// How KherveCalc writes numbers: normal / scientific / engineering / fixed,
// complex numbers as a + bi or r∠θ. Pure (no React, no OS): the engine sends
// each number as its significant digits and an exponent, and this lays them out.

/** value = sign · d.ddd… × 10^exp, `digits` without the decimal point ("inf", "nan" too). */
export interface Sci {
  sign: '' | '-'
  digits: string
  exp: number
}

export interface NumPayload {
  re: Sci
  im: Sci | null
  abs?: Sci
  arg?: Sci
}

export type NumFormat = 'normal' | 'sci' | 'eng' | 'fix'
export type AngleUnit = 'deg' | 'rad' | 'grad'
export type ComplexForm = 'rect' | 'polar'

export interface FormatOpts {
  format: NumFormat
  /** Decimals in 'fix'; significant digits shown in 'sci'/'eng' when > 0 (0 = all). */
  fix: number
  /** The precision in use (switches 'normal' to scientific beyond it). */
  digits: number
}

export interface Written {
  text: string
  latex: string
}

/** Round significant digits to n (half up); strips trailing zeros. Returns the new digits and exponent. */
export function roundDigits(digits: string, exp: number, n: number): { digits: string; exp: number } {
  if (n <= 0) return { digits: '0', exp }
  if (digits.length <= n) return { digits: digits.replace(/0+$/, '') || '0', exp }
  const head = digits.slice(0, n).split('').map(Number)
  if (Number(digits[n]) >= 5) {
    let k = n - 1
    while (k >= 0) {
      head[k]++
      if (head[k] < 10) break
      head[k] = 0
      k--
    }
    if (k < 0) {
      head.unshift(1)
      head.pop()
      exp++
    }
  }
  return { digits: head.join('').replace(/0+$/, '') || '0', exp }
}

const isZero = (n: Sci) => /^0*$/.test(n.digits)

/** d.ddd with the point after `intDigits` digits (pads with zeros either side). */
function placePoint(digits: string, intDigits: number, minDecimals = 0): string {
  let int: string
  let frac: string
  if (intDigits <= 0) {
    int = '0'
    frac = '0'.repeat(-intDigits) + digits
  } else if (intDigits >= digits.length) {
    int = digits + '0'.repeat(intDigits - digits.length)
    frac = ''
  } else {
    int = digits.slice(0, intDigits)
    frac = digits.slice(intDigits)
  }
  frac = frac.replace(/0+$/, '')
  if (frac.length < minDecimals) frac += '0'.repeat(minDecimals - frac.length)
  return frac ? `${int}.${frac}` : int
}

function special(n: Sci): Written | null {
  if (n.digits === 'inf') return { text: `${n.sign}oo`, latex: `${n.sign}\\infty` }
  if (n.digits === 'nan') return { text: 'nan', latex: '\\text{undefined}' }
  return null
}

function withExp(mant: string, exp: number, sign: string): Written {
  if (exp === 0) return { text: sign + mant, latex: sign + mant }
  return { text: `${sign}${mant}e${exp}`, latex: `${sign}${mant}\\times 10^{${exp}}` }
}

/** One real number in the chosen format. */
export function formatReal(n: Sci, o: FormatOpts): Written {
  const sp = special(n)
  if (sp) return sp
  if (isZero(n)) {
    const z = o.format === 'fix' ? placePoint('0', 1, o.fix) : '0'
    return { text: z, latex: z }
  }
  const sign = n.sign
  if (o.format === 'fix') {
    // keep `fix` decimals: exp + 1 + fix significant digits
    const keep = n.exp + 1 + o.fix
    if (keep <= 0) {
      // rounds to 0.000…, or to the last decimal when the next digit rounds up
      const up = keep === 0 && Number(n.digits[0]) >= 5
      const s = up ? placePoint('1', -o.fix + 1, o.fix) : placePoint('0', 1, o.fix)
      const sg = up ? sign : ''
      return { text: sg + s, latex: sg + s }
    }
    const r = roundDigits(n.digits, n.exp, keep)
    const s = placePoint(r.digits, r.exp + 1, o.fix)
    return { text: sign + s, latex: sign + s }
  }
  const sigs = o.fix > 0 && o.format !== 'normal' ? o.fix : o.digits
  const r = roundDigits(n.digits, n.exp, Math.max(1, sigs))
  if (o.format === 'sci') return withExp(placePoint(r.digits, 1), r.exp, sign)
  if (o.format === 'eng') {
    const e3 = Math.floor(r.exp / 3) * 3
    return withExp(placePoint(r.digits, r.exp - e3 + 1), e3, sign)
  }
  // normal: plain while it fits the precision, scientific beyond
  if (r.exp >= -5 && r.exp < Math.max(o.digits, 1)) {
    const s = placePoint(r.digits, r.exp + 1)
    return { text: sign + s, latex: sign + s }
  }
  return withExp(placePoint(r.digits, 1), r.exp, sign)
}

/** A real or complex value: a + bi, or r∠θ (θ in the angle unit). */
export function formatNumber(num: NumPayload, o: FormatOpts, form: ComplexForm = 'rect', angle: AngleUnit = 'rad'): Written {
  if (!num.im || isZero(num.im)) return formatReal(num.re, o)
  if (form === 'polar' && num.abs && num.arg) {
    const r = formatReal(num.abs, o)
    const t = formatReal(num.arg, o)
    const deg = angle === 'deg'
    const grad = angle === 'grad'
    return {
      text: `${r.text}∠${t.text}${deg ? '°' : ''}`,
      latex: `${r.latex}\\angle ${t.latex}${deg ? '^{\\circ}' : grad ? '^{\\mathrm{g}}' : ''}`,
    }
  }
  const im = formatReal({ ...num.im, sign: '' }, o)
  const imUnit = im.text === '1' ? '' : im.text
  const imUnitLatex = im.latex === '1' ? '' : im.latex
  if (isZero(num.re)) {
    const s = num.im.sign
    return { text: `${s}${imUnit}${imUnit ? '*' : ''}i`, latex: `${s}${imUnitLatex}\\,i` }
  }
  const re = formatReal(num.re, o)
  const op = num.im.sign === '-' ? '-' : '+'
  return { text: `${re.text} ${op} ${imUnit}${imUnit ? '*' : ''}i`, latex: `${re.latex} ${op} ${imUnitLatex}\\,i` }
}

/** Plain JS number -> Sci (for statistics and graph values computed in the browser). */
export function sciOf(v: number, digits = 15): Sci {
  if (!Number.isFinite(v)) return { sign: v < 0 ? '-' : '', digits: Number.isNaN(v) ? 'nan' : 'inf', exp: 0 }
  if (v === 0) return { sign: '', digits: '0', exp: 0 }
  const [m, e] = Math.abs(v).toExponential(Math.min(Math.max(digits, 1), 100) - 1).split('e')
  return { sign: v < 0 ? '-' : '', digits: m.replace('.', '').replace(/0+$/, '') || '0', exp: Number(e) }
}

/** A plain number written compactly (tables, axes, statistics). */
export function fmt(v: number | null | undefined, digits = 10): string {
  if (v === null || v === undefined) return '—'
  if (Number.isNaN(v)) return 'undef'
  return formatReal(sciOf(v, digits), { format: 'normal', fix: 0, digits }).text
}
