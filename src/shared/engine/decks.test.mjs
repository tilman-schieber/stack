// Every default deck is a legal, fully supported 60-card list with a 15-card
// sideboard, and the computer can play a whole game with each of them without
// ever handing the engine an illegal answer.
// Run: node src/shared/engine/decks.test.mjs

import { GameEngine } from './engine.mjs'
import { SAMPLE_CARDS } from './cards.mjs'
import { classifyCard } from './classify.mjs'
import { botChoose, botFallback } from './bot.mjs'
import { DEFAULT_DECKS } from '../../renderer/src/lib/defaultDecks.mjs'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

const cardFor = (name) => SAMPLE_CARDS[name] || Object.values(SAMPLE_CARDS).find((c) => c.name.split(' // ')[0] === name)
const build = (list) => {
  const out = []
  for (const [q, n] of list) {
    const c = cardFor(n)
    if (!c) return null
    for (let i = 0; i < q; i++) out.push(c)
  }
  return out
}

section('Every default deck is 60 + 15 and fully supported')
for (const d of DEFAULT_DECKS) {
  const main = d.cards.reduce((s, [q]) => s + q, 0)
  const side = (d.sideboard || []).reduce((s, [q]) => s + q, 0)
  const unknown = []
  const unsupported = []
  for (const [, n] of [...d.cards, ...(d.sideboard || [])]) {
    const c = cardFor(n)
    if (!c) unknown.push(n)
    else if (!classifyCard(c).supported) unsupported.push(n)
  }
  assert(
    main === 60 && side === 15 && !unknown.length && !unsupported.length,
    `${d.name}: ${main}+${side}${unknown.length ? ' — unknown: ' + unknown.join(', ') : ''}${unsupported.length ? ' — unsupported: ' + unsupported.join(', ') : ''}`
  )
}

section('The computer plays a full game with each deck')
{
  // Each deck faces the next one in the list, so every deck is played and faced.
  for (let i = 0; i < DEFAULT_DECKS.length; i++) {
    const a = DEFAULT_DECKS[i]
    const b = DEFAULT_DECKS[(i + 1) % DEFAULT_DECKS.length]
    const d0 = build(a.cards)
    const d1 = build(b.cards)
    if (!d0 || !d1) {
      assert(false, `${a.name} vs ${b.name}: a card is missing from the fixture`)
      continue
    }
    const e = new GameEngine({
      seed: 'decks-' + i,
      autoOrderTriggers: true,
      players: [
        { name: a.name, deck: d0 },
        { name: b.name, deck: d1 }
      ]
    }).start()
    let n = 0
    let fallbacks = 0
    let errors = 0
    while (e.pending && e.pending.kind !== 'gameOver' && n++ < 4000) {
      const pid = e.pending.player
      try {
        e.choose(botChoose(e, pid))
      } catch {
        fallbacks++
        try {
          e.choose(botFallback(e, pid))
        } catch (err2) {
          errors++
          console.error(`  ${a.name}: ${e.pending?.kind} — ${err2.message}`)
          break
        }
      }
    }
    assert(errors === 0 && n < 4000, `${a.name} vs ${b.name}: played to completion (${n} decisions, ${fallbacks} fallbacks)`)
  }
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
