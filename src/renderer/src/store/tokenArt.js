import { create } from 'zustand'

// Resolves and remembers artwork for tokens created during a game. A token has
// no fixed printing, so we look up matching token printings on Scryfall by the
// token's characteristics, default to a saved choice (or the first), and let the
// player cycle art in the zoom view. The chosen art is persisted per token type
// so future tokens of that type reuse it.

// A stable key for a token type.
export function tokenKey(def) {
  if (!def) return ''
  const pt = def.power != null ? `${def.power}/${def.toughness}` : ''
  return [def.name, pt, (def.colors || []).join(''), (def.subtypes || []).join('')].join('|')
}

function buildQuery(def) {
  const parts = ['is:token', `!"${def.name}"`]
  if (def.power != null && def.toughness != null) parts.push(`pow=${def.power}`, `tou=${def.toughness}`)
  const cols = def.colors || []
  parts.push(cols.length ? `c=${cols.join('').toLowerCase()}` : 'c=c')
  return parts.join(' ')
}

const prefKey = (key) => 'token:' + key

export const useTokenArt = create((set, get) => ({
  cache: {}, // tokenKey -> { loading, prints: [scryfallCard], chosenId }

  // Ensure art for a token type is loaded (idempotent — safe to call on render).
  ensure: async (def) => {
    const key = tokenKey(def)
    if (!key || get().cache[key]) return
    set((s) => ({ cache: { ...s.cache, [key]: { loading: true, prints: [], chosenId: null } } }))
    // Keep only the exact single-faced token — avoids double-faced tokens like
    // "Goblin // Soldier" whose front art is a different creature.
    const exact = (list) => (list || []).filter((c) => c.name === def.name && !c.card_faces)
    try {
      const results = await window.api.searchCards(buildQuery(def))
      const base = exact(results)[0] || results[0]
      let prints = exact(results)
      // Fetch every printing (art variant) of the matched token.
      if (base?.prints_search_uri) {
        const { cards } = await window.api.getPrints(base.prints_search_uri)
        const ex = exact(cards)
        if (ex.length) prints = ex
        else if (cards?.length) prints = cards
      }
      if (!prints.length) {
        const fb = await window.api.searchCards(`is:token !"${def.name}"`)
        prints = exact(fb).length ? exact(fb) : fb
      }
      const { favorites } = await window.api.getPrefs(prefKey(key))
      const savedId = favorites?.[0]
      const chosenId = savedId && prints.some((p) => p.id === savedId) ? savedId : prints[0]?.id || null
      set((s) => ({ cache: { ...s.cache, [key]: { loading: false, prints, chosenId } } }))
    } catch {
      set((s) => ({ cache: { ...s.cache, [key]: { loading: false, prints: [], chosenId: null } } }))
    }
  },

  // Cycle to the previous/next art variant and remember the choice.
  cycle: (key, dir) => {
    const entry = get().cache[key]
    if (!entry || entry.prints.length < 2) return
    const i = Math.max(0, entry.prints.findIndex((p) => p.id === entry.chosenId))
    const next = entry.prints[(i + dir + entry.prints.length) % entry.prints.length]
    set((s) => ({ cache: { ...s.cache, [key]: { ...entry, chosenId: next.id } } }))
    window.api.setFavoritePrints(prefKey(key), [next.id])
  }
}))
