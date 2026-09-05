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

section('Nyxborn Hydra: X spell enters with X +1/+1 counters')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Forest', 'battlefield') // {X}{G}: pay G + X=3
  const hydra = put(e, 0, 'Nyxborn Hydra', 'hand')
  advanceToPriorityAt(e, 'main1')
  const cast = e.pending.actions.find((a) => a.type === 'cast' && a.oid === hydra.oid)
  assert(cast && cast.hasX, 'offered as an X spell')
  assert(cast.maxX === 3, 'max X is 3 with 4 lands (1 for {G})')

  e.choose({ type: 'cast', oid: hydra.oid, x: 3 })
  resolveAll(e)
  recompute(e.state)
  assert(`${hydra.chars.power}/${hydra.chars.toughness}` === '3/4', 'enters as a 3/4 (0/1 + three +1/+1)')
  assert(hydra.chars.keywords.includes('Reach') && hydra.chars.keywords.includes('Trample'), 'has reach and trample')
}

section('Sagu Wildling: creature (ETB gain 3) or its Omen half (Roost Seek)')
{
  // Creature half: cast it, gain 3 on ETB.
  const e = makeEngine()
  for (let i = 0; i < 5; i++) put(e, 0, 'Forest', 'battlefield')
  const sagu = put(e, 0, 'Sagu Wildling', 'hand')
  advanceToPriorityAt(e, 'main1')
  const life = e.state.players[0].life
  const acts = e.pending.actions.filter((a) => a.oid === sagu.oid)
  assert(acts.some((a) => a.type === 'cast') && acts.some((a) => a.type === 'castOmen'), 'both halves offered')
  e.choose({ type: 'cast', oid: sagu.oid })
  resolveAll(e)
  assert(inZone(e, 0, 'battlefield', sagu.oid), 'creature resolved')
  assert(e.state.players[0].life === life + 3, 'gained 3 on ETB')
}
{
  // Omen half: Roost Seek tutors a basic to hand, then the card shuffles back.
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const sagu = put(e, 0, 'Sagu Wildling', 'hand')
  advanceToPriorityAt(e, 'main1')
  const handBefore = hand(e, 0)
  e.choose({ type: 'castOmen', oid: sagu.oid })
  bothPass(e) // resolve -> search
  assert(e.pending.kind === 'search', 'Roost Seek searches for a basic land')
  e.choose({ pick: e.pending.cards[0] })
  resolveAll(e)
  // -1 (Sagu cast/omen leaves hand) +1 (fetched land) and Sagu shuffled into library
  assert(inZone(e, 0, 'library', sagu.oid), 'the Omen card was shuffled into the library')
  assert(hand(e, 0) === handBefore, 'net hand unchanged (Roost Seek left, a basic came in)')
}

section('Bestow: Nyxborn Hydra cast as an Aura gives the creature +X/+X and reach & trample')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Forest', 'battlefield') // {X}{G}{G} with X=2 = 4 mana
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield') // 2/2
  const hydra = put(e, 0, 'Nyxborn Hydra', 'hand')
  advanceToPriorityAt(e, 'main1')
  const bestow = e.pending.actions.find((a) => a.type === 'castBestow' && a.oid === hydra.oid)
  assert(!!bestow, 'Bestow is offered as a cast option')
  assert(bestow.maxX === 2, 'maxX = 4 sources − 2 fixed (GG) = 2')
  e.choose({ type: 'castBestow', oid: hydra.oid, x: 2, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  recompute(e.state)
  assert(hydra.status.attachedTo === bear.oid, 'the Hydra entered attached to the Bears')
  assert(!hydra.chars.types.includes('Creature'), 'while bestowed it is not a creature')
  assert((hydra.status.counters['+1/+1'] || 0) === 2, 'it entered with X = 2 +1/+1 counters')
  assert(`${bear.chars.power}/${bear.chars.toughness}` === '4/4', 'the Bears gets +2/+2 (one per counter)')
  assert(bear.chars.keywords.includes('Reach') && bear.chars.keywords.includes('Trample'), 'plus reach & trample')
}

section('Bestow: when the enchanted creature leaves, the Hydra becomes a creature')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Forest', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const hydra = put(e, 0, 'Nyxborn Hydra', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'castBestow', oid: hydra.oid, x: 2, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  bear.status.damage = 99 // lethal — SBA will bury it
  e._checkSBA()
  recompute(e.state)
  assert(!inZone(e, 0, 'battlefield', bear.oid), 'the Bears died')
  assert(inZone(e, 0, 'battlefield', hydra.oid), 'the Hydra stayed on the battlefield (did not go to the graveyard)')
  assert(!hydra.bestowed && hydra.status.attachedTo == null, 'it came unattached')
  assert(hydra.chars.types.includes('Creature'), 'and is a creature again')
  assert(`${hydra.chars.power}/${hydra.chars.toughness}` === '2/3', 'a 2/3 (0/1 base + its two +1/+1 counters)')
}

section('Twisted Landscape: enters untapped; sacrifice to fetch a basic that enters tapped; cycling')
{
  const e = makeEngine('Forest', 20) // library: Forests (a basic Swamp/Mountain/Forest search can find them)
  const land = put(e, 0, 'Twisted Landscape', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'playLand', oid: land.oid })
  assert(inZone(e, 0, 'battlefield', land.oid) && !land.status.tapped, 'Twisted Landscape enters the battlefield untapped')
  assert(land.behavior.cycling?.cost === '{B}{R}{G}', 'it has Cycling {B}{R}{G} (derived from the oracle text)')
  const libBefore = zone(e.state, 'library', 0).length
  const bfBefore = zone(e.state, 'battlefield', 0).length
  e.choose({ type: 'activate', oid: land.oid, ability: 0 })
  resolveAll(e)
  assert(e.pending.kind === 'search' && e.pending.player === 0, 'the sacrifice ability resolves into a library search')
  assert(e.pending.cards.length === libBefore, 'every Forest in the library is a legal pick')
  const pick = e.pending.cards[0]
  e.choose({ pick })
  const fetched = e.state.objects[pick]
  assert(inZone(e, 0, 'battlefield', pick) && fetched.status.tapped, 'the fetched Forest is on the battlefield tapped')
  assert(inZone(e, 0, 'graveyard', land.oid), 'Twisted Landscape was sacrificed')
  assert(zone(e.state, 'battlefield', 0).length === bfBefore, 'one land left, one arrived')
  assert(zone(e.state, 'library', 0).length === libBefore - 1, 'the library shrank by one')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
