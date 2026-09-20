// Headless M4c verification: replacement / prevention effects.
//  - "enters with N +1/+1 counters" applied before SBAs (a 0/0 survives as 2/2).
//  - Fog: prevent all combat damage this turn (and it wears off).
// Run: node src/shared/engine/m4c.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const passUntil = (e, pred) => {
  let g = 0
  while (!pred(e) && g++ < 200) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else break
  }
}

// --- 1. Enters-with-counters (replacement before SBA) -----------------------

section('1. Servant of the Scale enters as a 2/2 (0/0 + two counters)')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const servant = put(e, 0, 'Servant of the Scale', 'hand')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: servant.oid })
  bothPass(e) // resolves and enters
  assert(inZone(e, 0, 'battlefield', servant.oid), 'the 0/0 survived (did not die to SBA)')
  recompute(e.state)
  assert(`${servant.chars.power}/${servant.chars.toughness}` === '2/2', 'it is a 2/2 from two +1/+1 counters')
}

// --- 2. Fog prevents combat damage ------------------------------------------

section('2. Fog prevents all combat damage this turn')
{
  const e = makeEngine()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  put(e, 0, 'Forest', 'battlefield') // to pay for Fog
  const fog = put(e, 0, 'Fog', 'hand')
  advanceToPriorityAt(e, 'main1')

  passUntil(e, (e) => e.pending.kind === 'declareAttackers')
  e.choose({ attackers: [bear.oid] })
  // The defender controls no creatures, so there is no block to declare and the
  // game does not stop to ask — 2 damage is incoming.
  passUntil(e, (e) => e.state.step === 'declareBlockers' && e.pending.kind === 'priority')

  // Now the attacking player has priority before combat damage; cast Fog.
  assert(e.pending.kind === 'priority', 'priority before combat damage')
  e.choose({ type: 'cast', oid: fog.oid })
  bothPass(e) // Fog resolves → prevention shield up
  passUntil(e, (e) => e.state.step === 'main2' || e.pending.kind !== 'priority')
  assert(e.state.players[1].life === 20, 'combat damage was prevented (defender still at 20)')
}

// --- 3. control: without Fog the same attack deals damage -------------------

section('3. control — no Fog, damage lands')
{
  const e = makeEngine()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  passUntil(e, (e) => e.pending.kind === 'declareAttackers')
  e.choose({ attackers: [bear.oid] })
  passUntil(e, (e) => e.state.step === 'main2')
  assert(e.state.players[1].life === 18, 'unprevented 2 damage reduced the defender to 18')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
