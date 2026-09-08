// Mana a source produced but the cost didn't need stays in the pool (106.4).
//
// Tapping Azorius Chancery ({T}: Add {W}{U}) to pay {W} used to throw the {U}
// away, and the same for every source that makes more than one mana: Sol Ring
// tapped for {1}, Urza's Tower tapped for {2}. The whole mana ability resolves,
// so all of it lands in the pool and only what is spent leaves.
// Run: node src/shared/engine/floating-mana.test.mjs
import { makeEngine, put, refresh, advanceToPriorityAt, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const pool = (e, pid = 0) => e.state.players[pid].manaPool
const total = (p) => Object.values(p).reduce((a, b) => a + b, 0)

// A board with `lands`, then cast `spell` from hand (targeting the bear if it
// needs a target).
const scene = (lands, spell) => {
  const e = makeEngine('Forest', 30)
  advanceToPriorityAt(e, 'main1')
  const sources = lands.map((n) => put(e, 0, n, 'battlefield'))
  const bear = put(e, 0, 'Grizzly Bears', 'battlefield')
  const card = put(e, 0, spell, 'hand')
  refresh(e)
  return { e, sources, bear, card }
}
const cast = (e, card, targets = []) => {
  const a = e.pending.actions.find((x) => x.type === 'cast' && x.oid === card.oid)
  if (!a) throw new Error(`${card.printed.name} is not castable`)
  e.choose({ ...a, targets })
}

section('A Karoo tapped for a one-pip spell keeps its other pip')
{
  const { e, sources, bear, card } = scene(['Azorius Chancery'], 'Ephemerate') // {W}
  cast(e, card, [{ kind: 'object', oid: bear.oid }])
  assert(e.state.objects[sources[0].oid].status.tapped, 'the Chancery is tapped')
  assert(pool(e).W === 0, 'the {W} paid for the spell')
  assert(pool(e).U === 1, `and the {U} is still there (pool ${JSON.stringify(pool(e))})`)
  assert(/left in their mana pool/.test(e.state.log.map((l) => l.text).join('\n')), 'the log says what is floating')
}

section('Nothing is left over when the whole source is spent')
{
  const { e, card } = scene(['Azorius Chancery'], 'Meddling Mage') // {W}{U}
  cast(e, card)
  assert(total(pool(e)) === 0, `the pool is empty (${JSON.stringify(pool(e))})`)
}

section('Two mana of one colour: Sol Ring paying {1}')
{
  const e = makeEngine('Forest', 30)
  advanceToPriorityAt(e, 'main1')
  const ring = put(e, 0, 'Sol Ring', 'battlefield')
  put(e, 0, 'Bonesplitter', 'hand')
  refresh(e)
  const eq = e.pending.actions.find((x) => x.type === 'cast' && x.label?.startsWith('Bonesplitter')) // {1}
  assert(!!eq, 'Bonesplitter is castable off Sol Ring')
  e.choose(eq)
  assert(e.state.objects[ring.oid].status.tapped, 'Sol Ring is tapped')
  assert(pool(e).C === 1, `one colourless is still floating (pool ${JSON.stringify(pool(e))})`)
}

section('Floating mana pays the next spell before anything else taps')
{
  const { e, sources, bear, card } = scene(['Azorius Chancery', 'Island'], 'Ephemerate')
  cast(e, card, [{ kind: 'object', oid: bear.oid }])
  assert(pool(e).U === 1, 'the {U} floats')
  const island = sources[1]
  assert(!e.state.objects[island.oid].status.tapped, 'the Island is still untapped')
  // Let the first spell resolve; the pool survives until the step ends.
  e.choose({ type: 'pass' })
  e.choose({ type: 'pass' })
  // Now a {U} spell: it should spend the floating mana, not tap the Island.
  const two = put(e, 0, 'Ponder', 'hand') // {U}
  refresh(e)
  const a = e.pending.actions.find((x) => x.type === 'cast' && x.oid === two.oid)
  assert(!!a, 'the second spell is castable')
  e.choose(a)
  assert(pool(e).U === 0, 'the floating mana was spent')
  assert(!e.state.objects[island.oid].status.tapped, 'and the Island stayed untapped')
}

section('The pool empties at the end of the step, as always')
{
  const { e, bear, card } = scene(['Azorius Chancery'], 'Ephemerate')
  cast(e, card, [{ kind: 'object', oid: bear.oid }])
  assert(pool(e).U === 1, 'floating after the cast')
  let g = 0
  while (e.pending.kind === 'priority' && e.state.step === 'main1' && g++ < 20) e.choose({ type: 'pass' })
  assert(pool(e).U === 0, `and gone once the step ends (pool ${JSON.stringify(pool(e))})`)
}

section('Tapping a Karoo by hand is one action, not one per colour')
{
  const e = makeEngine('Forest', 30)
  advanceToPriorityAt(e, 'main1')
  const ch = put(e, 0, 'Azorius Chancery', 'battlefield')
  refresh(e)
  const taps = e.pending.actions.filter((a) => a.type === 'tapForMana' && a.oid === ch.oid)
  assert(taps.length === 1, `one way to tap it (got ${taps.length}: ${taps.map((t) => t.label).join(' / ')})`)
  assert(taps[0].label === 'Tap for {W}{U}', `labelled with both pips (got "${taps[0].label}")`)
  e.choose(taps[0])
  assert(pool(e).W === 1 && pool(e).U === 1, `both pips land in the pool (${JSON.stringify(pool(e))})`)
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
