// Regenerates src/renderer/src/mana.css from the installed mana-font package.
//
// The package's own stylesheet declares two @font-face blocks that between them
// pull in five formats of two fonts — including a 1.9MB SVG font for browsers
// that have not existed for a decade, and MPlantin, which this app does not
// use. Every one of those would be emitted into the bundle and precached by the
// service worker. This keeps all 700-odd symbol rules exactly as the package
// defines them and replaces the font loading with woff2 alone.
//
// Run after changing the mana-font version: node scripts/gen-mana-css.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const pkgPath = require.resolve('mana-font/package.json')
const pkgDir = path.dirname(pkgPath)
const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version
const src = readFileSync(path.join(pkgDir, 'css', 'mana.css'), 'utf8')

// Drop every @font-face block; keep everything else verbatim.
const rules = src.replace(/@font-face\s*\{[^}]*\}\s*/g, '').trim()
const dropped = (src.match(/@font-face/g) || []).length
if (dropped !== 2) throw new Error(`expected 2 @font-face blocks in mana.css, found ${dropped}`)
if (!/\.ms-r::before/.test(rules)) throw new Error('symbol rules missing after the strip — check the mana-font layout')

const out = `/* Magic's mana symbols. Generated from mana-font v${version} by
   scripts/gen-mana-css.mjs — edit that script, not this file.

   The font is Andrew Gioia's mana-font (MIT). The symbols it draws are Wizards
   of the Coast's, used here under their Fan Content Policy: Stack is an
   unofficial, non-commercial fan project and is not affiliated with or endorsed
   by Wizards of the Coast.

   Only woff2 is loaded; the package's other four formats and its MPlantin body
   face are not used and would otherwise be bundled and precached. */
@font-face {
  font-family: 'Mana';
  src: url('mana-font/fonts/mana.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: block;
}

${rules}
`

const dest = path.join(process.cwd(), 'src', 'renderer', 'src', 'mana.css')
writeFileSync(dest, out)
console.log(`wrote ${dest} from mana-font ${version} (${(out.length / 1024).toFixed(1)} kB, ${dropped} @font-face blocks replaced)`)
