// Small helpers shared by the scenes (pure).

import type { Params, ParamDef, PlotSpec, Series } from './types.ts'

export const G_EARTH = 9.80665
export const G_MOON = 1.62
export const G_MARS = 3.71
export const G_JUPITER = 24.79
export const DEG = Math.PI / 180

/** Fixed, mid-lightness colours that read on both dark and light canvases. */
export const COLORS = {
  a: '#f59e0b', // amber
  b: '#38bdf8', // sky
  c: '#f472b6', // pink
  d: '#4ade80', // green
  e: '#a78bfa', // violet
  f: '#f87171', // red
  g: '#2dd4bf', // teal
  h: '#fb923c', // orange
  star: '#fbbf24',
  rod: '#94a3b8',
  fixed: '#64748b',
  theory: '#e879f9',
} as const

export const PALETTE = [COLORS.a, COLORS.b, COLORS.c, COLORS.d, COLORS.e, COLORS.f, COLORS.g, COLORS.h]

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export const num = (p: Params, key: string, fallback: number): number => {
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
export const str = (p: Params, key: string, fallback: string): string => {
  const v = p[key]
  return typeof v === 'string' ? v : fallback
}
export const bool = (p: Params, key: string, fallback: boolean): boolean => {
  const v = p[key]
  return typeof v === 'boolean' ? v : fallback
}

/** Deterministic random numbers (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const gauss = (r: () => number): number => {
  const u = Math.max(1e-12, r())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

/** A number with `digits` significant digits, no trailing noise ("12.35", "0.0012", "1.2e+5"). */
export function fmt(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : '—'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-4) return x.toExponential(Math.max(0, digits - 1)).replace('e+', 'e').replace(/\.?0+e/, 'e')
  const s = x.toPrecision(digits)
  return s.includes('.') && !s.includes('e') ? s.replace(/\.?0+$/, '') : s
}

/** "12.3 m". */
export const withUnit = (x: number, unit: string, digits = 4) => `${fmt(x, digits)} ${unit}`.trim()

export function timePlot(id: string, title: string, series: Series[], yLabel: string, tUnit = 's'): PlotSpec {
  return { id, title, kind: 'time', x: 't', series, xLabel: `t (${tUnit})`, yLabel }
}

export function xyPlot(id: string, title: string, x: string, series: Series[], xLabel: string, yLabel: string, equal = false): PlotSpec {
  return { id, title, kind: 'xy', x, series, xLabel, yLabel, equal }
}

/** The energy plot every conservative scene has. */
export const energyPlot = (tUnit = 's', unit = 'J'): PlotSpec =>
  timePlot('energy', 'Energies', [{ key: 'ke', label: 'kinetic' }, { key: 'pe', label: 'potential' }, { key: 'e', label: 'total' }], `energy (${unit})`, tUnit)

/** Parameter definitions of one mode (the shared ones plus the mode's own). */
export const paramsOf = (defs: ParamDef[], mode: string): ParamDef[] => defs.filter((d) => !d.modes || d.modes.includes(mode))

/** Defaults of a mode from the definitions. */
export function defaultsFor(defs: ParamDef[], mode: string, overrides: Params = {}): Params {
  const p: Params = { mode }
  for (const d of paramsOf(defs, mode)) p[d.key] = d.value
  for (const [k, v] of Object.entries(overrides)) if (k in p) p[k] = v // only values the mode actually has
  return p
}

/** A value inside a param's range, rounded to its precision (for presets and the AI tools). */
export function sanitize(defs: ParamDef[], mode: string, input: Params): Params {
  const out: Params = { mode }
  for (const d of paramsOf(defs, mode)) {
    const v = input[d.key]
    if (d.kind === 'number') out[d.key] = typeof v === 'number' && Number.isFinite(v) ? clamp(v, d.min, d.max) : d.value
    else if (d.kind === 'bool') out[d.key] = typeof v === 'boolean' ? v : d.value
    else out[d.key] = typeof v === 'string' && d.options.some((o) => o.value === v) ? v : d.value
  }
  for (const k of Object.keys(input)) if (!(k in out) && k !== 'mode' && typeof input[k] === 'object' && input[k] !== null) out[k] = input[k] // structured data (sandbox world)
  return out
}

export const wrapPi = (a: number) => {
  const t = (a + Math.PI) % (2 * Math.PI)
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI
}

/** Linear interpolation of where f crosses zero between (t0,f0) and (t1,f1). */
export const crossT = (t0: number, f0: number, t1: number, f1: number) => (f1 === f0 ? t0 : t0 + (t1 - t0) * (f0 / (f0 - f1)))
