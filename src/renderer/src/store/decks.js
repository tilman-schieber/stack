import { create } from 'zustand'
import { DEFAULT_DECKS, deckCardNames } from '../lib/defaultDecks.mjs'
import { buildLookup } from '../lib/resolveDeck.js'
import { signatureCard, deckColors } from '../lib/cardUtils.js'
import { slugify } from '../../../shared/backend.mjs'

// The list of saved decks, shared by every view that shows or picks decks, plus
// the first-start seeding of the default decks into that list.

// Resolve one default deck into a saveable record.
async function buildDefaultDeck(d) {
  const { cards } = await window.api.resolveDeck(deckCardNames(d))
  const lookup = buildLookup(cards)
  const entries = []
  const add = (list, section) => {
    for (const [qty, name] of list) {
      const card = lookup(name)
      if (!card) throw new Error(`Could not resolve "${name}" for ${d.name}`)
      const found = entries.find((e) => e.scryfallId === card.id && e.section === section)
      if (found) found.qty += qty
      else entries.push({ scryfallId: card.id, name: card.name, qty, section })
    }
  }
  add(d.cards, 'main')
  add(d.sideboard || [], 'sideboard')
  const mainCards = entries.filter((e) => e.section === 'main').map((e) => ({ card: lookup(e.name), qty: e.qty }))
  const art = signatureCard(mainCards, d.name)
  return { name: d.name, description: d.description || '', artId: art?.id || null, colors: deckColors(mainCards), entries }
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

  // App start: load the list, add the default decks the first time, and fill in
  // the art / colours of decks saved before those existed.
  init: async () => {
    await get().refresh()
    const settings = await window.api.getSettings()
    if (!settings.seededDecks) await get().restoreDefaults()
    // A deck whose cover was never chosen by hand should be wearing whatever the
    // current rule picks. Re-picking every start would mean a Scryfall round
    // trip per deck, so it happens once per rule change.
    const recut = !settings.coverRule2
    await get().backfillIdentity(recut)
    if (recut) await window.api.setSettings({ ...settings, coverRule2: true })
  },

  // A deck records the card whose art represents it and the colours it plays.
  // Decks saved before that existed get it filled in once, from cards already
  // cached, so this needs no network and never touches a deck's contents.
  backfillIdentity: async (recut = false) => {
    const stale = get().decks.filter(
      (d) => recut || !d.artId || !Array.isArray(d.colors) || !d.colors.length
    )
    if (!stale.length) return
    let changed = 0
    for (const summary of stale) {
      try {
        const rec = await window.api.loadDeck(summary.slug)
        const main = (rec.entries || []).filter((e) => (e.section || 'main') === 'main')
        if (!main.length) continue
        const { cards } = await window.api.ensureCards(main.map((e) => e.scryfallId))
        const byId = new Map(cards.map((c) => [c.id, c]))
        const pairs = main.map((e) => ({ card: byId.get(e.scryfallId), qty: e.qty })).filter((p) => p.card)
        if (!pairs.length) continue
        // A cover the user pinned is theirs; only automatic ones are re-picked.
        if (recut && rec.coverKey) continue
        const art = signatureCard(pairs, rec.name)
        if (art?.id === rec.artId && rec.colors?.length) continue
        await window.api.saveDeck({ ...rec, artId: art?.id || null, colors: deckColors(pairs) })
        changed++
      } catch {
        // a deck we can't resolve keeps its plain plate; not worth failing start-up
      }
    }
    if (changed) await get().refresh()
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
