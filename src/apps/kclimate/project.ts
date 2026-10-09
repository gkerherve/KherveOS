// The state of a kClimate window (a "project") and the .kclim file: JSON
//   { "format": "kclim", "version": 1, "title", "notes", "datasets": [id | embedded import, …],
//     "views": { tab, series, trend, seasonal, relate, stripes }, "model": { params, scenario, … } }
// Pure: reading a file never throws on bad fields, it falls back to the defaults and reports what it ignored.

import { DEFAULT_EBM, DEFAULT_SCENARIO, type EbmParams, type Scenario, type ScenarioMode, type ScenarioPreset } from './ebm.ts'
import type { ImportedColumn, ImportedDataset } from './importCsv.ts'
import type { SmoothSpec } from './series.ts'
import type { TrendModel } from './stats.ts'
import type { PredictorTransform } from './relate.ts'

export type TabId = 'data' | 'series' | 'trend' | 'seasonal' | 'relate' | 'stripes' | 'model' | 'sources'
export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'data', label: 'Datasets' },
  { id: 'series', label: 'Time series' },
  { id: 'trend', label: 'Trends' },
  { id: 'seasonal', label: 'Seasonal cycle' },
  { id: 'relate', label: 'Relationships' },
  { id: 'stripes', label: 'Stripes & records' },
  { id: 'model', label: 'Energy balance' },
  { id: 'sources', label: 'Data sources' },
]

export interface PlotLine {
  ref: string
  axis: 'left' | 'right'
  /** A baseline for this line only (overrides the view's), e.g. "1951-1980". */
  baseline?: string
}

export interface SeriesView {
  lines: PlotLine[]
  from: number | null
  to: number | null
  /** "native" keeps the provider's baseline; otherwise a baseline id ("1951-1980"). */
  baseline: string
  smooth: SmoothSpec
  trendLine: TrendModel | 'none'
}

export interface TrendView {
  series: string
  from: number | null
  to: number | null
  baseline: string
  model: TrendModel
  /** Fit annual means instead of every month. */
  annual: boolean
  ar1: boolean
  breakpoint: boolean
  /** Periods to compare (inclusive years). */
  periods: Array<[number, number]>
}

export interface SeasonalView {
  series: string
  from: number | null
  to: number | null
  harmonics: number
  degree: number
  windowYears: number
}

export interface RelatePredictor {
  ref: string
  transform: PredictorTransform
  lag: number
}

export interface RelateView {
  mode: 'correlation' | 'lag' | 'regression'
  x: string
  y: string
  step: 'monthly' | 'annual'
  maxLag: number
  detrend: boolean
  from: number | null
  to: number | null
  /** Regression: the series to explain and what explains it. */
  target: string
  predictors: RelatePredictor[]
  trend: boolean
}

export interface StripesView {
  series: string
  from: number | null
  to: number | null
  baseline: string
  kind: 'stripes' | 'decadal' | 'histogram' | 'records'
  /** Histogram: two periods to compare. */
  periodA: [number, number]
  periodB: [number, number]
}

export interface ModelView {
  params: EbmParams
  scenario: Scenario
  tool: 'response' | 'hysteresis' | 'blackbody'
  /** Observed series laid over the model (a global temperature series), or "". */
  observed: string
}

export interface Project {
  title: string
  notes: string
  datasets: string[]
  imports: ImportedDataset[]
  tab: TabId
  series: SeriesView
  trend: TrendView
  seasonal: SeasonalView
  relate: RelateView
  stripes: StripesView
  model: ModelView
}

export const DEFAULT_SERIES_VIEW: SeriesView = {
  lines: [{ ref: 'hadcrut5.anomaly', axis: 'left' }], from: null, to: null, baseline: '1961-1990', smooth: { kind: 'none' }, trendLine: 'none',
}

export const DEFAULT_PROJECT: Project = {
  title: 'Untitled',
  notes: '',
  datasets: ['hadcrut5'],
  imports: [],
  tab: 'series',
  series: DEFAULT_SERIES_VIEW,
  trend: { series: 'hadcrut5.anomaly', from: 1970, to: null, baseline: 'native', model: 'linear', annual: true, ar1: true, breakpoint: false, periods: [[1970, 1990], [1991, 2010], [2011, 2025]] },
  seasonal: { series: 'co2_mlo.co2', from: null, to: null, harmonics: 4, degree: 2, windowYears: 5 },
  relate: { mode: 'lag', x: 'oni.oni', y: 'gistemp.global', step: 'monthly', maxLag: 24, detrend: true, from: 1960, to: null, target: 'gistemp.global', predictors: [{ ref: 'co2_mlo.co2', transform: 'log2', lag: 0 }, { ref: 'oni.oni', transform: 'none', lag: 3 }], trend: false },
  stripes: { series: 'hadcrut5.anomaly', from: null, to: null, baseline: '1961-1990', kind: 'stripes', periodA: [1951, 1980], periodB: [1991, 2020] },
  model: { params: DEFAULT_EBM, scenario: DEFAULT_SCENARIO, tool: 'response', observed: 'hadcrut5.anomaly' },
}

/** A deep copy (projects are plain JSON). */
export const cloneProject = (p: Project): Project => JSON.parse(JSON.stringify(p)) as Project

// ---------------------------------------------------------------------------------------------- reading

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
const numOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const yearOrNull = (v: unknown, d: number | null): number | null => (v === null ? null : typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d)
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d)
const period = (v: unknown, d: [number, number]): [number, number] => (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? [Math.round(v[0]), Math.round(v[1])] : d)

function smoothOf(v: unknown, d: SmoothSpec): SmoothSpec {
  if (!isObj(v)) return d
  switch (v.kind) {
    case 'none': return { kind: 'none' }
    case 'annual': return { kind: 'annual' }
    case 'running': return { kind: 'running', years: Math.max(0.1, numOr(v.years, 1)) }
    case 'lowess': return { kind: 'lowess', years: Math.max(0.5, numOr(v.years, 15)) }
    case 'decadal': return { kind: 'decadal', years: Math.max(1, numOr(v.years, 11)) }
    default: return d
  }
}

function paramsOf(v: unknown): EbmParams {
  const d = DEFAULT_EBM
  if (!isObj(v)) return { ...d }
  return {
    solar: numOr(v.solar, d.solar), albedo: numOr(v.albedo, d.albedo), emissivity: numOr(v.emissivity, d.emissivity), ecs: Math.max(0.1, numOr(v.ecs, d.ecs)),
    mixedDepth: Math.max(1, numOr(v.mixedDepth, d.mixedDepth)), oceanFraction: Math.min(1, Math.max(0.05, numOr(v.oceanFraction, d.oceanFraction))),
    deepOcean: bool(v.deepOcean, d.deepOcean), deepDepth: Math.max(10, numOr(v.deepDepth, d.deepDepth)), exchange: Math.max(0, numOr(v.exchange, d.exchange)),
    c0: Math.max(1, numOr(v.c0, d.c0)), ice: bool(v.ice, d.ice), iceAlbedo: numOr(v.iceAlbedo, d.iceAlbedo), tCold: numOr(v.tCold, d.tCold), tWarm: numOr(v.tWarm, d.tWarm),
  }
}

function scenarioOf(v: unknown): Scenario {
  const d = DEFAULT_SCENARIO
  if (!isObj(v)) return { ...d, points: d.points.map((q) => [...q] as [number, number]) }
  const points = Array.isArray(v.points)
    ? v.points.filter((q): q is [number, number] => Array.isArray(q) && q.length === 2 && q.every((x) => typeof x === 'number' && Number.isFinite(x))).map((q) => [q[0], q[1]] as [number, number])
    : d.points
  return {
    mode: oneOf<ScenarioMode>(v.mode, ['emissions', 'concentration'], d.mode),
    preset: oneOf<ScenarioPreset>(v.preset, ['constant', 'growth', 'peak', 'netzero', 'custom'], d.preset),
    startYear: Math.round(numOr(v.startYear, d.startYear)), growthPct: numOr(v.growthPct, d.growthPct), peakYear: Math.round(numOr(v.peakYear, d.peakYear)),
    declineYears: Math.max(1, numOr(v.declineYears, d.declineYears)), zeroYear: Math.round(numOr(v.zeroYear, d.zeroYear)), points: points.sort((a, b) => a[0] - b[0]),
  }
}

function importOf(v: unknown): ImportedDataset | null {
  if (!isObj(v) || typeof v.id !== 'string' || !Array.isArray(v.columns) || !Array.isArray(v.t) || !isObj(v.values)) return null
  const columns: ImportedColumn[] = []
  for (const c of v.columns) {
    if (isObj(c) && typeof c.key === 'string') columns.push({ key: c.key, name: str(c.name, c.key), unit: str(c.unit, ''), kind: c.kind === 'anomaly' ? 'anomaly' : 'level' })
  }
  const t = v.t.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : NaN))
  if (!columns.length || t.length < 2 || t.some((x) => Number.isNaN(x))) return null
  const values: Record<string, Array<number | null>> = {}
  for (const c of columns) {
    const raw = (v.values as Record<string, unknown>)[c.key]
    values[c.key] = t.map((_, i) => { const x = Array.isArray(raw) ? raw[i] : null; return typeof x === 'number' && Number.isFinite(x) ? x : null })
  }
  return {
    id: v.id.startsWith('user:') ? v.id : `user:${v.id}`, name: str(v.name, 'My data'), step: oneOf(v.step, ['monthly', 'annual', 'irregular'] as const, 'irregular'), columns, t, values,
    ...(v.synthetic === true ? { synthetic: true } : {}),
  }
}

export interface ReadResult {
  project: Project
  warnings: string[]
}

/** Reads a .kclim file. Throws only when the text is not a kClimate file at all. */
export function parseKclim(text: string): ReadResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a kClimate file (it is not JSON).')
  }
  if (!isObj(raw) || raw.format !== 'kclim') throw new Error('This is not a kClimate file (no "format": "kclim").')
  const warnings: string[] = []
  if (typeof raw.version === 'number' && raw.version > 1) warnings.push(`The file is version ${raw.version}; this kClimate reads version 1, so some settings may be ignored.`)
  const d = DEFAULT_PROJECT
  const datasets: string[] = []
  const imports: ImportedDataset[] = []
  for (const e of Array.isArray(raw.datasets) ? raw.datasets : []) {
    if (typeof e === 'string') datasets.push(e)
    else {
      const im = importOf(e)
      if (im) imports.push(im)
      else warnings.push('A dataset embedded in the file is damaged and was left out.')
    }
  }
  const views = isObj(raw.views) ? raw.views : {}
  const sv = isObj(views.series) ? views.series : {}
  const tv = isObj(views.trend) ? views.trend : {}
  const ev = isObj(views.seasonal) ? views.seasonal : {}
  const rv = isObj(views.relate) ? views.relate : {}
  const stv = isObj(views.stripes) ? views.stripes : {}
  const mv = isObj(raw.model) ? raw.model : {}
  const lines: PlotLine[] = Array.isArray(sv.lines)
    ? sv.lines.filter((l): l is Record<string, unknown> => isObj(l) && typeof l.ref === 'string').map((l): PlotLine => ({ ref: l.ref as string, axis: l.axis === 'right' ? 'right' : 'left', ...(typeof l.baseline === 'string' && l.baseline ? { baseline: l.baseline } : {}) }))
    : d.series.lines
  const predictors: RelatePredictor[] = Array.isArray(rv.predictors)
    ? rv.predictors.filter((p): p is Record<string, unknown> => isObj(p) && typeof p.ref === 'string').map((p) => ({ ref: p.ref as string, transform: oneOf<PredictorTransform>(p.transform, ['none', 'log2', 'ln'], 'none'), lag: Math.round(numOr(p.lag, 0)) }))
    : d.relate.predictors
  const periods = Array.isArray(tv.periods) ? tv.periods.map((p) => period(p, [0, 0])).filter((p) => p[1] >= p[0] && p[1] > 0) : d.trend.periods
  const project: Project = {
    title: str(raw.title, 'Untitled'),
    notes: str(raw.notes, ''),
    datasets,
    imports,
    tab: oneOf<TabId>(views.tab, TABS.map((t) => t.id), 'series'),
    series: {
      lines, from: yearOrNull(sv.from, null), to: yearOrNull(sv.to, null), baseline: str(sv.baseline, d.series.baseline), smooth: smoothOf(sv.smooth, { kind: 'none' }),
      trendLine: oneOf(sv.trendLine, ['none', 'linear', 'quadratic', 'exponential'] as const, 'none'),
    },
    trend: {
      series: str(tv.series, d.trend.series), from: yearOrNull(tv.from, d.trend.from), to: yearOrNull(tv.to, null), baseline: str(tv.baseline, 'native'),
      model: oneOf(tv.model, ['linear', 'quadratic', 'exponential'] as const, 'linear'), annual: bool(tv.annual, true), ar1: bool(tv.ar1, true), breakpoint: bool(tv.breakpoint, false), periods,
    },
    seasonal: {
      series: str(ev.series, d.seasonal.series), from: yearOrNull(ev.from, null), to: yearOrNull(ev.to, null),
      harmonics: Math.min(6, Math.max(1, Math.round(numOr(ev.harmonics, 4)))), degree: Math.min(3, Math.max(1, Math.round(numOr(ev.degree, 2)))), windowYears: Math.min(15, Math.max(3, Math.round(numOr(ev.windowYears, 5)))),
    },
    relate: {
      mode: oneOf(rv.mode, ['correlation', 'lag', 'regression'] as const, 'lag'), x: str(rv.x, d.relate.x), y: str(rv.y, d.relate.y), step: oneOf(rv.step, ['monthly', 'annual'] as const, 'monthly'),
      maxLag: Math.min(60, Math.max(1, Math.round(numOr(rv.maxLag, 24)))), detrend: bool(rv.detrend, true), from: yearOrNull(rv.from, null), to: yearOrNull(rv.to, null),
      target: str(rv.target, d.relate.target), predictors, trend: bool(rv.trend, false),
    },
    stripes: {
      series: str(stv.series, d.stripes.series), from: yearOrNull(stv.from, null), to: yearOrNull(stv.to, null), baseline: str(stv.baseline, d.stripes.baseline),
      kind: oneOf(stv.kind, ['stripes', 'decadal', 'histogram', 'records'] as const, 'stripes'), periodA: period(stv.periodA, d.stripes.periodA), periodB: period(stv.periodB, d.stripes.periodB),
    },
    model: {
      params: paramsOf(mv.params), scenario: scenarioOf(mv.scenario), tool: oneOf(mv.tool, ['response', 'hysteresis', 'blackbody'] as const, 'response'), observed: str(mv.observed, d.model.observed),
    },
  }
  if (!Array.isArray(raw.datasets)) warnings.push('The file lists no datasets, so no data are loaded.')
  return { project, warnings }
}

// --------------------------------------------------------------------------------------------- writing

const round = (v: number | null, d = 6): number | null => (v === null ? null : Number(v.toPrecision(d)))

const pick = <T extends object>(o: T, keys: Array<keyof T>): T => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as T

/** The text of a .kclim file (2-space JSON, a fixed order of keys, a final newline). */
export function serializeKclim(p: Project): string {
  const imports = p.imports.map((im) => ({
    id: im.id, name: im.name, step: im.step, ...(im.synthetic ? { synthetic: true } : {}),
    columns: im.columns.map((c) => pick(c, ['key', 'name', 'unit', 'kind'])), t: im.t.map((x) => Number(x.toFixed(5))), values: Object.fromEntries(im.columns.map((c) => [c.key, (im.values[c.key] ?? []).map((v) => round(v))])),
  }))
  const smooth = p.series.smooth
  const out = {
    format: 'kclim',
    version: 1,
    title: p.title,
    notes: p.notes,
    datasets: [...p.datasets, ...imports],
    views: {
      tab: p.tab,
      series: { ...pick(p.series, ['lines', 'from', 'to', 'baseline']), smooth: smooth.kind === 'none' || smooth.kind === 'annual' ? { kind: smooth.kind } : pick(smooth, ['kind', 'years'] as never), trendLine: p.series.trendLine },
      trend: pick(p.trend, ['series', 'from', 'to', 'baseline', 'model', 'annual', 'ar1', 'breakpoint', 'periods']),
      seasonal: pick(p.seasonal, ['series', 'from', 'to', 'harmonics', 'degree', 'windowYears']),
      relate: pick(p.relate, ['mode', 'x', 'y', 'step', 'maxLag', 'detrend', 'from', 'to', 'target', 'predictors', 'trend']),
      stripes: pick(p.stripes, ['series', 'from', 'to', 'baseline', 'kind', 'periodA', 'periodB']),
    },
    model: {
      params: pick(p.model.params, ['solar', 'albedo', 'emissivity', 'ecs', 'mixedDepth', 'oceanFraction', 'deepOcean', 'deepDepth', 'exchange', 'c0', 'ice', 'iceAlbedo', 'tCold', 'tWarm']),
      scenario: pick(p.model.scenario, ['mode', 'preset', 'startYear', 'growthPct', 'peakYear', 'declineYears', 'zeroYear', 'points']),
      tool: p.model.tool,
      observed: p.model.observed,
    },
  }
  out.views.series.lines = p.series.lines.map((l) => pick(l, ['ref', 'axis', 'baseline']))
  return JSON.stringify(out, null, 2) + '\n'
}
