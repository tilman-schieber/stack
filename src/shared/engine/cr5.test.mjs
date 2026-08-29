// Headless verification, CR gap analysis batch 5:
//   118 cost vocabulary — kicker (702.33), {Q} (107.6), remove-counter costs,
//   X in activation costs, delve (702.66), convoke (702.51)
//   305.2 additional land plays; 402.2 no maximum hand size
// Run: node src/shared/engine/cr5.test.mjs

import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { makeEngine, put, advanceToPriorityAt, inZone, makeAsserter, refresh } from './_testutil.mjs'

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

section('Kicker: offered as a second cast option; "if it was kicked" is an intervening if')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const bw = put(e, 0, 'Goblin Bushwhacker', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  let casts = e.pending.actions.filter((a) => a.type === 'cast' && a.oid === bw.oid)
  assert(casts.length === 1 && !casts[0].kicker, 'with one Mountain only the unkicked cast is offered')
  put(e, 0, 'Mountain', 'battlefield')
  casts = e.pending.actions.filter((a) => a.type === 'cast' && a.oid === bw.oid)
  assert(casts.length === 2 && casts.some((a) => a.kicker && /kicked/.test(a.label)), 'with two, the kicked cast too')
  e.choose({ type: 'cast', oid: bw.oid, kicker: true })
  assert(e.state.objects[bw.oid].kicked, 'the spell remembers it was kicked')
  bothPass(e) // resolves, ETB trigger goes on the stack
  untilStack(e)
  recompute(e.state)
  assert(bear.chars.power === 3 && bear.chars.keywords.includes('Haste'), 'creatures got +1/+0 and haste')
  assert(bw.chars.power === 2, 'including the Bushwhacker itself')

  const f = makeEngine()
  put(f, 0, 'Mountain', 'battlefield')
  put(f, 0, 'Mountain', 'battlefield')
  const bw2 = put(f, 0, 'Goblin Bushwhacker', 'hand')
  const bear2 = put(f, 0, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: bw2.oid })
  bothPass(f)
  assert(zone(f.state, 'stack').length === 0, 'unkicked: the ETB does not even trigger')
  recompute(f.state)
  assert(bear2.chars.power === 2, 'no pump')
}

section('{Q}: an untap cost needs a tapped, non-summoning-sick permanent')
{
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Plains', 'battlefield')
  const order = put(e, 0, 'Order of Whiteclay', 'battlefield', { summoningSick: false })
  const dead = put(e, 0, 'Grizzly Bears', 'graveyard') // MV 2
  const big = put(e, 0, 'Serra Angel', 'graveyard') // MV 5: not returnable
  advanceToPriorityAt(e, 'main1')
  assert(!e.pending.actions.some((a) => a.type === 'activate' && a.oid === order.oid), 'untapped: {Q} cannot be paid')
  order.status.tapped = true
  refresh(e)
  assert(e.pending.actions.some((a) => a.type === 'activate' && a.oid === order.oid), 'tapped: offered')
  e.choose({ type: 'activate', oid: order.oid, ability: 0, targets: [] })
  assert(!order.status.tapped, 'paying {Q} untapped it')
  bothPass(e)
  assert(e.pending.kind === 'search' && e.pending.cards.includes(dead.oid) && !e.pending.cards.includes(big.oid), 'choose a creature card with MV 3 or less')
  e.choose({ pick: dead.oid })
  assert(dead.zoneName === 'battlefield', 'returned to the battlefield')
}

section('Remove-counter costs and X in an activation cost')
{
  const e = makeEngine()
  for (let i = 0; i < 4; i++) put(e, 0, 'Mountain', 'battlefield')
  const ball = put(e, 0, 'Walking Ballista', 'hand') // {X}{X}
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'cast' && a.oid === ball.oid)
  assert(act.hasX && act.maxX === 2, 'X up to 2 off four lands ({X}{X})')
  e.choose({ type: 'cast', oid: ball.oid, x: 2 })
  bothPass(e)
  assert(ball.zoneName === 'battlefield' && ball.status.counters['+1/+1'] === 2, 'entered with two counters')
  refresh(e)
  const ping = e.pending.actions.find((a) => a.type === 'activate' && a.oid === ball.oid && a.ability === 1)
  assert(!!ping, 'remove-a-counter ability offered')
  e.choose({ type: 'activate', oid: ball.oid, ability: 1, targets: [{ kind: 'player', pid: 1 }] })
  assert(ball.status.counters['+1/+1'] === 1, 'a counter was removed as the cost')
  bothPass(e)
  assert(e.state.players[1].life === 19, '1 damage')

  const f = makeEngine()
  put(f, 0, 'Mountain', 'battlefield')
  put(f, 0, 'Forest', 'battlefield')
  put(f, 0, 'Forest', 'battlefield')
  const run = put(f, 0, 'Kessig Wolf Run', 'battlefield')
  const bear = put(f, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(f, 'main1')
  const wolf = f.pending.actions.find((a) => a.type === 'activate' && a.oid === run.oid)
  assert(wolf && wolf.hasX && wolf.maxX === 1, '{X}{R}{G},{T}: X up to 1 with one spare land (the Run taps itself)')
  f.choose({ type: 'activate', oid: run.oid, ability: 0, targets: [{ kind: 'object', oid: bear.oid }], x: 1 })
  bothPass(f)
  recompute(f.state)
  assert(bear.chars.power === 3 && bear.chars.keywords.includes('Trample'), '+1/+0 and trample')
}

section('Delve and convoke pay generic mana')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  for (let i = 0; i < 6; i++) put(e, 0, 'Lightning Bolt', 'graveyard')
  const angler = put(e, 0, 'Gurmag Angler', 'hand') // {6}{B}
  advanceToPriorityAt(e, 'main1')
  assert(e.pending.actions.some((a) => a.type === 'cast' && a.oid === angler.oid), 'castable: Swamp + six graveyard cards')
  e.choose({ type: 'cast', oid: angler.oid })
  assert(zone(e.state, 'graveyard', 0).length === 0 && zone(e.state, 'exile', 0).length === 6, 'six cards exiled (delve)')
  bothPass(e)
  assert(angler.zoneName === 'battlefield', 'Angler resolved')

  const f = makeEngine()
  put(f, 0, 'Forest', 'battlefield')
  put(f, 0, 'Forest', 'battlefield')
  const c1 = put(f, 0, 'Grizzly Bears', 'battlefield', { summoningSick: true }) // convoke ignores summoning sickness
  const c2 = put(f, 0, 'Grizzly Bears', 'battlefield')
  const c3 = put(f, 0, 'Llanowar Elves', 'battlefield')
  const c4 = put(f, 0, 'Soul Warden', 'battlefield')
  const c5 = put(f, 0, 'White Knight', 'battlefield')
  const wurm = put(f, 0, 'Siege Wurm', 'hand') // {5}{G}{G} convoke
  advanceToPriorityAt(f, 'main1')
  assert(f.pending.actions.some((a) => a.type === 'cast' && a.oid === wurm.oid), 'castable with two Forests + five creatures')
  f.choose({ type: 'cast', oid: wurm.oid })
  assert([c1, c2, c3, c4, c5].every((c) => c.status.tapped), 'all five creatures were tapped to convoke')
}

section('305.2 Exploration: an additional land each turn; 402.2 Reliquary Tower: no maximum hand size')
{
  const e = makeEngine()
  put(e, 0, 'Exploration', 'battlefield')
  const l1 = put(e, 0, 'Forest', 'hand')
  const l2 = put(e, 0, 'Forest', 'hand')
  const l3 = put(e, 0, 'Forest', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'playLand', oid: l1.oid })
  assert(e.pending.actions.some((a) => a.type === 'playLand' && a.oid === l2.oid), 'a second land drop is offered')
  e.choose({ type: 'playLand', oid: l2.oid })
  assert(!e.pending.actions.some((a) => a.type === 'playLand' && a.oid === l3.oid), 'but not a third')

  const f = makeEngine()
  put(f, 0, 'Reliquary Tower', 'battlefield')
  for (let i = 0; i < 5; i++) put(f, 0, 'Forest', 'hand') // 12 cards in hand
  advanceToPriorityAt(f, 'main1')
  let g = 0
  while (f.state.activePlayer === 0 && g++ < 40) {
    if (f.pending.kind === 'priority') f.choose({ type: 'pass' })
    else if (f.pending.kind === 'declareAttackers') f.choose({ attackers: [] })
    else break
  }
  assert(f.state.activePlayer === 1 && zone(f.state, 'hand', 0).length === 12, 'no discard at cleanup')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
