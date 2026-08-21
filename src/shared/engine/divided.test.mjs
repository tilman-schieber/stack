// Headless verification: divided / variable-count targeting (rule 601.2c-d) via
// Forked Bolt — "2 damage divided as you choose among one or two targets." The
// engine supports a variadic target slot ({ min, max, divide }); the division is
// validated (each target gets >=1, they sum to the total) before any cost is paid.
// Run: node src/shared/engine/divided.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('Two targets: the 2 damage splits 1 and 1 (default even division)')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const a = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const b = put(e, 1, 'Vampire Nighthawk', 'battlefield', { summoningSick: false })
  const fb = put(e, 0, 'Forked Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({
    type: 'cast',
    oid: fb.oid,
    targets: [{ kind: 'object', oid: a.oid }, { kind: 'object', oid: b.oid }]
  })
  resolveStack(e)
  assert(a.status.damage === 1 && b.status.damage === 1, 'each creature took 1 damage')
}

section('One target: all 2 damage goes to it (kills a 2/2)')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const a = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const fb = put(e, 0, 'Forked Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: fb.oid, targets: [{ kind: 'object', oid: a.oid }] })
  resolveStack(e)
  assert(a.zoneName === 'graveyard', 'the single target took 2 and died')
}

section('An explicit uneven division to a creature and a player is honored')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const a = put(e, 1, 'Vampire Nighthawk', 'battlefield', { summoningSick: false }) // 2/3
  const fb = put(e, 0, 'Forked Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({
    type: 'cast',
    oid: fb.oid,
    targets: [{ kind: 'object', oid: a.oid }, { kind: 'player', pid: 1 }],
    division: [1, 1]
  })
  resolveStack(e)
  assert(a.status.damage === 1, 'the creature took 1')
  assert(e.state.players[1].life === 19, 'the player took 1')
}

section('Illegal divisions and counts are rejected before mana is paid')
{
  const e = makeEngine()
  const mtn = put(e, 0, 'Mountain', 'battlefield')
  const a = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const b = put(e, 1, 'Vampire Nighthawk', 'battlefield', { summoningSick: false })
  const c = put(e, 1, 'Typhoid Rats', 'battlefield', { summoningSick: false })
  const fb = put(e, 0, 'Forked Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  const tryCast = (targets, division) => {
    try {
      e.choose({ type: 'cast', oid: fb.oid, targets, division })
      return false
    } catch {
      return true
    }
  }
  assert(tryCast([{ kind: 'object', oid: a.oid }], [1]), 'a division summing to 1 (not 2) is rejected')
  assert(tryCast([{ kind: 'object', oid: a.oid }, { kind: 'object', oid: b.oid }], [2, 0]), '0 to a target is rejected')
  assert(
    tryCast(
      [{ kind: 'object', oid: a.oid }, { kind: 'object', oid: b.oid }, { kind: 'object', oid: c.oid }],
      [1, 1, 1]
    ),
    'three targets (over the max of two) is rejected'
  )
  assert(!mtn.status.tapped, 'no mana was spent on the rejected casts')
  // A legal cast still works afterwards.
  e.choose({ type: 'cast', oid: fb.oid, targets: [{ kind: 'object', oid: a.oid }], division: [2] })
  assert(zone(e.state, 'stack').length === 1, 'the legal cast went on the stack')
}

section('It fizzles only if ALL targets are gone; a surviving target still gets its share')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const a = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const b = put(e, 1, 'Vampire Nighthawk', 'battlefield', { summoningSick: false })
  const fb = put(e, 0, 'Forked Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({
    type: 'cast',
    oid: fb.oid,
    targets: [{ kind: 'object', oid: a.oid }, { kind: 'object', oid: b.oid }],
    division: [1, 1]
  })
  // One target leaves before resolution.
  const bf = zone(e.state, 'battlefield')
  bf.splice(bf.indexOf(a.oid), 1)
  a.zoneName = 'exile'
  resolveStack(e)
  assert(b.status.damage === 1, 'the surviving target still took its 1 damage')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
