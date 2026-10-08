// Reaction energy profiles: reactants, transition states, intermediates and products with relative energies
// (kJ/mol). Activation energies, ΔH, the rate-determining step, the Hammond postulate, a catalysed overlay and a
// smooth curve for plotting. Pure functions.

import type { MechState } from './library.ts'

export type PointKind = 'reactant' | 'ts' | 'intermediate' | 'product'

export interface ProfilePoint {
  label: string
  energy: number
  kind: PointKind
}

export interface Profile {
  points: ProfilePoint[]
}

/** Kinds follow position: reactants, then alternating TS / intermediate, products last. */
export function normalise(points: { label: string; energy: number }[]): Profile {
  const n = points.length
  return {
    points: points.map((p, i) => ({
      label: p.label,
      energy: p.energy,
      kind: i === 0 ? 'reactant' : i === n - 1 ? 'product' : i % 2 === 1 ? 'ts' : 'intermediate',
    })),
  }
}

/** A one-barrier profile from ΔH and Ea (kJ/mol). */
export function simpleProfile(dH: number, ea: number, reactants = 'Reactants', products = 'Products'): Profile {
  return normalise([
    { label: reactants, energy: 0 },
    { label: 'Transition state', energy: Math.max(ea, dH, 0) },
    { label: products, energy: dH },
  ])
}

/** The profile of a library mechanism: each state is preceded by the transition state that leads to it. */
export function profileFromMechanism(states: MechState[]): Profile {
  const pts: { label: string; energy: number }[] = []
  states.forEach((s, i) => {
    if (i > 0) pts.push({ label: `TS${states.length > 2 ? i : ''}`, energy: s.ts ?? Math.max(states[i - 1].energy, s.energy) })
    pts.push({ label: s.label, energy: s.energy })
  })
  return normalise(pts)
}

/** Indices of the states (reactant, intermediates, product) in the point list. */
export function stateIndices(p: Profile): number[] {
  return p.points.map((_, i) => i).filter((i) => i % 2 === 0)
}

export interface StepInfo {
  from: string
  to: string
  ts: string
  /** Forward and reverse activation energies of the step. */
  eaF: number
  eaR: number
  /** Energy change of the step. */
  dE: number
  hammond: string
}

export interface ProfileInfo {
  valid: boolean
  message: string
  dH: number
  steps: StepInfo[]
  /** Index into `steps` of the step with the highest transition state (rate-determining). */
  rds: number
  /** Overall forward / reverse activation energy: highest TS above the reactants, and above the products. */
  eaOverall: number
  eaReverse: number
  /** Energetic span: the highest TS minus the lowest earlier intermediate. */
  span: number
}

export function analyse(p: Profile): ProfileInfo {
  const pts = p.points
  const bad = (message: string): ProfileInfo => ({ valid: false, message, dH: 0, steps: [], rds: -1, eaOverall: 0, eaReverse: 0, span: 0 })
  if (pts.length < 3 || pts.length % 2 === 0) return bad('A profile needs reactants, then pairs of (transition state, state), ending with the products.')
  const steps: StepInfo[] = []
  for (let i = 0; i + 2 < pts.length; i += 2) {
    const a = pts[i], ts = pts[i + 1], b = pts[i + 2]
    const eaF = ts.energy - a.energy
    const eaR = ts.energy - b.energy
    const dE = b.energy - a.energy
    let hammond: string
    if (Math.abs(dE) < 0.1 * Math.max(Math.abs(eaF), Math.abs(eaR), 1)) hammond = 'Nearly thermoneutral: the transition state lies midway and resembles both sides.'
    else if (dE < 0) hammond = 'Exothermic step: by the Hammond postulate the transition state comes early and looks like the reactant side.'
    else hammond = 'Endothermic step: by the Hammond postulate the transition state comes late and looks like the product side.'
    steps.push({ from: a.label, to: b.label, ts: ts.label, eaF, eaR, dE, hammond })
  }
  const bad2 = steps.find((s) => s.eaF < -1e-9 || s.eaR < -1e-9)
  let rds = 0
  let highest = -Infinity
  pts.forEach((q, i) => {
    if (i % 2 === 1 && q.energy > highest) {
      highest = q.energy
      rds = (i - 1) / 2
    }
  })
  const last = pts[pts.length - 1].energy
  let span = 0
  for (let i = 1; i < pts.length; i += 2) {
    let low = Infinity
    for (let j = 0; j < i; j += 2) low = Math.min(low, pts[j].energy)
    span = Math.max(span, pts[i].energy - low)
  }
  return {
    valid: !bad2, message: bad2 ? `The transition state of "${bad2.ts}" is lower than a neighbouring state: it must be the top of the barrier.` : '',
    dH: last - pts[0].energy, steps, rds, eaOverall: highest - pts[0].energy, eaReverse: highest - last, span,
  }
}

/** The same profile with each transition state lowered by `lower` kJ/mol (a catalyst), never below its neighbours. */
export function catalysed(p: Profile, lower: number): Profile {
  const pts = p.points.map((q) => ({ ...q }))
  for (let i = 1; i < pts.length; i += 2) {
    const floor = Math.max(pts[i - 1].energy, pts[i + 1].energy)
    pts[i].energy = Math.max(pts[i].energy - lower, floor + 1)
  }
  return { points: pts }
}

/** x positions 0..n−1 for the points and a smooth curve with flat tops and bottoms (cosine easing). */
export function curve(p: Profile, perSegment = 24): { x: number[]; y: number[] } {
  const x: number[] = []
  const y: number[] = []
  const pts = p.points
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let k = 0; k < perSegment; k++) {
      const t = k / perSegment
      x.push(i + t)
      y.push(pts[i].energy + (pts[i + 1].energy - pts[i].energy) * (1 - Math.cos(Math.PI * t)) / 2)
    }
  }
  x.push(pts.length - 1)
  y.push(pts[pts.length - 1].energy)
  return { x, y }
}

/** Rate constant ratio of two barriers at temperature T (Arrhenius with the same prefactor). */
export function rateEnhancement(eaUncatalysed: number, eaCatalysed: number, T: number): number {
  return Math.exp(((eaUncatalysed - eaCatalysed) * 1000) / (8.314462618 * T))
}
