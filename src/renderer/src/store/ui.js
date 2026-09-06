import { create } from 'zustand'

// Shell state the app frame needs but should not import a whole subsystem to
// learn. Keeping this separate is what lets App.jsx stay out of the rules
// engine's dependency graph, so Play can be a lazily loaded chunk.
export const useUi = create((set) => ({
  // True while a game is actually being played, which hides the nav bar.
  inGame: false,
  setInGame: (on) => set({ inGame: !!on })
}))
