// AI tools of kStats (the manifest is src/os/ai/manifests/kstats.ts).

import { fs, path, HOME } from '@/os'
import type { useAppTools } from '@/os/ai/appTools'
import { columnValues, parseData, usableColumns, xySigma, columnAligned, type Data } from './data'
import { compareModels, fitModel, getModel, isFit, modelFromName, predict, type FitResult } from './fits'
import { describe, fmt, outliers } from './math'
import { runTest, testKind, TEST_KINDS, type TestConfig } from './run'
import { correlationMatrix } from './tests'

type Tools = Parameters<typeof useAppTools>[1]

/** What the tools may change in the window besides the data. */
export interface ViewPatch {
  tab?: 'describe' | 'fit' | 'compare' | 'tests' | 'corr'
  xi?: number
  yi?: number
  si?: number
  weighted?: boolean
  modelId?: string
  test?: TestConfig
  method?: 'pearson' | 'spearman'
}

interface Hooks {
  setText(text: string): void
  get(): { data: Data }
  show(patch: ViewPatch): void
  report(): string
}

/** A column by its header, or by its number (1 = the first column). */
function columnIndex(data: Data, key: unknown): number {
  const headers = data.table.headers
  const s = String(key ?? '').trim()
  const byName = headers.findIndex((h) => h.toLowerCase() === s.toLowerCase())
  if (byName >= 0) return byName
  const n = Number(s)
  if (s !== '' && Number.isInteger(n) && n >= 1 && n <= headers.length) return n - 1
  throw new Error(`There is no column "${s}" (the columns are: ${headers.join(', ')}).`)
}

/** Several columns: an array, or text separated by "|" or commas (names may contain spaces). */
function columnList(data: Data, key: unknown): number[] {
  if (key === undefined || key === null || key === '') return []
  const parts = Array.isArray(key)
    ? key.map(String)
    : String(key).includes('|') || data.table.headers.some((h) => h.includes(','))
      ? String(key).split('|')
      : String(key).split(',')
  return parts.map((p) => p.trim()).filter(Boolean).map((p) => columnIndex(data, p))
}

const sig = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(6)) : null)

function fitSummary(fit: FitResult, headers: string[], xi: number, yi: number, used: number, total: number) {
  return {
    x: headers[xi],
    y: headers[yi],
    model: fit.model,
    label: fit.label,
    equation: fit.equation,
    parameters: fit.params.map((q) => ({ name: q.name, value: sig(q.value), std_error: sig(q.se), ci95: [sig(q.lo), sig(q.hi)], p: sig(q.p) })),
    r2: sig(fit.r2),
    adjusted_r2: sig(fit.adjR2),
    rmse: sig(fit.rmse),
    residual_sd: sig(fit.residualSd),
    aic: sig(fit.aic),
    points: fit.n,
    rows_used: `${used} of ${total}`,
    weighted: fit.weighted,
    converged: fit.converged,
  }
}

export function kstatsTools(h: Hooks): Tools {
  return {
    set_data: async (a) => {
      const text = String(a.text ?? '')
      h.setText(text)
      const d = parseData(text)
      return { rows: d.table.rows.length, columns: d.table.headers }
    },

    describe: async (a) => {
      const { data } = h.get()
      const { table } = data
      const idx = a.column === undefined || a.column === '' ? table.headers.map((_, i) => i) : [columnIndex(data, a.column)]
      h.show({ tab: 'describe' })
      return idx.map((i) => {
        const { values } = columnValues(table, i)
        const d = describe(values)
        if (!d) return { column: table.headers[i], n: 0, note: 'no numbers' }
        const o = outliers(values)
        return {
          column: table.headers[i], n: d.n, mean: fmt(d.mean), sd: fmt(d.sd), sem: fmt(d.sem), median: fmt(d.median), min: fmt(d.min), max: fmt(d.max),
          q1: fmt(d.q1), q3: fmt(d.q3), iqr: fmt(d.iqr), skewness: fmt(d.skew), excess_kurtosis: fmt(d.kurt),
          ci95_of_mean: [fmt(d.ciLo), fmt(d.ciHi)],
          outliers_iqr: o.iqr.map((k) => ({ row: columnValues(table, i).rows[k] + 1, value: values[k] })),
          grubbs: o.grubbs ? { value: o.grubbs.value, p: sig(o.grubbs.p), outlier: o.grubbs.outlier } : undefined,
        }
      })
    },

    fit: async (a) => {
      const { data } = h.get()
      const { table } = data
      const xi = columnIndex(data, a.x)
      const yi = columnIndex(data, a.y)
      const si = a.sigma === undefined || a.sigma === '' ? -1 : columnIndex(data, a.sigma)
      let modelId: string
      if (a.model !== undefined && String(a.model).trim() !== '') {
        const m = modelFromName(String(a.model))
        if (!m) throw new Error(`Unknown model "${a.model}". Models: ${['linear', 'poly2…poly6', 'exp', 'power', 'log', 'mm', 'gauss', 'lorentz', 'logistic'].join(', ')}.`)
        modelId = m
      } else {
        const degree = a.degree === undefined ? 1 : Math.round(Number(a.degree))
        if (!(degree >= 1 && degree <= 6)) throw new Error('The polynomial degree must be 1 to 6.')
        modelId = `poly${degree}`
      }
      const xy = xySigma(table, xi, yi, si)
      h.show({ tab: 'fit', xi, yi, si, weighted: si >= 0, modelId })
      const fit = fitModel(modelId, xy.x, xy.y, { sigma: xy.sigma })
      if (!isFit(fit)) throw new Error(`${getModel(modelId)?.label ?? modelId}: ${fit.error}`)
      const out: Record<string, unknown> = fitSummary(fit, table.headers, xi, yi, xy.x.length, xy.total)
      const def = getModel(modelId)
      if (def?.poly) {
        out.degree = def.poly
        out.coefficients = fit.p.map((c) => Number(c.toPrecision(6)))
        out.residual_sd = Number(fit.residualSd.toPrecision(6))
        out.note = 'coefficients go from the constant term up: y = c0 + c1·x + c2·x² …'
      }
      if (a.predict_at !== undefined && a.predict_at !== '') {
        const at = Number(a.predict_at)
        if (Number.isFinite(at)) {
          const q = predict(fit, at)
          out.prediction = { x: at, y: sig(q.y), ci95: [sig(q.lo), sig(q.hi)], prediction_interval95: [sig(q.plo), sig(q.phi)] }
        }
      }
      return out
    },

    test: async (a) => {
      const { data } = h.get()
      const kind = testKind(String(a.test ?? ''))
      if (!kind) throw new Error(`Unknown test "${a.test}". Tests: ${TEST_KINDS.map((k) => k.id).join(', ')}.`)
      let cols = columnList(data, a.columns)
      const info = TEST_KINDS.find((k) => k.id === kind)!
      if (info.columns === 'many' && cols.length === 0) cols = usableColumns(data)
      if (info.columns !== 'many') cols = cols.slice(0, info.columns)
      const cfg: TestConfig = { kind, cols, mu: a.value === undefined || a.value === '' ? 0 : Number(a.value), alpha: a.alpha === undefined ? 0.05 : Number(a.alpha) }
      if (!Number.isFinite(cfg.mu)) throw new Error('"value" must be a number.')
      if (!(cfg.alpha > 0 && cfg.alpha < 1)) throw new Error('"alpha" must be between 0 and 1 (e.g. 0.05).')
      h.show({ tab: 'tests', test: cfg })
      const r = runTest(data.table, cfg)
      if (typeof r === 'string') throw new Error(r)
      return {
        test: r.name,
        summary: r.summary,
        statistic: { name: r.statistic.label, value: sig(r.statistic.value) },
        p: sig(r.p),
        significant: r.significant,
        alpha: r.alpha,
        details: Object.fromEntries(r.rows),
        notes: r.notes,
      }
    },

    correlate: async (a) => {
      const { data } = h.get()
      const method = String(a.method ?? 'pearson').toLowerCase().startsWith('s') ? 'spearman' : 'pearson'
      let cols = columnList(data, a.columns)
      if (cols.length === 0) cols = usableColumns(data)
      if (cols.length < 2) throw new Error('A correlation needs at least two columns of numbers.')
      h.show({ tab: 'corr', method })
      const m = correlationMatrix(cols.map((c) => data.table.headers[c]), cols.map((c) => columnAligned(data.table, c)), method === 'spearman')
      const pairs: Record<string, unknown>[] = []
      for (let i = 0; i < cols.length; i++) {
        for (let j = i + 1; j < cols.length; j++) {
          if (Number.isFinite(m.r[i][j])) pairs.push({ a: m.names[i], b: m.names[j], r: sig(m.r[i][j]), p: sig(m.p[i][j]), n: m.n[i][j], significant: m.p[i][j] < 0.05 })
        }
      }
      return { method, columns: m.names, matrix: m.r.map((row) => row.map(sig)), pairs }
    },

    compare_models: async (a) => {
      const { data } = h.get()
      const xi = columnIndex(data, a.x)
      const yi = columnIndex(data, a.y)
      const si = a.sigma === undefined || a.sigma === '' ? -1 : columnIndex(data, a.sigma)
      const ids = a.models ? String(a.models).split(/[,|]/).map((s) => modelFromName(s.trim())).filter((s): s is string => !!s) : undefined
      const xy = xySigma(data.table, xi, yi, si)
      h.show({ tab: 'compare', xi, yi, si, weighted: si >= 0 })
      const rows = compareModels(xy.x, xy.y, { sigma: xy.sigma }, ids && ids.length ? ids : undefined)
      return {
        x: data.table.headers[xi],
        y: data.table.headers[yi],
        rows_used: `${xy.x.length} of ${xy.total}`,
        ranking: rows.map((r, i) => r.fit
          ? { rank: i + 1, model: r.model, label: r.label, parameters: r.fit.k, r2: sig(r.fit.r2), adjusted_r2: sig(r.fit.adjR2), rmse: sig(r.fit.rmse), aic: sig(r.fit.aic), delta_aic: sig(r.deltaAic), weight: sig(r.weight), equation: r.fit.equation }
          : { model: r.model, label: r.label, not_fitted: r.error }),
        note: 'Ranked by AIC (AICc for small samples); lower is better; weights sum to 1. Use fit with model=<id> to look at one.',
      }
    },

    export_report: async (a, ctx) => {
      const target = String(a.path ?? '').trim() || `${HOME}/Documents/kStats/kstats-report.md`
      const full = target.startsWith('~') ? target.replace(/^~/, HOME) : target
      const ok = await ctx.confirm(`Write the kStats report to ${full}${fs.exists(full) ? ' (replacing the file that is there)' : ''}`)
      if (!ok) throw new Error('The user declined to save the report.')
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeText(full, h.report())
      return { saved: full }
    },
  }
}
