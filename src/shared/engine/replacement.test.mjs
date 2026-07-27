// Headless verification: the general replacement-effect system (rule 614/616),
// exercised by the sample-deck showcase cards Furnace of Rath (damage doubling),
// Rhox Faithmender (life-gain doubling), and Samite Healer (a prevention shield).
// Run: node src/shared/engine/replacement.test.mjs

import { zone } from './state.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, combat, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const resolveAll = (e) => {
  let g = 0
  while (zone(e.state, 'stack').length > 0 && e.pending.kind === 'priority' && g++ < 40) bothPass(e)
}

section('Furnace of Rath: doubles noncombat (burn) damage')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Furnace of Rath', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 14, 'Lightning Bolt dealt 6 (3 doubled)')
}

section('Furnace of Rath: doubles combat damage')
{
  const e = makeEngine()
  put(e, 0, 'Furnace of Rath', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2
  combat(e, [bear.oid])
  assert(e.state.players[1].life === 16, 'the 2/2 dealt 4 combat damage (2 doubled)')
}

section('Rhox Faithmender: doubles life you gain (here, Soul Warden’s trigger)')
{
  const e = makeEngine()
  put(e, 0, 'Rhox Faithmender', 'battlefield')
  put(e, 0, 'Soul Warden', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')
  const before = e.state.players[0].life
  e.choose({ type: 'cast', oid: bear.oid }) // ETB -> Soul Warden gains 1 -> Rhox doubles to 2
  resolveAll(e)
  assert(e.state.players[0].life === before + 2, 'gained 2 (Soul Warden’s 1, doubled)')
}

section('Samite Healer: prevents the next 1 damage to the chosen target, then is spent')
{
  const e = makeEngine()
  const healer = put(e, 0, 'Samite Healer', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === healer.oid)
  assert(!!act, 'Samite Healer offers its {T} prevention ability')
  e.choose({ type: 'activate', oid: healer.oid, ability: act.ability, targets: [{ kind: 'player', pid: 0 }] })
  resolveAll(e)
  assert(e.state.replacements.length === 1, 'a 1-damage shield is now active')
  e._dealDamage(null, { player: 0 }, 3) // three damage at the protected player
  assert(e.state.players[0].life === 18, 'prevented 1 of the 3 damage (took 2)')
  assert(e.state.replacements.length === 0, 'the 1-damage shield was used up')
}

section('Replacements stack: Furnace doubles, then a shield prevents 1 of the result')
{
  const e = makeEngine()
  put(e, 0, 'Furnace of Rath', 'battlefield')
  const healer = put(e, 0, 'Samite Healer', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === healer.oid)
  e.choose({ type: 'activate', oid: healer.oid, ability: act.ability, targets: [{ kind: 'player', pid: 0 }] })
  resolveAll(e)
  e._dealDamage(null, { player: 0 }, 3) // 3 -> doubled to 6 -> shield prevents 1 -> 5
  assert(e.state.players[0].life === 15, 'doubled to 6, shield prevented 1, took 5')
}

section('Furnace of Rath is symmetric: it doubles damage dealt to its controller too')
{
  const e = makeEngine()
  put(e, 1, 'Mountain', 'battlefield')
  put(e, 0, 'Furnace of Rath', 'battlefield') // player 0 controls it
  const bolt = put(e, 1, 'Lightning Bolt', 'hand') // player 1's burn at player 0
  // Hand player 1 priority on player 0's turn to cast the instant.
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'pass' }) // -> player 1 has priority
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 0 }] })
  resolveAll(e)
  assert(e.state.players[0].life === 14, 'the Furnace controller also takes doubled damage (6)')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
