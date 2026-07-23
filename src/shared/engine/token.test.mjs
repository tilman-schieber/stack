// Headless verification: the createToken effect. Tokens appear in play with the
// right characteristics and a token def (used by the renderer to fetch art), and
// they cease to exist when they leave the battlefield.
// Run: node src/shared/engine/token.test.mjs

import { zone } from './state.mjs'
import { projectGame } from './project.mjs'
import { makeEngine, put, inZone, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

section('1. Dragon Fodder makes two 1/1 red Goblin tokens')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const df = put(e, 0, 'Dragon Fodder', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: df.oid })
  bothPass(e) // resolves

  const mine = zone(e.state, 'battlefield')
    .map((oid) => e.state.objects[oid])
    .filter((o) => o.token && o.controller === 0)
  assert(mine.length === 2, 'two tokens were created')
  assert(mine.every((o) => o.chars.power === 1 && o.chars.toughness === 1), 'they are 1/1')
  assert(mine.every((o) => o.chars.types.includes('Creature')), 'they are creatures')
  assert(mine.every((o) => o.status.summoningSick), 'they have summoning sickness')

  const view = projectGame(e)
  const shown = view.players[0].battlefield.filter((c) => c.token)
  assert(shown.length === 2, 'the projection marks them as tokens')
  assert(shown[0].tokenDef?.name === 'Goblin', 'the token def (for art lookup) is carried through')
}

section('2. tokens cease to exist when they leave the battlefield')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const df = put(e, 0, 'Dragon Fodder', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: df.oid })
  bothPass(e)

  const token = zone(e.state, 'battlefield')
    .map((oid) => e.state.objects[oid])
    .find((o) => o.token)
  token.status.damage = 1 // lethal for a 1/1
  e._checkSBA()
  assert(!e.state.objects[token.oid], 'the dead token was removed from the game entirely')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
