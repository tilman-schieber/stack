// Tolerant parser for Arena/MTGO-style plain-text decklists.
//
// Handles lines like:
//   "4 Lightning Bolt"
//   "4x Lightning Bolt"
//   "Lightning Bolt"                (defaults to qty 1)
//   "2 Snapcaster Mage (MM2) 42"    (set/collector suffix stripped)
//   "1 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki"  (kept as-is)
// Section headers switch the current section:
//   "Deck", "Sideboard", "Commander", "Companion"  (with optional trailing ":")
// A blank line followed by more cards is treated as the start of the sideboard
// when no explicit "Sideboard" header is present (common in MTGO exports).
//
// Returns: { main: Entry[], sideboard: Entry[], commander: Entry[], errors: string[] }
// where Entry = { name, qty, section }

const HEADERS = {
  deck: 'main',
  maindeck: 'main',
  main: 'main',
  sideboard: 'sideboard',
  side: 'sideboard',
  commander: 'commander',
  companion: 'sideboard'
}

// leading quantity: "4 ", "4x ", "4X " (optional)
const QTY_RE = /^\s*(\d+)\s*[xX]?\s+(.*)$/
// trailing "(SET) 123" or "(SET) 123p" collector info
const SET_SUFFIX_RE = /\s*\([A-Za-z0-9]{2,5}\)\s+\S+\s*$/

export function parseDecklist(text) {
  const lines = String(text || '').split(/\r?\n/)
  const result = { main: [], sideboard: [], commander: [], errors: [] }

  let section = 'main'
  let sawCardInSection = false
  let blankSeenAfterCards = false
  let sawExplicitSideboard = false

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      if (sawCardInSection) blankSeenAfterCards = true
      continue
    }

    // Section header?
    const headerKey = line.replace(/:$/, '').toLowerCase()
    if (HEADERS[headerKey] !== undefined) {
      section = HEADERS[headerKey]
      if (section === 'sideboard') sawExplicitSideboard = true
      sawCardInSection = false
      blankSeenAfterCards = false
      continue
    }

    // Implicit sideboard: a blank line separated a second block of cards and no
    // explicit Sideboard header was given.
    if (blankSeenAfterCards && !sawExplicitSideboard && section === 'main') {
      section = 'sideboard'
      sawExplicitSideboard = true
    }
    blankSeenAfterCards = false

    const entry = parseLine(line, section)
    if (!entry) {
      result.errors.push(rawLine)
      continue
    }
    sawCardInSection = true
    addEntry(result[section] || result.main, entry)
  }

  return result
}

function parseLine(line, section) {
  let qty = 1
  let rest = line

  const m = line.match(QTY_RE)
  if (m) {
    qty = parseInt(m[1], 10)
    rest = m[2]
  }

  let name = rest.replace(SET_SUFFIX_RE, '').trim()
  // Normalize the double-faced separator to Scryfall's canonical " // ".
  name = name.replace(/\s*\/\/\s*/g, ' // ').trim()

  if (!name || !Number.isFinite(qty) || qty < 1) return null
  return { name, qty, section }
}

// Merge duplicate names within a section.
function addEntry(list, entry) {
  const existing = list.find((e) => e.name.toLowerCase() === entry.name.toLowerCase())
  if (existing) existing.qty += entry.qty
  else list.push(entry)
}
