// Headless verification for additional mechanics (Pauper staples). Grows as new
// mechanics land. Run: node src/shared/engine/mechanics.test.mjs

import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const resolve = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

// --- Indestructible ---------------------------------------------------------

section('indestructible: survives lethal damage')
{
  const e = makeEngine()
  const myr = put(e, 0, 'Darksteel Myr', 'battlefield') // 0/1 indestructible
  myr.status.damage = 5
  e._checkSBA()
  assert(inZone(e, 0, 'battlefield', myr.oid), '0/1 with 5 damage survives (indestructible)')
}

section('indestructible: survives Doom Blade (destroy)')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const db = put(e, 0, 'Doom Blade', 'hand')
  const myr = put(e, 1, 'Darksteel Myr', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: db.oid, targets: [{ kind: 'object', oid: myr.oid }] })
  resolve(e)
  assert(inZone(e, 1, 'battlefield', myr.oid), '"destroy" does not kill an indestructible creature')
}

section('indestructible: 0 toughness still dies')
{
  const e = makeEngine()
  const myr = put(e, 0, 'Darksteel Myr', 'battlefield', { counters: { '-1/-1': 1 } }) // 0/1 -> -1/0
  e._checkSBA()
  assert(inZone(e, 0, 'graveyard', myr.oid), '0 toughness is not saved by indestructible')
}

section('defender: cannot attack')
{
  const e = makeEngine()
  // Give a creature Defender by piggybacking on Giant Spider and forcing the kw.
  const wall = put(e, 0, 'Giant Spider', 'battlefield', { summoningSick: false })
  wall.printed.keywords = ['Defender']
  advanceToPriorityAt(e, 'main1')
  let g = 0
  // Advance toward combat; with only a defender, no attackers are eligible so the
  // engine skips straight past the declare-attackers decision.
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 50) e.choose({ type: 'pass' })
  assert(e.state.step === 'main2' || e.pending.kind !== 'declareAttackers', 'a defender is not offered as an attacker')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
