// Global (not deck-specific) token-image favorites. Stored in the favorites
// table under a synthetic key so they persist and are shared across decks/games.

export const TOKENS_FAV_KEY = '__tokens__'

// Load favorited token card objects, in saved order. Ids are resolved to full
// Scryfall cards (fetched if not already cached).
export async function loadFavoriteTokens() {
  const { favorites } = await window.api.getPrefs(TOKENS_FAV_KEY)
  if (!favorites?.length) return []
  const { cards } = await window.api.ensureCards(favorites)
  const byId = new Map(cards.map((c) => [c.id, c]))
  return favorites.map((id) => byId.get(id)).filter(Boolean)
}

// Toggle a token id in the favorites list; returns the new id array.
export async function toggleFavoriteToken(id) {
  const { favorites } = await window.api.toggleFavoritePrint(TOKENS_FAV_KEY, id)
  return favorites
}
