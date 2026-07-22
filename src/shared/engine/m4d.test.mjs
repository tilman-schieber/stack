// Headless M4d verification: Auras & Equipment (attachments feeding the layer
// system, and their attachment state-based actions).
// Run: node src/shared/engine/m4d.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const pt = (o) => `${o.chars.power}/${o.chars.toughness}`
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const hasActivate = (e, oid) => e.pending.actions.some((a) => a.type === 'activate' && a.oid === oid)

// --- 1. Aura: Rancor buffs the enchanted creature --------------------------

section('1. Rancor (Aura) — +2/+0 and trample on the enchanted creature')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const rancor = put(e, 0, 'Rancor', 'hand')
  advanceToPriorityAt(e, 'main1')

  e.choose({ type: 'cast', oid: rancor.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e) // Rancor resolves and enters attached
  assert(inZone(e, 0, 'battlefield', rancor.oid), 'Rancor is on the battlefield')
  assert(rancor.status.attachedTo === bear.oid, 'Rancor is attached to the creature')
  recompute(e.state)
  assert(pt(bear) === '4/2', 'enchanted creature is 4/2 (+2/+0)')
  assert(bear.chars.keywords.includes('Trample'), 'enchanted creature has trample')
}

// --- 2. Aura falls off (goes to graveyard) when its creature dies ----------

section('2. Aura SBA — Rancor dies with its creature')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const rancor = put(e, 0, 'Rancor', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: rancor.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)

  bear.status.damage = 2 // lethal for the 4/2
  e._checkSBA()
  assert(inZone(e, 0, 'graveyard', bear.oid), 'the creature died')
  assert(inZone(e, 0, 'graveyard', rancor.oid), 'the unattached Aura went to the graveyard')
}

// --- 3. Equipment: Bonesplitter equips and stays when the creature dies -----

section('3. Bonesplitter (Equipment) — equip, then unattach on death')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield') // to pay Equip {1}
  const splitter = put(e, 0, 'Bonesplitter', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  assert(hasActivate(e, splitter.oid), 'Equip ability is offered (sorcery speed)')

  e.choose({ type: 'activate', oid: splitter.oid, ability: 0, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e) // equip ability resolves
  assert(splitter.status.attachedTo === bear.oid, 'Bonesplitter attached to the creature')
  recompute(e.state)
  assert(pt(bear) === '4/2', 'equipped creature is 4/2 (+2/+0)')

  bear.status.damage = 2
  e._checkSBA()
  assert(inZone(e, 0, 'graveyard', bear.oid), 'the creature died')
  assert(inZone(e, 0, 'battlefield', splitter.oid), 'Equipment stayed on the battlefield')
  assert(splitter.status.attachedTo === null, 'Equipment unattached')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
