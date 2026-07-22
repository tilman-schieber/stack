import React from 'react'
import { useGame } from '../../store/game.js'
import { PHASES, PHASE_LABELS } from '../../lib/gameCard.js'

export default function TurnBar() {
  const phase = useGame((s) => s.phase)
  const activePlayer = useGame((s) => s.activePlayer)
  const players = useGame((s) => s.players)
  const untapAll = useGame((s) => s.untapAll)
  const draw = useGame((s) => s.draw)
  const mulligan = useGame((s) => s.mulligan)
  const nextPhase = useGame((s) => s.nextPhase)
  const passTurn = useGame((s) => s.passTurn)
  const newGame = useGame((s) => s.newGame)

  const active = players[activePlayer]

  return (
    <div className="turnbar">
      <div className="phases">
        {PHASES.map((p) => (
          <span key={p} className={'phase-pill' + (p === phase ? ' on' : '')}>
            {PHASE_LABELS[p]}
          </span>
        ))}
      </div>
      <div className="turn-actions">
        <button onClick={() => untapAll(activePlayer)}>Untap all</button>
        <button onClick={() => draw(activePlayer, 1)}>Draw</button>
        <button onClick={() => mulligan(activePlayer)} title="Reshuffle hand, draw 7">
          Mulligan
        </button>
        <button onClick={nextPhase}>Next phase ▸</button>
        <button className="primary" onClick={passTurn} title="End turn, pass to opponent">
          Pass turn ⟳
        </button>
        <button className="secondary" onClick={newGame}>
          New game
        </button>
      </div>
      <div className="turn-active muted">Active: {active?.name}</div>
    </div>
  )
}
