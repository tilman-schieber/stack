// Headless verification: a spell or ability with targets doesn't resolve if all
// of its targets have become illegal by the time it would resolve (rule 608.2b,
// "fizzle") — it leaves the stack with no effect.
// Run: node src/shared/engine/fizzle.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('A burn spell fizzles when its only target dies in response')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bears = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2
  const b1 = put(e, 0, 'Lightning Bolt', 'hand')
  const b2 = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  // Stack both Bolts at the Bears; the second resolves first and kills it.
  e.choose({ type: 'cast', oid: b1.oid, targets: [{ kind: 'object', oid: bears.oid }] })
  e.choose({ type: 'cast', oid: b2.oid, targets: [{ kind: 'object', oid: bears.oid }] })
  assert(zone(e.state, 'stack').length === 2, 'both Bolts are on the stack')
  resolveStack(e)
  assert(bears.zoneName === 'graveyard', 'the first-resolving Bolt killed the Bears')
  assert(b2.zoneName === 'graveyard' && b1.zoneName === 'graveyard', 'both Bolts left the stack')
  assert(e.state.players[1].life === 20, 'the fizzled Bolt dealt no damage (it did not redirect to a player)')
}

section('A spell resolves normally when its target is still legal')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const bears = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: bears.oid }] })
  resolveStack(e)
  assert(bears.zoneName === 'graveyard', 'the Bolt resolved and killed the Bears (no fizzle)')
}

section('An activated ability fizzles when its target leaves the battlefield')
{
  const e = makeEngine()
  const mogg = put(e, 0, 'Mogg Fanatic', 'battlefield', { summoningSick: false })
  const bears = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === mogg.oid)
  assert(!!act, 'Mogg Fanatic can sacrifice itself to deal 1 damage')
  e.choose({ type: 'activate', oid: mogg.oid, ability: act.ability, targets: [{ kind: 'object', oid: bears.oid }] })
  assert(mogg.zoneName === 'graveyard', 'Mogg Fanatic was sacrificed as a cost')
  // The target vanishes before the ability resolves (simulate a bounce/blink).
  const bf = zone(e.state, 'battlefield')
  bf.splice(bf.indexOf(bears.oid), 1)
  bears.zoneName = 'exile'
  const lifeBefore = e.state.players[1].life
  resolveStack(e)
  assert(zone(e.state, 'stack').length === 0, 'the ability left the stack')
  assert(e.state.players[1].life === lifeBefore, 'it dealt no damage — the ability fizzled')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
