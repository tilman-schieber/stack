// Headless verification: copy effects (rule 706 / 613 layer 1), via the sample-deck
// card Clone — "enter as a copy of any creature on the battlefield." The copy
// replaces Clone's copiable characteristics as it enters, so it never briefly
// exists as its printed 0/0.
// Run: node src/shared/engine/copy.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Cast Clone (already in hand) and pass both players' priority so it resolves and
// pauses on its copy-as-it-enters choice. Returns the pending copyEnter decision.
const castCloneToCopyChoice = (e, clone) => {
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: clone.oid })
  // acting player retains priority; pass both to resolve the Clone
  e.choose({ type: 'pass' })
  e.choose({ type: 'pass' })
  return e.pending
}

section('Clone enters as a copy of a keyword creature — gains its name, P/T and keywords')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Island', 'battlefield')
  const angel = put(e, 1, 'Serra Angel', 'battlefield', { summoningSick: false }) // 4/4 flying vigilance
  const clone = put(e, 0, 'Clone', 'hand')
  const p = castCloneToCopyChoice(e, clone)
  assert(p.kind === 'copyEnter', 'Clone paused for a copy-as-it-enters choice')
  assert(p.choices.includes(angel.oid), 'the enemy Serra Angel is a legal thing to copy')
  e.choose({ copy: angel.oid })
  recompute(e.state)
  assert(inZone(e, 0, 'battlefield', clone.oid), 'the Clone is on the battlefield under its caster')
  assert(clone.chars.name === 'Serra Angel', 'it copied the name')
  assert(clone.chars.power === 4 && clone.chars.toughness === 4, 'it copied the 4/4 body')
  assert(clone.chars.keywords.includes('Flying'), 'it copied Flying')
  assert(clone.chars.keywords.includes('Vigilance'), 'it copied Vigilance')
  assert(clone.status.summoningSick === true, 'the copy is summoning sick')
  assert(clone.owner === 0, 'ownership is unchanged — the Clone is still owned by its caster')
}

section("Clone copying a creature with an ETB trigger fires the copy's own trigger")
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Island', 'battlefield')
  const vis = put(e, 0, 'Elvish Visionary', 'battlefield', { summoningSick: false }) // ETB: draw a card
  const clone = put(e, 0, 'Clone', 'hand')
  castCloneToCopyChoice(e, clone) // Clone is now on the stack, no longer in hand
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ copy: vis.oid })
  // The copy's ETB "draw a card" is a trigger — resolve it.
  let g = 0
  while (zone(e.state, 'stack').length > 0 && e.pending.kind === 'priority' && g++ < 20) {
    e.choose({ type: 'pass' })
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  }
  assert(clone.chars.name === 'Elvish Visionary', 'the Clone became an Elvish Visionary')
  assert(zone(e.state, 'hand', 0).length === handBefore + 1, "the copy's ETB drew a card")
}

section('Clone may decline to copy — it enters as its printed 0/0 and dies to SBAs')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Island', 'battlefield')
  put(e, 1, 'Serra Angel', 'battlefield', { summoningSick: false })
  const clone = put(e, 0, 'Clone', 'hand')
  castCloneToCopyChoice(e, clone)
  e.choose({ copy: null }) // decline
  assert(inZone(e, 0, 'graveyard', clone.oid), 'the 0/0 Clone was put into the graveyard by SBAs')
}

section('Copiable values exclude counters — Clone copies base P/T, not the buffed body')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Island', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  bear.status.counters['+1/+1'] = 2 // a 4/4 on the battlefield
  recompute(e.state)
  assert(bear.chars.power === 4, 'the buffed Bears is a 4/4 right now')
  const clone = put(e, 0, 'Clone', 'hand')
  castCloneToCopyChoice(e, clone)
  e.choose({ copy: bear.oid })
  recompute(e.state)
  assert(clone.chars.power === 2 && clone.chars.toughness === 2, 'the Clone is a 2/2 — counters are not copiable')
}

section('No creatures to copy — Clone enters normally (as a 0/0) with no copy choice')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Island', 'battlefield')
  const clone = put(e, 0, 'Clone', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: clone.oid })
  e.choose({ type: 'pass' })
  e.choose({ type: 'pass' })
  // With nothing to copy there is no copyEnter pause; the 0/0 dies to SBAs.
  assert(e.pending.kind !== 'copyEnter', 'no copy choice was offered')
  assert(inZone(e, 0, 'graveyard', clone.oid), 'the uncopied 0/0 Clone died')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
