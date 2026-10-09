// Time-domain tools (pure): statistics, quantisation, decimation and resampling, correlation, the Hilbert
// envelope, smoothing (moving average, median, Savitzky–Golay), peak detection and heart rate, plot decimation.

import { convolveFft, fft } from './fft.ts'
import { makeWindow } from './windows.ts'

// ------------------------------------------------------------------------------------------------- statistics

export function mean(x: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]
  return x.length ? s / x.length : 0
}

export function rms(x: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return x.length ? Math.sqrt(s / x.length) : 0
}

export function stdDev(x: ArrayLike<number>): number {
  const m = mean(x)
  let s = 0
  for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2
  return x.length > 1 ? Math.sqrt(s / (x.length - 1)) : 0
}

export interface SignalStats { n: number; mean: number; rms: number; min: number; max: number; peak: number; crest: number; std: number }

export function signalStats(x: ArrayLike<number>): SignalStats {
  let mn = Infinity
  let mx = -Infinity
  for (let i = 0; i < x.length; i++) { if (x[i] < mn) mn = x[i]; if (x[i] > mx) mx = x[i] }
  if (!x.length) { mn = 0; mx = 0 }
  const r = rms(x)
  const peak = Math.max(Math.abs(mn), Math.abs(mx))
  return { n: x.length, mean: mean(x), rms: r, min: mn, max: mx, peak, crest: r > 0 ? peak / r : 0, std: stdDev(x) }
}

export const db20 = (r: number): number => 20 * Math.log10(Math.max(r, 1e-300))

/** Signal to noise ratio in dB of `x` against a reference: 10 log10(Σref² / Σ(x − ref)²). */
export function snrAgainst(ref: ArrayLike<number>, x: ArrayLike<number>): number {
  let s = 0
  let e = 0
  const n = Math.min(ref.length, x.length)
  for (let i = 0; i < n; i++) { s += ref[i] * ref[i]; e += (x[i] - ref[i]) ** 2 }
  return 10 * Math.log10(Math.max(s, 1e-300) / Math.max(e, 1e-300))
}

// ------------------------------------------------------------------------------------------------- quantisation

/** Rounds to a uniform `bits`-bit converter with range ±fullScale (mid-tread, saturating). */
export function quantize(x: ArrayLike<number>, bits: number, fullScale = 1): Float64Array {
  const out = new Float64Array(x.length)
  const levels = 2 ** bits
  const step = (2 * fullScale) / levels
  const lo = -fullScale
  const hi = fullScale - step
  for (let i = 0; i < x.length; i++) out[i] = Math.min(hi, Math.max(lo, Math.round(x[i] / step) * step))
  return out
}

/** Ideal SNR of a full-scale sine: 6.02 N + 1.76 dB. */
export const idealSnrDb = (bits: number): number => 6.02 * bits + 1.76

// ------------------------------------------------------------------------------------------------- resampling

/** Zero-phase FIR low-pass (windowed sinc) with the group delay compensated: output has the input's length. */
export function lowpassZeroPhase(x: ArrayLike<number>, cutoffHz: number, fs: number, taps = 101): Float64Array {
  const n = taps % 2 ? taps : taps + 1
  const m = (n - 1) / 2
  const w = makeWindow('hamming', n, { periodic: false })
  const fc = cutoffHz / fs
  const h = new Float64Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const t = i - m
    h[i] = (t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t)) * w[i]
    sum += h[i]
  }
  for (let i = 0; i < n; i++) h[i] /= sum
  const full = convolveFft(x, h)
  return full.slice(m, m + x.length)
}

/** Keeps every q-th sample after an anti-alias low-pass at 0.9 of the new Nyquist frequency. */
export function decimate(x: ArrayLike<number>, q: number, fs: number): { x: Float64Array; fs: number } {
  const k = Math.max(1, Math.round(q))
  if (k === 1) return { x: Float64Array.from(x as ArrayLike<number> as number[]), fs }
  const filtered = lowpassZeroPhase(x, (0.9 * fs) / (2 * k), fs, 20 * k + 1)
  const out = new Float64Array(Math.ceil(x.length / k))
  for (let i = 0; i < out.length; i++) out[i] = filtered[i * k]
  return { x: out, fs: fs / k }
}

/** Band-limited resampling to another rate (windowed-sinc interpolation, half width 16 input samples). */
export function resample(x: ArrayLike<number>, fsIn: number, fsOut: number): Float64Array {
  if (fsIn === fsOut) return Float64Array.from(x as ArrayLike<number> as number[])
  const nOut = Math.max(0, Math.floor((x.length * fsOut) / fsIn))
  const out = new Float64Array(nOut)
  const ratio = fsIn / fsOut
  const scale = Math.min(1, fsOut / fsIn) // lower the cutoff when going down
  const half = Math.ceil(16 / scale)
  for (let m = 0; m < nOut; m++) {
    const t = m * ratio
    const c = Math.floor(t)
    let acc = 0
    let norm = 0
    for (let j = Math.max(0, c - half + 1); j <= Math.min(x.length - 1, c + half); j++) {
      const d = t - j
      const arg = scale * d
      const s = arg === 0 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg)
      const win = 0.5 + 0.5 * Math.cos((Math.PI * d) / half)
      const wgt = s * win * scale
      acc += x[j] * wgt
      norm += wgt
    }
    out[m] = norm > 1e-12 ? acc / norm : 0
  }
  return out
}

// ------------------------------------------------------------------------------------------------- correlation

/** Cross-correlation r[k] = Σ x[n+k] y[n] for lags −maxLag … +maxLag (FFT based). */
export function crossCorrelation(x: ArrayLike<number>, y: ArrayLike<number>, maxLag?: number, normalize = false): { lags: Int32Array; r: Float64Array } {
  const yr = Float64Array.from(y as ArrayLike<number> as number[]).reverse()
  const full = convolveFft(x, yr) // index i ↔ lag i − (y.length − 1)
  const L = Math.min(maxLag ?? Math.max(x.length, y.length) - 1, Math.max(x.length, y.length) - 1)
  const lags = new Int32Array(2 * L + 1)
  const r = new Float64Array(2 * L + 1)
  let norm = 1
  if (normalize) {
    let sx = 0, sy = 0
    for (let i = 0; i < x.length; i++) sx += x[i] * x[i]
    for (let i = 0; i < y.length; i++) sy += y[i] * y[i]
    norm = Math.sqrt(sx * sy) || 1
  }
  for (let k = -L; k <= L; k++) {
    const idx = k + (y.length - 1)
    lags[k + L] = k
    r[k + L] = idx >= 0 && idx < full.length ? full[idx] / norm : 0
  }
  return { lags, r }
}

export function autoCorrelation(x: ArrayLike<number>, maxLag?: number, normalize = true): { lags: Int32Array; r: Float64Array } {
  return crossCorrelation(x, x, maxLag, normalize)
}

/** Period of a periodic signal from the first strong autocorrelation peak after the zero-lag lobe, in seconds (0 if none). */
export function estimatePeriod(x: ArrayLike<number>, fs: number, minHz = 20, maxHz = 4000): number {
  const L = Math.min(x.length - 1, Math.ceil(fs / minHz))
  const { lags, r } = autoCorrelation(x, L, true)
  const c = L
  const start = Math.max(1, Math.floor(fs / maxHz))
  // first zero crossing, then the largest peak after it
  let k = start
  while (k <= L && r[c + k] > 0) k++
  let best = 0
  let bestK = 0
  for (; k < L; k++) if (r[c + k] > best && r[c + k] >= r[c + k - 1] && r[c + k] >= r[c + k + 1]) { best = r[c + k]; bestK = k }
  if (!bestK || best < 0.3) return 0
  // parabolic refinement
  const a = r[c + bestK - 1], b = r[c + bestK], g = r[c + bestK + 1]
  const den = a - 2 * b + g
  const delta = den !== 0 ? (0.5 * (a - g)) / den : 0
  return (lags[c + bestK] + delta) / fs
}

// ------------------------------------------------------------------------------------------------- Hilbert

/** The analytic signal x + i·H{x} (FFT method). */
export function analyticSignal(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = x.length
  const re = Float64Array.from(x as ArrayLike<number> as number[])
  const im = new Float64Array(n)
  if (n < 2) return { re, im }
  fft(re, im)
  const h = new Float64Array(n)
  if (n % 2 === 0) {
    h[0] = 1; h[n / 2] = 1
    for (let i = 1; i < n / 2; i++) h[i] = 2
  } else {
    h[0] = 1
    for (let i = 1; i <= (n - 1) / 2; i++) h[i] = 2
  }
  for (let i = 0; i < n; i++) { re[i] *= h[i]; im[i] *= h[i] }
  fft(re, im, true)
  return { re, im }
}

/** Instantaneous amplitude |x + i H{x}|. */
export function hilbertEnvelope(x: ArrayLike<number>): Float64Array {
  const a = analyticSignal(x)
  const out = new Float64Array(x.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.hypot(a.re[i], a.im[i])
  return out
}

/** Instantaneous frequency in Hz from the analytic signal's phase (length n − 1 padded with the last value). */
export function instantaneousFrequency(x: ArrayLike<number>, fs: number): Float64Array {
  const a = analyticSignal(x)
  const n = x.length
  const out = new Float64Array(n)
  for (let i = 0; i < n - 1; i++) {
    const dr = a.re[i + 1] * a.re[i] + a.im[i + 1] * a.im[i]
    const di = a.im[i + 1] * a.re[i] - a.re[i + 1] * a.im[i]
    out[i] = (Math.atan2(di, dr) * fs) / (2 * Math.PI)
  }
  if (n > 1) out[n - 1] = out[n - 2]
  return out
}

// ------------------------------------------------------------------------------------------------- smoothing

/** Centred moving average of `width` samples; the window shrinks at the ends. */
export function movingAverage(x: ArrayLike<number>, width: number): Float64Array {
  const n = x.length
  const w = Math.max(1, Math.round(width))
  const before = Math.floor((w - 1) / 2)
  const after = w - 1 - before
  const cum = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + x[i]
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - before)
    const b = Math.min(n - 1, i + after)
    out[i] = (cum[b + 1] - cum[a]) / (b - a + 1)
  }
  return out
}

/** Sliding median of `width` samples (odd; the window shrinks at the ends). */
export function medianFilter(x: ArrayLike<number>, width: number): Float64Array {
  const n = x.length
  const w = Math.max(1, Math.round(width) | 1)
  const h = (w - 1) / 2
  const out = new Float64Array(n)
  const buf: number[] = []
  for (let i = 0; i < n; i++) {
    buf.length = 0
    for (let j = Math.max(0, i - h); j <= Math.min(n - 1, i + h); j++) buf.push(x[j])
    buf.sort((p, q) => p - q)
    const m = buf.length >> 1
    out[i] = buf.length % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2
  }
  return out
}

/** Solves the normal equations of a polynomial least-squares fit; returns coefficients c0 … c_order. */
function polyFit(xs: readonly number[], ys: readonly number[], order: number): number[] {
  const m = order + 1
  const mat: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0))
  for (let k = 0; k < xs.length; k++) {
    const pw = [1]
    for (let j = 1; j < 2 * m; j++) pw.push(pw[j - 1] * xs[k])
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) mat[r][c] += pw[r + c]
      mat[r][m] += pw[r] * ys[k]
    }
  }
  for (let c = 0; c < m; c++) {
    let piv = c
    for (let r = c + 1; r < m; r++) if (Math.abs(mat[r][c]) > Math.abs(mat[piv][c])) piv = r
    ;[mat[c], mat[piv]] = [mat[piv], mat[c]]
    const d = mat[c][c] || 1e-300
    for (let r = 0; r < m; r++) {
      if (r === c) continue
      const f = mat[r][c] / d
      if (f !== 0) for (let k = c; k <= m; k++) mat[r][k] -= f * mat[c][k]
    }
  }
  return mat.map((row, i) => row[m] / (row[i] || 1e-300))
}

/** Savitzky–Golay smoothing coefficients (centre-point estimate, `deriv`-th derivative, unit sample spacing). */
export function savgolCoeffs(window: number, order: number, deriv = 0): number[] {
  const w = window % 2 ? window : window + 1
  const h = (w - 1) / 2
  const p = Math.min(order, w - 1)
  // c = e_deriv^T (AᵀA)⁻¹ Aᵀ, scaled by deriv!: fit unit impulses
  const out: number[] = []
  const xs = Array.from({ length: w }, (_, i) => i - h)
  let fact = 1
  for (let i = 2; i <= deriv; i++) fact *= i
  for (let j = 0; j < w; j++) {
    const ys = new Array(w).fill(0)
    ys[j] = 1
    out.push(polyFit(xs, ys, p)[deriv] * fact)
  }
  return out
}

/**
 * Savitzky–Golay filter: fits a polynomial of `order` in a sliding window of `window` samples. The first and last
 * half windows use the polynomial fitted to the first / last `window` samples (scipy's mode="interp").
 */
export function savgol(x: ArrayLike<number>, window: number, order: number): Float64Array {
  const n = x.length
  let w = Math.max(3, Math.round(window) | 1)
  if (w > n) w = n % 2 ? n : n - 1
  if (w < 3) return Float64Array.from(x as ArrayLike<number> as number[])
  const p = Math.min(order, w - 1)
  const h = (w - 1) / 2
  const c = savgolCoeffs(w, p)
  const out = new Float64Array(n)
  for (let i = h; i < n - h; i++) {
    let s = 0
    for (let j = 0; j < w; j++) s += c[j] * x[i - h + j]
    out[i] = s
  }
  const xs = Array.from({ length: w }, (_, i) => i - h)
  const edge = (start: number, from: number, to: number) => {
    const ys = Array.from({ length: w }, (_, i) => x[start + i])
    const co = polyFit(xs, ys, p)
    for (let i = from; i < to; i++) {
      const t = i - start - h
      let v = 0
      for (let k = co.length - 1; k >= 0; k--) v = v * t + co[k]
      out[i] = v
    }
  }
  edge(0, 0, h)
  edge(n - w, n - h, n)
  return out
}

// ------------------------------------------------------------------------------------------------- peaks in time

export interface TimePeak { index: number; time: number; value: number }

/** Local maxima above `height`, at least `minDistance` seconds apart (the higher one wins). */
export function findTimePeaks(x: ArrayLike<number>, fs: number, height: number, minDistance = 0): TimePeak[] {
  const cand: number[] = []
  for (let i = 1; i < x.length - 1; i++) if (x[i] >= height && x[i] > x[i - 1] && x[i] >= x[i + 1]) cand.push(i)
  cand.sort((a, b) => x[b] - x[a])
  const dist = Math.max(1, Math.round(minDistance * fs))
  const kept: number[] = []
  for (const i of cand) if (kept.every((j) => Math.abs(j - i) >= dist)) kept.push(i)
  kept.sort((a, b) => a - b)
  return kept.map((i) => {
    // parabolic refinement of the position
    const a = x[i - 1], b = x[i], g = x[i + 1]
    const den = a - 2 * b + g
    const delta = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - g)) / den)) : 0
    return { index: i, time: (i + delta) / fs, value: b - 0.25 * (a - g) * delta }
  })
}

export interface HeartRate { beats: number; bpm: number; meanRR: number; sdnn: number; rr: number[] }

/** Heart rate from R-peak times (seconds): mean rate from the mean R–R interval, and the SDNN in seconds. */
export function heartRate(peaks: readonly TimePeak[]): HeartRate | null {
  if (peaks.length < 2) return null
  const rr: number[] = []
  for (let i = 1; i < peaks.length; i++) rr.push(peaks[i].time - peaks[i - 1].time)
  const m = mean(rr)
  return { beats: peaks.length, bpm: 60 / m, meanRR: m, sdnn: stdDev(rr), rr }
}

// ------------------------------------------------------------------------------------------------- plotting

/** At most ~maxPoints points of x[from..to] for plotting: per bucket the minimum and the maximum, so peaks survive. */
export function minMaxDecimate(xs: ArrayLike<number> | ((i: number) => number), y: ArrayLike<number>, from: number, to: number, maxPoints: number): { x: number[]; y: number[] } {
  const x = typeof xs === 'function' ? { get: xs } : { get: (i: number) => xs[i] }
  const a = Math.max(0, Math.floor(from))
  const b = Math.min(y.length, Math.ceil(to))
  const count = b - a
  if (count <= maxPoints || maxPoints < 4) {
    const xo: number[] = new Array(Math.max(0, count))
    const yo: number[] = new Array(Math.max(0, count))
    for (let i = 0; i < count; i++) { xo[i] = x.get(a + i); yo[i] = y[a + i] }
    return { x: xo, y: yo }
  }
  const buckets = Math.floor(maxPoints / 2)
  const size = count / buckets
  const xo: number[] = []
  const yo: number[] = []
  for (let k = 0; k < buckets; k++) {
    const s = a + Math.floor(k * size)
    const e = Math.min(b, a + Math.floor((k + 1) * size))
    let lo = s
    let hi = s
    for (let i = s; i < e; i++) { if (y[i] < y[lo]) lo = i; if (y[i] > y[hi]) hi = i }
    const first = Math.min(lo, hi)
    const second = Math.max(lo, hi)
    xo.push(x.get(first)); yo.push(y[first])
    if (second !== first) { xo.push(x.get(second)); yo.push(y[second]) }
  }
  return { x: xo, y: yo }
}

/** A matrix of frames×bins reduced to at most maxT×maxF cells by taking the maximum of each block. */
export function reduceMatrix(frames: readonly Float32Array[], maxT: number, maxF: number): { z: number[][]; tIdx: number[]; fIdx: number[] } {
  const nT = frames.length
  const nF = nT ? frames[0].length : 0
  const st = Math.max(1, Math.ceil(nT / maxT))
  const sf = Math.max(1, Math.ceil(nF / maxF))
  const tIdx: number[] = []
  const fIdx: number[] = []
  for (let t = 0; t < nT; t += st) tIdx.push(t)
  for (let f = 0; f < nF; f += sf) fIdx.push(f)
  // z[f][t] as Plotly heat maps want rows = y (frequency)
  const z: number[][] = fIdx.map(() => new Array(tIdx.length).fill(0))
  tIdx.forEach((t, ti) => {
    fIdx.forEach((f, fi) => {
      let m = 0
      for (let tt = t; tt < Math.min(nT, t + st); tt++) for (let ff = f; ff < Math.min(nF, f + sf); ff++) if (frames[tt][ff] > m) m = frames[tt][ff]
      z[fi][ti] = m
    })
  })
  return { z, tIdx, fIdx }
}
