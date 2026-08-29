// Headless verification, CR gap analysis batch 8:
//   103.7a play or draw; 510.4 two combat damage steps with first strike
//   701.12 fight; 702.29 cycling; 702.74 evoke; 702.93/702.79 undying & persist;
//   702.83 exalted; 702.85 cascade; 702.16 protection from creatures / everything;
//   114 emblems; "enters tapped unless"; "instead of the graveyard" replacements
// Run: node src/shared/engine/cr8.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, combat, keepAll, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const untilStack = (e) => {
  let g = 0
  while (zone(e.state, 'stack').length && e.pending.kind === 'priority' && g++ < 20) bothPass(e)
}

section('103.7a: the die-roll winner may choose to draw')
{
  const deck = () => Array(20).fill('Forest')
  const e = new GameEngine({ seed: 'pd', autoOrderTriggers: true, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start()
  assert(e.pending.kind === 'playOrDraw' && e.pending.player === e.state.startingPlayer, 'asked to play or draw')
  const chooser = e.pending.player
  e.choose({ play: false })
  keepAll(e)
  assert(e.state.activePlayer !== chooser && e.state.turnNumber === 1, 'the other player takes the first turn')
}

section('510.4: priority between first-strike and regular combat damage')
{
  const e = makeEngine()
  put(e, 1, 'Mountain', 'battlefield')
  const knight = put(e, 0, 'White Knight', 'battlefield', { summoningSick: false }) // 2/2 first strike
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ attackers: [knight.oid] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ blocks: { [bear.oid]: knight.oid } })
  g = 0
  while (!(e.state.step === 'combatDamage' && e.pending.kind === 'priority') && g++ < 20) e.choose({ type: 'pass' })
  assert(inZone(e, 1, 'graveyard', bear.oid) && knight.status.damage === 0, 'first strike killed the bear before it could hit back')
  e.choose({ type: 'pass' }) // player 1 gets priority in the first combat damage step
  assert(e.pending.player === 1 && e.state.step === 'combatDamage', 'the defender has priority before regular damage')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: knight.oid }] })
  bothPass(e)
  assert(inZone(e, 0, 'graveyard', knight.oid), 'Bolt killed the Knight between the two damage steps')
}

section('701.12 fight')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const mine = put(e, 0, 'Serra Angel', 'battlefield') // 4/4
  const theirs = put(e, 1, 'Grizzly Bears', 'battlefield') // 2/2
  const prey = put(e, 0, 'Prey Upon', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: prey.oid, targets: [{ kind: 'object', oid: mine.oid }, { kind: 'object', oid: theirs.oid }] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', theirs.oid) && mine.status.damage === 2, 'the bear died, the Angel took 2')
}

section('702.29 cycling (mana and life costs)')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  const sandbar = put(e, 0, 'Lonely Sandbar', 'hand')
  const wraith = put(e, 0, 'Street Wraith', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(e.pending.actions.filter((a) => a.type === 'cycle').length === 2, 'both cycling cards offer Cycle')
  const hand = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cycle', oid: sandbar.oid })
  assert(inZone(e, 0, 'graveyard', sandbar.oid) && zone(e.state, 'stack').length === 1, 'discarded; the draw is on the stack')
  bothPass(e)
  assert(zone(e.state, 'hand', 0).length === hand, 'drew a card')
  e.choose({ type: 'cycle', oid: wraith.oid })
  assert(e.state.players[0].life === 18, 'Street Wraith: paid 2 life')
}

section('702.74 evoke: cast cheaply, sacrificed on entering after its ETB')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Island', 'battlefield')
  const mull = put(e, 0, 'Mulldrifter', 'hand') // {4}{U}, evoke {2}{U}
  advanceToPriorityAt(e, 'main1')
  const casts = e.pending.actions.filter((a) => a.type === 'cast' && a.oid === mull.oid)
  assert(casts.length === 1 && casts[0].evoke, 'only the evoke cast is affordable off three lands')
  const hand = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cast', oid: mull.oid, evoke: true })
  bothPass(e) // resolves; ETB draw + evoke sacrifice trigger
  untilStack(e)
  assert(zone(e.state, 'hand', 0).length === hand - 1 + 2, 'drew two')
  assert(inZone(e, 0, 'graveyard', mull.oid), 'and Mulldrifter was sacrificed')
}

section('702.93 undying / 702.79 persist')
{
  const e = makeEngine()
  const wolf = put(e, 0, 'Young Wolf', 'battlefield')
  const elite = put(e, 0, 'Safehold Elite', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e._bury(wolf)
  e._bury(elite)
  e._grantPriorityTo(0)
  untilStack(e)
  assert(wolf.zoneName === 'battlefield' && wolf.status.counters['+1/+1'] === 1, 'Young Wolf came back with a +1/+1 counter')
  assert(elite.zoneName === 'battlefield' && elite.status.counters['-1/-1'] === 1, 'Safehold Elite came back with a -1/-1 counter')
  e._bury(wolf)
  e._grantPriorityTo(0)
  assert(zone(e.state, 'stack').length === 0 && wolf.zoneName === 'graveyard', 'with a +1/+1 counter it stays dead')
}

section('702.83 exalted: attacking alone')
{
  const e = makeEngine()
  put(e, 0, 'Akrasan Squire', 'battlefield')
  put(e, 0, 'Akrasan Squire', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  combat(e, [bear.oid])
  assert(e.state.players[1].life === 16, 'two exalted instances: the lone attacker hit for 4')
}

section('702.85 cascade')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const bbe = put(e, 0, 'Bloodbraid Elf', 'hand')
  // Stack the library: a land, then a cheaper spell.
  const lib = e.state.zones['0:library']
  const bolt = put(e, 0, 'Lightning Bolt', 'library')
  const forest = put(e, 0, 'Forest', 'library')
  lib.splice(lib.indexOf(bolt.oid), 1)
  lib.splice(lib.indexOf(forest.oid), 1)
  lib.unshift(bolt.oid)
  lib.unshift(forest.oid)
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bbe.oid })
  bothPass(e) // cascade trigger resolves
  assert(e.pending.kind === 'madness' && e.pending.free && e.pending.oid === bolt.oid, 'offered to cast Lightning Bolt for free')
  e.choose({ cast: true, targets: [{ kind: 'player', pid: 1 }] })
  assert(lib[lib.length - 1] === forest.oid, 'the skipped land went to the bottom')
  untilStack(e)
  assert(e.state.players[1].life === 17 && bbe.zoneName === 'battlefield', 'Bolt resolved, then the Elf')
}

section('702.16: protection from creatures / from everything')
{
  const e = makeEngine()
  const chaplain = put(e, 1, 'Beloved Chaplain', 'battlefield', { summoningSick: false }) // pro creatures
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  recompute(e.state)
  assert(!e._canBlock(bear, chaplain), 'a creature cannot block it')
  e._dealDamage(bear, { obj: chaplain }, 2)
  assert(chaplain.status.damage === 0, 'creature damage is prevented')
  const prog = put(e, 1, 'Progenitus', 'battlefield')
  recompute(e.state)
  assert(!e._targetableBy(prog, 0, ['R', 'Instant']), 'Progenitus cannot be targeted by anything')
  e._bury(prog)
  assert(prog.zoneName === 'library', 'shuffled into its library instead of the graveyard')
}

section('114 emblems: Elspeth ultimate grants indestructible for the rest of the game')
{
  const e = makeEngine()
  const els = put(e, 0, 'Elspeth, Knight-Errant', 'battlefield')
  els.status.counters.loyalty = 8
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  refresh(e)
  e.choose({ type: 'activate', oid: els.oid, ability: 2, targets: [] })
  bothPass(e)
  recompute(e.state)
  assert(zone(e.state, 'command').length === 1 && bear.chars.keywords.includes('Indestructible'), 'the emblem grants indestructible')
  e._dealDamage(null, { obj: bear }, 5)
  e._checkSBA()
  assert(bear.zoneName === 'battlefield', 'lethal damage does not destroy it')
}

section('"Enters tapped unless you control two or fewer other lands"')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const early = put(e, 0, 'Seachrome Coast', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'playLand', oid: early.oid })
  assert(!early.status.tapped, 'with two other lands it enters untapped')
  const f = makeEngine()
  for (let i = 0; i < 3; i++) put(f, 0, 'Plains', 'battlefield')
  const late = put(f, 0, 'Seachrome Coast', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'playLand', oid: late.oid })
  assert(late.status.tapped, 'with three other lands it enters tapped')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
