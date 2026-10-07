// What Python sends back (kfweb/bridge.py `view`) and the desktop's lists:
// peak models, background methods, table columns. No browser or OS imports,
// so Node tests can load this file.

/** One core level as the page shows it. */
export interface View {
  file: string
  sheets: string[]
  sheet: string
  /** The desktop's peak table: two rows per peak (values, constraints), 19 columns of text. */
  grid: string[][]
  background: BackgroundInfo | null
  settings: Settings
  fit: FitSummary | null
  resultsKey: string
  results: ResultRow[]
  x?: (number | null)[]
  y?: (number | null)[]
  bkg?: (number | null)[]
  /** Each peak plus the background (null where not drawn). */
  peaks?: ((number | null)[] | null)[]
  envelope?: (number | null)[] | null
  residuals?: (number | null)[] | null
}

export interface BackgroundInfo {
  type: string
  low: number | string
  high: number | string
  offsetLow: number | string
  offsetHigh: number | string
  /** Recorded regions: [offset high, offset low, low BE, high BE]. */
  ranges: number[][]
  tougaard: number[]
}

export interface Settings {
  model: string
  method: string
  maxIterations: number
  optimization: string
  weights: string
  photons: number
  instrument: string
  libraryType: string
  averagingPoints: number
  workfunction: number
  instruments: string[]
}

export interface FitSummary {
  r2: number | null
  chi2: number
  redChi2: number
  nfev: number
  rsd: number | null
  text: string
}

export interface ResultRow {
  key: string
  name: string
  position: number
  height: number | string
  fwhm: number | string
  lg: number | string
  area: number
  at: number
  checked: boolean
  rsf: number
  txfn: number
  ecf: string
  instrument: string
  model: string
  relArea: number
  sheet: string
  wt: number
  mass: number
}

/** Columns of the peak table (Widgets_Toolbars.py), short labels for the web grid. */
export const PEAK_COLUMNS: { label: string; title: string; width: number }[] = [
  { label: 'ID', title: 'Peak letter (used in constraints: A+1.2, B*0.5…)', width: 30 },
  { label: 'Label', title: 'Peak label', width: 118 },
  { label: 'Position', title: 'Position (eV)', width: 78 },
  { label: 'Height', title: 'Height (CPS)', width: 78 },
  { label: 'FWHM', title: 'FWHM (eV)', width: 62 },
  { label: 'L/G %', title: 'σ/γ (%) — Lorentzian/Gaussian mix', width: 58 },
  { label: 'Area', title: 'Area (CPS.eV)', width: 82 },
  { label: 'σ', title: 'σ (W_g)', width: 56 },
  { label: 'γ', title: 'γ (W_l)', width: 56 },
  { label: 'Skew', title: 'W_g / skew', width: 56 },
  { label: 'Conc. %', title: 'Concentration (%) within this core level', width: 60 },
  { label: 'A/Aᴀ', title: 'Area relative to peak A (%)', width: 56 },
  { label: 'Split', title: 'Split from peak A (eV)', width: 54 },
  { label: 'Fitting Model', title: 'Peak shape', width: 150 },
  { label: 'Bkg Type', title: 'Background', width: 84 },
  { label: 'Bkg Low', title: 'Background low (eV)', width: 66 },
  { label: 'Bkg High', title: 'Background high (eV)', width: 66 },
  { label: 'Off. Low', title: 'Background offset low (CPS)', width: 62 },
  { label: 'Off. High', title: 'Background offset high (CPS)', width: 62 },
]

/** Cells the user may type in (as on the desktop): label, values and constraints. */
export function isEditable(row: number, col: number): boolean {
  if (row % 2 === 0) return col === 1 || (col >= 2 && col <= 9) || col === 13
  return col >= 2 && col <= 9
}

/** The fitting window's model list (Fitting_Screen.py), with its section headers. */
export const MODEL_GROUPS: { name: string; models: string[] }[] = [
  { name: 'Best models', models: ['SGL (Area)', 'GL (Area)', 'LA (Area, σ/γ, γ)', 'Voigt (Area, L/G, σ)'] },
  { name: 'Asymmetric', models: ['LA (Area, σ, γ)', 'DS*G (A, σ, γ, S)', 'DS (A, σ, γ)', 'ExpGauss.(Area, σ, γ)'] },
  { name: 'Voigt', models: ['Voigt (Area, σ, γ)', 'Voigt (Area, L/G, σ, S)'] },
  { name: 'LA', models: ['LA*G (Area, σ/γ, γ)'] },
  { name: 'Others', models: ['Pseudo-Voigt (Area)', 'GL (Height)', 'SGL (Height)'] },
]

export const ALL_MODELS = MODEL_GROUPS.flatMap((g) => g.models)

/** Background methods of the fitting window (normal mode). */
export const BACKGROUND_METHODS = [
  'Smart', 'Shirley', 'Linear', 'Offset', 'U4-Tougaard', 'U2-Tougaard', 'Active Shirley', 'Active Tougaard', 'ALS-Raman', 'Arctan-XAS',
]

export const OPTIMIZATION_METHODS = ['leastsq', 'least_squares', 'nelder', 'powell', 'cobyla', 'trust-constr']
export const WEIGHT_METHODS = ['uniform', 'intensity-based', 'statistical-XPS', 'hybrid-XPS']
export const LIBRARY_TYPES = ['TPP-2M', 'Scofield', 'Wagner', 'EAL', 'None']

/** A number cell of the peak table, or null. */
export function num(text: string | undefined): number | null {
  if (text === undefined || text.trim() === '') return null
  const v = Number(text)
  return Number.isFinite(v) ? v : null
}

/** Peaks of a table: index, letter, label, position, height (above the background), model. */
export interface PeakInfo {
  index: number
  letter: string
  label: string
  position: number
  height: number
  model: string
}

export function peaksOf(grid: string[][]): PeakInfo[] {
  const out: PeakInfo[] = []
  for (let r = 0; r < grid.length; r += 2) {
    const row = grid[r]
    const position = num(row[2])
    const height = num(row[3])
    out.push({
      index: r / 2,
      letter: row[0] || String.fromCharCode(65 + r / 2),
      label: row[1] ?? '',
      position: position ?? NaN,
      height: height ?? NaN,
      model: row[13] ?? '',
    })
  }
  return out
}

/** The sheet name of a sample-numbered core level ('C1s2' → sample 2), as the desktop's results tables. */
export function sampleOf(sheet: string): number {
  const m = /(\d+)$/.exec(sheet)
  return m ? Number(m[1]) : 0
}

/** Raman and XAS sheets are drawn with the energy axis the normal way round (PlotManager). */
export function reversedAxis(sheet: string): boolean {
  if (sheet.startsWith('RA') || sheet.toUpperCase().includes('RAMAN')) return false
  if (sheet.startsWith('XAS')) return false
  return true
}

export function xLabel(sheet: string): string {
  if (sheet.startsWith('RA') || sheet.toUpperCase().includes('RAMAN')) return 'Wavenumber (cm⁻¹)'
  if (sheet.startsWith('XAS')) return 'Photon Energy (eV)'
  return 'Binding Energy (eV)'
}
