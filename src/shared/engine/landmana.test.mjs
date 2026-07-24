// Headless verification: nonbasic land mana (dual/artifact lands) + enters-tapped.
// Run: node src/shared/engine/landmana.test.mjs

import { parseManaCost } from './cards.mjs'
import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('dual lands produce either color')
{
  const e = makeEngine()
  put(e, 0, 'Drossforge Bridge', 'battlefield') // B or R
  put(e, 0, 'Slagwoods Bridge', 'battlefield') // R or G
  assert(e._canPay(0, parseManaCost('{B}{G}')), 'B from one dual, G from the other')
  assert(e._canPay(0, parseManaCost('{R}{R}')), 'both duals can make R')
  assert(e._canPay(0, parseManaCost('{B}{R}')), 'B + R payable')
  assert(!e._canPay(0, parseManaCost('{B}{B}')), 'only one source can make B')
  assert(!e._canPay(0, parseManaCost('{G}{G}')), 'only one source can make G')
}

section('artifact land taps for its color and counts as an artifact')
{
  const e = makeEngine()
  const vault = put(e, 0, 'Vault of Whispers', 'battlefield') // {T}: B, Artifact Land
  assert(e._canPay(0, parseManaCost('{B}')), 'Vault of Whispers taps for B')
  assert(vault.chars.types.includes('Artifact'), 'artifact land counts as an artifact')
}

section('bridges enter tapped')
{
  const e = makeEngine()
  const bridge = put(e, 0, 'Drossforge Bridge', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'playLand', oid: bridge.oid })
  assert(bridge.status.tapped === true, 'Drossforge Bridge entered tapped')
  assert(!e._canPay(0, parseManaCost('{B}')), 'a tapped land makes no mana this turn')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
