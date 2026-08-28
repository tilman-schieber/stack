import { EXAMPLE_DECKS, deckCardNames, expandExampleDeck } from './exampleDecks.js'
import { deckCoverage } from '@engine/classify.mjs'

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

// Decks a game can be started with: the built-in examples plus every deck saved
// in the deck builder. Keys are "example:<slug>" / "saved:<slug>".
export async function listPlayableDecks() {
  const examples = EXAMPLE_DECKS.map((d) => ({ key: `example:${d.slug}`, name: d.name, group: 'Example decks' }))
  let saved = []
  try {
    saved = (await window.api.listDecks()).map((d) => ({
      key: `saved:${d.slug}`,
      name: `${d.name} (${d.count})`,
      group: 'Your decks'
    }))
  } catch {
    /* no saved decks available */
  }
  return [...examples, ...saved]
}

// Resolve one example deck (by slug) into { name, cards } with real Scryfall
// card objects, via the main-process card cache. Throws if any name is missing.
export async function resolveExampleDeck(slug) {
  const d = EXAMPLE_DECKS.find((x) => x.slug === slug)
  if (!d) throw new Error(`Unknown deck: ${slug}`)
  const { cards } = await window.api.resolveDeck(deckCardNames(d))
  const lookup = buildLookup(cards)
  const built = expandExampleDeck(d, lookup)
  if (built.missing.length) throw new Error(`Could not resolve: ${built.missing.join(', ')}`)
  return { name: d.name, cards: built.cards, coverage: coverageOf(d.cards.map(([qty, name]) => [qty, lookup(name)])) }
}

// Resolve a deck saved by the deck builder (main section only; the sideboard
// is ignored) into { name, cards, coverage }.
export async function resolveSavedDeck(slug) {
  const record = await window.api.loadDeck(slug)
  const main = (record.entries || []).filter((e) => (e.section || 'main') === 'main')
  const { cards } = await window.api.ensureCards(main.map((e) => e.scryfallId))
  const byId = new Map(cards.map((c) => [c.id, c]))
  const out = []
  const missing = []
  const pairs = []
  for (const e of main) {
    const card = byId.get(e.scryfallId)
    if (!card) {
      missing.push(e.name)
      continue
    }
    for (let i = 0; i < e.qty; i++) out.push(card)
    pairs.push([e.qty, card])
  }
  if (missing.length) throw new Error(`Could not resolve: ${missing.join(', ')}`)
  if (out.length === 0) throw new Error('That deck has no cards in its main section')
  return { name: record.name, cards: out, coverage: coverageOf(pairs) }
}

export function resolvePlayableDeck(key) {
  const [kind, slug] = String(key).split(':')
  return kind === 'saved' ? resolveSavedDeck(slug) : resolveExampleDeck(slug)
}

// Rules-engine coverage of a deck: which cards it fully supports. Unsupported
// cards still play as their printed characteristics (a creature with an
// unimplemented ability is just a vanilla creature).
function coverageOf(pairs) {
  return deckCoverage(pairs.filter(([, card]) => card).map(([qty, card]) => ({ card, qty, section: 'main' })))
}
