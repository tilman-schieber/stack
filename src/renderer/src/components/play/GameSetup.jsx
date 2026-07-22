import React, { useEffect, useState } from 'react'
import { useGame } from '../../store/game.js'
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

// Choose two saved decks and start a hotseat game.
export default function GameSetup() {
  const startGame = useGame((s) => s.startGame)
  const startEngineGame = useEngineGame((s) => s.startEngineGame)
  const [decks, setDecks] = useState([])
  const [p0, setP0] = useState('')
  const [p1, setP1] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Engine-mode example-deck selection.
  const [e0, setE0] = useState(EXAMPLE_DECKS[0].slug)
  const [e1, setE1] = useState(EXAMPLE_DECKS[1].slug)
  const [engBusy, setEngBusy] = useState(false)
  const [engError, setEngError] = useState('')

  useEffect(() => {
    window.api.listDecks().then((d) => {
      setDecks(d)
      if (d[0]) setP0(d[0].slug)
      if (d[1]) setP1(d[1].slug)
      else if (d[0]) setP1(d[0].slug)
    })
  }, [])

  async function start() {
    if (!p0 || !p1) return
    setBusy(true)
    setError('')
    try {
      await startGame({ p0Slug: p0, p1Slug: p1 })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function startEngine() {
    const d0 = EXAMPLE_DECKS.find((d) => d.slug === e0)
    const d1 = EXAMPLE_DECKS.find((d) => d.slug === e1)
    setEngBusy(true)
    setEngError('')
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
      setEngError(err.message)
    } finally {
      setEngBusy(false)
    }
  }

  return (
    <div className="game-setup">
      <div className="setup-card">
        <h2>Rules-engine game (beta)</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Play with automatic rule enforcement using built-in example decks.
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
        {engError && <div className="search-error">{engError}</div>}
        <button className="primary" onClick={startEngine} disabled={engBusy}>
          {engBusy ? 'Resolving cards…' : 'Play with rules engine'}
        </button>
      </div>

      <div className="setup-card">
        <h2>Manual hotseat</h2>
        {decks.length === 0 ? (
          <p className="muted">
            No saved decks yet. Build and save a deck in the <b>Build</b> tab first.
          </p>
        ) : (
          <>
            <label className="field-label">Player 1 deck</label>
            <select value={p0} onChange={(e) => setP0(e.target.value)}>
              {decks.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name} ({d.count})
                </option>
              ))}
            </select>

            <label className="field-label">Player 2 deck</label>
            <select value={p1} onChange={(e) => setP1(e.target.value)}>
              {decks.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.name} ({d.count})
                </option>
              ))}
            </select>

            {error && <div className="search-error">{error}</div>}
            <button className="primary" onClick={start} disabled={busy || !p0 || !p1}>
              {busy ? 'Dealing…' : 'Start game'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
