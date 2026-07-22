import React, { useState } from 'react'
import { useDeck } from '../store/deck.js'
import { imageSrc, typeLine } from '../lib/cardUtils.js'

// In-app card search (Scryfall query syntax). Click a result to add it.
export default function CardSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const addCard = useDeck((s) => s.addCard)

  async function runSearch(e) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setError('')
    try {
      const cards = await window.api.searchCards(q)
      setResults(cards)
      if (cards.length === 0) setError('No cards found.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="search-panel">
      <form onSubmit={runSearch} className="search-form">
        <input
          type="text"
          placeholder="Search cards (e.g. t:goblin cmc<=2)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'Search'}
        </button>
      </form>
      {error && <div className="search-error">{error}</div>}
      <div className="search-results">
        {results.map((card) => (
          <button
            key={card.id}
            className="search-result"
            title={`${card.name} — click to add`}
            onClick={() => addCard(card, 'main', 1)}
          >
            <img src={imageSrc(card)} alt={card.name} loading="lazy" draggable={false} />
            <div className="search-result-meta">
              <div className="search-result-name">{card.name}</div>
              <div className="muted small">{typeLine(card)}</div>
            </div>
            <span className="add-plus">＋</span>
          </button>
        ))}
      </div>
    </div>
  )
}
