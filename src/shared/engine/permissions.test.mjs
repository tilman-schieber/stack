// Headless verification: "as though" permission effects (rule 118) via Vedalken
// Orrery — "You may cast spells as though they had flash." A sorcery-speed spell
// becomes castable on the opponent's turn / with the stack non-empty.
// Run: node src/shared/engine/permissions.test.mjs

import { put, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Advance until `pid` holds priority during the OTHER player's turn.
function toOffTurnPriority(e, pid, cap = 4000) {
  let g = 0
  while (g++ < cap) {
    const p = e.pending
    if (p.kind === 'priority' && e.state.activePlayer !== pid && p.player === pid) return true
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else e.choose({})
  }
  return false
}

const setup = (withOrrery) => {
  const e = makeEngineFresh()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  if (withOrrery) put(e, 0, 'Vedalken Orrery', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'hand') // a sorcery-speed creature
  return { e, bears }
}

// A fresh engine that keeps both hands (no mulligans).
import { GameEngine } from './engine.mjs'
function makeEngineFresh() {
  const deck = Array(20).fill('Forest')
  const e = new GameEngine({ seed: 'perm', players: [{ name: 'A', deck }, { name: 'B', deck }] }).start()
  let g = 0
  while (e.pending && (e.pending.kind === 'mulligan' || e.pending.kind === 'bottom') && g++ < 50) {
    if (e.pending.kind === 'mulligan') e.choose({ keep: true })
    else e.choose({ bottom: e.pending.hand.slice(0, e.pending.count) })
  }
  return e
}

section('With Vedalken Orrery you can cast a creature on the opponent’s turn')
{
  const { e, bears } = setup(true)
  assert(toOffTurnPriority(e, 0), 'player 0 gets priority during player 1’s turn')
  const castable = e.pending.actions.some((a) => a.type === 'cast' && a.oid === bears.oid)
  assert(castable, 'Grizzly Bears is castable at instant speed thanks to Orrery')
}

section('Without it, a sorcery-speed creature is NOT castable on the opponent’s turn')
{
  const { e, bears } = setup(false)
  assert(toOffTurnPriority(e, 0), 'player 0 gets priority during player 1’s turn')
  const castable = e.pending.actions.some((a) => a.type === 'cast' && a.oid === bears.oid)
  assert(!castable, 'the creature cannot be cast off-turn without the permission')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
