// Two small things a player could not see.
//
// An Omen spell goes back into its owner's library when it resolves, and the
// log said nothing — the card just vanished off the stack. And a library search
// only ever offered the cards it could find, when searching a library means
// looking through all of it (701.19a).
// Run: node src/shared/engine/omen-and-search.test.mjs
import { makeEngine, put, refresh, advanceToPriorityAt, inZone, makeAsserter } from './_testutil.mjs'
import { projectGame } from './project.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const logOf = (e) => e.state.log.map((l) => l.text).join('\n')

section('Sagu Wildling cast as its Omen goes back, and says so')
{
  const e = makeEngine('Forest', 20)
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  const card = put(e, 0, 'Sagu Wildling', 'hand')
  refresh(e)
  const omen = e.pending.actions?.find((a) => a.type === 'castOmen' && a.oid === card.oid)
  assert(!!omen, 'the Omen half can be cast')
  e.choose(omen)
  // It searches for a basic land; take the first thing offered, then let it resolve.
  let g = 0
  while (e.pending && e.pending.kind !== 'gameOver' && g++ < 30) {
    const p = e.pending
    if (p.kind === 'search') e.choose({ pick: p.cards[0] })
    else if (p.kind === 'priority') e.choose({ type: 'pass' })
    else break
    if (inZone(e, 0, 'library', card.oid)) break
  }
  assert(inZone(e, 0, 'library', card.oid), 'the card is back in its library')
  assert(!inZone(e, 0, 'graveyard', card.oid), 'and not in the graveyard')
  const log = logOf(e)
  assert(/Sagu Wildling is shuffled into/.test(log), 'the log names the card going back')
  assert(/omen/i.test(log), 'and says why')
  assert(/casts Roost Seek/.test(log), "while the cast itself is still logged under the Omen's own name")
}

section('A search offers the whole library to look through')
{
  const e = makeEngine('Forest', 20)
  advanceToPriorityAt(e, 'main1')
  for (let i = 0; i < 3; i++) put(e, 0, 'Forest', 'battlefield')
  const card = put(e, 0, 'Sagu Wildling', 'hand')
  refresh(e)
  e.choose(e.pending.actions.find((a) => a.type === 'castOmen' && a.oid === card.oid))
  let g = 0
  while (e.pending?.kind === 'priority' && g++ < 8) e.choose({ type: 'pass' })
  const p = e.pending
  assert(p.kind === 'search', 'the search is pending')
  assert(Array.isArray(p.library) && p.library.length > 0, 'the whole library comes with it')
  assert(p.library.length >= p.cards.length, 'and it is at least as big as what the search can find')
  assert(p.cards.every((oid) => p.library.includes(oid)), 'every findable card is part of it')

  // The searcher sees the cards; nobody else does.
  const mine = projectGame(e, 0).pending
  assert(mine.library.length === p.library.length, 'the searcher gets the whole library')
  assert(mine.library.every((c) => c.name), 'as real cards, not blanks')
  const theirs = projectGame(e, 1).pending
  assert(theirs.library.length === 0, "an opponent gets none of it")
  assert(theirs.cards.every((c) => c.hidden), 'and cannot see what is findable either')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
