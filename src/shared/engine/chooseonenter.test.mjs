// Headless verification: choose-and-remember on entry (rule 614.12b) via Adaptive
// Automaton — "As this creature enters, choose a creature type. Other creatures you
// control of the chosen type get +1/+1." The chosen value is remembered on the
// permanent and read by its static ability.
// Run: node src/shared/engine/chooseonenter.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('Casting Adaptive Automaton pauses to choose a creature type')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  const auto = put(e, 0, 'Adaptive Automaton', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: auto.oid, targets: [] })
  resolveStack(e)
  assert(e.pending.kind === 'chooseValue', 'a choose-value decision is pending as it enters')
  assert(e.pending.options.includes('Goblin'), 'creature types are offered')
  e.choose({ value: 'Goblin' })
  assert(auto.chosen === 'Goblin', 'the chosen type is remembered on the permanent')
  assert(auto.zoneName === 'battlefield', 'the Automaton is on the battlefield')
}

section('The lord buffs only your other creatures of the chosen type')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  const goblin = put(e, 0, 'Goblin Piker', 'battlefield', { summoningSick: false }) // 2/1 Goblin
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2 Bear (not a Goblin)
  const oppGob = put(e, 1, 'Raging Goblin', 'battlefield', { summoningSick: false }) // opponent's Goblin
  const auto = put(e, 0, 'Adaptive Automaton', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: auto.oid, targets: [] })
  resolveStack(e)
  e.choose({ value: 'Goblin' })
  recompute(e.state)
  assert(goblin.chars.power === 3 && goblin.chars.toughness === 2, 'your Goblin got +1/+1 (2/1 -> 3/2)')
  assert(bear.chars.power === 2, 'your non-Goblin Bear is unaffected')
  assert(oppGob.chars.power === 1, "the opponent's Goblin is unaffected")
}

section('Choosing a different type moves the buff accordingly')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  const goblin = put(e, 0, 'Goblin Piker', 'battlefield', { summoningSick: false })
  const auto = put(e, 0, 'Adaptive Automaton', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: auto.oid, targets: [] })
  resolveStack(e)
  e.choose({ value: 'Elf' }) // no Elves in play -> Goblin unaffected
  recompute(e.state)
  assert(goblin.chars.power === 2, 'with Elf chosen, the Goblin gets no bonus')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
