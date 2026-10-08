// The kinetics simulator's model: a small text syntax for reaction networks (elementary steps with rate
// constants or Arrhenius parameters, reversible steps, catalysts, fixed species), the mass-action ODEs with an
// analytic Jacobian, simulation and a few analyses. Pure functions.
//
//   T = 298.15                  temperature in K (or "T = 25 C"); only needed with Arrhenius parameters
//   [A]0 = 1.0                  initial concentration (also "A = 1.0" or "init A = 1.0")
//   fixed B = 3                 a species held at a constant concentration (a reservoir)
//   A -> B ; k = 0.1            irreversible step
//   A + B <=> C ; kf = 2, kr = 0.5     reversible (or  kf = 2, K = 4)
//   2 A -> B ; A = 1e8, Ea = 50        Arrhenius, Ea in kJ/mol (Af/Eaf/Ar/Ear for reversible steps)
//   0 -> A ; k = 0.01           zero-order source
//   # comment

import { R_J, R_KJ } from './constants.ts'
import { linreg } from './fit.ts'
import { solveOde, type OdeMethod, type OdeSystem, type Solution } from './ode.ts'

export { R_J, R_KJ }

export interface Term {
  /** Species index. */
  i: number
  /** Stoichiometric coefficient. */
  n: number
}

export interface Step {
  /** The step as written (without parameters). */
  text: string
  reactants: Term[]
  products: Term[]
  reversible: boolean
  kf: number
  kr: number
  /** How the constants were given. */
  how: string
  /** The parameters as written ("k = 0.1"). */
  params: string
  line: number
}

export interface Network {
  species: string[]
  init: number[]
  fixed: boolean[]
  T: number | null
  steps: Step[]
}

export interface ParseResult {
  network: Network | null
  errors: string[]
  warnings: string[]
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

function num(text: string, what: string): number {
  const t = text.trim().replace(/,/g, '.').replace(/×10\^?/, 'e').replace(/\s+/g, '')
  if (!NUM.test(t)) throw new Error(`${what}: "${text.trim()}" is not a number.`)
  return Number(t)
}

const NAME = /^[A-Za-z_][A-Za-z0-9_*'’]*$/

function parseSide(text: string, index: (name: string) => number): Term[] {
  const t = text.trim()
  if (t === '' || t === '0' || t === '∅' || t === '{}') return []
  const out: Term[] = []
  for (const raw of t.split(/\s*\+\s*/)) {
    const m = /^(\d+(?:\.\d+)?)?\s*([A-Za-z_][A-Za-z0-9_*'’]*)$/.exec(raw.trim())
    if (!m || !NAME.test(m[2])) throw new Error(`"${raw.trim()}" is not a species (use names like A, B2, ES, A*).`)
    const i = index(m[2])
    const n = m[1] ? Number(m[1]) : 1
    const hit = out.find((x) => x.i === i)
    if (hit) hit.n += n
    else out.push({ i, n })
  }
  return out
}

/** Reads a network in the text syntax above. Errors name the line; the network is null when there is any. */
export function parseNetwork(text: string): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const species: string[] = []
  const init = new Map<string, number>()
  const fixedSet = new Set<string>()
  let T: number | null = null
  const index = (name: string): number => {
    let i = species.indexOf(name)
    if (i < 0) {
      species.push(name)
      i = species.length - 1
    }
    return i
  }
  const pending: { text: string; left: string; right: string; arrow: string; params: string; line: number }[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, ln) => {
    const line = ln + 1
    const l = raw.replace(/#.*$/, '').replace(/\/\/.*$/, '').trim()
    if (l === '') return
    try {
      const arrow = /(<=>|<->|⇌|⇄|->|→|=>)/.exec(l.split(';')[0])
      if (arrow) {
        const [eqn, ...rest] = l.split(';')
        const idx = eqn.indexOf(arrow[1])
        pending.push({ text: eqn.trim(), left: eqn.slice(0, idx), right: eqn.slice(idx + arrow[1].length), arrow: arrow[1], params: rest.join(';'), line })
        return
      }
      let m = /^T\s*=\s*(.+?)\s*(K|C|°C)?$/i.exec(l)
      if (m) {
        const v = num(m[1], 'T')
        T = m[2] && /c/i.test(m[2]) ? v + 273.15 : v
        if (!(T > 0)) throw new Error('T must be above 0 K.')
        return
      }
      m = /^fixed\s+(\S+?)(?:\s*=\s*(.+))?$/i.exec(l)
      if (m) {
        if (!NAME.test(m[1])) throw new Error(`"${m[1]}" is not a species name.`)
        fixedSet.add(m[1])
        if (m[2] !== undefined) init.set(m[1], num(m[2], `[${m[1]}]`))
        index(m[1])
        return
      }
      m = /^(?:init\s+)?\[?\s*([A-Za-z_][A-Za-z0-9_*'’]*)\s*\]?\s*(?:0|\(0\))?\s*=\s*(.+)$/i.exec(l)
      if (m) {
        const v = num(m[2], `[${m[1]}]`)
        if (v < 0) throw new Error(`The concentration of ${m[1]} cannot be negative.`)
        init.set(m[1], v)
        index(m[1])
        return
      }
      throw new Error(`I do not understand "${l}". Write a step like  A + B -> C ; k = 0.1  or an initial value like  A = 1.`)
    } catch (e) {
      errors.push(`Line ${line}: ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  const steps: Step[] = []
  for (const p of pending) {
    try {
      const reactants = parseSide(p.left, index)
      const products = parseSide(p.right, index)
      if (reactants.length === 0 && products.length === 0) throw new Error('A step needs at least one species.')
      const reversible = /<|⇌|⇄/.test(p.arrow)
      const kv = new Map<string, number>()
      for (const part of p.params.split(',')) {
        if (part.trim() === '') continue
        const m = /^\s*([A-Za-z]+)\s*=\s*(.+?)\s*$/.exec(part)
        if (!m) throw new Error(`"${part.trim()}" is not a parameter (write k = 0.1 or A = 1e8, Ea = 50).`)
        kv.set(m[1], num(m[2], m[1]))
      }
      const known = new Set(['k', 'kf', 'kr', 'K', 'A', 'Ea', 'Af', 'Eaf', 'Ar', 'Ear'])
      for (const key of kv.keys()) if (!known.has(key)) throw new Error(`Unknown parameter "${key}".`)
      const arr = (a: string, e: string): number | null => {
        if (!kv.has(a) && !kv.has(e)) return null
        if (!kv.has(a) || !kv.has(e)) throw new Error(`Arrhenius needs both ${a} and ${e}.`)
        if (T === null) throw new Error(`${a}/${e} need a temperature: add a line  T = 298.15`)
        return kv.get(a)! * Math.exp(-kv.get(e)! / (R_KJ * T))
      }
      let kf: number | null
      let kr = 0
      let how = ''
      if (!reversible) {
        kf = kv.has('k') ? kv.get('k')! : kv.has('kf') ? kv.get('kf')! : null
        let viaA = false
        if (kf === null) {
          kf = arr('A', 'Ea') ?? arr('Af', 'Eaf')
          viaA = kf !== null
        }
        if (kf === null) throw new Error('No rate constant: add  ; k = …  (or A = …, Ea = …).')
        how = viaA ? `Arrhenius, k = ${fmtK(kf)}` : `k = ${fmtK(kf)}`
      } else {
        kf = kv.has('kf') ? kv.get('kf')! : kv.has('k') ? kv.get('k')! : arr('Af', 'Eaf') ?? arr('A', 'Ea')
        if (kf === null) throw new Error('No forward rate constant: add  ; kf = …, kr = …')
        const k2 = kv.has('kr') ? kv.get('kr')! : arr('Ar', 'Ear')
        if (k2 !== null) kr = k2
        else if (kv.has('K')) {
          if (!(kv.get('K')! > 0)) throw new Error('K must be above zero.')
          kr = kf / kv.get('K')!
        } else throw new Error('No reverse rate constant: add kr = … (or K = …).')
        how = `kf = ${fmtK(kf)}, kr = ${fmtK(kr)}, K = ${fmtK(kf / kr)}`
      }
      if (!(kf >= 0) || !(kr >= 0)) throw new Error('Rate constants cannot be negative.')
      steps.push({ text: p.text, reactants, products, reversible, kf, kr, how, params: p.params.trim(), line: p.line })
    } catch (e) {
      errors.push(`Line ${p.line}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  for (const name of init.keys()) if (!species.includes(name)) species.push(name)
  for (const f of fixedSet) if (!species.includes(f)) errors.push(`fixed ${f}: unknown species.`)
  if (steps.length === 0 && errors.length === 0) errors.push('Add at least one reaction step, e.g.  A -> B ; k = 0.1')
  if (errors.length) return { network: null, errors, warnings }
  const used = new Set<number>()
  for (const s of steps) [...s.reactants, ...s.products].forEach((t) => used.add(t.i))
  species.forEach((name, i) => {
    if (!used.has(i)) warnings.push(`${name} takes part in no step.`)
  })
  return {
    network: { species, init: species.map((s) => init.get(s) ?? 0), fixed: species.map((s) => fixedSet.has(s)), T, steps },
    errors,
    warnings,
  }
}

export function fmtK(x: number): string {
  if (x === 0) return '0'
  const a = Math.abs(x)
  return a >= 1e4 || a < 1e-3 ? x.toExponential(3).replace(/\.?0+e/, 'e').replace('e+', 'e') : String(Number(x.toPrecision(4)))
}

// ------------------------------------------------------------------ the ODEs

/** Mass-action rates of the network: dc/dt and the Jacobian (rows of fixed species are zero). */
export function networkSystem(net: Network): OdeSystem {
  const n = net.species.length
  const rate = (terms: Term[], c: ArrayLike<number>): number => {
    let r = 1
    for (const t of terms) r *= Math.pow(Math.max(c[t.i], 0), t.n)
    return r
  }
  const dRate = (terms: Term[], c: ArrayLike<number>, j: number): number => {
    const tj = terms.find((t) => t.i === j)
    if (!tj) return 0
    let r = tj.n * Math.pow(Math.max(c[j], 0), tj.n - 1)
    for (const t of terms) if (t.i !== j) r *= Math.pow(Math.max(c[t.i], 0), t.n)
    return r
  }
  return {
    n,
    f(_t, c, out) {
      for (let i = 0; i < n; i++) out[i] = 0
      for (const s of net.steps) {
        const r = s.kf * rate(s.reactants, c) - (s.reversible ? s.kr * rate(s.products, c) : 0)
        for (const t of s.reactants) out[t.i] -= t.n * r
        for (const t of s.products) out[t.i] += t.n * r
      }
      net.fixed.forEach((f, i) => {
        if (f) out[i] = 0
      })
    },
    jac(_t, c, J) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) J[i][j] = 0
      for (const s of net.steps) {
        const involved = new Set([...s.reactants, ...s.products].map((t) => t.i))
        for (const j of involved) {
          const dr = s.kf * dRate(s.reactants, c, j) - (s.reversible ? s.kr * dRate(s.products, c, j) : 0)
          if (dr === 0) continue
          for (const t of s.reactants) J[t.i][j] -= t.n * dr
          for (const t of s.products) J[t.i][j] += t.n * dr
        }
      }
      net.fixed.forEach((f, i) => {
        if (f) for (let j = 0; j < n; j++) J[i][j] = 0
      })
    },
  }
}

export interface SimOptions {
  tEnd: number
  points?: number
  logTime?: boolean
  method?: OdeMethod
  rtol?: number
}

export interface Simulation {
  species: string[]
  t: number[]
  /** c[k][i] */
  c: number[][]
  method: Solution['method']
  steps: number
  ok: boolean
  message?: string
}

/** Output times: linear from 0, or geometric from tEnd·1e-5 (with t = 0 first). */
export function timeGrid(tEnd: number, points: number, log: boolean): number[] {
  const n = Math.max(2, Math.round(points))
  const out = [0]
  if (log) {
    const lo = tEnd * 1e-5
    for (let k = 0; k < n; k++) out.push(lo * Math.pow(tEnd / lo, k / (n - 1)))
  } else for (let k = 1; k <= n; k++) out.push((tEnd * k) / n)
  return out
}

export function simulate(net: Network, o: SimOptions): Simulation {
  if (!(o.tEnd > 0)) return { species: net.species, t: [0], c: [net.init.slice()], method: 'rk45', steps: 0, ok: false, message: 'The end time must be above zero.' }
  const times = timeGrid(o.tEnd, o.points ?? 300, o.logTime ?? false)
  const sol = solveOde(networkSystem(net), net.init, { times, method: o.method ?? 'auto', rtol: o.rtol ?? 1e-8 })
  const c = sol.y.map((row) => row.map((v) => (v < 0 && v > -1e-9 ? 0 : v)))
  return { species: net.species, t: sol.t, c, method: sol.method, steps: sol.steps, ok: sol.ok, message: sol.message }
}

// ------------------------------------------------------------------ analysis of a run

export interface SpeciesSummary {
  name: string
  initial: number
  final: number
  max: number
  tMax: number
  /** First time the concentration falls to half of its initial value (consumed species only), or null. */
  tHalf: number | null
}

function crossing(t: number[], y: number[], level: number): number | null {
  for (let k = 1; k < y.length; k++) {
    if ((y[k - 1] - level) * (y[k] - level) <= 0 && y[k - 1] !== y[k]) {
      return t[k - 1] + ((level - y[k - 1]) / (y[k] - y[k - 1])) * (t[k] - t[k - 1])
    }
  }
  return null
}

export function summarise(sim: Simulation): SpeciesSummary[] {
  return sim.species.map((name, i) => {
    const y = sim.c.map((row) => row[i])
    let max = y[0]
    let tMax = sim.t[0]
    y.forEach((v, k) => {
      if (v > max) {
        max = v
        tMax = sim.t[k]
      }
    })
    const initial = y[0]
    const tHalf = initial > 0 && y[y.length - 1] < initial / 2 ? crossing(sim.t, y, initial / 2) : null
    return { name, initial, final: y[y.length - 1], max, tMax, tHalf }
  })
}

// ------------------------------------------------------------------ analytic results (for checks and notes)

/** First order: c(t) = c0 exp(−k t). */
export const firstOrder = (c0: number, k: number, t: number) => c0 * Math.exp(-k * t)
/** Time of the maximum of B in A → B → C, and its height. */
export function consecutiveMax(k1: number, k2: number, a0 = 1): { t: number; b: number } {
  if (Math.abs(k1 - k2) < 1e-12 * Math.max(k1, k2)) return { t: 1 / k1, b: a0 / Math.E }
  return { t: Math.log(k1 / k2) / (k1 - k2), b: a0 * Math.pow(k1 / k2, k2 / (k2 - k1)) }
}
/** Concentration of B in A → B → C. */
export function consecutiveB(k1: number, k2: number, a0: number, t: number): number {
  if (Math.abs(k1 - k2) < 1e-12 * Math.max(k1, k2)) return a0 * k1 * t * Math.exp(-k1 * t)
  return (a0 * k1 / (k2 - k1)) * (Math.exp(-k1 * t) - Math.exp(-k2 * t))
}

// ------------------------------------------------------------------ Michaelis–Menten and Lineweaver–Burk

export interface MmParams {
  k1: number
  km1: number
  kcat: number
  e0: number
  s0: number[]
}

export interface MmPoint {
  s0: number
  v: number
  /** Michaelis–Menten with the true constants, for comparison. */
  vTheory: number
}

export interface MmResult {
  km: number
  vmax: number
  points: MmPoint[]
  /** Lineweaver–Burk fit of the simulated velocities: 1/v = (Km/Vmax)(1/S) + 1/Vmax. */
  lb: { vmax: number; km: number; r2: number }
}

/**
 * Initial velocities of E + S ⇌ ES → E + P at several substrate concentrations, then Lineweaver–Burk. The
 * substrate is held constant (initial-rate conditions), so v₀ = kcat·[ES] once the fast transient has died away.
 */
export function michaelisMenten(p: MmParams): MmResult {
  const km = (p.km1 + p.kcat) / p.k1
  const vmax = p.kcat * p.e0
  const points: MmPoint[] = p.s0.map((s0) => {
    const lambda = p.k1 * s0 + p.km1 + p.kcat
    const net = parseNetwork(
      `E = ${p.e0}\nfixed S = ${s0}\nE + S <=> ES ; kf = ${p.k1}, kr = ${p.km1}\nES -> E + P ; k = ${p.kcat}`,
    ).network as Network
    const sim = simulate(net, { tEnd: 14 / lambda, points: 40, method: 'rk45' })
    const es = sim.c[sim.c.length - 1][net.species.indexOf('ES')]
    return { s0, v: p.kcat * es, vTheory: (vmax * s0) / (km + s0) }
  })
  const fit = linreg(points.map((q) => 1 / q.s0), points.map((q) => 1 / q.v))
  const vmaxLb = 1 / fit.intercept
  return { km, vmax, points, lb: { vmax: vmaxLb, km: fit.slope * vmaxLb, r2: fit.r2 } }
}

// ------------------------------------------------------------------ presets

export interface Preset {
  id: string
  name: string
  text: string
  tEnd: number
  logTime: boolean
  note: string
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'first-order', name: 'A → B (first order)', tEnd: 100, logTime: false,
    text: 'A = 1\nB = 0\nA -> B ; k = 0.05',
    note: '[A] = [A]0·e^(−kt); half-life t½ = ln 2 / k = 13.9. A plot of ln[A] against t is a straight line of slope −k.',
  },
  {
    id: 'second-order', name: '2A → B (second order)', tEnd: 20, logTime: false,
    text: 'A = 1\nB = 0\n2 A -> B ; k = 0.5',
    note: 'The rate of the step is k[A]², so d[A]/dt = −2k[A]² and 1/[A] = 1/[A]0 + 2kt. The half-life is 1/(2k[A]0) and grows as the reaction slows.',
  },
  {
    id: 'reversible', name: 'A ⇌ B (approach to equilibrium)', tEnd: 20, logTime: false,
    text: 'A = 1\nB = 0\nA <=> B ; kf = 0.3, kr = 0.1',
    note: 'Both concentrations relax with rate kf + kr = 0.4 to the equilibrium ratio [B]/[A] = kf/kr = K = 3 (so [B] → 0.75).',
  },
  {
    id: 'consecutive', name: 'A → B → C (consecutive)', tEnd: 20, logTime: false,
    text: 'A = 1\nB = 0\nC = 0\nA -> B ; k = 0.5\nB -> C ; k = 0.2',
    note: 'The intermediate B peaks at t = ln(k1/k2)/(k1 − k2) = 3.05 with [B]max = [A]0 (k1/k2)^(k2/(k2−k1)) = 0.545; C appears with an induction period.',
  },
  {
    id: 'parallel', name: 'A → B and A → C (parallel)', tEnd: 30, logTime: false,
    text: 'A = 1\nB = 0\nC = 0\nA -> B ; k = 0.3\nA -> C ; k = 0.1',
    note: 'A decays with kA = k1 + k2 = 0.4. The products keep the fixed ratio [B]/[C] = k1/k2 = 3 all the time (kinetic control), ending at 0.75 and 0.25.',
  },
  {
    id: 'michaelis-menten', name: 'Michaelis–Menten enzyme', tEnd: 60, logTime: false,
    text: 'E = 0.1\nS = 2\nES = 0\nP = 0\nE + S <=> ES ; kf = 10, kr = 1\nES -> E + P ; k = 2',
    note: 'KM = (k−1 + kcat)/k1 = 0.3 and Vmax = kcat[E]0 = 0.2. After a very fast transient the enzyme sits in a steady state and P grows almost linearly until the substrate runs low. Use "Lineweaver–Burk" below for the initial-velocity analysis.',
  },
  {
    id: 'autocatalysis', name: 'Autocatalysis A + B → 2B', tEnd: 40, logTime: false,
    text: 'A = 1\nB = 0.01\nA + B -> 2 B ; k = 0.5',
    note: 'The product catalyses its own formation: a slow start, a rapid S-shaped rise, then saturation as A is used up. The rate is greatest when [A] = [B].',
  },
  {
    id: 'pre-equilibrium', name: 'Pre-equilibrium A + B ⇌ I → P', tEnd: 200, logTime: true,
    text: 'A = 1\nB = 1\nA + B <=> I ; kf = 100, kr = 50\nI -> P ; k = 0.05',
    note: 'The fast first step stays near equilibrium, [I] = K[A][B] with K = 2, so the overall rate is k2·K·[A][B] = 0.1·[A][B]: second order overall. The log-time axis shows both time scales.',
  },
  {
    id: 'lindemann', name: 'Lindemann unimolecular mechanism', tEnd: 1000, logTime: true,
    text: 'fixed M = 1\nA = 1\nA* = 0\nP = 0\nA + M -> A* + M ; k = 0.01\nA* + M -> A + M ; k = 1\nA* -> P ; k = 0.1',
    note: 'Collisional activation A + M → A*, deactivation, and unimolecular reaction A* → P. At high [M] the rate is first order with kuni = k1k2/k−1 = 0.001; at low [M] every activation leads to reaction and the rate becomes k1[M][A] (second order overall). Change the value of M to see the fall-off.',
  },
  {
    id: 'brusselator', name: 'Brusselator oscillator', tEnd: 60, logTime: false,
    text: 'fixed A = 1\nfixed B = 3\nX = 1\nY = 1\nD = 0\nE = 0\nA -> X ; k = 1\n2 X + Y -> 3 X ; k = 1\nB + X -> Y + D ; k = 1\nX -> E ; k = 1',
    note: 'A model with sustained oscillations when B > 1 + A² (here 3 > 2). X and Y chase each other round a limit cycle: autocatalysis (2X + Y → 3X) with negative feedback.',
  },
  {
    id: 'sir', name: 'Epidemic analogue S + I → 2I → R', tEnd: 120, logTime: false,
    text: 'S = 0.99\nI = 0.01\nR = 0\nS + I -> 2 I ; k = 0.3\nI -> R ; k = 0.1',
    note: 'A chemical analogue of the SIR model: infection is autocatalytic, recovery is first order. The basic reproduction number R0 = k1[S]0/k2 = 2.97 is above 1, so an epidemic peak occurs.',
  },
  {
    id: 'robertson', name: 'Robertson problem (stiff)', tEnd: 4e5, logTime: true,
    text: 'A = 1\nB = 0\nC = 0\nA -> B ; k = 0.04\n2 B -> B + C ; k = 3e7\nB + C -> A + C ; k = 1e4',
    note: 'The classical stiff test: rate constants differ by nine orders of magnitude. An explicit method needs a vast number of tiny steps; the stiff solver takes a few hundred. Use the log-time axis.',
  },
]

export function findPreset(id: string): Preset | null {
  return PRESETS.find((p) => p.id === id) ?? null
}

// ------------------------------------------------------------------ from a reaction to a network

/** A species name the network syntax accepts ("C2H6O", "NO2", "O4S2−" → "O4S2"). */
export function networkName(label: string, taken: string[]): string {
  let n = label.replace(/[^A-Za-z0-9_*']/g, '')
  if (!/^[A-Za-z_]/.test(n)) n = `S${n}`
  let out = n
  let k = 2
  while (taken.includes(out)) out = `${n}_${k++}`
  return out
}

/**
 * The balanced reaction as a (stoichiometric, not elementary) kinetic model: initial concentrations of 1 for the
 * reactants and a rate constant to edit.
 */
export function reactionToNetwork(reactants: { label: string; coeff: number }[], products: { label: string; coeff: number }[], reversible: boolean): string {
  const taken: string[] = []
  const name = (l: string) => {
    const n = networkName(l, taken)
    taken.push(n)
    return n
  }
  const R = reactants.map((s) => ({ n: name(s.label), c: s.coeff }))
  const P = products.map((s) => ({ n: name(s.label), c: s.coeff }))
  const term = (x: { n: string; c: number }) => (x.c === 1 ? x.n : `${x.c} ${x.n}`)
  const lines = ['# stoichiometric equation used as one step (not a real mechanism)']
  for (const r of R) lines.push(`${r.n} = 1`)
  for (const p of P) lines.push(`${p.n} = 0`)
  lines.push(`${R.map(term).join(' + ')} ${reversible ? '<=>' : '->'} ${P.map(term).join(' + ')} ; ${reversible ? 'kf = 0.1, kr = 0.02' : 'k = 0.1'}`)
  return lines.join('\n')
}

// ------------------------------------------------------------------ the form view of a network

export interface FormSpecies {
  name: string
  init: string
  fixed: boolean
}

export interface FormStep {
  /** "A + B <=> C" */
  eq: string
  /** "kf = 2, kr = 0.5" */
  params: string
}

export interface NetworkForm {
  T: string
  species: FormSpecies[]
  steps: FormStep[]
}

const fmtNum = (x: number) => (x === 0 ? '0' : String(Number(x.toPrecision(10))))

/** A parsed network as form rows (comments of the text are lost). */
export function networkToForm(net: Network): NetworkForm {
  return {
    T: net.T === null ? '' : String(net.T),
    species: net.species.map((name, i) => ({ name, init: fmtNum(net.init[i]), fixed: net.fixed[i] })),
    steps: net.steps.map((s) => ({ eq: s.text, params: s.params })),
  }
}

/** The form rows as text in the network syntax. */
export function formToText(f: NetworkForm): string {
  const lines: string[] = []
  if (f.T.trim() !== '') lines.push(`T = ${f.T.trim()}`)
  for (const s of f.species) {
    const name = s.name.trim()
    if (name === '') continue
    if (s.fixed) lines.push(`fixed ${name} = ${s.init.trim() || '0'}`)
    else lines.push(`${name} = ${s.init.trim() || '0'}`)
  }
  for (const st of f.steps) {
    if (st.eq.trim() === '') continue
    lines.push(st.params.trim() === '' ? st.eq.trim() : `${st.eq.trim()} ; ${st.params.trim()}`)
  }
  return lines.join('\n')
}

export interface RateFields {
  /** Rate constants given directly, or as Arrhenius parameters. */
  arrhenius: boolean
  k: string
  kr: string
  A: string
  Ea: string
  Ar: string
  Ear: string
}

/** Reads "kf = 2, kr = 0.5" / "A = 1e8, Ea = 50" into form fields. */
export function readRateFields(params: string): RateFields {
  const kv = new Map<string, string>()
  for (const part of params.split(',')) {
    const m = /^\s*([A-Za-z]+)\s*=\s*(.+?)\s*$/.exec(part)
    if (m) kv.set(m[1], m[2])
  }
  const arrhenius = kv.has('A') || kv.has('Af') || kv.has('Ea') || kv.has('Eaf')
  return {
    arrhenius,
    k: kv.get('k') ?? kv.get('kf') ?? '',
    kr: kv.get('kr') ?? (kv.has('K') ? `K=${kv.get('K')}` : ''),
    A: kv.get('A') ?? kv.get('Af') ?? '',
    Ea: kv.get('Ea') ?? kv.get('Eaf') ?? '',
    Ar: kv.get('Ar') ?? '',
    Ear: kv.get('Ear') ?? '',
  }
}

/** Writes form fields back as parameters. */
export function writeRateFields(f: RateFields, reversible: boolean): string {
  const out: string[] = []
  if (f.arrhenius) {
    if (f.A) out.push(`${reversible ? 'Af' : 'A'} = ${f.A}`)
    if (f.Ea) out.push(`${reversible ? 'Eaf' : 'Ea'} = ${f.Ea}`)
    if (reversible && f.Ar) out.push(`Ar = ${f.Ar}`)
    if (reversible && f.Ear) out.push(`Ear = ${f.Ear}`)
  } else {
    if (f.k) out.push(`${reversible ? 'kf' : 'k'} = ${f.k}`)
    if (reversible && f.kr) out.push(f.kr.startsWith('K=') ? f.kr.replace('K=', 'K = ') : `kr = ${f.kr}`)
  }
  return out.join(', ')
}
