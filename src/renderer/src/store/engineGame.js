import { create } from 'zustand'
import { GameEngine, projectGame } from '@engine/index.mjs'

// Steps that grant priority (where a stop can be set). Untap and cleanup never
// grant priority, so they are omitted.
export const PRIORITY_STEPS = [
  'upkeep',
  'draw',
  'main1',
  'beginCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endCombat',
  'main2',
  'end'
]

// MTGO-style default stops: each player stops in the main phases so they can act.
// Everything else auto-passes unless a stop is added. One Set per seat.
const defaultStops = (n = 2) => {
  const s = {}
  for (let i = 0; i < n; i++) s[i] = new Set(['main1', 'main2'])
  return s
}

// Auto-pass through priority the way Magic Online does: pass automatically unless
// the player both *can* act and has a stop set for the current step. Windows
// where the only legal move is pass always auto-pass. Stops at real decisions
// (attackers/blockers/discard/game over) and at any step a player has stopped on.
function settle(engine, stops) {
  let guard = 0
  while (engine.state.pending?.kind === 'priority' && guard++ < 4000) {
    const p = engine.state.pending
    const canAct = (p.actions?.length || 0) > 1
    const stopHere = stops[p.player]?.has(engine.state.step)
    if (canAct && stopHere) break // hand this player priority
    engine.choose({ type: 'pass' })
  }
}

// Engine-backed play mode. Three modes share one interface:
//   local — one in-renderer engine drives all seats (hot-seat).
//   host  — this app owns the engine; it applies its own and the guest's choices,
//           and pushes each side a per-viewer redacted projection over the wire.
//   guest — no engine; renders the redacted view the host pushes and sends its
//           choices back. See src/renderer/src/net/webrtcTransport.js.
// The GameEngine (host/local) is held outside React (it mutates in place and holds
// a non-serializable RNG); after every choice we rebuild an immutable `view`.
export const useEngineGame = create((set, get) => ({
  started: false,
  view: null,
  error: null,
  mode: 'local',
  netSeat: 0, // which player id the local human controls
  stops: defaultStops(),
  _engine: null,
  _transport: null,

  // ---- local hot-seat ------------------------------------------------------
  // decks: [{ name, cards: [scryfallCard…] }, { name, cards }]
  startEngineGame: ({ decks }) => {
    const engine = new GameEngine({
      seed: 'game-' + Date.now(),
      players: decks.map((d) => ({ name: d.name, deck: d.cards }))
    })
    engine.start()
    settle(engine, get().stops)
    set({ started: true, mode: 'local', netSeat: 0, _engine: engine, view: projectGame(engine), error: null })
  },

  // ---- networked: host (owns the engine, seat 0) ---------------------------
  hostGame: ({ myDeck, transport }) => {
    transport.onMessage = (msg) => get()._onHostMessage(msg, myDeck)
    transport.onClose = () => get().endGame()
    set({ mode: 'host', netSeat: 0, _transport: transport, stops: defaultStops(2), started: false })
  },

  // ---- networked: guest (no engine, seat 1) --------------------------------
  guestGame: ({ myDeck, transport }) => {
    transport.onMessage = (msg) => get()._onGuestMessage(msg)
    transport.onClose = () => get().endGame()
    transport.onOpen = () => transport.send({ t: 'deck', name: myDeck.name, cards: myDeck.cards })
    // If the channel is already open (connected before this ran), send now.
    if (transport.channel?.readyState === 'open')
      transport.send({ t: 'deck', name: myDeck.name, cards: myDeck.cards })
    set({ mode: 'guest', netSeat: 1, _transport: transport, started: false })
  },

  choose: (answer) => {
    const { mode, _engine, _transport, view, stops } = get()
    if (mode === 'guest') {
      _transport?.send({ t: 'choose', answer }) // host applies it authoritatively
      return
    }
    if (!_engine) return
    // Host may only act on its own decisions (seat 0); the guest's come over the wire.
    if (mode === 'host' && view?.pending && view.pending.player !== 0) return
    try {
      _engine.choose(answer)
      settle(_engine, stops)
      get()._commit()
    } catch (err) {
      set({ error: String(err?.message || err) })
    }
  },

  // Push the fresh view locally and (host) the redacted view to the guest.
  _commit: () => {
    const { _engine, mode, _transport } = get()
    set({ view: projectGame(_engine, mode === 'host' ? 0 : null), error: null })
    if (mode === 'host') _transport?.send({ t: 'view', view: projectGame(_engine, 1) })
  },

  _onHostMessage: (msg, myDeck) => {
    const { _engine, stops } = get()
    if (msg.t === 'deck') {
      const engine = new GameEngine({
        seed: 'game-' + Date.now(),
        players: [
          { name: myDeck.name, deck: myDeck.cards },
          { name: msg.name, deck: msg.cards }
        ]
      })
      engine.start()
      settle(engine, stops)
      set({ started: true, _engine: engine })
      get()._commit()
    } else if (msg.t === 'choose') {
      if (!_engine || _engine.state.pending?.player !== 1) return // only the guest's decisions
      try {
        _engine.choose(msg.answer)
        settle(_engine, get().stops)
        get()._commit()
      } catch {
        /* illegal remote choice: ignore, state is untouched */
      }
    } else if (msg.t === 'stops') {
      const next = { ...get().stops, 1: new Set(msg.steps) }
      if (_engine) settle(_engine, next)
      set({ stops: next })
      get()._commit()
    } else if (msg.t === 'bye') {
      get().endGame()
    }
  },

  _onGuestMessage: (msg) => {
    if (msg.t === 'view') set({ started: true, view: msg.view, error: null })
    else if (msg.t === 'bye') get().endGame()
  },

  // Toggle a stop for the local seat. Local mode can toggle either seat.
  toggleStop: (pid, step) => {
    const { mode, netSeat, _engine, _transport } = get()
    if (mode !== 'local' && pid !== netSeat) return // online: only your own stops
    const stops = {}
    for (const k of Object.keys(get().stops)) stops[k] = new Set(get().stops[k])
    if (stops[pid].has(step)) stops[pid].delete(step)
    else stops[pid].add(step)
    if (mode === 'guest') {
      _transport?.send({ t: 'stops', steps: [...stops[pid]] })
      set({ stops })
      return
    }
    if (_engine) settle(_engine, stops)
    set({ stops })
    if (_engine) get()._commit()
  },

  endGame: () => {
    const { _transport } = get()
    try {
      _transport?.send({ t: 'bye' })
      _transport?.close()
    } catch {
      /* ignore */
    }
    set({ started: false, mode: 'local', netSeat: 0, _engine: null, _transport: null, view: null, error: null })
  }
}))
