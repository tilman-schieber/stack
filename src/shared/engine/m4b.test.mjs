// Headless M4b verification: targeted triggered abilities. The target is chosen
// as the ability is put on the stack (a `chooseTargets` decision). Flametongue
// Kavu — "When it enters, it deals 4 damage to target creature."
// Run: node src/shared/engine/m4b.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

// --- 1. ETB deals 4 to a chosen target creature ----------------------------

section('1. Flametongue Kavu kills a chosen creature')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Mountain', 'battlefield')
  const ftk = put(e, 0, 'Flametongue Kavu', 'hand')
  const victim = put(e, 1, 'Serra Angel', 'battlefield') // 4/4
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: ftk.oid }) // creature, no cast targets
  bothPass(e) // FTK resolves, enters, ETB trigger wants a target
  assert(e.pending.kind === 'chooseTargets', 'engine pauses to choose the trigger target')
  assert(e.pending.name === 'Flametongue Kavu', 'decision names its source')
  assert(e.pending.targets[0].type === 'creature', 'target spec is a creature')

  e.choose({ targets: [{ kind: 'object', oid: victim.oid }] })
  assert(zone(e.state, 'stack').length === 1, 'the triggered ability is on the stack')
  bothPass(e) // ability resolves
  assert(inZone(e, 1, 'graveyard', victim.oid), '4 damage killed the 4/4')
  assert(inZone(e, 0, 'battlefield', ftk.oid), 'Flametongue Kavu is on the battlefield')
}

// --- 2. Must target even if only itself is legal ----------------------------

section('2. forced to target itself when no other creature exists')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Mountain', 'battlefield')
  const ftk = put(e, 0, 'Flametongue Kavu', 'hand')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: ftk.oid })
  bothPass(e)
  assert(e.pending.kind === 'chooseTargets', 'still must choose a target')
  e.choose({ targets: [{ kind: 'object', oid: ftk.oid }] }) // only legal target is itself
  bothPass(e)
  assert(inZone(e, 0, 'graveyard', ftk.oid), 'the 4/2 shoots itself and dies')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
