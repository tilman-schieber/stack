import React from 'react'
import BoardCard from './BoardCard.jsx'

// The active player's hand, shown face-up as a row.
export default function Hand({ player, cardsById, onStart, onMenu }) {
  return (
    <div className="hand" data-zone="hand" data-player={player.id}>
      {player.zones.hand.length === 0 && <div className="hand-hint">Hand empty</div>}
      {player.zones.hand.map((inst) => (
        <div className="hand-slot" key={inst.iid}>
          <BoardCard
            instance={inst}
            card={cardsById[inst.cardId]}
            playerId={player.id}
            zone="hand"
            onStart={onStart}
            onMenu={onMenu}
          />
        </div>
      ))}
    </div>
  )
}
