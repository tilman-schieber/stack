// Helpers for reading fields off Scryfall card objects.

// Which bucket a card with several types belongs to. This is a different
// question from the order the buckets are listed in, and conflating the two is
// what put artifact lands under Artifacts.
//
// A card is filed under the first of these it has. Land wins outright: an
// artifact land is a land you play off your land drop, registered in the lands
// section of a tournament decklist, and every deckbuilder files it there — the
// same reasoning puts Dryad Arbor ("Land Creature") under lands. Creature comes
// next, so an artifact creature like Frogmite is a creature, not an artifact.
const TYPE_PRECEDENCE = ['Land', 'Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment']

// The order the groups are listed in: creatures first, lands last, which is how
// decklists have been written and registered for as long as there have been
// decklists.
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

// The supertypes and types of the front face only.
//
// Two things have to be cut away before matching. A double-faced card's line
// holds both faces ("Sorcery // Land" — Bala Ged Recovery is a sorcery you may
// instead play as a land, and every tool files it under sorceries), and the
// subtypes after the em dash are free text that can contain a type's name.
function frontTypes(card) {
  return typeLine(card).split('//')[0].split('—')[0]
}

const hasType = (card, t) => new RegExp(`\\b${t}\\b`).test(frontTypes(card))

// The group a card is listed under.
export function primaryType(card) {
  for (const t of TYPE_PRECEDENCE) if (hasType(card, t)) return t
  return 'Other'
}

export function isLand(card) {
  return hasType(card, 'Land')
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
let imageResolver = (id, variant) => `card://${id}${variant ? '/' + variant : ''}`
export function setImageResolver(fn) {
  imageResolver = fn
}

// Scryfall serves a card at 146px (12kB), 488px (81kB) and 672px (122kB). A
// board draws cards about 100px wide, so the smallest one is the right fetch —
// until the card is actually being drawn bigger than that, either because the
// screen is dense or because the player has scaled the board up (see
// lib/cardScale.js), where the soft upscale would be obvious.
let boardScale = 1
export function setBoardScale(scale) {
  boardScale = Number(scale) > 0 ? Number(scale) : 1
}
export const boardImageSize = () => {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  return 100 * boardScale * dpr > 160 ? 'normal' : 'small'
}

// `face`: false = the front, true/'back' = the second face, 'art' = the crop.
// `size`: 'small' | 'normal' | 'large'.
export function cardImageUrl(id, face = false, size = 'normal') {
  if (!id) return null
  const variant =
    face === 'art'
      ? 'art'
      : face
        ? size === 'small'
          ? 'back-small'
          : 'back'
        : size === 'normal'
          ? '' // the plain front keeps its bare URL, so caches stay warm
          : size
  return imageResolver(id, variant)
}
// The cropped illustration of a card, for deck banners.
export const cardArtUrl = (id) => cardImageUrl(id, 'art')

// Words in a deck's name that describe the deck rather than name a card in it:
// the format, the colours, the guild and wedge names, and the shape of the deck.
// Everything else is a word a card might share.
const DECK_NAME_NOISE = new Set([
  'pauper', 'modern', 'legacy', 'standard', 'vintage', 'pioneer', 'commander', 'brawl', 'historic',
  'alchemy', 'premodern', 'oathbreaker', 'cube', 'draft', 'deck', 'list', 'budget',
  'mono', 'white', 'blue', 'black', 'red', 'green', 'colorless', 'colourless',
  'azorius', 'dimir', 'rakdos', 'gruul', 'selesnya', 'orzhov', 'izzet', 'golgari', 'boros', 'simic',
  'bant', 'esper', 'grixis', 'jund', 'naya', 'abzan', 'jeskai', 'sultai', 'mardu', 'temur',
  'aggro', 'control', 'combo', 'midrange', 'tempo', 'ramp', 'tribal', 'the'
])

// A word reduced to the form a name shares: lowercase, and a trailing plural "s"
// dropped so "Familiars" finds Sunscape Familiar and "Bogles" finds Slippery
// Bogle. Irregular plurals ("Elves" against "Elf") are left to fall through.
const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

// Raw words, before stemming: the noise list has to be checked against these,
// or Boros stems to "boro" and slips past it into Boros Garrison.
function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // the "(Pauper)" a deck's name usually carries
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3)
}

// The words in a deck's name that a card could be named after.
export function deckNameWords(deckName) {
  return [...new Set(words(deckName).filter((w) => !DECK_NAME_NOISE.has(w)).map(stem))]
}

// Whether a card's name shares a whole word with the deck's name.
export function namesakeOf(card, deckWords) {
  if (!deckWords?.length) return false
  const set = new Set(deckWords)
  return words(card?.name).map(stem).some((w) => set.has(w))
}

// A deck's signature card — the one whose art represents it.
//
// A deck named after one of its cards should wear that card: Jund Wildfire gets
// Cleansing Wildfire, 4-Land Spy gets Balustrade Spy. Failing that, the most
// expensive nonland card, since that is what a deck is built around, with
// copies breaking the remaining ties.
//
// The two preferences are ranked rather than filtered, which matters for a deck
// named after its lands: Naya Gates has no namesake spell but four namesake
// gates, and a gate is a better cover for it than the biggest creature. A
// namesake land still loses to a namesake spell, and with no namesake at all
// this is exactly the old rule.
export function signatureCard(cards, deckName = '') {
  const list = (cards || []).filter(Boolean)
  if (!list.length) return null
  const deckWords = deckNameWords(deckName)
  const named = (e) => (namesakeOf(e.card, deckWords) ? 1 : 0)
  const spell = (e) => (isLand(e.card) ? 0 : 1)
  return [...list].sort(
    (a, b) =>
      named(b) - named(a) ||
      spell(b) - spell(a) ||
      manaValue(b.card) - manaValue(a.card) ||
      (b.qty || 0) - (a.qty || 0)
  )[0].card
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
