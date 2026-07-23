// Headless verification: madness (discard -> exile -> may cast for madness cost)
// driven through an effect-based discard (Faithless Looting).
// Run: node src/shared/engine/madness.test.mjs

import { zone } from './state.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

section('madness: discard Fiery Temper to Faithless Looting, then cast it')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield') // for Faithless Looting {R}
  put(e, 0, 'Mountain', 'battlefield') // for madness {R}
  const looting = put(e, 0, 'Faithless Looting', 'hand')
  const temper = put(e, 0, 'Fiery Temper', 'hand') // madness {R}
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: looting.oid })
  bothPass(e) // resolve Looting: draw 2, then pause for discard
  assert(e.pending.kind === 'discardCards', 'Faithless Looting pauses to discard two')

  const aForest = zone(e.state, 'hand', 0).find((oid) => e.state.objects[oid].printed.name === 'Forest')
  e.choose({ discard: [temper.oid, aForest] })

  assert(e.pending.kind === 'madness', 'discarding a madness card offers a cast')
  assert(e.pending.name === 'Fiery Temper' && e.pending.canPay, 'the madness card is castable for {R}')
  assert(inZone(e, 0, 'exile', temper.oid), 'the madness card was exiled (not put in the graveyard)')

  e.choose({ cast: true, targets: [{ kind: 'player', pid: 1 }] })
  // Faithless Looting finishes and goes to the graveyard; the madness spell is now on the stack.
  bothPass(e) // resolve Fiery Temper
  assert(e.state.players[1].life === 17, 'Fiery Temper dealt 3 via madness')
  assert(inZone(e, 0, 'exile', temper.oid), 'Fiery Temper exiled after resolving (madness)')
  assert(inZone(e, 0, 'graveyard', looting.oid), 'Faithless Looting went to the graveyard')
}

section('madness: decline sends the card to the graveyard')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const looting = put(e, 0, 'Faithless Looting', 'hand')
  const temper = put(e, 0, 'Fiery Temper', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: looting.oid })
  bothPass(e)
  const aForest = zone(e.state, 'hand', 0).find((oid) => e.state.objects[oid].printed.name === 'Forest')
  e.choose({ discard: [temper.oid, aForest] })
  e.choose({ cast: false })
  assert(inZone(e, 0, 'graveyard', temper.oid), 'declined madness card goes to the graveyard')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
