// Headless verification: games with more than two players (rule 800/802). Turn
// order and priority rotate through all seats; a player may attack any opponent;
// each attacked opponent declares its own blockers; a player at 0 life leaves the
// game and the game continues until one player remains.
// Run: node src/shared/engine/multiplayer.test.mjs

import { zone } from './state.mjs'
import { GameEngine } from './engine.mjs'
import { createObject, zoneKey } from './state.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// A three-player engine, hands kept.
function make3() {
  const deck = Array(20).fill('Forest')
  const e = new GameEngine({
    seed: '3p', startingPlayer: 0, autoOrderTriggers: true,
    players: [{ name: 'A', deck }, { name: 'B', deck }, { name: 'C', deck }]
  }).start()
  let g = 0
  while (e.pending && (e.pending.kind === 'mulligan' || e.pending.kind === 'bottom') && g++ < 90) {
    if (e.pending.kind === 'mulligan') e.choose({ keep: true })
    else e.choose({ bottom: e.pending.hand.slice(0, e.pending.count) })
  }
  return e
}
function put(e, pid, name, zoneName, status = {}) {
  const o = createObject(e.state, SAMPLE_CARDS[name], pid)
  o.zoneName = zoneName
  if (zoneName === 'battlefield') o.controller = pid
  Object.assign(o.status, status)
  e.state.zones[zoneKey(zoneName, pid)].push(o.oid)
  return o
}
function toAttackers(e) {
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 200) {
    const p = e.pending
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else e.choose({})
  }
}

section('Turn order rotates A -> B -> C -> A')
{
  const e = make3()
  const seen = []
  let g = 0
  while (seen.length < 4 && g++ < 6000) {
    const p = e.pending
    if (e.state.step === 'upkeep' && seen[seen.length - 1] !== e.state.activePlayer) seen.push(e.state.activePlayer)
    if (p.kind === 'priority') e.choose({ type: 'pass' })
    else if (p.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (p.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (p.kind === 'discard') e.choose({ discard: p.hand.slice(0, p.count) })
    else e.choose({})
  }
  assert(seen.slice(0, 4).join() === '0,1,2,0', `turns went ${seen.slice(0, 4).join(' -> ')}`)
}

section('Priority passes through all three players before the stack resolves')
{
  const e2 = make3()
  put(e2, 0, 'Mountain', 'battlefield')
  const b2 = put(e2, 0, 'Lightning Bolt', 'hand')
  let g = 0
  while (!(e2.state.step === 'main1' && e2.pending.player === 0) && g++ < 200) {
    if (e2.pending.kind === 'priority') e2.choose({ type: 'pass' })
    else e2.choose({})
  }
  e2.choose({ type: 'cast', oid: b2.oid, targets: [{ kind: 'player', pid: 2 }] })
  // Bolt is on the stack; it should take three passes (0,1,2) to resolve.
  assert(zone(e2.state, 'stack').length === 1, 'Bolt on the stack')
  e2.choose({ type: 'pass' }) // player 0
  assert(zone(e2.state, 'stack').length === 1 && e2.pending.player === 1, 'still on stack, player 1 to act')
  e2.choose({ type: 'pass' }) // player 1
  assert(zone(e2.state, 'stack').length === 1 && e2.pending.player === 2, 'still on stack, player 2 to act')
  e2.choose({ type: 'pass' }) // player 2 -> resolves
  assert(zone(e2.state, 'stack').length === 0, 'after all three passed, Bolt resolved')
  assert(e2.state.players[2].life === 17, 'player 2 (a chosen opponent) took the 3 damage')
}

section('A player can attack a chosen opponent, who blocks with their own creatures')
{
  const e = make3()
  const atk = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // A attacks
  put(e, 1, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // B (not attacked) has a blocker
  const cBlk = put(e, 2, 'Grizzly Bears', 'battlefield', { summoningSick: false }) // C is attacked
  toAttackers(e)
  const defenders = e.pending.defenders.map((d) => d.pid).filter((x) => x != null)
  assert(defenders.includes(1) && defenders.includes(2), 'both opponents are legal attack targets')
  e.choose({ attackers: [{ oid: atk.oid, defender: { player: 2 } }] })
  // Pass priority to reach declareBlockers; only player 2 should be asked to block.
  let g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 50) e.choose({ type: 'pass' })
  assert(e.pending.player === 2, 'the attacked player (C) declares blockers')
  assert(e.pending.eligible.includes(cBlk.oid), 'C may block with its creature')
  e.choose({ blocks: {} }) // C takes it
  g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 50) e.choose({ type: 'pass' })
  assert(e.state.players[2].life === 18, 'C took 2 combat damage; A and B are untouched at 20')
  assert(e.state.players[1].life === 20, 'the non-attacked player B is unharmed')
}

section('A player who hits 0 life leaves the game; the game continues')
{
  const e = make3()
  e.state.players[1].life = 0
  e._checkSBA()
  assert(e.state.players[1].hasLost, 'player 1 has left the game')
  assert(e.state.winner == null, 'the game continues (two players remain)')
  // Now player 2 also loses -> player 0 wins.
  e.state.players[2].life = -1
  e._checkSBA()
  assert(e.state.winner === 0, 'with only player 0 left, they win')
}

section('"Each opponent discards" prompts every opponent, not just one')
{
  const e = make3()
  for (let i = 0; i < 4; i++) put(e, 0, 'Swamp', 'battlefield')
  const fam = put(e, 0, 'Refurbished Familiar', 'hand') // ETB: each opponent discards
  let g = 0
  while (!(e.state.step === 'main1' && e.pending.player === 0 && e.pending.kind === 'priority') && g++ < 200) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else e.choose({})
  }
  e.choose({ type: 'cast', oid: fam.oid, targets: [] })
  const prompted = []
  g = 0
  while (g++ < 200) {
    const p = e.pending
    if (p.kind === 'discardCards') {
      prompted.push(p.player)
      e.choose({ discard: p.hand.slice(0, 1) })
    } else if (p.kind === 'priority') {
      if (prompted.length >= 2) break
      e.choose({ type: 'pass' })
    } else break
  }
  assert(prompted.includes(1) && prompted.includes(2), `both opponents discarded (prompted: ${prompted.join()})`)
}

section('If the active player leaves the game mid-turn, their turn ends')
{
  const e = make3()
  let g = 0
  while (!(e.state.step === 'main1' && e.pending.player === 0 && e.pending.kind === 'priority') && g++ < 200) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else e.choose({})
  }
  e.state.players[0].life = 0 // the active player is about to lose
  e._grantPriorityTo(0) // the engine checks SBAs here
  assert(e.state.players[0].hasLost, 'the active player left the game')
  assert(e.state.winner == null, 'the game continues')
  assert(e.state.activePlayer === 1, 'the turn passed to the next player')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
