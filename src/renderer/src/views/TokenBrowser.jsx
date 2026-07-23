import React, { useEffect, useState } from 'react'
import { imageSrc, typeLine } from '../lib/cardUtils.js'
import { TOKENS_FAV_KEY, loadFavoriteTokens } from '../lib/tokens.js'
import '../tokens.css'

// A single token tile with a favorite toggle.
function TokenTile({ card, favorite, onToggle }) {
  return (
    <div className="tok-card">
      <div className="tok-img-wrap">
        <img src={imageSrc(card)} alt={card.name} loading="lazy" />
        <button
          className={'tok-star' + (favorite ? ' on' : '')}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => onToggle(card)}
        >
          {favorite ? '★' : '☆'}
        </button>
      </div>
      <div className="tok-name">{card.name}</div>
      <div className="muted small">{typeLine(card)}</div>
    </div>
  )
}

// Global token gallery: search Scryfall for tokens and favorite the images you
// like. Favorites are reused wherever a token is created.
export default function TokenBrowser() {
  const [query, setQuery] = useState('t:token ')
  const [results, setResults] = useState([])
  const [favorites, setFavorites] = useState([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)

  const favIds = new Set(favorites.map((c) => c.id))

  useEffect(() => {
    loadFavoriteTokens().then(setFavorites)
  }, [])

  async function run(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setBusy(true)
    setSearched(true)
    try {
      setResults(await window.api.searchCards(query))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(card) {
    await window.api.toggleFavoritePrint(TOKENS_FAV_KEY, card.id)
    setFavorites(await loadFavoriteTokens())
  }

  return (
    <div className="token-browser">
      <div className="tok-head">
        <div>
          <h2>Tokens</h2>
          <p className="muted small">
            Search Scryfall for token art and ★ your favorites. Favorited tokens show up first
            when you create a token in a game.
          </p>
        </div>
        <form onSubmit={run} className="search-form">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. t:token goblin"
          />
          <button type="submit" disabled={busy}>
            {busy ? '…' : 'Search'}
          </button>
        </form>
      </div>

      {favorites.length > 0 && (
        <section className="tok-section">
          <h3 className="tok-section-title">★ Favorites ({favorites.length})</h3>
          <div className="tok-grid">
            {favorites.map((card) => (
              <TokenTile key={card.id} card={card} favorite onToggle={toggle} />
            ))}
          </div>
        </section>
      )}

      <section className="tok-section">
        <h3 className="tok-section-title">
          {searched ? `Results (${results.length})` : 'Search results'}
        </h3>
        {results.length === 0 ? (
          <p className="muted">
            {searched ? 'No tokens found — try a broader query.' : 'Search to browse token art.'}
          </p>
        ) : (
          <div className="tok-grid">
            {results.map((card) => (
              <TokenTile
                key={card.id}
                card={card}
                favorite={favIds.has(card.id)}
                onToggle={toggle}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
