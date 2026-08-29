// Headless verification, CR gap analysis batch 7: the Commander format (903) —
// 40 life, commanders in the command zone, casting with the commander tax, the
// command-zone return, and the 21-damage rule (704.6c).
// Run: node src/shared/engine/cr7.test.mjs

import { GameEngine } from './engine.mjs'
import { projectGame } from './project.mjs'
import { zone } from './state.mjs'
import { keepAll, put, advanceToPriorityAt, combat, inZone, makeAsserter, refresh } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const bothPass = (e) => {
  e.choose({ type: 'pass' })
  if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
}
const mk = () => {
  const deck = () => Array(30).fill('Plains')
  return keepAll(
    new GameEngine({
      seed: 'cmd',
      startingPlayer: 0,
      autoOrderTriggers: true,
      format: 'commander',
      players: [
        { name: 'A', deck: deck(), commander: 'Serra Angel' },
        { name: 'B', deck: deck(), commander: 'Grizzly Bears' }
      ]
    }).start()
  )
}
const cmdOf = (e, pid) => zone(e.state, 'command').map((o) => e.state.objects[o]).find((o) => o.owner === pid)

section('903.6/903.7: commanders start in the command zone; 40 life')
{
  const e = mk()
  assert(e.state.players.every((p) => p.life === 40), '40 life each')
  const angel = cmdOf(e, 0)
  assert(angel && angel.printed.name === 'Serra Angel' && angel.isCommander && angel.zoneName === 'command', "A's Serra Angel is in the command zone")
  const v = projectGame(e, 1)
  assert(v.format === 'commander' && v.players[0].command[0].name === 'Serra Angel', 'the view shows the command zone')
}

section('903.8: cast from the command zone; the tax grows by {2} each time')
{
  const e = mk()
  for (let i = 0; i < 5; i++) put(e, 0, 'Plains', 'battlefield')
  const angel = cmdOf(e, 0)
  advanceToPriorityAt(e, 'main1')
  refresh(e)
  assert(e.pending.actions.some((a) => a.type === 'cast' && a.oid === angel.oid), 'castable from the command zone for {3}{W}{W}')
  e.choose({ type: 'cast', oid: angel.oid })
  bothPass(e)
  assert(angel.zoneName === 'battlefield' && angel.commanderCasts === 1, 'on the battlefield; one cast recorded')
  e._bury(angel) // "dies"
  e._checkSBA()
  assert(angel.zoneName === 'command', '903.9: it went back to the command zone')
  assert(e.state.log.some((l) => /returns to the command zone/.test(l.text)), 'logged')
  for (const o of zone(e.state, 'battlefield').map((x) => e.state.objects[x])) o.status.tapped = false
  refresh(e)
  assert(!e.pending.actions.some((a) => a.type === 'cast' && a.oid === angel.oid), 'five lands no longer pay {3}{W}{W} + {2}')
  put(e, 0, 'Plains', 'battlefield')
  put(e, 0, 'Plains', 'battlefield')
  refresh(e)
  assert(e.pending.actions.some((a) => a.type === 'cast' && a.oid === angel.oid), 'seven do')
}

section('704.6c: 21 combat damage from one commander loses the game')
{
  const e = mk()
  const bears = cmdOf(e, 1)
  const angel = cmdOf(e, 0)
  // Put A's commander onto the battlefield as a big attacker.
  e._relocate(angel, 'battlefield')
  e._enterBattlefield(angel, 0)
  angel.status.summoningSick = false
  e.state.continuous.push({ timestamp: ++e.state.tsCounter, targets: [angel.oid], modifyPT: { power: 16, toughness: 0 }, duration: 'permanent' })
  combat(e, [angel.oid]) // 20 combat damage from the commander
  assert(e.state.players[1].life === 20 && e.state.players[1].commanderDamage[angel.oid] === 20, '20 commander damage tracked, 20 life left')
  assert(e.state.winner == null, 'still alive at 20')
  // Next turn: one more point.
  let g = 0
  while (!(e.state.activePlayer === 0 && e.state.turnNumber === 3) && g++ < 80) {
    if (e.pending.kind === 'priority') e.choose({ type: 'pass' })
    else if (e.pending.kind === 'declareAttackers') e.choose({ attackers: [] })
    else if (e.pending.kind === 'declareBlockers') e.choose({ blocks: {} })
    else if (e.pending.kind === 'discard') e.choose({ discard: e.pending.hand.slice(0, e.pending.count) })
    else break
  }
  combat(e, [angel.oid])
  assert(e.pending.kind === 'gameOver' && e.pending.winner === 0, 'B loses to 21+ commander damage while at positive life')
  void bears
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
