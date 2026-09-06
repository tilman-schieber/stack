// Who plays first (103.1), and whether you can tell.
//
// The roll is fair, but only its winner is asked to play or draw — and a
// computer answers that instantly, so losing the roll produced no visible
// moment at all and felt like always winning.
// Run: node src/shared/engine/die-roll.test.mjs
import { GameEngine } from './engine.mjs'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const deck = Array(40).fill('Forest')
const game = (opts) => new GameEngine({ players: [{ name: 'A', deck }, { name: 'B', deck }], ...opts }).start()

section('The die roll is a coin, not a formality')
{
  // Exactly the seeds the app makes: 'game-' + Date.now(), a few ms apart.
  const t0 = 1750000000000
  for (const [gap, label] of [[1, 'consecutive milliseconds'], [1000, 'a second apart'], [30000, 'half a minute apart']]) {
    const counts = [0, 0]
    for (let i = 0; i < 600; i++) counts[game({ seed: 'game-' + (t0 + i * gap) }).state.startingPlayer]++
    const pct = (counts[0] / 6).toFixed(0)
    assert(counts[0] > 220 && counts[1] > 220, `${label}: ${counts[0]}/${counts[1]} — ${pct}% seat 0, not lopsided`)
  }
}

section('Both outcomes actually happen, and each is written down')
{
  const seats = new Set()
  for (let i = 0; i < 40; i++) seats.add(game({ seed: 'roll-' + i }).state.startingPlayer)
  assert(seats.has(0) && seats.has(1), 'both players win it across a run of games')

  const e = game({ seed: 'roll-7' })
  const winner = e.state.players[e.state.startingPlayer].name
  const log = e.state.log.map((l) => l.text).join('\n')
  assert(/wins the die roll/.test(log), 'the roll is recorded in the log')
  assert(new RegExp(`${winner} wins the die roll`).test(log), 'and it names the player who won it')
}

section('A fixed starting player is not a die roll and does not claim to be')
{
  const e = game({ seed: 'x', startingPlayer: 1 })
  assert(e.state.startingPlayer === 1, 'an explicit starting player is honoured')
  assert(!/die roll/.test(e.state.log.map((l) => l.text).join('\n')), 'and no roll is reported')
}

section('Later games of a match are chosen, not rolled (103.6)')
{
  const e = game({ seed: 'x', playDrawChooser: 1 })
  assert(e.state.startingPlayer === 1, 'the loser of the last game decides')
  const log = e.state.log.map((l) => l.text).join('\n')
  assert(!/die roll/.test(log), 'no die roll is claimed')
  assert(/lost the last game/.test(log), 'and the log says why they are choosing')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
