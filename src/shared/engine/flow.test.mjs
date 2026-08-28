// Integration smoke for engine-mode wiring: drives a whole game through the same
// surface the renderer uses (pending decisions + projectGame + auto-pass settle)
// with a trivial scripted bot. Asserts the loop progresses and terminates
// without throwing or hanging.
// Run: node src/shared/engine/flow.test.mjs

import { GameEngine } from './engine.mjs'
import { projectGame } from './project.mjs'
import { makeAsserter, keepAll } from './_testutil.mjs'

const { assert, stats } = makeAsserter()

// Mirror of the store's auto-pass fast-forward.
function settle(engine) {
  let g = 0
  while (
    engine.state.pending?.kind === 'priority' &&
    (engine.state.pending.actions?.length || 0) <= 1 &&
    g++ < 2000
  )
    engine.choose({ type: 'pass' })
}

const deck = () => [
  ...Array(12).fill('Forest'),
  'Llanowar Elves',
  'Llanowar Elves',
  'Grizzly Bears',
  'Grizzly Bears',
  'Grizzly Bears',
  'Elvish Visionary',
  'Elvish Visionary',
  'Rumbling Baloth',
  'Lightning Bolt',
  'Lightning Bolt'
]

const e = new GameEngine({ seed: 'flow', startingPlayer: 0, players: [{ name: 'A', deck: deck() }, { name: 'B', deck: deck() }] })
e.start()
keepAll(e)
settle(e)

let steps = 0
let castCount = 0
let combats = 0
let projectionsOk = true

while (steps++ < 4000) {
  const v = projectGame(e)
  if (!v || !Array.isArray(v.players) || v.players.length !== 2) {
    projectionsOk = false
    break
  }
  const p = e.state.pending
  if (!p) break
  if (p.kind === 'gameOver') break
  if (e.state.turnNumber > 12) break // long enough to exercise everything

  if (p.kind === 'priority') {
    const acts = p.actions
    const land = acts.find((a) => a.type === 'playLand')
    const creature = acts.find((a) => a.type === 'cast' && a.needsTargets === 0)
    if (land) e.choose(land)
    else if (creature) {
      e.choose({ type: 'cast', oid: creature.oid })
      castCount++
    } else e.choose({ type: 'pass' })
  } else if (p.kind === 'declareAttackers') {
    if (p.eligible.length) combats++
    e.choose({ attackers: p.eligible }) // swing with everyone
  } else if (p.kind === 'declareBlockers') {
    e.choose({ blocks: {} }) // never block
  } else if (p.kind === 'discard') {
    e.choose({ discard: p.hand.slice(0, p.count) })
  } else {
    throw new Error('unexpected pending ' + p.kind)
  }
  settle(e)
}

console.log('\nengine-mode flow smoke')
assert(projectionsOk, 'projectGame produced a valid view at every step')
assert(steps < 4000, 'game loop terminated (did not hang)')
assert(castCount > 0, `creatures were cast (${castCount})`)
assert(combats > 0, `combat happened (${combats} declare-attacker steps with attackers)`)
const bf = e.state.zones.battlefield.length
assert(bf > 0, `permanents ended up on the battlefield (${bf})`)
const lifeChanged = e.state.players.some((p) => p.life !== 20)
assert(lifeChanged, 'life totals changed over the game')

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
