// Project engine state into a plain, serializable view for the renderer. The UI
// never touches engine internals directly — it reads this snapshot and sends
// choices back through GameEngine.choose().

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'

function cardView(o, viewerPid = null, engine = null) {
  // A face-down permanent (morph) shows only as an anonymous 2/2 creature — its
  // real card, colors, and abilities are hidden from other players. Its controller
  // (and the open local hot-seat view) additionally get the real identity in
  // `realName`/`realCardId` so they know what they can turn face up.
  if (o.faceDown) {
    const mine = viewerPid == null || viewerPid === o.controller
    return {
      oid: o.oid,
      name: 'Face-down creature',
      cardId: null,
      realName: mine ? o.printed?.name || null : null,
      realCardId: mine ? o.cardId || null : null,
      token: false,
      faceDown: true,
      types: ['Creature'],
      supertypes: [],
      colors: [],
      power: 2,
      toughness: 2,
      keywords: [],
      protections: [],
      tapped: !!o.status?.tapped,
      summoningSick: !!o.status?.summoningSick,
      attacking: !!o.status?.attacking,
      blocked: !!o.status?.blocked,
      blocking: o.status?.blocking || null,
      damage: o.status?.damage || 0,
      counters: o.status?.counters || {},
      loyalty: null
    }
  }
  return {
    oid: o.oid,
    name: o.chars?.name || o.printed?.name || '',
    cardId: o.cardId || null,
    face: o.face || 0, // 1 = the back face of a double-faced card is up
    token: !!o.token,
    tokenDef: o.tokenDef || null,
    types: o.chars?.types || [],
    supertypes: o.chars?.supertypes || [],
    colors: o.chars?.colors || [],
    power: o.chars?.power ?? null,
    toughness: o.chars?.toughness ?? null,
    keywords: o.chars?.keywords || [],
    protections: o.chars?.protections || [],
    tapped: !!o.status?.tapped,
    summoningSick: !!o.status?.summoningSick,
    attacking: !!o.status?.attacking,
    blocked: !!o.status?.blocked,
    blocking: o.status?.blocking || null,
    damage: o.status?.damage || 0,
    counters: o.status?.counters || {},
    loyalty: o.chars?.types?.includes('Planeswalker') ? o.status?.counters?.loyalty ?? null : null,
    defense: o.chars?.types?.includes('Battle') ? o.status?.counters?.defense ?? null : null,
    protector: o.chars?.types?.includes('Battle') ? o.protector ?? null : undefined,
    // For the card inspector: rules text, which keywords are granted rather than
    // printed, whether the engine enforces all of this card's text, and any
    // attack/block restrictions currently applying to it.
    oracleText: o.printed?.oracleText || '',
    printedKeywords: o.printed?.keywords || [],
    supported: o.supported !== false,
    restrictions:
      engine && o.zoneName === 'battlefield' && o.chars?.types?.includes('Creature')
        ? ['attack', 'block'].filter((a) => engine._restricted(o, a) || (a === 'block' && engine._ability(o, 'cantBlock')))
        : []
  }
}

// An opponent's hand card as seen by a viewer who may not know its identity — a
// face-down "card back". Keeps the oid (so counts/animation line up) but leaks
// nothing about what the card is. Mirrors the face-down redaction above.
function hiddenHandCard(o) {
  return { oid: o.oid, hidden: true, name: 'Hidden card', cardId: null, token: false }
}

function stackView(state, oid) {
  const o = state.objects[oid]
  if (o.kind === 'ability') {
    const src = state.objects[o.sourceOid]
    return {
      oid: o.oid,
      kind: 'ability',
      name: (src?.printed?.name || 'Ability') + ' — ability',
      cardId: src?.cardId || null,
      controller: o.controller,
      targets: o.targets || [],
      targetNames: targetNames(state, o.targets)
    }
  }
  return {
    oid: o.oid,
    kind: 'spell',
    name: o.printed?.name || '',
    cardId: o.cardId || null,
    face: o.layout === 'transform' || o.layout === 'modal_dfc' ? o.face || 0 : 0,
    controller: o.controller,
    targets: o.targets || [],
    targetNames: targetNames(state, o.targets)
  }
}

// Readable names for a stack object's targets (players, permanents, spells).
function targetNames(state, targets) {
  return (targets || []).map((t) => (t?.kind === 'player' ? state.players[t.pid]?.name || 'a player' : state.objects[t?.oid]?.chars?.name || state.objects[t?.oid]?.printed?.name || '?'))
}

// Build the serializable view. `viewerPid` (default null) redacts hidden
// information for networked play: when set, other players' hands are shown as card
// backs and library-revealing pending decisions (scry/search/explore) owned by an
// opponent are stripped. `null` yields the full view used by local hot-seat.
export function projectGame(engine, viewerPid = null) {
  const state = engine.state
  recompute(state) // ensure P/T reflects anthems/pumps in the view
  const bf = zone(state, 'battlefield')

  const players = state.players.map((p) => {
    const controlled = bf.map((oid) => state.objects[oid]).filter((o) => o.controller === p.id)
    const hidden = viewerPid != null && p.id !== viewerPid // hide this player's hand from the viewer
    return {
      id: p.id,
      name: p.name,
      life: p.life,
      manaPool: p.manaPool,
      restrictedMana: (p.restrictedPool || []).map((r) => r.color),
      counters: p.counters,
      handCount: zone(state, 'hand', p.id).length,
      libraryCount: zone(state, 'library', p.id).length,
      hand: zone(state, 'hand', p.id).map((oid) =>
        hidden ? hiddenHandCard(state.objects[oid]) : cardView(state.objects[oid])
      ),
      battlefield: controlled.map((o) => cardView(o, viewerPid, engine)),
      graveyard: zone(state, 'graveyard', p.id).map((oid) => cardView(state.objects[oid])),
      exile: zone(state, 'exile', p.id).map((oid) => cardView(state.objects[oid])),
      // Commander: this player's cards in the (shared) command zone.
      command: zone(state, 'command')
        .filter((oid) => state.objects[oid]?.owner === p.id)
        .map((oid) => ({ ...cardView(state.objects[oid]), commanderCasts: state.objects[oid].commanderCasts || 0 })),
      commanderDamage: p.commanderDamage || {},
      // Phased-out permanents (702.26): out of the game until they phase back in.
      phasedOut: (state.phasedOut || [])
        .filter((x) => x.controller === p.id)
        .flatMap((x) => x.oids)
        .map((oid) => cardView(state.objects[oid], viewerPid))
    }
  })

  // Scry/surveil reveals specific library cards to their controller — enrich them
  // into card views so the UI can show the art. To another player's view, those
  // cards are private, so strip them (keep kind/player so "waiting…" can show).
  let pending = state.pending
  const privateToViewer = viewerPid == null || pending?.player === viewerPid
  if (pending?.kind === 'scry' || pending?.kind === 'search')
    pending = privateToViewer
      ? { ...pending, cards: pending.cards.map((oid) => cardView(state.objects[oid])) }
      : { ...pending, cards: pending.cards.map((oid) => ({ oid, hidden: true })) }
  else if (pending?.kind === 'lookAtHand' || pending?.kind === 'chooseFromHand')
    // A revealed hand is public information (701.15): every viewer sees the cards.
    pending = { ...pending, cards: pending.cards.map((oid) => cardView(state.objects[oid])), hand: (pending.hand || pending.cards).map((oid) => cardView(state.objects[oid])) }
  else if (pending?.kind === 'explore')
    pending = privateToViewer
      ? { ...pending, card: cardView(state.objects[pending.card]) }
      : { ...pending, card: { oid: pending.card, hidden: true } }

  return {
    format: state.format || null,
    turnNumber: state.turnNumber,
    step: state.step,
    activePlayer: state.activePlayer,
    winner: state.winner,
    pending,
    priorityPlayer: pending?.kind === 'priority' ? pending.player : null,
    stack: zone(state, 'stack').map((oid) => stackView(state, oid)),
    players,
    // The public game log (never contains hidden information), most recent last.
    log: state.log.slice(-200)
  }
}
