// Logic shared by the two backends behind `window.api`: the Electron main
// process (src/main/, SQLite + files) and the web build (src/renderer/src/web/,
// IndexedDB). Anything here must not touch Node or browser globals.

// Stable identity for a card across printings.
export function oracleKey(card) {
  return card.oracle_id || card.card_faces?.[0]?.oracle_id || String(card.name || '').toLowerCase()
}

// Swap each resolved card for the user's chosen default printing (the first
// favorite), if any. `db` may be synchronous (SQLite) or asynchronous (IndexedDB);
// it needs getDefaultPrintId(key), missingIds(ids), putCards(cards), getCard(id).
export async function applyDefaultPrintings(cards, { db, scryfall }) {
  const targets = new Map() // originalId -> defaultId
  const needed = []
  for (const c of cards) {
    const defaultId = await db.getDefaultPrintId(oracleKey(c))
    if (defaultId && defaultId !== c.id) {
      targets.set(c.id, defaultId)
      needed.push(defaultId)
    }
  }
  const missing = await db.missingIds(needed)
  if (missing.length) {
    const { found } = await scryfall.resolveByIds(missing)
    await db.putCards(found)
  }
  const out = []
  for (const c of cards) {
    const targetId = targets.get(c.id)
    const replacement = targetId ? await db.getCard(targetId) : null
    out.push(replacement || c)
  }
  return out
}

// Saved decks are keyed by the slug of their name.
export function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'deck'
  )
}

// What the deck list shows for a saved record.
export function deckSummary(rec) {
  return {
    slug: rec.slug,
    name: rec.name,
    updatedAt: rec.updatedAt,
    count: (rec.entries || []).reduce((s, e) => s + (e.qty || 0), 0)
  }
}

export const SETTINGS_DEFAULTS = {
  // Hide World Championship gold-bordered printings in the art picker.
  ignoreGoldBordered: true,
  // Hide printings that aren't legal in sanctioned paper play (un-sets,
  // oversized, memorabilia, digital-only, etc.).
  ignoreNonTournamentLegal: true,
  // Additional set codes (lowercase) to hide.
  ignoredSets: []
}

// Merge a settings patch, normalizing set codes.
export function mergeSettings(current, patch) {
  const next = { ...current, ...patch }
  if (Array.isArray(patch.ignoredSets)) {
    next.ignoredSets = patch.ignoredSets.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
  }
  return next
}
