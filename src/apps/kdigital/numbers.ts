// Number systems and arithmetic: bases, two's complement, sign-magnitude, Gray, BCD, fixed point, IEEE-754 half /
// single / double (bit fields, encoding, decoding), binary add / subtract / multiply / divide with the working
// shown, the flags, and the ASCII table. Uses BigInt, so any width works. Pure.

export type Base = 2 | 8 | 10 | 16

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

/** Reads an integer: optional sign, optional 0b / 0o / 0x prefix, spaces and underscores ignored. Null when it is not one. */
export function parseInteger(text: string, base: Base = 10): bigint | null {
  let s = text.trim().replace(/[\s_]/g, '').toLowerCase()
  if (!s) return null
  let neg = false
  if (s[0] === '-' || s[0] === '+') { neg = s[0] === '-'; s = s.slice(1) }
  let b = BigInt(base)
  if (s.startsWith('0x')) { b = 16n; s = s.slice(2) } else if (s.startsWith('0b')) { b = 2n; s = s.slice(2) } else if (s.startsWith('0o')) { b = 8n; s = s.slice(2) }
  if (!s) return null
  let v = 0n
  for (const ch of s) {
    const d = DIGITS.indexOf(ch)
    if (d < 0 || BigInt(d) >= b) return null
    v = v * b + BigInt(d)
  }
  return neg ? -v : v
}

export function toBase(v: bigint, base: Base | number, minDigits = 1): string {
  const neg = v < 0n
  let n = neg ? -v : v
  const b = BigInt(base)
  let s = ''
  if (n === 0n) s = '0'
  while (n > 0n) { s = DIGITS[Number(n % b)] + s; n /= b }
  return (neg ? '-' : '') + s.padStart(minDigits, '0')
}

const mask = (bits: number): bigint => (1n << BigInt(bits)) - 1n

export const minSigned = (bits: number): bigint => -(1n << BigInt(bits - 1))
export const maxSigned = (bits: number): bigint => (1n << BigInt(bits - 1)) - 1n
export const maxUnsigned = (bits: number): bigint => mask(bits)

/** Bit string (MSB first) of an unsigned value in `bits` bits. */
export const bitString = (v: bigint, bits: number): string => (v & mask(bits)).toString(2).padStart(bits, '0')

/** Two's-complement bit string of a signed value; null when it does not fit. */
export function twosComplement(v: bigint, bits: number): string | null {
  if (v < minSigned(bits) || v > maxSigned(bits)) return null
  return bitString(v, bits)
}

export function fromTwos(s: string): bigint {
  const bits = s.length
  const u = BigInt('0b' + (s || '0'))
  return u >= 1n << BigInt(bits - 1) ? u - (1n << BigInt(bits)) : u
}

export function signMagnitude(v: bigint, bits: number): string | null {
  const m = v < 0n ? -v : v
  if (m > mask(bits - 1)) return null
  return (v < 0n ? '1' : '0') + m.toString(2).padStart(bits - 1, '0')
}

export function fromSignMagnitude(s: string): bigint {
  const m = BigInt('0b' + (s.slice(1) || '0'))
  return s[0] === '1' ? -m : m
}

export function onesComplement(v: bigint, bits: number): string | null {
  if (v < -mask(bits - 1) || v > mask(bits - 1)) return null
  return v < 0n ? bitString(~(-v), bits) : bitString(v, bits)
}

export function fromOnesComplement(s: string): bigint {
  return s[0] === '1' ? -BigInt('0b' + s.split('').map((c) => (c === '1' ? '0' : '1')).join('')) : BigInt('0b' + s)
}

export const grayEncode = (n: bigint): bigint => n ^ (n >> 1n)
export function grayDecode(g: bigint): bigint {
  let n = g
  for (let s = g >> 1n; s > 0n; s >>= 1n) n ^= s
  return n
}

/** Packed BCD of a non-negative integer ("0001 0010" for 12); null for a negative number. */
export function toBcd(v: bigint): string | null {
  if (v < 0n) return null
  return v.toString(10).split('').map((d) => Number(d).toString(2).padStart(4, '0')).join(' ')
}

export function fromBcd(s: string): bigint | null {
  const clean = s.replace(/\s/g, '')
  if (!clean || clean.length % 4 !== 0 || /[^01]/.test(clean)) return null
  let out = ''
  for (let i = 0; i < clean.length; i += 4) {
    const d = parseInt(clean.slice(i, i + 4), 2)
    if (d > 9) return null
    out += d
  }
  return BigInt(out)
}

export interface Representations {
  value: bigint
  bits: number
  unsigned: string | null
  twos: string | null
  signMag: string | null
  ones: string | null
  gray: string | null
  bcd: string | null
  octal: string
  decimal: string
  hex: string
  fits: { unsigned: boolean; signed: boolean }
}

/** Every representation of an integer in a given width (null where the number does not fit). */
export function representations(v: bigint, bits: number): Representations {
  const unsigned = v >= 0n && v <= mask(bits)
  const signed = v >= minSigned(bits) && v <= maxSigned(bits)
  const u = v & mask(bits)
  return {
    value: v, bits,
    unsigned: unsigned ? bitString(v, bits) : null,
    twos: twosComplement(v, bits),
    signMag: signMagnitude(v, bits),
    ones: onesComplement(v, bits),
    gray: unsigned ? bitString(grayEncode(v), bits) : null,
    bcd: toBcd(v),
    octal: toBase(u, 8, Math.ceil(bits / 3)),
    decimal: v.toString(10),
    hex: toBase(u, 16, Math.ceil(bits / 4)).toUpperCase(),
    fits: { unsigned, signed },
  }
}

// ------------------------------------------------------------------------------ fixed point

export interface FixedPoint { bits: string; value: number; error: number; overflow: boolean }

/** Qm.n: `intBits` integer bits (including the sign when signed) and `fracBits` fractional bits. Rounds to nearest. */
export function toFixed(x: number, intBits: number, fracBits: number, signed: boolean): FixedPoint {
  const total = intBits + fracBits
  const scaled = Math.round(x * 2 ** fracBits)
  const lo = signed ? -(2 ** (total - 1)) : 0
  const hi = signed ? 2 ** (total - 1) - 1 : 2 ** total - 1
  const overflow = scaled < lo || scaled > hi
  const clamped = Math.min(hi, Math.max(lo, scaled))
  const raw = BigInt(clamped) & mask(total)
  const value = clamped / 2 ** fracBits
  return { bits: raw.toString(2).padStart(total, '0'), value, error: value - x, overflow }
}

export function fromFixed(bits: string, fracBits: number, signed: boolean): number {
  const n = signed ? fromTwos(bits) : BigInt('0b' + (bits || '0'))
  return Number(n) / 2 ** fracBits
}

// ------------------------------------------------------------------------------ IEEE-754

export interface FloatFormat { name: string; expBits: number; fracBits: number; bias: number }

export const FORMATS: Record<'half' | 'single' | 'double', FloatFormat> = {
  half: { name: 'half (binary16)', expBits: 5, fracBits: 10, bias: 15 },
  single: { name: 'single (binary32)', expBits: 8, fracBits: 23, bias: 127 },
  double: { name: 'double (binary64)', expBits: 11, fracBits: 52, bias: 1023 },
}

export const formatWidth = (f: FloatFormat): number => 1 + f.expBits + f.fracBits

export type FloatClass = 'zero' | 'subnormal' | 'normal' | 'infinity' | 'nan'

export interface FloatFields {
  sign: string
  exponent: string
  fraction: string
  cls: FloatClass
  /** the unbiased exponent (for normal numbers; the minimum for subnormals) */
  exp: number
  /** the value as a JS number (rounded for the formats that are wider than a double — none here) */
  value: number
  /** the exact value written out in decimal */
  exact: string
}

/** Splits a bit string into its fields and decodes it. */
export function decodeFloat(bits: string, f: FloatFormat): FloatFields {
  const w = formatWidth(f)
  const s = bits.padStart(w, '0').slice(-w)
  const sign = s[0]
  const exponent = s.slice(1, 1 + f.expBits)
  const fraction = s.slice(1 + f.expBits)
  const e = parseInt(exponent, 2)
  const frac = BigInt('0b' + fraction)
  const allOnes = (1 << f.expBits) - 1
  const neg = sign === '1'
  if (e === allOnes) {
    if (frac === 0n) return { sign, exponent, fraction, cls: 'infinity', exp: allOnes - f.bias, value: neg ? -Infinity : Infinity, exact: neg ? '−∞' : '+∞' }
    return { sign, exponent, fraction, cls: 'nan', exp: allOnes - f.bias, value: NaN, exact: 'NaN' }
  }
  const emin = 1 - f.bias
  let sig: bigint
  let exp: number
  let cls: FloatClass
  if (e === 0) { sig = frac; exp = emin; cls = frac === 0n ? 'zero' : 'subnormal' } else { sig = (1n << BigInt(f.fracBits)) | frac; exp = e - f.bias; cls = 'normal' }
  const pow = exp - f.fracBits // value = sig × 2^pow
  const mag = Number(sig) * 2 ** pow
  return { sign, exponent, fraction, cls, exp, value: neg ? -mag : mag, exact: exactDecimal(sig, pow, neg) }
}

/** sig × 2^pow written exactly in decimal. */
export function exactDecimal(sig: bigint, pow: number, neg: boolean): string {
  if (sig === 0n) return neg ? '−0' : '0'
  let text: string
  if (pow >= 0) text = (sig << BigInt(pow)).toString()
  else {
    // sig / 2^k = sig × 5^k / 10^k
    const k = -pow
    const digits = (sig * 5n ** BigInt(k)).toString().padStart(k + 1, '0')
    const int = digits.slice(0, digits.length - k)
    const frac = digits.slice(digits.length - k).replace(/0+$/, '')
    text = frac ? `${int}.${frac}` : int
  }
  return (neg ? '−' : '') + text
}

/** Encodes a JS number in an IEEE-754 format (round to nearest, ties to even). */
export function encodeFloat(x: number, f: FloatFormat): string {
  const w = formatWidth(f)
  const allOnes = (1 << f.expBits) - 1
  const neg = x < 0 || Object.is(x, -0)
  const sign = neg ? '1' : '0'
  const field = (e: number, frac: bigint) => sign + e.toString(2).padStart(f.expBits, '0') + frac.toString(2).padStart(f.fracBits, '0')
  if (Number.isNaN(x)) return '0' + '1'.repeat(f.expBits) + '1' + '0'.repeat(f.fracBits - 1)
  if (!Number.isFinite(x)) return field(allOnes, 0n)
  if (x === 0) return field(0, 0n)
  // |x| = M × 2^q exactly, with M a 53-bit integer
  const dv = new DataView(new ArrayBuffer(8))
  dv.setFloat64(0, Math.abs(x))
  const hi = dv.getUint32(0)
  const lo = dv.getUint32(4)
  const be = (hi >>> 20) & 0x7ff
  let M = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let q: number
  if (be === 0) q = -1074
  else { M |= 1n << 52n; q = be - 1075 }
  const msb = M.toString(2).length - 1
  const E = q + msb // |x| in [2^E, 2^(E+1))
  const emin = 1 - f.bias
  const p = f.fracBits
  const target = Math.max(E, emin) // exponent of the leading bit, or the subnormal exponent
  const k = target - p // the quantum is 2^k
  const shift = q - k // |x| / 2^k = M × 2^shift
  let N: bigint
  if (shift >= 0) N = M << BigInt(shift)
  else {
    const sh = BigInt(-shift)
    N = M >> sh
    const rem = M & ((1n << sh) - 1n)
    const half = 1n << (sh - 1n)
    if (rem > half || (rem === half && (N & 1n) === 1n)) N += 1n
  }
  let e = target
  if (N >= 1n << BigInt(p + 1)) { N >>= 1n; e += 1 } // rounding carried into the next binade
  if (N < 1n << BigInt(p)) return field(0, N) // subnormal (or zero after rounding)
  const biased = e + f.bias
  if (biased >= allOnes) return field(allOnes, 0n) // overflow → infinity
  void w
  return field(biased, N - (1n << BigInt(p)))
}

/** Round-trips a number through a format: what is actually stored. */
export function roundToFormat(x: number, f: FloatFormat): number {
  return decodeFloat(encodeFloat(x, f), f).value
}

// ------------------------------------------------------------------------------ arithmetic with the working

export interface Flags { Z: boolean; N: boolean; C: boolean; V: boolean }

export interface AddResult {
  a: string
  b: string
  /** carry into each column (index 0 = least significant) */
  carries: number[]
  sum: string
  carryOut: number
  flags: Flags
  unsigned: { a: bigint; b: bigint; result: bigint; overflow: boolean }
  signed: { a: bigint; b: bigint; result: bigint; overflow: boolean }
}

export function addBits(a: bigint, b: bigint, bits: number, carryIn = 0): AddResult {
  const A = bitString(a, bits)
  const B = bitString(b, bits)
  const carries: number[] = []
  let c = carryIn
  let sum = ''
  for (let i = bits - 1; i >= 0; i--) {
    carries[bits - 1 - i] = c
    const x = Number(A[i]), y = Number(B[i])
    sum = String(x ^ y ^ c) + sum
    c = (x & y) | (c & (x ^ y))
  }
  const cin = carries[bits - 1]
  const V = (cin ^ c) === 1
  const ua = BigInt('0b' + A), ub = BigInt('0b' + B)
  const sa = fromTwos(A), sb = fromTwos(B)
  const ur = ua + ub + BigInt(carryIn)
  const sr = sa + sb + BigInt(carryIn)
  return {
    a: A, b: B, carries, sum, carryOut: c,
    flags: { Z: /^0+$/.test(sum), N: sum[0] === '1', C: c === 1, V },
    unsigned: { a: ua, b: ub, result: ur, overflow: ur > mask(bits) },
    signed: { a: sa, b: sb, result: sr, overflow: sr < minSigned(bits) || sr > maxSigned(bits) },
  }
}

/** A − B as A + ¬B + 1; the carry flag means "no borrow". */
export function subBits(a: bigint, b: bigint, bits: number): AddResult & { notB: string } {
  const notB = bitString(~b, bits)
  const r = addBits(a, BigInt('0b' + notB), bits, 1)
  const ua = BigInt('0b' + r.a), ub = BigInt('0b' + bitString(b, bits))
  const sa = fromTwos(r.a), sb = fromTwos(bitString(b, bits))
  return {
    ...r, notB, unsigned: { a: ua, b: ub, result: ua - ub, overflow: ua < ub },
    signed: { a: sa, b: sb, result: sa - sb, overflow: sa - sb < minSigned(bits) || sa - sb > maxSigned(bits) },
  }
}

export interface MulResult {
  a: string
  b: string
  /** one row per multiplier bit (LSB first): the partial product, shifted */
  partials: { bit: string; row: string; shift: number }[]
  product: string
  unsigned: bigint
  signed: bigint
  /** the running sum after each partial product */
  running: string[]
}

export function mulBits(a: bigint, b: bigint, bits: number): MulResult {
  const A = bitString(a, bits)
  const B = bitString(b, bits)
  const ua = BigInt('0b' + A)
  const ub = BigInt('0b' + B)
  const partials: MulResult['partials'] = []
  const running: string[] = []
  let acc = 0n
  for (let i = 0; i < bits; i++) {
    const bit = B[bits - 1 - i]
    const row = bit === '1' ? ua << BigInt(i) : 0n
    partials.push({ bit, row: row.toString(2).padStart(2 * bits, '0'), shift: i })
    acc += row
    running.push(acc.toString(2).padStart(2 * bits, '0'))
  }
  return { a: A, b: B, partials, product: acc.toString(2).padStart(2 * bits, '0'), unsigned: ua * ub, signed: fromTwos(A) * fromTwos(B), running }
}

export interface DivStep { step: number; remainder: string; bringDown: string; trial: string; subtracted: boolean; quotientBit: string }

export interface DivResult {
  dividend: string
  divisor: string
  quotient: string
  remainder: string
  steps: DivStep[]
}

/** Restoring division of unsigned numbers. */
export function divBits(a: bigint, b: bigint, bits: number): DivResult {
  if (b === 0n) throw new Error('Division by zero.')
  const A = bitString(a, bits)
  const ub = BigInt('0b' + bitString(b, bits))
  if (ub === 0n) throw new Error('Division by zero.')
  let r = 0n
  let q = ''
  const steps: DivStep[] = []
  for (let i = 0; i < bits; i++) {
    r = (r << 1n) | BigInt(A[i])
    const before = r
    const sub = r >= ub
    if (sub) r -= ub
    q += sub ? '1' : '0'
    steps.push({ step: i + 1, remainder: bitString(before, bits + 1), bringDown: A[i], trial: bitString(before - ub, bits + 1), subtracted: sub, quotientBit: sub ? '1' : '0' })
  }
  return { dividend: A, divisor: bitString(ub, bits), quotient: q, remainder: bitString(r, bits), steps }
}

// ------------------------------------------------------------------------------ ASCII

const CONTROL = ['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'HT', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI', 'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US']
const CONTROL_NAME: Record<string, string> = { NUL: 'null', SOH: 'start of heading', STX: 'start of text', ETX: 'end of text', EOT: 'end of transmission', ENQ: 'enquiry', ACK: 'acknowledge', BEL: 'bell', BS: 'backspace', HT: 'horizontal tab', LF: 'line feed', VT: 'vertical tab', FF: 'form feed', CR: 'carriage return', SO: 'shift out', SI: 'shift in', DLE: 'data link escape', DC1: 'device control 1 (XON)', DC2: 'device control 2', DC3: 'device control 3 (XOFF)', DC4: 'device control 4', NAK: 'negative acknowledge', SYN: 'synchronous idle', ETB: 'end of block', CAN: 'cancel', EM: 'end of medium', SUB: 'substitute', ESC: 'escape', FS: 'file separator', GS: 'group separator', RS: 'record separator', US: 'unit separator' }

export interface AsciiRow { code: number; char: string; name: string; control: boolean; bin: string; oct: string; dec: string; hex: string }

export function asciiTable(): AsciiRow[] {
  const rows: AsciiRow[] = []
  for (let c = 0; c < 128; c++) {
    let char: string
    let name: string
    const control = c < 32 || c === 127
    if (c < 32) { char = CONTROL[c]; name = CONTROL_NAME[char] }
    else if (c === 127) { char = 'DEL'; name = 'delete' }
    else if (c === 32) { char = 'SP'; name = 'space' }
    else { char = String.fromCharCode(c); name = '' }
    rows.push({ code: c, char, name, control, bin: c.toString(2).padStart(7, '0'), oct: c.toString(8).padStart(3, '0'), dec: String(c), hex: c.toString(16).toUpperCase().padStart(2, '0') })
  }
  return rows
}

/** The ASCII code of one character, or null when it is outside 0–127. */
export const asciiCode = (ch: string): number | null => (ch.length >= 1 && ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : null)
