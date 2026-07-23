// Headless verification for additional mechanics (Pauper staples). Grows as new
// mechanics land. Run: node src/shared/engine/mechanics.test.mjs

import { zone } from './state.mjs'
import { inZone, makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const resolve = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

// --- Indestructible ---------------------------------------------------------

section('indestructible: survives lethal damage')
{
  const e = makeEngine()
  const myr = put(e, 0, 'Darksteel Myr', 'battlefield') // 0/1 indestructible
  myr.status.damage = 5
  e._checkSBA()
  assert(inZone(e, 0, 'battlefield', myr.oid), '0/1 with 5 damage survives (indestructible)')
}

section('indestructible: survives Doom Blade (destroy)')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const db = put(e, 0, 'Doom Blade', 'hand')
  const myr = put(e, 1, 'Darksteel Myr', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: db.oid, targets: [{ kind: 'object', oid: myr.oid }] })
  resolve(e)
  assert(inZone(e, 1, 'battlefield', myr.oid), '"destroy" does not kill an indestructible creature')
}

section('indestructible: 0 toughness still dies')
{
  const e = makeEngine()
  const myr = put(e, 0, 'Darksteel Myr', 'battlefield', { counters: { '-1/-1': 1 } }) // 0/1 -> -1/0
  e._checkSBA()
  assert(inZone(e, 0, 'graveyard', myr.oid), '0 toughness is not saved by indestructible')
}

section('defender: cannot attack')
{
  const e = makeEngine()
  // Give a creature Defender by piggybacking on Giant Spider and forcing the kw.
  const wall = put(e, 0, 'Giant Spider', 'battlefield', { summoningSick: false })
  wall.printed.keywords = ['Defender']
  advanceToPriorityAt(e, 'main1')
  let g = 0
  // Advance toward combat; with only a defender, no attackers are eligible so the
  // engine skips straight past the declare-attackers decision.
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 50) e.choose({ type: 'pass' })
  assert(e.state.step === 'main2' || e.pending.kind !== 'declareAttackers', 'a defender is not offered as an attacker')
}

// --- Flash ------------------------------------------------------------------

section('flash: a creature can be cast at instant speed')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const viper = put(e, 0, 'Ambush Viper', 'hand') // Flash
  const bears = put(e, 0, 'Grizzly Bears', 'hand') // no flash
  // Begin-combat is not a main phase, so sorcery-speed casts aren't legal there.
  advanceToPriorityAt(e, 'beginCombat')
  const acts = e.pending.actions
  assert(acts.some((a) => a.type === 'cast' && a.oid === viper.oid), 'flash creature castable outside a main phase')
  assert(!acts.some((a) => a.type === 'cast' && a.oid === bears.oid), 'non-flash creature NOT castable outside a main phase')
}

// --- Scry (Preordain) -------------------------------------------------------

section('scry: Preordain — pause to scry 2, then draw')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  const pre = put(e, 0, 'Preordain', 'hand')
  advanceToPriorityAt(e, 'main1')

  const libTop = zone(e.state, 'library', 0).slice(0, 2)
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cast', oid: pre.oid })
  // resolving pauses on the scry
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  assert(e.pending.kind === 'scry', 'resolution paused for a scry decision')
  assert(e.pending.cards.length === 2, 'looking at the top 2 cards')

  // Put the first on the bottom, keep the second on top.
  e.choose({ toBottom: [libTop[0]], toTop: [libTop[1]] })

  // After scry, Preordain draws a card.
  assert(zone(e.state, 'hand', 0).length === handBefore, 'net hand unchanged (cast -1, draw +1)')
  assert(zone(e.state, 'hand', 0).includes(libTop[1]), 'drew the card kept on top')
  assert(zone(e.state, 'library', 0).slice(-1)[0] === libTop[0], 'the bottomed card is on the bottom')
  assert(inZone(e, 0, 'graveyard', pre.oid), 'Preordain went to the graveyard')
}

// --- Prowess ----------------------------------------------------------------

section('prowess: +1/+1 until EOT when you cast a noncreature spell')
{
  const e = makeEngine()
  const swift = put(e, 0, 'Monastery Swiftspear', 'battlefield', { summoningSick: false }) // 1/2
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  // prowess trigger goes on the stack above the bolt; resolve both
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  const { recompute } = await import('./layers.mjs')
  recompute(e.state)
  assert(`${swift.chars.power}/${swift.chars.toughness}` === '2/3', 'Swiftspear is 2/3 after a noncreature spell')
}

section('prowess: does NOT trigger on a creature spell')
{
  const e = makeEngine()
  const swift = put(e, 0, 'Monastery Swiftspear', 'battlefield', { summoningSick: false })
  put(e, 0, 'Forest', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bears.oid })
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  const { recompute: rc } = await import('./layers.mjs')
  rc(e.state)
  assert(`${swift.chars.power}/${swift.chars.toughness}` === '1/2', 'no prowess bump from a creature spell')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
