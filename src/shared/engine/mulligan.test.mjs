// London mulligan (rule 103.5): draw 7, keep or mulligan (reshuffle + redraw 7),
// then bottom one card per mulligan taken.
// Run: node src/shared/engine/mulligan.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const deck = () => Array(40).fill('Forest')
const make = () =>
  new GameEngine({ seed: 'mull', players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start()

console.log('\n1. game begins in the mulligan phase')
{
  const e = make()
  assert(e.pending.kind === 'mulligan', 'first decision is a mulligan')
  assert(e.pending.player === 0 && e.pending.hand.length === 7, 'starting player, 7-card hand')
}

console.log('\n2. keeping both hands starts the game with 7 cards each')
{
  const e = make()
  e.choose({ keep: true }) // P0 keeps
  assert(e.pending.kind === 'mulligan' && e.pending.player === 1, 'then P1 decides')
  e.choose({ keep: true }) // P1 keeps
  assert(zone(e.state, 'hand', 0).length === 7, 'P0 kept 7')
  assert(zone(e.state, 'hand', 1).length === 7, 'P1 kept 7')
  assert(e.state.turnNumber === 1 && e.pending.kind === 'priority', 'game started at turn 1')
}

console.log('\n3. one mulligan → redraw 7 → bottom 1 (keep 6)')
{
  const e = make()
  const firstHand = [...e.pending.hand]
  e.choose({ keep: false }) // P0 mulligans
  assert(e.pending.kind === 'mulligan' && e.pending.player === 0, 'same player decides again')
  assert(e.pending.mulligans === 1, 'mulligan count is 1')
  assert(zone(e.state, 'hand', 0).length === 7, 'redrew a full seven')
  e.choose({ keep: true }) // now keep
  assert(e.pending.kind === 'bottom' && e.pending.count === 1, 'must bottom exactly 1 card')
  const toBottom = e.pending.hand[0]
  const libBefore = zone(e.state, 'library', 0).length
  e.choose({ bottom: [toBottom] })
  assert(zone(e.state, 'hand', 0).length === 6, 'kept 6 after bottoming 1')
  assert(zone(e.state, 'library', 0).length === libBefore + 1, 'bottomed card returned to library')
  assert(
    zone(e.state, 'library', 0)[zone(e.state, 'library', 0).length - 1] === toBottom,
    'card went to the very bottom of the library'
  )
  assert(e.pending.kind === 'mulligan' && e.pending.player === 1, 'then P1 decides')
  firstHand // referenced
}

console.log('\n4. two mulligans → bottom 2 (keep 5)')
{
  const e = make()
  e.choose({ keep: false })
  e.choose({ keep: false })
  assert(e.pending.mulligans === 2, 'two mulligans taken')
  e.choose({ keep: true })
  assert(e.pending.kind === 'bottom' && e.pending.count === 2, 'must bottom 2')
  e.choose({ bottom: e.pending.hand.slice(0, 2) })
  assert(zone(e.state, 'hand', 0).length === 5, 'kept 5')
}

console.log('\n5. bottoming the wrong count is rejected (non-corrupting)')
{
  const e = make()
  e.choose({ keep: false })
  e.choose({ keep: true })
  let threw = false
  try {
    e.choose({ bottom: [] })
  } catch {
    threw = true
  }
  assert(threw, 'must bottom exactly the required number')
  assert(e.pending.kind === 'bottom', 'decision is preserved after the illegal choice')
  e.choose({ bottom: [e.pending.hand[0]] })
  assert(zone(e.state, 'hand', 0).length === 6, 'retry succeeds')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
