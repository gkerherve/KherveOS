// The scope and Bode plots as plain Plotly figures ({ data, layout }). Pure: ScopeChart.tsx loads Plotly
// (lazily) and draws these; the colours arrive as a palette read from the theme.

import { acTrace, seriesOf, traceData } from './session.ts'
import type { SimResult } from './sim/engine.ts'

export type Trace = Record<string, unknown>
export interface Figure { data: Trace[]; layout: Record<string, unknown> }

export interface Palette { text: string; muted: string; border: string; accent: string; link: string; danger: string; success: string; warning: string; surface: string }

export const DEFAULT_PALETTE: Palette = {
  text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', link: '#60a5fa', danger: '#f87171', success: '#4ade80', warning: '#fbbf24', surface: '#1f2937',
}

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

export const traceColors = (p: Palette): string[] => [p.accent, p.link, p.warning, p.danger, p.success, p.text, p.muted]

/** Keeps at most `max` points, preserving the extremes of each bucket. */
export function decimate(x: ArrayLike<number>, y: ArrayLike<number>, max = 6000): { x: number[]; y: number[] } {
  const n = x.length
  if (n <= max) return { x: Array.from(x), y: Array.from(y) }
  const buckets = Math.floor(max / 2)
  const size = n / buckets
  const ox: number[] = []
  const oy: number[] = []
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor(b * size)
    const e = Math.min(n, Math.floor((b + 1) * size))
    let lo = a
    let hi = a
    for (let i = a; i < e; i++) { if (y[i] < y[lo]) lo = i; if (y[i] > y[hi]) hi = i }
    const [i1, i2] = lo < hi ? [lo, hi] : [hi, lo]
    ox.push(x[i1]); oy.push(y[i1])
    if (i2 !== i1) { ox.push(x[i2]); oy.push(y[i2]) }
  }
  return { x: ox, y: oy }
}

export const unitOf = (expr: string): string => (/^\s*I/i.test(expr) ? 'A' : /^\s*P/i.test(expr) ? 'W' : 'V')

function axisBase(p: Palette, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: { text: title, standoff: 6, font: { size: 11 } }, gridcolor: withAlpha(p.border, 0.7), linecolor: p.border, zerolinecolor: withAlpha(p.border, 1), zeroline: true,
    tickfont: { color: p.muted, size: 10 }, automargin: true, ...extra,
  }
}

export interface ScopeOptions {
  traces: string[]
  stacked: boolean
  cursors?: (number | null)[]
}

function layoutBase(p: Palette): Record<string, unknown> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: p.text, size: 11, family: 'inherit' },
    margin: { l: 56, r: 56, t: 10, b: 38 }, legend: { orientation: 'h', y: 1.12, x: 0, font: { color: p.muted, size: 11 } }, hovermode: 'x unified',
    hoverlabel: { font: { family: 'inherit' } },
  }
}

function cursorShapes(c: (number | null)[] | undefined, p: Palette, log = false): Trace[] {
  const out: Trace[] = []
  ;(c ?? []).forEach((x, i) => {
    if (x === null || x === undefined || !Number.isFinite(x) || (log && !(x > 0))) return
    out.push({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color: i === 0 ? p.warning : p.danger, width: 1.2, dash: 'dash' } })
  })
  return out
}

/** Waveforms of a transient or DC sweep. Returns null when there is nothing to draw. */
export function waveFigure(r: SimResult, o: ScopeOptions, p: Palette = DEFAULT_PALETTE): Figure | null {
  const s = seriesOf(r)
  if (!s || o.traces.length === 0) return null
  const colors = traceColors(p)
  const units = [...new Set(o.traces.map(unitOf))]
  const stacked = o.stacked || units.length > 2
  const layout: Record<string, unknown> = layoutBase(p)
  const data: Trace[] = []
  const fmt = { tickformat: '~s' }
  o.traces.forEach((expr, i) => {
    let y: number[]
    try { y = traceData(r, expr) } catch { return }
    const d = decimate(s.x, y)
    const trace: Trace = { type: 'scatter', mode: 'lines', name: expr, x: d.x, y: d.y, line: { color: colors[i % colors.length], width: 1.6 }, hovertemplate: `${expr}: %{y:.4~s}<extra></extra>` }
    if (stacked) { trace.yaxis = i === 0 ? 'y' : `y${i + 1}`; trace.xaxis = 'x' }
    else if (unitOf(expr) !== units[0]) trace.yaxis = 'y2'
    data.push(trace)
  })
  if (data.length === 0) return null
  layout.xaxis = axisBase(p, s.xLabel, { ...fmt, anchor: stacked ? `y${data.length > 1 ? data.length : ''}` : 'y', zeroline: false })
  if (stacked) {
    const n = data.length
    const gap = 0.04
    const h = (1 - gap * (n - 1)) / n
    data.forEach((t, i) => {
      const key = i === 0 ? 'yaxis' : `yaxis${i + 1}`
      const top = 1 - i * (h + gap)
      layout[key] = axisBase(p, String(t.name), { ...fmt, domain: [top - h, top], anchor: 'x' })
    })
    layout.xaxis = axisBase(p, s.xLabel, { ...fmt, anchor: n === 1 ? 'y' : `y${n}`, zeroline: false })
    layout.legend = { ...(layout.legend as object), visible: false }
  } else {
    layout.yaxis = axisBase(p, `${units[0]}`, fmt)
    if (units.length > 1) layout.yaxis2 = axisBase(p, units[1], { ...fmt, overlaying: 'y', side: 'right', showgrid: false })
  }
  layout.shapes = cursorShapes(o.cursors, p)
  return { data, layout }
}

/** Bode plot: magnitude in dB over phase, on a shared logarithmic frequency axis. */
export function bodeFigure(r: SimResult, o: ScopeOptions, p: Palette = DEFAULT_PALETTE): Figure | null {
  if (r.type !== 'ac' || o.traces.length === 0) return null
  const colors = traceColors(p)
  const data: Trace[] = []
  o.traces.forEach((expr, i) => {
    let t: { mag: number[]; phase: number[] }
    try { t = acTrace(r.ac, expr) } catch { return }
    const color = colors[i % colors.length]
    const db = t.mag.map((m) => 20 * Math.log10(Math.max(m, 1e-300)))
    data.push({ type: 'scatter', mode: 'lines', name: expr, x: r.ac.freq, y: db, xaxis: 'x', yaxis: 'y', line: { color, width: 1.8 }, hovertemplate: `${expr}: %{y:.2f} dB<extra></extra>` })
    data.push({ type: 'scatter', mode: 'lines', name: `${expr} phase`, x: r.ac.freq, y: t.phase, xaxis: 'x', yaxis: 'y2', line: { color, width: 1.4, dash: 'dot' }, showlegend: false, hovertemplate: `${expr}: %{y:.1f}°<extra></extra>` })
  })
  if (data.length === 0) return null
  const layout: Record<string, unknown> = layoutBase(p)
  layout.xaxis = axisBase(p, 'Frequency (Hz)', { type: 'log', anchor: 'y2', zeroline: false })
  layout.yaxis = axisBase(p, 'Magnitude (dB)', { domain: [0.54, 1], anchor: 'x', zeroline: false })
  layout.yaxis2 = axisBase(p, 'Phase (°)', { domain: [0, 0.46], anchor: 'x', zeroline: false })
  layout.shapes = cursorShapes(o.cursors, p, true)
  return { data, layout }
}

export function scopeFigure(r: SimResult, o: ScopeOptions, p: Palette = DEFAULT_PALETTE): Figure | null {
  if (r.type === 'ac') return bodeFigure(r, o, p)
  if (r.type === 'tran' || r.type === 'dc') return waveFigure(r, o, p)
  return null
}

/** The plotted data as CSV (one x column and one column per trace). */
export function traceCsv(r: SimResult, traces: string[]): string {
  if (r.type === 'ac') {
    const cols = traces.map((t) => { try { return acTrace(r.ac, t) } catch { return null } })
    const head = ['frequency_Hz', ...traces.flatMap((t, i) => (cols[i] ? [`${t} magnitude`, `${t} dB`, `${t} phase_deg`] : []))]
    const lines = [head.map(q).join(',')]
    r.ac.freq.forEach((f, k) => lines.push([f, ...cols.flatMap((c) => (c ? [c.mag[k], 20 * Math.log10(Math.max(c.mag[k], 1e-300)), c.phase[k]] : []))].join(',')))
    return lines.join('\n') + '\n'
  }
  const s = seriesOf(r)
  if (!s) return ''
  const cols = traces.map((t) => { try { return traceData(r, t) } catch { return null } })
  const names = traces.filter((_, i) => cols[i])
  const data = cols.filter((c): c is number[] => !!c)
  const lines = [[s.xLabel.replace(/ \(.*/, ''), ...names].map(q).join(',')]
  s.x.forEach((x, k) => lines.push([x, ...data.map((c) => c[k])].join(',')))
  return lines.join('\n') + '\n'
}

const q = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
