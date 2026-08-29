// Headless verification, CR gap analysis batch 9:
//   702.122 crew / Vehicles; 714 Sagas; Edict effects ("sacrifice a creature of
//   their choice"); 702.27 buyback; 702.84 unearth; 702.30 echo; 702.61 split
//   second; 702.73 changeling; 702.88 rebound; 702.100 extort; 702.62 suspend
// Run: node src/shared/engine/cr9.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, combat, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const untilStack = (e) => {
  let g = 0
  while (zone(e.state, 'stack').length && e.pending.kind === 'priority' && g++ < 20) bothPass(e)
}
// Drive to the given player's turn and step (passing/declining everything).
const untilTurn = (e, pid, turn, step = 'main1') => {
  let g = 0
  while (!(e.state.activePlayer === pid && e.state.turnNumber === turn && e.state.step === step && e.pending.kind === 'priority') && g++ < 120) {
    const k = e.pending.kind
    if (k === 'priority') e.choose({ type: 'pass' })
    else if (k === 'declareAttackers') e.choose({ attackers: [] })
    else if (k === 'declareBlockers') e.choose({ blocks: {} })
    else if (k === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else if (k === 'mayPay') e.choose({ pay: false })
    else if (k === 'madness') e.choose({ cast: false })
    else break
  }
}

section('702.122 crew: tapping creatures turns the Vehicle into a creature until end of turn')
{
  const e = makeEngine()
  const ship = put(e, 0, 'Renegade Freighter', 'battlefield', { summoningSick: false }) // 4/3, crew 2
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const rats = put(e, 0, 'Typhoid Rats', 'battlefield', { summoningSick: false }) // 1/1
  advanceToPriorityAt(e, 'main1')
  assert(!e._eligibleAttackers().includes(ship.oid), 'uncrewed: not a creature, cannot attack')
  const crew = e.pending.actions.find((a) => a.type === 'crew' && a.oid === ship.oid)
  assert(!!crew, 'Crew 2 offered')
  e.choose({ type: 'crew', oid: ship.oid })
  assert(rats.status.tapped && bear.status.tapped, 'the 1/1 alone falls short, so the 2/2 was tapped too (smallest first)')
  bothPass(e)
  recompute(e.state)
  assert(ship.chars.types.includes('Creature') && e._eligibleAttackers().includes(ship.oid), 'crewed: an artifact creature that can attack')
  combat(e, [ship.oid])
  assert(e.state.players[1].life === 15, 'attacked for 5 (its attack trigger: +1/+1)')
  untilTurn(e, 1, 2)
  recompute(e.state)
  assert(!ship.chars.types.includes('Creature'), 'no longer a creature next turn')
}

section('714 Sagas: lore counters, chapters, sacrifice after the last; Edict choices')
{
  const e = makeEngine()
  for (let i = 0; i < 5; i++) put(e, 0, 'Swamp', 'battlefield')
  const saga = put(e, 0, 'The Eldest Reborn', 'hand')
  const a = put(e, 1, 'Grizzly Bears', 'battlefield')
  const b = put(e, 1, 'Serra Angel', 'battlefield')
  put(e, 1, 'Forest', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: saga.oid })
  bothPass(e) // resolves; chapter I trigger
  assert(saga.status.counters.lore === 1 && zone(e.state, 'stack').length === 1, 'entered with a lore counter; chapter I on the stack')
  bothPass(e) // chapter I resolves: the opponent chooses what to sacrifice
  assert(e.pending.kind === 'sacrificeChoice' && e.pending.player === 1 && e.pending.choices.length === 2, 'B chooses a creature to sacrifice')
  e.choose({ sacrifice: [a.oid] })
  assert(inZone(e, 1, 'graveyard', a.oid) && b.zoneName === 'battlefield', 'B sacrificed the bear, kept the Angel')
  untilTurn(e, 0, 3)
  assert(saga.status.counters.lore === 2, 'chapter II after the next draw step')
  // chapter II (each opponent discards) is on the stack now
  untilStack(e)
  if (e.pending.kind === 'discardCards') e.choose({ discard: [e.pending.hand[0]] })
  untilTurn(e, 0, 5)
  assert(saga.status.counters.lore === 3 && zone(e.state, 'stack').length === 1, 'chapter III triggered')
  bothPass(e)
  assert(e.pending.kind === 'search' && e.pending.cards.includes(a.oid), 'III: choose a creature card from a graveyard')
  e.choose({ pick: a.oid })
  assert(a.zoneName === 'battlefield' && a.controller === 0, 'the bear came back under my control')
  assert(inZone(e, 0, 'graveyard', saga.oid), 'the Saga was sacrificed after chapter III (714.4)')
}

section("Chainer's Edict: target player sacrifices a creature of their choice")
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const edict = put(e, 0, "Chainer's Edict", 'hand')
  const x = put(e, 1, 'Grizzly Bears', 'battlefield')
  const y = put(e, 1, 'Typhoid Rats', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: edict.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(e.pending.kind === 'sacrificeChoice' && e.pending.player === 1, 'the targeted player chooses')
  let threw = false
  try {
    e.choose({ sacrifice: [edict.oid] })
  } catch {
    threw = true
  }
  assert(threw, 'must pick from the offered choices')
  e.choose({ sacrifice: [y.oid] })
  assert(inZone(e, 1, 'graveyard', y.oid) && x.zoneName === 'battlefield', 'they sacrificed the Rats')
}

section('702.27 buyback returns the spell to hand')
{
  const e = makeEngine()
  for (let i = 0; i < 6; i++) put(e, 0, 'Island', 'battlefield')
  const cap = put(e, 0, 'Capsize', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  const opts = e.pending.actions.filter((a) => a.type === 'cast' && a.oid === cap.oid)
  assert(opts.length === 2 && opts.some((a) => a.buyback), 'normal and buyback casts offered')
  e.choose({ type: 'cast', oid: cap.oid, buyback: true, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  assert(bear.zoneName === 'hand' && inZone(e, 0, 'hand', cap.oid), 'bear bounced; Capsize is back in hand')
}

section('702.84 unearth: returns with haste, exiled at end of turn or if it would leave')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const zombie = put(e, 0, 'Dregscape Zombie', 'graveyard')
  advanceToPriorityAt(e, 'main1')
  assert(e.pending.actions.some((a) => a.type === 'unearth' && a.oid === zombie.oid), 'Unearth offered from the graveyard')
  e.choose({ type: 'unearth', oid: zombie.oid })
  bothPass(e)
  recompute(e.state)
  assert(zombie.zoneName === 'battlefield' && zombie.chars.keywords.includes('Haste'), 'on the battlefield with haste')
  combat(e, [zombie.oid])
  assert(e.state.players[1].life === 18, 'it attacked')
  untilTurn(e, 1, 2)
  assert(zombie.zoneName === 'exile', 'exiled at the end step')
  const f = makeEngine()
  put(f, 0, 'Swamp', 'battlefield')
  const z2 = put(f, 0, 'Dregscape Zombie', 'graveyard')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'unearth', oid: z2.oid })
  bothPass(f)
  f._bury(z2)
  assert(z2.zoneName === 'exile', 'dying: exiled instead of the graveyard')
}

section('702.30 echo: pay at the next upkeep or sacrifice')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const mwm = put(e, 0, 'Mogg War Marshal', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: mwm.oid })
  bothPass(e)
  untilStack(e)
  assert(mwm.zoneName === 'battlefield' && zone(e.state, 'battlefield').filter((o) => e.state.objects[o].token).length === 1, 'entered with its Goblin')
  let g = 0
  while (!(e.state.activePlayer === 0 && e.state.turnNumber === 3 && e.pending.kind === 'mayPay') && g++ < 120) {
    const k = e.pending.kind
    if (k === 'priority') e.choose({ type: 'pass' })
    else if (k === 'declareAttackers') e.choose({ attackers: [] })
    else if (k === 'declareBlockers') e.choose({ blocks: {} })
    else if (k === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else break
  }
  assert(e.pending.kind === 'mayPay' && e.pending.cost === '{1}{R}', 'echo asks at my next upkeep')
  e.choose({ pay: false })
  assert(inZone(e, 0, 'graveyard', mwm.oid), 'declined: sacrificed')
  untilStack(e)
  assert(zone(e.state, 'battlefield').filter((o) => e.state.objects[o].token).length === 2, 'its dies trigger made another Goblin')
}

section('702.61 split second: nothing but mana abilities while it is on the stack')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  put(e, 1, 'Island', 'battlefield')
  const shock = put(e, 0, 'Sudden Shock', 'hand')
  const counter = put(e, 1, 'Counterspell', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: shock.oid, targets: [{ kind: 'player', pid: 1 }] })
  e.choose({ type: 'pass' })
  assert(e.pending.player === 1, 'opponent has priority')
  assert(!e.pending.actions.some((a) => a.type === 'cast' && a.oid === counter.oid), 'Counterspell cannot be cast in response')
  assert(e.pending.actions.some((a) => a.type === 'tapForMana'), 'mana abilities still allowed')
}

section('702.73 changeling counts as every creature type')
{
  const e = makeEngine()
  put(e, 0, 'Goblin King', 'battlefield') // other Goblins you control get +1/+1
  const ch = put(e, 0, 'Avian Changeling', 'battlefield') // 2/2
  recompute(e.state)
  assert(ch.chars.power === 3, 'the Changeling is a Goblin for Goblin King')
}

section('702.88 rebound: exiled on resolution, cast free at your next upkeep')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  const strike = put(e, 0, 'Distortion Strike', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: strike.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  assert(strike.zoneName === 'exile', 'exiled instead of the graveyard')
  recompute(e.state)
  assert(bear.chars.power === 3 && bear.chars.keywords.includes('Unblockable'), '+1/+0 and unblockable this turn')
  let g = 0
  while (!(e.state.activePlayer === 0 && e.state.turnNumber === 3 && e.pending.kind === 'madness') && g++ < 120) {
    const k = e.pending.kind
    if (k === 'priority') e.choose({ type: 'pass' })
    else if (k === 'declareAttackers') e.choose({ attackers: [] })
    else if (k === 'declareBlockers') e.choose({ blocks: {} })
    else if (k === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else break
  }
  assert(e.pending.kind === 'madness' && e.pending.free && e.pending.oid === strike.oid, 'offered to cast it free at my upkeep')
  e.choose({ cast: true, targets: [{ kind: 'object', oid: bear.oid }] })
  bothPass(e)
  assert(inZone(e, 0, 'graveyard', strike.oid), 'this time it goes to the graveyard (not cast from hand)')
}

section('702.100 extort: may pay {W/B} whenever you cast a spell')
{
  const e = makeEngine()
  put(e, 0, 'Basilica Screecher', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  put(e, 0, 'Swamp', 'battlefield')
  const bear = put(e, 0, 'Grizzly Bears', 'hand') // {1}{G} — wait, no green: use a black spell
  const edict = put(e, 0, "Chainer's Edict", 'hand')
  put(e, 0, 'Swamp', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: edict.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e) // extort trigger resolves first
  assert(e.pending.kind === 'mayPay' && e.pending.cost === '{W/B}', 'extort asks to pay')
  e.choose({ pay: true })
  assert(e.state.players[1].life === 19 && e.state.players[0].life === 21, 'drained 1')
  void bear
}

section('702.62 suspend: exile with time counters, cast free when the last is removed')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Rift Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(e.pending.actions.some((a) => a.type === 'suspend' && a.oid === bolt.oid), 'Suspend offered')
  assert(!e.pending.actions.some((a) => a.type === 'cast' && a.oid === bolt.oid), '(and the hard cast is not affordable)')
  e.choose({ type: 'suspend', oid: bolt.oid })
  assert(bolt.zoneName === 'exile' && bolt.status.counters.time === 1 && bolt.suspended, 'exiled with a time counter')
  let g = 0
  while (!(e.state.activePlayer === 0 && e.state.turnNumber === 3 && e.pending.kind === 'madness') && g++ < 120) {
    const k = e.pending.kind
    if (k === 'priority') e.choose({ type: 'pass' })
    else if (k === 'declareAttackers') e.choose({ attackers: [] })
    else if (k === 'declareBlockers') e.choose({ blocks: {} })
    else if (k === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else break
  }
  assert(e.pending.kind === 'madness' && e.pending.free && e.pending.oid === bolt.oid, 'the last counter came off: cast it free')
  e.choose({ cast: true, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(e.state.players[1].life === 17, 'Rift Bolt hit for 3')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
