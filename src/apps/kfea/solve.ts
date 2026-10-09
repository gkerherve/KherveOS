// One front door for the solvers: solveModel(model) picks the right one, `measure` reads a named number out of a
// result (used by the expected-value checks of the examples and by the AI tool), `summarize` is the short text/JSON
// description of a result.

import { solveFrame, type FrameResult } from './frame.ts'
import { bucklingAnalysis, modalAnalysis, type BucklingResult, type ModalResult } from './modal.ts'
import type { Mesh } from './mesh.ts'
import { isPlate, type Model } from './model.ts'
import { plateField } from './post.ts'
import { solvePlate, type PlaneResult } from './plane.ts'
import { SolveError } from './linalg.ts'
import { fmt, fromSI, label, show, type Units } from './units.ts'

export type AnyResult = FrameResult | PlaneResult | ModalResult | BucklingResult

export function solveModel(model: Model, opts: { mesh?: Mesh; modes?: number; divisions?: number } = {}): AnyResult {
  if (isPlate(model.analysis)) return solvePlate(model, opts.mesh)
  if (model.study === 'modal') return modalAnalysis(model, { modes: opts.modes, divisions: opts.divisions })
  if (model.study === 'buckling') return bucklingAnalysis(model, { modes: opts.modes, divisions: opts.divisions })
  return solveFrame(model)
}

export { SolveError }

// ---------------------------------------------------------------------------- named numbers

/**
 * Reads a number out of a result by name (SI):
 *   frames   rx:N rx:node  ry:node  mz:node   ux:node uy:node rz:node   N:member (axial force at the start)
 *            Nmax:member Vmax:member Mmax:member   M:member@0.5 V:member@0.5 N:member@0.5   v:member@0.5 (deflection across)
 *            maxDisp   maxStress   safety
 *   modal    omega1 freq1 omega2 …        buckling  lambda1 lambda2 …
 *   plates   uy@x,y ux@x,y (node nearest to the point)   sx@x,y sy@x,y txy@x,y vm@x,y (averaged stress there)
 *            maxsx maxsy maxvm maxDisp energy work
 */
export function measure(_model: Model, r: AnyResult, key: string): number {
  const bad = () => new Error(`Unknown quantity “${key}”.`)
  const [name, arg] = key.split(':')
  if (r.kind === 'modal') {
    const m = key.match(/^(omega|freq)(\d+)$/)
    if (!m) throw bad()
    const mode = r.modes[Number(m[2]) - 1]
    if (!mode) throw new Error(`There is no mode ${m[2]}.`)
    return m[1] === 'omega' ? mode.omega : mode.frequency
  }
  if (r.kind === 'buckling') {
    const m = key.match(/^lambda(\d+)$/)
    if (!m) throw bad()
    const mode = r.modes[Number(m[1]) - 1]
    if (!mode) throw new Error(`There is no buckling mode ${m[1]}.`)
    return mode.factor
  }
  if (r.kind === 'frame') {
    if (key === 'maxDisp') return r.maxDisp
    if (key === 'maxStress') return r.maxStress
    if (key === 'safety') return r.safety
    if (['rx', 'ry', 'mz'].includes(name)) {
      const re = r.reactions.find((x) => x.node === arg)
      if (!re) throw new Error(`Node ${arg} has no reaction.`)
      return name === 'rx' ? re.rx : name === 'ry' ? re.ry : re.mz
    }
    if (['ux', 'uy', 'rz'].includes(name)) {
      const i = r.nodeIds.indexOf(arg)
      if (i < 0) throw new Error(`There is no node ${arg}.`)
      return r.u[3 * i + ['ux', 'uy', 'rz'].indexOf(name)]
    }
    const [id, at] = (arg ?? '').split('@')
    const mr = r.members.find((x) => x.id === id)
    if (['N', 'V', 'M', 'v', 'u', 'Nmax', 'Vmax', 'Mmax'].includes(name)) {
      if (!mr) throw new Error(`There is no member ${id}.`)
      if (name === 'Nmax') return mr.maxN
      if (name === 'Vmax') return mr.maxV
      if (name === 'Mmax') return mr.maxM
      const frac = at === undefined ? 0 : Number(at)
      const x = frac * mr.L
      // the nearest station (a station is always at 0, L and the quarter points when the divisions are a multiple of 4)
      let st = mr.stations[0]
      for (const q of mr.stations) if (Math.abs(q.x - x) < Math.abs(st.x - x) - 1e-12) st = q
      if (Math.abs(st.x - x) > 1e-9 * mr.L) throw new Error(`No station at ${at} of member ${id}.`)
      return name === 'N' ? st.N : name === 'V' ? st.V : name === 'M' ? st.M : name === 'v' ? st.v : st.u
    }
    throw bad()
  }
  // plate
  const m = r.mesh
  if (key === 'maxDisp') return r.maxDisp
  if (key === 'energy') return r.strainEnergy
  if (key === 'work') return r.work
  if (key === 'maxsx') return Math.max(...r.nodal.sx)
  if (key === 'maxsy') return Math.max(...r.nodal.sy)
  if (key === 'maxvm') return r.maxVm
  const at = key.match(/^(ux|uy|sx|sy|txy|vm)@(-?[\d.eE+-]+),(-?[\d.eE+-]+)$/)
  if (at) {
    const x = Number(at[2])
    const y = Number(at[3])
    let best = 0
    let bd = Infinity
    for (let i = 0; i < m.nNodes; i++) {
      const d = Math.hypot(m.xy[2 * i] - x, m.xy[2 * i + 1] - y)
      if (d < bd) { bd = d; best = i }
    }
    if (at[1] === 'ux') return r.u[2 * best]
    if (at[1] === 'uy') return r.u[2 * best + 1]
    return plateField(r, at[1] as 'sx' | 'sy' | 'txy' | 'vm', 'nodal')[best]
  }
  throw bad()
}

// ---------------------------------------------------------------------------- expected values

export interface Check {
  key: string
  value: number
  /** relative tolerance (and `abs` as a floor, for values near zero) */
  tol: number
  abs?: number
  /** instead of a value: the measured / `value` ratio must lie in this range */
  range?: [number, number]
  what?: string
}

export interface CheckResult extends Check {
  measured: number
  ok: boolean
}

export function runChecks(model: Model, r: AnyResult, checks: readonly Check[]): CheckResult[] {
  return checks.map((c) => {
    const measured = measure(model, r, c.key)
    const ok = c.range
      ? measured / c.value >= c.range[0] && measured / c.value <= c.range[1]
      : Math.abs(measured - c.value) <= Math.max(c.abs ?? 0, c.tol * Math.abs(c.value))
    return { ...c, measured, ok }
  })
}

// ---------------------------------------------------------------------------- summaries (AI tools, report)

/** A short plain-text summary of a result in the model's display units. */
export function summaryLines(model: Model, r: AnyResult): string[] {
  const u: Units = model.units
  const L = (v: number) => show(v, 'length', u)
  const F = (v: number) => show(v, 'force', u)
  const S = (v: number) => show(v, 'stress', u)
  const out: string[] = []
  if (r.kind === 'frame') {
    out.push(`Largest displacement ${L(r.maxDisp)} (${r.maxDispAt}).`)
    for (const re of r.reactions) out.push(`Reaction at ${re.node}: Rx ${F(re.rx)}, Ry ${F(re.ry)}${Math.abs(re.mz) > 1e-9 ? `, M ${show(re.mz, 'moment', u)}` : ''}.`)
    out.push(`Largest stress ${S(r.maxStress)} in member ${r.maxStressMember}; safety factor ${Number.isFinite(r.safety) ? fmt(r.safety, 3) : '∞'}.`)
  } else if (r.kind === 'plane') {
    out.push(`${r.mesh.nElems} ${r.mesh.type === 'tri' ? 'triangles' : 'quadrilaterals'}, ${2 * r.mesh.nNodes} degrees of freedom.`)
    out.push(`Largest displacement ${L(r.maxDisp)}; largest von Mises stress ${S(r.maxVm)}; safety factor ${Number.isFinite(r.safety) ? fmt(r.safety, 3) : '∞'}.`)
  } else if (r.kind === 'modal') {
    r.modes.forEach((m, i) => out.push(`Mode ${i + 1}: ${fmt(m.frequency, 5)} Hz (ω = ${fmt(m.omega, 5)} rad/s).`))
  } else {
    r.modes.forEach((m, i) => out.push(`Buckling mode ${i + 1}: load factor ${fmt(m.factor, 5)}.`))
  }
  return out
}

export { fromSI, label }
