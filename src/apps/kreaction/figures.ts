// The charts of kReaction as plain Plotly figures ({ data, layout }): concentrations against time, energy
// profiles (with a highlighted point and a catalysed overlay), the linearised order plots, Arrhenius / Eyring
// and Lineweaver–Burk. Pure (no browser, no Plotly import): PlotlyChart.tsx loads Plotly lazily and draws these;
// the colours come in as a palette read from the theme variables.

import type { ArrheniusResult, EyringResult, OrderFit } from './fit.ts'
import type { MmResult, Simulation } from './kinetics.ts'
import { analyse, curve, type Profile } from './profile.ts'

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
  text: '#e5e7eb', muted: '#9ca3af', border: '#374151', accent: '#34d399', link: '#60a5fa', danger: '#f87171',
  success: '#4ade80', warning: '#fbbf24', surface: '#1f2937',
}

/** Dark ink on white, for the PNG / SVG files. */
export const PRINT_PALETTE: Palette = {
  text: '#111827', muted: '#4b5563', border: '#d1d5db', accent: '#047857', link: '#1d4ed8', danger: '#b91c1c',
  success: '#15803d', warning: '#b45309', surface: '#ffffff',
}

/** The figure on a white background. */
export function onWhite(fig: Figure): Figure {
  return { data: fig.data, layout: { ...fig.layout, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff' } }
}

/** "rgb(1, 2, 3)" or "#abc" with an alpha → "rgba(1, 2, 3, a)". */
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

/** Series colours, cycling with a dash style once the palette is used up. */
export function seriesStyle(i: number, pal: Palette): { color: string; dash: string } {
  const colours = [pal.accent, pal.link, pal.danger, pal.warning, pal.success, pal.muted]
  const dashes = ['solid', 'dash', 'dot', 'dashdot']
  return { color: colours[i % colours.length], dash: dashes[Math.floor(i / colours.length) % dashes.length] }
}

function layoutBase(pal: Palette, xTitle = '', yTitle = ''): Record<string, unknown> {
  const axis = (title: string) => ({
    title: { text: title, standoff: 8 }, gridcolor: withAlpha(pal.border, 0.7), linecolor: pal.border, zeroline: false,
    tickfont: { color: pal.muted, size: 11 }, automargin: true,
  })
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: pal.text, size: 12, family: 'inherit' },
    margin: { l: 56, r: 16, t: 14, b: 46 },
    xaxis: axis(xTitle),
    yaxis: axis(yTitle),
    legend: { orientation: 'h', y: -0.24, font: { color: pal.muted, size: 11 } },
    hoverlabel: { font: { family: 'inherit' } },
  }
}

// ------------------------------------------------------------------ kinetics

export interface KineticsFigureInput {
  sim: Simulation
  hidden: string[]
  logTime: boolean
  /** Optional analytic curves to overlay (name → values at sim.t). */
  analytic?: { name: string; y: number[] }[]
}

export function kineticsFigure(i: KineticsFigureInput, pal: Palette = DEFAULT_PALETTE): Figure {
  const { sim } = i
  const t = i.logTime ? sim.t.slice(1) : sim.t
  const cut = i.logTime ? 1 : 0
  const data: Trace[] = []
  sim.species.forEach((name, k) => {
    if (i.hidden.includes(name)) return
    const st = seriesStyle(k, pal)
    data.push({
      type: 'scatter', mode: 'lines', name, x: t, y: sim.c.slice(cut).map((row) => row[k]), line: { color: st.color, dash: st.dash, width: 2.2 },
      hovertemplate: `${name}: %{y:.4g} mol/L<br>t = %{x:.4g}<extra></extra>`,
    })
  })
  for (const a of i.analytic ?? []) {
    data.push({ type: 'scatter', mode: 'lines', name: a.name, x: t, y: a.y.slice(cut), line: { color: pal.text, dash: 'dot', width: 1.4 }, opacity: 0.8 })
  }
  const layout = layoutBase(pal, 'time', 'concentration (mol/L)')
  if (i.logTime) (layout.xaxis as Record<string, unknown>).type = 'log'
  return { data, layout }
}

// ------------------------------------------------------------------ energy profile

export interface ProfileFigureInput {
  profile: Profile
  overlay?: Profile | null
  /** Index into profile.points to highlight. */
  active?: number | null
  annotate?: boolean
}

export function profileFigure(i: ProfileFigureInput, pal: Palette = DEFAULT_PALETTE): Figure {
  const { profile } = i
  const pts = profile.points
  const data: Trace[] = []
  const c = curve(profile)
  data.push({ type: 'scatter', mode: 'lines', name: 'Uncatalysed', x: c.x, y: c.y, line: { color: pal.accent, width: 2.5 }, hoverinfo: 'skip' })
  if (i.overlay) {
    const o = curve(i.overlay)
    data.push({ type: 'scatter', mode: 'lines', name: 'Catalysed', x: o.x, y: o.y, line: { color: pal.link, width: 2, dash: 'dash' }, hoverinfo: 'skip' })
  }
  data.push({
    type: 'scatter', mode: 'markers+text', name: 'Species', showlegend: false,
    x: pts.map((_, k) => k), y: pts.map((p) => p.energy), text: pts.map((p) => p.label), textposition: pts.map((p) => (p.kind === 'ts' ? 'top center' : 'bottom center')),
    textfont: { color: pal.muted, size: 10 },
    marker: { size: pts.map((p) => (p.kind === 'ts' ? 8 : 10)), symbol: pts.map((p) => (p.kind === 'ts' ? 'diamond' : 'circle')), color: pts.map((p) => (p.kind === 'ts' ? pal.danger : pal.accent)), line: { color: pal.surface, width: 1.5 } },
    hovertemplate: '%{text}: %{y:.1f} kJ/mol<extra></extra>', cliponaxis: false,
  })
  if (i.active !== undefined && i.active !== null && pts[i.active]) {
    data.push({
      type: 'scatter', mode: 'markers', name: 'Now', showlegend: false, x: [i.active], y: [pts[i.active].energy], hoverinfo: 'skip',
      marker: { size: 17, color: 'rgba(0,0,0,0)', line: { color: pal.warning, width: 3 } },
    })
  }
  const layout = layoutBase(pal, 'reaction progress', 'relative energy (kJ/mol)')
  const xa = layout.xaxis as Record<string, unknown>
  xa.showticklabels = false
  xa.showgrid = false
  xa.range = [-0.4, pts.length - 0.6]
  layout.margin = { l: 56, r: 16, t: 28, b: 38 }
  const info = analyse(profile)
  const shapes: Record<string, unknown>[] = []
  const annotations: Record<string, unknown>[] = []
  if (i.annotate !== false && info.valid && pts.length >= 3) {
    const top = Math.max(...pts.filter((p) => p.kind === 'ts').map((p) => p.energy))
    const topIdx = pts.findIndex((p) => p.energy === top && p.kind === 'ts')
    shapes.push({ type: 'line', x0: 0, x1: topIdx + 0.22, y0: pts[0].energy, y1: pts[0].energy, line: { color: pal.border, dash: 'dot', width: 1 } })
    shapes.push({ type: 'line', x0: topIdx + 0.22, x1: topIdx + 0.22, y0: pts[0].energy, y1: top, line: { color: pal.danger, width: 1.5 } })
    annotations.push({ x: topIdx + 0.22, y: (top + pts[0].energy) / 2, text: `Ea ${info.eaOverall.toFixed(0)}`, showarrow: false, xanchor: 'left', xshift: 6, font: { color: pal.danger, size: 11 } })
    const last = pts.length - 1
    shapes.push({ type: 'line', x0: last - 0.3, x1: last - 0.3, y0: pts[0].energy, y1: pts[last].energy, line: { color: pal.accent, width: 1.5 } })
    annotations.push({ x: last - 0.3, y: (pts[last].energy + pts[0].energy) / 2, text: `ΔH ${info.dH.toFixed(0)}`, showarrow: false, xanchor: 'right', xshift: -6, font: { color: pal.accent, size: 11 } })
  }
  layout.shapes = shapes
  layout.annotations = annotations
  return { data, layout }
}

// ------------------------------------------------------------------ order, Arrhenius, Lineweaver–Burk

function lineTrace(x: number[], slope: number, intercept: number, name: string, color: string): Trace {
  const lo = Math.min(...x)
  const hi = Math.max(...x)
  const pad = (hi - lo || 1) * 0.03
  return { type: 'scatter', mode: 'lines', name, x: [lo - pad, hi + pad], y: [intercept + slope * (lo - pad), intercept + slope * (hi + pad)], line: { color, width: 2 } }
}

export function orderFigure(t: number[], f: OrderFit, pal: Palette = DEFAULT_PALETTE): Figure {
  const data: Trace[] = [
    { type: 'scatter', mode: 'markers', name: 'data', x: t, y: f.yData, marker: { color: pal.link, size: 8 } },
    lineTrace(t, f.fit.slope, f.fit.intercept, `fit (R² = ${f.fit.r2.toFixed(4)})`, pal.accent),
  ]
  return { data, layout: layoutBase(pal, 't', f.yLabel) }
}

export function arrheniusFigure(r: ArrheniusResult | EyringResult, x: number[], y: number[], eyringPlot: boolean, pal: Palette = DEFAULT_PALETTE): Figure {
  const data: Trace[] = [
    { type: 'scatter', mode: 'markers', name: 'data', x, y, marker: { color: pal.link, size: 8 } },
    lineTrace(x, r.fit.slope, r.fit.intercept, `fit (R² = ${r.fit.r2.toFixed(4)})`, pal.accent),
  ]
  return { data, layout: layoutBase(pal, '1/T (K⁻¹)', eyringPlot ? 'ln(k/T)' : 'ln k') }
}

export function michaelisFigure(r: MmResult, pal: Palette = DEFAULT_PALETTE): { saturation: Figure; lineweaver: Figure } {
  const sMax = Math.max(...r.points.map((p) => p.s0))
  const grid = Array.from({ length: 80 }, (_, k) => (sMax * 1.1 * (k + 1)) / 80)
  const saturation: Figure = {
    data: [
      { type: 'scatter', mode: 'lines', name: 'Michaelis–Menten', x: grid, y: grid.map((s) => (r.vmax * s) / (r.km + s)), line: { color: pal.accent, width: 2 } },
      { type: 'scatter', mode: 'markers', name: 'simulated v₀', x: r.points.map((p) => p.s0), y: r.points.map((p) => p.v), marker: { color: pal.link, size: 8 } },
    ],
    layout: layoutBase(pal, '[S]₀ (mol/L)', 'v₀ (mol L⁻¹ s⁻¹)'),
  }
  const inv = r.points.map((p) => 1 / p.s0)
  const slope = r.lb.km / r.lb.vmax
  const intercept = 1 / r.lb.vmax
  const lineweaver: Figure = {
    data: [
      { type: 'scatter', mode: 'markers', name: 'simulated', x: inv, y: r.points.map((p) => 1 / p.v), marker: { color: pal.link, size: 8 } },
      lineTrace([-1 / r.km, ...inv], slope, intercept, `1/v = ${slope.toPrecision(3)}·(1/[S]) + ${intercept.toPrecision(3)}`, pal.accent),
    ],
    layout: layoutBase(pal, '1/[S]₀ (L/mol)', '1/v₀ (L s mol⁻¹)'),
  }
  return { saturation, lineweaver }
}

// ------------------------------------------------------------------ thermodynamics and equilibrium

/** ΔG° against temperature: a straight line that crosses zero at T = ΔH/ΔS. */
export function gibbsFigure(dH: number, dS: number, T: number, pal: Palette = DEFAULT_PALETTE): Figure {
  const crossing = dS !== 0 ? dH / (dS / 1000) : NaN
  const hi = Math.max(1000, T * 1.5, Number.isFinite(crossing) && crossing > 0 ? crossing * 1.4 : 0)
  const x = Array.from({ length: 60 }, (_, i) => 1 + (hi * i) / 59)
  const data: Trace[] = [
    { type: 'scatter', mode: 'lines', name: 'ΔG°', x, y: x.map((t) => dH - (t * dS) / 1000), line: { color: pal.accent, width: 2.4 } },
    { type: 'scatter', mode: 'markers', name: 'your T', x: [T], y: [dH - (T * dS) / 1000], marker: { color: pal.warning, size: 11, line: { color: pal.surface, width: 1.5 } } },
  ]
  const layout = layoutBase(pal, 'T (K)', 'ΔG° (kJ/mol)')
  layout.shapes = [{ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: pal.muted, dash: 'dot', width: 1 } }]
  return { data, layout }
}

/** Initial against equilibrium amounts of an ICE table. */
export function iceFigure(rows: { name: string; initial: number; equilibrium: number }[], pal: Palette = DEFAULT_PALETTE): Figure {
  const names = rows.map((r) => r.name)
  const data: Trace[] = [
    { type: 'bar', name: 'initial', x: names, y: rows.map((r) => r.initial), marker: { color: withAlpha(pal.muted, 0.6) } },
    { type: 'bar', name: 'equilibrium', x: names, y: rows.map((r) => r.equilibrium), marker: { color: pal.accent } },
  ]
  const layout = layoutBase(pal, '', 'amount (mol/L or pressure)')
  layout.barmode = 'group'
  return { data, layout }
}
