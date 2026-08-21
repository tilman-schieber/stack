// Headless verification: three more rule modifiers —
//  - "This spell can't be countered" (Great Sable Stag) vs Counterspell/Ward,
//  - "doesn't untap during its controller's untap step" (Claustrophobia),
//  - "You can't lose the game" (Platinum Angel).
// Run: node src/shared/engine/morerules.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section("Great Sable Stag can't be countered by Counterspell")
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  const stag = put(e, 0, 'Great Sable Stag', 'hand')
  const cs = put(e, 1, 'Counterspell', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: stag.oid, targets: [] })
  e.choose({ type: 'pass' }) // player 0 passes; player 1 gets priority
  e.choose({ type: 'cast', oid: cs.oid, targets: [{ kind: 'spell', oid: stag.oid }] })
  resolveStack(e)
  assert(stag.zoneName === 'battlefield', 'the Stag resolved despite Counterspell')
  assert(cs.zoneName === 'graveyard', 'Counterspell resolved (and simply failed to counter)')
}

section("Claustrophobia taps the creature and stops it untapping")
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Island', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const claus = put(e, 0, 'Claustrophobia', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: claus.oid, targets: [{ kind: 'object', oid: bears.oid }] })
  resolveStack(e)
  assert(claus.status.attachedTo === bears.oid, 'Claustrophobia is attached')
  assert(bears.status.tapped, 'its ETB tapped the creature')
  assert(e._restricted(bears, 'untap'), 'the creature is restricted from untapping')
  // Drive to player 0's next untap step; the Bears must remain tapped.
  let g = 0
  while (!(e.state.turnNumber === 3 && e.state.step === 'draw') && g++ < 4000) {
    const p = e.pending
    if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else e.choose({})
  }
  assert(bears.status.tapped, 'the Bears stayed tapped through its controller’s untap step')
}

section("Platinum Angel keeps its controller from losing at 0 life")
{
  const e = makeEngine()
  const angel = put(e, 0, 'Platinum Angel', 'battlefield', { summoningSick: false })
  e.state.players[0].life = 0
  e._checkSBA()
  assert(e.state.winner == null, 'player 0 does not lose while the Angel is out')
  // Remove the Angel; now the state-based loss applies.
  const bf = zone(e.state, 'battlefield')
  bf.splice(bf.indexOf(angel.oid), 1)
  angel.zoneName = 'graveyard'
  e._checkSBA()
  assert(e.state.winner === 1, 'once the Angel is gone, player 1 wins')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
