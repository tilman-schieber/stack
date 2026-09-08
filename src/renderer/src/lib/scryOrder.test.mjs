// Headless verification of the scry overlay's ordering.
// Run: node src/renderer/src/lib/scryOrder.test.mjs
import { moveInOrder, keptOrder, moveKept, canMoveKept } from './scryOrder.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

section('A card moves one place at a time')
{
  const o = ['a', 'b', 'c']
  assert(eq(moveInOrder(o, 'c', -1), ['a', 'c', 'b']), 'towards the top')
  assert(eq(moveInOrder(o, 'a', 1), ['b', 'a', 'c']), 'and away from it')
  assert(eq(o, ['a', 'b', 'c']), 'without disturbing the array it was given')
}

section('Scrying 2: the swap that used to be impossible')
{
  assert(eq(moveInOrder(['a', 'b'], 'b', -1), ['b', 'a']), 'the second card can become the first')
  assert(eq(moveInOrder(['a', 'b'], 'a', 1), ['b', 'a']), 'from either side')
}

section('The ends are inert, not wrapping')
{
  const o = ['a', 'b', 'c']
  assert(eq(moveInOrder(o, 'a', -1), o), 'the top card cannot go higher')
  assert(eq(moveInOrder(o, 'c', 1), o), 'and the bottom one cannot go lower')
  assert(eq(moveInOrder(o, 'zzz', -1), o), 'a card that is not there changes nothing')
}

section('Moving right across the list keeps everyone else in order')
{
  let o = ['a', 'b', 'c', 'd']
  o = moveInOrder(o, 'd', -1)
  o = moveInOrder(o, 'd', -1)
  o = moveInOrder(o, 'd', -1)
  assert(eq(o, ['d', 'a', 'b', 'c']), 'the last card walked to the front')
}

section('What goes back on top is the order minus the bottomed cards')
{
  assert(eq(keptOrder(['a', 'b', 'c'], ['b']), ['a', 'c']), 'a bottomed card drops out')
  assert(eq(keptOrder(['c', 'a', 'b'], []), ['c', 'a', 'b']), 'and the chosen order is kept')
  assert(eq(keptOrder(['a', 'b'], ['a', 'b']), []), 'bottoming everything leaves nothing on top')
}

section('Ordering steps over a card on its way to the bottom')
{
  const order = ['a', 'b', 'c']
  const bottom = ['b'] // the middle card is going to the bottom
  assert(eq(keptOrder(moveKept(order, bottom, 'c', -1), bottom), ['c', 'a']), 'c passes b in one step and lands above a')
  assert(eq(moveKept(order, bottom, 'c', -1), ['c', 'b', 'a']), 'and b keeps the slot it is drawn in')
  assert(!canMoveKept(order, bottom, 'a', -1), 'the topmost kept card cannot go higher')
  assert(!canMoveKept(order, bottom, 'c', 1), 'and the last kept card cannot go lower')
  assert(canMoveKept(order, bottom, 'a', 1), 'but it can go down past the bottomed one')
}

section('Bottoming everything leaves nothing to order')
{
  const order = ['a', 'b']
  assert(!canMoveKept(order, ['a', 'b'], 'a', 1), 'no arrows do anything')
  assert(moveKept(order, ['a', 'b'], 'a', 1) === order, 'and the order is returned untouched')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
