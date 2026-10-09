// The charts of kTitration as plain Plotly figures ({ data, layout }). Pure: no browser, no Plotly import;
// Chart.tsx loads Plotly lazily and draws these. Colours arrive as a palette read from the theme variables.

import type { DiagramData } from './speciation.ts'
import type { GranResult, Smoothed } from './analyse.ts'
import { hexToRgb, mixColors } from './format.ts'
import type { Band, TitrationResult } from './result.ts'

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
}

export const DEFAULT_PALETTE: Palette = {
  text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', link: '#60a5fa', danger: '#f87171', success: '#4ade80', warning: '#fbbf24', surface: '#1f2937',
}

/** "rgb(1, 2, 3)" or "#abc" / "#aabbcc" with an alpha → "rgba(1, 2, 3, a)". */
export function withAlpha(color: string, alpha: number): string {
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(color)
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if (hex) {
    const [r, g, b] = hexToRgb(hex[1])
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return `rgba(128, 128, 128, ${alpha})`
}

/** For exported pictures: dark text on a white page whatever the theme. */
export const LIGHT_PALETTE: Palette = {
  text: '#1f2937', muted: '#4b5563', border: '#cbd5e1', accent: '#0f766e', link: '#1d4ed8', danger: '#b91c1c', success: '#15803d', warning: '#b45309', surface: '#ffffff',
}

/** The same figure on an opaque white background (for PNG/SVG export). */
export function opaque(f: Figure): Figure {
  return { data: f.data, layout: { ...f.layout, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff' } }
}

export const seriesColors = (pal: Palette) => [pal.accent, pal.link, pal.warning, pal.danger, pal.success, pal.text, pal.muted]

export function layoutBase(pal: Palette, xTitle = '', yTitle = ''): Record<string, unknown> {
  const axis = (title: string) => ({
    title: { text: title, standoff: 8 }, gridcolor: withAlpha(pal.border, 0.7), linecolor: pal.border, zeroline: false,
    tickfont: { color: pal.muted, size: 11 }, automargin: true,
  })
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: pal.text, size: 12, family: 'inherit' },
    margin: { l: 56, r: 16, t: 30, b: 46 },
    xaxis: axis(xTitle),
    yaxis: axis(yTitle),
    legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { color: pal.muted, size: 11 } },
    hoverlabel: { font: { family: 'inherit' } },
    showlegend: true,
  }
}

const finite = (v: number) => (Number.isFinite(v) ? v : null)

function line(x: number[], y: number[], name: string, color: string, extra: Trace = {}): Trace {
  return { type: 'scatter', mode: 'lines', x, y: y.map(finite), name, line: { color, width: 2 }, hovertemplate: `${name}<br>%{x:.3g}, %{y:.4g}<extra></extra>`, ...extra }
}

// ---------------------------------------------------------------------------------------------- the titration curve

/** Colour of a band at a value of y, by interpolating its stops. */
export function bandColor(b: Band, y: number): string {
  const s = b.stops
  if (y <= s[0].y) return s[0].color
  for (let i = 1; i < s.length; i++) {
    if (y <= s[i].y) return mixColors(s[i - 1].color, s[i].color, (y - s[i - 1].y) / (s[i].y - s[i - 1].y || 1))
  }
  return s[s.length - 1].color
}

export interface CurveFigureOptions {
  /** Current volume of the virtual burette (a marker on the curve). */
  current?: number | null
  marks?: boolean
  buffers?: boolean
  band?: boolean
  /** Only the part of the curve up to this volume is drawn (practice mode); the axes stay full-size. */
  revealTo?: number | null
  /** Measured points to draw instead of the whole curve (practice mode). */
  points?: Array<{ V: number; y: number }> | null
  /** Extra title. */
  title?: string
}

export function titrationFigure(r: TitrationResult, pal: Palette, o: CurveFigureOptions = {}): Figure {
  const data: Trace[] = []
  const shapes: Record<string, unknown>[] = []
  const annotations: Record<string, unknown>[] = []
  const reveal = o.revealTo ?? null
  const ys = r.y.filter((v) => Number.isFinite(v))
  const ymin = Math.min(...ys)
  const ymax = Math.max(...ys)
  const pad = (ymax - ymin) * 0.05 || 0.5
  if (o.points) {
    data.push({ type: 'scatter', mode: 'lines+markers', x: o.points.map((p) => p.V), y: o.points.map((p) => p.y), name: 'your readings', marker: { color: pal.accent, size: 7 }, line: { color: withAlpha(pal.accent, 0.5), width: 1.5 }, hovertemplate: 'V %{x:.2f} mL<br>%{y:.3f}<extra></extra>' })
  } else {
    const keep = r.V.map((v, i) => (reveal === null || v <= reveal ? i : -1)).filter((i) => i >= 0)
    data.push(line(keep.map((i) => r.V[i]), keep.map((i) => r.y[i]), r.yShort, pal.accent, { line: { color: pal.accent, width: 2.6 } }))
  }
  if (o.band !== false && r.band) {
    const b = r.band
    const lo = Math.max(b.lo, ymin - pad)
    const hi = Math.min(b.hi, ymax + pad)
    const n = 18
    for (let i = 0; i < n && hi > lo; i++) {
      const a = lo + ((hi - lo) * i) / n
      const c = lo + ((hi - lo) * (i + 1)) / n
      shapes.push({ type: 'rect', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: a, y1: c, fillcolor: withAlpha(bandColor(b, (a + c) / 2), 0.42), line: { width: 0 }, layer: 'below' })
    }
    annotations.push({ xref: 'paper', x: 0.995, xanchor: 'right', yref: 'y', y: (lo + hi) / 2, text: b.name, showarrow: false, font: { size: 10, color: pal.text }, bgcolor: withAlpha(pal.surface, 0.55) })
  }
  if (o.buffers !== false && !o.points) {
    for (const b of r.buffer) shapes.push({ type: 'rect', xref: 'x', x0: b.from, x1: b.to, yref: 'paper', y0: 0, y1: 1, fillcolor: withAlpha(pal.success, 0.08), line: { width: 0 }, layer: 'below' })
  }
  if (o.marks !== false && !o.points) {
    for (const e of r.eq) {
      if (reveal !== null && e.V > reveal) continue
      shapes.push({ type: 'line', xref: 'x', x0: e.V, x1: e.V, yref: 'paper', y0: 0, y1: 1, line: { color: withAlpha(pal.danger, 0.55), width: 1, dash: 'dot' } })
    }
    if (r.eq.length) data.push({ type: 'scatter', mode: 'markers+text', x: r.eq.map((e) => e.V), y: r.eq.map((e) => e.y), text: r.eq.map((e) => e.label), textposition: 'top left', marker: { symbol: 'diamond', size: 10, color: pal.danger }, name: 'equivalence', textfont: { color: pal.danger, size: 11 }, hovertemplate: r.eq.map((e) => `${e.detail ?? e.label}<br>V %{x:.3f} mL<br>${r.yShort} %{y:.3f}<extra></extra>`) })
    if (r.half.length) data.push({ type: 'scatter', mode: 'markers+text', x: r.half.map((e) => e.V), y: r.half.map((e) => e.y), text: r.half.map((e) => e.label), textposition: 'bottom right', marker: { symbol: 'circle', size: 8, color: pal.warning }, name: 'half-equivalence', textfont: { color: pal.warning, size: 10 }, hovertemplate: r.half.map((e) => `${e.label}<br>V %{x:.3f} mL<br>${r.yShort} %{y:.3f}<extra></extra>`) })
    if (r.endpoint && r.endpoint.V !== null && r.endpoint.y !== null) data.push({ type: 'scatter', mode: 'markers', x: [r.endpoint.V], y: [r.endpoint.y], marker: { symbol: 'x', size: 10, color: pal.link, line: { width: 2, color: pal.link } }, name: `${r.endpoint.name} changes`, hovertemplate: `${r.endpoint.name}<br>V %{x:.3f} mL<extra></extra>` })
  }
  if (o.current !== null && o.current !== undefined) {
    const at = r.at(o.current)
    if (Number.isFinite(at.y)) data.push({ type: 'scatter', mode: 'markers', x: [o.current], y: [at.y], marker: { size: 13, color: pal.link, line: { color: pal.text, width: 2 } }, name: 'burette', hovertemplate: 'V %{x:.2f} mL<br>%{y:.3f}<extra></extra>', showlegend: false })
  }
  const layout = layoutBase(pal, 'Titrant added / mL', r.yLabel)
  ;(layout.xaxis as Record<string, unknown>).range = [0, r.vmax]
  ;(layout.yaxis as Record<string, unknown>).range = [ymin - pad, ymax + pad]
  layout.shapes = shapes
  layout.annotations = annotations
  return { data, layout }
}

/** First and second derivative of the curve against volume. */
export function derivativeFigure(r: TitrationResult, pal: Palette): Figure {
  const data: Trace[] = [
    line(r.V, r.dy, `d${r.yShort}/dV`, pal.link),
    line(r.V, r.d2y, `d²${r.yShort}/dV²`, pal.warning, { yaxis: 'y2', line: { color: pal.warning, width: 1.4 } }),
  ]
  const layout = layoutBase(pal, 'Titrant added / mL', `d${r.yShort}/dV (per mL)`)
  ;(layout.xaxis as Record<string, unknown>).range = [0, r.vmax]
  layout.yaxis2 = { title: { text: `d²${r.yShort}/dV²` }, overlaying: 'y', side: 'right', showgrid: false, zeroline: false, tickfont: { color: pal.warning, size: 10 }, linecolor: pal.border }
  layout.shapes = r.eq.map((e) => ({ type: 'line', xref: 'x', x0: e.V, x1: e.V, yref: 'paper', y0: 0, y1: 1, line: { color: withAlpha(pal.danger, 0.55), width: 1, dash: 'dot' } }))
  return { data, layout }
}

// ---------------------------------------------------------------------------------------------- speciation

export function alphaFigure(d: DiagramData, forms: string[], pal: Palette): Figure {
  const cols = seriesColors(pal)
  const data = d.alpha.map((a, j) => line(d.pH, a, forms[j] ?? `species ${j}`, cols[j % cols.length], { line: { color: cols[j % cols.length], width: 2.4 } }))
  const layout = layoutBase(pal, 'pH', 'Fraction α')
  ;(layout.yaxis as Record<string, unknown>).range = [0, 1.03]
  layout.shapes = d.pKaUsed.map((p) => ({ type: 'line', xref: 'x', x0: p, x1: p, yref: 'paper', y0: 0, y1: 1, line: { color: withAlpha(pal.muted, 0.6), width: 1, dash: 'dot' } }))
  layout.annotations = d.pKaUsed.map((p, i) => ({ x: p, xref: 'x', y: 1, yref: 'paper', yanchor: 'bottom', text: `pKa${d.pKaUsed.length > 1 ? i + 1 : ''} ${p.toFixed(2)}`, showarrow: false, font: { size: 10, color: pal.muted } }))
  return { data, layout }
}

export function sillenFigure(d: DiagramData, forms: string[], pal: Palette): Figure {
  const cols = seriesColors(pal)
  const data: Trace[] = d.logC.map((c, j) => line(d.pH, c, forms[j] ?? `species ${j}`, cols[j % cols.length], { line: { color: cols[j % cols.length], width: 2.4 } }))
  data.push(line(d.pH, d.logH, 'H⁺', pal.muted, { line: { color: pal.muted, width: 1.4, dash: 'dash' } }))
  data.push(line(d.pH, d.logOH, 'OH⁻', pal.muted, { line: { color: pal.muted, width: 1.4, dash: 'dot' } }))
  const layout = layoutBase(pal, 'pH', 'log C')
  const top = Math.max(...d.logC.flat().filter(Number.isFinite))
  ;(layout.yaxis as Record<string, unknown>).range = [top - 9, top + 0.5]
  return { data, layout }
}

export function betaFigure(d: DiagramData, pal: Palette, extra?: { pH: number[]; beta: number[]; name: string }): Figure {
  const data: Trace[] = [line(d.pH, d.beta, 'β of the system and water', pal.accent, { fill: 'tozeroy', fillcolor: withAlpha(pal.accent, 0.1), line: { color: pal.accent, width: 2.4 } })]
  if (extra) data.push(line(extra.pH, extra.beta, extra.name, pal.warning, { line: { color: pal.warning, width: 2 } }))
  const layout = layoutBase(pal, 'pH', 'Buffer capacity β / mol L⁻¹ per pH')
  layout.shapes = d.pKaUsed.map((p) => ({ type: 'rect', xref: 'x', x0: p - 1, x1: p + 1, yref: 'paper', y0: 0, y1: 1, fillcolor: withAlpha(pal.success, 0.07), line: { width: 0 }, layer: 'below' }))
  return { data, layout }
}

/** pH against equivalents of titrant per mole of species (the titration of one species). */
export function speciesTitrationFigure(x: number[], pH: number[], pal: Palette, label: string, eqs: number[] = []): Figure {
  const data: Trace[] = [line(x, pH, label, pal.accent, { line: { color: pal.accent, width: 2.6 } })]
  const layout = layoutBase(pal, 'Equivalents of titrant per mole of analyte', 'pH')
  layout.shapes = eqs.map((v) => ({ type: 'line', xref: 'x', x0: v, x1: v, yref: 'paper', y0: 0, y1: 1, line: { color: withAlpha(pal.danger, 0.55), width: 1, dash: 'dot' } }))
  return { data, layout }
}

// ---------------------------------------------------------------------------------------------- measured data

export function dataFigure(V: number[], pH: number[], pal: Palette, opts: { fit?: { V: number[]; y: number[] } | null; eq?: Array<{ V: number; pH: number }>; label?: string } = {}): Figure {
  const data: Trace[] = [{ type: 'scatter', mode: 'markers', x: V, y: pH, name: opts.label ?? 'data', marker: { color: pal.text, size: 6, opacity: 0.85 }, hovertemplate: 'V %{x:.3f} mL<br>pH %{y:.3f}<extra></extra>' }]
  if (opts.fit) data.push(line(opts.fit.V, opts.fit.y, 'fitted model', pal.accent, { line: { color: pal.accent, width: 2.4 } }))
  const shapes: Record<string, unknown>[] = []
  if (opts.eq?.length) {
    data.push({ type: 'scatter', mode: 'markers+text', x: opts.eq.map((e) => e.V), y: opts.eq.map((e) => e.pH), text: opts.eq.map((_, i) => `EP${i + 1}`), textposition: 'top left', marker: { symbol: 'diamond', size: 10, color: pal.danger }, name: 'equivalence', textfont: { color: pal.danger, size: 11 }, hovertemplate: 'EP: %{x:.3f} mL, pH %{y:.2f}<extra></extra>' })
    for (const e of opts.eq) shapes.push({ type: 'line', xref: 'x', x0: e.V, x1: e.V, yref: 'paper', y0: 0, y1: 1, line: { color: withAlpha(pal.danger, 0.5), width: 1, dash: 'dot' } })
  }
  const layout = layoutBase(pal, 'Titrant added / mL', 'pH')
  layout.shapes = shapes
  return { data, layout }
}

export function smoothedFigure(s: Smoothed, pal: Palette, eq: Array<{ V: number }> = []): Figure {
  const data: Trace[] = [
    line(s.x, s.d1, 'dpH/dV (smoothed)', pal.link, { mode: 'lines+markers', marker: { size: 4, color: pal.link } }),
    line(s.x, s.d2, 'd²pH/dV²', pal.warning, { yaxis: 'y2', line: { color: pal.warning, width: 1.4 } }),
  ]
  const layout = layoutBase(pal, 'Titrant added / mL', 'dpH/dV')
  layout.yaxis2 = { title: { text: 'd²pH/dV²' }, overlaying: 'y', side: 'right', showgrid: false, zeroline: false, tickfont: { color: pal.warning, size: 10 }, linecolor: pal.border }
  layout.shapes = eq.map((e) => ({ type: 'line', xref: 'x', x0: e.V, x1: e.V, yref: 'paper', y0: 0, y1: 1, line: { color: withAlpha(pal.danger, 0.55), width: 1, dash: 'dot' } }))
  return { data, layout }
}

export function granFigure(g: GranResult, pal: Palette): Figure {
  const data: Trace[] = []
  const branch = (b: GranResult['before'], name: string, color: string) => {
    data.push({ type: 'scatter', mode: 'markers', x: b.x, y: b.y, name: `${name} (all points)`, marker: { color: withAlpha(color, 0.35), size: 5 }, hovertemplate: 'V %{x:.3f} mL<br>%{y:.4g}<extra></extra>' })
    data.push({ type: 'scatter', mode: 'markers', x: b.used.map((i) => b.x[i]), y: b.used.map((i) => b.y[i]), name: `${name} (used)`, marker: { color, size: 7 } })
    if (b.fit && b.Ve !== null && Number.isFinite(b.Ve)) {
      const xs = [Math.min(...b.used.map((i) => b.x[i])), b.Ve]
      data.push(line(xs, xs.map((x) => b.fit!.intercept + b.fit!.slope * x), `${name} line → ${b.Ve.toFixed(3)} mL`, color, { line: { color, width: 1.6, dash: 'dash' } }))
    }
  }
  branch(g.before, 'before', pal.accent)
  branch(g.after, 'after', pal.warning)
  const layout = layoutBase(pal, 'Titrant added / mL', 'Gran function')
  const top = Math.max(...g.before.used.map((i) => g.before.y[i]), ...g.after.used.map((i) => g.after.y[i]), 0)
  ;(layout.yaxis as Record<string, unknown>).range = [-top * 0.05, top * 1.15]
  return { data, layout }
}

export function residualFigure(V: number[], residuals: number[], pal: Palette): Figure {
  const data: Trace[] = [{ type: 'bar', x: V, y: residuals, name: 'residual (pH)', marker: { color: residuals.map((r) => (r >= 0 ? withAlpha(pal.link, 0.8) : withAlpha(pal.danger, 0.8))) }, hovertemplate: 'V %{x:.3f} mL<br>%{y:.4f}<extra></extra>' }]
  const layout = layoutBase(pal, 'Titrant added / mL', 'Residual / pH units')
  layout.showlegend = false
  return { data, layout }
}

export function rgbaOf(hex: string, a: number) {
  return withAlpha(hex, a)
}
