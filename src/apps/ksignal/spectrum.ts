// Spectral analysis (pure): calibrated amplitude/phase spectrum, Welch PSD, STFT, peak finding with parabolic
// interpolation, and the tone metrics THD / SNR / SINAD / SFDR / ENOB.

import { rfft } from './fft.ts'
import { makeWindow, mainLobeHalfWidth, windowGains, type WindowName } from './windows.ts'

export interface SpectrumOptions {
  window?: WindowName
  beta?: number
  /** FFT length (≥ the number of samples used: the segment is zero-padded). Default: the number of samples. */
  nfft?: number
  /** First sample of the segment (default 0) and its length (default: up to nfft or the end). */
  start?: number
  length?: number
  /** Subtract the mean before windowing. */
  removeMean?: boolean
}

export interface Spectrum {
  /** Frequencies of the bins, Hz. */
  freq: Float64Array
  /** Single-sided amplitude: a sine of amplitude A on a bin reads A (coherent-gain corrected). */
  amp: Float64Array
  /** Phase in radians of the windowed DFT bins. */
  phase: Float64Array
  re: Float64Array
  im: Float64Array
  /** Samples used (before zero-padding) and FFT length. */
  n: number
  nfft: number
  fs: number
  /** Bin spacing, Hz. */
  df: number
  /** Window gains. */
  cg: number
  pg: number
  enbw: number
  window: WindowName
  beta: number
}

export function ampSpectrum(x: ArrayLike<number>, fs: number, opts: SpectrumOptions = {}): Spectrum {
  const window = opts.window ?? 'hann'
  const start = Math.max(0, Math.floor(opts.start ?? 0))
  const avail = Math.max(0, x.length - start)
  const n = Math.max(1, Math.min(avail, Math.floor(opts.length ?? opts.nfft ?? avail)))
  const nfft = Math.max(n, Math.floor(opts.nfft ?? n))
  const w = makeWindow(window, n, { beta: opts.beta })
  const g = windowGains(w)
  let mean = 0
  if (opts.removeMean) { for (let i = 0; i < n; i++) mean += x[start + i] ?? 0; mean /= n }
  const seg = new Float64Array(n)
  for (let i = 0; i < n; i++) seg[i] = ((x[start + i] ?? 0) - mean) * w[i]
  const { re, im } = rfft(seg, nfft)
  const bins = re.length
  const freq = new Float64Array(bins)
  const amp = new Float64Array(bins)
  const phase = new Float64Array(bins)
  const df = fs / nfft
  const nyq = nfft % 2 === 0 ? nfft / 2 : -1
  for (let k = 0; k < bins; k++) {
    freq[k] = k * df
    const m = Math.hypot(re[k], im[k])
    amp[k] = (m * (k === 0 || k === nyq ? 1 : 2)) / (n * g.cg)
    phase[k] = Math.atan2(im[k], re[k])
  }
  return { freq, amp, phase, re, im, n, nfft, fs, df, cg: g.cg, pg: g.pg, enbw: g.enbw, window, beta: opts.beta ?? 8.6 }
}

/** Amplitude in dB re `ref` (default 1), floored. */
export function toDb(a: number, ref = 1, floor = -300): number {
  return a > 0 ? Math.max(floor, 20 * Math.log10(a / ref)) : floor
}

// ------------------------------------------------------------------------------------------------- Welch

export interface WelchOptions {
  nperseg?: number
  /** Overlap as a fraction 0 … <1 (default 0.5). */
  overlap?: number
  window?: WindowName
  beta?: number
  /** 'density': V²/Hz. 'spectrum': V² per bin (power spectrum). */
  scaling?: 'density' | 'spectrum'
  /** Remove each segment's mean (default true). */
  detrend?: boolean
}

export interface Psd {
  freq: Float64Array
  psd: Float64Array
  segments: number
  nperseg: number
  scaling: 'density' | 'spectrum'
}

export function welch(x: ArrayLike<number>, fs: number, opts: WelchOptions = {}): Psd {
  const nperseg = Math.max(8, Math.min(x.length, Math.floor(opts.nperseg ?? 1024)))
  const overlap = Math.min(0.95, Math.max(0, opts.overlap ?? 0.5))
  const hop = Math.max(1, Math.round(nperseg * (1 - overlap)))
  const scaling = opts.scaling ?? 'density'
  const w = makeWindow(opts.window ?? 'hann', nperseg, { beta: opts.beta })
  let s1 = 0
  let s2 = 0
  for (let i = 0; i < nperseg; i++) { s1 += w[i]; s2 += w[i] * w[i] }
  const scale = scaling === 'density' ? 1 / (fs * s2) : 1 / (s1 * s1)
  const bins = Math.floor(nperseg / 2) + 1
  const acc = new Float64Array(bins)
  let segments = 0
  const seg = new Float64Array(nperseg)
  for (let s = 0; s + nperseg <= x.length; s += hop) {
    let mean = 0
    if (opts.detrend ?? true) { for (let i = 0; i < nperseg; i++) mean += x[s + i]; mean /= nperseg }
    for (let i = 0; i < nperseg; i++) seg[i] = (x[s + i] - mean) * w[i]
    const { re, im } = rfft(seg)
    for (let k = 0; k < bins; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
    segments++
  }
  const freq = new Float64Array(bins)
  const psd = new Float64Array(bins)
  const nyq = nperseg % 2 === 0 ? nperseg / 2 : -1
  for (let k = 0; k < bins; k++) {
    freq[k] = (k * fs) / nperseg
    psd[k] = segments ? ((acc[k] / segments) * scale * (k === 0 || k === nyq ? 1 : 2)) : 0
  }
  return { freq, psd, segments, nperseg, scaling }
}

// ------------------------------------------------------------------------------------------------- STFT

export interface StftOptions {
  nperseg?: number
  overlap?: number
  window?: WindowName
  beta?: number
  /** Zero-padded FFT length per frame (default nperseg). */
  nfft?: number
  /** At most this many frames: the hop grows for very long signals (default 4000). */
  maxFrames?: number
}

export interface Stft {
  freq: Float64Array
  /** Centre time of each frame, seconds. */
  time: Float64Array
  /** frames[t][k]: single-sided amplitude, same calibration as ampSpectrum. */
  frames: Float32Array[]
  nperseg: number
  hop: number
  fs: number
}

export function stft(x: ArrayLike<number>, fs: number, opts: StftOptions = {}): Stft {
  const nperseg = Math.max(8, Math.min(Math.max(8, x.length), Math.floor(opts.nperseg ?? 512)))
  const overlap = Math.min(0.98, Math.max(0, opts.overlap ?? 0.75))
  const hop = Math.max(1, Math.round(nperseg * (1 - overlap)), Math.ceil(Math.max(0, x.length - nperseg) / Math.max(1, opts.maxFrames ?? 4000)))
  const nfft = Math.max(nperseg, Math.floor(opts.nfft ?? nperseg))
  const w = makeWindow(opts.window ?? 'hann', nperseg, { beta: opts.beta })
  const g = windowGains(w)
  const bins = Math.floor(nfft / 2) + 1
  const nyq = nfft % 2 === 0 ? nfft / 2 : -1
  const freq = new Float64Array(bins)
  for (let k = 0; k < bins; k++) freq[k] = (k * fs) / nfft
  const frames: Float32Array[] = []
  const time: number[] = []
  const seg = new Float64Array(nperseg)
  const last = Math.max(0, x.length - nperseg)
  for (let s = 0; s <= last; s += hop) {
    for (let i = 0; i < nperseg; i++) seg[i] = (x[s + i] ?? 0) * w[i]
    const { re, im } = rfft(seg, nfft)
    const f = new Float32Array(bins)
    for (let k = 0; k < bins; k++) f[k] = (Math.hypot(re[k], im[k]) * (k === 0 || k === nyq ? 1 : 2)) / (nperseg * g.cg)
    frames.push(f)
    time.push((s + nperseg / 2) / fs)
  }
  return { freq, time: Float64Array.from(time), frames, nperseg, hop, fs }
}

// ------------------------------------------------------------------------------------------------- peaks

export interface SpectrumPeak {
  bin: number
  /** Interpolated frequency, Hz. */
  freq: number
  /** Interpolated amplitude. */
  amp: number
  ampDb: number
  /** Phase at sample 0 of the segment (cosine convention), radians; set by peakPhases. */
  phase?: number
}

export interface PeakOptions {
  /** Ignore peaks below this many dB under the highest one (default 60). */
  rangeDb?: number
  /** Ignore peaks below this absolute amplitude. */
  minAmp?: number
  maxPeaks?: number
  /** Minimum distance between two peaks, in bins (default 3). */
  minSepBins?: number
  /** First bin considered (default 1: not the DC bin). */
  fromBin?: number
  /** Parabolic interpolation of the log magnitude (default true). */
  interpolate?: boolean
}

/** Peaks of an amplitude spectrum, strongest first. */
export function findSpectrumPeaks(amp: ArrayLike<number>, df: number, opts: PeakOptions = {}): SpectrumPeak[] {
  const n = amp.length
  const from = Math.max(1, opts.fromBin ?? 1)
  let top = 0
  for (let k = from; k < n; k++) if (amp[k] > top) top = amp[k]
  if (top <= 0) return []
  const floor = Math.max(opts.minAmp ?? 0, top * 10 ** (-(opts.rangeDb ?? 60) / 20))
  const cand: number[] = []
  for (let k = from; k < n; k++) {
    const a = amp[k]
    if (a < floor || a <= 0) continue
    const left = k > 0 ? amp[k - 1] : 0
    const right = k < n - 1 ? amp[k + 1] : 0
    if (a > left && a >= right) cand.push(k)
  }
  cand.sort((p, q) => amp[q] - amp[p])
  const sep = Math.max(1, opts.minSepBins ?? 3)
  const kept: number[] = []
  for (const k of cand) {
    if (kept.every((j) => Math.abs(j - k) >= sep)) kept.push(k)
    if (kept.length >= (opts.maxPeaks ?? 20)) break
  }
  const interpolate = opts.interpolate ?? true
  return kept.map((k) => {
    let delta = 0
    let a = amp[k]
    if (interpolate && k > 0 && k < n - 1 && amp[k - 1] > 0 && amp[k + 1] > 0) {
      const al = Math.log(amp[k - 1])
      const be = Math.log(amp[k])
      const ga = Math.log(amp[k + 1])
      const den = al - 2 * be + ga
      if (den < 0) {
        delta = Math.max(-0.5, Math.min(0.5, (0.5 * (al - ga)) / den))
        a = Math.exp(be - 0.25 * (al - ga) * delta)
      }
    }
    return { bin: k, freq: (k + delta) * df, amp: a, ampDb: toDb(a) }
  })
}

/** Phase of a tone at sample 0 (cosine convention, radians) from the bin next to it, corrected for the window centre. */
export function peakPhase(s: Spectrum, freq: number): number {
  const k = Math.max(0, Math.min(s.phase.length - 1, Math.round(freq / s.df)))
  const nu = k - freq / s.df
  let p = s.phase[k] + (Math.PI * nu * s.n) / s.nfft
  p = ((p + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  return p
}

/** |W(ν)|: the window's transform at ν FFT bins from its centre frequency. */
function windowMagnitude(w: ArrayLike<number>, nu: number, nfft: number): number {
  let re = 0
  let im = 0
  const step = (-2 * Math.PI * nu) / nfft
  for (let i = 0; i < w.length; i++) {
    re += w[i] * Math.cos(step * i)
    im += w[i] * Math.sin(step * i)
  }
  return Math.hypot(re, im)
}

/**
 * Frequency and amplitude of the tone near bin k. The frequency comes from a parabola through the log magnitudes
 * of three bins (the complex Jacobsen estimator for the rectangular window); the amplitude is the bin value divided by
 * the window's response at the offset (the scalloping loss), so an off-bin tone reads its true amplitude.
 */
export function refinePeak(s: Spectrum, k: number, w?: ArrayLike<number>): { freq: number; amp: number } {
  const n = s.amp.length
  const raw = s.amp[k]
  if (k < 3 || k > n - 4 || raw <= 0) return { freq: k * s.df, amp: raw }
  let delta = 0
  if (s.window === 'rectangular' && s.nfft === s.n) {
    const xr = (i: number) => s.re[k + i]
    const xi = (i: number) => s.im[k + i]
    const dr = 2 * xr(0) - xr(-1) - xr(1)
    const di = 2 * xi(0) - xi(-1) - xi(1)
    const nr = xr(-1) - xr(1)
    const ni = xi(-1) - xi(1)
    const den = dr * dr + di * di
    if (den > 0) delta = (nr * dr + ni * di) / den
  } else if (s.window === 'flattop' && k >= 6 && k <= n - 7) {
    // the flat-top main lobe is too flat for a parabola: the centroid of the lobe's power is unbiased
    let sw = 0
    let sk = 0
    for (let j = -5; j <= 5; j++) { const p2 = s.amp[k + j] * s.amp[k + j]; sw += p2; sk += j * p2 }
    delta = sw > 0 ? sk / sw : 0
  } else {
    const al = Math.log(s.amp[k - 1])
    const be = Math.log(raw)
    const ga = Math.log(s.amp[k + 1])
    const den = al - 2 * be + ga
    if (den < 0 && Number.isFinite(den)) delta = (0.5 * (al - ga)) / den
  }
  delta = Math.max(-0.5, Math.min(0.5, delta))
  const freq = (k + delta) * s.df
  const win = w ?? makeWindow(s.window, s.n, { beta: s.beta })
  let sum = 0
  for (let i = 0; i < win.length; i++) sum += win[i]
  const m = windowMagnitude(win, delta, s.nfft)
  return { freq, amp: m > 0 ? (raw * sum) / m : raw }
}

/** Peaks of a spectrum with their refined frequency and amplitude and their phases. */
export function spectrumPeaks(s: Spectrum, opts: PeakOptions = {}): SpectrumPeak[] {
  const w = makeWindow(s.window, s.n, { beta: s.beta })
  return findSpectrumPeaks(s.amp, s.df, { ...opts, interpolate: false }).map((p) => {
    const r = refinePeak(s, p.bin, w)
    return { bin: p.bin, freq: r.freq, amp: r.amp, ampDb: toDb(r.amp), phase: peakPhase(s, r.freq) }
  })
}

// ------------------------------------------------------------------------------------------------- tone metrics

export interface ToneMetrics {
  /** Fundamental, Hz and amplitude. */
  fundamental: number
  amplitude: number
  harmonics: Array<{ order: number; freq: number; amp: number; db: number }>
  /** Total harmonic distortion: sqrt(ΣP_h / P_1) in dB and in percent. */
  thdDb: number
  thdPercent: number
  /** Signal to noise (harmonics excluded), signal to noise-and-distortion, dB. */
  snrDb: number
  sinadDb: number
  /** Effective number of bits (SINAD − 1.76) / 6.02. */
  enob: number
  /** Spurious-free dynamic range, dB below the fundamental. */
  sfdrDb: number
  /** Noise floor, dB re the fundamental amplitude per bin (mean noise bin level). */
  noiseFloorDb: number
}

export interface ToneOptions {
  /** Fundamental in Hz (default: the strongest peak). */
  fundamental?: number
  /** Highest harmonic order (default 5). */
  harmonics?: number
  /** Half width in bins of the band gathered around each tone (default: the window's main lobe). */
  halfWidth?: number
  beta?: number
}

/** One-sided periodogram power per bin, in units where a sine of amplitude A sums to A²/2 (and white noise of variance σ² to σ²). */
function binPower(s: Spectrum): Float64Array {
  const bins = s.re.length
  const p = new Float64Array(bins)
  const nyq = s.nfft % 2 === 0 ? s.nfft / 2 : -1
  const norm = s.nfft * s.n * s.pg
  for (let k = 0; k < bins; k++) p[k] = ((s.re[k] * s.re[k] + s.im[k] * s.im[k]) * (k === 0 || k === nyq ? 1 : 2)) / norm
  return p
}

export function toneMetrics(s: Spectrum, opts: ToneOptions = {}): ToneMetrics | null {
  const power = binPower(s)
  const bins = power.length
  const hw = Math.max(1, Math.round((opts.halfWidth ?? mainLobeHalfWidth(s.window, opts.beta)) * (s.nfft / s.n)))
  let f1 = opts.fundamental
  if (f1 === undefined || !(f1 > 0)) {
    const pk = spectrumPeaks(s, { maxPeaks: 1 })[0]
    if (!pk) return null
    f1 = pk.freq
  }
  const c1 = Math.round(f1 / s.df)
  const used = new Uint8Array(bins)
  // the DC region (the mean and the window's leakage of it) is neither signal nor noise
  for (let k = 0; k <= Math.max(0, Math.min(hw, c1 - hw - 1)) && k < bins; k++) used[k] = 1
  const gather = (c: number): number => {
    let sum = 0
    for (let k = Math.max(0, c - hw); k <= Math.min(bins - 1, c + hw); k++) {
      if (used[k]) continue
      sum += power[k]
      used[k] = 1
    }
    return sum
  }
  const p1 = gather(c1)
  if (p1 <= 0) return null
  const fs = s.fs
  const harm: ToneMetrics['harmonics'] = []
  let pHarm = 0
  for (let h = 2; h <= (opts.harmonics ?? 5); h++) {
    let f = (h * f1) % fs
    if (f > fs / 2) f = fs - f
    const c = Math.round(f / s.df)
    if (Math.abs(c - c1) <= 2 * hw || c >= bins - 1 || used[c]) continue
    pHarm += gather(c)
    const a = refinePeak(s, c).amp
    harm.push({ order: h, freq: f, amp: a, db: toDb(a) })
  }
  let pNoise = 0
  let count = 0
  let dcBins = 0
  for (let k = 0; k < bins; k++) {
    if (!used[k]) { pNoise += power[k]; count++ }
  }
  for (let k = 0; k < bins && used[k]; k++) dcBins++
  // the bins taken by tones would have held noise too
  const pn = count > 0 ? pNoise * ((bins - dcBins) / count) : 0
  const db = (r: number) => 10 * Math.log10(Math.max(r, 1e-300))
  let spur = 0
  for (let k = dcBins; k < bins; k++) if (Math.abs(k - c1) > hw && s.amp[k] > spur) spur = s.amp[k]
  const a1 = refinePeak(s, c1).amp
  const sinad = db(p1 / (pn + pHarm))
  return {
    fundamental: f1,
    amplitude: a1,
    harmonics: harm,
    thdDb: pHarm > 0 ? db(pHarm / p1) : -300,
    thdPercent: Math.sqrt(pHarm / p1) * 100,
    snrDb: db(p1 / pn),
    sinadDb: sinad,
    enob: (sinad - 1.76) / 6.02,
    sfdrDb: spur > 0 ? toDb(a1 / spur) : 300,
    noiseFloorDb: count > 0 ? toDb(Math.sqrt((pNoise / count) * 2) / Math.max(a1, 1e-300)) : -300,
  }
}
