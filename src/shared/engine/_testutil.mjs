// Shared helpers for the headless engine tests. Deterministic, no framework.

import { GameEngine } from './engine.mjs'
import { createObject, zone, zoneKey } from './state.mjs'
import { SAMPLE_CARDS } from './cards.mjs'

// Resolve the opening mulligan phase by keeping both hands (no mulligans).
export function keepAll(engine) {
  let g = 0
  while (
    engine.pending &&
    (engine.pending.kind === 'mulligan' || engine.pending.kind === 'bottom') &&
    g++ < 50
  ) {
    if (engine.pending.kind === 'mulligan') engine.choose({ keep: true })
    else engine.choose({ bottom: engine.pending.hand.slice(0, engine.pending.count) })
  }
  return engine
}

export function makeEngine(deckName = 'Forest', size = 20) {
  const deck = Array(size).fill(deckName)
  const engine = new GameEngine({
    seed: 'test',
    players: [{ name: 'A', deck }, { name: 'B', deck }]
  }).start()
  return keepAll(engine)
}

// Place a fresh card object directly into a zone (bypasses draw/shuffle so
// scenarios are deterministic).
export function put(engine, pid, name, zoneName, status = {}) {
  const o = createObject(engine.state, SAMPLE_CARDS[name], pid)
  o.zoneName = zoneName
  if (zoneName === 'battlefield') o.controller = pid
  Object.assign(o.status, status)
  engine.state.zones[zoneKey(zoneName, pid)].push(o.oid)
  return o
}

export const inZone = (engine, pid, zoneName, oid) => zone(engine.state, zoneName, pid).includes(oid)

// Pass priority (from whoever holds it) until the active player has priority at
// the given step. Only ever passes.
export function advanceToPriorityAt(engine, step) {
  let guard = 0
  while (guard++ < 500) {
    const p = engine.pending
    if (p.kind === 'priority' && engine.state.step === step && p.player === engine.state.activePlayer)
      return
    if (p.kind === 'priority') engine.choose({ type: 'pass' })
    else throw new Error(`unexpected decision ${p.kind} at step ${engine.state.step}`)
  }
  throw new Error('advanceToPriorityAt did not reach ' + step)
}

// Both players pass in succession — resolves the top of the stack (or ends step).
// Repeats while a priority decision keeps coming back to the acting player, so a
// chain of triggers/resolutions all resolve.
export function resolveStack(engine) {
  let guard = 0
  while (zone(engine.state, 'stack').length > 0 && guard++ < 200) {
    if (engine.pending.kind !== 'priority') break
    engine.choose({ type: 'pass' })
    if (engine.pending.kind === 'priority') engine.choose({ type: 'pass' })
  }
}

// Drive one combat: from main1, declare `attackers`, then `blocks`
// ({ blockerOid: attackerOid }), then pass through combat damage to main2.
// Assumes the active player controls the attackers.
export function combat(engine, attackers, blocks = {}) {
  advanceToPriorityAt(engine, 'main1')
  let g = 0
  while (engine.pending.kind !== 'declareAttackers' && g++ < 50) engine.choose({ type: 'pass' })
  engine.choose({ attackers })
  if (engine.pending.kind === 'gameOver') return
  g = 0
  while (engine.pending.kind === 'priority' && engine.state.step !== 'declareBlockers' && g++ < 50)
    engine.choose({ type: 'pass' })
  if (engine.pending.kind === 'declareBlockers') engine.choose({ blocks })
  g = 0
  while (
    engine.pending.kind === 'priority' &&
    engine.state.step !== 'main2' &&
    engine.state.step !== 'cleanup' &&
    g++ < 50
  )
    engine.choose({ type: 'pass' })
}

export function makeAsserter() {
  const stats = { passed: 0, failed: 0 }
  const assert = (cond, msg) => {
    if (cond) stats.passed++
    else {
      stats.failed++
      console.error('  ✗ ' + msg)
    }
  }
  return { assert, stats }
}
