// Headless verification: phase-boundary triggers (rule 503/513) and delayed
// triggered abilities (603.7), via the sample-deck showcase cards Ball Lightning
// (end-step self-sacrifice), Phyrexian Arena (upkeep draw/lose-life), and
// Flickerwisp (ETB exile + delayed return at the next end step).
// Run: node src/shared/engine/delayed.test.mjs

import { zone } from './state.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

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
// Drive the game (declaring no attackers/blockers) until `pred` holds.
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

section('Ball Lightning: an end-step trigger sacrifices it')
{
  const e = makeEngine()
  const ball = put(e, 0, 'Ball Lightning', 'battlefield', { summoningSick: false })
  runUntil(e, (e) => e.state.step === 'end' && e.pending.kind === 'priority')
  assert(zone(e.state, 'stack').length === 1, 'the end-step sacrifice trigger is on the stack')
  resolveStack(e)
  assert(!inZone(e, 0, 'battlefield', ball.oid), 'Ball Lightning left the battlefield')
  assert(inZone(e, 0, 'graveyard', ball.oid), 'it was sacrificed to the graveyard')
}

section('Phyrexian Arena: an upkeep trigger draws a card and loses 1 life (only on your turn)')
{
  const e = makeEngine()
  put(e, 0, 'Phyrexian Arena', 'battlefield')
  // Reach the controller's next upkeep (turn 3 — turns alternate 0,1,0).
  runUntil(
    e,
    (e) => e.state.turnNumber === 3 && e.state.step === 'upkeep' && e.state.activePlayer === 0 && e.pending.kind === 'priority'
  )
  assert(e.state.players[0].life === 20, 'no life lost on turn 1/2 (never fired on the opponent’s upkeep)')
  const handBefore = zone(e.state, 'hand', 0).length
  assert(zone(e.state, 'stack').length === 1, 'the upkeep trigger is on the stack')
  resolveStack(e)
  assert(zone(e.state, 'hand', 0).length === handBefore + 1, 'drew a card')
  assert(e.state.players[0].life === 19, 'lost 1 life')
}

section('Flickerwisp: ETB exiles a creature, a delayed trigger returns it at the end step')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield') // the creature to blink
  const wisp = put(e, 0, 'Flickerwisp', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: wisp.oid }) // {1}{W}{W}
  resolveAll(e)
  assert(e.pending.kind === 'chooseTargets', 'Flickerwisp’s ETB asks for a creature to blink')
  e.choose({ targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  assert(inZone(e, 0, 'exile', bear.oid), 'the target was exiled')
  assert(e.state.delayedTriggers.length === 1, 'a delayed end-step return was scheduled')
  // Advance to this turn's end step; the delayed trigger returns the card.
  advanceToPriorityAt(e, 'end')
  assert(zone(e.state, 'stack').length === 1, 'the delayed return is on the stack at the end step')
  resolveStack(e)
  assert(inZone(e, 0, 'battlefield', bear.oid), 'the creature returned to the battlefield')
  assert(e.state.delayedTriggers.length === 0, 'the delayed trigger fired once and was cleared')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
