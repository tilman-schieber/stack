// Headless M3 verification: the layer system (rule 613) — static continuous
// effects (anthems, lords, keyword granters) and until-end-of-turn pumps.
// Run: node src/shared/engine/m3.test.mjs

import { zone, moveObject } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const pt = (o) => `${o.chars.power}/${o.chars.toughness}`

function passUntilTurn(e, target) {
  let g = 0
  while (e.state.turnNumber < target && g++ < 500) {
    const p = e.pending
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else break
  }
}

// --- 1. Anthem: your creatures get +1/+1, opponents' don't -------------------

section('1. Glorious Anthem (layer 7d)')
{
  const e = makeEngine()
  put(e, 0, 'Glorious Anthem', 'battlefield')
  const mine = put(e, 0, 'Grizzly Bears', 'battlefield')
  const theirs = put(e, 1, 'Grizzly Bears', 'battlefield')
  recompute(e.state)
  assert(pt(mine) === '3/3', 'your 2/2 becomes 3/3')
  assert(pt(theirs) === '2/2', "opponent's creature is unaffected")
}

// --- 2. Two anthems stack additively ----------------------------------------

section('2. Anthems stack')
{
  const e = makeEngine()
  put(e, 0, 'Glorious Anthem', 'battlefield')
  put(e, 0, 'Glorious Anthem', 'battlefield')
  const mine = put(e, 0, 'Grizzly Bears', 'battlefield')
  recompute(e.state)
  assert(pt(mine) === '4/4', 'two anthems give +2/+2')
}

// --- 3. Lord: "other Goblins you control get +1/+1" -------------------------

section('3. Goblin King (subtype + "another")')
{
  const e = makeEngine()
  const king = put(e, 0, 'Goblin King', 'battlefield') // 2/2 Goblin
  const goblin = put(e, 0, 'Raging Goblin', 'battlefield') // 1/1 Goblin
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield') // 2/2 non-Goblin
  recompute(e.state)
  assert(pt(king) === '2/2', 'the lord does not pump itself ("other")')
  assert(pt(goblin) === '2/2', 'another Goblin gets +1/+1')
  assert(pt(bear) === '2/2', 'a non-Goblin is unaffected')
}

// --- 4. Keyword granter (layer 6): Levitation gives flying ------------------

section('4. Levitation grants flying (layer 6)')
{
  const e = makeEngine()
  put(e, 0, 'Levitation', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const ground = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  recompute(e.state)
  assert(bear.chars.keywords.includes('Flying'), 'your creature has flying')

  // A groundling can no longer block it.
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 50) e.choose({ type: 'pass' })
  e.choose({ attackers: [bear.oid] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 50) e.choose({ type: 'pass' })
  let threw = false
  try {
    e.choose({ blocks: { [ground.oid]: bear.oid } })
  } catch {
    threw = true
  }
  assert(threw, 'granted flying makes it unblockable by a groundling')
}

// --- 5. Giant Growth: +3/+3 until end of turn, then wears off ---------------

section('5. Giant Growth (until-EOT floating effect)')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const gg = put(e, 0, 'Giant Growth', 'hand')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: gg.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' }) // resolve
  recompute(e.state)
  assert(pt(bear) === '5/5', 'creature is 5/5 while the pump is active')

  passUntilTurn(e, 2) // through P0's cleanup
  recompute(e.state)
  assert(pt(bear) === '2/2', 'the +3/+3 wore off at end of turn')
}

// --- 6. Removing the anthem re-checks SBAs (layer-dependent death) ----------

section('6. Anthem removal → toughness drops → SBA death')
{
  const e = makeEngine()
  const anthem = put(e, 0, 'Glorious Anthem', 'battlefield')
  // 2/2 that has already taken 2 damage; the anthem keeps it alive at 3/3.
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { damage: 2 })
  e._checkSBA()
  assert(inZone(e, 0, 'battlefield', bear.oid), '3/3 with 2 damage survives while the anthem is out')

  moveObject(e.state, anthem.oid, 'graveyard') // anthem leaves
  e._checkSBA()
  assert(inZone(e, 0, 'graveyard', bear.oid), 'without the anthem the 2/2 with 2 damage dies')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
