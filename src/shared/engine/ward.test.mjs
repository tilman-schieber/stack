// Headless verification: Ward (rule 702.21). When an opponent's spell or ability
// targets a permanent with ward, that opponent must pay the ward cost or their
// spell/ability is countered. Costs may be mana (Tomakul Honor Guard, ward {2})
// or life (Dwarven Forge-Chanter, ward—pay 2 life).
// Run: node src/shared/engine/ward.test.mjs

import { zone } from './state.mjs'
import { makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Pass priority for both players until a ward-payment decision appears or the
// stack empties. Returns the pending when it's a wardPay, else null.
function runToWard(e) {
  let g = 0
  while (g++ < 60) {
    if (e.pending.kind === 'wardPay') return e.pending
    if (e.pending.kind !== 'priority') return null
    if (zone(e.state, 'stack').length === 0) return null
    e.choose({ type: 'pass' })
  }
  return null
}
function drain(e) {
  let g = 0
  while (e.pending.kind === 'priority' && zone(e.state, 'stack').length > 0 && g++ < 60)
    e.choose({ type: 'pass' })
}

section('Declining the ward cost counters the spell')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const guard = put(e, 1, 'Tomakul Honor Guard', 'battlefield', { summoningSick: false }) // ward {2}
  const doom = put(e, 0, 'Doom Blade', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: doom.oid, targets: [{ kind: 'object', oid: guard.oid }] })
  const w = runToWard(e)
  assert(!!w && w.player === 0, 'the caster (player 0) is asked to pay the ward cost')
  assert(w.mana === '{2}', 'the ward cost is {2}')
  e.choose({ pay: false })
  drain(e)
  assert(doom.zoneName === 'graveyard', 'Doom Blade was countered by ward')
  assert(guard.zoneName === 'battlefield', 'the warded creature survived')
}

section('Paying the ward cost lets the spell resolve')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Swamp', 'battlefield')
  const guard = put(e, 1, 'Tomakul Honor Guard', 'battlefield', { summoningSick: false })
  const doom = put(e, 0, 'Doom Blade', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: doom.oid, targets: [{ kind: 'object', oid: guard.oid }] })
  const w = runToWard(e)
  assert(!!w && w.canPay, 'player 0 has the two extra mana to pay ward')
  e.choose({ pay: true })
  drain(e)
  assert(guard.zoneName === 'graveyard', 'Doom Blade resolved and destroyed the warded creature')
  assert(doom.zoneName === 'graveyard', 'Doom Blade is in the graveyard (resolved)')
}

section("Ward doesn't trigger against the warded creature's own controller")
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const guard = put(e, 0, 'Tomakul Honor Guard', 'battlefield', { summoningSick: false })
  const gg = put(e, 0, 'Giant Growth', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: gg.oid, targets: [{ kind: 'object', oid: guard.oid }] })
  const w = runToWard(e)
  assert(w === null, 'your own spell targeting your warded creature raises no ward')
}

section("Unable to pay the ward cost -> the spell is countered anyway")
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield') // exactly enough for Doom Blade, nothing left for ward
  const guard = put(e, 1, 'Tomakul Honor Guard', 'battlefield', { summoningSick: false })
  const doom = put(e, 0, 'Doom Blade', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: doom.oid, targets: [{ kind: 'object', oid: guard.oid }] })
  const w = runToWard(e)
  assert(!!w && !w.canPay, 'player 0 cannot afford the ward cost')
  e.choose({ pay: true }) // even trying to pay can't help
  drain(e)
  assert(doom.zoneName === 'graveyard' && guard.zoneName === 'battlefield', 'the spell is countered')
}

section('Life-cost ward: paying deducts life; declining counters the spell')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const chanter = put(e, 1, 'Dwarven Forge-Chanter', 'battlefield', { summoningSick: false }) // ward—pay 2 life
  const doom = put(e, 0, 'Doom Blade', 'hand') // Chanter is red (nonblack) -> legal target
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: doom.oid, targets: [{ kind: 'object', oid: chanter.oid }] })
  const w = runToWard(e)
  assert(!!w && w.life === 2, 'the ward cost is 2 life')
  const before = e.state.players[0].life
  e.choose({ pay: true })
  drain(e)
  assert(e.state.players[0].life === before - 2, 'player 0 paid 2 life')
  assert(chanter.zoneName === 'graveyard', 'Doom Blade then resolved (creature destroyed)')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
