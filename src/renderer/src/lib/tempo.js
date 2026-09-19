// How fast the game plays itself.
//
// Most of a game of Magic is not a decision anyone makes: priority passes back
// and forth, the stack resolves, steps tick over. The engine does all of that in
// a single synchronous burst, so the board used to jump from one state to a much
// later one between two frames — a spell appeared and resolved without ever
// being seen on the stack, and a whole opponent's turn could land in one blink.
//
// The cure is not a fixed delay everywhere. It is to give each thing that
// happens its own frame, and to size the pause by how much of the board moved:
// nothing visible costs nothing, a card changing zones is worth a beat, a turn
// changing is worth a longer one. A burst that runs long speeds up as it goes,
// so a twenty-step turn does not become twenty seconds.
//
// Everything here is a pure function of plain data, so the pacing can be
// reasoned about (and tested) without an engine or a browser.

// A snapshot of everything a person would notice from across the table. Two
// signatures that match mean the last step changed nothing worth pausing for.
export function signatureOf(state) {
  if (!state) return null
  const zones = {}
  for (const p of state.players || []) {
    zones[p.id] = ['hand', 'battlefield', 'graveyard', 'exile', 'library']
      .map((z) => (state.zones?.[`${z}:${p.id}`] || []).length)
      .join('/')
  }
  return {
    turn: state.turnNumber ?? 0,
    active: state.activePlayer ?? 0,
    step: state.step || '',
    stack: (state.zones?.stack || []).length,
    life: (state.players || []).map((p) => p.life).join('/'),
    zones
  }
}

// What changed between two signatures, named by the biggest thing that moved.
// The order matters: a turn change usually also changes the step, and a spell
// resolving changes both the stack and a zone.
export function changeKind(before, after) {
  if (!before || !after) return 'none'
  if (before.turn !== after.turn || before.active !== after.active) return 'turn'
  if (before.stack !== after.stack) return 'stack'
  for (const pid of Object.keys(after.zones)) if (before.zones[pid] !== after.zones[pid]) return 'card'
  if (before.life !== after.life) return 'life'
  if (before.step !== after.step) return 'step'
  return 'none'
}

// What each kind of change is worth, in milliseconds at normal speed.
export const BEATS = {
  none: 0,
  step: 160, // the game moving to the next step: a tick, not an event
  life: 300,
  card: 340, // a card changing zones — drawn, played, destroyed
  stack: 380, // something going on or coming off the stack
  turn: 700 // the table changing hands
}

// How long the computer appears to think before a real move, by what it is being
// asked. Choosing attackers is a bigger decision than answering a trigger, and
// looks wrong if it comes back instantly.
export const THINK = {
  priority: 520, // casting, activating, playing a land
  declareAttackers: 780,
  declareBlockers: 820,
  chooseTargets: 420,
  mulligan: 600,
  scry: 520,
  discard: 520,
  default: 460
}

// Named speeds. `instant` is the old behaviour — everything at once — and is
// what a player who finds any of this slow will want.
export const SPEEDS = { instant: 0, brisk: 0.6, normal: 1, relaxed: 1.6 }
export const SPEED_NAMES = Object.keys(SPEEDS)
export const DEFAULT_SPEED = 'normal'

export const speedFactor = (name) => (name in SPEEDS ? SPEEDS[name] : SPEEDS[DEFAULT_SPEED])

// A long burst gets faster as it goes: the first few things that happen are the
// ones worth dwelling on, and by the tenth nobody wants the full beat. Floors at
// a third of the beat so it never becomes a blur.
export function urgency(depth) {
  return Math.max(0.33, 1 - (depth || 0) * 0.09)
}

// The pause after a step of the given kind, `depth` steps into this burst.
export function beatFor(kind, depth = 0, speed = DEFAULT_SPEED) {
  const base = BEATS[kind] ?? 0
  if (!base) return 0
  const ms = base * urgency(depth) * speedFactor(speed)
  // Under about 60ms nothing reads as a separate frame, so it is not worth the
  // timer — the step runs straight into the next one.
  return ms < 60 ? 0 : Math.round(ms)
}

// The pause before the computer's own move.
export function thinkTime(pendingKind, speed = DEFAULT_SPEED) {
  const base = THINK[pendingKind] ?? THINK.default
  const ms = base * speedFactor(speed)
  return ms < 60 ? 0 : Math.round(ms)
}
