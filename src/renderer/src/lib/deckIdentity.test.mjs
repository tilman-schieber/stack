// Headless verification of which card's art a deck wears.
// Run: node src/renderer/src/lib/deckIdentity.test.mjs
import { signatureCard, deckNameWords, namesakeOf, deckSize } from './cardUtils.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)

// qty defaults to 4, the usual maximum, so the tests read like decklists.
const c = (name, cmc = 2, qty = 4, type_line = 'Creature — Human') => ({
  card: { id: name.toLowerCase().replace(/\W+/g, '-'), name, cmc, type_line },
  qty
})
const land = (name, qty = 4) => c(name, 0, qty, 'Land')
const pick = (deck, name) => signatureCard(deck, name)?.name

section('A deck named after a card wears that card')
{
  const jund = [c('Cleansing Wildfire', 2), c('Writhing Chrysalis', 5), c('Krark-Clan Shaman', 3)]
  assert(pick(jund, 'Jund Wildfire (Pauper)') === 'Cleansing Wildfire', 'Jund Wildfire gets Cleansing Wildfire')
  assert(pick(jund, '') === 'Writhing Chrysalis', 'and without a name it is still the most expensive card')

  const spy = [c('Balustrade Spy', 4), c('Dread Return', 4), c('Narcomoeba', 2), c('Hedron Crab', 1)]
  assert(pick(spy, '4-Land Spy') === 'Balustrade Spy', '4-Land Spy gets Balustrade Spy')
  assert(pick(spy, 'Four Land Spy (Legacy)') === 'Balustrade Spy', 'however the name is written')
}

section('The name is read for words, not substrings')
{
  const deck = [c('Fog Bank', 2), c('Turbo Boost', 3)]
  assert(!namesakeOf({ name: 'Fog Bank' }, deckNameWords('Black Turbofog')), 'Turbofog does not contain the word Fog')
  assert(pick(deck, 'Black Turbofog') === 'Turbo Boost', 'so it falls through to the most expensive card')
  assert(namesakeOf({ name: 'Tolarian Terror' }, deckNameWords('Dimir Terror')), 'a whole word does match')
}

section('Plurals are folded, so the deck and the card can disagree about number')
{
  assert(namesakeOf({ name: 'Sunscape Familiar' }, deckNameWords('Azorius Familiars')), 'Familiars finds a Familiar')
  assert(namesakeOf({ name: 'Slippery Bogle' }, deckNameWords('Bogles')), 'Bogles finds a Bogle')
  assert(namesakeOf({ name: 'Basilisk Gate' }, deckNameWords('Naya Gates')), 'Gates finds a Gate')
  assert(namesakeOf({ name: 'Llanowar Elves' }, deckNameWords('Elves')), 'and a plural matches a plural')
}

section('Words that describe the deck rather than name a card are ignored')
{
  // Boros stems to "boro"; if the noise list were checked after stemming it
  // would slip through and claim Boros Garrison.
  assert(!deckNameWords('Boros Synth (Pauper)').includes('boro'), 'a guild name is not a card word')
  assert(!namesakeOf({ name: 'Boros Garrison' }, deckNameWords('Boros Synth')), 'so it does not match a guild land')
  assert(!namesakeOf({ name: 'Azorius Chancery' }, deckNameWords('Azorius Familiars')), 'nor Azorius')
  assert(deckNameWords('Mono Red Rally (Pauper)').join() === 'rally', 'colour, "mono" and the format all drop out')
  assert(deckNameWords('Grixis Affinity (Pauper)').join() === 'affinity', 'shards drop out too')
  assert(deckNameWords('Mono-Red Madness (Pauper)').join() === 'madness', 'and a hyphen is a word break')
}

section('A deck named after its lands may wear one')
{
  // Naya Gates has no namesake spell and four namesake gates.
  const gates = [land('Basilisk Gate'), land('Citadel Gate'), c('Writhing Chrysalis', 5)]
  assert(pick(gates, 'Naya Gates') === 'Basilisk Gate', 'a namesake land beats a bigger unrelated spell')
  const both = [land('Basilisk Gate'), c('Gates Ablaze', 3)]
  assert(pick(both, 'Naya Gates') === 'Gates Ablaze', 'but a namesake spell still beats a namesake land')
}

section('Ties fall back to the old ordering')
{
  const two = [c('Tolarian Terror', 8, 4), c('Terror of the Peaks', 5, 2)]
  assert(pick(two, 'Dimir Terror') === 'Tolarian Terror', 'the more expensive namesake wins')
  const same = [c('Cheap Terror', 2, 1), c('Common Terror', 2, 4)]
  assert(pick(same, 'Dimir Terror') === 'Common Terror', 'and at equal cost, the one there are more of')
  const noNames = [c('Alpha', 3), c('Beta', 6), land('Swamp')]
  assert(pick(noNames, 'Nothing Matches Here') === 'Beta', 'with no namesake, the most expensive nonland')
  assert(pick([land('Swamp'), land('Island')], 'Land Deck') === 'Swamp', 'a deck of nothing but lands still gets a cover')
}

section('Nothing to pick from')
{
  assert(signatureCard([], 'Jund Wildfire') === null, 'an empty deck has no cover')
  assert(signatureCard(null, 'Jund Wildfire') === null, 'and neither has no deck at all')
  assert(deckNameWords('').length === 0, 'an empty name has no words')
  assert(deckNameWords('(Pauper)').length === 0, 'nor a name that is only a format')
  assert(!namesakeOf({ name: 'Anything' }, []), 'and with no words nothing is a namesake')
}

section('How big a deck is said to be')
{
  // A decklist is 60 + 15, never 75: the two numbers mean different things and
  // adding them together answers a question nobody asked.
  assert(deckSize({ mainCount: 60, sideCount: 15, count: 75 }) === '60 + 15', 'a tournament deck')
  assert(deckSize({ mainCount: 60, sideCount: 0, count: 60 }) === '60 cards', 'no sideboard, no plus')
  assert(deckSize({ mainCount: 99, sideCount: 0, count: 99 }) === '99 cards', 'a commander deck')
  assert(deckSize({ mainCount: 0, sideCount: 0, count: 0 }) === '0 cards', 'an empty deck')
  // Only a record saved before the split existed falls back to the total.
  assert(deckSize({ count: 75 }) === '75 cards', 'an old record with only a total')
  assert(deckSize(null) === '', 'and no deck at all says nothing')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
