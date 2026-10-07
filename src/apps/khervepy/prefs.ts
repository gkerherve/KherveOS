// KhervePY's remembered settings (this browser only), like the desktop app's QSettings.

export type LeftTab = 'project' | 'search'
export type RightTab = 'git' | 'log'
export type BottomTab = 'output' | 'diff'

export interface Prefs {
  /** Saved files are written back by themselves shortly after each edit (the desktop app's behaviour). */
  autoSave: boolean
  showHidden: boolean
  wrap: boolean
  lineNumbers: boolean
  fontSize: number
  lastProject: string | null
  recent: string[]
  /** The tabs open when the window closed (reopened with the same project). */
  session: { project: string | null; files: string[]; active: string | null }
  docks: { left: boolean; right: boolean; bottom: boolean }
  tabs: { left: LeftTab; right: RightTab; bottom: BottomTab }
  sizes: { left: number; right: number; bottom: number }
  logAllBranches: boolean
}

const KEY = 'kherveos.khervepy.prefs'

export const DEFAULT_PREFS: Prefs = {
  autoSave: true,
  showHidden: false,
  wrap: false,
  lineNumbers: true,
  fontSize: 13,
  lastProject: null,
  recent: [],
  session: { project: null, files: [], active: null },
  docks: { left: true, right: true, bottom: true },
  tabs: { left: 'project', right: 'git', bottom: 'output' },
  sizes: { left: 230, right: 330, bottom: 190 },
  logAllBranches: true,
}

export function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null
    if (!saved) return DEFAULT_PREFS
    return {
      ...DEFAULT_PREFS,
      ...saved,
      docks: { ...DEFAULT_PREFS.docks, ...saved.docks },
      tabs: { ...DEFAULT_PREFS.tabs, ...saved.tabs },
      sizes: { ...DEFAULT_PREFS.sizes, ...saved.sizes },
      session: { ...DEFAULT_PREFS.session, ...saved.session },
      recent: Array.isArray(saved.recent) ? saved.recent.filter((p) => typeof p === 'string').slice(0, 10) : [],
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

/** Put a project at the top of the recent list. */
export function pushRecent(list: string[], path: string): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, 10)
}
