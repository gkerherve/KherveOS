// Measurements on waveforms and frequency responses, Fourier analysis / THD, and a tiny expression
// language for traces ("V(out)-V(in)", "V(a)*I(R1)", "abs(V(x))").

export interface Stats {
  min: number
  max: number
  pp: number
  mean: number
  rms: number
  /** value at the end */
  last: number
}

/** Linear interpolation of y(t) at time `at`. */
export function valueAt(t: ArrayLike<number>, y: ArrayLike<number>, at: number): number {
  const n = t.length
  if (n === 0) return NaN
  if (at <= t[0]) return y[0]
  if (at >= t[n - 1]) return y[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= at) lo = mid; else hi = mid
  }
  const f = (at - t[lo]) / (t[hi] - t[lo] || 1)
  return y[lo] + f * (y[hi] - y[lo])
}

/** Statistics of y(t) between t0 and t1 (time-weighted mean and RMS). */
export function stats(t: ArrayLike<number>, y: ArrayLike<number>, t0 = -Infinity, t1 = Infinity): Stats {
  const n = t.length
  const a = Math.max(t0, t[0])
  const b = Math.min(t1, t[n - 1])
  let mn = Infinity
  let mx = -Infinity
  let sum = 0
  let sum2 = 0
  const pts: [number, number][] = [[a, valueAt(t, y, a)]]
  for (let i = 0; i < n; i++) if (t[i] > a && t[i] < b) pts.push([t[i], y[i]])
  pts.push([b, valueAt(t, y, b)])
  for (let i = 0; i < pts.length; i++) {
    mn = Math.min(mn, pts[i][1])
    mx = Math.max(mx, pts[i][1])
    if (i === 0) continue
    const dt = pts[i][0] - pts[i - 1][0]
    const y0 = pts[i - 1][1]
    const y1 = pts[i][1]
    sum += (dt * (y0 + y1)) / 2
    sum2 += (dt * (y0 * y0 + y0 * y1 + y1 * y1)) / 3 // exact for piecewise-linear y
  }
  const span = b - a || 1
  return { min: mn, max: mx, pp: mx - mn, mean: sum / span, rms: Math.sqrt(Math.max(0, sum2 / span)), last: y[n - 1] }
}

/** Times at which y crosses `level` going up (dir 1), down (−1) or either (0). */
export function crossings(t: ArrayLike<number>, y: ArrayLike<number>, level: number, dir: -1 | 0 | 1 = 1): number[] {
  const out: number[] = []
  for (let i = 1; i < t.length; i++) {
    const a = y[i - 1] - level
    const b = y[i] - level
    const up = a < 0 && b >= 0
    const down = a > 0 && b <= 0
    if ((dir >= 0 && up) || (dir <= 0 && down)) out.push(t[i - 1] + ((t[i] - t[i - 1]) * (0 - a)) / (b - a || 1))
  }
  return out
}

/** Frequency from the rising crossings of the mean level; null when there are fewer than two. */
export function frequencyOf(t: ArrayLike<number>, y: ArrayLike<number>, t0 = -Infinity): number | null {
  const s = stats(t, y, t0)
  const mid = (s.max + s.min) / 2
  const xs = crossings(t, y, mid, 1).filter((x) => x >= t0)
  if (xs.length < 2) return null
  return (xs.length - 1) / (xs[xs.length - 1] - xs[0])
}

/** 10 %–90 % rise time of the first rising edge between the low and high levels (null if none). */
export function riseTime(t: ArrayLike<number>, y: ArrayLike<number>, lo?: number, hi?: number): number | null {
  const s = stats(t, y)
  const l = lo ?? s.min
  const h = hi ?? s.max
  if (!(h > l)) return null
  const a = crossings(t, y, l + 0.1 * (h - l), 1)
  const b = crossings(t, y, l + 0.9 * (h - l), 1)
  if (a.length === 0 || b.length === 0) return null
  const t10 = a[0]
  const t90 = b.find((x) => x >= t10)
  return t90 === undefined ? null : t90 - t10
}

export function fallTime(t: ArrayLike<number>, y: ArrayLike<number>, lo?: number, hi?: number): number | null {
  const s = stats(t, y)
  const l = lo ?? s.min
  const h = hi ?? s.max
  if (!(h > l)) return null
  const a = crossings(t, y, l + 0.9 * (h - l), -1)
  const b = crossings(t, y, l + 0.1 * (h - l), -1)
  if (a.length === 0 || b.length === 0) return null
  const t90 = a[0]
  const t10 = b.find((x) => x >= t90)
  return t10 === undefined ? null : t10 - t90
}

/** Time to settle within `tol` (fraction of the final value's distance from the start) of the final value. */
export function settlingTime(t: ArrayLike<number>, y: ArrayLike<number>, tol = 0.02): number | null {
  const n = t.length
  if (n < 2) return null
  const fin = y[n - 1]
  const band = tol * Math.max(Math.abs(fin - y[0]), 1e-12)
  for (let i = n - 1; i >= 0; i--) if (Math.abs(y[i] - fin) > band) return i === n - 1 ? null : t[i + 1] - t[0]
  return 0
}

// ------------------------------------------------------------------------------ Fourier

export interface Harmonic { k: number; freq: number; mag: number; phase: number }
export interface FourierResult { fundamental: number; dc: number; harmonics: Harmonic[]; thd: number }

/**
 * Fourier analysis of a periodic steady state: the last `cycles` periods of y(t) are resampled
 * uniformly (linear interpolation) and a DFT gives the harmonics; THD is √ΣH²(2…n) / H1.
 */
export function fourier(t: ArrayLike<number>, y: ArrayLike<number>, f0: number, nHarm = 9, cycles = 1): FourierResult {
  const n = t.length
  const period = 1 / f0
  const tEnd = t[n - 1]
  const span = Math.min(cycles, Math.floor((tEnd - t[0]) / period + 1e-9)) * period
  if (!(span > 0)) throw new Error('The simulation is shorter than one period of the fundamental.')
  const m = 2048
  const t0 = tEnd - span
  const samples = new Float64Array(m)
  for (let i = 0; i < m; i++) samples[i] = valueAt(t, y, t0 + (span * i) / m)
  const cyc = span / period
  const harm: Harmonic[] = []
  let dc = 0
  for (let i = 0; i < m; i++) dc += samples[i]
  dc /= m
  for (let k = 1; k <= nHarm; k++) {
    let re = 0
    let im = 0
    const w = (2 * Math.PI * k * cyc) / m
    for (let i = 0; i < m; i++) { re += samples[i] * Math.cos(w * i); im -= samples[i] * Math.sin(w * i) }
    re *= 2 / m
    im *= 2 / m
    harm.push({ k, freq: k * f0, mag: Math.hypot(re, im), phase: (Math.atan2(im, re) * 180) / Math.PI })
  }
  let rest = 0
  for (const h of harm.slice(1)) rest += h.mag * h.mag
  return { fundamental: f0, dc, harmonics: harm, thd: harm[0].mag > 0 ? Math.sqrt(rest) / harm[0].mag : 0 }
}

// ------------------------------------------------------------------------------ AC measurements

/** Frequency at which a magnitude curve (linear) first falls to `level` times its start value; interpolated in log-f. */
export function cornerFrequency(freq: number[], mag: number[], rel = Math.SQRT1_2): number | null {
  const ref = mag[0]
  const target = ref * rel
  for (let i = 1; i < freq.length; i++) {
    if ((mag[i - 1] - target) * (mag[i] - target) <= 0 && mag[i] !== mag[i - 1]) {
      const f = (target - mag[i - 1]) / (mag[i] - mag[i - 1])
      return Math.pow(10, Math.log10(freq[i - 1]) + f * (Math.log10(freq[i]) - Math.log10(freq[i - 1])))
    }
  }
  return null
}

/** Peak of a magnitude curve: frequency, value and the half-power bandwidth with Q = f0/Δf (null if not a peak). */
export function resonance(freq: number[], mag: number[]): { f0: number; peak: number; q: number | null; bandwidth: number | null } {
  let k = 0
  for (let i = 1; i < mag.length; i++) if (mag[i] > mag[k]) k = i
  // refine with a parabola through the three points around the peak (in log f)
  let f0 = freq[k]
  let peak = mag[k]
  if (k > 0 && k < mag.length - 1) {
    const x0 = Math.log10(freq[k - 1]), x1 = Math.log10(freq[k]), x2 = Math.log10(freq[k + 1])
    const y0 = mag[k - 1], y1 = mag[k], y2 = mag[k + 1]
    const d1 = (y1 - y0) / (x1 - x0)
    const d2 = (y2 - y1) / (x2 - x1)
    const a = (d2 - d1) / (x2 - x0)
    if (a < 0) {
      const xm = (x0 + x1) / 2 - d1 / (2 * a)
      if (xm > x0 && xm < x2) {
        f0 = Math.pow(10, xm)
        peak = y0 + d1 * (xm - x0) + a * (xm - x0) * (xm - x1)
      }
    }
  }
  const half = mag[k] * Math.SQRT1_2
  let fl: number | null = null
  let fh: number | null = null
  const lerp = (i: number, j: number) => {
    const f = (half - mag[i]) / (mag[j] - mag[i])
    return Math.pow(10, Math.log10(freq[i]) + f * (Math.log10(freq[j]) - Math.log10(freq[i])))
  }
  for (let i = k; i > 0; i--) if (mag[i - 1] <= half) { fl = lerp(i - 1, i); break }
  for (let i = k; i < mag.length - 1; i++) if (mag[i + 1] <= half) { fh = lerp(i, i + 1); break }
  const bw = fl !== null && fh !== null ? fh - fl : null
  return { f0, peak: Math.max(peak, mag[k]), q: bw ? f0 / bw : null, bandwidth: bw }
}

/** Slope of a magnitude curve in dB per decade between two frequencies. */
export function slopeDbPerDecade(freq: number[], mag: number[], fa: number, fb: number): number {
  const at = (f: number) => {
    let i = 1
    while (i < freq.length - 1 && freq[i] < f) i++
    const x = (Math.log10(f) - Math.log10(freq[i - 1])) / (Math.log10(freq[i]) - Math.log10(freq[i - 1]))
    return 20 * Math.log10(mag[i - 1]) + x * (20 * Math.log10(mag[i]) - 20 * Math.log10(mag[i - 1]))
  }
  return (at(fb) - at(fa)) / (Math.log10(fb) - Math.log10(fa))
}

// ------------------------------------------------------------------------------ expressions

type Tok = { k: 'num'; v: number } | { k: 'sig'; v: string } | { k: 'op'; v: string } | { k: 'fn'; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?[a-zµ]*/i.exec(src.slice(i))
    if (num && /[\d.]/.test(ch)) {
      const text = num[0]
      const m = /^([0-9.e+-]+?)([a-zµ]*)$/i.exec(text)
      let v = parseFloat(m ? m[1] : text)
      const suf = (m ? m[2] : '').toLowerCase()
      const table: Record<string, number> = { k: 1e3, meg: 1e6, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, g: 1e9, t: 1e12 }
      for (const key of ['meg', 'k', 'm', 'u', 'µ', 'n', 'p', 'f', 'g', 't']) if (suf.startsWith(key)) { v *= table[key]; break }
      out.push({ k: 'num', v })
      i += text.length
      continue
    }
    const sig = /^([VIP][be]?)\(\s*([^()\s,]+)\s*\)/i.exec(src.slice(i))
    if (sig) {
      const head = sig[1].length === 1 ? sig[1].toUpperCase() : sig[1][0].toUpperCase() + sig[1][1].toLowerCase()
      out.push({ k: 'sig', v: `${head}(${sig[2]})` })
      i += sig[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))
    if (id) {
      i += id[0].length
      out.push({ k: 'fn', v: id[0].toLowerCase() })
      continue
    }
    if ('+-*/()^,'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue }
    throw new Error(`Unexpected “${ch}” in the expression.`)
  }
  return out
}

const FUNCS: Record<string, (x: number) => number> = {
  abs: Math.abs, sqrt: Math.sqrt, log10: Math.log10, ln: Math.log, exp: Math.exp, db: (x) => 20 * Math.log10(Math.abs(x)), sin: Math.sin, cos: Math.cos,
}

/** Evaluates an expression over the signals pointwise. */
export function evalExpr(expr: string, signals: Record<string, ArrayLike<number>>, length: number): number[] {
  const toks = tokenize(expr)
  let pos = 0
  const lookup = new Map<string, ArrayLike<number>>()
  for (const [k, v] of Object.entries(signals)) lookup.set(k.toLowerCase().replace(/\s+/g, ''), v)
  const peek = () => toks[pos]
  const take = () => toks[pos++]
  type V = number | number[]
  const map1 = (a: V, f: (x: number) => number): V => (typeof a === 'number' ? f(a) : a.map(f))
  const map2 = (a: V, b: V, f: (x: number, y: number) => number): V => {
    if (typeof a === 'number' && typeof b === 'number') return f(a, b)
    const out = new Array<number>(length)
    for (let i = 0; i < length; i++) out[i] = f(typeof a === 'number' ? a : a[i], typeof b === 'number' ? b : b[i])
    return out
  }
  const primary = (): V => {
    const t = take()
    if (!t) throw new Error('The expression ends too early.')
    if (t.k === 'num') return t.v
    if (t.k === 'sig') {
      const s = lookup.get(t.v.toLowerCase().replace(/\s+/g, ''))
      if (!s) throw new Error(`There is no signal “${t.v}”.`)
      return Array.from(s)
    }
    if (t.k === 'fn') {
      const f = FUNCS[t.v]
      if (!f) throw new Error(`Unknown function “${t.v}”.`)
      if (take()?.v !== '(') throw new Error(`Write ${t.v}( … ).`)
      const a = sum()
      if (take()?.v !== ')') throw new Error('Missing a closing bracket.')
      return map1(a, f)
    }
    if (t.v === '(') {
      const a = sum()
      if (take()?.v !== ')') throw new Error('Missing a closing bracket.')
      return a
    }
    if (t.v === '-') return map1(unary(), (x) => -x)
    if (t.v === '+') return unary()
    throw new Error(`Unexpected “${t.v}”.`)
  }
  const unary = (): V => primary()
  const power = (): V => {
    const a = unary()
    if (peek()?.k === 'op' && peek().v === '^') { take(); return map2(a, power(), Math.pow) }
    return a
  }
  const product = (): V => {
    let a = power()
    while (peek()?.k === 'op' && (peek().v === '*' || peek().v === '/')) {
      const o = take().v
      const b = power()
      a = map2(a, b, o === '*' ? (x, y) => x * y : (x, y) => x / y)
    }
    return a
  }
  const sum = (): V => {
    let a = product()
    while (peek()?.k === 'op' && (peek().v === '+' || peek().v === '-')) {
      const o = take().v
      const b = product()
      a = map2(a, b, o === '+' ? (x, y) => x + y : (x, y) => x - y)
    }
    return a
  }
  const r = sum()
  if (pos < toks.length) throw new Error(`Unexpected “${toks[pos].v}”.`)
  return typeof r === 'number' ? new Array<number>(length).fill(r) : r
}
