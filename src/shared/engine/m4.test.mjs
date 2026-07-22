// Headless M4a verification: activated abilities on the stack — tap cost with a
// target (Prodigal Sorcerer), mana-cost self-pump firebreathing (Shivan Dragon),
// and a sacrifice-self cost (Mogg Fanatic).
// Run: node src/shared/engine/m4.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const pt = (o) => `${o.chars.power}/${o.chars.toughness}`
const hasActivate = (e, oid) => e.pending.actions.some((a) => a.type === 'activate' && a.oid === oid)

function passUntilTurn(e, target) {
  let g = 0
  while (e.state.turnNumber < target && g++ < 500) {
    const p = e.pending
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else break
  }
}
const resolve = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

// --- 1. Prodigal Sorcerer: {T} to ping ------------------------------------

section('1. Prodigal Sorcerer — {T}: 1 damage to any target')
{
  const e = makeEngine()
  const tim = put(e, 0, 'Prodigal Sorcerer', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  assert(hasActivate(e, tim.oid), 'tap ability is offered')

  e.choose({ type: 'activate', oid: tim.oid, ability: 0, targets: [{ kind: 'player', pid: 1 }] })
  assert(zone(e.state, 'stack').length === 1, 'the ability is on the stack')
  assert(tim.status.tapped === true, 'source tapped to pay the cost')
  resolve(e)
  assert(e.state.players[1].life === 19, 'dealt 1 damage to the opponent')
}

section('1b. summoning sickness blocks a {T} ability')
{
  const e = makeEngine()
  const tim = put(e, 0, 'Prodigal Sorcerer', 'battlefield', { summoningSick: true })
  advanceToPriorityAt(e, 'main1')
  assert(!hasActivate(e, tim.oid), 'a summoning-sick creature cannot use its {T} ability')
}

// --- 2. Shivan Dragon firebreathing: {R}: +1/+0 until EOT -------------------

section('2. Shivan Dragon — {R}: +1/+0 (self-pump, wears off)')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const dragon = put(e, 0, 'Shivan Dragon', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  assert(hasActivate(e, dragon.oid), 'firebreathing offered (no tap, so sickness irrelevant)')

  e.choose({ type: 'activate', oid: dragon.oid, ability: 0 }) // no target
  resolve(e)
  recompute(e.state)
  assert(pt(dragon) === '6/5', 'dragon pumped to 6/5')

  passUntilTurn(e, 2)
  recompute(e.state)
  assert(pt(dragon) === '5/5', 'the pump wore off at end of turn')
}

// --- 3. Mogg Fanatic: Sacrifice → 1 damage ---------------------------------

section('3. Mogg Fanatic — Sacrifice: 1 damage (ability outlives its source)')
{
  const e = makeEngine()
  const mogg = put(e, 0, 'Mogg Fanatic', 'battlefield', { summoningSick: false })
  const victim = put(e, 1, 'Raging Goblin', 'battlefield') // 1/1
  advanceToPriorityAt(e, 'main1')
  assert(hasActivate(e, mogg.oid), 'sacrifice ability offered')

  e.choose({ type: 'activate', oid: mogg.oid, ability: 0, targets: [{ kind: 'object', oid: victim.oid }] })
  assert(inZone(e, 0, 'graveyard', mogg.oid), 'source sacrificed to the graveyard')
  assert(zone(e.state, 'stack').length === 1, 'ability still on the stack after its source is gone')
  resolve(e)
  assert(inZone(e, 1, 'graveyard', victim.oid), '1 damage killed the 1/1')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
