// Headless verification of Scryfall's {...} notation to Mana-font classes.
// Run: node src/renderer/src/lib/manaSymbols.test.mjs
import { symbolClass, splitSymbols, costColors, symbolTitle } from './manaSymbols.js'
import { makeAsserter } from '../../../shared/engine/_testutil.mjs'

const { assert, stats } = makeAsserter()
const section = (n) => console.log('\n' + n)
const cls = (c) => symbolClass(c)

section('The five colours, colourless, and generic amounts')
{
  assert(cls('W') === 'ms-w', 'white')
  assert(cls('G') === 'ms-g', 'green')
  assert(cls('C') === 'ms-c', 'colorless')
  assert(cls('0') === 'ms-0', 'zero')
  assert(cls('7') === 'ms-7', 'seven')
  assert(cls('20') === 'ms-20', 'twenty')
  assert(cls('1000000') === 'ms-1000000', 'a million, for the one card that asks')
  assert(cls('X') === 'ms-x' && cls('Y') === 'ms-y', 'X and Y')
}

section('Braces are optional, and case does not matter')
{
  assert(cls('{R}') === 'ms-r', 'braces are stripped')
  assert(cls('r') === 'ms-r', 'lowercase input')
  assert(cls(' R ') === 'ms-r', 'surrounding space')
}

section('Hybrids, twobrids and Phyrexians drop the slash')
{
  assert(cls('W/U') === 'ms-wu', 'hybrid')
  assert(cls('2/W') === 'ms-2w', 'twobrid')
  assert(cls('W/P') === 'ms-wp', 'Phyrexian')
  assert(cls('B/G/P') === 'ms-bgp', 'Phyrexian hybrid')
  assert(cls('C/W') === 'ms-cw', 'colourless hybrid')
}

section('Symbols the font names differently')
{
  assert(cls('T') === 'ms-tap', 'tap is not ms-t')
  assert(cls('Q') === 'ms-untap', 'untap is not ms-q')
  assert(cls('CHAOS') === 'ms-chaos', 'the planar die')
  assert(cls('∞') === 'ms-infinity', 'infinity')
  assert(cls('E') === 'ms-e', 'energy keeps its letter')
  assert(cls('S') === 'ms-s', 'snow keeps its letter')
}

section('Anything the font cannot draw is left alone')
{
  assert(cls('') === null, 'empty')
  assert(cls(null) === null, 'null')
  assert(cls('not a symbol') === null, 'a phrase')
  assert(cls('!!') === null, 'punctuation')
}

section('Splitting a cost into symbols')
{
  const parts = splitSymbols('{2}{R}{R}')
  assert(parts.length === 3, 'three symbols')
  assert(parts.every((p) => p.symbol), 'and no plain text between them')
  assert(parts.map((p) => p.text).join(',') === '2,R,R', 'in printed order')
}

section('Splitting rules text keeps the words')
{
  const parts = splitSymbols('{T}: Add {G}.')
  assert(parts.length === 4, 'symbol, text, symbol, text')
  assert(parts[0].symbol && parts[0].text === 'T', 'starts with the tap symbol')
  assert(!parts[1].symbol && parts[1].text === ': Add ', 'the words survive verbatim')
  assert(parts[2].symbol && parts[2].text === 'G', 'then green')
  assert(!parts[3].symbol && parts[3].text === '.', 'and the full stop')
  assert(splitSymbols('No symbols here.').length === 1, 'text with no symbols is one run')
  assert(splitSymbols('').length === 0, 'empty text is no runs')
}

section('Braces that are not symbols stay as written')
{
  // Reminder text and set codes use braces too; only real symbols are replaced.
  const parts = splitSymbols('Choose {a mode} then add {U}.')
  const text = parts.filter((p) => !p.symbol).map((p) => p.text).join('')
  assert(text === 'Choose {a mode} then add .', 'the non-symbol braces are untouched')
  assert(parts.filter((p) => p.symbol).length === 1, 'and only the real symbol is drawn')
  assert(splitSymbols('{').length === 1 && !splitSymbols('{')[0].symbol, 'an unclosed brace is plain text')
}

section('The colours a cost asks for')
{
  assert(costColors('{2}{R}{R}').join('') === 'R', 'mono red')
  assert(costColors('{W}{U}').join('') === 'WU', 'in WUBRG order, not written order')
  assert(costColors('{U}{W}').join('') === 'WU', 'however it was written')
  assert(costColors('{B/G}').join('') === 'BG', 'a hybrid asks for both')
  assert(costColors('{3}').length === 0, 'generic asks for none')
  assert(costColors('').length === 0 && costColors(null).length === 0, 'no cost at all')
}

section('Every symbol can say what it means')
{
  assert(symbolTitle('T') === 'Tap this permanent', 'tap')
  assert(symbolTitle('{R}') === 'One red mana', 'a colour, braces and all')
  assert(symbolTitle('3') === '3 generic mana', 'generic')
  assert(/Phyrexian/.test(symbolTitle('W/P')), 'Phyrexian mentions the life')
  assert(/hybrid/.test(symbolTitle('W/U')), 'hybrid says so')
}

console.log(`\n${stats.passed} passed, ${stats.failed} failed`)
process.exit(stats.failed ? 1 : 0)
