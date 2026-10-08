// A small, safe expression evaluator for computed columns: `a*2+1`, `log10([signal (V)])`,
// `sqrt(x^2 + c2^2)`. A hand-written parser and tree walker: nothing here calls eval or
// new Function, and names are looked up in a Map (never on an object's prototype).

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Expr }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '%' | '^'; a: Expr; b: Expr }
  | { t: 'call'; fn: string; args: Expr[] }

export class ExprError extends Error {}

const FUNCS = new Map<string, (...a: number[]) => number>([
  ['sin', Math.sin], ['cos', Math.cos], ['tan', Math.tan], ['asin', Math.asin], ['acos', Math.acos], ['atan', Math.atan],
  ['sinh', Math.sinh], ['cosh', Math.cosh], ['tanh', Math.tanh],
  ['exp', Math.exp], ['ln', Math.log], ['log', Math.log10], ['log10', Math.log10], ['log2', Math.log2],
  ['sqrt', Math.sqrt], ['cbrt', Math.cbrt], ['abs', Math.abs], ['floor', Math.floor], ['ceil', Math.ceil], ['round', Math.round],
  ['sign', Math.sign], ['min', Math.min], ['max', Math.max], ['pow', Math.pow], ['atan2', Math.atan2], ['hypot', Math.hypot],
  ['mod', (a, b) => a - b * Math.floor(a / b)],
  ['deg', (a) => (a * 180) / Math.PI], ['rad', (a) => (a * Math.PI) / 180],
])
const CONSTS = new Map<string, number>([['pi', Math.PI], ['e', Math.E], ['tau', 2 * Math.PI]])

export const EXPR_FUNCTIONS = [...FUNCS.keys()]

type Tok = { k: 'num'; v: number } | { k: 'id'; s: string } | { k: 'name'; s: string } | { k: 'op'; s: string } | { k: 'end' }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))
    if (num) { out.push({ k: 'num', v: Number(num[0]) }); i += num[0].length; continue }
    const id = /^[\p{L}_µ][\p{L}\p{N}_µ]*/u.exec(src.slice(i))
    if (id) { out.push({ k: 'id', s: id[0] }); i += id[0].length; continue }
    if (c === '[' || c === '"') {
      const close = c === '[' ? ']' : '"'
      const j = src.indexOf(close, i + 1)
      if (j < 0) throw new ExprError(`Missing ${close}`)
      out.push({ k: 'name', s: src.slice(i + 1, j) })
      i = j + 1
      continue
    }
    if (c === '*' && src[i + 1] === '*') { out.push({ k: 'op', s: '^' }); i += 2; continue }
    if ('+-*/%^(),'.includes(c)) { out.push({ k: 'op', s: c }); i++; continue }
    throw new ExprError(`Unexpected "${c}"`)
  }
  out.push({ k: 'end' })
  return out
}

export function parseExpr(src: string): Expr {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (s: string) => peek().k === 'op' && (peek() as { s: string }).s === s
  const eat = (s: string) => {
    if (!isOp(s)) throw new ExprError(`Expected "${s}"`)
    p++
  }

  const expr = (): Expr => {
    let a = term()
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { s: '+' | '-' }).s
      a = { t: 'bin', op, a, b: term() }
    }
    return a
  }
  const term = (): Expr => {
    let a = unary()
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (toks[p++] as { s: '*' | '/' | '%' }).s
      a = { t: 'bin', op, a, b: unary() }
    }
    return a
  }
  const unary = (): Expr => {
    if (isOp('-')) { p++; return { t: 'neg', a: unary() } }
    if (isOp('+')) { p++; return unary() }
    return power()
  }
  const power = (): Expr => {
    const a = atom()
    if (isOp('^')) { p++; return { t: 'bin', op: '^', a, b: unary() } }
    return a
  }
  const atom = (): Expr => {
    const t = peek()
    if (t.k === 'num') { p++; return { t: 'num', v: t.v } }
    if (t.k === 'name') { p++; return { t: 'var', name: t.s } }
    if (t.k === 'id') {
      p++
      if (isOp('(')) {
        p++
        const args: Expr[] = []
        if (!isOp(')')) {
          args.push(expr())
          while (isOp(',')) { p++; args.push(expr()) }
        }
        eat(')')
        const fn = t.s.toLowerCase()
        if (!FUNCS.has(fn)) throw new ExprError(`Unknown function "${t.s}"`)
        return { t: 'call', fn, args }
      }
      return { t: 'var', name: t.s }
    }
    if (isOp('(')) {
      p++
      const e = expr()
      eat(')')
      return e
    }
    throw new ExprError(t.k === 'end' ? 'The expression ends too early' : `Unexpected "${t.k === 'op' ? t.s : ''}"`)
  }

  const tree = expr()
  if (peek().k !== 'end') throw new ExprError('Unexpected text after the expression')
  return tree
}

/** The names an expression uses (columns, not constants). */
export function exprNames(e: Expr, out = new Set<string>()): Set<string> {
  if (e.t === 'var') out.add(e.name)
  else if (e.t === 'neg') exprNames(e.a, out)
  else if (e.t === 'bin') { exprNames(e.a, out); exprNames(e.b, out) }
  else if (e.t === 'call') e.args.forEach((a) => exprNames(a, out))
  return out
}

/** Evaluate with `lookup(name)` giving a number (or undefined for an unknown name). */
export function evalExpr(e: Expr | string, lookup: (name: string) => number | undefined = () => undefined): number {
  const tree = typeof e === 'string' ? parseExpr(e) : e
  const go = (n: Expr): number => {
    switch (n.t) {
      case 'num': return n.v
      case 'var': {
        const v = lookup(n.name)
        if (v !== undefined) return v
        const c = CONSTS.get(n.name.toLowerCase())
        if (c !== undefined) return c
        throw new ExprError(`Unknown name "${n.name}"`)
      }
      case 'neg': return -go(n.a)
      case 'bin': {
        const a = go(n.a)
        const b = go(n.b)
        switch (n.op) {
          case '+': return a + b
          case '-': return a - b
          case '*': return a * b
          case '/': return a / b
          case '%': return a - b * Math.floor(a / b)
          default: return Math.pow(a, b)
        }
      }
      case 'call': return FUNCS.get(n.fn)!(...n.args.map(go))
    }
  }
  return go(tree)
}

/** A lookup for the columns of a table: header (any case), the header as an identifier, and c1, c2… */
export function columnLookup(headers: string[], row: (string | number)[], toNumber: (c: string) => number, extra: Record<string, number> = {}): (name: string) => number | undefined {
  const names = new Map<string, number>()
  const ident = (h: string) => h.trim().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '').toLowerCase()
  headers.forEach((h, i) => {
    names.set(h.trim().toLowerCase(), i)
    const id = ident(h)
    if (id && !names.has(id)) names.set(id, i)
  })
  const extras = new Map(Object.entries(extra))
  return (name) => {
    const key = name.trim().toLowerCase()
    const ex = extras.get(key)
    const idx = names.get(key)
    if (idx === undefined) {
      const m = /^c(\d+)$/.exec(key)
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= headers.length) return cell(Number(m[1]) - 1)
      return ex
    }
    return cell(idx)
  }
  function cell(i: number): number {
    const v = row[i]
    return typeof v === 'number' ? v : toNumber(String(v ?? ''))
  }
}
