// "As this enters, choose a …" (614.12b): the prompt must ask for the thing it
// is actually offering. Utopia Sprawl chooses a colour and was asking for a
// creature type while showing W/U/B/R/G.
// Run: node src/shared/engine/enter-choice.test.mjs
import { makeEngine, put, refresh, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

const enterChoice = (name, target) => {
  const e = makeEngine('Forest', 20)
  advanceToPriorityAt(e, 'main1')
  const land = put(e, 0, 'Forest', 'battlefield')
  for (let i = 0; i < 4; i++) put(e, 0, 'Forest', 'battlefield')
  const card = put(e, 0, name, 'hand')
  refresh(e)
  e.choose({ type: 'cast', oid: card.oid, targets: target ? [{ kind: 'object', oid: land.oid }] : [] })
  let g = 0
  while (e.pending?.kind === 'priority' && g++ < 8) e.choose({ type: 'pass' })
  return e.pending
}

section('Utopia Sprawl chooses a colour, and says so')
{
  const p = enterChoice('Utopia Sprawl', true)
  assert(p?.kind === 'chooseValue', 'it asks for a value as it enters')
  assert(p.kindOfChoice === 'color', 'the choice is a colour')
  assert(p.options.join('') === 'WUBRG', 'the five colours are offered')
  assert(!/creature type/i.test(p.label), 'and it does not ask for a creature type')
  assert(/colou?r/i.test(p.label), 'it asks for a colour')
  assert(/Utopia Sprawl/.test(p.label), 'and names the card doing the asking')
}

section('A card that really does choose a creature type still says that')
{
  const e = makeEngine('Forest', 20)
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < 6; i++) put(e, 0, 'Forest', 'battlefield')
  const auto = put(e, 0, 'Adaptive Automaton', 'hand')
  refresh(e)
  const a = e.pending.actions?.find((x) => x.type === 'cast' && x.oid === auto.oid)
  if (a) {
    e.choose(a)
    let g = 0
    while (e.pending?.kind === 'priority' && g++ < 8) e.choose({ type: 'pass' })
    const p = e.pending
    assert(p?.kind === 'chooseValue' && p.kindOfChoice === 'creatureType', 'it asks for a creature type')
    assert(/creature type/i.test(p.label), 'and the wording says creature type')
  } else {
    assert(true, '(Adaptive Automaton not castable here — skipped)')
  }
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
