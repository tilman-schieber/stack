// Headless verification: untargetability — hexproof (702.11), shroud (702.18),
// and protection-from-color on SPELL/ability targeting (702.16e). Until now
// protection was enforced only in combat; these make a permanent an illegal
// target so a spell with no other legal target isn't castable, and naming it
// directly is rejected.
// Run: node src/shared/engine/untargetable.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

const resolveAll = (e) => {
  let g = 0
  while (zone(e.state, 'stack').length > 0 && e.pending.kind === 'priority' && g++ < 40) {
    e.choose({ type: 'pass' })
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  }
}

// ---- Hexproof (Gladecover Scout) ------------------------------------------

section("Hexproof: an opponent's removal can't target it")
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const scout = put(e, 1, 'Gladecover Scout', 'battlefield', { summoningSick: false }) // green, hexproof
  const doom = put(e, 0, 'Doom Blade', 'hand')
  recompute(e.state)
  assert(!e._targetableBy(scout, 0, ['B']), 'the opponent cannot target the hexproof creature')
  advanceToPriorityAt(e, 'main1')
  assert(
    !e.pending.actions.some((a) => a.type === 'cast' && a.oid === doom.oid),
    "Doom Blade is uncastable — its only nonblack creature is the opponent's hexproof Scout"
  )
}

section('Hexproof does not stop its own controller from targeting it')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const scout = put(e, 0, 'Gladecover Scout', 'battlefield', { summoningSick: false })
  const gg = put(e, 0, 'Giant Growth', 'hand')
  recompute(e.state)
  assert(e._targetableBy(scout, 0, ['G']), 'you can target your own hexproof creature')
  advanceToPriorityAt(e, 'main1')
  const cast = e.pending.actions.find((a) => a.type === 'cast' && a.oid === gg.oid)
  assert(!!cast, 'Giant Growth is castable on your own Scout')
  e.choose({ type: 'cast', oid: gg.oid, targets: [{ kind: 'object', oid: scout.oid }] })
  assert(zone(e.state, 'stack').length === 1, 'the spell went on the stack (target accepted)')
}

section('Naming a hexproof creature as a target is rejected outright')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const scout = put(e, 1, 'Gladecover Scout', 'battlefield', { summoningSick: false }) // green hexproof
  const bears = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // green, no hexproof
  const doom = put(e, 0, 'Doom Blade', 'hand')
  recompute(e.state)
  advanceToPriorityAt(e, 'main1')
  assert(
    e.pending.actions.some((a) => a.type === 'cast' && a.oid === doom.oid),
    'Doom Blade is castable now that a legal target (the Bears) exists'
  )
  let threw = false
  try {
    e.choose({ type: 'cast', oid: doom.oid, targets: [{ kind: 'object', oid: scout.oid }] })
  } catch {
    threw = true
  }
  assert(threw, 'targeting the hexproof Scout throws')
  // The legal target still works.
  e.choose({ type: 'cast', oid: doom.oid, targets: [{ kind: 'object', oid: bears.oid }] })
  resolveAll(e)
  assert(bears.zoneName === 'graveyard', 'Doom Blade destroyed the (legal) Bears')
}

// ---- Shroud (Lightning Greaves grants it) ---------------------------------

section('Shroud blocks EVERY player — including the creature’s own controller')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const greaves = put(e, 0, 'Lightning Greaves', 'battlefield')
  greaves.status.attachedTo = bears.oid
  recompute(e.state)
  assert(bears.chars.keywords.includes('Shroud'), 'the equipped creature has shroud')
  assert(!e._targetableBy(bears, 0, ['G']), 'even you cannot target your shrouded creature')
  assert(!e._targetableBy(bears, 1, ['B']), 'and neither can your opponent')
  // Your own Giant Growth can no longer target it.
  const gg = put(e, 0, 'Giant Growth', 'hand')
  advanceToPriorityAt(e, 'main1')
  let threw = false
  try {
    e.choose({ type: 'cast', oid: gg.oid, targets: [{ kind: 'object', oid: bears.oid }] })
  } catch {
    threw = true
  }
  assert(threw, 'casting Giant Growth on your own shrouded creature is rejected')
}

section('Equip {0} attaches Lightning Greaves and grants shroud')
{
  const e = makeEngine()
  const bears = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const greaves = put(e, 0, 'Lightning Greaves', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const equip = e.pending.actions.find((a) => a.type === 'activate' && a.oid === greaves.oid)
  assert(!!equip, 'the Equip {0} ability is available')
  e.choose({ type: 'activate', oid: greaves.oid, ability: equip.ability, targets: [{ kind: 'object', oid: bears.oid }] })
  resolveAll(e)
  recompute(e.state)
  assert(greaves.status.attachedTo === bears.oid, 'Greaves attached to the Bears')
  assert(bears.chars.keywords.includes('Shroud') && bears.chars.keywords.includes('Haste'), 'it has shroud and haste')
}

// ---- Protection from a color, on targeting (White Knight: pro-black) -------

section('Protection from black now stops a black removal spell from targeting')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const knight = put(e, 1, 'White Knight', 'battlefield', { summoningSick: false }) // pro-black
  const doom = put(e, 0, 'Doom Blade', 'hand') // black, "nonblack creature" (Knight is white)
  recompute(e.state)
  assert(knight.chars.protections.includes('B'), 'White Knight has protection from black')
  assert(!e._targetableBy(knight, 0, ['B']), 'a black source cannot target it')
  advanceToPriorityAt(e, 'main1')
  assert(
    !e.pending.actions.some((a) => a.type === 'cast' && a.oid === doom.oid),
    'the black Doom Blade is uncastable against a lone pro-black creature'
  )
}

section('Protection from black does not stop a differently-colored spell')
{
  const e = makeEngine()
  const knight = put(e, 1, 'White Knight', 'battlefield', { summoningSick: false })
  recompute(e.state)
  assert(e._targetableBy(knight, 0, ['R']), 'a red source may target the pro-black creature')
  assert(!e._targetableBy(knight, 0, ['B']), 'but a black source may not')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
