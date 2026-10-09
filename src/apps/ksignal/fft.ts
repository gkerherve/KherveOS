// Fast Fourier transform for any length (pure, no browser): iterative radix-2 for powers of two and Bluestein's
// chirp-z algorithm for the rest, plus real-input helpers. Arrays are Float64Array pairs (re, im).

export const isPow2 = (n: number): boolean => n > 0 && (n & (n - 1)) === 0

/** The smallest power of two ≥ n. */
export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

interface Plan2 { cos: Float64Array; sin: Float64Array; rev: Uint32Array }
const plans2 = new Map<number, Plan2>()

function plan2(n: number): Plan2 {
  let p = plans2.get(n)
  if (p) return p
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    const a = (2 * Math.PI * i) / n
    cos[i] = Math.cos(a)
    sin[i] = -Math.sin(a)
  }
  const rev = new Uint32Array(n)
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b)
    rev[i] = r
  }
  p = { cos, sin, rev }
  if (plans2.size > 24) plans2.clear()
  plans2.set(n, p)
  return p
}

/** In-place forward radix-2 FFT (n must be a power of two). */
function fftPow2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n <= 1) return
  const { cos, sin, rev } = plan2(n)
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr
      const ti = im[i]; im[i] = im[j]; im[j] = ti
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = start + k
        const b = a + half
        const wr = cos[t]
        const wi = sin[t]
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }
}

interface PlanB { m: number; wr: Float64Array; wi: Float64Array; br: Float64Array; bi: Float64Array }
const plansB = new Map<number, PlanB>()

function planBluestein(n: number): PlanB {
  let p = plansB.get(n)
  if (p) return p
  const m = nextPow2(2 * n - 1)
  const wr = new Float64Array(n)
  const wi = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    // exp(-iπ k²/n); k² mod 2n keeps the angle small for long signals
    const a = (Math.PI * ((k * k) % (2 * n))) / n
    wr[k] = Math.cos(a)
    wi[k] = -Math.sin(a)
  }
  const br = new Float64Array(m)
  const bi = new Float64Array(m)
  br[0] = wr[0]
  bi[0] = -wi[0]
  for (let k = 1; k < n; k++) {
    br[k] = br[m - k] = wr[k]
    bi[k] = bi[m - k] = -wi[k]
  }
  fftPow2(br, bi)
  p = { m, wr, wi, br, bi }
  if (plansB.size > 8) plansB.clear()
  plansB.set(n, p)
  return p
}

function fftBluestein(re: Float64Array, im: Float64Array): void {
  const n = re.length
  const { m, wr, wi, br, bi } = planBluestein(n)
  const ar = new Float64Array(m)
  const ai = new Float64Array(m)
  for (let k = 0; k < n; k++) {
    ar[k] = re[k] * wr[k] - im[k] * wi[k]
    ai[k] = re[k] * wi[k] + im[k] * wr[k]
  }
  fftPow2(ar, ai)
  for (let k = 0; k < m; k++) {
    const r = ar[k] * br[k] - ai[k] * bi[k]
    const i = ar[k] * bi[k] + ai[k] * br[k]
    ar[k] = r
    ai[k] = -i // conjugate for the inverse transform below
  }
  fftPow2(ar, ai)
  for (let k = 0; k < n; k++) {
    const cr = ar[k] / m
    const ci = -ai[k] / m
    re[k] = cr * wr[k] - ci * wi[k]
    im[k] = cr * wi[k] + ci * wr[k]
  }
}

/** In-place FFT of any length. Forward: X[k] = Σ x[n] e^{-2πikn/N}. Inverse divides by N. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length
  if (im.length !== n) throw new Error('fft: re and im must have the same length')
  if (n <= 1) return
  if (inverse) for (let i = 0; i < n; i++) im[i] = -im[i]
  if (isPow2(n)) fftPow2(re, im)
  else fftBluestein(re, im)
  if (inverse) {
    const s = 1 / n
    for (let i = 0; i < n; i++) {
      re[i] *= s
      im[i] = -im[i] * s
    }
  }
}

/** Spectrum of a real signal: bins 0 … ⌊N/2⌋ (N/2+1 of them for even N). Zero-pads to `n` when given. */
export function rfft(x: ArrayLike<number>, n = x.length): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const m = Math.min(n, x.length)
  for (let i = 0; i < m; i++) re[i] = x[i]
  fft(re, im)
  const h = Math.floor(n / 2) + 1
  return { re: re.slice(0, h), im: im.slice(0, h) }
}

/** Inverse of rfft: the real signal of length n from bins 0 … ⌊n/2⌋. */
export function irfft(re: ArrayLike<number>, im: ArrayLike<number>, n: number): Float64Array {
  const fr = new Float64Array(n)
  const fi = new Float64Array(n)
  const h = Math.floor(n / 2) + 1
  for (let k = 0; k < h && k < re.length; k++) {
    fr[k] = re[k]
    fi[k] = im[k]
    if (k > 0 && n - k !== k && n - k < n) {
      fr[n - k] = re[k]
      fi[n - k] = -im[k]
    }
  }
  fft(fr, fi, true)
  return fr
}

/** Linear (full) convolution through the FFT: length a + b − 1. */
export function convolveFft(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const n = a.length + b.length - 1
  if (n <= 0) return new Float64Array(0)
  const m = nextPow2(n)
  const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m)
  for (let i = 0; i < a.length; i++) ar[i] = a[i]
  for (let i = 0; i < b.length; i++) br[i] = b[i]
  fft(ar, ai)
  fft(br, bi)
  for (let i = 0; i < m; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i]
    ai[i] = ar[i] * bi[i] + ai[i] * br[i]
    ar[i] = r
  }
  fft(ar, ai, true)
  return ar.slice(0, n)
}
