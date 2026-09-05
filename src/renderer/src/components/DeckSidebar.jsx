import React, { useState } from 'react'
import { useDeck } from '../store/deck.js'
import { useDecks } from '../store/decks.js'
import { useNav } from '../store/nav.js'
import { formatDecklist } from '../lib/deckExport.js'

// Left sidebar of the builder: the deck being edited — name, notes, save/new,
// copy the list, play it. Listing, importing, exporting and deleting decks lives
// in the Decks view.
export default function DeckSidebar() {
  const deckName = useDeck((s) => s.deckName)
  const setDeckName = useDeck((s) => s.setDeckName)
  const description = useDeck((s) => s.description)
  const setDescription = useDeck((s) => s.setDescription)
  const serialize = useDeck((s) => s.serialize)
  const newDeck = useDeck((s) => s.newDeck)
  const entries = useDeck((s) => s.entries)
  const refreshDecks = useDecks((s) => s.refresh)
  const go = useNav((s) => s.go)
  const play = useNav((s) => s.play)

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
    refreshDecks()
    flash(`Saved “${saved.name}”.`)
    return saved
  }

  // Play the deck as it is on screen: save first so the game setup can find it.
  async function playThis() {
    const saved = await save()
    if (saved) play(saved.slug)
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
      <label className="field-label">Deck name</label>
      <input className="deck-name-input" value={deckName} onChange={(e) => setDeckName(e.target.value)} />
      <div className="muted small deck-counts">
        {counts.main} main{counts.side ? ` · ${counts.side} sideboard` : ''}
        {counts.cmd ? ` · ${counts.cmd} commander` : ''}
      </div>
      <textarea
        className="notes-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Notes (optional) — what the deck does, where the list is from…"
        rows={3}
      />

      <div className="sidebar-actions">
        <button className="primary" onClick={save}>
          Save
        </button>
        <button className="secondary" onClick={newDeck}>
          New
        </button>
      </div>
      <div className="sidebar-actions">
        <button className="secondary" onClick={playThis} disabled={!counts.main} title="Save, then start a game with this deck">
          Play ▶
        </button>
        <button className="secondary" onClick={copyList} title="Copy the decklist as text">
          Copy list
        </button>
      </div>
      {status && <div className="status-msg">{status}</div>}

      <button className="secondary manage-link" onClick={() => go('decks')}>
        All decks →
      </button>
    </aside>
  )
}
