// Headless verification of the scry overlay's ordering.
// Run: node src/renderer/src/lib/scryOrder.test.mjs
import { moveTo, keptOrder } from './scryOrder.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

section('Dropping a card onto another takes that place')
{
  const o = ['a', 'b', 'c']
  assert(eq(moveTo(o, 'c', 'a'), ['c', 'a', 'b']), 'the last card dropped on the first goes to the front')
  assert(eq(moveTo(o, 'a', 'c'), ['b', 'c', 'a']), 'and the first dropped on the last goes to the back')
  assert(eq(moveTo(o, 'a', 'b'), ['b', 'a', 'c']), 'a neighbour swap is the same as a one-step move')
  assert(eq(o, ['a', 'b', 'c']), 'without disturbing the array it was given')
}

section('Scrying 2: the swap that used to be impossible')
{
  assert(eq(moveTo(['a', 'b'], 'b', 'a'), ['b', 'a']), 'the second card can become the first')
  assert(eq(moveTo(['a', 'b'], 'a', 'b'), ['b', 'a']), 'from either side')
}

section('A drop that changes nothing returns the same array')
{
  // Identity matters: it is what stops a re-render on every dragover event.
  const o = ['a', 'b', 'c']
  assert(moveTo(o, 'b', 'b') === o, 'a card dropped on itself')
  assert(moveTo(o, 'zzz', 'a') === o, 'a card that is not in the row')
  assert(moveTo(o, 'a', 'zzz') === o, 'and a target that is not either')
}

section('Dragging across the row keeps everyone else in order')
{
  assert(eq(moveTo(['a', 'b', 'c', 'd'], 'd', 'a'), ['d', 'a', 'b', 'c']), 'the last card dropped at the front')
  assert(eq(moveTo(['a', 'b', 'c', 'd'], 'b', 'd'), ['a', 'c', 'd', 'b']), 'and one dropped at the back')
}

section('What goes back on top is the order minus the bottomed cards')
{
  assert(eq(keptOrder(['a', 'b', 'c'], ['b']), ['a', 'c']), 'a bottomed card drops out')
  assert(eq(keptOrder(['c', 'a', 'b'], []), ['c', 'a', 'b']), 'and the chosen order is kept')
  assert(eq(keptOrder(['a', 'b'], ['a', 'b']), []), 'bottoming everything leaves nothing on top')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
