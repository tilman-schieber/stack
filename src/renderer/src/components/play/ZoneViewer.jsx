import React, { useState } from 'react'
import { useGame } from '../../store/game.js'
import { instanceImage, ZONE_LABELS } from '../../lib/gameCard.js'

// Browse/search a hidden or stacked zone (library / graveyard / exile) and pull
// cards out to other zones. `viewer` = { playerId, zone }.
export default function ZoneViewer({ viewer, cardsById, onClose }) {
  const { playerId, zone } = viewer
  const player = useGame((s) => s.players[playerId])
  const moveCard = useGame((s) => s.moveCard)
  const shuffleLibrary = useGame((s) => s.shuffleLibrary)
  const [query, setQuery] = useState('')

  // Library: top-first. Others: most-recent first.
  const list = zone === 'library' ? player.zones[zone] : [...player.zones[zone]].reverse()
  const q = query.trim().toLowerCase()
  const shown = q
    ? list.filter((inst) => (cardsById[inst.cardId]?.name || '').toLowerCase().includes(q))
    : list

  const pull = (iid, toZone, opts) => () => {
    moveCard(playerId, iid, toZone, opts)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal zone-viewer" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>
              {player.name} — {ZONE_LABELS[zone]} ({player.zones[zone].length})
            </h2>
            {zone === 'library' && <p className="muted small">Top of library shown first.</p>}
          </div>
          <div className="zv-header-actions">
            {zone === 'library' && (
              <button className="secondary" onClick={() => shuffleLibrary(playerId)}>
                Shuffle
              </button>
            )}
            <button className="del" onClick={onClose} title="Close">
              ✕
            </button>
          </div>
        </header>

        {zone === 'library' && (
          <input
            className="zv-search"
            placeholder="Search this zone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        )}

        <div className="zv-grid">
          {shown.length === 0 && <p className="muted">No cards.</p>}
          {shown.map((inst) => {
            const card = cardsById[inst.cardId]
            const img = instanceImage(inst)
            return (
              <div className="zv-card" key={inst.iid}>
                {img ? <img src={img} alt={card?.name || ''} loading="lazy" /> : <div className="cardback" />}
                <div className="zv-name">{card?.name || 'Card'}</div>
                <div className="zv-actions">
                  <button onClick={pull(inst.iid, 'hand')}>Hand</button>
                  <button onClick={pull(inst.iid, 'battlefield', { x: 40, y: 40 })}>Play</button>
                  {zone !== 'library' && (
                    <button onClick={pull(inst.iid, 'library', { toTop: true })}>Top</button>
                  )}
                  {zone === 'library' && (
                    <button onClick={pull(inst.iid, 'graveyard')}>GY</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
