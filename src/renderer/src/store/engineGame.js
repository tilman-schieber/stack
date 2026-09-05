import { create } from 'zustand'
import { GameEngine, projectGame, botChoose, botFallback, BOT_STOPS } from '@engine/index.mjs'

const BOT_DELAY_MS = 450 // a beat between computer moves so they can be followed

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

// Magic Online-style stops: each player marks the steps at which they want
// priority, separately for their own turn and for opponents' turns. Defaults:
// your main phases (to cast sorcery-speed spells), plus the opponent's declare
// attackers and end step (to act at instant speed after attacks are known and
// before the turn ends). One Set per seat, holding step names for the player's
// own turn and "opp:<step>" for opponents' turns.
export const stopKey = (step, oppTurn) => (oppTurn ? 'opp:' + step : step)
export const DEFAULT_STOPS = ['main1', 'main2', 'opp:declareAttackers', 'opp:end']
const defaultStops = (n = 2) => {
  const s = {}
  for (let i = 0; i < n; i++) s[i] = new Set(DEFAULT_STOPS)
  return s
}

// Yields (Magic Online's F-keys), per seat and for the current turn only:
//   'turn'     F4 — pass every remaining stop this turn, but still stop when an
//              opponent puts something on the stack you could respond to (the
//              yield is cancelled when that happens).
//   'all'      F6 — pass everything this turn, responses included. Real decisions
//              (attackers, blockers, discards, choices) still come to you.
export const YIELD_KINDS = ['turn', 'all']

// Auto-pass through priority the way Magic Online does. A player is handed
// priority when they can do something (tapping for mana never counts) and either
//   - an opponent's spell or ability is on top of the stack — you can always
//     respond, regardless of stops (unless you yielded the whole turn, F6), or
//   - they have a stop at this step and haven't yielded the turn.
// Everything else passes automatically. Real decisions (attackers/blockers/
// discard/game over) are separate pending kinds and always stop.
// A computer seat sees every priority window; when its answer is simply to
// pass, that happens here at once (no delay), so only its real moves take time.
function settle(engine, stops, botSeats = [], yields = {}) {
  let guard = 0
  while (engine.state.pending?.kind === 'priority' && guard++ < 4000) {
    const s = engine.state
    const p = s.pending
    const me = p.player
    const canAct = (p.actions || []).some((a) => a.type !== 'pass' && !a.mana)
    const stack = s.zones.stack || []
    const top = stack.length ? s.objects[stack[stack.length - 1]] : null
    const respondable = !!top && top.controller !== me
    const y = yields[me]?.turn === s.turnNumber ? yields[me].kind : null
    const stopHere = stops[me]?.has(stopKey(s.step, s.activePlayer !== me))
    let give = false
    if (canAct) {
      if (y === 'all') give = false
      else if (respondable) {
        give = true
        if (y === 'turn') delete yields[me] // something happened: F4 is cancelled
      } else give = !y && stopHere
    }
    if (give) {
      if (!botSeats.includes(me)) break // hand this player priority
      let ans = null
      try {
        ans = botChoose(engine, me)
      } catch {
        ans = { type: 'pass' }
      }
      if (ans && ans.type !== 'pass') break // a real move: the timer plays it visibly
      engine.choose({ type: 'pass' })
      continue
    }
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
  notice: null, // why the last game ended unexpectedly (disconnect etc.), shown on the setup screen
  mode: 'local',
  netSeat: 0, // which player id the local human controls
  botSeats: [], // seats played by the computer (local mode)
  stops: defaultStops(),
  yields: {}, // per seat: { kind: 'turn' | 'all', turn } — see YIELD_KINDS
  _engine: null,
  _transport: null,
  _botTimer: null,

  // ---- local hot-seat / vs. computer ---------------------------------------
  // decks: [{ name, cards: [scryfallCard…], commander? }, …]; format: null | 'commander';
  // bots: seat ids the computer plays (their hands are hidden like an opponent's).
  startEngineGame: ({ decks, format = null, bots = [] }) => {
    const engine = new GameEngine({
      seed: 'game-' + Date.now(),
      format,
      players: decks.map((d) => ({ name: d.name, deck: d.cards, commander: format === 'commander' ? d.commander : null }))
    })
    engine.start()
    const stops = defaultStops(decks.length)
    for (const b of bots) stops[b] = new Set(BOT_STOPS) // the bot sees every window; passes are instant
    const yields = {}
    settle(engine, stops, bots, yields)
    set({ started: true, mode: 'local', netSeat: 0, botSeats: bots, stops, yields, _engine: engine, error: null, notice: null })
    get()._commit()
  },

  // Let the computer take its decisions, one every BOT_DELAY_MS, until a human
  // must act. Scheduled after every commit; harmless when it's not a bot's turn.
  _scheduleBot: () => {
    const { _engine, botSeats, _botTimer } = get()
    if (!_engine || !botSeats.length) return
    const pid = _engine.state.pending?.player
    if (pid == null || !botSeats.includes(pid) || _engine.state.pending.kind === 'gameOver') return
    if (_botTimer) clearTimeout(_botTimer)
    const timer = setTimeout(() => {
      set({ _botTimer: null })
      const e = get()._engine
      if (e !== _engine || !e.state.pending || e.state.pending.player !== pid) return
      try {
        e.choose(botChoose(e, pid))
      } catch (err) {
        console.warn('bot answer rejected, falling back:', err)
        try {
          e.choose(botFallback(e, pid))
        } catch (err2) {
          console.error('bot fallback rejected — conceding for it:', err2)
          e.concede(pid)
        }
      }
      settle(e, get().stops, get().botSeats, get().yields)
      get()._commit()
    }, BOT_DELAY_MS)
    set({ _botTimer: timer })
  },

  clearNotice: () => set({ notice: null }),

  // ---- networked: host (owns the engine, seat 0) ---------------------------
  hostGame: ({ myDeck, transport }) => {
    transport.onMessage = (msg) => get()._onHostMessage(msg, myDeck)
    transport.onClose = () => get().endGame(LOST_CONNECTION)
    set({ mode: 'host', netSeat: 0, _transport: transport, stops: defaultStops(2), yields: {}, started: false, notice: null })
  },

  // ---- networked: guest (no engine, seat 1) --------------------------------
  guestGame: ({ myDeck, transport }) => {
    transport.onMessage = (msg) => get()._onGuestMessage(msg)
    transport.onClose = () => get().endGame(LOST_CONNECTION)
    transport.onOpen = () => transport.send({ t: 'deck', name: myDeck.name, cards: myDeck.cards, commander: myDeck.commander || null })
    // If the channel is already open (connected before this ran), send now.
    if (transport.channel?.readyState === 'open')
      transport.send({ t: 'deck', name: myDeck.name, cards: myDeck.cards, commander: myDeck.commander || null })
    set({ mode: 'guest', netSeat: 1, _transport: transport, started: false, notice: null })
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
    if (view?.pending && get().botSeats.includes(view.pending.player)) return // the computer's decision
    try {
      _engine.choose(answer)
      settle(_engine, stops, get().botSeats, get().yields)
      get()._commit()
    } catch (err) {
      set({ error: String(err?.message || err) })
    }
  },

  // Push the fresh view locally and (host) the redacted view to the guest. With a
  // computer opponent the human's seat is the viewer, so the bot's hand is hidden.
  _commit: () => {
    const { _engine, mode, _transport, botSeats, netSeat } = get()
    const viewer = mode === 'host' ? 0 : botSeats.length ? netSeat : null
    set({ view: projectGame(_engine, viewer), error: null, yields: { ...get().yields } })
    if (mode === 'host') _transport?.send({ t: 'view', view: projectGame(_engine, 1) })
    get()._scheduleBot()
  },

  _onHostMessage: (msg, myDeck) => {
    const { _engine, stops } = get()
    if (msg.t === 'deck') {
      if (_engine) return // the game is already running; a second deck can't replace it
      // Online: it's a Commander game when both decks bring a commander.
      const format = myDeck.commander && msg.commander ? 'commander' : null
      const engine = new GameEngine({
        seed: 'game-' + Date.now(),
        format,
        players: [
          { name: myDeck.name, deck: myDeck.cards, commander: format ? myDeck.commander : null },
          { name: msg.name, deck: msg.cards, commander: format ? msg.commander : null }
        ]
      })
      engine.start()
      settle(engine, stops, [], get().yields)
      set({ started: true, _engine: engine })
      get()._commit()
    } else if (msg.t === 'choose') {
      if (!_engine || _engine.state.pending?.player !== 1) return // only the guest's decisions
      try {
        _engine.choose(msg.answer)
        settle(_engine, get().stops, [], get().yields)
        get()._commit()
      } catch {
        /* illegal remote choice: ignore, state is untouched */
      }
    } else if (msg.t === 'concede') {
      if (!_engine) return
      _engine.concede(1)
      settle(_engine, get().stops, [], get().yields)
      get()._commit()
    } else if (msg.t === 'stops') {
      const next = { ...get().stops, 1: new Set(msg.steps) }
      if (_engine) settle(_engine, next, [], get().yields)
      set({ stops: next })
      get()._commit()
    } else if (msg.t === 'yield') {
      // The guest yielded (or cancelled a yield) for this turn.
      const yields = { ...get().yields }
      if (msg.kind && YIELD_KINDS.includes(msg.kind) && _engine) yields[1] = { kind: msg.kind, turn: _engine.state.turnNumber }
      else delete yields[1]
      if (_engine) settle(_engine, get().stops, [], yields)
      set({ yields })
      get()._commit()
    } else if (msg.t === 'bye') {
      get().endGame(get().started ? 'Your opponent left the game.' : 'Your opponent cancelled.')
    }
  },

  _onGuestMessage: (msg) => {
    if (msg.t === 'view') set({ started: true, view: msg.view, error: null })
    else if (msg.t === 'bye') get().endGame(get().started ? 'The host ended the game.' : 'The host cancelled.')
  },

  // Toggle a stop for the local seat (`oppTurn`: on opponents' turns rather than
  // the player's own). Local mode can toggle either human seat.
  toggleStop: (pid, step, oppTurn = false) => {
    const { mode, netSeat, _engine, _transport, botSeats } = get()
    if (mode !== 'local' && pid !== netSeat) return // online: only your own stops
    if (botSeats.includes(pid)) return
    const key = stopKey(step, oppTurn)
    const stops = {}
    for (const k of Object.keys(get().stops)) stops[k] = new Set(get().stops[k])
    if (stops[pid].has(key)) stops[pid].delete(key)
    else stops[pid].add(key)
    if (mode === 'guest') {
      _transport?.send({ t: 'stops', steps: [...stops[pid]] })
      set({ stops })
      return
    }
    if (_engine) settle(_engine, stops, get().botSeats, get().yields)
    set({ stops })
    if (_engine) get()._commit()
  },

  // Yield for the rest of this turn (`kind`: 'turn' = F4, 'all' = F6) or cancel
  // with null (F3). Online the guest's yield is applied by the host's engine.
  setYield: (kind) => {
    const { mode, netSeat, _engine, _transport } = get()
    if (mode === 'guest') {
      _transport?.send({ t: 'yield', kind: kind || null })
      const yields = { ...get().yields }
      if (kind) yields[netSeat] = { kind, turn: get().view?.turnNumber ?? 0 }
      else delete yields[netSeat]
      set({ yields })
      return
    }
    if (!_engine) return
    const yields = { ...get().yields }
    if (kind) yields[netSeat] = { kind, turn: _engine.state.turnNumber }
    else delete yields[netSeat]
    settle(_engine, get().stops, get().botSeats, yields)
    set({ yields })
    get()._commit()
  },

  // Concede as a game action (104.3a): the local seat leaves the game and the
  // engine decides the outcome (in a 2-player game the opponent wins). Online
  // the game-over screen then shows on both sides; locally `endGame` is the exit.
  concede: () => {
    const { mode, _engine, _transport, netSeat, stops } = get()
    if (mode === 'guest') {
      _transport?.send({ t: 'concede' })
      return
    }
    if (!_engine) return
    _engine.concede(netSeat)
    settle(_engine, stops, get().botSeats, get().yields)
    get()._commit()
  },

  // End the game (concede / exit / connection lost). `reason`, if given, is shown
  // on the setup screen so an unexpected end isn't silent.
  endGame: (reason = null) => {
    const { _transport, _botTimer } = get()
    if (_botTimer) clearTimeout(_botTimer)
    if (_transport) {
      // Detach first so closing the channel doesn't re-enter endGame with a
      // "connection lost" notice of its own.
      _transport.onClose = null
      _transport.onMessage = null
      try {
        _transport.send({ t: 'bye' })
        _transport.close()
      } catch {
        /* ignore */
      }
    }
    set({
      started: false,
      mode: 'local',
      netSeat: 0,
      _engine: null,
      _transport: null,
      _botTimer: null,
      botSeats: [],
      yields: {},
      view: null,
      error: null,
      notice: typeof reason === 'string' ? reason : null
    })
  }
}))

const LOST_CONNECTION = 'Connection lost — the other player disconnected.'
