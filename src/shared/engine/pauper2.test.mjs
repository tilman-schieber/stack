// Headless verification: the Paupergeddon Summer 2026 #2 and #3 decks —
// White Weenie and Mono Red Rally — and the mechanics they brought in: sneak,
// web-slinging, disturb, prepared, connive, flashback by tapping creatures,
// an alternative "tap a creature" cost, colour prevention, "may play until the
// end of your next turn", Chain Lightning's copy-back, energy equip.
// Run: node src/shared/engine/pauper2.test.mjs

import { zone } from './state.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { classifyCard } from './classify.mjs'
import { recompute } from './layers.mjs'
import { EXAMPLE_DECKS } from '../../renderer/src/lib/exampleDecks.js'
import { makeEngine, put, refresh, advanceToPriorityAt, inZone, combat, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const drain = (e) => {
  let g = 0
  while (g++ < 40 && e.pending.kind === 'priority' && zone(e.state, 'stack').length) bothPass(e)
}
const putTop = (e, pid, name) => {
  const o = put(e, pid, name, 'library')
  const lib = zone(e.state, 'library', pid)
  lib.unshift(lib.pop())
  refresh(e)
  return o
}
const goTo = (e, pid, step) => {
  let g = 0
  while (!(e.state.activePlayer === pid && e.state.step === step && e.pending.kind === 'priority' && e.pending.player === pid) && g++ < 160) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count ?? 1) })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (e.pending.kind === 'declareBlockers') e.choose({ blocks: {} })
    else throw new Error(`unexpected decision ${e.pending.kind}`)
  }
}
const castIt = (e, o, extra = {}) => {
  e.choose({ type: 'cast', oid: o.oid, ...extra })
  bothPass(e)
}
const tokensOf = (e, pid, name) => zone(e.state, 'battlefield').filter((oid) => e.state.objects[oid].token && e.state.objects[oid].controller === pid && (!name || e.state.objects[oid].printed.name === name))

section('Both decks are fully engine-supported')
{
  for (const slug of ['pauper-white-weenie', 'pauper-mono-red-rally']) {
    const deck = EXAMPLE_DECKS.find((d) => d.slug === slug)
    const total = deck.cards.reduce((n, [q]) => n + q, 0)
    const bad = deck.cards.filter(([, name]) => {
      const sf = SAMPLE_CARDS[name] || Object.values(SAMPLE_CARDS).find((c) => c.name.split(' // ')[0] === name)
      return !sf || !classifyCard(sf).supported
    })
    assert(total === 60 && bad.length === 0, `${deck.name}: 60 cards, all supported${bad.length ? ' — missing: ' + bad.map(([, n]) => n).join(', ') : ''}`)
  }
}

section('Investigate, connive, Kor Skyfisher\'s bounce choice, Lunarch Veteran\'s life')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Plains', 'battlefield')
  const vet = put(e, 0, 'Lunarch Veteran', 'battlefield')
  const insp = put(e, 0, 'Thraben Inspector', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, insp)
  drain(e)
  assert(tokensOf(e, 0, 'Clue').length === 1, 'Thraben Inspector investigates')
  assert(e.state.players[0].life === 21, 'Lunarch Veteran: another creature entered, gained 1')
  const inf = put(e, 0, "Raffine's Informant", 'hand')
  put(e, 0, 'Lightning Bolt', 'hand')
  castIt(e, inf)
  drain(e)
  assert(e.pending.kind === 'discardCards' && e.pending.player === 0, 'connive: drew, now discards')
  const nonland = e.pending.hand.find((oid) => !e.state.objects[oid].printed.types.includes('Land'))
  e.choose({ discard: [nonland] })
  drain(e)
  assert(inf.status.counters['+1/+1'] === 1, 'discarded a nonland card: +1/+1 counter')
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const sky = put(e, 0, 'Kor Skyfisher', 'hand')
  castIt(e, sky)
  drain(e)
  assert(e.pending.kind === 'sacrificeChoice' && e.pending.action === 'bounce' && e.pending.choices.includes(insp.oid), 'Skyfisher: choose a permanent you control to return')
  e.choose({ sacrifice: [insp.oid] })
  assert(inZone(e, 0, 'hand', insp.oid), 'the Inspector went back to hand (to investigate again)')
  void vet
}

section('Disturb: cast Luminous Phantom from the graveyard; it is exiled instead of dying')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const vet = put(e, 0, 'Lunarch Veteran', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'castDisturb' && a.oid === vet.oid)
  assert(act, 'disturb is offered from the graveyard')
  e.choose(act)
  assert(e.state.objects[vet.oid].printed.name === 'Luminous Phantom', 'on the stack it is the back face')
  bothPass(e)
  recompute(e.state)
  assert(inZone(e, 0, 'battlefield', vet.oid) && vet.chars.keywords.includes('Flying'), 'Luminous Phantom entered, flying')
  e._bury(vet)
  assert(inZone(e, 0, 'exile', vet.oid), 'it would go to the graveyard: exiled instead')
}

section('Sneak: Leonardo enters tapped and attacking for {W}; +1/+0 per other creature')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const leo = put(e, 0, 'Leonardo, Big Brother', 'hand')
  put(e, 1, 'Grizzly Bears', 'battlefield') // a potential blocker that stays home
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ attackers: [bear.oid] })
  g = 0
  while (!(e.pending.kind === 'declareBlockers') && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ blocks: {} })
  // A's priority after blockers: sneak Leonardo in for the unblocked bear.
  assert(e.pending.kind === 'priority' && e.pending.player === 0, 'A has priority after blocks')
  const act = e.pending.actions.find((a) => a.type === 'cast' && a.sneak && a.oid === leo.oid)
  assert(act && act.returns.includes(bear.oid), 'sneak is offered, returning the unblocked bear')
  e.choose({ ...act, returned: bear.oid })
  assert(inZone(e, 0, 'hand', bear.oid) && inZone(e, 0, 'battlefield', leo.oid) === false, 'the bear went home; Leonardo is on the stack')
  bothPass(e)
  assert(leo.status.attacking && leo.status.tapped && e.state.combat.attackers.includes(leo.oid), 'Leonardo entered tapped and attacking')
  drain(e)
  g = 0
  while (e.state.step !== 'main2' && g++ < 20) e.choose({ type: 'pass' })
  assert(e.state.players[1].life === 19, 'Leonardo (1/3, no other creatures) dealt 1')
  put(e, 0, 'Grizzly Bears', 'battlefield')
  put(e, 0, 'Grizzly Bears', 'battlefield')
  recompute(e.state)
  assert(leo.chars.power === 3, '+1/+0 for each other creature: 3/3 with two Bears')
}

section('Web-slinging: return a tapped creature to cast Spider-Man for {W}')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  const tapped = put(e, 0, 'Grizzly Bears', 'battlefield', { tapped: true })
  const spidey = put(e, 0, 'Spider-Man, Web-Slinger', 'hand')
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'cast' && a.webSlinging && a.oid === spidey.oid)
  assert(act && act.returns.includes(tapped.oid), 'offered, naming the tapped Bears')
  assert(!e.pending.actions.some((a) => a.type === 'cast' && !a.webSlinging && a.oid === spidey.oid), 'the full {2}{W} is not affordable')
  e.choose({ ...act, returned: tapped.oid })
  bothPass(e)
  assert(inZone(e, 0, 'hand', tapped.oid) && inZone(e, 0, 'battlefield', spidey.oid), 'Bears returned, Spider-Man entered')
}

section('Prismatic Strands: colour prevention, flashback by tapping a white creature; Battle Screech')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Plains', 'battlefield')
  const strands = put(e, 0, 'Prismatic Strands', 'hand')
  const knight = put(e, 0, 'White Knight', 'battlefield', { summoningSick: false })
  put(e, 1, 'Mountain', 'battlefield')
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, strands)
  assert(e.pending.kind === 'chooseValue' && e.pending.options.length === 5, 'choose a colour on resolution')
  e.choose({ value: 'R' })
  assert(inZone(e, 0, 'graveyard', strands.oid), 'Strands resolved into the graveyard')
  e.choose({ type: 'pass' }) // B may act
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 0 }] })
  bothPass(e)
  assert(e.state.players[0].life === 20, 'the red Bolt was prevented')
  // Flashback by tapping the White Knight (no mana needed).
  const fb = e.pending.actions.find((a) => a.type === 'castFlashback' && a.oid === strands.oid)
  assert(fb, 'flashback offered with an untapped white creature')
  e.choose(fb)
  assert(knight.status.tapped, 'the Knight was tapped to pay')
  bothPass(e)
  e.choose({ value: 'G' })
  assert(inZone(e, 0, 'exile', strands.oid), 'then exiled')

  const f = makeEngine()
  for (let i = 0; i < 4; i++) put(f, 0, 'Plains', 'battlefield')
  const screech = put(f, 0, 'Battle Screech', 'hand')
  put(f, 0, 'White Knight', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  castIt(f, screech)
  assert(tokensOf(f, 0, 'Bird').length === 2, 'two Birds')
  refresh(f)
  const fb2 = f.pending.actions.find((a) => a.type === 'castFlashback' && a.oid === screech.oid)
  assert(fb2, 'three untapped white creatures: flashback offered')
  f.choose(fb2)
  bothPass(f)
  assert(tokensOf(f, 0, 'Bird').length === 4 && tokensOf(f, 0, 'Bird').every((oid) => f.state.objects[oid].status.tapped || true), 'four Birds after the flashback')
  assert(zone(f.state, 'battlefield').filter((oid) => f.state.objects[oid].controller === 0 && f.state.objects[oid].chars.types.includes('Creature') && f.state.objects[oid].status.tapped).length === 3, 'three creatures were tapped')
}

section("Thraben Charm's modes, Guardians' Pledge, Ramosian Rally's alternative cost")
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Grizzly Bears', 'battlefield')
  put(e, 0, 'Grizzly Bears', 'battlefield')
  const charm = put(e, 0, 'Thraben Charm', 'hand')
  const angel = put(e, 1, 'Serra Angel', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: charm.oid, modes: [0], modeTargets: [[{ kind: 'object', oid: angel.oid }]] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', angel.oid), 'twice two creatures = 4 damage: the Angel died')

  const f = makeEngine()
  put(f, 0, 'Plains', 'battlefield')
  const bear = put(f, 0, 'Grizzly Bears', 'battlefield')
  const knight = put(f, 0, 'White Knight', 'battlefield')
  const rally = put(f, 0, 'Ramosian Rally', 'hand')
  advanceToPriorityAt(f, 'main1')
  const alt = f.pending.actions.find((a) => a.type === 'cast' && a.altCost && a.oid === rally.oid)
  assert(alt, 'with a Plains: castable by tapping a creature')
  f.choose(alt)
  bothPass(f)
  recompute(f.state)
  assert((bear.status.tapped || knight.status.tapped) && bear.chars.power === 3 && knight.chars.power === 3, 'a creature was tapped; everyone got +1/+1')
  const g = makeEngine()
  put(g, 0, 'Forest', 'battlefield')
  put(g, 0, 'Grizzly Bears', 'battlefield')
  const rally2 = put(g, 0, 'Ramosian Rally', 'hand')
  advanceToPriorityAt(g, 'main1')
  assert(!g.pending.actions.some((a) => a.altCost && a.oid === rally2.oid), 'no Plains: no alternative cost')
}

section('Idyllic Grange: enters untapped with three other Plains and grows a creature')
{
  const e = makeEngine()
  const g1 = put(e, 0, 'Idyllic Grange', 'hand')
  put(e, 0, 'Plains', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'playLand', oid: g1.oid })
  assert(g1.status.tapped && zone(e.state, 'stack').length === 0, 'one other Plains: enters tapped, no trigger')
  const f = makeEngine()
  for (let i = 0; i < 3; i++) put(f, 0, 'Plains', 'battlefield')
  const bear = put(f, 0, 'Grizzly Bears', 'battlefield')
  const g2 = put(f, 0, 'Idyllic Grange', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'playLand', oid: g2.oid })
  assert(!g2.status.tapped && f.pending.kind === 'chooseTargets', 'three other Plains: untapped, and the trigger wants a target')
  f.choose({ targets: [{ kind: 'object', oid: bear.oid }] })
  drain(f)
  assert(bear.status.counters['+1/+1'] === 1, '+1/+1 counter on the Bears')
}

section('Prepared: Elite Interceptor enters prepared; casting Rejoinder unprepares it')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Plains', 'battlefield')
  const ei = put(e, 0, 'Elite Interceptor', 'hand')
  const opp = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  castIt(e, ei)
  assert(ei.prepared === true, 'entered prepared')
  const act = e.pending.actions.find((a) => a.type === 'castPrepared' && a.oid === ei.oid)
  assert(act && act.needsTargets === 1, 'Rejoinder can be cast for {1}{W}')
  const hand = zone(e.state, 'hand', 0).length
  e.choose({ ...act, targets: [{ kind: 'object', oid: opp.oid }] })
  assert(!ei.prepared && zone(e.state, 'stack').length === 1, 'unprepared; the copy is on the stack')
  bothPass(e)
  assert(opp.status.tapped && zone(e.state, 'hand', 0).length === hand + 1, 'the opposing Bears was tapped and A drew')
  assert(!e.pending.actions.some((a) => a.type === 'castPrepared'), 'no second cast')
}

section('Mono Red Rally: Emissary mana, Tomb Raider, Inventor\'s Axe energy equip, Rally haste')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bte = put(e, 0, 'Burning-Tree Emissary', 'hand')
  const raider = put(e, 0, 'Goblin Tomb Raider', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, bte, { hybrid: ['R', 'R'] })
  drain(e)
  assert(e.state.players[0].manaPool.R === 1 && e.state.players[0].manaPool.G === 1, 'Emissary added {R}{G}')
  refresh(e)
  castIt(e, raider)
  recompute(e.state)
  assert(inZone(e, 0, 'battlefield', raider.oid) && raider.chars.power === 1 && !raider.chars.keywords.includes('Haste'), 'Tomb Raider without an artifact: 1/2, no haste')
  put(e, 0, 'Mountain', 'battlefield')
  const axe = put(e, 0, "Inventor's Axe", 'hand')
  refresh(e)
  castIt(e, axe)
  drain(e)
  assert(e.pending.kind === 'chooseTargets', 'the Axe attaches to a target creature you control')
  e.choose({ targets: [{ kind: 'object', oid: raider.oid }] })
  drain(e)
  recompute(e.state)
  assert(e.state.players[0].counters.energy === 2 && axe.status.attachedTo === raider.oid, 'two energy; attached')
  assert(raider.chars.power === 4 && raider.chars.keywords.includes('Haste'), 'Raider with an artifact and the Axe: 4/2 haste')
  const other = put(e, 0, 'Burning-Tree Emissary', 'battlefield')
  refresh(e)
  const equip = e.pending.actions.find((a) => a.type === 'activate' && a.oid === axe.oid)
  assert(equip, 'Equip—Pay {E}{E} is available')
  e.choose({ ...equip, targets: [{ kind: 'object', oid: other.oid }] })
  bothPass(e)
  assert(e.state.players[0].counters.energy === 0 && axe.status.attachedTo === other.oid, 'paid two energy; re-equipped')

  const f = makeEngine()
  put(f, 0, 'Mountain', 'battlefield')
  put(f, 0, 'Mountain', 'battlefield')
  const rally = put(f, 0, 'Rally at the Hornburg', 'hand')
  advanceToPriorityAt(f, 'main1')
  castIt(f, rally)
  recompute(f.state)
  const humans = tokensOf(f, 0, 'Human Soldier')
  assert(humans.length === 2 && humans.every((oid) => f.state.objects[oid].chars.keywords.includes('Haste')), 'two hasty Human Soldiers')
}

section('Clockwork Percussionist / Reckless Impulse: play the exiled cards until the end of your next turn')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const imp = put(e, 0, 'Reckless Impulse', 'hand')
  putTop(e, 0, 'Lightning Bolt')
  putTop(e, 0, 'Forest')
  advanceToPriorityAt(e, 'main1')
  castIt(e, imp)
  const exiled = zone(e.state, 'exile', 0).filter((oid) => e.state.objects[oid].playableFromExile === 0)
  assert(exiled.length === 2 && exiled.every((oid) => e.state.objects[oid].playableUntilTurn === 3), 'two cards playable until the end of A\'s next turn (turn 3)')
  refresh(e)
  const land = e.pending.actions.find((a) => a.type === 'playLand' && a.fromExile)
  assert(land, 'the Forest can be played from exile')
  e.choose(land)
  goTo(e, 1, 'main1')
  goTo(e, 0, 'main1')
  assert(e.pending.actions.some((a) => a.type === 'cast' && a.fromExile), 'still playable on A\'s next turn')
  goTo(e, 1, 'main1')
  assert(zone(e.state, 'exile', 0).every((oid) => e.state.objects[oid].playableFromExile == null), 'after that turn ended the permission lapsed')

  const f = makeEngine()
  const perc = put(f, 0, 'Clockwork Percussionist', 'battlefield')
  putTop(f, 0, 'Lightning Bolt')
  advanceToPriorityAt(f, 'main1')
  f._bury(perc)
  f._grantPriorityTo(0)
  drain(f)
  assert(zone(f.state, 'exile', 0).some((oid) => f.state.objects[oid].playableFromExile === 0 && f.state.objects[oid].printed.name === 'Lightning Bolt'), 'Percussionist died: the top card is exiled and playable')
}

section('Chain Lightning: the victim may pay {R}{R} to copy it back with a new target')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const chain = put(e, 0, 'Chain Lightning', 'hand')
  put(e, 1, 'Mountain', 'battlefield')
  put(e, 1, 'Mountain', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: chain.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(e.state.players[1].life === 17 && e.pending.kind === 'mayPay' && e.pending.player === 1 && e.pending.canPay, 'B took 3 and may pay {R}{R} to copy')
  e.choose({ pay: true })
  assert(e.pending.kind === 'chooseTargets' && e.pending.player === 1, 'B chooses a new target for the copy')
  e.choose({ targets: [{ kind: 'player', pid: 0 }] })
  assert(inZone(e, 0, 'graveyard', chain.oid) && zone(e.state, 'stack').length === 1, 'the original finished; the copy waits on the stack')
  bothPass(e)
  assert(e.state.players[0].life === 17 && e.pending.kind === 'mayPay' && e.pending.player === 0, 'the copy hit A, who may copy it again (no mana: cannot)')
  assert(!e.pending.canPay, 'A cannot pay')
  e.choose({ pay: false })
  assert(zone(e.state, 'stack').length === 0 && e.pending.kind === 'priority', 'done')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
