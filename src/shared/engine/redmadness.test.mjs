// Headless verification: Mono-Red Madness (Pauper) cards (oracle text from Scryfall).
// Run: node src/shared/engine/redmadness.test.mjs

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
const named = (e, pid, zoneName, name) =>
  zone(e.state, zoneName, pid).map((o) => e.state.objects[o]).find((o) => o.printed.name === name)

section('Guttersnipe: casting an instant deals 2 to each opponent')
{
  const e = makeEngine()
  put(e, 0, 'Guttersnipe', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 15, 'opponent took 3 (Bolt) + 2 (Guttersnipe) = 5')
}

section('Voldaren Epicure: ETB pings each opponent and makes a Blood token')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const epicure = put(e, 0, 'Voldaren Epicure', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: epicure.oid })
  resolveAll(e)
  assert(inZone(e, 0, 'battlefield', epicure.oid), 'Epicure resolved onto the battlefield')
  assert(e.state.players[1].life === 19, 'dealt 1 to the opponent')
  const blood = named(e, 0, 'battlefield', 'Blood')
  assert(blood && blood.chars.types.includes('Artifact'), 'created a Blood token (artifact)')
}

section('Blood token: {1}, T, discard, sac -> draw a card')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield') // for Epicure {R}
  put(e, 0, 'Mountain', 'battlefield') // stays untapped to pay Blood's {1}
  const epicure = put(e, 0, 'Voldaren Epicure', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: epicure.oid })
  resolveAll(e)
  const blood = named(e, 0, 'battlefield', 'Blood')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === blood.oid)
  assert(!!act, 'Blood offers an activated ability')
  e.choose({ type: 'activate', oid: blood.oid, ability: act.ability, targets: [] })
  resolveAll(e)
  assert(e.pending.kind === 'discardCards', 'activating Blood pauses to discard a card')
  const aForest = zone(e.state, 'hand', 0).find((oid) => e.state.objects[oid].printed.name === 'Forest')
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ discard: [aForest] })
  resolveAll(e)
  assert(!inZone(e, 0, 'battlefield', blood.oid), 'Blood was sacrificed (a token ceases to exist)')
  assert(zone(e.state, 'hand', 0).length === handBefore, 'discarded one, drew one (net 0)')
}

section('Fireblast: alternative cost sacrifices two Mountains for 4 damage')
{
  const e = makeEngine()
  const m1 = put(e, 0, 'Mountain', 'battlefield')
  const m2 = put(e, 0, 'Mountain', 'battlefield')
  const fb = put(e, 0, 'Fireblast', 'hand')
  advanceToPriorityAt(e, 'main1')
  const alt = e.pending.actions.find((a) => a.oid === fb.oid && a.altCost)
  assert(!!alt, 'Fireblast offers an alternative-cost cast')
  e.choose({ type: 'cast', oid: fb.oid, altCost: true, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 16, 'dealt 4 to the opponent')
  assert(inZone(e, 0, 'graveyard', m1.oid) && inZone(e, 0, 'graveyard', m2.oid), 'sacrificed two Mountains')
}

section('Lava Dart: flashback by sacrificing a Mountain')
{
  const e = makeEngine()
  const m = put(e, 0, 'Mountain', 'battlefield')
  const dart = put(e, 0, 'Lava Dart', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  const fbAct = e.pending.actions.find((a) => a.type === 'castFlashback' && a.oid === dart.oid)
  assert(!!fbAct, 'Lava Dart offers a flashback cast from the graveyard')
  e.choose({ type: 'castFlashback', oid: dart.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 19, 'dealt 1 to the opponent')
  assert(inZone(e, 0, 'graveyard', m.oid), 'sacrificed a Mountain for flashback')
  assert(inZone(e, 0, 'exile', dart.oid), 'Lava Dart exiled after flashback')
}

section('Grab the Prize: discard a nonland -> draw two + 2 to each opponent')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const grab = put(e, 0, 'Grab the Prize', 'hand')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand') // a nonland to discard
  advanceToPriorityAt(e, 'main1')
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cast', oid: grab.oid })
  resolveAll(e)
  assert(e.pending.kind === 'discardCards', 'Grab the Prize pauses for its discard cost')
  e.choose({ discard: [bolt.oid] })
  resolveAll(e)
  // hand: -grab (cast) -bolt (discard) +2 (draw) => +0 net from the pre-cast count? Track drew.
  assert(inZone(e, 0, 'graveyard', bolt.oid), 'discarded the nonland card')
  // hand: -Grab (cast) -Bolt (discard) +2 (draw) = handBefore
  assert(zone(e.state, 'hand', 0).length === handBefore, 'drew two cards')
  assert(e.state.players[1].life === 18, 'dealt 2 to the opponent (discard was a nonland)')
}

section('Grab the Prize: discarding a land deals no damage')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const grab = put(e, 0, 'Grab the Prize', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: grab.oid })
  resolveAll(e)
  const aForest = zone(e.state, 'hand', 0).find((oid) => e.state.objects[oid].printed.name === 'Forest')
  e.choose({ discard: [aForest] })
  resolveAll(e)
  assert(e.state.players[1].life === 20, 'no damage when a land was discarded')
}

section('Melded Moxite: ETB may discard -> draw two')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const moxite = put(e, 0, 'Melded Moxite', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: moxite.oid })
  resolveAll(e)
  assert(e.pending.kind === 'discardCards' && e.pending.optional, 'ETB offers an optional discard')
  const aForest = zone(e.state, 'hand', 0).find((oid) => e.state.objects[oid].printed.name === 'Forest')
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ discard: [aForest] })
  resolveAll(e)
  assert(zone(e.state, 'hand', 0).length === handBefore - 1 + 2, 'discarded one, drew two')
}

section('Melded Moxite: {3}, Sacrifice -> a tapped 2/2 Robot')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  const moxite = put(e, 0, 'Melded Moxite', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === moxite.oid)
  assert(!!act, 'Moxite offers its sacrifice ability')
  e.choose({ type: 'activate', oid: moxite.oid, ability: act.ability, targets: [] })
  resolveAll(e)
  assert(inZone(e, 0, 'graveyard', moxite.oid), 'Moxite was sacrificed')
  const robot = named(e, 0, 'battlefield', 'Robot')
  assert(robot && `${robot.chars.power}/${robot.chars.toughness}` === '2/2', 'made a 2/2 Robot')
  assert(robot.status.tapped, 'the Robot entered tapped')
}

section('Sneaky Snacker: returns from the graveyard tapped on your third draw')
{
  const e = makeEngine()
  advanceToPriorityAt(e, 'main1')
  const snack = put(e, 0, 'Sneaky Snacker', 'graveyard')
  e.draw(0, 2)
  assert(inZone(e, 0, 'graveyard', snack.oid), 'still in the graveyard after two draws')
  e.draw(0, 1) // the third card this turn
  e._grantPriority()
  resolveAll(e)
  assert(inZone(e, 0, 'battlefield', snack.oid), 'returned to the battlefield on the third draw')
  assert(snack.status.tapped, 'returned tapped')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
