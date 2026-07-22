import { useEffect, useRef, useState } from 'react'
import { useGame } from '../store/game.js'

const CLICK_THRESHOLD = 5 // px of movement before a press counts as a drag
const CARD_W = 90
const CARD_H = 126
const GRID = 20 // slight snap-to-grid for battlefield placement
const snap = (v) => Math.round(v / GRID) * GRID

// Pointer-based drag manager for board cards. Returns:
//  - start(e, { playerId, zone, instance }): begin a potential drag on mousedown
//  - drag: current drag state (null when idle) for rendering a floating preview
//  - onCardTap: optional callback set per card is handled inline (tap = click w/o move)
//
// On drop, the target zone is resolved via document.elementFromPoint against
// [data-zone][data-player] containers. Battlefield drops compute x/y from the rect.
// Same-player only (control changes are out of scope for v1).
export function useBoardDrag({ onTap } = {}) {
  const [drag, setDrag] = useState(null)
  const dragRef = useRef(null)
  const moveCard = useGame((s) => s.moveCard)
  const setPosition = useGame((s) => s.setPosition)

  useEffect(() => {
    dragRef.current = drag
  }, [drag])

  useEffect(() => {
    if (!drag) return

    function onMove(e) {
      setDrag((d) => {
        if (!d) return d
        const moved = d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > CLICK_THRESHOLD
        return { ...d, x: e.clientX, y: e.clientY, moved }
      })
    }

    function onUp(e) {
      const d = dragRef.current
      if (d) {
        if (!d.moved) {
          onTap?.(d)
        } else {
          const el = document.elementFromPoint(e.clientX, e.clientY)
          const zoneEl = el?.closest('[data-zone]')
          if (zoneEl) {
            const toPlayer = Number(zoneEl.dataset.player)
            const toZone = zoneEl.dataset.zone
            if (toPlayer === d.fromPlayer) {
              if (toZone === 'battlefield') {
                const rect = zoneEl.getBoundingClientRect()
                const x = snap(e.clientX - rect.left - CARD_W / 2)
                const y = snap(e.clientY - rect.top - CARD_H / 2)
                if (d.fromZone === 'battlefield') setPosition(d.fromPlayer, d.instance.iid, x, y)
                else moveCard(d.fromPlayer, d.instance.iid, 'battlefield', { x, y })
              } else if (toZone !== d.fromZone) {
                moveCard(d.fromPlayer, d.instance.iid, toZone)
              }
            }
          }
        }
      }
      setDrag(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag, moveCard, setPosition, onTap])

  function start(e, { playerId, zone, instance }) {
    if (e.button !== 0) return // left button only
    e.preventDefault()
    setDrag({
      instance,
      fromPlayer: playerId,
      fromZone: zone,
      x: e.clientX,
      y: e.clientY,
      sx: e.clientX,
      sy: e.clientY,
      moved: false
    })
  }

  return { start, drag }
}
