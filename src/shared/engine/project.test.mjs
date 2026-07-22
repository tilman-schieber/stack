// Smoke test: build engine state from real Scryfall-shaped objects (with ids),
// project to a view, and exercise a couple of the new spells.
// Run: node src/shared/engine/project.test.mjs

import { GameEngine } from './engine.mjs'
import { projectGame } from './project.mjs'
import { zone } from './state.mjs'
import { advanceToPriorityAt, makeAsserter, keepAll } from './_testutil.mjs'

const { assert, stats } = makeAsserter()

// Minimal Scryfall-shaped cards with print ids (as real decks provide).
const MOUNTAIN = { id: 'sf-mtn', name: 'Mountain', mana_cost: '', type_line: 'Basic Land — Mountain', colors: [] }
const SHOCK = { id: 'sf-shock', name: 'Shock', mana_cost: '{R}', type_line: 'Instant', colors: ['R'] }
const BEARS = { id: 'sf-bears', name: 'Grizzly Bears', mana_cost: '{1}{G}', type_line: 'Creature — Bear', power: '2', toughness: '2', colors: ['G'] }

function make() {
  const deckA = [...Array(10).fill(MOUNTAIN), SHOCK, SHOCK, SHOCK, SHOCK, SHOCK, SHOCK, SHOCK]
  const deckB = [...Array(10).fill(MOUNTAIN), BEARS, BEARS, BEARS, BEARS, BEARS, BEARS, BEARS]
  return keepAll(new GameEngine({ seed: 'proj', players: [{ name: 'A', deck: deckA }, { name: 'B', deck: deckB }] }).start())
}

console.log('\nprojection + real-card path')
{
  const e = make()
  const v = projectGame(e)
  assert(v.players.length === 2, 'two players in the view')
  assert(v.players[0].hand.every((c) => c.cardId), 'hand cards carry a Scryfall id for images')
  assert(v.players[0].hand.some((c) => c.name === 'Mountain' || c.name === 'Shock'), 'hand shows real card names')
  assert(typeof v.step === 'string' && v.priorityPlayer === 0, 'view reports step and priority')
}

console.log('\nShock kills a Grizzly Bears via SBA (real objects)')
{
  const e = make()
  // Put a Mountain and a Shock in p0's hand, a Grizzly Bears on p1's battlefield.
  const { createObject, zoneKey } = await import('./state.mjs')
  const mtn = createObject(e.state, MOUNTAIN, 0); mtn.zoneName = 'battlefield'; mtn.controller = 0
  e.state.zones['battlefield'].push(mtn.oid)
  const shock = createObject(e.state, SHOCK, 0); shock.zoneName = 'hand'
  e.state.zones[zoneKey('hand', 0)].push(shock.oid)
  const bear = createObject(e.state, BEARS, 1); bear.zoneName = 'battlefield'; bear.controller = 1
  e.state.zones['battlefield'].push(bear.oid)

  advanceToPriorityAt(e, 'main1')
  const cast = e.pending.actions.find((a) => a.type === 'cast' && a.oid === shock.oid)
  assert(cast && cast.targets[0].type === 'any', 'Shock castable and exposes its target spec')
  e.choose({ type: 'cast', oid: shock.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  // resolve
  e.choose({ type: 'pass' }); if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
  assert(zone(e.state, 'graveyard', 1).includes(bear.oid), 'Shock (2 dmg) killed the 2/2')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
