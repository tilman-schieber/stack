// Deterministic seeded RNG so shuffles and whole games are reproducible in
// headless tests. Small, dependency-free (mulberry32 + a string hash).

function hashSeed(seed) {
  // Accept numbers or strings; fold into a 32-bit integer.
  if (typeof seed === 'number') return seed >>> 0
  let h = 2166136261 >>> 0
  const s = String(seed ?? 'stack')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Returns a stateful RNG: rng() → float in [0,1), plus helpers.
export function makeRng(seed) {
  let a = hashSeed(seed)
  const rng = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  rng.int = (n) => Math.floor(rng() * n) // integer in [0, n)
  // Fisher–Yates using this RNG; returns a new array.
  rng.shuffle = (arr) => {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      const j = rng.int(i + 1)
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  return rng
}
