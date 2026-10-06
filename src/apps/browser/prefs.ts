// The Browser's remembered choices (in this browser's localStorage): the search
// engine, and the sites where the "Blank page?" hint was dismissed.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_SEARCH_ENGINE } from './sites'

interface BrowserPrefs {
  /** null: DEFAULT_SEARCH_ENGINE, so changing that constant reaches everyone who never chose. */
  engine: string | null
  /** Hosts where the user dismissed the "Blank page?" hint. */
  quietHosts: string[]
  setEngine(id: string): void
  quiet(host: string): void
}

export const useBrowserPrefs = create<BrowserPrefs>()(
  persist(
    (set) => ({
      engine: null,
      quietHosts: [],
      setEngine: (id) => set({ engine: id === DEFAULT_SEARCH_ENGINE ? null : id }),
      quiet: (host) => set((s) => ({ quietHosts: [...s.quietHosts.filter((h) => h !== host), host].slice(-200) })),
    }),
    {
      name: 'kherveos.browser',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ engine: s.engine, quietHosts: s.quietHosts }),
    },
  ),
)
