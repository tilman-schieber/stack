// Headless verification of the blocking arrows' geometry.
// Run: node src/renderer/src/lib/combatArrows.test.mjs
import { edgePoint, arrowGeometry, arrowPath, bowFor, blockPairs } from './combatArrows.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const near = (a, b, eps = 0.001) => Math.abs(a - b) < eps
// A card-shaped rect centred on (x, y).
const card = (x, y) => ({ left: x - 40, top: y - 56, width: 80, height: 112 })

section('An arrow starts and ends on a card edge, never inside the art')
{
  const from = card(100, 500)
  const to = card(100, 200) // straight up
  const g = arrowGeometry(from, to)
  assert(near(g.start.y, from.top), `it leaves the top edge of the blocker (${g.start.y} vs ${from.top})`)
  assert(near(g.end.y, to.top + to.height), `and lands on the bottom edge of the attacker (${g.end.y})`)
  assert(near(g.start.x, 100) && near(g.end.x, 100), 'straight up stays on the vertical')
}
{
  const from = card(100, 300)
  const to = card(400, 300) // straight across
  const g = arrowGeometry(from, to)
  assert(near(g.start.x, from.left + from.width), 'it leaves the right edge')
  assert(near(g.end.x, to.left), 'and lands on the left edge')
}

section('The edge point is on the rectangle, not a circle around it')
{
  const r = card(0, 0) // 80 wide, 112 tall
  const p = edgePoint(r, { x: 1000, y: 0 })
  assert(near(p.x, 40) && near(p.y, 0), 'due right is the middle of the right edge')
  const q = edgePoint(r, { x: 0, y: -1000 })
  assert(near(q.x, 0) && near(q.y, -56), 'due up is the middle of the top edge')
  // Towards the top-right corner of a taller-than-wide card, the side is hit first.
  const c = edgePoint(r, { x: 1000, y: -1000 })
  assert(near(c.x, 40) && near(c.y, -40), `a diagonal leaves through the side (${c.x}, ${c.y})`)
}

section('Two blockers on one attacker do not draw the same line twice')
{
  const from = card(100, 500)
  const to = card(100, 200)
  const straight = arrowGeometry(from, to, bowFor(0, 1))
  const left = arrowGeometry(from, to, bowFor(0, 2))
  const right = arrowGeometry(from, to, bowFor(1, 2))
  assert(near(straight.ctrl.x, 100), 'a lone arrow is straight')
  assert(left.ctrl.x < 100 && right.ctrl.x > 100, 'two bow to opposite sides')
  assert(near(left.ctrl.x - 100, 100 - right.ctrl.x), 'by the same amount either way')
  assert(bowFor(1, 3) === 0, 'and the middle of three is the straight one')
}

section('The path is one quadratic curve through the control point')
{
  const g = arrowGeometry(card(0, 100), card(0, 0))
  const d = arrowPath(g)
  assert(/^M [-\d.]+ [-\d.]+ Q [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/.test(d), `a move and a curve (${d})`)
}

section('Blocks become one arrow per attacker blocked')
{
  const known = (oid) => ['b1', 'b2', 'a1', 'a2'].includes(oid)
  assert(blockPairs({ b1: 'a1' }, known).length === 1, 'a plain block is one arrow')
  assert(blockPairs({ b1: ['a1', 'a2'] }, known).length === 2, 'a creature blocking two draws two')
  assert(blockPairs({ b1: 'a1', b2: 'a1' }, known).length === 2, 'and two blockers on one attacker draw two')
}

section('An arrow is never drawn to a card that has left the board')
{
  const known = (oid) => oid === 'b1'
  assert(blockPairs({ b1: 'gone' }, known).length === 0, 'a killed attacker drops its arrow')
  assert(blockPairs({ gone: 'b1' }, known).length === 0, 'and so does a killed blocker')
  assert(blockPairs({ b1: null }, known).length === 0, 'a blocker with no assignment draws nothing')
  assert(blockPairs(null, known).length === 0, 'and no blocks at all is no arrows')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
