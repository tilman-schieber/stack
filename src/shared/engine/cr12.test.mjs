// Headless verification, CR gap analysis batch 12:
//   106 multi-mana sources (Sol Ring) and restricted mana (Eldrazi Temple, 106.6)
//   702.52 dredge (a draw replacement); "if you would draw from an empty library, win"
//   701.27 proliferate as a real choice
//   702.140 mutate; 702.22 banding
// Run: node src/shared/engine/cr12.test.mjs

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
const drive = (e, pred, max = 150) => {
  let g = 0
  while (!pred() && g++ < max) {
    const k = e.pending.kind
    if (k === 'priority') e.choose({ type: 'pass' })
    else if (k === 'declareAttackers') e.choose({ attackers: [] })
    else if (k === 'declareBlockers') e.choose({ blocks: {} })
    else if (k === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else break
  }
}
const manual = () => {
  const deck = () => Array(20).fill('Forest')
  return keepAll(new GameEngine({ seed: 'm', startingPlayer: 0, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start())
}

section('Sol Ring taps for two; a tap-for-mana action names the amount')
{
  const e = makeEngine()
  put(e, 0, 'Sol Ring', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'hand') // {1}{G}
  const angel = put(e, 0, 'Serra Angel', 'hand') // {3}{W}{W}
  put(e, 0, 'Forest', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  assert(e.pending.actions.some((a) => a.type === 'cast' && a.oid === bear.oid), 'Bears castable off Forest + Sol Ring')
  assert(!e.pending.actions.some((a) => a.type === 'cast' && a.oid === angel.oid), 'Angel is not (no white)')
  const tap = e.pending.actions.find((a) => a.type === 'tapForMana' && a.label.includes('{C}{C}'))
  assert(!!tap, 'the Sol Ring tap is offered as {C}{C}')
  e.choose({ type: 'tapForMana', oid: tap.oid, color: 'C', option: tap.option })
  assert(e.state.players[0].manaPool.C === 2, 'two colourless in the pool')
}

section('106.6 restricted mana: Eldrazi Temple pays only for colourless Eldrazi')
{
  const e = makeEngine()
  put(e, 0, 'Eldrazi Temple', 'battlefield')
  const mimic = put(e, 0, 'Eldrazi Mimic', 'hand') // {2}, colourless Eldrazi
  const bear = put(e, 0, 'Grizzly Bears', 'hand') // {1}{G}
  put(e, 0, 'Forest', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  assert(e.pending.actions.some((a) => a.type === 'cast' && a.oid === mimic.oid), 'Mimic castable: the Temple makes {C}{C} for it')
  const taps = e.pending.actions.filter((a) => a.type === 'tapForMana' && a.oid === e.state.objects[mimic.oid] && false)
  void taps
  e.choose({ type: 'cast', oid: mimic.oid })
  bothPass(e)
  assert(mimic.zoneName === 'battlefield', 'Mimic resolved')
  const f = makeEngine()
  const temple = put(f, 0, 'Eldrazi Temple', 'battlefield')
  const bear2 = put(f, 0, 'Grizzly Bears', 'hand')
  put(f, 0, 'Forest', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  const restricted = f.pending.actions.find((a) => a.type === 'tapForMana' && a.oid === temple.oid && /restricted/.test(a.label))
  assert(!!restricted, 'the restricted {C}{C} option is offered')
  f.choose({ type: 'tapForMana', oid: temple.oid, color: 'C', option: restricted.option })
  assert(f.state.players[0].restrictedPool.length === 2 && f.state.players[0].manaPool.C === 0, 'two restricted {C} floating')
  assert(!f.pending.actions.some((a) => a.type === 'cast' && a.oid === bear2.oid), 'Bears cannot use it (needs {1}{G}: only the Forest is usable)')
  void bear
}

section('702.52 dredge replaces a draw (draw step and spell draws); declining draws normally')
{
  const e = makeEngine()
  const imp = put(e, 1, 'Stinkweed Imp', 'graveyard') // dredge 5
  advanceToPriorityAt(e, 'main1')
  drive(e, () => e.pending.kind === 'dredge')
  assert(e.pending.kind === 'dredge' && e.pending.player === 1 && e.state.step === 'draw', "asked at B's draw step")
  const lib = zone(e.state, 'library', 1).length
  e.choose({ oid: imp.oid })
  assert(inZone(e, 1, 'hand', imp.oid) && zone(e.state, 'library', 1).length === lib - 5 && zone(e.state, 'graveyard', 1).length === 5, 'milled five, Imp back in hand, no card drawn')
  assert(e.pending.kind === 'priority' && e.state.step === 'draw', 'the draw step continues')

  const f = makeEngine()
  put(f, 0, 'Island', 'battlefield')
  put(f, 0, 'Island', 'battlefield')
  put(f, 0, 'Island', 'battlefield')
  const imp2 = put(f, 0, 'Stinkweed Imp', 'graveyard')
  const div = put(f, 0, 'Divination', 'hand') // draw two
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: div.oid })
  bothPass(f)
  assert(f.pending.kind === 'dredge' && f.pending._remaining === 2, 'Divination: the first draw may be dredged')
  const hand = zone(f.state, 'hand', 0).length
  f.choose({}) // draw normally
  assert(f.pending.kind === 'dredge', 'and the second')
  f.choose({ oid: imp2.oid })
  assert(zone(f.state, 'hand', 0).length === hand + 2 && inZone(f, 0, 'hand', imp2.oid), 'one drawn, one dredged')
}

section('Laboratory Maniac: drawing from an empty library wins instead of losing')
{
  const e = makeEngine()
  put(e, 0, 'Laboratory Maniac', 'battlefield')
  e.state.zones['0:library'].length = 0
  advanceToPriorityAt(e, 'main1')
  e.draw(0, 1)
  e._checkSBA()
  assert(e.pending.kind === 'gameOver' && e.pending.winner === 0, 'A wins')
}

section('701.27 proliferate: the controller chooses which permanents and players')
{
  const e = manual()
  const bird = put(e, 0, 'Thrummingbird', 'battlefield', { summoningSick: false })
  const mine = put(e, 0, 'Grizzly Bears', 'battlefield', { counters: { '+1/+1': 1 } })
  const theirs = put(e, 1, 'Grizzly Bears', 'battlefield', { counters: { '+1/+1': 1 } })
  e.state.players[1].counters.poison = 1
  combat(e, [bird.oid])
  assert(e.pending.kind === 'proliferate' && e.pending.choices.length === 3, 'asked: my bear, their bear, the poisoned opponent')
  e.choose({ picks: [{ oid: mine.oid }, { pid: 1 }] })
  assert(mine.status.counters['+1/+1'] === 2 && theirs.status.counters['+1/+1'] === 1 && e.state.players[1].counters.poison === 2, 'only the chosen ones got another counter')
}

section('702.140 mutate: the pile has the top card\'s characteristics and every card\'s abilities')
{
  const e = manual()
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false, counters: { '+1/+1': 1 } })
  const gem = put(e, 0, 'Gemrazer', 'hand') // mutate {1}{G}{G}: 4/4 reach trample; "whenever this mutates, destroy target artifact/enchantment an opponent controls"
  const wellspring = put(e, 1, 'Ichor Wellspring', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const m = e.pending.actions.find((a) => a.type === 'cast' && a.oid === gem.oid && a.mutate)
  assert(!!m, 'the mutate cast is offered')
  e.choose({ type: 'cast', oid: gem.oid, mutate: true, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  assert(e.pending.kind === 'mutateOrder', 'asked: on top or under')
  e.choose({ onTop: true })
  recompute(e.state)
  assert(bear.chars.name === 'Gemrazer' && bear.chars.power === 5 && bear.chars.keywords.includes('Reach') && bear.chars.keywords.includes('Trample'), 'Gemrazer on top: 4/4 + the counter, reach, trample')
  assert(gem.zoneName === 'merged' && !zone(e.state, 'battlefield').includes(gem.oid), 'the Gemrazer card is part of the pile, not a separate permanent')
  assert(e.pending.kind === 'chooseTargets', 'the "whenever this creature mutates" trigger wants a target')
  e.choose({ targets: [{ kind: 'object', oid: wellspring.oid }] })
  untilStack(e)
  assert(inZone(e, 1, 'graveyard', wellspring.oid), 'it destroyed the artifact')
  e._bury(bear)
  assert(inZone(e, 0, 'graveyard', bear.oid) && inZone(e, 0, 'graveyard', gem.oid) && bear.printed.name === 'Grizzly Bears', 'leaving: both cards in the graveyard as themselves')
}

section('702.22 banding: blocked as a group; the band controller assigns the blocker\'s damage')
{
  const e = manual()
  const hero = put(e, 0, 'Benalish Hero', 'battlefield', { summoningSick: false }) // 1/1 banding
  const angel = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false }) // 4/4
  const blocker = put(e, 1, 'Gurmag Angler', 'battlefield', { summoningSick: false }) // 5/5
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ attackers: [{ oid: hero.oid, band: 'A' }, { oid: angel.oid, band: 'A' }] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ blocks: { [blocker.oid]: hero.oid } }) // block the Hero: the Angel is blocked too
  assert(angel.status.blocked, 'blocking one member blocks the whole band')
  g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'combatDamage' && g++ < 30) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'bandDamage', 'the band controller is asked to divide the blocker\'s damage')
  e.choose({ assignment: { [angel.oid]: 5 } })
  g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 30) e.choose({ type: 'pass' })
  assert(e.state.players[1].life === 20, 'no damage got through: the Angel was blocked')
  assert(blocker.status.damage === 5 || inZone(e, 1, 'graveyard', blocker.oid), 'both attackers hit the blocker (1 + 4)')
  assert(angel.zoneName === 'battlefield' && angel.status.damage === 5 || angel.zoneName === 'graveyard', 'all 5 went to the Angel, which dies')
  assert(hero.zoneName === 'battlefield', 'the Hero survived')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
