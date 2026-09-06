import { create } from 'zustand'
import { GameEngine, projectGame, botChoose, botFallback, BOT_STOPS } from '@engine/index.mjs'
import { priorityDecision, stopKey, DEFAULT_STOPS, YIELD_KINDS } from '@engine/priority.mjs'

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

// Stops, yields and holds — see src/shared/engine/priority.mjs for the rules.
// Stops: one Set per seat, step names for the player's own turn and
// "opp:<step>" for opponents' turns. Yields: per seat, for one turn ('turn' = F4,
// 'all' = F6). Holds: per seat, keep priority after your next spell or ability.
export { stopKey, DEFAULT_STOPS, YIELD_KINDS }
const defaultStops = (n = 2) => {
  const s = {}
  for (let i = 0; i < n; i++) s[i] = new Set(DEFAULT_STOPS)
  return s
}

// Auto-pass through priority windows the way Magic Online does, handing one to a
// player only when priorityDecision says so. A computer seat sees every window;
// when its answer is simply to pass, that happens here at once (no delay), so
// only its real moves take time. `yields` and `holds` are updated in place when
// a decision consumes them (F4 cancelled by a response; a hold used up).
function settle(engine, stops, botSeats = [], yields = {}, holds = {}) {
  let guard = 0
  while (engine.state.pending?.kind === 'priority' && guard++ < 4000) {
    const me = engine.state.pending.player
    const d = priorityDecision(engine.state, stops[me], yields[me], !!holds[me])
    if (d.cancelYield) delete yields[me]
    if (d.consumeHold) delete holds[me]
    if (d.give) {
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
  holds: {}, // per seat: true while a hold-priority request is outstanding
  match: null, // best-of-N match state: { bestOf, wins, game, decks, format, bots, over }
  sideboarding: false, // between games of a match
  _engine: null,
  _transport: null,
  _botTimer: null,

  // ---- local hot-seat / vs. computer ---------------------------------------
  // decks: [{ name, cards: [scryfallCard…], sideboard?, commander? }, …];
  // format: null | 'commander'; bots: seat ids the computer plays (their hands
  // are hidden like an opponent's). `bestOf` (3) plays a match with sideboarding
  // between games; `chooser` is the seat that picks play/draw (games 2+, 103.6).
  startEngineGame: ({ decks, format = null, bots = [], bestOf = 1, chooser = null }) => {
    const engine = new GameEngine({
      seed: 'game-' + Date.now(),
      format,
      playDrawChooser: chooser ?? undefined,
      players: decks.map((d) => ({ name: d.name, deck: d.cards, commander: format === 'commander' ? d.commander : null }))
    })
    engine.start()
    const stops = defaultStops(decks.length)
    for (const b of bots) stops[b] = new Set(BOT_STOPS) // the bot sees every window; passes are instant
    const yields = {}
    const holds = {}
    settle(engine, stops, bots, yields, holds)
    const prior = get().match
    // A match keeps the decks (with sideboards) and the running score across games.
    const match =
      bestOf > 1 || prior
        ? {
            bestOf: prior?.bestOf ?? bestOf,
            wins: prior?.wins ?? decks.map(() => 0),
            game: prior ? prior.game + 1 : 1,
            decks,
            format,
            bots,
            recorded: false,
            over: false
          }
        : null
    set({ started: true, mode: 'local', netSeat: 0, botSeats: bots, stops, yields, holds, match, sideboarding: false, _engine: engine, error: null, notice: null })
    get()._commit()
  },

  // A game of a match has ended: record it, and either finish the match or open
  // sideboarding for the next game.
  _recordMatchGame: () => {
    const { match, view } = get()
    if (!match || match.recorded || view?.pending?.kind !== 'gameOver') return
    const wins = [...match.wins]
    const winner = view.pending.winner
    if (Number.isInteger(winner) && wins[winner] != null) wins[winner]++
    const need = Math.floor(match.bestOf / 2) + 1
    const over = wins.some((w) => w >= need) || match.game >= match.bestOf
    set({ match: { ...match, wins, recorded: true, over, lastWinner: Number.isInteger(winner) ? winner : null } })
  },

  // Between games: open / close the sideboarding screen.
  openSideboard: () => set({ sideboarding: true }),

  // Start the next game of the match with the (re-sideboarded) decks. The loser
  // of the last game chooses to play or draw (103.6).
  nextGame: (decks) => {
    const { match, _engine, _botTimer } = get()
    if (!match) return
    if (_botTimer) clearTimeout(_botTimer)
    void _engine
    const loser = match.lastWinner == null ? 0 : decks.findIndex((_, i) => i !== match.lastWinner)
    set({ sideboarding: false, _engine: null, view: null })
    get().startEngineGame({ decks, format: match.format, bots: match.bots, chooser: loser < 0 ? 0 : loser })
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
      settle(e, get().stops, get().botSeats, get().yields, get().holds)
      get()._commit()
    }, BOT_DELAY_MS)
    set({ _botTimer: timer })
  },

  clearNotice: () => set({ notice: null }),

  // ---- networked: host (owns the engine, seat 0) ---------------------------
  hostGame: ({ myDeck, transport }) => {
    transport.onMessage = (msg) => get()._onHostMessage(msg, myDeck)
    transport.onClose = () => get().endGame(LOST_CONNECTION)
    set({ mode: 'host', netSeat: 0, _transport: transport, stops: defaultStops(2), yields: {}, holds: {}, started: false, notice: null })
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
      settle(_engine, stops, get().botSeats, get().yields, get().holds)
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
    set({ view: projectGame(_engine, viewer), error: null, yields: { ...get().yields }, holds: { ...get().holds } })
    if (mode === 'host') _transport?.send({ t: 'view', view: projectGame(_engine, 1) })
    get()._recordMatchGame()
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
      settle(engine, stops, [], get().yields, get().holds)
      set({ started: true, _engine: engine })
      get()._commit()
    } else if (msg.t === 'choose') {
      if (!_engine || _engine.state.pending?.player !== 1) return // only the guest's decisions
      try {
        _engine.choose(msg.answer)
        settle(_engine, get().stops, [], get().yields, get().holds)
        get()._commit()
      } catch {
        /* illegal remote choice: ignore, state is untouched */
      }
    } else if (msg.t === 'concede') {
      if (!_engine) return
      _engine.concede(1)
      settle(_engine, get().stops, [], get().yields, get().holds)
      get()._commit()
    } else if (msg.t === 'stops') {
      const next = { ...get().stops, 1: new Set(msg.steps) }
      if (_engine) settle(_engine, next, [], get().yields, get().holds)
      set({ stops: next })
      get()._commit()
    } else if (msg.t === 'yield') {
      // The guest yielded (or cancelled a yield) for this turn.
      const yields = { ...get().yields }
      if (msg.kind && YIELD_KINDS.includes(msg.kind) && _engine) yields[1] = { kind: msg.kind, turn: _engine.state.turnNumber }
      else delete yields[1]
      if (_engine) settle(_engine, get().stops, [], yields, get().holds)
      set({ yields })
      get()._commit()
    } else if (msg.t === 'hold') {
      const holds = { ...get().holds }
      if (msg.on) holds[1] = true
      else delete holds[1]
      if (_engine) settle(_engine, get().stops, [], get().yields, holds)
      set({ holds })
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
    if (_engine) settle(_engine, stops, get().botSeats, get().yields, get().holds)
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
    settle(_engine, get().stops, get().botSeats, yields, get().holds)
    set({ yields })
    get()._commit()
  },

  // Keep priority after your next spell or ability (to respond to it yourself);
  // used up the first time it applies. Online the host's engine applies it.
  setHold: (on) => {
    const { mode, netSeat, _engine, _transport } = get()
    const holds = { ...get().holds }
    if (on) holds[netSeat] = true
    else delete holds[netSeat]
    if (mode === 'guest') {
      _transport?.send({ t: 'hold', on: !!on })
      set({ holds })
      return
    }
    if (_engine) settle(_engine, get().stops, get().botSeats, get().yields, holds)
    set({ holds })
    if (_engine) get()._commit()
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
    settle(_engine, stops, get().botSeats, get().yields, get().holds)
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
      holds: {},
      match: null,
      sideboarding: false,
      view: null,
      error: null,
      notice: typeof reason === 'string' ? reason : null
    })
  }
}))

const LOST_CONNECTION = 'Connection lost — the other player disconnected.'
