// Headless verification: Storm (702.40), Ninjutsu (702.49), Plot (702.170).
// Run: node src/shared/engine/stormninjaplot.test.mjs

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
  while (zone(e.state, 'stack').length > 0 && e.pending.kind === 'priority' && g++ < 60) bothPass(e)
}
const onBattlefield = (e, pid, name) =>
  zone(e.state, 'battlefield', pid).map((o) => e.state.objects[o]).filter((o) => o.printed.name === name)

section('Storm: Grapeshot copies once per earlier spell this turn')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Mountain', 'battlefield')
  const bolt1 = put(e, 0, 'Lightning Bolt', 'hand')
  const bolt2 = put(e, 0, 'Lightning Bolt', 'hand')
  const grape = put(e, 0, 'Grapeshot', 'hand')
  advanceToPriorityAt(e, 'main1')
  // Two earlier spells this turn.
  e.choose({ type: 'cast', oid: bolt1.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  e.choose({ type: 'cast', oid: bolt2.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 14, 'two Bolts dealt 6 (20 -> 14)')
  // Grapeshot is the 3rd spell -> 2 copies + the original = 3 damage total.
  e.choose({ type: 'cast', oid: grape.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 11, 'Grapeshot + 2 storm copies dealt 3 (14 -> 11)')
}

section('Storm: count resets each turn')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const grape = put(e, 0, 'Grapeshot', 'hand')
  advanceToPriorityAt(e, 'main1')
  // First spell of the turn -> no copies, just 1 damage.
  e.choose({ type: 'cast', oid: grape.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  assert(e.state.players[1].life === 19, 'a lone Grapeshot deals only 1')
}

section('Storm: Empty the Warrens copies its token effect')
{
  const e = makeEngine()
  for (let i = 0; i < 8; i++) put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const empty = put(e, 0, 'Empty the Warrens', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: bolt.oid, targets: [{ kind: 'player', pid: 1 }] })
  resolveAll(e)
  // 2nd spell -> 1 copy. Original makes 2 goblins, the copy makes 2 more = 4.
  e.choose({ type: 'cast', oid: empty.oid })
  resolveAll(e)
  assert(onBattlefield(e, 0, 'Goblin').length === 4, 'made 4 Goblins (2 + a storm copy of 2)')
}

section('Plot: exile from hand, then cast free on a later turn')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const robbery = put(e, 0, 'Highway Robbery', 'hand')
  advanceToPriorityAt(e, 'main1')
  const plotAct = e.pending.actions.find((a) => a.type === 'plot' && a.oid === robbery.oid)
  assert(!!plotAct, 'Plot is offered as a special action')
  e.choose({ type: 'plot', oid: robbery.oid })
  assert(inZone(e, 0, 'exile', robbery.oid) && robbery.plotted, 'card is exiled and plotted')
  // Same turn: it may not be cast yet.
  assert(
    !e.pending.actions.find((a) => a.type === 'castPlotted' && a.oid === robbery.oid),
    'a plotted card cannot be cast the turn it was plotted'
  )
  // Advance to this player's *next* turn (turn number must exceed the plot turn).
  const plottedTurn = robbery.plottedTurn
  let g = 0
  while (g++ < 800) {
    const p = e.pending
    if (
      p.kind === 'priority' &&
      e.state.activePlayer === 0 &&
      e.state.step === 'main1' &&
      p.player === 0 &&
      e.state.turnNumber > plottedTurn
    )
      break
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else throw new Error('unexpected ' + p.kind)
  }
  const castAct = e.pending.actions.find((a) => a.type === 'castPlotted' && a.oid === robbery.oid)
  assert(!!castAct, 'plotted card is castable for free on a later turn')
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ type: 'castPlotted', oid: robbery.oid })
  resolveAll(e)
  // Highway Robbery: optional discard -> draw 2. Decline the discard here.
  if (e.pending.kind === 'discardCards') e.choose({ discard: [] })
  resolveAll(e)
  assert(inZone(e, 0, 'graveyard', robbery.oid), 'plotted spell resolved to the graveyard')
  assert(zone(e.state, 'hand', 0).length === handBefore, 'declined the discard, drew nothing (no mana paid)')
}

section('Highway Robbery: sacrifice a land instead of discarding, then draw two')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const spare = put(e, 0, 'Mountain', 'battlefield') // the land to sacrifice
  const robbery = put(e, 0, 'Highway Robbery', 'hand')
  advanceToPriorityAt(e, 'main1')
  const handBefore = zone(e.state, 'hand', 0).length
  e.choose({ type: 'cast', oid: robbery.oid })
  resolveAll(e)
  assert(e.pending.kind === 'discardCards' && e.pending.orSacrificeLand, 'offers discard-or-sacrifice-a-land')
  e.choose({ sacLand: spare.oid })
  resolveAll(e)
  assert(inZone(e, 0, 'graveyard', spare.oid), 'the land was sacrificed instead of a card')
  // -Robbery (cast) + 2 (draw) = handBefore + 1
  assert(zone(e.state, 'hand', 0).length === handBefore + 1, 'drew two cards')
}

section('Ninjutsu: swap an unblocked attacker for the ninja, tapped and attacking')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const ninja = put(e, 0, 'Ninja of the Deep Hours', 'hand')
  // Attack with the bear (unblocked), then ninjutsu during declare-blockers.
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 50) e.choose({ type: 'pass' })
  e.choose({ attackers: [{ oid: bear.oid, defender: { player: 1 } }] })
  g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'declareBlockers' && g++ < 50)
    e.choose({ type: 'pass' })
  // The opponent has nothing that can block, so no declaration is asked for and
  // the active player simply gets priority in declare-blockers.
  const ninAct = e.pending.actions.find((a) => a.type === 'ninjutsu' && a.oid === ninja.oid)
  assert(!!ninAct, 'ninjutsu is offered with an unblocked attacker')
  e.choose({ type: 'ninjutsu', oid: ninja.oid, returned: bear.oid })
  assert(inZone(e, 0, 'hand', bear.oid), 'the unblocked attacker returned to hand')
  assert(onBattlefield(e, 0, 'Ninja of the Deep Hours').length === 1, 'ninja entered the battlefield')
  assert(ninja.status.tapped && ninja.status.attacking, 'ninja is tapped and attacking')
  // Pass through combat damage; ninja hits for 2 and its trigger draws a card.
  const handBefore = zone(e.state, 'hand', 0).length
  g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 60) e.choose({ type: 'pass' })
  resolveAll(e)
  assert(e.state.players[1].life === 18, 'ninja dealt 2 combat damage')
  assert(zone(e.state, 'hand', 0).length === handBefore + 1, 'combat-damage trigger drew a card')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
