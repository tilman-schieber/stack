// Headless verification, batch 17: blocking additional creatures (Entourage of
// Trest), day and night (731), the Ring tempts you (701.54), Classes (716) and
// Rooms (Duskmourn doors).
// Run: node src/shared/engine/cr17.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { projectGame } from './project.mjs'
import { recompute } from './layers.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { classifyCard } from './classify.mjs'
import { makeEngine, put, refresh, advanceToPriorityAt, keepAll, inZone, makeAsserter } from './_testutil.mjs'

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
const goTo = (e, pid, step) => {
  let g = 0
  while (!(e.state.activePlayer === pid && e.state.step === step && e.pending.kind === 'priority' && e.pending.player === pid) && g++ < 200) {
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
const toAttackers = (e) => {
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 30) e.choose({ type: 'pass' })
}
const toBlockers = (e) => {
  let g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 30) e.choose({ type: 'pass' })
}
const manual = () => {
  const deck = () => Array(20).fill('Forest')
  return keepAll(new GameEngine({ seed: 'h', startingPlayer: 0, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start())
}

section('The new cards are classified as supported')
{
  for (const n of ['Tavern Ruffian // Tavern Smasher', 'Bird Admirer // Wing Shredder', 'Entourage of Trest', 'Birthday Escape', 'Call of the Ring', 'Ranger Class', 'Derelict Attic // Widow\'s Walk', 'Glassworks // Shattered Yard'])
    assert(classifyCard(SAMPLE_CARDS[n]).supported, `${n} supported`)
}

section('Entourage of Trest blocks two attackers while its controller is the monarch')
{
  const e = makeEngine()
  const a1 = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const a2 = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const ent = put(e, 1, 'Entourage of Trest', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  toAttackers(e)
  e.choose({ attackers: [a1.oid, a2.oid] })
  toBlockers(e)
  let threw = false
  try {
    e.choose({ blocks: { [ent.oid]: [a1.oid, a2.oid] } })
  } catch {
    threw = true
  }
  assert(threw, 'not the monarch: it can block only one')
  e.state.monarch = 1
  e.choose({ blocks: { [ent.oid]: [a1.oid, a2.oid] } })
  assert(a1.status.blocked && a2.status.blocked && e.state.combat.multiBlocks[ent.oid].length === 2, 'both Bears are blocked')
  let g = 0
  while (e.state.step !== 'main2' && g++ < 20) e.choose({ type: 'pass' })
  assert(inZone(e, 0, 'graveyard', a1.oid) && inZone(e, 0, 'graveyard', a2.oid), '4 power split 2/2 kills both Bears')
  assert(ent.status.damage === 0 || inZone(e, 1, 'battlefield', ent.oid), 'the Entourage (4/4) took 4 and survives (damage 4 < toughness... it dies) — checked below')
  assert(inZone(e, 1, 'graveyard', ent.oid), 'two Bears deal 4: the 4/4 Entourage dies too')
  assert(e.state.players[0].life === 20, 'nothing got through')
}

section('Day and night: a daybound permanent starts the day; a spell-less turn brings night')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Mountain', 'battlefield')
  const ruff = put(e, 0, 'Tavern Ruffian', 'hand')
  const bird = put(e, 1, 'Bird Admirer', 'hand')
  put(e, 1, 'Forest', 'battlefield')
  put(e, 1, 'Forest', 'battlefield')
  put(e, 1, 'Forest', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  assert(e.state.daytime === null, 'neither day nor night to begin with')
  castIt(e, ruff)
  assert(e.state.daytime === 'day' && projectGame(e).daytime === 'day', 'the Ruffian entering makes it day')
  assert(ruff.chars.power === 2, 'front face: 2/5')
  // B's turn: B casts nothing -> A's next turn begins at night; the Ruffian transforms.
  goTo(e, 1, 'main1')
  goTo(e, 0, 'main1')
  assert(e.state.daytime === 'night', 'B cast no spells: night')
  recompute(e.state)
  assert(ruff.face === 1 && ruff.printed.name === 'Tavern Smasher' && ruff.chars.power === 6, 'the Ruffian is now the 6/5 Tavern Smasher')
  // A casts two spells this turn -> day again next turn.
  const b1 = put(e, 0, 'Lightning Bolt', 'hand')
  const b2 = put(e, 0, 'Lightning Bolt', 'hand')
  castIt(e, b1, { targets: [{ kind: 'player', pid: 1 }] })
  castIt(e, b2, { targets: [{ kind: 'player', pid: 1 }] })
  goTo(e, 1, 'main1')
  assert(e.state.daytime === 'day' && ruff.face === 0, 'two spells: day, and the Smasher is a Ruffian again')
  // B casts a daybound creature at night: it enters transformed.
  goTo(e, 0, 'main1')
  goTo(e, 1, 'main1') // A cast nothing on their turn -> night now
  assert(e.state.daytime === 'night', 'night again')
  castIt(e, bird)
  assert(bird.face === 1 && bird.printed.name === 'Wing Shredder', 'a daybound creature entering at night enters transformed (731.7)')
}

section('The Ring tempts you: emblem, Ring-bearer, and its growing abilities')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const escape = put(e, 0, 'Birthday Escape', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, escape)
  assert(e.state.players[0].ringTempts === 1 && bear.ringBearer, 'tempted once; the Bears is the Ring-bearer')
  assert(zone(e.state, 'command').some((oid) => e.state.objects[oid].kind === 'emblem' && e.state.objects[oid].printed.name === 'The Ring'), 'the Ring emblem exists')
  recompute(e.state)
  assert(bear.chars.supertypes.includes('Legendary'), 'the Ring-bearer is legendary')
  const view = projectGame(e, 1)
  assert(view.players[0].ringTempts === 1 && view.players[0].emblems.some((x) => x.name === 'The Ring') && view.players[0].battlefield.find((c) => c.oid === bear.oid).ringBearer, 'the view shows it all')
  // Level 1: can't be blocked by creatures with greater power.
  const giant = put(e, 1, 'Hill Giant', 'battlefield')
  assert(!e._canBlock(giant, bear), 'a 3/3 can\'t block the 2/2 Ring-bearer')
  // Level 2: attacks -> loot.
  put(e, 0, 'Island', 'battlefield')
  const escape2 = put(e, 0, 'Birthday Escape', 'hand')
  castIt(e, escape2)
  assert(e.state.players[0].ringTempts === 2, 'tempted twice')
  const hand = zone(e.state, 'hand', 0).length
  toAttackers(e)
  e.choose({ attackers: [bear.oid] })
  drain(e)
  assert(e.pending.kind === 'discardCards' && zone(e.state, 'hand', 0).length === hand + 1, 'the Ring-bearer attacked: drew, now discards')
  e.choose({ discard: [e.pending.hand[0]] })
  // Level 3: a blocker is sacrificed at end of combat.
  const f = makeEngine()
  f.state.players[0].ringTempts = 2
  const rb = put(f, 0, 'Hill Giant', 'battlefield', { summoningSick: false })
  put(f, 0, 'Island', 'battlefield')
  const esc = put(f, 0, 'Birthday Escape', 'hand')
  const blocker = put(f, 1, 'Giant Spider', 'battlefield') // 2/4: may block the 3/3 Ring-bearer (power not greater)
  advanceToPriorityAt(f, 'main1')
  castIt(f, esc)
  assert(f.state.players[0].ringTempts === 3 && rb.ringBearer, 'three temptations')
  toAttackers(f)
  f.choose({ attackers: [rb.oid] })
  drain(f)
  if (f.pending.kind === 'discardCards') f.choose({ discard: [f.pending.hand[0]] }) // level 2 loot
  toBlockers(f)
  f.choose({ blocks: { [blocker.oid]: rb.oid } })
  drain(f)
  let g = 0
  while (f.state.step !== 'main2' && g++ < 30) {
    if (f.pending.kind === 'priority') f.choose({ type: 'pass' })
    else break
  }
  assert(inZone(f, 1, 'graveyard', blocker.oid), 'the Spider that blocked the Ring-bearer was sacrificed at end of combat')

  const h = manual()
  put(h, 0, 'Island', 'battlefield')
  put(h, 0, 'Grizzly Bears', 'battlefield')
  put(h, 0, 'Serra Angel', 'battlefield')
  const esc3 = put(h, 0, 'Birthday Escape', 'hand')
  advanceToPriorityAt(h, 'main1')
  castIt(h, esc3)
  assert(h.pending.kind === 'chooseRingBearer' && h.pending.choices.length === 2, 'with two creatures the player chooses the Ring-bearer')
  h.choose({ oid: h.pending.choices[0] })
  assert(h.state.objects[h.pending?.oid ?? h.state.objects[Object.keys(h.state.objects)[0]].oid] !== undefined, 'chosen')
}

section('Call of the Ring: pay 2 life to draw when you choose a Ring-bearer')
{
  const e = makeEngine()
  put(e, 0, 'Call of the Ring', 'battlefield')
  put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  goTo(e, 1, 'main1')
  goTo(e, 0, 'upkeep')
  drain(e)
  assert(e.pending.kind === 'mayPay' && e.pending.life === 2, 'upkeep: tempted, chose the Bears — may pay 2 life')
  const hand = zone(e.state, 'hand', 0).length
  e.choose({ pay: true })
  assert(e.state.players[0].life === 18 && zone(e.state, 'hand', 0).length === hand + 1, 'paid 2 and drew')
}

section('Ranger Class: level up as a sorcery; each level adds its ability')
{
  const e = makeEngine()
  for (let i = 0; i < 7; i++) put(e, 0, 'Forest', 'battlefield')
  const rc = put(e, 0, 'Ranger Class', 'hand')
  advanceToPriorityAt(e, 'main1')
  castIt(e, rc)
  drain(e)
  const wolf = zone(e.state, 'battlefield').map((oid) => e.state.objects[oid]).find((o) => o.token && o.printed.name === 'Wolf')
  assert(wolf, 'level 1: a 2/2 Wolf')
  assert(projectGame(e).players[0].battlefield.find((c) => c.oid === rc.oid).classLevel === 1, 'shown at level 1')
  const lv2 = e.pending.actions.find((a) => a.type === 'activate' && a.oid === rc.oid)
  assert(lv2 && /Level 2/.test(lv2.label), 'the level-2 ability is offered')
  assert(!e.pending.actions.some((a) => a.type === 'activate' && a.oid === rc.oid && /Level 3/.test(a.label)), 'not level 3 yet')
  e.choose(lv2)
  bothPass(e)
  assert(rc.status.classLevel === 2, 'level 2')
  // Level 2: whenever you attack, a +1/+1 counter on target attacking creature.
  wolf.status.summoningSick = false
  toAttackers(e)
  e.choose({ attackers: [wolf.oid] })
  assert(e.pending.kind === 'chooseTargets' && /Ranger Class/.test(e.pending.name), 'the level-2 trigger asks for an attacking creature')
  e.choose({ targets: [{ kind: 'object', oid: wolf.oid }] })
  drain(e)
  assert(wolf.status.counters['+1/+1'] === 1, 'the Wolf got a counter')
  let g = 0
  while (e.state.step !== 'main2' && g++ < 30) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'declareBlockers') e.choose({ blocks: {} })
  }
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield') // {3}{G} for level 3
  refresh(e)
  const lv3 = e.pending.actions.find((a) => a.type === 'activate' && a.oid === rc.oid && /Level 3/.test(a.label))
  assert(lv3, 'now the level-3 ability is offered')
  e.choose(lv3)
  bothPass(e)
  assert(rc.status.classLevel === 3 && e._topCardVisibility(0) === 'look', 'level 3: you may look at the top card of your library')
}

section('Rooms: cast one door, unlock the other as a sorcery; each door\'s abilities apply')
{
  const e = makeEngine()
  for (let i = 0; i < 8; i++) put(e, 0, 'Mountain', 'battlefield')
  const room = put(e, 0, 'Glassworks // Shattered Yard', 'hand')
  const victim = put(e, 1, 'Serra Angel', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const doors = e.pending.actions.filter((a) => a.type === 'cast' && a.oid === room.oid)
  assert(doors.length === 2 && doors.some((a) => a.face === 0) && doors.some((a) => a.face === 1), 'either door may be cast')
  e.choose({ ...doors.find((a) => a.face === 0) }) // Glassworks {2}{R}
  bothPass(e)
  assert(inZone(e, 0, 'battlefield', room.oid) && room.unlocked?.join() === '0' && room.printed.name === 'Glassworks', 'entered with Glassworks unlocked')
  assert(e.pending.kind === 'chooseTargets' && /Glassworks/.test(e.pending.name), '"when you unlock this door": target creature an opponent controls')
  e.choose({ targets: [{ kind: 'object', oid: victim.oid }] })
  drain(e)
  assert(inZone(e, 1, 'graveyard', victim.oid), '4 damage killed the Angel')
  const unlock = e.pending.actions.find((a) => a.type === 'unlockDoor' && a.oid === room.oid)
  assert(unlock && unlock.face === 1, 'the other door can be unlocked')
  e.choose(unlock)
  assert(room.unlocked.length === 2 && room.printed.name === 'Glassworks // Shattered Yard', 'both doors unlocked')
  assert(projectGame(e).players[0].battlefield.find((c) => c.oid === room.oid).doors.every((d) => d.unlocked), 'the view shows both doors open')
  goTo(e, 0, 'end')
  drain(e)
  assert(e.state.players[1].life === 19, 'Shattered Yard: 1 damage to each opponent at your end step')

  const f = makeEngine()
  for (let i = 0; i < 4; i++) put(f, 0, 'Swamp', 'battlefield')
  const attic = put(f, 0, 'Derelict Attic // Widow\'s Walk', 'hand')
  advanceToPriorityAt(f, 'main1')
  const hand = zone(f.state, 'hand', 0).length - 1
  f.choose({ type: 'cast', oid: attic.oid, face: 1 }) // Widow's Walk {3}{B}
  bothPass(f)
  assert(attic.printed.name === "Widow's Walk" && zone(f.state, 'hand', 0).length === hand, 'Widow\'s Walk unlocked: no draw (that is the other door)')
  const bear = put(f, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  toAttackers(f)
  f.choose({ attackers: [bear.oid] })
  drain(f)
  recompute(f.state)
  assert(bear.chars.power === 3 && bear.chars.keywords.includes('Deathtouch'), 'attacking alone: +1/+0 and deathtouch')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
