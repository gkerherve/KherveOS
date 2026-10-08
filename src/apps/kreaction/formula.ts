// Molecular formulas for kReaction: parsing "Ca(OH)2", "CuSO4·5H2O", "SO4^2-", "NH4+" into atom counts and a
// charge, the Hill formula, molar mass and typesetting. Pure functions (no React, no RDKit).

export type Counts = Record<string, number>

export interface Composition {
  atoms: Counts
  charge: number
}

/** Standard atomic weights (g/mol) of the elements chemists meet. */
export const ATOMIC_WEIGHTS: Readonly<Record<string, number>> = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998, Ne: 20.18,
  Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
  K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693,
  Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798,
  Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.91, Pd: 106.42,
  Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.6, I: 126.9, Xe: 131.29,
  Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Pr: 140.91, Nd: 144.24, Pm: 145, Sm: 150.36, Eu: 151.96, Gd: 157.25,
  Tb: 158.93, Dy: 162.5, Ho: 164.93, Er: 167.26, Tm: 168.93, Yb: 173.05, Lu: 174.97,
  Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08, Au: 196.97, Hg: 200.59,
  Tl: 204.38, Pb: 207.2, Bi: 208.98, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226, Ac: 227, Th: 232.04, Pa: 231.04,
  U: 238.03, Np: 237, Pu: 244, Am: 243, Cm: 247,
}

export function isElement(sym: string): boolean {
  return Object.prototype.hasOwnProperty.call(ATOMIC_WEIGHTS, sym)
}

const SUPERSCRIPT: Record<string, string> = {
  '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-',
}
const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'

/** Unicode sub- and superscripts, minus signs and dots → plain ASCII ("Fe₂O₃" → "Fe2O3", "SO₄²⁻" → "SO4^2-"). */
export function normalize(input: string): string {
  let s = input.trim().replace(/[−–—]/g, '-').replace(/[•∙⋅]/g, '·')
  let out = ''
  let sup = false
  for (const ch of s) {
    const si = SUBSCRIPT.indexOf(ch)
    if (si >= 0) {
      out += String(si)
      sup = false
    } else if (SUPERSCRIPT[ch] !== undefined) {
      if (!sup) out += '^'
      out += SUPERSCRIPT[ch]
      sup = true
    } else {
      out += ch
      sup = false
    }
  }
  s = out
  return s
}

/** Splits a trailing charge off a formula: "SO4^2-" → body "SO4", charge −2. */
export function splitCharge(raw: string): { body: string; charge: number } {
  let s = normalize(raw).replace(/\s+/g, '')
  let m = /\^\{?(\d*)([+-]+)\}?$/.exec(s)
  if (m) {
    const n = m[1] ? Number(m[1]) : m[2].length
    return { body: s.slice(0, m.index), charge: (m[2][0] === '+' ? 1 : -1) * n }
  }
  m = /([+-]+)$/.exec(s)
  if (!m || m.index === 0) return { body: s, charge: 0 }
  const sign = m[1][0] === '+' ? 1 : -1
  let body = s.slice(0, m.index)
  let n = m[1].length
  const digits = /(\d+)$/.exec(body)
  if (digits && m[1].length === 1) {
    const before = body.slice(0, digits.index)
    // Fe3+ (one atom with a digit) or SO42- (two digits: the last is the charge); NH4+ and NO3- keep their subscript.
    const singleAtom = /^[A-Z][a-z]?$/.test(before)
    if (singleAtom) {
      n = Number(digits[1])
      body = before
    } else if (digits[1].length >= 2) {
      n = Number(digits[1].slice(-1))
      body = body.slice(0, -1)
    }
  }
  return { body, charge: sign * n }
}

function addInto(target: Counts, src: Counts, times: number): void {
  for (const [k, v] of Object.entries(src)) target[k] = (target[k] ?? 0) + v * times
}

/** Atom counts of a charge-free formula body: "Ca(OH)2", "K4[Fe(CN)6]", "CuSO4·5H2O". Throws a readable Error. */
export function parseBody(body: string): Counts {
  const parts = body.split(/[·*]|\.(?=\d*[A-Z(\[])/)
  const total: Counts = {}
  for (let part of parts) {
    if (part === '') continue
    let mult = 1
    const lead = /^(\d+)(?=[A-Z(\[])/.exec(part)
    if (lead && parts.length > 1) {
      mult = Number(lead[1])
      part = part.slice(lead[0].length)
    }
    addInto(total, parseGroup(part), mult)
  }
  if (Object.keys(total).length === 0) throw new Error('Empty formula.')
  return total
}

function parseGroup(s: string): Counts {
  const stack: Counts[] = [{}]
  const closers: string[] = []
  let i = 0
  const readNum = (): number => {
    const m = /^\d+/.exec(s.slice(i))
    if (!m) return 1
    i += m[0].length
    return Number(m[0])
  }
  while (i < s.length) {
    const ch = s[i]
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({})
      closers.push(ch === '(' ? ')' : ch === '[' ? ']' : '}')
      i++
    } else if (ch === ')' || ch === ']' || ch === '}') {
      if (closers.pop() !== ch || stack.length < 2) throw new Error(`Unmatched "${ch}" in ${s}.`)
      i++
      const inner = stack.pop() as Counts
      addInto(stack[stack.length - 1], inner, readNum())
    } else if (/[A-Z]/.test(ch)) {
      let sym = ch
      if (/[a-z]/.test(s[i + 1] ?? '')) sym += s[i + 1]
      if (!isElement(sym) && sym.length === 2 && isElement(ch)) sym = ch // "Cl" vs "C" + "l" is handled by the table
      if (!isElement(sym)) throw new Error(`"${sym}" is not an element.`)
      i += sym.length
      addInto(stack[stack.length - 1], { [sym]: 1 }, readNum())
    } else {
      throw new Error(`Unexpected "${ch}" in ${s}.`)
    }
  }
  if (stack.length !== 1) throw new Error(`Unclosed bracket in ${s}.`)
  return stack[0]
}

/** A formula with an optional charge and phase: "Fe^3+", "NO3-", "H2O(l)", "e-". */
export function parseFormula(raw: string): Composition {
  let s = normalize(raw).replace(/\s+/g, '')
  s = s.replace(/\((?:s|l|g|aq)\)$/i, '')
  if (/^e-?$/.test(s)) return { atoms: {}, charge: -1 }
  const { body, charge } = splitCharge(s)
  return { atoms: parseBody(body), charge }
}

/** Hill order: C first, H second, then alphabetical (no carbon: all alphabetical). */
export function hillFormula(atoms: Counts, charge = 0): string {
  const keys = Object.keys(atoms).filter((k) => atoms[k] !== 0)
  const hasC = keys.includes('C')
  keys.sort((a, b) => {
    const rank = (k: string) => (hasC ? (k === 'C' ? 0 : k === 'H' ? 1 : 2) : 2)
    return rank(a) - rank(b) || a.localeCompare(b)
  })
  let out = keys.map((k) => (atoms[k] === 1 ? k : `${k}${atoms[k]}`)).join('')
  if (charge !== 0) out += chargeText(charge)
  return out
}

/** "+" / "2−" / "3+" … (a real minus sign). */
export function chargeText(charge: number): string {
  if (charge === 0) return ''
  const n = Math.abs(charge)
  return `${n === 1 ? '' : n}${charge > 0 ? '+' : '−'}`
}

export function molarMass(atoms: Counts): number {
  let m = 0
  for (const [k, v] of Object.entries(atoms)) {
    const w = ATOMIC_WEIGHTS[k]
    if (w === undefined) throw new Error(`"${k}" is not an element.`)
    m += w * v
  }
  return m
}

export function atomCount(atoms: Counts): number {
  return Object.values(atoms).reduce((s, v) => s + v, 0)
}

export function sumCounts(list: { atoms: Counts; coeff?: number }[]): Counts {
  const out: Counts = {}
  for (const s of list) addInto(out, s.atoms, s.coeff ?? 1)
  return out
}

export function sameCounts(a: Counts, b: Counts): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false
  return true
}

export interface TypesetPart {
  text: string
  kind: 'n' | 'sub' | 'sup'
}

/** A formula as runs of normal, subscript and superscript text (for display). */
export function typeset(formula: string, charge = 0): TypesetPart[] {
  const parts: TypesetPart[] = []
  const push = (text: string, kind: TypesetPart['kind']) => {
    const last = parts[parts.length - 1]
    if (last && last.kind === kind) last.text += text
    else parts.push({ text, kind })
  }
  for (const m of formula.matchAll(/(\d+)|([^\d]+)/g)) {
    if (m[1]) {
      const before = parts.length ? parts[parts.length - 1].text.slice(-1) : ''
      // a number right after "·" or at the start is a multiplier, after a letter or bracket a subscript
      push(m[1], /[A-Za-z)\]]/.test(before) ? 'sub' : 'n')
    } else push(m[2], 'n')
  }
  if (charge !== 0) push(chargeText(charge), 'sup')
  return parts
}

/** Numbers for display: 4 significant figures, no trailing zeros. */
export function num(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e5 || a < 1e-3) return x.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e').replace('e+', 'e')
  return String(Number(x.toPrecision(digits)))
}
