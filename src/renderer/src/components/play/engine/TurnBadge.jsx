import React, { useEffect, useRef, useState } from 'react'

// Whose turn it is.
//
// The board said this only in a brass edge down one side of the table, which is
// easy to miss and impossible to read at a glance mid-game. The badge says it in
// words, always, and announces each handover once so a turn never changes
// without anyone noticing.
//
// `thinking` is the seat the game is waiting on while the computer decides — the
// pause is part of the game, so it is labelled rather than left as a freeze.
export default function TurnBadge({ mine, turnNumber, stepLabel, oppName, thinking }) {
  const [announce, setAnnounce] = useState(null)
  const seen = useRef(null)

  useEffect(() => {
    if (turnNumber == null) return
    const key = `${turnNumber}:${mine}`
    if (seen.current === key) return
    const first = seen.current === null
    seen.current = key
    if (first) return // no banner for the turn the game opens on
    setAnnounce({ mine, key })
    const t = setTimeout(() => setAnnounce(null), 1400)
    return () => clearTimeout(t)
  }, [turnNumber, mine])

  return (
    <>
      <div className={'eng-turn-badge' + (mine ? ' mine' : '')} title={`Turn ${turnNumber} — ${stepLabel}`}>
        <span className="eng-turn-who">{mine ? 'Your turn' : `${oppName || 'Opponent'}'s turn`}</span>
        <span className="eng-turn-step">{stepLabel}</span>
        {thinking != null && (
          <span className="eng-turn-thinking" title="The computer is deciding">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>
      {announce && (
        <div className={'eng-turn-announce' + (announce.mine ? ' mine' : '')} key={announce.key} aria-live="polite">
          {announce.mine ? 'Your turn' : `${oppName || 'Opponent'}'s turn`}
        </div>
      )}
    </>
  )
}
