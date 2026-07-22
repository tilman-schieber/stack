import React from 'react'
import { instanceImage } from '../../lib/gameCard.js'

// One card instance rendered on the board. Left-drag moves it (handled by the
// parent's drag hook via onStart); right-click opens the context menu.
export default function BoardCard({ instance, card, playerId, zone, onStart, onMenu, style }) {
  const img = instance.faceDown ? null : instanceImage(instance)
  const counters = Object.entries(instance.counters || {})

  return (
    <div
      className={
        'board-card' +
        (instance.tapped ? ' tapped' : '') +
        (instance.faceDown ? ' facedown' : '')
      }
      style={style}
      title={instance.faceDown ? 'Face-down card' : card?.name || ''}
      onMouseDown={(e) => onStart(e, { playerId, zone, instance })}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e, { playerId, zone, instance })
      }}
    >
      {img ? (
        <img src={img} alt={card?.name || ''} draggable={false} />
      ) : (
        <div className="cardback" />
      )}
      {counters.length > 0 && (
        <div className="counters">
          {counters.map(([t, n]) => (
            <span key={t} className="counter-badge" title={t}>
              {n} {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
