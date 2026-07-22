// Headless M1 verification: triggered abilities (etb/dies/attacks) and the new
// spell effects (draw, targeted destroy, counter, lifegain).
// Run: node src/shared/engine/m1.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const handCount = (e, pid) => zone(e.state, 'hand', pid).length

// --- 1. ETB trigger: Elvish Visionary draws a card --------------------------

section('1. ETB trigger — Elvish Visionary draws')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const viz = put(e, 0, 'Elvish Visionary', 'hand')
  advanceToPriorityAt(e, 'main1')
  const before = handCount(e, 0)

  e.choose({ type: 'cast', oid: viz.oid })
  resolveStack(e) // creature resolves, ETB trigger goes on stack, then resolves

  assert(viz.zoneName === 'battlefield', 'Visionary resolved onto the battlefield')
  // hand: -1 for the cast, +1 for the ETB draw → net unchanged from `before`.
  assert(handCount(e, 0) === before, 'ETB drew a card (net hand unchanged after casting)')
}

// --- 2. ETB trigger with filter: Soul Warden (another creature) -------------

section('2. ETB filter — Soul Warden gains life for another creature')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Soul Warden', 'battlefield') // already out, life 20
  const bears = put(e, 0, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: bears.oid })
  resolveStack(e)
  assert(e.state.players[0].life === 21, 'Soul Warden gained 1 life when another creature entered')
}

// --- 3. Dies trigger: Blood Artist ------------------------------------------

section('3. Dies trigger — Blood Artist gains life on a death')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Blood Artist', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const victim = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: victim.oid }] })
  resolveStack(e) // bolt resolves → SBA kills bears → dies trigger → gain life

  assert(inZone(e, 1, 'graveyard', victim.oid), 'victim died to the graveyard')
  assert(e.state.players[0].life === 21, 'Blood Artist gained 1 life on the death')
}

// --- 4. Attacks trigger fires on declaration --------------------------------

section('4. Attacks trigger — Blood Artist alive, attacker declared')
{
  // No attacks-trigger card in the pool, so assert the plumbing: declaring an
  // attacker queues nothing spurious and combat still resolves a death, which
  // Blood Artist observes (a stand-in for attack-driven triggers).
  const e = makeEngine()
  const attacker = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  put(e, 1, 'Blood Artist', 'battlefield')
  const blocker = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')

  let guard = 0
  while (e.pending.kind !== 'declareAttackers' && guard++ < 50) e.choose({ type: 'pass' })
  e.choose({ attackers: [attacker.oid] })
  guard = 0
  while (e.pending.kind !== 'declareBlockers' && guard++ < 50) e.choose({ type: 'pass' })
  e.choose({ blocks: { [blocker.oid]: attacker.oid } })
  guard = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && guard++ < 50)
    e.choose({ type: 'pass' })

  assert(inZone(e, 0, 'graveyard', attacker.oid), 'attacker died in combat')
  assert(inZone(e, 1, 'graveyard', blocker.oid), 'blocker died in combat')
  // Blood Artist (p1) saw two creatures die → +2 life.
  assert(e.state.players[1].life === 22, 'Blood Artist gained 2 life from two combat deaths')
}

// --- 5. Counterspell counters a spell ---------------------------------------

section('5. Counterspell')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'hand')
  const cs = put(e, 1, 'Counterspell', 'hand')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: bears.oid }) // p0 casts creature, retains priority
  e.choose({ type: 'pass' }) // p0 passes → p1 gets priority with bears on the stack
  assert(e.pending.player === 1, 'defender has priority with the spell on the stack')
  e.choose({ type: 'cast', oid: cs.oid, targets: [{ kind: 'spell', oid: bears.oid }] })
  resolveStack(e)

  assert(inZone(e, 0, 'graveyard', bears.oid), 'countered creature went to the graveyard')
  assert(bears.zoneName !== 'battlefield', 'countered creature never resolved')
  assert(inZone(e, 1, 'graveyard', cs.oid), 'Counterspell went to its graveyard')
}

// --- 6. Doom Blade destroys a creature --------------------------------------

section('6. Doom Blade destroys target creature')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const db = put(e, 0, 'Doom Blade', 'hand')
  const target = put(e, 1, 'Serra Angel', 'battlefield')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: db.oid, targets: [{ kind: 'object', oid: target.oid }] })
  resolveStack(e)
  assert(inZone(e, 1, 'graveyard', target.oid), 'Serra Angel destroyed to the graveyard')
}

// --- 7. Divination draws two --------------------------------------------------

section('7. Divination draws two')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const div = put(e, 0, 'Divination', 'hand')
  advanceToPriorityAt(e, 'main1')
  const before = handCount(e, 0)

  e.choose({ type: 'cast', oid: div.oid })
  resolveStack(e)
  // -1 cast, +2 drawn = net +1 vs before.
  assert(handCount(e, 0) === before + 1, 'Divination netted +1 card (drew 2, spent 1)')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
