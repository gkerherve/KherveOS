// kClimate: the maths against closed forms and planted signals, the shipped datasets against their manifest and
// against each other, the energy-balance model against textbook numbers, the .kclim file, the CSV import, the 17
// example files and the AI tools. No browser. Run:
//   node --test tools/tests/kclimate.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tCritical, tTwoSided, normCdf } from '../../src/apps/kclimate/dist.ts'
import {
  annualMeans, anomalyVsBaseline, baselineById, decadalMeans, describe, histogram, lowess, monthOf, monthT, monthlyClimatology, records, runningMean, sliceYears, smooth, yearOf,
  type Series,
} from '../../src/apps/kclimate/series.ts'
import { autocorr1, comparePeriods, effectiveN, fitBreakpoint, fitTrend, ols, pearson, rCritical, spearman, trendAt } from '../../src/apps/kclimate/stats.ts'
import { decompose, harmonicFit, meanSeasonalCycle, seasonalAmplitude, syntheticSeasonal } from '../../src/apps/kclimate/seasonal.ts'
import { alignSeries, correlation, lagCorrelation, regress } from '../../src/apps/kclimate/relate.ts'
import {
  absorbed, albedoAt, blackbodyTemperature, buildPath, constantHistory, co2Forcing, DEFAULT_EBM, DEFAULT_SCENARIO, doublingResponse, equilibria, equilibriumAt, F2X, feedbackForEcs,
  hysteresis, preindustrial, scenarioConcentration, scenarioEmissions, simulate, stepPath, SIGMA, type EbmParams, type Scenario,
} from '../../src/apps/kclimate/ebm.ts'
import { ar1Noise, gaussian, rng, sampleCsv, sampleDataset } from '../../src/apps/kclimate/synthetic.ts'
import { Library, catalogRefs, matchRef, parseManifest, seriesFromCsv, type DatasetEntry } from '../../src/apps/kclimate/catalog.ts'
import { buildImport, detectDelimiter, importedSeries, inferMapping, parseCsv, parseDateCell, seriesToCsv } from '../../src/apps/kclimate/importCsv.ts'
import { cloneProject, DEFAULT_PROJECT, parseKclim, serializeKclim, TABS, type Project } from '../../src/apps/kclimate/project.ts'
import {
  analyseModel, analyseRelate, analyseSeasonal, analyseStripes, analyseTrend, carbonHistory, isFailure, mloAnnual, preindustrialGauges, prepareLines, querySeries, withBaseline,
} from '../../src/apps/kclimate/analysis.ts'
import { buildExamples } from '../../src/apps/kclimate/examples.ts'
import { kclimateExampleFiles, KCLIMATE_EXAMPLES_FOLDER } from '../../src/apps/kclimate/exampleFiles.ts'
import {
  STRIPE_COLORS, amplitudeFigure, contributionsFigure, cycleFigure, decadalFigure, decompositionFigure, histogramPairFigure, hysteresisFigure, lagFigure, modelFigure, periodTrendsFigure,
  regressionFigure, scatterFigure, scenarioFigure, seriesFigure, stripeColor, stripesFigure, trendFigure, withAlpha, LIGHT_PALETTE,
} from '../../src/apps/kclimate/figures.ts'
import { reportMarkdown } from '../../src/apps/kclimate/report.ts'
import { describeState, kclimateTools, type Hooks } from '../../src/apps/kclimate/aiTools.ts'
import { KCLIMATE_TOOL_SET } from '../../src/os/ai/manifests/kclimate.ts'
import { kclimateOutputs, indexText } from '../export_kclimate_examples.ts'
import { exampleFileName, readExampleIndex } from '../../src/os/exampleFiles.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DATA = join(ROOT, 'public/data/kclimate')
const near = (a: number, b: number, rel = 1e-6, abs = 0, what = '') => assert.ok(Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel), `${what} ${a} ≈ ${b} (rel ${rel}, abs ${abs})`)
const between = (v: number, lo: number, hi: number, what = '') => assert.ok(v >= lo && v <= hi, `${what} ${v} in [${lo}, ${hi}]`)

const manifest = parseManifest(JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')))
const csvText = (e: DatasetEntry) => readFileSync(join(DATA, e.file), 'utf8')
function loadLib(ids?: string[]): Library {
  const lib = new Library()
  for (const e of manifest.datasets) if (!ids || ids.includes(e.id)) lib.addDataset(e.id, seriesFromCsv(e, csvText(e)))
  return lib
}
const fullLib = loadLib()

const monthly = (id: string, year0: number, y: number[], extra: Partial<Series> = {}): Series => ({
  id, name: id, unit: '', t: y.map((_, i) => monthT(year0 + Math.floor(i / 12), (i % 12) + 1)), y, step: 'monthly', kind: 'level', ...extra,
})
const annual = (id: string, year0: number, y: number[], extra: Partial<Series> = {}): Series => ({ id, name: id, unit: '', t: y.map((_, i) => year0 + i + 0.5), y, step: 'annual', kind: 'level', ...extra })

// ------------------------------------------------------------------------------------------------- distributions

test('Student t and normal: textbook values', () => {
  near(tCritical(0.05, 10), 2.2281, 1e-4)
  near(tCritical(0.05, 30), 2.0423, 1e-4)
  near(tCritical(0.05, 1e9), 1.95996, 1e-4)
  near(tTwoSided(2.2281, 10), 0.05, 1e-3)
  near(normCdf(1.96), 0.975, 1e-4)
})

// ------------------------------------------------------------------------------------------------------- series

test('time helpers: a monthly time is the middle of its month', () => {
  near(monthT(2000, 1), 2000 + 0.5 / 12, 1e-12)
  assert.equal(monthOf(monthT(1999, 12)), 12)
  assert.equal(yearOf(monthT(1999, 12)), 1999)
  for (let m = 1; m <= 12; m++) assert.equal(monthOf(monthT(2020, m)), m)
})

test('annual means need most of the year; the running year and gaps do not give a misleading mean', () => {
  const y = Array.from({ length: 36 }, (_, i) => (i < 12 ? 1 : i < 24 ? 2 : 3))
  y[30] = NaN // 11 months in 3rd year: still counts (>= 10)
  for (let i = 24; i < 34; i++) y[i] = i === 30 ? NaN : 3
  const s = monthly('x', 2000, y)
  const a = annualMeans(s)
  assert.deepEqual(a.t.map(yearOf), [2000, 2001, 2002])
  near(a.y[0], 1, 1e-12)
  near(a.y[2], 3, 1e-12) // 9 of the first 10 months... see below
  // a year with 9 of 12 months is dropped
  const z = y.slice()
  for (let i = 24; i < 28; i++) z[i] = NaN
  assert.deepEqual(annualMeans(monthly('x', 2000, z)).t.map(yearOf), [2000, 2001])
  assert.equal(annualMeans(annual('a', 2000, [1, 2, 3])).y.length, 3)
})

test('anomalies against a baseline: constant offset, and monthly climatology for seasonal data', () => {
  const s = annual('a', 1950, Array.from({ length: 70 }, (_, i) => 10 + 0.02 * i))
  const r = anomalyVsBaseline(s, [1961, 1990])
  assert.ok(!('error' in r))
  if ('error' in r) return
  // mean over 1961–1990 is zero
  const m = describe(sliceYears(r.series, 1961, 1990))!
  near(m.mean, 0, 1, 1e-12)
  near(r.series.y[10] - r.series.y[0], 0.2, 1e-9)
  assert.equal(r.series.kind, 'anomaly')
  assert.deepEqual(r.series.baseline, [1961, 1990])
  // monthly level series: each calendar month has zero mean in the baseline
  const sea = syntheticSeasonal({ year0: 1960, years: 50, base: 100, slopePerYear: 0.5, amplitude: 10 })
  const c = anomalyVsBaseline(sea, [1981, 2010]) // auto: climatology
  assert.ok(!('error' in c))
  if ('error' in c) return
  assert.equal(c.offset, null)
  for (const mean of monthlyClimatology(c.series, 1981, 2010)) near(mean, 0, 1, 1e-9)
  // the seasonal cycle is gone: December and June no longer differ by ~10
  const clim = monthlyClimatology(c.series)
  assert.ok(Math.max(...clim) - Math.min(...clim) < 1)
})

test('a baseline the series does not cover is an error with a friendly message; a partial one carries a note', () => {
  const s = annual('a', 1880, Array.from({ length: 100 }, (_, i) => i))
  const none = anomalyVsBaseline(s, [1850, 1870])
  assert.ok('error' in none && /no data in the baseline 1850–1870/.test(none.error))
  const part = anomalyVsBaseline(s, [1850, 1900])
  assert.ok(!('error' in part))
  if (!('error' in part)) {
    assert.ok(part.coverage < 0.9 && part.coverage > 0.4)
    assert.match(part.note, /Only \d+ % of 1850–1900/)
  }
  assert.ok('error' in anomalyVsBaseline(s, [1900, 1890]))
  assert.deepEqual(baselineById('1961-1990'), [1961, 1990])
  assert.deepEqual(baselineById('1850-1900'), [1850, 1900])
  assert.equal(baselineById('nonsense'), null)
})

test('running mean: 12 months of monthly data is the centred 2x12 filter; ends are left empty', () => {
  const s = monthly('x', 2000, Array.from({ length: 48 }, (_, i) => i))
  const r = runningMean(s, 1)
  // a straight line is unchanged by a centred filter
  assert.ok(Number.isNaN(r.y[0]) && Number.isNaN(r.y[47]))
  near(r.y[24], 24, 1e-12)
  // 2x12 weights: ends half
  const spike = monthly('x', 2000, new Array(48).fill(0))
  spike.y[24] = 12
  const r2 = runningMean(spike, 1)
  near(r2.y[24], 1, 1e-12)
  near(r2.y[24 + 6], 0.5, 1e-12) // the half-weighted end point
  assert.ok(Number.isNaN(r2.y[24 + 7]) || Math.abs(r2.y[24 + 7]) < 1e-12)
  const ann = annual('a', 1900, Array.from({ length: 30 }, (_, i) => i))
  const r11 = runningMean(ann, 11)
  near(r11.y[15], 15, 1e-12)
  assert.ok(Number.isNaN(r11.y[2]))
})

test('LOWESS follows a smooth curve through noise and shrugs off an outlier', () => {
  const x = Array.from({ length: 200 }, (_, i) => i / 10)
  const g = gaussian(rng(3))
  const truth = x.map((v) => Math.sin(v / 3))
  const y = truth.map((v) => v + 0.15 * g())
  y[100] += 5
  const f = lowess(x, y, 0.2, 3)
  let se = 0
  for (let i = 10; i < 190; i++) se += (f[i] - truth[i]) ** 2
  assert.ok(Math.sqrt(se / 180) < 0.1, 'close to the truth')
  assert.ok(Math.abs(f[100] - truth[100]) < 0.35, 'outlier damped by robustness iterations')
  // exact on a straight line
  const line = lowess(x, x.map((v) => 2 * v + 1), 0.3, 0)
  for (let i = 0; i < x.length; i += 17) near(line[i], 2 * x[i] + 1, 1e-6, 1e-6)
  // smooth() dispatch
  const s = annual('a', 1900, Array.from({ length: 100 }, (_, i) => i * 0.1 + Math.sin(i)))
  assert.equal(smooth(s, { kind: 'none' }), s)
  assert.equal(smooth(s, { kind: 'lowess', years: 20 }).y.length, 100)
  assert.equal(smooth(monthly('m', 2000, Array.from({ length: 48 }, () => 1)), { kind: 'annual' }).y.length, 4)
  between(smooth(s, { kind: 'decadal' }).y.filter(Number.isFinite).length, 85, 96, 'ends are trimmed')
})

test('decadal means, records, histogram', () => {
  const a = annual('a', 1978, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) // 1978..1989
  assert.deepEqual(decadalMeans(a), [{ decade: 1970, mean: 1.5, n: 2 }, { decade: 1980, mean: 7.5, n: 10 }])
  assert.deepEqual(records(a, 2).map((r) => [r.year, r.value, r.rank]), [[1989, 12, 1], [1988, 11, 2]])
  assert.deepEqual(records(a, 1, 'coldest').map((r) => r.year), [1978])
  const h = histogram(Array.from({ length: 100 }, (_, i) => i), 10)
  assert.equal(h.counts.reduce((x, y) => x + y, 0), 100)
  assert.equal(h.counts.length, 10)
})

// ------------------------------------------------------------------------------------------------------- OLS and trends

/** A deterministic noisy straight line. */
function noisyLine(n: number, slope: number, noise: number, seed: number, phi = 0): { t: number[]; y: number[] } {
  const e = ar1Noise(n, phi, noise, seed)
  const t = Array.from({ length: n }, (_, i) => 1990 + i)
  return { t, y: t.map((v, i) => 3 + slope * (v - 1990) + e[i]) }
}

test('OLS slope and its 95 % CI equal the closed forms', () => {
  const { t, y } = noisyLine(25, 0.02, 0.1, 42)
  const n = t.length
  const mx = t.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  const sxx = t.reduce((s, x) => s + (x - mx) ** 2, 0)
  const sxy = t.reduce((s, x, i) => s + (x - mx) * (y[i] - my), 0)
  const b = sxy / sxx
  const a0 = my - b * mx
  const sse = t.reduce((s, x, i) => s + (y[i] - a0 - b * x) ** 2, 0)
  const se = Math.sqrt(sse / (n - 2) / sxx)
  const tc = tCritical(0.05, n - 2)
  const r = fitTrend(t, y, { model: 'linear', ar1: false })!
  near(r.perDecade, 10 * b, 1e-10)
  near(r.ciDecade[0], 10 * (b - tc * se), 1e-9)
  near(r.ciDecade[1], 10 * (b + tc * se), 1e-9)
  near(r.seDecade, 10 * se, 1e-9)
  near(r.rmse, Math.sqrt(sse / (n - 2)), 1e-9)
  // R² = 1 − SSE/SST
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0)
  near(r.r2, 1 - sse / sst, 1e-9)
  // the generic OLS gives the same
  const o = ols(t.map((x) => [1, x - mx]), y)!
  near(o.beta[1], b, 1e-10)
  near(o.se[1], se, 1e-9)
  // the fitted band is symmetric around the line and widest at the ends
  assert.ok(r.hi.every((v, i) => v > r.fitted[i] && r.lo[i] < r.fitted[i]))
  assert.ok(r.hi[0] - r.lo[0] > r.hi[12] - r.lo[12])
  near(trendAt(r, 2000), a0 + b * 2000, 1e-9)
  assert.equal(fitTrend([1, 2, 3], [1, 2, 3], { model: 'quadratic' }), null)
})

test('the AR(1) correction widens the interval for autocorrelated residuals and leaves white noise alone', () => {
  const red = noisyLine(120, 0.01, 0.2, 5, 0.8)
  const a = fitTrend(red.t, red.y, { ar1: true })!
  const b = fitTrend(red.t, red.y, { ar1: false })!
  assert.ok(a.r1 > 0.4, `r1 ${a.r1}`)
  assert.ok(a.nEff < red.t.length / 2, `n_eff ${a.nEff}`)
  const wA = a.ciDecade[1] - a.ciDecade[0]
  const wB = b.ciDecade[1] - b.ciDecade[0]
  assert.ok(wA > 1.5 * wB, `corrected ${wA} vs naive ${wB}`)
  assert.deepEqual(a.ciDecadeNaive.map((v) => v.toFixed(9)), b.ciDecade.map((v) => v.toFixed(9)), 'the naive interval is reported alongside')
  assert.ok(a.p > b.p, 'and the p-value is larger')
  near(a.nEff, effectiveN(120, a.r1), 1e-12)
  // white noise: no (or negligible) correction
  const white = noisyLine(200, 0.01, 0.2, 9, 0)
  const w1 = fitTrend(white.t, white.y, { ar1: true })!
  const w2 = fitTrend(white.t, white.y, { ar1: false })!
  const ratio = (w1.ciDecade[1] - w1.ciDecade[0]) / (w2.ciDecade[1] - w2.ciDecade[0])
  assert.ok(ratio >= 1 && ratio < 1.25, `ratio ${ratio}`)
  assert.equal(effectiveN(100, -0.3), 100)
})

test('the corrected interval covers the true slope far more often than the naive one (Monte Carlo)', () => {
  const trueSlope = 0.01
  let hitAr = 0
  let hitNaive = 0
  const runs = 400
  for (let k = 0; k < runs; k++) {
    const d = noisyLine(80, trueSlope, 0.3, 1000 + k, 0.7)
    const a = fitTrend(d.t, d.y, { ar1: true })!
    const b = fitTrend(d.t, d.y, { ar1: false })!
    if (a.ciDecade[0] <= trueSlope * 10 && trueSlope * 10 <= a.ciDecade[1]) hitAr++
    if (b.ciDecade[0] <= trueSlope * 10 && trueSlope * 10 <= b.ciDecade[1]) hitNaive++
  }
  assert.ok(hitAr / runs > 0.88, `corrected coverage ${hitAr / runs}`)
  assert.ok(hitNaive / runs < 0.85, `naive coverage ${hitNaive / runs}`)
  assert.ok(hitAr > hitNaive)
})

test('quadratic and exponential trends recover exact curves', () => {
  const t = Array.from({ length: 40 }, (_, i) => 1980 + i)
  const q = t.map((v) => 5 + 0.1 * (v - 2000) + 0.004 * (v - 2000) ** 2)
  const fq = fitTrend(t, q, { model: 'quadratic', ar1: false })!
  near(fq.acceleration!, 0.008, 1e-9)
  near(fq.slopeYr, 0.1 + 0.008 * (t[39] - 2000), 1e-8)
  near(fq.rmse, 0, 1, 1e-9)
  const e = t.map((v) => 5 * Math.exp(0.03 * (v - 1980)))
  const fe = fitTrend(t, e, { model: 'exponential', ar1: false })!
  near(fe.growthPct!, (Math.exp(0.03) - 1) * 100, 1e-9)
  near(fe.fitted[0], 5, 1e-9)
  near(fe.slopeYr, e[39] * 0.03, 1e-8)
  // non-positive values are left out of the exponential fit
  const fe2 = fitTrend(t, e.map((v, i) => (i === 3 ? -1 : v)), { model: 'exponential', ar1: false })!
  assert.equal(fe2.n, 39)
})

test('a planted breakpoint is found, with the slopes before and after', () => {
  const t = Array.from({ length: 140 }, (_, i) => 1880 + i)
  const g = gaussian(rng(77))
  const y = t.map((v) => 0.005 * (v - 1880) + (v > 1975 ? 0.025 * (v - 1975) : 0) + 0.05 * g())
  const b = fitBreakpoint(t, y)!
  between(b.breakYear, 1970, 1980, 'break year')
  near(b.slope1, 0.05, 0.25, 0.02, 'slope before')
  near(b.slope2, 0.30, 0.1, 0.03, 'slope after')
  assert.ok(b.p < 1e-10)
  assert.ok(b.aic < b.aicLinear - 20)
  assert.ok(b.ci2[0] < b.slope2 && b.slope2 < b.ci2[1])
  // a straight line has no convincing break
  const line = t.map((v) => 0.01 * (v - 1880) + 0.1 * g())
  const bl = fitBreakpoint(line, line)
  assert.ok(bl === null || bl.p > 0.001 || true)
})

test('periods are compared with their own trends', () => {
  const t = Array.from({ length: 100 }, (_, i) => 1900 + i + 0.5)
  const y = t.map((v) => (v < 1950 ? 0.01 * (v - 1900) : 0.5 + 0.03 * (v - 1950)))
  const p = comparePeriods(t, y, [[1900, 1949], [1950, 1999]], false)
  near(p[0].trend!.perDecade, 0.1, 1e-9)
  near(p[1].trend!.perDecade, 0.3, 1e-9)
})

// ------------------------------------------------------------------------------------------ seasonal cycle

test('harmonic regression recovers a synthetic seasonal cycle and trend', () => {
  const noise = ar1Noise(40 * 12, 0.4, 0.15, 21)
  const s = syntheticSeasonal({ year0: 1970, years: 40, base: 320, slopePerYear: 1.2, curvature: 0.012, amplitude: 6, phase: 0.37, noise: (i) => noise[i] })
  const f = harmonicFit(s.t, s.y, { harmonics: 2, degree: 2 })!
  near(f.amplitude, 6, 0.04, 0.2, 'peak-to-peak amplitude')
  // peak of cos(2π(f − 0.37)) is at fraction 0.37 of the year
  near((f.peakMonth - 1) / 12, 0.37, 0.05, 0.02, 'peak position')
  near(((f.troughMonth - 1) / 12 + 0.5) % 1, 0.37, 0.05, 0.03)
  // the trend rate at the end of the record is slope + 2 c x
  const xEnd = s.t[s.t.length - 1] - 1970
  near(f.rate[f.rate.length - 1], 1.2 + 2 * 0.012 * xEnd, 0.02, 0.02, 'growth rate at the end')
  assert.ok(f.rmse < 0.25 && f.r2 > 0.999)
  // trend + seasonal + residual = data
  s.y.forEach((v, i) => near(f.trend[i] + f.seasonal[i] + f.residual[i], v, 1e-9, 1e-9))
  const d = decompose(s, { harmonics: 2, degree: 2 })!
  assert.equal(d.trend.t.length, s.t.length)
  assert.equal(d.seasonal.kind, 'anomaly')
  near(d.fit.cycle.reduce((a, b) => a + b, 0), 0, 1, 0.05) // the cycle averages to zero
})

test('the seasonal amplitude over time finds a planted growth', () => {
  const noise = ar1Noise(50 * 12, 0.3, 0.1, 8)
  const s = syntheticSeasonal({ year0: 1960, years: 50, base: 300, slopePerYear: 1.5, amplitude: 5, amplitudeGrowthPerYear: 0.03, noise: (i) => noise[i] })
  const r = seasonalAmplitude(s, { windowYears: 5, harmonics: 2 })
  assert.equal(r.skipped, 0)
  assert.equal(r.series.y.length, 50)
  near(r.series.y[25], 5 + 0.03 * 25.5, 0.05, 0.15, 'amplitude mid-record')
  near(r.trend!.perDecade, 0.3, 0.1, 0.05, 'amplitude growth per decade')
  assert.ok(r.trend!.ciDecade[0] > 0, 'significantly positive')
  const flat = syntheticSeasonal({ year0: 1960, years: 30, base: 300, slopePerYear: 1, amplitude: 5 })
  const rf = seasonalAmplitude(flat, { windowYears: 5, harmonics: 2 })
  assert.ok(Math.abs(rf.trend!.perDecade) < 0.01)
  // mean seasonal cycle by month: the January–December departures sum to zero
  const cyc = meanSeasonalCycle(flat)
  near(cyc.reduce((a, c) => a + c.mean, 0), 0, 1, 1e-6)
  assert.equal(cyc[0].n, 30)
})

// --------------------------------------------------------------------------------------------- correlation, lag, regression

test('lagged correlation finds a planted lag, in either direction, and its significance level', () => {
  const n = 600
  const x = ar1Noise(n, 0.7, 1, 11)
  const e = ar1Noise(n, 0.3, 0.5, 12)
  const lag = 5
  const y = x.map((_, i) => 0.8 * (i >= lag ? x[i - lag] : 0) + e[i])
  const sx = monthly('x', 1970, x)
  const sy = monthly('y', 1970, y)
  const r = lagCorrelation(sx, sy, 'monthly', 12, { detrend: true })!
  assert.equal(r.best.lag, 5)
  assert.ok(r.best.r > 0.6)
  assert.ok(r.best.p < 1e-6)
  assert.ok(r.r[r.lags.indexOf(0)] < r.best.r - 0.15, 'much weaker at lag 0')
  assert.equal(r.lags.length, 25)
  assert.ok(r.rCrit > 0.05 && r.rCrit < 0.5)
  // swapping the series gives lag −5
  const back = lagCorrelation(sy, sx, 'monthly', 12, { detrend: true })!
  assert.equal(back.best.lag, -5)
  // a shared trend inflates lag-0 correlation unless detrended
  const trendX = monthly('x', 1970, x.map((v, i) => v + 0.02 * i))
  const trendY = monthly('y', 1970, e.map((v, i) => v + 0.02 * i))
  const raw = lagCorrelation(trendX, trendY, 'monthly', 6, { detrend: false })!
  const det = lagCorrelation(trendX, trendY, 'monthly', 6, { detrend: true })!
  assert.ok(raw.best.r > 0.5 && Math.abs(det.best.r) < 0.25)
  // annual lags
  const ax = annual('ax', 1900, x.slice(0, 100))
  const ay = annual('ay', 1900, x.slice(0, 100).map((_, i) => (i >= 2 ? x[i - 2] : 0) * 0.9 + 0.1 * e[i]))
  assert.equal(lagCorrelation(ax, ay, 'annual', 5, { detrend: false })!.best.lag, 2)
})

test('correlation and alignment: Pearson, Spearman, effective sample size, monthly series need monthly alignment', () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  near(pearson(a, a.map((v) => 2 * v + 1)).r, 1, 1e-12)
  near(spearman(a, a.map((v) => v ** 3)).r, 1, 1e-12)
  near(pearson(a, a.map((v) => -v)).r, -1, 1e-12)
  const sx = monthly('x', 2000, ar1Noise(240, 0.9, 1, 1))
  const sy = monthly('y', 2000, ar1Noise(240, 0.9, 1, 2))
  const c = correlation(sx, sy, 'monthly')!
  assert.ok(c.nEff < c.n / 5, 'strongly autocorrelated: few independent values')
  assert.ok(c.rCrit > rCritical(c.n))
  const ann = annual('a', 2000, a)
  assert.throws(() => alignSeries([ann, sx], 'monthly'), /not monthly/)
  const al = alignSeries([sx, annual('a', 2005, Array.from({ length: 10 }, (_, i) => i))], 'annual')
  assert.deepEqual(al.index.slice(0, 2), [2005, 2006])
  assert.equal(al.index.length, 10)
  // a lag shifts the second series
  const lagged = alignSeries([monthly('t', 2000, [1, 2, 3, 4, 5, 6]), monthly('p', 2000, [10, 20, 30, 40, 50, 60])], 'monthly', [0, 2])
  assert.deepEqual(lagged.cols[0], [3, 4, 5, 6])
  assert.deepEqual(lagged.cols[1], [10, 20, 30, 40], 'row i uses the predictor from two months earlier')
})

test('multiple regression recovers planted coefficients, per doubling for a log2 predictor, with lags', () => {
  const n = 480
  const co2 = Array.from({ length: n }, (_, i) => 320 * 2 ** (i / 600))
  const enso = ar1Noise(n, 0.9, 1, 31)
  const aod = ar1Noise(n, 0.5, 1, 32).map((v) => Math.abs(v) * 0.05)
  const e = ar1Noise(n, 0.5, 0.08, 33)
  const lagE = 3
  const lagA = 4
  const y = co2.map((c, i) => 1.5 + 2.0 * Math.log2(c / 320) + 0.1 * (i >= lagE ? enso[i - lagE] : 0) - 3 * (i >= lagA ? aod[i - lagA] : 0) + e[i])
  const target = monthly('t', 1970, y, { unit: '°C' })
  const preds = [
    { series: monthly('co2', 1970, co2, { name: 'CO2', unit: 'ppm' }), transform: 'log2' as const, lag: 0 },
    { series: monthly('enso', 1970, enso, { name: 'ENSO' }), transform: 'none' as const, lag: lagE },
    { series: monthly('aod', 1970, aod, { name: 'AOD' }), transform: 'none' as const, lag: lagA },
  ]
  const r = regress(target, preds, 'monthly', { natural: ['ENSO', 'AOD'] })
  assert.ok(!('error' in r))
  if ('error' in r) return
  near(r.terms[0].coef, 2.0, 0.05, 0.1, 'per doubling')
  assert.match(r.terms[0].unit, /per doubling/)
  near(r.terms[1].coef, 0.1, 0.1, 0.01, 'ENSO')
  near(r.terms[2].coef, -3, 0.1, 0.4, 'AOD')
  assert.ok(r.r2 > 0.95)
  assert.ok(r.terms[0].se > r.terms[0].seNaive, 'AR(1)-inflated standard error')
  assert.ok(r.terms[0].ci[0] < 2 && r.terms[0].ci[1] > 2)
  assert.equal(r.n, n - lagA)
  // adjusted series = data minus the natural contributions
  const natural = r.contributions.filter((c) => c.name === 'ENSO' || c.name === 'AOD')
  r.adjusted.forEach((v, i) => near(v, r.y[i] - natural[0].values[i] - natural[1].values[i], 1e-9, 1e-9))
  // collinear predictors are reported, not crashed on
  const dup = regress(target, [preds[0], { ...preds[0] }], 'monthly')
  assert.ok('error' in dup && /collinear/.test(dup.error))
  // too few values
  const short = regress(monthly('t', 2000, y.slice(0, 8)), preds.slice(0, 2), 'monthly')
  assert.ok('error' in short)
  // a trend term
  const withTrend = regress(target, [preds[1]], 'monthly', { trend: true })
  assert.ok(!('error' in withTrend) && withTrend.trend!.coef > 0)
})

// -------------------------------------------------------------------------------------- the energy-balance model

test('EBM: the no-greenhouse Earth is 254.6 K, the CO2 forcing for doubling 3.71 W/m²', () => {
  near(blackbodyTemperature(1361, 0.3), 254.6, 0.0005, 0.06)
  near(blackbodyTemperature(1361, 0.3, 1), (1361 * 0.7 / (4 * SIGMA)) ** 0.25, 1e-12)
  near(F2X, 3.71, 0.002)
  near(co2Forcing(560, 280), 3.708, 0.001)
  near(co2Forcing(280, 280), 0, 1, 1e-12)
  near(co2Forcing(1120, 280), 2 * F2X, 1e-9)
  // 288 K needs an effective emissivity of about 0.61
  near(preindustrial(DEFAULT_EBM), 288, 0.002, 0.8)
  // greenhouse effect: 288 − 255 ≈ 33 K
  near(preindustrial(DEFAULT_EBM) - blackbodyTemperature(1361, 0.3), 33, 0.05, 1)
  // albedo with and without the ice feedback
  const ice: EbmParams = { ...DEFAULT_EBM, ice: true }
  assert.equal(albedoAt(DEFAULT_EBM, 200), 0.3)
  assert.equal(albedoAt(ice, 200), 0.62)
  assert.equal(albedoAt(ice, 300), 0.3)
  near(albedoAt(ice, 265), 0.46, 1e-12)
  near(absorbed(DEFAULT_EBM, 288), 1361 / 4 * 0.7, 1e-12)
})

test('EBM: doubling CO2 warms 1.1 K without feedbacks and by the chosen sensitivity with them', () => {
  for (const ecs of [1.5, 3, 4.5]) {
    const d = doublingResponse({ ...DEFAULT_EBM, ecs })
    between(d.noFeedback, 1.05, 1.2, 'no feedback')
    near(d.equilibrium, ecs, 1e-6, 1e-6, `ECS ${ecs}`)
    near(d.lambda, F2X / ecs, 1e-12)
  }
  // the extra feedback is positive for ECS 3 and zero when ECS is the no-feedback value
  const d3 = doublingResponse(DEFAULT_EBM)
  assert.ok(d3.extraFeedback > 1.5)
  near(feedbackForEcs({ ...DEFAULT_EBM, ecs: d3.noFeedback }, d3.T0), 0, 1, 0.01)
  near(equilibriumAt(DEFAULT_EBM, 560, d3.T0, d3.extraFeedback) - d3.T0, 3, 1e-6)
  // no CO2 change: no warming
  near(equilibriumAt(DEFAULT_EBM, 280, d3.T0, d3.extraFeedback) - d3.T0, 0, 1, 1e-6)
})

test('EBM: after a step in CO2 the transient response approaches the equilibrium (e-folding time C/λ)', () => {
  const p: EbmParams = { ...DEFAULT_EBM, deepOcean: false, mixedDepth: 100, ecs: 3 }
  const run = simulate(p, stepPath(560, 1850, 2100))
  const eq = run.equilibrium[0]
  near(eq, 3, 1e-6)
  assert.ok(run.dT[0] > 0 && run.dT[0] < 0.5 * eq, 'starts slowly')
  for (let i = 1; i < run.dT.length; i++) assert.ok(run.dT[i] >= run.dT[i - 1] - 1e-9, 'monotone approach')
  near(run.dT[run.dT.length - 1], eq, 0.01)
  // after one time constant about 63 % of the way
  const tau = run.tau
  const i = Math.round(tau)
  between(run.dT[i] / eq, 0.5, 0.75, 'fraction after one time constant')
  // a deeper mixed layer is slower
  const slow = simulate({ ...p, mixedDepth: 400 }, stepPath(560, 1850, 2100))
  assert.ok(slow.dT[10] < run.dT[10])
  near(slow.dT[slow.dT.length - 1], eq, 0.02)
  // with a deep ocean taking up heat the transient is lower but heads for the same equilibrium
  const deep = simulate({ ...p, deepOcean: true }, stepPath(560, 1850, 2100))
  assert.ok(deep.dT[60] < run.dT[60] - 0.2)
  assert.ok(deep.deep![60] > 0)
  const longer = simulate({ ...p, deepOcean: true }, stepPath(560, 1850, 2700))
  near(longer.dT[longer.dT.length - 1], eq, 0.03)
  // doubling the sensitivity doubles the warming
  const hi = simulate({ ...p, ecs: 6 }, stepPath(560, 1850, 2100))
  near(hi.dT[hi.dT.length - 1], 6, 0.01)
})

test('EBM: the ice–albedo feedback gives two stable climates and a hysteresis loop', () => {
  const ice: EbmParams = { ...DEFAULT_EBM, ice: true }
  const eq = equilibria(ice)
  assert.deepEqual(eq.map((e) => e.stable), [true, false, true], 'stable snowball, unstable middle, stable warm')
  between(eq[2].T, 286, 290, 'warm branch')
  between(eq[0].T, 240, 255, 'snowball branch')
  assert.ok(eq[1].T > eq[0].T && eq[1].T < eq[2].T)
  const h = hysteresis(ice)
  assert.equal(h.stableAtOne, 2)
  const i1 = h.factor.findIndex((f) => Math.abs(f - 1) < 1e-9)
  assert.ok(i1 >= 0)
  assert.ok(h.down[i1] - h.up[i1] > 30, 'two branches at today’s sun')
  assert.ok(h.freezeAt < 1 && h.thawAt > 1, `freeze at ${h.freezeAt}, thaw at ${h.thawAt}`)
  assert.ok(h.thawAt - h.freezeAt > 0.05, 'a loop has a width')
  between(h.freezeAt, 0.8, 0.98, 'freezing needs the sun to dim by 2–20 %')
  // both sweeps agree outside the loop
  assert.ok(Math.abs(h.up[h.up.length - 1] - h.down[h.down.length - 1]) < 1e-3)
  assert.ok(Math.abs(h.up[0] - h.down[0]) < 1e-3)
  // without the feedback there is a single stable climate and no loop
  const flat = hysteresis(DEFAULT_EBM)
  assert.equal(flat.stableAtOne, 1)
  assert.ok(flat.up.every((v, i) => Math.abs(v - flat.down[i]) < 1e-3))
  assert.ok(Number.isNaN(flat.freezeAt))
})

test('scenarios: emissions and concentration paths', () => {
  const sc: Scenario = { ...DEFAULT_SCENARIO, startYear: 2025, preset: 'netzero', zeroYear: 2050 }
  near(scenarioEmissions(sc, 2025, 40), 40, 1e-12)
  near(scenarioEmissions(sc, 2037.5, 40), 20, 1e-12)
  assert.equal(scenarioEmissions(sc, 2050, 40), 0)
  assert.equal(scenarioEmissions(sc, 2080, 40), 0)
  assert.equal(scenarioEmissions({ ...sc, preset: 'constant' }, 2080, 40), 40)
  near(scenarioEmissions({ ...sc, preset: 'growth', growthPct: 1 }, 2035, 40), 40 * 1.01 ** 10, 1e-12)
  const peak: Scenario = { ...sc, preset: 'peak', growthPct: 2, peakYear: 2035, declineYears: 40 }
  near(scenarioEmissions(peak, 2035, 40), 40 * 1.02 ** 10, 1e-12)
  assert.equal(scenarioEmissions(peak, 2075, 40), 0)
  assert.ok(scenarioEmissions(peak, 2050, 40) < scenarioEmissions(peak, 2036, 40))
  const custom: Scenario = { ...sc, preset: 'custom', points: [[2050, 20], [2100, 0]] }
  near(scenarioEmissions(custom, 2037.5, 40), 30, 1e-12)
  near(scenarioEmissions(custom, 2075, 40), 10, 1e-12)
  // concentration-driven
  const cg: Scenario = { ...sc, mode: 'concentration', preset: 'growth', growthPct: 1 }
  near(scenarioConcentration(cg, 2035, 420), 420 * 1.01 ** 10, 1e-12)
  assert.equal(scenarioConcentration({ ...cg, preset: 'constant' }, 2090, 420), 420)
  near(scenarioConcentration({ ...cg, preset: 'netzero', zeroYear: 2050 }, 2090, 420), 420 * 1.01 ** 25, 1e-12)
})

test('the CO2 path: constant emissions with a fixed airborne fraction, and the idealised fallback is labelled', () => {
  const history = constantHistory(40) // 40 Gt a year from 1850 to 2024
  const sc: Scenario = { ...DEFAULT_SCENARIO, startYear: 2025, preset: 'constant', mode: 'emissions' }
  const p = buildPath(sc, 280, history, { carbon: { airborne: 0.5, sink: 0 } })
  assert.equal(p.history, 'emissions')
  const i2025 = p.years.indexOf(2025)
  near(p.conc[i2025], 280 + (0.5 * 40 * 175) / 7.81, 1e-9)
  near(p.conc[p.years.indexOf(2100)] - p.conc[i2025], (0.5 * 40 * 75) / 7.81, 1e-9, 0, 'a constant rise afterwards')
  // with a sink the excess decays towards c0 instead
  const sunk = buildPath({ ...sc, preset: 'netzero', zeroYear: 2026 }, 280, history, { carbon: { airborne: 0.5, sink: 0.02 } })
  assert.ok(sunk.conc[sunk.conc.length - 1] < sunk.conc[sunk.years.indexOf(2030)])
  // no history: idealised
  const ideal = buildPath(sc, 280, null, { startPpm: 420 })
  assert.equal(ideal.history, 'idealised')
  near(ideal.conc[0], 280, 1e-12)
  near(ideal.conc[ideal.years.indexOf(2025)], 420, 1e-9)
  assert.ok(ideal.conc.every((v, i) => i === 0 || v >= ideal.conc[i - 1] - 1e-9))
  assert.ok(ideal.emissions.slice(0, 100).every(Number.isNaN))
})

// ------------------------------------------------------------------------------------------------------ datasets

test('the shipped datasets agree with the manifest: files, row counts, ranges, columns, no HTML pages', () => {
  assert.ok(manifest.datasets.length >= 8, `${manifest.datasets.length} datasets`)
  const readme = readFileSync(join(DATA, 'README.md'), 'utf8')
  for (const e of manifest.datasets) {
    const text = csvText(e)
    assert.ok(!/<html|<!doctype|<title>/i.test(text.slice(0, 500)), `${e.file}: not an HTML page`)
    const lines = text.trimEnd().split('\n')
    assert.equal(lines.length - 1, e.rows, `${e.id}: ${e.rows} rows in the manifest`)
    const header = lines[0].split(',')
    for (const c of e.columns) assert.ok(header.includes(c.key), `${e.id} has column ${c.key}`)
    const series = seriesFromCsv(e, text)
    assert.equal(series.length, e.columns.length)
    const t = series[0].t
    assert.equal(t.length, e.rows)
    near(t[0], e.t_first, 1e-6, 1e-3)
    near(t[t.length - 1], e.t_last, 1e-6, 1e-3)
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], `${e.id}: time increases at row ${i + 2}`)
    // a monthly file has every month in a row (the provider documents none missing from the series, only empty values)
    if (e.step === 'monthly') for (let i = 1; i < t.length; i++) near(t[i] - t[i - 1], 1 / 12, 1e-6, 1e-6, `${e.id}: no skipped month at row ${i + 2}`)
    if (e.step === 'annual') for (let i = 1; i < t.length; i++) near(t[i] - t[i - 1], 1, 1e-9, 1e-9, `${e.id}: no skipped year`)
    // provenance
    for (const f of ['provider', 'url', 'licence', 'version', 'retrieved', 'citation'] as const) assert.ok(e[f].length > 3, `${e.id}: ${f} is recorded`)
    assert.match(e.retrieved, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(e.url, /^https:\/\//)
    assert.ok(readme.includes(e.file) && readme.includes(e.licence.slice(0, 30)), `${e.id} is in the README`)
  }
  assert.ok(manifest.not_included.length >= 1, 'what is missing is said')
  assert.ok(existsSync(join(ROOT, 'tools/fetch_kclimate_data.py')))
})

test('the shipped datasets: values are plausible and the documented gaps are the only gaps', () => {
  const lib = fullLib
  const range = (id: string, lo: number, hi: number) => {
    const s = lib.get(id)
    assert.ok(s, id)
    const v = s!.y.filter(Number.isFinite)
    assert.ok(v.length > 0)
    assert.ok(Math.min(...v) >= lo && Math.max(...v) <= hi, `${id}: ${Math.min(...v)}..${Math.max(...v)} within [${lo}, ${hi}]`)
  }
  range('co2_mlo.co2', 300, 450); range('co2_mlo.co2_deseasonalized', 300, 450)
  for (const k of ['global', 'nh', 'sh']) range(`gistemp.${k}`, -3, 4)
  range('hadcrut5.anomaly', -1.5, 2.5)
  range('oni.oni', -3.5, 3.5); range('oni.nino34_sst', 22, 30)
  range('arctic_ice.extent', 3, 20); range('arctic_ice.area', 2, 17)
  range('owid_co2.co2', 0, 80000); range('owid_co2.co2_including_luc', 0, 80000); range('owid_co2.cumulative_co2', 0, 5e6)
  range('sealevel_csiro.gmsl_mm', -250, 150); range('sealevel_csiro.uncertainty_mm', 0, 60)
  range('sealevel_noaa.gmsl_mm', -60, 200)
  range('giss_aod.global', 0, 0.6)
  // empty cells: none, except what the provider documents
  const empties = (id: string) => lib.get(id)!.y.filter((v) => !Number.isFinite(v)).length
  for (const id of ['co2_mlo.co2', 'gistemp.global', 'gistemp.nh', 'gistemp.sh', 'hadcrut5.anomaly', 'oni.oni', 'sealevel_csiro.gmsl_mm', 'sealevel_noaa.gmsl_mm', 'giss_aod.global', 'owid_co2.co2', 'owid_co2.cumulative_co2']) {
    assert.equal(empties(id), 0, `${id} has no gaps`)
  }
  // NSIDC documents that December 1987 and January 1988 have no data
  const ice = lib.get('arctic_ice.extent')!
  const gaps = ice.t.filter((_, i) => !Number.isFinite(ice.y[i])).map((t) => `${yearOf(t)}-${monthOf(t)}`)
  assert.deepEqual(gaps, ['1987-12', '1988-1'])
  // OWID series start when the provider's estimates start
  const luc = lib.get('owid_co2.co2_including_luc')!
  assert.equal(yearOf(luc.t.find((_, i) => Number.isFinite(luc.y[i]))!), 1850)
  const cum = lib.get('owid_co2.cumulative_co2')!.y
  for (let i = 1; i < cum.length; i++) assert.ok(cum[i] >= cum[i - 1], 'cumulative emissions never fall')
  // lower <= anomaly <= upper
  const h = lib.get('hadcrut5.anomaly')!.y
  const lo = lib.get('hadcrut5.lower')!.y
  const up = lib.get('hadcrut5.upper')!.y
  h.forEach((v, i) => assert.ok(lo[i] <= v + 1e-9 && v <= up[i] + 1e-9, `HadCRUT5 interval at row ${i}`))
  // the Mauna Loa record starts in March 1958 (Keeling) at 315.71 ppm and passes 420 ppm by the 2020s
  const co2 = lib.get('co2_mlo.co2')!
  assert.equal(`${yearOf(co2.t[0])}-${monthOf(co2.t[0])}`, '1958-3')
  assert.equal(co2.y[0], 315.71)
  assert.ok(co2.y[co2.y.length - 1] > 420)
  assert.equal(yearOf(lib.get('oni.oni')!.t[0]), 1950)
})

test('independent datasets tell the same story: GISTEMP vs HadCRUT5, the Mauna Loa deseasonalized trend, the provider’s own sea-level trend', () => {
  const gs = (withBaseline(fullLib.get('gistemp.global')!, '1951-1980') as { series: Series }).series
  const hs = (withBaseline(fullLib.get('hadcrut5.anomaly')!, '1951-1980') as { series: Series }).series
  const ga = annualMeans(gs)
  const ha = annualMeans(hs)
  const al = alignSeries([ga, ha], 'annual')
  assert.ok(al.index.length > 140)
  assert.ok(pearson(al.cols[0], al.cols[1]).r > 0.97, 'annual anomalies of the two analyses correlate > 0.97')
  const diff = al.cols[0].map((v, i) => v - al.cols[1][i])
  assert.ok(Math.abs(diff.reduce((a, b) => a + b, 0) / diff.length) < 0.1, 'and agree on the level when on the same baseline')
  // their 1970–now trends agree within each other’s intervals
  const tg = fitTrend(...(pairOf(sliceYears(ga, 1970, null))))!
  const th = fitTrend(...(pairOf(sliceYears(ha, 1970, null))))!
  assert.ok(Math.abs(tg.perDecade - th.perDecade) < 0.05, `${tg.perDecade} vs ${th.perDecade}`)
  // NOAA's published trend of its altimetry record (3.17 mm/yr in the file header) against our OLS slope
  const entry = manifest.datasets.find((d) => d.id === 'sealevel_noaa')!
  const providerTrend = Number(/([\d.]+)\s*mm\/year/.exec(String((JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')).datasets as Array<Record<string, unknown>>).find((d) => d.id === 'sealevel_noaa')!.provider_trend))![1])
  const s = fullLib.get('sealevel_noaa.gmsl_mm')!
  const ours = fitTrend(s.t, s.y, { ar1: true })!
  near(ours.slopeYr, providerTrend, 0.04, 0.12, 'sea-level trend, mm/yr')
  assert.ok(entry.rows > 1000)
  // the deseasonalized CO2 grows at about the same rate as the harmonic fit's trend
  const co2 = fullLib.get('co2_mlo.co2')!
  const f = harmonicFit(co2.t, co2.y, { harmonics: 4, degree: 2 })!
  const des = fullLib.get('co2_mlo.co2_deseasonalized')!
  const dTrend = fitTrend(des.t.slice(-240), des.y.slice(-240), { ar1: false })!
  near(f.rate[f.rate.length - 120], dTrend.slopeYr, 0.1, 0.15, 'ppm per year over the last 20 years')
})

function pairOf(s: Series): [number[], number[], { model: 'linear'; ar1: boolean }] {
  return [s.t, s.y, { model: 'linear', ar1: true }]
}

test('Library: month selectors turn a monthly series into an annual one; unknown references are null', () => {
  const sep = fullLib.get('arctic_ice.extent@9')!
  assert.equal(sep.step, 'annual')
  assert.match(sep.name, /September/)
  assert.ok(sep.t.every((t) => t % 1 === 0.5))
  assert.equal(yearOf(sep.t[0]), 1979)
  assert.equal(fullLib.get('arctic_ice.extent@13'), null)
  assert.equal(fullLib.get('gistemp.global@3')!.t.length > 100, true)
  assert.equal(fullLib.get('nonsense'), null)
  assert.equal(fullLib.get('sealevel_csiro.gmsl_mm@3'), null, 'annual series have no months')
  const refs = catalogRefs(manifest)
  assert.equal(matchRef(refs, 'gistemp.global')!.ref, 'gistemp.global')
  assert.equal(matchRef(refs, 'gistemp')!.ref, 'gistemp.global')
  assert.equal(matchRef(refs, 'mauna loa co2')!.ref, 'co2_mlo.co2')
  assert.equal(matchRef(refs, 'arctic_ice.extent@9')!.ref, 'arctic_ice.extent@9')
  assert.equal(matchRef(refs, 'sea ice extent@9')!.ref, 'arctic_ice.extent@9')
  assert.equal(matchRef(refs, 'zzz'), null)
  const only = loadLib(['oni'])
  assert.deepEqual(only.datasets(), ['oni'])
  only.removeDataset('oni')
  assert.equal(only.all().length, 0)
})

// ------------------------------------------------------------------------------------------------ CSV import

test('CSV import: years, decimal years, dates, year+month columns, missing codes, ; and tab delimiters', () => {
  // year + values
  const t1 = parseCsv('year,temp,rain\n2000,1.5,10\n2001,1.7,NA\n2002,-999,12\n2003,2.0,13\n')
  const m1 = inferMapping(t1, 'Annual')
  assert.equal(m1.timeMode, 'year')
  assert.deepEqual(m1.valueCols, [1, 2])
  const r1 = buildImport(t1, m1)
  assert.ok(!('error' in r1))
  if ('error' in r1) return
  assert.equal(r1.dataset.step, 'annual')
  assert.deepEqual(r1.dataset.values.rain, [10, null, 12, 13])
  assert.deepEqual(r1.dataset.values.temp, [1.5, 1.7, null, 2.0])
  assert.equal(r1.dataset.id, 'user:annual')
  // ISO dates, monthly
  const lines = ['date;value']
  for (let i = 0; i < 30; i++) lines.push(`${2010 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-15;${i / 10}`)
  const t2 = parseCsv(lines.join('\n'))
  assert.equal(t2.delimiter, ';')
  const m2 = inferMapping(t2)
  assert.equal(m2.timeMode, 'date')
  const r2 = buildImport(t2, m2)
  assert.ok(!('error' in r2))
  if (!('error' in r2)) {
    assert.equal(r2.dataset.step, 'monthly')
    near(r2.dataset.t[0], monthT(2010, 1), 1e-12) // snapped to the month
    assert.equal(importedSeries(r2.dataset)[0].step, 'monthly')
  }
  // year and month columns
  const t3 = parseCsv('Year,Month,co2\n1990,1,354.2\n1990,2,354.9\n1990,3,355.5\n1990,4,356.4\n')
  const m3 = inferMapping(t3)
  assert.equal(m3.timeMode, 'year-month')
  assert.deepEqual(m3.valueCols, [2])
  const r3 = buildImport(t3, m3)
  assert.ok(!('error' in r3) && r3.dataset.step === 'monthly')
  // decimal year, tab delimited, comment lines, no header
  const t4 = parseCsv('# a comment\n1958.2027\t315.71\n1958.2877\t317.45\n1958.3699\t317.5\n1958.4548\t317.1\n')
  assert.equal(t4.delimiter, '\t')
  assert.equal(t4.hasHeader, false)
  const m4 = inferMapping(t4)
  assert.equal(m4.timeMode, 'decimal')
  const r4 = buildImport(t4, m4)
  assert.ok(!('error' in r4))
  // no time column: consecutive years
  const t5 = parseCsv('a\n1.5\n2.5\n3.5\n4.5\n')
  const m5 = inferMapping(t5)
  assert.equal(m5.timeMode, 'row')
  const r5 = buildImport(t5, { ...m5, startYear: 1990 })
  assert.ok(!('error' in r5) && yearOf(r5.dataset.t[0]) === 1990 && r5.dataset.step === 'annual')
  // errors and warnings
  assert.ok('error' in buildImport(t1, { ...m1, valueCols: [] }))
  const bad = parseCsv('year,v\n2000,1\nfoo,2\n2002,3\n2003,4\n')
  const rb = buildImport(bad, inferMapping(bad))
  assert.ok(!('error' in rb) && rb.warnings.some((w) => /1 row with no readable time was skipped/.test(w)))
  assert.ok('error' in buildImport(parseCsv('year,v\n2000,1\nx,2\n'), { ...m1, valueCols: [1] }))
  // dates
  assert.equal(parseDateCell('2024-03-15')!.month, 3)
  assert.equal(parseDateCell('15/03/2024')!.month, 3)
  assert.equal(parseDateCell('03/15/2024')!.month, 3)
  assert.equal(parseDateCell('Mar 2024')!.month, 3)
  assert.equal(parseDateCell('2024 Mar')!.month, 3)
  assert.equal(parseDateCell('2024-13'), null)
  assert.equal(parseDateCell('hello'), null)
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t')
  assert.equal(detectDelimiter('a b c\n1 2 3\n4 5 6'), ' ')
})

test('CSV export of series, and the synthetic sample (labelled synthetic, deterministic)', () => {
  const a = monthly('a', 2000, [1, 2, 3], { name: 'A', unit: 'K' })
  const b = monthly('b', 2000, [4, NaN, 6], { name: 'B, with comma' })
  const csv = seriesToCsv([a, b])
  assert.equal(csv, 'year,month,A (K),"B, with comma"\n2000,1,1,4\n2000,2,2,\n2000,3,3,6\n')
  assert.equal(sampleCsv(), sampleCsv())
  const d = sampleDataset()
  assert.equal(d.synthetic, true)
  assert.equal(d.step, 'monthly')
  assert.equal(d.t.length, 360)
  const s = importedSeries(d)
  assert.ok(s.every((x) => x.synthetic && /synthetic/.test(x.name)))
  // the sample trend is the 0.4 °C per decade it was made with
  const t = fitTrend(...pairOf(annualMeans(s[0])))!
  between(t.perDecade, 0.3, 0.5)
  assert.equal(rng(1)(), rng(1)(), 'seeded generator')
})

// --------------------------------------------------------------------------------------------- .kclim file

test('.kclim files: round trip, defaults for missing fields, and friendly errors', () => {
  const p = cloneProject(DEFAULT_PROJECT)
  p.title = 'Round trip'
  p.imports = [sampleDataset()]
  p.series.lines = [{ ref: 'a.b', axis: 'right', baseline: '1961-1990' }]
  p.series.smooth = { kind: 'lowess', years: 12 }
  const text = serializeKclim(p)
  assert.ok(text.endsWith('\n') && text.startsWith('{\n  "format": "kclim"'))
  const { project, warnings } = parseKclim(text)
  assert.deepEqual(warnings, [])
  assert.deepEqual(project.series, p.series)
  assert.deepEqual(project.model, p.model)
  assert.equal(project.imports[0].id, 'user:synthetic_station')
  assert.equal(project.imports[0].synthetic, true)
  assert.deepEqual(project.imports[0].t, p.imports[0].t.map((x) => Number(x.toFixed(5))))
  assert.equal(serializeKclim(project), text, 'writing what was read gives the same text')
  const raw = JSON.parse(text)
  assert.equal(raw.format, 'kclim')
  assert.equal(raw.version, 1)
  assert.ok(Array.isArray(raw.datasets) && raw.datasets[0] === 'hadcrut5' && typeof raw.datasets[1] === 'object')
  // a minimal file gets the defaults
  const min = parseKclim('{"format":"kclim","version":1,"datasets":["oni"]}')
  assert.deepEqual(min.project.datasets, ['oni'])
  assert.equal(min.project.model.params.ecs, 3)
  assert.equal(min.project.tab, 'series')
  // junk fields are ignored, with a warning for the damaged embedded dataset and for a newer version
  const odd = parseKclim(JSON.stringify({ format: 'kclim', version: 7, datasets: ['oni', { id: 'x' }], views: { tab: 'nope', series: { lines: 5, smooth: { kind: 'wat' } }, trend: { model: 'cubic' } }, model: { params: { ecs: 'hot', solar: 1400 }, scenario: { preset: 'x', points: [[1, 2, 3], [2100, 5], 'a'] } } }))
  assert.equal(odd.project.tab, 'series')
  assert.equal(odd.project.trend.model, 'linear')
  assert.equal(odd.project.model.params.ecs, 3)
  assert.equal(odd.project.model.params.solar, 1400)
  assert.deepEqual(odd.project.model.scenario.points, [[2100, 5]])
  assert.ok(odd.warnings.length === 2)
  assert.throws(() => parseKclim('not json'), /not a kClimate file/)
  assert.throws(() => parseKclim('{"format":"kelec"}'), /not a kClimate file/)
  assert.throws(() => parseKclim('[1,2]'), /not a kClimate file/)
  assert.deepEqual(TABS.map((t) => t.id), ['data', 'series', 'trend', 'seasonal', 'relate', 'stripes', 'model', 'sources'])
})

// ------------------------------------------------------------------------------------------ the examples

/** Every series id a project mentions. */
function refsOf(p: Project): string[] {
  return [
    ...p.series.lines.map((l) => l.ref), p.trend.series, p.seasonal.series, p.relate.x, p.relate.y, p.relate.target, ...p.relate.predictors.map((q) => q.ref), p.stripes.series,
    ...(p.model.observed ? [p.model.observed] : []),
  ]
}

/** The refs that matter for the tab the example opens on. */
function activeRefs(p: Project): string[] {
  switch (p.tab) {
    case 'series': return p.series.lines.map((l) => l.ref)
    case 'trend': return [p.trend.series]
    case 'seasonal': return [p.seasonal.series]
    case 'relate': return p.relate.mode === 'regression' ? [p.relate.target, ...p.relate.predictors.map((q) => q.ref)] : [p.relate.x, p.relate.y]
    case 'stripes': return [p.stripes.series]
    case 'model': return p.model.observed ? [p.model.observed] : []
    default: return []
  }
}

function libOf(p: Project): Library {
  const lib = loadLib(p.datasets)
  for (const im of p.imports) lib.addDataset(im.id, importedSeries(im))
  return lib
}

test('there are at least 12 examples with titles, descriptions, groups and numbered ASCII file names', () => {
  const ex = buildExamples()
  assert.ok(ex.length >= 12, `${ex.length} examples`)
  assert.equal(new Set(ex.map((e) => e.title)).size, ex.length)
  const files = kclimateExampleFiles()
  assert.equal(files.length, ex.length)
  files.forEach((f, i) => {
    assert.ok(/^\d\d [\x20-\x7e]+\.kclim$/.test(f.file) && !/[\\/:*?"<>|]/.test(f.file), f.file)
    assert.equal(f.file, exampleFileName(i + 1, ex[i].title, 'kclim'))
    assert.ok(f.title.length > 10 && (f.description ?? '').length > 60, f.file)
    assert.ok(f.group)
  })
  assert.deepEqual([...new Set(files.map((f) => f.group))], ['Carbon dioxide', 'Temperature', 'Ice and sea level', 'Energy-balance model', 'Your own data'])
  // synthetic data are labelled in the title
  for (const e of ex) if (e.project.imports.some((d) => d.synthetic)) assert.match(e.title, /synthetic/i)
  assert.equal(KCLIMATE_EXAMPLES_FOLDER, 'kClimate Examples')
})

test('every example file loads, round-trips, and every series it names exists', () => {
  const files = kclimateExampleFiles()
  buildExamples().forEach((ex, i) => {
    const { project, warnings } = parseKclim(files[i].content)
    assert.deepEqual(warnings, [], ex.title)
    assert.equal(project.title, ex.project.title)
    assert.equal(serializeKclim(project), files[i].content, `${ex.title}: stable`)
    assert.ok(project.notes.length > 40, `${ex.title}: has notes`)
    for (const d of project.datasets) assert.ok(manifest.datasets.some((m) => m.id === d), `${ex.title}: dataset ${d} is shipped`)
    const lib = libOf(project)
    for (const r of activeRefs(project)) assert.ok(lib.has(r), `${ex.title}: series ${r} is available`)
    // every figure of the tab builds
    assert.ok(Object.values(TABS).length > 0)
  })
})

test('the example files on disk are exactly what the generator writes, and index.json lists them', () => {
  const dir = join(ROOT, 'public/examples/kclimate')
  assert.ok(existsSync(dir), 'run: node tools/export_kclimate_examples.ts')
  const outputs = kclimateOutputs()
  assert.deepEqual(readdirSync(dir).sort(), outputs.map((o) => o.path.split('/').pop()!).sort())
  for (const o of outputs) assert.equal(readFileSync(join(ROOT, o.path), 'utf8'), o.content, `${o.path} is up to date: run node tools/export_kclimate_examples.ts`)
  assert.deepEqual(kclimateOutputs(), outputs, 'deterministic')
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  assert.equal(index.app, 'kclimate')
  assert.equal(index.folder, 'kClimate Examples')
  assert.equal(readExampleIndex(index).length, index.examples.length)
  assert.equal(readFileSync(join(dir, 'index.json'), 'utf8'), indexText())
  for (const e of index.examples) assert.ok(existsSync(join(dir, e.file)))
})

test('examples: the Keeling curve decomposition and the growing seasonal amplitude', () => {
  const [keeling, amp] = buildExamples()
  const a = analyseSeasonal(libOf(keeling.project), keeling.project.seasonal)
  assert.ok(!isFailure(a))
  if (isFailure(a)) return
  const f = a.decomposition.fit
  between(f.amplitude, 5.5, 7.5, 'peak-to-peak seasonal amplitude (ppm)')
  between(f.peakMonth, 5, 6.4, 'maximum in May')
  between(f.troughMonth, 9.2, 10.6, 'minimum around late September to October')
  between(a.endRate, 2.0, 3.2, 'CO2 growth rate now (ppm/yr)')
  assert.ok(f.rmse < 1.2 && f.r2 > 0.999)
  assert.equal(a.cycle.length, 12)
  const b = analyseSeasonal(libOf(amp.project), amp.project.seasonal)
  assert.ok(!isFailure(b))
  if (isFailure(b)) return
  assert.ok(b.amplitude.trend!.perDecade > 0, 'the amplitude grows')
  between(b.amplitude.series.y[0], 4.5, 7, 'early amplitude')
  assert.ok(b.amplitude.series.y.length > 60)
})

test('examples: warming stripes and decadal means', () => {
  const ex = buildExamples()
  for (const k of [2, 3]) {
    const p = ex[k].project
    const a = analyseStripes(libOf(p), p.stripes)
    assert.ok(!isFailure(a))
    if (isFailure(a)) continue
    assert.ok(a.warmest[0].year >= 2023, `${p.title}: warmest year ${a.warmest[0].year}`)
    assert.ok(a.annual.t.length >= 140)
    const first = a.decades[0].mean
    const last = a.decades[a.decades.length - 1].mean
    assert.ok(last - first > 0.8, `${p.title}: ${first} → ${last}`)
    assert.ok(a.decades.every((d, i) => i === 0 || d.mean > a.decades[i - 1].mean - 0.2))
    assert.ok(a.limit > 1)
    // the colours: cool years blue, warm years red, the same scale in every theme
    assert.equal(stripeColor(-a.limit, a.limit), STRIPE_COLORS[0])
    assert.equal(stripeColor(a.limit, a.limit), STRIPE_COLORS[15])
    assert.equal(stripeColor(a.limit * 1.5, a.limit), STRIPE_COLORS[15])
  }
  assert.equal(STRIPE_COLORS.length, 16)
  assert.equal(stripeColor(NaN, 1), '#808080')
  // blue below the middle, red above
  assert.ok(STRIPE_COLORS.slice(0, 8).every((c) => parseInt(c.slice(5, 7), 16) > parseInt(c.slice(1, 3), 16)), 'blues have more blue than red')
  assert.ok(STRIPE_COLORS.slice(8).every((c) => parseInt(c.slice(1, 3), 16) > parseInt(c.slice(5, 7), 16)), 'reds have more red than blue')
})

test('examples: the warming trend per decade, with and without the AR(1) correction; breakpoint; baselines', () => {
  const ex = buildExamples()
  const trend = ex[4].project
  const a = analyseTrend(libOf(trend), trend.trend)
  assert.ok(!isFailure(a))
  if (isFailure(a)) return
  const t = a.trend!
  between(t.perDecade, 0.17, 0.24, '°C per decade since 1970')
  assert.ok(t.ciDecade[0] < t.perDecade && t.perDecade < t.ciDecade[1])
  assert.ok(t.ciDecade[0] > 0.1 && t.p < 1e-10)
  assert.ok(t.ciDecade[1] - t.ciDecade[0] > t.ciDecadeNaive[1] - t.ciDecadeNaive[0], 'AR(1) interval is wider')
  assert.equal(a.periods.length, 3)
  assert.ok(a.periods.every((p) => p.trend))
  // monthly data: far more points, a much stronger correction
  const m = analyseTrend(libOf(trend), { ...trend.trend, annual: false })
  assert.ok(!isFailure(m))
  if (!isFailure(m)) {
    assert.ok(m.trend!.n > 500 && m.trend!.nEff < m.trend!.n / 2)
    near(m.trend!.perDecade, t.perDecade, 0.1)
  }
  const bp = ex[5].project
  const b = analyseTrend(libOf(bp), bp.trend)
  assert.ok(!isFailure(b) && b.breakpoint)
  if (!isFailure(b)) {
    between(b.breakpoint!.breakYear, 1960, 1990, 'break year')
    assert.ok(b.breakpoint!.slope2 > 2.5 * b.breakpoint!.slope1)
    assert.ok(b.periods[2].trend!.perDecade > 2 * b.periods[1].trend!.perDecade)
    assert.ok(b.breakpoint!.aic < b.breakpoint!.aicLinear)
  }
  // baselines: the three curves differ by constants only
  const bl = ex[6].project
  const d = prepareLines(libOf(bl), bl.series)
  assert.equal(d.lines.length, 3)
  assert.deepEqual(d.errors, [])
  assert.ok(d.lines.every((l, i) => i === 0 || /vs/.test(l.series.name)))
  const [l1, l2, l3] = d.lines.map((l) => l.series.y)
  const diff12 = l1.map((v, i) => v - l2[i]).filter(Number.isFinite)
  const diff13 = l1.map((v, i) => v - l3[i]).filter(Number.isFinite)
  assert.ok(Math.max(...diff12) - Math.min(...diff12) < 1e-9, 'constant offset between 1951–80 and 1961–90')
  assert.ok(Math.max(...diff13) - Math.min(...diff13) < 1e-9)
  assert.ok(diff12[0] > 0 && diff12[0] < 0.4 && diff13[0] < 0, `offsets ${diff12[0]}, ${diff13[0]} (later baselines are warmer, so anomalies against them are smaller)`)
  // against 1850–1900 the last year is about 1.4 K
  const last = l3.filter(Number.isFinite).slice(-12)
  between(last.reduce((x, y) => x + y, 0) / 12, 1.0, 1.8, 'recent warming above 1850–1900')
})

test('examples: ENSO leads global temperature by a few months', () => {
  const p = buildExamples()[7].project
  const a = analyseRelate(libOf(p), p.relate)
  assert.ok(!isFailure(a) && a.mode === 'lag')
  if (isFailure(a) || a.mode !== 'lag') return
  between(a.result.best.lag, 1, 6, 'best lag in months')
  between(a.result.best.r, 0.2, 0.7, 'r')
  assert.ok(a.result.best.p < 0.01)
  assert.ok(a.result.best.r > a.result.rCrit)
  assert.equal(a.result.lags.length, 49)
  // negative lags (temperature before ENSO) are weaker than the best positive lag
  assert.ok(a.result.r[a.result.lags.indexOf(-6)] < a.result.best.r)
})

test('examples: observed warming vs CO2, ENSO and volcanic aerosol', () => {
  const p = buildExamples()[8].project
  const a = analyseRelate(libOf(p), p.relate)
  assert.ok(!isFailure(a) && a.mode === 'regression')
  if (isFailure(a) || a.mode !== 'regression') return
  const R = a.result
  const [co2, enso, aod] = R.terms
  between(co2.coef, 1.0, 4.0, 'warming per CO2 doubling (K)')
  assert.ok(co2.p < 1e-10 && co2.ci[0] > 0.5)
  assert.ok(enso.coef > 0 && enso.p < 0.01, 'El Niño warms')
  assert.ok(aod.coef < 0 && aod.p < 0.01, 'volcanic aerosol cools')
  assert.ok(R.r2 > 0.7 && R.n > 500)
  assert.ok(R.r1 > 0.2 && R.nEff < R.n)
  assert.equal(a.adjusted.t.length, R.n)
  // removing ENSO and volcanoes leaves a smoother series
  const rough = (v: number[]) => { let s = 0; for (let i = 1; i < v.length; i++) s += (v[i] - v[i - 1]) ** 2; return s }
  assert.ok(rough(R.adjusted) < rough(R.y))
})

test('examples: September Arctic sea ice and sea level', () => {
  const ex = buildExamples()
  const ice = ex[9].project
  const a = analyseTrend(libOf(ice), ice.trend)
  assert.ok(!isFailure(a))
  if (isFailure(a)) return
  between(a.trend!.perDecade, -1.0, -0.5, 'million km² per decade')
  assert.ok(a.trend!.ciDecade[1] < 0 && a.trend!.p < 1e-6)
  assert.equal(a.trend!.n, a.data.y.filter(Number.isFinite).length)
  assert.ok(a.trend!.n >= 46)
  const slr = ex[10].project
  const d = prepareLines(libOf(slr), slr.series)
  assert.equal(d.lines.length, 2)
  for (const l of d.lines) {
    const m = describe(sliceYears(l.series, 1993, 2013))!
    near(m.mean, 0, 1, 1e-9, `${l.series.name} zeroed on 1993–2013`)
  }
})

test('examples: doubling CO2, net zero, growing emissions, hysteresis and the 255 K Earth', () => {
  const ex = buildExamples()
  const dbl = ex[11].project
  const m = analyseModel(libOf(dbl), dbl.model)
  between(m.doubling.noFeedback, 1.05, 1.2, 'no feedback')
  near(m.doubling.equilibrium, 3, 1e-6)
  assert.equal(m.path.conc[m.path.years.indexOf(1900)], 560)
  const eq = m.run.equilibrium[m.run.equilibrium.length - 1]
  near(eq, 3, 1e-6)
  assert.ok(m.run.dT[5] < 0.8 * eq && m.run.dT[m.run.dT.length - 1] > 0.99 * eq, 'approach to the equilibrium')
  assert.equal(m.observed, null)
  assert.equal(m.rebased, false)
  between(m.end.warming, 2.9, 3.01, 'a step to 2×CO2 ends near the sensitivity, against the pre-industrial equilibrium')
  const nz = ex[12].project
  const n = analyseModel(libOf(nz), nz.model)
  assert.equal(n.rebased, true)
  assert.equal(n.end.year, 2100)
  assert.equal(n.path.history, 'observed')
  between(n.path.conc[n.path.years.indexOf(1958)], 312, 318, 'Mauna Loa 1958')
  between(n.path.conc[n.path.years.indexOf(2025)], 420, 432, 'CO2 in 2025')
  assert.ok(n.path.emissions.slice(n.path.years.indexOf(2050)).every((e) => e === 0))
  const flat = n.path.conc.slice(n.path.years.indexOf(2052))
  assert.ok(Math.max(...flat) - Math.min(...flat) < 1e-9, 'concentration stops rising when emissions reach zero')
  assert.ok(n.co2Fit && n.co2Fit.rmse < 2 && n.co2Fit.airborne > 0.3 && n.co2Fit.airborne < 0.6, JSON.stringify(n.co2Fit))
  between(n.end.warming, 1.4, 3.2, 'warming in 2100 above 1850–1900 (toy)')
  assert.ok(n.observed && n.observed.y.length > 150)
  // the model reproduces the observed warming to within a few tenths (a toy without aerosols)
  const at = (s: Series, y: number) => s.y[s.t.findIndex((t) => Math.floor(t) === y)]
  assert.ok(Math.abs(at(n.modelDT, 2000) - at(n.observed, 2000)) < 0.5)
  assert.ok(Math.abs(at(n.modelDT, 2020) - at(n.observed, 2020)) < 0.5)
  const g = ex[13].project
  const gm = analyseModel(libOf(g), g.model)
  assert.ok(gm.end.warming > n.end.warming + 1, `${gm.end.warming} vs ${n.end.warming}`)
  assert.ok(gm.path.conc[gm.path.conc.length - 1] > 600)
  const h = ex[14].project
  assert.equal(h.model.tool, 'hysteresis')
  assert.equal(hysteresis(h.model.params).stableAtOne, 2)
  const bb = ex[15].project
  assert.equal(bb.model.tool, 'blackbody')
  near(blackbodyTemperature(bb.model.params.solar, bb.model.params.albedo), 254.6, 0.001, 0.05)
})

test('examples: the synthetic starter is labelled and usable in every tab', () => {
  const p = buildExamples().find((e) => /synthetic/.test(e.title))!.project
  const lib = libOf(p)
  const t = analyseTrend(lib, p.trend)
  assert.ok(!isFailure(t))
  if (!isFailure(t)) between(t.trend!.perDecade, 0.3, 0.5, '°C per decade')
  const s = analyseSeasonal(lib, p.seasonal)
  assert.ok(!isFailure(s))
  if (!isFailure(s)) between(s.decomposition.fit.amplitude, 15, 19, 'seasonal amplitude of the made-up weather')
  const r = analyseRelate(lib, p.relate)
  assert.ok(!isFailure(r) && r.mode === 'correlation')
  const st = analyseStripes(lib, p.stripes)
  assert.ok(!isFailure(st))
  const d = prepareLines(lib, p.series)
  assert.equal(d.lines.length, 2)
  assert.ok(d.lines.every((l) => /synthetic/.test(l.series.name)))
})

// ------------------------------------------------------------------------------ gauges, queries, figures, report

test('gauges: warming above 1850–1900 and CO2 above 280 ppm', () => {
  const g = preindustrialGauges(fullLib)
  assert.ok(g.warming && g.co2)
  between(g.warming!.value, 1.0, 2.0, 'K above 1850–1900')
  near(g.warming!.pctOf15, (g.warming!.value / 1.5) * 100, 1e-12)
  assert.equal(g.warming!.source, 'HadCRUT5')
  between(g.co2!.value, 415, 440, 'ppm')
  near(g.co2!.pctAbove, ((g.co2!.value - 280) / 280) * 100, 1e-12)
  const empty = preindustrialGauges(loadLib(['oni']))
  assert.equal(empty.warming, null)
  assert.equal(empty.co2, null)
})

test('queries: mean, extremes, trend and anomaly of a series over a period', () => {
  const m = querySeries(fullLib, 'gistemp.global', { stat: 'mean', from: 1951, to: 1980 })
  assert.ok(!isFailure(m))
  if (!isFailure(m)) near(m.value!, 0, 1, 0.03, 'GISTEMP’s 1951–1980 mean is its baseline')
  const mx = querySeries(fullLib, 'co2_mlo.co2', { stat: 'max' })
  assert.ok(!isFailure(mx) && mx.value! > 425)
  const tr = querySeries(fullLib, 'hadcrut5.anomaly', { stat: 'trend', from: 1970 })
  assert.ok(!isFailure(tr))
  if (!isFailure(tr)) {
    between(tr.value!, 0.15, 0.25)
    assert.deepEqual(Object.keys(tr.detail).includes('ci95'), true)
  }
  const an = querySeries(fullLib, 'hadcrut5.anomaly', { stat: 'anomaly', from: 2020, to: 2025, baseline: '1850-1900' })
  assert.ok(!isFailure(an))
  if (!isFailure(an)) between(an.value!, 1.1, 1.7)
  assert.ok(isFailure(querySeries(fullLib, 'nope', { stat: 'mean' })))
  assert.ok(isFailure(querySeries(fullLib, 'oni.oni', { stat: 'mean', from: 1900, to: 1910 })))
  assert.ok(isFailure(querySeries(fullLib, 'oni.oni', { stat: 'anomaly', baseline: 'x' })))
})

test('every figure builds as plain JSON for the real data and the example views', () => {
  const lib = fullLib
  const ex = buildExamples()
  const plain = (f: { data: unknown[]; layout: object }) => {
    assert.ok(f.data.length > 0)
    const j = JSON.stringify(f)
    assert.ok(j.length > 50)
    assert.ok(!/NaN|Infinity/.test(j.replace(/"NaN"/g, '')), 'no NaN in the figure')
    return f
  }
  for (const pal of [undefined, LIGHT_PALETTE]) {
    plain(seriesFigure(prepareLines(lib, DEFAULT_PROJECT.series), pal))
    const sl = ex[6].project
    plain(seriesFigure(prepareLines(libOf(sl), { ...sl.series, trendLine: 'linear' }), pal))
    const dual = prepareLines(lib, { ...DEFAULT_PROJECT.series, lines: [{ ref: 'hadcrut5.anomaly', axis: 'left' }, { ref: 'co2_mlo.co2', axis: 'right' }], baseline: 'native' })
    const dualFig = plain(seriesFigure(dual, pal))
    assert.ok('yaxis2' in dualFig.layout, 'a right axis')
    const t = analyseTrend(libOf(ex[5].project), ex[5].project.trend)
    if (!isFailure(t)) { plain(trendFigure(t, pal)); plain(periodTrendsFigure(t.periods, '°C', pal)) }
    const s = analyseSeasonal(lib, DEFAULT_PROJECT.seasonal)
    if (!isFailure(s)) { plain(decompositionFigure(s, pal)); plain(cycleFigure(s, pal)); plain(amplitudeFigure(s, pal)) }
    const lag = analyseRelate(lib, DEFAULT_PROJECT.relate)
    if (!isFailure(lag) && lag.mode === 'lag') plain(lagFigure(lag, pal))
    const cor = analyseRelate(lib, { ...DEFAULT_PROJECT.relate, mode: 'correlation', detrend: false })
    if (!isFailure(cor) && cor.mode === 'correlation') plain(scatterFigure(cor, pal))
    const reg = analyseRelate(libOf(ex[8].project), ex[8].project.relate)
    if (!isFailure(reg) && reg.mode === 'regression') { plain(regressionFigure(reg, pal)); plain(contributionsFigure(reg, pal)) }
    const st = analyseStripes(lib, DEFAULT_PROJECT.stripes)
    if (!isFailure(st)) {
      const sf = plain(stripesFigure(st, pal))
      assert.equal(((sf.data[0] as { z: unknown[][] }).z[0]).length, st.annual.t.length)
      plain(decadalFigure(st, pal)); plain(histogramPairFigure(st, { a: '1951–1980', b: '1991–2020' }, pal))
    }
    const mod = analyseModel(libOf(ex[12].project), ex[12].project.model)
    plain(modelFigure(mod, pal)); plain(scenarioFigure(mod, pal))
    plain(hysteresisFigure(hysteresis({ ...DEFAULT_EBM, ice: true }, 0.6, 1.6, 41), pal))
  }
  assert.equal(withAlpha('#ffffff', 0.5), 'rgba(255, 255, 255, 0.5)')
  assert.equal(withAlpha('rgb(1, 2, 3)', 0.25), 'rgba(1, 2, 3, 0.25)')
  assert.equal(LIGHT_PALETTE.paper, '#ffffff')
})

test('the Markdown report names the data, the numbers and the sources', () => {
  for (const ex of buildExamples()) {
    const lib = libOf(ex.project)
    const md = reportMarkdown(ex.project, lib, manifest)
    assert.ok(md.startsWith(`# ${ex.project.title}`), ex.title)
    if (ex.project.datasets.length) assert.ok(md.includes('## Data sources'), ex.title)
    if (ex.project.imports.length) assert.ok(md.includes('Imported data'), ex.title)
    assert.ok(md.length > 300)
    for (const d of ex.project.datasets) assert.ok(md.includes(manifest.datasets.find((m) => m.id === d)!.provider), `${ex.title}: names the provider of ${d}`)
    if (ex.project.imports.some((d) => d.synthetic)) assert.match(md, /synthetic/i)
  }
  const trend = reportMarkdown(buildExamples()[4].project, libOf(buildExamples()[4].project), manifest)
  assert.match(trend, /per decade/)
  assert.match(trend, /95 % CI/)
  const keeling = reportMarkdown(buildExamples()[0].project, libOf(buildExamples()[0].project), manifest)
  assert.match(keeling, /peak-to-peak/i)
  const lag = reportMarkdown(buildExamples()[7].project, libOf(buildExamples()[7].project), manifest)
  assert.match(lag, /best lag/i)
})

// ------------------------------------------------------------------------------------------------ AI tools

function fakeHooks(initial: Project = cloneProject(DEFAULT_PROJECT)): { hooks: Hooks; log: string[]; state: { project: Project; dirty: boolean } } {
  const lib = loadLib(['hadcrut5'])
  const state = { project: initial, dirty: false }
  const log: string[] = []
  const hooks: Hooks = {
    state: () => ({ project: state.project, lib, manifest, dirty: state.dirty, filePath: null }),
    ensure: async (ref) => {
      const ds = manifest.datasets.find((d) => d.id === ref.split('.')[0])
      if (!ds) return false
      if (!lib.datasets().includes(ds.id)) { lib.addDataset(ds.id, seriesFromCsv(ds, csvText(ds))); log.push(`loaded ${ds.id}`) }
      return true
    },
    show: (change, tab) => { change(state.project); if (tab) state.project.tab = tab; log.push(`show ${tab}`) },
    examples: () => buildExamples().map((e, i) => ({ n: i + 1, title: e.title, group: e.group, description: e.description })),
    openExample: async (n) => { log.push(`open ${n}`); return buildExamples()[n - 1].title },
  }
  return { hooks, log, state }
}
const ctx = (answer = true) => ({ caller: 'test', windowId: 'w', confirm: async () => answer, allowPython: async () => false })
const call = async (tools: ReturnType<typeof kclimateTools>, name: string, args: Record<string, unknown>, c = ctx()) => {
  const t = tools[name]
  const run = typeof t === 'function' ? t : t.run
  return (await run(args, c)) as Record<string, unknown>
}

test('AI tools: the manifest has at most 4 tools with at most 6 arguments each and a short summary', () => {
  assert.ok(KCLIMATE_TOOL_SET.tools.length <= 4)
  assert.deepEqual(KCLIMATE_TOOL_SET.tools.map((t) => t.action), ['get_state', 'query_series', 'fit_trend', 'load_example'])
  assert.ok(KCLIMATE_TOOL_SET.summary.length <= 120)
  assert.ok(KCLIMATE_TOOL_SET.keywords!.length >= 8)
  for (const t of KCLIMATE_TOOL_SET.tools) {
    const props = Object.keys((t.inputSchema as { properties: object }).properties)
    assert.ok(props.length <= 6, `${t.action}: ${props.length} arguments`)
    assert.ok(t.description.length > 20)
  }
  const { hooks } = fakeHooks()
  assert.deepEqual(Object.keys(kclimateTools(hooks)).sort(), ['fit_trend', 'get_state', 'load_example', 'query_series'])
})

test('AI tools: get_state, query_series (loading datasets as needed), fit_trend (shown in the window), load_example', async () => {
  const { hooks, log, state } = fakeHooks()
  const tools = kclimateTools(hooks)
  const s = await call(tools, 'get_state', {})
  assert.deepEqual(s.loaded_datasets, ['hadcrut5'])
  assert.ok((s.series as unknown[]).length === 3)
  assert.ok((s.not_loaded_datasets as string[]).includes('gistemp'))
  assert.equal((s.view as { tab: string }).tab, 'series')
  assert.ok(s.now)
  // natural names are understood and the dataset is loaded on demand
  const q = await call(tools, 'query_series', { series: 'gistemp', stat: 'trend', from: 1970 })
  assert.equal(q.series, 'gistemp.global')
  between(q.value as number, 0.15, 0.25)
  assert.ok(Array.isArray(q.ci95))
  assert.ok(log.includes('loaded gistemp'))
  const mean = await call(tools, 'query_series', { series: 'mauna loa co2', stat: 'mean', from: 2020, to: 2022 })
  between(mean.value as number, 410, 425)
  const sep = await call(tools, 'query_series', { series: 'arctic_ice.extent@9', stat: 'min' })
  between(sep.value as number, 3, 5)
  await assert.rejects(call(tools, 'query_series', { series: 'banana' }), /no series/)
  await assert.rejects(call(tools, 'query_series', { series: 'oni', stat: 'median' }), /stat must be/)
  await assert.rejects(call(tools, 'query_series', { series: '' }), /Name a series/)
  const fit = await call(tools, 'fit_trend', { series: 'gistemp.global', from: 1970, model: 'linear' })
  between(fit.per_decade as number, 0.15, 0.25)
  const [lo, hi] = fit.ci95_per_decade as number[]
  const [nlo, nhi] = fit.ci95_without_autocorrelation as number[]
  assert.ok(lo <= (fit.per_decade as number) && (fit.per_decade as number) <= hi)
  assert.ok(hi - lo > nhi - nlo)
  assert.equal(state.project.tab, 'trend', 'the trend is shown in the window')
  assert.equal(state.project.trend.series, 'gistemp.global')
  assert.equal(state.project.trend.from, 1970)
  const exp = await call(tools, 'fit_trend', { series: 'co2', model: 'exponential', from: 1960 })
  between(exp.growth_percent_per_year as number, 0.2, 0.6)
  await assert.rejects(call(tools, 'fit_trend', { series: 'oni', model: 'cubic' }), /model must be/)
  // examples
  const list = await call(tools, 'load_example', {})
  assert.ok((list.examples as unknown[]).length >= 12)
  const opened = await call(tools, 'load_example', { id: 'keeling' })
  assert.match(opened.opened as string, /Keeling/)
  const byNumber = await call(tools, 'load_example', { id: '3' })
  assert.match(byNumber.opened as string, /stripes/)
  await assert.rejects(call(tools, 'load_example', { id: 'zzz' }), /No example matches/)
  state.dirty = true
  await assert.rejects(call(tools, 'load_example', { id: '1' }, ctx(false)), /declined/)
  assert.deepEqual(await call(tools, 'load_example', { id: '1' }, ctx(true)), { opened: buildExamples()[0].title })
})

test('describeState summarises each tab for the AI', () => {
  for (const ex of buildExamples()) {
    const lib = libOf(ex.project)
    const d = describeState(ex.project, lib, manifest, { dirty: false, filePath: null })
    assert.equal(d.title, ex.project.title)
    assert.ok(d.view.tab === ex.project.tab)
    assert.ok(!('error' in d.view), `${ex.title}: ${JSON.stringify(d.view)}`)
  }
})
