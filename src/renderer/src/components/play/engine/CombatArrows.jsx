import React, { useEffect, useState } from 'react'
import { arrowGeometry, arrowPath, bowFor } from '../../../lib/combatArrows.js'

// Arrows from each blocker to the attacker it is blocking.
//
// Blocks were shown only as a colour on the two cards, which says that a
// creature is blocking and never which attacker it is on — unreadable the
// moment there is more than one of each. The arrows are drawn in a fixed layer
// over the board, measured from the cards themselves, so they follow the board
// wherever it scrolls or resizes.
//
// `pairs` is [{ blocker, attacker, pending }] of card oids; `pending` marks a
// block being declared rather than one already made.
export default function CombatArrows({ pairs }) {
  const [rects, setRects] = useState(null)
  // What to re-measure for: the arrows themselves, and the size of the window
  // they are drawn in.
  const key = pairs.map((p) => `${p.blocker}>${p.attacker}${p.pending ? '?' : ''}`).join(',')

  useEffect(() => {
    if (!pairs.length) {
      setRects(null)
      return
    }
    let raf = 0
    let last = ''
    // The board moves under the arrows — cards fly in from the motion layer,
    // the hand fans open, the wheel rescales everything — and none of that
    // notifies us. Measuring each frame while a block is on screen is cheap
    // (a handful of rects) and is the only thing that stays correct.
    const tick = () => {
      const next = {}
      for (const oid of new Set(pairs.flatMap((p) => [p.blocker, p.attacker]))) {
        const el = document.querySelector(`[data-oid="${oid}"]`)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.width) next[oid] = { left: r.left, top: r.top, width: r.width, height: r.height }
      }
      const sig = JSON.stringify(next)
      if (sig !== last) {
        last = sig
        setRects(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pairs.length || !rects) return null
  // Arrows onto the same attacker fan out, so a double block reads as two.
  const perAttacker = {}
  for (const p of pairs) perAttacker[p.attacker] = (perAttacker[p.attacker] || 0) + 1
  const seen = {}

  const drawn = pairs
    .map((p) => {
      const from = rects[p.blocker]
      const to = rects[p.attacker]
      if (!from || !to) return null
      const n = perAttacker[p.attacker]
      const i = (seen[p.attacker] = (seen[p.attacker] ?? -1) + 1)
      const g = arrowGeometry(from, to, bowFor(i, n))
      return { ...p, d: arrowPath(g) }
    })
    .filter(Boolean)

  return (
    <svg className="eng-combat-arrows" aria-hidden="true">
      <defs>
        {/* One head per colour: a marker cannot inherit the stroke of the path
            that uses it, so a declared block and a made one get their own. */}
        {['made', 'pending'].map((k) => (
          <marker
            key={k}
            id={`eng-arrowhead-${k}`}
            className={`eng-arrowhead ${k}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        ))}
      </defs>
      {drawn.map((a) => (
        <path
          key={`${a.blocker}>${a.attacker}`}
          className={'eng-arrow' + (a.pending ? ' pending' : '')}
          d={a.d}
          markerEnd={`url(#eng-arrowhead-${a.pending ? 'pending' : 'made'})`}
        />
      ))}
    </svg>
  )
}
