// Headless verification: a real mana pool (rule 106.4 / 605), manual tapping,
// non-stack mana abilities (Eldrazi Spawn), the seeded starting player (103.1),
// and the public game log.
// Run: node src/shared/engine/manapool.test.mjs

import { GameEngine } from './engine.mjs'
import { projectGame } from './project.mjs'
import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, keepAll, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const SPAWN = { name: 'Eldrazi Spawn', types: ['Creature'], subtypes: ['Eldrazi', 'Spawn'], colors: [], power: 0, toughness: 1 }

section('Tap for mana floats mana; casting spends the pool before tapping more')
{
  const e = makeEngine()
  const m1 = put(e, 0, 'Mountain', 'battlefield')
  const m2 = put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  const taps = e.pending.actions.filter((a) => a.type === 'tapForMana')
  assert(taps.length === 2 && taps.every((a) => a.color === 'R' && a.mana), 'each Mountain offers "tap for {R}"')
  e.choose({ type: 'tapForMana', oid: m1.oid, color: 'R' })
  assert(m1.status.tapped && e.state.players[0].manaPool.R === 1, 'Mountain tapped, {R} in the pool')
  assert(e.pending.kind === 'priority' && e.pending.player === 0, 'player keeps priority after a mana ability')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  assert(e.state.players[0].manaPool.R === 0, 'the floating {R} paid for the Bolt')
  assert(!m2.status.tapped, 'the second Mountain was not tapped')
}

section('Pool empties between steps')
{
  const e = makeEngine()
  const m = put(e, 0, 'Mountain', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'tapForMana', oid: m.oid, color: 'R' })
  assert(e.state.players[0].manaPool.R === 1, 'mana floating in main 1')
  e.choose({ type: 'pass' })
  e.choose({ type: 'pass' }) // both pass: main1 ends
  assert(e.state.step !== 'main1', 'moved on from main 1')
  assert(e.state.players[0].manaPool.R === 0, 'pool emptied at the step boundary')
}

section("Eldrazi Spawn: sacrifice for {C} is a mana ability (no stack), never auto-spent")
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'hand') // {1}{G}
  advanceToPriorityAt(e, 'main1')
  e._createToken(SPAWN, 0)
  refresh(e)
  const spawn = zone(e.state, 'battlefield').map((o) => e.state.objects[o]).find((o) => o.token)
  assert(!e.pending.actions.some((a) => a.type === 'cast' && a.oid === bears.oid), 'Bears not castable: auto-pay never sacrifices the Spawn')
  const sac = e.pending.actions.find((a) => a.type === 'activate' && a.oid === spawn.oid)
  assert(sac && sac.mana && /Sacrifice/.test(sac.label), 'the Spawn offers its sacrifice mana ability')
  e.choose({ type: 'activate', oid: spawn.oid, ability: 0, targets: [] })
  assert(zone(e.state, 'stack').length === 0, 'mana ability did not use the stack')
  assert(e.state.players[0].manaPool.C === 1 && !e.state.objects[spawn.oid], '{C} in the pool; token gone')
  assert(e.pending.actions.some((a) => a.type === 'cast' && a.oid === bears.oid), 'Bears now castable with Forest + floating {C}')
  e.choose({ type: 'cast', oid: bears.oid })
  assert(e.state.players[0].manaPool.C === 0, 'the {C} paid the generic pip')
}

section('X spells count floating mana')
{
  const e = makeEngine()
  const f = put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const hydra = put(e, 0, 'Nyxborn Hydra', 'hand') // {X}{G}
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'tapForMana', oid: f.oid, color: 'G' })
  const act = e.pending.actions.find((a) => a.type === 'cast' && a.oid === hydra.oid)
  assert(act && act.maxX === 1, 'max X = 1 with one floating {G} + one untapped Forest')
}

section('Starting player: explicit, or seeded random')
{
  const deck = () => Array(20).fill('Forest')
  const mk = (seed, startingPlayer) =>
    keepAll(new GameEngine({ seed, startingPlayer, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start())
  const e1 = mk('s', 1)
  assert(e1.state.activePlayer === 1 && e1.state.turnNumber === 1, 'startingPlayer: 1 takes turn 1')
  const first = new GameEngine({ seed: 'x', players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start()
  assert(first.pending.kind === 'mulligan' && first.pending.player === first.state.startingPlayer, 'starting player mulligans first')
  const picks = new Set()
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) picks.add(mk(seed).state.activePlayer)
  assert(picks.has(0) && picks.has(1), 'random pick covers both seats across seeds')
  assert(mk('same').state.activePlayer === mk('same').state.activePlayer, 'same seed -> same starting player')
  assert(e1.state.log.some((l) => /B plays first/.test(l.text)), 'log records who plays first')
}

section('Game log: public events recorded, hidden information not')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  e.choose({ type: 'pass' })
  e.choose({ type: 'pass' })
  const texts = e.state.log.map((l) => l.text)
  assert(texts.some((t) => t === 'A casts Lightning Bolt targeting B'), 'cast logged with target')
  assert(texts.some((t) => t === 'Lightning Bolt resolves'), 'resolution logged')
  assert(texts.some((t) => t === 'Lightning Bolt deals 3 damage to B'), 'damage logged')
  assert(texts.some((t) => /^— Turn 1: A —$/.test(t)), 'turn marker logged')
  assert(!texts.some((t) => /draws (a card|\d+ cards).*Forest/.test(t)), 'drawn cards are never named')
  const v = projectGame(e, 1)
  assert(Array.isArray(v.log) && v.log.length === e.state.log.length, 'log projected for the opponent too')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
