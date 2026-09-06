import React, { useLayoutEffect, useRef } from 'react'
import { FLIGHT_MS } from '../../../lib/boardMotion.js'

// One card in transit. It starts at the old place and size and is animated to
// the new one; the real card is hidden until it lands, so you see one object
// travel rather than two appear.
function Flight({ flight }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { from, to } = flight
    const anim = el.animate(
      [
        {
          transform: `translate(${from.left}px, ${from.top}px) scale(${from.width / to.width}, ${from.height / to.height})`
        },
        { transform: `translate(${to.left}px, ${to.top}px) scale(1, 1)` }
      ],
      { duration: FLIGHT_MS, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)', fill: 'forwards' }
    )
    return () => anim.cancel()
  }, [flight])
  return (
    <div
      ref={ref}
      className="eng-flight"
      style={{ width: flight.to.width, height: flight.to.height, transformOrigin: '0 0' }}
      aria-hidden="true"
    >
      {flight.src ? <img src={flight.src} alt="" draggable={false} /> : <div className="cardback" />}
    </div>
  )
}

// The layer cards travel through, and the damage numbers thrown off them. It
// covers the window and takes no clicks, so nothing underneath changes.
export default function MotionLayer({ flights, hits }) {
  if (!flights.length && !hits.length) return null
  return (
    <div className="eng-motion" aria-hidden="true">
      {flights.map((f) => (
        <Flight key={f.id} flight={f} />
      ))}
      {hits.map((h) => (
        <span key={h.id} className="eng-hit" style={{ left: h.x, top: h.y }}>
          {h.text}
        </span>
      ))}
    </div>
  )
}
