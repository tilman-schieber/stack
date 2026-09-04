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

// Pass until `pid` holds priority at `step` of `active`'s turn (an instant-speed window).
const toWindow = (e, pid, active, step) => {
  let g = 0
  while (!(e.state.activePlayer === active && e.state.step === step && e.pending.kind === 'priority' && e.pending.player === pid) && g++ < 200) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count ?? 1) })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (e.pending.kind === 'declareBlockers') e.choose({ blocks: {} })
    else throw new Error(`unexpected decision ${e.pending.kind}`)
  }
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
  assert(a.type === 'pass', 'with nothing to kill and no race on, holds the Bolt')
  e.state.players[1].life = 3
  a = botChoose(e, 0)
  assert(a.type === 'cast' && a.oid === bolt.oid && a.targets[0].kind === 'player' && a.targets[0].pid === 1, 'at 3 life: Bolts the opponent for lethal')
  void land
  const f = makeEngine()
  f.state.players[0].landsPlayed = 1 // no land drop left: the bot must cast
  put(f, 0, 'Mountain', 'battlefield')
  const bolt2 = put(f, 0, 'Lightning Bolt', 'hand')
  const angel = put(f, 1, 'Serra Angel', 'battlefield')
  put(f, 1, 'Grizzly Bears', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  a = botChoose(f, 0)
  assert(a.type === 'pass', 'instant-speed removal waits for the opponent\'s turn')
  put(f, 0, 'Forest', 'battlefield')
  put(f, 0, 'Forest', 'battlefield')
  const bear = put(f, 0, 'Grizzly Bears', 'hand')
  a = botChoose(f, 0)
  assert(a.type === 'cast' && a.oid === bear.oid, 'casts the creature instead')
  f.choose(a)
  f.choose({ type: 'pass' })
  f.choose({ type: 'pass' })
  toWindow(f, 0, 1, 'end')
  a = botChoose(f, 0)
  assert(a.type === 'cast' && a.oid === bolt2.oid && a.targets[0].oid !== angel.oid && a.targets[0].kind === 'object', 'at their end step: Bolts the Bears, not the 4-toughness Angel')
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

section('Holds removal for a real target; uses it at the opponent\'s end step')
{
  const e = makeEngine()
  e.state.players[0].landsPlayed = 1
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  const elf = put(e, 1, 'Llanowar Elves', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  let a = botChoose(e, 0)
  assert(a.type === 'pass', 'a 1/1 mana elf is not worth a Bolt: holds it (no face burn either, not racing)')
  void elf
  toWindow(e, 0, 1, 'end')
  a = botChoose(e, 0)
  assert(a.type === 'pass', 'still nothing worth it at their end step')
  const bear = put(e, 1, 'Grizzly Bears', 'battlefield')
  a = botChoose(e, 0)
  assert(a.type === 'cast' && a.oid === bolt.oid && a.targets[0].oid === bear.oid, 'a 2/2 is worth it: Bolts the Bears at the end of their turn')
}

section('Counters a threatening spell at instant speed')
{
  const e = makeEngine()
  put(e, 0, 'Island', 'battlefield')
  put(e, 0, 'Island', 'battlefield')
  const cs = put(e, 0, 'Counterspell', 'hand')
  for (let i = 0; i < 5; i++) put(e, 1, 'Plains', 'battlefield')
  const angel = put(e, 1, 'Serra Angel', 'hand')
  advanceToPriorityAt(e, 'main1')
  toWindow(e, 1, 1, 'main1')
  e.choose({ type: 'cast', oid: angel.oid })
  assert(e.pending.kind === 'priority' && e.pending.player === 1, 'B holds priority after casting')
  e.choose({ type: 'pass' })
  assert(e.pending.player === 0, 'A may respond')
  const a = botChoose(e, 0)
  assert(a.type === 'cast' && a.oid === cs.oid && a.targets[0].kind === 'spell' && a.targets[0].oid === angel.oid, 'Counterspell on the Angel')
}

section('Combat tricks: a pump that wins the fight; a Fog when lethal is coming')
{
  const e = makeEngine()
  put(e, 0, 'Forest', 'battlefield')
  const gg = put(e, 0, 'Giant Growth', 'hand')
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const giant = put(e, 1, 'Hill Giant', 'battlefield')
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ attackers: [bear.oid] })
  g = 0
  while (e.pending.kind !== 'declareBlockers' && g++ < 20) e.choose({ type: 'pass' })
  e.choose({ blocks: { [giant.oid]: bear.oid } })
  assert(e.pending.kind === 'priority' && e.pending.player === 0, 'A has priority after blocks')
  const a = botChoose(e, 0)
  assert(a.type === 'cast' && a.oid === gg.oid && a.targets[0].oid === bear.oid, 'Giant Growth on the blocked Bears: it survives and kills the Giant')

  const f = makeEngine()
  f.state.players[1].life = 3
  put(f, 1, 'Forest', 'battlefield')
  const fog = put(f, 1, 'Fog', 'hand')
  const angel = put(f, 0, 'Serra Angel', 'battlefield', { summoningSick: false })
  advanceToPriorityAt(f, 'main1')
  g = 0
  while (f.pending.kind !== 'declareAttackers' && g++ < 20) f.choose({ type: 'pass' })
  f.choose({ attackers: [angel.oid] })
  f.choose({ type: 'pass' }) // A passes in the declare-attackers window
  assert(f.pending.kind === 'priority' && f.pending.player === 1 && f.state.step === 'declareAttackers', 'B may respond to the attack')
  const b = botChoose(f, 1)
  assert(b.type === 'cast' && b.oid === fog.oid, 'at 3 life facing 4 in the air: Fog')
}

section('Who is the beatdown: the alpha strike at lethal, patience otherwise')
{
  const e = makeEngine()
  e.state.players[1].life = 2
  const b1 = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const b2 = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  put(e, 1, 'Hill Giant', 'battlefield') // one blocker that eats a Bears
  advanceToPriorityAt(e, 'main1')
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 20) e.choose({ type: 'pass' })
  const a = botChoose(e, 0)
  assert(a.attackers.length === 2, 'at 2 life one Bears gets through past the single blocker: both attack')
  const f = makeEngine()
  f.state.players[1].life = 10
  put(f, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  put(f, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  put(f, 1, 'Hill Giant', 'battlefield')
  put(f, 1, 'Serra Angel', 'battlefield')
  advanceToPriorityAt(f, 'main1')
  g = 0
  while (f.pending.kind !== 'declareAttackers' && g++ < 20) f.choose({ type: 'pass' })
  const b = botChoose(f, 0)
  assert(b.attackers.length === 0, 'outclassed on board and not the beatdown: no bad attacks into the Giant and the Angel')
  void b1
  void b2
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
