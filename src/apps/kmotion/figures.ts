// The charts of kMotion as plain Plotly figures ({ data, layout }). Pure (no browser, no Plotly import):
// PlotlyChart.tsx loads Plotly lazily and draws these. Colours come in as a palette read from the theme.

import { COLORS, PALETTE } from './common.ts'
import type { DriftCurve } from './analysis.ts'
import type { Recorder } from './analysis.ts'
import type { Channel, PlotSpec, Series, Sweep } from './types.ts'

export type Trace = Record<string, unknown>
export interface Figure {
  data: Trace[]
  layout: Record<string, unknown>
}

/** CSS colours (rgb(...) or #hex) resolved from the theme. */
export interface Palette {
  text: string
  muted: string
  border: string
  accent: string
  link: string
  danger: string
  surface: string
}

export const DEFAULT_PALETTE: Palette = {
  text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', link: '#60a5fa', danger: '#f87171', surface: '#1f2937',
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

function layoutBase(pal: Palette, xTitle: string, yTitle: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const axis = (title: string) => ({
    title: { text: title, standoff: 8 }, gridcolor: withAlpha(pal.border, 0.7), linecolor: pal.border, zeroline: false,
    tickfont: { color: pal.muted, size: 11 }, automargin: true,
  })
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: pal.text, size: 12, family: 'inherit' },
    margin: { l: 56, r: 16, t: 28, b: 44 },
    xaxis: axis(xTitle),
    yaxis: axis(yTitle),
    legend: { orientation: 'h', y: -0.28, font: { color: pal.muted, size: 11 } },
    hoverlabel: { font: { family: 'inherit' } },
    ...extra,
  }
}

const finite = (x: number) => (Number.isFinite(x) ? x : null)

/** At most `max` points, thinned evenly (the last point is kept). */
function thin<T>(a: T[], max: number): T[] {
  if (a.length <= max) return a
  const step = a.length / max
  const out: T[] = []
  for (let i = 0; i < max; i++) out.push(a[Math.floor(i * step)])
  out.push(a[a.length - 1])
  return out
}

const colorAt = (i: number, analytic: boolean) => (analytic ? [COLORS.theory, COLORS.g, COLORS.c, COLORS.h][i % 4] : PALETTE[i % PALETTE.length])

function labelOf(ch: Channel | undefined, s: Series): string {
  if (s.label !== undefined) return s.label
  return ch ? ch.label : s.key
}

/** The chart of one plot spec from the recorded rows and the scene's point clouds. */
export function plotFigure(spec: PlotSpec, rec: Recorder, channels: Channel[], clouds: Record<string, number[][]>, pal: Palette): Figure {
  const byKey = new Map(channels.map((c) => [c.key, c]))
  const data: Trace[] = []
  const MAXP = 2500
  spec.series.forEach((s, i) => {
    const xKey = s.x ?? spec.x ?? 't'
    const ch = byKey.get(s.key)
    const analytic = !!ch?.analytic || !!s.dash
    const xs = rec.column(xKey)
    const ys = rec.column(s.key)
    const idx = thin(Array.from({ length: Math.min(xs.length, ys.length) }, (_, k) => k), MAXP)
    data.push({
      type: 'scatter', mode: s.markers ? 'markers' : 'lines', name: labelOf(ch, s), x: idx.map((k) => finite(xs[k])), y: idx.map((k) => finite(ys[k])),
      line: { color: colorAt(i, analytic && !!s.dash), width: s.dash ? 1.6 : 1.8, dash: s.dash ? 'dash' : 'solid' }, marker: { color: colorAt(i, false), size: 4 },
      connectgaps: false, showlegend: (s.label ?? 'x') !== '',
    })
  })
  for (const [k, c] of (spec.clouds ?? []).entries()) {
    const pts = clouds[c.key] ?? []
    data.push({
      type: 'scatter', mode: c.markers ? 'markers' : 'lines', name: c.label, x: pts.map((p) => finite(p[0])), y: pts.map((p) => finite(p[1])),
      marker: { color: COLORS.c, size: 4, opacity: 0.8 }, line: { color: withAlpha(pal.muted, 0.8), width: 1, dash: c.dash ? 'dot' : 'solid' }, connectgaps: false, showlegend: pts.length > 0 || k === 0,
    })
  }
  const layout = layoutBase(pal, spec.xLabel, spec.yLabel, {
    uirevision: spec.id,
    title: { text: spec.title, font: { size: 13, color: pal.muted }, x: 0.01, xanchor: 'left', y: 0.97 },
  })
  if (spec.equal) (layout.yaxis as Record<string, unknown>).scaleanchor = 'x'
  if (spec.logY) (layout.yaxis as Record<string, unknown>).type = 'log'
  return { data, layout }
}

/** The measured resonance curve of a driven system against its closed form. */
export function sweepFigure(sw: Sweep, pal: Palette): Figure {
  const data: Trace[] = [
    { type: 'scatter', mode: 'markers', name: 'simulated', x: sw.x, y: sw.measured.map(finite), marker: { color: COLORS.a, size: 6 } },
  ]
  if (sw.theory) data.push({ type: 'scatter', mode: 'lines', name: 'closed form (linear)', x: sw.x, y: sw.theory.map(finite), line: { color: COLORS.theory, dash: 'dash', width: 1.6 } })
  if (sw.phase) data.push({ type: 'scatter', mode: 'markers', name: 'phase lag (°)', x: sw.x, y: sw.phase.map(finite), yaxis: 'y2', marker: { color: COLORS.b, size: 5, symbol: 'diamond' } })
  if (sw.phaseTheory) data.push({ type: 'scatter', mode: 'lines', name: 'phase, closed form', x: sw.x, y: sw.phaseTheory.map(finite), yaxis: 'y2', line: { color: COLORS.b, dash: 'dot', width: 1.2 } })
  const layout = layoutBase(pal, sw.xLabel, sw.yLabel, {
    title: { text: sw.title, font: { size: 13, color: pal.muted }, x: 0.01, xanchor: 'left', y: 0.97 },
    yaxis2: { overlaying: 'y', side: 'right', title: { text: 'phase lag (°)' }, range: [-10, 190], showgrid: false, tickfont: { color: pal.muted, size: 11 }, linecolor: pal.border, zeroline: false },
  })
  if (sw.mark !== undefined) layout.shapes = [{ type: 'line', x0: sw.mark, x1: sw.mark, yref: 'paper', y0: 0, y1: 1, line: { color: withAlpha(pal.muted, 0.7), width: 1, dash: 'dot' } }]
  return { data, layout }
}

/** Relative energy error of every integrator against time (log scale). */
export function driftFigure(curves: DriftCurve[], pal: Palette): Figure {
  const data: Trace[] = curves.map((c, i) => ({
    type: 'scatter', mode: 'lines', name: `${c.label} (${c.final.toExponential(1)}, ${c.evals} evals)`, x: c.t, y: c.drift.map(finite),
    line: { color: PALETTE[i % PALETTE.length], width: 1.8 },
  }))
  const layout = layoutBase(pal, 'time', 'relative energy error |ΔE/E|', {
    title: { text: 'Energy error of the integrators (same step)', font: { size: 13, color: pal.muted }, x: 0.01, xanchor: 'left', y: 0.97 },
  })
  ;(layout.yaxis as Record<string, unknown>).type = 'log'
  return { data, layout }
}
