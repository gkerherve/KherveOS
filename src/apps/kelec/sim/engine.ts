// The simulator: modified nodal analysis with Newton–Raphson (damping, junction limiting, gmin and
// source stepping) for the DC operating point and DC sweeps, trapezoidal / backward-Euler transient
// analysis with an adaptive step and breakpoints, and complex small-signal AC analysis about the
// operating point. Pure TypeScript: no React, no "@/" imports.

import type { Analysis, Circuit, Elem, Source } from './circuit.ts'
import { DEFAULT_CGD, DEFAULT_CGS, DEFAULT_CJC, DEFAULT_CJE, isGround, nextBreakpoint, sourceAt, sourceDC, switchClosed } from './circuit.ts'
import { bjtCurrents, diodeCurrent, evalBehaviour, evalBjt, evalDiode, evalMos, mosDrainCurrent, type JState, type Lin } from './devices.ts'
import { solveComplex, solveReal } from './linalg.ts'

export class SimError extends Error {
  /** names of the elements or nodes involved */
  refs: string[]
  constructor(message: string, refs: string[] = []) {
    super(message)
    this.refs = refs
  }
}

// ------------------------------------------------------------------------------ preparing

export interface Prepared {
  circuit: Circuit
  els: Elem[]
  /** non-ground node names; the index is the matrix row */
  nodes: string[]
  idx: Map<string, number>
  /** per element: matrix row of each node (−1 for ground) */
  nd: number[][]
  /** per element: matrix row of its branch current, or −1 */
  br: number[]
  size: number
  nNodes: number
  byName: Map<string, number>
  /** per inductor index: coupled inductors with the mutual inductance */
  mutual: Map<number, { j: number; m: number }[]>
  hasNonlinear: boolean
  /** no diodes or BJTs: Newton can use a residual line search */
  canBacktrack: boolean
  /** has an ideal op-amp */
  hasOpamp: boolean
  vscale: number
  capBranch: boolean
}

export const normNode = (n: string): string => (isGround(n) ? '0' : n)

/** A logic gate's output delay (seconds): its output has this RC time constant, which also tames latches. */
export const GATE_TAU = 100e-9

export function prepare(circuit: Circuit, capBranch = false): Prepared {
  // gates get an output delay; transistors their junction capacitances (these make the fast switching of
  // multivibrators and latches a continuous process the integrator can follow)
  const cap = (name: string, a: string, b: string, value: number): Elem[] => (value > 0 ? [{ kind: 'C', name, nodes: [a, b], value }] : [])
  const withDelays = circuit.elements.flatMap((e): Elem[] => {
    if (e.kind === 'B' && e.fn.type === 'gate' && e.fn.ro > 0) return [e, ...cap(`${e.name}#C`, e.nodes[0], '0', GATE_TAU / e.fn.ro)]
    if (e.kind === 'Q') return [e, ...cap(`${e.name}#be`, e.nodes[1], e.nodes[2], e.model.cje ?? DEFAULT_CJE), ...cap(`${e.name}#bc`, e.nodes[1], e.nodes[0], e.model.cjc ?? DEFAULT_CJC)]
    if (e.kind === 'M') return [e, ...cap(`${e.name}#gs`, e.nodes[1], e.nodes[2], e.model.cgs ?? DEFAULT_CGS), ...cap(`${e.name}#gd`, e.nodes[1], e.nodes[0], e.model.cgd ?? DEFAULT_CGD)]
    return [e]
  })
  const els = withDelays.map((e) => {
    if (e.kind === 'K') return e
    return { ...e, nodes: e.nodes.map(normNode) } as Elem
  })
  const idx = new Map<string, number>()
  const nodes: string[] = []
  const byName = new Map<string, number>()
  els.forEach((e, i) => {
    if (byName.has(e.name.toLowerCase())) throw new SimError(`Two parts are named “${e.name}”: every part needs its own name.`, [e.name])
    byName.set(e.name.toLowerCase(), i)
    if (e.kind === 'K') return
    for (const n of e.nodes) if (n !== '0' && !idx.has(n)) { idx.set(n, nodes.length); nodes.push(n) }
  })
  const nNodes = nodes.length
  let size = nNodes
  const nd: number[][] = []
  const br: number[] = []
  let hasNonlinear = false
  let junctions = false
  let hasOpamp = false
  let vscale = 1
  const mutual = new Map<number, { j: number; m: number }[]>()
  els.forEach((e) => {
    nd.push(e.kind === 'K' ? [] : e.nodes.map((n) => (n === '0' ? -1 : idx.get(n)!)))
    const wantsBranch = e.kind === 'V' || e.kind === 'L' || e.kind === 'E' || e.kind === 'B' || (e.kind === 'C' && capBranch && !e.name.includes('#'))
    br.push(wantsBranch ? size++ : -1)
    if (e.kind === 'D' || e.kind === 'Q' || e.kind === 'M' || e.kind === 'B') hasNonlinear = true
    if (e.kind === 'D' || e.kind === 'Q') junctions = true
    if (e.kind === 'B' && e.fn.type === 'opamp') hasOpamp = true
    if (e.kind === 'V' || e.kind === 'I') {
      const s = e.src
      const w = s.wave
      const amp = w ? (w.kind === 'sin' ? Math.abs(w.offset) + Math.abs(w.amp) : w.kind === 'pulse' ? Math.max(Math.abs(w.v1), Math.abs(w.v2)) : Math.max(0, ...w.points.map((q) => Math.abs(q[1])))) : Math.abs(s.dc)
      if (e.kind === 'V') vscale = Math.max(vscale, amp)
    }
    if (e.kind === 'B' && e.fn.type === 'gate') vscale = Math.max(vscale, e.fn.vdd)
    if (e.kind === 'B' && e.fn.type === 'opamp') vscale = Math.max(vscale, e.fn.rail)
  })
  els.forEach((e) => {
    if (e.kind !== 'K') return
    const a = byName.get(e.l1.toLowerCase())
    const b = byName.get(e.l2.toLowerCase())
    if (a === undefined || b === undefined || els[a].kind !== 'L' || els[b].kind !== 'L') {
      throw new SimError(`${e.name} couples ${e.l1} and ${e.l2}, but they are not both inductors.`, [e.name])
    }
    const la = (els[a] as { value: number }).value
    const lb = (els[b] as { value: number }).value
    const m = e.k * Math.sqrt(la * lb)
    mutual.set(a, [...(mutual.get(a) ?? []), { j: b, m }])
    mutual.set(b, [...(mutual.get(b) ?? []), { j: a, m }])
  })
  return { circuit, els, nodes, idx, nd, br, size, nNodes, byName, mutual, hasNonlinear, canBacktrack: hasNonlinear && !junctions, hasOpamp, vscale, capBranch }
}

// ------------------------------------------------------------------------------ state, context

export interface State {
  capV: Float64Array
  capI: Float64Array
  indI: Float64Array
  indV: Float64Array
  js: JState[]
}

function newState(p: Prepared): State {
  const n = p.els.length
  return { capV: new Float64Array(n), capI: new Float64Array(n), indI: new Float64Array(n), indV: new Float64Array(n), js: Array.from({ length: n }, () => ({ v: [] })) }
}

interface Ctx {
  mode: 'dc' | 'tran' | 'uic0'
  t: number
  h: number
  tr: boolean
  srcScale: number
  gmin: number
  override?: { name: string; value: number }
}

const RELTOL = 1e-6
const VNTOL = 1e-9
const ABSTOL = 1e-12
const GMIN = 1e-12

function srcValue(e: { name: string; src: Source }, c: Ctx): number {
  if (c.override && c.override.name.toLowerCase() === e.name.toLowerCase()) return c.override.value * c.srcScale
  const v = c.mode === 'dc' ? sourceDC(e.src) : sourceAt(e.src, c.t)
  return v * c.srcScale
}

const volt = (x: ArrayLike<number>, r: number) => (r < 0 ? 0 : x[r])

function switchR(e: Extract<Elem, { kind: 'S' }>, c: Ctx): number {
  const t = c.mode === 'tran' ? c.t - c.h / 2 : 0
  return switchClosed(e.spec, t) ? e.ron : e.roff
}

/** Companion-model conductance and equivalent current for a capacitor. */
function capCompanion(value: number, c: Ctx, vprev: number, iprev: number): { geq: number; ieq: number } {
  const geq = (c.tr ? 2 : 1) * value / c.h
  return { geq, ieq: geq * vprev + (c.tr ? iprev : 0) }
}

function termVolts(p: Prepared, i: number, x: ArrayLike<number>): number[] {
  return p.nd[i].map((r) => volt(x, r))
}

// ------------------------------------------------------------------------------ assembling

function assemble(p: Prepared, x: Float64Array, st: State, c: Ctx, A: Float64Array, b: Float64Array): boolean {
  const n = p.size
  A.fill(0)
  b.fill(0)
  let limited = false
  const add = (r: number, k: number, v: number) => { if (r >= 0 && k >= 0) A[r * n + k] += v }
  const rhs = (r: number, v: number) => { if (r >= 0) b[r] += v }
  const conductance = (a: number, bb: number, g: number) => { add(a, a, g); add(bb, bb, g); add(a, bb, -g); add(bb, a, -g) }
  for (let i = 0; i < p.nNodes; i++) A[i * n + i] += c.gmin
  for (let i = 0; i < p.els.length; i++) {
    const e = p.els[i]
    const nn = p.nd[i]
    const r = p.br[i]
    switch (e.kind) {
      case 'R': conductance(nn[0], nn[1], 1 / e.value); break
      case 'S': conductance(nn[0], nn[1], 1 / switchR(e, c)); break
      case 'C':
        if (c.mode === 'tran') {
          const { geq, ieq } = capCompanion(e.value, c, st.capV[i], st.capI[i])
          conductance(nn[0], nn[1], geq)
          rhs(nn[0], ieq)
          rhs(nn[1], -ieq)
        } else if (c.mode === 'uic0' && r >= 0) {
          add(nn[0], r, 1); add(nn[1], r, -1)
          add(r, nn[0], 1); add(r, nn[1], -1)
          b[r] = e.ic ?? 0
        }
        if (r >= 0 && c.mode !== 'uic0') A[r * n + r] = 1 // unused branch row
        break
      case 'L':
        add(nn[0], r, 1); add(nn[1], r, -1)
        if (c.mode === 'uic0') {
          A[r * n + r] = 1
          b[r] = e.ic ?? 0
        } else if (c.mode === 'dc') {
          // a short, with a micro-ohm so a source straight across a coil is still solvable
          add(r, nn[0], 1); add(r, nn[1], -1); add(r, r, -1e-6)
        } else {
          const k = (c.tr ? 2 : 1) / c.h
          add(r, nn[0], 1); add(r, nn[1], -1)
          add(r, r, -k * e.value)
          let rh = -k * e.value * st.indI[i] - (c.tr ? st.indV[i] : 0)
          for (const m of p.mutual.get(i) ?? []) {
            add(r, p.br[m.j], -k * m.m)
            rh -= k * m.m * st.indI[m.j]
          }
          b[r] = rh
        }
        break
      case 'V':
        add(nn[0], r, 1); add(nn[1], r, -1)
        add(r, nn[0], 1); add(r, nn[1], -1)
        b[r] = srcValue(e, c)
        break
      case 'I': {
        const v = srcValue(e, c)
        rhs(nn[0], -v)
        rhs(nn[1], v)
        break
      }
      case 'E':
        add(nn[0], r, 1); add(nn[1], r, -1)
        add(r, nn[0], 1); add(r, nn[1], -1); add(r, nn[2], -e.value); add(r, nn[3], e.value)
        break
      case 'G':
        add(nn[0], nn[2], e.value); add(nn[0], nn[3], -e.value)
        add(nn[1], nn[2], -e.value); add(nn[1], nn[3], e.value)
        break
      case 'D':
      case 'Q':
      case 'M': {
        const v = termVolts(p, i, x)
        const lin: Lin = e.kind === 'D' ? evalDiode(e.model, v, st.js[i], c.gmin) : e.kind === 'Q' ? evalBjt(e.model, v, st.js[i], c.gmin) : evalMos(e.model, v)
        if (lin.limited) limited = true
        for (let k = 0; k < nn.length; k++) {
          for (let j = 0; j < nn.length; j++) add(nn[k], nn[j], lin.g[k][j])
          rhs(nn[k], -lin.ieq[k])
        }
        break
      }
      case 'B': {
        const vin = nn.slice(1).map((q) => volt(x, q))
        const ev = evalBehaviour(e.fn, vin)
        add(nn[0], r, 1)
        add(r, nn[0], 1)
        add(r, r, -e.fn.ro)
        let cst = ev.f
        for (let j = 0; j < ev.df.length; j++) {
          add(r, nn[1 + j], -ev.df[j])
          cst -= ev.df[j] * (vin[j] ?? 0)
        }
        b[r] = cst
        break
      }
      case 'K': break
    }
  }
  return limited
}

// ------------------------------------------------------------------------------ Newton–Raphson

interface NewtonResult { ok: boolean; x: Float64Array; iterations: number; singular: boolean }

function newton(p: Prepared, st: State, c: Ctx, x0: Float64Array, maxIter: number, robust = false): NewtonResult {
  const n = p.size
  if (n === 0) return { ok: true, x: new Float64Array(0), iterations: 0, singular: false }
  let x = Float64Array.from(x0)
  const A = new Float64Array(n * n)
  const b = new Float64Array(n)
  const vlim = Math.max(3, 0.5 * p.vscale)
  // a transient step is judged more loosely than a DC solution: the step control keeps the accuracy
  const rel = c.mode === 'tran' ? 1e-4 : RELTOL
  const vn = c.mode === 'tran' ? 1e-6 : VNTOL
  const an = c.mode === 'tran' ? 1e-9 : ABSTOL
  // robust mode: a backtracking line search on the residual (only without exponential junctions, which are limited instead)
  let A0 = new Float64Array(n * n)
  let b0 = new Float64Array(n)
  let r0 = Infinity
  const residual = (Am: Float64Array, bm: Float64Array, xv: Float64Array): number => {
    let sum = 0
    for (let i = 0; i < n; i++) {
      let acc = -bm[i]
      for (let j = 0; j < n; j++) acc += Am[i * n + j] * xv[j]
      sum += acc * acc
    }
    return Math.sqrt(sum)
  }
  let limited = assemble(p, x, st, c, A0, b0)
  if (robust) r0 = residual(A0, b0, x)
  for (let it = 1; it <= maxIter; it++) {
    A.set(A0)
    b.set(b0)
    if (!solveReal(A, b, n)) return { ok: false, x, iterations: it, singular: true }
    let finite = true
    let conv = !limited
    let maxdv = 0
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(b[i])) { finite = false; break }
      const d = Math.abs(b[i] - x[i])
      const tol = rel * Math.max(Math.abs(b[i]), Math.abs(x[i])) + (i < p.nNodes ? vn : an)
      if (d > tol) conv = false
      if (i < p.nNodes && d > maxdv) maxdv = d
    }
    if (!finite) return { ok: false, x, iterations: it, singular: true }
    if (!p.hasNonlinear) return { ok: true, x: Float64Array.from(b), iterations: it, singular: false }
    if (conv) return { ok: true, x: Float64Array.from(b), iterations: it, singular: false }
    let alpha = maxdv > vlim ? vlim / maxdv : 1
    const xn = Float64Array.from(b)
    const xt = new Float64Array(n)
    for (let tries = 0; ; tries++) {
      for (let i = 0; i < n; i++) xt[i] = x[i] + alpha * (xn[i] - x[i])
      const A1 = new Float64Array(n * n)
      const b1 = new Float64Array(n)
      limited = assemble(p, xt, st, c, A1, b1)
      if (!robust) { A0 = A1; b0 = b1; break }
      const r1 = residual(A1, b1, xt)
      if (r1 <= r0 * (1 - 1e-4 * alpha) || tries >= 8) { A0 = A1; b0 = b1; r0 = r1; break }
      alpha /= 2
    }
    x = Float64Array.from(xt)
  }
  return { ok: false, x, iterations: maxIter, singular: false }
}

export interface DcSolution { x: Float64Array; iterations: number; method: 'newton' | 'gmin stepping' | 'source stepping' }

function resetJs(st: State) {
  for (const j of st.js) j.v.length = 0
}

/** The DC solution, trying plain Newton, then gmin stepping, then source stepping. */
function solveDCRaw(p: Prepared, st: State, base: Ctx, guess?: Float64Array): DcSolution {
  const n = p.size
  const zero = new Float64Array(n)
  let total = 0
  const first = newton(p, st, { ...base, gmin: GMIN }, guess ?? zero, 150)
  total += first.iterations
  if (first.ok) return { x: first.x, iterations: total, method: 'newton' }
  if (first.singular && !p.hasNonlinear) throw singularError(p)
  if (p.canBacktrack) {
    resetJs(st)
    const second = newton(p, st, { ...base, gmin: GMIN }, guess ?? zero, 200, true)
    total += second.iterations
    if (second.ok) return { x: second.x, iterations: total, method: 'newton' }
  }
  // gmin stepping
  resetJs(st)
  let x: Float64Array = zero
  let okAll = true
  for (let e = -2; e >= -12; e -= 1) {
    const r = newton(p, st, { ...base, gmin: Math.pow(10, e) }, x, 100, p.canBacktrack)
    total += r.iterations
    if (!r.ok) { okAll = false; break }
    x = r.x
  }
  if (okAll) {
    const r = newton(p, st, { ...base, gmin: GMIN }, x, 100, p.canBacktrack)
    total += r.iterations
    if (r.ok) return { x: r.x, iterations: total, method: 'gmin stepping' }
  }
  // source stepping
  resetJs(st)
  x = zero
  okAll = true
  const steps = 30
  for (let s = 1; s <= steps; s++) {
    const r = newton(p, st, { ...base, gmin: GMIN * 1e3, srcScale: base.srcScale * (s / steps) }, x, 100, p.canBacktrack)
    total += r.iterations
    if (!r.ok) { okAll = false; break }
    x = r.x
  }
  if (okAll) {
    const r = newton(p, st, { ...base, gmin: GMIN }, x, 100, p.canBacktrack)
    total += r.iterations
    if (r.ok) return { x: r.x, iterations: total, method: 'source stepping' }
  }
  throw first.singular ? singularError(p) : new SimError('The circuit has no steady DC solution that the solver could find. Oscillators and latches often have none: run a transient analysis with “start from initial conditions” ticked. Otherwise check for a diode or transistor with nothing limiting its current, or a loop of ideal sources.', [])
}

/**
 * A comparator or Schmitt trigger (an op-amp with positive feedback) has a balanced solution that Newton finds
 * first but a real circuit never stays on: it is unstable. Such a solution shows as a negative resistance at an
 * op-amp input (injecting current lowers the voltage there). When one is found the solution is pushed off along
 * that direction so the iteration falls into a stable, saturated state.
 */
function solveDC(p: Prepared, st: State, base: Ctx, guess?: Float64Array): DcSolution {
  let sol = solveDCRaw(p, st, base, guess)
  if (!p.hasOpamp || base.mode !== 'dc') return sol
  const n = p.size
  for (let attempt = 0; attempt < 3; attempt++) {
    const A = new Float64Array(n * n)
    const b = new Float64Array(n)
    assemble(p, sol.x, st, { ...base, gmin: GMIN }, A, b)
    let kick: Float64Array | null = null
    let kickRow = -1
    let kickSize = 1e-5
    for (let i = 0; i < p.els.length && !kick; i++) {
      const e = p.els[i]
      if (e.kind !== 'B' || e.fn.type !== 'opamp') continue
      for (const row of [p.nd[i][1], p.nd[i][2]]) {
        if (row < 0) continue
        const M = Float64Array.from(A)
        const y = new Float64Array(n)
        y[row] = 1
        if (!solveReal(M, y, n)) continue
        if (y[row] < -1e-9) { kick = y; kickRow = row; kickSize = Math.max(1e-5, (6 * e.fn.rail) / e.fn.gain); break }
      }
    }
    if (!kick) return sol
    // move the op-amp input along the unstable direction by a few times its linear range (output swing / gain),
    // far enough for it to saturate
    const x2 = Float64Array.from(sol.x)
    const scale = kickSize / Math.abs(kick[kickRow])
    for (let i = 0; i < n; i++) x2[i] += kick[i] * scale
    const r = newton(p, st, { ...base, gmin: GMIN }, x2, 150)
    if (!r.ok) return sol
    sol = { x: r.x, iterations: sol.iterations + r.iterations, method: sol.method }
  }
  return sol
}

function singularError(_p?: Prepared): SimError {
  return new SimError('The circuit equations cannot be solved (singular matrix). Usual causes: two voltage sources in parallel or a loop of sources and inductors, a node with no path to ground, or a missing ground.', [])
}

// ------------------------------------------------------------------------------ signals

/** Current into each terminal of element i, and the absorbed power, at solution x. */
function terminalCurrents(p: Prepared, i: number, x: Float64Array, st: State, c: Ctx): number[] {
  const e = p.els[i]
  const nn = p.nd[i]
  const r = p.br[i]
  const v = termVolts(p, i, x)
  switch (e.kind) {
    case 'R': { const g = (v[0] - v[1]) / e.value; return [g, -g] }
    case 'S': { const g = (v[0] - v[1]) / switchR(e, c); return [g, -g] }
    case 'C': {
      if (c.mode === 'tran') { const { geq, ieq } = capCompanion(e.value, c, st.capV[i], st.capI[i]); const q = geq * (v[0] - v[1]) - ieq; return [q, -q] }
      if (c.mode === 'uic0' && r >= 0) return [x[r], -x[r]]
      return [0, 0]
    }
    case 'L': case 'V': return [x[r], -x[r]]
    case 'I': { const s = srcValue(e, c); return [s, -s] }
    case 'E': return [x[r], -x[r], 0, 0]
    case 'G': { const q = e.value * (v[2] - v[3]); return [q, -q, 0, 0] }
    case 'D': { const q = diodeCurrent(e.model, v[0] - v[1]).i; return [q, -q] }
    case 'Q': return bjtCurrents(e.model, v)
    case 'M': { const q = mosDrainCurrent(e.model, v); return [q, 0, -q] }
    case 'B': return [x[r], ...nn.slice(1).map(() => 0)]
    case 'K': return []
  }
}

/** Voltage names → value, and per element I(name) / P(name). */
function snapshot(p: Prepared, x: Float64Array, st: State, c: Ctx, out: Record<string, number>) {
  p.nodes.forEach((n, i) => { out[`V(${n})`] = x[i] })
  for (let i = 0; i < p.els.length; i++) {
    const e = p.els[i]
    if (e.kind === 'K') continue
    const cur = terminalCurrents(p, i, x, st, c)
    const v = termVolts(p, i, x)
    let pw = 0
    for (let k = 0; k < cur.length; k++) pw += (v[k] ?? 0) * cur[k]
    out[`I(${e.name})`] = cur[0]
    out[`P(${e.name})`] = pw
    if (e.kind === 'Q') { out[`Ib(${e.name})`] = cur[1]; out[`Ie(${e.name})`] = cur[2] }
  }
}

// ------------------------------------------------------------------------------ operating point

export interface OpResult {
  /** V(node), I(element), P(element) (power absorbed; negative = delivered) */
  values: Record<string, number>
  nodes: Record<string, number>
  currents: Record<string, number>
  power: Record<string, number>
  /** short description of each transistor / diode region */
  devices: Record<string, string>
  totalPower: number
  suppliedPower: number
  dissipatedPower: number
  iterations: number
  method: string
}

function describeDevices(p: Prepared, x: Float64Array): Record<string, string> {
  const out: Record<string, string> = {}
  p.els.forEach((e, i) => {
    const v = termVolts(p, i, x)
    if (e.kind === 'D') {
      const vd = v[0] - v[1]
      out[e.name] = e.model.bv && vd < -e.model.bv * 0.98 ? `breakdown (${vd.toFixed(2)} V)` : vd > 0.3 ? `conducting (${vd.toFixed(3)} V)` : 'off'
    } else if (e.kind === 'Q') {
      const pol = e.model.pol
      const vbe = pol * (v[1] - v[2])
      const vbc = pol * (v[1] - v[0])
      out[e.name] = vbe < 0.4 ? 'cut-off' : vbc > 0.4 ? `saturated (Vce ${(pol * (v[0] - v[2])).toFixed(2)} V)` : `forward active (Vbe ${vbe.toFixed(3)} V)`
    } else if (e.kind === 'M') {
      const pol = e.model.pol
      const vgs = pol * (v[1] - v[2])
      const vds = pol * (v[0] - v[2])
      const vth = pol * e.model.vto
      out[e.name] = vgs <= vth ? 'cut-off' : vds < vgs - vth ? `triode (Vds ${vds.toFixed(3)} V)` : `saturation (Vgs ${vgs.toFixed(2)} V)`
    } else if (e.kind === 'B' && e.fn.type === 'opamp') {
      const o = v[0]
      const rail = e.fn.rail
      out[e.name] = !e.fn.supply && Math.abs(o) > rail * 0.99 ? 'saturated (output at the rail)' : 'linear'
    }
  })
  return out
}

function makeOp(p: Prepared, st: State, sol: DcSolution, c: Ctx): OpResult {
  const values: Record<string, number> = {}
  snapshot(p, sol.x, st, c, values)
  const nodes: Record<string, number> = {}
  const currents: Record<string, number> = {}
  const power: Record<string, number> = {}
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith('V(')) nodes[k.slice(2, -1)] = v
    else if (k.startsWith('I(')) currents[k.slice(2, -1)] = v
    else if (k.startsWith('P(')) power[k.slice(2, -1)] = v
  }
  let sup = 0
  let dis = 0
  for (const v of Object.values(power)) { if (v < 0) sup -= v; else dis += v }
  return {
    values, nodes, currents, power, devices: describeDevices(p, sol.x),
    totalPower: sup - dis, suppliedPower: sup, dissipatedPower: dis, iterations: sol.iterations, method: sol.method,
  }
}

export function operatingPoint(circuit: Circuit): OpResult {
  const p = prepare(circuit)
  const st = newState(p)
  const c: Ctx = { mode: 'dc', t: 0, h: 0, tr: false, srcScale: 1, gmin: GMIN }
  const sol = solveDC(p, st, c)
  return makeOp(p, st, sol, c)
}

// ------------------------------------------------------------------------------ DC sweep

export interface SweepResult {
  x: number[]
  xLabel: string
  signals: Record<string, number[]>
}

export function dcSweep(circuit: Circuit, source: string, start: number, stop: number, step: number): SweepResult {
  const p = prepare(circuit)
  const el = p.els.find((e) => e.name.toLowerCase() === source.toLowerCase())
  if (!el || (el.kind !== 'V' && el.kind !== 'I')) throw new SimError(`The DC sweep needs a voltage or current source: “${source}” is not one.`, [source])
  if (!(step !== 0) || (stop - start) / step < 0) throw new SimError('The DC sweep step must go from the start towards the stop value.')
  const count = Math.floor(Math.abs((stop - start) / step) + 1e-9) + 1
  if (count > 100000) throw new SimError('The DC sweep has too many points (limit 100 000).')
  const st = newState(p)
  const xs: number[] = []
  const signals: Record<string, number[]> = {}
  let guess: Float64Array | undefined
  for (let k = 0; k < count; k++) {
    const v = start + k * step
    const c: Ctx = { mode: 'dc', t: 0, h: 0, tr: false, srcScale: 1, gmin: GMIN, override: { name: el.name, value: v } }
    let sol: DcSolution
    try { sol = solveDC(p, st, c, guess) } catch (e) {
      if (e instanceof SimError) throw new SimError(`${e.message} (at ${el.name} = ${v})`, e.refs)
      throw e
    }
    guess = sol.x
    const snap: Record<string, number> = {}
    snapshot(p, sol.x, st, c, snap)
    xs.push(v)
    for (const [key, val] of Object.entries(snap)) (signals[key] ??= []).push(val)
  }
  return { x: xs, xLabel: el.name, signals }
}

// ------------------------------------------------------------------------------ transient

export interface TranResult {
  t: number[]
  signals: Record<string, number[]>
  steps: number
  rejected: number
  /** things worth telling the user (e.g. the run started from zero because no DC solution exists) */
  notes: string[]
}

export interface TranOptions { tstop: number; tstep?: number; tmax?: number; uic?: boolean; maxPoints?: number; signal?: { aborted: boolean } }

export function transient(circuit: Circuit, opt: TranOptions): TranResult {
  try {
    return transientRun(circuit, opt)
  } catch (e) {
    // an oscillator or latch has no DC operating point: start from zero (all capacitors empty) instead
    if (!opt.uic && e instanceof SimError && /no steady DC solution/.test(e.message)) {
      const r = transientRun(circuit, { ...opt, uic: true })
      r.notes.push('The circuit has no DC operating point (it oscillates or latches), so the run started from zero: capacitors empty, inductors without current.')
      return r
    }
    throw e
  }
}

function transientRun(circuit: Circuit, opt: TranOptions): TranResult {
  const tstop = opt.tstop
  if (!(tstop > 0)) throw new SimError('The stop time must be above zero.')
  const edgeMin = Math.max(tstop * 1e-7, 1e-12)
  const adjusted: Circuit = {
    ...circuit,
    elements: circuit.elements.map((e) => {
      if ((e.kind === 'V' || e.kind === 'I') && e.src.wave?.kind === 'pulse') {
        const w = e.src.wave
        return { ...e, src: { ...e.src, wave: { ...w, rise: Math.max(w.rise, edgeMin), fall: Math.max(w.fall, edgeMin) } } }
      }
      return e
    }),
  }
  const uic = !!opt.uic
  const p = prepare(adjusted, uic)
  const st = newState(p)
  let hmax = opt.tmax ?? tstop / 500
  if (opt.tstep) hmax = Math.min(hmax, Math.max(opt.tstep, tstop / 20000))
  for (const e of p.els) if ((e.kind === 'V' || e.kind === 'I') && e.src.wave?.kind === 'sin' && e.src.wave.freq > 0) hmax = Math.min(hmax, 1 / (50 * e.src.wave.freq))
  const hmin = tstop * 1e-13
  const maxPoints = opt.maxPoints ?? 150000

  // initial solution
  let x: Float64Array
  const c0: Ctx = { mode: uic ? 'uic0' : 'dc', t: 0, h: 0, tr: false, srcScale: 1, gmin: GMIN }
  const sol0 = solveDC(p, st, c0)
  x = sol0.x
  for (let i = 0; i < p.els.length; i++) {
    const e = p.els[i]
    const nn = p.nd[i]
    if (e.kind === 'C') {
      st.capV[i] = volt(x, nn[0]) - volt(x, nn[1])
      st.capI[i] = uic && p.br[i] >= 0 ? x[p.br[i]] : 0
    } else if (e.kind === 'L') {
      st.indI[i] = x[p.br[i]]
      st.indV[i] = uic ? volt(x, nn[0]) - volt(x, nn[1]) : 0
    }
  }
  resetJs(st)

  const t: number[] = []
  const signals: Record<string, number[]> = {}
  const record = (time: number, xs: Float64Array, c: Ctx) => {
    const snap: Record<string, number> = {}
    snapshot(p, xs, st, c, snap)
    t.push(time)
    for (const [key, val] of Object.entries(snap)) (signals[key] ??= []).push(val)
  }
  record(0, x, c0)

  // The step is chosen from how well the state variables (capacitor voltages, inductor currents) follow a
  // polynomial through the previous points: node voltages that merely jump when a diode turns on or off
  // are not states, and must not shrink the step.
  const states: { c: boolean; a: number; b: number }[] = []
  p.els.forEach((e, i) => {
    if (e.kind === 'C') states.push({ c: true, a: p.nd[i][0], b: p.nd[i][1] })
    else if (e.kind === 'L') states.push({ c: false, a: p.br[i], b: -1 })
  })
  const stateOf = (xs: Float64Array): Float64Array => Float64Array.from(states, (q) => (q.c ? volt(xs, q.a) - volt(xs, q.b) : xs[q.a]))

  interface Pt { t: number; x: Float64Array; s: Float64Array }
  let hist: Pt[] = [{ t: 0, x, s: stateOf(x) }]
  let time = 0
  let h = hmax / 20
  let steps = 0
  let rejected = 0
  let afterBreak = true
  let forceBE = false // after a failed step, retry with backward Euler: trapezoidal rings when the step is tiny

  while (time < tstop * (1 - 1e-12)) {
    if (opt.signal?.aborted) throw new SimError('Stopped.')
    if (t.length > maxPoints) throw new SimError(`The simulation needs more than ${maxPoints} time points. Raise “max step” or shorten the stop time.`)
    let hTry = Math.min(h, hmax, tstop - time)
    let nb = Infinity
    for (const e of p.els) nb = Math.min(nb, nextBreakpoint(e, time, tstop))
    let landed = false
    if (nb - time <= hTry * 1.05) { hTry = nb - time; landed = true }
    if (tstop - time <= hTry * 1.05) { hTry = tstop - time }
    const useTR = !afterBreak && !forceBE
    const tNew = time + hTry
    const c: Ctx = { mode: 'tran', t: tNew, h: hTry, tr: useTR, srcScale: 1, gmin: GMIN }
    const stSave = st.js.map((j) => ({ v: [...j.v] }))
    let r = newton(p, st, c, x, 60)
    if (!r.ok && p.canBacktrack) {
      st.js.forEach((j, i) => { j.v = stSave[i].v })
      r = newton(p, st, c, x, 80, true)
    }
    if (!r.ok) {
      st.js.forEach((j, i) => { j.v = stSave[i].v })
      rejected++
      forceBE = true
      h = hTry / 4
      if (h < hmin) throw new SimError(`The transient analysis could not continue at t = ${time.toExponential(3)} s (the step became too small). Check for an ideal switch or source driving a capacitor loop.`)
      continue
    }
    // local truncation error from a polynomial predictor of the states
    let est = 0
    const hl = hist.length
    const sNew = stateOf(r.x)
    if (hl >= 2 && states.length > 0) {
      const pr = new Float64Array(states.length)
      if (hl >= 3) {
        const [a, bb, cc] = hist.slice(-3)
        const l0 = ((tNew - bb.t) * (tNew - cc.t)) / ((a.t - bb.t) * (a.t - cc.t))
        const l1 = ((tNew - a.t) * (tNew - cc.t)) / ((bb.t - a.t) * (bb.t - cc.t))
        const l2 = ((tNew - a.t) * (tNew - bb.t)) / ((cc.t - a.t) * (cc.t - bb.t))
        for (let i = 0; i < pr.length; i++) pr[i] = l0 * a.s[i] + l1 * bb.s[i] + l2 * cc.s[i]
      } else {
        const [bb, cc] = hist.slice(-2)
        const f = (tNew - cc.t) / (cc.t - bb.t)
        for (let i = 0; i < pr.length; i++) pr[i] = cc.s[i] + f * (cc.s[i] - bb.s[i])
      }
      let ratio = 0
      const last = hist[hl - 1].s
      for (let i = 0; i < pr.length; i++) {
        const tol = 1e-3 * Math.max(Math.abs(sNew[i]), Math.abs(last[i])) + (states[i].c ? 1e-6 : 1e-9)
        ratio = Math.max(ratio, Math.abs(sNew[i] - pr[i]) / tol)
      }
      est = ratio / (hl >= 3 ? 6 : 2)
    }
    if (est > 1 && hTry > hmin * 16 && !landed) {
      st.js.forEach((j, i) => { j.v = stSave[i].v })
      rejected++
      h = hTry * Math.max(0.2, 0.9 * Math.pow(1 / est, hl >= 3 ? 1 / 3 : 1 / 2))
      continue
    }
    // accept
    for (let i = 0; i < p.els.length; i++) {
      const e = p.els[i]
      const nn = p.nd[i]
      if (e.kind === 'C') {
        const v = volt(r.x, nn[0]) - volt(r.x, nn[1])
        const { geq, ieq } = capCompanion(e.value, c, st.capV[i], st.capI[i])
        st.capI[i] = geq * v - ieq
        st.capV[i] = v
      } else if (e.kind === 'L') {
        st.indI[i] = r.x[p.br[i]]
        st.indV[i] = volt(r.x, nn[0]) - volt(r.x, nn[1])
      }
    }
    x = r.x
    time = tNew
    steps++
    forceBE = false
    record(time, x, c)
    if (landed) {
      hist = [{ t: time, x, s: sNew }]
      afterBreak = true
      h = Math.max(hmax / 20, hTry)
    } else {
      hist.push({ t: time, x, s: sNew })
      if (hist.length > 3) hist.shift()
      afterBreak = false
      const grow = est > 0 ? Math.min(2, Math.max(0.5, 0.9 * Math.pow(1 / est, hl >= 3 ? 1 / 3 : 1 / 2))) : 2
      h = hTry * grow
    }
  }
  return { t, signals, steps, rejected, notes: [] }
}

// ------------------------------------------------------------------------------ AC

export interface AcResult {
  freq: number[]
  /** magnitude of V(node) / I(element) at each frequency */
  mag: Record<string, number[]>
  /** phase in degrees (unwrapped) */
  phase: Record<string, number[]>
}

export function acSweep(circuit: Circuit, fstart: number, fstop: number, perDecade: number): AcResult {
  if (!(fstart > 0) || !(fstop > fstart)) throw new SimError('The AC sweep needs 0 < start < stop frequency.')
  const hasAc = circuit.elements.some((e) => (e.kind === 'V' || e.kind === 'I') && e.src.acMag !== 0)
  if (!hasAc) throw new SimError('No source has an AC amplitude: give a voltage or current source an AC value (1 is the usual choice) to run an AC sweep.')
  const p = prepare(circuit)
  const st = newState(p)
  const c: Ctx = { mode: 'dc', t: 0, h: 0, tr: false, srcScale: 1, gmin: GMIN }
  const op = solveDC(p, st, c).x
  const n = p.size
  const decades = Math.log10(fstop / fstart)
  const count = Math.max(2, Math.ceil(decades * perDecade) + 1)
  const freq: number[] = []
  for (let k = 0; k < count; k++) freq.push(fstart * Math.pow(10, (k * decades) / (count - 1)))
  const re = (n2: number) => new Float64Array(n2)
  const Ar = re(n * n), Ai = re(n * n), br = re(n), bi = re(n)
  const mag: Record<string, number[]> = {}
  const phase: Record<string, number[]> = {}
  // linearise the nonlinear parts once, at the operating point
  const lin: (Lin | null)[] = p.els.map((e, i) => {
    const v = termVolts(p, i, op)
    if (e.kind === 'D') return evalDiode(e.model, v, null, GMIN)
    if (e.kind === 'Q') return evalBjt(e.model, v, null, GMIN)
    if (e.kind === 'M') return evalMos(e.model, v)
    return null
  })
  const bev = p.els.map((e, i) => (e.kind === 'B' ? evalBehaviour(e.fn, p.nd[i].slice(1).map((q) => volt(op, q))) : null))
  const last: Record<string, number> = {}
  for (const f of freq) {
    const w = 2 * Math.PI * f
    Ar.fill(0); Ai.fill(0); br.fill(0); bi.fill(0)
    const add = (r: number, k: number, vr: number, vi = 0) => { if (r >= 0 && k >= 0) { Ar[r * n + k] += vr; Ai[r * n + k] += vi } }
    const cond = (a: number, b: number, gr: number, gi = 0) => { add(a, a, gr, gi); add(b, b, gr, gi); add(a, b, -gr, -gi); add(b, a, -gr, -gi) }
    for (let i = 0; i < p.nNodes; i++) Ar[i * n + i] += GMIN
    for (let i = 0; i < p.els.length; i++) {
      const e = p.els[i]
      const nn = p.nd[i]
      const r = p.br[i]
      switch (e.kind) {
        case 'R': cond(nn[0], nn[1], 1 / e.value); break
        case 'S': cond(nn[0], nn[1], 1 / (switchClosed(e.spec, 0) ? e.ron : e.roff)); break
        case 'C': cond(nn[0], nn[1], 0, w * e.value); break
        case 'L':
          add(nn[0], r, 1); add(nn[1], r, -1)
          add(r, nn[0], 1); add(r, nn[1], -1); add(r, r, 0, -w * e.value)
          for (const m of p.mutual.get(i) ?? []) add(r, p.br[m.j], 0, -w * m.m)
          break
        case 'V': {
          add(nn[0], r, 1); add(nn[1], r, -1)
          add(r, nn[0], 1); add(r, nn[1], -1)
          const ph = (e.src.acPhase * Math.PI) / 180
          br[r] = e.src.acMag * Math.cos(ph)
          bi[r] = e.src.acMag * Math.sin(ph)
          break
        }
        case 'I': {
          const ph = (e.src.acPhase * Math.PI) / 180
          const vr = e.src.acMag * Math.cos(ph)
          const vi = e.src.acMag * Math.sin(ph)
          if (nn[0] >= 0) { br[nn[0]] -= vr; bi[nn[0]] -= vi }
          if (nn[1] >= 0) { br[nn[1]] += vr; bi[nn[1]] += vi }
          break
        }
        case 'E':
          add(nn[0], r, 1); add(nn[1], r, -1)
          add(r, nn[0], 1); add(r, nn[1], -1); add(r, nn[2], -e.value); add(r, nn[3], e.value)
          break
        case 'G':
          add(nn[0], nn[2], e.value); add(nn[0], nn[3], -e.value); add(nn[1], nn[2], -e.value); add(nn[1], nn[3], e.value)
          break
        case 'D': case 'Q': case 'M': {
          const l = lin[i]!
          for (let k = 0; k < nn.length; k++) for (let j = 0; j < nn.length; j++) add(nn[k], nn[j], l.g[k][j])
          break
        }
        case 'B': {
          const ev = bev[i]!
          add(nn[0], r, 1); add(r, nn[0], 1); add(r, r, -e.fn.ro)
          for (let j = 0; j < ev.df.length; j++) add(r, nn[1 + j], -ev.df[j])
          break
        }
        case 'K': break
      }
    }
    if (n > 0 && !solveComplex(Ar, Ai, br, bi, n)) throw singularError(p)
    const put = (key: string, vr: number, vi: number) => {
      const m = Math.hypot(vr, vi)
      let ph = (Math.atan2(vi, vr) * 180) / Math.PI
      const prev = last[key]
      if (prev !== undefined) { while (ph - prev > 180) ph -= 360; while (ph - prev < -180) ph += 360 }
      last[key] = ph
      ;(mag[key] ??= []).push(m)
      ;(phase[key] ??= []).push(ph)
    }
    p.nodes.forEach((name, i) => put(`V(${name})`, br[i], bi[i]))
    for (let i = 0; i < p.els.length; i++) {
      const e = p.els[i]
      const nn = p.nd[i]
      const r = p.br[i]
      const vr = (k: number) => volt(br, nn[k])
      const vi = (k: number) => volt(bi, nn[k])
      let cr = 0
      let ci = 0
      switch (e.kind) {
        case 'R': { const g = 1 / e.value; cr = g * (vr(0) - vr(1)); ci = g * (vi(0) - vi(1)); break }
        case 'S': { const g = 1 / (switchClosed(e.spec, 0) ? e.ron : e.roff); cr = g * (vr(0) - vr(1)); ci = g * (vi(0) - vi(1)); break }
        case 'C': { const dr = vr(0) - vr(1); const di = vi(0) - vi(1); cr = -w * e.value * di; ci = w * e.value * dr; break }
        case 'L': case 'V': case 'E': case 'B': cr = br[r]; ci = bi[r]; break
        case 'I': { const ph = (e.src.acPhase * Math.PI) / 180; cr = e.src.acMag * Math.cos(ph); ci = e.src.acMag * Math.sin(ph); break }
        case 'G': { cr = e.value * (vr(2) - vr(3)); ci = e.value * (vi(2) - vi(3)); break }
        case 'D': case 'Q': case 'M': {
          const l = lin[i]!
          for (let j = 0; j < nn.length; j++) { cr += l.g[0][j] * vr(j); ci += l.g[0][j] * vi(j) }
          break
        }
        case 'K': continue
      }
      put(`I(${e.name})`, cr, ci)
    }
  }
  return { freq, mag, phase }
}

// ------------------------------------------------------------------------------ one entry point

export type SimResult =
  | { type: 'op'; op: OpResult }
  | { type: 'dc'; sweep: SweepResult }
  | { type: 'ac'; ac: AcResult }
  | { type: 'tran'; tran: TranResult }

export function simulate(circuit: Circuit, an: Analysis): SimResult {
  switch (an.type) {
    case 'op': return { type: 'op', op: operatingPoint(circuit) }
    case 'dc': return { type: 'dc', sweep: dcSweep(circuit, an.source, an.start, an.stop, an.step) }
    case 'ac': return { type: 'ac', ac: acSweep(circuit, an.fstart, an.fstop, an.perDecade) }
    case 'tran': return { type: 'tran', tran: transient(circuit, an) }
  }
}
