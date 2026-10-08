// KherveCalc's programmer mode: integer arithmetic in BIN/OCT/DEC/HEX with a
// word size (8/16/32/64 bits, signed or not) and bitwise operations, in BigInt.
// Pure, so tools/tests can run it in Node.
//
//   progEval('FF + 1', { base: 16, bits: 8, signed: false })  ->  0n
//
// Operators, C-like precedence: unary - ~ !(not) > ** > * / % > + - > << >> >>>
// > & > ^ > |. Words: and or xor nand nor xnor not mod shl shr sar rol ror.
// Functions: rol(x,n) ror(x,n) popcount(x) clz(x) ctz(x) abs(x) min max bit(x,n) setbit clearbit flipbit.
// Literals: 0x1F 0b101 0o17, or plain digits read in the current base
// (in HEX, an all-uppercase word of A–F such as FF is a number).

export type Base = 2 | 8 | 10 | 16
export type WordSize = 8 | 16 | 32 | 64

export interface ProgOpts {
  base: Base
  bits: WordSize
  signed: boolean
}

export class ProgError extends Error {}

type Tok = { t: 'num'; v: bigint } | { t: 'op'; v: string } | { t: 'name'; v: string } | { t: '(' } | { t: ')' } | { t: ',' }

const WORD_OPS: Record<string, string> = {
  and: '&', or: '|', xor: '^', mod: '%', shl: '<<', shr: '>>>', sar: '>>', nand: 'nand', nor: 'nor', xnor: 'xnor',
  rol: 'rol', ror: 'ror',
}
const DIGITS: Record<Base, RegExp> = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^[0-9]+$/, 16: /^[0-9A-Fa-f]+$/ }

/** Wrap to the word size; signed words read the top bit as negative (two's complement). */
export function wrap(v: bigint, bits: WordSize, signed: boolean): bigint {
  const n = BigInt(bits)
  return signed ? BigInt.asIntN(bits, v) : BigInt.asUintN(Number(n), v)
}

function parseDigits(s: string, base: Base): bigint {
  const clean = s.replace(/_/g, '')
  if (!DIGITS[base].test(clean)) throw new ProgError(`'${s}' is not a ${baseName(base)} number`)
  const prefix = base === 16 ? '0x' : base === 8 ? '0o' : base === 2 ? '0b' : ''
  return BigInt(prefix + clean)
}

export function baseName(b: Base): string {
  return b === 2 ? 'binary' : b === 8 ? 'octal' : b === 16 ? 'hexadecimal' : 'decimal'
}

export function tokenize(src: string, base: Base): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const rest = src.slice(i)
    let m = /^0[xX][0-9A-Fa-f_]+|^0[bB][01_]+|^0[oO][0-7_]+/.exec(rest)
    if (m) {
      out.push({ t: 'num', v: BigInt(m[0].replace(/_/g, '').replace(/^0X/, '0x').replace(/^0B/, '0b').replace(/^0O/, '0o')) })
      i += m[0].length
      continue
    }
    // h/b/o/d suffixes: 1Fh, 1010b, 17o, 99d
    m = /^([0-9][0-9A-Fa-f_]*)([hHoOdD]|[bB](?![0-9A-Fa-f]))(?![\w])/.exec(rest)
    if (m && !(base === 16 && /[bBdD]$/.test(m[0]) && DIGITS[16].test(m[0]))) {
      const sfx = m[2].toLowerCase()
      const b: Base = sfx === 'h' ? 16 : sfx === 'o' ? 8 : sfx === 'b' ? 2 : 10
      out.push({ t: 'num', v: parseDigits(m[1], b) })
      i += m[0].length
      continue
    }
    m = /^[0-9][0-9A-Za-z_]*/.exec(rest)
    if (m) {
      out.push({ t: 'num', v: parseDigits(m[0], base) })
      i += m[0].length
      continue
    }
    m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
    if (m) {
      const w = m[0]
      const low = w.toLowerCase()
      if (base === 16 && /^[A-F]+$/.test(w)) out.push({ t: 'num', v: BigInt('0x' + w) })
      else if (low in WORD_OPS) out.push({ t: 'op', v: WORD_OPS[low] })
      else if (low === 'not') out.push({ t: 'op', v: '~' })
      else out.push({ t: 'name', v: w })
      i += w.length
      continue
    }
    const three = src.slice(i, i + 3)
    const two = src.slice(i, i + 2)
    if (three === '>>>') {
      out.push({ t: 'op', v: '>>>' })
      i += 3
    } else if (['<<', '>>', '**'].includes(two)) {
      out.push({ t: 'op', v: two })
      i += 2
    } else if ('+-*/%&|^~!'.includes(c)) {
      out.push({ t: 'op', v: c === '!' ? '~' : c })
      i++
    } else if (c === '(') {
      out.push({ t: '(' })
      i++
    } else if (c === ')') {
      out.push({ t: ')' })
      i++
    } else if (c === ',') {
      out.push({ t: ',' })
      i++
    } else throw new ProgError(`Unexpected '${c}'`)
  }
  return out
}

const BINARY: string[][] = [
  ['|', 'nor'],
  ['^', 'xnor'],
  ['&', 'nand'],
  ['<<', '>>', '>>>', 'rol', 'ror'],
  ['+', '-'],
  ['*', '/', '%'],
]

/** Evaluate an expression; variables (e.g. ans) are optional. */
export function progEval(src: string, o: ProgOpts, vars: Record<string, bigint> = {}): bigint {
  const toks = tokenize(src, o.base)
  if (!toks.length) throw new ProgError('Nothing to calculate')
  let p = 0
  const W = (v: bigint) => wrap(v, o.bits, o.signed)
  const mask = (1n << BigInt(o.bits)) - 1n
  const u = (v: bigint) => v & mask
  const peek = () => toks[p]
  const isOp = (v: string) => {
    const t = peek()
    return t?.t === 'op' && t.v === v
  }

  const rot = (v: bigint, n: bigint, left: boolean) => {
    const b = BigInt(o.bits)
    const k = ((n % b) + b) % b
    const x = u(v)
    const r = left ? ((x << k) | (x >> (b - k))) & mask : ((x >> k) | (x << (b - k))) & mask
    return W(r)
  }

  const apply = (op: string, a: bigint, b: bigint): bigint => {
    switch (op) {
      case '+': return W(a + b)
      case '-': return W(a - b)
      case '*': return W(a * b)
      case '/':
        if (b === 0n) throw new ProgError('Division by zero')
        return W(a / b)
      case '%':
        if (b === 0n) throw new ProgError('Division by zero')
        return W(a % b)
      case '&': return W(a & b)
      case '|': return W(a | b)
      case '^': return W(a ^ b)
      case 'nand': return W(~(a & b))
      case 'nor': return W(~(a | b))
      case 'xnor': return W(~(a ^ b))
      case '<<': return W(b >= BigInt(o.bits) ? 0n : a << b)
      case '>>': return W(a >> b) // arithmetic for signed words
      case '>>>': return W(u(a) >> b)
      case 'rol': return rot(a, b, true)
      case 'ror': return rot(a, b, false)
      case '**':
        if (b < 0n) throw new ProgError('Negative powers are not integers')
        return W(a ** b)
    }
    throw new ProgError(`Unknown operator ${op}`)
  }

  const level = (k: number): bigint => {
    if (k >= BINARY.length) return power()
    let left = level(k + 1)
    for (;;) {
      const t = peek()
      if (t?.t === 'op' && BINARY[k].includes(t.v)) {
        p++
        left = apply(t.v, left, level(k + 1))
      } else return left
    }
  }
  const power = (): bigint => {
    const base = unary()
    if (isOp('**')) {
      p++
      return apply('**', base, power())
    }
    return base
  }
  const unary = (): bigint => {
    if (isOp('-')) {
      p++
      return W(-unary())
    }
    if (isOp('+')) {
      p++
      return unary()
    }
    if (isOp('~')) {
      p++
      return W(~unary())
    }
    return primary()
  }
  const args = (): bigint[] => {
    const t = peek()
    if (t?.t !== '(') throw new ProgError('Expected (')
    p++
    const out: bigint[] = []
    if (peek()?.t === ')') {
      p++
      return out
    }
    for (;;) {
      out.push(level(0))
      const n = peek()
      if (n?.t === ',') p++
      else if (n?.t === ')') {
        p++
        return out
      } else throw new ProgError("Missing ')'")
    }
  }
  const call = (name: string, a: bigint[]): bigint => {
    const need = (n: number) => {
      if (a.length !== n) throw new ProgError(`${name} takes ${n} value${n > 1 ? 's' : ''}`)
    }
    switch (name.toLowerCase()) {
      case 'rol': need(2); return rot(a[0], a[1], true)
      case 'ror': need(2); return rot(a[0], a[1], false)
      case 'shl': need(2); return apply('<<', a[0], a[1])
      case 'shr': need(2); return apply('>>>', a[0], a[1])
      case 'sar': need(2); return apply('>>', a[0], a[1])
      case 'not': need(1); return W(~a[0])
      case 'and': need(2); return W(a[0] & a[1])
      case 'or': need(2); return W(a[0] | a[1])
      case 'xor': need(2); return W(a[0] ^ a[1])
      case 'popcount': case 'popcnt': {
        need(1)
        let x = u(a[0])
        let n = 0n
        while (x) {
          n += x & 1n
          x >>= 1n
        }
        return n
      }
      case 'clz': {
        need(1)
        const x = u(a[0])
        let n = 0n
        for (let b = BigInt(o.bits) - 1n; b >= 0n && !((x >> b) & 1n); b--) n++
        return n
      }
      case 'ctz': {
        need(1)
        const x = u(a[0])
        if (!x) return BigInt(o.bits)
        let n = 0n
        while (!((x >> n) & 1n)) n++
        return n
      }
      case 'abs': need(1); return W(a[0] < 0n ? -a[0] : a[0])
      case 'min': if (!a.length) throw new ProgError('min needs values'); return a.reduce((m, v) => (v < m ? v : m))
      case 'max': if (!a.length) throw new ProgError('max needs values'); return a.reduce((m, v) => (v > m ? v : m))
      case 'bit': need(2); return (u(a[0]) >> a[1]) & 1n
      case 'setbit': need(2); return W(a[0] | (1n << a[1]))
      case 'clearbit': need(2); return W(a[0] & ~(1n << a[1]))
      case 'flipbit': need(2); return W(a[0] ^ (1n << a[1]))
      case 'mod': need(2); return apply('%', a[0], a[1])
    }
    throw new ProgError(`Unknown function ${name}`)
  }
  const primary = (): bigint => {
    const t = peek()
    if (!t) throw new ProgError('Incomplete expression')
    if (t.t === 'num') {
      p++
      return W(t.v)
    }
    if (t.t === '(') {
      p++
      const v = level(0)
      if (peek()?.t !== ')') throw new ProgError("Missing ')'")
      p++
      return v
    }
    if (t.t === 'op' && ['rol', 'ror', '<<', '>>>', '>>', '&', '|', '^', '%'].includes(t.v) && toks[p + 1]?.t === '(') {
      // word operators used as functions: rol(x, 3), and(a, b)…
      const name = { '<<': 'shl', '>>>': 'shr', '>>': 'sar', '&': 'and', '|': 'or', '^': 'xor', '%': 'mod' }[t.v] ?? t.v
      p++
      return call(name, args())
    }
    if (t.t === 'name') {
      p++
      if (peek()?.t === '(') return call(t.v, args())
      const key = t.v.toLowerCase()
      if (key in vars) return W(vars[key])
      throw new ProgError(`Unknown name '${t.v}'`)
    }
    throw new ProgError('Unexpected ' + (t.t === 'op' ? t.v : t.t))
  }

  const v = level(0)
  if (p < toks.length) {
    const t = toks[p]
    throw new ProgError(t.t === ')' ? "')' has no opening bracket" : `Unexpected ${t.t === 'num' ? 'number' : t.t === 'op' || t.t === 'name' ? t.v : t.t}`)
  }
  return v
}

/** The value written in a base: two's complement for negative words outside DEC; groups of 4 (BIN/HEX) or 3 (DEC/OCT). */
export function progFormat(v: bigint, base: Base, bits: WordSize, signed: boolean, group = false): string {
  let s: string
  if (base === 10) s = (signed ? BigInt.asIntN(bits, v) : BigInt.asUintN(bits, v)).toString(10)
  else s = BigInt.asUintN(bits, v).toString(base).toUpperCase()
  if (!group) return s
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  const size = base === 2 || base === 16 ? 4 : 3
  const sep = base === 10 ? ',' : ' '
  const parts: string[] = []
  for (let i = body.length; i > 0; i -= size) parts.unshift(body.slice(Math.max(0, i - size), i))
  return (neg ? '-' : '') + parts.join(sep)
}

/** The bits of the word, most significant first (for the bit grid). */
export function bitsOf(v: bigint, bits: WordSize): number[] {
  const x = BigInt.asUintN(bits, v)
  const out: number[] = []
  for (let b = bits - 1; b >= 0; b--) out.push(Number((x >> BigInt(b)) & 1n))
  return out
}

/** The word with one bit flipped (clicking the bit grid). */
export function toggleBit(v: bigint, bit: number, o: Pick<ProgOpts, 'bits' | 'signed'>): bigint {
  return wrap(v ^ (1n << BigInt(bit)), o.bits, o.signed)
}
