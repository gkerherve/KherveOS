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
  /** Per grid row, one character per column: '.' normal, 'g' grey, 'w' unused, 'c' hidden (constraint), 'k' green. */
  gridColours?: string[]
  /** The desktop's results grid: 38 cells of text per row. */
  resultsGrid?: { key: string; cells: string[]; checked: boolean }[]
  /** Chi, R2, RedChi of the sheet's last fit. */
  stats?: { Chi?: number; R2?: number; RedChi?: number }
  /** Per peak, its 1σ uncertainties after a fit ({Position, Height, FWHM, 'L/G', Area, method}). */
  peakErrors?: Record<string, number | string>[]
  /** Extra per-sheet fields of the dev-AI tools (features.view_extra). */
  extra?: ViewExtra
}

export interface ViewExtra {
  beCorrection?: number
  sample?: number
  labels?: { text: string; x: number; y?: number | null }[]
  [k: string]: unknown
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

/** Columns of the peak grid (Widgets_Toolbars.create_peak_params_grid): label, width (px). */
export const PEAK_COLUMNS: { label: string; width: number }[] = [
  ['ID', 20], ['Peak\nLabel', 90], ['Position\n(eV)', 80], ['Height\n(CPS)', 60], ['FWHM\n(eV)', 60], ['\u03c3/\u03b3 (%)\nL/G \n', 50],
  ['Area\n(CPS.eV)', 70], ['\u03c3\nW_g', 45], ['\u03b3\nW_l', 45], ['W_g\nSkew', 50], ['Conc.\n(%)', 40], ['A/A\u1D00', 40], ['Split\n(eV)', 40],
  ['Fitting Model', 130], ['Bkg Type', 130], ['Bkg Low\n(eV)', 80], ['Bkg High\n(eV)', 80], ['Bkg Offset Low\n(CPS)', 100], ['Bkg Offset High\n(CPS)', 100],
].map(([label, width]) => ({ label: label as string, width: width as number }))

/** Peak-grid columns the "Show / hide extra grid columns" button hides (Functions.toggle_Col_1, columns1). */
export const PEAK_EXTRA_COLUMNS = [13, 14, 15, 16, 17, 18]

/** Columns of the results grid (create_results_grid), then the 1σ columns of Fit_Uncertainty. */
export const RESULT_COLUMNS: { label: string; width: number }[] = [
  ['Peak\nLabel', 100], ['Position\n(eV)', 55], ['Height\n(CPS)', 55], ['FWHM\n(eV)', 50], ['L/G \n\u03c3/\u03b3 (%)', 50], ['Area\n(CPS.eV)', 80],
  ['Atomic\n(%)', 50], [' ', 20], ['RSF', 30], ['TXFN', 30], ['ECF', 50], ['Instr.', 80], ['Fitting Model', 120], ['Corr. Area\n(a.u.)', 60],
  ['\u03c3 or \u03B1\nW_g', 80], ['\u03b3 or \u03B2\nW_l', 70], ['Bkg Type', 70], ['Bkg Low\n(eV)', 100], ['Bkg High\n(eV)', 100],
  ['Bkg Offset Low\n(CPS)', 80], ['Bkg Offset High\n(CPS)', 80], ['Sheetname', 80], ['Position\nConstraint', 120], ['Height\nConstraint', 120],
  ['FWHM\nConstraint', 120], ['L/G\nConstraint', 70], ['Area\nConstraint', 70], ['\u03c3\nConstraint', 70], ['\u03b3\nConstraint', 50],
  ['Weight\n(%)', 45], ['Mass\n(amu)', 40],
  ['\u00b1 Position\n(eV)', 60], ['\u00b1 Height\n(CPS)', 60], ['\u00b1 FWHM\n(eV)', 55], ['\u00b1 L/G\n(%)', 55], ['\u00b1 Area\n(CPS.eV)', 70],
  ['\u00b1 Atomic\n(%)', 60], ['Error\nfrom', 110],
].map(([label, width]) => ({ label: label as string, width: width as number }))

/** Display order of the results columns: each ± after its value, "Error from" after ± Atomic (arrange_result_error_columns). */
export const RESULT_ORDER: number[] = (() => {
  const after: Record<number, number> = { 1: 31, 2: 32, 3: 33, 4: 34, 5: 35, 6: 36 }
  const moved = new Set([31, 32, 33, 34, 35, 36, 37])
  const order: number[] = []
  for (let c = 0; c < RESULT_COLUMNS.length; c++) {
    if (moved.has(c)) continue
    order.push(c)
    if (c in after) {
      order.push(after[c])
      if (c === 6) order.push(37)
    }
  }
  return order
})()

/** Results columns hidden in the compact view (toggle_Col_1, columns2 + ± Height / ± L/G). */
export const RESULT_EXTRA_COLUMNS = [2, 4, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 32, 34]

/** Results cells shown green and bold (Atomic %, Corr. Area, Weight %). */
export const RESULT_KEY_COLUMNS = [6, 13, 29]

/** Cells the user may type in (as on the desktop): label, values and constraints. */
export function isEditable(row: number, col: number): boolean {
  if (row % 2 === 0) return col === 1 || (col >= 2 && col <= 9) || col === 13
  return col >= 2 && col <= 9
}

/** The model editor of the peak grid's Fitting Model column (window.fitting_models). */
export const GRID_MODELS = [
  'GL (Area)', 'SGL (Area)', 'Voigt (Area)', 'Voigt (Area, L/G, S)', 'LA (Area, \u03c3/\u03b3, \u03b3)', 'Voigt (Area, L/G, \u03c3)', 'Voigt (Area, \u03c3, \u03b3)',
  'Voigt (Area, L/G, \u03c3, S)', 'LA (Area, \u03c3, \u03b3)', 'LA*G (Area, \u03c3/\u03b3, \u03b3)', 'Pseudo-Voigt (Area)', 'ExpGauss.(Area, \u03c3, \u03b3)',
  'GL (Height)', 'SGL (Height)', 'A*GL (Area, a, b)', 'A*SGL (Area, a, b)', 'LF (Area, \u03c3, \u03b3, w)', 'DL (A, \u03c3, \u03b3, aDL)', 'TLA (A, \u03bc, \u03b1, Wg)', 'SB (Height)',
]

/** The Fitting tab's model combo (Fitting_Screen.init_fitting_tab), section headers included. */
export const MODEL_GROUPS: { name: string; models: string[] }[] = [
  { name: 'Best Models', models: ['SGL (Area)', 'GL (Area)', 'LA (Area, \u03c3/\u03b3, \u03b3)', 'Voigt (Area, L/G, \u03c3)'] },
  { name: 'Asymmetric', models: ['LA (Area, \u03c3, \u03b3)', 'DL (A, \u03c3, \u03b3, aDL)', 'TLA (A, \u03bc, \u03b1, Wg)', 'DS*G (A, \u03c3, \u03b3, S)', 'DS (A, \u03c3, \u03b3)', 'ExpGauss.(Area, \u03c3, \u03b3)'] },
  { name: 'Voigt', models: ['Voigt (Area)', 'Voigt (Area, L/G, S)', 'Voigt (Area, L/G, \u03c3)', 'Voigt (Area, \u03c3, \u03b3)', 'Voigt (Area, L/G, \u03c3, S)'] },
  { name: 'LA', models: ['LA (Area, \u03c3/\u03b3, \u03b3)', 'LA (Area, \u03c3, \u03b3)', 'LA*G (Area, \u03c3/\u03b3, \u03b3)', 'LF (Area, \u03c3, \u03b3, w)'] },
  { name: 'Others', models: ['Pseudo-Voigt (Area)', 'GL (Height)', 'SGL (Height)', 'A*GL (Area, a, b)', 'A*SGL (Area, a, b)', 'SB (Height)'] },
  { name: 'Beta', models: ['Voigt (Area, L/G, \u03c3, S)'] },
]

export const ALL_MODELS = [...new Set([...MODEL_GROUPS.flatMap((g) => g.models), ...GRID_MODELS])]

/** The BKG tab's method combo (init_background_tab), "-----" entries are section headers. */
export const BACKGROUND_METHODS = [
  'Smart', 'Shirley', 'Iterated Shirley', 'Linear', 'Offset', 'U4-Tougaard', 'U2-Tougaard', 'Spline Background------', 'Spline Shirley', 'Spline Tougaard',
  'Active Background------', 'Active Shirley', 'Active Tougaard', 'Other Techniques-------', 'Poly-2', 'Poly-3', 'ALS', 'ALS-Raman', 'Arctan-XAS', 'Power-EELS',
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
