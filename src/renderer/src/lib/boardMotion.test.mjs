// Headless verification of what the board's motion layer decides to animate.
// planMotion is pure: measured rectangles and zones in, flights and damage
// numbers out — so the rule for "this card moved" can be checked without a
// browser. Run: node src/renderer/src/lib/boardMotion.test.mjs
import { planMotion, MAX_FLIGHTS } from './boardMotion.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

const at = (left, top, width = 100, height = 140) => ({ left, top, width, height })
const board = (entries) => new Map(entries.map(([oid, zone, rect]) => [oid, { zone, rect }]))
const dmg = (entries = []) => new Map(entries)
const never = () => null
const run = (before, now, opts = {}) =>
  planMotion({
    before,
    now,
    damageBefore: opts.damageBefore || dmg(),
    damageNow: opts.damageNow || dmg(),
    sourceFor: opts.sourceFor || never,
    max: opts.max
  })

section('A card that changed zone flies from where it was to where it is')
{
  const before = board([['a', 'hand', at(300, 800)]])
  const now = board([['a', 'bf', at(500, 200)]])
  const { flights } = run(before, now)
  assert(flights.length === 1, 'one flight')
  assert(flights[0].from.top === 800, 'from the hand')
  assert(flights[0].to.top === 200, 'to the battlefield')
  assert(flights[0].oid === 'a', 'carries the oid')
}

section('Staying in a zone is not movement, however the row reflows')
{
  const before = board([['a', 'bf', at(100, 200)]])
  const now = board([['a', 'bf', at(400, 200)]])
  assert(run(before, now).flights.length === 0, 'no flight for a reflow inside the battlefield')
  const h1 = board([['a', 'hand', at(100, 800)]])
  const h2 = board([['a', 'hand', at(220, 800)]])
  assert(run(h1, h2).flights.length === 0, 'no flight for a hand re-fanning')
  const s1 = board([['a', 'stack', at(900, 400)]])
  const s2 = board([['a', 'stack', at(900, 440)]])
  assert(run(s1, s2).flights.length === 0, 'no flight for the stack cascading down')
}

section('A card that was not on screen needs a source, or it just appears')
{
  const now = board([['a', 'hand', at(300, 800)]])
  assert(run(new Map(), now).flights.length === 0, 'no source, no flight')
  const withSource = run(new Map(), now, { sourceFor: () => at(20, 780, 40, 56) })
  assert(withSource.flights.length === 1, 'a source gives it a flight')
  assert(withSource.flights[0].from.left === 20, 'it starts at the source')
  assert(withSource.flights[0].from.width === 40, 'it keeps the source size, so it can scale on the way')
}

section('A card that lands where it started has not gone anywhere')
{
  const before = board([['a', 'stack', at(500, 300)]])
  const now = board([['a', 'bf', at(501, 302)]])
  assert(run(before, now).flights.length === 0, 'sub-pixel drift is not a flight')
  const moved = board([['a', 'bf', at(520, 300)]])
  assert(run(before, moved).flights.length === 1, 'twenty pixels is')
}

section('Every zone change the game actually produces')
{
  const before = board([
    ['draw', 'hand', at(300, 800)],
    ['cast', 'hand', at(420, 800)],
    ['resolve', 'stack', at(900, 400)],
    ['dies', 'bf', at(200, 250)],
    ['discard', 'hand', at(540, 800)]
  ])
  const now = board([
    ['draw', 'bf', at(200, 600)],
    ['cast', 'stack', at(900, 400)],
    ['resolve', 'bf', at(300, 600)],
    ['dies', 'graveyard', at(60, 780, 40, 56)],
    ['discard', 'graveyard', at(60, 780, 40, 56)]
  ])
  const { flights } = run(before, now)
  assert(flights.length === 5, 'all five move')
  const byOid = Object.fromEntries(flights.map((f) => [f.oid, f]))
  assert(byOid.draw.from.top === 800 && byOid.draw.to.top === 600, 'play: hand to battlefield')
  assert(byOid.cast.to.left === 900, 'cast: hand to stack')
  assert(byOid.resolve.from.left === 900 && byOid.resolve.to.left === 300, 'resolve: stack to battlefield')
  assert(byOid.dies.to.width === 40, 'death: battlefield to graveyard')
  assert(byOid.discard.to.width === 40, 'discard: hand to graveyard')
}

section('A big turn does not put the whole game in the air at once')
{
  const before = board(Array.from({ length: 30 }, (_, i) => ['c' + i, 'hand', at(i * 10, 800)]))
  const now = board(Array.from({ length: 30 }, (_, i) => ['c' + i, 'bf', at(i * 10, 200)]))
  assert(run(before, now).flights.length === MAX_FLIGHTS, `capped at ${MAX_FLIGHTS}`)
  assert(run(before, now, { max: 3 }).flights.length === 3, 'and the cap is overridable')
}

section('Damage newly marked throws a number off the creature')
{
  const now = board([['a', 'bf', at(100, 200)]])
  const first = run(now, now, { damageNow: dmg([['a', 2]]) })
  assert(first.hits.length === 1 && first.hits[0].amount === 2, 'two damage on a fresh creature')
  assert(first.hits[0].oid === 'a', 'it names the creature')
  const more = run(now, now, { damageBefore: dmg([['a', 2]]), damageNow: dmg([['a', 5]]) })
  assert(more.hits.length === 1 && more.hits[0].amount === 3, 'only the new damage is thrown')
  const same = run(now, now, { damageBefore: dmg([['a', 5]]), damageNow: dmg([['a', 5]]) })
  assert(same.hits.length === 0, 'damage that has not changed is silent')
  const healed = run(now, now, { damageBefore: dmg([['a', 5]]), damageNow: dmg() })
  assert(healed.hits.length === 0, 'damage wearing off at end of turn is silent')
}

section('A creature that died is not given a damage number it never showed')
{
  // Lethal damage and the state-based action that kills happen together, so the
  // dead creature is simply absent from the new view.
  const before = board([['a', 'bf', at(100, 200)]])
  const now = board([['a', 'graveyard', at(60, 780, 40, 56)]])
  const { flights, hits } = run(before, now, { damageNow: dmg() })
  assert(flights.length === 1, 'it flies to the graveyard')
  assert(hits.length === 0, 'and throws no number')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
