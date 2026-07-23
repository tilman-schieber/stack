import React, { useState } from 'react'
import { imageSrc, typeLine } from '../../lib/cardUtils.js'

// Search Scryfall for any card/token and put it on the battlefield as a token.
// Used by the manual hotseat board.
export default function TokenSearch({ onPick, onClose }) {
  const [query, setQuery] = useState('t:token ')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)

  async function run(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    try {
      setResults(await window.api.searchCards(query))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal token-search" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Create token</h2>
            <p className="muted small">
              Search Scryfall (e.g. <code>t:token soldier</code>) and click to add.
            </p>
          </div>
          <button className="del" onClick={onClose} title="Close">
            ✕
          </button>
        </header>
        <form onSubmit={run} className="search-form" style={{ padding: '0 20px' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <button type="submit" disabled={busy}>
            {busy ? '…' : 'Search'}
          </button>
        </form>
        <div className="zv-grid">
          {results.map((card) => (
            <div className="zv-card" key={card.id}>
              <img src={imageSrc(card)} alt={card.name} loading="lazy" onClick={() => onPick(card)} />
              <div className="zv-name">{card.name}</div>
              <div className="muted small">{typeLine(card)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
