// Code 128 barcodes (pure): code sets A, B and C, the check digit, and an SVG drawing. Used on the sample labels.
// The pattern table is the standard one (6 elements per symbol: bar, space, bar, space, bar, space, widths in modules;
// the stop symbol has 7); the tests check every row sums to 11 modules and that known check digits come out.

export const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

export const START_A = 103
export const START_B = 104
export const START_C = 105
export const STOP = 106
const CODE_A = 101 // "Code A" in sets B and C
const CODE_B = 100
const CODE_C = 99

export type CodeSet = 'A' | 'B' | 'C'

export class BarcodeError extends Error {}

/** The symbol values of a text: start, data (with set switches), check digit and stop. */
export function encodeValues(text: string, force?: CodeSet): number[] {
  if (!text) throw new BarcodeError('Nothing to encode.')
  for (const ch of text) if (ch.charCodeAt(0) > 126 || ch.charCodeAt(0) < 0) throw new BarcodeError(`“${ch}” cannot be written in Code 128 (ASCII only).`)
  const values: number[] = []
  let set: CodeSet
  const aVal = (c: number): number => (c < 32 ? c + 64 : c - 32)
  const bVal = (c: number): number => c - 32
  const chars = [...text].map((c) => c.charCodeAt(0))
  if (force) {
    set = force
    if (force === 'C') {
      if (!/^\d+$/.test(text) || text.length % 2) throw new BarcodeError('Code set C needs an even number of digits.')
    }
    if (force === 'B' && chars.some((c) => c < 32)) throw new BarcodeError('Control characters need code set A.')
    if (force === 'A' && chars.some((c) => c > 95)) throw new BarcodeError('Lower-case letters need code set B.')
    values.push(set === 'A' ? START_A : set === 'B' ? START_B : START_C)
    if (set === 'C') for (let i = 0; i < chars.length; i += 2) values.push(Number(text.slice(i, i + 2)))
    else for (const c of chars) values.push(set === 'A' ? aVal(c) : bVal(c))
  } else {
    // a run of at least 4 digits (any length ≥ 2 when the whole text is digits) goes in set C; the rest in B (A for controls)
    const segs: Array<{ set: CodeSet; text: string }> = []
    let buf = ''
    const flush = () => {
      // control characters exist only in set A, so they get their own runs
      for (const m of buf.matchAll(/[\x00-\x1f]+|[^\x00-\x1f]+/g)) segs.push({ set: m[0].charCodeAt(0) < 32 ? 'A' : 'B', text: m[0] })
      buf = ''
    }
    let i = 0
    while (i < text.length) {
      const run = /^\d*/.exec(text.slice(i))![0]
      if (run.length >= (i === 0 && run.length === text.length ? 2 : 4)) {
        let from = i
        if (run.length % 2) { buf += text[i]; from = i + 1 } // the odd digit goes before the pairs
        flush()
        segs.push({ set: 'C', text: text.slice(from, i + run.length) })
        i += run.length
      } else { buf += text[i]; i++ }
    }
    flush()
    segs.forEach((r, k) => {
      if (k === 0) values.push(r.set === 'A' ? START_A : r.set === 'B' ? START_B : START_C)
      else values.push(r.set === 'A' ? CODE_A : r.set === 'B' ? CODE_B : CODE_C)
      if (r.set === 'C') for (let q = 0; q < r.text.length; q += 2) values.push(Number(r.text.slice(q, q + 2)))
      else for (const ch of r.text) values.push(r.set === 'A' ? aVal(ch.charCodeAt(0)) : bVal(ch.charCodeAt(0)))
    })
  }
  values.push(checkDigit(values))
  values.push(STOP)
  return values
}

/** The check symbol: (start + Σ position × value) mod 103. `values` is the start symbol followed by the data. */
export function checkDigit(values: readonly number[]): number {
  let sum = values[0]
  for (let i = 1; i < values.length; i++) sum += i * values[i]
  return sum % 103
}

/** Bar and space widths in modules for a text, starting with a bar (11 modules per symbol, 13 for the stop). */
export function modules(text: string, force?: CodeSet): number[] {
  return encodeValues(text, force).flatMap((v) => [...PATTERNS[v]].map(Number))
}

/** Reads a symbol sequence back to text (used by the tests): returns null when the check digit is wrong. */
export function decodeValues(values: readonly number[]): string | null {
  const data = values.slice(0, -2)
  if (values[values.length - 1] !== STOP || checkDigit(data) !== values[values.length - 2]) return null
  let set: CodeSet = data[0] === START_A ? 'A' : data[0] === START_B ? 'B' : 'C'
  let out = ''
  for (const v of data.slice(1)) {
    if (set !== 'C' && v === CODE_C) { set = 'C'; continue }
    if (v === CODE_B && set !== 'B') { set = 'B'; continue }
    if (v === CODE_A && set !== 'A') { set = 'A'; continue }
    if (set === 'C') out += String(v).padStart(2, '0')
    else if (set === 'B') out += String.fromCharCode(v + 32)
    else out += String.fromCharCode(v < 64 ? v + 32 : v - 64)
  }
  return out
}

/** Symbol values from a module sequence (the inverse of `modules`), or null for an unknown pattern. */
export function valuesFromModules(widths: readonly number[]): number[] | null {
  const out: number[] = []
  let i = 0
  while (i < widths.length) {
    const take = i + 7 <= widths.length && widths.slice(i, i + 7).join('') === PATTERNS[STOP] ? 7 : 6
    const v = PATTERNS.indexOf(widths.slice(i, i + take).join(''))
    if (v < 0) return null
    out.push(v)
    i += take
  }
  return out
}

export interface BarcodeStyle {
  /** Width of one module in SVG units. */
  module?: number
  height?: number
  /** Print the text under the bars. */
  caption?: boolean
  /** Bar colour (default black). */
  color?: string
  /** Quiet zone, in modules (default 10). */
  quiet?: number
}

const escXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The barcode as an SVG string (bars as one path, white background). */
export function code128Svg(text: string, style: BarcodeStyle = {}): string {
  const m = style.module ?? 1.6
  const quiet = (style.quiet ?? 10) * m
  const barH = style.height ?? 40
  const widths = modules(text)
  const total = widths.reduce((a, b) => a + b, 0) * m + 2 * quiet
  const captionH = style.caption === false ? 0 : 13
  let x = quiet
  let path = ''
  widths.forEach((w, i) => {
    if (i % 2 === 0) path += `M${x.toFixed(2)} 0h${(w * m).toFixed(2)}v${barH}h-${(w * m).toFixed(2)}z`
    x += w * m
  })
  const H = barH + captionH
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total.toFixed(2)}" height="${H}" viewBox="0 0 ${total.toFixed(2)} ${H}"><rect width="${total.toFixed(2)}" height="${H}" fill="#fff"/>` +
    `<path d="${path}" fill="${style.color ?? '#000'}"/>` +
    (captionH ? `<text x="${(total / 2).toFixed(2)}" y="${barH + 10}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="10" fill="#000">${escXml(text)}</text>` : '') + '</svg>'
}

/** Width of a barcode in modules (for layout). */
export const barcodeModules = (text: string, quiet = 10): number => modules(text).reduce((a, b) => a + b, 0) + 2 * quiet
