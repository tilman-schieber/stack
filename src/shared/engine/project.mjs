// Project engine state into a plain, serializable view for the renderer. The UI
// never touches engine internals directly — it reads this snapshot and sends
// choices back through GameEngine.choose().

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'

function cardView(o) {
  return {
    oid: o.oid,
    name: o.chars?.name || o.printed?.name || '',
    cardId: o.cardId || null,
    token: !!o.token,
    tokenDef: o.tokenDef || null,
    types: o.chars?.types || [],
    supertypes: o.chars?.supertypes || [],
    power: o.chars?.power ?? null,
    toughness: o.chars?.toughness ?? null,
    keywords: o.chars?.keywords || [],
    tapped: !!o.status?.tapped,
    summoningSick: !!o.status?.summoningSick,
    attacking: !!o.status?.attacking,
    blocked: !!o.status?.blocked,
    blocking: o.status?.blocking || null,
    damage: o.status?.damage || 0,
    counters: o.status?.counters || {},
    loyalty: o.chars?.types?.includes('Planeswalker') ? o.status?.counters?.loyalty ?? null : null
  }
}

function stackView(state, oid) {
  const o = state.objects[oid]
  if (o.kind === 'ability') {
    const src = state.objects[o.sourceOid]
    return {
      oid: o.oid,
      kind: 'ability',
      name: (src?.printed?.name || 'Ability') + ' — triggered ability',
      controller: o.controller,
      targets: o.targets || []
    }
  }
  return {
    oid: o.oid,
    kind: 'spell',
    name: o.printed?.name || '',
    cardId: o.cardId || null,
    controller: o.controller,
    targets: o.targets || []
  }
}

export function projectGame(engine) {
  const state = engine.state
  recompute(state) // ensure P/T reflects anthems/pumps in the view
  const bf = zone(state, 'battlefield')

  const players = state.players.map((p) => {
    const controlled = bf.map((oid) => state.objects[oid]).filter((o) => o.controller === p.id)
    return {
      id: p.id,
      name: p.name,
      life: p.life,
      manaPool: p.manaPool,
      counters: p.counters,
      handCount: zone(state, 'hand', p.id).length,
      libraryCount: zone(state, 'library', p.id).length,
      hand: zone(state, 'hand', p.id).map((oid) => cardView(state.objects[oid])),
      battlefield: controlled.map(cardView),
      graveyard: zone(state, 'graveyard', p.id).map((oid) => cardView(state.objects[oid])),
      exile: zone(state, 'exile', p.id).map((oid) => cardView(state.objects[oid]))
    }
  })

  // Scry/surveil reveals specific library cards to their controller — enrich
  // them into card views so the UI can show the art.
  let pending = state.pending
  if (pending?.kind === 'scry' || pending?.kind === 'search')
    pending = { ...pending, cards: pending.cards.map((oid) => cardView(state.objects[oid])) }
  else if (pending?.kind === 'explore')
    pending = { ...pending, card: cardView(state.objects[pending.card]) }

  return {
    turnNumber: state.turnNumber,
    step: state.step,
    activePlayer: state.activePlayer,
    winner: state.winner,
    pending,
    priorityPlayer: pending?.kind === 'priority' ? pending.player : null,
    stack: zone(state, 'stack').map((oid) => stackView(state, oid)),
    players
  }
}
