// Digital filters (pure): IIR design from analog prototypes (Butterworth, Chebyshev I and II) by the bilinear
// transform in zero–pole–gain form, second-order sections, FIR design by windowing, lfilter / filtfilt, frequency
// response (magnitude, phase, group delay), poles and zeros, step and impulse responses.
// The algorithms follow scipy.signal (buttap, cheb1ap, cheb2ap, lp2*_zpk, bilinear_zpk, zpk2sos, firwin).

import { convolveFft } from './fft.ts'
import { besselI0, isWindowName, makeWindow, type WindowName } from './windows.ts'

// ------------------------------------------------------------------------------------------------- complex

export interface Cx { re: number; im: number }
const cx = (re: number, im = 0): Cx => ({ re, im })
const cadd = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im)
const csub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im)
const cmul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
const cscale = (a: Cx, s: number): Cx => cx(a.re * s, a.im * s)
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im)
function cdiv(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
function csqrt(a: Cx): Cx {
  const m = cabs(a)
  const re = Math.sqrt(Math.max(0, (m + a.re) / 2))
  const im = Math.sqrt(Math.max(0, (m - a.re) / 2))
  return cx(re, a.im < 0 ? -im : im)
}
const cneg = (a: Cx): Cx => cx(-a.re, -a.im)
const cprod = (list: Cx[]): Cx => list.reduce((p, q) => cmul(p, q), cx(1))

/** Polynomial with the given roots (highest power first), real part of the coefficients. */
export function polyFromRoots(roots: Cx[]): number[] {
  let p: Cx[] = [cx(1)]
  for (const r of roots) {
    const next: Cx[] = new Array(p.length + 1).fill(null).map(() => cx(0))
    for (let i = 0; i < p.length; i++) {
      next[i] = cadd(next[i], p[i])
      next[i + 1] = csub(next[i + 1], cmul(p[i], r))
    }
    p = next
  }
  return p.map((c) => c.re)
}

/** Roots of a polynomial (highest power first) by the Aberth–Ehrlich iteration. */
export function polyRoots(coeffs: readonly number[]): Cx[] {
  let c = [...coeffs]
  while (c.length && c[0] === 0) c.shift()
  let zeros = 0
  while (c.length > 1 && c[c.length - 1] === 0) { c.pop(); zeros++ }
  const n = c.length - 1
  const roots: Cx[] = []
  if (n >= 1) {
    const a = c.map((v) => v / c[0])
    const radius = 1 + Math.max(...a.slice(1).map(Math.abs))
    const r0 = Math.min(radius, Math.pow(Math.abs(a[n]) || 1, 1 / n) + 0.1)
    const z: Cx[] = []
    for (let k = 0; k < n; k++) {
      const ang = (2 * Math.PI * k) / n + 0.4
      z.push(cx(r0 * Math.cos(ang), r0 * Math.sin(ang)))
    }
    const evalP = (x: Cx): { p: Cx; d: Cx } => {
      let p = cx(a[0])
      let d = cx(0)
      for (let i = 1; i <= n; i++) {
        d = cadd(cmul(d, x), p)
        p = cadd(cmul(p, x), cx(a[i]))
      }
      return { p, d }
    }
    for (let it = 0; it < 500; it++) {
      let worst = 0
      for (let i = 0; i < n; i++) {
        const { p, d } = evalP(z[i])
        if (cabs(p) < 1e-300) continue
        const ratio = cdiv(p, d)
        let s = cx(0)
        for (let j = 0; j < n; j++) if (j !== i) s = cadd(s, cdiv(cx(1), csub(z[i], z[j])))
        const denom = csub(cx(1), cmul(ratio, s))
        const w = cdiv(ratio, denom)
        z[i] = csub(z[i], w)
        worst = Math.max(worst, cabs(w) / Math.max(1, cabs(z[i])))
      }
      if (worst < 1e-14) break
    }
    // clean the numerically real roots
    for (const r of z) roots.push(Math.abs(r.im) < 1e-9 * Math.max(1, Math.abs(r.re)) ? cx(r.re) : r)
  }
  for (let i = 0; i < zeros; i++) roots.push(cx(0))
  return roots
}

// ------------------------------------------------------------------------------------------------- zpk

export interface Zpk { z: Cx[]; p: Cx[]; k: number }

/** Analog prototypes with the cutoff at 1 rad/s. */
export function butterAnalog(n: number): Zpk {
  const p: Cx[] = []
  for (let m = -n + 1; m < n; m += 2) {
    const a = (Math.PI * m) / (2 * n)
    p.push(cx(-Math.cos(a), -Math.sin(a)))
  }
  return { z: [], p, k: 1 }
}

export function cheby1Analog(n: number, rp: number): Zpk {
  const eps = Math.sqrt(10 ** (0.1 * rp) - 1)
  const mu = Math.asinh(1 / eps) / n
  const p: Cx[] = []
  for (let m = -n + 1; m < n; m += 2) {
    const th = (Math.PI * m) / (2 * n)
    // -sinh(mu + i th)
    p.push(cx(-Math.sinh(mu) * Math.cos(th), -Math.cosh(mu) * Math.sin(th)))
  }
  let k = cprod(p.map(cneg)).re
  if (n % 2 === 0) k /= Math.sqrt(1 + eps * eps)
  return { z: [], p, k }
}

export function cheby2Analog(n: number, rs: number): Zpk {
  const de = 1 / Math.sqrt(10 ** (0.1 * rs) - 1)
  const mu = Math.asinh(1 / de) / n
  const ms: number[] = []
  if (n % 2) {
    for (let m = -n + 1; m < 0; m += 2) ms.push(m)
    for (let m = 2; m < n; m += 2) ms.push(m)
  } else for (let m = -n + 1; m < n; m += 2) ms.push(m)
  // z = -conj(1j / sin(m π / 2n)) = -conj(-i / s) ... computed directly: 1j/s has re 0, im 1/s
  const z: Cx[] = ms.map((m) => {
    const s = Math.sin((m * Math.PI) / (2 * n))
    return cx(0, 1 / s) // -conj(0 + i/s) = -(0 - i/s) = i/s
  })
  const p: Cx[] = []
  for (let m = -n + 1; m < n; m += 2) {
    const a = (Math.PI * m) / (2 * n)
    const b = cx(-Math.cos(a), -Math.sin(a))
    const warped = cx(Math.sinh(mu) * b.re, Math.cosh(mu) * b.im)
    p.push(cdiv(cx(1), warped))
  }
  const k = cdiv(cprod(p.map(cneg)), cprod(z.map(cneg))).re
  return { z, p, k }
}

const zeros = (count: number): Cx[] => new Array(count).fill(null).map(() => cx(0))

function lp2lp(f: Zpk, wo: number): Zpk {
  const degree = f.p.length - f.z.length
  return { z: f.z.map((v) => cscale(v, wo)), p: f.p.map((v) => cscale(v, wo)), k: f.k * wo ** degree }
}

function lp2hp(f: Zpk, wo: number): Zpk {
  const degree = f.p.length - f.z.length
  const z = f.z.map((v) => cdiv(cx(wo), v)).concat(zeros(degree))
  const p = f.p.map((v) => cdiv(cx(wo), v))
  const k = f.k * cdiv(cprod(f.z.map(cneg)), cprod(f.p.map(cneg))).re
  return { z, p, k }
}

function lp2bp(f: Zpk, wo: number, bw: number): Zpk {
  const degree = f.p.length - f.z.length
  const split = (list: Cx[]): Cx[] => {
    const lp = list.map((v) => cscale(v, bw / 2))
    const out: Cx[] = []
    for (const v of lp) { const s = csqrt(csub(cmul(v, v), cx(wo * wo))); out.push(cadd(v, s)) }
    for (const v of lp) { const s = csqrt(csub(cmul(v, v), cx(wo * wo))); out.push(csub(v, s)) }
    return out
  }
  return { z: split(f.z).concat(zeros(degree)), p: split(f.p), k: f.k * bw ** degree }
}

function lp2bs(f: Zpk, wo: number, bw: number): Zpk {
  const degree = f.p.length - f.z.length
  const split = (list: Cx[]): Cx[] => {
    const hp = list.map((v) => cdiv(cx(bw / 2), v))
    const out: Cx[] = []
    for (const v of hp) { const s = csqrt(csub(cmul(v, v), cx(wo * wo))); out.push(cadd(v, s)) }
    for (const v of hp) { const s = csqrt(csub(cmul(v, v), cx(wo * wo))); out.push(csub(v, s)) }
    return out
  }
  const z = split(f.z)
  for (let i = 0; i < degree; i++) { z.push(cx(0, wo)); z.push(cx(0, -wo)) }
  const k = f.k * cdiv(cprod(f.z.map(cneg)), cprod(f.p.map(cneg))).re
  return { z, p: split(f.p), k }
}

/** Bilinear transform with fs = 2 (frequencies normalised to Nyquist = 1). */
function bilinear(f: Zpk): Zpk {
  const fs2 = 4
  const degree = f.p.length - f.z.length
  const z = f.z.map((v) => cdiv(cadd(cx(fs2), v), csub(cx(fs2), v)))
  const p = f.p.map((v) => cdiv(cadd(cx(fs2), v), csub(cx(fs2), v)))
  for (let i = 0; i < degree; i++) z.push(cx(-1))
  const k = f.k * cdiv(cprod(f.z.map((v) => csub(cx(fs2), v))), cprod(f.p.map((v) => csub(cx(fs2), v)))).re
  return { z, p, k }
}

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop'
export type IirFamily = 'butter' | 'cheby1' | 'cheby2'

/** Digital zero–pole–gain of an IIR filter. Cutoffs in Hz; band types take [low, high]. */
export function iirZpk(family: IirFamily, type: FilterType, order: number, edges: number | [number, number], fs: number, rp = 1, rs = 40): Zpk {
  const lo = Array.isArray(edges) ? edges[0] : edges
  const hi = Array.isArray(edges) ? edges[1] : edges
  const band = type === 'bandpass' || type === 'bandstop'
  const nyq = fs / 2
  for (const f of band ? [lo, hi] : [lo]) {
    if (!(f > 0 && f < nyq)) throw new Error(`The cutoff ${fmt(f)} Hz must be between 0 and the Nyquist frequency ${fmt(nyq)} Hz.`)
  }
  if (band && !(lo < hi)) throw new Error('The lower edge must be below the upper edge.')
  if (!Number.isInteger(order) || order < 1 || order > 24) throw new Error('The order must be a whole number from 1 to 24.')
  if (family === 'cheby1' && !(rp > 0 && rp < 40)) throw new Error('The passband ripple must be between 0 and 40 dB.')
  if (family === 'cheby2' && !(rs > 0 && rs < 200)) throw new Error('The stopband attenuation must be between 0 and 200 dB.')
  const proto = family === 'butter' ? butterAnalog(order) : family === 'cheby1' ? cheby1Analog(order, rp) : cheby2Analog(order, rs)
  const warp = (f: number) => 4 * Math.tan((Math.PI * (f / nyq)) / 2)
  let analog: Zpk
  if (type === 'lowpass') analog = lp2lp(proto, warp(lo))
  else if (type === 'highpass') analog = lp2hp(proto, warp(lo))
  else {
    const w1 = warp(lo)
    const w2 = warp(hi)
    const wo = Math.sqrt(w1 * w2)
    analog = type === 'bandpass' ? lp2bp(proto, wo, w2 - w1) : lp2bs(proto, wo, w2 - w1)
  }
  return bilinear(analog)
}

const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : String(v))

// ------------------------------------------------------------------------------------------------- sos

/** A second-order section [b0, b1, b2, 1, a1, a2]. */
export type Sos = number[]

const isReal = (c: Cx) => Math.abs(c.im) <= 1e-8 * Math.max(1, cabs(c))

/** Pairs complex-conjugate and real roots into groups of at most two (each group real-coefficient). */
function pairRoots(roots: Cx[]): Cx[][] {
  const complex = roots.filter((r) => !isReal(r) && r.im > 0)
  const real = roots.filter(isReal).map((r) => cx(r.re)).sort((a, b) => a.re - b.re)
  const groups: Cx[][] = complex.map((r) => [r, cx(r.re, -r.im)])
  // real roots: pair the smallest with the largest so that sections stay well behaved
  while (real.length > 1) groups.push([real.shift()!, real.pop()!])
  if (real.length === 1) groups.push([real[0]])
  return groups
}

/** Second-order sections from zeros and poles; the gain goes into the first section. */
export function zpkToSos(zpk: Zpk): Sos[] {
  const pg = pairRoots(zpk.p)
  const zg = pairRoots(zpk.z)
  const radius = (g: Cx[]) => Math.max(...g.map(cabs))
  pg.sort((a, b) => radius(b) - radius(a)) // closest to the unit circle first
  const poly = (g: Cx[]): [number, number, number] => {
    if (g.length === 2) return [1, -(g[0].re + g[1].re), cmul(g[0], g[1]).re]
    if (g.length === 1) return [1, -g[0].re, 0]
    return [1, 0, 0]
  }
  const free = zg.slice()
  const sections: Sos[] = []
  const count = Math.max(pg.length, zg.length)
  for (let i = 0; i < count; i++) {
    const pgroup = pg[i] ?? []
    let zgroup: Cx[] = []
    if (free.length) {
      let best = 0
      if (pgroup.length) {
        let bd = Infinity
        free.forEach((g, j) => {
          const d = Math.min(...g.map((r) => Math.min(...pgroup.map((p) => cabs(csub(r, p))))))
          if (d < bd) { bd = d; best = j }
        })
      }
      zgroup = free.splice(best, 1)[0]
    }
    const b = poly(zgroup)
    const a = poly(pgroup)
    sections.push([b[0], b[1], b[2], 1, a[1], a[2]])
  }
  if (sections.length) for (let j = 0; j < 3; j++) sections[0][j] *= zpk.k
  return sections
}

/** Transfer function coefficients from sections (b and a, ascending powers of z⁻¹). */
export function sosToTf(sos: readonly Sos[]): { b: number[]; a: number[] } {
  let b = [1]
  let a = [1]
  const conv = (p: number[], q: number[]) => {
    const r = new Array(p.length + q.length - 1).fill(0)
    for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) r[i + j] += p[i] * q[j]
    return r
  }
  for (const s of sos) {
    b = conv(b, [s[0], s[1], s[2]])
    a = conv(a, [s[3], s[4], s[5]])
  }
  const trim = (v: number[]) => { while (v.length > 1 && v[v.length - 1] === 0) v.pop(); return v }
  return { b: trim(b), a: trim(a) }
}

/** IIR notch (scipy.signal.iirnotch): zeros on the unit circle at f0, −3 dB bandwidth f0/Q. */
export function notchSos(f0: number, q: number, fs: number): Sos[] {
  if (!(f0 > 0 && f0 < fs / 2)) throw new Error(`The notch frequency must be between 0 and ${fmt(fs / 2)} Hz.`)
  if (!(q > 0.1)) throw new Error('Q must be above 0.1.')
  const w0 = (Math.PI * f0) / (fs / 2)
  const bw = w0 / q
  const beta = Math.tan(bw / 2)
  const gain = 1 / (1 + beta)
  const c = Math.cos(w0)
  return [[gain, -2 * gain * c, gain, 1, -2 * gain * c, 2 * gain - 1]]
}

// ------------------------------------------------------------------------------------------------- FIR

/** Number of taps and Kaiser beta for a given stopband attenuation (dB) and transition width (Hz). */
export function kaiserOrder(attenDb: number, widthHz: number, fs: number): { taps: number; beta: number } {
  const A = Math.max(attenDb, 8)
  let beta = 0
  if (A > 50) beta = 0.1102 * (A - 8.7)
  else if (A >= 21) beta = 0.5842 * (A - 21) ** 0.4 + 0.07886 * (A - 21)
  const dw = (2 * Math.PI * Math.max(widthHz, 1e-9)) / fs
  let taps = Math.ceil((A - 7.95) / (2.285 * dw)) + 1
  if (taps % 2 === 0) taps++
  return { taps: Math.max(3, taps), beta }
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))

/** FIR by the window method (firwin): linear phase, unit gain in the (centre of the) first passband. */
export function firWindow(type: FilterType, taps: number, edges: number | [number, number], fs: number, window: WindowName = 'hamming', beta = 8.6): number[] {
  const band = type === 'bandpass' || type === 'bandstop'
  const lo = Array.isArray(edges) ? edges[0] : edges
  const hi = Array.isArray(edges) ? edges[1] : edges
  const nyq = fs / 2
  for (const f of band ? [lo, hi] : [lo]) {
    if (!(f > 0 && f < nyq)) throw new Error(`The cutoff ${fmt(f)} Hz must be between 0 and the Nyquist frequency ${fmt(nyq)} Hz.`)
  }
  if (band && !(lo < hi)) throw new Error('The lower edge must be below the upper edge.')
  if (!Number.isInteger(taps) || taps < 3 || taps > 8001) throw new Error('The number of taps must be a whole number from 3 to 8001.')
  let n = taps
  if ((type === 'highpass' || type === 'bandstop') && n % 2 === 0) n++ // a type-II FIR cannot pass the Nyquist frequency
  const m = (n - 1) / 2
  const w = makeWindow(window, n, { periodic: false, beta })
  const lp = (fc: number, i: number) => (2 * fc / fs) * sinc((2 * fc / fs) * (i - m))
  const h = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let v: number
    switch (type) {
      case 'lowpass': v = lp(lo, i); break
      case 'highpass': v = (i === m ? 1 : 0) - lp(lo, i); break
      case 'bandpass': v = lp(hi, i) - lp(lo, i); break
      default: v = (i === m ? 1 : 0) - (lp(hi, i) - lp(lo, i))
    }
    h[i] = v * w[i]
  }
  // scale to unit gain at DC (lowpass, bandstop), Nyquist (highpass) or band centre (bandpass)
  const f0 = type === 'lowpass' || type === 'bandstop' ? 0 : type === 'highpass' ? nyq : (lo + hi) / 2
  const wr = (2 * Math.PI * f0) / fs
  let re = 0
  let im = 0
  for (let i = 0; i < n; i++) { re += h[i] * Math.cos(wr * i); im -= h[i] * Math.sin(wr * i) }
  const g = Math.hypot(re, im)
  return h.map((v) => v / g)
}

// ------------------------------------------------------------------------------------------------- spec and design

export type FilterFamily = 'butter' | 'cheby1' | 'cheby2' | 'fir' | 'notch' | 'scipy'

export interface FilterSpec {
  family: FilterFamily
  type: FilterType
  /** IIR order (per band edge: a band-pass of order 4 has 8 poles); FIR: number of taps. */
  order: number
  /** Cutoff (low-pass, high-pass), lower edge (band types) or notch frequency, Hz. */
  f1: number
  /** Upper edge of band types, Hz. */
  f2: number
  /** Chebyshev I passband ripple, dB. */
  rp: number
  /** Chebyshev II stopband attenuation, dB. */
  rs: number
  window: WindowName
  beta: number
  /** Notch quality factor. */
  q: number
  /** Filter forwards and backwards (filtfilt): zero phase, squared magnitude. */
  zeroPhase: boolean
  /** Coefficients from scipy (Remez, elliptic, Bessel…); `label` says how they were made. */
  coeffs?: { sos?: number[][]; b?: number[]; a?: number[]; label?: string }
}

export const DEFAULT_FILTER: FilterSpec = {
  family: 'butter', type: 'lowpass', order: 4, f1: 1000, f2: 2000, rp: 1, rs: 40, window: 'hamming', beta: 8.6, q: 30, zeroPhase: false,
}

export const FAMILY_LABELS: Record<FilterFamily, string> = {
  butter: 'Butterworth', cheby1: 'Chebyshev I', cheby2: 'Chebyshev II', fir: 'FIR (window)', notch: 'Notch (IIR)', scipy: 'scipy design',
}

const FILTER_TYPES: readonly FilterType[] = ['lowpass', 'highpass', 'bandpass', 'bandstop']
const FAMILIES: readonly FilterFamily[] = ['butter', 'cheby1', 'cheby2', 'fir', 'notch', 'scipy']

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** A complete spec from anything JSON-like (unknown or invalid fields take the defaults). */
export function normalizeFilterSpec(raw: unknown): FilterSpec {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_FILTER
  const spec: FilterSpec = {
    family: FAMILIES.includes(o.family as FilterFamily) ? (o.family as FilterFamily) : d.family,
    type: FILTER_TYPES.includes(o.type as FilterType) ? (o.type as FilterType) : d.type,
    order: Math.round(num(o.order, d.order)),
    f1: num(o.f1, d.f1),
    f2: num(o.f2, d.f2),
    rp: num(o.rp, d.rp),
    rs: num(o.rs, d.rs),
    window: isWindowName(o.window) ? o.window : d.window,
    beta: num(o.beta, d.beta),
    q: num(o.q, d.q),
    zeroPhase: o.zeroPhase === true,
  }
  const c = o.coeffs as FilterSpec['coeffs'] | undefined
  if (c && typeof c === 'object') {
    const arr = (v: unknown): number[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : undefined)
    const sos = Array.isArray(c.sos) && c.sos.every((s) => Array.isArray(s) && s.length === 6 && s.every((x) => typeof x === 'number' && Number.isFinite(x))) ? c.sos : undefined
    const b = arr(c.b)
    const a = arr(c.a)
    if (sos || b) spec.coeffs = { ...(sos ? { sos } : {}), ...(b ? { b } : {}), ...(a ? { a } : {}), ...(typeof c.label === 'string' ? { label: c.label } : {}) }
  }
  return spec
}

export interface FilterDesign {
  spec: FilterSpec
  fs: number
  kind: 'fir' | 'iir'
  /** Sections (IIR only). */
  sos: Sos[]
  /** Transfer function in ascending powers of z⁻¹. */
  b: number[]
  a: number[]
  zeros: Cx[]
  poles: Cx[]
  /** Short description, e.g. "Butterworth low-pass, order 4, 1000 Hz". */
  label: string
  notes: string[]
}

const TYPE_LABEL: Record<FilterType, string> = { lowpass: 'low-pass', highpass: 'high-pass', bandpass: 'band-pass', bandstop: 'band-stop' }

export function describeSpec(spec: FilterSpec): string {
  const band = spec.type === 'bandpass' || spec.type === 'bandstop'
  const edge = band ? `${fmt(spec.f1)}–${fmt(spec.f2)} Hz` : `${fmt(spec.f1)} Hz`
  if (spec.family === 'notch') return `Notch ${fmt(spec.f1)} Hz, Q ${fmt(spec.q)}`
  if (spec.family === 'fir') return `FIR ${TYPE_LABEL[spec.type]}, ${spec.order} taps, ${spec.window}, ${edge}`
  if (spec.family === 'scipy') return `${spec.coeffs?.label ?? 'scipy filter'}`
  const extra = spec.family === 'cheby1' ? `, ${fmt(spec.rp)} dB ripple` : spec.family === 'cheby2' ? `, ${fmt(spec.rs)} dB stopband` : ''
  return `${FAMILY_LABELS[spec.family]} ${TYPE_LABEL[spec.type]}, order ${spec.order}${extra}, ${edge}`
}

function fromSos(spec: FilterSpec, fs: number, sos: Sos[], zpk?: Zpk, notes: string[] = []): FilterDesign {
  const tf = sosToTf(sos)
  const z = zpk?.z ?? sos.flatMap((s) => quadRoots([s[0], s[1], s[2]]))
  const p = zpk?.p ?? sos.flatMap((s) => quadRoots([s[3], s[4], s[5]]))
  return { spec, fs, kind: 'iir', sos, b: tf.b, a: tf.a, zeros: z, poles: p, label: describeSpec(spec), notes }
}

/** Roots of b0 + b1 z⁻¹ + b2 z⁻² (as roots in z). */
function quadRoots(c: [number, number, number]): Cx[] {
  const [b0, b1, b2] = c
  if (b2 === 0 && b1 === 0) return []
  if (b2 === 0) return [cx(-b1 / b0)]
  if (b0 === 0) return b1 !== 0 ? [cx(-b2 / b1)] : []
  const disc = cx(b1 * b1 - 4 * b0 * b2)
  const s = csqrt(disc)
  return [cscale(cdiv(cadd(cx(-b1), s), cx(1)), 1 / (2 * b0)), cscale(cdiv(csub(cx(-b1), s), cx(1)), 1 / (2 * b0))]
}

/** Designs a filter. Throws an Error with a readable message when the spec cannot be met. */
export function designFilter(specIn: FilterSpec | Partial<FilterSpec>, fs: number): FilterDesign {
  const spec = normalizeFilterSpec(specIn)
  if (!(fs > 0)) throw new Error('The sample rate must be above 0.')
  const notes: string[] = []
  const band = spec.type === 'bandpass' || spec.type === 'bandstop'
  if (spec.family === 'scipy') {
    const c = spec.coeffs
    if (c?.sos?.length) return fromSos(spec, fs, c.sos, undefined, notes)
    if (c?.b?.length) {
      const b = c.b
      const a = c.a?.length ? c.a : [1]
      return { spec, fs, kind: a.length === 1 ? 'fir' : 'iir', sos: [], b, a, zeros: polyRoots(b.length <= 80 ? b : []), poles: polyRoots(a), label: describeSpec(spec), notes }
    }
    throw new Error('This filter was made with scipy (Advanced) and has no coefficients yet: run it again from the Filter tab.')
  }
  if (spec.family === 'notch') return fromSos(spec, fs, notchSos(spec.f1, spec.q, fs), undefined, notes)
  if (spec.family === 'fir') {
    const b = firWindow(spec.type, spec.order, band ? [spec.f1, spec.f2] : spec.f1, fs, spec.window, spec.beta)
    if (b.length !== spec.order) notes.push(`${TYPE_LABEL[spec.type]} FIR filters need an odd number of taps: using ${b.length}.`)
    const z = b.length <= 80 ? polyRoots(b) : []
    if (b.length > 80) notes.push('Zeros are not shown for more than 80 taps.')
    return { spec, fs, kind: 'fir', sos: [], b, a: [1], zeros: z, poles: zeros(b.length - 1), label: describeSpec(spec), notes }
  }
  const zpk = iirZpk(spec.family, spec.type, spec.order, band ? [spec.f1, spec.f2] : spec.f1, fs, spec.rp, spec.rs)
  const sos = zpkToSos(zpk)
  if (spec.order * (band ? 2 : 1) > 12) notes.push('High orders are applied as second-order sections; the coefficient list b/a is shown for reference only.')
  return fromSos(spec, fs, sos, zpk, notes)
}

// ------------------------------------------------------------------------------------------------- frequency response

export interface FreqResponse {
  freq: Float64Array
  /** |H| linear. */
  mag: Float64Array
  magDb: Float64Array
  /** Phase in radians, unwrapped. */
  phase: Float64Array
  /** Group delay in samples (−dφ/dω). */
  groupDelay: Float64Array
}

function polyAt(c: readonly number[], w: number): { p: Cx; d: Cx } {
  let pr = 0, pi = 0, dr = 0, di = 0
  for (let k = 0; k < c.length; k++) {
    const co = Math.cos(w * k)
    const si = -Math.sin(w * k)
    pr += c[k] * co
    pi += c[k] * si
    dr += k * c[k] * co
    di += k * c[k] * si
  }
  return { p: cx(pr, pi), d: cx(dr, di) }
}

export function unwrapPhase(phase: ArrayLike<number>): Float64Array {
  const out = new Float64Array(phase.length)
  let offset = 0
  for (let i = 0; i < phase.length; i++) {
    if (i > 0) {
      const d = phase[i] - phase[i - 1]
      if (d > Math.PI) offset -= 2 * Math.PI * Math.ceil((d - Math.PI) / (2 * Math.PI))
      else if (d < -Math.PI) offset += 2 * Math.PI * Math.ceil((-d - Math.PI) / (2 * Math.PI))
    }
    out[i] = phase[i] + offset
  }
  return out
}

/** Frequency response of a design at the given frequencies (Hz). `zeroPhase` squares the magnitude and removes the phase. */
export function frequencyResponse(d: FilterDesign, freqs: ArrayLike<number>): FreqResponse {
  const n = freqs.length
  const mag = new Float64Array(n)
  const magDb = new Float64Array(n)
  const ph = new Float64Array(n)
  const gd = new Float64Array(n)
  const sections: Array<[readonly number[], readonly number[]]> = d.sos.length ? d.sos.map((s) => [[s[0], s[1], s[2]], [s[3], s[4], s[5]]] as [number[], number[]]) : [[d.b, d.a]]
  for (let i = 0; i < n; i++) {
    const w = (2 * Math.PI * freqs[i]) / d.fs
    let hr = 1, hi = 0, tau = 0
    for (const [b, a] of sections) {
      const pb = polyAt(b, w)
      const pa = polyAt(a, w)
      const h = cdiv(pb.p, pa.p)
      const nh = cmul(cx(hr, hi), h)
      hr = nh.re; hi = nh.im
      if (cabs(pb.p) > 1e-12) tau += cdiv(pb.d, pb.p).re
      if (cabs(pa.p) > 1e-12) tau -= cdiv(pa.d, pa.p).re
    }
    let m = Math.hypot(hr, hi)
    let phase = Math.atan2(hi, hr)
    if (d.spec.zeroPhase) { m = m * m; phase = 0; tau = 0 }
    mag[i] = m
    magDb[i] = 20 * Math.log10(Math.max(m, 1e-15))
    ph[i] = phase
    gd[i] = tau
  }
  return { freq: Float64Array.from(freqs), mag, magDb, phase: d.spec.zeroPhase ? ph : unwrapPhase(ph), groupDelay: gd }
}

/** Evenly spaced (linear) or log-spaced frequencies from f0 to f1, n points. */
export function frequencyGrid(f0: number, f1: number, n: number, log = false): Float64Array {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0
    out[i] = log ? f0 * (f1 / f0) ** t : f0 + (f1 - f0) * t
  }
  return out
}

/** |H| in dB at one frequency. */
export function gainDbAt(d: FilterDesign, f: number): number {
  return frequencyResponse(d, [f]).magDb[0]
}

// ------------------------------------------------------------------------------------------------- filtering

/** Direct form II transposed difference equation (like scipy.signal.lfilter). */
export function lfilter(bIn: readonly number[], aIn: readonly number[], x: ArrayLike<number>, zi?: ArrayLike<number>): Float64Array {
  const a0 = aIn[0]
  if (!a0) throw new Error('The first denominator coefficient must not be zero.')
  const n = Math.max(bIn.length, aIn.length)
  const b = new Float64Array(n)
  const a = new Float64Array(n)
  for (let i = 0; i < bIn.length; i++) b[i] = bIn[i] / a0
  for (let i = 0; i < aIn.length; i++) a[i] = aIn[i] / a0
  const z = new Float64Array(Math.max(0, n - 1))
  if (zi) for (let i = 0; i < z.length && i < zi.length; i++) z[i] = zi[i]
  const y = new Float64Array(x.length)
  if (n === 1) {
    for (let i = 0; i < x.length; i++) y[i] = b[0] * x[i]
    return y
  }
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const yi = b[0] * xi + z[0]
    for (let k = 0; k < n - 2; k++) z[k] = z[k + 1] + b[k + 1] * xi - a[k + 1] * yi
    z[n - 2] = b[n - 1] * xi - a[n - 1] * yi
    y[i] = yi
  }
  return y
}

/** Initial state for a unit step (the steady state), like scipy.signal.lfilter_zi. */
export function lfilterZi(bIn: readonly number[], aIn: readonly number[]): Float64Array {
  const n = Math.max(bIn.length, aIn.length)
  const a0 = aIn[0]
  const b = Array.from({ length: n }, (_, i) => (bIn[i] ?? 0) / a0)
  const a = Array.from({ length: n }, (_, i) => (aIn[i] ?? 0) / a0)
  const m = n - 1
  const zi = new Float64Array(m)
  if (m === 0) return zi
  // (I − A) zi = B − a·b0 with A the companion matrix of the transposed form
  const mat: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0))
  for (let i = 0; i < m; i++) {
    mat[i][i] += 1
    mat[i][0] += a[i + 1]
    if (i + 1 < m) mat[i][i + 1] -= 1
    mat[i][m] = b[i + 1] - a[i + 1] * b[0]
  }
  // Gauss elimination with partial pivoting
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(mat[r][c]) > Math.abs(mat[piv][c])) piv = r
    if (Math.abs(mat[piv][c]) < 1e-14) return new Float64Array(m)
    ;[mat[c], mat[piv]] = [mat[piv], mat[c]]
    for (let r = 0; r < m; r++) {
      if (r === c) continue
      const f = mat[r][c] / mat[c][c]
      if (f !== 0) for (let k = c; k <= m; k++) mat[r][k] -= f * mat[c][k]
    }
  }
  for (let i = 0; i < m; i++) zi[i] = mat[i][m] / mat[i][i]
  return zi
}

/** Cascade of second-order sections (direct form II transposed), optionally starting from the steady state of the first sample. */
export function sosfilt(sos: readonly Sos[], x: ArrayLike<number>, steadyStart = false): Float64Array {
  let y = Float64Array.from(x as ArrayLike<number> as number[])
  if (y.length === 0) return y
  for (const s of sos) {
    const [b0, b1, b2, a0, a1, a2] = s
    let z1 = 0
    let z2 = 0
    if (steadyStart) {
      const den = a0 + a1 + a2
      if (Math.abs(den) > 1e-12) {
        const h1 = (b0 + b1 + b2) / den
        z2 = (b2 - a2 * h1) * y[0]
        z1 = (b1 - a1 * h1 + (b2 - a2 * h1)) * y[0]
      }
    }
    const out = new Float64Array(y.length)
    for (let i = 0; i < y.length; i++) {
      const xi = y[i]
      const yi = (b0 * xi + z1) / a0
      z1 = b1 * xi - a1 * yi + z2
      z2 = b2 * xi - a2 * yi
      out[i] = yi
    }
    y = out
  }
  return y
}

function oddExtend(x: ArrayLike<number>, pad: number): Float64Array {
  const n = x.length
  const out = new Float64Array(n + 2 * pad)
  for (let i = 0; i < pad; i++) out[i] = 2 * x[0] - x[pad - i]
  for (let i = 0; i < n; i++) out[pad + i] = x[i]
  for (let i = 0; i < pad; i++) out[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i]
  return out
}

/** Zero-phase filtering: forwards then backwards, with odd extension and steady-state start (like scipy.signal.filtfilt). */
export function filtfilt(b: readonly number[], a: readonly number[], x: ArrayLike<number>): Float64Array {
  const n = x.length
  if (n < 2) return Float64Array.from(x as ArrayLike<number> as number[])
  const pad = Math.min(n - 1, 3 * Math.max(a.length, b.length))
  const ext = oddExtend(x, pad)
  const zi = lfilterZi(b, a)
  const scaled = (v: number) => zi.map((z) => z * v)
  let y = lfilter(b, a, ext, scaled(ext[0]))
  y.reverse()
  y = lfilter(b, a, y, scaled(y[0]))
  y.reverse()
  return y.slice(pad, pad + n)
}

export function sosfiltfilt(sos: readonly Sos[], x: ArrayLike<number>): Float64Array {
  const n = x.length
  if (n < 2) return Float64Array.from(x as ArrayLike<number> as number[])
  const pad = Math.min(n - 1, 3 * (2 * sos.length + 1))
  const ext = oddExtend(x, pad)
  let y = sosfilt(sos, ext, true)
  y.reverse()
  y = sosfilt(sos, y, true)
  y.reverse()
  return y.slice(pad, pad + n)
}

/** FIR filtering; long filters on long signals go through the FFT. `steady` starts as if the signal had always been x[0]. */
function firApply(b: readonly number[], x: ArrayLike<number>, steady: boolean): Float64Array {
  const n = x.length
  const m = b.length
  if (m * n <= 4e6) return lfilter(b, [1], x, steady && n ? lfilterZi(b, [1]).map((z) => z * x[0]) : undefined)
  const pre = steady ? m - 1 : 0
  const ext = new Float64Array(pre + n)
  if (pre) ext.fill(x[0], 0, pre)
  for (let i = 0; i < n; i++) ext[pre + i] = x[i]
  return convolveFft(ext, b).slice(pre, pre + n)
}

function firFiltfilt(b: readonly number[], x: ArrayLike<number>): Float64Array {
  const n = x.length
  if (n < 2) return Float64Array.from(x as ArrayLike<number> as number[])
  const pad = Math.min(n - 1, 3 * b.length)
  let y = firApply(b, oddExtend(x, pad), true)
  y.reverse()
  y = firApply(b, y, true)
  y.reverse()
  return y.slice(pad, pad + n)
}

/** Applies a design to a signal; `zeroPhase` (default: the spec's) filters forwards and backwards. */
export function applyFilter(d: FilterDesign, x: ArrayLike<number>, zeroPhase = d.spec.zeroPhase): Float64Array {
  if (d.sos.length) return zeroPhase ? sosfiltfilt(d.sos, x) : sosfilt(d.sos, x)
  if (d.a.length === 1 && d.a[0] === 1) return zeroPhase ? firFiltfilt(d.b, x) : firApply(d.b, x, false)
  return zeroPhase ? filtfilt(d.b, d.a, x) : lfilter(d.b, d.a, x)
}

/** Response to a unit impulse (n samples). */
export function impulseResponse(d: FilterDesign, n: number): Float64Array {
  const x = new Float64Array(n)
  if (n) x[0] = 1
  return applyFilter(d, x, false)
}

/** Response to a unit step (n samples). */
export function stepResponse(d: FilterDesign, n: number): Float64Array {
  return applyFilter(d, new Float64Array(n).fill(1), false)
}

/** True when every pole is inside the unit circle. */
export function isStable(d: FilterDesign): boolean {
  return d.poles.every((p) => cabs(p) < 1 - 1e-12)
}

export { besselI0 }
