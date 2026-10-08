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
  /** View > File Explorer Position: the side panels on the left or the right of the cells. */
  side: 'left' | 'right'
  /** View > Theme: one of the desktop's themes, or '' for KherveOS's own. */
  theme: string
}

const UI_KEY = 'khervebook.ui'
const RECENT_KEY = 'khervebook.recent'
const MAX_RECENT = 12

const DEFAULTS: UiPrefs = { explorer: true, ai: true, sideWidth: 280, split: 0.42, pageMode: false, lineNumbers: true, explorerRoot: null, side: 'left', theme: '' }

/** desktop style.THEMES: colour tokens per theme. */
export const DESKTOP_THEMES: Record<string, { window: string; chrome: string; card: string; border: string; text: string; editor: string; hover: string; pressed: string; select: string; icon: string; gutter: string; dark: boolean }> = {
  Light: { window: '#f4f5f7', chrome: '#fafbfc', card: '#ffffff', border: '#e1e4e8', text: '#1a1a1a', editor: '#f8f9fa', hover: '#e3eef9', pressed: '#cfe3f6', select: '#2176c7', icon: '#444444', gutter: '#1565c0', dark: false },
  Dark: { window: '#1e2227', chrome: '#262b31', card: '#2b3138', border: '#3a4149', text: '#e6e9ec', editor: '#23282e', hover: '#37404a', pressed: '#415060', select: '#4aa3ff', icon: '#cfd6dd', gutter: '#6ab0f3', dark: true },
  Slate: { window: '#e8ebef', chrome: '#dde2e8', card: '#ffffff', border: '#c5ccd4', text: '#2e3440', editor: '#f0f3f6', hover: '#cfd9e4', pressed: '#b9c8d8', select: '#4a6fa5', icon: '#4c566a', gutter: '#4a6fa5', dark: false },
  Ocean: { window: '#e7f1f6', chrome: '#d9e9f2', card: '#ffffff', border: '#bcd6e4', text: '#173a4d', editor: '#eef6fa', hover: '#c8e2ef', pressed: '#aed5e8', select: '#1a6e8e', icon: '#2a647e', gutter: '#1a6e8e', dark: false },
  Forest: { window: '#eaf1ea', chrome: '#dde9dd', card: '#ffffff', border: '#c3d6c3', text: '#23362a', editor: '#f0f6f0', hover: '#d0e4d0', pressed: '#b9d6b9', select: '#2e7d4f', icon: '#3c5a44', gutter: '#2e7d4f', dark: false },
  Sand: { window: '#f5f0e6', chrome: '#efe7d8', card: '#fffdf8', border: '#ddd1bb', text: '#3d3526', editor: '#f8f4ea', hover: '#ecdfc8', pressed: '#e2d2b4', select: '#b07d2b', icon: '#6b5d40', gutter: '#a06b1a', dark: false },
  Graphite: { window: '#26262a', chrome: '#2e2e33', card: '#333339', border: '#46464d', text: '#dddde2', editor: '#2b2b30', hover: '#3f3f47', pressed: '#4c4c56', select: '#9a7fd1', icon: '#c4c4cc', gutter: '#b49ae0', dark: true },
  'High Contrast': { window: '#ffffff', chrome: '#ffffff', card: '#ffffff', border: '#000000', text: '#000000', editor: '#ffffff', hover: '#dddddd', pressed: '#bbbbbb', select: '#0000cc', icon: '#000000', gutter: '#0000cc', dark: false },
}

/** The CSS variables of a desktop theme on the KherveBook window (style._template's roles). */
export function desktopThemeVars(name: string): Record<string, string> | null {
  const t = DESKTOP_THEMES[name]
  if (!t) return null
  return {
    '--k-bg': t.window, '--k-surface': t.card, '--k-chrome': t.chrome, '--k-text': t.text, '--k-muted': t.icon, '--k-border': t.border,
    '--k-accent': t.select, '--k-accent-text': '#ffffff', '--k-selection': t.pressed, '--k-button': t.chrome, '--k-button-hover': t.hover,
    '--k-link': t.select, '--k-alt': t.editor, '--nb-page': t.window, '--nb-card': t.card, '--nb-editor': t.editor, '--nb-gutter-text': t.gutter,
    '--nb-icon': t.icon, colorScheme: t.dark ? 'dark' : 'light',
  }
}

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
    side: p.side === 'right' ? 'right' : 'left',
    theme: typeof p.theme === 'string' && (p.theme === '' || p.theme in DESKTOP_THEMES) ? p.theme : '',
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
