// Headless verification that a card usable from a pile can actually be reached.
//
// The actions here are the shapes src/shared/engine/engine-legal.mjs produces.
// Run: node src/renderer/src/lib/zoneActions.test.mjs
import { zoneCardAction, readyCount } from './zoneActions.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const found = (actions, zone, oid) => !!zoneCardAction(actions, zone, oid)

section('An ability a card only has in the graveyard')
{
  // Cauldron Familiar: "Sacrifice a Food: Return this card from your graveyard
  // to the battlefield." An activated ability, not a way of casting the card —
  // which is exactly why listing only the cast-like actions left it unclickable.
  const cat = { type: 'activate', oid: 'cat', ability: 0, fromGraveyard: true, label: 'Sacrifice a Food: return this card from your graveyard to the battlefield' }
  assert(found([cat], 'graveyard', 'cat'), 'the graveyard ability is offered')
  assert(zoneCardAction([cat], 'graveyard', 'cat').label === cat.label, 'and it carries its own wording')
  // An ordinary activated ability of a permanent must not leak into the pile.
  const onBoard = { type: 'activate', oid: 'guy', ability: 0 }
  assert(!found([onBoard], 'graveyard', 'guy'), 'an ability of a permanent on the battlefield does not')
}

section('The other ways a card is used from a pile')
{
  for (const type of ['castFlashback', 'castEscape', 'castDisturb', 'unearth', 'embalm'])
    assert(found([{ type, oid: 'x' }], 'graveyard', 'x'), type)
  assert(found([{ type: 'castPlotted', oid: 'x' }], 'exile', 'x'), 'a plotted card in exile')
  assert(found([{ type: 'cast', oid: 'x', fromExile: true }], 'exile', 'x'), 'a foretold card in exile')
  assert(found([{ type: 'playLand', oid: 'x', fromExile: true }], 'exile', 'x'), 'a land played from exile')
  assert(found([{ type: 'cast', oid: 'x' }], 'command', 'x'), 'a commander in the command zone')
}

section('And what must not be offered')
{
  assert(!found([{ type: 'cast', oid: 'x' }], 'graveyard', 'x'), 'a plain cast is from hand, not the graveyard')
  assert(!found([{ type: 'pass' }], 'graveyard', 'x'), 'passing is not a card action')
  assert(!found([{ type: 'castFlashback', oid: 'other' }], 'graveyard', 'x'), 'an action for a different card')
  assert(!found([], 'graveyard', 'x'), 'no actions at all')
  assert(!found(null, 'graveyard', 'x'), 'no action list at all')
  assert(!found([{ type: 'castFlashback', oid: 'x' }], 'graveyard', null), 'no card')
  assert(zoneCardAction([{ type: 'castFlashback', oid: 'x' }], 'graveyard', 'x') !== undefined, 'always returns null or an action, never undefined')
}

section('What the pile badge counts')
{
  const cards = [{ oid: 'a' }, { oid: 'b' }, { oid: 'c' }]
  const actions = [
    { type: 'castFlashback', oid: 'a' },
    { type: 'activate', oid: 'b', fromGraveyard: true },
    { type: 'pass' }
  ]
  assert(readyCount(actions, 'graveyard', cards) === 2, 'two of the three can be used')
  // A card with two ways to use it is still one card in the pile.
  const twoWays = [{ type: 'castFlashback', oid: 'a' }, { type: 'castEscape', oid: 'a' }]
  assert(readyCount(twoWays, 'graveyard', cards) === 1, 'a card with two options counts once')
  assert(readyCount([], 'graveyard', cards) === 0, 'nothing usable is zero')
  assert(readyCount(actions, 'graveyard', []) === 0, 'an empty pile is zero')
  assert(readyCount(actions, 'graveyard', null) === 0, 'and so is no pile')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
