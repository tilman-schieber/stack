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
    types: o.chars?.types || [],
    power: o.chars?.power ?? null,
    toughness: o.chars?.toughness ?? null,
    keywords: o.chars?.keywords || [],
    tapped: !!o.status?.tapped,
    summoningSick: !!o.status?.summoningSick,
    attacking: !!o.status?.attacking,
    blocked: !!o.status?.blocked,
    blocking: o.status?.blocking || null,
    damage: o.status?.damage || 0,
    counters: o.status?.counters || {}
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

  return {
    turnNumber: state.turnNumber,
    step: state.step,
    activePlayer: state.activePlayer,
    winner: state.winner,
    pending: state.pending,
    priorityPlayer: state.pending?.kind === 'priority' ? state.pending.player : null,
    stack: zone(state, 'stack').map((oid) => stackView(state, oid)),
    players
  }
}
