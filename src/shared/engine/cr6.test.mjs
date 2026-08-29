// Headless verification, CR gap analysis batch 6:
//   608.2b a spell with one illegal and one legal target affects only the legal one
//   616.1  prevention is applied before damage doubling (what the affected player picks)
//   613.1f "loses all abilities" (Dress Down), 305.7 Blood Moon
//   613.8  dependency ordering within a layer beats timestamp order
// Run: node src/shared/engine/cr6.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, combat, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

section('608.2b: one target gains shroud in response — the other is still affected')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const fi = put(e, 0, 'Fire // Ice', 'hand')
  const a = put(e, 1, 'Grizzly Bears', 'battlefield')
  const b = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: fi.oid, face: 0, targets: [{ kind: 'object', oid: a.oid }, { kind: 'object', oid: b.oid }], division: [1, 1] })
  e.state.continuous.push({ timestamp: ++e.state.tsCounter, targets: [a.oid], grantKeywords: ['Shroud'], duration: 'eot' })
  bothPass(e)
  assert(a.status.damage === 0 && b.status.damage === 1, 'the shrouded bear took nothing, the other took 1')
  assert(inZone(e, 0, 'graveyard', fi.oid), 'the spell resolved (it did not fizzle)')
}

section('616.1: a prevention shield applies before a damage doubler')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  put(e, 1, 'Furnace of Rath', 'battlefield') // damage is doubled
  e.state.replacements.push({ event: 'damage', target: { player: 1 }, remaining: 3, duration: 'eot', owner: 1 }) // "prevent the next 3"
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(e.state.players[1].life === 20, 'prevent 3 first, then double 0: no damage')
}

section('613.1f Dress Down: creatures lose all abilities')
{
  const e = makeEngine()
  const angel = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false }) // flying, vigilance
  const elves = put(e, 0, 'Llanowar Elves', 'battlefield', { summoningSick: false })
  const warden = put(e, 1, 'Soul Warden', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  const before = e._manaSources(0).length
  const dd = put(e, 1, 'Dress Down', 'battlefield')
  recompute(e.state)
  assert(!angel.chars.keywords.includes('Flying') && angel.chars.lostAbilities, 'Angel has no flying')
  assert(e._manaSources(0).length === before - 1, 'Llanowar Elves no longer taps for mana')
  assert(e._canBlock(bear, angel), 'a ground creature can block the ex-flyer')
  e._createToken({ name: 'Goblin', types: ['Creature'], colors: ['R'], power: 1, toughness: 1 }, 1)
  e._grantPriorityTo(0)
  assert(zone(e.state, 'stack').length === 0, 'Soul Warden did not trigger')
  assert(e.state.players[1].life === 20, 'no life gained')
  // A keyword granted after Dress Down (later timestamp) sticks (613.7).
  e.state.continuous.push({ timestamp: ++e.state.tsCounter, targets: [angel.oid], grantKeywords: ['Haste'], duration: 'eot' })
  recompute(e.state)
  assert(angel.chars.keywords.includes('Haste') && !angel.chars.keywords.includes('Flying'), 'a later grant applies, printed abilities stay lost')
  e._relocate(dd, 'graveyard')
  recompute(e.state)
  assert(angel.chars.keywords.includes('Flying') && !angel.chars.lostAbilities, 'abilities return when Dress Down leaves')
  void warden
  void elves
}

section('305.7 Blood Moon: nonbasic lands are Mountains and tap only for {R}')
{
  const e = makeEngine()
  const vault = put(e, 0, 'Vault of Whispers', 'battlefield') // authored: taps for {B}
  const swamp = put(e, 0, 'Swamp', 'battlefield')
  put(e, 1, 'Blood Moon', 'battlefield')
  recompute(e.state)
  assert(vault.chars.subtypes.join() === 'Mountain' && e._manaColorsOf(vault).join() === 'R', 'Vault is a Mountain tapping for {R}')
  assert(swamp.chars.subtypes.join() === 'Swamp' && e._manaColorsOf(swamp).join() === 'B', 'the basic Swamp is untouched')
}

section('613.8: a dependent effect applies after the one it depends on, despite timestamps')
{
  const e = makeEngine()
  const island = put(e, 0, 'Island', 'battlefield')
  // Q (earlier): "Mountains are Forests"; P (later): "Islands are Mountains".
  // Timestamps alone would give Island → Mountain. Q depends on P (P changes what
  // Q applies to), so P goes first and the Island ends up a Forest.
  const q = put(e, 0, 'Glorious Anthem', 'battlefield')
  q.timestamp = 1
  q.behavior = { ...q.behavior, static: [{ affects: { subtype: 'Mountain' }, setSubtypes: ['Forest'] }] }
  const p = put(e, 0, 'Glorious Anthem', 'battlefield')
  p.timestamp = 2
  p.behavior = { ...p.behavior, static: [{ affects: { subtype: 'Island' }, setSubtypes: ['Mountain'] }] }
  recompute(e.state)
  assert(island.chars.subtypes.join() === 'Forest', 'Island → Mountain → Forest')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
