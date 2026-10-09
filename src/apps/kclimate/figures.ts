// The charts of kClimate as plain Plotly figures ({ data, layout }). Pure (no browser, no Plotly import): PlotlyChart.tsx
// loads Plotly lazily and draws these. Colours come in as a palette that the window reads from the theme variables;
// the warming-stripes colour scale is the same blue-to-red in every theme.

import type {
  ModelAnalysis, RelateAnalysis, SeasonalAnalysis, SeriesFigureData, StripesAnalysis, TrendAnalysis,
} from './analysis.ts'
import type { HysteresisLoop } from './ebm.ts'
import type { Series } from './series.ts'
import { MONTHS } from './series.ts'
import type { PeriodTrend } from './stats.ts'

export type Trace = Record<string, unknown>
export interface Figure {
  data: Trace[]
  layout: Record<string, unknown>
}

export interface Palette {
  text: string
  muted: string
  border: string
  accent: string
  link: string
  danger: string
  success: string
  warning: string
  surface: string
  /** Background of the chart; transparent on screen, white in exported pictures. */
  paper?: string
}

export const DEFAULT_PALETTE: Palette = {
  text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', link: '#60a5fa', danger: '#f87171', success: '#4ade80', warning: '#fbbf24', surface: '#1f2937',
}

/** For exported pictures: dark text on white, whatever the theme. */
export const LIGHT_PALETTE: Palette = {
  text: '#1f2937', muted: '#6b7280', border: '#d1d5db', accent: '#059669', link: '#2563eb', danger: '#dc2626', success: '#16a34a', warning: '#d97706', surface: '#f3f4f6', paper: '#ffffff',
}

/** "rgb(1, 2, 3)" or "#abc" / "#aabbcc" with an alpha → "rgba(1, 2, 3, a)". */
export function withAlpha(color: string, alpha: number): string {
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(color)
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`
  }
  return `rgba(128, 128, 128, ${alpha})`
}

export const seriesColor = (i: number, pal: Palette): string => [pal.link, pal.accent, pal.warning, pal.danger, pal.success, pal.text][i % 6]

function axis(pal: Palette, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: { text: title, standoff: 8 }, gridcolor: withAlpha(pal.border, 0.7), linecolor: pal.border, zeroline: false, tickfont: { color: pal.muted, size: 11 }, automargin: true, ...extra,
  }
}

function base(pal: Palette, xTitle = '', yTitle = '', extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paper_bgcolor: pal.paper ?? 'rgba(0,0,0,0)',
    plot_bgcolor: pal.paper ?? 'rgba(0,0,0,0)',
    font: { color: pal.text, size: 12, family: 'inherit' },
    margin: { l: 56, r: 18, t: 16, b: 46 },
    xaxis: axis(pal, xTitle),
    yaxis: axis(pal, yTitle),
    legend: { orientation: 'h', y: -0.2, font: { color: pal.muted, size: 11 } },
    hoverlabel: { font: { family: 'inherit' } },
    showlegend: true,
    ...extra,
  }
}

const yearAxis = (pal: Palette, span: number, title = 'Year'): Record<string, unknown> => axis(pal, title, { tickformat: span < 8 ? '.1f' : 'd', hoverformat: '.2f' })

const unitLabel = (list: Series[]): string => {
  const units = [...new Set(list.map((s) => s.unit).filter(Boolean))]
  return units.length === 1 ? units[0] : list.map((s) => s.name).join(', ')
}

const finiteSpan = (list: Array<{ t: number[]; y: number[] }>): number => {
  let lo = Infinity
  let hi = -Infinity
  for (const s of list) for (let i = 0; i < s.t.length; i++) if (Number.isFinite(s.y[i])) { lo = Math.min(lo, s.t[i]); hi = Math.max(hi, s.t[i]) }
  return hi > lo ? hi - lo : 10
}

// ---------------------------------------------------------------------------------------------- time series

export function seriesFigure(d: SeriesFigureData, pal: Palette = DEFAULT_PALETTE): Figure {
  const data: Trace[] = []
  const left = d.lines.filter((l) => l.axis === 'left').map((l) => l.series)
  const right = d.lines.filter((l) => l.axis === 'right').map((l) => l.series)
  d.lines.forEach((l, i) => {
    const s = l.series
    const monthly = s.step === 'monthly' && s.t.length > 400
    data.push({
      type: 'scatter', mode: 'lines', x: s.t, y: s.y.map((v) => (Number.isFinite(v) ? v : null)), name: s.name + (l.axis === 'right' ? ' (right axis)' : ''), yaxis: l.axis === 'right' ? 'y2' : 'y',
      line: { color: seriesColor(i, pal), width: monthly ? 1.1 : 1.8 }, connectgaps: false,
      hovertemplate: `${s.name}<br>%{x:.2f}: %{y:.3f}${s.unit ? ' ' + s.unit : ''}<extra></extra>`,
    })
  })
  if (d.trend && d.lines.length) {
    const t = d.trend
    data.push({ type: 'scatter', mode: 'lines', x: t.t, y: t.hi, line: { width: 0 }, hoverinfo: 'skip', showlegend: false, yaxis: d.lines[0].axis === 'right' ? 'y2' : 'y' })
    data.push({ type: 'scatter', mode: 'lines', x: t.t, y: t.lo, line: { width: 0 }, fill: 'tonexty', fillcolor: withAlpha(pal.warning, 0.18), hoverinfo: 'skip', showlegend: false, yaxis: d.lines[0].axis === 'right' ? 'y2' : 'y' })
    data.push({
      type: 'scatter', mode: 'lines', x: t.t, y: t.fitted, line: { color: pal.warning, width: 2, dash: 'dash' }, yaxis: d.lines[0].axis === 'right' ? 'y2' : 'y',
      name: `${t.model} trend: ${fmt(t.perDecade)} per decade`,
    })
  }
  const span = finiteSpan(d.lines.map((l) => l.series))
  const layout = base(pal, '', unitLabel(left.length ? left : right), {
    xaxis: yearAxis(pal, span),
    margin: { l: 58, r: right.length ? 58 : 18, t: 16, b: 46 },
    ...(right.length ? { yaxis2: axis(pal, unitLabel(right), { overlaying: 'y', side: 'right', showgrid: false }) } : {}),
  })
  return { data, layout }
}

const fmt = (v: number, d = 3): string => (Number.isFinite(v) ? String(Number(v.toPrecision(d))) : 'n/a')

// ------------------------------------------------------------------------------------------------- trends

export function trendFigure(a: TrendAnalysis, pal: Palette = DEFAULT_PALETTE): Figure {
  const s = a.data
  const t = a.trend
  const data: Trace[] = [{
    type: 'scatter', mode: s.step === 'monthly' ? 'lines' : 'lines+markers', x: s.t, y: s.y.map((v) => (Number.isFinite(v) ? v : null)), name: s.name,
    line: { color: withAlpha(pal.link, 0.75), width: s.step === 'monthly' ? 1 : 1.5 }, marker: { size: 4, color: pal.link },
  }]
  if (t) {
    data.push({ type: 'scatter', mode: 'lines', x: t.t, y: t.hi, line: { width: 0 }, hoverinfo: 'skip', showlegend: false })
    data.push({ type: 'scatter', mode: 'lines', x: t.t, y: t.lo, line: { width: 0 }, fill: 'tonexty', fillcolor: withAlpha(pal.warning, 0.22), name: '95 % confidence band', hoverinfo: 'skip' })
    data.push({ type: 'scatter', mode: 'lines', x: t.t, y: t.fitted, line: { color: pal.warning, width: 2.2 }, name: `${t.model} trend: ${fmt(t.perDecade)} ${s.unit}/decade` })
  }
  if (a.breakpoint) {
    data.push({ type: 'scatter', mode: 'lines', x: a.breakpoint.t, y: a.breakpoint.fitted, line: { color: pal.danger, width: 2, dash: 'dash' }, name: `two segments, break ${a.breakpoint.breakYear}` })
  }
  return { data, layout: base(pal, '', s.unit ? `${s.name} (${s.unit})` : s.name, { xaxis: yearAxis(pal, finiteSpan([s])), margin: { l: 62, r: 18, t: 16, b: 50 } }) }
}

/** Slope per decade of several periods, with 95 % intervals. */
export function periodTrendsFigure(periods: PeriodTrend[], unit: string, pal: Palette = DEFAULT_PALETTE): Figure {
  const ok = periods.filter((p) => p.trend)
  return {
    data: [{
      type: 'bar', x: ok.map((p) => `${p.from}–${p.to}`), y: ok.map((p) => p.trend!.perDecade), marker: { color: withAlpha(pal.accent, 0.8), line: { color: pal.accent, width: 1 } },
      error_y: { type: 'data', symmetric: false, array: ok.map((p) => p.trend!.ciDecade[1] - p.trend!.perDecade), arrayminus: ok.map((p) => p.trend!.perDecade - p.trend!.ciDecade[0]), color: pal.text, thickness: 1.4, width: 5 },
      hovertemplate: '%{x}: %{y:.3f}<extra></extra>', name: 'trend per decade',
    }],
    layout: base(pal, '', `trend (${unit || 'units'} per decade)`, { showlegend: false, bargap: 0.35 }),
  }
}

// ------------------------------------------------------------------------------------------ seasonal cycle

/** The data with its trend, the seasonal cycle and the residual in three stacked panels. */
export function decompositionFigure(a: SeasonalAnalysis, pal: Palette = DEFAULT_PALETTE): Figure {
  const d = a.decomposition
  const f = d.fit
  const unit = a.source.unit
  const panel = (name: string, yaxis: string, domain: [number, number]) => ({ title: { text: name, standoff: 6 }, domain, gridcolor: withAlpha(pal.border, 0.7), linecolor: pal.border, zeroline: false, tickfont: { color: pal.muted, size: 10 }, automargin: true, anchor: 'x', ...(yaxis ? {} : {}) })
  return {
    data: [
      { type: 'scatter', mode: 'lines', x: f.t, y: f.y, name: a.source.name, line: { color: withAlpha(pal.link, 0.6), width: 1 }, yaxis: 'y', hovertemplate: '%{x:.2f}: %{y:.2f}<extra>data</extra>' },
      { type: 'scatter', mode: 'lines', x: f.t, y: f.trend, name: 'trend (polynomial)', line: { color: pal.warning, width: 2 }, yaxis: 'y', hovertemplate: '%{x:.2f}: %{y:.2f}<extra>trend</extra>' },
      { type: 'scatter', mode: 'lines', x: f.t, y: f.seasonal, name: 'seasonal cycle', line: { color: pal.accent, width: 1.2 }, yaxis: 'y2', hovertemplate: '%{x:.2f}: %{y:.2f}<extra>seasonal</extra>' },
      { type: 'scatter', mode: 'lines', x: f.t, y: f.residual, name: 'residual', line: { color: pal.danger, width: 1 }, yaxis: 'y3', hovertemplate: '%{x:.2f}: %{y:.2f}<extra>residual</extra>' },
    ],
    layout: base(pal, '', '', {
      xaxis: yearAxis(pal, finiteSpan([{ t: f.t, y: f.y }]), 'Year'),
      yaxis: panel(`data and trend (${unit})`, '', [0.5, 1]),
      yaxis2: panel('seasonal', '', [0.26, 0.46]),
      yaxis3: panel('residual', '', [0, 0.22]),
      margin: { l: 66, r: 18, t: 12, b: 46 },
    }),
  }
}

/** The mean seasonal cycle by calendar month, with ±1 s. */
export function cycleFigure(a: SeasonalAnalysis, pal: Palette = DEFAULT_PALETTE): Figure {
  return {
    data: [{
      type: 'bar', x: MONTHS, y: a.cycle.map((c) => c.mean), marker: { color: a.cycle.map((c) => (c.mean >= 0 ? withAlpha(pal.warning, 0.8) : withAlpha(pal.link, 0.8))) },
      error_y: { type: 'data', array: a.cycle.map((c) => c.sd), color: pal.muted, thickness: 1, width: 3 }, name: 'departure from the annual mean', hovertemplate: '%{x}: %{y:.2f}<extra></extra>',
    }],
    layout: base(pal, '', `departure from the year's mean (${a.source.unit})`, { showlegend: false, bargap: 0.25 }),
  }
}

export function amplitudeFigure(a: SeasonalAnalysis, pal: Palette = DEFAULT_PALETTE): Figure {
  const s = a.amplitude.series
  const t = a.amplitude.trend
  const data: Trace[] = [{ type: 'scatter', mode: 'lines+markers', x: s.t, y: s.y, name: 'peak-to-peak amplitude', line: { color: pal.accent, width: 1.8 }, marker: { size: 4 } }]
  if (t) {
    data.push({ type: 'scatter', mode: 'lines', x: t.t, y: t.hi, line: { width: 0 }, hoverinfo: 'skip', showlegend: false })
    data.push({ type: 'scatter', mode: 'lines', x: t.t, y: t.lo, line: { width: 0 }, fill: 'tonexty', fillcolor: withAlpha(pal.warning, 0.2), hoverinfo: 'skip', name: '95 % confidence' })
    data.push({ type: 'scatter', mode: 'lines', x: t.t, y: t.fitted, line: { color: pal.warning, width: 2, dash: 'dash' }, name: `trend ${fmt(t.perDecade)} ${s.unit}/decade` })
  }
  return { data, layout: base(pal, '', `seasonal amplitude (${s.unit})`, { xaxis: yearAxis(pal, finiteSpan([s])) }) }
}

// ---------------------------------------------------------------------------------------------- relationships

export function lagFigure(r: Extract<RelateAnalysis, { mode: 'lag' }>, pal: Palette = DEFAULT_PALETTE): Figure {
  const L = r.result
  const unit = L.step === 'monthly' ? 'months' : 'years'
  const best = L.best
  const line = (y: number) => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: y, y1: y, line: { color: pal.muted, width: 1, dash: 'dot' } })
  return {
    data: [{
      type: 'bar', x: L.lags, y: L.r.map((v) => (Number.isFinite(v) ? v : null)), marker: { color: L.lags.map((l) => (l === best.lag ? pal.warning : withAlpha(pal.link, 0.75))) },
      hovertemplate: `lag %{x} ${unit}: r = %{y:.3f}<extra></extra>`, name: 'correlation',
    }],
    layout: base(pal, `lag in ${unit}: positive = ${r.y.name} follows ${r.x.name}`, 'correlation r', {
      showlegend: false, bargap: 0.15, shapes: [line(L.rCrit), line(-L.rCrit)],
      annotations: [{ x: best.lag, y: best.r, text: `best: ${best.lag} ${unit}, r = ${best.r.toFixed(2)}`, showarrow: true, arrowcolor: pal.muted, font: { color: pal.text, size: 11 }, ax: 40, ay: -26 }],
    }),
  }
}

export function scatterFigure(r: Extract<RelateAnalysis, { mode: 'correlation' }>, pal: Palette = DEFAULT_PALETTE): Figure {
  const { x, y } = r.pairs
  const n = x.length
  let sx = 0, sy = 0
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i] }
  const mx = sx / n
  const my = sy / n
  let sxy = 0, sxx = 0
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2 }
  const b = sxx > 0 ? sxy / sxx : 0
  const lo = Math.min(...x)
  const hi = Math.max(...x)
  return {
    data: [
      { type: 'scatter', mode: 'markers', x, y, text: r.pairs.t.map((t) => t.toFixed(2)), marker: { color: withAlpha(pal.link, 0.55), size: 5 }, name: 'pairs', hovertemplate: '%{text}<br>x %{x:.3f}, y %{y:.3f}<extra></extra>' },
      { type: 'scatter', mode: 'lines', x: [lo, hi], y: [my + b * (lo - mx), my + b * (hi - mx)], line: { color: pal.warning, width: 2 }, name: `r = ${r.result.r.toFixed(2)}` },
    ],
    layout: base(pal, r.x.unit ? `${r.x.name} (${r.x.unit})` : r.x.name, r.y.unit ? `${r.y.name} (${r.y.unit})` : r.y.name),
  }
}

export function regressionFigure(r: Extract<RelateAnalysis, { mode: 'regression' }>, pal: Palette = DEFAULT_PALETTE): Figure {
  const R = r.result
  return {
    data: [
      { type: 'scatter', mode: 'lines', x: R.t, y: R.y, name: r.target.name, line: { color: withAlpha(pal.link, 0.55), width: 1 } },
      { type: 'scatter', mode: 'lines', x: R.t, y: R.fitted, name: 'regression fit', line: { color: pal.warning, width: 1.6 } },
      { type: 'scatter', mode: 'lines', x: R.t, y: R.adjusted, name: 'natural variations removed', line: { color: pal.accent, width: 1.6 }, visible: R.contributions.length > 1 ? true : 'legendonly' },
    ],
    layout: base(pal, '', r.target.unit ? `${r.target.name} (${r.target.unit})` : r.target.name, { xaxis: yearAxis(pal, finiteSpan([{ t: R.t, y: R.y }])), margin: { l: 62, r: 18, t: 16, b: 50 } }),
  }
}

export function contributionsFigure(r: Extract<RelateAnalysis, { mode: 'regression' }>, pal: Palette = DEFAULT_PALETTE): Figure {
  const R = r.result
  return {
    data: [
      ...R.contributions.map((c, i) => ({ type: 'scatter', mode: 'lines', x: R.t, y: c.values, name: c.name, line: { color: seriesColor(i + 1, pal), width: 1.3 } })),
      { type: 'scatter', mode: 'lines', x: R.t, y: R.residual, name: 'residual', line: { color: withAlpha(pal.muted, 0.8), width: 0.9 } },
    ],
    layout: base(pal, '', `contribution (${r.target.unit})`, { xaxis: yearAxis(pal, finiteSpan([{ t: R.t, y: R.y }])) }),
  }
}

// ------------------------------------------------------------------------------------ stripes and records

/** Ed Hawkins' warming-stripes colours (ColorBrewer Blues and Reds, 8 classes each): the same in every theme. */
export const STRIPE_COLORS = [
  '#08306b', '#08519c', '#2171b5', '#4292c6', '#6baed6', '#9ecae1', '#c6dbef', '#deebf7',
  '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d',
]

/** The colour of a value on the scale that runs from −limit to +limit. */
export function stripeColor(v: number, limit: number): string {
  if (!Number.isFinite(v) || !(limit > 0)) return '#808080'
  const i = Math.floor(((v / limit + 1) / 2) * STRIPE_COLORS.length)
  return STRIPE_COLORS[Math.max(0, Math.min(STRIPE_COLORS.length - 1, i))]
}

export function stripesFigure(a: StripesAnalysis, pal: Palette = DEFAULT_PALETTE, opts: { showYears?: boolean } = {}): Figure {
  const n = STRIPE_COLORS.length
  const scale: Array<[number, string]> = []
  STRIPE_COLORS.forEach((c, i) => { scale.push([i / n, c], [(i + 1) / n, c]) })
  const years = a.annual.t.map((t) => Math.floor(t))
  const first = years[0]
  const last = years[years.length - 1]
  // every year from first to last, so that missing years show as gaps
  const all = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const byYear = new Map(years.map((y, i) => [y, a.annual.y[i]]))
  return {
    data: [{
      type: 'heatmap', x: all, y: [''], z: [all.map((y) => (byYear.has(y) && Number.isFinite(byYear.get(y)) ? byYear.get(y) : null))], zmin: -a.limit, zmax: a.limit, colorscale: scale, showscale: false,
      xgap: 0, ygap: 0, hovertemplate: '%{x}: %{z:.2f}<extra></extra>', hoverongaps: false,
    }],
    layout: base(pal, '', '', {
      showlegend: false, margin: { l: 8, r: 8, t: 8, b: opts.showYears === false ? 8 : 34 },
      xaxis: { visible: opts.showYears !== false, tickfont: { color: pal.muted, size: 11 }, showgrid: false, zeroline: false, tickformat: 'd', range: [first - 0.5, last + 0.5], fixedrange: true },
      yaxis: { visible: false, fixedrange: true },
    }),
  }
}

export function decadalFigure(a: StripesAnalysis, pal: Palette = DEFAULT_PALETTE): Figure {
  return {
    data: [{
      type: 'bar', x: a.decades.map((d) => `${d.decade}s`), y: a.decades.map((d) => d.mean), marker: { color: a.decades.map((d) => stripeColor(d.mean, a.limit)) },
      text: a.decades.map((d) => (d.n < 10 ? `${d.n} yr` : '')), textposition: 'outside', hovertemplate: '%{x}: %{y:.2f}<extra></extra>',
    }],
    layout: base(pal, '', a.source.unit ? `${a.source.name} (${a.source.unit})` : a.source.name, { showlegend: false, bargap: 0.12, margin: { l: 62, r: 18, t: 16, b: 46 } }),
  }
}

export function histogramPairFigure(a: StripesAnalysis, labels: { a: string; b: string }, pal: Palette = DEFAULT_PALETTE): Figure {
  const h = a.histA.hist
  const center = h.counts.map((_, k) => (h.edges[k] + h.edges[k + 1]) / 2)
  const countB = h.counts.map(() => 0)
  for (const v of a.histB.values) {
    const k = Math.min(h.counts.length - 1, Math.max(0, Math.floor((v - h.edges[0]) / h.width)))
    if (v >= h.edges[0] && v <= h.edges[h.edges.length - 1]) countB[k]++
  }
  return {
    data: [
      { type: 'bar', x: center, y: h.counts, width: h.width * 0.95, name: labels.a, marker: { color: withAlpha(pal.link, 0.65) }, hovertemplate: '%{y} years<extra></extra>' },
      { type: 'bar', x: center, y: countB, width: h.width * 0.95, name: labels.b, marker: { color: withAlpha(pal.danger, 0.6) }, hovertemplate: '%{y} years<extra></extra>' },
    ],
    layout: base(pal, a.source.unit ? `annual anomaly (${a.source.unit})` : 'annual value', 'number of years', { barmode: 'overlay', bargap: 0.03 }),
  }
}

// --------------------------------------------------------------------------------------------------- model

export function modelFigure(m: ModelAnalysis, pal: Palette = DEFAULT_PALETTE): Figure {
  const offset = m.rebased ? m.run.dT[0] - m.modelDT.y[0] : 0
  const data: Trace[] = [
    { type: 'scatter', mode: 'lines', x: m.modelDT.t, y: m.modelDT.y, name: 'model (mixed layer)', line: { color: pal.warning, width: 2.2 }, hovertemplate: '%{x:.0f}: %{y:.2f} K<extra>model</extra>' },
    { type: 'scatter', mode: 'lines', x: m.run.t, y: m.run.equilibrium.map((v) => v - offset), name: 'equilibrium for that CO₂', line: { color: pal.muted, width: 1.4, dash: 'dot' }, visible: 'legendonly' },
  ]
  if (m.observed) {
    data.unshift({ type: 'scatter', mode: 'lines', x: m.observed.t, y: m.observed.y, name: `observed: ${m.observed.name}`, line: { color: pal.link, width: 1.8 }, hovertemplate: '%{x:.0f}: %{y:.2f}<extra>observed</extra>' })
  }
  return { data, layout: base(pal, 'Year', m.rebased ? 'warming above 1850–1900 (°C)' : 'warming above the pre-industrial equilibrium (°C)', { xaxis: axis(pal, 'Year', { tickformat: 'd' }) }) }
}

export function scenarioFigure(m: ModelAnalysis, pal: Palette = DEFAULT_PALETTE): Figure {
  const p = m.path
  return {
    data: [
      { type: 'scatter', mode: 'lines', x: p.years, y: p.conc, name: 'CO₂ (ppm)', line: { color: pal.accent, width: 2 }, yaxis: 'y' },
      { type: 'bar', x: p.years, y: p.emissions.map((v) => (Number.isFinite(v) ? v : null)), name: 'emissions (Gt CO₂/yr)', marker: { color: withAlpha(pal.danger, 0.45) }, yaxis: 'y2' },
    ],
    layout: base(pal, '', 'CO₂ (ppm)', {
      xaxis: axis(pal, 'Year', { tickformat: 'd' }), margin: { l: 58, r: 58, t: 16, b: 46 }, bargap: 0,
      yaxis2: axis(pal, 'emissions (Gt CO₂/yr)', { overlaying: 'y', side: 'right', showgrid: false }),
    }),
  }
}

export function hysteresisFigure(h: HysteresisLoop, pal: Palette = DEFAULT_PALETTE): Figure {
  const stableX: number[] = []
  const stableY: number[] = []
  const unstableX: number[] = []
  const unstableY: number[] = []
  h.factor.forEach((k, i) => h.equilibria[i].forEach((e) => { (e.stable ? stableX : unstableX).push(k); (e.stable ? stableY : unstableY).push(e.T) }))
  return {
    data: [
      { type: 'scatter', mode: 'markers', x: unstableX, y: unstableY, name: 'unstable equilibria', marker: { color: pal.muted, size: 3, symbol: 'circle-open' } },
      { type: 'scatter', mode: 'markers', x: stableX, y: stableY, name: 'stable equilibria', marker: { color: withAlpha(pal.muted, 0.5), size: 3 }, visible: 'legendonly' },
      { type: 'scatter', mode: 'lines', x: h.factor, y: h.up, name: 'sweeping up from a frozen Earth', line: { color: pal.link, width: 2.4 } },
      { type: 'scatter', mode: 'lines', x: h.factor, y: h.down, name: 'sweeping down from a warm Earth', line: { color: pal.danger, width: 2.4, dash: 'dash' } },
    ],
    layout: base(pal, 'solar constant (fraction of today’s 1361 W/m²)', 'global mean temperature (K)'),
  }
}

/** Temperature of an Earth with no greenhouse effect against its albedo, with today's marked. */
export function blackbodyFigure(solar: number, albedo: number, emissivity: number, pal: Palette = DEFAULT_PALETTE): Figure {
  const sigma = 5.670374419e-8
  const bb = (a: number, e: number) => Math.pow((solar * (1 - a)) / (4 * e * sigma), 0.25)
  const xs = Array.from({ length: 81 }, (_, i) => i * 0.01)
  return {
    data: [
      { type: 'scatter', mode: 'lines', x: xs, y: xs.map((a) => bb(a, 1)), name: 'no greenhouse effect (ε = 1)', line: { color: pal.link, width: 2 } },
      ...(Math.abs(emissivity - 1) > 1e-6 ? [{ type: 'scatter', mode: 'lines', x: xs, y: xs.map((a) => bb(a, emissivity)), name: `with effective emissivity ε = ${emissivity}`, line: { color: pal.warning, width: 2, dash: 'dash' } }] : []),
      { type: 'scatter', mode: 'markers', x: [albedo], y: [bb(albedo, 1)], name: `albedo ${albedo}: ${bb(albedo, 1).toFixed(1)} K`, marker: { color: pal.danger, size: 10 } },
    ],
    layout: base(pal, 'albedo', 'equilibrium temperature (K)'),
  }
}
