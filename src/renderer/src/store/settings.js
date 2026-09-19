import { create } from 'zustand'

// App-wide settings, mirrored from the main process (persisted there).
export const useSettings = create((set, get) => ({
  loaded: false,
  ignoreGoldBordered: true,
  ignoreNonTournamentLegal: true,
  ignoredSets: [],
  sounds: false,
  tableSpeed: 'normal', // how fast the opponent's side of the game plays out (lib/tempo.js)

  load: async () => {
    const s = await window.api.getSettings()
    set({ ...s, loaded: true })
  },

  // Persists whatever the store holds, minus its own bookkeeping. Naming the
  // fields here instead meant every new setting silently failed to save.
  update: async (patch) => {
    set(patch)
    const { loaded, load, update, ...persisted } = get() // eslint-disable-line no-unused-vars
    await window.api.setSettings(persisted)
  }
}))
