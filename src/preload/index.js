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
  deleteDeck: (slug) => ipcRenderer.invoke('decks:delete', slug)
}

contextBridge.exposeInMainWorld('api', api)
