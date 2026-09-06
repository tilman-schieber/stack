// Headless verification of the cards that complete Dimir Terror, Naya Gates and
// Boros Synth: delve, embalm, modal triggered abilities, "sacrifice it unless",
// abilities activated from the graveyard, alternative life costs, protection from
// monocolored, and the rest. Oracle text from Scryfall.
// Run: node src/shared/engine/defaults3.test.mjs

import { zone, zoneKey } from './state.mjs'
import { recompute } from './layers.mjs'
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
const hand = (e, p) => zone(e.state, 'hand', p).length
const act = (e, oid, type = null) => e.pending.actions.find((a) => a.oid === oid && a.type !== 'tapForMana' && (!type || a.type === type))
const tokensOf = (e, pid, name) =>
  zone(e.state, 'battlefield')
    .map((oid) => e.state.objects[oid])
    .filter((o) => o.token && o.controller === pid && (!name || o.printed.name === name))

section('Gurmag Angler: delve exiles the graveyard to pay')
{
  const e = makeEngine('Island', 20)
  for (let i = 0; i < 2; i++) put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const angler = put(e, 0, 'Gurmag Angler', 'hand') // {6}{B}
  for (let i = 0; i < 6; i++) put(e, 0, 'Brainstorm', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  assert(angler.printed.keywords.includes('Delve'), 'Delve is a printed keyword')
  assert(!!act(e, angler.oid), 'castable off three lands plus six graveyard cards')
  e.choose({ type: 'cast', oid: angler.oid })
  assert(zone(e.state, 'graveyard', 0).length === 0 && zone(e.state, 'exile', 0).length === 6, 'six graveyard cards were exiled to delve')
  bothPass(e)
  assert(inZone(e, 0, 'battlefield', angler.oid), 'the Angler resolved')
}

section('Snuff Out: free off a Swamp, kills a nonblack creature through regeneration')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const snuff = put(e, 0, 'Snuff Out', 'hand')
  const skel = put(e, 1, 'Drudge Skeletons', 'battlefield') // black — illegal target
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const alt = e.pending.actions.find((a) => a.oid === snuff.oid && a.altCost)
  assert(!!alt, 'the alternative cost (pay 4 life) is offered with a Swamp in play')
  let err = null
  try {
    e.choose({ type: 'cast', oid: snuff.oid, altCost: true, targets: [{ kind: 'object', oid: skel.oid }] })
  } catch (x) {
    err = x.message
  }
  assert(!!err, 'a black creature is not a legal target')
  e.choose({ type: 'cast', oid: snuff.oid, altCost: true, targets: [{ kind: 'object', oid: bear.oid }] })
  assert(e.state.players[0].life === 16, 'paid 4 life instead of mana')
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', bear.oid), 'the Bears are destroyed')
}

section('Arms of Hadar / Suffocating Fumes: mass -N/-N on one player, or on opponents')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Swamp', 'battlefield')
  const arms = put(e, 0, 'Arms of Hadar', 'hand')
  const mine = put(e, 0, 'Grizzly Bears', 'battlefield')
  const theirs = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: arms.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  recompute(e.state)
  assert(inZone(e, 1, 'graveyard', theirs.oid) && inZone(e, 0, 'battlefield', mine.oid) && mine.chars.power === 2, "only the targeted player's creatures shrank")

  const f = makeEngine()
  for (let i = 0; i < 3; i++) put(f, 0, 'Swamp', 'battlefield')
  const fumes = put(f, 0, 'Suffocating Fumes', 'hand')
  const rat = put(f, 1, 'Typhoid Rats', 'battlefield')
  const myBear = put(f, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  assert(fumes.behavior.cycling?.cost === '{2}', 'Cycling {2} parsed')
  f.choose({ type: 'cast', oid: fumes.oid })
  bothPass(f)
  recompute(f.state)
  assert(inZone(f, 1, 'graveyard', rat.oid) && myBear.chars.power === 2, "the opponent's Rats died; your Bears are untouched")
}

section('Steel Sabotage: counter an artifact spell, or bounce an artifact')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  const sab = put(e, 0, 'Steel Sabotage', 'hand')
  const prism = put(e, 1, 'Prophetic Prism', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: sab.oid, modes: [1], modeTargets: [[{ kind: 'object', oid: prism.oid }]] })
  bothPass(e)
  assert(inZone(e, 1, 'hand', prism.oid), 'the Prism was returned to its owner\'s hand')
}

section('Sacred Cat: embalm makes a white Zombie Cat token copy')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  const cat = put(e, 0, 'Sacred Cat', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  assert(cat.behavior.embalm?.cost === '{W}', 'Embalm {W} parsed')
  const a = act(e, cat.oid, 'embalm')
  assert(!!a, 'embalm is offered from the graveyard')
  e.choose({ type: 'embalm', oid: cat.oid })
  const tok = tokensOf(e, 0, 'Sacred Cat')[0]
  recompute(e.state)
  assert(inZone(e, 0, 'exile', cat.oid), 'the card was exiled')
  assert(tok && tok.chars.colors.join('') === 'W' && tok.chars.subtypes.includes('Zombie') && tok.chars.subtypes.includes('Cat'), 'a white Zombie Cat token')
  assert(tok.chars.keywords.includes('Lifelink') && tok.chars.power === 1, 'it copies the card (1/1 lifelink)')
}

section('Outlaw Medic and Temple Acolyte: dies-draw and enters-gain')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const medic = put(e, 0, 'Outlaw Medic', 'battlefield')
  const acolyte = put(e, 0, 'Temple Acolyte', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: acolyte.oid })
  bothPass(e)
  resolveAll(e)
  assert(e.state.players[0].life === 23, 'Temple Acolyte gained 3')
  const before = hand(e, 0)
  e._bury(medic)
  e._grantPriority()
  resolveAll(e)
  assert(hand(e, 0) === before + 1, 'Outlaw Medic drew a card when it died')
}

section('Bitter Reunion: enters with a rummage, sacrifices for haste')
{
  const e = makeEngine('Mountain', 20)
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  const reunion = put(e, 0, 'Bitter Reunion', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  bear.status.summoningSick = true
  advanceToPriorityAt(e, 'main1')
  const before = hand(e, 0)
  e.choose({ type: 'cast', oid: reunion.oid })
  bothPass(e)
  resolveAll(e)
  assert(e.pending.kind === 'discardCards' && e.pending.optional, 'a "you may discard" decision')
  e.choose({ discard: [zone(e.state, 'hand', 0)[0]] })
  assert(hand(e, 0) === before - 1 - 1 + 2, 'discarded one, drew two')
  const a = act(e, reunion.oid, 'activate')
  e.choose({ type: 'activate', oid: reunion.oid, ability: a.ability, targets: [] })
  resolveAll(e)
  recompute(e.state)
  assert(bear.chars.keywords.includes('Haste') && inZone(e, 0, 'graveyard', reunion.oid), 'your creatures gained haste; the enchantment was sacrificed')
}

section('Talons of Wildwood: +1/+1 and trample, and it buys itself back from the graveyard')
{
  const e = makeEngine()
  for (let i = 0; i < 6; i++) put(e, 0, 'Forest', 'battlefield') // {2}{G} to return it, then {1}{G} to cast it
  const talons = put(e, 0, 'Talons of Wildwood', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  const a = act(e, talons.oid, 'activate')
  assert(a && a.fromGraveyard, 'the return ability is offered from the graveyard')
  e.choose({ type: 'activate', oid: talons.oid, ability: a.ability, targets: [] })
  resolveAll(e)
  assert(inZone(e, 0, 'hand', talons.oid), 'it returned to hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  e._grantPriority()
  e.choose({ type: 'cast', oid: talons.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  recompute(e.state)
  assert(bear.chars.power === 3 && bear.chars.keywords.includes('Trample'), 'the enchanted creature is a 3/3 with trample')
}

section('Heap Gate: tap another Gate to make a Treasure')
{
  const e = makeEngine()
  const heap = put(e, 0, 'Heap Gate', 'battlefield')
  const other = put(e, 0, 'Basilisk Gate', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const a = e.pending.actions.find((x) => x.oid === heap.oid && x.type === 'activate' && !x.mana)
  assert(!!a, 'the Treasure ability is offered')
  e.choose({ type: 'activate', oid: heap.oid, ability: a.ability, targets: [] })
  assert(heap.status.tapped && other.status.tapped, 'both Gates are tapped')
  resolveAll(e)
  assert(tokensOf(e, 0, 'Treasure').length === 1, 'a Treasure token was created')
}

section('Ancient Grudge and Destroy Evil: flashback and a toughness-gated mode')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  for (let i = 0; i < 2; i++) put(e, 0, 'Forest', 'battlefield') // {1}{R} to cast, {G} to flash back
  const grudge = put(e, 0, 'Ancient Grudge', 'hand')
  const prism = put(e, 1, 'Prophetic Prism', 'battlefield')
  const star = put(e, 1, 'Chromatic Star', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: grudge.oid, targets: [{ kind: 'object', oid: prism.oid }] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', prism.oid), 'the Prism is destroyed')
  const fb = act(e, grudge.oid, 'castFlashback')
  assert(!!fb, 'flashback {G} is offered')
  e.choose({ type: 'castFlashback', oid: grudge.oid, targets: [{ kind: 'object', oid: star.oid }] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', star.oid) && inZone(e, 0, 'exile', grudge.oid), 'the Star is destroyed and the Grudge exiled')

  const f = makeEngine()
  put(f, 0, 'Plains', 'battlefield')
  put(f, 0, 'Plains', 'battlefield')
  const evil = put(f, 0, 'Destroy Evil', 'hand')
  const small = put(f, 1, 'Grizzly Bears', 'battlefield') // 2/2
  const big = put(f, 1, 'Rumbling Baloth', 'battlefield') // 4/4
  advanceToPriorityAt(f, 'main1')
  let err = null
  try {
    f.choose({ type: 'cast', oid: evil.oid, modes: [0], modeTargets: [[{ kind: 'object', oid: small.oid }]] })
  } catch (x) {
    err = x.message
  }
  assert(!!err, 'a 2/2 is not a legal target for "toughness 4 or greater"')
  f.choose({ type: 'cast', oid: evil.oid, modes: [0], modeTargets: [[{ kind: 'object', oid: big.oid }]] })
  bothPass(f)
  assert(inZone(f, 1, 'graveyard', big.oid), 'the 4/4 is destroyed')
}

section("Tamiyo's Safekeeping: hexproof and indestructible, and 2 life")
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const safe = put(e, 0, "Tamiyo's Safekeeping", 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: safe.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  recompute(e.state)
  assert(bear.chars.keywords.includes('Hexproof') && bear.chars.keywords.includes('Indestructible'), 'both keywords granted')
  assert(e.state.players[0].life === 22, 'gained 2 life')
}

section('Dawnbringer Cleric: a modal enters trigger')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const cleric = put(e, 0, 'Dawnbringer Cleric', 'hand')
  const journey = put(e, 1, 'Journey to Nowhere', 'battlefield')
  put(e, 1, 'Grizzly Bears', 'graveyard') // so all three modes are available
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: cleric.oid })
  bothPass(e)
  assert(e.pending.kind === 'chooseValue' && e.pending.options.length === 3, 'three modes offered as the trigger goes on the stack')
  e.choose({ value: e.pending.options[1] }) // Dispel Magic
  assert(e.pending.kind === 'chooseTargets', 'the chosen mode asks for its target')
  e.choose({ targets: [{ kind: 'object', oid: journey.oid }] })
  resolveAll(e)
  assert(inZone(e, 1, 'graveyard', journey.oid), 'the enchantment is destroyed')

  const f = makeEngine()
  put(f, 0, 'Plains', 'battlefield')
  put(f, 0, 'Plains', 'battlefield')
  const c2 = put(f, 0, 'Dawnbringer Cleric', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: c2.oid })
  bothPass(f)
  resolveAll(f)
  assert(f.state.players[0].life === 22, 'with no enchantment and no graveyard only one mode is possible: it is taken without asking, gaining 2')
}

section('Glint Hawk: sacrificed unless you return an artifact')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  const hawk = put(e, 0, 'Glint Hawk', 'hand')
  const prism = put(e, 0, 'Prophetic Prism', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: hawk.oid })
  bothPass(e)
  resolveAll(e)
  assert(e.pending.kind === 'sacrificeChoice' && e.pending.choices.includes(prism.oid) && e.pending.optional, 'choose an artifact to return, or decline')
  e.choose({ sacrifice: [prism.oid] })
  assert(inZone(e, 0, 'hand', prism.oid) && inZone(e, 0, 'battlefield', hawk.oid), 'the Prism returned; the Hawk stays')

  const f = makeEngine()
  put(f, 0, 'Plains', 'battlefield')
  const hawk2 = put(f, 0, 'Glint Hawk', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: hawk2.oid })
  bothPass(f)
  resolveAll(f)
  assert(inZone(f, 0, 'graveyard', hawk2.oid), 'with no artifact to return, the Hawk sacrifices itself')
}

section("Red Mage's Rapier: job select, and the equipped creature grows on noncreature spells")
{
  const e = makeEngine('Mountain', 20)
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  const rapier = put(e, 0, "Red Mage's Rapier", 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: rapier.oid })
  bothPass(e)
  resolveAll(e)
  const hero = tokensOf(e, 0, 'Hero')[0]
  recompute(e.state)
  assert(hero && rapier.status.attachedTo === hero.oid && hero.chars.subtypes.includes('Wizard'), 'a Hero token, equipped, and a Wizard')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  e._grantPriority()
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  recompute(e.state)
  assert(hero.chars.power === 3, 'the Hero got +2/+0 from the noncreature spell')
}

section('Guardian of the Guildpact: protection from monocolored')
{
  const e = makeEngine()
  put(e, 1, 'Mountain', 'battlefield')
  const guardian = put(e, 0, 'Guardian of the Guildpact', 'battlefield')
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  recompute(e.state)
  assert(guardian.chars.protections.includes('monocolored'), 'the protection is parsed')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'pass' })
  let err = null
  try {
    e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: guardian.oid }] })
  } catch (x) {
    err = x.message
  }
  assert(/target/.test(err || ''), 'a mono-red Bolt may not target it')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 0 }] })
  assert(zone(e.state, 'stack').length === 1, 'the Bolt can still go at a player')
}

section('Shattered Acolyte: sacrifice to destroy an artifact or enchantment')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  const acolyte = put(e, 0, 'Shattered Acolyte', 'battlefield')
  const journey = put(e, 1, 'Journey to Nowhere', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const a = act(e, acolyte.oid, 'activate')
  e.choose({ type: 'activate', oid: acolyte.oid, ability: a.ability, targets: [{ kind: 'object', oid: journey.oid }] })
  resolveAll(e)
  assert(inZone(e, 0, 'graveyard', acolyte.oid) && inZone(e, 1, 'graveyard', journey.oid), 'the Acolyte was sacrificed and the enchantment destroyed')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
