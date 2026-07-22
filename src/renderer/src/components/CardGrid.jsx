import React, { useMemo } from 'react'
import CardTile from './CardTile.jsx'
import { primaryType, manaValue, TYPE_GROUP_ORDER } from '../lib/cardUtils.js'
import { useDeck } from '../store/deck.js'

const SECTION_LABELS = {
  main: 'Main Deck',
  commander: 'Commander',
  sideboard: 'Sideboard'
}

// Groups entries by section, then by primary card type, sorted by mana value.
export default function CardGrid() {
  const entries = useDeck((s) => s.entries)
  const loading = useDeck((s) => s.loading)

  const sections = useMemo(() => groupEntries(entries), [entries])

  if (loading) {
    return <div className="empty-state">Resolving cards…</div>
  }
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        <p>No cards yet.</p>
        <p className="muted">Import an Arena decklist or search for cards to add.</p>
      </div>
    )
  }

  return (
    <div className="card-grid-scroll">
      {['commander', 'main', 'sideboard'].map((sec) => {
        const groups = sections[sec]
        if (!groups || groups.length === 0) return null
        const total = groups.reduce(
          (s, g) => s + g.items.reduce((n, e) => n + e.qty, 0),
          0
        )
        return (
          <section key={sec} className="deck-section">
            <h2 className="section-title">
              {SECTION_LABELS[sec]} <span className="muted">({total})</span>
            </h2>
            {groups.map((group) => (
              <div key={group.type} className="type-group">
                <h3 className="group-title">
                  {group.type}{' '}
                  <span className="muted">
                    ({group.items.reduce((n, e) => n + e.qty, 0)})
                  </span>
                </h3>
                <div className="card-grid">
                  {group.items.map((entry) => (
                    <CardTile key={entry.id + entry.section} entry={entry} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function groupEntries(entries) {
  const bySection = { main: {}, commander: {}, sideboard: {} }
  for (const e of entries) {
    const sec = bySection[e.section] ? e.section : 'main'
    const t = primaryType(e.card)
    ;(bySection[sec][t] ||= []).push(e)
  }
  const result = {}
  for (const [sec, groups] of Object.entries(bySection)) {
    const ordered = TYPE_GROUP_ORDER.filter((t) => groups[t]).map((type) => ({
      type,
      items: groups[type].sort(
        (a, b) =>
          manaValue(a.card) - manaValue(b.card) || a.card.name.localeCompare(b.card.name)
      )
    }))
    result[sec] = ordered
  }
  return result
}
