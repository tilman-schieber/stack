// Headless verification: control-changing continuous effects (rule 613, layer 2),
// via the sample-deck card Act of Treason — gain control of a creature until end of
// turn, untap it, give it haste; control reverts during cleanup.
// Run: node src/shared/engine/control.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, combat, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const resolveAll = (e) => {
  let g = 0
  while (zone(e.state, 'stack').length > 0 && e.pending.kind === 'priority' && g++ < 40) bothPass(e)
}
const runUntil = (e, pred, cap = 3000) => {
  let g = 0
  while (!pred(e) && g++ < cap) {
    const p = e.pending
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else if (p.kind === 'mulligan') e.choose({ keep: true })
    else throw new Error('unexpected decision ' + p.kind)
  }
}

section('Act of Treason: steal an enemy creature, swing with it, then control reverts')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // opponent's 2/2
  const act = put(e, 0, 'Act of Treason', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: act.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  recompute(e.state)
  assert(bear.controller === 0, 'gained control of the Bears')
  assert(bear.chars.keywords.includes('Haste'), 'it gained haste (so it can attack this turn)')
  assert(bear.status.summoningSick === true, 'it is summoning sick under its new controller (haste lets it attack anyway)')
  // Attack with the stolen creature — it hits its original owner.
  combat(e, [bear.oid])
  assert(e.state.players[1].life === 18, 'the stolen 2/2 dealt 2 to its owner')
  // Pass to the opponent's turn; control reverts during cleanup of turn 1.
  runUntil(e, (e) => e.state.activePlayer === 1 && e.state.step === 'upkeep')
  assert(bear.controller === 1, 'control reverted to the owner at end of turn')
  assert(inZone(e, 1, 'battlefield', bear.oid), 'the creature is back under its owner')
}

section('Act of Treason: cannot steal a creature you already control (no-op)')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const act = put(e, 0, 'Act of Treason', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: act.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  assert(bear.controller === 0, 'still yours')
  assert(!e.state.continuous.some((c) => c.control != null), 'no control effect was created')
}

section('Stolen creature that dies before cleanup does not revert or error')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const act = put(e, 0, 'Act of Treason', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: act.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  bear.status.damage = 99 // lethal — SBA buries it while you control it
  e._checkSBA()
  assert(inZone(e, 1, 'graveyard', bear.oid), 'the stolen creature died to its owner’s graveyard')
  runUntil(e, (e) => e.state.activePlayer === 1 && e.state.step === 'upkeep')
  assert(!e.state.continuous.some((c) => c.control != null), 'the control effect was cleaned up')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
