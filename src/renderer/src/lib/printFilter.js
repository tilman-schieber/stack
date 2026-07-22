// Rules for which printings to show in the art picker.

// A printing usable in sanctioned paper play — excludes joke/un-set cards,
// oversized/memorabilia, and digital-only (Alchemy/MTGO) printings.
export function isTournamentLegal(card) {
  if (card.border_color === 'silver' || card.border_color === 'gold') return false
  if (card.set_type === 'funny' || card.set_type === 'memorabilia') return false
  if (card.oversized) return false
  if (card.digital) return false
  if (Array.isArray(card.games) && card.games.length && !card.games.includes('paper')) {
    return false
  }
  return true
}

// Returns true if a printing should be shown given the settings.
// Favorites and the currently-used printing bypass filtering (see keepIds).
export function isAllowed(card, settings, keepIds) {
  if (keepIds && keepIds.has(card.id)) return true
  const set = (card.set || '').toLowerCase()
  if (settings.ignoredSets?.includes(set)) return false
  if (settings.ignoreGoldBordered && card.border_color === 'gold') return false
  if (settings.ignoreNonTournamentLegal && !isTournamentLegal(card)) return false
  return true
}
