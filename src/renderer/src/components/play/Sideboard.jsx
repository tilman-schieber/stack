import React, { useMemo, useState } from 'react'
import { useEngineGame } from '../../store/engineGame.js'
import { cardImageUrl, boardImageSize } from '../../lib/cardUtils.js'

// Group a list of card objects (one entry per copy) into [{ card, qty }], by name.
function grouped(cards) {
  const by = new Map()
  for (const c of cards) {
    const key = c.name
    if (by.has(key)) by.get(key).qty++
    else by.set(key, { card: c, qty: 1 })
  }
  return [...by.values()].sort((a, b) => a.card.name.localeCompare(b.card.name))
}

// One player's deck as two lists; clicking a card moves one copy across.
function DeckColumns({ deck, onChange, readOnly }) {
  const main = grouped(deck.cards)
  const side = grouped(deck.sideboard || [])
  const move = (from, to, name) => {
    if (readOnly) return
    const i = deck[from].findIndex((c) => c.name === name)
    if (i < 0) return
    const src = [...deck[from]]
    const [card] = src.splice(i, 1)
    onChange({ ...deck, [from]: src, [to]: [...deck[to], card] })
  }
  const list = (rows, from, to, title, count) => (
    <div className="sb-col">
      <div className="sb-col-head">
        {title} <span className="muted">({count})</span>
      </div>
      <div className="sb-list">
        {rows.length === 0 && <p className="muted small">Empty.</p>}
        {rows.map(({ card, qty }) => (
          <div
            key={card.name}
            className={'sb-row' + (readOnly ? '' : ' clickable')}
            onClick={() => move(from, to, card.name)}
            title={readOnly ? card.name : `${card.name} — click to move one copy`}
          >
            <span className="sb-qty">{qty}</span>
            {card.id ? <img src={cardImageUrl(card.id, false, boardImageSize())} alt="" className="sb-thumb" /> : null}
            <span className="sb-name">{card.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <div className="sb-columns">
      {list(main, 'cards', 'sideboard', 'Deck', deck.cards.length)}
      {list(side, 'sideboard', 'cards', 'Sideboard', (deck.sideboard || []).length)}
    </div>
  )
}

// Between games of a match: each human player swaps cards between deck and
// sideboard, then the next game starts. The computer keeps its deck as it is.
export default function Sideboard() {
  const match = useEngineGame((s) => s.match)
  const nextGame = useEngineGame((s) => s.nextGame)
  const endGame = useEngineGame((s) => s.endGame)
  const botSeats = useEngineGame((s) => s.botSeats)
  const [decks, setDecks] = useState(() => match.decks.map((d) => ({ ...d, cards: [...d.cards], sideboard: [...(d.sideboard || [])] })))
  const [seat, setSeat] = useState(() => match.decks.findIndex((_, i) => !botSeats.includes(i)))

  const startingSizes = useMemo(() => match.decks.map((d) => d.cards.length), [match.decks])
  const deck = decks[seat]
  const wrongSize = deck && deck.cards.length < startingSizes[seat]
  const humanSeats = match.decks.map((_, i) => i).filter((i) => !botSeats.includes(i))

  return (
    <div className="game-setup">
      <div className="setup-card sb-card">
        <h2>Sideboard</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Game {match.game} went to <b>{match.decks[match.lastWinner]?.name ?? 'nobody'}</b> — the match stands{' '}
          {match.wins.join(' – ')}. Swap cards between deck and sideboard, then start game {match.game + 1}. The loser of
          the last game chooses to play or draw.
        </p>

        {humanSeats.length > 1 && (
          <div className="mode-tabs">
            {humanSeats.map((i) => (
              <button key={i} className={seat === i ? 'active' : ''} onClick={() => setSeat(i)}>
                {match.decks[i].name}
              </button>
            ))}
          </div>
        )}

        {deck && (
          <DeckColumns
            deck={deck}
            readOnly={botSeats.includes(seat)}
            onChange={(next) => setDecks((ds) => ds.map((d, i) => (i === seat ? next : d)))}
          />
        )}

        {wrongSize && (
          <div className="deck-coverage warn">
            Your deck is down to {deck.cards.length} cards (it started at {startingSizes[seat]}). A deck may not get
            smaller between games.
          </div>
        )}

        <div className="sb-actions">
          <button className="primary" disabled={wrongSize} onClick={() => nextGame(decks)}>
            Start game {match.game + 1}
          </button>
          <button className="secondary" onClick={() => endGame()}>
            Quit the match
          </button>
        </div>
      </div>
    </div>
  )
}
