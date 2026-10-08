// Nonlinear device models: diode (with Zener breakdown), BJT (Ebers–Moll), MOSFET (level 1) and the
// behavioural sources (op-amp with rails, logic gates). Each evaluates to a linearisation about the
// given terminal voltages:  current into terminal k  ≈  Σ_j g[k][j]·v_j + ieq[k].

import type { Behaviour, BjtModel, DiodeModel, GateKind, MosModel } from './circuit.ts'
import { THERMAL_VOLTAGE } from './circuit.ts'

export interface Lin {
  /** Jacobian: g[k][j] = ∂(current into terminal k)/∂(voltage of terminal j) */
  g: number[][]
  ieq: number[]
  /** true when a junction voltage was limited this iteration (so Newton has not converged yet) */
  limited: boolean
}

/** The junction voltages used by the previous iteration (for limiting). */
export interface JState { v: number[] }

const VT = THERMAL_VOLTAGE
const expc = (x: number) => Math.exp(Math.min(x, 100))

/** SPICE's junction voltage limiter. */
export function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): { v: number; limited: boolean } {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    let v: number
    if (vold > 0) {
      const arg = (vnew - vold) / vt
      v = arg > 0 ? vold + vt * (2 + Math.log(Math.max(arg - 2, 1e-12))) : vold - vt * (2 + Math.log(2 - arg))
    } else v = vt * Math.log(vnew / vt)
    return { v, limited: true }
  }
  return { v: vnew, limited: false }
}

const vcritOf = (is: number, vt: number) => vt * Math.log(vt / (Math.SQRT2 * is))

const zeros = (n: number) => Array.from({ length: n }, () => new Array<number>(n).fill(0))

// ----------------------------------------------------------------------------- diode

export function diodeCurrent(m: DiodeModel, vd: number): { i: number; g: number } {
  const vte = m.n * VT
  const e = expc(vd / vte)
  let i = m.is * (e - 1)
  let g = (m.is / vte) * e
  if (m.bv) {
    const nb = 1.5 * VT
    const ibv = m.ibv ?? 5e-3
    const er = expc(-(vd + m.bv) / nb)
    i -= ibv * er
    g += (ibv / nb) * er
  }
  return { i, g }
}

export function evalDiode(m: DiodeModel, v: number[], js: JState | null, gmin: number): Lin {
  const vd = v[0] - v[1]
  const vte = m.n * VT
  let vf = vd
  let limited = false
  if (js) {
    const r = pnjlim(vd, js.v[0] ?? 0, vte, vcritOf(m.is, vte))
    vf = r.v
    limited = r.limited
    js.v[0] = vf
  }
  const ef = expc(vf / vte)
  let i0 = m.is * (ef - 1)
  let g = (m.is / vte) * ef
  let ieq = i0 - g * vf
  if (m.bv) {
    const nb = 1.5 * VT
    const ibv = m.ibv ?? 5e-3
    // reverse junction: vr = −(vd + bv)
    let vr = -(vd + m.bv)
    if (js) {
      const r = pnjlim(vr, js.v[1] ?? 0, nb, vcritOf(ibv * 1e-3, nb))
      vr = r.v
      limited = limited || r.limited
      js.v[1] = vr
    }
    const er = expc(vr / nb)
    const ir = ibv * er
    const gr = ir / nb
    const vd0 = -vr - m.bv
    i0 -= ir
    g += gr
    ieq += -ir - gr * vd0
  }
  g += gmin
  return { g: [[g, -g], [-g, g]], ieq: [ieq, -ieq], limited }
}

// ----------------------------------------------------------------------------- BJT

interface BjtOp { ic: number; ib: number; dicDbe: number; dicDbc: number; dibDbe: number; dibDbc: number }

/** Transport-form Ebers–Moll with Early effect; voltages and currents for an NPN-like device. */
function bjtCore(m: BjtModel, vbe: number, vbc: number): BjtOp {
  const If = m.is * (expc(vbe / VT) - 1)
  const Ir = m.is * (expc(vbc / VT) - 1)
  const gF = (m.is / VT) * expc(vbe / VT)
  const gR = (m.is / VT) * expc(vbc / VT)
  const va = m.vaf && m.vaf > 0 ? m.vaf : 0
  const early = va ? 1 - vbc / va : 1
  const ict = (If - Ir) * early
  const ic = ict - Ir / m.br
  const ib = If / m.bf + Ir / m.br
  return {
    ic, ib,
    dicDbe: gF * early,
    dicDbc: -gR * early - (va ? (If - Ir) / va : 0) - gR / m.br,
    dibDbe: gF / m.bf,
    dibDbc: gR / m.br,
  }
}

/** Terminals are [collector, base, emitter]. */
export function evalBjt(m: BjtModel, v: number[], js: JState | null, gmin: number): Lin {
  const pol = m.pol
  let vbe = pol * (v[1] - v[2])
  let vbc = pol * (v[1] - v[0])
  let limited = false
  if (js) {
    const crit = vcritOf(m.is, VT)
    const a = pnjlim(vbe, js.v[0] ?? 0, VT, crit)
    const b = pnjlim(vbc, js.v[1] ?? 0, VT, crit)
    vbe = a.v
    vbc = b.v
    limited = a.limited || b.limited
    js.v[0] = vbe
    js.v[1] = vbc
  }
  const op = bjtCore(m, vbe, vbc)
  // terminal currents into C, B, E (pol flips the signs for PNP); derivatives wrt vbe, vbc unchanged
  const dbe = [op.dicDbe, op.dibDbe, -(op.dicDbe + op.dibDbe)]
  const dbc = [op.dicDbc, op.dibDbc, -(op.dicDbc + op.dibDbc)]
  const i0 = [pol * op.ic, pol * op.ib, -pol * (op.ic + op.ib)]
  const g = zeros(3)
  const ieq = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    // vbe = pol·(vb − ve), vbc = pol·(vb − vc)  ⇒ ∂/∂vb = (dbe+dbc), ∂/∂ve = −dbe, ∂/∂vc = −dbc (pol² = 1)
    g[k][1] += dbe[k] + dbc[k]
    g[k][2] += -dbe[k]
    g[k][0] += -dbc[k]
    ieq[k] = i0[k] - pol * (dbe[k] * vbe + dbc[k] * vbc)
  }
  // junction shunts help the first iterations
  g[1][1] += 2 * gmin; g[1][2] -= gmin; g[1][0] -= gmin
  g[2][2] += gmin; g[2][1] -= gmin
  g[0][0] += gmin; g[0][1] -= gmin
  return { g, ieq, limited }
}

/** Currents into [collector, base, emitter] with no limiting (for reporting). */
export function bjtCurrents(m: BjtModel, v: number[]): number[] {
  const pol = m.pol
  const op = bjtCore(m, pol * (v[1] - v[2]), pol * (v[1] - v[0]))
  return [pol * op.ic, pol * op.ib, -pol * (op.ic + op.ib)]
}

// ----------------------------------------------------------------------------- MOSFET

function mosCore(beta: number, lambda: number, vgs: number, vds: number, vth: number): { id: number; gm: number; gds: number } {
  const vov = vgs - vth
  if (vov <= 0) return { id: 0, gm: 0, gds: 0 }
  const cl = 1 + lambda * vds
  if (vds < vov) {
    const core = vov * vds - (vds * vds) / 2
    return { id: beta * core * cl, gm: beta * vds * cl, gds: beta * (vov - vds) * cl + beta * core * lambda }
  }
  return { id: ((beta / 2) * vov * vov) * cl, gm: beta * vov * cl, gds: ((beta / 2) * vov * vov) * lambda }
}

/** Terminals are [drain, gate, source]; the body is tied to the source. */
export function evalMos(m: MosModel, v: number[]): Lin {
  const pol = m.pol
  const vth = pol * m.vto
  const beta = (m.kp * m.w) / m.l
  const vd = v[0], vg = v[1], vs = v[2]
  const swapped = pol * (vd - vs) < 0
  const g = zeros(3)
  const ieq = [0, 0, 0]
  if (!swapped) {
    const op = mosCore(beta, m.lambda, pol * (vg - vs), pol * (vd - vs), vth)
    const id = pol * op.id
    g[0][0] = op.gds; g[0][1] = op.gm; g[0][2] = -(op.gm + op.gds)
    g[2][0] = -op.gds; g[2][1] = -op.gm; g[2][2] = op.gm + op.gds
    const c = id - (op.gds * vd + op.gm * vg - (op.gm + op.gds) * vs)
    ieq[0] = c
    ieq[2] = -c
  } else {
    // source and drain swap roles: current flows from the "source" terminal to the "drain" terminal
    const op = mosCore(beta, m.lambda, pol * (vg - vd), pol * (vs - vd), vth)
    const id = -pol * op.id // into terminal 0 (drain)
    g[0][0] = op.gm + op.gds; g[0][1] = -op.gm; g[0][2] = -op.gds
    g[2][0] = -(op.gm + op.gds); g[2][1] = op.gm; g[2][2] = op.gds
    const c = id - (g[0][0] * vd + g[0][1] * vg + g[0][2] * vs)
    ieq[0] = c
    ieq[2] = -c
  }
  return { g, ieq, limited: false }
}

/** Current into the drain (no limiting). */
export function mosDrainCurrent(m: MosModel, v: number[]): number {
  const lin = evalMos(m, v)
  return lin.g[0][0] * v[0] + lin.g[0][1] * v[1] + lin.g[0][2] * v[2] + lin.ieq[0]
}

// ----------------------------------------------------------------------------- behavioural sources

const sigmoid = (x: number) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)))
/** smooth max(a, b) with softness eps, and its partial derivatives */
function smax(a: number, b: number, eps: number): { f: number; da: number; db: number } {
  const m = Math.max(a, b)
  const f = m + eps * Math.log1p(Math.exp(-Math.abs(a - b) / eps))
  const sa = sigmoid((a - b) / eps)
  return { f, da: sa, db: 1 - sa }
}

export interface BEval { f: number; df: number[] }

const LOGIC: Record<GateKind, (a: number, b: number) => { y: number; da: number; db: number }> = {
  and: (a, b) => ({ y: a * b, da: b, db: a }),
  or: (a, b) => ({ y: a + b - a * b, da: 1 - b, db: 1 - a }),
  xor: (a, b) => ({ y: a + b - 2 * a * b, da: 1 - 2 * b, db: 1 - 2 * a }),
  nand: (a, b) => { const r = LOGIC.and(a, b); return { y: 1 - r.y, da: -r.da, db: -r.db } },
  nor: (a, b) => { const r = LOGIC.or(a, b); return { y: 1 - r.y, da: -r.da, db: -r.db } },
  xnor: (a, b) => { const r = LOGIC.xor(a, b); return { y: 1 - r.y, da: -r.da, db: -r.db } },
  not: (a) => ({ y: 1 - a, da: -1, db: 0 }),
}

/** A behavioural source's output voltage and its derivatives wrt each input (nodes[1…]). */
export function evalBehaviour(fn: Behaviour, vin: number[]): BEval {
  if (fn.type === 'gate') {
    const w = fn.vdd * 0.05
    const th = fn.vdd / 2
    const s = (x: number) => 0.5 * (1 + Math.tanh((x - th) / w))
    const ds = (x: number) => (0.5 / w) * (1 - Math.tanh((x - th) / w) ** 2)
    const a = vin[0] ?? 0
    const b = vin[1] ?? 0
    const r = LOGIC[fn.gate](s(a), s(b))
    return { f: fn.vdd * r.y, df: [fn.vdd * r.da * ds(a), fn.vdd * r.db * ds(b)] }
  }
  // op-amp: out = clamp(A·(v+ − v−), lo, hi) with soft knees; inputs [v+, v−, vsp, vsn]
  const vd = (vin[0] ?? 0) - (vin[1] ?? 0)
  const hi = fn.supply ? vin[2] ?? fn.rail : fn.rail
  const lo = fn.supply ? vin[3] ?? -fn.rail : -fn.rail
  const span = Math.max(hi - lo, 1e-3)
  const eps = 2e-4 * span
  const y = fn.gain * vd
  const z = smax(lo, y, eps) // max(lo, y)
  // min(hi, z) = −max(−hi, −z)
  const o = smax(-hi, -z.f, eps)
  const out = -o.f
  // d out/d hi = o.da (through −hi) ; d out/d z = o.db ; d z/d y = z.db ; d z/d lo = z.da
  const dY = o.db * z.db * fn.gain
  const df = [dY, -dY]
  if (fn.supply) {
    df.push(o.da) // vsp
    df.push(o.db * z.da) // vsn
  }
  return { f: out, df }
}
