// Geometry for the arrows that show which blocker stopped which attacker.
//
// Two cards on the board are two rectangles; an arrow between them should leave
// one edge and land on the other, never start or stop inside the art. These are
// pure functions over rects ({left, top, width, height}) so the drawing code has
// nothing to work out for itself.

const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

// Where the line from `r`'s centre towards `to` crosses `r`'s edge. Solved on
// the rectangle rather than an enclosing circle, so the arrow meets a card's
// side square-on instead of floating off a corner.
export function edgePoint(r, to) {
  const c = centre(r)
  const dx = to.x - c.x
  const dy = to.y - c.y
  if (!dx && !dy) return c
  const hw = r.width / 2
  const hh = r.height / 2
  // How far along the ray the first edge is hit.
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return { x: c.x + dx * t, y: c.y + dy * t }
}

// The curve from the blocker to the attacker it is blocking: both ends sit on a
// card edge, and the line bows sideways so two arrows into the same attacker
// stay apart instead of overlapping into one thick smear. `bow` is a fraction of
// the arrow's length, signed — callers space out a fan by varying it.
export function arrowGeometry(fromRect, toRect, bow = 0) {
  const a = centre(fromRect)
  const b = centre(toRect)
  const start = edgePoint(fromRect, b)
  const end = edgePoint(toRect, a)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const mx = (start.x + end.x) / 2
  const my = (start.y + end.y) / 2
  // Perpendicular to the line, scaled by how long the arrow is.
  const ctrl = { x: mx + (-dy / len) * len * bow, y: my + (dx / len) * len * bow }
  return { start, end, ctrl, length: len }
}

// `d` for an SVG path: one quadratic curve.
export function arrowPath(g) {
  return `M ${g.start.x} ${g.start.y} Q ${g.ctrl.x} ${g.ctrl.y} ${g.end.x} ${g.end.y}`
}

// Fan the arrows that share a target, so a double block reads as two arrows.
// One arrow is straight; more spread evenly either side of straight.
export function bowFor(index, count, spread = 0.18) {
  if (count <= 1) return 0
  return (index / (count - 1) - 0.5) * 2 * spread
}

// One arrow per attacker each blocker is on. `blocks` maps a blocker's oid to an
// attacker oid or a list of them (a creature that may block more than one), and
// unknown or dangling entries are dropped rather than drawn to nowhere.
export function blockPairs(blocks, known) {
  const out = []
  for (const [blocker, val] of Object.entries(blocks || {})) {
    if (!known(blocker)) continue
    for (const attacker of val == null ? [] : Array.isArray(val) ? val : [val]) {
      if (known(attacker)) out.push({ blocker, attacker })
    }
  }
  return out
}
