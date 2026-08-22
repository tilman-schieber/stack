// Headless verification: per-viewer redaction in projectGame (for networked play).
// projectGame(engine, viewerPid) must hide other players' hand identities and any
// library-revealing pending decision they own; projectGame(engine) (no viewer)
// must stay the full, unchanged view used by local hot-seat.
// Run: node src/shared/engine/redaction.test.mjs

import { zone } from './state.mjs'
import { projectGame } from './project.mjs'
import { makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section("A viewer sees their own hand but only card backs for the opponent's")
{
  const e = makeEngine()
  put(e, 0, 'Grizzly Bears', 'hand')
  put(e, 1, 'Lightning Bolt', 'hand')
  const v0 = projectGame(e, 0)
  const v1 = projectGame(e, 1)

  // Player 0's own hand is visible to player 0.
  assert(v0.players[0].hand.every((c) => !c.hidden), "seat 0 sees its own hand")
  assert(v0.players[0].hand.some((c) => c.name === 'Grizzly Bears'), 'own card identity present')
  // Player 1's hand is redacted for player 0, but the count is preserved.
  assert(v0.players[1].hand.every((c) => c.hidden && c.cardId == null), "opponent hand is card backs")
  assert(v0.players[1].hand.every((c) => c.name !== 'Lightning Bolt'), 'no opponent identity leaks')
  assert(v0.players[1].handCount === zone(e.state, 'hand', 1).length, 'opponent hand count is exact')

  // The mirror holds for player 1.
  assert(v1.players[1].hand.some((c) => c.name === 'Lightning Bolt'), 'seat 1 sees its own hand')
  assert(v1.players[0].hand.every((c) => c.hidden), "seat 1 sees seat 0's hand as backs")
}

section("A library-revealing decision (scry) stays private to its owner")
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const sv = put(e, 0, 'Serum Visions', 'hand') // draw 1, then scry 2
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: sv.oid, targets: [] })
  // resolve to reach the scry decision (owned by player 0)
  let g = 0
  while (e.pending.kind !== 'scry' && g++ < 20) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'scry' && e.pending.player === 0, 'a scry decision is pending for seat 0')

  const owner = projectGame(e, 0)
  const other = projectGame(e, 1)
  assert(owner.pending.cards.some((c) => c.name), 'the scrying player sees the revealed card identities')
  assert(
    other.pending.kind === 'scry' && other.pending.player === 0,
    'the opponent still learns a scry is happening'
  )
  assert(other.pending.cards.every((c) => c.hidden && !c.name), "but not which cards are being scried")
}

section('projectGame with no viewer is the full, unredacted view (hot-seat unchanged)')
{
  const e = makeEngine()
  put(e, 1, 'Grizzly Bears', 'hand')
  const full = projectGame(e)
  assert(full.players[1].hand.every((c) => !c.hidden), 'both hands fully visible without a viewer')
  assert(full.players[1].hand.some((c) => c.name === 'Grizzly Bears'), 'identities present for all')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
