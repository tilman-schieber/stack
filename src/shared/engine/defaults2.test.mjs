// Headless verification of the cards that complete the default Pauper decks —
// their other Top 64 variants, their sideboards, and Mono Blue Terror. Oracle
// text from Scryfall.
// Run: node src/shared/engine/defaults2.test.mjs

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
const lastLog = (e) => e.state.log.at(-1)?.text || ''

section('Terminate destroys through regeneration; Breath Weapon spares Dragons')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const term = put(e, 0, 'Terminate', 'hand')
  const skel = put(e, 1, 'Drudge Skeletons', 'battlefield')
  skel.status.regenShields = 1
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: term.oid, targets: [{ kind: 'object', oid: skel.oid }] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', skel.oid), "Terminate: the Skeletons die despite a regeneration shield (can't be regenerated)")

  const f = makeEngine()
  for (let i = 0; i < 3; i++) put(f, 0, 'Mountain', 'battlefield')
  const bw = put(f, 0, 'Breath Weapon', 'hand')
  const bear = put(f, 1, 'Grizzly Bears', 'battlefield')
  const dragon = put(f, 1, 'Shivan Dragon', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: bw.oid })
  bothPass(f)
  assert(inZone(f, 1, 'graveyard', bear.oid) && inZone(f, 1, 'battlefield', dragon.oid) && dragon.status.damage === 0, 'Breath Weapon: 2 to the Bears, nothing to the Dragon')
}

section('Pyroblast / Red Elemental Blast: counter or destroy, only blue')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Island', 'battlefield')
  put(e, 1, 'Mountain', 'battlefield')
  const div = put(e, 0, 'Divination', 'hand')
  const pyro = put(e, 1, 'Pyroblast', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: div.oid })
  e.choose({ type: 'pass' })
  const a = act(e, pyro.oid)
  assert(a?.modal && a.modes.length === 2, 'Pyroblast is modal')
  e.choose({ type: 'cast', oid: pyro.oid, modes: [0], modeTargets: [[{ kind: 'spell', oid: div.oid }]] })
  bothPass(e)
  assert(inZone(e, 0, 'graveyard', div.oid) && hand(e, 0) === 7, 'the blue Divination is countered')

  const f = makeEngine()
  put(f, 1, 'Mountain', 'battlefield')
  const knight = put(f, 0, 'White Knight', 'battlefield')
  const reb = put(f, 1, 'Red Elemental Blast', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'pass' })
  const b = act(f, reb.oid)
  assert(!b || !b.modes.some((m) => m.castable), 'Red Elemental Blast has no legal target against a white permanent and no spell')
  const g = makeEngine()
  put(g, 1, 'Mountain', 'battlefield')
  const drake = put(g, 0, 'Cryptic Serpent', 'battlefield')
  const reb2 = put(g, 1, 'Red Elemental Blast', 'hand')
  advanceToPriorityAt(g, 'main1')
  g.choose({ type: 'pass' })
  g.choose({ type: 'cast', oid: reb2.oid, modes: [1], modeTargets: [[{ kind: 'object', oid: drake.oid }]] })
  bothPass(g)
  assert(inZone(g, 0, 'graveyard', drake.oid), 'the blue Drake is destroyed')
  void knight
}

section('Faerie Macabre: from hand, discard to exile up to two cards from graveyards')
{
  const e = makeEngine()
  const mac = put(e, 0, 'Faerie Macabre', 'hand')
  const c1 = put(e, 1, 'Grizzly Bears', 'graveyard')
  const c2 = put(e, 1, 'Lightning Bolt', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  const a = act(e, mac.oid, 'activate')
  assert(a && a.fromHand && a.needsTargets === 1, 'the discard ability is offered from hand, one target required')
  e.choose({ type: 'activate', oid: mac.oid, ability: a.ability, targets: [{ kind: 'object', oid: c1.oid }, { kind: 'object', oid: c2.oid }] })
  assert(inZone(e, 0, 'graveyard', mac.oid), 'Faerie Macabre was discarded as the cost')
  resolveAll(e)
  assert(inZone(e, 1, 'exile', c1.oid) && inZone(e, 1, 'exile', c2.oid), 'both graveyard cards are exiled')
}

section('Troublemaker Ouphe: bargained, it exiles an artifact or enchantment')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const clue = put(e, 0, 'Ichor Wellspring', 'battlefield')
  const ouphe = put(e, 0, 'Troublemaker Ouphe', 'hand')
  const prism = put(e, 1, 'Prophetic Prism', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  assert(ouphe.behavior.bargain === true, 'Bargain parsed')
  const plain = e.pending.actions.find((a) => a.oid === ouphe.oid && a.type === 'cast' && !a.bargain)
  const barg = e.pending.actions.find((a) => a.oid === ouphe.oid && a.type === 'cast' && a.bargain)
  assert(!!plain && !!barg && barg.sacChoose, 'offered plain and bargained (choose what to sacrifice)')
  e.choose({ type: 'cast', oid: ouphe.oid, bargain: true, sacrifice: clue.oid })
  assert(inZone(e, 0, 'graveyard', clue.oid) && ouphe.bargained, 'the Wellspring was sacrificed; the spell is bargained')
  bothPass(e)
  resolveAll(e)
  if (e.pending.kind === 'chooseTargets') e.choose({ targets: [{ kind: 'object', oid: prism.oid }] })
  resolveAll(e)
  assert(inZone(e, 1, 'exile', prism.oid), "the opponent's Prism is exiled")
}

section('Holy Light and Rally the Peasants: mass pumps with filters')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Plains', 'battlefield')
  const light = put(e, 0, 'Holy Light', 'hand')
  const knight = put(e, 0, 'White Knight', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  const rat = put(e, 1, 'Typhoid Rats', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: light.oid })
  bothPass(e)
  recompute(e.state)
  assert(knight.chars.toughness === 2 && bear.chars.power === 1 && inZone(e, 1, 'graveyard', rat.oid), 'nonwhite creatures got -1/-1 (the Rats died); the white Knight is untouched')
}

section('Martyr of Sands: reveal X white cards, sacrifice: gain 3X life')
{
  const e = makeEngine('Plains', 20) // hand: seven Plains — white? no: lands are colourless
  put(e, 0, 'Plains', 'battlefield')
  const martyr = put(e, 0, 'Martyr of Sands', 'battlefield')
  put(e, 0, 'White Knight', 'hand')
  put(e, 0, 'Holy Light', 'hand')
  advanceToPriorityAt(e, 'main1')
  const a = act(e, martyr.oid, 'activate')
  assert(!!a, 'the ability is offered')
  e.choose({ type: 'activate', oid: martyr.oid, ability: a.ability, targets: [] })
  resolveAll(e)
  assert(e.state.players[0].life === 26, 'two white cards revealed: gained 6')
}

section('End the Festivities / Tectonic Hazard: 1 to each opponent and their creatures')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const etf = put(e, 0, 'End the Festivities', 'hand')
  const mine = put(e, 0, 'Grizzly Bears', 'battlefield')
  const theirs = put(e, 1, 'Typhoid Rats', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: etf.oid })
  bothPass(e)
  assert(e.state.players[1].life === 19 && inZone(e, 1, 'graveyard', theirs.oid) && mine.status.damage === 0 && e.state.players[0].life === 20, "the opponent and their Rats took 1; you and yours didn't")
}

section("Cast into the Fire: 'up to two' creatures in a mode; Flaring Pain stops prevention")
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const cast = put(e, 0, 'Cast into the Fire', 'hand')
  const r1 = put(e, 1, 'Typhoid Rats', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: cast.oid, modes: [0], modeTargets: [[{ kind: 'object', oid: r1.oid }]] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', r1.oid), 'one target chosen out of "up to two": the Rats died')

  const f = makeEngine()
  for (let i = 0; i < 4; i++) put(f, 0, 'Mountain', 'battlefield')
  const pain = put(f, 0, 'Flaring Pain', 'hand')
  const bolt = put(f, 0, 'Lightning Bolt', 'hand')
  const healer = put(f, 1, 'Samite Healer', 'battlefield')
  healer.status.summoningSick = false
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: pain.oid })
  bothPass(f)
  assert(f._ruleMods().some(({ mod }) => mod.damageCantBePrevented), "damage can't be prevented this turn")
}

section('Relic of Progenitus: target player exiles a card of their choice; exile all graveyards')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  const relic = put(e, 0, 'Relic of Progenitus', 'battlefield')
  const g1 = put(e, 1, 'Grizzly Bears', 'graveyard')
  const g2 = put(e, 1, 'Lightning Bolt', 'graveyard')
  put(e, 0, 'Divination', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'activate', oid: relic.oid, ability: 0, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.pending.kind === 'search' && e.pending.player === 1 && e.pending.cards.length === 2, 'the opponent chooses one of their two graveyard cards')
  e.choose({ pick: g2.oid })
  assert(inZone(e, 1, 'exile', g2.oid) && inZone(e, 1, 'graveyard', g1.oid), 'their pick is exiled')
  relic.status.tapped = false
  e._grantPriority()
  const before = hand(e, 0)
  e.choose({ type: 'activate', oid: relic.oid, ability: 1, targets: [] })
  resolveAll(e)
  assert(zone(e.state, 'graveyard', 0).length === 0 && zone(e.state, 'graveyard', 1).length === 0 && hand(e, 0) === before + 1, 'all graveyards exiled, a card drawn')
}

section('Cryogen Relic: stun counter instead of untapping; Sewer-veillance Cam may tap a creature')
{
  const e = makeEngine('Island', 20)
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const relic = put(e, 0, 'Cryogen Relic', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  bear.status.tapped = true
  advanceToPriorityAt(e, 'main1')
  const a = act(e, relic.oid, 'activate')
  assert(!!a, "the Relic's ability is offered")
  e.choose({ type: 'activate', oid: relic.oid, ability: a.ability, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  assert(bear.status.counters.stun === 1, 'the tapped Bears got a stun counter')
  e._setTapped(bear, true)
  // Fast-forward to the opponent's untap step by ending the turn.
  let g = 0
  while (!(e.state.activePlayer === 1 && e.state.step !== 'untap') && g++ < 60) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (e.pending.kind === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else break
  }
  assert(bear.status.tapped && !bear.status.counters.stun, 'in its untap step the Bears stayed tapped and lost the stun counter')

  const f = makeEngine('Island', 20)
  put(f, 0, 'Island', 'battlefield')
  const cam = put(f, 0, 'Sewer-veillance Cam', 'hand')
  const bear2 = put(f, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: cam.oid })
  bothPass(f)
  if (f.pending.kind === 'optionalTrigger') f.choose({ yes: true })
  if (f.pending.kind === 'chooseTargets') f.choose({ targets: [{ kind: 'object', oid: bear2.oid }] })
  resolveAll(f)
  assert(bear2.status.tapped, 'the Cam tapped the Bears as it entered')
}

section('Chromatic Star and Prophetic Prism: costed mana abilities with a colour choice')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const star = put(e, 0, 'Chromatic Star', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  const reds = e.pending.actions.filter((a) => a.oid === star.oid && a.type === 'activate')
  assert(reds.length === 5 && reds.some((a) => a.color === 'R'), 'five activations, one per colour')
  assert(!e.pending.actions.some((a) => a.type === 'tapForMana' && a.oid === star.oid), 'it is not offered as a plain tap-for-mana')
  const before = hand(e, 0)
  e.choose({ type: 'activate', oid: star.oid, ability: 0, color: 'R', targets: [] })
  assert(e.state.players[0].manaPool.R === 1 && inZone(e, 0, 'graveyard', star.oid), 'paid {1}, tapped and sacrificed: {R} in the pool')
  resolveAll(e)
  assert(hand(e, 0) === before + 1, 'the Star drew a card as it hit the graveyard')
  assert(!!act(e, bolt.oid), 'the floating {R} lets the Bolt be cast')
}

section("Black Mage's Rod: job select, +1/+0 Wizard, pings on noncreature spells while attached")
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Swamp', 'battlefield')
  const rod = put(e, 0, "Black Mage's Rod", 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: rod.oid })
  bothPass(e)
  resolveAll(e)
  const hero = zone(e.state, 'battlefield').map((oid) => e.state.objects[oid]).find((o) => o.token && o.printed.name === 'Hero')
  recompute(e.state)
  assert(!!hero && rod.status.attachedTo === hero.oid, 'a Hero token was created and the Rod attached to it')
  assert(hero.chars.power === 2 && hero.chars.subtypes.includes('Wizard'), 'the Hero is a 2/1 Wizard')
  const div = put(e, 0, 'Duress', 'hand')
  e.choose({ type: 'cast', oid: div.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 19, 'casting a noncreature spell pinged the opponent')
}

section('Unexpected Fangs: a lifelink counter grants lifelink')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const fangs = put(e, 0, 'Unexpected Fangs', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: fangs.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  recompute(e.state)
  assert(bear.chars.power === 3 && bear.chars.keywords.includes('Lifelink'), 'a 3/3 with lifelink')
}

section('Extract a Confession: with evidence, the opponent sacrifices their biggest creature')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const conf = put(e, 0, 'Extract a Confession', 'hand')
  put(e, 0, 'Shivan Dragon', 'graveyard') // MV 6
  const small = put(e, 1, 'Typhoid Rats', 'battlefield')
  const big = put(e, 1, 'Hill Giant', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const ev = e.pending.actions.find((a) => a.oid === conf.oid && a.evidence)
  assert(!!ev, 'collecting evidence 6 is offered (a Dragon in the graveyard)')
  e.choose({ type: 'cast', oid: conf.oid, evidence: true })
  assert(zone(e.state, 'graveyard', 0).length === 0 && conf.evidenceCollected, 'the Dragon was exiled as evidence')
  bothPass(e)
  assert(e.pending.kind === 'sacrificeChoice' && e.pending.choices.length === 1 && e.pending.choices[0] === big.oid, 'only the greatest-power creature may be chosen')
  e.choose({ sacrifice: [big.oid] })
  assert(inZone(e, 1, 'graveyard', big.oid) && inZone(e, 1, 'battlefield', small.oid), 'the Giant is gone, the Rats stay')
}

section("Sazacap's Brew: gift a tapped Fish, discard, draw two, pump if gifted")
{
  const e = makeEngine('Mountain', 20)
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const brew = put(e, 0, "Sazacap's Brew", 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const gift = e.pending.actions.find((a) => a.oid === brew.oid && a.gift)
  assert(gift && gift.needsTargets === 2 && gift.discChoose === 1, 'the gift variant has a second target and the discard cost')
  const other = zone(e.state, 'hand', 0).find((oid) => oid !== brew.oid)
  const before = hand(e, 0)
  e.choose({ type: 'cast', oid: brew.oid, gift: true, discard: [other], targets: [{ kind: 'player', pid: 0 }, { kind: 'object', oid: bear.oid }] })
  bothPass(e)
  recompute(e.state)
  const fish = zone(e.state, 'battlefield').map((oid) => e.state.objects[oid]).find((o) => o.token && o.printed.name === 'Fish')
  assert(fish && fish.controller === 1 && fish.status.tapped, 'the opponent got a tapped Fish')
  assert(hand(e, 0) === before - 2 + 2 && bear.chars.power === 4, 'drew two (net of the cast and the discard); the Bears got +2/+0')
}

section("Searing Blaze: 1 each, or 3 each with landfall; the creature must be that player's")
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const blaze = put(e, 0, 'Searing Blaze', 'hand')
  const bear = put(e, 1, 'Hill Giant', 'battlefield')
  const mine = put(e, 0, 'Grizzly Bears', 'battlefield')
  const land = put(e, 0, 'Mountain', 'hand')
  advanceToPriorityAt(e, 'main1')
  let err = null
  try {
    e.choose({ type: 'cast', oid: blaze.oid, targets: [{ kind: 'player', pid: 1 }, { kind: 'object', oid: mine.oid }] })
  } catch (x) {
    err = x.message
  }
  assert(!!err, 'a creature the targeted player does not control is refused')
  e.choose({ type: 'playLand', oid: land.oid })
  e.choose({ type: 'cast', oid: blaze.oid, targets: [{ kind: 'player', pid: 1 }, { kind: 'object', oid: bear.oid }] })
  bothPass(e)
  assert(e.state.players[1].life === 17 && inZone(e, 1, 'graveyard', bear.oid), 'landfall: 3 to the player and 3 to the Giant')
}

section('Militia Bugler, Whitemane Lion, Mardu Devotee, Reckless Lackey, Kessig Flamebreather, Crimson Fleet Commodore')
{
  const e = makeEngine('Plains', 20)
  for (let i = 0; i < 3; i++) put(e, 0, 'Plains', 'battlefield')
  const bugler = put(e, 0, 'Militia Bugler', 'hand')
  const inspector = put(e, 0, 'Thraben Inspector', 'library')
  const lib = e.state.zones[zoneKey('library', 0)]
  lib.splice(lib.indexOf(inspector.oid), 1)
  lib.splice(1, 0, inspector.oid)
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bugler.oid })
  bothPass(e)
  resolveAll(e)
  assert(e.pending.kind === 'lookTop' && e.pending.max === 1, 'Bugler: look at four, may take one creature with power 2 or less')
  e.choose({ picks: [inspector.oid] })
  assert(inZone(e, 0, 'hand', inspector.oid), 'the Inspector is in hand')

  const f = makeEngine()
  put(f, 0, 'Plains', 'battlefield')
  put(f, 0, 'Plains', 'battlefield')
  const lion = put(f, 0, 'Whitemane Lion', 'hand')
  const knight = put(f, 0, 'White Knight', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: lion.oid })
  bothPass(f)
  resolveAll(f)
  assert(f.pending.kind === 'sacrificeChoice' && f.pending.choices.includes(knight.oid) && f.pending.choices.includes(lion.oid), 'Lion: return a creature you control (itself allowed)')
  f.choose({ sacrifice: [knight.oid] })
  assert(inZone(f, 0, 'hand', knight.oid), 'the Knight returned to hand')

  const g = makeEngine()
  put(g, 0, 'Plains', 'battlefield')
  put(g, 0, 'Plains', 'battlefield')
  const devotee = put(g, 0, 'Mardu Devotee', 'battlefield')
  advanceToPriorityAt(g, 'main1')
  const reds = g.pending.actions.filter((a) => a.oid === devotee.oid && a.type === 'activate')
  assert(reds.length === 3 && reds.every((a) => ['R', 'W', 'B'].includes(a.color)), 'Devotee: {1}: add R, W or B (three actions)')
  g.choose({ type: 'activate', oid: devotee.oid, ability: reds[0].ability, color: 'B', targets: [] })
  assert(g.state.players[0].manaPool.B === 1, '{B} added')
  assert(!g.pending.actions.some((a) => a.oid === devotee.oid && a.type === 'activate'), 'once per turn')

  const h = makeEngine()
  for (let i = 0; i < 3; i++) put(h, 0, 'Mountain', 'battlefield')
  const lackey = put(h, 0, 'Reckless Lackey', 'battlefield')
  const flame = put(h, 0, 'Kessig Flamebreather', 'battlefield')
  const bolt = put(h, 0, 'Lightning Bolt', 'hand')
  put(h, 0, 'Mountain', 'battlefield')
  advanceToPriorityAt(h, 'main1')
  assert(lackey.chars.keywords.includes('First strike') && lackey.chars.keywords.includes('Haste'), 'Lackey: first strike, haste')
  h.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(h)
  assert(h.state.players[1].life === 16, 'Bolt for 3 plus the Flamebreather ping')
  const a = act(h, lackey.oid, 'activate')
  const before = hand(h, 0)
  h.choose({ type: 'activate', oid: lackey.oid, ability: a.ability, targets: [] })
  resolveAll(h)
  assert(hand(h, 0) === before + 1 && zone(h.state, 'battlefield').some((oid) => h.state.objects[oid].printed.name === 'Treasure'), 'Lackey: drew and made a Treasure')

  const k = makeEngine()
  for (let i = 0; i < 4; i++) put(k, 0, 'Mountain', 'battlefield')
  const commodore = put(k, 0, 'Crimson Fleet Commodore', 'hand')
  advanceToPriorityAt(k, 'main1')
  k.choose({ type: 'cast', oid: commodore.oid })
  bothPass(k)
  resolveAll(k)
  assert(k.state.monarch === 0, 'the Commodore made you the monarch')
}

section('Experimental Synthesizer: exile the top card, playable this turn only')
{
  const e = makeEngine('Mountain', 20)
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield') // one for the Synthesizer, one for the exiled Bolt
  const synth = put(e, 0, 'Experimental Synthesizer', 'hand')
  const bolt = put(e, 0, 'Lightning Bolt', 'library')
  const lib = e.state.zones[zoneKey('library', 0)]
  lib.splice(lib.indexOf(bolt.oid), 1)
  lib.unshift(bolt.oid)
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: synth.oid })
  bothPass(e)
  resolveAll(e)
  assert(inZone(e, 0, 'exile', bolt.oid) && bolt.playableFromExile === 0, 'the Bolt is exiled and playable')
  assert(e.pending.actions.some((a) => a.oid === bolt.oid && a.fromExile), 'it is offered from exile')
}

section('Standard Bearer: an opponent must target a Flagbearer if able')
{
  const e = makeEngine()
  put(e, 1, 'Mountain', 'battlefield')
  const bearer = put(e, 0, 'Standard Bearer', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'pass' })
  let err = null
  try {
    e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  } catch (x) {
    err = x.message
  }
  assert(/Flagbearer/.test(err || ''), 'bolting the Bears is refused while the Flagbearer is targetable')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: bearer.oid }] })
  bothPass(e)
  assert(inZone(e, 0, 'graveyard', bearer.oid), 'the Standard Bearer took the Bolt')
}

section('Mono Blue Terror: Murmuring Mystic, Delver flips, Deem Inferior, Sleep of the Dead with escape')
{
  const e = makeEngine('Island', 20)
  for (let i = 0; i < 4; i++) put(e, 0, 'Island', 'battlefield')
  const mystic = put(e, 0, 'Murmuring Mystic', 'battlefield')
  const ponder = put(e, 0, 'Ponder', 'hand')
  void mystic
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: ponder.oid })
  resolveAll(e)
  assert(zone(e.state, 'battlefield').some((oid) => e.state.objects[oid].printed.name === 'Bird Illusion'), 'casting a sorcery made a Bird Illusion')

  const f = makeEngine('Island', 20)
  const delver = put(f, 0, 'Delver of Secrets', 'battlefield')
  const bolt = put(f, 0, 'Lightning Bolt', 'library')
  const lib = f.state.zones[zoneKey('library', 0)]
  lib.splice(lib.indexOf(bolt.oid), 1)
  lib.unshift(bolt.oid)
  advanceToPriorityAt(f, 'main1')
  // pass to the next own upkeep
  let g = 0
  while (!(f.state.activePlayer === 0 && f.state.turnNumber >= 3 && f.state.step === 'main1') && g++ < 200) {
    if (f.pending.kind === 'priority') f.choose({ type: 'pass' })
    else if (f.pending.kind === 'declareAttackers') f.choose({ attackers: [] })
    else if (f.pending.kind === 'declareBlockers') f.choose({ blocks: {} })
    else if (f.pending.kind === 'optionalTrigger') f.choose({ yes: true })
    else if (f.pending.kind === 'discard') f.choose({ discard: f.pending.hand.slice(0, f.pending.count) })
    else break
  }
  recompute(f.state)
  assert(delver.face === 1 && delver.chars.name === 'Insectile Aberration' && delver.chars.keywords.includes('Flying'), 'Delver transformed at upkeep (a Bolt on top)')

  const h = makeEngine('Island', 20)
  for (let i = 0; i < 4; i++) put(h, 0, 'Island', 'battlefield')
  const deem = put(h, 0, 'Deem Inferior', 'hand')
  const knight = put(h, 1, 'White Knight', 'battlefield')
  advanceToPriorityAt(h, 'main1')
  assert(h._effectiveCost(0, deem).generic === 3, 'no cards drawn this turn (main phase after the draw was skipped): full price')
  h.choose({ type: 'cast', oid: deem.oid, targets: [{ kind: 'object', oid: knight.oid }] })
  bothPass(h)
  assert(h.pending.kind === 'chooseValue' && h.pending.player === 1, "the Knight's owner chooses where it goes")
  h.choose({ value: 'Second from the top' })
  assert(h.state.zones[zoneKey('library', 1)][1] === knight.oid, 'the Knight is second from the top of its owner\'s library')

  const k = makeEngine('Island', 20)
  for (let i = 0; i < 3; i++) put(k, 0, 'Island', 'battlefield')
  const sleep = put(k, 0, 'Sleep of the Dead', 'graveyard')
  for (let i = 0; i < 3; i++) put(k, 0, 'Ponder', 'graveyard')
  const bear = put(k, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(k, 'main1')
  assert(sleep.behavior.escape?.cost === '{2}{U}' && sleep.behavior.escape.exile === 3, 'Escape—{2}{U}, exile three parsed')
  const esc = act(k, sleep.oid, 'castEscape')
  assert(!!esc, 'escape is offered from the graveyard')
  k.choose({ type: 'castEscape', oid: sleep.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  assert(zone(k.state, 'exile', 0).length === 3, 'three other cards were exiled')
  bothPass(k)
  assert(bear.status.tapped && bear.status.skipUntap, 'the Bears are tapped and will skip their next untap')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
