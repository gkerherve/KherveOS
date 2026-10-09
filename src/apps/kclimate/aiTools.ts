// AI tools of kClimate (the manifest is src/os/ai/manifests/kclimate.ts). Written against a small set of hooks the
// window provides, so the logic can be tested without a browser.

import type { useAppTools } from '@/os/ai/appTools'
import { analyseModel, analyseRelate, analyseSeasonal, analyseStripes, analyseTrend, isFailure, preindustrialGauges, prepareLines, querySeries, type QueryStat } from './analysis.ts'
import { catalogRefs, matchRef, type Library, type Manifest, type RefInfo } from './catalog.ts'
import type { Project, TabId } from './project.ts'
import { yearSpan } from './series.ts'
import type { TrendModel } from './stats.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface ExampleListing {
  n: number
  title: string
  group: string
  description: string
}

export interface Hooks {
  state(): { project: Project; lib: Library; manifest: Manifest | null; dirty: boolean; filePath: string | null }
  /** Loads the dataset behind a series id (a no-op when it is loaded). False when no such dataset exists. */
  ensure(ref: string): Promise<boolean>
  /** Changes the project shown in the window (and switches to `tab`). */
  show(change: (p: Project) => void, tab?: TabId): void
  examples(): ExampleListing[]
  /** Opens example number n (replacing the project). */
  openExample(n: number): Promise<string>
}

const sig = (v: number | null | undefined, d = 4): number | null => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(d)) : null)

/** Resolves what the AI wrote ("gistemp", "co2", "arctic_ice.extent@9") to a series id, loading its dataset. */
async function resolve(h: Hooks, text: unknown): Promise<string> {
  const { manifest, lib, project } = h.state()
  const word = String(text ?? '').trim()
  if (!word) throw new Error('Name a series, e.g. "gistemp.global". Use get_state to see the series that are available.')
  if (lib.has(word)) return word
  const refs: RefInfo[] = [
    ...(manifest ? catalogRefs(manifest) : []),
    ...lib.all().map((s) => ({ ref: s.id, name: s.name, dataset: s.dataset ?? s.id, unit: s.unit, step: s.step, kind: s.kind })),
    ...project.imports.flatMap((d) => d.columns.map((c) => ({ ref: `${d.id}.${c.key}`, name: c.name, dataset: d.id, unit: c.unit, step: d.step, kind: c.kind }))),
  ]
  const m = matchRef(refs, word)
  if (!m) throw new Error(`There is no series “${word}”. Available: ${[...new Set(refs.map((r) => r.ref))].join(', ')}.`)
  if (!(await h.ensure(m.ref))) throw new Error(`The dataset of “${m.ref}” could not be loaded (offline?).`)
  return m.ref
}

const yearArg = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? Number(v) : null)

/** What the AI sees of the window. */
export function describeState(project: Project, lib: Library, manifest: Manifest | null, extra: { dirty: boolean; filePath: string | null }) {
  const view: Record<string, unknown> = { tab: project.tab }
  try {
    if (project.tab === 'series') {
      const d = prepareLines(lib, project.series)
      view.series = { lines: d.lines.map((l) => ({ id: l.ref, name: l.series.name, axis: l.axis })), baseline: project.series.baseline, smoothing: project.series.smooth.kind, from: project.series.from, to: project.series.to, errors: d.errors }
    } else if (project.tab === 'trend') {
      const a = analyseTrend(lib, project.trend)
      view.trend = isFailure(a) ? { error: a.error } : { series: project.trend.series, model: project.trend.model, per_decade: sig(a.trend?.perDecade), ci95: a.trend?.ciDecade.map((x) => sig(x)), n: a.trend?.n }
    } else if (project.tab === 'seasonal') {
      const a = analyseSeasonal(lib, project.seasonal)
      view.seasonal = isFailure(a) ? { error: a.error } : { series: project.seasonal.series, amplitude: sig(a.decomposition.fit.amplitude), peak_month: sig(a.decomposition.fit.peakMonth, 3), trend_rate_at_end_per_year: sig(a.endRate), amplitude_trend_per_decade: sig(a.amplitude.trend?.perDecade) }
    } else if (project.tab === 'relate') {
      const a = analyseRelate(lib, project.relate)
      view.relate = isFailure(a) ? { error: a.error } : a.mode === 'lag' ? { mode: 'lag', best_lag: a.result.best.lag, r: sig(a.result.best.r, 3), step: a.result.step } : a.mode === 'correlation' ? { mode: 'correlation', r: sig(a.result.r, 3), n: a.result.n } : { mode: 'regression', r2: sig(a.result.r2, 3), terms: a.result.terms.map((t) => ({ name: t.name, coef: sig(t.coef), se: sig(t.se) })) }
    } else if (project.tab === 'stripes') {
      const a = analyseStripes(lib, project.stripes)
      view.stripes = isFailure(a) ? { error: a.error } : { series: project.stripes.series, warmest: a.warmest.slice(0, 5).map((r) => ({ year: r.year, value: sig(r.value, 3) })) }
    } else if (project.tab === 'model') {
      const a = analyseModel(lib, project.model)
      view.model = { tool: project.model.tool, ecs: project.model.params.ecs, scenario: `${project.model.scenario.mode}: ${project.model.scenario.preset}`, warming_in_2100_vs_1850_1900: sig(a.end.warming, 3), no_feedback_doubling: sig(a.doubling.noFeedback, 3), equilibrium_doubling: sig(a.doubling.equilibrium, 3) }
    }
  } catch (e) {
    view.error = e instanceof Error ? e.message : String(e)
  }
  const g = preindustrialGauges(lib)
  return {
    title: project.title,
    unsaved_changes: extra.dirty,
    file: extra.filePath,
    loaded_datasets: lib.datasets(),
    series: lib.all().map((s) => { const y = yearSpan(s); return { id: s.id, name: s.name, unit: s.unit, step: s.step, years: y ? `${y[0]}–${y[1]}` : null, ...(s.synthetic ? { synthetic: true } : {}) } }),
    not_loaded_datasets: (manifest?.datasets ?? []).filter((d) => !lib.datasets().includes(d.id)).map((d) => d.id),
    view,
    now: g.warming ? { warming_above_1850_1900: sig(g.warming.value, 3), source: g.warming.source, period: g.warming.label, co2_ppm: sig(g.co2?.value, 4) } : undefined,
  }
}

export function kclimateTools(h: Hooks): Tools {
  return {
    get_state: async () => {
      const s = h.state()
      return describeState(s.project, s.lib, s.manifest, { dirty: s.dirty, filePath: s.filePath })
    },

    query_series: async (a) => {
      const ref = await resolve(h, a.series)
      const stat = String(a.stat ?? 'mean') as QueryStat
      if (!['mean', 'min', 'max', 'trend', 'anomaly', 'count', 'first', 'last'].includes(stat)) throw new Error('stat must be mean, min, max, trend, anomaly, count, first or last.')
      const r = querySeries(h.state().lib, ref, { from: yearArg(a.from), to: yearArg(a.to), stat, baseline: typeof a.baseline === 'string' && a.baseline ? a.baseline : undefined })
      if (isFailure(r)) throw new Error(r.error)
      return {
        series: r.series, name: r.name, unit: r.unit, period: `${r.from ?? 'start'}–${r.to ?? 'end'}`, stat: r.stat, value: sig(r.value, 5),
        ...(r.stat === 'trend' ? { unit_of_value: `${r.unit}/decade` } : {}), ...r.detail,
      }
    },

    fit_trend: async (a) => {
      const ref = await resolve(h, a.series)
      const model = String(a.model ?? 'linear') as TrendModel
      if (!['linear', 'quadratic', 'exponential'].includes(model)) throw new Error('model must be linear, quadratic or exponential.')
      const st = h.state()
      const view = { ...st.project.trend, series: ref, from: yearArg(a.from), to: yearArg(a.to), baseline: typeof a.baseline === 'string' && a.baseline ? a.baseline : 'native', model, annual: a.annual !== false, ar1: a.ar1 !== false, breakpoint: false }
      const r = analyseTrend(st.lib, view)
      if (isFailure(r)) throw new Error(r.error)
      h.show((p) => { p.trend = { ...p.trend, ...view } }, 'trend')
      const t = r.trend!
      return {
        series: ref, name: r.source.name, unit: r.source.unit, period: `${view.from ?? 'start'}–${view.to ?? 'end'}`, model, points: t.n,
        per_decade: sig(t.perDecade), ci95_per_decade: t.ciDecade.map((x) => sig(x)), ci95_without_autocorrelation: t.ciDecadeNaive.map((x) => sig(x)), p_value: sig(t.p, 3),
        r2: sig(t.r2, 3), lag1_autocorrelation: sig(t.r1, 3), effective_n: sig(t.nEff, 3), ...(t.growthPct !== undefined ? { growth_percent_per_year: sig(t.growthPct) } : {}), equation: t.equation, notes: r.notes,
      }
    },

    load_example: async (a, ctx) => {
      const list = h.examples()
      const key = String(a.id ?? '').trim().toLowerCase()
      if (!key) return { examples: list.map((e) => ({ id: e.n, title: e.title, group: e.group, description: e.description })), hint: 'Call load_example again with id set to a number or part of a title.' }
      const found = /^\d+$/.test(key) ? list.find((e) => e.n === Number(key)) : list.find((e) => e.title.toLowerCase().includes(key))
      if (!found) throw new Error(`No example matches “${a.id}”. Call load_example with no id to list them.`)
      if (h.state().dirty && !(await ctx.confirm(`Open the example “${found.title}” and discard the unsaved changes in kClimate?`))) throw new Error('The user declined.')
      return { opened: await h.openExample(found.n) }
    },
  }
}
