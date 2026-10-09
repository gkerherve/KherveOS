// Signal generators (pure): a source is a sample rate, a duration and a list of components that are added
// (sine, square, triangle, saw, chirp, pulse train, AM, FM, harmonic series, decaying partials, synthetic ECG, DC),
// then seeded noise and an optional quantiser. The same spec always gives the same samples.

import { quantize } from './dsp.ts'

export type ComponentType = 'sine' | 'square' | 'triangle' | 'saw' | 'chirp' | 'pulse' | 'am' | 'fm' | 'harmonics' | 'partials' | 'ecg' | 'gaussian' | 'dc'

export interface Partial3 { freq: number; amp: number; tau: number }

/** One term of the sum. Fields not used by a type are ignored. */
export interface Component {
  type: ComponentType
  amp: number
  /** sine, square, triangle, saw, pulse: frequency in Hz. harmonics: fundamental. */
  freq: number
  /** Phase in degrees (sine, square, triangle, saw): sin(2π f t + φ). */
  phase: number
  /** square, pulse: duty cycle 0…1. */
  duty: number
  /** chirp: start and end frequency, Hz, and sweep law. */
  f0: number
  f1: number
  sweep: 'linear' | 'log'
  /** am, fm: carrier and modulating frequency, Hz. */
  carrier: number
  mod: number
  /** am: modulation depth 0…1. */
  depth: number
  /** fm: peak frequency deviation, Hz. */
  deviation: number
  /** harmonics: number of harmonics and amplitude roll-off (amp / k^rolloff). */
  count: number
  rolloff: number
  /** harmonics, partials: decay time constant in seconds (0 = no decay; harmonic k decays with tau / k). */
  tau: number
  /** harmonics, partials: attack time in seconds (a short linear fade-in). */
  attack: number
  /** partials: the list. */
  partials: Partial3[]
  /** ecg: heart rate in beats per minute and beat-to-beat variability (fraction of the interval). */
  bpm: number
  variability: number
  /** ecg: random seed. */
  seed: number
  /** gaussian: centre in seconds and standard deviation in seconds. */
  center: number
  width: number
  /** dc: the value is `amp`. */
}

export interface NoiseSpec { sigma: number; seed: number; color: 'white' | 'pink' }

export interface GeneratorSource {
  kind: 'generator'
  fs: number
  duration: number
  components: Component[]
  noise: NoiseSpec
  /** Quantiser resolution in bits (0 = none) and its full-scale range ±fullScale. */
  bits: number
  fullScale: number
}

export const MAX_SAMPLES = 2 ** 21
export const MAX_FS = 192000

export const COMPONENT_LABELS: Record<ComponentType, string> = {
  sine: 'Sine', square: 'Square', triangle: 'Triangle', saw: 'Sawtooth', chirp: 'Chirp (sweep)', pulse: 'Pulse train',
  am: 'AM (amplitude modulated)', fm: 'FM (frequency modulated)', harmonics: 'Harmonic series (string)', partials: 'Decaying partials (bell)',
  ecg: 'Synthetic ECG', gaussian: 'Gaussian peak', dc: 'DC offset',
}

export const COMPONENT_TYPES = Object.keys(COMPONENT_LABELS) as ComponentType[]

/** The numeric fields each component type edits (for the generic editor in the source panel). */
export interface FieldDef { key: keyof Component; label: string; unit?: string; min?: number; max?: number; step?: number }
export const COMPONENT_FIELDS: Record<ComponentType, FieldDef[]> = {
  sine: [{ key: 'freq', label: 'Frequency', unit: 'Hz', min: 0, step: 1 }, { key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }, { key: 'phase', label: 'Phase', unit: '°', step: 15 }],
  square: [{ key: 'freq', label: 'Frequency', unit: 'Hz', min: 0, step: 1 }, { key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }, { key: 'duty', label: 'Duty', min: 0.01, max: 0.99, step: 0.05 }],
  triangle: [{ key: 'freq', label: 'Frequency', unit: 'Hz', min: 0, step: 1 }, { key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }, { key: 'phase', label: 'Phase', unit: '°', step: 15 }],
  saw: [{ key: 'freq', label: 'Frequency', unit: 'Hz', min: 0, step: 1 }, { key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }, { key: 'phase', label: 'Phase', unit: '°', step: 15 }],
  chirp: [{ key: 'f0', label: 'Start', unit: 'Hz', min: 0, step: 10 }, { key: 'f1', label: 'End', unit: 'Hz', min: 0, step: 10 }, { key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }],
  pulse: [{ key: 'freq', label: 'Rate', unit: 'Hz', min: 0, step: 1 }, { key: 'amp', label: 'Amplitude', step: 0.1 }, { key: 'duty', label: 'Duty', min: 0.001, max: 0.99, step: 0.01 }],
  am: [{ key: 'carrier', label: 'Carrier', unit: 'Hz', min: 0, step: 10 }, { key: 'mod', label: 'Modulation', unit: 'Hz', min: 0, step: 1 }, { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.05 }, { key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }],
  fm: [{ key: 'carrier', label: 'Carrier', unit: 'Hz', min: 0, step: 10 }, { key: 'mod', label: 'Modulation', unit: 'Hz', min: 0, step: 1 }, { key: 'deviation', label: 'Deviation', unit: 'Hz', min: 0, step: 10 }, { key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }],
  harmonics: [{ key: 'freq', label: 'Fundamental', unit: 'Hz', min: 0, step: 1 }, { key: 'count', label: 'Harmonics', min: 1, max: 64, step: 1 }, { key: 'rolloff', label: 'Roll-off', min: 0, max: 4, step: 0.25 }, { key: 'tau', label: 'Decay τ', unit: 's', min: 0, step: 0.1 }, { key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }],
  partials: [{ key: 'amp', label: 'Amplitude', min: 0, step: 0.1 }, { key: 'attack', label: 'Attack', unit: 's', min: 0, step: 0.001 }],
  ecg: [{ key: 'bpm', label: 'Heart rate', unit: 'bpm', min: 20, max: 240, step: 1 }, { key: 'amp', label: 'R amplitude', min: 0, step: 0.1 }, { key: 'variability', label: 'Variability', min: 0, max: 0.5, step: 0.01 }, { key: 'seed', label: 'Seed', min: 0, step: 1 }],
  gaussian: [{ key: 'amp', label: 'Height', step: 0.1 }, { key: 'center', label: 'Centre', unit: 's', min: 0, step: 0.01 }, { key: 'width', label: 'Width σ', unit: 's', min: 0.0001, step: 0.001 }],
  dc: [{ key: 'amp', label: 'Value', step: 0.1 }],
}

const BASE: Component = {
  type: 'sine', amp: 1, freq: 440, phase: 0, duty: 0.5, f0: 100, f1: 1000, sweep: 'linear', carrier: 1000, mod: 100, depth: 0.5, deviation: 200,
  count: 8, rolloff: 1, tau: 0, attack: 0, partials: [], bpm: 72, variability: 0, seed: 1, center: 0.5, width: 0.02,
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/** A complete component of a type (defaults for what the type needs). */
export function defaultComponent(type: ComponentType): Component {
  const c: Component = { ...BASE, type, partials: [] }
  switch (type) {
    case 'sine': break
    case 'square': case 'triangle': case 'saw': c.freq = 100; break
    case 'chirp': c.f0 = 100; c.f1 = 2000; break
    case 'pulse': c.freq = 10; c.duty = 0.05; break
    case 'harmonics': c.freq = 110; c.count = 8; c.tau = 1; c.attack = 0.005; break
    case 'partials':
      c.partials = [{ freq: 523.25, amp: 1, tau: 1.2 }, { freq: 1046.5, amp: 0.5, tau: 0.8 }, { freq: 1568.8, amp: 0.3, tau: 0.5 }]
      c.attack = 0.002
      break
    case 'ecg': c.amp = 1; c.bpm = 72; break
    case 'gaussian': c.amp = 1; break
    case 'dc': c.amp = 0.5; break
    default: break
  }
  return c
}

/** A component from anything JSON-like; unknown fields are dropped and bad numbers take the defaults. */
export function normalizeComponent(raw: unknown): Component | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!o || typeof o.type !== 'string' || !COMPONENT_TYPES.includes(o.type as ComponentType)) return null
  const d = defaultComponent(o.type as ComponentType)
  const c: Component = { ...d }
  for (const key of Object.keys(d) as Array<keyof Component>) {
    if (key === 'type' || key === 'partials' || key === 'sweep') continue
    ;(c as unknown as Record<string, number>)[key] = num(o[key], d[key] as number)
  }
  c.sweep = o.sweep === 'log' ? 'log' : 'linear'
  if (Array.isArray(o.partials)) {
    c.partials = o.partials
      .map((p) => (p && typeof p === 'object' ? { freq: num((p as Record<string, unknown>).freq, NaN), amp: num((p as Record<string, unknown>).amp, 1), tau: num((p as Record<string, unknown>).tau, 0) } : null))
      .filter((p): p is Partial3 => !!p && Number.isFinite(p.freq) && p.freq > 0)
      .slice(0, 64)
  }
  return c
}

export const DEFAULT_GENERATOR: GeneratorSource = {
  kind: 'generator', fs: 8000, duration: 1, components: [{ ...BASE, freq: 440, amp: 1 }], noise: { sigma: 0, seed: 1, color: 'white' }, bits: 0, fullScale: 1,
}

/** A complete generator source from anything JSON-like. */
export function normalizeGenerator(raw: unknown): GeneratorSource {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const comps = Array.isArray(o.components) ? o.components.map(normalizeComponent).filter((c): c is Component => !!c).slice(0, 32) : DEFAULT_GENERATOR.components
  const n = (o.noise && typeof o.noise === 'object' ? o.noise : {}) as Record<string, unknown>
  return {
    kind: 'generator',
    fs: num(o.fs, DEFAULT_GENERATOR.fs),
    duration: num(o.duration, DEFAULT_GENERATOR.duration),
    components: comps,
    noise: { sigma: Math.max(0, num(n.sigma, 0)), seed: Math.round(num(n.seed, 1)), color: n.color === 'pink' ? 'pink' : 'white' },
    bits: Math.max(0, Math.min(24, Math.round(num(o.bits, 0)))),
    fullScale: num(o.fullScale, 1) > 0 ? num(o.fullScale, 1) : 1,
  }
}

/** Problems that stop a source from being generated (empty list = fine). */
export function sourceProblems(src: GeneratorSource): string[] {
  const out: string[] = []
  if (!(src.fs >= 1 && src.fs <= MAX_FS)) out.push(`The sample rate must be between 1 and ${MAX_FS} Hz.`)
  if (!(src.duration > 0)) out.push('The duration must be above 0 s.')
  else if (src.fs * src.duration > MAX_SAMPLES) out.push(`That is ${Math.round(src.fs * src.duration).toLocaleString('en')} samples; the limit is ${MAX_SAMPLES.toLocaleString('en')}. Shorten the duration or lower the sample rate.`)
  if (src.fs * src.duration < 8) out.push('The signal needs at least 8 samples.')
  return out
}

// ------------------------------------------------------------------------------------------------- random numbers

/** mulberry32: a small seeded generator in [0, 1). */
export function rng(seed: number): () => number {
  let a = (Math.floor(seed) >>> 0) || 0x9e3779b9
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Gaussian noise with unit variance (Box–Muller) from a seeded generator. */
export function gaussian(rand: () => number): () => number {
  let spare: number | null = null
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s }
    let u = 0
    while (u === 0) u = rand()
    const v = rand()
    const r = Math.sqrt(-2 * Math.log(u))
    spare = r * Math.sin(2 * Math.PI * v)
    return r * Math.cos(2 * Math.PI * v)
  }
}

/** Seeded noise of the given colour with standard deviation `sigma`. */
export function noise(n: number, sigma: number, seed: number, color: 'white' | 'pink' = 'white'): Float64Array {
  const g = gaussian(rng(seed))
  const out = new Float64Array(n)
  if (color === 'white') {
    for (let i = 0; i < n; i++) out[i] = sigma * g()
    return out
  }
  // pink (1/f) noise: Paul Kellet's filter, then scaled to the requested standard deviation
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  let sum = 0
  let sum2 = 0
  for (let i = 0; i < n; i++) {
    const w = g()
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    const v = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
    out[i] = v
    sum += v
    sum2 += v * v
  }
  const m = sum / Math.max(1, n)
  const sd = Math.sqrt(Math.max(1e-300, sum2 / Math.max(1, n) - m * m))
  for (let i = 0; i < n; i++) out[i] = (sigma * (out[i] - m)) / sd
  return out
}

// ------------------------------------------------------------------------------------------------- components

const frac = (x: number) => x - Math.floor(x)

/** Beats of the synthetic ECG: the times of the R peaks in seconds. */
export function ecgBeatTimes(bpm: number, duration: number, variability: number, seed: number): number[] {
  const rr = 60 / Math.max(10, bpm)
  const g = gaussian(rng(seed))
  const times: number[] = []
  let t = rr * 0.5 // the first R wave half an interval in, so the first P wave is in the record
  while (t < duration + rr) {
    times.push(t)
    t += rr * (1 + variability * g())
  }
  return times
}

/** P, Q, R, S, T waves: [amplitude re R, centre in s from the R peak, width σ in s]. */
const ECG_WAVES: Array<[number, number, number]> = [
  [0.12, -0.2, 0.025], [-0.15, -0.045, 0.01], [1, 0, 0.012], [-0.25, 0.045, 0.012], [0.3, 0.25, 0.05],
]

function addComponent(out: Float64Array, c: Component, fs: number): void {
  const n = out.length
  const dt = 1 / fs
  const T = n / fs
  const rad = (c.phase * Math.PI) / 180
  switch (c.type) {
    case 'sine': for (let i = 0; i < n; i++) out[i] += c.amp * Math.sin(2 * Math.PI * c.freq * i * dt + rad); break
    case 'square': for (let i = 0; i < n; i++) out[i] += frac(c.freq * i * dt + c.phase / 360) < c.duty ? c.amp : -c.amp; break
    case 'triangle': for (let i = 0; i < n; i++) out[i] += c.amp * (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * c.freq * i * dt + rad)); break
    case 'saw': for (let i = 0; i < n; i++) out[i] += c.amp * (2 * frac(c.freq * i * dt + c.phase / 360 + 0.5) - 1); break
    case 'chirp': {
      const k = (c.f1 - c.f0) / T
      const ratio = c.f1 / Math.max(c.f0, 1e-9)
      for (let i = 0; i < n; i++) {
        const t = i * dt
        let ph: number
        if (c.sweep === 'log' && c.f0 > 0 && c.f1 > 0 && Math.abs(ratio - 1) > 1e-12) ph = 2 * Math.PI * ((c.f0 * T) / Math.log(ratio)) * (ratio ** (t / T) - 1)
        else ph = 2 * Math.PI * (c.f0 * t + 0.5 * k * t * t)
        out[i] += c.amp * Math.sin(ph)
      }
      break
    }
    case 'pulse': for (let i = 0; i < n; i++) out[i] += frac(c.freq * i * dt) < c.duty ? c.amp : 0; break
    case 'am': for (let i = 0; i < n; i++) { const t = i * dt; out[i] += c.amp * (1 + c.depth * Math.cos(2 * Math.PI * c.mod * t)) * Math.cos(2 * Math.PI * c.carrier * t) } break
    case 'fm': {
      const beta = c.mod > 0 ? c.deviation / c.mod : 0
      for (let i = 0; i < n; i++) { const t = i * dt; out[i] += c.amp * Math.cos(2 * Math.PI * c.carrier * t + beta * Math.sin(2 * Math.PI * c.mod * t)) }
      break
    }
    case 'harmonics': {
      const kmax = Math.max(1, Math.min(64, Math.round(c.count)))
      for (let k = 1; k <= kmax; k++) {
        const f = c.freq * k
        if (f >= fs / 2) break
        const a = c.amp / k ** c.rolloff
        const tau = c.tau > 0 ? c.tau / k : 0
        for (let i = 0; i < n; i++) {
          const t = i * dt
          const env = (tau > 0 ? Math.exp(-t / tau) : 1) * (c.attack > 0 ? Math.min(1, t / c.attack) : 1)
          out[i] += a * env * Math.sin(2 * Math.PI * f * t)
        }
      }
      break
    }
    case 'partials':
      for (const p of c.partials) {
        for (let i = 0; i < n; i++) {
          const t = i * dt
          const env = (p.tau > 0 ? Math.exp(-t / p.tau) : 1) * (c.attack > 0 ? Math.min(1, t / c.attack) : 1)
          out[i] += c.amp * p.amp * env * Math.sin(2 * Math.PI * p.freq * t)
        }
      }
      break
    case 'ecg': {
      const beats = ecgBeatTimes(c.bpm, T, c.variability, c.seed)
      for (const tb of beats) {
        for (const [a, mu, sg] of ECG_WAVES) {
          const centre = tb + mu
          const i0 = Math.max(0, Math.floor((centre - 5 * sg) * fs))
          const i1 = Math.min(n - 1, Math.ceil((centre + 5 * sg) * fs))
          for (let i = i0; i <= i1; i++) out[i] += c.amp * a * Math.exp(-0.5 * ((i * dt - centre) / sg) ** 2)
        }
      }
      break
    }
    case 'gaussian': for (let i = 0; i < n; i++) out[i] += c.amp * Math.exp(-0.5 * ((i * dt - c.center) / Math.max(c.width, 1e-9)) ** 2); break
    case 'dc': for (let i = 0; i < n; i++) out[i] += c.amp; break
  }
}

/** The samples of a generator source. Throws when the source has problems. */
export function generate(srcIn: GeneratorSource): Float64Array {
  const src = normalizeGenerator(srcIn)
  const problems = sourceProblems(src)
  if (problems.length) throw new Error(problems[0])
  const n = Math.round(src.fs * src.duration)
  const out = new Float64Array(n)
  for (const c of src.components) addComponent(out, c, src.fs)
  if (src.noise.sigma > 0) {
    const w = noise(n, src.noise.sigma, src.noise.seed, src.noise.color)
    for (let i = 0; i < n; i++) out[i] += w[i]
  }
  return src.bits > 0 ? quantize(out, src.bits, src.fullScale) : out
}

/** Peak times of the first ECG component of a source (for checking detectors). */
export function ecgRPeakTimes(src: GeneratorSource): number[] {
  const c = src.components.find((x) => x.type === 'ecg')
  return c ? ecgBeatTimes(c.bpm, src.duration, c.variability, c.seed).filter((t) => t < src.duration) : []
}

/** "523.25:1:1.2, 1046.5:0.5:0.8" ⇄ partials (frequency:amplitude:decay-seconds). */
export function partialsToText(p: readonly Partial3[]): string {
  return p.map((q) => `${q.freq}:${q.amp}:${q.tau}`).join(', ')
}

export function partialsFromText(text: string): Partial3[] {
  const out: Partial3[] = []
  for (const part of text.split(/[,;\n]+/)) {
    const nums = part.trim().split(/[:\s]+/).map(Number)
    if (nums.length >= 1 && Number.isFinite(nums[0]) && nums[0] > 0) out.push({ freq: nums[0], amp: Number.isFinite(nums[1]) ? nums[1] : 1, tau: Number.isFinite(nums[2]) ? Math.max(0, nums[2]) : 0 })
  }
  return out.slice(0, 64)
}
