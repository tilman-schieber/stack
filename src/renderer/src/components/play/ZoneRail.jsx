import React from 'react'
import { useGame } from '../../store/game.js'
import { instanceImage } from '../../lib/gameCard.js'

// A card-sized pile that is also a drop target and opens its zone viewer.
function RailPile({ player, zone, label, faceDown, onOpen, children }) {
  const cards = player.zones[zone]
  const top = cards[cards.length - 1]
  const img = !faceDown && top ? instanceImage(top) : null
  return (
    <div className="rail-pile">
      <div
        className="rail-pile-card"
        data-zone={zone}
        data-player={player.id}
        title={`${label} (${cards.length})`}
        onClick={() => onOpen(zone)}
      >
        {img ? (
          <img src={img} alt="" draggable={false} />
        ) : (
          <div className={cards.length ? 'cardback' : 'pile-empty'} />
        )}
        <span className="pile-count">{cards.length}</span>
      </div>
      <div className="rail-pile-label">{label}</div>
      {children}
    </div>
  )
}

// Library / graveyard / exile piles on the right edge of a player's battlefield.
export default function ZoneRail({ player, onOpenZone }) {
  const draw = useGame((s) => s.draw)
  const shuffleLibrary = useGame((s) => s.shuffleLibrary)

  return (
    <div className="right-rail">
      <RailPile player={player} zone="library" label="Library" faceDown onOpen={onOpenZone}>
        <div className="rail-lib-actions">
          <button onClick={() => draw(player.id, 1)}>Draw</button>
          <button onClick={() => shuffleLibrary(player.id)}>Shuffle</button>
        </div>
      </RailPile>
      <RailPile player={player} zone="graveyard" label="Graveyard" onOpen={onOpenZone} />
      <RailPile player={player} zone="exile" label="Exile" onOpen={onOpenZone} />
    </div>
  )
}
