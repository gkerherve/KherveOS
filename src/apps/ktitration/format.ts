// Small text helpers of kTitration (pure): chemical formulas with sub- and superscripts, numbers, parsing.

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻' }

/**
 * "H3PO4", "HPO4^2-", "NH4^+" → "H₃PO₄", "HPO₄²⁻", "NH₄⁺". Digits after a letter or ")" become subscripts,
 * "^…" (up to the next space) superscripts. Text that is already typeset is left alone.
 */
export function pretty(f: string): string {
  let out = ''
  let sub = false // the previous character was a letter, a bracket or a subscript digit
  for (let i = 0; i < f.length; i++) {
    const c = f[i]
    if (c === '^') {
      let j = i + 1
      while (j < f.length && /[0-9+-]/.test(f[j])) { out += SUP[f[j]]; j++ }
      i = j - 1
      sub = false
      continue
    }
    if (/[0-9]/.test(c) && sub) { out += SUB[Number(c)]; continue }
    out += c
    sub = /[A-Za-z)\]]/.test(c)
  }
  return out
}

/** Plain text of a typeset formula ("H₃PO₄" → "H3PO4"), for CSV and reports that should stay ASCII-friendly. */
export function plain(f: string): string {
  let out = ''
  let inSup = false
  for (const c of f) {
    const sub = SUB.indexOf(c)
    if (sub >= 0) { out += String(sub); inSup = false; continue }
    const sup = Object.entries(SUP).find(([, v]) => v === c)
    if (sup) { out += (inSup ? '' : '^') + sup[0]; inSup = true; continue }
    inSup = false
    out += c
  }
  return out
}

/** A number with `digits` significant digits, no trailing zeros, exponent only when really small or large. */
export function sig(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : '–'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e6 || a < 1e-3) {
    const [m, e] = x.toExponential(Math.max(0, digits - 1)).split('e')
    return `${Number(m)}e${Number(e)}`
  }
  const s = Number(x.toPrecision(digits))
  return String(s)
}

/** Fixed decimals, "−" for negatives (typographic minus), NaN → "–". */
export function fixed(x: number, d = 2): string {
  if (!Number.isFinite(x)) return '–'
  const s = x.toFixed(d)
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s // no “-0.00”
}

/** Parses what people type: "0.1", "0,1", "1e-3", " 25 mL" (the number at the start). null when there is none. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(',', '.').replace(/^[+]/, '')
  if (!t) return null
  const m = /^[-−]?\d*\.?\d+(?:e[-+]?\d+)?|^[-−]?\d+\.?(?:e[-+]?\d+)?/i.exec(t)
  if (!m) return null
  const v = Number(m[0].replace('−', '-'))
  return Number.isFinite(v) ? v : null
}

/** A short file-name stem: letters, digits, space, dash. */
export function safeName(name: string): string {
  return name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, ' ') || 'titration'
}

/** "#rrggbb" → [r, g, b]. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Linear mix of two hex colours: t = 0 → a, t = 1 → b. */
export function mixColors(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const u = Math.max(0, Math.min(1, t))
  return rgbToHex(r1 + (r2 - r1) * u, g1 + (g2 - g1) * u, b1 + (b2 - b1) * u)
}

/** A small deterministic random generator (mulberry32), for examples, noise and quizzes. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal numbers from a uniform generator (Box–Muller). */
export function gaussian(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), 1e-12)
    const v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}
