// Ordering the cards a scry keeps on top.
//
// Scry does two things: send cards to the bottom, and put the rest back "in any
// order". Only the first was implemented, so scrying 2 could not swap them —
// the half of the effect that decides what you draw next turn.

// Move `oid` `by` places within `order` (negative = nearer the top). Out-of-range
// moves leave the order alone, so the buttons at the ends are simply inert.
export function moveInOrder(order, oid, by) {
  const i = order.indexOf(oid)
  const j = i + by
  if (i < 0 || j < 0 || j >= order.length) return order
  const out = [...order]
  out.splice(j, 0, out.splice(i, 1)[0])
  return out
}

// The cards going back on top, topmost first: the chosen order minus whatever is
// being sent to the bottom (or the graveyard, for surveil).
export function keptOrder(order, bottom) {
  return order.filter((oid) => !bottom.includes(oid))
}

// Move `oid` one place among the cards that are staying on top, leaving the
// bottomed ones where they sit on screen. Moving "past" a card that is going to
// the bottom would look like a move and change nothing, so the step skips it.
export function moveKept(order, bottom, oid, by) {
  const kept = keptOrder(order, bottom)
  const moved = moveInOrder(kept, oid, by)
  if (moved === kept) return order
  const slots = order.map((o, i) => (bottom.includes(o) ? -1 : i)).filter((i) => i >= 0)
  const out = [...order]
  slots.forEach((slot, i) => (out[slot] = moved[i]))
  return out
}

// Can `oid` still move that way among the kept cards? (Both ends are inert.)
export function canMoveKept(order, bottom, oid, by) {
  return moveKept(order, bottom, oid, by) !== order
}
