// The calculations behind each tab of kClimate, from a project's view settings and the library of series. The window,
// the AI tools, the report and the tests all call these, so they agree. Pure.

import type { Library } from './catalog.ts'
import { buildPath, doublingResponse, simulate, HISTORY_FIRST, type CarbonHistory, type DoublingResult, type EbmRun, type Path } from './ebm.ts'
import type { ModelView, Project, RelateView, SeasonalView, SeriesView, StripesView, TrendView } from './project.ts'
import { alignSeries, correlation, lagCorrelation, regress, regressionSeries, type CorrelationResult, type LagResult, type Predictor, type RegressionResult } from './relate.ts'
import { decompose, meanSeasonalCycle, seasonalAmplitude, type AmplitudeResult, type Decomposition } from './seasonal.ts'
import {
  annualMeans, anomalyVsBaseline, baselineById, decadalMeans, describe, extent, histogram, mean, records, sliceYears, smooth, yearOf, yearSpan,
  type Histogram, type Series,
} from './series.ts'
import { seriesToCsv } from './importCsv.ts'
import { comparePeriods, fitBreakpoint, fitTrend, type BreakpointResult, type PeriodTrend, type TrendModel, type TrendResult } from './stats.ts'

export type Failure = { error: string }
export const isFailure = <T>(r: T | Failure): r is Failure => typeof r === 'object' && r !== null && 'error' in (r as object) && typeof (r as { error: unknown }).error === 'string'

export function baselineText(id: string): string {
  if (id === 'native') return 'the provider’s own baseline'
  const b = baselineById(id)
  return b ? `${b[0]}–${b[1]}` : id
}

/** A series after the baseline (computed on the whole record), without range or smoothing. */
export function withBaseline(raw: Series, baseline: string): { series: Series; note: string } | Failure {
  if (baseline === 'native' || baseline === '') return { series: raw, note: '' }
  const b = baselineById(baseline)
  if (!b) return { error: `“${baseline}” is not a baseline period (write it like 1961-1990).` }
  const r = anomalyVsBaseline(raw, b)
  if ('error' in r) return r
  return { series: r.series, note: r.note }
}

export interface ProcessedLine {
  ref: string
  axis: 'left' | 'right'
  raw: Series
  series: Series
  notes: string[]
}

export interface SeriesFigureData {
  lines: ProcessedLine[]
  errors: string[]
  /** One trend fitted to the first line, when asked. */
  trend: TrendResult | null
  yearRange: [number, number] | null
}

/** Range, baseline and smoothing applied to the lines of the time-series plot. */
export function prepareLines(lib: Library, v: SeriesView): SeriesFigureData {
  const lines: ProcessedLine[] = []
  const errors: string[] = []
  for (const l of v.lines) {
    const raw = lib.get(l.ref)
    if (!raw) { errors.push(`The series “${l.ref}” is not loaded.`); continue }
    const baseline = l.baseline || v.baseline
    const b = withBaseline(raw, baseline)
    if (isFailure(b)) { errors.push(`${raw.name}: ${b.error}`); continue }
    const notes = b.note ? [`${raw.name}: ${b.note}`] : []
    const ranged = sliceYears(b.series, v.from, v.to)
    const smoothed = smooth(ranged, v.smooth)
    // two lines of one series with different baselines need different names
    const name = l.baseline && baseline !== 'native' ? `${raw.name} (vs ${baselineText(baseline)})` : smoothed.name
    lines.push({ ref: l.ref, axis: l.axis, raw, series: { ...smoothed, name }, notes })
  }
  let trend: TrendResult | null = null
  if (v.trendLine !== 'none' && lines.length) {
    const base = lines[0]
    trend = fitTrend(base.series.t, base.series.y, { model: v.trendLine as TrendModel, ar1: true })
  }
  const spans = lines.map((l) => yearSpan(l.series)).filter((s): s is [number, number] => !!s)
  return { lines, errors, trend, yearRange: spans.length ? [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))] : null }
}

// ---------------------------------------------------------------------------------------------------- trends

export interface TrendAnalysis {
  source: Series
  /** The data that was fitted (range cut, annual means when asked). */
  data: Series
  trend: TrendResult | null
  breakpoint: BreakpointResult | null
  periods: PeriodTrend[]
  notes: string[]
}

export function analyseTrend(lib: Library, v: TrendView): TrendAnalysis | Failure {
  const raw = lib.get(v.series)
  if (!raw) return { error: `The series “${v.series}” is not loaded. Add its dataset in the Datasets tab.` }
  const b = withBaseline(raw, v.baseline)
  if (isFailure(b)) return b
  const notes = b.note ? [b.note] : []
  let data = b.series
  const annual = v.annual && data.step !== 'annual' ? annualMeans(data) : data
  data = annual
  const full = data
  data = sliceYears(data, v.from, v.to)
  const trend = fitTrend(data.t, data.y, { model: v.model, ar1: v.ar1 })
  if (!trend) return { error: `Not enough values in ${v.from ?? 'the start'}–${v.to ?? 'the end'} to fit a ${v.model} trend.` }
  if (v.model === 'exponential' && trend.n < data.y.filter(Number.isFinite).length) notes.push('Values that are zero or negative were left out of the exponential fit.')
  const breakpoint = v.breakpoint ? fitBreakpoint(data.t, data.y, { ar1: v.ar1 }) : null
  if (v.breakpoint && !breakpoint) notes.push('Too few values for a breakpoint fit.')
  return { source: raw, data, trend, breakpoint, periods: comparePeriods(full.t, full.y, v.periods, v.ar1), notes }
}

// -------------------------------------------------------------------------------------------------- seasonal

export interface SeasonalAnalysis {
  source: Series
  decomposition: Decomposition
  amplitude: AmplitudeResult
  cycle: Array<{ month: number; mean: number; sd: number; n: number }>
  /** Growth of the trend per year at the end of the record (ppm/yr for CO2). */
  endRate: number
  notes: string[]
}

export function analyseSeasonal(lib: Library, v: SeasonalView): SeasonalAnalysis | Failure {
  const raw = lib.get(v.series)
  if (!raw) return { error: `The series “${v.series}” is not loaded.` }
  if (raw.step !== 'monthly') return { error: `${raw.name} is not a monthly series, so it has no seasonal cycle to analyse. Choose a monthly series (CO₂, sea-ice extent…).` }
  const data = sliceYears(raw, v.from, v.to)
  const decomposition = decompose(data, { harmonics: v.harmonics, degree: v.degree })
  if (!decomposition) return { error: 'Too few values for the harmonic fit. Widen the period or use fewer harmonics.' }
  const amplitude = seasonalAmplitude(data, { windowYears: v.windowYears, harmonics: Math.min(3, v.harmonics) })
  const rate = decomposition.fit.rate
  return {
    source: raw, decomposition, amplitude, cycle: meanSeasonalCycle(data), endRate: rate[rate.length - 1], notes: [],
  }
}

// --------------------------------------------------------------------------------------------- relationships

export type RelateAnalysis =
  | { mode: 'correlation'; x: Series; y: Series; result: CorrelationResult; pairs: { x: number[]; y: number[]; t: number[] } }
  | { mode: 'lag'; x: Series; y: Series; result: LagResult }
  | { mode: 'regression'; target: Series; predictors: Predictor[]; result: RegressionResult; fitted: Series; residual: Series; adjusted: Series }

export function analyseRelate(lib: Library, v: RelateView): RelateAnalysis | Failure {
  const range: [number | null, number | null] = [v.from, v.to]
  if (v.mode === 'regression') {
    const target = lib.get(v.target)
    if (!target) return { error: `The series “${v.target}” is not loaded.` }
    if (!v.predictors.length && !v.trend) return { error: 'Add at least one explanatory variable.' }
    const predictors: Predictor[] = []
    for (const p of v.predictors) {
      const s = lib.get(p.ref)
      if (!s) return { error: `The series “${p.ref}” is not loaded.` }
      predictors.push({ series: s, transform: p.transform, lag: p.lag })
    }
    const natural = predictors.filter((p) => !/co2|carbon|ghg|emission/i.test(`${p.series.id} ${p.series.name}`)).map((p) => p.label ?? p.series.name)
    const r = regress(target, predictors, v.step, { trend: v.trend, range, natural })
    if (isFailure(r)) return r
    return {
      mode: 'regression', target, predictors, result: r,
      fitted: regressionSeries(target, r, 'fitted', 'Regression fit'), residual: regressionSeries(target, r, 'residual', 'Residual'), adjusted: regressionSeries(target, r, 'adjusted', `${target.name}, natural variations removed`),
    }
  }
  const x = lib.get(v.x)
  const y = lib.get(v.y)
  if (!x) return { error: `The series “${v.x}” is not loaded.` }
  if (!y) return { error: `The series “${v.y}” is not loaded.` }
  try {
    if (v.mode === 'correlation') {
      const result = correlation(x, y, v.step, { detrend: v.detrend, range })
      if (!result) return { error: 'The two series share fewer than 5 times in this period.' }
      const al = alignSeries([x, y], v.step, [], range)
      return { mode: 'correlation', x, y, result, pairs: { x: al.cols[0], y: al.cols[1], t: al.t } }
    }
    const result = lagCorrelation(x, y, v.step, v.maxLag, { detrend: v.detrend, range })
    if (!result) return { error: 'The two series share too few times in this period.' }
    return { mode: 'lag', x, y, result }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// ------------------------------------------------------------------------------------------ stripes, records

export interface StripesAnalysis {
  source: Series
  /** Annual means after the baseline, within the range. */
  annual: Series
  decades: Array<{ decade: number; mean: number; n: number }>
  warmest: Array<{ year: number; value: number; rank: number }>
  coldest: Array<{ year: number; value: number; rank: number }>
  histA: { values: number[]; hist: Histogram; mean: number; sd: number }
  histB: { values: number[]; mean: number; sd: number }
  /** The largest absolute anomaly, for the colour scale. */
  limit: number
  notes: string[]
}

export function analyseStripes(lib: Library, v: StripesView): StripesAnalysis | Failure {
  const raw = lib.get(v.series)
  if (!raw) return { error: `The series “${v.series}” is not loaded.` }
  const b = withBaseline(raw, v.baseline)
  if (isFailure(b)) return b
  const annualAll = annualMeans(b.series)
  const annual = sliceYears(annualAll, v.from, v.to)
  if (annual.y.filter(Number.isFinite).length < 3) return { error: 'Fewer than three years have a value in this period.' }
  const pick = (p: [number, number]) => sliceYears(annualAll, p[0], p[1]).y.filter(Number.isFinite)
  const a = pick(v.periodA)
  const bb = pick(v.periodB)
  const all = [...a, ...bb]
  const stat = (x: number[]) => ({ values: x, mean: mean(x), sd: x.length > 1 ? Math.sqrt(x.reduce((s, q) => s + (q - mean(x)) ** 2, 0) / (x.length - 1)) : NaN })
  const lo = all.length ? Math.min(...all) : 0
  const hi = all.length ? Math.max(...all) : 1
  const pad = (hi - lo) * 0.05 || 0.5
  return {
    source: raw, annual, decades: decadalMeans(annual), warmest: records(annual, 10, 'warmest'), coldest: records(annual, 5, 'coldest'),
    histA: { ...stat(a), hist: histogram(a, undefined, [lo - pad, hi + pad]) }, histB: stat(bb),
    limit: Math.max(...annual.y.filter(Number.isFinite).map(Math.abs), 1e-9), notes: b.note ? [b.note] : [],
  }
}

/** Highest-n of the 10 warmest years etc. is in StripesAnalysis; the gauges below are the "where are we" numbers. */
export interface Gauges {
  warming: { value: number; year: number | null; partial: boolean; label: string; source: string; baseline: string; pctOf15: number; pctOf2: number } | null
  co2: { value: number; label: string; preindustrial: number; pctAbove: number } | null
  notes: string[]
}

/** Warming above 1850–1900 (the mean of the latest 12 months, or the latest complete year) and CO2 above 280 ppm. */
export function preindustrialGauges(lib: Library, opts: { preindustrialPpm?: number } = {}): Gauges {
  const notes: string[] = []
  let warming: Gauges['warming'] = null
  for (const [ref, label] of [['hadcrut5.anomaly', 'HadCRUT5'], ['gistemp.global', 'GISTEMP']] as const) {
    const s = lib.get(ref)
    if (!s) continue
    const b = withBaseline(s, '1850-1900')
    if (isFailure(b)) continue
    const f = b.series
    const idx: number[] = []
    for (let i = f.t.length - 1; i >= 0 && idx.length < 12; i--) if (Number.isFinite(f.y[i])) idx.push(i)
    if (idx.length < 12) continue
    const value = mean(idx.map((i) => f.y[i]))
    const last = f.t[idx[0]]
    warming = {
      value, year: yearOf(last), partial: false, source: label, baseline: '1850–1900',
      label: `mean of the 12 months to ${monthName(last)} ${yearOf(last)}`, pctOf15: (value / 1.5) * 100, pctOf2: (value / 2) * 100,
    }
    if (b.note) notes.push(`${label}: ${b.note}`)
    break
  }
  let co2: Gauges['co2'] = null
  const c = lib.get('co2_mlo.co2')
  if (c) {
    const idx: number[] = []
    for (let i = c.t.length - 1; i >= 0 && idx.length < 12; i--) if (Number.isFinite(c.y[i])) idx.push(i)
    if (idx.length === 12) {
      const value = mean(idx.map((i) => c.y[i]))
      const pre = opts.preindustrialPpm ?? 280
      co2 = { value, preindustrial: pre, pctAbove: ((value - pre) / pre) * 100, label: `mean of the 12 months to ${monthName(c.t[idx[0]])} ${yearOf(c.t[idx[0]])}` }
    }
  }
  return { warming, co2, notes }
}

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthName = (t: number): string => MONTH_LONG[Math.min(11, Math.floor((t - Math.floor(t + 1e-9)) * 12 + 1e-6))]

// ------------------------------------------------------------------------------------------------- query

export type QueryStat = 'mean' | 'min' | 'max' | 'trend' | 'anomaly' | 'count' | 'first' | 'last'

export interface QueryResult {
  series: string
  name: string
  unit: string
  from: number | null
  to: number | null
  stat: QueryStat
  value: number | null
  detail: Record<string, unknown>
}

/** One statistic of a series over a period (the AI tool and the report use this). */
export function querySeries(lib: Library, ref: string, opts: { from?: number | null; to?: number | null; stat: QueryStat; baseline?: string }): QueryResult | Failure {
  const s = lib.get(ref)
  if (!s) return { error: `There is no series “${ref}”. Loaded series: ${lib.all().slice(0, 40).map((x) => x.id).join(', ')}.` }
  const from = opts.from ?? null
  const to = opts.to ?? null
  const slice = sliceYears(s, from, to)
  const d = describe(slice)
  const out = (value: number | null, detail: Record<string, unknown> = {}): QueryResult => ({ series: s.id, name: s.name, unit: s.unit, from, to, stat: opts.stat, value, detail })
  if (!d) return { error: `${s.name} has no values in ${from ?? 'the start'}–${to ?? 'the end'}.` }
  switch (opts.stat) {
    case 'mean': return out(d.mean, { n: d.n, sd: d.sd })
    case 'min': return out(d.min, { at: Number(d.tMin.toFixed(3)) })
    case 'max': return out(d.max, { at: Number(d.tMax.toFixed(3)) })
    case 'count': return out(d.n)
    case 'first': return out(slice.y.find(Number.isFinite) ?? null, { at: finiteFirst(slice) })
    case 'last': { const e = extent(slice); return out(slice.y.filter(Number.isFinite).pop() ?? null, { at: e ? Number(e[1].toFixed(3)) : null }) }
    case 'trend': {
      const data = s.step === 'monthly' ? annualMeans(slice) : slice
      const t = fitTrend(data.t, data.y, { model: 'linear', ar1: true })
      if (!t) return { error: 'Too few values for a trend.' }
      return out(t.perDecade, { per: 'decade', ci95: t.ciDecade.map((x) => Number(x.toPrecision(4))), ci95_without_autocorrelation: t.ciDecadeNaive.map((x) => Number(x.toPrecision(4))), p: t.p, r2: t.r2, n: t.n, lag1_autocorrelation: Number(t.r1.toFixed(3)), effective_n: Number(t.nEff.toFixed(1)) })
    }
    case 'anomaly': {
      const b = baselineById(opts.baseline ?? '1961-1990')
      if (!b) return { error: `“${opts.baseline}” is not a baseline period (write it like 1961-1990).` }
      const r = anomalyVsBaseline(s, b, 'constant')
      if ('error' in r) return r
      const sub = sliceYears(r.series, from, to)
      const dd = describe(sub)
      return out(dd ? dd.mean : null, { baseline: `${b[0]}-${b[1]}`, baseline_mean: r.offset, ...(r.note ? { note: r.note } : {}) })
    }
  }
}

function finiteFirst(s: Series): number | null {
  const e = extent(s)
  return e ? Number(e[0].toFixed(3)) : null
}

// ------------------------------------------------------------------------------------------------- model

export interface ModelAnalysis {
  path: Path
  run: EbmRun
  doubling: DoublingResult
  /** Observed anomalies (1850–1900 baseline), if available, and the model anomalies in the same baseline. */
  observed: Series | null
  modelDT: Series
  /** The model and the observations are expressed against 1850–1900 (when the scenario starts later than that); otherwise against the pre-industrial equilibrium. */
  rebased: boolean
  /** Model temperature rise at the end of the run (against 1850–1900, or the pre-industrial equilibrium). */
  end: { year: number; warming: number }
  /** How well the emission history explains the Mauna Loa record (airborne fraction, RMSE in ppm), when both are loaded. */
  co2Fit: { airborne: number; early: number; rmse: number } | null
  notes: string[]
}

/** The emission history (Gt CO2 per year) from the library, or null. */
export function carbonHistory(lib: Library): CarbonHistory | null {
  const s = lib.get('owid_co2.co2_including_luc')
  if (!s) return null
  const emissions: Array<[number, number]> = []
  for (let i = 0; i < s.t.length; i++) if (Number.isFinite(s.y[i]) && yearOf(s.t[i]) >= HISTORY_FIRST) emissions.push([yearOf(s.t[i]), s.y[i] / 1000])
  return emissions.length > 50 ? { emissions } : null
}

/** Annual means of the Mauna Loa record as [year, ppm]. */
export function mloAnnual(lib: Library): Array<[number, number]> {
  const s = lib.get('co2_mlo.co2')
  if (!s) return []
  const a = annualMeans(s)
  return a.t.map((t, i) => [yearOf(t), a.y[i]] as [number, number]).filter((p) => Number.isFinite(p[1]))
}

export function analyseModel(lib: Library, v: ModelView): ModelAnalysis {
  const notes: string[] = []
  const history = carbonHistory(lib)
  const obsCo2 = mloAnnual(lib)
  if (!history && v.scenario.startYear > HISTORY_FIRST + 10) notes.push('The emission history is not loaded, so the CO₂ before the scenario is an idealised rise to the starting value (not data).')
  else if (obsCo2.length < 10) notes.push('Mauna Loa CO₂ is not loaded, so the history comes from the emissions with a default airborne fraction.')
  const mloEnd = obsCo2.length ? obsCo2[obsCo2.length - 1][1] : 425
  const path = buildPath(v.scenario, v.params.c0, history, { observed: obsCo2, startPpm: mloEnd })
  const run = simulate(v.params, path)
  const doubling = doublingResponse(v.params)
  // anomalies against 1850-1900 for both
  const modelRaw: Series = { id: 'model.dT', name: 'Energy-balance model', unit: '°C', t: run.t, y: run.dT, step: 'annual', kind: 'anomaly' }
  // a scenario that starts after 1900 has a history, so both are shown against 1850–1900; a step in 1850 is shown against the pre-industrial equilibrium
  const rebased = v.scenario.startYear > 1900
  const base = rebased ? anomalyVsBaseline(modelRaw, [1850, 1900], 'constant') : null
  const modelDT = base && !('error' in base) ? base.series : modelRaw
  let observed: Series | null = null
  const o = rebased && v.observed ? lib.get(v.observed) : null
  if (o) {
    const ob = withBaseline(annualMeans(o), '1850-1900')
    if (!isFailure(ob)) {
      observed = ob.series
      if (ob.note) notes.push(ob.note)
    } else notes.push(`The observed series cannot be shown against 1850–1900: ${ob.error}`)
  }
  const lastI = modelDT.y.length - 1
  return { path, run, doubling, observed, modelDT, rebased, end: { year: Math.round(modelDT.t[lastI]), warming: modelDT.y[lastI] }, co2Fit: path.fitted, notes }
}

// ----------------------------------------------------------------------------------------------- export

/** The numbers behind the open tab as CSV (File › Export › Data). Null when the tab has none. */
export function exportCsv(p: Project, lib: Library): { name: string; csv: string } | null {
  switch (p.tab) {
    case 'series': {
      const d = prepareLines(lib, p.series)
      return d.lines.length ? { name: 'series', csv: seriesToCsv(d.lines.map((l) => l.series)) } : null
    }
    case 'trend': {
      const a = analyseTrend(lib, p.trend)
      if (isFailure(a) || !a.trend) return null
      const fit: Series = { ...a.data, id: 'fit', name: `${a.data.name}: ${a.trend.model} trend`, t: a.trend.t, y: a.trend.fitted }
      const lo: Series = { ...fit, id: 'lo', name: '95 % lower', y: a.trend.lo }
      const hi: Series = { ...fit, id: 'hi', name: '95 % upper', y: a.trend.hi }
      return { name: 'trend', csv: seriesToCsv([a.data, fit, lo, hi]) }
    }
    case 'seasonal': {
      const a = analyseSeasonal(lib, p.seasonal)
      if (isFailure(a)) return null
      const d = a.decomposition
      return { name: 'seasonal', csv: seriesToCsv([d.trend, d.seasonal, d.residual, d.deseasonalized, a.amplitude.series]) }
    }
    case 'relate': {
      const a = analyseRelate(lib, p.relate)
      if (isFailure(a)) return null
      if (a.mode === 'lag') return { name: 'lagged-correlation', csv: ['lag,r,n', ...a.result.lags.map((l, i) => `${l},${Number.isFinite(a.result.r[i]) ? Number(a.result.r[i].toFixed(5)) : ''},${a.result.n[i]}`)].join('\n') + '\n' }
      if (a.mode === 'correlation') return { name: 'correlation', csv: ['time,x,y', ...a.pairs.t.map((t, i) => `${Number(t.toFixed(4))},${a.pairs.x[i]},${a.pairs.y[i]}`)].join('\n') + '\n' }
      return { name: 'regression', csv: seriesToCsv([{ ...a.target, t: a.result.t, y: a.result.y, step: a.result.step === 'monthly' ? 'monthly' : 'annual' }, a.fitted, a.residual, a.adjusted]) }
    }
    case 'stripes': {
      const a = analyseStripes(lib, p.stripes)
      return isFailure(a) ? null : { name: 'annual', csv: seriesToCsv([a.annual]) }
    }
    case 'model': {
      const m = analyseModel(lib, p.model)
      const r = m.run
      const lines = ['year,co2_ppm,forcing_w_m2,temperature_k,warming_vs_1850_1900_c,equilibrium_warming_c']
      const off = r.dT[0] - m.modelDT.y[0]
      r.t.forEach((t, i) => lines.push([Number(t.toFixed(2)), Number(r.conc[i].toFixed(3)), Number(r.forcing[i].toFixed(4)), Number(r.T[i].toFixed(4)), Number(m.modelDT.y[i].toFixed(4)), Number((r.equilibrium[i] - off).toFixed(4))].join(',')))
      return { name: 'energy-balance', csv: lines.join('\n') + '\n' }
    }
    default: return null
  }
}
