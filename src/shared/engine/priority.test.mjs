// Headless verification of the Magic Online-style priority decision: stops per
// own/opponent turn, always responding to an opponent's stack object, yields
// (F4 / F6) and holding priority after your own spell.
// Run: node src/shared/engine/priority.test.mjs
import { priorityDecision, stopKey, DEFAULT_STOPS } from './priority.mjs'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// A minimal state: seat 0 holds priority with a castable spell available.
const mk = ({ step = 'main1', active = 0, me = 0, turn = 3, stack = [], canAct = true } = {}) => {
  const objects = {}
  stack.forEach((ctrl, i) => (objects['s' + i] = { controller: ctrl }))
  return {
    step,
    activePlayer: active,
    turnNumber: turn,
    zones: { stack: stack.map((_, i) => 's' + i) },
    objects,
    pending: { kind: 'priority', player: me, actions: canAct ? [{ type: 'pass' }, { type: 'cast', oid: 'x' }, { type: 'activate', mana: true }] : [{ type: 'pass' }, { type: 'activate', mana: true }] }
  }
}
const stops = new Set(DEFAULT_STOPS)

section('stops on an empty stack')
assert(priorityDecision(mk(), stops).give === true, 'own main 1 with a default stop: handed priority')
assert(priorityDecision(mk({ step: 'upkeep' }), stops).give === false, 'own upkeep without a stop: passes')
assert(priorityDecision(mk({ step: 'end', active: 1 }), stops).give === true, "opponent's end step (default stop): handed priority")
assert(priorityDecision(mk({ step: 'main1', active: 1 }), stops).give === false, "opponent's main 1 without a stop: passes")
assert(priorityDecision(mk({ canAct: false }), stops).give === false, 'nothing but mana abilities to do: passes even at a stop')
assert(stopKey('end', true) === 'opp:end' && stopKey('end', false) === 'end', 'stop keys')

section("an opponent's spell on the stack always gives a chance to respond")
assert(priorityDecision(mk({ step: 'main1', active: 1, stack: [1] }), stops).give === true, "opponent's spell during their main phase (no stop there)")
assert(priorityDecision(mk({ step: 'upkeep', active: 1, stack: [1] }), new Set()).give === true, 'even with no stops at all')
assert(priorityDecision(mk({ step: 'upkeep', stack: [0] }), new Set()).give === false, 'your own spell on top: passes (no hold)')

section('yields')
const yTurn = { kind: 'turn', turn: 3 }
const yAll = { kind: 'all', turn: 3 }
assert(priorityDecision(mk(), stops, yTurn).give === false, 'F4: a stop is skipped')
{
  const d = priorityDecision(mk({ active: 1, step: 'main1', stack: [1] }), stops, yTurn)
  assert(d.give === true && d.cancelYield === true, "F4: still stops for the opponent's spell, and the yield is cancelled")
}
assert(priorityDecision(mk({ active: 1, step: 'main1', stack: [1] }), stops, yAll).give === false, "F6: passes even the opponent's spell")
assert(priorityDecision(mk(), stops, { kind: 'all', turn: 2 }).give === true, 'a yield from an earlier turn has expired')

section('hold priority after your own spell')
{
  const d = priorityDecision(mk({ stack: [0] }), new Set(), undefined, true)
  assert(d.give === true && d.consumeHold === true, 'held: priority comes back with your spell on the stack, and the hold is used up')
  assert(priorityDecision(mk({ stack: [] }), new Set(), undefined, true).give === false, 'held but nothing of yours on the stack: no effect yet')
  assert(priorityDecision(mk({ stack: [0] }), new Set(), yAll, true).give === true, 'a hold beats F6 for your own spell')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
