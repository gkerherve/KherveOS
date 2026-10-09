// Finite-state machines: the model, the state table, state assignment (binary / Gray / one-hot), next-state and
// output equations by Quine–McCluskey, simulation of an input sequence, the sequence-detector generator, the
// geometry of the diagram, and the D-flip-flop implementation drawn as a schematic. Pure.

import { Builder } from './builder.ts'
import { and, format, not, or, parse, v as varNode, variables, type Node } from './expr.ts'
import { addLogic, connectTap, type LogicOutput } from './layout.ts'
import { snap, type Doc } from './model.ts'
import { minimize, sopNode, termNode, type Implicant } from './qmc.ts'
import type { Probe } from './wave.ts'

export interface FsmState {
  id: string
  name: string
  x: number
  y: number
  /** Moore outputs, one character per output ("101") */
  out: string
  initial?: boolean
}

export interface FsmTransition {
  id: string
  from: string
  to: string
  /** "" (always), an input pattern such as "1-0", or an expression such as "X & !Y" */
  cond: string
  /** Mealy outputs, one character per output */
  out: string
  /** curvature of the arrow, −1 … 1 (0 = straight) */
  bend: number
}

export type Encoding = 'binary' | 'gray' | 'onehot'

export interface Fsm {
  name: string
  type: 'moore' | 'mealy'
  inputs: string[]
  outputs: string[]
  states: FsmState[]
  transitions: FsmTransition[]
  encoding: Encoding
}

export const emptyFsm = (): Fsm => ({ name: 'Machine', type: 'moore', inputs: ['X'], outputs: ['Y'], states: [], transitions: [], encoding: 'binary' })

let counter = 0
export const fsmId = (p: string) => `${p}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

export const MAX_STATES = 16
export const MAX_FSM_INPUTS = 4

const zeros = (n: number) => '0'.repeat(n)

// ------------------------------------------------------------------------------ conditions

const PATTERN = /^[01xX\-]+$/

/** Does the condition hold for this input combination (bit k = input k, the first input is the MSB)? */
export function condHolds(cond: string, inputs: readonly string[], combo: number): boolean {
  const c = cond.trim()
  if (c === '' || c === '1' && inputs.length === 0) return true
  const n = inputs.length
  if (PATTERN.test(c) && c.length === n) {
    for (let k = 0; k < n; k++) {
      const ch = c[k]
      if (ch === '-' || ch === 'x' || ch === 'X') continue
      if (Number(ch) !== ((combo >> (n - 1 - k)) & 1)) return false
    }
    return true
  }
  const node = parse(c, { names: inputs })
  const env: Record<string, number> = {}
  inputs.forEach((name, k) => { env[name] = (combo >> (n - 1 - k)) & 1 })
  for (const name of variables(node)) if (!(name in env)) throw new Error(`The condition “${c}” uses ${name}, which is not an input.`)
  return evalCond(node, env)
}

function evalCond(node: Node, env: Record<string, number>): boolean {
  switch (node.t) {
    case 'const': return node.v === 1
    case 'var': return !!env[node.n]
    case 'not': return !evalCond(node.a, env)
    case 'and': return node.a.every((c) => evalCond(c, env))
    case 'or': return node.a.some((c) => evalCond(c, env))
    case 'nand': return !node.a.every((c) => evalCond(c, env))
    case 'nor': return !node.a.some((c) => evalCond(c, env))
    case 'xor': return node.a.reduce((s, c) => s ^ (evalCond(c, env) ? 1 : 0), 0) === 1
    case 'xnor': return node.a.reduce((s, c) => s ^ (evalCond(c, env) ? 1 : 0), 0) === 0
  }
}

/** A readable form of a condition for the diagram: "X=1", "1-0", "always". */
export function condLabel(t: FsmTransition, fsm: Fsm): string {
  const c = t.cond.trim()
  if (!c) return fsm.inputs.length ? '' : ''
  return c
}

/** The label drawn on a transition. */
export function transitionLabel(t: FsmTransition, fsm: Fsm): string {
  const cond = condLabel(t, fsm)
  if (fsm.type === 'mealy') return `${cond || '—'}/${t.out || zeros(fsm.outputs.length)}`
  return cond
}

export function checkCondition(cond: string, inputs: readonly string[]): string | null {
  try {
    for (let c = 0; c < 1 << inputs.length; c++) condHolds(cond, inputs, c)
    return null
  } catch (e) { return e instanceof Error ? e.message : String(e) }
}

// ------------------------------------------------------------------------------ the state table

export interface TableRow {
  state: string
  combo: number
  /** the input bits as text, "01" */
  inputBits: string
  next: string
  /** the output after this clock edge's decision: Mealy = of (state, input), Moore = of the current state */
  out: string
  /** transitions that matched (ids) */
  matched: string[]
}

export interface FsmAnalysis {
  table: TableRow[]
  warnings: string[]
  reachable: string[]
  unreachable: string[]
  initial: string | null
}

const outBits = (s: string, n: number): string => (s + zeros(n)).slice(0, n).replace(/[^01]/g, '0')

export function initialState(fsm: Fsm): FsmState | undefined {
  return fsm.states.find((s) => s.initial) ?? fsm.states[0]
}

export function analyseFsm(fsm: Fsm): FsmAnalysis {
  const warnings: string[] = []
  const n = fsm.inputs.length
  const names = new Set<string>()
  for (const s of fsm.states) {
    if (!s.name.trim()) warnings.push('A state has no name.')
    if (names.has(s.name)) warnings.push(`Two states are called ${s.name}.`)
    names.add(s.name)
  }
  if (n > MAX_FSM_INPUTS) warnings.push(`At most ${MAX_FSM_INPUTS} inputs are supported.`)
  if (fsm.states.length > MAX_STATES) warnings.push(`At most ${MAX_STATES} states are supported.`)
  const byId = new Map(fsm.states.map((s) => [s.id, s]))
  const table: TableRow[] = []
  const incomplete: string[] = []
  const conflicts: string[] = []
  for (const s of fsm.states) {
    const outgoing = fsm.transitions.filter((t) => t.from === s.id)
    for (let combo = 0; combo < 1 << Math.min(n, MAX_FSM_INPUTS); combo++) {
      const matched: FsmTransition[] = []
      for (const t of outgoing) {
        try { if (condHolds(t.cond, fsm.inputs, combo)) matched.push(t) } catch { /* reported below */ }
      }
      const inputBits = n === 0 ? '' : combo.toString(2).padStart(n, '0')
      if (matched.length === 0) incomplete.push(`${s.name}${n ? ` with ${fsm.inputs.map((x, k) => `${x}=${inputBits[k]}`).join(' ')}` : ''}`)
      if (matched.length > 1) conflicts.push(`${s.name}${n ? ` with ${fsm.inputs.map((x, k) => `${x}=${inputBits[k]}`).join(' ')}` : ''}`)
      const t = matched[0]
      const next = t ? byId.get(t.to)?.name ?? s.name : s.name
      const out = fsm.type === 'moore' ? outBits(s.out, fsm.outputs.length) : outBits(t?.out ?? '', fsm.outputs.length)
      table.push({ state: s.name, combo, inputBits, next, out, matched: matched.map((m) => m.id) })
    }
  }
  for (const t of fsm.transitions) {
    const err = checkCondition(t.cond, fsm.inputs)
    if (err) warnings.push(err)
    if (!byId.has(t.from) || !byId.has(t.to)) warnings.push('A transition is attached to a state that does not exist.')
  }
  if (incomplete.length) warnings.push(`Not every input is handled (the machine stays in its state): ${incomplete.slice(0, 4).join('; ')}${incomplete.length > 4 ? ` … (${incomplete.length} cases)` : ''}.`)
  if (conflicts.length) warnings.push(`Two transitions apply at once (the first one is used): ${conflicts.slice(0, 4).join('; ')}${conflicts.length > 4 ? ' …' : ''}.`)
  // reachability from the initial state
  const init = initialState(fsm)
  const reach = new Set<string>()
  if (init) {
    const queue = [init.id]
    reach.add(init.id)
    while (queue.length) {
      const id = queue.shift()!
      for (const t of fsm.transitions) if (t.from === id && !reach.has(t.to) && byId.has(t.to)) { reach.add(t.to); queue.push(t.to) }
    }
  } else warnings.push('There are no states yet.')
  const unreachable = fsm.states.filter((s) => !reach.has(s.id)).map((s) => s.name)
  if (unreachable.length) warnings.push(`Unreachable from the initial state: ${unreachable.join(', ')}.`)
  // outputs of Moore states
  if (fsm.type === 'moore') for (const s of fsm.states) if (s.out.length !== fsm.outputs.length && fsm.outputs.length) warnings.push(`State ${s.name} has ${s.out.length} output bits, expected ${fsm.outputs.length}.`)
  return {
    table, warnings, initial: init?.name ?? null,
    reachable: fsm.states.filter((s) => reach.has(s.id)).map((s) => s.name), unreachable,
  }
}

// ------------------------------------------------------------------------------ state assignment

export interface Assignment {
  /** the flip-flop outputs, most significant first: Q2 Q1 Q0 */
  bits: string[]
  /** state name → code (a string of bits in the order of `bits`) */
  codes: Record<string, string>
  /** the codes that no state uses (don't-cares) */
  unused: number[]
  onehot: boolean
}

const gray = (i: number) => i ^ (i >> 1)

export function assignStates(fsm: Fsm, encoding: Encoding = fsm.encoding): Assignment {
  const init = initialState(fsm)
  // the initial state gets the first code (the reset value)
  const ordered = init ? [init, ...fsm.states.filter((s) => s.id !== init.id)] : [...fsm.states]
  const n = ordered.length
  const codes: Record<string, string> = {}
  if (encoding === 'onehot') {
    const width = Math.max(1, n)
    ordered.forEach((s, i) => { codes[s.name] = '0'.repeat(width - 1 - i) + '1' + '0'.repeat(i) })
    return { bits: Array.from({ length: width }, (_, i) => `Q${width - 1 - i}`), codes, unused: [], onehot: true }
  }
  let width = 1
  while ((1 << width) < n) width++
  ordered.forEach((s, i) => { codes[s.name] = (encoding === 'gray' ? gray(i) : i).toString(2).padStart(width, '0') })
  const usedCodes = new Set(Object.values(codes).map((c) => parseInt(c, 2)))
  const unused: number[] = []
  for (let c = 0; c < 1 << width; c++) if (!usedCodes.has(c)) unused.push(c)
  return { bits: Array.from({ length: width }, (_, i) => `Q${width - 1 - i}`), codes, unused, onehot: false }
}

// ------------------------------------------------------------------------------ equations

export interface Equation {
  /** D2, D1, D0 for the flip-flops, then the outputs */
  name: string
  kind: 'next' | 'output'
  expr: Node
  text: string
  /** variables the expression is over, in table order */
  vars: string[]
  on: number[]
  dc: number[]
  /** the product terms of the chosen cover */
  cover: Implicant[]
}

export interface Equations {
  assignment: Assignment
  next: Equation[]
  outputs: Equation[]
  /** the inputs of the combinational logic */
  vars: string[]
}

const literal = (name: string, bit: string): Node => (bit === '1' ? varNode(name) : not(varNode(name)))

export function deriveEquations(fsm: Fsm, encoding: Encoding = fsm.encoding): Equations {
  const a = assignStates(fsm, encoding)
  const an = analyseFsm(fsm)
  const n = fsm.inputs.length
  const sb = a.bits.length
  const vars = [...a.bits, ...fsm.inputs]
  const next: Equation[] = []
  const outputs: Equation[] = []
  const codeOf = (name: string) => a.codes[name]

  if (a.onehot) {
    // D_i = OR over (state j, input combos going to i) of Q_j · cover(inputs)
    a.bits.forEach((_bitName, bi) => {
      const stateOfBit = Object.keys(a.codes).find((s) => a.codes[s][bi] === '1')
      const terms: Node[] = []
      const covers: Implicant[] = []
      for (const s of Object.keys(a.codes)) {
        const combos = an.table.filter((r) => r.state === s && r.next === stateOfBit).map((r) => r.combo)
        if (combos.length === 0) continue
        const qj = literal(a.bits[a.codes[s].indexOf('1')], '1')
        if (n === 0 || combos.length === 1 << n) terms.push(qj)
        else {
          const cover = minimize(n, combos).cover
          covers.push(...cover)
          const inner = sopNode(cover, fsm.inputs)
          terms.push(and(qj, inner))
        }
      }
      const expr: Node = terms.length === 0 ? { t: 'const', v: 0 } : terms.length === 1 ? terms[0] : or(...terms)
      next.push({ name: `D${a.bits.length - 1 - bi}`, kind: 'next', expr, text: format(expr), vars, on: [], dc: [], cover: covers })
    })
    fsm.outputs.forEach((name, oi) => {
      const parts: Node[] = []
      const covers: Implicant[] = []
      for (const s of fsm.states) {
        const qj = literal(a.bits[a.codes[s.name].indexOf('1')], '1')
        if (fsm.type === 'moore') { if (outBits(s.out, fsm.outputs.length)[oi] === '1') parts.push(qj) }
        else {
          const combos = an.table.filter((r) => r.state === s.name && r.out[oi] === '1').map((r) => r.combo)
          if (!combos.length) continue
          if (combos.length === 1 << n) parts.push(qj)
          else { const cover = minimize(n, combos).cover; covers.push(...cover); parts.push(and(qj, sopNode(cover, fsm.inputs))) }
        }
      }
      const expr: Node = parts.length === 0 ? { t: 'const', v: 0 } : parts.length === 1 ? parts[0] : or(...parts)
      outputs.push({ name, kind: 'output', expr, text: format(expr), vars, on: [], dc: [], cover: covers })
    })
    return { assignment: a, next, outputs, vars }
  }

  // binary / Gray: truth tables over (state bits, inputs), unused codes are don't-cares
  const rowsFor = (withInputs: boolean) => (1 << (sb + (withInputs ? n : 0)))
  const lookup = new Map<string, Map<number, { next: string; out: string }>>()
  for (const r of an.table) {
    if (!lookup.has(r.state)) lookup.set(r.state, new Map())
    lookup.get(r.state)!.set(r.combo, { next: r.next, out: r.out })
  }
  const stateByCode = new Map<number, string>()
  for (const [name, code] of Object.entries(a.codes)) stateByCode.set(parseInt(code, 2), name)
  a.bits.forEach((_, bi) => {
    const on: number[] = []
    const dc: number[] = []
    const total = rowsFor(true)
    for (let row = 0; row < total; row++) {
      const code = row >> n
      const combo = row & ((1 << n) - 1)
      const s = stateByCode.get(code)
      if (!s) { dc.push(row); continue }
      const to = lookup.get(s)?.get(combo)?.next ?? s
      if (codeOf(to)[bi] === '1') on.push(row)
    }
    const res = minimize(sb + n, on, dc)
    const expr = sopNode(res.cover, vars)
    next.push({ name: `D${sb - 1 - bi}`, kind: 'next', expr, text: format(expr), vars, on, dc, cover: res.cover })
  })
  const mealy = fsm.type === 'mealy' && n > 0
  fsm.outputs.forEach((name, oi) => {
    const on: number[] = []
    const dc: number[] = []
    const v = mealy ? vars : a.bits
    const total = mealy ? rowsFor(true) : rowsFor(false)
    for (let row = 0; row < total; row++) {
      const code = mealy ? row >> n : row
      const combo = mealy ? row & ((1 << n) - 1) : 0
      const s = stateByCode.get(code)
      if (!s) { dc.push(row); continue }
      const out = fsm.type === 'moore' ? outBits(fsm.states.find((q) => q.name === s)?.out ?? '', fsm.outputs.length) : lookup.get(s)?.get(combo)?.out ?? zeros(fsm.outputs.length)
      if (out[oi] === '1') on.push(row)
    }
    const res = minimize(v.length, on, dc)
    const expr = sopNode(res.cover, v)
    outputs.push({ name, kind: 'output', expr, text: format(expr), vars: v, on, dc, cover: res.cover })
  })
  return { assignment: a, next, outputs, vars }
}

export { termNode }

// ------------------------------------------------------------------------------ simulation

export interface TraceRow {
  step: number
  input: string
  state: string
  next: string
  out: string
}

/** Runs input vectors ("0", "1", "01"…; one per clock edge). The output column is what the machine shows while that input is applied. */
export function simulateFsm(fsm: Fsm, inputs: readonly (string | number)[]): TraceRow[] {
  const an = analyseFsm(fsm)
  const n = fsm.inputs.length
  const init = initialState(fsm)
  if (!init) return []
  let state = init.name
  const rows: TraceRow[] = []
  inputs.forEach((raw, step) => {
    const bits = typeof raw === 'number' ? raw.toString(2).padStart(n, '0') : String(raw).replace(/[^01]/g, '').padStart(n, '0').slice(-n || undefined)
    const combo = n === 0 ? 0 : parseInt(bits || '0', 2)
    const row = an.table.find((r) => r.state === state && r.combo === combo)
    const next = row?.next ?? state
    // Moore: the output belongs to the current state; Mealy: to (state, input)
    rows.push({ step, input: n === 0 ? '' : bits, state, next, out: row?.out ?? zeros(fsm.outputs.length) })
    state = next
  })
  return rows
}

/** The trace as a timing diagram (WaveJSON signal list). */
export function fsmWave(fsm: Fsm, trace: readonly TraceRow[]): { signal: { name: string; wave: string; data?: string[] }[]; config: { hscale: number } } {
  const cols = trace.length
  const signal: { name: string; wave: string; data?: string[] }[] = [{ name: 'clk', wave: 'p' + '.'.repeat(Math.max(0, cols - 1)) }]
  const bitWave = (get: (r: TraceRow) => string): string => {
    let prev = ''
    return trace.map((r) => { const c = get(r); const out = c === prev ? '.' : c; prev = c; return out }).join('')
  }
  fsm.inputs.forEach((name, k) => signal.push({ name, wave: bitWave((r) => r.input[k] ?? '0') }))
  let prev = ''
  const data: string[] = []
  const wave = trace.map((r) => { if (r.state === prev) return '.'; prev = r.state; data.push(r.state); return '=' }).join('')
  signal.push({ name: 'state', wave, data })
  fsm.outputs.forEach((name, k) => signal.push({ name, wave: bitWave((r) => r.out[k] ?? '0') }))
  return { signal, config: { hscale: 2 } }
}

// ------------------------------------------------------------------------------ sequence detector

export interface DetectorOptions {
  /** may the end of one match be the start of the next (1011011 → two matches)? */
  overlap: boolean
  type: 'mealy' | 'moore'
}

export function sequenceDetector(pattern: string, opt: DetectorOptions = { overlap: true, type: 'mealy' }): Fsm {
  const p = pattern.replace(/[^01]/g, '')
  if (p.length < 2 || p.length > 8) throw new Error('Give a pattern of 2 to 8 bits, e.g. 1011.')
  const L = p.length
  const mealy = opt.type === 'mealy'
  const nStates = mealy ? L : L + 1
  // state i = the last i bits seen are the first i bits of the pattern
  const step = (i: number, bit: string): { next: number; hit: boolean } => {
    const s = p.slice(0, i) + bit
    if (s === p) return { next: opt.overlap ? longestBorder(p) : 0, hit: true }
    for (let len = Math.min(s.length, L - 1); len > 0; len--) if (p.startsWith(s.slice(s.length - len))) return { next: len, hit: false }
    return { next: 0, hit: false }
  }
  const states: FsmState[] = []
  const R = 150
  const cx = 360, cy = 230
  for (let i = 0; i < nStates; i++) {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / nStates
    states.push({ id: `s${i}`, name: `S${i}`, x: snap(cx + R * 1.5 * Math.cos(ang)), y: snap(cy + R * Math.sin(ang)), out: mealy ? '' : i === L ? '1' : '0', ...(i === 0 ? { initial: true } : {}) })
  }
  const transitions: FsmTransition[] = []
  let k = 0
  for (let i = 0; i < nStates; i++) {
    for (const bit of ['0', '1']) {
      let next: number
      let hit = false
      if (mealy) ({ next, hit } = step(i, bit))
      else {
        // Moore: reaching the full match is a state of its own (S_L); from S_L continue as from the border
        if (i === L) { const from = opt.overlap ? longestBorder(p) : 0; next = step(from, bit).next; if (step(from, bit).hit) next = L }
        else { const r = step(i, bit); next = r.hit ? L : r.next }
      }
      transitions.push({ id: `t${k++}`, from: `s${i}`, to: `s${next}`, cond: bit, out: mealy ? (hit ? '1' : '0') : '', bend: next === i ? 0 : next < i ? 0.35 : 0 })
    }
  }
  return { name: `${p} detector`, type: opt.type, inputs: ['X'], outputs: ['Y'], states, transitions, encoding: 'binary' }
}

function longestBorder(p: string): number {
  for (let len = p.length - 1; len > 0; len--) if (p.slice(0, len) === p.slice(p.length - len)) return len
  return 0
}

/** Positions of the matches of a pattern in a bit string (index of the last bit), with or without overlap. */
export function patternMatches(bits: string, pattern: string, overlap: boolean): number[] {
  const out: number[] = []
  let i = 0
  while (i + pattern.length <= bits.length) {
    if (bits.startsWith(pattern, i)) { out.push(i + pattern.length - 1); i += overlap ? 1 : pattern.length } else i++
  }
  return out
}

// ------------------------------------------------------------------------------ diagram geometry

export const STATE_R = 30

export interface Arrow {
  d: string
  /** label position */
  lx: number
  ly: number
  /** arrow head: tip and direction */
  tip: { x: number; y: number }
  angle: number
}

/** The curve of a transition between two states (or a loop on one). `index` separates parallel arrows. */
export function transitionGeometry(from: FsmState, to: FsmState, bend: number, index = 0): Arrow {
  if (from.id === to.id) {
    const up = bend >= 0 ? -1 : 1
    const r = STATE_R
    const x = from.x, y = from.y
    const spread = 1 + index * 0.6
    const x1 = x - 14, x2 = x + 14
    const y0 = y + up * Math.sqrt(r * r - 14 * 14)
    const top = y + up * (r + 44 * spread)
    const d = `M${x1} ${y0} C${x - 42 * spread} ${top} ${x + 42 * spread} ${top} ${x2} ${y0}`
    return { d, lx: x, ly: y + up * (r + 36 * spread) + (up > 0 ? 14 : -4), tip: { x: x2, y: y0 }, angle: Math.atan2(y0 - (y + up * (r + 20 * spread)), x2 - (x + 20)) }
  }
  const dx = to.x - from.x, dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len, uy = dy / len
  const nx = -uy, ny = ux
  const b = bend + index * 0.18 * (bend >= 0 ? 1 : -1)
  const cx = (from.x + to.x) / 2 + nx * b * len * 0.6
  const cy = (from.y + to.y) / 2 + ny * b * len * 0.6
  // end points on the circles, along the first / last part of the curve
  const toward = (p: { x: number; y: number }, q: { x: number; y: number }, r: number) => {
    const ddx = q.x - p.x, ddy = q.y - p.y
    const l = Math.hypot(ddx, ddy) || 1
    return { x: p.x + (ddx / l) * r, y: p.y + (ddy / l) * r }
  }
  const s = toward(from, { x: cx, y: cy }, STATE_R)
  const e = toward(to, { x: cx, y: cy }, STATE_R + 2)
  const mx = 0.25 * s.x + 0.5 * cx + 0.25 * e.x
  const my = 0.25 * s.y + 0.5 * cy + 0.25 * e.y
  const lx = mx + nx * 12 * (b >= 0 ? 1 : -1) * (Math.abs(b) < 0.05 ? 1 : 1)
  const ly = my + ny * 12 * (b >= 0 ? 1 : -1)
  return { d: `M${s.x} ${s.y} Q${cx} ${cy} ${e.x} ${e.y}`, lx, ly, tip: e, angle: Math.atan2(e.y - cy, e.x - cx) }
}

/** Bounds of a diagram, for fitting the view. */
export function fsmBounds(fsm: Fsm): { x1: number; y1: number; x2: number; y2: number } {
  if (fsm.states.length === 0) return { x1: 0, y1: 0, x2: 600, y2: 400 }
  const xs = fsm.states.map((s) => s.x), ys = fsm.states.map((s) => s.y)
  return { x1: Math.min(...xs) - 90, y1: Math.min(...ys) - 110, x2: Math.max(...xs) + 90, y2: Math.max(...ys) + 90 }
}

// ------------------------------------------------------------------------------ implementation as a schematic

export interface FsmCircuit {
  doc: Doc
  builder: Builder
  probes: Probe[]
  equations: Equations
}

/** D flip-flops, next-state logic and output logic drawn into a schematic, with CLK and RST inputs. */
export function fsmToCircuit(fsm: Fsm, encoding: Encoding = fsm.encoding): FsmCircuit {
  const eq = deriveEquations(fsm, encoding)
  const a = eq.assignment
  const sb = a.bits.length
  const b = new Builder()
  const n = fsm.inputs.length
  const init = initialState(fsm)
  const initCode = init ? a.codes[init.name] : '0'.repeat(sb)
  // inputs on the left
  let y = 0
  const inputRefs: string[] = []
  fsm.inputs.forEach((name) => {
    const ref = b.add('switch', 0, y, { name })
    b.tie(`${ref}.Y`, name, 20)
    inputRefs.push(ref)
    y += 50
  })
  const clk = b.add('clock', 0, y, { name: 'CLK', period: '20' })
  b.tie(`${clk}.Y`, 'CLK', 20)
  y += 50
  const rst = b.add('button', 0, y, { name: 'RST' })
  b.tie(`${rst}.Y`, 'RST', 20)
  y += 70
  // logic: the next-state functions and the outputs
  const outs: LogicOutput[] = [
    ...eq.next.map((e) => ({ name: e.name, expr: e.expr })),
    ...eq.outputs.map((e) => ({ name: `out_${e.name}`, expr: e.expr })),
  ]
  const logic = addLogic(b, outs, { x0: 240, y0: 0, makeInputs: false })
  // flip-flops right of the logic
  const ffX = snap(logic.right + 120)
  const ffRefs: string[] = []
  a.bits.forEach((bit, k) => {
    const ref = b.add('dff', ffX, snap(k * 130 + 20), { name: bit, init: initCode[k], en: 'no' })
    ffRefs.push(ref)
    const dName = `D${sb - 1 - k}`
    connectTap(b, logic.taps[dName], `${ref}.D`)
    b.tie(`${ref}.CLK`, 'CLK', 20)
    if (initCode[k] === '1') b.tie(`${ref}.S`, 'RST', 20)
    else b.tie(`${ref}.R`, 'RST', 20)
    b.tie(`${ref}.Q`, bit, 20)
  })
  // outputs
  const ledX = snap(ffX + 200)
  fsm.outputs.forEach((name, k) => {
    const led = b.add('led', ledX, snap(k * 60), { name })
    connectTap(b, logic.taps[`out_${name}`], `${led}.A`)
  })
  const probeBits = a.bits.map((_, k) => `${ffRefs[k]}.Q`)
  const bp = b.add('probe', ledX, snap(Math.max(fsm.outputs.length, 1) * 60 + 80), { name: 'STATE', bits: String(sb), radix: 'binary' })
  probeBits.forEach((_t, k) => b.tie(`${bp}.B${sb - 1 - k}`, a.bits[k], 20))
  b.note(0, -50, `${fsm.name}: ${fsm.type === 'mealy' ? 'Mealy' : 'Moore'}, ${encoding} state assignment\n${a.bits.join('')} = ${fsm.states.map((s) => `${s.name}:${a.codes[s.name]}`).join('  ')}`)
  void n
  const probes: Probe[] = [
    { name: 'CLK', bits: [`${clk}.Y`] },
    ...fsm.inputs.map((name, k) => ({ name, bits: [`${inputRefs[k]}.Y`] })),
    { name: 'RST', bits: [`${rst}.Y`] },
    { name: 'state', bits: probeBits, radix: 'binary' as const },
    ...fsm.outputs.map((name) => ({ name, bits: [name] })),
  ]
  return { doc: b.build(), builder: b, probes, equations: eq }
}
