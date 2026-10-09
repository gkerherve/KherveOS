// The charts of kMech as plain Plotly figures ({ data, layout }). Pure: PlotlyChart.tsx loads Plotly lazily
// and draws these; the colours come in as a palette read from the theme variables.

import type { Cycle } from './analysis.ts'
import type { CamProfile, ProgramTable } from './cam.ts'
import type { DynResult } from './dynamics.ts'
import type { EngineResult } from './engine.ts'

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
  surface: string
}

export const DEFAULT_PALETTE: Palette = {
  text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', link: '#60a5fa', danger: '#f87171', surface: '#1f2937',
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

const AMBER = '#f59e0b'

function axis(pal: Palette, title: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: { text: title, standoff: 6 }, gridcolor: withAlpha(pal.border, 0.7), linecolor: pal.border, zeroline: false, tickfont: { color: pal.muted, size: 11 }, automargin: true, ...extra,
  }
}

function base(pal: Palette): Record<string, unknown> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)', font: { color: pal.text, size: 12, family: 'inherit' }, margin: { l: 56, r: 16, t: 12, b: 44 },
    legend: { orientation: 'h', y: -0.2, font: { color: pal.muted, size: 11 } }, hoverlabel: { font: { family: 'inherit' } },
  }
}

export interface Row {
  title: string
  traces: Trace[]
  /** y-axis extras (range, …) */
  axis?: Record<string, unknown>
  shapes?: Array<Record<string, unknown>>
}

/** Rows of plots sharing the x axis. */
export function stacked(rows: Row[], xTitle: string, pal: Palette): Figure {
  const n = rows.length
  const gap = 0.045
  const h = (1 - gap * (n - 1)) / n
  const layout: Record<string, unknown> = { ...base(pal), margin: { l: 60, r: 16, t: 10, b: 44 }, showlegend: n === 1 || rows.some((r) => r.traces.length > 1) }
  const data: Trace[] = []
  const shapes: Array<Record<string, unknown>> = []
  rows.forEach((row, i) => {
    const top = 1 - i * (h + gap)
    const dom = [Math.max(0, top - h), top]
    const k = i === 0 ? '' : String(i + 1)
    layout[`yaxis${k}`] = axis(pal, row.title, { domain: dom, anchor: `x${k}`, ...(row.axis ?? {}) })
    layout[`xaxis${k}`] = axis(pal, i === n - 1 ? xTitle : '', { anchor: `y${k}`, matches: 'x', showticklabels: i === n - 1 })
    for (const t of row.traces) data.push({ ...t, xaxis: `x${k}`, yaxis: `y${k}` })
    for (const s of row.shapes ?? []) shapes.push({ ...s, xref: `x${k} domain`, yref: `y${k}` })
  })
  layout.shapes = shapes
  layout.legend = { orientation: 'h', y: -0.12, font: { color: pal.muted, size: 11 } }
  return { data, layout }
}

const line = (x: ArrayLike<number>, y: ArrayLike<number | null>, name: string, color: string, extra: Record<string, unknown> = {}): Trace => ({
  type: 'scatter', mode: 'lines', x: Array.from(x), y: Array.from(y), name, line: { color, width: 2 }, ...extra,
})

// ------------------------------------------------------------------------------ linkage

/** Output position, velocity and acceleration against the input angle. */
export function motionFigure(c: Cycle, pal: Palette = DEFAULT_PALETTE): Figure {
  const u = c.outputUnit === 'deg' ? '°' : c.outputUnit === 'mm' ? ' mm' : ''
  return stacked([
    { title: `position (${u.trim() || '-'})`, traces: [line(c.theta, c.pos, 'position', pal.accent, { showlegend: false })] },
    { title: `velocity (${u.trim() || '-'}/s)`, traces: [line(c.theta, c.vel, 'velocity', pal.link, { showlegend: false })] },
    { title: `acceleration (${u.trim() || '-'}/s²)`, traces: [line(c.theta, c.acc, 'acceleration', AMBER, { showlegend: false })] },
  ], 'input angle (°)', pal)
}

/** The transmission angle with the 40°–140° band. */
export function transmissionFigure(c: Cycle, pal: Palette = DEFAULT_PALETTE): Figure {
  const slider = c.output?.kind === 'slider'
  const lo = slider ? 50 : 40
  const hi = slider ? 90 : 140
  const mu = c.mu.map((v) => (v === null ? NaN : v))
  const fig = stacked([
    {
      title: 'transmission angle (°)', axis: { range: [0, slider ? 95 : 185] },
      traces: [line(c.theta, mu, 'μ', pal.accent, { showlegend: false })],
      shapes: [{ type: 'rect', x0: 0, x1: 1, y0: lo, y1: hi, fillcolor: withAlpha(pal.accent, 0.12), line: { width: 0 }, layer: 'below' }],
    },
    { title: 'mechanical advantage', axis: { type: 'log' }, traces: [line(c.theta, c.ma.map((v) => (Number.isFinite(v) && v > 0 ? v : NaN)), 'MA', pal.link, { showlegend: false })] },
  ], 'input angle (°)', pal)
  return fig
}

/** Coupler curves in the drawing plane (equal axes). */
export function couplerFigure(curves: Array<{ name: string; x: number[]; y: number[]; cusps?: Array<{ x: number; y: number }> }>, pal: Palette = DEFAULT_PALETTE): Figure {
  const colors = [pal.accent, pal.link, AMBER, pal.danger, pal.muted]
  const data: Trace[] = []
  curves.forEach((c, i) => {
    data.push(line(c.x, c.y, c.name, colors[i % colors.length], { line: { color: colors[i % colors.length], width: 1.6 } }))
    if (c.cusps?.length) data.push({ type: 'scatter', mode: 'markers', x: c.cusps.map((p) => p.x), y: c.cusps.map((p) => p.y), name: 'cusps', marker: { color: pal.danger, size: 8, symbol: 'diamond' }, showlegend: i === 0 })
  })
  return { data, layout: { ...base(pal), xaxis: axis(pal, 'x (mm)'), yaxis: axis(pal, 'y (mm)', { scaleanchor: 'x', scaleratio: 1 }) } }
}

// ------------------------------------------------------------------------------ engine

export function pressureFigure(r: EngineResult, pal: Palette = DEFAULT_PALETTE): Figure {
  return stacked([
    { title: 'gas pressure (kPa abs)', traces: [line(r.phi, r.p, 'pressure', pal.accent, { showlegend: false })] },
    { title: 'cylinder volume (cm³)', traces: [line(r.phi, r.vol, 'volume', pal.link, { showlegend: false })] },
  ], 'crank angle (°, 0 = TDC at start of intake)', pal)
}

export function engineTorqueFigure(r: EngineResult, pal: Palette = DEFAULT_PALETTE): Figure {
  return stacked([
    {
      title: 'torque (N·m)',
      traces: [line(r.phi, r.gasTorque, 'gas', pal.accent), line(r.phi, r.inertiaTorque, 'inertia', pal.link), line(r.phi, r.torque, 'total', AMBER), line(r.phi, r.phi.map(() => r.meanTorque), 'mean', pal.muted, { line: { color: pal.muted, width: 1, dash: 'dash' } })],
    },
    { title: 'energy above mean (J)', traces: [line(r.phi, r.energy, 'flywheel energy', pal.danger, { showlegend: false, fill: 'tozeroy', fillcolor: withAlpha(pal.danger, 0.12) })] },
  ], 'crank angle (°)', pal)
}

// ------------------------------------------------------------------------------ dynamics

export function dynamicsFigure(d: DynResult, c: Cycle | null, pal: Palette = DEFAULT_PALETTE): Figure {
  const rows: Row[] = [
    {
      title: `${d.outLabel || 'output'} (${d.outUnit === 'deg' ? '°/s' : 'mm/s'})`,
      traces: [
        line(d.theta, d.outVel, 'dynamic (planck)', pal.accent),
        ...(c && c.ok ? [line(c.theta.map((t) => t), c.vel, 'kinematic', pal.link, { line: { color: pal.link, width: 1.5, dash: 'dash' } })] : []),
      ],
    },
    { title: 'motor torque (N·m)', traces: [line(d.theta, d.motorTorque, 'torque', AMBER, { showlegend: false })] },
    { title: 'driver speed (rpm)', traces: [line(d.theta, d.rpm, 'speed', pal.muted, { showlegend: false })] },
  ]
  return stacked(rows, 'driver angle (°)', pal)
}

export function jointForceFigure(d: DynResult, pal: Palette = DEFAULT_PALETTE): Figure {
  const top = [...d.joints].sort((a, b) => b.peak - a.peak).slice(0, 6)
  const colors = [pal.accent, pal.link, AMBER, pal.danger, pal.muted, pal.text]
  return {
    data: top.map((j, i) => line(d.theta, j.force, j.name, colors[i % colors.length], { line: { color: colors[i % colors.length], width: 1.6 } })),
    layout: { ...base(pal), xaxis: axis(pal, 'driver angle (°)'), yaxis: axis(pal, 'joint reaction force (N)') },
  }
}

// ------------------------------------------------------------------------------ cams

export function camDiagramFigure(t: ProgramTable, pal: Palette = DEFAULT_PALETTE, cmp?: { label: string; table: ProgramTable }, unit = 'mm'): Figure {
  const mk = (key: 's' | 'v' | 'a' | 'j', label: string, y: string): Row => ({
    title: y,
    traces: [
      line(t.theta, t[key], label, pal.accent, { showlegend: key === 's' }),
      ...(cmp ? [line(cmp.table.theta, cmp.table[key], cmp.label, AMBER, { showlegend: key === 's', line: { color: AMBER, width: 1.6, dash: 'dash' } })] : []),
    ],
  })
  return stacked([
    mk('s', 'program', `lift s (${unit})`),
    mk('v', 'program', `velocity ds/dθ (${unit}/rad)`),
    mk('a', 'program', `acceleration (${unit}/rad²)`),
    mk('j', 'program', `jerk (${unit}/rad³)`),
  ], 'cam angle (°)', pal)
}

export function camChecksFigure(p: CamProfile, limit: number, pal: Palette = DEFAULT_PALETTE): Figure {
  return stacked([
    {
      title: 'pressure angle (°)', traces: [line(p.theta, p.phi, 'pressure angle', pal.accent, { showlegend: false })],
      shapes: [{ type: 'line', x0: 0, x1: 1, y0: limit, y1: limit, line: { color: pal.danger, width: 1, dash: 'dash' } }, { type: 'line', x0: 0, x1: 1, y0: -limit, y1: -limit, line: { color: pal.danger, width: 1, dash: 'dash' } }],
    },
    { title: 'radius of curvature (mm)', axis: { range: [0, Math.min(400, Math.max(...p.rho.filter((v) => Number.isFinite(v) && v < 1e5), 10) * 1.1)] }, traces: [line(p.theta, p.rho.map((v) => (Number.isFinite(v) && v < 1e5 ? v : NaN)), 'ρ', pal.link, { showlegend: false })] },
  ], 'cam angle (°)', pal)
}
