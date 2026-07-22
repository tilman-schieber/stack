// Helpers for turning decks into in-play card instances and manipulating them.

export function uid() {
  return crypto.randomUUID()
}

// A card instance is one physical card in play. Multiple instances can share a
// cardId (Scryfall print id). Tokens have token=true and vanish when they leave
// the battlefield.
export function makeInstance(cardId, extra = {}) {
  return {
    iid: uid(),
    cardId,
    token: false,
    tapped: false,
    flipped: false, // show back face (DFC)
    faceDown: false,
    counters: {}, // { "+1/+1": 2, ... }
    x: 0,
    y: 0,
    ...extra
  }
}

// Expand a saved deck record's entries into library instances.
// entries: [{ scryfallId, qty, section }]  — sideboard excluded.
export function expandDeck(record) {
  const out = []
  for (const e of record.entries || []) {
    if (e.section === 'sideboard') continue
    for (let i = 0; i < e.qty; i++) out.push(makeInstance(e.scryfallId))
  }
  return out
}

// Fisher–Yates shuffle, returns a new array.
export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const PHASES = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end']
export const PHASE_LABELS = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  combat: 'Combat',
  main2: 'Main 2',
  end: 'End'
}

export const ZONE_LABELS = {
  library: 'Library',
  hand: 'Hand',
  battlefield: 'Battlefield',
  graveyard: 'Graveyard',
  exile: 'Exile',
  command: 'Command'
}

// Image source for an instance, honoring face-down and DFC flip.
export function instanceImage(inst) {
  if (!inst || !inst.cardId) return null
  if (inst.faceDown) return null // caller renders a card back
  return inst.flipped ? `card://${inst.cardId}/back` : `card://${inst.cardId}`
}

// Does this card object have a second (back) face with its own image?
export function hasBackFace(card) {
  return Array.isArray(card?.card_faces) && card.card_faces.length > 1 && !!card.card_faces[1]?.image_uris
}
