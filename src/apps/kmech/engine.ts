// Slider-crank engine mode (pure): a gas-pressure curve over the four-stroke cycle, the indicated torque it
// makes at the crank (principle of virtual work), the reciprocating inertia torque, and the flywheel needed for
// a given speed fluctuation.

import { sliderA, sliderV, sliderX, type SliderCrank } from './fourbar.ts'
import { rad, TAU } from './math.ts'

export interface EngineSpec {
  /** mm */
  bore: number
  /** mm */
  stroke: number
  /** connecting rod length, mm */
  rod: number
  /** compression ratio */
  cr: number
  /** in-line cylinders with even firing */
  cylinders: number
  rpm: number
  /** reciprocating mass per cylinder (piston + small end of the rod), kg */
  mRec: number
  /** heat released per cylinder per cycle, J */
  heat: number
  /** ratio of specific heats */
  gamma: number
  /** absolute intake pressure, kPa */
  pIntake: number
  /** absolute exhaust pressure, kPa */
  pExhaust: number
  /** start of the burn, degrees before firing TDC */
  burnAdvance: number
  /** burn duration, degrees */
  burnDuration: number
  /** coefficient of speed fluctuation (ωmax − ωmin)/ω */
  cs: number
  /** Optional measured/typed pressure curve over 720° (crank angle from the start of intake, kPa absolute). */
  table?: Array<[number, number]>
}

export const DEFAULT_ENGINE: EngineSpec = {
  bore: 80, stroke: 80, rod: 135, cr: 9.5, cylinders: 1, rpm: 3000, mRec: 0.45, heat: 720, gamma: 1.3, pIntake: 95, pExhaust: 110, burnAdvance: 15, burnDuration: 50, cs: 0.02,
}

export function slideOf(e: EngineSpec): SliderCrank {
  return { r: e.stroke / 2, l: e.rod }
}

export interface EngineResult {
  /** crank angle of the four-stroke cycle, degrees 0…720 (0 = TDC at the start of intake, 360 = firing TDC) */
  phi: number[]
  /** piston position above the crank axis, mm */
  x: number[]
  /** cylinder volume, cm³ */
  vol: number[]
  /** absolute gas pressure, kPa */
  p: number[]
  /** net gas force on the piston, N (positive = pushing toward the crank) */
  force: number[]
  /** N·m, one cylinder */
  gasTorque1: number[]
  inertiaTorque1: number[]
  /** N·m, all cylinders */
  gasTorque: number[]
  inertiaTorque: number[]
  torque: number[]
  meanTorque: number
  peakTorque: number
  minTorque: number
  /** indicated work per cycle (all cylinders), J */
  workPerCycle: number
  /** mean effective pressure on the swept volume, kPa */
  imep: number
  /** kW */
  power: number
  peakPressure: number
  swept: number
  /** energy fluctuation over the cycle, J */
  deltaE: number
  /** flywheel inertia for the speed fluctuation `cs`, kg·m² */
  flywheelI: number
  /** cumulative energy above the mean, J, per sample */
  energy: number[]
  /** angles of the maximum and minimum of the energy curve, degrees */
  phiEmax: number
  phiEmin: number
}

const ATM = 101.325

/** The pressure curve of one cylinder over the 720° cycle (kPa absolute), one sample per degree·`per`. */
export function pressureCurve(e: EngineSpec, per = 1): { phi: number[]; p: number[]; vol: number[] } {
  const s = slideOf(e)
  const A = (Math.PI * e.bore * e.bore) / 4
  const Vs = A * e.stroke
  const Vc = Vs / (e.cr - 1)
  const n = Math.round(720 * per)
  const phi = Array.from({ length: n }, (_, i) => i / per)
  const xTop = sliderX(s, 0)
  const vol = phi.map((f) => Vc + A * (xTop - sliderX(s, rad(f))))
  const p = new Array<number>(n).fill(e.pIntake)
  if (e.table && e.table.length >= 2) {
    const t = [...e.table].sort((a, b) => a[0] - b[0])
    for (let i = 0; i < n; i++) {
      const f = ((phi[i] % 720) + 720) % 720
      let k = 0
      while (k < t.length - 2 && t[k + 1][0] < f) k++
      const [f0, p0] = t[k]; const [f1, p1] = t[k + 1]
      const u = f1 === f0 ? 0 : Math.min(1, Math.max(0, (f - f0) / (f1 - f0)))
      p[i] = p0 + (p1 - p0) * u
    }
    return { phi, p, vol }
  }
  // compression and expansion: the adiabatic equation with heat added by a Wiebe burn
  const f0 = 180; const f1 = 540
  const start = 360 - e.burnAdvance
  const dxb = (f: number) => {
    const u = (f - start) / e.burnDuration
    return u <= 0 ? 0 : (15 * u * u * Math.exp(-5 * u ** 3)) / e.burnDuration
  }
  const step = 1 / (per * 4)
  let pr = e.pIntake
  let f = f0
  const volAt = (ph: number) => Vc + A * (xTop - sliderX(s, rad(ph)))
  const dV = (ph: number) => -A * sliderV(s, rad(ph)) * (Math.PI / 180) // dV/dφ in mm³ per degree
  const rhs = (ph: number, pp: number) => {
    const V = volAt(ph)
    // heat: J → N·mm → pressure change in kPa: dp = (γ−1) dQ / V, Q in N·mm (1 J = 1000 N·mm), p in N/mm² (kPa·1e-3)
    const dQ = e.heat * 1000 * dxb(ph)
    const dpNmm2 = (-e.gamma * (pp * 1e-3) * dV(ph) + (e.gamma - 1) * dQ) / V
    return dpNmm2 * 1e3
  }
  const samples = new Map<number, number>()
  samples.set(Math.round(f0 * per * 4), pr)
  while (f < f1 - 1e-9) {
    const k1 = rhs(f, pr)
    const k2 = rhs(f + step / 2, pr + (k1 * step) / 2)
    const k3 = rhs(f + step / 2, pr + (k2 * step) / 2)
    const k4 = rhs(f + step, pr + k3 * step)
    pr += ((k1 + 2 * k2 + 2 * k3 + k4) * step) / 6
    f += step
    samples.set(Math.round(f * per * 4), pr)
  }
  const pAt = (ph: number) => samples.get(Math.round(ph * per * 4)) ?? e.pIntake
  const pOpen = pAt(540)
  for (let i = 0; i < n; i++) {
    const ph = phi[i]
    if (ph < 180) p[i] = e.pIntake
    else if (ph <= 540) p[i] = pAt(ph)
    else if (ph < 560) p[i] = pOpen + ((e.pExhaust - pOpen) * (ph - 540)) / 20
    else p[i] = e.pExhaust
  }
  return { phi, p, vol }
}

/** Torques and the flywheel for an engine. */
export function runEngine(e: EngineSpec, per = 1): EngineResult {
  const s = slideOf(e)
  const A = (Math.PI * e.bore * e.bore) / 4
  const Vs = A * e.stroke
  const cyl = Math.max(1, Math.round(e.cylinders))
  const om = (e.rpm * TAU) / 60
  const { phi, p, vol } = pressureCurve(e, per)
  const n = phi.length
  const x = phi.map((f) => sliderX(s, rad(f)))
  const force = p.map((pp) => (pp - ATM) * 1e-3 * A)
  // N·mm per rad → N·m
  const gas1 = phi.map((f, i) => (-force[i] * sliderV(s, rad(f))) / 1000)
  // inertia: the force −m·ẍ on the piston, ẍ = x''·ω² (mm/s² → m/s²)
  const inert1 = phi.map((f) => (-e.mRec * (sliderA(s, rad(f)) * om * om) * 1e-3 * sliderV(s, rad(f))) / 1000)
  const shift = (arr: number[], deg: number) => {
    const k = Math.round(deg * per)
    return arr.map((_, i) => arr[(((i - k) % n) + n) % n])
  }
  const gas = new Array<number>(n).fill(0)
  const inertia = new Array<number>(n).fill(0)
  for (let c = 0; c < cyl; c++) {
    const g = shift(gas1, (720 / cyl) * c)
    const q = shift(inert1, (720 / cyl) * c)
    for (let i = 0; i < n; i++) { gas[i] += g[i]; inertia[i] += q[i] }
  }
  const torque = gas.map((g, i) => g + inertia[i])
  const dphi = (Math.PI / 180) / per
  const mean = torque.reduce((a, b) => a + b, 0) / n
  const W = mean * 4 * Math.PI
  const energy = new Array<number>(n).fill(0)
  let acc = 0
  for (let i = 0; i < n; i++) { acc += (torque[i] - mean) * dphi; energy[i] = acc }
  const eMax = Math.max(...energy)
  const eMin = Math.min(...energy)
  const dE = eMax - eMin
  return {
    phi, x, vol: vol.map((v) => v / 1000), p, force, gasTorque1: gas1, inertiaTorque1: inert1, gasTorque: gas, inertiaTorque: inertia, torque,
    meanTorque: mean, peakTorque: Math.max(...torque), minTorque: Math.min(...torque), workPerCycle: W,
    imep: (W / (Vs * 1e-9 * cyl)) / 1000, power: (mean * om) / 1000, peakPressure: Math.max(...p), swept: Vs * cyl * 1e-3,
    deltaE: dE, flywheelI: dE / (Math.max(e.cs, 1e-6) * om * om), energy,
    phiEmax: phi[energy.indexOf(eMax)], phiEmin: phi[energy.indexOf(eMin)],
  }
}

/** Piston speed (m/s) mean: 2·stroke·n/60. */
export const meanPistonSpeed = (e: EngineSpec): number => (2 * (e.stroke / 1000) * e.rpm) / 60
