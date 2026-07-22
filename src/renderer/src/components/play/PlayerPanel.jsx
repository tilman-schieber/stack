import React, { useState } from 'react'
import { useGame } from '../../store/game.js'

const COUNTER_ICON = { poison: '☠', energy: '⚡', experience: '✦' }

// Counters are hidden by default; the ＋ button adds one, and each active
// counter shows as a compact chip with steppers (auto-hides at 0).
function Counters({ player }) {
  const setPlayerCounter = useGame((s) => s.setPlayerCounter)
  const [open, setOpen] = useState(false)
  const entries = Object.entries(player.counters).filter(([, n]) => n > 0)

  return (
    <div className="pp-counters">
      {entries.map(([t, n]) => (
        <span className="counter-chip" key={t} title={t}>
          <button onClick={() => setPlayerCounter(player.id, t, -1)}>−</button>
          <span>
            {COUNTER_ICON[t] || t} {n}
          </span>
          <button onClick={() => setPlayerCounter(player.id, t, 1)}>+</button>
        </span>
      ))}
      <div className="counter-add">
        <button className="mini" title="Add counter" onClick={() => setOpen((o) => !o)}>
          ＋
        </button>
        {open && (
          <div className="counter-menu" onMouseLeave={() => setOpen(false)}>
            {['poison', 'energy', 'experience'].map((t) => (
              <button
                key={t}
                onClick={() => {
                  setPlayerCounter(player.id, t, 1)
                  setOpen(false)
                }}
              >
                {COUNTER_ICON[t]} {t}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function PlayerPanel({ player, isActive }) {
  const setLifeValue = useGame((s) => s.setLifeValue)
  const setLife = useGame((s) => s.setLife)

  return (
    <div className={'player-panel' + (isActive ? ' active' : '')}>
      <div className="pp-name">
        {player.name}
        {isActive && <span className="pp-active-dot" title="Active player" />}
      </div>

      <div className="life-control">
        <button onClick={() => setLife(player.id, -1)}>−</button>
        <input
          className="life-input"
          type="number"
          value={player.life}
          onChange={(e) => setLifeValue(player.id, Number(e.target.value))}
        />
        <button onClick={() => setLife(player.id, 1)}>+</button>
      </div>

      <Counters player={player} />

      <div className="pp-hand" title="Cards in hand">
        ✋ {player.zones.hand.length}
      </div>
    </div>
  )
}
