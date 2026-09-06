// How big the cards on the board are drawn.
//
// The wheel over the table resizes them, which is how you deal with a board too
// full to fit as much as it is a matter of taste. Kept per device, since it is
// about the screen in front of you rather than about the game.
import { setBoardScale } from './cardUtils.js'

export const BASE_CARD_WIDTH = 100 // px at scale 1, and what the CSS falls back to
export const MIN_SCALE = 0.6
export const MAX_SCALE = 1.8
const STEP = 1.1 // one wheel notch
const KEY = 'stack.cardscale'

// Anything that is not a usable positive number — a cleared or corrupted stored
// value, a negative, an infinity — is not a very small card, it is no answer at
// all, so it falls back to the resting size. A usable number is clamped.
export const clampScale = (n) => {
  const s = typeof n === 'string' && n.trim() === '' ? NaN : Number(n)
  if (!Number.isFinite(s) || s <= 0) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 1000) / 1000))
}

// One notch: up makes the cards bigger. Multiplicative, so a notch feels the
// same size at either end of the range.
export const scaleBy = (current, direction) => clampScale(direction > 0 ? current * STEP : current / STEP)

export const cardWidth = (scale) => Math.round(BASE_CARD_WIDTH * clampScale(scale))

export function loadScale() {
  let s = 1
  try {
    const raw = localStorage.getItem(KEY)
    if (raw != null) s = clampScale(raw)
  } catch {
    /* private mode: the default is fine */
  }
  setBoardScale(s)
  return s
}

export function saveScale(scale) {
  const s = clampScale(scale)
  setBoardScale(s)
  try {
    localStorage.setItem(KEY, String(s))
  } catch {
    /* the choice just doesn't outlive the session */
  }
  return s
}
