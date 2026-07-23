// Headless M5 verification: the remaining state-based actions —
//  - losing from drawing off an empty library (704.5c),
//  - the legend rule (704.5j),
//  - +1/+1 and -1/-1 counter annihilation (704.5q).
// Run: node src/shared/engine/m5.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, inZone, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// --- 1. Draw from an empty library → you lose -------------------------------

section('1. drawing from an empty library loses the game')
{
  const e = makeEngine()
  // Empty player 0's library.
  const lib = zone(e.state, 'library', 0)
  lib.length = 0
  e.draw(0, 1)
  e._checkSBA()
  assert(e.state.winner === 1, 'player 1 wins when player 0 draws from an empty library')
}

// --- 2. Legend rule ---------------------------------------------------------

section('2. legend rule keeps only the newest same-named legend')
{
  const e = makeEngine()
  const first = put(e, 0, 'Isamaru, Hound of Konda', 'battlefield')
  first.timestamp = 1
  const second = put(e, 0, 'Isamaru, Hound of Konda', 'battlefield')
  second.timestamp = 2
  // A copy controlled by the opponent is unaffected.
  const theirs = put(e, 1, 'Isamaru, Hound of Konda', 'battlefield')
  theirs.timestamp = 3
  e._checkSBA()
  assert(inZone(e, 0, 'graveyard', first.oid), 'the older legend was put into the graveyard')
  assert(inZone(e, 0, 'battlefield', second.oid), 'the newest legend stays')
  assert(inZone(e, 1, 'battlefield', theirs.oid), "the opponent's copy is unaffected")
}

// --- 3. Counter annihilation ------------------------------------------------

section('3. +1/+1 and -1/-1 counters annihilate')
{
  const e = makeEngine()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', {
    counters: { '+1/+1': 3, '-1/-1': 1 }
  })
  e._checkSBA()
  assert(bear.status.counters['+1/+1'] === 2, 'one +1/+1 removed (3 - 1)')
  assert(!bear.status.counters['-1/-1'], 'all -1/-1 removed')
  assert(inZone(e, 0, 'battlefield', bear.oid), 'net 4/4 survives')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
