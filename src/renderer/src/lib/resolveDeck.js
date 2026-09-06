import { deckCoverage } from '@engine/classify.mjs'

// Build a case-insensitive name -> card lookup (indexing each face of DFCs).
export function buildLookup(cards) {
  const map = new Map()
  for (const card of cards) {
    const keys = [card.name]
    if (Array.isArray(card.card_faces)) for (const f of card.card_faces) if (f.name) keys.push(f.name)
    for (const k of keys) {
      const key = String(k).toLowerCase()
      if (!map.has(key)) map.set(key, card)
    }
  }
  return (name) => map.get(String(name).toLowerCase())
}

// Resolve a saved deck (by slug) into { name, cards, sideboard, commander,
// coverage, commanderIssues } for the engine. `cards` is the main deck, one
// entry per copy; `sideboard` likewise, for between-games sideboarding.
export async function resolveSavedDeck(slug) {
  const record = await window.api.loadDeck(slug)
  const main = (record.entries || []).filter((e) => (e.section || 'main') === 'main')
  const side = (record.entries || []).filter((e) => e.section === 'sideboard')
  const cmdEntries = (record.entries || []).filter((e) => e.section === 'commander')
  const { cards } = await window.api.ensureCards([...main, ...side, ...cmdEntries].map((e) => e.scryfallId))
  const byId = new Map(cards.map((c) => [c.id, c]))
  // Commander (903): the first card of the commander section, if any.
  const commander = cmdEntries.length ? byId.get(cmdEntries[0].scryfallId) || null : null
  const out = []
  const sideOut = []
  const missing = []
  const pairs = []
  for (const e of main) {
    const card = byId.get(e.scryfallId)
    if (!card) {
      missing.push(e.name)
      continue
    }
    for (let i = 0; i < e.qty; i++) out.push(card)
    pairs.push([e.qty, card])
  }
  for (const e of side) {
    const card = byId.get(e.scryfallId)
    if (card) for (let i = 0; i < e.qty; i++) sideOut.push(card)
  }
  if (missing.length) throw new Error(`Could not resolve: ${missing.join(', ')}`)
  if (out.length === 0) throw new Error('That deck has no cards in its main section')
  return { name: record.name, cards: out, sideboard: sideOut, commander, coverage: coverageOf(pairs), commanderIssues: commander ? commanderIssues(out, commander) : [] }
}

// Deck-construction problems for Commander (903.5): colour identity, singleton,
// 100 cards. Informational — the game can still be started.
export function commanderIssues(cards, commander) {
  const issues = []
  const identity = new Set(commander.color_identity || [])
  const outside = new Set()
  const counts = new Map()
  for (const c of cards) {
    for (const col of c.color_identity || []) if (!identity.has(col)) outside.add(c.name)
    if (!/\bBasic\b/.test(c.type_line || '')) counts.set(c.name, (counts.get(c.name) || 0) + 1)
  }
  if (outside.size) issues.push(`outside the commander's colour identity: ${[...outside].slice(0, 5).join(', ')}${outside.size > 5 ? '…' : ''}`)
  const dups = [...counts].filter(([, n]) => n > 1).map(([n]) => n)
  if (dups.length) issues.push(`more than one copy: ${dups.slice(0, 5).join(', ')}${dups.length > 5 ? '…' : ''}`)
  if (cards.length + 1 !== 100) issues.push(`${cards.length + 1} cards including the commander (100 expected)`)
  return issues
}

// Rules-engine coverage of a deck: which cards it fully supports. Unsupported
// cards still play as their printed characteristics (a creature with an
// unimplemented ability is just a vanilla creature).
function coverageOf(pairs) {
  return deckCoverage(pairs.filter(([, card]) => card).map(([qty, card]) => ({ card, qty, section: 'main' })))
}
