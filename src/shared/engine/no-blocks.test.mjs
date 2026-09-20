// Blockers are only asked for when a block is actually possible.
//
// The game used to stop and ask for a declaration whenever anything was
// attacking, even with an empty board on the other side, or with one groundling
// facing a flier. An unanswerable question reads as though a block were being
// missed, and it costs a click every combat.
// Run: node src/shared/engine/no-blocks.test.mjs
import { makeEngine, put, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// Attack with everything `attackers` names, then report what the game asked for
// on the way to combat damage.
const attackWith = (e, attackers) => {
  let g = 0
  while (e.pending.kind !== 'declareAttackers' && g++ < 50) e.choose({ type: 'pass' })
  e.choose({ attackers })
  let asked = null
  g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'combatDamage' && g++ < 50) {
    e.choose({ type: 'pass' })
    if (e.pending.kind === 'declareBlockers') {
      asked = e.pending
      break
    }
  }
  return asked
}
const scene = () => {
  const e = makeEngine('Forest', 30)
  advanceToPriorityAt(e, 'main1')
  return e
}

section('An empty board on the other side is not a decision')
{
  const e = scene()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  assert(attackWith(e, [bear.oid]) === null, 'no creatures, no question')
  assert(e.state.players[1].life === 18, 'and the damage still lands')
}

section('Nor is a creature that cannot block this attacker')
{
  const e = scene()
  const angel = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false }) // flying
  put(e, 1, 'Grizzly Bears', 'battlefield')
  assert(attackWith(e, [angel.oid]) === null, 'a groundling facing a flier is asked nothing')
  assert(e.state.players[1].life === 16, 'and takes the 4')
}
{
  const e = scene()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  put(e, 1, 'Grizzly Bears', 'battlefield', { tapped: true })
  assert(attackWith(e, [bear.oid]) === null, 'a tapped creature is asked nothing either')
}

section('But a real choice is still put to the defender')
{
  const e = scene()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  const wall = put(e, 1, 'Grizzly Bears', 'battlefield')
  const asked = attackWith(e, [bear.oid])
  assert(asked !== null, 'a creature that can block is asked about')
  assert(asked.player === 1, 'and it is the defender who is asked')
  assert(asked.eligible.includes(wall.oid), 'with the blocker offered')
}

section('Only the creatures that can block this attack are offered')
{
  // One flier and one groundling against a flying attacker: the groundling is
  // not a blocker here, and offering it only invites a click the engine refuses.
  const e = scene()
  const angel = put(e, 0, 'Serra Angel', 'battlefield', { summoningSick: false })
  const flier = put(e, 1, 'Serra Angel', 'battlefield')
  const ground = put(e, 1, 'Grizzly Bears', 'battlefield')
  const asked = attackWith(e, [angel.oid])
  assert(asked !== null, 'the flier makes it a real question')
  assert(asked.eligible.includes(flier.oid), 'the flier is offered')
  assert(!asked.eligible.includes(ground.oid), 'and the groundling is not')
}

section('Skipping the question changes nothing else about combat')
{
  const e = scene()
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield', { summoningSick: false })
  attackWith(e, [bear.oid])
  const log = e.state.log.map((l) => l.text).join('\n')
  assert(/doesn't block/.test(log), 'the log still records that no block was made')
  let g = 0
  while (e.pending.kind === 'priority' && e.state.step !== 'main2' && g++ < 50) e.choose({ type: 'pass' })
  assert(e.state.step === 'main2', 'and combat runs through to main 2')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
