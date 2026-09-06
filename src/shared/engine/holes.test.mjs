// Headless verification of the six engine mechanisms from the Paupergeddon Top 64
// coverage scan: typecycling and "except by N creatures"; library manipulation
// (look at the top N, put back, reorder); utility lands (Tron, Karoos, Gates);
// mana-tap bonuses and count-based cost reduction; counter unless pay; exile
// until this leaves. Oracle text from Scryfall.
// Run: node src/shared/engine/holes.test.mjs

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
const lib = (e, p) => e.state.zones[zoneKey('library', p)]
const named = (e, oid) => e.state.objects[oid].printed.name
const act = (e, oid) => e.pending.actions.find((a) => a.oid === oid && a.type !== 'tapForMana')

section('Typecycling: Islandcycling searches for an Island instead of drawing')
{
  const e = makeEngine('Forest', 20)
  put(e, 0, 'Mountain', 'battlefield')
  const rev = put(e, 0, 'Lórien Revealed', 'hand')
  lib(e, 0).splice(5, 0, put(e, 0, 'Island', 'library').oid) // an Island somewhere in the library
  advanceToPriorityAt(e, 'main1')
  assert(rev.behavior.cycling?.cost === '{1}' && rev.behavior.cycling.search?.subtype === 'Island', 'Islandcycling {1} parsed as a search for an Island')
  const a = e.pending.actions.find((x) => x.type === 'cycle' && x.oid === rev.oid)
  assert(!!a, 'cycling is offered')
  e.choose(a)
  resolveAll(e)
  assert(e.pending.kind === 'search' && e.pending.cards.every((oid) => named(e, oid) === 'Island'), 'the search offers exactly the Islands')
  e.choose({ pick: e.pending.cards[0] })
  assert(zone(e.state, 'hand', 0).some((oid) => named(e, oid) === 'Island'), 'the Island is in hand')
  assert(inZone(e, 0, 'graveyard', rev.oid), 'the cycled card is in the graveyard')
  assert(e.state.log.some((l) => /puts Island into their hand/.test(l.text)), 'a revealed search names the card')
}

section("Troll of Khazad-dûm: can't be blocked except by three or more creatures")
{
  const e = makeEngine()
  const troll = put(e, 0, 'Troll of Khazad-dûm', 'battlefield')
  troll.status.summoningSick = false
  const b1 = put(e, 1, 'Grizzly Bears', 'battlefield')
  const b2 = put(e, 1, 'Grizzly Bears', 'battlefield')
  const b3 = put(e, 1, 'Grizzly Bears', 'battlefield')
  assert(troll.behavior.minBlockers === 3, 'minBlockers parsed as 3')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ attackers: [{ oid: troll.oid, player: 1 }] })
  g = 0
  while (e.pending.kind === 'priority' && g++ < 10) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'declareBlockers', 'blockers are being declared')
  let err = null
  try {
    e.choose({ blocks: { [b1.oid]: troll.oid, [b2.oid]: troll.oid } })
  } catch (x) {
    err = x.message
  }
  assert(/3 or more/.test(err || ''), 'two blockers are refused')
  e.choose({ blocks: { [b1.oid]: troll.oid, [b2.oid]: troll.oid, [b3.oid]: troll.oid } })
  assert(e.state.combat.blocks && Object.keys(e.state.combat.blocks).length === 3, 'three blockers are accepted')
}

section('Lead the Stampede: look at five, take the creatures, rest on the bottom')
{
  const e = makeEngine('Forest', 20)
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  const stampede = put(e, 0, 'Lead the Stampede', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'library')
  const elf = put(e, 0, 'Arbor Elf', 'library')
  const l0 = lib(e, 0)
  l0.splice(l0.indexOf(bear.oid), 1)
  l0.splice(l0.indexOf(elf.oid), 1)
  l0.splice(1, 0, bear.oid)
  l0.splice(3, 0, elf.oid) // top five: Forest, Bears, Forest, Elf, Forest
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: stampede.oid })
  bothPass(e)
  assert(e.pending.kind === 'lookTop' && e.pending.cards.length === 5 && e.pending.max === 5, 'looking at the top five')
  const forests = e.pending.cards.filter((oid) => named(e, oid) === 'Forest')
  let err = null
  try {
    e.choose({ picks: [forests[0]] })
  } catch (x) {
    err = x.message
  }
  assert(!!err, 'a land may not be taken (creatures only)')
  const libBefore = l0.length
  e.choose({ picks: [bear.oid, elf.oid] })
  assert(inZone(e, 0, 'hand', bear.oid) && inZone(e, 0, 'hand', elf.oid), 'both creatures went to hand')
  assert(l0.slice(-3).every((oid) => forests.includes(oid)), 'the three Forests are on the bottom')
  assert(l0.length === libBefore - 2, 'the library shrank by the two taken')
}

section('Winding Way: choose creature or land, take every card of that type, rest to graveyard')
{
  const e = makeEngine('Forest', 20)
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const way = put(e, 0, 'Winding Way', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'library')
  const l0 = lib(e, 0)
  l0.splice(l0.indexOf(bear.oid), 1)
  l0.splice(2, 0, bear.oid)
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: way.oid })
  bothPass(e)
  assert(e.pending.kind === 'lookTop' && e.pending.chooseType?.length === 2, 'a creature-or-land choice')
  const gyBefore = zone(e.state, 'graveyard', 0).length
  const forestsBefore = zone(e.state, 'hand', 0).filter((oid) => named(e, oid) === 'Forest').length
  e.choose({ type: 'Land' })
  assert(zone(e.state, 'hand', 0).filter((oid) => named(e, oid) === 'Forest').length === forestsBefore + 3, 'the three Forests among the top four are in hand')
  assert(inZone(e, 0, 'graveyard', bear.oid) && zone(e.state, 'graveyard', 0).length === gyBefore + 2, 'the Bears (and the spell) hit the graveyard')
}

section('Brainstorm: draw three, put two back on top in the chosen order')
{
  const e = makeEngine('Island', 20)
  put(e, 0, 'Island', 'battlefield')
  const bs = put(e, 0, 'Brainstorm', 'hand')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')
  const before = hand(e, 0)
  e.choose({ type: 'cast', oid: bs.oid })
  bothPass(e)
  assert(e.pending.kind === 'putBack' && e.pending.count === 2 && hand(e, 0) === before - 1 + 3, 'drew three, now choosing two to put back')
  let err = null
  try {
    e.choose({ cards: [bolt.oid] })
  } catch (x) {
    err = x.message
  }
  assert(!!err, 'exactly two cards must be chosen')
  e.choose({ cards: [bolt.oid, bear.oid] })
  assert(lib(e, 0)[0] === bolt.oid && lib(e, 0)[1] === bear.oid, 'first chosen card is on top, second beneath it')
  assert(hand(e, 0) === before - 1 + 3 - 2, 'hand is net +0 after the put-back')
}

section('Ponder: look at three, put back in any order, may shuffle; then draw')
{
  const e = makeEngine('Island', 20)
  put(e, 0, 'Island', 'battlefield')
  const ponder = put(e, 0, 'Ponder', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'library')
  const l0 = lib(e, 0)
  l0.splice(l0.indexOf(bear.oid), 1)
  l0.splice(2, 0, bear.oid) // third from the top
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: ponder.oid })
  bothPass(e)
  assert(e.pending.kind === 'scry' && e.pending.noBottom && e.pending.mayShuffle, 'a reorder decision (no bottom option)')
  const [a, b, c] = e.pending.cards
  e.choose({ toTop: [c, a, b], toBottom: [a] }) // toBottom is ignored
  assert(inZone(e, 0, 'hand', bear.oid), 'the card moved to the top (Bears) was drawn')
  assert(l0[0] === a && l0[1] === b, 'the other two follow in the chosen order')
}

section('Tron: each Urza land taps for one, or more with all three')
{
  const e = makeEngine()
  const mine = put(e, 0, "Urza's Mine", 'battlefield')
  assert(e._manaOptionsOf(mine).reduce((m, o) => Math.max(m, o.amount), 0) === 1, 'alone, the Mine makes {C}')
  put(e, 0, "Urza's Power Plant", 'battlefield')
  const tower = put(e, 0, "Urza's Tower", 'battlefield')
  recompute(e.state)
  assert(e._manaOptionsOf(mine).some((o) => o.amount === 2), 'with the set, the Mine makes {C}{C}')
  assert(e._manaOptionsOf(tower).some((o) => o.amount === 3), 'and the Tower {C}{C}{C}')
  const wurm = put(e, 0, 'Craw Wurm', 'hand') // {4}{G}{G} — 7 colourless is not enough without green
  const forest = put(e, 0, 'Forest', 'battlefield')
  const forest2 = put(e, 0, 'Forest', 'battlefield')
  void forest
  void forest2
  advanceToPriorityAt(e, 'main1')
  assert(!!act(e, wurm.oid), 'Craw Wurm ({4}{G}{G}) is castable off Tron + two Forests')
}

section('Karoo: enters tapped, bounces a land, taps for {R}{W}')
{
  const e = makeEngine()
  const mtn = put(e, 0, 'Mountain', 'battlefield')
  const garrison = put(e, 0, 'Boros Garrison', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'playLand', oid: garrison.oid })
  assert(garrison.status.tapped, 'the Garrison enters tapped')
  resolveAll(e)
  assert(e.pending.kind === 'sacrificeChoice' && e.pending.choices.includes(mtn.oid) && e.pending.choices.includes(garrison.oid), 'choose a land to return (the Garrison itself is legal)')
  e.choose({ sacrifice: [mtn.oid] })
  assert(inZone(e, 0, 'hand', mtn.oid), 'the Mountain returned to hand')
  garrison.status.tapped = false
  e._grantPriority() // refresh the offered actions now that it's untapped
  const opts = e._manaOptionsOf(garrison)
  assert(opts.length === 1 && opts[0].pips?.join('') === 'RW', 'its only mana option is the fixed pair {R}{W}')
  const p = e.pending
  void p
  e.choose({ type: 'tapForMana', oid: garrison.oid, option: 0, color: 'R' })
  assert(e.state.players[0].manaPool.R === 1 && e.state.players[0].manaPool.W === 1, 'tapping adds one R and one W')
}

section('Gates: Citadel Gate taps for W or the colour chosen as it entered; Basilisk Gate pumps by Gate count')
{
  const e = makeEngine()
  const gate = put(e, 0, 'Citadel Gate', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'playLand', oid: gate.oid })
  assert(e.pending.kind === 'chooseValue' && e.pending.options.includes('G'), 'asked to choose a colour')
  e.choose({ value: 'G' })
  assert(gate.chosen === 'G' && e._manaOptionsOf(gate)[0].colors.join('') === 'WG', 'taps for W or G')
  const basilisk = put(e, 0, 'Basilisk Gate', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  recompute(e.state)
  const a = act(e, basilisk.oid)
  assert(!!a, "Basilisk Gate's pump is offered at sorcery speed")
  e.choose({ type: 'activate', oid: basilisk.oid, ability: a.ability, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  recompute(e.state)
  assert(bear.chars.power === 4 && bear.chars.toughness === 4, 'Bears got +2/+2 (two Gates)')
}

section('Wild Growth / Utopia Sprawl: the enchanted land makes an extra mana, and auto-pay counts it')
{
  const e = makeEngine()
  const forest = put(e, 0, 'Forest', 'battlefield')
  const growth = put(e, 0, 'Wild Growth', 'battlefield')
  growth.status.attachedTo = forest.oid
  recompute(e.state)
  const opt = e._manaOptionsOf(forest)[0]
  assert(opt.extra?.join('') === 'G', 'the Forest carries an extra {G}')
  const bears = put(e, 0, 'Grizzly Bears', 'hand') // {1}{G} off a single Forest
  advanceToPriorityAt(e, 'main1')
  assert(!!act(e, bears.oid), 'Grizzly Bears is castable off the one enchanted Forest')
  e.choose({ type: 'cast', oid: bears.oid })
  assert(forest.status.tapped && inZone(e, 0, 'battlefield', bears.oid) === false && zone(e.state, 'stack').length === 1, 'paid by tapping the Forest for two')
  const f = makeEngine()
  const forest2 = put(f, 0, 'Forest', 'battlefield')
  const sprawl = put(f, 0, 'Utopia Sprawl', 'battlefield')
  sprawl.status.attachedTo = forest2.oid
  sprawl.chosen = 'R'
  recompute(f.state)
  assert(f._manaOptionsOf(forest2)[0].extra?.join('') === 'R', 'Utopia Sprawl adds the chosen colour')
}

section('Tolarian Terror costs {1} less per instant/sorcery in the graveyard; Sunscape Familiar per colour')
{
  const e = makeEngine('Island', 20)
  for (let i = 0; i < 3; i++) put(e, 0, 'Island', 'battlefield')
  const terror = put(e, 0, 'Tolarian Terror', 'hand') // {6}{U}
  for (let i = 0; i < 4; i++) put(e, 0, 'Lightning Bolt', 'graveyard')
  put(e, 0, 'Grizzly Bears', 'graveyard')
  put(e, 0, 'Divination', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  const cost = e._effectiveCost(0, terror)
  assert(cost.generic === 1 && cost.U === 1, 'five instants/sorceries: {6}{U} becomes {1}{U}')
  assert(!!act(e, terror.oid), 'castable off three Islands')
  const fam = put(e, 0, 'Sunscape Familiar', 'battlefield')
  void fam
  const bears = put(e, 0, 'Grizzly Bears', 'hand')
  const knight = put(e, 0, 'White Knight', 'hand')
  recompute(e.state)
  assert(e._effectiveCost(0, bears).generic === 0, 'a green spell costs {1} less')
  assert(e._effectiveCost(0, knight).generic === (knight.printed.manaCost.generic || 0), 'a white spell is unchanged')
}

section('Mana Tithe: counter unless its controller pays {1}; Spell Pierce only hits noncreature spells')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 1, 'Plains', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const tithe = put(e, 1, 'Mana Tithe', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  e.choose({ type: 'pass' }) // caster passes; opponent has priority with the Bolt on the stack
  e.choose({ type: 'cast', oid: tithe.oid, targets: [{ kind: 'spell', oid: bolt.oid }] })
  bothPass(e)
  assert(e.pending.kind === 'mayPay' && e.pending.player === 0 && e.pending.canPay === false, "the Bolt's controller is asked to pay {1} and can't")
  e.choose({ pay: false })
  assert(inZone(e, 0, 'graveyard', bolt.oid) && e.state.players[1].life === 20, 'the Bolt was countered')

  const f = makeEngine()
  for (let i = 0; i < 3; i++) put(f, 0, 'Mountain', 'battlefield') // one for the Bolt, two spare for Spell Pierce's {2}
  put(f, 1, 'Island', 'battlefield')
  const bolt2 = put(f, 0, 'Lightning Bolt', 'hand')
  const pierce = put(f, 1, 'Spell Pierce', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: bolt2.oid, targets: [{ kind: 'player', pid: 1 }] })
  f.choose({ type: 'pass' })
  f.choose({ type: 'cast', oid: pierce.oid, targets: [{ kind: 'spell', oid: bolt2.oid }] })
  bothPass(f)
  assert(f.pending.kind === 'mayPay' && f.pending.canPay === true, 'with two spare Mountains the {2} payment is possible')
  f.choose({ pay: true })
  resolveAll(f)
  assert(f.state.players[1].life === 17, 'paid: the Bolt resolved')

  const g = makeEngine()
  put(g, 0, 'Forest', 'battlefield')
  put(g, 0, 'Forest', 'battlefield')
  put(g, 1, 'Island', 'battlefield')
  const bears = put(g, 0, 'Grizzly Bears', 'hand')
  const pierce2 = put(g, 1, 'Spell Pierce', 'hand')
  advanceToPriorityAt(g, 'main1')
  g.choose({ type: 'cast', oid: bears.oid })
  g.choose({ type: 'pass' })
  assert(!g.pending.actions.some((a) => a.oid === pierce2.oid), 'Spell Pierce has no legal target against a creature spell')
}

section('Prohibit: counters MV ≤ 2, or ≤ 4 when kicked')
{
  const e = makeEngine()
  for (let i = 0; i < 5; i++) put(e, 1, 'Island', 'battlefield')
  for (let i = 0; i < 4; i++) put(e, 0, 'Forest', 'battlefield')
  const baloth = put(e, 0, 'Rumbling Baloth', 'hand') // {2}{G}{G}, MV 4
  const pro = put(e, 1, 'Prohibit', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: baloth.oid })
  e.choose({ type: 'pass' })
  const plain = e.pending.actions.find((a) => a.oid === pro.oid && !a.kicker)
  const kicked = e.pending.actions.find((a) => a.oid === pro.oid && a.kicker)
  assert(!!plain && !!kicked, 'Prohibit is offered plain and kicked')
  e.choose({ type: 'cast', oid: pro.oid, kicker: true, targets: [{ kind: 'spell', oid: baloth.oid }] })
  bothPass(e)
  assert(inZone(e, 0, 'graveyard', baloth.oid), 'kicked: the MV-4 Baloth is countered')

  const f = makeEngine()
  for (let i = 0; i < 2; i++) put(f, 1, 'Island', 'battlefield')
  for (let i = 0; i < 4; i++) put(f, 0, 'Forest', 'battlefield')
  const baloth2 = put(f, 0, 'Rumbling Baloth', 'hand')
  const pro2 = put(f, 1, 'Prohibit', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: baloth2.oid })
  f.choose({ type: 'pass' })
  f.choose({ type: 'cast', oid: pro2.oid, targets: [{ kind: 'spell', oid: baloth2.oid }] })
  bothPass(f)
  resolveAll(f)
  assert(inZone(f, 0, 'battlefield', baloth2.oid), 'unkicked against MV 4: nothing happens, the Baloth resolves')
}

section('Journey to Nowhere: exiles a creature; it returns when the Journey leaves')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const journey = put(e, 0, 'Journey to Nowhere', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: journey.oid })
  bothPass(e)
  if (e.pending.kind === 'chooseTargets') e.choose({ targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  assert(inZone(e, 1, 'exile', bear.oid) && journey.linkedExile?.includes(bear.oid), 'the Bears are exiled and linked to the Journey')
  e._bury(journey)
  e._grantPriority()
  resolveAll(e)
  assert(inZone(e, 1, 'battlefield', bear.oid), 'the Bears came back when the Journey left')
}

section('Deep Analysis: flashback for {1}{U} and 3 life')
{
  const e = makeEngine('Island', 20)
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const da = put(e, 0, 'Deep Analysis', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  const fb = e.pending.actions.find((a) => a.type === 'castFlashback' && a.oid === da.oid)
  assert(!!fb, 'flashback is offered')
  const before = hand(e, 0)
  e.choose({ type: 'castFlashback', oid: da.oid, targets: [{ kind: 'player', pid: 0 }] })
  assert(e.state.players[0].life === 17, 'paid 3 life')
  bothPass(e)
  assert(hand(e, 0) === before + 2 && inZone(e, 0, 'exile', da.oid), 'drew two; the card is exiled')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
