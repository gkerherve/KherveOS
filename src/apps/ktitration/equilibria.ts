// Acid–base equilibria in water (pure, no browser): Kw against temperature, activity coefficients (Davies and the
// extended Debye–Hückel law), the species distribution of mono- and polyprotic acids/bases/ampholytes, the buffer
// capacity and the exact solution of the charge balance for [H⁺] (Brent's method in pH, which is log space).
//
// Conventions: pH = −log a(H⁺) (what an electrode reads), concentrations in mol/L, pKa values are thermodynamic
// (I → 0, 25 °C). With activities on, the constants in the mass-action laws are the mixed constants
// Ka·γ(HA)/γ(A) with a(H⁺) = 10^−pH, so the pKa that is "corrected" for ionic strength is pKa(I) = pKa − log(γ_acid/γ_base).

export type ActivityModel = 'none' | 'davies' | 'edh'

/** A (poly)protic system: species j has lost j protons and has the charge z0 − j. */
export interface System {
  label: string
  /** pKa of step i (species i → species i+1), at 25 °C and zero ionic strength. */
  pKa: number[]
  /** Charge of the fully protonated species (H₃PO₄ 0, NH₄⁺ +1, H₂Gly⁺ +1, H₆EDTA²⁺ +2). */
  z0: number
  /** d(pKa)/dT in pK units per kelvin, per step (optional; around 25 °C). */
  dpKadT?: number[]
}

/** A system dissolved in the solution. */
export interface Dissolved {
  sys: System
  /** Total concentration in the solution (mol/L, already diluted). */
  conc: number
  /** Which species was weighed in (0 = fully protonated). Its charge is balanced by an inert counter-ion (see `counterIons`). */
  form: number
}

/** An inert ion (does not take part in any equilibrium considered): charge z (signed) and concentration. */
export interface Ion {
  z: number
  conc: number
}

export interface Medium {
  /** °C, 0–100. */
  T: number
  activity: ActivityModel
}

export const IDEAL_25: Medium = { T: 25, activity: 'none' }

// ---------------------------------------------------------------------------------------------- water and activities

/** pKw of water against °C (CRC Handbook, rounded); linear in between. */
export const KW_TABLE: ReadonlyArray<readonly [number, number]> = [
  [0, 14.94], [5, 14.73], [10, 14.53], [15, 14.35], [20, 14.17], [25, 14.0], [30, 13.83], [35, 13.68], [40, 13.53], [45, 13.4],
  [50, 13.26], [55, 13.14], [60, 13.02], [70, 12.8], [80, 12.6], [90, 12.42], [100, 12.26],
]

export function pKw(T: number): number {
  const t = Math.max(0, Math.min(100, T))
  for (let i = 1; i < KW_TABLE.length; i++) {
    const [t1, p1] = KW_TABLE[i]
    if (t <= t1) {
      const [t0, p0] = KW_TABLE[i - 1]
      return p0 + ((p1 - p0) * (t - t0)) / (t1 - t0)
    }
  }
  return KW_TABLE[KW_TABLE.length - 1][1]
}

export const kw = (T: number) => Math.pow(10, -pKw(T))

/** Relative permittivity of water (Malmberg & Maryott). */
const epsilon = (T: number) => 87.74 - 0.40008 * T + 9.398e-4 * T * T - 1.41e-6 * T * T * T

/** Debye–Hückel A (log10 units, L^½ mol^−½): 0.5115 at 25 °C. */
export function debyeA(T: number): number {
  return 1.8248e6 / Math.pow(epsilon(T) * (T + 273.15), 1.5)
}

/** Debye–Hückel B (Å⁻¹ L^½ mol^−½): 0.329 at 25 °C. */
export function debyeB(T: number): number {
  return 50.29 / Math.sqrt(epsilon(T) * (T + 273.15))
}

/** Ion-size parameter a (Å) used by the extended law (Kielland's values for H⁺ and OH⁻, by charge for the rest). */
export function ionSize(z: number, kind?: 'H' | 'OH'): number {
  if (kind === 'H') return 9
  if (kind === 'OH') return 3.5
  const a = Math.abs(z)
  return a <= 1 ? 4.5 : a === 2 ? 5 : a === 3 ? 9 : 11
}

/** log10 of the activity coefficient of an ion of charge z at ionic strength I (mol/L). */
export function logGamma(z: number, I: number, model: ActivityModel, T = 25, kind?: 'H' | 'OH'): number {
  if (model === 'none' || z === 0 || !(I > 0)) return 0
  const s = Math.sqrt(I)
  const A = debyeA(T)
  if (model === 'davies') return -A * z * z * (s / (1 + s) - 0.3 * I)
  return (-A * z * z * s) / (1 + debyeB(T) * ionSize(z, kind) * s)
}

export const gamma = (z: number, I: number, model: ActivityModel, T = 25, kind?: 'H' | 'OH') => Math.pow(10, logGamma(z, I, model, T, kind))

/** The pKa of step i at temperature T. */
export function pKaAt(sys: System, i: number, T: number): number {
  return sys.pKa[i] + (sys.dpKadT?.[i] ?? 0) * (T - 25)
}

/** The pKa of step i as it appears with a(H⁺): pKa(I) = pKa − log(γ_acid/γ_base). */
export function pKaMixed(sys: System, i: number, I: number, med: Medium): number {
  const g = logGamma(sys.z0 - i, I, med.activity, med.T) - logGamma(sys.z0 - i - 1, I, med.activity, med.T)
  return pKaAt(sys, i, med.T) - g
}

// ---------------------------------------------------------------------------------------------- distribution

/** Charge of species j of a system. */
export const chargeOf = (sys: System, j: number) => sys.z0 - j

/** Fractions α_j of the species of a system at the given pH (a(H⁺) = 10^−pH) and ionic strength. */
export function alphas(sys: System, pH: number, I: number, med: Medium = IDEAL_25): number[] {
  const n = sys.pKa.length
  const logw = new Array<number>(n + 1).fill(0)
  for (let i = 0; i < n; i++) {
    logw[i + 1] = logw[i] + pH - pKaMixed(sys, i, I, med)
  }
  const m = Math.max(...logw)
  let sum = 0
  const w = logw.map((l) => {
    const v = Math.pow(10, l - m)
    sum += v
    return v
  })
  return w.map((v) => v / sum)
}

/** Mean charge of a system at a pH (Σ αⱼ zⱼ). */
export function meanCharge(sys: System, pH: number, I = 0, med: Medium = IDEAL_25): number {
  return alphas(sys, pH, I, med).reduce((s, a, j) => s + a * chargeOf(sys, j), 0)
}

/** Mean number of protons lost, ⟨j⟩ = Σ j αⱼ. */
export function meanLost(sys: System, pH: number, I = 0, med: Medium = IDEAL_25): number {
  return alphas(sys, pH, I, med).reduce((s, a, j) => s + a * j, 0)
}

/** The counter-ion that balances the charge of the weighed-in form (a cation when negative, an anion when positive). */
export function counterIons(d: Dissolved): Ion[] {
  const q = chargeOf(d.sys, d.form)
  if (q === 0 || !(d.conc > 0)) return []
  return [{ z: q < 0 ? 1 : -1, conc: Math.abs(q) * d.conc }]
}

// ---------------------------------------------------------------------------------------------- root finding

/** Brent's root finder on [a, b] (f(a) and f(b) of opposite signs). */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-13, maxIter = 300): number {
  let fa = f(a)
  let fb = f(b)
  if (fa === 0) return a
  if (fb === 0) return b
  if (fa * fb > 0) throw new Error('The root is not bracketed.')
  let c = a
  let fc = fa
  let d = b - a
  let e = d
  for (let it = 0; it < maxIter; it++) {
    if (fb * fc > 0) {
      c = a
      fc = fa
      d = b - a
      e = d
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b; b = c; c = a
      fa = fb; fb = fc; fc = fa
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol
    const xm = 0.5 * (c - b)
    if (Math.abs(xm) <= tol1 || fb === 0) return b
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa
      let p: number
      let q: number
      if (a === c) {
        p = 2 * xm * s
        q = 1 - s
      } else {
        const qq = fa / fc
        const r = fb / fc
        p = s * (2 * xm * qq * (qq - r) - (b - a) * (r - 1))
        q = (qq - 1) * (r - 1) * (s - 1)
      }
      if (p > 0) q = -q
      p = Math.abs(p)
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d
        d = p / q
      } else {
        d = xm
        e = d
      }
    } else {
      d = xm
      e = d
    }
    a = b
    fa = fb
    b += Math.abs(d) > tol1 ? d : xm > 0 ? tol1 : -tol1
    fb = f(b)
  }
  return b
}

// ---------------------------------------------------------------------------------------------- the solution

export interface SystemState {
  /** Fractions of the species (index = protons lost). */
  alpha: number[]
  /** Concentrations of the species (mol/L). */
  conc: number[]
}

export interface Solution {
  /** −log a(H⁺). */
  pH: number
  /** [H⁺] and [OH⁻] in mol/L. */
  H: number
  OH: number
  /** Ionic strength (mol/L) used for the activity coefficients (0 without activities). */
  I: number
  gammaH: number
  systems: SystemState[]
  /** Net charge of the solution at the root (mol/L): the charge balance residual, ≈ 0. */
  residual: number
}

function ionicStrength(items: readonly Dissolved[], ions: readonly Ion[], pH: number, I: number, med: Medium): number {
  const { H, OH } = hydronium(pH, I, med)
  let s = H + OH
  for (const ion of ions) s += ion.z * ion.z * ion.conc
  for (const d of items) {
    const a = alphas(d.sys, pH, I, med)
    for (let j = 0; j < a.length; j++) s += a[j] * d.conc * chargeOf(d.sys, j) ** 2
  }
  return s / 2
}

function hydronium(pH: number, I: number, med: Medium): { H: number; OH: number; gH: number } {
  const aH = Math.pow(10, -pH)
  const gH = gamma(1, I, med.activity, med.T, 'H')
  const gOH = gamma(-1, I, med.activity, med.T, 'OH')
  return { H: aH / gH, OH: kw(med.T) / (aH * gOH), gH }
}

/** Net charge (mol/L) of the solution at a pH and ionic strength: zero at equilibrium. Decreasing in pH. */
export function netCharge(items: readonly Dissolved[], ions: readonly Ion[], pH: number, I: number, med: Medium): number {
  const { H, OH } = hydronium(pH, I, med)
  let q = H - OH
  for (const ion of ions) q += ion.z * ion.conc
  for (const d of items) {
    if (!(d.conc > 0)) continue
    const a = alphas(d.sys, pH, I, med)
    let m = 0
    for (let j = 0; j < a.length; j++) m += a[j] * chargeOf(d.sys, j)
    q += d.conc * m
  }
  return q
}

/**
 * Solves the charge balance for pH: Σ zᵢcᵢ + [H⁺] − [OH⁻] = 0 over the inert ions and the species of every system.
 * `ions` holds the inert ions and the counter-ions of the forms weighed in (use `counterIons`). With activities the
 * ionic strength is iterated to self-consistency.
 */
export function solve(items: readonly Dissolved[], ions: readonly Ion[], med: Medium = IDEAL_25): Solution {
  const pkw = pKw(med.T)
  const root = (I: number): number => {
    const f = (pH: number) => netCharge(items, ions, pH, I, med)
    let lo = -2.5
    let hi = pkw + 3
    for (let k = 0; k < 4 && !(f(lo) > 0 && f(hi) < 0); k++) {
      lo -= 2
      hi += 2
    }
    return brent(f, lo, hi, 1e-14)
  }
  let I = 0
  let pH = root(0)
  let iterations = 1
  if (med.activity !== 'none') {
    I = ionicStrength(items, ions, pH, 0, med)
    for (; iterations < 80; iterations++) {
      pH = root(I)
      const next = ionicStrength(items, ions, pH, I, med)
      if (Math.abs(next - I) <= 1e-13 + 1e-11 * I) { I = next; break }
      I = 0.4 * I + 0.6 * next
    }
    pH = root(I)
  }
  const { H, OH, gH } = hydronium(pH, I, med)
  const systems = items.map((d) => {
    const alpha = alphas(d.sys, pH, I, med)
    return { alpha, conc: alpha.map((a) => a * d.conc) }
  })
  return { pH, H, OH, I, gammaH: gH, systems, residual: netCharge(items, ions, pH, I, med) }
}

/** Buffer capacity β = dC_b/dpH (mol L⁻¹ per pH unit) of a solution at a pH and ionic strength: ln10 ([H⁺] + [OH⁻] + Σ c·var(j)). */
export function bufferCapacity(items: readonly Dissolved[], pH: number, I: number, med: Medium = IDEAL_25): number {
  const { H, OH } = hydronium(pH, I, med)
  let s = H + OH
  for (const d of items) {
    if (!(d.conc > 0)) continue
    const a = alphas(d.sys, pH, I, med)
    let m1 = 0
    let m2 = 0
    for (let j = 0; j < a.length; j++) {
      m1 += a[j] * j
      m2 += a[j] * j * j
    }
    s += d.conc * (m2 - m1 * m1)
  }
  return Math.LN10 * s
}

/** The isoelectric point of an ampholyte: the pH where its mean charge is zero (ideal solution). null when it never is zero. */
export function isoelectricPoint(sys: System): number | null {
  const f = (pH: number) => meanCharge(sys, pH)
  if (!(f(-2) > 0 && f(16) < 0)) return null
  return brent(f, -2, 16, 1e-12)
}

/** pH of a single system (and its counter-ion) in water, volume-free: a convenience for tables and tests. */
export function phOf(sys: System, conc: number, form: number, med: Medium = IDEAL_25, extra: Ion[] = []): Solution {
  const d: Dissolved = { sys, conc, form }
  return solve([d], [...counterIons(d), ...extra], med)
}

/** pH of a strong acid (positive c) or strong base (negative c) of concentration |c|. */
export function phStrong(c: number, med: Medium = IDEAL_25): Solution {
  return solve([], [{ z: c >= 0 ? -1 : 1, conc: Math.abs(c) }], med)
}
