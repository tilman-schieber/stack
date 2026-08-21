// Headless verification: layer 3 text-changing (rule 613) via Spreading Seas —
// "Enchanted land is an Island." The land's basic type is replaced, so it now taps
// for {U} instead of its old color, and the Aura draws a card on entry.
// Run: node src/shared/engine/layer3.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { manaAbilityColors } from './behaviors.mjs'
import { makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('Spreading Seas turns a Mountain into an Island (taps for U, and draws a card)')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const mtn = put(e, 0, 'Mountain', 'battlefield')
  recompute(e.state)
  assert(manaAbilityColors(mtn).join() === 'R', 'the Mountain taps for R to begin with')
  const seas = put(e, 0, 'Spreading Seas', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: seas.oid, targets: [{ kind: 'object', oid: mtn.oid }] })
  const handAfterCast = zone(e.state, 'hand', 0).length
  resolveStack(e)
  recompute(e.state)
  assert(seas.status.attachedTo === mtn.oid, 'Spreading Seas is attached to the Mountain')
  assert(mtn.chars.subtypes.includes('Island') && !mtn.chars.subtypes.includes('Mountain'), 'it is now an Island, not a Mountain')
  assert(manaAbilityColors(mtn).join() === 'U', 'the enchanted land now taps for U')
  assert(zone(e.state, 'hand', 0).length === handAfterCast + 1, 'its ETB drew a card')
}

section('Removing the Aura restores the land’s original type')
{
  const e = makeEngine()
  const mtn = put(e, 0, 'Mountain', 'battlefield')
  const seas = put(e, 0, 'Spreading Seas', 'battlefield')
  seas.status.attachedTo = mtn.oid
  recompute(e.state)
  assert(manaAbilityColors(mtn).join() === 'U', 'taps for U while enchanted')
  const bf = zone(e.state, 'battlefield')
  bf.splice(bf.indexOf(seas.oid), 1)
  seas.zoneName = 'graveyard'
  recompute(e.state)
  assert(manaAbilityColors(mtn).join() === 'R', 'back to R once the Aura is gone')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
