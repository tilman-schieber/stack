// Board motion: the screen says what happened.
//
// The engine rebuilds a whole view after every decision and never tells the
// renderer "this card moved" — but every object carries a stable oid, so the
// move is recoverable by diffing two consecutive views. This measures where
// each card is on screen after every commit and compares it with where it was
// after the previous one. A card whose zone changed gets a flight: a copy of it
// travels from the old place to the new one while the real card waits, hidden.
//
// Flights are copies in a fixed overlay rather than the cards themselves,
// because hands clip their contents and battlefields scroll — a card animated
// in place would be cut off crossing the boundary between the two.
//
// The decision of what moved is `planMotion`, which is pure and takes plain
// data; only the measuring and the animating touch the DOM.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const FLIGHT_MS = 270
const DAMAGE_MS = 1000
// A turn that empties a hand should not put thirty things in the air at once.
const MAX_FLIGHTS = 10
// Zone changes worth showing. Reordering inside a zone is not movement.
const SILENT = new Set(['bf>bf', 'hand>hand', 'stack>stack'])
// Below this a card has not visibly gone anywhere.
const MIN_TRAVEL = 3

// What moved between two measured boards.
//
// `before` and `now` are Map<oid, { rect, zone }>; `damageBefore` and
// `damageNow` are Map<oid, number>. `sourceFor(oid, entry)` supplies a starting
// rect for a card that was not on screen at all a moment ago, and returns null
// when there is no honest answer — a token appearing has nowhere to come from.
export function planMotion({ before, now, damageBefore, damageNow, sourceFor, max = MAX_FLIGHTS }) {
  const flights = []
  for (const [oid, cur] of now) {
    if (flights.length >= max) break
    const old = before.get(oid)
    if (old && (old.zone === cur.zone || SILENT.has(`${old.zone}>${cur.zone}`))) continue
    const from = old ? old.rect : sourceFor(oid, cur)
    if (!from) continue
    if (Math.abs(from.left - cur.rect.left) < MIN_TRAVEL && Math.abs(from.top - cur.rect.top) < MIN_TRAVEL) continue
    flights.push({ oid, from, to: cur.rect })
  }
  // Damage newly marked. A creature that took lethal damage is already gone by
  // the time the view is built, so this only ever fires for survivors.
  const hits = []
  for (const [oid, n] of damageNow) {
    const was = damageBefore.get(oid) || 0
    if (n > was) hits.push({ oid, amount: n - was })
  }
  return { flights, hits }
}

const reduceMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

// Everything the layer needs about one card on screen right now.
function measure() {
  const map = new Map()
  for (const el of document.querySelectorAll('[data-oid]')) {
    const oid = el.dataset.oid
    if (!oid || map.has(oid)) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    map.set(oid, { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, zone: el.dataset.zone || '', el })
  }
  return map
}

const boxOf = (node) => {
  const r = node?.getBoundingClientRect()
  return r?.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
}

// Where a card that was nowhere a moment ago came from.
//
// Drawn into a hand: off that player's library. Cast or played by someone whose
// hand is hidden — the computer, an online opponent — from where their hand is
// on screen, which is their side's card count, since the cards themselves are
// never drawn. A card entering next to a hand you can actually see is a token
// or came from a hidden zone, and simply appears.
function domSource(_oid, cur) {
  const el = cur.el
  // The stack sits between the seats rather than inside one, so a spell on it
  // names its controller and the seat is found from that.
  const owner = el.dataset.player
  const seat =
    el.closest('.eng-seat') ||
    (owner != null ? document.querySelector(`[data-pile="library"][data-player="${owner}"]`)?.closest('.eng-seat') : null)
  if (cur.zone === 'hand') {
    return boxOf(seat?.querySelector('[data-pile="library"]') || document.querySelector('[data-pile="library"]'))
  }
  if ((cur.zone === 'bf' || cur.zone === 'stack') && seat && !seat.querySelector('[data-zone="hand"]')) {
    return boxOf(seat.querySelector('.eng-rail-counts'))
  }
  return null
}

// Damage marked on every creature in play, straight from the view rather than
// scraped back off the board.
function damageOf(view) {
  const map = new Map()
  for (const p of view?.players || []) {
    for (const c of p.battlefield || []) if (c.damage > 0) map.set(c.oid, c.damage)
  }
  return map
}

let nextId = 1

// Watches the board and returns the flights and damage numbers to draw. `view`
// changes identity exactly when the engine hands over a new one, which is the
// only time anything can have moved; hovering a card must not trigger a diff.
export function useBoardMotion(view, enabled = true) {
  const [flights, setFlights] = useState([])
  const [hits, setHits] = useState([])
  const boxes = useRef(new Map())
  const damage = useRef(new Map())
  const lastView = useRef(null)
  const held = useRef(new Set())

  useLayoutEffect(() => {
    if (view === lastView.current) return
    const first = lastView.current === null
    lastView.current = view

    const now = measure()
    const before = boxes.current
    const damageNow = damageOf(view)
    const damageBefore = damage.current
    boxes.current = now
    damage.current = damageNow
    if (first || !enabled || reduceMotion()) return

    const plan = planMotion({ before, now, damageBefore, damageNow, sourceFor: domSource })

    if (plan.flights.length) {
      const added = plan.flights.map((f) => {
        const el = now.get(f.oid).el
        const img = el.querySelector('img')
        return { id: nextId++, src: img?.currentSrc || img?.src || null, from: f.from, to: f.to, el }
      })
      // Hold the real cards back so the copy is the only one you see arriving.
      for (const f of added) {
        f.el.style.opacity = '0'
        held.current.add(f.el)
      }
      setFlights((list) => [...list, ...added])
      window.setTimeout(() => {
        for (const f of added) {
          f.el.style.opacity = ''
          held.current.delete(f.el)
        }
        const ids = new Set(added.map((f) => f.id))
        setFlights((list) => list.filter((f) => !ids.has(f.id)))
      }, FLIGHT_MS)
    }

    if (plan.hits.length) {
      const bumps = []
      for (const h of plan.hits) {
        const r = now.get(h.oid)?.rect
        if (!r) continue
        bumps.push({ id: nextId++, text: `−${h.amount}`, x: r.left + r.width / 2, y: r.top + r.height / 3 })
      }
      if (bumps.length) {
        setHits((list) => [...list, ...bumps])
        const ids = new Set(bumps.map((b) => b.id))
        window.setTimeout(() => setHits((list) => list.filter((b) => !ids.has(b.id))), DAMAGE_MS)
      }
    }
  }, [view, enabled])

  // A card unmounted mid-flight would otherwise keep its opacity forever.
  useEffect(
    () => () => {
      for (const el of held.current) el.style.opacity = ''
      held.current.clear()
    },
    []
  )

  return { flights, hits }
}

export { FLIGHT_MS, DAMAGE_MS, MAX_FLIGHTS }
