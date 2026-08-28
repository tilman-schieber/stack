// Headless verification: the engine validates every answer against what the
// pending decision offered. The local UI only offers legal moves, but a networked
// guest's answer is raw JSON — the engine, not the client, is the authority. An
// illegal answer throws and leaves the decision (and the game) untouched.
// Run: node src/shared/engine/validation.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, combat, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Expect choose(answer) to throw, and the decision to still be pending afterwards.
function rejects(e, answer, msg) {
  const before = e.pending
  let threw = false
  try {
    e.choose(answer)
  } catch (err) {
    threw = true
  }
  assert(threw && e.pending === before, msg)
}

section('Priority: only offered actions are accepted')
{
  const e = makeEngine()
  const oppLand = put(e, 1, 'Mountain', 'hand')
  const myLand = put(e, 0, 'Mountain', 'hand')
  const myLand2 = put(e, 0, 'Mountain', 'hand')
  advanceToPriorityAt(e, 'main1')
  rejects(e, { type: 'playLand', oid: oppLand.oid }, "can't play a land from the opponent's hand")
  assert(oppLand.zoneName === 'hand' && oppLand.controller === 1, "opponent's land untouched")
  e.choose({ type: 'playLand', oid: myLand.oid })
  assert(myLand.zoneName === 'battlefield', 'own land drop works')
  rejects(e, { type: 'playLand', oid: myLand2.oid }, 'a second land drop this turn is rejected')
  assert(e.state.players[0].landsPlayed === 1, 'landsPlayed stays 1')
  rejects(e, { type: 'frobnicate', oid: myLand2.oid }, 'unknown action types are rejected')
  rejects(e, { type: 'activate', oid: myLand.oid, ability: 0 }, 'activating a nonexistent ability is rejected')
}

section('Cast: targets must fit the spec (kind, type, player exists)')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand') // any target
  const murder = put(e, 0, 'Murder', 'hand') // target creature
  const land = put(e, 1, 'Forest', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  rejects(e, { type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 7 }] }, 'no such player')
  rejects(e, { type: 'cast', oid: bolt.oid, targets: [] }, 'a targeted spell needs its target')
  rejects(e, { type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: land.oid }] }, "'any target' excludes a land")
  rejects(e, { type: 'cast', oid: murder.oid, targets: [{ kind: 'player', pid: 1 }] }, "'target creature' rejects a player")
  rejects(e, { type: 'cast', oid: murder.oid, targets: [{ kind: 'object', oid: land.oid }] }, "'target creature' rejects a land")
  assert(zone(e.state, 'stack').length === 0, 'nothing reached the stack')
  e.choose({ type: 'cast', oid: murder.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  assert(zone(e.state, 'stack').length === 1, 'a legal target is accepted')
}

section('Cast: X, sacrifice and discard costs are checked')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const wellspring = put(e, 0, 'Ichor Wellspring', 'battlefield')
  const oppArtifact = put(e, 1, 'Ichor Wellspring', 'battlefield')
  const rb = put(e, 0, "Reckoner's Bargain", 'hand') // additional cost: sacrifice an artifact or creature
  advanceToPriorityAt(e, 'main1')
  rejects(e, { type: 'cast', oid: rb.oid }, 'a sacrifice additional cost must be paid')
  rejects(e, { type: 'cast', oid: rb.oid, sacrifice: oppArtifact.oid }, "can't sacrifice an opponent's permanent")
  assert(oppArtifact.zoneName === 'battlefield', "opponent's artifact still there")
  e.choose({ type: 'cast', oid: rb.oid, sacrifice: wellspring.oid })
  assert(wellspring.zoneName === 'graveyard', 'own artifact sacrificed')
}

section('Combat: attackers and blockers must be eligible')
{
  const e = makeEngine()
  const ready = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const sick = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: true })
  const enemy = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  rejects(e, { attackers: [sick.oid] }, 'a summoning-sick creature cannot be declared')
  rejects(e, { attackers: [enemy.oid] }, "an opponent's creature cannot be declared")
  rejects(e, { attackers: [ready.oid, ready.oid] }, 'the same creature cannot attack twice')
  rejects(e, { attackers: [{ oid: ready.oid, defender: { player: 0 } }] }, "can't attack yourself")
  e.choose({ attackers: [ready.oid] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 20) e.choose({ type: 'pass' })
  const tapped = put(e, 1, 'Grizzly Bears', 'battlefield', { tapped: true })
  rejects(e, { blocks: { [tapped.oid]: ready.oid } }, 'a tapped creature cannot block')
  rejects(e, { blocks: { [sick.oid]: ready.oid } }, "the attacker's own creature cannot block")
  rejects(e, { blocks: { [enemy.oid]: sick.oid } }, 'cannot block a creature that is not attacking')
  e.choose({ blocks: { [enemy.oid]: ready.oid } })
  assert(enemy.status.blocking === ready.oid, 'a legal block is accepted')
}

section('Discard / bottom: only cards from your own hand')
{
  const e = makeEngine()
  for (let i = 0; i < 2; i++) put(e, 0, 'Forest', 'hand') // 9 cards -> cleanup discards 2
  const oppPerm = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'discard' && g++ < 60) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else break
  }
  assert(e.pending.kind === 'discard', 'reached the cleanup discard')
  const hand = e.pending.hand
  rejects(e, { discard: [oppPerm.oid, hand[0]] }, "can't 'discard' an opponent's permanent")
  assert(oppPerm.zoneName === 'battlefield', "opponent's permanent untouched")
  rejects(e, { discard: [hand[0], hand[0]] }, 'same card twice is rejected')
  e.choose({ discard: [hand[0], hand[1]] })
  assert(zone(e.state, 'hand', 0).length === 7, 'legal discard accepted')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
