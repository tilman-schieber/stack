// Headless verification: Jund Wildfire cards (oracle text from Scryfall).
// Run: node src/shared/engine/jund.test.mjs

import { zone, zoneKey, createObject } from './state.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { recompute } from './layers.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const hand = (e, p) => zone(e.state, 'hand', p).length
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const resolveAll = (e) => {
  let g = 0
  while (zone(e.state, 'stack').length > 0 && e.pending.kind === 'priority' && g++ < 40) bothPass(e)
}
const gy = (e, pid, name) => {
  const o = createObject(e.state, SAMPLE_CARDS[name], pid)
  o.zoneName = 'graveyard'
  e.state.zones[zoneKey('graveyard', pid)].push(o.oid)
  return o
}

section('Ichor Wellspring: draw when it enters or is put into a graveyard')
{
  const e = makeEngine()
  const ichor = put(e, 0, 'Ichor Wellspring', 'battlefield')
  const before = hand(e, 0)
  e._bury(ichor)
  e._grantPriority()
  resolveAll(e)
  assert(hand(e, 0) === before + 1, 'drew a card when put into the graveyard')
}

section('Go for the Throat: destroy target nonartifact creature')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const gft = put(e, 0, 'Go for the Throat', 'hand')
  const angel = put(e, 1, 'Serra Angel', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: gft.oid, targets: [{ kind: 'object', oid: angel.oid }] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', angel.oid), 'creature destroyed')
}

section('Toxin Analysis: deathtouch + lifelink until EOT, and investigate (Clue)')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const tox = put(e, 0, 'Toxin Analysis', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: tox.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  recompute(e.state)
  assert(`${bear.chars.power}/${bear.chars.toughness}` === '2/2', 'no P/T change')
  assert(bear.chars.keywords.includes('Deathtouch') && bear.chars.keywords.includes('Lifelink'), 'gained deathtouch + lifelink')
  const clue = zone(e.state, 'battlefield').map((o) => e.state.objects[o]).find((o) => o.printed.name === 'Clue')
  assert(clue && clue.chars.types.includes('Artifact'), 'made a Clue token')
}

section("Eviscerator's Insight: sacrifice, draw two, has flashback")
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const ins = put(e, 0, "Eviscerator's Insight", 'hand')
  const fodder = put(e, 0, 'Ichor Wellspring', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const before = hand(e, 0)
  e.choose({ type: 'cast', oid: ins.oid, sacrifice: fodder.oid })
  resolveAll(e)
  // cast -1, Ichor sac draw +1, Insight draw +2 = +2
  assert(hand(e, 0) === before + 2, 'drew two (plus Ichor), sacrificing an artifact')
  assert(e.state.players[0].life === 20, 'no life loss (that was the wrong version)')
}

section('Krark-Clan Shaman: sacrifice an artifact -> 1 to each creature without flying')
{
  const e = makeEngine()
  const shaman = put(e, 0, 'Krark-Clan Shaman', 'battlefield') // 1/1, no tap needed
  const ichor = put(e, 0, 'Ichor Wellspring', 'battlefield')
  const flyer = put(e, 1, 'Serra Angel', 'battlefield') // flying
  const ground = put(e, 1, 'Raging Goblin', 'battlefield') // 1/1, no flying
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'activate', oid: shaman.oid, ability: 0, sacrifice: ichor.oid })
  resolveAll(e)
  assert(inZone(e, 1, 'graveyard', ground.oid), 'the grounded 1/1 died')
  assert(inZone(e, 1, 'battlefield', flyer.oid), 'the flyer was not hit')
  assert(inZone(e, 0, 'graveyard', shaman.oid), 'the Shaman itself (no flying) died')
}

section('Lembas: ETB scry 1 + draw; dies -> shuffle into library')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const lembas = put(e, 0, 'Lembas', 'hand')
  advanceToPriorityAt(e, 'main1')
  const before = hand(e, 0)
  e.choose({ type: 'cast', oid: lembas.oid })
  bothPass(e)
  // ETB trigger resolves -> scry pause
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 6) bothPass(e)
  assert(e.pending.kind === 'scry', 'Lembas ETB scries')
  e.choose({ toBottom: [], toTop: e.pending.cards })
  assert(hand(e, 0) === before, 'net hand unchanged (cast -1, ETB draw +1)')

  // Dies -> shuffled into library, not left in the graveyard.
  e._bury(lembas)
  e._grantPriority()
  resolveAll(e)
  assert(inZone(e, 0, 'library', lembas.oid), 'Lembas shuffled into the library on death')
  assert(!inZone(e, 0, 'graveyard', lembas.oid), 'not left in the graveyard')
}

section('Refurbished Familiar: ETB each opponent discards a card')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Swamp', 'battlefield')
  const fam = put(e, 0, 'Refurbished Familiar', 'hand')
  advanceToPriorityAt(e, 'main1')
  const oppBefore = hand(e, 1)
  e.choose({ type: 'cast', oid: fam.oid })
  bothPass(e)
  // ETB trigger -> opponent discard decision
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 6) bothPass(e)
  assert(e.pending.kind === 'discardCards' && e.pending.player === 1, 'opponent must discard')
  e.choose({ discard: [e.pending.hand[0]] })
  assert(hand(e, 1) === oppBefore - 1, 'opponent discarded a card')
}

section('Pulse of Murasa: return a creature/land from a graveyard, gain 6')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const pulse = put(e, 0, 'Pulse of Murasa', 'hand')
  const dead = gy(e, 0, 'Grizzly Bears') // a creature card in the graveyard
  advanceToPriorityAt(e, 'main1')
  const life = e.state.players[0].life
  e.choose({ type: 'cast', oid: pulse.oid })
  bothPass(e)
  assert(e.pending.kind === 'search', 'choose a card to return from a graveyard')
  e.choose({ pick: dead.oid })
  resolveAll(e)
  assert(inZone(e, 0, 'hand', dead.oid), 'the creature returned to hand')
  assert(e.state.players[0].life === life + 6, 'gained 6 life')
}

section('Writhing Chrysalis: cast trigger makes two Eldrazi Spawn')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const chrys = put(e, 0, 'Writhing Chrysalis', 'hand') // {2}{R}{G}
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: chrys.oid })
  resolveAll(e) // cast trigger + creature resolve
  const spawn = zone(e.state, 'battlefield').map((o) => e.state.objects[o]).filter((o) => o.token && o.printed.name === 'Eldrazi Spawn')
  assert(spawn.length === 2, 'created two Eldrazi Spawn tokens')
  assert(inZone(e, 0, 'battlefield', chrys.oid), 'Writhing Chrysalis resolved onto the battlefield')
}

section('Cleansing Wildfire: {1}{R}, destroy a land, fetch a basic tapped, draw')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const target = put(e, 0, 'Vault of Whispers', 'battlefield')
  const cw = put(e, 0, 'Cleansing Wildfire', 'hand')
  advanceToPriorityAt(e, 'main1')
  const before = hand(e, 0)
  e.choose({ type: 'cast', oid: cw.oid, targets: [{ kind: 'object', oid: target.oid }] })
  bothPass(e)
  assert(e.pending.kind === 'search', 'paused to fetch a basic land')
  const fetched = e.pending.cards[0]
  e.choose({ pick: fetched })
  resolveAll(e)
  assert(inZone(e, 0, 'graveyard', target.oid), 'the land was destroyed')
  assert(inZone(e, 0, 'battlefield', fetched) && e.state.objects[fetched].status.tapped, 'fetched basic entered tapped')
  assert(hand(e, 0) === before - 1 + 1, 'drew a card')
}

section('Nihil Spellbomb: {T}, sac -> exile a graveyard; dies -> may pay {B} to draw')
{
  const e = makeEngine()
  const bomb = put(e, 0, 'Nihil Spellbomb', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield') // for the optional {B}
  gy(e, 1, 'Grizzly Bears') // opponent graveyard cards to exile
  gy(e, 1, 'Raging Goblin')
  advanceToPriorityAt(e, 'main1')
  const before = hand(e, 0)

  e.choose({ type: 'activate', oid: bomb.oid, ability: 0, targets: [{ kind: 'player', pid: 1 }] })
  assert(inZone(e, 0, 'graveyard', bomb.oid), 'sacrificed to the graveyard')
  bothPass(e) // resolve the toGraveyard trigger -> may-pay decision
  assert(e.pending.kind === 'mayPay' && e.pending.canPay, 'offered to pay {B} to draw')
  e.choose({ pay: true })
  assert(hand(e, 0) === before + 1, 'paid {B} and drew a card')
  resolveAll(e) // resolve the exile-graveyard ability
  assert(zone(e.state, 'graveyard', 1).length === 0, "opponent's graveyard was exiled")
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
