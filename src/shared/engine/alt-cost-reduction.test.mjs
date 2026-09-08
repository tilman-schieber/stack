// Cost reductions apply to alternative costs too (601.2f).
//
// The total cost of a spell is built from whichever cost is being paid — the
// printed one or an alternative like evoke — and increases and reductions are
// applied to that. Evoke, overload and mutate all bypassed the reduction step,
// so a Sunscape Familiar discounted the hard cast and did nothing for the evoke.
// Run: node src/shared/engine/alt-cost-reduction.test.mjs
import { makeEngine, put, refresh, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'
import { zone } from './state.mjs'
import { formatManaCost, parseManaCost } from './cards.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// `islands` untapped Islands, optionally a Sunscape Familiar ("green and blue
// spells you cast cost {1} less"), and `name` in hand.
const scene = (islands, familiar, name) => {
  const e = makeEngine('Island', 40)
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < islands; i++) put(e, 0, 'Island', 'battlefield')
  if (familiar) put(e, 0, 'Sunscape Familiar', 'battlefield')
  const card = put(e, 0, name, 'hand')
  refresh(e)
  return { e, card }
}
const labels = (e, card) => e.pending.actions.filter((a) => a.oid === card.oid).map((a) => a.label)
const untappedIslands = (e) =>
  zone(e.state, 'battlefield', 0)
    .map((o) => e.state.objects[o])
    .filter((o) => o.printed.name === 'Island' && !o.status.tapped).length

section('Mulldrifter evokes for {2}{U} on its own')
{
  const { e, card } = scene(3, false, 'Mulldrifter')
  assert(labels(e, card).some((l) => l.includes('evoke {2}{U}')), `the printed evoke cost (${labels(e, card)})`)
  assert(!labels(e, card).some((l) => l === 'Mulldrifter'), 'and {4}{U} is out of reach on three lands')
}

section('…and for {1}{U} with a Sunscape Familiar out')
{
  const { e, card } = scene(3, true, 'Mulldrifter')
  assert(labels(e, card).some((l) => l.includes('evoke {1}{U}')), `the discount shows in the label (${labels(e, card)})`)
  const ev = e.pending.actions.find((a) => a.oid === card.oid && a.evoke)
  e.choose(ev)
  assert(untappedIslands(e) === 1, `and only two lands are actually spent (${untappedIslands(e)} left)`)
}

section('The discount is what makes it castable at all')
{
  const { e, card } = scene(2, false, 'Mulldrifter')
  assert(labels(e, card).length === 0, 'two lands cannot evoke it unaided')
}
{
  const { e, card } = scene(2, true, 'Mulldrifter')
  const ev = e.pending.actions.find((a) => a.oid === card.oid && a.evoke)
  assert(!!ev, 'two lands and a Familiar can')
  e.choose(ev)
  assert(untappedIslands(e) === 0, 'spending both')
}

section('The hard cast still gets the same discount')
{
  const { e, card } = scene(4, true, 'Mulldrifter')
  const hard = e.pending.actions.find((a) => a.oid === card.oid && !a.evoke)
  assert(!!hard, 'four lands and a Familiar pay {3}{U}')
  e.choose(hard)
  assert(untappedIslands(e) === 0, 'spending all four')
}

section('A cost written back out reads the way a card prints it')
{
  const round = (c) => formatManaCost(parseManaCost(c))
  assert(round('{4}{U}') === '{4}{U}', 'generic before colour')
  assert(round('{X}{R}{R}') === '{X}{R}{R}', 'X first')
  assert(round('{B/R}{2/W}{U/P}') === '{B/R}{2/W}{U/P}', 'hybrid, two-brid and Phyrexian survive the trip')
  assert(round('{0}') === '{0}', 'and a free spell is {0}, not nothing at all')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
