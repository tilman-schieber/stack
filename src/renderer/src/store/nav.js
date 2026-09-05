import { create } from 'zustand'

// Which top-level view is showing, plus the small bits of intent one view hands
// the next: the deck to preselect in the game setup, and whether the deck
// manager should open with its import panel expanded.
export const useNav = create((set) => ({
  view: 'home', // 'home' | 'decks' | 'build' | 'play'
  playDeck: null, // deck key ("example:<slug>" / "saved:<slug>") to preselect as Player 1
  intent: null, // 'import' opens the import panel in Decks; consumed on arrival

  go: (view, intent = null) => set({ view, intent }),
  // Jump to Play with a deck preselected.
  play: (deckKey) => set({ view: 'play', playDeck: deckKey || null, intent: null }),
  consumeIntent: () => set({ intent: null })
}))
