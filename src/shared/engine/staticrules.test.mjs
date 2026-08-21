// Headless verification: rule-modifying static effects (rule 613.11) — statics
// that change what players may DO rather than any object's characteristics.
// Covers restrictions (Pacifism: "can't attack or block") and cost modifiers
// (Goblin Warchief: Goblin spells cost {1} less; Thalia: noncreature spells cost
// {1} more).
// Run: node src/shared/engine/staticrules.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

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

// ---- Pacifism: "can't attack or block" ------------------------------------

section('Pacifism: an enchanted creature can no longer attack')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const pac = put(e, 0, 'Pacifism', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(e._eligibleAttackers().includes(bear.oid), 'before Pacifism the Bears may attack')
  e.choose({ type: 'cast', oid: pac.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  assert(pac.status.attachedTo === bear.oid, 'Pacifism attached to the Bears')
  assert(e._restricted(bear, 'attack'), 'the Bears is restricted from attacking')
  assert(!e._eligibleAttackers().includes(bear.oid), 'the Bears is no longer an eligible attacker')
}

section('Pacifism: an enchanted creature can no longer block')
{
  const e = makeEngine()
  // Player 0 (active) enchants player 1's blocker.
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  const wall = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const pac = put(e, 0, 'Pacifism', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(e._eligibleBlockers(1).includes(wall.oid), 'before Pacifism the Bears may block')
  e.choose({ type: 'cast', oid: pac.oid, targets: [{ kind: 'object', oid: wall.oid }] })
  resolveAll(e)
  assert(e._restricted(wall, 'block'), 'the Bears is restricted from blocking')
  assert(!e._eligibleBlockers(1).includes(wall.oid), 'the Bears is no longer an eligible blocker')
}

section('Pacifism restriction disappears when the Aura leaves the battlefield')
{
  const e = makeEngine()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const pac = put(e, 0, 'Pacifism', 'battlefield')
  pac.status.attachedTo = bear.oid
  assert(e._restricted(bear, 'attack'), 'restricted while enchanted')
  // Remove the Aura from the battlefield.
  const bf = zone(e.state, 'battlefield')
  bf.splice(bf.indexOf(pac.oid), 1)
  pac.zoneName = 'graveyard'
  assert(!e._restricted(bear, 'attack'), 'no longer restricted once the Aura is gone')
}

// ---- Goblin Warchief: "Goblin spells you cast cost {1} less" ---------------

section('Goblin Warchief reduces the cost of your Goblin spells by {1}')
{
  const e = makeEngine()
  put(e, 0, 'Goblin Warchief', 'battlefield', { summoningSick: false })
  const piker = put(e, 0, 'Goblin Piker', 'hand') // {1}{R} Goblin
  const bolt = put(e, 0, 'Lightning Bolt', 'hand') // {R} noncreature (not a Goblin)
  assert(e._effectiveCost(0, piker).generic === 0, 'Goblin Piker {1}{R} -> {R} (generic 0)')
  assert(e._effectiveCost(0, bolt).generic === 0, 'Lightning Bolt (not a Goblin) is unchanged')
}

section("Goblin Warchief only reduces its controller's Goblin spells")
{
  const e = makeEngine()
  put(e, 0, 'Goblin Warchief', 'battlefield', { summoningSick: false })
  const oppPiker = put(e, 1, 'Goblin Piker', 'hand')
  assert(e._effectiveCost(1, oppPiker).generic === 1, "opponent's Goblin Piker still {1}{R}")
}

section('Cost reduction never drops generic below zero (Raging Goblin {R})')
{
  const e = makeEngine()
  put(e, 0, 'Goblin Warchief', 'battlefield', { summoningSick: false })
  const raging = put(e, 0, 'Raging Goblin', 'hand') // {R}, generic already 0
  assert(raging.printed.subtypes.includes('Goblin'), 'Raging Goblin is a Goblin')
  assert(e._effectiveCost(0, raging).generic === 0, 'stays at generic 0, R pip untouched')
  assert(e._effectiveCost(0, raging).R === 1, 'the {R} pip is preserved')
}

section('Goblin Warchief grants haste to your Goblins (a normal layer-6 static)')
{
  const e = makeEngine()
  put(e, 0, 'Goblin Warchief', 'battlefield', { summoningSick: false })
  const sick = put(e, 0, 'Goblin Piker', 'battlefield', { summoningSick: true })
  recompute(e.state)
  assert(sick.chars.keywords.includes('Haste'), 'the summoning-sick Goblin has haste')
  assert(e._eligibleAttackers().includes(sick.oid), 'and can therefore attack this turn')
}

// ---- Thalia, Guardian of Thraben: "Noncreature spells cost {1} more" -------

section('Thalia raises the cost of noncreature spells by {1}')
{
  const e = makeEngine()
  put(e, 0, 'Thalia, Guardian of Thraben', 'battlefield', { summoningSick: false })
  const bolt = put(e, 0, 'Lightning Bolt', 'hand') // {R} noncreature
  const bear = put(e, 0, 'Grizzly Bears', 'hand') // {1}{G} creature
  assert(e._effectiveCost(0, bolt).generic === 1, 'Lightning Bolt {R} -> {1}{R}')
  assert(e._effectiveCost(0, bear).generic === 1, "the creature's {1}{G} is unchanged")
}

section('Thalia is symmetric — she taxes every player, not just her controller')
{
  const e = makeEngine()
  put(e, 0, 'Thalia, Guardian of Thraben', 'battlefield', { summoningSick: false })
  const oppBolt = put(e, 1, 'Lightning Bolt', 'hand')
  assert(e._effectiveCost(1, oppBolt).generic === 1, "the opponent's Bolt is taxed too")
}

section('The tax gates castability: one Mountain can no longer pay for Bolt under Thalia')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Thalia, Guardian of Thraben', 'battlefield', { summoningSick: false })
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(
    !e.pending.actions.some((a) => a.type === 'cast' && a.oid === bolt.oid),
    'Bolt is uncastable — {1}{R} needs two mana, only one Mountain is available'
  )
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
