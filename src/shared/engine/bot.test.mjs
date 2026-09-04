// Headless verification: the computer opponent plays whole games without ever
// handing the engine an illegal answer, against itself with several decks and
// seeds, and makes the obvious plays (land, creature, attack into an empty
// board, block when it trades up, chump when lethal is coming).
// Run: node src/shared/engine/bot.test.mjs

import { GameEngine } from './engine.mjs'
import { zone } from './state.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { botChoose, botFallback } from './bot.mjs'
import { makeEngine, put, advanceToPriorityAt, keepAll, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

const have = (names) => names.filter((n) => SAMPLE_CARDS[n])
const deck = (lands, spells) => {
  const out = []
  for (const [q, n] of spells) for (let i = 0; i < q; i++) out.push(n)
  while (out.length < 60) out.push(lands)
  return out
}
const RED = deck('Mountain', [[4, 'Lightning Bolt'], [4, 'Raging Goblin'], [4, 'Goblin Piker'], [3, 'Hill Giant'], [3, 'Boggart Brute'], [2, 'Shock'], [3, 'Mogg Fanatic'], [3, 'Goblin King'], [2, 'Flametongue Kavu'], [2, 'Shivan Dragon'], [2, 'Forked Bolt'], [2, 'Act of Treason'], [2, 'Dragon Fodder']].filter(([, n]) => SAMPLE_CARDS[n]))
const WHITE = deck('Plains', [[4, 'Soul Warden'], [4, 'White Knight'], [3, 'Serra Angel'], [3, 'Kor Skyfisher'], [4, 'Thraben Inspector'], [3, 'Fencing Ace'], [2, 'Palace Sentinels'], [3, 'Isamaru, Hound of Konda'], [2, 'Glorious Anthem'], [3, 'Raise the Alarm'], [2, 'Pacifism'], [2, 'Battle Screech'], [2, 'Flickerwisp']].filter(([, n]) => SAMPLE_CARDS[n]))
const GREEN = deck('Forest', [[4, 'Llanowar Elves'], [4, 'Grizzly Bears'], [4, 'Elvish Visionary'], [3, 'Rumbling Baloth'], [3, 'Giant Spider'], [2, 'Craw Wurm'], [3, 'Giant Growth'], [2, 'Rancor'], [2, 'Servant of the Scale'], [2, 'Great Sable Stag'], [2, 'Young Wolf'], [2, 'Fog'], [2, 'Siege Wurm']].filter(([, n]) => SAMPLE_CARDS[n]))
const BLACK = deck('Swamp', [[4, 'Typhoid Rats'], [4, 'Vampire Nighthawk'], [3, 'Doom Blade'], [2, 'Murder'], [3, 'Sign in Blood'], [2, 'Blood Artist'], [2, 'Phyrexian Arena'], [3, 'Duress'], [2, 'Thorn of the Black Rose'], [2, 'Gurmag Angler'], [2, 'Bog Wraith'], [2, 'Chainer\'s Edict'], [2, 'Dregscape Zombie']].filter(([, n]) => SAMPLE_CARDS[n]))
void have

// Play a whole game with both seats driven by the bot. Returns stats.
function playGame(seed, d0, d1) {
  const e = new GameEngine({ seed, players: [{ name: 'Bot A', deck: d0 }, { name: 'Bot B', deck: d1 }] }).start()
  let decisions = 0
  let fallbacks = 0
  let errors = 0
  while (e.pending && e.pending.kind !== 'gameOver' && decisions < 6000) {
    const pid = e.pending.player
    decisions++
    let answer = null
    try {
      answer = botChoose(e, pid)
      e.choose(answer)
    } catch (err) {
      fallbacks++
      if (fallbacks <= 3) console.error(`  (fallback at ${e.pending.kind} turn ${e.state.turnNumber}: ${err.message} — answer ${JSON.stringify(answer)})`)
      try {
        e.choose(botFallback(e, pid))
      } catch (err2) {
        errors++
        console.error(`  fallback failed: ${err2.message}`)
        break
      }
    }
  }
  return { e, decisions, fallbacks, errors, over: e.pending?.kind === 'gameOver', turns: e.state.turnNumber, winner: e.state.winner }
}

section('Bot vs bot: whole games end, with no illegal answers')
{
  const pairs = [
    ['red-vs-white', RED, WHITE],
    ['green-vs-black', GREEN, BLACK],
    ['white-vs-green', WHITE, GREEN],
    ['black-vs-red', BLACK, RED]
  ]
  let i = 0
  for (const [name, d0, d1] of pairs)
    for (const seed of ['s1', 's2']) {
      const r = playGame(`${name}-${seed}`, d0, d1)
      i++
      assert(r.over && r.errors === 0, `${name}/${seed}: game over in ${r.turns} turns after ${r.decisions} decisions (winner ${r.winner})`)
      assert(r.fallbacks === 0, `${name}/${seed}: no fallbacks needed (${r.fallbacks})`)
      assert(r.turns >= 5 && r.turns < 80, `${name}/${seed}: a plausible game length (${r.turns} turns)`)
    }
}

section('The obvious plays')
{
  const e = makeEngine()
  const land = put(e, 0, 'Mountain', 'hand')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  advanceToPriorityAt(e, 'main1')
  let a = botChoose(e, 0)
  assert(a.type === 'playLand', 'plays a land first')
  e.choose(a)
  put(e, 0, 'Mountain', 'battlefield')
  a = botChoose(e, 0)
  assert(a.type === 'cast' && a.oid === bolt.oid && a.targets[0].kind === 'player' && a.targets[0].pid === 1, 'with nothing to kill, Bolts the opponent')
  void land
  const f = makeEngine()
  f.state.players[0].landsPlayed = 1 // no land drop left: the bot must cast
  put(f, 0, 'Mountain', 'battlefield')
  const bolt2 = put(f, 0, 'Lightning Bolt', 'hand')
  const angel = put(f, 1, 'Serra Angel', 'battlefield')
  put(f, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  a = botChoose(f, 0)
  assert(a.type === 'cast' && a.oid === bolt2.oid && a.targets[0].oid !== angel.oid, 'does not Bolt a 4-toughness Angel (it picks the best creature it can kill, or face)')
  put(f, 0, 'Forest', 'battlefield')
  put(f, 0, 'Forest', 'battlefield')
  const bear = put(f, 0, 'Grizzly Bears', 'hand')
  a = botChoose(f, 0)
  assert(a.type === 'cast' && (a.oid === bear.oid || a.oid === bolt2.oid), 'casts something useful')
  void bear
}

section('Attacks and blocks')
{
  const e = makeEngine()
  const big = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false })
  const small = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  put(e, 1, 'Hill Giant', 'battlefield') // 3/3 can block and kill the Bears
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  const a = botChoose(e, 0)
  const ids = a.attackers.map((x) => x.oid)
  assert(ids.includes(big.oid) && !ids.includes(small.oid), 'attacks with the flying Angel, keeps the Bears home')

  const f = makeEngine()
  const atk = put(f, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const giant = put(f, 1, 'Hill Giant', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  g = 0
  while (f.pending.kind !== 'declareAttackers' && g++ < 20) f.choose({ type: 'pass' })
  f.choose({ attackers: [atk.oid] })
  g = 0
  while (f.pending.kind !== 'declareBlockers' && g++ < 20) f.choose({ type: 'pass' })
  const b = botChoose(f, 1)
  assert(b.blocks[giant.oid] === atk.oid, 'the Giant blocks and eats the Bears')

  const h = makeEngine()
  h.state.players[1].life = 3
  const atk2 = put(h, 0, 'Serra Angel', 'battlefield', { summoningSick: false })
  const chump = put(h, 1, 'Kor Skyfisher', 'battlefield')
  advanceToPriorityAt(h, 'main1')
  g = 0
  while (h.pending.kind !== 'declareAttackers' && g++ < 20) h.choose({ type: 'pass' })
  h.choose({ attackers: [atk2.oid] })
  g = 0
  while (h.pending.kind !== 'declareBlockers' && g++ < 20) h.choose({ type: 'pass' })
  const c = botChoose(h, 1)
  assert(c.blocks[chump.oid] === atk2.oid, 'at 3 life it chump-blocks the Angel with the Drake')
}

section('Mulligans and the other decisions')
{
  const deck7lands = Array(60).fill('Forest')
  const e = new GameEngine({ seed: 'm', startingPlayer: 0, players: [{ name: 'A', deck: deck7lands }, { name: 'B', deck: deck7lands }] }).start()
  keepAll(e) // handles nothing bot-specific; just check the bot's opinion first
  void e
  const f = new GameEngine({ seed: 'm2', startingPlayer: 0, players: [{ name: 'A', deck: deck7lands }, { name: 'B', deck: deck7lands }] }).start()
  let g = 0
  while (f.pending.kind === 'playOrDraw' && g++ < 3) f.choose(botChoose(f, f.pending.player))
  assert(f.pending.kind === 'mulligan', 'a mulligan decision')
  const m = botChoose(f, f.pending.player)
  assert(m.keep === false, 'seven lands: mulligans')
  const b = makeEngine()
  put(b, 0, 'Swamp', 'battlefield')
  const duress = put(b, 0, 'Duress', 'hand')
  put(b, 1, 'Lightning Bolt', 'hand')
  put(b, 1, 'Serra Angel', 'hand')
  put(b, 1, 'Counterspell', 'hand')
  advanceToPriorityAt(b, 'main1')
  b.choose({ type: 'cast', oid: duress.oid, targets: [{ kind: 'player', pid: 1 }] })
  b.choose({ type: 'pass' })
  b.choose({ type: 'pass' })
  assert(b.pending.kind === 'chooseFromHand', 'Duress resolves to a hand choice')
  const pick = botChoose(b, 0)
  assert(b.state.objects[pick.oid].printed.name === 'Counterspell', 'takes the most expensive matching card')
  void zone
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
