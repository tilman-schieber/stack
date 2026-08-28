// Coverage classification: decide whether the rules engine fully supports a card.
// Used to show a coverage report and (later) to gate engine-mode play, with a
// manual fallback for unsupported cards.

import { printedFromScryfall } from './cards.mjs'
import { BEHAVIORS } from './behaviors.mjs'

// Keyword abilities the engine models in combat (French-vanilla cards are free).
const SUPPORTED_KEYWORDS = new Set(
  [
    'flying',
    'reach',
    'first strike',
    'double strike',
    'trample',
    'deathtouch',
    'lifelink',
    'vigilance',
    'haste',
    'menace',
    'indestructible',
    'flash',
    'defender',
    'prowess',
    'hexproof',
    'shroud'
  ]
)

// Keyword lines with a parameter the engine parses from oracle text (see
// behaviors.mjs / cards.mjs): ward costs, protection from a color, morph costs.
const SUPPORTED_PATTERNS = [
  /^ward\s*[—-]?\s*((\{[^}]+\})+|pay \d+ life)$/i,
  /^protection from (white|blue|black|red|green)$/i,
  /^morph\s*[—-]?\s*(\{[^}]+\})+$/i
]
const supportedToken = (t) => SUPPORTED_KEYWORDS.has(t) || SUPPORTED_PATTERNS.some((re) => re.test(t))

// Is a permanent vanilla (no rules text) or French-vanilla (only supported
// keyword abilities)? Reminder text in parentheses is ignored.
function isVanillaOrKeyword(sf) {
  const text = (sf.oracle_text || '')
    .replace(/\s*\([^)]*\)/g, '') // reminder text
    .replace(/affinity for artifacts/gi, '') // cost reduction we model
    .trim()
  if (!text) return true
  const tokens = text
    .split(/[\n,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  return tokens.every(supportedToken)
}

// Classify one Scryfall card → { name, supported, category }.
export function classifyCard(sf) {
  const name = sf.name
  if (BEHAVIORS[name]) return { name, supported: true, category: 'authored' }

  const printed = printedFromScryfall(sf)
  const types = printed.types

  if (types.includes('Land')) {
    if (printed.supertypes.includes('Basic')) return { name, supported: true, category: 'basic land' }
    return { name, supported: false, category: 'nonbasic land (not authored in behaviors.mjs)' }
  }
  if (types.includes('Instant') || types.includes('Sorcery'))
    return { name, supported: false, category: 'spell effect not implemented' }
  if (types.includes('Planeswalker'))
    return { name, supported: false, category: 'planeswalker abilities not implemented' }

  // Creatures / artifacts / enchantments: supported if vanilla or keyword-only.
  if (isVanillaOrKeyword(sf)) {
    const category = (sf.oracle_text || '').trim() ? 'keyword' : 'vanilla'
    return { name, supported: true, category }
  }
  return { name, supported: false, category: 'abilities not implemented' }
}

// Coverage for a set of deck entries [{ card, qty, section }] (sideboard skipped).
export function deckCoverage(entries) {
  let supported = 0
  let total = 0
  const rows = []
  for (const e of entries || []) {
    if (e.section === 'sideboard') continue
    const c = classifyCard(e.card)
    total += e.qty
    if (c.supported) supported += e.qty
    rows.push({ ...c, qty: e.qty })
  }
  const unsupported = rows.filter((r) => !r.supported)
  return { supported, total, pct: total ? Math.round((supported / total) * 100) : 100, rows, unsupported }
}
