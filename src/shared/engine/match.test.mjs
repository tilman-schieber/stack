// Headless verification of the match rule the engine owns: in games after the
// first, the loser of the previous game decides who plays first (103.6) instead
// of a die roll.
// Run: node src/shared/engine/match.test.mjs

import { GameEngine } from './engine.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const deck = (name) => Array(40).fill(SAMPLE_CARDS[name])

const start = (opts) =>
  new GameEngine({
    seed: 'match',
    players: [
      { name: 'A', deck: deck('Forest') },
      { name: 'B', deck: deck('Mountain') }
    ],
    ...opts
  }).start()

section('Game 1: the die roll decides who chooses')
{
  const e = start({})
  assert(e.pending.kind === 'playOrDraw', 'the winner of the roll is asked to play or draw')
  assert(!e.pending.matchLoser, 'it is flagged as a die roll, not a match loser')
}

section('Games 2+: the named player (the previous loser) chooses')
{
  const e = start({ playDrawChooser: 1 })
  assert(e.pending.kind === 'playOrDraw' && e.pending.player === 1, 'seat 1 is asked')
  assert(e.pending.matchLoser === true, 'flagged as the match loser making the choice')
  e.choose({ play: true })
  assert(e.state.startingPlayer === 1, 'choosing to play makes them the starting player')

  const f = start({ playDrawChooser: 1 })
  f.choose({ play: false })
  assert(f.state.startingPlayer === 0, 'choosing to draw gives the turn to the opponent')
}

section('An explicit startingPlayer (tests) still skips the choice')
{
  const e = start({ startingPlayer: 0 })
  assert(e.pending.kind !== 'playOrDraw', 'no play/draw decision')
  assert(e.state.startingPlayer === 0, 'the given seat starts')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
