import { create } from 'zustand'
import { expandDeck, makeInstance, shuffle, uid, PHASES } from '../lib/gameCard.js'

const STORAGE_KEY = 'mtg-game'
const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command']

function emptyZones() {
  return { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [] }
}

function makePlayer(id, name, deckSlug, library, hand) {
  return {
    id,
    name: name || `Player ${id + 1}`,
    life: 20,
    counters: {}, // poison, energy, etc.
    deckSlug,
    zones: { ...emptyZones(), library, hand }
  }
}

// Which zone of a player currently holds an instance.
function findZone(player, iid) {
  for (const z of ZONES) if (player.zones[z].some((c) => c.iid === iid)) return z
  return null
}

// Immutably update one player by id.
function mapPlayer(players, pid, fn) {
  return players.map((p) => (p.id === pid ? fn(p) : p))
}

// Immutably update a single instance within whatever zone holds it.
function updateInstance(player, iid, fn) {
  const z = findZone(player, iid)
  if (!z) return player
  return {
    ...player,
    zones: { ...player.zones, [z]: player.zones[z].map((c) => (c.iid === iid ? fn(c) : c)) }
  }
}

export const useGame = create((set, get) => ({
  started: false,
  players: [makePlayer(0, 'Player 1', null, [], []), makePlayer(1, 'Player 2', null, [], [])],
  activePlayer: 0,
  turn: 1,
  phase: 'main1',
  cardsById: {}, // cardId -> Scryfall card object (for hover text / DFC detection)

  // ---- setup ----
  startGame: async ({ p0Slug, p1Slug }) => {
    const [r0, r1] = await Promise.all([window.api.loadDeck(p0Slug), window.api.loadDeck(p1Slug)])
    const insts0 = expandDeck(r0)
    const insts1 = expandDeck(r1)
    const ids = [...new Set([...insts0, ...insts1].map((i) => i.cardId))]
    const { cards } = await window.api.ensureCards(ids)
    const cardsById = Object.fromEntries(cards.map((c) => [c.id, c]))

    const lib0 = shuffle(insts0)
    const lib1 = shuffle(insts1)
    const hand0 = lib0.splice(0, 7)
    const hand1 = lib1.splice(0, 7)

    set({
      started: true,
      turn: 1,
      activePlayer: 0,
      phase: 'main1',
      cardsById,
      players: [
        makePlayer(0, r0.name, p0Slug, lib0, hand0),
        makePlayer(1, r1.name, p1Slug, lib1, hand1)
      ]
    })
  },

  newGame: () =>
    set({
      started: false,
      players: [
        makePlayer(0, 'Player 1', null, [], []),
        makePlayer(1, 'Player 2', null, [], [])
      ],
      activePlayer: 0,
      turn: 1,
      phase: 'main1',
      cardsById: {}
    }),

  // Restore an in-progress game from localStorage (called on mount).
  hydrate: async () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (!saved?.started) return
      set({
        started: saved.started,
        players: saved.players,
        activePlayer: saved.activePlayer,
        turn: saved.turn,
        phase: saved.phase
      })
      const ids = [
        ...new Set(
          saved.players
            .flatMap((p) => ZONES.flatMap((z) => p.zones[z]))
            .map((c) => c.cardId)
            .filter(Boolean)
        )
      ]
      if (ids.length) {
        const { cards } = await window.api.ensureCards(ids)
        set({ cardsById: Object.fromEntries(cards.map((c) => [c.id, c])) })
      }
    } catch {
      // ignore corrupt saved state
    }
  },

  // ---- card movement ----
  draw: (pid, n = 1) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => {
        const library = [...p.zones.library]
        const drawn = library.splice(0, n)
        return { ...p, zones: { ...p.zones, library, hand: [...p.zones.hand, ...drawn] } }
      })
    })),

  // Move an instance to another zone of the same player.
  // opts: { x, y } for battlefield placement; { toTop } / { toBottom } for library.
  moveCard: (pid, iid, toZone, opts = {}) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => {
        const from = findZone(p, iid)
        if (!from) return p
        const card = p.zones[from].find((c) => c.iid === iid)
        const zones = { ...p.zones, [from]: p.zones[from].filter((c) => c.iid !== iid) }

        // Tokens cease to exist when they leave the battlefield.
        if (card.token && from === 'battlefield' && toZone !== 'battlefield') {
          return { ...p, zones }
        }

        const nc = { ...card }
        if (toZone !== 'battlefield') {
          nc.tapped = false
          nc.counters = {}
          nc.faceDown = false
        } else {
          nc.x = opts.x ?? nc.x
          nc.y = opts.y ?? nc.y
        }
        if (opts.toTop) zones[toZone] = [nc, ...zones[toZone]]
        else zones[toZone] = [...zones[toZone], nc]
        return { ...p, zones }
      })
    })),

  setPosition: (pid, iid, x, y) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) =>
        updateInstance(p, iid, (c) => ({ ...c, x, y }))
      )
    })),

  toggleTap: (pid, iid) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) =>
        updateInstance(p, iid, (c) => ({ ...c, tapped: !c.tapped }))
      )
    })),

  untapAll: (pid) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => ({
        ...p,
        zones: {
          ...p.zones,
          battlefield: p.zones.battlefield.map((c) => ({ ...c, tapped: false }))
        }
      }))
    })),

  setCounter: (pid, iid, type, delta) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) =>
        updateInstance(p, iid, (c) => {
          const counters = { ...c.counters }
          const next = (counters[type] || 0) + delta
          if (next <= 0) delete counters[type]
          else counters[type] = next
          return { ...c, counters }
        })
      )
    })),

  flip: (pid, iid) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) =>
        updateInstance(p, iid, (c) => ({ ...c, flipped: !c.flipped }))
      )
    })),

  toggleFaceDown: (pid, iid) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) =>
        updateInstance(p, iid, (c) => ({ ...c, faceDown: !c.faceDown }))
      )
    })),

  shuffleLibrary: (pid) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => ({
        ...p,
        zones: { ...p.zones, library: shuffle(p.zones.library) }
      }))
    })),

  mulligan: (pid) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => {
        const library = shuffle([...p.zones.library, ...p.zones.hand])
        const hand = library.splice(0, 7)
        return { ...p, zones: { ...p.zones, library, hand } }
      })
    })),

  // Duplicate a battlefield instance as a token (copy), offset slightly.
  duplicate: (pid, iid) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => {
        const card = p.zones.battlefield.find((c) => c.iid === iid)
        if (!card) return p
        const copy = { ...card, iid: uid(), token: true, x: card.x + 24, y: card.y + 24 }
        return { ...p, zones: { ...p.zones, battlefield: [...p.zones.battlefield, copy] } }
      })
    })),

  // Create a token on the battlefield from a Scryfall card object.
  createToken: (pid, card) =>
    set((s) => {
      const inst = makeInstance(card.id, { token: true, x: 40, y: 40 })
      return {
        cardsById: { ...s.cardsById, [card.id]: card },
        players: mapPlayer(s.players, pid, (p) => ({
          ...p,
          zones: { ...p.zones, battlefield: [...p.zones.battlefield, inst] }
        }))
      }
    }),

  // ---- player state ----
  setLife: (pid, delta) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => ({ ...p, life: p.life + delta }))
    })),

  setLifeValue: (pid, value) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => ({ ...p, life: value }))
    })),

  setPlayerCounter: (pid, type, delta) =>
    set((s) => ({
      players: mapPlayer(s.players, pid, (p) => {
        const counters = { ...p.counters }
        const next = (counters[type] || 0) + delta
        if (next <= 0) delete counters[type]
        else counters[type] = next
        return { ...p, counters }
      })
    })),

  // ---- turn / phase (light assist) ----
  nextPhase: () =>
    set((s) => {
      const i = PHASES.indexOf(s.phase)
      if (i < PHASES.length - 1) return { phase: PHASES[i + 1] }
      return {} // at 'end' — use Pass turn to advance
    }),

  passTurn: () => {
    const s = get()
    const next = s.activePlayer === 0 ? 1 : 0
    s.untapAll(next)
    s.draw(next, 1)
    set({ activePlayer: next, turn: s.turn + 1, phase: 'main1' })
  }
}))

// Persist the in-progress game (not cardsById — it's re-fetched on hydrate).
useGame.subscribe((s) => {
  try {
    if (!s.started) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        started: s.started,
        players: s.players,
        activePlayer: s.activePlayer,
        turn: s.turn,
        phase: s.phase
      })
    )
  } catch {
    // ignore quota / serialization errors
  }
})
