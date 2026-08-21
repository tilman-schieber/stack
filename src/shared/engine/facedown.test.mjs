// Headless verification: face-down permanents / Morph (rule 702.37). A morph card
// may be cast face down as a nameless 2/2 for {3}; its controller may turn it face
// up any time by paying the morph cost, revealing its real characteristics.
// Run: node src/shared/engine/facedown.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { projectGame } from './project.mjs'
import { makeEngine, put, advanceToPriorityAt, resolveStack, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

section('A morph card can be cast face down as a 2/2 for {3}')
{
  const e = makeEngine()
  for (let i = 0; i < 6; i++) put(e, 0, 'Forest', 'battlefield')
  const patron = put(e, 0, 'Patron of the Wild', 'hand') // {G} 1/1, Morph {2}{G}
  advanceToPriorityAt(e, 'main1')
  const fd = e.pending.actions.find((a) => a.type === 'castFaceDown' && a.oid === patron.oid)
  assert(!!fd, 'a cast-face-down action is offered for the morph card')
  e.choose({ type: 'castFaceDown', oid: patron.oid })
  resolveStack(e)
  recompute(e.state)
  assert(patron.zoneName === 'battlefield' && patron.faceDown, 'it entered the battlefield face down')
  assert(patron.chars.power === 2 && patron.chars.toughness === 2, 'it is a 2/2')
  assert(patron.chars.name === '' && patron.chars.types.join() === 'Creature', 'nameless, just a creature')
}

section('The projected view hides a face-down creature’s identity')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  const patron = put(e, 0, 'Patron of the Wild', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'castFaceDown', oid: patron.oid })
  resolveStack(e)
  const view = projectGame(e)
  const card = view.players[0].battlefield.find((c) => c.oid === patron.oid)
  assert(card.name === 'Face-down creature' && card.cardId == null, 'the view shows no real name or art')
  assert(card.power === 2 && card.faceDown, 'shown as a 2/2, flagged face down')
}

section('Turning it face up pays the morph cost and reveals the real card')
{
  const e = makeEngine()
  for (let i = 0; i < 6; i++) put(e, 0, 'Forest', 'battlefield')
  const patron = put(e, 0, 'Patron of the Wild', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'castFaceDown', oid: patron.oid })
  resolveStack(e)
  const up = e.pending.actions.find((a) => a.type === 'turnFaceUp' && a.oid === patron.oid)
  assert(!!up, 'a turn-face-up action is available (morph cost payable)')
  e.choose({ type: 'turnFaceUp', oid: patron.oid })
  recompute(e.state)
  assert(!patron.faceDown, 'it is now face up')
  assert(patron.chars.name === 'Patron of the Wild', 'its real name is revealed')
  assert(patron.chars.power === 1 && patron.chars.toughness === 1, 'and its real 1/1 body')
}

section('A creature without morph has no cast-face-down action')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  const bears = put(e, 0, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(!e.pending.actions.some((a) => a.type === 'castFaceDown' && a.oid === bears.oid), 'no face-down option')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
