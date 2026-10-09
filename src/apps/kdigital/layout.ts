// Boolean expressions → gate-level schematics (auto-layout in columns by logic depth), and circuits → truth
// tables / expressions. Pure.

import { Builder } from './builder.ts'
import { and, format, gateStats, normalize, nand, nor, not, or, toNandOnly, toNorOnly, variables, xor, type Node } from './expr.ts'
import { snap, type Doc, type Kind } from './model.ts'
import { circuitTable, type SimSettings } from './sim.ts'
import { minimizeBoth } from './qmc.ts'
import type { Cell } from './truth.ts'

export type LogicStyle = 'as-is' | 'sop' | 'pos' | 'nand' | 'nor'

export interface LogicOutput { name: string; expr: Node }

/** Where a built output can be picked up. */
export type Tap = { pin: string } | { label: string } | { constant: 0 | 1 }

interface GateNode {
  key: string
  kind: Kind
  /** children: gate nodes or variable names */
  kids: ({ gate: GateNode } | { variable: string } | { constant: 0 | 1 })[]
  level: number
  ref?: string
  y?: number
  inputs: number
  tied: boolean
}

const GATE_KIND: Record<string, Kind> = { and: 'and', or: 'or', xor: 'xor', nand: 'nand', nor: 'nor', xnor: 'xnor' }

/** The expression in the form a style asks for. */
export function styled(node: Node, style: LogicStyle, vars: readonly string[] = variables(node)): Node {
  if (style === 'as-is') return normalize(node)
  const rows = 1 << vars.length
  const on: number[] = []
  for (let r = 0; r < rows; r++) {
    const env: Record<string, number> = {}
    vars.forEach((n, k) => { env[n] = (r >> (vars.length - 1 - k)) & 1 })
    if (evalNode(node, env)) on.push(r)
  }
  const m = minimizeBoth(vars, on)
  if (style === 'sop') return m.sopNode
  if (style === 'pos') return m.posNode
  // NAND-only / NOR-only: the better of the two-level form and a direct translation of the expression as written
  const direct = normalize(node)
  const pick = (a: Node, b: Node) => (gateStats(b).gates < gateStats(a).gates ? b : a)
  return style === 'nand' ? pick(toNandOnly(m.sopNode), toNandOnly(direct)) : pick(toNorOnly(m.posNode), toNorOnly(direct))
}

function evalNode(n: Node, env: Record<string, number>): boolean {
  switch (n.t) {
    case 'const': return n.v === 1
    case 'var': return !!env[n.n]
    case 'not': return !evalNode(n.a, env)
    case 'and': return n.a.every((c) => evalNode(c, env))
    case 'or': return n.a.some((c) => evalNode(c, env))
    case 'nand': return !n.a.every((c) => evalNode(c, env))
    case 'nor': return !n.a.some((c) => evalNode(c, env))
    case 'xor': return n.a.reduce((s, c) => s ^ (evalNode(c, env) ? 1 : 0), 0) === 1
    case 'xnor': return n.a.reduce((s, c) => s ^ (evalNode(c, env) ? 1 : 0), 0) === 0
  }
}

export interface LogicOptions {
  x0: number
  y0: number
  /** make a switch for every variable (and a net label on its output); otherwise the labels are expected from elsewhere */
  makeInputs: boolean
  columnWidth?: number
  /** names of the variables to make inputs for even when unused */
  vars?: readonly string[]
}

export interface LogicResult {
  taps: Record<string, Tap>
  /** right edge and bottom of what was drawn */
  right: number
  bottom: number
  gates: number
  counts: Record<string, number>
}

/**
 * Draws the gates of several expressions into a builder. Identical sub-expressions are built once. Variables
 * reach the gates through net labels with the variable's name.
 */
export function addLogic(b: Builder, outputs: readonly LogicOutput[], opt: LogicOptions): LogicResult {
  const colW = opt.columnWidth ?? 170
  const table = new Map<string, GateNode>()
  const order: GateNode[] = []
  const counts: Record<string, number> = {}

  const make = (n: Node): { gate: GateNode } | { variable: string } | { constant: 0 | 1 } => {
    if (n.t === 'var') return { variable: n.n }
    if (n.t === 'const') return { constant: n.v }
    const key = format(n, 'bang') + '#' + n.t + (n.t === 'nand' || n.t === 'nor' ? n.a.length : '')
    const have = table.get(key)
    if (have) return { gate: have }
    let kind: Kind
    let kids: GateNode['kids']
    if (n.t === 'not') { kind = 'not'; kids = [make(n.a)] }
    else if ((n.t === 'nand' || n.t === 'nor') && n.a.length === 1) { kind = n.t; kids = [make(n.a[0]), make(n.a[0])] } // an inverter made of a two-input gate
    else {
      kind = GATE_KIND[n.t]
      let list = n.a
      // more than eight inputs: a tree of gates
      if (list.length > 8) {
        const base: Node['t'] = n.t === 'nand' ? 'and' : n.t === 'nor' ? 'or' : n.t === 'xnor' ? 'xor' : n.t
        const chunk = (l: Node[]): Node[] => (l.length <= 8 ? l : chunk(Array.from({ length: Math.ceil(l.length / 8) }, (_, i) => ({ t: base, a: l.slice(i * 8, i * 8 + 8) }) as Node)))
        list = chunk(list)
      }
      kids = list.map(make)
    }
    const level = 1 + Math.max(0, ...kids.map((k) => ('gate' in k ? k.gate.level : 0)))
    const g: GateNode = { key, kind, kids, level, inputs: Math.max(2, kids.length), tied: false }
    table.set(key, g)
    order.push(g)
    return { gate: g }
  }

  const roots = outputs.map((o) => ({ name: o.name, root: make(o.expr) }))

  // variables → switches
  const used = new Set<string>(opt.vars ?? [])
  const collect = (k: GateNode['kids'][number]) => { if ('variable' in k) used.add(k.variable) }
  order.forEach((g) => g.kids.forEach(collect))
  roots.forEach((r) => { if ('variable' in r.root) used.add(r.root.variable) })
  const varList = [...used].sort((a, c) => a.localeCompare(c, 'en', { numeric: true }))
  let bottom = opt.y0
  if (opt.makeInputs) {
    varList.forEach((name, i) => {
      const y = opt.y0 + i * 50
      const ref = b.add('switch', opt.x0, y, { name })
      b.tie(`${ref}.Y`, name, 20)
      bottom = Math.max(bottom, y + 20)
    })
  }
  const maxLevel = Math.max(1, ...order.map((g) => g.level))
  const gx = (level: number) => snap(opt.x0 + (opt.makeInputs ? 140 : 80) + (level - 1) * colW)
  // rows: each gate sits near the middle of the gates it reads
  const cursor: number[] = new Array(maxLevel + 2).fill(opt.y0)
  const height = (g: GateNode) => Math.max(40, g.inputs * 20) + 30
  const byLevel = [...order].sort((a, c) => a.level - c.level)
  for (const g of byLevel) {
    const ys = g.kids.flatMap((k) => ('gate' in k && k.gate.y !== undefined ? [k.gate.y] : []))
    let y = ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : cursor[g.level]
    y = Math.max(snap(y), cursor[g.level] + (cursor[g.level] === opt.y0 ? 0 : 0))
    y = snap(y)
    g.y = y
    cursor[g.level] = y + height(g)
    bottom = Math.max(bottom, y + height(g) / 2)
  }
  // a gate whose rows were pushed down: nothing else to do; place
  for (const g of byLevel) {
    const kindProps: Record<string, string> = {}
    if (g.kind !== 'not' && g.kind !== 'buf') kindProps.inputs = String(g.inputs)
    g.ref = b.add(g.kind, gx(g.level), g.y!, kindProps)
    counts[g.kind.toUpperCase()] = (counts[g.kind.toUpperCase()] ?? 0) + 1
  }
  const pinNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  // fan-out: pins fed by one gate
  const feeds = new Map<GateNode, string[]>()
  for (const g of order) {
    g.kids.forEach((k, i) => {
      const pin = `${g.ref}.${pinNames[i]}`
      if ('gate' in k) feeds.set(k.gate, [...(feeds.get(k.gate) ?? []), pin])
      else if ('variable' in k) b.tie(pin, k.variable, 20)
      else {
        const c = b.add('const', gx(g.level) - 90, g.y! + i * 20 - 10, { value: String(k.constant), name: '' })
        b.link(`${c}.Y`, pin)
      }
    })
  }
  // outputs: the right end of the last column
  const taps: Record<string, Tap> = {}
  for (const r of roots) {
    if ('gate' in r.root) feeds.set(r.root.gate, [...(feeds.get(r.root.gate) ?? []), `@out:${r.name}`])
  }
  for (const [g, pins] of feeds) {
    const real = pins.filter((p) => !p.startsWith('@out:'))
    if (real.length === 1) b.link(`${g.ref}.Y`, real[0])
    else if (real.length > 1) b.fan(`${g.ref}.Y`, real)
  }
  for (const r of roots) {
    if ('gate' in r.root) taps[r.name] = { pin: `${r.root.gate.ref}.Y` }
    else if ('variable' in r.root) taps[r.name] = { label: r.root.variable }
    else taps[r.name] = { constant: r.root.constant }
  }
  const right = gx(maxLevel) + 60
  return { taps, right, bottom: bottom + 30, gates: order.length, counts }
}

/** Connects a tap to a pin: a wire, a net label, or a constant part. */
export function connectTap(b: Builder, tap: Tap, pin: string, hint?: { constantAt?: [number, number] }): void {
  if ('pin' in tap) b.link(tap.pin, pin)
  else if ('label' in tap) b.tie(pin, tap.label, 20)
  else {
    const at = hint?.constantAt ?? [b.pin(pin).x - 80, b.pin(pin).y]
    const c = b.add('const', at[0], at[1], { value: String(tap.constant), name: '' })
    b.link(`${c}.Y`, pin)
  }
}

/** A complete circuit for some expressions: a switch per variable, the gates, an LED per output. */
export function expressionsToDoc(outputs: readonly LogicOutput[], style: LogicStyle = 'as-is'): { doc: Doc; builder: Builder; summary: { gates: number; counts: Record<string, number>; inputs: string[] } } {
  const vars = variables(outputs.map((o) => o.expr))
  const styledOuts = outputs.map((o) => ({ name: o.name, expr: styled(o.expr, style, vars) }))
  const b = new Builder()
  const res = addLogic(b, styledOuts, { x0: 0, y0: 0, makeInputs: true, vars })
  const used = new Set(vars)
  outputs.forEach((o, i) => {
    const name = used.has(o.name) ? `${o.name}_out` : o.name
    const y = snap(i * 70)
    const led = b.add('led', res.right + 40, y, { name, color: 'red' })
    connectTap(b, res.taps[o.name], `${led}.A`)
  })
  return { doc: b.build(), builder: b, summary: { gates: res.gates, counts: res.counts, inputs: vars } }
}

// ------------------------------------------------------------------------------ circuit → function

export interface CircuitFunctions {
  inputs: string[]
  outputs: { name: string; values: Cell[]; expr: Node; text: string }[]
  sequential: boolean
}

/** The truth table and minimal expressions of a combinational circuit (by simulating every input combination). */
export function circuitFunctions(doc: Doc, settings?: SimSettings): CircuitFunctions {
  const t = circuitTable(doc, settings)
  const outputs = t.outputs.map((name, k) => {
    const values = t.rows.map((r) => (r.outputs[k] === 1 ? 1 : r.outputs[k] === 0 ? 0 : 2) as Cell)
    const on = values.flatMap((v, i) => (v === 1 ? [i] : []))
    const dc = values.flatMap((v, i) => (v === 2 ? [i] : []))
    const m = minimizeBoth(t.inputs, on, dc)
    return { name, values, expr: m.sopNode, text: format(m.sopNode, 'prime') }
  })
  return { inputs: t.inputs, outputs, sequential: t.sequential }
}

export { and, nand, nor, not, or, xor }
