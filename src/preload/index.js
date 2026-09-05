import { contextBridge, ipcRenderer } from 'electron'

// Typed, minimal surface exposed to the renderer. The renderer never touches
// the network or filesystem directly — everything goes through these calls.
const api = {
  // names: string[]  -> { cards: ScryfallCard[], notFound: string[] }
  resolveDeck: (names) => ipcRenderer.invoke('deck:resolve', names),
  // ids: string[]    -> { cards: ScryfallCard[] }
  ensureCards: (ids) => ipcRenderer.invoke('deck:ensureCards', ids),
  // query: string    -> ScryfallCard[]
  searchCards: (query) => ipcRenderer.invoke('cards:search', query),

  // uri: prints_search_uri | next_page  -> { cards, nextPage }
  getPrints: (uri) => ipcRenderer.invoke('prints:get', uri),
  // per-card printing preferences (key = oracle_id or lowercased name)
  getPrefs: (key) => ipcRenderer.invoke('prefs:get', key),
  toggleFavoritePrint: (key, id) => ipcRenderer.invoke('prefs:toggleFavorite', key, id),
  setFavoritePrints: (key, ids) => ipcRenderer.invoke('prefs:setFavorites', key, ids),

  // app-wide settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  saveDeck: (deck) => ipcRenderer.invoke('decks:save', deck),
  listDecks: () => ipcRenderer.invoke('decks:list'),
  loadDeck: (slug) => ipcRenderer.invoke('decks:load', slug),
  deleteDeck: (slug) => ipcRenderer.invoke('decks:delete', slug),
  renameDeck: (slug, name) => ipcRenderer.invoke('decks:rename', slug, name),
  duplicateDeck: (slug) => ipcRenderer.invoke('decks:duplicate', slug),
  // (defaultName, text, ext = 'txt') -> saved file name, or null if cancelled
  exportDeckFile: (defaultName, text, ext) => ipcRenderer.invoke('decks:exportFile', defaultName, text, ext),
  // (ext = 'txt') -> { name, text } | null
  importDeckFile: (ext) => ipcRenderer.invoke('decks:importFile', ext)
}

contextBridge.exposeInMainWorld('api', api)
