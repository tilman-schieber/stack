// Named deck persistence — one JSON file per deck in userData/decks/.
import { app } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

let dir
function decksDir() {
  if (!dir) dir = path.join(app.getPath('userData'), 'decks')
  return dir
}

function slugify(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'deck'
  )
}

// deck: { name, entries: [{ scryfallId, name, qty, section }] }
export async function saveDeck(deck) {
  await fs.mkdir(decksDir(), { recursive: true })
  const slug = slugify(deck.name)
  const record = {
    slug,
    name: deck.name,
    updatedAt: new Date().toISOString(),
    entries: deck.entries || []
  }
  const file = path.join(decksDir(), `${slug}.json`)
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(record, null, 2))
  await fs.rename(tmp, file)
  return record
}

export async function listDecks() {
  try {
    const files = await fs.readdir(decksDir())
    const out = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      try {
        const raw = await fs.readFile(path.join(decksDir(), f), 'utf8')
        const rec = JSON.parse(raw)
        out.push({
          slug: rec.slug,
          name: rec.name,
          updatedAt: rec.updatedAt,
          count: (rec.entries || []).reduce((s, e) => s + (e.qty || 0), 0)
        })
      } catch {
        // skip corrupt files
      }
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return out
  } catch {
    return []
  }
}

export async function loadDeck(slug) {
  const file = path.join(decksDir(), `${slugify(slug)}.json`)
  const raw = await fs.readFile(file, 'utf8')
  return JSON.parse(raw)
}

export async function deleteDeck(slug) {
  const file = path.join(decksDir(), `${slugify(slug)}.json`)
  await fs.rm(file, { force: true })
  return true
}

// Rename a deck. The file is keyed by the slugified name, so a rename writes the
// record under the new slug and removes the old file (unless the slug is the same).
export async function renameDeck(slug, newName) {
  const name = String(newName || '').trim()
  if (!name) throw new Error('A deck needs a name')
  const record = await loadDeck(slug)
  const saved = await saveDeck({ ...record, name })
  if (saved.slug !== slugify(slug)) await deleteDeck(slug)
  return saved
}

// Duplicate a deck as "<name> (copy)", picking a free name if that exists.
export async function duplicateDeck(slug) {
  const record = await loadDeck(slug)
  const existing = new Set((await listDecks()).map((d) => d.slug))
  let name = `${record.name} (copy)`
  for (let i = 2; existing.has(slugify(name)); i++) name = `${record.name} (copy ${i})`
  return saveDeck({ ...record, name })
}
