// Headless verification: protection from a color — can't be blocked by that
// color, and damage from that color is prevented (White Knight: pro-black).
// Run: node src/shared/engine/protection.test.mjs

import { recompute } from './layers.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('1. a black creature cannot block a creature with protection from black')
{
  const e = makeEngine()
  const knight = put(e, 0, 'White Knight', 'battlefield', { summoningSick: false })
  const blackBlocker = put(e, 1, 'Typhoid Rats', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 50) e.choose({ type: 'pass' })
  e.choose({ attackers: [knight.oid] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 50) e.choose({ type: 'pass' })
  let threw = false
  try {
    e.choose({ blocks: { [blackBlocker.oid]: knight.oid } })
  } catch {
    threw = true
  }
  assert(threw, 'the black creature was not allowed to block')
}

section('2. damage from a black source is prevented')
{
  const e = makeEngine()
  const knight = put(e, 0, 'White Knight', 'battlefield')
  const blackSource = put(e, 0, 'Typhoid Rats', 'battlefield') // colors ['B']
  recompute(e.state)
  assert(knight.chars.protections.includes('B'), 'White Knight has protection from black')
  e._dealDamage(blackSource, { obj: knight }, 2)
  assert(knight.status.damage === 0, 'black damage was prevented')

  // A non-black source still deals damage.
  const white = put(e, 0, 'Serra Angel', 'battlefield') // colors ['W']
  recompute(e.state)
  e._dealDamage(white, { obj: knight }, 1)
  assert(knight.status.damage === 1, 'non-black damage lands normally')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
