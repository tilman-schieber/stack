import { app, shell, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import * as scryfall from './scryfall.js'
import * as db from './db.js'
import * as deckStore from './deckStore.js'
import * as settings from './settings.js'
import { registerScheme, registerHandler } from './imageCache.js'

// Stable identity for a card across printings (matches db.js oracleKeyOf).
function oracleKey(card) {
  return card.oracle_id || card.card_faces?.[0]?.oracle_id || String(card.name || '').toLowerCase()
}

// Swap each resolved card for the user's chosen default printing, if any.
async function applyDefaultPrintings(cards) {
  const targets = new Map() // originalId -> defaultId
  const needed = []
  for (const c of cards) {
    const defaultId = db.getDefaultPrintId(oracleKey(c)) // first favorite = import default
    if (defaultId && defaultId !== c.id) {
      targets.set(c.id, defaultId)
      needed.push(defaultId)
    }
  }
  const missing = db.missingIds(needed)
  if (missing.length) {
    const { found } = await scryfall.resolveByIds(missing)
    db.putCards(found)
  }
  const out = []
  for (const c of cards) {
    const targetId = targets.get(c.id)
    const replacement = targetId ? db.getCard(targetId) : null
    out.push(replacement || c)
  }
  return out
}

// The custom scheme must be registered before the app is ready.
registerScheme()

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#14151a',
    title: 'MTG Deck Builder',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // Forward renderer console warnings/errors to the terminal so they're visible
  // in dev logs (renderer console normally only shows in DevTools).
  win.webContents.on('console-message', (...args) => {
    // Electron 33 positional signature: (event, level, message, line, sourceId)
    const level = args[1]
    const message = args[2]
    const sourceId = args[4]
    const line = args[3]
    if (typeof level === 'number' && level >= 1) {
      console.log(`[renderer] ${message}  (${sourceId}:${line})`)
    }
  })

  // Surface uncaught renderer crashes.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', JSON.stringify(details))
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Open DevTools automatically in dev so errors are easy to inspect.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  // electron-vite injects ELECTRON_RENDERER_URL in dev; load the built file otherwise.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
  }
}

// ---- IPC handlers ----
function registerIpc() {
  // Resolve an Arena decklist (array of {name, qty, section}) into full cards.
  ipcMain.handle('deck:resolve', async (_e, names) => {
    const { found, notFound } = await scryfall.resolveByNames(names)
    db.putCards(found)
    const cards = await applyDefaultPrintings(found)
    return { cards, notFound }
  })

  // Ensure metadata for a set of card ids is available (used when opening a
  // saved deck). Returns the resolved cards, fetching any that are missing.
  ipcMain.handle('deck:ensureCards', async (_e, ids) => {
    const missing = db.missingIds(ids)
    if (missing.length) {
      const { found } = await scryfall.resolveByIds(missing)
      db.putCards(found)
    }
    const cards = []
    for (const id of ids) {
      const c = db.getCard(id)
      if (c) cards.push(c)
    }
    return { cards }
  })

  ipcMain.handle('cards:search', async (_e, query) => {
    const cards = await scryfall.search(query)
    db.putCards(cards)
    return cards
  })

  // Fetch a page of all printings of a card (uri = prints_search_uri or next_page).
  ipcMain.handle('prints:get', async (_e, uri) => {
    const { cards, nextPage } = await scryfall.getPrints(uri)
    db.putCards(cards)
    return { cards, nextPage }
  })

  ipcMain.handle('prefs:get', (_e, key) => db.getFavorites(key))
  ipcMain.handle('prefs:toggleFavorite', (_e, key, id) => db.toggleFavorite(key, id))
  ipcMain.handle('prefs:setFavorites', (_e, key, ids) => db.setFavorites(key, ids))

  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch))

  ipcMain.handle('decks:save', (_e, deck) => deckStore.saveDeck(deck))
  ipcMain.handle('decks:list', () => deckStore.listDecks())
  ipcMain.handle('decks:load', (_e, slug) => deckStore.loadDeck(slug))
  ipcMain.handle('decks:delete', (_e, slug) => deckStore.deleteDeck(slug))
}

app.whenReady().then(() => {
  db.init()
  registerHandler()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
