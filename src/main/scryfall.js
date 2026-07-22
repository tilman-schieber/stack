// Scryfall API client (main process).
// Docs: https://scryfall.com/docs/api
// Scryfall asks clients to send a User-Agent + Accept header and to throttle to
// ~10 req/s (we use ~100ms between requests) and to cache image data locally.

const BASE = 'https://api.scryfall.com'
const HEADERS = {
  'User-Agent': 'MtgDeckBuilder/0.1',
  Accept: 'application/json'
}

// --- simple sequential rate limiter (>=100ms between requests) ---
let chain = Promise.resolve()
function throttled(fn) {
  const run = chain.then(fn)
  // advance the chain regardless of success/failure, after a 100ms gap
  chain = run.then(
    () => delay(100),
    () => delay(100)
  )
  return run
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiFetch(url, options = {}) {
  return throttled(async () => {
    const res = await fetch(url, { ...options, headers: { ...HEADERS, ...options.headers } })
    if (!res.ok) {
      let detail = ''
      try {
        detail = (await res.json())?.details || ''
      } catch {
        // ignore body parse errors
      }
      throw new Error(`Scryfall ${res.status}: ${detail || res.statusText}`)
    }
    return res.json()
  })
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// Scryfall's /cards/collection matches double-faced cards by their FRONT face
// name, not the combined "Front // Back" name. Normalize identifiers so both
// Arena (front-only) and MTGO (full) decklists resolve.
function nameIdentifier(name) {
  const front = name.includes('//') ? name.split('//')[0].trim() : name
  return { name: front }
}

// Resolve a list of card names to full card objects via POST /cards/collection.
// names: string[]  ->  { found: card[], notFound: string[] }
// Max 75 identifiers per request, so we chunk.
export async function resolveByNames(names) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const found = []
  const notFound = []
  for (const group of chunk(unique, 75)) {
    const body = { identifiers: group.map(nameIdentifier) }
    const data = await apiFetch(`${BASE}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (Array.isArray(data.data)) found.push(...data.data)
    if (Array.isArray(data.not_found)) {
      for (const nf of data.not_found) notFound.push(nf.name)
    }
  }
  return { found, notFound }
}

// Fetch full card objects by their Scryfall ids (used to warm the cache when
// opening a saved deck whose metadata isn't cached locally).
export async function resolveByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  const found = []
  const notFound = []
  for (const group of chunk(unique, 75)) {
    const body = { identifiers: group.map((id) => ({ id })) }
    const data = await apiFetch(`${BASE}/cards/collection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (Array.isArray(data.data)) found.push(...data.data)
    if (Array.isArray(data.not_found)) {
      for (const nf of data.not_found) notFound.push(nf.id)
    }
  }
  return { found, notFound }
}

// Full-text search using Scryfall query syntax. Returns first page of cards.
// GET /cards/search?q=...&unique=cards
export async function search(query) {
  const q = (query || '').trim()
  if (!q) return []
  const url = `${BASE}/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`
  try {
    const data = await apiFetch(url)
    return Array.isArray(data.data) ? data.data : []
  } catch (err) {
    // Scryfall returns 404 when a search matches nothing — treat as empty.
    if (/404/.test(String(err.message))) return []
    throw err
  }
}

function hasImage(card) {
  return !!(card.image_uris?.normal || card.card_faces?.some((f) => f.image_uris?.normal))
}

// Fetch one page of all printings of a card. `uri` is a card's `prints_search_uri`
// (already scoped to that oracle + unique:prints) for the first page, or a
// `next_page` url for subsequent pages.
// Returns { cards, nextPage } — nextPage is null when there are no more.
export async function getPrints(uri) {
  if (!uri || !uri.startsWith(`${BASE}/`)) throw new Error('Invalid prints URI')
  try {
    const data = await apiFetch(uri)
    const cards = (Array.isArray(data.data) ? data.data : []).filter(hasImage)
    return { cards, nextPage: data.has_more ? data.next_page : null }
  } catch (err) {
    if (/404/.test(String(err.message))) return { cards: [], nextPage: null }
    throw err
  }
}
