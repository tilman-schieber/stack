// The web build's `window.api`: the same surface the Electron preload exposes
// (src/preload/index.js), backed by Scryfall over CORS, IndexedDB for card data,
// favorites, decks and settings, and the browser's file dialogs. The renderer
// cannot tell the two apart. Installed by main.jsx when no preload is present.
import {
  createScryfallClient,
  imageUrlFor,
  SCRYFALL_BASE
} from '../../../shared/scryfall.mjs'
import {
  applyDefaultPrintings,
  slugify,
  deckSummary,
  SETTINGS_DEFAULTS,
  mergeSettings
} from '../../../shared/backend.mjs'
import { setImageResolver } from '../lib/cardUtils.js'
import { openDatabase, get, getAll, put, del, getMany, putMany } from './idb.js'

const DB_NAME = 'stack'
const DB_VERSION = 1
const STORES = { prints: 'prints', favorites: 'favorites', decks: 'decks', settings: 'settings' }

export async function createWebApi() {
  const idb = await openDatabase(DB_NAME, DB_VERSION, (db) => {
    db.createObjectStore(STORES.prints, { keyPath: 'id' }) // full Scryfall card json
    db.createObjectStore(STORES.favorites, { keyPath: 'key' }) // { key, ids: [] }, ids[0] = import default
    db.createObjectStore(STORES.decks, { keyPath: 'slug' })
    db.createObjectStore(STORES.settings, { keyPath: 'key' })
  })
  const scryfall = createScryfallClient()

  // ---------- card images ----------
  // <img src> needs a URL synchronously, so remember the image URLs of every
  // card that passes through the API. Ids we have never seen (an online
  // opponent's cards) fall back to Scryfall's redirecting image endpoint and are
  // fetched in the background so later renders use direct image URLs.
  const images = new Map() // id -> { front, back }
  const unknown = new Set()
  let flushTimer = null
  function remember(cards) {
    for (const c of cards) {
      if (c?.id) images.set(c.id, { front: imageUrlFor(c, 'front'), back: imageUrlFor(c, 'back') })
    }
  }
  function noteUnknown(id) {
    if (images.has(id) || unknown.has(id)) return
    unknown.add(id)
    if (flushTimer) return
    flushTimer = setTimeout(async () => {
      flushTimer = null
      const ids = [...unknown]
      try {
        await ensureCards(ids)
      } catch (err) {
        console.warn('[web] could not fetch card data for images:', err)
      }
      // An id Scryfall doesn't know stays in `unknown` so it isn't asked for again.
      for (const id of ids) if (images.has(id)) unknown.delete(id)
    }, 50)
  }
  setImageResolver((id, back) => {
    const known = images.get(id)
    if (known) return back ? known.back : known.front
    noteUnknown(id)
    return `${SCRYFALL_BASE}/cards/${encodeURIComponent(id)}?format=image&version=normal${back ? '&face=back' : ''}`
  })

  // ---------- card store (mirrors src/main/db.js) ----------
  const db = {
    async putCards(cards) {
      const list = (cards || []).filter((c) => c && c.id)
      if (!list.length) return
      remember(list)
      await putMany(idb, STORES.prints, list)
    },
    async getCard(id) {
      const card = await get(idb, STORES.prints, id)
      if (card) remember([card])
      return card
    },
    async getCards(ids) {
      const cards = (await getMany(idb, STORES.prints, ids)).filter(Boolean)
      remember(cards)
      return cards
    },
    async missingIds(ids) {
      if (!ids || !ids.length) return []
      const found = await getMany(idb, STORES.prints, ids)
      return ids.filter((_, i) => !found[i])
    },
    async getFavorites(key) {
      const rec = await get(idb, STORES.favorites, key)
      return { favorites: rec?.ids || [] }
    },
    async setFavorites(key, ids) {
      const clean = [...new Set((ids || []).filter(Boolean))]
      if (clean.length) await put(idb, STORES.favorites, { key, ids: clean })
      else await del(idb, STORES.favorites, key)
      return { favorites: clean }
    },
    async getDefaultPrintId(key) {
      return (await db.getFavorites(key)).favorites[0] ?? null
    }
  }

  // ---------- cards ----------
  async function resolveDeck(names) {
    const { found, notFound } = await scryfall.resolveByNames(names)
    await db.putCards(found)
    const cards = await applyDefaultPrintings(found, { db, scryfall })
    return { cards, notFound }
  }

  async function ensureCards(ids) {
    const missing = await db.missingIds(ids)
    if (missing.length) {
      const { found } = await scryfall.resolveByIds(missing)
      await db.putCards(found)
    }
    return { cards: await db.getCards(ids) }
  }

  async function searchCards(query) {
    const cards = await scryfall.search(query)
    await db.putCards(cards)
    return cards
  }

  async function getPrints(uri) {
    const { cards, nextPage } = await scryfall.getPrints(uri)
    await db.putCards(cards)
    return { cards, nextPage }
  }

  // ---------- favorites ----------
  const getPrefs = (key) => db.getFavorites(key)
  async function toggleFavoritePrint(key, id) {
    const current = (await db.getFavorites(key)).favorites
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    return db.setFavorites(key, next)
  }
  const setFavoritePrints = (key, ids) => db.setFavorites(key, ids)

  // ---------- settings ----------
  async function getSettings() {
    const rec = await get(idb, STORES.settings, 'settings')
    return { ...SETTINGS_DEFAULTS, ...(rec?.value || {}) }
  }
  async function setSettings(patch) {
    const next = mergeSettings(await getSettings(), patch)
    await put(idb, STORES.settings, { key: 'settings', value: next })
    return next
  }

  // ---------- decks (mirrors src/main/deckStore.js) ----------
  async function saveDeck(deck) {
    const record = {
      slug: slugify(deck.name),
      name: deck.name,
      description: deck.description || '',
      updatedAt: new Date().toISOString(),
      entries: deck.entries || []
    }
    await put(idb, STORES.decks, record)
    return record
  }
  async function listDecks() {
    const out = (await getAll(idb, STORES.decks)).map(deckSummary)
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return out
  }
  async function loadDeck(slug) {
    const rec = await get(idb, STORES.decks, slugify(slug))
    if (!rec) throw new Error(`No saved deck "${slug}"`)
    return rec
  }
  async function deleteDeck(slug) {
    await del(idb, STORES.decks, slugify(slug))
    return true
  }
  async function renameDeck(slug, newName) {
    const name = String(newName || '').trim()
    if (!name) throw new Error('A deck needs a name')
    const record = await loadDeck(slug)
    const saved = await saveDeck({ ...record, name })
    if (saved.slug !== slugify(slug)) await deleteDeck(slug)
    return saved
  }
  async function duplicateDeck(slug) {
    const record = await loadDeck(slug)
    const existing = new Set((await listDecks()).map((d) => d.slug))
    let name = `${record.name} (copy)`
    for (let i = 2; existing.has(slugify(name)); i++) name = `${record.name} (copy ${i})`
    return saveDeck({ ...record, name })
  }

  // ---------- decklist files ----------
  // The File System Access API gives real save/open dialogs where it exists
  // (Chromium); elsewhere a download link and a file input do the job.
  const DECKLIST_TYPES = [{ description: 'Decklist', accept: { 'text/plain': ['.txt', '.dec', '.dek', '.mwdeck'] } }]
  const BACKUP_TYPES = [{ description: 'Deck backup', accept: { 'application/json': ['.json'] } }]
  const typesFor = (ext) => (ext === 'json' ? BACKUP_TYPES : DECKLIST_TYPES)
  const stripExt = (name) => String(name).replace(/\.[^.]+$/, '')

  async function exportDeckFile(defaultName, text, ext = 'txt') {
    const fileName = `${String(defaultName || 'deck').replace(/[\\/:*?"<>|]+/g, '-')}.${ext === 'json' ? 'json' : 'txt'}`
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: typesFor(ext) })
        const writable = await handle.createWritable()
        await writable.write(String(text))
        await writable.close()
        return handle.name
      } catch (err) {
        if (err?.name === 'AbortError') return null
        // e.g. no user activation left: fall through to a plain download
      }
    }
    const url = URL.createObjectURL(new Blob([String(text)], { type: ext === 'json' ? 'application/json' : 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return fileName
  }

  async function importDeckFile(ext = 'txt') {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({ types: typesFor(ext), multiple: false })
        const file = await handle.getFile()
        return { name: stripExt(file.name), text: await file.text() }
      } catch (err) {
        if (err?.name === 'AbortError') return null
        // fall through to the file input
      }
    }
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = ext === 'json' ? '.json,application/json' : '.txt,.dec,.dek,.mwdeck,text/plain'
      input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return resolve(null)
        file.text().then((text) => resolve({ name: stripExt(file.name), text }), reject)
      }
      input.oncancel = () => resolve(null)
      input.click()
    })
  }

  return {
    resolveDeck,
    ensureCards,
    searchCards,
    getPrints,
    getPrefs,
    toggleFavoritePrint,
    setFavoritePrints,
    getSettings,
    setSettings,
    saveDeck,
    listDecks,
    loadDeck,
    deleteDeck,
    renameDeck,
    duplicateDeck,
    exportDeckFile,
    importDeckFile
  }
}
