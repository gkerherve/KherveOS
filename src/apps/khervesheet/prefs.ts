// KherveSheet's remembered choices (the desktop keeps them in QSettings),
// in this browser's localStorage. Every access is guarded: storage can be
// unavailable (private windows, blocked site data).

export interface ViewPrefs {
  /** 1 = 100 %. */
  zoom: number
  gridlines: boolean
  headings: boolean
  /** Show formulas instead of their values (Ctrl+`). */
  formulas: boolean
  /** The second toolbar row (formatting). */
  formatBar: boolean
}

const VIEW_KEY = 'khervesheet.view'
const RECENT_KEY = 'khervesheet.recent'
const MAX_RECENT = 12

const DEFAULTS: ViewPrefs = { zoom: 1, gridlines: true, headings: true, formulas: false, formatBar: true }

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: the choice lasts until the window closes */
  }
}

export function loadView(): ViewPrefs {
  const v = { ...DEFAULTS, ...readJson<Partial<ViewPrefs>>(VIEW_KEY, {}) }
  v.zoom = Number.isFinite(v.zoom) ? Math.min(4, Math.max(0.25, v.zoom)) : 1
  v.formulas = false // a session choice, like Excel
  return v
}

export function saveView(v: ViewPrefs) {
  writeJson(VIEW_KEY, { ...v, formulas: false })
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
