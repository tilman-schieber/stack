import React, { useEffect, useRef } from 'react'
import { PRIORITY_STEPS } from '../../../store/engineGame.js'

// The public game log, newest at the bottom, kept scrolled to the latest entry.
export function GameLog({ log }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length])
  return (
    <div className="eng-log" ref={ref}>
      {log.length === 0 && <div className="eng-log-line muted">Game log</div>}
      {log.map((l) => (
        <div key={l.n} className={'eng-log-line' + (l.marker ? ' marker' : '')}>
          {l.text}
        </div>
      ))}
    </div>
  )
}


const STOP_STEP_LABEL = {
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  beginCombat: 'Begin combat',
  declareAttackers: 'Declare attackers',
  declareBlockers: 'Declare blockers',
  combatDamage: 'Combat damage',
  endCombat: 'End of combat',
  main2: 'Main 2',
  end: 'End step'
}

// Magic Online-style stop matrix: each player picks the steps they want priority
// at. Unstopped steps auto-pass (see settle() in the store).
export function StopsPanel({ stops, toggleStop, players, canToggle, currentStep, onClose }) {
  return (
    <div className="eng-stops-panel" onMouseLeave={onClose}>
      <div className="eng-stops-head">
        <span>Priority stops</span>
        <button className="mini" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="eng-stops-hint">
        Steps without a stop pass priority automatically (stops apply on both players' turns).
      </div>
      <table className="eng-stops-table">
        <thead>
          <tr>
            <th>Step</th>
            {players.map((p) => (
              <th key={p.id}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PRIORITY_STEPS.map((step) => (
            <tr key={step} className={step === currentStep ? 'now' : ''}>
              <td>{STOP_STEP_LABEL[step] || step}</td>
              {players.map((p) => (
                <td key={p.id}>
                  <input
                    type="checkbox"
                    checked={stops[p.id]?.has(step) || false}
                    disabled={!canToggle(p.id)}
                    title={canToggle(p.id) ? undefined : 'Only your own stops can be changed online'}
                    onChange={() => toggleStop(p.id, step)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
