// Headless verification: in bot-vs-bot games with the Madness deck, a madness
// cast is only ever offered for a card that was just discarded (it sits in exile
// when offered, and the log shows the discard), and the log line says so.
// Run: node src/shared/engine/madness-bot.test.mjs
import { GameEngine } from './engine.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { botChoose, botFallback } from './bot.mjs'
import { DEFAULT_DECKS } from '../../renderer/src/lib/defaultDecks.js'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()

const cardFor = (name) => SAMPLE_CARDS[name] || Object.values(SAMPLE_CARDS).find((c) => c.name.split(' // ')[0] === name)
const build = (slug) => {
  const d = DEFAULT_DECKS.find((x) => x.slug === slug)
  const out = []
  for (const [q, n] of d.cards) {
    const c = cardFor(n)
    if (!c) throw new Error('missing ' + n)
    for (let i = 0; i < q; i++) out.push(c)
  }
  return out
}
const MAD = build('pauper-madness-burn')
const RALLY = build('pauper-mono-red-rally')

let offers = 0
let violations = 0
let castLines = 0
for (let g = 0; g < 12; g++) {
  const e = new GameEngine({ seed: 'mad-' + g, players: [{ name: 'Mad', deck: MAD }, { name: 'Rally', deck: RALLY }] }).start()
  let n = 0
  while (e.pending && e.pending.kind !== 'gameOver' && n++ < 6000) {
    const p = e.pending
    if (p.kind === 'madness' && !p.free && !p.miracle) {
      offers++
      const o = e.state.objects[p.oid]
      const recent = e.state.log.slice(-4).map((l) => l.text)
      const discarded = recent.some((t) => t.includes('discards') && t.includes(o.printed.name))
      if (o.zoneName !== 'exile' || !discarded) {
        violations++
        console.log(`  violation (game ${g}, turn ${e.state.turnNumber}): ${o.printed.name} in ${o.zoneName}; ${JSON.stringify(recent)}`)
      }
    }
    try {
      e.choose(botChoose(e, p.player))
    } catch {
      try {
        e.choose(botFallback(e, p.player))
      } catch {
        break
      }
    }
  }
  castLines += e.state.log.filter((l) => /for its madness cost .* \(it was discarded\)/.test(l.text)).length
}
assert(offers > 0, `madness was offered at least once across the games (${offers} offers)`)
assert(violations === 0, 'every madness offer followed a discard of that very card')
assert(castLines > 0, 'madness casts are logged as such, naming the discard')

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
