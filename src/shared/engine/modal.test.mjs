// Headless verification: modal spells (rule 700.2), via the sample-deck cards
// Abrade ("Choose one —") and Cryptic Command ("Choose two —"). The chosen modes
// are flattened into one effect + targets list, so resolution is like any spell.
// Run: node src/shared/engine/modal.test.mjs

import { zone } from './state.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

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

section('Abrade, mode 1: deals 3 damage to target creature')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // 2/2
  const abrade = put(e, 0, 'Abrade', 'hand')
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.oid === abrade.oid)
  assert(act?.modal?.count === 1, 'Abrade is offered as a choose-one modal spell')
  assert(act.modes.length === 2, 'it exposes both modes')
  e.choose({ type: 'cast', oid: abrade.oid, modes: [0], modeTargets: [[{ kind: 'object', oid: bear.oid }]] })
  resolveAll(e)
  assert(inZone(e, 1, 'graveyard', bear.oid), 'the 2/2 took 3 and died')
}

section('Abrade, mode 2: destroy target artifact')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const eq = put(e, 1, 'Bonesplitter', 'battlefield') // an artifact (Equipment)
  const abrade = put(e, 0, 'Abrade', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: abrade.oid, modes: [1], modeTargets: [[{ kind: 'object', oid: eq.oid }]] })
  resolveAll(e)
  assert(inZone(e, 1, 'graveyard', eq.oid), 'the artifact was destroyed')
}

section('Modal legality: castable if any one mode has a legal target')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const abrade = put(e, 0, 'Abrade', 'hand')
  advanceToPriorityAt(e, 'main1')
  // No creatures and no artifacts anywhere -> neither mode has a target -> not castable.
  assert(!e.pending.actions.some((a) => a.oid === abrade.oid), 'Abrade is not castable with no legal mode')

  // Fresh scenario with a creature present from the start: the damage mode now
  // has a target, so the spell is castable.
  const e2 = makeEngine()
  put(e2, 0, 'Mountain', 'battlefield')
  put(e2, 0, 'Mountain', 'battlefield')
  put(e2, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const abrade2 = put(e2, 0, 'Abrade', 'hand')
  advanceToPriorityAt(e2, 'main1')
  const act = e2.pending.actions.find((a) => a.oid === abrade2.oid)
  assert(!!act, 'with a creature present Abrade becomes castable')
  assert(act.modes[0].castable && !act.modes[1].castable, 'only the damage mode reports a legal target')
}

section('Cryptic Command, choose two: tap all opponents’ creatures + draw a card')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Island', 'battlefield')
  const a = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const b = put(e, 1, 'Serra Angel', 'battlefield', { summoningSick: false })
  const mine = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const cc = put(e, 0, 'Cryptic Command', 'hand')
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((x) => x.oid === cc.oid)
  assert(act?.modal?.count === 2, 'Cryptic is a choose-two modal spell')
  const handBefore = zone(e.state, 'hand', 0).length - 1 // minus the Cryptic we cast
  e.choose({ type: 'cast', oid: cc.oid, modes: [2, 3], modeTargets: [[], []] })
  resolveAll(e)
  assert(a.status.tapped && b.status.tapped, "both of the opponent's creatures are tapped")
  assert(mine.status.tapped === false, 'your own creature is not tapped')
  assert(zone(e.state, 'hand', 0).length === handBefore + 1, 'you drew a card')
}

section('Cryptic Command: counter a spell + bounce a creature (per-mode targets, offset refs)')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Island', 'battlefield')
  put(e, 1, 'Mountain', 'battlefield')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  const cc = put(e, 0, 'Cryptic Command', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'pass' }) // pass priority to the opponent
  // Opponent casts Lightning Bolt at you; it goes on the stack. The caster keeps
  // priority, so they pass it to you.
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 0 }] })
  e.choose({ type: 'pass' })
  // You respond with Cryptic: counter the Bolt (mode 0) and bounce the bear (mode 1).
  const act = e.pending.actions.find((x) => x.oid === cc.oid)
  assert(!!act, 'you can cast Cryptic in response')
  e.choose({
    type: 'cast',
    oid: cc.oid,
    modes: [0, 1],
    modeTargets: [[{ kind: 'spell', oid: bolt.oid }], [{ kind: 'object', oid: bear.oid }]]
  })
  resolveAll(e)
  assert(inZone(e, 1, 'graveyard', bolt.oid), 'the Bolt was countered (mode 0 targeted the spell)')
  assert(inZone(e, 1, 'hand', bear.oid), "the bear was bounced (mode 1's target0 was offset to target1)")
  assert(e.state.players[0].life === 20, 'the countered Bolt dealt no damage')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
