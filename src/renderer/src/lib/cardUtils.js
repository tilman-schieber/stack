// Helpers for reading fields off Scryfall card objects.

const TYPE_ORDER = [
  'Creature',
  'Planeswalker',
  'Battle',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Other'
]

export function typeLine(card) {
  return card.type_line || card.card_faces?.[0]?.type_line || ''
}

// The primary type used for grouping (first recognized type in the type line).
export function primaryType(card) {
  const line = typeLine(card)
  for (const t of TYPE_ORDER) {
    if (t !== 'Other' && line.includes(t)) return t
  }
  return 'Other'
}

export function isLand(card) {
  return typeLine(card).includes('Land')
}

export function manaValue(card) {
  return typeof card.cmc === 'number' ? card.cmc : 0
}

// Color identity letters, e.g. ['W','U']. Empty => colorless.
export function colorIdentity(card) {
  return Array.isArray(card.color_identity) ? card.color_identity : []
}

// Card images. In Electron, `card://<id>` (or `card://<id>/back`) is served by
// the main process, which caches them on disk. The web build has no such
// protocol and installs a resolver that maps ids to Scryfall image URLs
// (src/web/api.js).
// `face`: false/undefined = the whole front card, true/'back' = the second face,
// 'art' = the cropped illustration (deck banners).
let imageResolver = (id, face) => `card://${id}${face === 'art' ? '/art' : face ? '/back' : ''}`
export function setImageResolver(fn) {
  imageResolver = fn
}
export function cardImageUrl(id, face = false) {
  return id ? imageResolver(id, face === 'art' ? 'art' : !!face) : null
}
// The cropped illustration of a card, for deck banners.
export const cardArtUrl = (id) => cardImageUrl(id, 'art')

// A deck's signature card — the one whose art represents it. The most expensive
// nonland card, since that is what a deck is built around; ties go to the card
// with more copies. Falls back to whatever the deck's first card is.
export function signatureCard(cards) {
  const list = (cards || []).filter(Boolean)
  if (!list.length) return null
  const spells = list.filter((e) => !isLand(e.card))
  const pool = spells.length ? spells : list
  return [...pool].sort((a, b) => manaValue(b.card) - manaValue(a.card) || (b.qty || 0) - (a.qty || 0))[0].card
}

// The colours a deck actually plays, in WUBRG order — the colours of the spells
// you cast, not colour identity, which also counts mana symbols in rules text and
// would paint a two-colour deck five colours because of its lands.
export function deckColors(cards) {
  const seen = new Set()
  for (const e of cards || []) {
    if (!e.card || isLand(e.card)) continue
    for (const c of e.card.colors || e.card.card_faces?.[0]?.colors || []) seen.add(c)
  }
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => seen.has(c))
}
export function imageSrc(card) {
  return cardImageUrl(card.id)
}

// Stable identity for a card across printings — must match the backend
// (src/shared/backend.mjs oracleKey).
export function oracleKey(card) {
  return card.oracle_id || String(card.name || '').toLowerCase()
}

// Human-readable printing label, e.g. "MOM · 123 · March of the Machine".
export function printLabel(card) {
  const code = (card.set || '').toUpperCase()
  return [code, card.collector_number, card.set_name].filter(Boolean).join(' · ')
}

export const TYPE_GROUP_ORDER = TYPE_ORDER

export const COLOR_META = {
  W: { name: 'White', hex: '#f8e7b9' },
  U: { name: 'Blue', hex: '#3b82f6' },
  B: { name: 'Black', hex: '#6b7280' },
  R: { name: 'Red', hex: '#ef4444' },
  G: { name: 'Green', hex: '#22c55e' },
  C: { name: 'Colorless', hex: '#b8a99a' }
}
