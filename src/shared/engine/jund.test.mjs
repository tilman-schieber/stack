// Headless verification: a batch of Jund Wildfire cards using existing mechanics.
// Run: node src/shared/engine/jund.test.mjs

import { zone } from './state.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

section('Ichor Wellspring draws when it enters and when it dies')
{
  const e = makeEngine()
  const ichor = put(e, 0, 'Ichor Wellspring', 'battlefield')
  const before = zone(e.state, 'hand', 0).length
  // put() bypasses ETB; test the toGraveyard draw directly.
  e._bury(ichor)
  e._grantPriority() // places the toGraveyard trigger on the stack
  bothPass(e) // resolve it
  assert(zone(e.state, 'hand', 0).length === before + 1, 'drew a card when put into the graveyard')
  assert(inZone(e, 0, 'graveyard', ichor.oid), 'Ichor Wellspring is in the graveyard')
}

section('Go for the Throat destroys a creature')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const gft = put(e, 0, 'Go for the Throat', 'hand')
  const angel = put(e, 1, 'Serra Angel', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: gft.oid, targets: [{ kind: 'object', oid: angel.oid }] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', angel.oid), 'target creature destroyed')
}

section('Toxin Analysis grants +2/+1 and deathtouch')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const tox = put(e, 0, 'Toxin Analysis', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: tox.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  const { recompute } = await import('./layers.mjs')
  recompute(e.state)
  assert(`${bear.chars.power}/${bear.chars.toughness}` === '4/3', 'bear is 4/3')
  assert(bear.chars.keywords.includes('Deathtouch'), 'bear has deathtouch')
}

section("Eviscerator's Insight: draw 2, lose 2")
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Swamp', 'battlefield')
  const ins = put(e, 0, "Eviscerator's Insight", 'hand')
  advanceToPriorityAt(e, 'main1')
  const before = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cast', oid: ins.oid })
  bothPass(e)
  assert(zone(e.state, 'hand', 0).length === before - 1 + 2, 'net +1 card (cast -1, draw +2)')
  assert(e.state.players[0].life === 18, 'lost 2 life')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
