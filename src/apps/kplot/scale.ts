// Axis scales for kPlot: round ticks (linear, log10, ln), tick labels in the chosen number
// format, and the mapping from a data value to a position along the axis. Pure TypeScript.

import type { AxisOpt, NumberFormat, ScaleKind } from './figure.ts'

/** Round, evenly spaced tick values covering [min, max] (about `count` of them). */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min > max) [min, max] = [max, min]
  if (min === max) {
    min -= 1
    max += 1
  }
  const raw = (max - min) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag
  const start = Math.floor(min / step + 1e-9) * step
  const end = Math.ceil(max / step - 1e-9) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toPrecision(12)))
  return ticks
}

/** The tick step of a list of evenly spaced ticks. */
const stepOf = (t: number[]): number => (t.length > 1 ? t[1] - t[0] : 1)

/** Minor ticks between (and around) evenly spaced major ticks, inside [lo, hi]. */
export function minorTicks(major: number[], lo: number, hi: number): number[] {
  if (major.length < 2) return []
  const step = stepOf(major)
  const mant = step / 10 ** Math.floor(Math.log10(step))
  const div = Math.abs(mant - 2) < 0.01 ? 4 : 5
  const sub = step / div
  const out: number[] = []
  const first = major[0] - step
  const last = major[major.length - 1] + step
  for (let v = first; v <= last + sub / 2; v += sub) {
    const r = Number(v.toPrecision(12))
    if (r < lo - sub * 1e-6 || r > hi + sub * 1e-6) continue
    if (major.some((m) => Math.abs(m - r) < sub * 1e-6)) continue
    out.push(r)
  }
  return out
}

/** Major and minor ticks of a log10 axis between lo and hi (both > 0): decades when the range is wide, 1-2-5 when it is narrow. */
export function logTicks(lo: number, hi: number, count = 5): { major: number[]; minor: number[] } {
  const e0 = Math.ceil(Math.log10(lo) - 1e-9)
  const e1 = Math.floor(Math.log10(hi) + 1e-9)
  const span = e1 - e0
  if (span >= 2) {
    const k = Math.max(1, Math.ceil((span + 1) / (count + 2)))
    const major: number[] = []
    for (let e = e0; e <= e1; e += k) major.push(10 ** e)
    const minor: number[] = []
    if (k === 1) {
      for (let e = e0 - 1; e <= e1; e++) {
        for (let m = 2; m <= 9; m++) {
          const v = m * 10 ** e
          if (v > lo * (1 - 1e-9) && v < hi * (1 + 1e-9)) minor.push(Number(v.toPrecision(12)))
        }
      }
    }
    return { major, minor }
  }
  const pattern: number[] = []
  for (let e = e0 - 1; e <= e1; e++) for (const m of [1, 2, 5]) pattern.push(Number((m * 10 ** e).toPrecision(12)))
  const major = pattern.filter((v) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9))
  if (major.length < 2) {
    const t = niceTicks(lo, hi, count).filter((v) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9))
    return { major: t, minor: [] }
  }
  const minor: number[] = []
  for (let e = e0 - 1; e <= e1; e++) {
    for (const m of [3, 4, 6, 7, 8, 9]) {
      const v = m * 10 ** e
      if (v > lo && v < hi) minor.push(Number(v.toPrecision(12)))
    }
  }
  return { major, minor }
}

const MINUS = '−'

/** A number as label markup: "−1.5", "2×10^{5}", "10^{−3}", "0.250". */
export function formatValue(v: number, fmt: NumberFormat = 'auto', decimals = 2, bareDecade = false): string {
  if (!Number.isFinite(v)) return String(v)
  const neg = v < 0
  const a = Math.abs(v)
  let body: string
  const sci = (digits?: number) => {
    const [m, e] = (digits === undefined ? a.toExponential(5) : a.toExponential(digits)).split('e')
    const mant = digits === undefined ? String(Number(m)) : m
    const exp = Number(e)
    return mant === '1' && bareDecade ? `10^{${exp < 0 ? MINUS : ''}${Math.abs(exp)}}` : `${mant}×10^{${exp < 0 ? MINUS : ''}${Math.abs(exp)}}`
  }
  if (fmt === 'fixed') body = a.toFixed(decimals)
  else if (fmt === 'sci') body = a === 0 ? (0).toFixed(decimals) : sci(decimals)
  else if (a === 0) body = '0'
  else if (a >= 1e5 || a < 1e-3) body = sci()
  else body = String(Number(a.toPrecision(6)))
  return neg && !/^0(\.0*)?$/.test(body) ? MINUS + body : body
}

export interface Tick {
  /** The data value the tick sits at. */
  v: number
  /** Label markup. */
  text: string
}

export interface Scale {
  kind: ScaleKind
  /** The data range (lo < hi, whatever the direction on the page). */
  lo: number
  hi: number
  invert: boolean
  major: Tick[]
  minor: number[]
  /** Position along the axis from 0 (where lo is, unless inverted) to 1. */
  frac(v: number): number
  /** The data value at a fraction along the axis. */
  at(f: number): number
  /** Whether the value can be drawn on this scale (log scales need v > 0). */
  ok(v: number): boolean
}

const tf = (kind: ScaleKind) => (kind === 'log10' ? Math.log10 : kind === 'ln' ? Math.log : (v: number) => v)
const inv = (kind: ScaleKind) => (kind === 'log10' ? (v: number) => 10 ** v : kind === 'ln' ? Math.exp : (v: number) => v)

function finish(kind: ScaleKind, lo: number, hi: number, invert: boolean, major: Tick[], minor: number[]): Scale {
  const f = tf(kind)
  const g = inv(kind)
  const a = f(lo)
  const b = f(hi)
  return {
    kind, lo, hi, invert, major, minor,
    frac: (v) => {
      const t = (f(v) - a) / (b - a || 1)
      return invert ? 1 - t : t
    },
    at: (t) => g(a + ((invert ? 1 - t : t) * (b - a))),
    ok: (v) => Number.isFinite(v) && (kind === 'linear' || v > 0),
  }
}

export interface ScaleOptions {
  /** Include zero (bars, histograms, areas). */
  zero?: boolean
  /** Use the data range as it is, instead of widening it to round ticks. */
  exact?: boolean
  /** Leave this fraction of the data range free beyond the data (so markers are not cut by the frame). */
  pad?: number
}

/** A scale for data in [min, max] (null when there is no data) and the axis options. */
export function makeScale(ext: { min: number; max: number } | null, opt: AxisOpt, o: ScaleOptions = {}): Scale {
  const kind = opt.scale
  let lo = ext ? ext.min : kind === 'linear' ? 0 : 1
  let hi = ext ? ext.max : kind === 'linear' ? 1 : 10
  const manLo = opt.min !== null && Number.isFinite(opt.min) && (kind === 'linear' || (opt.min as number) > 0)
  const manHi = opt.max !== null && Number.isFinite(opt.max) && (kind === 'linear' || (opt.max as number) > 0)
  if (manLo) lo = opt.min as number
  if (manHi) hi = opt.max as number
  if (kind === 'linear' && o.zero && !manLo && lo > 0) lo = 0
  if (kind === 'linear' && o.zero && !manHi && hi < 0) hi = 0
  if (kind !== 'linear') {
    if (!(lo > 0)) lo = hi > 0 ? hi / 10 : 1
    if (!(hi > 0)) hi = lo * 10
  }
  if (lo > hi) [lo, hi] = [hi, lo]

  if (kind === 'log10') {
    if (!manLo && !o.exact) lo = 10 ** Math.floor(Math.log10(lo) + 1e-9)
    if (!manHi && !o.exact) hi = 10 ** Math.ceil(Math.log10(hi) - 1e-9)
    if (hi <= lo) hi = lo * 10
    const t = logTicks(lo, hi, opt.ticks)
    const major = t.major.map((v) => {
      const e = Math.log10(v)
      const decade = Math.abs(e - Math.round(e)) < 1e-9
      return { v, text: opt.format === 'auto' ? (decade && (Math.abs(e) >= 4 || e < -2) ? `10^{${e < 0 ? MINUS : ''}${Math.abs(Math.round(e))}}` : formatValue(v, 'auto', opt.decimals, true)) : formatValue(v, opt.format, opt.decimals, true) }
    })
    return finish(kind, lo, hi, opt.invert, major, t.minor)
  }

  // linear, or ln (the same in the logarithm of the values, which the axis shows)
  const f = tf(kind)
  const g = inv(kind)
  let a = f(lo)
  let b = f(hi)
  if (a === b) { a -= 1; b += 1 }
  if (o.pad && !o.exact) {
    const span = b - a
    if (!manLo && !(o.zero && a === 0)) a -= span * o.pad
    if (!manHi && !(o.zero && b === 0)) b += span * o.pad
  }
  const nice = niceTicks(a, b, opt.ticks)
  if (!o.exact) {
    if (!manLo) a = nice[0]
    if (!manHi) b = nice[nice.length - 1]
  }
  const ticks = niceTicks(a, b, opt.ticks)
  const eps = (b - a) * 1e-9
  const inside = ticks.filter((t) => t >= a - eps && t <= b + eps)
  const major = inside.map((t) => ({ v: g(t), text: formatValue(t, opt.format, opt.decimals) }))
  const minor = minorTicks(inside, a, b).map(g)
  return finish(kind, g(a), g(b), opt.invert, major, minor)
}

/** A scale with ticks at the integers 0…n−1 labelled with names (bar charts, box plots). */
export function categoryScale(names: string[], invert: boolean): Scale {
  const n = Math.max(1, names.length)
  return finish('linear', -0.5, n - 0.5, invert, names.map((text, i) => ({ v: i, text })), [])
}
