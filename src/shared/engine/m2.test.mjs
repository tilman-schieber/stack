// Headless M2 verification: keyword abilities in combat (flying/reach, first &
// double strike, trample, deathtouch, lifelink, vigilance, haste, menace).
// Run: node src/shared/engine/m2.test.mjs

import { makeEngine, put, inZone, advanceToPriorityAt, combat, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const alive = (e, pid, o) => inZone(e, pid, 'battlefield', o.oid)
const dead = (e, pid, o) => inZone(e, pid, 'graveyard', o.oid)

// --- 1. Flying: unblockable by a groundling, blockable by reach --------------

section('1. Flying evasion')
{
  const e = makeEngine()
  const flyer = put(e, 0, 'Vampire Nighthawk', 'battlefield', { summoningSick: false }) // 2/3 flyer
  const ground = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  let threw = false
  try {
    // attempt to block the flyer with a groundling
    advanceToPriorityAt(e, 'main1')
    let g = 0
    while (e.pending.kind !== 'declareAttackers' && g++ < 50) e.choose({ type: 'pass' })
    e.choose({ attackers: [flyer.oid] })
    g = 0
    while (e.pending.kind !== 'declareBlockers' && g++ < 50) e.choose({ type: 'pass' })
    e.choose({ blocks: { [ground.oid]: flyer.oid } })
  } catch {
    threw = true
  }
  assert(threw, 'a non-flyer cannot block a flyer')
}
{
  const e = makeEngine()
  const flyer = put(e, 0, 'Vampire Nighthawk', 'battlefield', { summoningSick: false })
  const spider = put(e, 1, 'Giant Spider', 'battlefield', { summoningSick: false }) // 2/4 reach
  combat(e, [flyer.oid], { [spider.oid]: flyer.oid })
  // Nighthawk has deathtouch → 2 damage kills the 2/4 spider; spider deals 2 to the 2/3 hawk (survives).
  assert(dead(e, 1, spider), 'reach creature can block the flyer and dies to deathtouch')
  assert(alive(e, 0, flyer), 'flyer survives (2 damage < 3 toughness)')
}

// --- 2. First strike --------------------------------------------------------

section('2. First strike')
{
  const e = makeEngine()
  const knight = put(e, 0, 'White Knight', 'battlefield', { summoningSick: false }) // 2/2 first strike
  const bears = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2
  combat(e, [knight.oid], { [bears.oid]: knight.oid })
  assert(dead(e, 1, bears), 'first-strike knight kills the 2/2 blocker')
  assert(alive(e, 0, knight), 'knight survives — blocker died before dealing damage')
}

// --- 3. Double strike -------------------------------------------------------

section('3. Double strike')
{
  const e = makeEngine()
  const ace = put(e, 0, 'Fencing Ace', 'battlefield', { summoningSick: false }) // 1/1 double strike
  const bears = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2
  combat(e, [ace.oid], { [bears.oid]: ace.oid })
  // Ace deals 1 (first) + 1 (regular) = 2, enough to kill the 2/2; ace dies to the 2 back.
  assert(dead(e, 1, bears), 'double strike deals 2 total and kills the 2/2')
  assert(dead(e, 0, ace), 'the ace still dies to the blocker')
}

// --- 4. Trample -------------------------------------------------------------

section('4. Trample')
{
  const e = makeEngine()
  const baloth = put(e, 0, 'Rumbling Baloth', 'battlefield', { summoningSick: false }) // 4/4 trample
  const bears = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2
  const startLife = e.state.players[1].life
  combat(e, [baloth.oid], { [bears.oid]: baloth.oid })
  assert(dead(e, 1, bears), 'trampler kills its blocker')
  assert(e.state.players[1].life === startLife - 2, 'excess 2 damage tramples to the player')
}

// --- 5. Deathtouch ----------------------------------------------------------

section('5. Deathtouch')
{
  const e = makeEngine()
  const rats = put(e, 0, 'Typhoid Rats', 'battlefield', { summoningSick: false }) // 1/1 deathtouch
  const angel = put(e, 1, 'Serra Angel', 'battlefield', { summoningSick: false }) // 4/4
  combat(e, [rats.oid], { [angel.oid]: rats.oid })
  assert(dead(e, 1, angel), '1 deathtouch damage kills the 4/4')
  assert(dead(e, 0, rats), 'the rats die to the 4/4')
}

// --- 6. Lifelink ------------------------------------------------------------

section('6. Lifelink')
{
  const e = makeEngine()
  const hawk = put(e, 0, 'Vampire Nighthawk', 'battlefield', { summoningSick: false }) // 2/3 lifelink flyer
  const startLife = e.state.players[0].life
  combat(e, [hawk.oid], {}) // unblocked, 2 damage to defender
  assert(e.state.players[1].life === 20 - 2, 'defender took 2')
  assert(e.state.players[0].life === startLife + 2, 'lifelink gained 2')
}

// --- 7. Vigilance -----------------------------------------------------------

section('7. Vigilance')
{
  const e = makeEngine()
  const angel = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false }) // vigilance
  combat(e, [angel.oid], {})
  assert(angel.status.tapped === false, 'a vigilant attacker does not tap')
}

// --- 8. Haste ---------------------------------------------------------------

section('8. Haste')
{
  const e = makeEngine()
  // Summoning sick, but haste lets it attack the turn it arrived.
  const goblin = put(e, 0, 'Raging Goblin', 'battlefield', { summoningSick: true })
  const startLife = e.state.players[1].life
  combat(e, [goblin.oid], {})
  assert(e.state.players[1].life === startLife - 1, 'hasty creature attacked despite summoning sickness')
}

// --- 9. Menace --------------------------------------------------------------

section('9. Menace')
{
  const e = makeEngine()
  const brute = put(e, 0, 'Boggart Brute', 'battlefield', { summoningSick: false }) // 3/2 menace
  const b1 = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  let threw = false
  try {
    advanceToPriorityAt(e, 'main1')
    let g = 0
    while (e.pending.kind !== 'declareAttackers' && g++ < 50) e.choose({ type: 'pass' })
    e.choose({ attackers: [brute.oid] })
    g = 0
    while (e.pending.kind !== 'declareBlockers' && g++ < 50) e.choose({ type: 'pass' })
    e.choose({ blocks: { [b1.oid]: brute.oid } }) // only one blocker — illegal
  } catch {
    threw = true
  }
  assert(threw, 'menace attacker cannot be blocked by just one creature')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
