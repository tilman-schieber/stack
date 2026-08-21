// Headless verification: an extensible turn structure (rule 720 / 500-506).
// Time Walk queues an extra turn for its caster; Relentless Assault inserts an
// additional combat phase (plus main) after the current main phase.
// Run: node src/shared/engine/extraturns.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Drive the game forward one decision at a time until `stop(state)` holds,
// counting how many declareAttackers phases occur. Returns the count.
function driveUntil(e, stop, cap = 4000) {
  let attackPhases = 0
  let g = 0
  while (!stop(e.state) && g++ < cap) {
    const p = e.pending
    if (p.kind === 'declareAttackers') {
      attackPhases++
      e.choose({ attackers: [] })
    } else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else e.choose({})
  }
  return attackPhases
}

section('Time Walk gives its caster (player 0) another turn instead of passing to player 1')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const tw = put(e, 0, 'Time Walk', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: tw.oid, targets: [] })
  resolveStack(e)
  assert(e.state.extraTurns.length === 1 && e.state.extraTurns[0] === 0, 'an extra turn is queued for player 0')
  // Play out turn 1 (player 0) into the next turn's upkeep.
  driveUntil(e, (st) => st.turnNumber === 2 && st.step === 'upkeep')
  assert(e.state.activePlayer === 0, 'the next turn is player 0 again (the extra turn)')
  // And the turn after the extra one goes back to player 1.
  driveUntil(e, (st) => st.turnNumber === 3 && st.step === 'upkeep')
  assert(e.state.activePlayer === 1, 'after the extra turn, play passes to player 1')
}

section('Relentless Assault inserts a second combat phase in the same turn')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Raging Goblin', 'battlefield', { summoningSick: false }) // a creature so combat isn't skipped
  const ra = put(e, 0, 'Relentless Assault', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: ra.oid, targets: [] })
  resolveStack(e)
  assert(e.state.extraCombats === 1, 'an additional combat phase is scheduled')
  // Count combat phases for the rest of this (player 0's) turn.
  const phases = driveUntil(e, (st) => st.turnNumber === 2)
  assert(phases === 2, 'the turn had two declareAttackers phases (normal + additional)')
}

section('A normal turn has exactly one combat phase (control)')
{
  const e = makeEngine()
  put(e, 0, 'Raging Goblin', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  const phases = driveUntil(e, (st) => st.turnNumber === 2)
  assert(phases === 1, 'one combat phase without Relentless Assault')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
