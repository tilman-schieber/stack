import React, { useEffect, useRef, useState } from 'react'
import { PRIORITY_STEPS, stopKey } from '../../../store/engineGame.js'
import ManaCost, { RulesText } from '../../Mana.jsx'

const LOG_HIDDEN = 'stack.gamelog.hidden'
const readHidden = () => {
  try {
    return localStorage.getItem(LOG_HIDDEN) === '1'
  } catch {
    return false
  }
}

// The public game log, newest at the bottom, kept scrolled to the latest entry.
// It folds away to its header — everything it records is also on the board —
// and stays folded for the next game.
export function GameLog({ log }) {
  const ref = useRef(null)
  const [hidden, setHidden] = useState(readHidden)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length, hidden])
  const toggle = () => {
    setHidden((v) => {
      try {
        localStorage.setItem(LOG_HIDDEN, v ? '0' : '1')
      } catch {
        /* private mode: the choice just doesn't outlive the session */
      }
      return !v
    })
  }
  return (
    <div className={'eng-logbox' + (hidden ? ' hidden' : '')}>
      <button
        className="eng-log-head"
        onClick={toggle}
        title={hidden ? 'Show the game log' : 'Hide the game log'}
        aria-expanded={!hidden}
      >
        <span>Game log</span>
        <span className="eng-log-caret">{hidden ? '▴' : '▾'}</span>
      </button>
      {!hidden && (
        <div className="eng-log" ref={ref}>
          {log.length === 0 && <div className="eng-log-line muted">Nothing has happened yet.</div>}
          {log.map((l) => (
            <div key={l.n} className={'eng-log-line' + (l.marker ? ' marker' : '')}>
              {l.text}
            </div>
          ))}
        </div>
      )}
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
        <ManaCost cost={card.manaCost} />
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
      {card.oracleText && (
        <div className="eng-inspector-text">
          <RulesText text={card.oracleText} />
        </div>
      )}
      {card.supported === false && <div className="eng-inspector-warn">! Part of this text is not enforced — the card plays with its printed characteristics only.</div>}
    </div>
  )
}

export const STOP_STEP_LABEL = {
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
const SHORT_STEP_LABEL = {
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  beginCombat: 'Combat',
  declareAttackers: 'Attackers',
  declareBlockers: 'Blockers',
  combatDamage: 'Damage',
  endCombat: 'End combat',
  main2: 'Main 2',
  end: 'End'
}

// Magic Online-style phase bar: the steps of the current turn with the current
// one lit. Each step shows whether `seat` has a stop there for this kind of turn
// (own or opponent's); clicking toggles it. Steps without a stop pass by; an
// opponent's spell or ability always gives a chance to respond.
export function PhaseBar({ step, oppTurn, seat, stops, toggleStop, canToggle, vertical = false }) {
  const set = stops[seat] || new Set()
  return (
    <div
      className={'eng-phasebar' + (vertical ? ' vertical' : '')}
      title={oppTurn ? "Opponent's turn — click a step to stop there on opponents' turns" : 'Your turn — click a step to stop there on your turns'}
    >
      <span className="eng-phasebar-who">{oppTurn ? 'Opponent’s turn' : 'Your turn'}</span>
      {PRIORITY_STEPS.map((st) => {
        const on = set.has(stopKey(st, oppTurn))
        const now = st === step
        return (
          <button
            key={st}
            className={'eng-phase' + (now ? ' now' : '') + (on ? ' stop' : '')}
            disabled={!canToggle}
            onClick={() => toggleStop(seat, st, oppTurn)}
            title={`${STOP_STEP_LABEL[st]}${now ? ' (now)' : ''} — ${on ? 'stop set' : 'passes automatically'}${canToggle ? '. Click to toggle.' : ''}`}
          >
            {on && <span className="eng-phase-dot" />}
            {SHORT_STEP_LABEL[st]}
          </button>
        )
      })}
    </div>
  )
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
        Steps without a stop pass priority automatically, set separately for your own turn and for the opponent's. You
        always get to respond to an opponent's spell or ability, and always declare your own attackers and blockers.
      </div>
      <table className="eng-stops-table">
        <thead>
          <tr>
            <th rowSpan={2}>Step</th>
            {players.map((p) => (
              <th key={p.id} colSpan={2}>
                {p.name}
              </th>
            ))}
          </tr>
          <tr>
            {players.map((p) => (
              <React.Fragment key={p.id}>
                <th className="eng-stops-sub">own turn</th>
                <th className="eng-stops-sub">opp. turn</th>
              </React.Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {PRIORITY_STEPS.map((step) => (
            <tr key={step} className={step === currentStep ? 'now' : ''}>
              <td>{STOP_STEP_LABEL[step] || step}</td>
              {players.map((p) => (
                <React.Fragment key={p.id}>
                  {[false, true].map((opp) => (
                    <td key={String(opp)}>
                      <input
                        type="checkbox"
                        checked={stops[p.id]?.has(stopKey(step, opp)) || false}
                        disabled={!canToggle(p.id)}
                        title={canToggle(p.id) ? (opp ? "On the opponent's turn" : 'On your own turn') : "Only your own stops can be changed"}
                        onChange={() => toggleStop(p.id, step, opp)}
                      />
                    </td>
                  ))}
                </React.Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
