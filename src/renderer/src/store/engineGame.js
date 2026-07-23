import { create } from 'zustand'
import { GameEngine, projectGame } from '@engine/index.mjs'
import { createObject } from '@engine/state.mjs'

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

// MTGO-style default stops: each player stops in their (and the opponent's) main
// phases so they can act. Everything else auto-passes unless a stop is added.
const defaultStops = () => ({ 0: new Set(['main1', 'main2']), 1: new Set(['main1', 'main2']) })

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

// Engine-backed play mode. The GameEngine instance is held outside React (it
// mutates in place and holds non-serializable RNG); after every choice we
// rebuild an immutable projection (`view`) that the UI renders from.
export const useEngineGame = create((set, get) => ({
  started: false,
  view: null,
  error: null,
  stops: defaultStops(),
  _engine: null,

  // decks: [{ name, cards: [scryfallCard…] }, { name, cards }]
  startEngineGame: ({ decks }) => {
    const engine = new GameEngine({
      seed: 'game-' + Date.now(),
      players: decks.map((d) => ({ name: d.name, deck: d.cards }))
    })
    engine.start()
    settle(engine, get().stops)
    set({ started: true, _engine: engine, view: projectGame(engine), error: null })
  },

  choose: (answer) => {
    const engine = get()._engine
    if (!engine) return
    try {
      engine.choose(answer)
      settle(engine, get().stops)
      set({ view: projectGame(engine), error: null })
    } catch (err) {
      // Illegal action (shouldn't normally be reachable from the UI) — surface
      // it without corrupting the game.
      set({ error: String(err?.message || err) })
    }
  },

  // Toggle a player's stop for a step. Applies immediately: if the change means
  // the current priority no longer needs a stop, fast-forward past it.
  toggleStop: (pid, step) => {
    const stops = { 0: new Set(get().stops[0]), 1: new Set(get().stops[1]) }
    if (stops[pid].has(step)) stops[pid].delete(step)
    else stops[pid].add(step)
    const engine = get()._engine
    if (engine) settle(engine, stops)
    set({ stops, view: engine ? projectGame(engine) : get().view })
  },

  // Put a token onto a player's battlefield from a Scryfall token card. Treated
  // as a sanctioned manual insertion (hybrid fallback); the engine derives the
  // token's characteristics from the card and cleans it up when it leaves play.
  createToken: (pid, card) => {
    const engine = get()._engine
    if (!engine) return
    const s = engine.state
    const o = createObject(s, card, pid)
    o.token = true
    o.zoneName = 'battlefield'
    o.controller = pid
    o.timestamp = ++s.tsCounter
    if (o.printed.types.includes('Creature')) o.status.summoningSick = true
    s.zones.battlefield.push(o.oid)
    set({ view: projectGame(engine) })
  },

  endGame: () => set({ started: false, _engine: null, view: null, error: null })
}))
