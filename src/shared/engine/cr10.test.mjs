// Headless verification, CR gap analysis batch 10:
//   310 battles (Siege): defense counters, attacking a battle, defeat → cast transformed
//   115.7 changing a spell's targets (Redirect)
//   509.2 the attacker orders damage assignment among several blockers
//   702.96 overload; 702.94 miracle
// Run: node src/shared/engine/cr10.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, keepAll, inZone, makeAsserter, refresh } from './_testutil.mjs'

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
const toAttackers = (e) => {
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
}
const toBlockers = (e) => {
  let g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 20) e.choose({ type: 'pass' })
}

section('310: a Siege enters with defense, is protected by an opponent, and can be attacked')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  const inv = put(e, 0, 'Invasion of Regatha // Disciples of the Inferno', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const angel = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: inv.oid })
  bothPass(e) // resolves; ETB trigger asks for a target opponent
  assert(inv.zoneName === 'battlefield' && inv.status.counters.defense === 5 && inv.protector === 1, 'entered with 5 defense, protected by B')
  assert(e.pending.kind === 'chooseTargets', 'ETB: choose a target opponent')
  let threw = false
  try {
    e.choose({ targets: [{ kind: 'player', pid: 0 }] })
  } catch {
    threw = true
  }
  assert(threw, '"target opponent" rejects yourself')
  e.choose({ targets: [{ kind: 'player', pid: 1 }] })
  untilStack(e)
  assert(e.state.players[1].life === 16, 'B took 4')
  toAttackers(e)
  assert(e.pending.defenders.some((d) => d.kind === 'battle' && d.oid === inv.oid), 'the battle is offered as an attack target')
  e.choose({ attackers: [{ oid: bear.oid, defender: { battle: inv.oid } }, { oid: angel.oid, defender: { battle: inv.oid } }] })
  toBlockers(e)
  assert(e.pending.player === 1, "the protector declares blockers against the battle's attackers")
  e.choose({ blocks: {} })
  let g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 30) e.choose({ type: 'pass' })
  assert(inv.zoneName === 'exile', '6 damage: defeated and exiled')
  assert(e.pending.kind === 'madness' && e.pending.free && e.pending.oid === inv.oid, 'offered to cast it transformed for free')
  e.choose({ cast: true })
  untilStack(e)
  assert(inv.zoneName === 'battlefield' && inv.face === 1 && inv.chars.name === 'Disciples of the Inferno' && inv.chars.power === 4, 'Disciples of the Inferno is on the battlefield')
  assert(inv.chars.keywords.includes('Prowess'), 'with prowess')
}

section('115.7 Redirect: choose new targets for a spell')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const redirect = put(e, 1, 'Redirect', 'hand')
  const myBear = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  e.choose({ type: 'pass' })
  e.choose({ type: 'cast', oid: redirect.oid, targets: [{ kind: 'spell', oid: bolt.oid }] })
  bothPass(e) // Redirect resolves
  assert(e.pending.kind === 'chooseTargets' && e.pending.player === 1 && e.pending.optional, "B chooses the Bolt's new target (may decline)")
  e.choose({ targets: [{ kind: 'object', oid: myBear.oid }] })
  untilStack(e)
  assert(inZone(e, 0, 'graveyard', myBear.oid) && e.state.players[1].life === 20, 'the Bolt hit the bear instead of B')
}

section('509.2: the attacking player orders blockers for damage')
{
  const deck = () => Array(20).fill('Forest')
  const e = keepAll(new GameEngine({ seed: 'ord', startingPlayer: 0, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start())
  const angel = put(e, 0, 'Gurmag Angler', 'battlefield', { summoningSick: false }) // 5/5, no evasion
  const b1 = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2
  const b2 = put(e, 1, 'Typhoid Rats', 'battlefield', { summoningSick: false }) // 1/1 deathtouch
  advanceToPriorityAt(e, 'main1')
  toAttackers(e)
  e.choose({ attackers: [angel.oid] })
  toBlockers(e)
  e.choose({ blocks: { [b1.oid]: angel.oid, [b2.oid]: angel.oid } })
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 10) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'orderBlockers' && e.pending.player === 0, 'A is asked to order the two blockers')
  e.choose({ order: { [angel.oid]: [b2.oid, b1.oid] } }) // Rats first
  assert(inZone(e, 1, 'graveyard', b2.oid) && inZone(e, 1, 'graveyard', b1.oid), '1 to the Rats, the rest to the Bears: both die')
}

section('702.96 overload: "target" becomes "each"')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const el = put(e, 0, 'Electrickery', 'hand')
  const mine = put(e, 0, 'Typhoid Rats', 'battlefield')
  const t1 = put(e, 1, 'Typhoid Rats', 'battlefield')
  const t2 = put(e, 1, 'Typhoid Rats', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const opts = e.pending.actions.filter((a) => a.type === 'cast' && a.oid === el.oid)
  assert(opts.some((a) => a.overload && a.needsTargets === 0), 'overload offered, untargeted')
  e.choose({ type: 'cast', oid: el.oid, overload: true })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', t1.oid) && inZone(e, 1, 'graveyard', t2.oid) && mine.zoneName === 'battlefield', "each creature you don't control took 1; yours is fine")
}

section('702.94 miracle: cast the first card drawn this turn for its miracle cost')
{
  const e = makeEngine()
  put(e, 1, 'Mountain', 'battlefield')
  const wrath = put(e, 1, 'Thunderous Wrath', 'library')
  const lib = e.state.zones['1:library']
  lib.splice(lib.indexOf(wrath.oid), 1)
  lib.unshift(wrath.oid)
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (!(e.state.activePlayer === 1 && e.pending.kind === 'madness') && g++ < 60) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else break
  }
  assert(e.pending.kind === 'madness' && e.pending.miracle && e.pending.cost === '{R}' && e.state.step === 'draw', 'offered at the draw step for {R}')
  e.choose({ cast: true, targets: [{ kind: 'player', pid: 0 }] })
  untilStack(e)
  assert(e.state.players[0].life === 15 && inZone(e, 1, 'graveyard', wrath.oid), '5 damage; the card went to the graveyard')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
