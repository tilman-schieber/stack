// Headless verification: casting from the graveyard (flashback) and exile.
// Run: node src/shared/engine/graveyard.test.mjs

import { zone, zoneKey, createObject } from './state.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
// Put a card straight into a graveyard.
function gy(e, pid, name) {
  const o = createObject(e.state, SAMPLE_CARDS[name], pid)
  o.zoneName = 'graveyard'
  e.state.zones[zoneKey('graveyard', pid)].push(o.oid)
  return o
}

section('flashback: cast from the graveyard, then exile')
{
  const e = makeEngine()
  for (let i = 0; i < 5; i++) put(e, 0, 'Mountain', 'battlefield') // {4}{R}
  const fb = gy(e, 0, 'Firebolt')
  advanceToPriorityAt(e, 'main1')
  const acts = e.pending.actions
  assert(acts.some((a) => a.type === 'castFlashback' && a.oid === fb.oid), 'flashback offered from graveyard')

  e.choose({ type: 'castFlashback', oid: fb.oid, targets: [{ kind: 'player', pid: 1 }] })
  assert(zone(e.state, 'stack').includes(fb.oid), 'flashback spell on the stack')
  bothPass(e)
  assert(e.state.players[1].life === 18, 'dealt 2 damage')
  assert(inZone(e, 0, 'exile', fb.oid), 'flashback spell was exiled, not returned to the graveyard')
}

section('flashback: not offered without enough mana')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield') // only {R}, need {4}{R}
  const fb = gy(e, 0, 'Firebolt')
  advanceToPriorityAt(e, 'main1')
  assert(!e.pending.actions.some((a) => a.type === 'castFlashback' && a.oid === fb.oid), 'not castable without {4}{R}')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
