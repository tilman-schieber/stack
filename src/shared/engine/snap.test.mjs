// Headless verification: Snap — {1}{U} instant that returns target creature to its
// owner's hand and untaps up to two lands you control (so it can pay for itself).
// Run: node src/shared/engine/snap.test.mjs

import { zone } from './state.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

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
const tapped = (o) => o.status.tapped

section('Snap: bounces a creature and untaps the two lands that paid for it')
{
  const e = makeEngine()
  const i1 = put(e, 0, 'Island', 'battlefield')
  const i2 = put(e, 0, 'Island', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield') // opponent's creature
  const snap = put(e, 0, 'Snap', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: snap.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  assert(tapped(i1) && tapped(i2), 'both Islands tapped to pay {1}{U}')
  resolveAll(e)
  assert(inZone(e, 1, 'hand', bear.oid), 'the Grizzly Bears was returned to its owner’s hand')
  assert(!inZone(e, 1, 'battlefield', bear.oid), 'the Bears left the battlefield')
  assert(!tapped(i1) && !tapped(i2), 'Snap untapped both lands — it paid for itself')
}

section('Snap: untaps up to two — a lone extra tapped land stays as it is beyond the cap')
{
  const e = makeEngine()
  const i1 = put(e, 0, 'Island', 'battlefield')
  const i2 = put(e, 0, 'Island', 'battlefield')
  const i3 = put(e, 0, 'Island', 'battlefield', { tapped: true }) // already tapped, third land
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  const snap = put(e, 0, 'Snap', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: snap.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  // Two lands paid for Snap (tapped), i3 was already tapped: 3 tapped lands, only 2 untap.
  const untapped = [i1, i2, i3].filter((l) => !tapped(l)).length
  assert(untapped === 2, 'exactly two lands were untapped (the "up to two" cap held)')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
