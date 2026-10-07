// KherveDB's remembered settings (this browser only).

export type PanelTab = 'databases' | 'properties'

export interface Prefs {
  /** "Don't show this again" in the welcome window. */
  hideWelcome: boolean
  /** Plain tiles with the symbol only (the Python app's Simplified Periodic Table). */
  simplified: boolean
  /** The tab of the Other Databases & Properties panel. */
  panelTab: PanelTab
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
  panelTab: 'databases',
  plotBin: 0,
  plotSmooth: true,
  newestFirst: false,
}

export function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null
    if (!saved || typeof saved !== 'object') return DEFAULT_PREFS
    return {
      hideWelcome: saved.hideWelcome === true,
      simplified: saved.simplified === true,
      panelTab: saved.panelTab === 'properties' ? 'properties' : 'databases',
      plotBin: typeof saved.plotBin === 'number' && saved.plotBin >= 0 && saved.plotBin <= 5 ? saved.plotBin : 0,
      plotSmooth: saved.plotSmooth !== false,
      newestFirst: saved.newestFirst === true,
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
