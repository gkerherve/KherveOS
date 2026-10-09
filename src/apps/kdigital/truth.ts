// Truth tables for one or several outputs, function specifications typed as text
// (F = A&B | !C,  F(A,B,C) = Σm(1,3,7) + d(0)), equivalence and the standard forms. Pure.

import { evaluate, parse, ParseError, truthVector, variables, type Node, type ParseOptions } from './expr.ts'
import { canonicalPos, canonicalSop, minimizeBoth, piText, sigmaText, type Minimised } from './qmc.ts'

/** 0, 1, or 2 = don't care. */
export type Cell = 0 | 1 | 2

export interface TruthTable {
  vars: string[]
  outputs: { name: string; values: Cell[] }[]
}

export const MAX_VARS = 8

export function rowEnv(vars: readonly string[], row: number): Record<string, number> {
  const env: Record<string, number> = {}
  vars.forEach((name, k) => { env[name] = (row >> (vars.length - 1 - k)) & 1 })
  return env
}

export function tableFromNodes(defs: { name: string; node: Node }[], vars?: readonly string[]): TruthTable {
  const names = vars ? [...vars] : variables(defs.map((d) => d.node))
  if (names.length > MAX_VARS) throw new Error(`The truth table is limited to ${MAX_VARS} variables (this one has ${names.length}).`)
  return { vars: names, outputs: defs.map((d) => ({ name: d.name, values: Array.from(truthVector(d.node, names), (x) => x as Cell) })) }
}

export const onSet = (values: readonly Cell[]): number[] => values.flatMap((x, i) => (x === 1 ? [i] : []))
export const dcSet = (values: readonly Cell[]): number[] => values.flatMap((x, i) => (x === 2 ? [i] : []))
export const offSet = (values: readonly Cell[]): number[] => values.flatMap((x, i) => (x === 0 ? [i] : []))

/** Everything the Boolean tab shows about one output. */
export interface Analysis {
  name: string
  vars: string[]
  on: number[]
  dc: number[]
  off: number[]
  min: Minimised
  canonicalSop: Node
  canonicalPos: Node
  sigma: string
  pi: string
}

export function analyse(vars: readonly string[], name: string, values: readonly Cell[]): Analysis {
  const on = onSet(values)
  const dc = dcSet(values)
  const off = offSet(values)
  return {
    name, vars: [...vars], on, dc, off, min: minimizeBoth(vars, on, dc),
    canonicalSop: canonicalSop(vars, on), canonicalPos: canonicalPos(vars, off), sigma: sigmaText(on, dc), pi: piText(off, dc),
  }
}

// ------------------------------------------------------------------------------ function specifications

export interface FunctionSpec {
  name: string
  /** Variables given in the heading F(A,B,C), if any. */
  vars?: string[]
  /** An expression, or a minterm list. */
  node?: Node
  on?: number[]
  dc?: number[]
  /** Π form: `on` holds the maxterms (where the function is 0). */
  maxterms?: boolean
  source: string
  /** index of its line in the text (set by parseFunctions) */
  line?: number
}

const LIST = /^\s*([ΣΠ]|sum|prod|sigma|pi)?\s*([mMdD])\s*\(([^)]*)\)\s*/

function parseNumbers(text: string, line: string): number[] {
  const out: number[] = []
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part)
    if (range) { for (let i = Number(range[1]); i <= Number(range[2]); i++) out.push(i); continue }
    if (!/^\d+$/.test(part)) throw new ParseError(`“${part}” is not a minterm number (in “${line}”).`, 0)
    out.push(Number(part))
  }
  return out
}

/** One line: `name = expression`, `name(A,B,C) = expression`, `F(A,B,C) = Σm(1,2,3) + d(0)`, `Σm(1,2)` or just an expression. */
export function parseFunctionLine(line: string, defaultName: string, opts: ParseOptions = {}): FunctionSpec {
  const text = line.trim()
  const head = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\))?\s*=(?!=)\s*(.*)$/.exec(text)
  let name = defaultName
  let vars: string[] | undefined
  let body = text
  // `Q = ...` is a definition; `A'B = ...` is not (it never matches the head pattern)
  if (head && !LIST.test(text)) { name = head[1]; vars = head[2]?.split(',').map((s) => s.trim()); body = head[3] }
  else if (head) { name = head[1]; vars = head[2]?.split(',').map((s) => s.trim()); body = head[3] }
  body = body.trim()
  if (!body) throw new ParseError('The right-hand side is empty.', 0)
  const list = LIST.exec(body)
  if (list) {
    let on: number[] = []
    let dc: number[] = []
    let maxterms = false
    let rest = body
    for (;;) {
      const m = LIST.exec(rest)
      if (!m) break
      const nums = parseNumbers(m[3], body)
      const kind = m[2].toLowerCase()
      if (kind === 'd') dc = dc.concat(nums)
      else {
        if (m[2] === 'M' || m[1] === 'Π' || m[1] === 'prod' || m[1] === 'pi') maxterms = true
        on = on.concat(nums)
      }
      rest = rest.slice(m[0].length).replace(/^\s*[+·*.]\s*/, '')
    }
    if (rest.trim()) throw new ParseError(`Unexpected “${rest.trim()}” after the minterm list.`, 0)
    return { name, vars, on, dc, maxterms, source: text }
  }
  return { name, vars, node: parse(body, opts), source: text }
}

export interface FunctionSet {
  table: TruthTable
  specs: FunctionSpec[]
  errors: { line: number; message: string }[]
}

const DEFAULT_NAMES = ['F', 'G', 'H', 'Y', 'Z', 'W', 'U', 'T']

/** Several lines (blank lines and `#` or `//` comments are skipped) → one truth table over the union of their variables. */
export function parseFunctions(text: string, opts: ParseOptions = {}): FunctionSet {
  const specs: FunctionSpec[] = []
  const errors: FunctionSet['errors'] = []
  const lines = text.split('\n')
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s(#|\/\/).*$/, '').trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) return
    try {
      const spec = parseFunctionLine(line, DEFAULT_NAMES[specs.length] ?? `F${specs.length + 1}`, opts)
      spec.line = idx
      specs.push(spec)
    } catch (e) {
      errors.push({ line: idx + 1, message: e instanceof Error ? e.message : String(e) })
    }
  })
  // variables: those named in a heading, plus the ones used in expressions, plus letters for minterm lists
  let vars: string[] = []
  const named = specs.find((s) => s.vars)?.vars
  if (named) vars = [...named]
  const used = variables(specs.flatMap((s) => (s.node ? [s.node] : [])))
  for (const u of used) if (!vars.includes(u)) vars.push(u)
  if (!named) vars = [...used]
  const maxIdx = Math.max(-1, ...specs.flatMap((s) => (s.node ? [] : [...(s.on ?? []), ...(s.dc ?? [])])))
  if (maxIdx >= 0) {
    let bits = 1
    while ((1 << bits) <= maxIdx) bits++
    const letters = 'ABCDEFGH'
    while (vars.length < bits) {
      const next = [...letters].find((c) => !vars.includes(c)) ?? `X${vars.length}`
      vars.push(next)
    }
  }
  if (vars.length > MAX_VARS) {
    errors.push({ line: 0, message: `At most ${MAX_VARS} variables are supported (this has ${vars.length}).` })
    vars = vars.slice(0, MAX_VARS)
  }
  const size = 1 << vars.length
  const outputs: TruthTable['outputs'] = []
  for (const s of specs) {
    let values: Cell[]
    if (s.node) {
      const missing = variables(s.node).filter((x) => !vars.includes(x))
      if (missing.length) { errors.push({ line: 0, message: `${s.name}: ${missing.join(', ')} is not among the variables.` }); continue }
      values = Array.from(truthVector(s.node, vars), (x) => x as Cell)
    } else if (s.maxterms) {
      values = new Array<Cell>(size).fill(1)
      for (const m of s.on ?? []) if (m < size) values[m] = 0
      for (const m of s.dc ?? []) if (m < size) values[m] = 2
    } else {
      values = new Array<Cell>(size).fill(0)
      for (const m of s.on ?? []) if (m < size) values[m] = 1
      for (const m of s.dc ?? []) if (m < size) values[m] = 2
    }
    outputs.push({ name: s.name, values })
  }
  return { table: { vars, outputs }, specs, errors }
}

/** Cycles a table cell 0 → 1 → X → 0. */
export const nextCell = (c: Cell): Cell => (c === 0 ? 1 : c === 1 ? 2 : 0)

/** The text that reproduces a table: `F(A,B) = Σm(1,2) + d(3)`. */
export function tableToText(t: TruthTable): string {
  return t.outputs.map((o) => `${o.name}(${t.vars.join(',')}) = ${sigmaText(onSet(o.values), dcSet(o.values))}`).join('\n')
}

export function minterm(vars: readonly string[], env: Readonly<Record<string, number>>): number {
  let r = 0
  for (const x of vars) r = (r << 1) | (env[x] ? 1 : 0)
  return r
}

export { evaluate }

/** The text with the line of one function replaced by its minterm list (after a cell of the truth table was clicked). */
export function setFunctionCells(text: string, name: string, vars: readonly string[], values: readonly Cell[]): string {
  const set = parseFunctions(text)
  const spec = set.specs.find((s) => s.name === name)
  const line = `${name}(${vars.join(',')}) = ${sigmaText(onSet(values), dcSet(values))}`
  if (!spec || spec.line === undefined) return (text.trim() ? text.replace(/\s*$/, '\n') : '') + line
  const lines = text.split('\n')
  lines[spec.line] = line
  return lines.join('\n')
}
