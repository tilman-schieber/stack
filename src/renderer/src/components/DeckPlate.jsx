import React from 'react'
import { cardArtUrl, deckSize } from '../lib/cardUtils.js'

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

// A deck as a plate: its signature card's illustration behind the name, its
// colours, its size, and the actions you take on it. `actions` is rendered over
// the art; `menu` sits in the corner.
// `pending` draws a deck that is on its way: the name and description are known
// from the built-in list, the art and the counts are not yet.
export default function DeckPlate({ deck, onPlay, onEdit, menu, subtitle, pending = false }) {
  if (pending) {
    return (
      <article className="deck-plate pending" aria-busy="true">
        <div className="deck-art none" />
        <div className="deck-scrim" />
        <div className="deck-front">
          <h3 className="deck-name">{deck.name}</h3>
          <p className="deck-sub">Fetching its cards…</p>
          {deck.description && <p className="deck-note">{deck.description}</p>}
        </div>
      </article>
    )
  }
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
