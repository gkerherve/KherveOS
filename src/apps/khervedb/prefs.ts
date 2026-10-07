// KherveDB's remembered settings (this browser only). The main window and the
// Other Databases & Properties window each save only what they change
// (savePrefs merges), so neither undoes the other's choices.

/** The tabs of the Other Databases & Properties window: a source id (sources.ts) or 'props'. */
export type RefTab = string

export interface Prefs {
  /** "Don't show this again" in the welcome window. */
  hideWelcome: boolean
  /** Plain tiles with the symbol only (the Python app's Simplified Periodic Table). */
  simplified: boolean
  /** The tab shown in the Other Databases & Properties window. */
  refTab: RefTab
  /** Histogram bin width in eV; 0 picks one from the range shown. */
  plotBin: number
  /** The smooth curve over the histogram. */
  plotSmooth: boolean
  /** Good paper Scholar: newest papers first instead of the most cited. */
  newestFirst: boolean
}

const KEY = 'kherveos.khervedb.prefs'

export const DEFAULT_PREFS: Prefs = {
  hideWelcome: false,
  simplified: false,
  refTab: 'xpsfitting',
  plotBin: 0,
  plotSmooth: true,
  newestFirst: false,
}

export function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Partial<Prefs> & { panelTab?: string }) | null
    if (!saved || typeof saved !== 'object') return DEFAULT_PREFS
    return {
      hideWelcome: saved.hideWelcome === true,
      simplified: saved.simplified === true,
      // (the panel of earlier versions remembered 'properties')
      refTab: typeof saved.refTab === 'string' && /^[a-z]{1,20}$/.test(saved.refTab) ? saved.refTab : saved.panelTab === 'properties' ? 'props' : DEFAULT_PREFS.refTab,
      plotBin: typeof saved.plotBin === 'number' && saved.plotBin >= 0 && saved.plotBin <= 5 ? saved.plotBin : 0,
      plotSmooth: saved.plotSmooth !== false,
      newestFirst: saved.newestFirst === true,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

/** Remember these settings (merged into what is saved). */
export function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}
