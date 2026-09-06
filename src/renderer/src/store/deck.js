import { create } from 'zustand'

// An entry pairs a resolved Scryfall card with a quantity + section.
// entries: { id, card, qty, section }[]   section = 'main' | 'sideboard'

// Build a name->card lookup that also indexes each face of double-faced cards.
function buildLookup(cards) {
  const map = new Map()
  for (const card of cards) {
    const keys = [card.name]
    if (Array.isArray(card.card_faces)) {
      for (const f of card.card_faces) if (f.name) keys.push(f.name)
    }
    for (const k of keys) {
      const key = k.toLowerCase()
      if (!map.has(key)) map.set(key, card)
    }
  }
  return (name) => map.get(String(name).toLowerCase())
}

function mergeEntry(entries, card, qty, section) {
  const found = entries.find((e) => e.id === card.id && e.section === section)
  if (found) found.qty += qty
  else entries.push({ id: card.id, card, qty, section })
}

export const useDeck = create((set, get) => ({
  deckName: 'Untitled Deck',
  description: '', // free-text notes saved with the deck
  entries: [],
  loading: false,
  notFound: [], // names that could not be resolved
  parseErrors: [], // raw lines the parser could not read

  setDeckName: (name) => set({ deckName: name }),
  setDescription: (description) => set({ description }),

  newDeck: () =>
    set({ deckName: 'Untitled Deck', description: '', entries: [], notFound: [], parseErrors: [] }),

  // Import a parsed decklist (from parseDecklist): resolve names -> cards. The
  // app is 1v1 constructed, so a pasted list's Commander section joins the main
  // deck rather than being dropped.
  importParsed: async (parsed, deckName) => {
    const all = [...parsed.main, ...parsed.commander.map((e) => ({ ...e, section: 'main' })), ...parsed.sideboard]
    if (all.length === 0) {
      set({ parseErrors: parsed.errors || [], notFound: [] })
      return
    }
    set({ loading: true })
    try {
      const names = all.map((e) => e.name)
      const { cards, notFound } = await window.api.resolveDeck(names)
      const lookup = buildLookup(cards)
      const entries = []
      const unresolved = [...notFound]
      for (const e of all) {
        const card = lookup(e.name)
        if (!card) {
          if (!unresolved.includes(e.name)) unresolved.push(e.name)
          continue
        }
        mergeEntry(entries, card, e.qty, e.section)
      }
      set({
        entries,
        notFound: unresolved,
        parseErrors: parsed.errors || [],
        deckName: deckName || get().deckName,
        loading: false
      })
    } catch (err) {
      set({ loading: false, notFound: [`Error: ${err.message}`] })
    }
  },

  // Add a single card (from search) to a section.
  addCard: (card, section = 'main', qty = 1) =>
    set((state) => {
      const entries = state.entries.map((e) => ({ ...e }))
      mergeEntry(entries, card, qty, section)
      return { entries }
    }),

  setQty: (id, section, qty) =>
    set((state) => {
      const q = Math.max(0, qty)
      if (q === 0) {
        return { entries: state.entries.filter((e) => !(e.id === id && e.section === section)) }
      }
      return {
        entries: state.entries.map((e) =>
          e.id === id && e.section === section ? { ...e, qty: q } : e
        )
      }
    }),

  removeCard: (id, section) =>
    set((state) => ({
      entries: state.entries.filter((e) => !(e.id === id && e.section === section))
    })),

  // Swap the printing (art) used for a specific deck entry.
  setEntryPrinting: (oldId, section, card) =>
    set((state) => {
      // If the chosen printing already exists in this section, merge quantities.
      const dup = state.entries.find(
        (e) => e.id === card.id && e.section === section && e.id !== oldId
      )
      const moving = state.entries.find((e) => e.id === oldId && e.section === section)
      if (!moving) return {}
      if (dup) {
        return {
          entries: state.entries
            .filter((e) => !(e.id === oldId && e.section === section))
            .map((e) =>
              e.id === card.id && e.section === section
                ? { ...e, qty: e.qty + moving.qty }
                : e
            )
        }
      }
      return {
        entries: state.entries.map((e) =>
          e.id === oldId && e.section === section ? { ...e, id: card.id, card } : e
        )
      }
    }),

  // Load a saved deck record ({ name, entries:[{scryfallId,name,qty,section}] }).
  loadSaved: async (record) => {
    set({ loading: true })
    try {
      const ids = record.entries.map((e) => e.scryfallId)
      const { cards } = await window.api.ensureCards(ids)
      const byId = new Map(cards.map((c) => [c.id, c]))
      const entries = []
      const unresolved = []
      for (const e of record.entries) {
        const card = byId.get(e.scryfallId)
        if (!card) {
          unresolved.push(e.name)
          continue
        }
        entries.push({ id: card.id, card, qty: e.qty, section: e.section || 'main' })
      }
      set({
        entries,
        deckName: record.name,
        description: record.description || '',
        notFound: unresolved,
        parseErrors: [],
        loading: false
      })
    } catch (err) {
      set({ loading: false, notFound: [`Error: ${err.message}`] })
    }
  },

  // Serialize the current deck for saving.
  serialize: () => {
    const { deckName, description, entries } = get()
    return {
      name: deckName,
      description,
      entries: entries.map((e) => ({
        scryfallId: e.id,
        name: e.card.name,
        qty: e.qty,
        section: e.section
      }))
    }
  }
}))
