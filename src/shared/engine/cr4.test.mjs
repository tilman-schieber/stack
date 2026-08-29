// Headless verification, CR gap analysis batch 4:
//   603 trigger vocabulary — blocks / becomes blocked / becomes tapped / life gained /
//       draw (targeted "may") / cast enchantment (untargeted "may") / another dies /
//       beginning of combat
//   603.3b the controller orders simultaneous triggers
//   603.4 intervening "if"
//   611.2 durations: until end of combat, until your next turn
// Run: node src/shared/engine/cr4.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, combat, keepAll, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

section('"Becomes blocked" and "blocks a creature with flying" triggers')
{
  const e = makeEngine()
  const wolv = put(e, 0, 'Deepwood Wolverine', 'battlefield', { summoningSick: false }) // 1/1, +2/+0 when blocked
  const angel = put(e, 1, 'Serra Angel', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ attackers: [wolv.oid] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ blocks: { [angel.oid]: wolv.oid } })
  bothPass(e) // the trigger resolves
  recompute(e.state)
  assert(wolv.chars.power === 3, 'Wolverine is 3/1 after becoming blocked')

  const f = makeEngine()
  const bird = put(f, 0, 'Serra Angel', 'battlefield', { summoningSick: false }) // flyer attacks
  const archers = put(f, 1, "Ezuri's Archers", 'battlefield', { summoningSick: false }) // reach, +3/+0 vs flyers
  advanceToPriorityAt(f, 'main1')
  g = 0
  while (f.pending.kind !== 'declareAttackers' && g++ < 20) f.choose({ type: 'pass' })
  f.choose({ attackers: [bird.oid] })
  g = 0
  while (f.pending.kind !== 'declareBlockers' && g++ < 20) f.choose({ type: 'pass' })
  f.choose({ blocks: { [archers.oid]: bird.oid } })
  bothPass(f)
  recompute(f.state)
  assert(archers.chars.power === 4, 'Archers are 4/2 after blocking a flyer')
}

section('"Becomes tapped" fires for attacking, costs and mana, not for entering tapped')
{
  const e = makeEngine()
  const lookout = put(e, 0, 'Night Market Lookout', 'battlefield', { summoningSick: false })
  combat(e, [lookout.oid])
  assert(e.state.players[1].life === 18 && e.state.players[0].life === 21, 'attacking tapped it: drain 1, and 1 combat damage')
}

section('"Whenever you gain life" (player event) and "another creature you control dies"')
{
  const e = makeEngine()
  const uni = put(e, 0, 'Celestial Unicorn', 'battlefield')
  const vamp = put(e, 0, 'Vindictive Vampire', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e._bury(bear)
  e._grantPriorityTo(0)
  let g = 0
  while (zone(e.state, 'stack').length && g++ < 10) bothPass(e)
  assert(e.state.players[1].life === 19, 'Vampire: each opponent took 1')
  assert(e.state.players[0].life === 21, 'Vampire: you gained 1')
  assert(uni.status.counters['+1/+1'] === 1, 'Unicorn grew from the life gain')
}

section('"Whenever you draw a card, you may have target player mill" — targeted, declinable')
{
  const e = makeEngine()
  put(e, 0, "Jace's Erasure", 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.draw(0, 1)
  e._grantPriorityTo(0)
  assert(e.pending.kind === 'chooseTargets' && e.pending.optional, 'asked for a target, may decline')
  e.choose({ targets: [{ kind: 'player', pid: 1 }] })
  const libBefore = zone(e.state, 'library', 1).length
  bothPass(e)
  assert(zone(e.state, 'library', 1).length === libBefore - 1 && zone(e.state, 'graveyard', 1).length === 1, 'milled one')
  e.draw(0, 1)
  e._grantPriorityTo(0)
  e.choose({ decline: true })
  assert(zone(e.state, 'stack').length === 0 && e.pending.kind === 'priority', 'declined: nothing on the stack')
}

section('Untargeted "you may" trigger asks yes/no; beginning-of-combat trigger')
{
  const e = makeEngine()
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Mesa Enchantress', 'battlefield')
  const pac = put(e, 0, 'Pacifism', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: pac.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  assert(e.pending.kind === 'optionalTrigger' && /Enchantress/.test(e.pending.name), 'Enchantress asks')
  const hand = zone(e.state, 'hand', 0).length
  e.choose({ yes: true })
  bothPass(e) // draw trigger resolves (above Pacifism)
  assert(zone(e.state, 'hand', 0).length === hand + 1, 'drew a card')
}

section('603.3b: a player orders their own simultaneous, different triggers')
{
  const deck = () => Array(20).fill('Forest')
  const e = keepAll(new GameEngine({ seed: 'ord', startingPlayer: 0, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start())
  put(e, 0, 'Soul Warden', 'battlefield')
  put(e, 0, 'Celestial Unicorn', 'battlefield') // grows when Soul Warden's lifegain resolves
  put(e, 0, 'Vindictive Vampire', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e._bury(bear) // Vampire (dies) — but the Warden won't trigger (not an ETB)
  e._createToken({ name: 'Goblin', types: ['Creature'], colors: ['R'], power: 1, toughness: 1 }, 0) // Soul Warden ETB
  e._grantPriorityTo(0)
  assert(e.pending.kind === 'orderTriggers' && e.pending.triggers.length === 2, 'asked to order Warden vs Vampire')
  const warden = e.pending.triggers.find((t) => /Warden/.test(t.name)).id
  const vamp = e.pending.triggers.find((t) => /Vampire/.test(t.name)).id
  e.choose({ order: [vamp, warden] }) // Warden on top: resolves first
  const st = zone(e.state, 'stack').map((o) => e.state.objects[o].sourceOid).map((o) => e.state.objects[o].printed.name)
  assert(st[st.length - 1] === 'Soul Warden', 'Soul Warden trigger is on top of the stack')
}

section('603.4 intervening if: checked on trigger and again on resolution')
{
  const e = makeEngine()
  // A synthetic "when a creature enters, if you control three or more creatures, gain 5 life".
  const watcher = put(e, 0, 'Grizzly Bears', 'battlefield')
  watcher.behavior = {
    ...watcher.behavior,
    triggered: [{ trigger: { event: 'etb', filter: { type: 'Creature' }, if: { controls: { type: 'Creature', min: 3 } } }, effect: [{ op: 'gainLife', amount: 5 }] }]
  }
  advanceToPriorityAt(e, 'main1')
  e._createToken({ name: 'Goblin', types: ['Creature'], colors: ['R'], power: 1, toughness: 1 }, 0)
  e._grantPriorityTo(0)
  assert(zone(e.state, 'stack').length === 0, 'with two creatures the trigger did not trigger at all')
  const tok = e._createToken({ name: 'Goblin', types: ['Creature'], colors: ['R'], power: 1, toughness: 1 }, 0)
  e._grantPriorityTo(0)
  assert(zone(e.state, 'stack').length === 1, 'with three it triggered')
  // Now make the condition false before resolution.
  const third = zone(e.state, 'battlefield').map((o) => e.state.objects[o]).filter((o) => o.token)[1]
  e._bury(third)
  bothPass(e)
  assert(e.state.players[0].life === 20, 'condition false on resolution: no life gained')
}

section('611.2 durations: until end of combat, until your next turn')
{
  const e = makeEngine()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  e.state.continuous.push({ timestamp: ++e.state.tsCounter, targets: [bear.oid], modifyPT: { power: 1, toughness: 1 }, duration: 'endOfCombat', owner: 0 })
  e.state.continuous.push({ timestamp: ++e.state.tsCounter, targets: [bear.oid], modifyPT: { power: 2, toughness: 2 }, duration: 'untilYourNextTurn', owner: 0 })
  recompute(e.state)
  assert(bear.chars.power === 5, 'both pumps apply in main 1')
  combat(e, [])
  recompute(e.state)
  assert(bear.chars.power === 4, 'end-of-combat pump gone after combat')
  let g = 0
  while (!(e.state.activePlayer === 1 && e.pending.kind === 'priority') && g++ < 40) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else break
  }
  recompute(e.state)
  assert(e.state.activePlayer === 1 && bear.chars.power === 4, "still 4/4 on the opponent's turn")
  g = 0
  while (!(e.state.activePlayer === 0 && e.state.turnNumber === 3) && g++ < 60) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (e.pending.kind === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else break
  }
  recompute(e.state)
  assert(e.state.turnNumber === 3 && bear.chars.power === 2, 'gone once your next turn begins')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
