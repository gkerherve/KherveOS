// Gases: the ideal gas law (solve for any one of P, V, n, T), the combined gas law, gas density and
// molar mass, Dalton's partial pressures, and van der Waals for a few real gases. Pure functions, SI inside.

/** J / (mol·K), CODATA 2018 (exact). */
export const R = 8.314462618
/** L·bar / (mol·K). */
export const R_LBAR = 0.0831446261815324
export const ATM = 101325

export const PRESSURE_UNITS: Record<string, number> = {
  atm: 101325, bar: 1e5, Pa: 1, kPa: 1e3, mmHg: 133.322387415, Torr: 101325 / 760, psi: 6894.757293168,
}
export const VOLUME_UNITS: Record<string, number> = {
  L: 1e-3, mL: 1e-6, 'm³': 1, 'cm³': 1e-6, 'dm³': 1e-3,
}
export const TEMPERATURE_UNITS = ['K', '°C', '°F'] as const
export type TempUnit = (typeof TEMPERATURE_UNITS)[number]
export const AMOUNT_UNITS: Record<string, number> = { mol: 1, mmol: 1e-3, kmol: 1e3 }

export function toKelvin(v: number, unit: TempUnit | string): number {
  switch (unit) {
    case '°C': return v + 273.15
    case '°F': return ((v - 32) * 5) / 9 + 273.15
    default: return v
  }
}
export function fromKelvin(k: number, unit: TempUnit | string): number {
  switch (unit) {
    case '°C': return k - 273.15
    case '°F': return ((k - 273.15) * 9) / 5 + 32
    default: return k
  }
}

export interface IdealInput {
  /** Pa */
  P: number | null
  /** m³ */
  V: number | null
  /** mol */
  n: number | null
  /** K */
  T: number | null
}

/** Solve PV = nRT for the one value left null (SI units: Pa, m³, mol, K). */
export function idealGas(x: IdealInput): { P: number; V: number; n: number; T: number; solved: 'P' | 'V' | 'n' | 'T' } {
  const keys = ['P', 'V', 'n', 'T'] as const
  const missing = keys.filter((k) => x[k] === null)
  if (missing.length !== 1) throw new Error('Leave exactly one of P, V, n, T empty: that is the one to find.')
  for (const k of keys) {
    const v = x[k]
    if (v !== null && !(v > 0)) throw new Error(`${k} must be above zero${k === 'T' ? ' (in kelvin: check the temperature unit)' : ''}.`)
  }
  const solved = missing[0]
  const { P, V, n, T } = x
  const out = { P, V, n, T } as { P: number; V: number; n: number; T: number }
  if (solved === 'P') out.P = ((n as number) * R * (T as number)) / (V as number)
  if (solved === 'V') out.V = ((n as number) * R * (T as number)) / (P as number)
  if (solved === 'n') out.n = ((P as number) * (V as number)) / (R * (T as number))
  if (solved === 'T') out.T = ((P as number) * (V as number)) / ((n as number) * R)
  return { ...out, solved }
}

export interface CombinedInput {
  P1: number | null
  V1: number | null
  T1: number | null
  P2: number | null
  V2: number | null
  T2: number | null
}

/** P1·V1/T1 = P2·V2/T2 (same units on both sides, T in K); leave one value null. */
export function combinedGas(x: CombinedInput): CombinedInput & { solved: keyof CombinedInput } {
  const keys = ['P1', 'V1', 'T1', 'P2', 'V2', 'T2'] as const
  const missing = keys.filter((k) => x[k] === null)
  if (missing.length !== 1) throw new Error('Leave exactly one of the six values empty: that is the one to find.')
  for (const k of keys) if (x[k] !== null && !((x[k] as number) > 0)) throw new Error(`${k} must be above zero.`)
  const s = missing[0]
  const v = { ...x } as Record<keyof CombinedInput, number>
  const { P1, V1, T1, P2, V2, T2 } = v
  // P1 V1 T2 = P2 V2 T1
  if (s === 'P1') v.P1 = (P2 * V2 * T1) / (V1 * T2)
  if (s === 'V1') v.V1 = (P2 * V2 * T1) / (P1 * T2)
  if (s === 'T1') v.T1 = (P1 * V1 * T2) / (P2 * V2)
  if (s === 'P2') v.P2 = (P1 * V1 * T2) / (V2 * T1)
  if (s === 'V2') v.V2 = (P1 * V1 * T2) / (P2 * T1)
  if (s === 'T2') v.T2 = (P2 * V2 * T1) / (P1 * V1)
  return { ...v, solved: s }
}

/** Density of an ideal gas in g/L from P (Pa), T (K) and molar mass (g/mol). */
export function gasDensity(P: number, T: number, molarMass: number): number {
  if (!(P > 0) || !(T > 0) || !(molarMass > 0)) throw new Error('Pressure, temperature and molar mass must be above zero.')
  return (P * molarMass) / (R * T) / 1000 // g/m³ → g/L
}

/** Molar mass (g/mol) of an ideal gas from its density (g/L), P (Pa) and T (K). */
export function molarMassFromDensity(P: number, T: number, densityGL: number): number {
  if (!(P > 0) || !(T > 0) || !(densityGL > 0)) throw new Error('Pressure, temperature and density must be above zero.')
  return (densityGL * 1000 * R * T) / P
}

export interface PartialPressure {
  label: string
  moles: number
  fraction: number
  /** Pa */
  pressure: number
}

/** Dalton: partial pressures from moles of each gas and the total pressure (Pa). */
export function partialPressures(gases: { label: string; moles: number }[], totalPressure: number): PartialPressure[] {
  if (gases.length === 0) throw new Error('Add at least one gas.')
  if (!(totalPressure > 0)) throw new Error('The total pressure must be above zero.')
  const total = gases.reduce((s, g) => s + g.moles, 0)
  if (!(total > 0)) throw new Error('The amounts must add up to more than zero.')
  return gases.map((g) => ({ label: g.label, moles: g.moles, fraction: g.moles / total, pressure: (g.moles / total) * totalPressure }))
}

export interface VdwGas {
  name: string
  formula: string
  /** L²·bar/mol² */
  a: number
  /** L/mol */
  b: number
}

export const VDW_GASES: VdwGas[] = [
  { name: 'Helium', formula: 'He', a: 0.0346, b: 0.0238 },
  { name: 'Neon', formula: 'Ne', a: 0.2135, b: 0.01709 },
  { name: 'Argon', formula: 'Ar', a: 1.355, b: 0.03201 },
  { name: 'Xenon', formula: 'Xe', a: 4.192, b: 0.05156 },
  { name: 'Hydrogen', formula: 'H2', a: 0.2476, b: 0.02661 },
  { name: 'Nitrogen', formula: 'N2', a: 1.37, b: 0.0387 },
  { name: 'Oxygen', formula: 'O2', a: 1.382, b: 0.03186 },
  { name: 'Carbon monoxide', formula: 'CO', a: 1.505, b: 0.03985 },
  { name: 'Carbon dioxide', formula: 'CO2', a: 3.658, b: 0.04286 },
  { name: 'Methane', formula: 'CH4', a: 2.303, b: 0.04307 },
  { name: 'Ethane', formula: 'C2H6', a: 5.562, b: 0.0638 },
  { name: 'Propane', formula: 'C3H8', a: 8.779, b: 0.08445 },
  { name: 'Ammonia', formula: 'NH3', a: 4.225, b: 0.0371 },
  { name: 'Water', formula: 'H2O', a: 5.537, b: 0.03049 },
  { name: 'Chlorine', formula: 'Cl2', a: 6.343, b: 0.05422 },
  { name: 'Sulfur dioxide', formula: 'SO2', a: 6.803, b: 0.05636 },
]

/** van der Waals pressure (bar) for n mol in V litres at T kelvin. */
export function vdwPressure(g: Pick<VdwGas, 'a' | 'b'>, n: number, V: number, T: number): number {
  if (!(V > n * g.b)) throw new Error('The volume is smaller than the molecules themselves (V must exceed n·b).')
  return (n * R_LBAR * T) / (V - n * g.b) - (g.a * n * n) / (V * V)
}

/** van der Waals temperature (K) for n mol in V litres at P bar. */
export function vdwTemperature(g: Pick<VdwGas, 'a' | 'b'>, n: number, V: number, P: number): number {
  if (!(V > n * g.b)) throw new Error('The volume is smaller than the molecules themselves (V must exceed n·b).')
  return ((P + (g.a * n * n) / (V * V)) * (V - n * g.b)) / (n * R_LBAR)
}

/** van der Waals volume (L): the gas-phase (largest) root of the cubic, found by Newton from the ideal volume. */
export function vdwVolume(g: Pick<VdwGas, 'a' | 'b'>, n: number, P: number, T: number): number {
  const { a, b } = g
  const f = (V: number) => P * V ** 3 - (P * n * b + n * R_LBAR * T) * V ** 2 + a * n * n * V - a * n ** 3 * b
  const df = (V: number) => 3 * P * V ** 2 - 2 * (P * n * b + n * R_LBAR * T) * V + a * n * n
  let V = (n * R_LBAR * T) / P + n * b
  for (let i = 0; i < 100; i++) {
    const step = f(V) / df(V)
    V -= step
    if (Math.abs(step) < 1e-13 * Math.abs(V)) break
  }
  if (!(V > n * b) || !Number.isFinite(V)) throw new Error('No gas-phase solution (the gas is probably liquid at this P and T).')
  return V
}

/** van der Waals amount (mol) for P bar, V litres and T kelvin: the first n (from zero) where the pressure reaches P. */
export function vdwMoles(g: Pick<VdwGas, 'a' | 'b'>, P: number, V: number, T: number): number {
  const N = 4000
  const nMax = (V / g.b) * 0.9999
  let prevN = 0
  let prevP = 0
  for (let i = 1; i <= N; i++) {
    const n = (nMax * i) / N
    const p = vdwPressure(g, n, V, T)
    if (p >= P) {
      let lo = prevN
      let hi = n
      for (let k = 0; k < 100; k++) {
        const m = (lo + hi) / 2
        if (vdwPressure(g, m, V, T) >= P) hi = m
        else lo = m
      }
      return (lo + hi) / 2
    }
    if (p < prevP) break // past the maximum of the curve
    prevN = n
    prevP = p
  }
  throw new Error('This pressure cannot be reached at this volume and temperature.')
}
