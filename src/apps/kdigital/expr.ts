// Boolean expressions: parser (A & B | !C, A AND B, A^B, ~A, A' …), evaluation, printing in several notations,
// normalisation and the NAND-only / NOR-only rewrites. Pure.

export type Node =
  | { t: 'const'; v: 0 | 1 }
  | { t: 'var'; n: string }
  | { t: 'not'; a: Node }
  | { t: 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor'; a: Node[] }

export class ParseError extends Error {
  pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.pos = pos
  }
}

export const C0: Node = { t: 'const', v: 0 }
export const C1: Node = { t: 'const', v: 1 }
export const v = (n: string): Node => ({ t: 'var', n })
export const not = (a: Node): Node => ({ t: 'not', a })
export const and = (...a: Node[]): Node => ({ t: 'and', a })
export const or = (...a: Node[]): Node => ({ t: 'or', a })
export const xor = (...a: Node[]): Node => ({ t: 'xor', a })
export const nand = (...a: Node[]): Node => ({ t: 'nand', a })
export const nor = (...a: Node[]): Node => ({ t: 'nor', a })

// ------------------------------------------------------------------------------ tokens

type OpName = 'AND' | 'OR' | 'XOR' | 'XNOR' | 'NAND' | 'NOR' | 'NOT' | '(' | ')' | "'"
type Tok =
  | { k: 'id'; s: string; pos: number }
  | { k: 'num'; s: string; pos: number }
  | { k: 'op'; s: OpName; pos: number }
  | { k: 'end'; pos: number }

const WORDS: Record<string, OpName> = { AND: 'AND', OR: 'OR', NOT: 'NOT', XOR: 'XOR', XNOR: 'XNOR', NAND: 'NAND', NOR: 'NOR' }

export interface ParseOptions {
  /** Read an upper-case word such as AB as A·B (textbook notation). Default true. */
  splitUpper?: boolean
  /** Names that are never split (signal names of the circuit). */
  names?: readonly string[]
}

function tokenize(text: string, opts: ParseOptions): Tok[] {
  const out: Tok[] = []
  const known = new Set(opts.names ?? [])
  const split = opts.splitUpper !== false
  let i = 0
  const push = (s: OpName, pos: number) => out.push({ k: 'op', s, pos })
  while (i < text.length) {
    const c = text[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '(' || c === '[' || c === '{') { push('(', i++); continue }
    if (c === ')' || c === ']' || c === '}') { push(')', i++); continue }
    if (c === "'" || c === '’' || c === '′') { push("'", i++); continue }
    if (c === '!' || c === '~' || c === '¬') { push('NOT', i++); continue }
    if (c === '&' || c === '*' || c === '·' || c === '∧' || c === '.') { push('AND', i); i += text[i + 1] === c && c === '&' ? 2 : 1; continue }
    if (c === '|' || c === '+' || c === '∨') { push('OR', i); i += text[i + 1] === c && c === '|' ? 2 : 1; continue }
    if (c === '^' || c === '⊕') { push('XOR', i++); continue }
    if (c === '⊙' || c === '↔') { push('XNOR', i++); continue }
    if (c === '↑') { push('NAND', i++); continue }
    if (c === '↓') { push('NOR', i++); continue }
    if (c === '-' && text[i + 1] === '>') throw new ParseError('Implication (->) is not supported: write !A | B.', i)
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < text.length && /[0-9A-Za-z_]/.test(text[j])) j++
      const s = text.slice(i, j)
      if (s !== '0' && s !== '1') throw new ParseError(`“${s}” is not a name or a constant (names start with a letter; constants are 0 and 1).`, i)
      out.push({ k: 'num', s, pos: i })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++
      const word = text.slice(i, j)
      const up = word.toUpperCase()
      if (WORDS[up] && !known.has(word)) push(WORDS[up], i)
      else if (split && !known.has(word) && word.length > 1 && /^[A-Z]+$/.test(word)) {
        // AB → A·B
        for (let k = 0; k < word.length; k++) out.push({ k: 'id', s: word[k], pos: i + k })
      } else out.push({ k: 'id', s: word, pos: i })
      i = j
      continue
    }
    throw new ParseError(`Unexpected “${c}”.`, i)
  }
  out.push({ k: 'end', pos: text.length })
  return out
}

// ------------------------------------------------------------------------------ parser

export function parse(text: string, opts: ParseOptions = {}): Node {
  const toks = tokenize(text, opts)
  let p = 0
  const peek = () => toks[p]
  const isOp = (t: Tok, ...s: string[]) => t.k === 'op' && s.includes(t.s)
  const startsPrimary = (t: Tok) => t.k === 'id' || t.k === 'num' || isOp(t, '(', 'NOT')

  function parseOr(): Node {
    let left = parseXor()
    while (isOp(peek(), 'OR', 'NOR')) {
      const op = (toks[p++] as { s: string }).s
      const right = parseXor()
      left = op === 'OR' ? joinN('or', left, right) : { t: 'nor', a: [left, right] }
    }
    return left
  }
  function parseXor(): Node {
    let left = parseAnd()
    while (isOp(peek(), 'XOR', 'XNOR')) {
      const op = (toks[p++] as { s: string }).s
      const right = parseAnd()
      left = op === 'XOR' ? joinN('xor', left, right) : { t: 'xnor', a: [left, right] }
    }
    return left
  }
  function parseAnd(): Node {
    let left = parseUnary()
    for (;;) {
      const t = peek()
      if (isOp(t, 'AND', 'NAND')) {
        p++
        const right = parseUnary()
        left = (t as { s: string }).s === 'AND' ? joinN('and', left, right) : { t: 'nand', a: [left, right] }
      } else if (startsPrimary(t)) left = joinN('and', left, parseUnary()) // implicit AND: A B, A(B+C), AB'
      else return left
    }
  }
  function parseUnary(): Node {
    const t = peek()
    if (isOp(t, 'NOT')) { p++; return not(parseUnary()) }
    return parsePostfix()
  }
  function parsePostfix(): Node {
    let n = parsePrimary()
    while (isOp(peek(), "'")) { p++; n = not(n) }
    return n
  }
  function parsePrimary(): Node {
    const t = toks[p++]
    if (t.k === 'id') return v(t.s)
    if (t.k === 'num') return t.s === '1' ? C1 : C0
    if (isOp(t, '(')) {
      const inner = parseOr()
      const close = toks[p++]
      if (!isOp(close, ')')) throw new ParseError('A closing bracket is missing.', close.pos)
      return inner
    }
    if (t.k === 'end') throw new ParseError('The expression ends too early: an operand is missing.', t.pos)
    throw new ParseError(`An operand (a name, 0, 1 or a bracket) was expected here, not “${t.k === 'op' ? t.s : ''}”.`, t.pos)
  }
  function joinN(kind: 'and' | 'or' | 'xor', a: Node, b: Node): Node {
    const list = [...(a.t === kind ? a.a : [a]), ...(b.t === kind ? b.a : [b])]
    return { t: kind, a: list }
  }

  if (toks.length === 1) throw new ParseError('Type an expression, e.g. A & B | !C.', 0)
  const n = parseOr()
  const rest = peek()
  if (rest.k !== 'end') throw new ParseError(rest.k === 'op' && rest.s === ')' ? 'There is a closing bracket too many.' : 'Unexpected text after the expression.', rest.pos)
  return n
}

export function tryParse(text: string, opts: ParseOptions = {}): { node: Node } | { error: string; pos: number } {
  try { return { node: parse(text, opts) } } catch (e) {
    if (e instanceof ParseError) return { error: e.message, pos: e.pos }
    throw e
  }
}

// ------------------------------------------------------------------------------ variables, evaluation

const naturalCompare = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0)

/** The variables of an expression, sorted (A, B, C…; Q0, Q1, Q10). */
export function variables(n: Node | Node[]): string[] {
  const set = new Set<string>()
  const walk = (x: Node) => {
    if (x.t === 'var') set.add(x.n)
    else if (x.t === 'not') walk(x.a)
    else if (x.t !== 'const') x.a.forEach(walk)
  }
  ;(Array.isArray(n) ? n : [n]).forEach(walk)
  return [...set].sort(naturalCompare)
}

export function evaluate(n: Node, env: Readonly<Record<string, number>>): 0 | 1 {
  switch (n.t) {
    case 'const': return n.v
    case 'var': {
      const x = env[n.n]
      if (x === undefined) throw new Error(`No value for ${n.n}.`)
      return x ? 1 : 0
    }
    case 'not': return evaluate(n.a, env) ? 0 : 1
    case 'and': return n.a.every((c) => evaluate(c, env)) ? 1 : 0
    case 'or': return n.a.some((c) => evaluate(c, env)) ? 1 : 0
    case 'nand': return n.a.every((c) => evaluate(c, env)) ? 0 : 1
    case 'nor': return n.a.some((c) => evaluate(c, env)) ? 0 : 1
    case 'xor': return (n.a.reduce((s, c) => s ^ evaluate(c, env), 0) & 1) as 0 | 1
    case 'xnor': return (1 ^ (n.a.reduce((s, c) => s ^ evaluate(c, env), 0) & 1)) as 0 | 1
  }
}

/** The output column of the truth table: row i has the first variable as its most significant bit. */
export function truthVector(n: Node, vars: readonly string[]): Uint8Array {
  const rows = 1 << vars.length
  const out = new Uint8Array(rows)
  const env: Record<string, number> = {}
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < vars.length; k++) env[vars[k]] = (r >> (vars.length - 1 - k)) & 1
    out[r] = evaluate(n, env)
  }
  return out
}

export function equivalent(a: Node, b: Node): { equal: boolean; vars: string[]; counterexample?: Record<string, number> } {
  const vars = variables([a, b])
  if (vars.length > 16) throw new Error('At most 16 variables can be compared.')
  const va = truthVector(a, vars)
  const vb = truthVector(b, vars)
  for (let r = 0; r < va.length; r++) {
    if (va[r] !== vb[r]) {
      const ex: Record<string, number> = {}
      vars.forEach((name, k) => { ex[name] = (r >> (vars.length - 1 - k)) & 1 })
      return { equal: false, vars, counterexample: ex }
    }
  }
  return { equal: true, vars }
}

// ------------------------------------------------------------------------------ printing

export type Style = 'prime' | 'bang' | 'words' | 'verilog' | 'vhdl' | 'math'

const PREC: Record<Node['t'], number> = { or: 1, nor: 1, xor: 2, xnor: 2, and: 3, nand: 3, not: 4, var: 5, const: 5 }

/** Is this a plain name that can sit next to another without a symbol (A, B, not Cin)? */
const single = (name: string) => name.length === 1

export function format(n: Node, style: Style = 'prime'): string {
  const sym: Record<string, string> = style === 'words'
    ? { and: ' AND ', or: ' OR ', xor: ' XOR ' }
    : style === 'vhdl' ? { and: ' and ', or: ' or ', xor: ' xor ' }
      : style === 'verilog' ? { and: ' & ', or: ' | ', xor: ' ^ ' }
        : style === 'math' ? { and: ' ∧ ', or: ' ∨ ', xor: ' ⊕ ' }
          : style === 'bang' ? { and: ' & ', or: ' | ', xor: ' ^ ' }
            : { and: ' · ', or: ' + ', xor: ' ⊕ ' }
  const notOp = style === 'verilog' ? '~' : style === 'bang' ? '!' : style === 'math' ? '¬' : style === 'vhdl' ? 'not ' : 'NOT '

  function go(x: Node, parent: number): string {
    switch (x.t) {
      case 'const': return String(x.v)
      case 'var': return x.n
      case 'not': {
        const inner = x.a
        if (style === 'prime') {
          if (inner.t === 'var' || inner.t === 'const' || inner.t === 'not') return `${go(inner, 5)}'`
          return `(${go(inner, 0)})'`
        }
        if (inner.t === 'var' || inner.t === 'const' || inner.t === 'not') return `${notOp}${go(inner, 4)}`
        return `${notOp}(${go(inner, 0)})`
      }
      case 'nand': case 'nor': case 'xnor': {
        const base: Node = { t: x.t === 'nand' ? 'and' : x.t === 'nor' ? 'or' : 'xor', a: x.a }
        return go(x.a.length === 1 ? not(x.a[0]) : not(base), parent)
      }
      case 'and': case 'or': case 'xor': {
        const prec = PREC[x.t]
        let s: string
        if (style === 'prime' && x.t === 'and') {
          const parts = x.a.map((c) => go(c, 3))
          const lits = x.a.filter((c) => c.t === 'var' || (c.t === 'not' && c.a.t === 'var')) as Node[]
          const plain = lits.every((c) => single(c.t === 'var' ? c.n : (c as { a: { n: string } }).a.n)) && !x.a.some((c) => c.t === 'const')
          s = parts.join(plain ? '' : ' · ')
        } else s = x.a.map((c) => go(c, prec)).join(sym[x.t])
        return prec < parent ? `(${s})` : s
      }
    }
  }
  return go(n, 0)
}

// ------------------------------------------------------------------------------ rewriting

/** Constant folding, flattening, removing double negations and duplicate operands. Keeps the function. */
export function normalize(n: Node): Node {
  switch (n.t) {
    case 'const': case 'var': return n
    case 'not': {
      const a = normalize(n.a)
      if (a.t === 'const') return a.v ? C0 : C1
      if (a.t === 'not') return a.a
      return not(a)
    }
    case 'nand': case 'nor': case 'xnor': {
      const base = n.t === 'nand' ? 'and' : n.t === 'nor' ? 'or' : 'xor'
      return normalize(not({ t: base, a: n.a }))
    }
    case 'and': case 'or': {
      const identity = n.t === 'and' ? 1 : 0
      const kids: Node[] = []
      const seen = new Set<string>()
      for (const c0 of n.a) {
        const c = normalize(c0)
        const parts = c.t === n.t ? c.a : [c]
        for (const q of parts) {
          if (q.t === 'const') {
            if (q.v !== identity) return q
            continue
          }
          const key = format(q, 'bang')
          if (seen.has(key)) continue
          seen.add(key)
          kids.push(q)
        }
      }
      // x & !x = 0, x | !x = 1
      for (const q of kids) if (q.t === 'not' && seen.has(format(q.a, 'bang'))) return identity ? C0 : C1
      if (kids.length === 0) return identity ? C1 : C0
      if (kids.length === 1) return kids[0]
      return { t: n.t, a: kids }
    }
    case 'xor': {
      let parity = 0
      const kids: Node[] = []
      for (const c0 of n.a) {
        const c = normalize(c0)
        for (const q of c.t === 'xor' ? c.a : [c]) {
          if (q.t === 'const') parity ^= q.v
          else kids.push(q)
        }
      }
      // pairs cancel
      const counts = new Map<string, { n: Node; c: number }>()
      for (const q of kids) { const k = format(q, 'bang'); const e = counts.get(k); if (e) e.c++; else counts.set(k, { n: q, c: 1 }) }
      const rest = [...counts.values()].filter((e) => e.c % 2 === 1).map((e) => e.n)
      if (rest.length === 0) return parity ? C1 : C0
      const core = rest.length === 1 ? rest[0] : ({ t: 'xor', a: rest } as Node)
      return parity ? normalize(not(core)) : core
    }
  }
}

/** Only AND, OR and NOT (XOR and the inverting gates expanded). */
export function toBasic(n: Node): Node {
  switch (n.t) {
    case 'const': case 'var': return n
    case 'not': return not(toBasic(n.a))
    case 'and': case 'or': return { t: n.t, a: n.a.map(toBasic) }
    case 'nand': return not(and(...n.a.map(toBasic)))
    case 'nor': return not(or(...n.a.map(toBasic)))
    case 'xor': case 'xnor': {
      const kids = n.a.map(toBasic)
      let acc = kids[0]
      for (let i = 1; i < kids.length; i++) acc = or(and(acc, not(kids[i])), and(not(acc), kids[i]))
      return n.t === 'xnor' ? not(acc) : acc
    }
  }
}

/** The same function using only NAND gates (an inverter is a one-input NAND). */
export function toNandOnly(n: Node): Node {
  const inv = (x: Node): Node => (x.t === 'nand' && x.a.length === 1 ? x.a[0] : nand(x))
  const go = (x: Node): Node => {
    switch (x.t) {
      case 'const': case 'var': return x
      case 'not': return inv(go(x.a))
      case 'and': return inv(nand(...x.a.map(go)))
      case 'or': return nand(...x.a.map((c) => inv(go(c))))
      case 'nand': return nand(...x.a.map(go))
      case 'nor': return inv(nand(...x.a.map((c) => inv(go(c)))))
      case 'xor': case 'xnor': {
        let acc = go(x.a[0])
        for (let i = 1; i < x.a.length; i++) {
          const b = go(x.a[i])
          const m = nand(acc, b)
          acc = nand(nand(acc, m), nand(b, m)) // the four-NAND exclusive OR
        }
        return x.t === 'xnor' ? inv(acc) : acc
      }
    }
  }
  return go(n)
}

/** The same function using only NOR gates (an inverter is a one-input NOR). */
export function toNorOnly(n: Node): Node {
  const inv = (x: Node): Node => (x.t === 'nor' && x.a.length === 1 ? x.a[0] : nor(x))
  const go = (x: Node): Node => {
    switch (x.t) {
      case 'const': case 'var': return x
      case 'not': return inv(go(x.a))
      case 'or': return inv(nor(...x.a.map(go)))
      case 'and': return nor(...x.a.map((c) => inv(go(c))))
      case 'nor': return nor(...x.a.map(go))
      case 'nand': return inv(nor(...x.a.map((c) => inv(go(c)))))
      case 'xor': case 'xnor': {
        let acc = go(x.a[0])
        for (let i = 1; i < x.a.length; i++) {
          const b = go(x.a[i])
          const m = nor(acc, b)
          acc = inv(nor(nor(acc, m), nor(b, m))) // XNOR from four NORs, inverted
        }
        return x.t === 'xnor' ? inv(acc) : acc
      }
    }
  }
  return go(n)
}

/** Gate-level statistics of an expression tree: gate counts by kind and the longest path (in gates). */
export function gateStats(n: Node): { counts: Record<string, number>; depth: number; gates: number } {
  const counts: Record<string, number> = {}
  const seen = new Map<string, number>()
  const depthOf = (x: Node): number => {
    if (x.t === 'var' || x.t === 'const') return 0
    const key = format(x, 'bang') + (x.t === 'nand' || x.t === 'nor' ? `#${x.t}${x.a.length}` : '')
    const have = seen.get(key + x.t)
    if (have !== undefined) return have
    const kids = x.t === 'not' ? [x.a] : x.a
    const d = 1 + Math.max(0, ...kids.map(depthOf))
    const name = x.t === 'not' || ((x.t === 'nand' || x.t === 'nor') && x.a.length === 1) ? 'NOT' : x.t.toUpperCase()
    counts[name] = (counts[name] ?? 0) + 1
    seen.set(key + x.t, d)
    return d
  }
  const depth = depthOf(n)
  return { counts, depth, gates: Object.values(counts).reduce((a, b) => a + b, 0) }
}
