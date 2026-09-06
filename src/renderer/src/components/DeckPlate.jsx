import React from 'react'
import { cardArtUrl } from '../lib/cardUtils.js'

// A deck's colour identity as pips, in WUBRG order. Colourless decks show one
// grey pip so the row never looks unfinished.
export function ColorPips({ colors }) {
  const list = colors?.length ? colors : ['C']
  return (
    <span className="pips">
      {list.map((c) => (
        <span key={c} className={'pip pip-' + c} title={COLOR_NAME[c] || 'Colorless'}>
          {c}
        </span>
      ))}
    </span>
  )
}

const COLOR_NAME = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' }

// "60 + 15" is how a decklist is read; fall back to a plain total for older decks.
export function deckSize(deck) {
  if (deck.mainCount == null) return `${deck.count} cards`
  return deck.sideCount ? `${deck.mainCount} + ${deck.sideCount}` : `${deck.mainCount} cards`
}

// A deck as a plate: its signature card's illustration behind the name, its
// colours, its size, and the actions you take on it. `actions` is rendered over
// the art; `menu` sits in the corner.
export default function DeckPlate({ deck, onPlay, onEdit, menu, subtitle }) {
  const art = cardArtUrl(deck.artId)
  return (
    <article className="deck-plate">
      {art ? <div className="deck-art" style={{ backgroundImage: `url(${art})` }} /> : <div className="deck-art none" />}
      <div className="deck-scrim" />
      <div className="deck-front">
        <ColorPips colors={deck.colors} />
        <h3 className="deck-name" onClick={onEdit} title="Open in the builder">
          {deck.name}
        </h3>
        <p className="deck-sub">{subtitle || deckSize(deck)}</p>
        {deck.description && <p className="deck-note">{deck.description}</p>}
        <div className="deck-acts">
          <button className="primary" onClick={onPlay} title="Start a game with this deck">
            Play
          </button>
          <button className="secondary" onClick={onEdit}>
            Edit
          </button>
          {menu}
        </div>
      </div>
    </article>
  )
}
