// A trigger on the stack says what it does.
//
// Two Mulldrifter triggers were two identical rows reading "Mulldrifter —
// ability", and "order your triggers" offered the same word twice. Neither the
// stack nor the ordering prompt carried the one thing needed to tell them
// apart, so the ability now travels with the line of its own card's text.
// Run: node src/shared/engine/trigger-text.test.mjs
import { GameEngine } from './engine.mjs'
import { keepAll, put, refresh, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'
import { projectGame } from './project.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// An engine that asks about trigger order rather than settling it silently.
const mk = () =>
  keepAll(
    new GameEngine({
      seed: 'test',
      startingPlayer: 0,
      autoOrderTriggers: false,
      players: [
        { name: 'A', deck: Array(60).fill('Island') },
        { name: 'B', deck: Array(60).fill('Island') }
      ]
    }).start()
  )
const table = (extra = () => {}) => {
  const e = mk()
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < 12; i++) put(e, 0, 'Island', 'battlefield')
  extra(e)
  refresh(e)
  return e
}
const castIt = (e, card) => {
  const a = e.pending.actions.find((x) => x.type === 'cast' && x.oid === card.oid && !x.evoke)
  if (!a) throw new Error(`${card.printed.name} is not castable`)
  e.choose(a)
}
// Pass until the stack holds an ability, and return the view of it.
const abilityOnStack = (e) => {
  for (let i = 0; i < 12; i++) {
    const v = projectGame(e, 0)
    const ab = v.stack.find((x) => x.kind === 'ability')
    if (ab) return ab
    if (e.pending.kind !== 'priority') return null
    e.choose({ type: 'pass' })
  }
  return null
}

section("A triggered ability carries its own line of the card's text")
{
  const e = table((e) => put(e, 0, 'Mulldrifter', 'hand'))
  const mull = e.pending.actions.find((a) => a.type === 'cast' && !a.evoke)
  castIt(e, { oid: mull.oid, printed: { name: 'Mulldrifter' } })
  const ab = abilityOnStack(e)
  assert(!!ab, 'the trigger reaches the stack')
  assert(ab.name === 'Mulldrifter — ability', 'named after its source')
  assert(/draw two cards/i.test(ab.text || ''), `and says what it does (${ab.text})`)
}

section('A spell on the stack says what it does too')
{
  const e = table((e) => put(e, 0, 'Ponder', 'hand'))
  const card = e.pending.actions.find((a) => a.type === 'cast')
  e.choose(card)
  const v = projectGame(e, 0)
  const sp = v.stack.find((x) => x.kind === 'spell')
  assert(!!sp && /look at the top three/i.test(sp.text || ''), `the spell carries its text (${sp?.text})`)
}

section('Ordering two different triggers offers what each one does')
{
  // Soul Warden watching a Mulldrifter enter: two triggers, one controller, two
  // quite different effects — exactly the choice that used to be unanswerable.
  const e = table((e) => {
    put(e, 0, 'Soul Warden', 'battlefield')
    put(e, 0, 'Mulldrifter', 'hand')
  })
  const mull = e.pending.actions.find((a) => a.type === 'cast' && !a.evoke)
  e.choose(mull)
  let g = 0
  while (e.pending.kind === 'priority' && g++ < 12) e.choose({ type: 'pass' })
  assert(e.pending.kind === 'orderTriggers', `the order is asked for (got ${e.pending.kind})`)
  const texts = e.pending.triggers.map((t) => t.text || '')
  assert(e.pending.triggers.length === 2, 'both triggers are offered')
  assert(texts.some((t) => /gain 1 life/i.test(t)), `one of them gains life (${texts.join(' | ')})`)
  assert(texts.some((t) => /draw two cards/i.test(t)), 'and the other draws two')
  assert(
    e.pending.triggers.every((t) => t.name),
    'each still says which card it came from'
  )
}

section('A trigger with no text to find still names its source')
{
  // A game trigger (the monarch's draw) has no card behind it at all; the stack
  // must still be able to describe it rather than rendering an empty row.
  const e = table()
  e.state.pendingTriggers.push({
    controller: 0,
    sourceOid: null,
    subjectOid: null,
    name: 'The Monarch',
    effect: [{ op: 'draw', amount: 1 }],
    targetSpec: []
  })
  e._advanceTriggerPlacement()
  const ab = abilityOnStack(e)
  assert(!!ab && ab.name === 'The Monarch', `it is named (${ab?.name})`)
  assert(ab.text === '', 'and carries no text rather than a broken one')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
