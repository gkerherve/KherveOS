// Window functions for spectral analysis and FIR design, with their gains (pure).

export type WindowName = 'rectangular' | 'hann' | 'hamming' | 'blackman' | 'blackmanharris' | 'flattop' | 'kaiser'

export const WINDOW_NAMES: readonly WindowName[] = ['rectangular', 'hann', 'hamming', 'blackman', 'blackmanharris', 'flattop', 'kaiser']

export const WINDOW_LABELS: Record<WindowName, string> = {
  rectangular: 'Rectangular',
  hann: 'Hann',
  hamming: 'Hamming',
  blackman: 'Blackman',
  blackmanharris: 'Blackman–Harris',
  flattop: 'Flat top',
  kaiser: 'Kaiser',
}

export const isWindowName = (s: unknown): s is WindowName => typeof s === 'string' && (WINDOW_NAMES as readonly string[]).includes(s)

/** Zeroth-order modified Bessel function of the first kind (series; accurate for the arguments windows use). */
export function besselI0(x: number): number {
  const q = (x * x) / 4
  let term = 1
  let sum = 1
  for (let k = 1; k < 500; k++) {
    term *= q / (k * k)
    sum += term
    if (term < sum * 1e-17) break
  }
  return sum
}

export interface WindowOptions {
  /** Kaiser shape parameter (default 8.6). */
  beta?: number
  /** DFT-even ("periodic") window, the right one for spectrum analysis. False: symmetric, for FIR design. Default true. */
  periodic?: boolean
}

/** Window of n points. */
export function makeWindow(name: WindowName, n: number, opts: WindowOptions = {}): Float64Array {
  const w = new Float64Array(n)
  if (n <= 0) return w
  if (n === 1) { w[0] = 1; return w }
  const periodic = opts.periodic ?? true
  const M = periodic ? n : n - 1
  const beta = opts.beta ?? 8.6
  const i0b = besselI0(beta)
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / M
    switch (name) {
      case 'rectangular': w[i] = 1; break
      case 'hann': w[i] = 0.5 - 0.5 * Math.cos(a); break
      case 'hamming': w[i] = 0.54 - 0.46 * Math.cos(a); break
      case 'blackman': w[i] = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a); break
      case 'blackmanharris': w[i] = 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a); break
      case 'flattop':
        w[i] = 0.21557895 - 0.41663158 * Math.cos(a) + 0.277263158 * Math.cos(2 * a) - 0.083578947 * Math.cos(3 * a) + 0.006947368 * Math.cos(4 * a)
        break
      case 'kaiser': {
        const r = (2 * i) / M - 1
        w[i] = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b
        break
      }
    }
  }
  return w
}

export interface WindowGains {
  /** Coherent gain: mean of the window. A sine of amplitude A shows A·cg in the raw DFT/N. */
  cg: number
  /** Power gain: mean of w². */
  pg: number
  /** Equivalent noise bandwidth in bins: N·Σw² / (Σw)². */
  enbw: number
}

export function windowGains(w: ArrayLike<number>): WindowGains {
  const n = w.length
  let s = 0
  let s2 = 0
  for (let i = 0; i < n; i++) { s += w[i]; s2 += w[i] * w[i] }
  return { cg: s / n, pg: s2 / n, enbw: s ? (n * s2) / (s * s) : 1 }
}

/** Half-width of the main lobe in bins (used to gather the power of a tone). */
export function mainLobeHalfWidth(name: WindowName, beta = 8.6): number {
  switch (name) {
    case 'rectangular': return 1
    case 'hann': case 'hamming': return 2
    case 'blackman': return 3
    case 'blackmanharris': return 4
    case 'flattop': return 5
    case 'kaiser': return Math.max(1, Math.ceil(Math.sqrt(1 + (beta / Math.PI) ** 2)))
  }
}
