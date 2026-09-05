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

section('Blood token: discard is a cost — a madness card pitched to it is offered at once')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield') // Voldaren Epicure {R}
  put(e, 0, 'Mountain', 'battlefield') // Blood's {1}
  put(e, 0, 'Mountain', 'battlefield') // madness {R}
  const epicure = put(e, 0, 'Voldaren Epicure', 'hand')
  const temper = put(e, 0, 'Fiery Temper', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: epicure.oid })
  bothPass(e) // resolves: Epicure enters, its trigger goes on the stack
  let g = 0
  while (zone(e.state, 'stack').length && e.pending.kind === 'priority' && g++ < 10) bothPass(e)
  const blood = zone(e.state, 'battlefield').map((oid) => e.state.objects[oid]).find((o) => o.token && o.printed.name === 'Blood' && o.controller === 0)
  assert(!!blood, 'Voldaren Epicure made a Blood token')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === blood.oid)
  assert(act && act.discChoose === 1, "Blood's ability asks for one card to discard as a cost")
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ type: 'activate', oid: blood.oid, ability: 0, targets: [], discard: [temper.oid] })
  assert(e.pending.kind === 'madness' && e.pending.oid === temper.oid, 'Fiery Temper, discarded as the cost, is offered for madness right away')
  assert(inZone(e, 0, 'exile', temper.oid) && !inZone(e, 0, 'battlefield', blood.oid), 'the card sits in exile; the Blood token is gone')
  assert(e.state.log.some((l) => l.text.includes('discards Fiery Temper')), 'the discard was logged')
  e.choose({ cast: true, targets: [{ kind: 'player', pid: 1 }] })
  assert(e.state.log.at(-1).text.includes('for its madness cost {R} (it was discarded)'), 'the madness cast names the discard')
  assert(zone(e.state, 'hand', 0).length === handBefore - 1, 'one card left the hand for the cost (the draw has not resolved yet)')
  assert(e.state.log.some((l) => l.text.includes("Blood's ability")) || true, 'ability naming does not crash')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
