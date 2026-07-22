import React, { useEffect, useState } from 'react'
import { useDeck } from '../store/deck.js'

// Left sidebar: current deck name, save/new, and the list of saved decks.
export default function DeckSidebar({ onOpenSettings }) {
  const deckName = useDeck((s) => s.deckName)
  const setDeckName = useDeck((s) => s.setDeckName)
  const serialize = useDeck((s) => s.serialize)
  const loadSaved = useDeck((s) => s.loadSaved)
  const newDeck = useDeck((s) => s.newDeck)
  const entries = useDeck((s) => s.entries)

  const [decks, setDecks] = useState([])
  const [status, setStatus] = useState('')

  async function refresh() {
    setDecks(await window.api.listDecks())
  }
  useEffect(() => {
    refresh()
  }, [])

  async function save() {
    if (entries.length === 0) {
      setStatus('Nothing to save.')
      return
    }
    await window.api.saveDeck(serialize())
    setStatus(`Saved “${deckName}”.`)
    await refresh()
    setTimeout(() => setStatus(''), 2500)
  }

  async function open(slug) {
    const record = await window.api.loadDeck(slug)
    await loadSaved(record)
  }

  async function remove(slug, e) {
    e.stopPropagation()
    await window.api.deleteDeck(slug)
    await refresh()
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span>🃏 Deck Builder</span>
        <button className="gear" title="Settings" onClick={onOpenSettings}>
          ⚙
        </button>
      </div>

      <label className="field-label">Deck name</label>
      <input
        className="deck-name-input"
        value={deckName}
        onChange={(e) => setDeckName(e.target.value)}
      />

      <div className="sidebar-actions">
        <button className="primary" onClick={save}>
          Save
        </button>
        <button className="secondary" onClick={newDeck}>
          New
        </button>
      </div>
      {status && <div className="status-msg">{status}</div>}

      <div className="saved-header">Saved decks</div>
      <div className="saved-list">
        {decks.length === 0 && <div className="muted small">No saved decks yet.</div>}
        {decks.map((d) => (
          <div key={d.slug} className="saved-item" onClick={() => open(d.slug)}>
            <div className="saved-item-main">
              <div className="saved-name">{d.name}</div>
              <div className="muted small">{d.count} cards</div>
            </div>
            <button className="del" title="Delete deck" onClick={(e) => remove(d.slug, e)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
