// Headless verification: copy effects beyond enter-as-copy (rule 707). Twincast
// copies a spell already on the stack (the copy shares targets and then ceases to
// exist); Cackling Counterpart creates a token that's a copy of a creature.
// Run: node src/shared/engine/copyeffects.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('Twincast copies a Lightning Bolt on the stack — the target takes it twice')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const twin = put(e, 0, 'Twincast', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  e.choose({ type: 'cast', oid: twin.oid, targets: [{ kind: 'spell', oid: bolt.oid }] })
  resolveStack(e)
  assert(e.state.players[1].life === 14, 'the opponent took 3 + 3 = 6 (Bolt and its copy)')
}

section('The copy ceases to exist; only the real cards hit the graveyard')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const twin = put(e, 0, 'Twincast', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  e.choose({ type: 'cast', oid: twin.oid, targets: [{ kind: 'spell', oid: bolt.oid }] })
  resolveStack(e)
  const gy = zone(e.state, 'graveyard', 0)
  assert(gy.length === 2, 'exactly two cards in the graveyard (Bolt + Twincast)')
  assert(bolt.zoneName === 'graveyard' && twin.zoneName === 'graveyard', 'both real spells are there')
}

section("Cackling Counterpart makes a token copy of your creature")
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const cc = put(e, 0, 'Cackling Counterpart', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: cc.oid, targets: [{ kind: 'object', oid: bears.oid }] })
  resolveStack(e)
  recompute(e.state)
  const bearsOnBf = zone(e.state, 'battlefield', 0)
    .map((oid) => e.state.objects[oid])
    .filter((o) => o.chars.name === 'Grizzly Bears')
  assert(bearsOnBf.length === 2, 'there are now two Grizzly Bears')
  const token = bearsOnBf.find((o) => o.token)
  assert(!!token, 'one of them is a token')
  assert(token.copyOf === 'Grizzly Bears', 'the token is a copy of Grizzly Bears')
  assert(token.chars.power === 2 && token.chars.toughness === 2, 'it has the copied 2/2 body')
}

section('Cackling Counterpart can only target a creature you control')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // opponent's only creature
  const cc = put(e, 0, 'Cackling Counterpart', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(
    !e.pending.actions.some((a) => a.type === 'cast' && a.oid === cc.oid),
    'with no creature of your own, Cackling Counterpart is uncastable'
  )
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
