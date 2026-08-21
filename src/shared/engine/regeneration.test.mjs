// Headless verification: regeneration shields (rule 701.15 / 615). "{B}: Regenerate
// this creature" sets up a replacement shield; the next time the creature would be
// destroyed this turn, instead it's tapped, removed from combat, and healed. A
// shield does NOT save a creature put into the graveyard for 0 toughness, and any
// unused shield wears off at end of turn.
// Run: node src/shared/engine/regeneration.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, combat, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('The {B}: Regenerate ability puts a regeneration shield on the creature')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const skel = put(e, 0, 'Drudge Skeletons', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === skel.oid)
  assert(!!act, 'the regenerate ability is activatable')
  e.choose({ type: 'activate', oid: skel.oid, ability: act.ability })
  resolveStack(e)
  assert((skel.status.regenShields || 0) === 1, 'a shield was set up')
}

section('A regeneration shield replaces destruction by a destroy effect (Murder)')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Swamp', 'battlefield')
  const skel = put(e, 0, 'Drudge Skeletons', 'battlefield', { summoningSick: false })
  skel.status.regenShields = 1
  const murder = put(e, 0, 'Murder', 'hand') // destroy target creature (targets own Skeleton here)
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: murder.oid, targets: [{ kind: 'object', oid: skel.oid }] })
  resolveStack(e)
  assert(skel.zoneName === 'battlefield', 'the Skeleton survived Murder')
  assert(skel.status.tapped, 'it was tapped by the regeneration')
  assert((skel.status.regenShields || 0) === 0, 'the shield was consumed')
  assert(murder.zoneName === 'graveyard', 'Murder resolved and is in the graveyard')
}

section('A shield replaces lethal combat damage; the creature is pulled from combat')
{
  const e = makeEngine()
  const bears = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2 attacker
  const skel = put(e, 1, 'Drudge Skeletons', 'battlefield', { summoningSick: false }) // 1/1 blocker
  skel.status.regenShields = 1
  combat(e, [bears.oid], { [skel.oid]: bears.oid })
  assert(skel.zoneName === 'battlefield', 'the Skeleton survived lethal combat damage')
  assert(skel.status.damage === 0, 'its damage was healed')
  assert(skel.status.blocking == null, 'it was removed from combat')
  assert(bears.zoneName === 'battlefield', 'the Bears (2/2) took only 1 and lived')
}

section('Regeneration does NOT save a creature put into the graveyard for 0 toughness')
{
  const e = makeEngine()
  const skel = put(e, 0, 'Drudge Skeletons', 'battlefield', { summoningSick: false })
  skel.status.regenShields = 1
  skel.status.counters['-1/-1'] = 1 // 1/1 -> 0/0
  e._checkSBA()
  assert(skel.zoneName === 'graveyard', 'the 0-toughness creature died despite the shield')
}

section('A shield is one-shot: the second destruction sticks')
{
  const e = makeEngine()
  for (let i = 0; i < 6; i++) put(e, 0, 'Swamp', 'battlefield')
  const skel = put(e, 0, 'Drudge Skeletons', 'battlefield', { summoningSick: false })
  skel.status.regenShields = 1
  const m1 = put(e, 0, 'Murder', 'hand')
  const m2 = put(e, 0, 'Murder', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: m1.oid, targets: [{ kind: 'object', oid: skel.oid }] })
  resolveStack(e)
  assert(skel.zoneName === 'battlefield', 'survived the first Murder')
  e.choose({ type: 'cast', oid: m2.oid, targets: [{ kind: 'object', oid: skel.oid }] })
  resolveStack(e)
  assert(skel.zoneName === 'graveyard', 'the second Murder destroyed it (no shield left)')
}

section('An unused regeneration shield wears off at end of turn')
{
  const e = makeEngine()
  const skel = put(e, 0, 'Drudge Skeletons', 'battlefield', { summoningSick: false })
  skel.status.regenShields = 1
  // Advance into the opponent's turn; turn-1 cleanup clears the shield.
  let g = 0
  while (!(e.state.activePlayer === 1 && e.state.step === 'upkeep') && g++ < 3000) {
    const p = e.pending
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else e.choose({})
  }
  assert((skel.status.regenShields || 0) === 0, 'the shield wore off during cleanup')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
