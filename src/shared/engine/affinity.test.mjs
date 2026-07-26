// Headless verification: Grixis Affinity + Jund staples and the general mechanics
// they need — affinity cost, metalcraft, sacrifice-value, Blood Fountain, Eldrazi
// Spawn mana, Kenku Artificer animation, and multi-blocker damage assignment.
// Run: node src/shared/engine/affinity.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, combat, makeAsserter } from './_testutil.mjs'

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
const named = (e, pid, zoneName, name) =>
  zone(e.state, zoneName, pid).map((o) => e.state.objects[o]).find((o) => o.printed.name === name)

section('Affinity: Thoughtcast costs {1} less per artifact you control')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  for (let i = 0; i < 4; i++) put(e, 0, 'Ichor Wellspring', 'battlefield') // 4 artifacts
  const tc = put(e, 0, 'Thoughtcast', 'hand') // {4}{U} -> {U} with 4 artifacts
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'cast' && a.oid === tc.oid)
  assert(!!act, 'Thoughtcast is castable off a single Island (affinity paid the {4})')
  const before = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cast', oid: tc.oid })
  resolveAll(e)
  assert(zone(e.state, 'hand', 0).length === before - 1 + 2, 'drew two cards')
}

section('Metalcraft: Galvanic Blast deals 4 with 3+ artifacts, else 2')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const gb1 = put(e, 0, 'Galvanic Blast', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: gb1.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 18, 'no metalcraft -> 2 damage')

  for (let i = 0; i < 3; i++) put(e, 0, 'Ichor Wellspring', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const gb2 = put(e, 0, 'Galvanic Blast', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: gb2.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 14, 'metalcraft (3 artifacts) -> 4 damage')
}

section("Reckoner's Bargain: sac a permanent -> gain its MV, draw 2")
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Ichor Wellspring', 'battlefield') // MV 2 artifact to sacrifice
  const rb = put(e, 0, "Reckoner's Bargain", 'hand')
  advanceToPriorityAt(e, 'main1')
  const wellspring = named(e, 0, 'battlefield', 'Ichor Wellspring')
  const before = zone(e.state, 'hand', 0).length
  const life = e.state.players[0].life
  e.choose({ type: 'cast', oid: rb.oid, sacrifice: wellspring.oid, targets: [] })
  resolveAll(e)
  // Ichor Wellspring's own "put into graveyard" draw also fires (+1).
  assert(e.state.players[0].life === life + 2, 'gained 2 life (Ichor Wellspring MV 2)')
  assert(zone(e.state, 'hand', 0).length === before - 1 + 2 + 1, 'drew 2 (Bargain) + 1 (Wellspring death)')
}

section('Blood Fountain: ETB Blood token; sac to return two creatures')
{
  const e = makeEngine()
  const bear1 = put(e, 0, 'Grizzly Bears', 'graveyard')
  const bear2 = put(e, 0, 'Grizzly Bears', 'graveyard')
  for (let i = 0; i < 2; i++) put(e, 0, 'Swamp', 'battlefield')
  for (let i = 0; i < 2; i++) put(e, 0, 'Mountain', 'battlefield')
  const bf = put(e, 0, 'Blood Fountain', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === bf.oid)
  assert(!!act, 'Blood Fountain offers its sac ability')
  e.choose({ type: 'activate', oid: bf.oid, ability: act.ability, targets: [] })
  resolveAll(e)
  // Two sequential "return a creature" searches.
  if (e.pending.kind === 'search') { e.choose({ pick: bear1.oid }); resolveAll(e) }
  if (e.pending.kind === 'search') { e.choose({ pick: bear2.oid }); resolveAll(e) }
  assert(inZone(e, 0, 'hand', bear1.oid) && inZone(e, 0, 'hand', bear2.oid), 'returned both creatures to hand')
  assert(!inZone(e, 0, 'battlefield', bf.oid), 'Blood Fountain sacrificed')
}

section('Eldrazi Spawn: sacrifice for {C}')
{
  const e = makeEngine()
  // The token normally comes from Writhing Chrysalis' cast trigger; make one directly.
  e._createToken(
    { name: 'Eldrazi Spawn', types: ['Creature'], subtypes: ['Eldrazi', 'Spawn'], colors: [], power: 0, toughness: 1 },
    0
  )
  advanceToPriorityAt(e, 'main1')
  const spawn = named(e, 0, 'battlefield', 'Eldrazi Spawn')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === spawn.oid)
  assert(!!act, 'Eldrazi Spawn offers a sacrifice-for-mana ability')
  e.choose({ type: 'activate', oid: spawn.oid, ability: act.ability, targets: [] })
  resolveAll(e)
  assert(e.state.players[0].manaPool.C === 1, 'sacrificing the Spawn added {C}')
  assert(!inZone(e, 0, 'battlefield', spawn.oid), 'the Spawn was sacrificed')
}

section('Writhing Chrysalis: sacrificing another Eldrazi grows it with a +1/+1 counter')
{
  const e = makeEngine()
  const chrys = put(e, 0, 'Writhing Chrysalis', 'battlefield')
  e._createToken(
    { name: 'Eldrazi Spawn', types: ['Creature'], subtypes: ['Eldrazi', 'Spawn'], colors: [], power: 0, toughness: 1 },
    0
  )
  advanceToPriorityAt(e, 'main1')
  const spawn = named(e, 0, 'battlefield', 'Eldrazi Spawn')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === spawn.oid)
  e.choose({ type: 'activate', oid: spawn.oid, ability: act.ability, targets: [] }) // sac the Spawn for {C}
  resolveAll(e) // the sacrifice trigger goes on the stack and resolves
  recompute(e.state)
  assert((chrys.status.counters['+1/+1'] || 0) === 1, 'Chrysalis gained a +1/+1 counter from the sacrifice')
  assert(chrys.chars.power === 3 && chrys.chars.toughness === 4, 'Chrysalis is now 3/4')
}

section('Writhing Chrysalis: does NOT trigger when a non-Eldrazi is sacrificed')
{
  const e = makeEngine()
  const chrys = put(e, 0, 'Writhing Chrysalis', 'battlefield')
  const mogg = put(e, 0, 'Mogg Fanatic', 'battlefield') // sacrifices itself — a Goblin, not an Eldrazi
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === mogg.oid)
  e.choose({ type: 'activate', oid: mogg.oid, ability: act.ability, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  recompute(e.state)
  assert(!inZone(e, 0, 'battlefield', mogg.oid), 'Mogg Fanatic sacrificed itself')
  assert((chrys.status.counters['+1/+1'] || 0) === 0, 'no counter — the sacrifice was not an Eldrazi')
}

section('Kenku Artificer: animate a noncreature artifact into a 3/3 flyer')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const wellspring = put(e, 0, 'Ichor Wellspring', 'battlefield')
  const kenku = put(e, 0, 'Kenku Artificer', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: kenku.oid })
  resolveAll(e) // resolves onto battlefield; ETB trigger asks for a target
  assert(e.pending.kind === 'chooseTargets', 'Kenku ETB targets a noncreature artifact')
  e.choose({ targets: [{ kind: 'object', oid: wellspring.oid }] })
  resolveAll(e)
  recompute(e.state)
  assert(wellspring.chars.types.includes('Creature'), 'the Wellspring became a creature')
  assert(`${wellspring.chars.power}/${wellspring.chars.toughness}` === '3/3', '0/0 + three +1/+1 = 3/3')
  assert(wellspring.chars.keywords.includes('Flying'), 'and has flying')
}

section('Multi-blocker: a 4/4 assigns lethal to each of two 2/2 blockers')
{
  const e = makeEngine()
  const wurm = put(e, 0, 'Craw Wurm', 'battlefield', { summoningSick: false }) // 6/4
  const b1 = put(e, 1, 'Grizzly Bears', 'battlefield')
  const b2 = put(e, 1, 'Grizzly Bears', 'battlefield')
  combat(e, [{ oid: wurm.oid, defender: { player: 1 } }], { [b1.oid]: wurm.oid, [b2.oid]: wurm.oid })
  assert(inZone(e, 1, 'graveyard', b1.oid) && inZone(e, 1, 'graveyard', b2.oid), 'both blockers died (lethal to each)')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
