// Headless verification: planeswalkers — enter with loyalty, loyalty abilities
// (sorcery speed, once per turn, +/- loyalty cost) go on the stack, damage
// removes loyalty, and 0 loyalty is a state-based loss to the graveyard.
// Run: node src/shared/engine/planeswalker.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const loyalty = (o) => o.status.counters.loyalty
const activateActions = (e, oid) => e.pending.actions.filter((a) => a.type === 'activate' && a.oid === oid)

section('1. enters with loyalty; +1 ability adds loyalty and deals 1')
{
  const e = makeEngine()
  const chandra = put(e, 0, 'Chandra Nalaar', 'battlefield')
  chandra.status.counters.loyalty = 6 // put() bypasses ETB, so seed loyalty
  put(e, 1, 'Grizzly Bears', 'battlefield') // a creature so the -3 target is legal
  advanceToPriorityAt(e, 'main1')

  const acts = activateActions(e, chandra.oid)
  assert(acts.length === 2, 'both loyalty abilities are offered')
  assert(acts.some((a) => a.loyalty === 1) && acts.some((a) => a.loyalty === -3), 'costs exposed (+1 / -3)')

  e.choose({ type: 'activate', oid: chandra.oid, ability: 0, targets: [{ kind: 'player', pid: 1 }] })
  assert(loyalty(chandra) === 7, '+1 raised loyalty to 7')
  bothPass(e) // ability resolves
  assert(e.state.players[1].life === 19, 'dealt 1 damage to the opponent')
}

section('2. only one loyalty ability per turn')
{
  const e = makeEngine()
  const chandra = put(e, 0, 'Chandra Nalaar', 'battlefield')
  chandra.status.counters.loyalty = 6
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'activate', oid: chandra.oid, ability: 0, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(activateActions(e, chandra.oid).length === 0, 'no more loyalty abilities this turn')
}

section('3. -3 needs enough loyalty; kills a creature')
{
  const e = makeEngine()
  const chandra = put(e, 0, 'Chandra Nalaar', 'battlefield')
  chandra.status.counters.loyalty = 2 // not enough for -3
  const angel = put(e, 1, 'Serra Angel', 'battlefield') // 4/4
  advanceToPriorityAt(e, 'main1')
  assert(!activateActions(e, chandra.oid).some((a) => a.loyalty === -3), '-3 not offered at 2 loyalty')

  chandra.status.counters.loyalty = 3
  refresh(e)
  e.choose({ type: 'activate', oid: chandra.oid, ability: 1, targets: [{ kind: 'object', oid: angel.oid }] })
  // Paying -3 drops Chandra to 0 loyalty, so she dies to SBA immediately (the
  // ability is already on the stack and still resolves).
  assert(inZone(e, 0, 'graveyard', chandra.oid), 'Chandra died from 0 loyalty (SBA)')
  bothPass(e) // ability resolves
  assert(inZone(e, 1, 'graveyard', angel.oid), 'the ability still killed the 4/4')
}

section('4. damage to a planeswalker removes loyalty')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const chandra = put(e, 1, 'Chandra Nalaar', 'battlefield')
  chandra.status.counters.loyalty = 6
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: chandra.oid }] })
  bothPass(e)
  assert(loyalty(chandra) === 3, 'Bolt removed 3 loyalty (6 -> 3)')
  assert(inZone(e, 1, 'battlefield', chandra.oid), 'still alive at 3 loyalty')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
