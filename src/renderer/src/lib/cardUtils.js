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
let imageResolver = (id, back) => `card://${id}${back ? '/back' : ''}`
export function setImageResolver(fn) {
  imageResolver = fn
}
export function cardImageUrl(id, back = false) {
  return id ? imageResolver(id, !!back) : null
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
