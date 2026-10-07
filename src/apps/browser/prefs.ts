// The Browser's remembered choices (in this browser's localStorage): the search
// engine, the sites where the "Blank page?" hint was dismissed, and the sites
// the user chose to show through the KherveOS page fetcher.

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_SEARCH_ENGINE } from './sites'

interface BrowserPrefs {
  /** null: DEFAULT_SEARCH_ENGINE, so changing that constant reaches everyone who never chose. */
  engine: string | null
  /** Hosts where the user dismissed the "Blank page?" hint. */
  quietHosts: string[]
  /** Hosts shown through the KherveOS page fetcher by choice ("Show through KherveOS"). */
  fetchHosts: string[]
  setEngine(id: string): void
  quiet(host: string): void
  /** Show this host through the fetcher (true) or framed directly (false). */
  setFetched(host: string, on: boolean): void
}

const remember = (list: string[], host: string) => [...list.filter((h) => h !== host), host].slice(-200)

export const useBrowserPrefs = create<BrowserPrefs>()(
  persist(
    (set) => ({
      engine: null,
      quietHosts: [],
      fetchHosts: [],
      setEngine: (id) => set({ engine: id === DEFAULT_SEARCH_ENGINE ? null : id }),
      quiet: (host) => set((s) => ({ quietHosts: remember(s.quietHosts, host) })),
      setFetched: (host, on) =>
        set((s) => ({ fetchHosts: on ? remember(s.fetchHosts, host) : s.fetchHosts.filter((h) => h !== host) })),
    }),
    {
      name: 'kherveos.browser',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ engine: s.engine, quietHosts: s.quietHosts, fetchHosts: s.fetchHosts }),
    },
  ),
)
