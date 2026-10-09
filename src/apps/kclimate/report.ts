// The Markdown report of a kClimate project: the numbers of the open tab with their uncertainties, and the sources
// of every dataset used. Pure.

import {
  analyseModel, analyseRelate, analyseSeasonal, analyseStripes, analyseTrend, isFailure, preindustrialGauges, prepareLines, baselineText,
} from './analysis.ts'
import type { Library, Manifest } from './catalog.ts'
import { PRESET_LABELS } from './ebm.ts'
import type { Project } from './project.ts'
import { TABS } from './project.ts'
import { MONTHS, SMOOTH_LABELS, describe, yearSpan, type Series } from './series.ts'
import { TREND_LABELS } from './stats.ts'

const num = (v: number | null | undefined, d = 3): string => (typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toPrecision(d))) : 'n/a')
const pval = (p: number): string => (!Number.isFinite(p) ? 'n/a' : p < 1e-4 ? '< 0.0001' : p.toFixed(4))
const years = (s: Series): string => { const y = yearSpan(s); return y ? `${y[0]}–${y[1]}` : 'no data' }
const cell = (x: string): string => x.replace(/\|/g, '\\|')
const row = (...c: string[]): string => `| ${c.map(cell).join(' | ')} |`
const rule = (n: number): string => `|${' --- |'.repeat(n)}`
const period = (a: number | null, b: number | null): string => `${a ?? 'start'}–${b ?? 'end'}`

/** The Markdown report of the project's open tab, with the data sources. */
export function reportMarkdown(p: Project, lib: Library, manifest: Manifest | null, opts: { date?: string } = {}): string {
  const out: string[] = [`# ${p.title}`, '']
  const tabLabel = TABS.find((t) => t.id === p.tab)?.label ?? p.tab
  out.push(`kClimate report: ${tabLabel}${opts.date ? `, ${opts.date}` : ''}.`, '')
  if (p.notes.trim()) out.push(p.notes.trim(), '')
  const synthetic = p.imports.some((d) => d.synthetic)
  if (synthetic) out.push('> **Synthetic data.** Some of the series here were made up for a demonstration; they are not observations.', '')
  const notes: string[] = []

  switch (p.tab) {
    case 'series': {
      const d = prepareLines(lib, p.series)
      out.push('## Time series', '', `Period ${period(p.series.from, p.series.to)}; baseline: ${baselineText(p.series.baseline)}; smoothing: ${SMOOTH_LABELS[p.series.smooth.kind]}.`, '')
      out.push(row('Series', 'Unit', 'Years', 'Mean', 'Min', 'Max'), rule(6))
      for (const l of d.lines) {
        const s = describe(l.series)
        out.push(row(l.series.name, l.series.unit || '-', years(l.series), num(s?.mean), num(s?.min), num(s?.max)))
        notes.push(...l.notes)
      }
      notes.push(...d.errors)
      if (d.trend) out.push('', `Trend of the first line (${TREND_LABELS[d.trend.model]}): ${num(d.trend.perDecade)} per decade, 95 % CI ${num(d.trend.ciDecade[0])} to ${num(d.trend.ciDecade[1])}.`)
      break
    }
    case 'trend': {
      const a = analyseTrend(lib, p.trend)
      out.push('## Trend', '')
      if (isFailure(a)) { out.push(a.error); break }
      const t = a.trend!
      out.push(`Series: ${a.source.name}${a.source.unit ? ` (${a.source.unit})` : ''}, ${period(p.trend.from, p.trend.to)}, ${p.trend.annual ? 'annual means' : 'native resolution'}, baseline ${baselineText(p.trend.baseline)}.`, '')
      out.push(row('Model', 'Trend per decade', '95 % CI (AR(1))', '95 % CI (naive)', 'p', 'R²', 'n', 'effective n', 'lag-1 r'), rule(9))
      out.push(row(TREND_LABELS[t.model], num(t.perDecade), `${num(t.ciDecade[0])} to ${num(t.ciDecade[1])}`, `${num(t.ciDecadeNaive[0])} to ${num(t.ciDecadeNaive[1])}`, pval(t.p), num(t.r2), String(t.n), num(t.nEff, 3), num(t.r1, 2)))
      out.push('', `Fit: ${t.equation}. ${t.growthPct !== undefined ? `Growth ${num(t.growthPct)} % per year. ` : ''}${t.ar1 ? 'The interval allows for lag-1 autocorrelation of the residuals (Santer et al. 2000).' : 'No autocorrelation correction.'}`)
      if (a.breakpoint) {
        const b = a.breakpoint
        out.push('', `Two-segment trend: break in ${b.breakYear}; ${num(b.slope1)} per decade before (95 % CI ${num(b.ci1[0])} to ${num(b.ci1[1])}) and ${num(b.slope2)} after (${num(b.ci2[0])} to ${num(b.ci2[1])}); p = ${pval(b.p)} (approximate), AIC ${num(b.aic, 5)} against ${num(b.aicLinear, 5)} for one line.`)
      }
      out.push('', '### Periods compared', '', row('Period', 'Trend per decade', '95 % CI'), rule(3))
      for (const q of a.periods) out.push(row(`${q.from}–${q.to}`, q.trend ? num(q.trend.perDecade) : 'n/a', q.trend ? `${num(q.trend.ciDecade[0])} to ${num(q.trend.ciDecade[1])}` : 'too few values'))
      notes.push(...a.notes)
      break
    }
    case 'seasonal': {
      const a = analyseSeasonal(lib, p.seasonal)
      out.push('## Seasonal cycle', '')
      if (isFailure(a)) { out.push(a.error); break }
      const f = a.decomposition.fit
      const unit = a.source.unit
      out.push(`Series: ${a.source.name}. Fit: polynomial of degree ${f.degree} plus ${f.harmonics} harmonics (${years(a.source)}).`, '')
      out.push(`- Seasonal cycle peak-to-peak size: ${num(f.amplitude)} ${unit}`, `- Maximum around ${MONTHS[Math.min(11, Math.floor(f.peakMonth - 1))]}, minimum around ${MONTHS[Math.min(11, Math.floor(f.troughMonth - 1))]}`, `- Growth rate of the trend now: ${num(a.endRate)} ${unit}/year`, `- Residual standard deviation: ${num(f.rmse)} ${unit}; R² = ${num(f.r2, 6)}`)
      const at = a.amplitude.trend
      if (at) out.push(`- Amplitude trend: ${num(at.perDecade)} ${unit} per decade (95 % CI ${num(at.ciDecade[0])} to ${num(at.ciDecade[1])}), from ${num(a.amplitude.series.y[0])} to ${num(a.amplitude.series.y[a.amplitude.series.y.length - 1])} ${unit}`)
      break
    }
    case 'relate': {
      const a = analyseRelate(lib, p.relate)
      out.push('## Relationships', '')
      if (isFailure(a)) { out.push(a.error); break }
      if (a.mode === 'lag') {
        const L = a.result
        const u = L.step === 'monthly' ? 'months' : 'years'
        out.push(`Cross-correlation of ${a.x.name} with ${a.y.name} (${L.detrended ? 'both detrended' : 'not detrended'}, ${L.step} values).`, '')
        out.push(`- Best lag: ${L.best.lag} ${u} (positive: ${a.y.name} follows ${a.x.name}), r = ${num(L.best.r, 3)}, p = ${pval(L.best.p)}`, `- Effective number of independent values: ${num(L.best.nEff, 3)}; |r| above ${num(L.rCrit, 2)} is significant at 95 %`)
      } else if (a.mode === 'correlation') {
        const r = a.result
        out.push(`Correlation of ${a.x.name} with ${a.y.name} (${r.detrended ? 'detrended' : 'not detrended'}).`, '', `- Pearson r = ${num(r.r, 3)}, Spearman ρ = ${num(r.rho, 3)} from ${r.n} pairs`, `- Effective n ${num(r.nEff, 3)}, p = ${pval(r.p)}`)
      } else {
        const R = a.result
        out.push(`Regression of ${a.target.name} on ${a.predictors.length} explanatory variable${a.predictors.length === 1 ? '' : 's'}, ${R.step} values, ${R.n} points, R² = ${num(R.r2, 3)}, residual sd ${num(R.rmse)} ${a.target.unit}.`, '')
        out.push(row('Term', 'Coefficient', 'Unit', 'Std error (AR(1))', 'p', 'Lag'), rule(6))
        for (const t of [R.intercept, ...(R.trend ? [R.trend] : []), ...R.terms]) out.push(row(t.name, num(t.coef), t.unit, num(t.se), pval(t.p), String(t.lag)))
        out.push('', `Residual lag-1 autocorrelation ${num(R.r1, 2)}; effective number of independent values ${num(R.nEff, 3)}.`)
      }
      break
    }
    case 'stripes': {
      const a = analyseStripes(lib, p.stripes)
      out.push('## Stripes and records', '')
      if (isFailure(a)) { out.push(a.error); break }
      out.push(`Annual means of ${a.source.name}, baseline ${baselineText(p.stripes.baseline)}.`, '', '### Warmest years', '', row('Rank', 'Year', 'Anomaly'), rule(3))
      for (const r of a.warmest) out.push(row(String(r.rank), String(r.year), num(r.value)))
      out.push('', '### Decades', '', row('Decade', 'Mean', 'Years'), rule(3))
      for (const d of a.decades) out.push(row(`${d.decade}s`, num(d.mean), String(d.n)))
      notes.push(...a.notes)
      const g = preindustrialGauges(lib)
      if (g.warming) out.push('', `Warming above ${g.warming.baseline}: ${num(g.warming.value, 3)} °C (${g.warming.source}, ${g.warming.label}), ${num(g.warming.pctOf15, 3)} % of the 1.5 °C level.`)
      if (g.co2) out.push(`CO₂ ${num(g.co2.value, 4)} ppm, ${num(g.co2.pctAbove, 3)} % above the pre-industrial ${g.co2.preindustrial} ppm.`)
      break
    }
    case 'model': {
      const a = analyseModel(lib, p.model)
      const e = p.model.params
      const sc = p.model.scenario
      out.push('## Energy-balance model', '', 'A zero-dimensional teaching model, not a projection.', '')
      out.push(`- Solar constant ${e.solar} W/m², albedo ${e.albedo}, effective emissivity ${e.emissivity}, climate sensitivity ${e.ecs} K per doubling`, `- Mixed layer ${e.mixedDepth} m${e.deepOcean ? `, deep ocean ${e.deepDepth} m, exchange ${e.exchange} W/m²/K` : ', no deep ocean'}${e.ice ? `, ice–albedo feedback (ice albedo ${e.iceAlbedo}, ice-free above ${e.tWarm} K, frozen below ${e.tCold} K)` : ''}`)
      out.push(`- Doubling CO₂: ${num(a.doubling.noFeedback)} K with no feedbacks, ${num(a.doubling.equilibrium)} K at equilibrium with them (forcing ${num(a.doubling.forcing)} W/m²)`)
      out.push(`- Scenario: ${PRESET_LABELS[sc.preset]} (${sc.mode === 'emissions' ? 'emissions' : 'concentration'}-driven from ${sc.startYear}); warming in ${a.end.year}: ${num(a.end.warming)} °C above 1850–1900`)
      if (a.co2Fit) out.push(`- Past CO₂: observed Mauna Loa from 1959; airborne fraction fitted ${num(a.co2Fit.airborne, 3)} (RMSE ${num(a.co2Fit.rmse, 2)} ppm)`)
      notes.push(...a.notes)
      break
    }
    default:
      out.push('## Datasets', '')
      for (const id of p.datasets) out.push(`- ${manifest?.datasets.find((d) => d.id === id)?.title ?? id}`)
      for (const d of p.imports) out.push(`- ${d.name}${d.synthetic ? ' (synthetic)' : ''}: ${d.t.length} rows`)
  }
  if (notes.length) out.push('', '### Notes', '', ...[...new Set(notes)].map((n) => `- ${n}`))
  // sources
  const used = p.datasets.map((id) => manifest?.datasets.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d)
  if (used.length) {
    out.push('', '## Data sources', '')
    for (const d of used) out.push(`- **${d.title}**. ${d.provider}. ${d.url}. Licence: ${d.licence}. Version: ${d.version}. Retrieved ${d.retrieved}. Cite as: ${d.citation}`)
  }
  for (const d of p.imports) out.push('', `Imported data: ${d.name}${d.synthetic ? ' (synthetic: made up, not observations)' : ''}.`)
  out.push('', '_Made with kClimate (KherveOS)._', '')
  return out.join('\n')
}
