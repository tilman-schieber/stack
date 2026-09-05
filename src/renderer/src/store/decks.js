import { create } from 'zustand'
import { DEFAULT_DECKS, deckCardNames } from '../lib/defaultDecks.js'
import { buildLookup } from '../lib/resolveDeck.js'
import { slugify } from '../../../shared/backend.mjs'

// The list of saved decks, shared by every view that shows or picks decks, plus
// the first-start seeding of the default decks into that list.

// Resolve one default deck into a saveable record.
async function buildDefaultDeck(d) {
  const { cards } = await window.api.resolveDeck(deckCardNames(d))
  const lookup = buildLookup(cards)
  const entries = []
  for (const [qty, name] of d.cards) {
    const card = lookup(name)
    if (!card) throw new Error(`Could not resolve "${name}" for ${d.name}`)
    const found = entries.find((e) => e.scryfallId === card.id)
    if (found) found.qty += qty
    else entries.push({ scryfallId: card.id, name: card.name, qty, section: 'main' })
  }
  return { name: d.name, description: d.description || '', entries }
}

export const useDecks = create((set, get) => ({
  decks: [], // summaries: { slug, name, description, updatedAt, count }
  loaded: false,
  seeding: false,
  seedError: null,

  refresh: async () => {
    const decks = await window.api.listDecks()
    set({ decks, loaded: true })
    return decks
  },

  // App start: load the list and, the first time, add the default decks.
  // The flag is only set once seeding succeeds, so an offline first start
  // tries again next time. Deleting the defaults later is respected.
  init: async () => {
    await get().refresh()
    const settings = await window.api.getSettings()
    if (!settings.seededDecks) await get().restoreDefaults()
  },

  // Save every default deck that isn't in the list (matched by name).
  restoreDefaults: async () => {
    if (get().seeding) return
    set({ seeding: true, seedError: null })
    try {
      const existing = new Set((await get().refresh()).map((d) => d.slug))
      // Lists sort by last update, so save in reverse to keep the file's order on top.
      for (const d of [...DEFAULT_DECKS].reverse()) {
        if (existing.has(slugify(d.name))) continue
        await window.api.saveDeck(await buildDefaultDeck(d))
      }
      await window.api.setSettings({ seededDecks: true })
      await get().refresh()
    } catch (err) {
      set({ seedError: err.message })
    } finally {
      set({ seeding: false })
    }
  }
}))

// Default decks not currently in the list.
export const missingDefaults = (decks) => DEFAULT_DECKS.filter((d) => !decks.some((x) => x.slug === slugify(d.name)))
