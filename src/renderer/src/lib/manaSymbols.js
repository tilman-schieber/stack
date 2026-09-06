// Scryfall's `{...}` notation to the class names the Mana font uses.
//
// Scryfall writes every symbol between braces: {2}{R} for a cost, {T}: Add {G}
// in rules text, {W/U} and {2/W} and {B/G/P} for the hybrids and Phyrexians.
// The font's own naming is the same thing lowercased with the slashes taken
// out — {B/G/P} is `ms-bgp` — so the mapping is one rule plus the handful of
// symbols the font names differently.

// Symbols whose class is not just the lowercased contents of the braces.
const NAMED = {
  T: 'tap',
  Q: 'untap',
  '½': 'half',
  '1/2': '1-2',
  '∞': 'infinity',
  PW: 'planeswalker',
  CHAOS: 'chaos',
  A: 'acorn',
  TK: 'ticket',
  H: 'half',
  // Half-mana of a colour: {HW} is half a white mana.
  HW: 'w-half',
  HR: 'r-half'
}

const COLOR_NAME = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless', S: 'snow' }

// The class for one symbol's contents (what was between the braces), or null if
// it is not something the font can draw.
export function symbolClass(code) {
  if (!code) return null
  const raw = String(code).replace(/^\{|\}$/g, '').trim()
  if (!raw) return null
  const named = NAMED[raw.toUpperCase()]
  if (named) return 'ms-' + named
  const slug = raw.toLowerCase().replace(/\//g, '')
  // Generic costs, colours, hybrids and Phyrexians all reduce to letters and
  // digits; anything else is something this font does not have a glyph for.
  if (!/^[a-z0-9]+$/.test(slug)) return null
  return 'ms-' + slug
}

// What the symbol means, for a tooltip and for a screen reader.
export function symbolTitle(code) {
  const raw = String(code).replace(/^\{|\}$/g, '').trim().toUpperCase()
  if (raw === 'T') return 'Tap this permanent'
  if (raw === 'Q') return 'Untap this permanent'
  if (raw === 'E') return 'An energy counter'
  if (/^\d+$/.test(raw)) return `${raw} generic mana`
  if (raw === 'X' || raw === 'Y' || raw === 'Z') return `${raw} generic mana`
  if (COLOR_NAME[raw]) return `One ${COLOR_NAME[raw]} mana`
  if (raw.endsWith('/P')) return `${raw.slice(0, -2)} or 2 life (Phyrexian)`
  if (raw.includes('/')) return raw.split('/').join(' or ') + ' (hybrid)'
  return raw
}

// Split text into runs of plain text and `{...}` symbols, in order. Braces that
// do not close, or hold something the font cannot draw, stay as plain text.
export function splitSymbols(text) {
  const out = []
  const re = /\{([^{}]{1,7})\}/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (!symbolClass(m[1])) continue
    if (m.index > last) out.push({ text: text.slice(last, m.index), symbol: false })
    out.push({ text: m[1], symbol: true })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), symbol: false })
  return out
}

// The colours a cost actually asks for, in WUBRG order — used to sort and to
// colour a row without re-parsing the cost at every call site.
export function costColors(cost) {
  const seen = new Set()
  for (const p of splitSymbols(cost || '')) {
    if (!p.symbol) continue
    for (const ch of p.text.toUpperCase()) if ('WUBRG'.includes(ch)) seen.add(ch)
  }
  return ['W', 'U', 'B', 'R', 'G'].filter((c) => seen.has(c))
}
