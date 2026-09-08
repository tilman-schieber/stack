// A triggered ability that targets a card in a graveyard.
//
// Archaeomancer ("When this creature enters, return target instant or sorcery
// card from your graveyard to your hand") did nothing at all: the trigger was
// dropped before it reached the stack because the "is there a legal target"
// check was run without knowing whose ability it was, so "your graveyard"
// matched nobody's. Picking a target then fizzled anyway, because the ability
// on the stack did not remember that its target lives in a graveyard and was
// judged by the rule for permanents.
// Run: node src/shared/engine/graveyard-targets.test.mjs
import { makeEngine, put, refresh, advanceToPriorityAt, inZone, makeAsserter } from './_testutil.mjs'
import { zone } from './state.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const logOf = (e) => e.state.log.map((l) => l.text).join('\n')

// Cast `name` from hand with enough Islands to pay for anything in this file,
// and pass priority until the game asks something other than for priority.
const scene = (name, fill) => {
  const e = makeEngine('Island', 40)
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < 8; i++) put(e, 0, 'Island', 'battlefield')
  const extra = fill(e)
  const card = put(e, 0, name, 'hand')
  refresh(e)
  return { e, card, ...extra }
}
const castIt = (e, card) => {
  const a = e.pending.actions.find((x) => x.type === 'cast' && x.oid === card.oid)
  if (!a) throw new Error(`${card.printed.name} is not castable`)
  e.choose(a)
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 20) e.choose({ type: 'pass' })
}

section('Archaeomancer asks for a card in your graveyard')
{
  const { e, card, bolt } = scene('Archaeomancer', (e) => ({
    bolt: put(e, 0, 'Lightning Bolt', 'graveyard')
  }))
  castIt(e, card)
  assert(e.pending.kind === 'chooseTargets', `the trigger asks for its target (got ${e.pending.kind})`)
  assert(e.pending.name === 'Archaeomancer', 'and says which ability is asking')
  assert(e.pending.targets?.[0]?.type === 'graveyardCard', 'the slot is a card in a graveyard')
  assert(e.pending.player === 0, 'the choice belongs to the ability’s controller')

  e.choose({ targets: [{ kind: 'object', oid: bolt.oid }] })
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 20) e.choose({ type: 'pass' })
  assert(inZone(e, 0, 'hand', bolt.oid), 'the chosen card comes back to hand')
  assert(!inZone(e, 0, 'graveyard', bolt.oid), 'and leaves the graveyard')
  assert(/Lightning Bolt returns to its owner's hand/.test(logOf(e)), 'the log says so')
  assert(!/fizzles/.test(logOf(e)), 'and the ability does not fizzle on a target that never moved')
}

section('…and only at a card the ability can actually reach')
{
  const { e, card, bear, theirs } = scene('Archaeomancer', (e) => ({
    bear: put(e, 0, 'Grizzly Bears', 'graveyard'),
    theirs: put(e, 1, 'Lightning Bolt', 'graveyard'),
    mine: put(e, 0, 'Lightning Bolt', 'graveyard')
  }))
  castIt(e, card)
  const refuses = (oid, what) => {
    let err = null
    try {
      e.choose({ targets: [{ kind: 'object', oid }] })
    } catch (x) {
      err = x.message
    }
    assert(/illegal target/.test(err || ''), `${what} is refused (${err})`)
    assert(e.pending.kind === 'chooseTargets', `and the question is still standing after ${what}`)
  }
  refuses(bear.oid, 'a creature card')
  refuses(theirs.oid, "an instant in the opponent's graveyard")
}

section('With nothing to return, the trigger never goes on the stack')
{
  const { e, card } = scene('Archaeomancer', (e) => ({ bear: put(e, 0, 'Grizzly Bears', 'graveyard') }))
  castIt(e, card)
  assert(e.pending.kind === 'priority', `no target, no question (got ${e.pending.kind})`)
  assert(e.state.objects[card.oid].zoneName === 'battlefield', 'the creature still enters')
}

section("Mortuary Mire reaches its own controller's graveyard too")
{
  const e = makeEngine('Island', 40)
  advanceToPriorityAt(e, 'main1')
  const bear = put(e, 0, 'Grizzly Bears', 'graveyard')
  const mire = put(e, 0, 'Mortuary Mire', 'hand')
  refresh(e)
  const a = e.pending.actions.find((x) => x.type === 'playLand' && x.oid === mire.oid)
  assert(!!a, 'the land can be played')
  e.choose(a)
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 20) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'chooseTargets', `its trigger asks for a creature card (got ${e.pending.kind})`)
  e.choose({ targets: [{ kind: 'object', oid: bear.oid }] })
  g = 0
  while (e.pending.kind === 'priority' && g++ < 20) e.choose({ type: 'pass' })
  assert(!inZone(e, 0, 'graveyard', bear.oid), 'the card leaves the graveyard')
  assert(zone(e.state, 'library', 0)[0] === bear.oid, 'and goes on top of the library')
}

section('The computer can answer a graveyard target')
{
  const { botChoose } = await import('./bot.mjs')
  const e = makeEngine('Island', 40)
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < 8; i++) put(e, 1, 'Island', 'battlefield')
  const bolt = put(e, 1, 'Lightning Bolt', 'graveyard')
  put(e, 1, 'Grizzly Bears', 'graveyard')
  const card = put(e, 1, 'Archaeomancer', 'hand')
  // Hand priority to the other seat by passing through to their main phase.
  let g = 0
  while (!(e.pending.kind === 'priority' && e.pending.player === 1 && e.state.step === 'main1' && e.state.activePlayer === 1) && g++ < 200)
    e.choose({ type: 'pass' })
  refresh(e)
  const a = e.pending.actions.find((x) => x.type === 'cast' && x.oid === card.oid)
  assert(!!a, 'the computer can cast it')
  e.choose(a)
  g = 0
  while (e.pending.kind === 'priority' && g++ < 20) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'chooseTargets', `the trigger asks (got ${e.pending.kind})`)
  const answer = botChoose(e, 1)
  assert(answer?.targets?.[0]?.oid === bolt.oid, 'and the computer names the instant, not a permanent')
  e.choose(answer)
  g = 0
  while (e.pending.kind === 'priority' && g++ < 20) e.choose({ type: 'pass' })
  assert(inZone(e, 1, 'hand', bolt.oid), 'which the engine accepts')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
