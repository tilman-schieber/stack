import React, { useEffect, useMemo, useState } from 'react'
import { imageSrc, oracleKey, printLabel } from '../lib/cardUtils.js'
import { isAllowed } from '../lib/printFilter.js'
import { useDeck } from '../store/deck.js'
import { useSettings } from '../store/settings.js'
import { CoverIcon } from './Icons.jsx'

// Modal for choosing the art/printing of a card.
// - Click a printing to use it for this deck entry.
// - ♥ toggles a favorite. Favorites appear first (drag to reorder); the first
//   favorite is the default printing used on import when no set is given.
export default function PrintPicker({ entry, onClose }) {
  const key = oracleKey(entry.card)
  const setEntryPrinting = useDeck((s) => s.setEntryPrinting)
  const coverKey = useDeck((s) => s.coverKey)
  const setCover = useDeck((s) => s.setCover)
  const settings = useSettings()
  const isCover = coverKey === key
  // Only a maindeck card can be the deck's face.
  const canBeCover = (entry.section || 'main') !== 'sideboard'

  // byId accumulates every printing we've seen; order preserves load order.
  const [byId, setById] = useState(() => new Map([[entry.card.id, entry.card]]))
  const [order, setOrder] = useState([entry.card.id])
  const [nextPage, setNextPage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [favorites, setFavorites] = useState([])
  const [dragIndex, setDragIndex] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  function addCards(cards) {
    setById((prev) => {
      const next = new Map(prev)
      for (const c of cards) next.set(c.id, c)
      return next
    })
    setOrder((prev) => {
      const seen = new Set(prev)
      const added = cards.map((c) => c.id).filter((id) => !seen.has(id))
      return added.length ? [...prev, ...added] : prev
    })
  }

  // Initial load: prefs, favorite card objects (so they always render), page 1.
  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const p = await window.api.getPrefs(key)
        if (cancelled) return
        setFavorites(p.favorites)
        if (p.favorites.length) {
          const { cards } = await window.api.ensureCards(p.favorites)
          if (!cancelled) addCards(cards)
        }
        const firstPage = await window.api.getPrints(entry.card.prints_search_uri)
        if (cancelled) return
        addCards(firstPage.cards)
        setNextPage(firstPage.nextPage)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  async function loadMore() {
    if (!nextPage) return
    setLoading(true)
    try {
      const page = await window.api.getPrints(nextPage)
      addCards(page.cards)
      setNextPage(page.nextPage)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const favSet = useMemo(() => new Set(favorites), [favorites])
  // Favorites and the current printing bypass set filters so they never vanish.
  const keepIds = useMemo(() => new Set([entry.id, ...favorites]), [entry.id, favorites])

  const favList = useMemo(
    () => favorites.map((id) => byId.get(id)).filter(Boolean),
    [favorites, byId]
  )
  const allList = useMemo(() => {
    return order
      .map((id) => byId.get(id))
      .filter((c) => c && !favSet.has(c.id) && isAllowed(c, settings, keepIds))
  }, [order, byId, favSet, settings, keepIds])

  async function toggleFavorite(id, e) {
    e.stopPropagation()
    const res = await window.api.toggleFavoritePrint(key, id)
    setFavorites(res.favorites)
  }
  function usePrinting(card) {
    setEntryPrinting(entry.id, entry.section, card)
    onClose()
  }

  // --- drag-and-drop reordering of favorites ---
  function onDrop(targetIndex) {
    setDragOver(null)
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      return
    }
    const ids = [...favorites]
    const [moved] = ids.splice(dragIndex, 1)
    ids.splice(targetIndex, 0, moved)
    setDragIndex(null)
    setFavorites(ids) // optimistic
    window.api.setFavoritePrints(key, ids).then((res) => setFavorites(res.favorites))
  }

  const renderTile = (card, opts = {}) => {
    const { fav = false, index = -1 } = opts
    const isCurrent = card.id === entry.id
    const isFav = favSet.has(card.id)
    const isDefault = fav && index === 0
    return (
      <div
        key={card.id}
        className={
          `print-tile${isCurrent ? ' current' : ''}` +
          (fav ? ' fav' : '') +
          (dragOver === index && fav ? ' drag-over' : '')
        }
        onClick={() => usePrinting(card)}
        title="Use this printing for this card"
        draggable={fav}
        onDragStart={fav ? () => setDragIndex(index) : undefined}
        onDragOver={
          fav
            ? (e) => {
                e.preventDefault()
                setDragOver(index)
              }
            : undefined
        }
        onDragLeave={fav ? () => setDragOver((o) => (o === index ? null : o)) : undefined}
        onDrop={fav ? () => onDrop(index) : undefined}
      >
        <div className="print-img-wrap">
          <img src={imageSrc(card)} alt={printLabel(card)} loading="lazy" draggable={false} />
          {isDefault && <span className="default-tag">Default</span>}
          {isCurrent && <span className="current-tag">In deck</span>}
          <div className="print-actions">
            <button
              className={`icon-btn${isFav ? ' on' : ''}`}
              title={isFav ? 'Remove favorite' : 'Add favorite'}
              onClick={(e) => toggleFavorite(card.id, e)}
            >
              ♥
            </button>
          </div>
        </div>
        <div className="print-label">{printLabel(card)}</div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal print-picker" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>{entry.card.name}</h2>
            <p className="muted small">
              Click a printing to use it · ♥ favorite · drag favorites to reorder · first
              favorite is the import default
            </p>
          </div>
          {canBeCover && (
            <button
              className={'cover-btn' + (isCover ? ' on' : '')}
              onClick={() => setCover(isCover ? null : key)}
              title={
                isCover
                  ? 'This card is the deck cover — click to go back to choosing one automatically'
                  : "Use this card's art as the deck cover"
              }
            >
              <CoverIcon />
              {isCover ? 'Deck cover' : 'Use as cover'}
            </button>
          )}
          <button className="del" onClick={onClose} title="Close">
            ✕
          </button>
        </header>

        {error && <div className="search-error">{error}</div>}

        <div className="print-scroll">
          {favList.length > 0 && (
            <>
              <h3 className="picker-section-title">♥ Favorites</h3>
              <div className="print-grid">
                {favList.map((card, i) => renderTile(card, { fav: true, index: i }))}
              </div>
              <h3 className="picker-section-title">All printings</h3>
            </>
          )}
          <div className="print-grid">{allList.map((card) => renderTile(card))}</div>
          {!loading && allList.length === 0 && favList.length === 0 && (
            <p className="muted" style={{ padding: '10px 0' }}>
              No printings match your filters.
            </p>
          )}
        </div>

        <footer className="modal-footer">
          {loading && <span className="muted">Loading…</span>}
          {!loading && nextPage && (
            <button className="secondary" onClick={loadMore}>
              Load more printings
            </button>
          )}
          {!loading && !nextPage && (
            <span className="muted small">
              {allList.length + favList.length} printing(s) shown
            </span>
          )}
        </footer>
      </div>
    </div>
  )
}
