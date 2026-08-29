// Headless verification, batch 14 (usability pass + two small rules):
//   conditional statics ("as long as …"); 724 "end the turn"
//   the projection carries what the inspector needs (rules text, granted keywords,
//   enforcement flag, restrictions, stack targets); cast actions preview payment;
//   activated abilities get readable labels; payments are logged
// Run: node src/shared/engine/cr14.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { projectGame } from './project.mjs'
import { makeEngine, put, advanceToPriorityAt, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

section('Conditional static: "as long as you control a Mountain, this gets +1/+0"')
{
  const e = makeEngine()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  bear.behavior = { ...bear.behavior, static: [{ affects: { self: true }, modifyPT: { power: 1, toughness: 0 }, if: { controls: { subtype: 'Mountain', min: 1 } } }] }
  recompute(e.state)
  assert(bear.chars.power === 2, 'no Mountain: no bonus')
  put(e, 0, 'Mountain', 'battlefield')
  recompute(e.state)
  assert(bear.chars.power === 3, 'with a Mountain: +1/+0')
}

section('724: "end the turn" exiles the stack and skips to cleanup')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const stop = put(e, 1, 'Counterspell', 'hand') // an instant standing in for Time Stop
  stop.behavior = { ...stop.behavior, spell: { effect: [{ op: 'endTurn' }] } }
  refresh(e)
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  e.choose({ type: 'pass' })
  e.choose({ type: 'cast', oid: stop.oid })
  bothPass(e) // "Time Stop" resolves
  assert(inZone(e, 0, 'exile', bolt.oid) && zone(e.state, 'stack').length === 0, 'the Bolt was exiled from the stack, never resolving')
  assert(e.state.players[1].life === 20, 'no damage')
  assert(e.state.turnNumber === 2 && e.state.activePlayer === 1, "the turn ended: it's B's turn")
}

section('The view carries inspector data and payment previews')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Forest', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'hand')
  const delver = put(e, 0, 'Delver of Secrets // Insectile Aberration', 'battlefield')
  const pac = put(e, 1, 'Pacifism', 'battlefield')
  const victim = put(e, 0, 'Serra Angel', 'battlefield')
  pac.status.attachedTo = victim.oid
  e.state.continuous.push({ timestamp: ++e.state.tsCounter, targets: [victim.oid], grantKeywords: ['Haste'], duration: 'eot' })
  advanceToPriorityAt(e, 'main1')
  const v = projectGame(e, 0)
  const bf = v.players[0].battlefield
  const d = bf.find((c) => c.oid === delver.oid)
  assert(d.supported === false && /upkeep/.test(d.oracleText), 'Delver: flagged as not fully enforced, with its rules text')
  const a = bf.find((c) => c.oid === victim.oid)
  assert(a.keywords.includes('Haste') && !a.printedKeywords.includes('Haste') && a.printedKeywords.includes('Flying'), 'granted vs printed keywords are distinguishable')
  assert(a.restrictions.includes('attack') && a.restrictions.includes('block'), "Pacifism: can't attack or block")
  const cast = v.pending.actions.find((x) => x.type === 'cast' && x.oid === bear.oid)
  assert(Array.isArray(cast.pays) && cast.pays.includes('Forest'), 'the cast action previews what auto-payment taps')
  e.choose({ type: 'cast', oid: bear.oid })
  assert(e.state.log.some((l) => /A taps .*Forest/.test(l.text)), 'the payment is logged')
  const st = projectGame(e).stack
  assert(st.length === 1 && Array.isArray(st[0].targetNames), 'stack items carry target names')
}

section('Activated abilities get readable labels when none is authored')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const skel = put(e, 0, 'Drudge Skeletons', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'activate' && a.oid === skel.oid)
  assert(act && /\{B\}: regenerate/.test(act.label), `label reads "${act?.label}"`)
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
