// Scryfall API client, shared by the Electron main process and the web build.
// Docs: https://scryfall.com/docs/api
// Scryfall asks clients to send a User-Agent + Accept header, to throttle to
// ~10 req/s (we use ~100ms between requests) and to cache data locally. A browser
// can't set User-Agent (it is a forbidden header), so it is only passed by the
// main process.

export const SCRYFALL_BASE = 'https://api.scryfall.com'

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

function hasImage(card) {
  return !!(card.image_uris?.normal || card.card_faces?.some((f) => f.image_uris?.normal))
}

// Pick an image url from a card.
//   face 'back' -> the second card face (transform / MDFC)
//   face 'art'  -> the cropped illustration, for deck banners
//   otherwise   -> the whole front card
export function imageUrlFor(card, face) {
  if (!card) return null
  if (face === 'back') {
    return card.card_faces?.[1]?.image_uris?.normal || null
  }
  if (face === 'art') {
    return card.image_uris?.art_crop || card.card_faces?.find((f) => f.image_uris?.art_crop)?.image_uris?.art_crop || null
  }
  if (card.image_uris?.normal) return card.image_uris.normal
  const front = card.card_faces?.find((f) => f.image_uris?.normal)
  return front?.image_uris?.normal || null
}

export function createScryfallClient({ headers: extraHeaders = {} } = {}) {
  const HEADERS = { Accept: 'application/json', ...extraHeaders }
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))

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

  // POST /cards/collection with a list of identifiers (max 75 per request).
  // notFoundKey names the identifier field to report for misses.
  async function collection(identifiers, notFoundKey) {
    const found = []
    const notFound = []
    for (const group of chunk(identifiers, 75)) {
      const data = await apiFetch(`${SCRYFALL_BASE}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: group })
      })
      if (Array.isArray(data.data)) found.push(...data.data)
      if (Array.isArray(data.not_found)) {
        for (const nf of data.not_found) notFound.push(nf[notFoundKey])
      }
    }
    return { found, notFound }
  }

  // Resolve a list of card names to full card objects.
  // names: string[]  ->  { found: card[], notFound: string[] }
  async function resolveByNames(names) {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
    return collection(unique.map(nameIdentifier), 'name')
  }

  // Fetch full card objects by their Scryfall ids (used to warm the cache when
  // opening a saved deck whose metadata isn't cached locally).
  async function resolveByIds(ids) {
    const unique = [...new Set(ids.filter(Boolean))]
    return collection(
      unique.map((id) => ({ id })),
      'id'
    )
  }

  // Full-text search using Scryfall query syntax. Returns first page of cards.
  // GET /cards/search?q=...&unique=cards
  async function search(query) {
    const q = (query || '').trim()
    if (!q) return []
    const url = `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name`
    try {
      const data = await apiFetch(url)
      return Array.isArray(data.data) ? data.data : []
    } catch (err) {
      // Scryfall returns 404 when a search matches nothing — treat as empty.
      if (/404/.test(String(err.message))) return []
      throw err
    }
  }

  // Fetch one page of all printings of a card. `uri` is a card's `prints_search_uri`
  // (already scoped to that oracle + unique:prints) for the first page, or a
  // `next_page` url for subsequent pages.
  // Returns { cards, nextPage } — nextPage is null when there are no more.
  async function getPrints(uri) {
    if (!uri || !uri.startsWith(`${SCRYFALL_BASE}/`)) throw new Error('Invalid prints URI')
    try {
      const data = await apiFetch(uri)
      const cards = (Array.isArray(data.data) ? data.data : []).filter(hasImage)
      return { cards, nextPage: data.has_more ? data.next_page : null }
    } catch (err) {
      if (/404/.test(String(err.message))) return { cards: [], nextPage: null }
      throw err
    }
  }

  return { resolveByNames, resolveByIds, search, getPrints }
}
