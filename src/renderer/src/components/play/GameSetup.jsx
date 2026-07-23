import React, { useState } from 'react'
import { useEngineGame } from '../../store/engineGame.js'
import { EXAMPLE_DECKS, deckCardNames, expandExampleDeck } from '../../lib/exampleDecks.js'

// Build a case-insensitive name -> card lookup (indexing each face of DFCs).
function buildLookup(cards) {
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

// Choose two decks and start a rules-enforced game.
export default function GameSetup() {
  const startEngineGame = useEngineGame((s) => s.startEngineGame)
  const [e0, setE0] = useState(EXAMPLE_DECKS[0].slug)
  const [e1, setE1] = useState(EXAMPLE_DECKS[1].slug)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    const d0 = EXAMPLE_DECKS.find((d) => d.slug === e0)
    const d1 = EXAMPLE_DECKS.find((d) => d.slug === e1)
    setBusy(true)
    setError('')
    try {
      const names = [...new Set([...deckCardNames(d0), ...deckCardNames(d1)])]
      const { cards } = await window.api.resolveDeck(names)
      const lookup = buildLookup(cards)
      const b0 = expandExampleDeck(d0, lookup)
      const b1 = expandExampleDeck(d1, lookup)
      const missing = [...new Set([...b0.missing, ...b1.missing])]
      if (missing.length) throw new Error(`Could not resolve: ${missing.join(', ')}`)
      startEngineGame({
        decks: [
          { name: d0.name, cards: b0.cards },
          { name: d1.name, cards: b1.cards }
        ]
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="game-setup">
      <div className="setup-card">
        <h2>New game</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Two-player game with automatic rule enforcement.
        </p>
        <label className="field-label">Player 1 deck</label>
        <select value={e0} onChange={(ev) => setE0(ev.target.value)}>
          {EXAMPLE_DECKS.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
        <label className="field-label">Player 2 deck</label>
        <select value={e1} onChange={(ev) => setE1(ev.target.value)}>
          {EXAMPLE_DECKS.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.name}
            </option>
          ))}
        </select>
        {error && <div className="search-error">{error}</div>}
        <button className="primary" onClick={start} disabled={busy}>
          {busy ? 'Resolving cards…' : 'Start game'}
        </button>
      </div>
    </div>
  )
}
