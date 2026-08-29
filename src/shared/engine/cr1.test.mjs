// Headless verification, CR gap analysis batch 1:
//   400.7  an object that changes zones is a new object (effects/choices end)
//   104.4  simultaneous loss is a draw; 104.3a concession
//   107.4  Phyrexian {U/P} and two-brid {2/W} mana symbols
// Run: node src/shared/engine/cr1.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { recompute } from './layers.mjs'
import { parseManaCost, manaValue } from './cards.mjs'
import { makeEngine, put, advanceToPriorityAt, keepAll, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}

section('400.7: an until-end-of-turn effect does not follow a card through a zone change')
{
  const e = makeEngine()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(e, 'main1')
  e.state.continuous.push({ timestamp: 99, targets: [bear.oid], modifyPT: { power: 3, toughness: 3 }, duration: 'eot' })
  recompute(e.state)
  assert(bear.chars.power === 5, 'pumped to 5/5')
  e._relocate(bear, 'hand')
  e._relocate(bear, 'battlefield')
  recompute(e.state)
  assert(bear.chars.power === 2 && bear.chars.toughness === 2, 'back on the battlefield it is a fresh 2/2')
}

section('400.7: regeneration shields, once-per-turn flags and morph status do not survive a zone change')
{
  const e = makeEngine()
  const skel = put(e, 0, 'Drudge Skeletons', 'battlefield', { regenShields: 2, abilityUsed: ['x'], attackedThisTurn: true })
  e._relocate(skel, 'hand')
  assert(!skel.status.regenShields && skel.status.abilityUsed.length === 0 && !skel.status.attackedThisTurn, 'per-object bookkeeping cleared')
  const patron = put(e, 0, 'Patron of the Wild', 'battlefield')
  patron.faceDown = true
  e._relocate(patron, 'hand')
  assert(!patron.faceDown, 'a bounced morph is face up in hand')
}

section('400.7: a Clone that leaves the battlefield is a Clone again')
{
  const e = makeEngine()
  const clone = put(e, 0, 'Clone', 'battlefield')
  const angel = put(e, 1, 'Serra Angel', 'battlefield')
  e._applyCopy(clone, angel)
  assert(clone.printed.name === 'Serra Angel', 'copying Serra Angel')
  e._relocate(clone, 'hand')
  assert(clone.printed.name === 'Clone' && clone.copyOf == null, 'in hand it is Clone')
}

section('104.4a: if every player loses at once the game is a draw (no crash)')
{
  const e = makeEngine()
  advanceToPriorityAt(e, 'main1')
  e.state.players[0].life = 0
  e.state.players[1].life = 0
  let threw = false
  try {
    bothPass(e)
  } catch {
    threw = true
  }
  assert(!threw, 'engine survives a simultaneous loss')
  assert(e.pending.kind === 'gameOver' && e.pending.draw && e.pending.winner == null, 'game over: draw')
  assert(e.state.log.some((l) => /draw/.test(l.text)), 'logged as a draw')
}

section('104.3a: conceding ends a 2-player game; in 3 players the game goes on')
{
  const e = makeEngine()
  advanceToPriorityAt(e, 'main1')
  e.concede(1)
  assert(e.pending.kind === 'gameOver' && e.pending.winner === 0, 'the opponent wins')

  const deck = () => Array(20).fill('Forest')
  const g = new GameEngine({
    seed: 'c3',
    startingPlayer: 0, autoOrderTriggers: true,
    players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }, { name: 'C', deck: deck() }]
  }).start()
  keepAll(g)
  advanceToPriorityAt(g, 'main1')
  g.choose({ type: 'pass' }) // priority to B
  assert(g.pending.player === 1, 'B has priority')
  g.concede(1) // B concedes while deciding
  assert(g.state.players[1].hasLost && g.state.winner == null, 'B is out, game continues')
  assert(g.pending.kind === 'priority' && g.pending.player !== 1, 'a remaining player has priority')
  g.concede(0)
  assert(g.pending.kind === 'gameOver' && g.pending.winner === 2, 'C wins when A also concedes')
}

section('107.4f Phyrexian mana: paid with the colour if available, else 2 life')
{
  const c = parseManaCost('{1}{B/P}{B/P}')
  assert(c.phyrexian?.join('') === 'BB' && manaValue(c) === 3, 'Dismember: {1}{B/P}{B/P} parses, MV 3')
  const e = makeEngine()
  put(e, 0, 'Mountain', 'battlefield')
  const dis = put(e, 0, 'Dismember', 'hand')
  const bear = put(e, 1, 'Serra Angel', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  e.choose({ type: 'cast', oid: dis.oid, targets: [{ kind: 'object', oid: bear.oid }] })
  assert(e.state.players[0].life === 16, 'paid 4 life for the two Phyrexian pips')
  bothPass(e)
  assert(inZone(e, 1, 'graveyard', bear.oid), 'Serra Angel died to -5/-5')

  const f = makeEngine()
  put(f, 0, 'Island', 'battlefield')
  const probe = put(f, 0, 'Gitaxian Probe', 'hand')
  advanceToPriorityAt(f, 'main1')
  f.choose({ type: 'cast', oid: probe.oid }) // (its look-at-hand effect isn't authored; only the cost matters here)
  assert(f.state.players[0].life === 20, 'with an Island available the pip is paid with mana')

  const g = makeEngine()
  const probe2 = put(g, 0, 'Gitaxian Probe', 'hand')
  g.state.players[0].life = 1
  advanceToPriorityAt(g, 'main1')
  refresh(g)
  assert(!g.pending.actions.some((a) => a.type === 'cast' && a.oid === probe2.oid), 'at 1 life with no mana it cannot be cast (119.4)')
}

section('107.4e two-brid {2/W}: the colour or two generic')
{
  const c = parseManaCost('{2/W}{2/W}{2/W}')
  assert(c.twobrid?.length === 3 && manaValue(c) === 6, 'Spectral Procession parses, MV 6')
  const e = makeEngine()
  for (let i = 0; i < 3; i++) put(e, 0, 'Plains', 'battlefield')
  const sp = put(e, 0, 'Spectral Procession', 'hand')
  advanceToPriorityAt(e, 'main1')
  assert(e.pending.actions.some((a) => a.type === 'cast' && a.oid === sp.oid), 'castable off three Plains')
  const f = makeEngine()
  for (let i = 0; i < 5; i++) put(f, 0, 'Mountain', 'battlefield')
  const sp2 = put(f, 0, 'Spectral Procession', 'hand')
  advanceToPriorityAt(f, 'main1')
  assert(!f.pending.actions.some((a) => a.type === 'cast' && a.oid === sp2.oid), 'not castable off five Mountains')
  put(f, 0, 'Mountain', 'battlefield')
  assert(f.pending.actions.some((a) => a.type === 'cast' && a.oid === sp2.oid), 'castable off six Mountains')
  f.choose({ type: 'cast', oid: sp2.oid })
  bothPass(f)
  assert(zone(f.state, 'battlefield').filter((o) => f.state.objects[o].token).length === 3, 'three Spirit tokens')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
