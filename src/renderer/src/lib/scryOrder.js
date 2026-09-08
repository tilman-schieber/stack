// Ordering the cards a scry keeps on top.
//
// Scry does two things: send cards to the bottom, and put the rest back "in any
// order". Only the first was implemented, so scrying 2 could not swap them —
// the half of the effect that decides what you draw next turn.

// Drop `oid` into the place `target` currently occupies, sliding the others
// along. Dropping a card on itself, or on a card that isn't there, changes
// nothing — and returns the same array, which is what tells React not to
// re-render mid-drag.
export function moveTo(order, oid, target) {
  const from = order.indexOf(oid)
  const to = order.indexOf(target)
  if (from < 0 || to < 0 || from === to) return order
  const out = [...order]
  out.splice(to, 0, out.splice(from, 1)[0])
  return out
}

// The cards going back on top, topmost first: the chosen order minus whatever is
// being sent to the bottom (or the graveyard, for surveil).
export function keptOrder(order, bottom) {
  return order.filter((oid) => !bottom.includes(oid))
}
