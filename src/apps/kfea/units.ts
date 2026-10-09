// Units for kFEA. Everything inside the app (the model, the solvers, the files) is SI: metres, newtons, pascals,
// kilograms, kelvin. Only what the user types and reads is converted, with these factors.

export type LengthUnit = 'mm' | 'm' | 'in' | 'ft'
export type ForceUnit = 'N' | 'kN' | 'kip' | 'lbf'

export interface Units {
  length: LengthUnit
  force: ForceUnit
}

export const LENGTH_UNITS: readonly LengthUnit[] = ['mm', 'm', 'in', 'ft']
export const FORCE_UNITS: readonly ForceUnit[] = ['N', 'kN', 'kip', 'lbf']

/** Metres in one unit. */
export const LENGTH_M: Record<LengthUnit, number> = { mm: 0.001, m: 1, in: 0.0254, ft: 0.3048 }
/** Newtons in one unit. */
export const FORCE_N: Record<ForceUnit, number> = { N: 1, kN: 1000, kip: 4448.2216152605, lbf: 4.4482216152605 }

export const DEFAULT_UNITS: Units = { length: 'm', force: 'kN' }

/** What a number measures. */
export type Quantity = 'length' | 'force' | 'stress' | 'moment' | 'lineLoad' | 'area' | 'inertia' | 'modulus' | 'density' | 'temperature' | 'angle' | 'stiffness' | 'rotStiffness' | 'none'

const PRESSURES: Array<[string, number]> = [['Pa', 1], ['kPa', 1e3], ['MPa', 1e6], ['GPa', 1e9], ['psi', 6894.757293168], ['ksi', 6894757.293168]]

/** Pascals in one unit of stress of this system (N/mm² = MPa, kN/m² = kPa, kip/in² = ksi…). */
export function stressFactor(u: Units): number {
  return FORCE_N[u.force] / (LENGTH_M[u.length] * LENGTH_M[u.length])
}

export function stressLabel(u: Units): string {
  const f = stressFactor(u)
  for (const [name, v] of PRESSURES) if (Math.abs(f - v) <= 1e-6 * v) return name
  return `${u.force}/${u.length}²`
}

/** SI value of one display unit of the quantity. */
export function factor(q: Quantity, u: Units): number {
  const L = LENGTH_M[u.length]
  const F = FORCE_N[u.force]
  switch (q) {
    case 'length': return L
    case 'force': return F
    case 'stress': case 'modulus': return stressFactor(u)
    case 'moment': return F * L
    case 'lineLoad': return F / L
    case 'area': return L * L
    case 'inertia': return L ** 4
    case 'density': return 1
    case 'temperature': return 1
    case 'angle': return 1
    case 'stiffness': return F / L
    case 'rotStiffness': return F * L
    default: return 1
  }
}

export function label(q: Quantity, u: Units): string {
  switch (q) {
    case 'length': return u.length
    case 'force': return u.force
    case 'stress': case 'modulus': return stressLabel(u)
    case 'moment': return `${u.force}·${u.length}`
    case 'lineLoad': return `${u.force}/${u.length}`
    case 'area': return `${u.length}²`
    case 'inertia': return `${u.length}⁴`
    case 'density': return 'kg/m³'
    case 'temperature': return 'K'
    case 'angle': return 'rad'
    case 'stiffness': return `${u.force}/${u.length}`
    case 'rotStiffness': return `${u.force}·${u.length}/rad`
    default: return ''
  }
}

export const toSI = (value: number, q: Quantity, u: Units): number => value * factor(q, u)
export const fromSI = (value: number, q: Quantity, u: Units): number => value / factor(q, u)

/** A number with a few significant digits, no trailing zeros: 12.35, 0.0001234, 1.235e+6. */
export function fmt(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : '–'
  if (v === 0 || Math.abs(v) < 1e-14) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-3) {
    const s = v.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e')
    return s.replace('e+', 'e').replace('e-', 'e-')
  }
  const dec = Math.max(0, digits - 1 - Math.floor(Math.log10(a)))
  const s = v.toFixed(Math.min(12, dec))
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** A display value of an SI quantity, as text with its unit. */
export function show(v: number, q: Quantity, u: Units, digits = 4): string {
  const l = label(q, u)
  return `${fmt(fromSI(v, q, u), digits)}${l ? ` ${l}` : ''}`
}

export function parseUnits(o: unknown): Units {
  const r = (o ?? {}) as Partial<Units>
  return {
    length: LENGTH_UNITS.includes(r.length as LengthUnit) ? (r.length as LengthUnit) : DEFAULT_UNITS.length,
    force: FORCE_UNITS.includes(r.force as ForceUnit) ? (r.force as ForceUnit) : DEFAULT_UNITS.force,
  }
}

/** Reads a number the user typed ("12", "1.5e3", "3,5", "2*4"): null when it is not one. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!t) return null
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t)
  if (/^[-+*/().\d\seE]+$/.test(t)) {
    try {
      const v = Function(`"use strict"; return (${t})`)() as unknown
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    } catch { return null }
  }
  return null
}
