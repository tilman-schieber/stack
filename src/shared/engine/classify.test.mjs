// Headless verification: the coverage classifier.
// Run: node src/shared/engine/classify.test.mjs

import { classifyCard, deckCoverage } from './classify.mjs'
import { makeAsserter } from './_testutil.mjs'

const { assert, stats } = makeAsserter()
const cat = (sf) => classifyCard(sf)
const S = (sf) => classifyCard(sf).supported

console.log('\nclassification')

// Basic land — supported.
assert(S({ name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' }), 'basic land supported')

// Vanilla creature — supported.
assert(S({ name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2', oracle_text: '' }), 'vanilla creature supported')

// French-vanilla (keywords only) — supported.
assert(
  S({ name: 'Serra Angel', type_line: 'Creature — Angel', power: '4', toughness: '4', oracle_text: 'Flying, vigilance' }),
  'keyword-only creature supported'
)

// Authored card — supported.
assert(S({ name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.' }), 'authored spell supported')

// Unauthored instant — unsupported.
assert(!S({ name: 'Ancestral Recall', type_line: 'Instant', oracle_text: 'Target player draws three cards.' }), 'unauthored spell unsupported')
assert(cat({ name: 'Ancestral Recall', type_line: 'Instant', oracle_text: 'x' }).category === 'spell effect not implemented', 'reason is spell effect')

// Creature with an unsupported ability — unsupported.
assert(
  !S({ name: 'Serra Ascendant', type_line: 'Creature — Human Monk', power: '1', toughness: '1', oracle_text: 'Lifelink\nAs long as you have 30 or more life, Serra Ascendant gets +5/+5.' }),
  'creature with extra text unsupported'
)

// Nonbasic land — unsupported (mana ability not modeled).
assert(!S({ name: 'Sacred Foundry', type_line: 'Land — Mountain Plains', oracle_text: '({T}: Add {R} or {W}.)' }), 'nonbasic land unsupported')

// Unauthored planeswalker — unsupported.
assert(!S({ name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace', loyalty: '3', oracle_text: '+2: ...' }), 'unauthored planeswalker unsupported')

console.log('\ndeck coverage')
{
  const entries = [
    { card: { name: 'Forest', type_line: 'Basic Land — Forest' }, qty: 10, section: 'main' },
    { card: { name: 'Grizzly Bears', type_line: 'Creature — Bear', power: '2', toughness: '2' }, qty: 4, section: 'main' },
    { card: { name: 'Ancestral Recall', type_line: 'Instant', oracle_text: 'draw three' }, qty: 2, section: 'main' },
    { card: { name: 'Black Lotus', type_line: 'Artifact', oracle_text: '{T}, Sacrifice: add 3 mana' }, qty: 1, section: 'sideboard' }
  ]
  const cov = deckCoverage(entries)
  assert(cov.total === 16, 'sideboard excluded from total (16)')
  assert(cov.supported === 14, '14 supported (10 lands + 4 bears)')
  assert(cov.unsupported.length === 1 && cov.unsupported[0].name === 'Ancestral Recall', 'lists the unsupported card')
  assert(cov.pct === 88, 'coverage percentage computed')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
