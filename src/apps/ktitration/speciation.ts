// Speciation diagrams of one acid/base system (pure): the α diagram (fractions against pH), the Sillén
// (log C–pH) diagram, buffer capacity against pH, the pKa values corrected for ionic strength and the
// isoelectric point, and the titration of a chosen species.

import type { AcidBaseSpec } from './acidbase.ts'
import {
  alphas, bufferCapacity, gamma, isoelectricPoint, kw, pKaAt, pKaMixed, pKw, type ActivityModel, type Dissolved, type Medium, type System,
} from './equilibria.ts'

export interface DiagramOptions {
  sys: System
  /** Total concentration (mol/L). */
  conc: number
  /** Fixed ionic strength (mol/L); used with an activity model. */
  ionic: number
  activity: ActivityModel
  T: number
  from?: number
  to?: number
  step?: number
}

export interface DiagramData {
  pH: number[]
  /** alpha[j][i]: fraction of species j at pH[i]. */
  alpha: number[][]
  /** log10 of the concentrations: species j, and H⁺, OH⁻. */
  logC: number[][]
  logH: number[]
  logOH: number[]
  /** Buffer capacity, mol/L per pH unit, of this system plus water. */
  beta: number[]
  /** pKa as used (temperature, ionic strength). */
  pKaUsed: number[]
  /** Isoelectric point (ideal) or null. */
  pI: number | null
  /** Crossing pH of neighbouring species (≈ pKa). */
  crossings: number[]
}

export function mediumOf(o: DiagramOptions): Medium {
  return { T: o.T, activity: o.ionic > 0 ? o.activity : 'none' }
}

/** Everything a speciation tab draws. */
export function diagramData(o: DiagramOptions): DiagramData {
  const med = mediumOf(o)
  const I = med.activity === 'none' ? 0 : o.ionic
  const from = o.from ?? 0
  const to = o.to ?? 14
  const step = o.step ?? 0.05
  const pH: number[] = []
  for (let v = from; v <= to + 1e-9; v += step) pH.push(Math.round(v * 1e6) / 1e6)
  const n = o.sys.pKa.length
  const alpha: number[][] = Array.from({ length: n + 1 }, () => [])
  const logC: number[][] = Array.from({ length: n + 1 }, () => [])
  const logH: number[] = []
  const logOH: number[] = []
  const beta: number[] = []
  const gH = gamma(1, I, med.activity, o.T, 'H')
  const gOH = gamma(-1, I, med.activity, o.T, 'OH')
  const d: Dissolved = { sys: o.sys, conc: o.conc, form: 0 }
  for (const x of pH) {
    const a = alphas(o.sys, x, I, med)
    a.forEach((v, j) => {
      alpha[j].push(v)
      logC[j].push(Math.log10(Math.max(v * o.conc, 1e-300)))
    })
    logH.push(-x - Math.log10(gH))
    logOH.push(-pKw(o.T) + x - Math.log10(gOH))
    beta.push(bufferCapacity([d], x, I, med))
  }
  const pKaUsed = o.sys.pKa.map((_, i) => pKaMixed(o.sys, i, I, med))
  // crossings of the neighbouring α curves
  const crossings: number[] = []
  for (let j = 0; j < n; j++) {
    for (let i = 1; i < pH.length; i++) {
      const a0 = alpha[j][i - 1] - alpha[j + 1][i - 1]
      const a1 = alpha[j][i] - alpha[j + 1][i]
      if (a0 > 0 && a1 <= 0) {
        crossings.push(pH[i - 1] + (a0 * (pH[i] - pH[i - 1])) / (a0 - a1))
        break
      }
    }
  }
  return { pH, alpha, logC, logH, logOH, beta, pKaUsed, pI: isoelectricPoint(o.sys), crossings }
}

/** Fractions of every species at one pH. */
export function distributionAt(o: DiagramOptions, pH: number): { alpha: number[]; conc: number[]; meanCharge: number } {
  const med = mediumOf(o)
  const a = alphas(o.sys, pH, med.activity === 'none' ? 0 : o.ionic, med)
  return { alpha: a, conc: a.map((x) => x * o.conc), meanCharge: a.reduce((s, x, j) => s + x * (o.sys.z0 - j), 0) }
}

/**
 * The titration of one species of the system: 25 mL of it, titrated with a strong base (acid) of the same
 * concentration so that one equivalence point is at 25 mL. `form` is the species weighed in.
 */
export function speciesTitration(o: DiagramOptions, form: number, direction: 'base' | 'acid'): AcidBaseSpec {
  return {
    items: [{ kind: 'weak', label: o.sys.label, pKa: [...o.sys.pKa], z0: o.sys.z0, form, conc: o.conc, volume: 25, ...(o.sys.dpKadT ? { dpKadT: [...o.sys.dpKadT] } : {}) }],
    water: 0,
    titrant: { kind: direction === 'base' ? 'strong-base' : 'strong-acid', label: direction === 'base' ? 'NaOH' : 'HCl', conc: o.conc },
    temperature: o.T, activity: o.ionic > 0 ? o.activity : 'none', background: o.ionic > 0 ? o.ionic : 0, vmax: null, indicator: null,
  }
}

/** pKa table: thermodynamic value, value at the temperature, and at the ionic strength. */
export function pKaTable(o: DiagramOptions): Array<{ step: number; thermodynamic: number; atT: number; atI: number }> {
  const med = mediumOf(o)
  const I = med.activity === 'none' ? 0 : o.ionic
  return o.sys.pKa.map((p, i) => ({ step: i + 1, thermodynamic: p, atT: pKaAt(o.sys, i, o.T), atI: pKaMixed(o.sys, i, I, med) }))
}

export { kw }
