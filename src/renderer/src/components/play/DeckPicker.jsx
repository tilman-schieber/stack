import React, { useEffect, useState } from 'react'
import { useDecks } from '../../store/decks.js'
import { resolveSavedDeck } from '../../lib/resolveDeck.js'
import { deckSize } from '../../lib/cardUtils.js'

// A <select> over the saved decks, with a rules-engine coverage note for the
// chosen one. `value` is a deck slug; `onChange(slug)`.
export default function DeckPicker({ label, value, onChange, disabled }) {
  const decks = useDecks((s) => s.decks)
  const [coverage, setCoverage] = useState(null)

  // Resolve the chosen deck once to report how much of it the engine supports.
  useEffect(() => {
    let alive = true
    setCoverage(null)
    if (!value) return
    resolveSavedDeck(value)
      .then((d) => alive && setCoverage({ ...d.coverage }))
      .catch((err) => alive && setCoverage({ error: err.message }))
    return () => {
      alive = false
    }
  }, [value])

  return (
    <>
      <label className="field-label">{label}</label>
      <select value={value || ''} onChange={(ev) => onChange(ev.target.value)} disabled={disabled || decks.length === 0}>
        {decks.length === 0 && <option value="">No decks yet</option>}
        {decks.map((d) => (
          <option key={d.slug} value={d.slug}>
            {d.name} ({deckSize(d)})
          </option>
        ))}
      </select>
      {coverage?.error && <div className="deck-coverage warn">{coverage.error}</div>}
      {coverage && !coverage.error && coverage.unsupported.length > 0 && (
        <div
          className="deck-coverage warn"
          title={coverage.unsupported.map((r) => `${r.qty}× ${r.name} — ${r.category}`).join('\n')}
        >
          {coverage.supported}/{coverage.total} cards fully supported — {coverage.unsupported.length} kind(s) of card
          will play with printed stats only (hover for the list).
        </div>
      )}
      {coverage && !coverage.error && coverage.unsupported.length === 0 && (
        <div className="deck-coverage ok">All {coverage.total} cards supported by the rules engine.</div>
      )}
    </>
  )
}
