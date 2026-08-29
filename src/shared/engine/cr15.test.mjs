// Headless verification, batch 15:
//   choices in hidden zones — Duress / Thoughtseize (reveal + choose + discard),
//   Peek / Gitaxian Probe (look); hybrid and two-brid pip picks; "why can't I
//   play this" reasons; attack preview (who could block each attacker)
// Run: node src/shared/engine/cr15.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { projectGame } from './project.mjs'
import { makeEngine, put, advanceToPriorityAt, keepAll, inZone, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const manual = () => {
  const deck = () => Array(20).fill('Forest')
  return keepAll(new GameEngine({ seed: 'h', startingPlayer: 0, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] }).start())
}

section('Duress: reveal, choose a noncreature nonland card, discard it')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const duress = put(e, 0, 'Duress', 'hand')
  const bolt = put(e, 1, 'Lightning Bolt', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')
  let threw = false
  try {
    e.choose({ type: 'cast', oid: duress.oid, targets: [{ kind: 'player', pid: 0 }] })
  } catch {
    threw = true
  }
  assert(threw, '"target opponent": cannot target yourself')
  e.choose({ type: 'cast', oid: duress.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(e.pending.kind === 'chooseFromHand' && e.pending.player === 0 && e.pending.target === 1, 'A chooses from B\'s revealed hand')
  assert(e.pending.cards.includes(bolt.oid) && !e.pending.cards.includes(bear.oid), 'only the noncreature nonland cards are choosable')
  assert(e.state.log.some((l) => /B reveals their hand: .*Lightning Bolt/.test(l.text)), 'the reveal is public (logged)')
  const v = projectGame(e, 0)
  assert(v.pending.hand.some((c) => c.name === 'Grizzly Bears') && v.pending.cards.every((c) => c.cardId !== undefined), 'the view shows the whole revealed hand')
  threw = false
  try {
    e.choose({ oid: bear.oid })
  } catch {
    threw = true
  }
  assert(threw, 'a non-matching card is rejected')
  e.choose({ oid: bolt.oid })
  assert(inZone(e, 1, 'graveyard', bolt.oid), 'B discarded the Bolt')
  assert(inZone(e, 0, 'graveyard', duress.oid) && e.pending.kind === 'priority', 'Duress finished resolving')
}

section('Thoughtseize: any nonland card, and you lose 2 life; Peek just looks')
{
  const e = makeEngine()
  put(e, 0, 'Swamp', 'battlefield')
  const ts = put(e, 0, 'Thoughtseize', 'hand')
  const bear = put(e, 1, 'Grizzly Bears', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: ts.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(e)
  assert(e.pending.kind === 'chooseFromHand' && e.pending.cards.includes(bear.oid), 'creatures are choosable with Thoughtseize')
  e.choose({ oid: bear.oid })
  assert(inZone(e, 1, 'graveyard', bear.oid) && e.state.players[0].life === 18, 'discarded, and A lost 2')

  const f = manual()
  put(f, 0, 'Island', 'battlefield')
  const peek = put(f, 0, 'Peek', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: peek.oid, targets: [{ kind: 'player', pid: 1 }] })
  bothPass(f)
  assert(f.pending.kind === 'lookAtHand' && f.pending.player === 0 && f.pending.cards.length === 7, 'A looks at B\'s seven cards')
  const hand = zone(f.state, 'hand', 0).length
  f.choose({})
  assert(zone(f.state, 'hand', 0).length === hand + 1, 'then drew a card')
}

section('Hybrid and two-brid pips can be paid the way the caster says')
{
  const e = makeEngine()
  const m1 = put(e, 0, 'Mountain', 'battlefield')
  const m2 = put(e, 0, 'Mountain', 'battlefield')
  const f1 = put(e, 0, 'Forest', 'battlefield')
  const f2 = put(e, 0, 'Forest', 'battlefield')
  const gang = put(e, 0, 'Boggart Ram-Gang', 'hand') // {R/G}{R/G}{R/G}
  advanceToPriorityAt(e, 'main1')
  const act = e.pending.actions.find((a) => a.type === 'cast' && a.oid === gang.oid)
  assert(act.hybrid?.length === 3, 'the action lists three hybrid pips')
  let threw = false
  try {
    e.choose({ type: 'cast', oid: gang.oid, hybrid: ['U', 'R', 'R'] })
  } catch {
    threw = true
  }
  assert(threw, 'a colour outside the pip is rejected')
  e.choose({ type: 'cast', oid: gang.oid, hybrid: ['G', 'G', 'R'] })
  assert(f1.status.tapped && f2.status.tapped && (m1.status.tapped !== m2.status.tapped), 'two Forests and one Mountain were tapped, as asked')

  const g = makeEngine()
  put(g, 0, 'Plains', 'battlefield')
  for (let i = 0; i < 4; i++) put(g, 0, 'Mountain', 'battlefield')
  const sp = put(g, 0, 'Spectral Procession', 'hand') // {2/W}{2/W}{2/W}
  advanceToPriorityAt(g, 'main1')
  g.choose({ type: 'cast', oid: sp.oid, twobrid: ['W', '2', '2'] })
  assert(zone(g.state, 'battlefield').every((o) => g.state.objects[o].status.tapped || g.state.objects[o].token), 'Plains for one pip, four Mountains for the other two')
}

section('The priority decision explains why a hand card cannot be played')
{
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const angel = put(e, 0, 'Serra Angel', 'hand')
  const div = put(e, 0, 'Divination', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(!e.pending.reasons[bolt.oid], 'the Bolt is castable: no reason')
  assert(/not enough mana/.test(e.pending.reasons[angel.oid]), `Angel: "${e.pending.reasons[angel.oid]}"`)
  e.choose({ type: 'pass' })
  e.choose({ type: 'pass' }) // main 1 ends: beginning of combat, A has priority
  assert(/sorcery timing/.test(e.pending.reasons[div.oid]), `Divination outside a main phase: "${e.pending.reasons[div.oid]}"`)
  const f = makeEngine()
  put(f, 0, 'Swamp', 'battlefield')
  put(f, 0, 'Swamp', 'battlefield')
  const murder = put(f, 0, 'Murder', 'hand')
  advanceToPriorityAt(f, 'main1')
  assert(/no legal target/.test(f.pending.reasons[murder.oid]), 'Murder with no creature in play: no legal target')
}

section('Declare-attackers carries who could block each attacker')
{
  const e = makeEngine()
  const flyer = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false })
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const wall = put(e, 1, 'Typhoid Rats', 'battlefield')
  const tapped = put(e, 1, 'Grizzly Bears', 'battlefield', { tapped: true })
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  const cb = e.pending.canBeBlockedBy
  assert(cb[flyer.oid].length === 0, 'nothing can block the flyer')
  assert(cb[bear.oid].length === 1 && cb[bear.oid][0] === wall.oid, 'only the untapped Rats can block the bear')
  void tapped
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
