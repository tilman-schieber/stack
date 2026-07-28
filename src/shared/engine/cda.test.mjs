// Headless verification: characteristic-defining P/T (rule 613 layer 7a), via the
// sample-deck card Nightmare — power/toughness each equal to the number of Swamps
// you control. Layer 7a runs before counters (7c) and modify (7d), so those stack.
// Run: node src/shared/engine/cda.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section("Nightmare's P/T equals the number of Swamps you control")
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const nm = put(e, 0, 'Nightmare', 'battlefield', { summoningSick: false })
  recompute(e.state)
  assert(nm.chars.power === 3 && nm.chars.toughness === 3, 'a 3/3 with three Swamps')

  // A fourth Swamp makes it a 4/4 immediately (the CDA re-reads game state).
  put(e, 0, 'Swamp', 'battlefield')
  recompute(e.state)
  assert(nm.chars.power === 4 && nm.chars.toughness === 4, 'a 4/4 after a fourth Swamp')
}

section("Only your own Swamps count")
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 1, 'Swamp', 'battlefield') // opponent's Swamp — does not count
  const nm = put(e, 0, 'Nightmare', 'battlefield', { summoningSick: false })
  recompute(e.state)
  assert(nm.chars.power === 2, "the opponent's Swamp is not counted")
}

section('Counters (7c) and anthems (7d) stack on top of the CDA base')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const nm = put(e, 0, 'Nightmare', 'battlefield', { summoningSick: false })
  nm.status.counters['+1/+1'] = 1
  recompute(e.state)
  assert(nm.chars.power === 3 && nm.chars.toughness === 3, 'base 2/2 + a +1/+1 counter = 3/3')
}

section('With no Swamps a Nightmare is 0/0 and dies to SBAs')
{
  const e = makeEngine()
  const nm = put(e, 0, 'Nightmare', 'battlefield', { summoningSick: false })
  e._checkSBA() // recomputes, then applies state-based actions
  assert(zone(e.state, 'graveyard', 0).includes(nm.oid), 'the 0/0 Nightmare was put into the graveyard')
}

section('A Nightmare that loses its last Swamp dies')
{
  const e = makeEngine()
  const sw = put(e, 0, 'Swamp', 'battlefield')
  const nm = put(e, 0, 'Nightmare', 'battlefield', { summoningSick: false })
  e._checkSBA()
  assert(nm.chars.power === 1, 'a 1/1 while it controls one Swamp')
  // Remove the Swamp; now the CDA makes it 0/0 and SBAs bury it.
  e._bury(sw)
  e._checkSBA()
  assert(zone(e.state, 'graveyard', 0).includes(nm.oid), 'losing its last Swamp killed the Nightmare')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
