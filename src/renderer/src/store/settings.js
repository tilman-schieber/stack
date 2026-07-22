import { create } from 'zustand'

// App-wide settings, mirrored from the main process (persisted there).
export const useSettings = create((set, get) => ({
  loaded: false,
  ignoreGoldBordered: true,
  ignoreNonTournamentLegal: true,
  ignoredSets: [],

  load: async () => {
    const s = await window.api.getSettings()
    set({ ...s, loaded: true })
  },

  update: async (patch) => {
    set(patch)
    const { ignoreGoldBordered, ignoreNonTournamentLegal, ignoredSets } = get()
    await window.api.setSettings({ ignoreGoldBordered, ignoreNonTournamentLegal, ignoredSets })
  }
}))
