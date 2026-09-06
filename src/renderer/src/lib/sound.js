// Table sounds: a card landing, a permanent tapping, damage.
//
// Synthesised rather than sampled — three short envelopes over an oscillator and
// a burst of noise — so there are no audio files to ship, license or cache, and
// nothing to download before the first sound plays. Off unless the user turns it
// on in Settings.
//
// Browsers refuse to start an AudioContext before the user has interacted with
// the page, so the context is created on the first sound and resumed if it was
// born suspended. Every failure here is swallowed: a game must not break because
// audio would not start.

let ctx = null
let enabled = false

export function setSoundEnabled(on) {
  enabled = !!on
}
export function soundEnabled() {
  return enabled
}

function audio() {
  if (!enabled) return null
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext
      if (!Ctor) return null
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    return ctx.state === 'closed' ? null : ctx
  } catch {
    return null
  }
}

// A short band-limited noise burst: the paper part of every one of these sounds.
function noise(ac, { at, duration, gain, freq, q = 1 }) {
  const frames = Math.max(1, Math.floor(ac.sampleRate * duration))
  const buf = ac.createBuffer(1, frames, ac.sampleRate)
  const data = buf.getChannelData(0)
  // A fixed pseudo-random sequence: the same card always sounds the same.
  let seed = 0x2f6e2b1
  for (let i = 0; i < frames; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    data[i] = (seed / 0x3fffffff - 1) * (1 - i / frames)
  }
  const src = ac.createBufferSource()
  src.buffer = buf
  const filter = ac.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = freq
  filter.Q.value = q
  const amp = ac.createGain()
  amp.gain.setValueAtTime(gain, at)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  src.connect(filter).connect(amp).connect(ac.destination)
  src.start(at)
  src.stop(at + duration)
}

// A short pitched body, for the weight under a sound.
function tone(ac, { at, duration, gain, from, to, type = 'sine' }) {
  const osc = ac.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, at)
  osc.frequency.exponentialRampToValueAtTime(to, at + duration)
  const amp = ac.createGain()
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.008)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  osc.connect(amp).connect(ac.destination)
  osc.start(at)
  osc.stop(at + duration)
}

const VOICES = {
  // A card coming to rest on the table: card stock, then a soft low body.
  card(ac, at) {
    noise(ac, { at, duration: 0.075, gain: 0.16, freq: 2600, q: 0.7 })
    tone(ac, { at, duration: 0.1, gain: 0.05, from: 220, to: 90 })
  },
  // A permanent turning sideways: shorter, drier, higher.
  tap(ac, at) {
    noise(ac, { at, duration: 0.045, gain: 0.11, freq: 4200, q: 1.4 })
  },
  // Damage: a thud with a downward pitch, enough to notice without a jolt.
  damage(ac, at) {
    tone(ac, { at, duration: 0.19, gain: 0.13, from: 190, to: 55, type: 'triangle' })
    noise(ac, { at, duration: 0.09, gain: 0.09, freq: 900, q: 0.6 })
  }
}

// Never more than this many of one voice at once — a turn that moves eight cards
// should not sound like eight cards.
const MAX_STACKED = 3

export function play(voice, count = 1) {
  const ac = audio()
  const make = VOICES[voice]
  if (!ac || !make) return
  try {
    const n = Math.min(count, MAX_STACKED)
    for (let i = 0; i < n; i++) make(ac, ac.currentTime + i * 0.055)
  } catch {
    /* an audio failure is never worth interrupting a game for */
  }
}
