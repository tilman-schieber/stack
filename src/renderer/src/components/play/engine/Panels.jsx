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


// Card inspector: what the hovered (or zoomed) card is right now — rules text,
// current P/T, printed vs. granted keywords, counters, damage, status, and
// whether the engine enforces all of its text.
export function Inspector({ card }) {
  if (!card || card.hidden) return <div className="eng-inspector muted">Hover a card for details.</div>
  const granted = (card.keywords || []).filter((k) => !(card.printedKeywords || []).includes(k))
  const lost = (card.printedKeywords || []).filter((k) => !(card.keywords || []).includes(k))
  const counters = Object.entries(card.counters || {}).filter(([, n]) => n > 0)
  const status = []
  if (card.tapped) status.push('tapped')
  if (card.summoningSick && card.types?.includes('Creature')) status.push('summoning sick')
  if (card.attacking) status.push('attacking')
  if (card.blocking) status.push('blocking')
  if (card.faceDown) status.push('face down')
  for (const r of card.restrictions || []) status.push(`can't ${r}`)
  const pt = card.power != null ? `${card.power}/${card.toughness}` : null
  return (
    <div className="eng-inspector">
      <div className="eng-inspector-head">
        <b>{card.faceDown && card.realName ? `${card.name} (${card.realName})` : card.name}</b>
        {pt && <span className="eng-inspector-pt">{pt}{card.damage ? ` (${card.damage} damage)` : ''}</span>}
        {card.loyalty != null && <span className="eng-inspector-pt">◆ {card.loyalty}</span>}
        {card.defense != null && <span className="eng-inspector-pt">🛡 {card.defense}</span>}
      </div>
      <div className="muted small">
        {[...(card.supertypes || []), ...(card.types || [])].join(' ')}
        {card.colors?.length ? ` · ${card.colors.join('')}` : ''}
      </div>
      {(card.keywords || []).length > 0 && (
        <div className="small">
          {(card.keywords || []).map((k) => (
            <span key={k} className={'eng-kw' + (granted.includes(k) ? ' granted' : '')} title={granted.includes(k) ? 'granted by an effect' : 'printed'}>
              {k}
            </span>
          ))}
          {lost.map((k) => (
            <span key={k} className="eng-kw lost" title="printed, but currently lost">
              {k}
            </span>
          ))}
        </div>
      )}
      {counters.length > 0 && <div className="small">Counters: {counters.map(([k, n]) => `${n}× ${k}`).join(', ')}</div>}
      {status.length > 0 && <div className="small">{status.join(' · ')}</div>}
      {card.oracleText && <div className="eng-inspector-text">{card.oracleText}</div>}
      {card.supported === false && <div className="eng-inspector-warn">! Part of this text is not enforced — the card plays with its printed characteristics only.</div>}
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
