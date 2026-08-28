import React, { useState } from 'react'
import { useDeck } from '../store/deck.js'
import { formatDecklist } from '../lib/deckExport.js'

// Left sidebar of the builder: the deck being edited — name, save/new, copy the
// list. Listing, importing, exporting and deleting saved decks lives in the Decks
// tab (DeckManager); `onManageDecks` switches there.
export default function DeckSidebar({ onOpenSettings, onManageDecks }) {
  const deckName = useDeck((s) => s.deckName)
  const setDeckName = useDeck((s) => s.setDeckName)
  const serialize = useDeck((s) => s.serialize)
  const newDeck = useDeck((s) => s.newDeck)
  const entries = useDeck((s) => s.entries)

  const [status, setStatus] = useState('')
  const flash = (msg) => {
    setStatus(msg)
    setTimeout(() => setStatus(''), 2500)
  }

  const counts = entries.reduce(
    (acc, e) => {
      acc[e.section === 'sideboard' ? 'side' : e.section === 'commander' ? 'cmd' : 'main'] += e.qty
      return acc
    },
    { main: 0, side: 0, cmd: 0 }
  )

  async function save() {
    if (entries.length === 0) {
      flash('Nothing to save.')
      return
    }
    const saved = await window.api.saveDeck(serialize())
    flash(`Saved “${saved.name}”.`)
  }

  async function copyList() {
    if (entries.length === 0) {
      flash('Nothing to copy.')
      return
    }
    const cardsById = new Map(entries.map((e) => [e.id, e.card]))
    await navigator.clipboard.writeText(formatDecklist(serialize(), cardsById))
    flash('Decklist copied.')
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
      <input className="deck-name-input" value={deckName} onChange={(e) => setDeckName(e.target.value)} />
      <div className="muted small deck-counts">
        {counts.main} main{counts.side ? ` · ${counts.side} sideboard` : ''}
        {counts.cmd ? ` · ${counts.cmd} commander` : ''}
      </div>

      <div className="sidebar-actions">
        <button className="primary" onClick={save}>
          Save
        </button>
        <button className="secondary" onClick={newDeck}>
          New
        </button>
        <button className="secondary" onClick={copyList} title="Copy the decklist as text">
          Copy list
        </button>
      </div>
      {status && <div className="status-msg">{status}</div>}

      <button className="secondary manage-link" onClick={onManageDecks}>
        Saved decks →
      </button>
    </aside>
  )
}
