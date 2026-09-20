// The board that lost the game is still there to look at.
//
// Rule 800.4's "leaves the game" clean-up exists so a multiplayer game can carry
// on without the player who left: their permanents are removed, anything they
// controlled reverts. Running it on the loss that *ends* a two-player game only
// sweeps away the position both players are staring at (104.2a — the game just
// ends), which reads as a bug and loses the thing you wanted to see.
// Run: node src/shared/engine/game-end.test.mjs
import { GameEngine } from './engine.mjs'
import { makeEngine, keepAll, put, refresh, advanceToPriorityAt, inZone, makeAsserter } from './_testutil.mjs'
import { objectsIn } from './state.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const onBattlefield = (e, name) => objectsIn(e.state, 'battlefield').filter((o) => o.printed.name === name)

section('Losing to damage leaves the battlefield exactly as it was')
{
  const e = makeEngine('Forest', 30)
  advanceToPriorityAt(e, 'main1')
  const mine = put(e, 0, 'Grizzly Bears', 'battlefield')
  const theirs = put(e, 1, 'Serra Angel', 'battlefield')
  put(e, 0, 'Mountain', 'battlefield')
  const bolt = put(e, 0, 'Lightning Bolt', 'hand')
  e.state.players[0].life = 1
  refresh(e)
  const a = e.pending.actions.find((x) => x.type === 'cast' && x.oid === bolt.oid)
  e.choose({ ...a, targets: [{ kind: 'player', pid: 0 }] })
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 10) e.choose({ type: 'pass' })

  assert(e.pending.kind === 'gameOver', `the game is over (got ${e.pending.kind})`)
  assert(e.state.winner === 1, 'and the other player won')
  assert(e.state.objects[mine.oid].zoneName === 'battlefield', "the loser's creature is still on the battlefield")
  assert(e.state.objects[theirs.oid].zoneName === 'battlefield', "and so is the winner's")
  assert(!inZone(e, 0, 'exile', mine.oid), 'nothing was swept into exile')
  assert(e.state.players[0].hasLost, 'the loss itself is still recorded')
}

section('The log says what happened, once')
{
  const e = makeEngine('Forest', 30)
  advanceToPriorityAt(e, 'main1')
  e.state.players[0].life = 0
  e._checkSBA()
  const log = e.state.log.map((l) => l.text).join('\n')
  assert(/A loses the game/.test(log), 'the loss is logged')
  assert(/wins the game/.test(log), 'and so is the win')
}

section('A multiplayer game that carries on still clears the player who left')
{
  // With someone still playing against someone else, 800.4 is exactly right:
  // the departed player's permanents have to go, or they sit there affecting a
  // game their controller is no longer in.
  const deck = Array(30).fill('Forest')
  const e = keepAll(
    new GameEngine({
      seed: 'test',
      startingPlayer: 0,
      autoOrderTriggers: true,
      players: [
        { name: 'A', deck },
        { name: 'B', deck },
        { name: 'C', deck }
      ]
    }).start()
  )
  const doomed = put(e, 1, 'Grizzly Bears', 'battlefield')
  const survivor = put(e, 2, 'Serra Angel', 'battlefield')
  e.state.players[1].life = 0
  e._checkSBA()

  assert(e.state.players[1].hasLost, 'B is out')
  assert(e.state.winner == null, 'but the game goes on')
  assert(e.state.objects[doomed.oid].zoneName === 'exile', "B's creature left the game (800.4a)")
  assert(e.state.objects[survivor.oid].zoneName === 'battlefield', "C's is untouched")
  assert(onBattlefield(e, 'Grizzly Bears').length === 0, 'and nothing of B is left on the battlefield')
}

section('The last loss of a multiplayer game leaves the rest of the board alone')
{
  const deck = Array(30).fill('Forest')
  const e = keepAll(
    new GameEngine({
      seed: 'test',
      startingPlayer: 0,
      autoOrderTriggers: true,
      players: [
        { name: 'A', deck },
        { name: 'B', deck },
        { name: 'C', deck }
      ]
    }).start()
  )
  const b = put(e, 1, 'Grizzly Bears', 'battlefield')
  const c = put(e, 2, 'Serra Angel', 'battlefield')
  e.state.players[1].life = 0
  e._checkSBA()
  assert(e.state.objects[b.oid].zoneName === 'exile', 'the first to go is cleared away as before')
  // Now the second loss ends it, and the winner's board stays put.
  e.state.players[0].life = 0
  e._checkSBA()
  assert(e.state.winner === 2, `C won (winner=${e.state.winner})`)
  assert(e.state.objects[c.oid].zoneName === 'battlefield', "and C's board is still there to look at")
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
