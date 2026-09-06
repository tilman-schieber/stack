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

// Pick an image url from a card, by variant:
//   ''/'front'/'normal' -> the whole front card at 488px
//   'small' / 'large'    -> the same at 146px / 672px
//   'back' / 'back-small'-> the second face (transform / MDFC)
//   'art'                -> the cropped illustration, for deck banners
// Size matters: `normal` is 81kB and `small` is 12kB, and a card drawn 100px
// wide on a board does not need the larger one.
export function imageUrlFor(card, variant = 'normal') {
  if (!card) return null
  if (variant === 'art') {
    return card.image_uris?.art_crop || card.card_faces?.find((f) => f.image_uris?.art_crop)?.image_uris?.art_crop || null
  }
  const size = variant === 'small' || variant === 'back-small' ? 'small' : variant === 'large' ? 'large' : 'normal'
  if (variant === 'back' || variant === 'back-small') {
    return card.card_faces?.[1]?.image_uris?.[size] || null
  }
  if (card.image_uris?.[size]) return card.image_uris[size]
  return card.card_faces?.find((f) => f.image_uris?.[size])?.image_uris?.[size] || null
}

export function createScryfallClient({ headers: extraHeaders = {} } = {}) {
  const HEADERS = { Accept: 'application/json', ...extraHeaders }
  const delay = (ms) => new Promise((r) => setTimeout(r, ms))

  // --- rate limiter: requests start >=100ms apart (Scryfall asks for 50-100ms) ---
  //
  // This gates when a request may *start*, not when the one before it finished.
  // Waiting for each response before counting the gap meant four batched
  // lookups cost four round trips end to end — five seconds of mostly waiting —
  // when the limit itself allows them to overlap.
  const MIN_GAP = 100
  let nextSlot = Promise.resolve()
  function throttled(fn) {
    const slot = nextSlot
    nextSlot = slot.then(() => delay(MIN_GAP), () => delay(MIN_GAP))
    return slot.then(fn)
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
  // The batches are asked for together rather than one after the other: the
  // limiter still spaces their starts, so a 228-card lookup costs one round trip
  // plus 300ms instead of four round trips.
  async function collection(identifiers, notFoundKey) {
    const found = []
    const notFound = []
    const pages = await Promise.all(
      chunk(identifiers, 75).map((group) =>
        apiFetch(`${SCRYFALL_BASE}/cards/collection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifiers: group })
        })
      )
    )
    for (const data of pages) {
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
