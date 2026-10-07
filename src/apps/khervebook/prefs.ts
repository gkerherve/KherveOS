// KherveBook's remembered choices (like the desktop's QSettings), kept in
// this browser's localStorage. Every access is guarded: storage can be
// unavailable (private windows, blocked site data).

export interface UiPrefs {
  /** The file explorer panel (desktop: View > File Explorer, Ctrl+B). */
  explorer: boolean
  /** The AI assistant panel (View > AI Assistant). */
  ai: boolean
  /** Width of the side panel, px. */
  sideWidth: number
  /** Share of the side panel's height given to the explorer (0–1). */
  split: number
  /** View > Page Mode: one continuous page, cell borders hidden. */
  pageMode: boolean
  /** Line numbers in code cells. */
  lineNumbers: boolean
  /** The folder the explorer shows when the notebook has none. */
  explorerRoot: string | null
}

const UI_KEY = 'khervebook.ui'
const RECENT_KEY = 'khervebook.recent'
const MAX_RECENT = 12

const DEFAULTS: UiPrefs = { explorer: true, ai: true, sideWidth: 280, split: 0.42, pageMode: false, lineNumbers: true, explorerRoot: null }

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: the choice lasts until the window closes */
  }
}

export function loadUiPrefs(): UiPrefs {
  const saved = readJson<Partial<UiPrefs>>(UI_KEY, {})
  const p = { ...DEFAULTS, ...saved }
  return {
    ...p,
    sideWidth: Number.isFinite(p.sideWidth) ? Math.min(640, Math.max(180, p.sideWidth)) : DEFAULTS.sideWidth,
    split: Number.isFinite(p.split) ? Math.min(0.85, Math.max(0.15, p.split)) : DEFAULTS.split,
  }
}

export function saveUiPrefs(p: UiPrefs) {
  writeJson(UI_KEY, p)
}

export function recentFiles(): string[] {
  const v = readJson<unknown>(RECENT_KEY, [])
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function addRecent(path: string) {
  writeJson(RECENT_KEY, [path, ...recentFiles().filter((p) => p !== path)].slice(0, MAX_RECENT))
}

export function clearRecent() {
  writeJson(RECENT_KEY, [])
}
