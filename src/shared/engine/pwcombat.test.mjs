// Headless verification: attacking a planeswalker. An attacker can be declared
// against the defending player or one of their planeswalkers; combat damage to a
// planeswalker removes loyalty, and a lethal hit sends it to the graveyard.
// Run: node src/shared/engine/pwcombat.test.mjs

import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Drive combat where the attacker targets a planeswalker (no blocks).
function attackPW(e, attacker, pwOid) {
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 50) e.choose({ type: 'pass' })
  // the decision advertises the available defenders
  const defenders = e.pending.defenders
  e.choose({ attackers: [{ oid: attacker.oid, defender: { planeswalker: pwOid } }] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 50) e.choose({ type: 'pass' })
  e.choose({ blocks: {} })
  g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 50)
    e.choose({ type: 'pass' })
  return defenders
}

section('1. declare-attackers lists the defending player and their planeswalkers')
{
  const e = makeEngine()
  put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const chandra = put(e, 1, 'Chandra Nalaar', 'battlefield')
  chandra.status.counters.loyalty = 6
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 50) e.choose({ type: 'pass' })
  const kinds = e.pending.defenders.map((d) => d.kind)
  assert(kinds.includes('player') && kinds.includes('planeswalker'), 'both the player and the walker are valid targets')
}

section('2. attacking a planeswalker removes loyalty')
{
  const e = makeEngine()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2
  const chandra = put(e, 1, 'Chandra Nalaar', 'battlefield')
  chandra.status.counters.loyalty = 6
  const startLife = e.state.players[1].life
  attackPW(e, bear, chandra.oid)
  assert(chandra.status.counters.loyalty === 4, 'walker lost 2 loyalty (6 -> 4)')
  assert(e.state.players[1].life === startLife, 'the defending player took no damage')
}

section('3. lethal damage sends the planeswalker to the graveyard')
{
  const e = makeEngine()
  const wurm = put(e, 0, 'Craw Wurm', 'battlefield', { summoningSick: false }) // 6/4
  const chandra = put(e, 1, 'Chandra Nalaar', 'battlefield')
  chandra.status.counters.loyalty = 5
  attackPW(e, wurm, chandra.oid)
  assert(inZone(e, 1, 'graveyard', chandra.oid), '6 damage to a 5-loyalty walker kills it')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
