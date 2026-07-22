import React from 'react'
import BoardCard from './BoardCard.jsx'

// Free-position drop area. Cards are absolutely positioned by their x/y.
export default function Battlefield({ player, cardsById, onStart, onMenu }) {
  return (
    <div className="battlefield" data-zone="battlefield" data-player={player.id}>
      {player.zones.battlefield.length === 0 && (
        <div className="bf-hint">Battlefield — drag cards here</div>
      )}
      {player.zones.battlefield.map((inst) => (
        <BoardCard
          key={inst.iid}
          instance={inst}
          card={cardsById[inst.cardId]}
          playerId={player.id}
          zone="battlefield"
          onStart={onStart}
          onMenu={onMenu}
          style={{ position: 'absolute', left: inst.x, top: inst.y }}
        />
      ))}
    </div>
  )
}
