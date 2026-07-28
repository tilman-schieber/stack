// Headless verification: color-changing effects (rule 613 layer 5), via the
// sample-deck card Aphotic Wisps ("target creature becomes black … draw a card").
// A layer-5 color change also flips whether "nonblack"-restricted spells (Doom
// Blade) can target the creature.
// Run: node src/shared/engine/color.test.mjs

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

section('Aphotic Wisps: a creature becomes black, gains fear, and you draw a card')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // green 2/2
  const wisps = put(e, 0, 'Aphotic Wisps', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: wisps.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  const handAfterCast = zone(e.state, 'hand', 0).length
  resolveAll(e)
  recompute(e.state)
  assert(bear.chars.colors.length === 1 && bear.chars.colors[0] === 'B', 'the Bears is now black (only)')
  assert(bear.chars.keywords.includes('Fear'), 'it gained fear')
  assert(zone(e.state, 'hand', 0).length === handAfterCast + 1, 'you drew a card')
}

section('Doom Blade cannot target a creature that has been made black')
{
  const e = makeEngine()
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // green
  recompute(e.state)
  const nonblack = { type: 'creature', excludeColor: 'B' }
  assert(e._specMatches(nonblack, bear), 'a green creature is a legal Doom Blade target')
  // Turn it black with a layer-5 effect (as Aphotic Wisps would).
  e.state.continuous.push({ timestamp: 999, targets: [bear.oid], setColors: ['B'], duration: 'eot' })
  recompute(e.state)
  assert(!e._specMatches(nonblack, bear), 'once black it is no longer a legal Doom Blade target')
}

section('Doom Blade is not castable when the only creature is (printed) black')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 1, 'Vampire Nighthawk', 'battlefield', { summoningSick: false }) // black
  const db = put(e, 0, 'Doom Blade', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(!e.pending.actions.some((a) => a.oid === db.oid), 'no legal (nonblack) target -> Doom Blade uncastable')
}

section('The color change wears off at end of turn')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const wisps = put(e, 0, 'Aphotic Wisps', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: wisps.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  resolveAll(e)
  recompute(e.state)
  assert(bear.chars.colors[0] === 'B', 'black during the turn')
  // Advance into the opponent's turn; cleanup of turn 1 removes the EOT effect.
  let g = 0
  while (!(e.state.activePlayer === 1 && e.state.step === 'upkeep') && g++ < 3000) {
    const p = e.pending
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else break
  }
  recompute(e.state)
  assert(bear.chars.colors.includes('G') && !bear.chars.colors.includes('B'), 'back to green next turn')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
