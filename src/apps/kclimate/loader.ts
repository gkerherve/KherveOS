// Fetching the shipped datasets in the browser (public/data/kclimate/) and the small per-user settings (recent files and
// window preferences in localStorage). The parsing is in catalog.ts, which Node can test.

import { parseManifest, seriesFromCsv, type DatasetEntry, type Manifest } from './catalog.ts'
import type { Series } from './series.ts'

const base = () => `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}data/kclimate/`

let manifestPromise: Promise<Manifest> | null = null

/** The manifest of the shipped datasets (fetched once; a failed fetch is tried again next time). */
export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch(`${base()}manifest.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`The data catalog could not be loaded (${r.status}).`)
      return r.json()
    })
    .then(parseManifest)
    .catch((e) => {
      manifestPromise = null
      throw e
    })
  return manifestPromise
}

const cache = new Map<string, Promise<Series[]>>()

/** The series of one shipped dataset. */
export function loadDataset(entry: DatasetEntry): Promise<Series[]> {
  let p = cache.get(entry.id)
  if (!p) {
    p = fetch(`${base()}${encodeURIComponent(entry.file)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${entry.title} could not be loaded (${r.status}).`)
        return r.text()
      })
      .then((text) => {
        const s = seriesFromCsv(entry, text)
        if (!s.length) throw new Error(`${entry.title}: the file has no readable series.`)
        return s
      })
      .catch((e) => {
        cache.delete(entry.id)
        throw e
      })
    cache.set(entry.id, p)
  }
  return p
}

// ---------------------------------------------------------------------------------------------------- settings

export interface Prefs {
  settings: boolean
  notes: boolean
}
export const DEFAULT_PREFS: Prefs = { settings: true, notes: true }
const PREFS_KEY = 'kherveos.kclimate.prefs'
const RECENT_KEY = 'kherveos.kclimate.recent'

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { settings: typeof raw.settings === 'boolean' ? raw.settings : true, notes: typeof raw.notes === 'boolean' ? raw.notes : true }
  } catch {
    return DEFAULT_PREFS
  }
}
export function savePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage blocked */ }
}

export function recentFiles(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export function addRecent(path: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([path, ...recentFiles().filter((p) => p !== path)].slice(0, 10))) } catch { /* storage blocked */ }
}
export function clearRecent(): void {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* storage blocked */ }
}
