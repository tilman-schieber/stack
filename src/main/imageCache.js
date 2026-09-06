// Local image cache + custom `card://` protocol handler.
// Renderer uses <img src="card://<scryfallId>"> and images are lazily downloaded
// from Scryfall on first use, then served from disk (offline-capable thereafter).
import { app, protocol, net } from 'electron'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import path from 'path'
import * as db from './db.js'
import * as scryfall from './scryfall.js'
import { imageUrlFor } from '../shared/scryfall.mjs'

const IMG_HEADERS = { 'User-Agent': 'Stack/0.2 (github.com/tilman-schieber/stack)' }

let dir
function cacheDir() {
  if (!dir) dir = path.join(app.getPath('userData'), 'card-cache')
  return dir
}

// Register the scheme as privileged. Must run before app is ready.
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'card',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

async function ensureImage(id, face) {
  await fs.mkdir(cacheDir(), { recursive: true })
  const suffix = face === 'back' ? '-back' : face === 'art' ? '-art' : ''
  const file = path.join(cacheDir(), `${id}${suffix}.jpg`)
  if (existsSync(file)) return file

  // A card we've never seen (an online opponent's, referenced by id only): fetch
  // its data first so the image — and later lookups — work.
  let card = db.getCard(id)
  if (!card) {
    const { found } = await scryfall.resolveByIds([id])
    db.putCards(found)
    card = db.getCard(id)
  }
  const url = imageUrlFor(card, face)
  if (!url) throw new Error(`No image url for card ${id}${suffix}`)

  const res = await fetch(url, { headers: IMG_HEADERS })
  if (!res.ok) throw new Error(`Image download failed (${res.status}) for ${id}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, buf)
  await fs.rename(tmp, file)
  return file
}

// Register the protocol handler. Must run after app is ready.
export function registerHandler() {
  protocol.handle('card', async (request) => {
    try {
      const url = new URL(request.url)
      const id = url.hostname
      // card://<id> (front), card://<id>/back (second face), card://<id>/art (crop)
      const path = url.pathname.replace(/^\/+/, '')
      const face = path === 'back' ? 'back' : path === 'art' ? 'art' : 'front'
      const file = await ensureImage(id, face)
      // Serve via net.fetch on a file:// url so Electron streams it efficiently.
      return net.fetch(`file://${file}`)
    } catch (err) {
      return new Response(`card image error: ${err.message}`, { status: 404 })
    }
  })
}
