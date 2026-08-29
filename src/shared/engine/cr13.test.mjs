// Headless verification, CR gap analysis batch 13 (the last approximations):
//   103.5  London mulligans in rounds, bottoming afterwards in turn order
//   702.22c the band's controller divides a blocker's damage
//   310.11a a Siege's controller chooses which opponent protects it
// Run: node src/shared/engine/cr13.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { put, advanceToPriorityAt, keepAll, inZone, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const deck = () => Array(20).fill('Forest')
const manual = (n = 2, seed = 'm') =>
  new GameEngine({ seed, startingPlayer: 0, players: Array.from({ length: n }, (_, i) => ({ name: 'ABC'[i], deck: deck() })) }).start()

section('103.5: mulligan decisions go around in rounds; bottoming happens after everyone kept')
{
  const e = manual(3)
  assert(e.pending.kind === 'mulligan' && e.pending.player === 0, 'A decides first')
  e.choose({ keep: false }) // A mulligans
  assert(e.pending.player === 1 && zone(e.state, 'hand', 0).length === 7, "B decides before A redraws")
  e.choose({ keep: true }) // B keeps
  assert(e.pending.player === 2, 'C decides')
  e.choose({ keep: false }) // C mulligans
  // Round 2: A and C redrew and decide again; B is done.
  assert(e.pending.kind === 'mulligan' && e.pending.player === 0 && e.pending.mulligans === 1, 'round 2: A again, one mulligan taken')
  assert(zone(e.state, 'hand', 0).length === 7 && e.state.players[2].mulligans === 1, 'both redrew seven')
  e.choose({ keep: true })
  assert(e.pending.player === 2 && e.pending.mulligans === 1, 'then C')
  e.choose({ keep: false })
  assert(e.pending.player === 2 && e.pending.mulligans === 2, 'round 3: only C')
  e.choose({ keep: true })
  // Bottoming, in turn order: A bottoms 1, then C bottoms 2.
  assert(e.pending.kind === 'bottom' && e.pending.player === 0 && e.pending.count === 1, 'A bottoms 1')
  e.choose({ bottom: [e.pending.hand[0]] })
  assert(e.pending.kind === 'bottom' && e.pending.player === 2 && e.pending.count === 2, 'C bottoms 2')
  e.choose({ bottom: e.pending.hand.slice(0, 2) })
  assert(e.state.turnNumber === 1 && zone(e.state, 'hand', 0).length === 6 && zone(e.state, 'hand', 1).length === 7 && zone(e.state, 'hand', 2).length === 5, 'game on: 6 / 7 / 5 cards')
}

section('702.22c: the band controller divides the blocker\'s damage')
{
  const e = keepAll(manual(2, 'band'))
  const hero = put(e, 0, 'Benalish Hero', 'battlefield', { summoningSick: false }) // 1/1 banding
  const angel = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false }) // 4/4
  const blocker = put(e, 1, 'Gurmag Angler', 'battlefield', { summoningSick: false }) // 5/5
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ attackers: [{ oid: hero.oid, band: 'A' }, { oid: angel.oid, band: 'A' }] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ blocks: { [blocker.oid]: hero.oid } }) // blocks the Hero: the whole band is blocked
  g = 0
  while (e.pending.kind === 'priority' && g++ < 10) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'bandDamage' && e.pending.player === 0 && e.pending.blocker.power === 5, 'A divides the Angler\'s 5 damage')
  let threw = false
  try {
    e.choose({ assignment: { [hero.oid]: 1, [angel.oid]: 3 } })
  } catch {
    threw = true
  }
  assert(threw, 'must divide exactly 5')
  e.choose({ assignment: { [hero.oid]: 1, [angel.oid]: 4 } })
  assert(inZone(e, 0, 'graveyard', hero.oid) && inZone(e, 0, 'graveyard', angel.oid), 'the split killed both (1 to the 1/1, 4 to the 4/4)')
  assert(inZone(e, 1, 'graveyard', blocker.oid), 'the band dealt 1 + 4 to the 5/5 blocker, which died')
}

section('310.11a: with several opponents the Siege controller chooses its protector')
{
  const e = keepAll(manual(3, 'siege'))
  for (let i = 0; i < 3; i++) put(e, 0, 'Mountain', 'battlefield')
  const inv = put(e, 0, 'Invasion of Regatha // Disciples of the Inferno', 'hand')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: inv.oid })
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 5) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'chooseProtector' && e.pending.choices.length === 2, 'asked which of the two opponents protects it')
  e.choose({ pid: 2 })
  assert(inv.zoneName === 'battlefield' && inv.protector === 2, 'C protects it')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
