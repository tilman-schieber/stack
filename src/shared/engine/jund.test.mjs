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

const resolveAll = (e) => {
  let g = 0
  while (zone(e.state, 'stack').length > 0 && e.pending.kind === 'priority' && g++ < 30) {
    e.choose({ type: 'pass' })
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  }
}

section('Krark-Clan Shaman: sac an artifact -> 1 damage to each creature')
{
  const e = makeEngine()
  const shaman = put(e, 0, 'Krark-Clan Shaman', 'battlefield', { summoningSick: false }) // 1/1
  const ichor = put(e, 0, 'Ichor Wellspring', 'battlefield') // artifact to sacrifice
  const goblin = put(e, 1, 'Raging Goblin', 'battlefield') // 1/1
  advanceToPriorityAt(e, 'main1')
  const before = zone(e.state, 'hand', 0).length

  e.choose({ type: 'activate', oid: shaman.oid, ability: 0, sacrifice: ichor.oid })
  assert(inZone(e, 0, 'graveyard', ichor.oid), 'sacrificed the artifact')
  resolveAll(e)
  assert(zone(e.state, 'hand', 0).length === before + 1, 'Ichor Wellspring drew a card on being sacrificed')
  assert(inZone(e, 0, 'graveyard', shaman.oid), 'Krark-Clan Shaman (1/1) died to its own ability')
  assert(inZone(e, 1, 'graveyard', goblin.oid), "the opponent's 1/1 died")
}

section('Makeshift Munitions: sac a creature -> 1 damage to any target')
{
  const e = makeEngine()
  const munitions = put(e, 0, 'Makeshift Munitions', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield') // for {1}
  const fodder = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({
    type: 'activate',
    oid: munitions.oid,
    ability: 0,
    sacrifice: fodder.oid,
    targets: [{ kind: 'player', pid: 1 }]
  })
  assert(inZone(e, 0, 'graveyard', fodder.oid), 'sacrificed a creature to pay')
  resolveAll(e)
  assert(e.state.players[1].life === 19, 'dealt 1 damage to the opponent')
}

section('Fanatical Offering: additional cost sacrifice, then draw 2')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const fo = put(e, 0, 'Fanatical Offering', 'hand')
  const fodder = put(e, 0, 'Ichor Wellspring', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const before = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cast', oid: fo.oid, sacrifice: fodder.oid })
  assert(inZone(e, 0, 'graveyard', fodder.oid), 'paid the additional sacrifice cost')
  resolveAll(e)
  // cast -1, Ichor sac draw +1, Fanatical Offering draw +2 = net +2
  assert(zone(e.state, 'hand', 0).length === before + 2, 'drew from Offering (2) and Ichor (1), minus the cast')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
