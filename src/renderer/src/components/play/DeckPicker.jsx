import React, { useEffect, useState } from 'react'
import { listPlayableDecks, resolvePlayableDeck } from '../../lib/resolveDeck.js'

// A deck <select> covering the built-in example decks and the decks saved in the
// deck builder, with a rules-engine coverage note for the chosen deck. `value`
// is a deck key ("example:<slug>" / "saved:<slug>"); `onChange(key)`.
export default function DeckPicker({ label, value, onChange, disabled }) {
  const [decks, setDecks] = useState([])
  const [coverage, setCoverage] = useState(null)

  useEffect(() => {
    let alive = true
    listPlayableDecks().then((list) => alive && setDecks(list))
    return () => {
      alive = false
    }
  }, [])

  // Resolve the chosen deck once to report how much of it the engine supports.
  useEffect(() => {
    let alive = true
    setCoverage(null)
    if (!value) return
    resolvePlayableDeck(value)
      .then((d) => alive && setCoverage(d.coverage))
      .catch((err) => alive && setCoverage({ error: err.message }))
    return () => {
      alive = false
    }
  }, [value])

  const groups = [...new Set(decks.map((d) => d.group))]
  return (
    <>
      <label className="field-label">{label}</label>
      <select value={value} onChange={(ev) => onChange(ev.target.value)} disabled={disabled}>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {decks
              .filter((d) => d.group === g)
              .map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
          </optgroup>
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
