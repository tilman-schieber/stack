// Headless verification of how a card with more than one type is filed.
//
// The type lines here are the real ones, taken from Scryfall. Run:
// node src/renderer/src/lib/cardTypes.test.mjs
import { primaryType, isLand, TYPE_GROUP_ORDER } from './cardUtils.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const card = (type_line) => ({ type_line })

section('Plain cards go where you would expect')
{
  assert(primaryType(card('Creature — Goblin')) === 'Creature', 'a creature')
  assert(primaryType(card('Instant')) === 'Instant', 'an instant')
  assert(primaryType(card('Sorcery')) === 'Sorcery', 'a sorcery')
  assert(primaryType(card('Artifact — Equipment')) === 'Artifact', 'an artifact')
  assert(primaryType(card('Enchantment — Aura')) === 'Enchantment', 'an enchantment')
  assert(primaryType(card('Basic Land — Mountain')) === 'Land', 'a basic land')
  assert(primaryType(card('Legendary Planeswalker — Sarkhan')) === 'Planeswalker', 'a planeswalker')
  assert(primaryType(card('Battle — Siege')) === 'Battle', 'a battle')
}

section('Land beats every other type — the bug this fixes')
{
  // Great Furnace, Seat of the Synod, Darksteel Citadel.
  assert(primaryType(card('Artifact Land')) === 'Land', 'an artifact land is a land, not an artifact')
  assert(isLand(card('Artifact Land')), 'and isLand agrees')
  // Dryad Arbor: a land that is also a creature, registered as a land.
  assert(primaryType(card('Land Creature — Forest Dryad')) === 'Land', 'a creature land is a land')
  assert(primaryType(card('Enchantment Land')) === 'Land', 'an enchantment land is a land')
  assert(primaryType(card('Legendary Artifact Land')) === 'Land', 'supertypes do not get in the way')
}

section('Creature beats the permanent types below it')
{
  // Frogmite, Myr Enforcer — the other half of Pauper Affinity.
  assert(primaryType(card('Artifact Creature — Frog')) === 'Creature', 'an artifact creature is a creature')
  assert(primaryType(card('Enchantment Creature — Nymph')) === 'Creature', 'an enchantment creature is a creature')
  assert(primaryType(card('Legendary Artifact Creature — Golem')) === 'Creature', 'and with supertypes too')
  assert(!isLand(card('Artifact Creature — Frog')), 'and it is not a land')
}

section('A double-faced card is filed by its front face')
{
  // Bala Ged Recovery // Bala Ged Sanctuary, Agadeem's Awakening: a spell you
  // may instead play as a land. It is a sorcery in every deckbuilder, and it
  // belongs in the mana curve.
  assert(primaryType(card('Sorcery // Land')) === 'Sorcery', 'a modal sorcery/land is a sorcery')
  assert(!isLand(card('Sorcery // Land')), 'and must not be counted as a land')
  assert(primaryType(card('Instant // Land')) === 'Instant', 'a modal instant/land is an instant')
  assert(primaryType(card('Battle — Siege // Sorcery')) === 'Battle', 'a battle with a spell back is a battle')
  assert(
    primaryType(card('Creature — Human Wizard // Creature — Human Insect')) === 'Creature',
    'a transforming creature is a creature'
  )
  // A land whose back is a spell is still a land.
  assert(primaryType(card('Land // Sorcery')) === 'Land', 'a land front stays a land')
}

section('Subtypes are not searched for type names')
{
  // The text after the em dash is free-form and has held words like these.
  assert(primaryType(card('Enchantment — Land Aura')) === 'Enchantment', 'a subtype naming Land does not make it one')
  assert(!isLand(card('Enchantment — Land Aura')), 'and isLand is not fooled either')
  assert(primaryType(card('Artifact — Creature Cage')) === 'Artifact', 'a subtype naming Creature does not either')
}

section('Anything unrecognised is still listed somewhere')
{
  assert(primaryType(card('')) === 'Other', 'no type line')
  assert(primaryType({}) === 'Other', 'no field at all')
  assert(primaryType(card('Dungeon')) === 'Other', 'a type this app does not group')
  assert(!isLand({}), 'and nothing without a type line is a land')
}

section('Cards carrying their types only on the front face object')
{
  assert(primaryType({ card_faces: [{ type_line: 'Artifact Land' }] }) === 'Land', 'faces[0] is used when there is no top-level line')
}

section('The groups are listed creatures first, lands last')
{
  assert(TYPE_GROUP_ORDER[0] === 'Creature', 'creatures lead')
  assert(TYPE_GROUP_ORDER[TYPE_GROUP_ORDER.length - 2] === 'Land', 'lands come last of the real types')
  assert(TYPE_GROUP_ORDER[TYPE_GROUP_ORDER.length - 1] === 'Other', 'with the catch-all after them')
  assert(TYPE_GROUP_ORDER.indexOf('Artifact') < TYPE_GROUP_ORDER.indexOf('Land'), 'artifacts are listed before lands')
  // Every type the filing can produce must have somewhere to be listed.
  for (const t of ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Other'])
    assert(TYPE_GROUP_ORDER.includes(t), `${t} has a group`)
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
