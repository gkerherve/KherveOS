// The circuit the simulator works on: a flat list of elements joined by named nodes ("0" is ground).
// Plain data (no functions) so it can be saved, compared and built by the netlist parser, the
// schematic and the AI tools alike.

export interface DiodeModel {
  /** the .model name when it has one ("1N4148", "LED_RED") */
  name?: string
  is: number
  n: number
  /** reverse breakdown voltage (positive number) for Zener diodes */
  bv?: number
  /** current at the breakdown voltage */
  ibv?: number
}

export interface BjtModel {
  name?: string
  pol: 1 | -1
  is: number
  bf: number
  br: number
  vaf?: number
  /** base–emitter and base–collector junction capacitances (F); default 8 pF and 4 pF */
  cje?: number
  cjc?: number
}

export interface MosModel {
  name?: string
  pol: 1 | -1
  vto: number
  kp: number
  lambda: number
  w: number
  l: number
  /** gate–source and gate–drain capacitances (F); default 20 pF and 4 pF */
  cgs?: number
  cgd?: number
}

export const DEFAULT_CJE = 8e-12
export const DEFAULT_CJC = 4e-12
export const DEFAULT_CGS = 20e-12
export const DEFAULT_CGD = 4e-12

export type Wave =
  | { kind: 'sin'; offset: number; amp: number; freq: number; delay: number; damping: number; phase: number }
  | { kind: 'pulse'; v1: number; v2: number; delay: number; rise: number; fall: number; width: number; period: number }
  | { kind: 'pwl'; points: [number, number][] }

export interface Source {
  dc: number
  wave?: Wave
  /** small-signal amplitude and phase (degrees) for the AC sweep */
  acMag: number
  acPhase: number
}

/** A switch that is closed from `delay` for `on` seconds, every `period` (0 = once); or fixed. */
export type SwitchSpec = { fixed: boolean } | { delay: number; on: number; period: number }

export type GateKind = 'and' | 'or' | 'not' | 'nand' | 'nor' | 'xor' | 'xnor'

export type Behaviour =
  | { type: 'opamp'; gain: number; rail: number; supply: boolean; ro: number }
  | { type: 'gate'; gate: GateKind; vdd: number; ro: number }

export interface Resistor { kind: 'R'; name: string; nodes: [string, string]; value: number }
export interface Capacitor { kind: 'C'; name: string; nodes: [string, string]; value: number; ic?: number }
export interface Inductor { kind: 'L'; name: string; nodes: [string, string]; value: number; ic?: number }
export interface VSource { kind: 'V'; name: string; nodes: [string, string]; src: Source }
export interface ISource { kind: 'I'; name: string; nodes: [string, string]; src: Source }
export interface Diode { kind: 'D'; name: string; nodes: [string, string]; model: DiodeModel }
export interface Bjt { kind: 'Q'; name: string; nodes: [string, string, string]; model: BjtModel }
export interface Mosfet { kind: 'M'; name: string; nodes: [string, string, string]; model: MosModel }
/** voltage-controlled voltage source: V(n0,n1) = gain · V(n2,n3) */
export interface Vcvs { kind: 'E'; name: string; nodes: [string, string, string, string]; value: number }
/** voltage-controlled current source: current gain·V(n2,n3) flows n0 → n1 */
export interface Vccs { kind: 'G'; name: string; nodes: [string, string, string, string]; value: number }
export interface Switch { kind: 'S'; name: string; nodes: [string, string]; ron: number; roff: number; spec: SwitchSpec }
/** mutual coupling between two inductors */
export interface Coupling { kind: 'K'; name: string; l1: string; l2: string; k: number }
/** a behavioural source: nodes[0] is the output, the others are inputs */
export interface Behavioural { kind: 'B'; name: string; nodes: string[]; fn: Behaviour }

export type Elem = Resistor | Capacitor | Inductor | VSource | ISource | Diode | Bjt | Mosfet | Vcvs | Vccs | Switch | Coupling | Behavioural

export interface Circuit {
  title: string
  elements: Elem[]
}

export type Analysis =
  | { type: 'op' }
  | { type: 'dc'; source: string; start: number; stop: number; step: number }
  | { type: 'ac'; fstart: number; fstop: number; perDecade: number }
  | { type: 'tran'; tstop: number; tstep?: number; tmax?: number; uic?: boolean }

export const GROUND = '0'

export const isGround = (n: string) => n === '0' || n.toLowerCase() === 'gnd'

export const DEFAULT_DIODE: DiodeModel = { is: 1e-14, n: 1 }
export const DEFAULT_BJT: BjtModel = { pol: 1, is: 1e-14, bf: 100, br: 1, vaf: undefined }
export const DEFAULT_NMOS: MosModel = { pol: 1, vto: 2, kp: 0.12, lambda: 0, w: 1, l: 1 }
export const DEFAULT_PMOS: MosModel = { pol: -1, vto: -2, kp: 0.12, lambda: 0, w: 1, l: 1 }

export const THERMAL_VOLTAGE = 0.025852

/** Is for a diode that drops `vf` volts at 10 mA with ideality `n`. */
export function isForDrop(vf: number, n: number, current = 0.01): number {
  return current * Math.exp(-vf / (n * THERMAL_VOLTAGE))
}

/** A plain DC source. */
export const dcSource = (dc: number): Source => ({ dc, acMag: 0, acPhase: 0 })

/** The value a source has in a DC analysis (the waveform's starting level). */
export function sourceDC(s: Source): number {
  const w = s.wave
  if (!w) return s.dc
  if (w.kind === 'sin') return w.offset
  if (w.kind === 'pulse') return w.v1
  return w.points.length ? w.points[0][1] : 0
}

/** The value of a source at time t. */
export function sourceAt(s: Source, t: number): number {
  const w = s.wave
  if (!w) return s.dc
  if (w.kind === 'sin') {
    if (t < w.delay) return w.offset + w.amp * Math.sin((w.phase * Math.PI) / 180)
    const dt = t - w.delay
    return w.offset + w.amp * Math.exp(-dt * w.damping) * Math.sin(2 * Math.PI * w.freq * dt + (w.phase * Math.PI) / 180)
  }
  if (w.kind === 'pulse') {
    if (t < w.delay) return w.v1
    let u = t - w.delay
    if (w.period > 0) u %= w.period
    if (u < w.rise) return w.rise > 0 ? w.v1 + ((w.v2 - w.v1) * u) / w.rise : w.v2
    u -= w.rise
    if (u < w.width) return w.v2
    u -= w.width
    if (u < w.fall) return w.fall > 0 ? w.v2 + ((w.v1 - w.v2) * u) / w.fall : w.v1
    return w.v1
  }
  const p = w.points
  if (p.length === 0) return 0
  if (t <= p[0][0]) return p[0][1]
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i][0]) {
      const [t0, v0] = p[i - 1]
      const [t1, v1] = p[i]
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1
    }
  }
  return p[p.length - 1][1]
}

/** Is the switch closed at time t? */
export function switchClosed(spec: SwitchSpec, t: number): boolean {
  if ('fixed' in spec) return spec.fixed
  if (t < spec.delay) return false
  let u = t - spec.delay
  if (spec.period > 0) u %= spec.period
  return u < spec.on
}

/** Times (> t) at which a source or switch changes slope or jumps: the integrator lands on them. */
export function nextBreakpoint(e: Elem, t: number, tstop: number): number {
  const eps = Math.max(1e-15, Math.abs(t) * 1e-12)
  let best = Infinity
  const take = (x: number) => { if (x > t + eps && x < best) best = x }
  if (e.kind === 'V' || e.kind === 'I') {
    const w = e.src.wave
    if (!w) return best
    if (w.kind === 'sin') take(w.delay)
    else if (w.kind === 'pwl') for (const [x] of w.points) take(x)
    else {
      const offs = [0, w.rise, w.rise + w.width, w.rise + w.width + w.fall]
      if (t < w.delay - eps) { take(w.delay); return best }
      if (w.period > 0) {
        const k = Math.max(0, Math.floor((t - w.delay) / w.period))
        for (let c = k; c <= k + 1; c++) for (const o of offs) take(w.delay + c * w.period + o)
      } else for (const o of offs) take(w.delay + o)
    }
  } else if (e.kind === 'S' && !('fixed' in e.spec)) {
    const s = e.spec
    take(s.delay)
    if (s.period > 0) {
      const k = Math.max(0, Math.floor((t - s.delay) / s.period))
      for (let c = k; c <= k + 1; c++) { take(s.delay + c * s.period); take(s.delay + c * s.period + s.on) }
    } else take(s.delay + s.on)
  }
  return best <= tstop ? best : Infinity
}
