// Who gets handed priority, Magic Online style. Pure: decides for one priority
// window; the caller passes or hands the window to the player.
//
// Stops are per seat: a Set of step names for the player's own turn and
// "opp:<step>" for opponents' turns. Yields are per seat and per turn:
//   'turn'  (F4) pass every remaining stop this turn, but still stop when an
//           opponent puts something on the stack you could respond to — and that
//           cancels the yield.
//   'all'   (F6) pass everything this turn, responses included.
// Hold: the player asked to keep priority after their next spell or ability, so
// they can respond to their own (it is consumed the first time it applies).

export const stopKey = (step, oppTurn) => (oppTurn ? 'opp:' + step : step)
export const DEFAULT_STOPS = ['main1', 'main2', 'opp:declareAttackers', 'opp:end']
export const YIELD_KINDS = ['turn', 'all']

// state: engine state with a `priority` pending. stops: Set for this seat.
// yield: { kind, turn } | undefined. hold: boolean.
// Returns { give, cancelYield, consumeHold }.
export function priorityDecision(state, stops, yieldEntry, hold = false) {
  const p = state.pending
  const me = p.player
  const no = { give: false, cancelYield: false, consumeHold: false }
  // Tapping for mana is always available and never a reason to stop.
  const canAct = (p.actions || []).some((a) => a.type !== 'pass' && !a.mana)
  if (!canAct) return no
  const stack = state.zones.stack || []
  const top = stack.length ? state.objects[stack[stack.length - 1]] : null
  const y = yieldEntry && yieldEntry.turn === state.turnNumber ? yieldEntry.kind : null
  if (top && top.controller === me && hold) return { give: true, cancelYield: false, consumeHold: true }
  if (y === 'all') return no
  if (top && top.controller !== me) return { give: true, cancelYield: y === 'turn', consumeHold: false }
  if (y) return no
  const stopHere = !!stops?.has(stopKey(state.step, state.activePlayer !== me))
  return { give: stopHere, cancelYield: false, consumeHold: false }
}
