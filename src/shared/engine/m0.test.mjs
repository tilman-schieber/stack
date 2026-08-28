// Headless M0 verification. Deterministic (seeded RNG), no React/Electron.
// Run: node src/shared/engine/m0.test.mjs
//
// Covers the plan's five M0 scenarios: cast a vanilla creature; Lightning Bolt
// kills a creature via SBA; a full turn cycle with priority + hand-size discard;
// combat with a block and death by SBA; illegal actions are not offered.

import { GameEngine } from './engine.mjs'
import { createObject, zone, zoneKey } from './state.mjs'
import { SAMPLE_CARDS } from './cards.mjs'

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) {
    passed++
  } else {
    failed++
    console.error('  ✗ ' + msg)
  }
}
function section(name) {
  console.log('\n' + name)
}

// --- helpers ----------------------------------------------------------------

function makeEngine() {
  // Libraries just need enough cards to draw an opening hand.
  const deck = Array(12).fill('Forest')
  const e = new GameEngine({
    seed: 'm0', startingPlayer: 0,
    players: [{ name: 'A', deck }, { name: 'B', deck }]
  }).start()
  // Keep both opening hands (resolve the mulligan phase).
  while (e.pending.kind === 'mulligan' || e.pending.kind === 'bottom') {
    if (e.pending.kind === 'mulligan') e.choose({ keep: true })
    else e.choose({ bottom: e.pending.hand.slice(0, e.pending.count) })
  }
  return e
}

// Place a fresh card object directly into a zone (bypasses draw/shuffle so
// scenarios are deterministic).
function put(engine, pid, name, zoneName, status = {}) {
  const o = createObject(engine.state, SAMPLE_CARDS[name], pid)
  o.zoneName = zoneName
  if (zoneName === 'battlefield') o.controller = pid
  Object.assign(o.status, status)
  engine.state.zones[zoneKey(zoneName, pid)].push(o.oid)
  return o
}

const byName = (engine, pid, zoneName, name) =>
  zone(engine.state, zoneName, pid)
    .map((oid) => engine.state.objects[oid])
    .find((o) => o.printed.name === name)

// Pass priority (from both players) until the active player holds priority at a
// given step. Only ever passes; never resolves anything unexpected.
function advanceToPriorityAt(engine, step) {
  let guard = 0
  while (guard++ < 500) {
    const p = engine.pending
    if (p.kind === 'priority' && engine.state.step === step && p.player === engine.state.activePlayer)
      return
    if (p.kind === 'priority') engine.choose({ type: 'pass' })
    else throw new Error(`unexpected decision ${p.kind} at step ${engine.state.step}`)
  }
  throw new Error('advanceToPriorityAt did not reach ' + step)
}

// Both players pass in succession — resolves the top of the stack (or ends step).
function passOnce(engine) {
  engine.choose({ type: 'pass' })
  if (engine.pending.kind === 'priority') engine.choose({ type: 'pass' })
}

// --- 1. play a land, tap for mana, cast a vanilla creature ------------------

section('1. cast a vanilla creature')
{
  const e = makeEngine()
  const forest = put(e, 0, 'Forest', 'battlefield') // one land already down
  const forestHand = put(e, 0, 'Forest', 'hand')
  const bears = put(e, 0, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')

  const acts = e.pending.actions
  assert(acts.some((a) => a.type === 'playLand' && a.oid === forestHand.oid), 'play-land offered')
  e.choose({ type: 'playLand', oid: forestHand.oid })

  const acts2 = e.pending.actions
  assert(acts2.some((a) => a.type === 'cast' && a.oid === bears.oid), 'cast creature offered (2 lands)')
  e.choose({ type: 'cast', oid: bears.oid })
  assert(zone(e.state, 'stack').includes(bears.oid), 'creature is on the stack')

  passOnce(e) // resolve it
  assert(bears.zoneName === 'battlefield', 'creature resolved onto battlefield')
  assert(bears.chars.power === 2 && bears.chars.toughness === 2, 'creature is 2/2')
  assert(bears.status.summoningSick === true, 'creature has summoning sickness')
  const tapped = zone(e.state, 'battlefield', 0)
    .map((o) => e.state.objects[o])
    .filter((o) => o.printed.types.includes('Land') && o.status.tapped)
  assert(tapped.length === 2, 'two lands tapped to pay {1}{G}')
  forest // referenced
}

// --- 2. Lightning Bolt kills a creature via SBA -----------------------------

section('2. Lightning Bolt kills a creature')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const target = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'object', oid: target.oid }] })
  assert(zone(e.state, 'stack').includes(bolt.oid), 'bolt on the stack')
  passOnce(e)

  assert(zone(e.state, 'graveyard', 1).includes(target.oid), 'creature died to the graveyard')
  assert(zone(e.state, 'graveyard', 0).includes(bolt.oid), 'bolt went to its graveyard')
}

// --- 3. full turn cycle with priority + hand-size discard -------------------

section('3. full turn + discard to hand size')
{
  const e = makeEngine()
  // Opening hand is 7; add two so cleanup must discard down to 7.
  put(e, 0, 'Forest', 'hand')
  put(e, 0, 'Forest', 'hand')
  assert(zone(e.state, 'hand', 0).length === 9, 'hand starts at 9')

  const startActive = e.state.activePlayer
  let guard = 0
  while (guard++ < 500) {
    const p = e.pending
    if (e.state.activePlayer !== startActive) break
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else throw new Error('unexpected ' + p.kind)
  }
  assert(zone(e.state, 'hand', 0).length === 7, 'discarded down to 7')
  assert(e.state.activePlayer === 1, 'turn passed to player 2')
}

// --- 4. combat: block and mutual death via SBA ------------------------------

section('4. combat with a block and death')
{
  const e = makeEngine()
  const attacker = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const blocker = put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')

  // Move to the declare-attackers decision.
  let guard = 0
  while (e.pending.kind !== 'declareAttackers' && guard++ < 50) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'declareAttackers', 'reached declare attackers')
  assert(e.pending.eligible.includes(attacker.oid), 'attacker is eligible')
  e.choose({ attackers: [attacker.oid] })
  assert(attacker.status.tapped === true, 'attacker tapped (no vigilance)')

  // pass priority to reach declare blockers
  guard = 0
  while (e.pending.kind !== 'declareBlockers' && guard++ < 50) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'declareBlockers', 'reached declare blockers')
  e.choose({ blocks: { [blocker.oid]: attacker.oid } })

  // pass priority so combat damage is dealt and SBA runs
  guard = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && guard++ < 50)
    e.choose({ type: 'pass' })

  assert(zone(e.state, 'graveyard', 0).includes(attacker.oid), 'attacker died via SBA')
  assert(zone(e.state, 'graveyard', 1).includes(blocker.oid), 'blocker died via SBA')
}

// --- 5. illegal actions are not offered -------------------------------------

section('5. illegal actions are gated')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'hand')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')

  // Put Lightning Bolt on the stack; now the stack is non-empty.
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  const acts = e.pending.actions
  assert(
    !acts.some((a) => a.type === 'cast' && a.oid === bears.oid),
    'sorcery-speed creature NOT castable with a non-empty stack'
  )
  assert(
    !acts.some((a) => a.type === 'playLand'),
    'land NOT playable with a non-empty stack'
  )
  // Let the bolt resolve; player 2 should be at 17.
  passOnce(e)
  assert(e.state.players[1].life === 17, 'bolt dealt 3 to player 2')
}

// --- report -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
