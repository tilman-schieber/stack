// Paying a hybrid or two-brid pip, the way the interface actually sends it.
//
// The pip picker sends both lists whenever it is shown, so a card with only
// hybrid pips arrives with `twobrid: []`. That empty array is truthy, and the
// guard tested the array rather than its length — which refused every hybrid
// card cast through the picker.
// Run: node src/shared/engine/hybrid-mana.test.mjs
import { makeEngine, put, refresh, advanceToPriorityAt, inZone, makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// A board with `lands` untapped basics of `basic`, and `name` in hand.
const board = (name, basic = 'Forest', lands = 4) => {
  const e = makeEngine(basic, 20)
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < lands; i++) put(e, 0, basic, 'battlefield')
  const card = put(e, 0, name, 'hand')
  refresh(e)
  return { e, card }
}
const cast = (e, card, payload) => {
  try {
    e.choose({ type: 'cast', oid: card.oid, targets: [], ...payload })
    return null
  } catch (err) {
    return err.message
  }
}

section('Slippery Bogle — one hybrid pip, {G/U}')
{
  const { e, card } = board('Slippery Bogle')
  const a = e.pending.actions?.find((x) => x.type === 'cast' && x.oid === card.oid)
  assert(!!a, 'it is castable off Forests')
  assert(Array.isArray(a.hybrid) && a.hybrid[0].includes('G') && a.hybrid[0].includes('U'), 'the pip offers green or blue')
  assert(!a.twobrid?.length, 'and it has no two-brid pips')

  // Exactly what the pip picker sends: both lists, one of them empty.
  assert(cast(e, card, { hybrid: ['G'], twobrid: [] }) === null, 'paying the pip with green is accepted')
  let g = 0
  while (e.pending?.kind === 'priority' && g++ < 8) e.choose({ type: 'pass' })
  assert(inZone(e, 0, 'battlefield', card.oid), 'and the Bogle resolves onto the battlefield')
}

section('The same card, every way the choice can arrive')
{
  for (const [payload, label] of [
    [{}, 'no pip lists at all — the engine pays it itself'],
    [{ hybrid: ['G'] }, 'only the hybrid list'],
    [{ hybrid: ['G'], twobrid: [] }, 'both lists, two-brid empty'],
    [{ hybrid: [], twobrid: [] }, 'both lists empty'],
    [{ hybrid: [null], twobrid: [] }, 'an undecided pip'],
    [{ hybrid: ['U'], twobrid: [] }, 'the colour we cannot actually produce']
  ]) {
    const { e, card } = board('Slippery Bogle')
    const err = cast(e, card, payload)
    // Picking blue off Forests is a payment problem, never a validation one.
    assert(err === null || /pay|mana/i.test(err), `${label}: ${err || 'accepted'}`)
    assert(!/illegal two-brid/.test(err || ''), `${label}: not rejected as a two-brid choice`)
  }
}

section('A choice that really is wrong is still refused')
{
  const { e, card } = board('Slippery Bogle')
  assert(/illegal hybrid/.test(cast(e, card, { hybrid: ['B'], twobrid: [] }) || ''), "black is not one of this pip's options")
  assert(/illegal two-brid/.test(cast(e, card, { hybrid: ['G'], twobrid: ['G'] }) || ''), 'and a two-brid choice on a card with none is refused')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
