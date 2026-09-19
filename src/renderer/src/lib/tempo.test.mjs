// Headless verification of how fast the table plays itself.
// Run: node src/renderer/src/lib/tempo.test.mjs
import { signatureOf, changeKind, beatFor, thinkTime, urgency, BEATS, SPEEDS } from './tempo.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// A minimal engine-shaped state: two players and the zones a signature reads.
const state = (over = {}) => ({
  turnNumber: 3,
  activePlayer: 0,
  step: 'main1',
  players: [
    { id: 0, life: 20 },
    { id: 1, life: 20 }
  ],
  zones: {
    stack: [],
    'hand:0': ['a', 'b'],
    'battlefield:0': ['c'],
    'graveyard:0': [],
    'exile:0': [],
    'library:0': new Array(30).fill('x'),
    'hand:1': ['d'],
    'battlefield:1': [],
    'graveyard:1': [],
    'exile:1': [],
    'library:1': new Array(30).fill('y')
  },
  ...over
})
const kindOf = (mutate) => {
  const before = signatureOf(state())
  const s = state()
  mutate(s)
  return changeKind(before, signatureOf(s))
}

section('A step nobody would notice costs nothing')
{
  assert(changeKind(signatureOf(state()), signatureOf(state())) === 'none', 'an identical board is no change')
  assert(beatFor('none') === 0, 'and buys no pause')
  // Priority moving between players is not in the signature at all: it is the
  // single commonest thing the engine does and the least worth watching.
  assert(kindOf((s) => (s.priorityPlayer = 1)) === 'none', 'priority moving is not an event')
}

section('The things a person would notice, in order of weight')
{
  assert(kindOf((s) => s.turnNumber++) === 'turn', 'a new turn')
  assert(kindOf((s) => (s.activePlayer = 1)) === 'turn', 'and the table changing hands')
  assert(kindOf((s) => s.zones.stack.push('spell')) === 'stack', 'something going on the stack')
  assert(kindOf((s) => s.zones['hand:0'].pop()) === 'card', 'a card leaving a zone')
  assert(kindOf((s) => (s.players[1].life = 17)) === 'life', 'a life total moving')
  assert(kindOf((s) => (s.step = 'main2')) === 'step', 'and the step ticking over')
}

section('A turn change outranks the step change that comes with it')
{
  // Every turn change is also a step change, and most spells resolving are both
  // a stack change and a zone change. The heavier reading has to win or the
  // pause is sized by the incidental half.
  const before = signatureOf(state())
  const s = state()
  s.turnNumber++
  s.step = 'upkeep'
  assert(changeKind(before, signatureOf(s)) === 'turn', 'the turn, not the step')
  const s2 = state()
  s2.zones.stack.push('x')
  s2.zones['hand:0'].pop()
  assert(changeKind(before, signatureOf(s2)) === 'stack', 'and the stack, not the zone it came from')
}

section('Bigger events get longer pauses')
{
  assert(beatFor('turn') > beatFor('stack'), 'a turn change beats a spell resolving')
  assert(beatFor('stack') > beatFor('step'), 'and a spell resolving beats a step ticking')
  assert(beatFor('card') > 0 && beatFor('card') <= BEATS.card, 'a card moving is worth a beat')
}

section('A long burst speeds up rather than dragging')
{
  const first = beatFor('card', 0)
  const tenth = beatFor('card', 10)
  assert(tenth < first, `the tenth step is quicker than the first (${tenth} vs ${first})`)
  assert(urgency(100) >= 0.33, 'but never faster than a third of the beat')
  assert(beatFor('turn', 40) > 0, 'so even a very long turn still marks the handover')
  // Twenty events should not cost twenty full beats.
  let total = 0
  for (let i = 0; i < 20; i++) total += beatFor('card', i)
  assert(total < 20 * BEATS.card * 0.7, `twenty events stay brisk in total (${Math.round(total)}ms)`)
}

section('Speed scales everything, and "instant" is the old behaviour')
{
  assert(beatFor('turn', 0, 'instant') === 0, 'instant pauses for nothing')
  assert(thinkTime('priority', 'instant') === 0, 'and the computer answers at once')
  assert(beatFor('turn', 0, 'brisk') < beatFor('turn', 0, 'normal'), 'brisk is shorter than normal')
  assert(beatFor('turn', 0, 'relaxed') > beatFor('turn', 0, 'normal'), 'and relaxed is longer')
  assert(beatFor('turn', 0, 'nonsense') === beatFor('turn', 0, 'normal'), 'an unknown speed falls back to normal')
  assert(SPEEDS.instant === 0, 'instant is a factor of zero, not a small number')
}

section('A pause too short to see is no pause at all')
{
  // A timer for 20ms costs a frame and shows nothing; it should not be set.
  assert(beatFor('step', 0, 'instant') === 0, 'scaled to nothing')
  assert(beatFor('step', 60) === 0 || beatFor('step', 60) >= 60, 'and never a sliver of a beat')
}

section('The computer thinks longer about bigger decisions')
{
  assert(thinkTime('declareAttackers') > thinkTime('chooseTargets'), 'attacking takes longer than a trigger target')
  assert(thinkTime('declareBlockers') > thinkTime('priority'), 'and blocking longer than a main-phase play')
  assert(thinkTime('somethingNew') > 0, 'a decision kind nobody listed still gets a pause')
}

section('A signature survives a state that is missing pieces')
{
  assert(signatureOf(null) === null, 'no state, no signature')
  assert(changeKind(null, signatureOf(state())) === 'none', 'and nothing to compare is no change')
  const bare = signatureOf({ players: [], zones: {} })
  assert(bare && bare.turn === 0 && bare.stack === 0, 'an empty state reads as an empty board')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
