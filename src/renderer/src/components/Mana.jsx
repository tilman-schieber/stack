import React from 'react'
import { symbolClass, splitSymbols, symbolTitle } from '../lib/manaSymbols.js'

// One mana symbol, drawn from the Mana font (see mana.css). `cost` gives it the
// rounded coin the card face uses; without it the glyph is drawn bare, which is
// what reads best inside a sentence of rules text.
export function Sym({ code, cost = true }) {
  const cls = symbolClass(code)
  if (!cls) return <span>{code}</span>
  return <i className={'ms ' + cls + (cost ? ' ms-cost ms-shadow' : '')} title={symbolTitle(code)} aria-label={code} />
}

// A mana cost like "{2}{R}{R}" as symbols. Renders nothing for a card with no
// cost at all (a land), rather than an empty gap.
export default function ManaCost({ cost, className = '' }) {
  if (!cost) return null
  const parts = splitSymbols(cost).filter((p) => p.symbol)
  if (!parts.length) return null
  return (
    <span className={'mana-cost ' + className} title={cost}>
      {parts.map((p, i) => (
        <Sym key={i} code={p.text} />
      ))}
    </span>
  )
}

// Rules text with its symbols drawn: "{T}: Add {G}" becomes a tap symbol, a
// colon, and a green pip. Line breaks are kept, since a card's text depends on
// them to separate abilities.
export function RulesText({ text, className = '' }) {
  if (!text) return null
  return (
    <span className={'rules-text ' + className}>
      {splitSymbols(text).map((p, i) =>
        p.symbol ? <Sym key={i} code={p.text} cost /> : <React.Fragment key={i}>{p.text}</React.Fragment>
      )}
    </span>
  )
}
