// Headless verification of the board's card-size control.
// Run: node src/renderer/src/lib/cardScale.test.mjs
import { clampScale, scaleBy, cardWidth, MIN_SCALE, MAX_SCALE, BASE_CARD_WIDTH } from './cardScale.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('A notch each way, and the range it moves in')
{
  assert(scaleBy(1, 1) > 1, 'up makes the cards bigger')
  assert(scaleBy(1, -1) < 1, 'down makes them smaller')
  assert(Math.abs(scaleBy(scaleBy(1, 1), -1) - 1) < 0.001, 'up then down comes back to where it started')
  // Multiplicative, so a notch is the same proportion at either end.
  const lowStep = scaleBy(MIN_SCALE, 1) / MIN_SCALE
  const highStep = scaleBy(1.5, 1) / 1.5
  assert(Math.abs(lowStep - highStep) < 0.001, 'a notch is the same size everywhere in the range')
}

section('It cannot be scrolled off the ends')
{
  let s = 1
  for (let i = 0; i < 50; i++) s = scaleBy(s, 1)
  assert(s === MAX_SCALE, 'scrolling up forever stops at the maximum')
  for (let i = 0; i < 100; i++) s = scaleBy(s, -1)
  assert(s === MIN_SCALE, 'and down forever stops at the minimum')
  assert(MIN_SCALE < 1 && MAX_SCALE > 1, 'with the resting size inside the range')
}

section('Anything unusable falls back to the resting size, not to a tiny card')
{
  // A cleared or corrupted stored value is not an answer, so it must not be
  // read as "the smallest card" — that would look like a bug to whoever hit it.
  for (const bad of [undefined, null, '', '   ', 'nonsense', NaN, Infinity, -Infinity, -5, 0])
    assert(clampScale(bad) === 1, `${JSON.stringify(bad) ?? String(bad)} gives the resting size`)
  assert(clampScale('1.25') === 1.25, 'a number that arrived as text still works')
  assert(clampScale(0.01) === MIN_SCALE, 'but a real number that is simply too small is clamped')
  assert(clampScale(99) === MAX_SCALE, 'as is one that is too large')
}

section('The width the CSS is given')
{
  assert(cardWidth(1) === BASE_CARD_WIDTH, 'the resting size is the base width')
  assert(cardWidth(2) === BASE_CARD_WIDTH * MAX_SCALE, 'past the maximum it is the maximum')
  assert(Number.isInteger(cardWidth(1.234)), 'always a whole number of pixels')
  assert(cardWidth(MIN_SCALE) === Math.round(BASE_CARD_WIDTH * MIN_SCALE), 'and it tracks the scale')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
