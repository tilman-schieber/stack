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
