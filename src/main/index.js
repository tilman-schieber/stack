import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { promises as fs } from 'fs'
import * as scryfall from './scryfall.js'
import * as db from './db.js'
import * as deckStore from './deckStore.js'
import * as settings from './settings.js'
import { registerScheme, registerHandler } from './imageCache.js'
import { applyDefaultPrintings } from '../shared/backend.mjs'

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
    title: 'Stack',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.js'),
      // The preload only uses contextBridge/ipcRenderer, so the renderer can run
      // in Chromium's OS sandbox.
      sandbox: true,
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
    const cards = await applyDefaultPrintings(found, { db, scryfall })
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
  ipcMain.handle('decks:rename', (_e, slug, name) => deckStore.renameDeck(slug, name))
  ipcMain.handle('decks:duplicate', (_e, slug) => deckStore.duplicateDeck(slug))

  // Deck manager file I/O: the renderer hands us decklist text to write, or asks
  // us to pick a text file to read. Paths never leave the main process.
  ipcMain.handle('decks:exportFile', async (e, defaultName, text) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export decklist',
      defaultPath: `${String(defaultName || 'deck').replace(/[\\/:*?"<>|]+/g, '-')}.txt`,
      filters: [{ name: 'Decklist', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return null
    await fs.writeFile(filePath, String(text), 'utf8')
    return path.basename(filePath)
  })
  ipcMain.handle('decks:importFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import decklist',
      properties: ['openFile'],
      filters: [
        { name: 'Decklist', extensions: ['txt', 'dec', 'dek', 'mwdeck'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (canceled || !filePaths?.length) return null
    const file = filePaths[0]
    const text = await fs.readFile(file, 'utf8')
    return { name: path.basename(file).replace(/\.[^.]+$/, ''), text }
  })
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
