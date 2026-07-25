// Headless verification: Spellstutter Sprite — flash flyer whose ETB counters a
// spell with mana value <= the number of Faeries you control.
// Run: node src/shared/engine/spellstutter.test.mjs

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

// Set up: on player 0's turn, player 1 casts an instant; player 0 flashes in
// Spellstutter Sprite to try to counter it. Returns { e, spell }.
function setup(spellName, extraFaeries = 0) {
  const e = makeEngine()
  put(e, 1, 'Mountain', 'battlefield')
  put(e, 1, 'Mountain', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  for (let i = 0; i < extraFaeries; i++) put(e, 0, 'Faerie Seer', 'battlefield')
  const spell = put(e, 1, spellName, 'hand')
  const sprite = put(e, 0, 'Spellstutter Sprite', 'hand')
  advanceToPriorityAt(e, 'main1') // player 0 has priority
  e.choose({ type: 'pass' }) // -> player 1 gets priority
  return { e, spell, sprite }
}

section('Spellstutter Sprite: counters a spell with MV <= Faeries you control')
{
  const { e, spell, sprite } = setup('Lightning Bolt') // MV 1
  e.choose({ type: 'cast', oid: spell.oid, targets: [{ kind: 'player', pid: 0 }] })
  e.choose({ type: 'pass' }) // player 1 passes -> player 0 has priority, Bolt on stack
  e.choose({ type: 'cast', oid: sprite.oid, targets: [] }) // flash in the Sprite
  bothPass(e) // resolve the Sprite; its ETB trigger asks for a target
  assert(e.pending.kind === 'chooseTargets', 'Sprite ETB asks to choose a spell')
  e.choose({ targets: [{ kind: 'spell', oid: spell.oid }] })
  bothPass(e) // resolve the counter
  assert(inZone(e, 1, 'graveyard', spell.oid), 'the Bolt was countered (1 Faerie >= MV 1)')
  assert(e.state.players[0].life === 20, 'no damage — the Bolt never resolved')
  assert(inZone(e, 0, 'battlefield', sprite.oid), 'Spellstutter Sprite stuck around as a 1/1 flyer')
}

section('Spellstutter Sprite: too few Faeries -> the spell resolves')
{
  const { e, spell, sprite } = setup('Lightning Strike') // MV 2, only 1 Faerie (the Sprite)
  e.choose({ type: 'cast', oid: spell.oid, targets: [{ kind: 'player', pid: 0 }] })
  e.choose({ type: 'pass' })
  e.choose({ type: 'cast', oid: sprite.oid, targets: [] })
  bothPass(e)
  assert(e.pending.kind === 'chooseTargets', 'Sprite ETB still targets the spell')
  e.choose({ targets: [{ kind: 'spell', oid: spell.oid }] })
  resolveAll(e) // counter fizzles (MV 2 > 1 Faerie), then the Strike resolves
  assert(e.state.players[0].life === 17, 'Lightning Strike dealt 3 — it was not countered')
}

section('Spellstutter Sprite: extra Faeries raise the ceiling')
{
  const { e, spell, sprite } = setup('Lightning Strike', 2) // MV 2, 1 Sprite + 2 Faerie Seers = 3
  e.choose({ type: 'cast', oid: spell.oid, targets: [{ kind: 'player', pid: 0 }] })
  e.choose({ type: 'pass' })
  e.choose({ type: 'cast', oid: sprite.oid, targets: [] })
  bothPass(e)
  e.choose({ targets: [{ kind: 'spell', oid: spell.oid }] })
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', spell.oid), 'countered (3 Faeries >= MV 2)')
  assert(e.state.players[0].life === 20, 'no damage taken')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
