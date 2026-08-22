import { EXAMPLE_DECKS, deckCardNames, expandExampleDeck } from './exampleDecks.js'

// Build a case-insensitive name -> card lookup (indexing each face of DFCs).
function buildLookup(cards) {
  const map = new Map()
  for (const card of cards) {
    const keys = [card.name]
    if (Array.isArray(card.card_faces)) for (const f of card.card_faces) if (f.name) keys.push(f.name)
    for (const k of keys) {
      const key = String(k).toLowerCase()
      if (!map.has(key)) map.set(key, card)
    }
  }
  return (name) => map.get(String(name).toLowerCase())
}

// Resolve one example deck (by slug) into { name, cards } with real Scryfall
// card objects, via the main-process card cache. Throws if any name is missing.
export async function resolveExampleDeck(slug) {
  const d = EXAMPLE_DECKS.find((x) => x.slug === slug)
  if (!d) throw new Error(`Unknown deck: ${slug}`)
  const { cards } = await window.api.resolveDeck(deckCardNames(d))
  const built = expandExampleDeck(d, buildLookup(cards))
  if (built.missing.length) throw new Error(`Could not resolve: ${built.missing.join(', ')}`)
  return { name: d.name, cards: built.cards }
}
