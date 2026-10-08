// Engineering notation: "4.7k" ↔ 4700, "1meg", "10u", "2.2n"… (SPICE suffixes, case-insensitive).
// Pure: no React, no "@/" imports (Node runs the tests).

const SUFFIX: Record<string, number> = {
  t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
}

/** "4.7k", "1meg", "10u", "1e-9", "2.2nF", "5V" → number; null when it is not a number. */
export function parseValue(text: string | number | undefined | null): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null
  if (text === undefined || text === null) return null
  const s = String(text).trim().replace(/,/g, '.').replace(/Ω|ohms?$/i, '')
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-zµ]*)$/i.exec(s)
  if (!m) return null
  const base = parseFloat(m[1])
  const rest = m[2].toLowerCase()
  if (!rest) return base
  // longest known prefix: "meg" before "m"; anything after it is a unit (F, H, V, Hz, A, s…)
  if (rest.startsWith('meg')) return base * 1e6
  if (rest.startsWith('mil')) return base * 25.4e-6
  const k = rest[0]
  if (k in SUFFIX) return base * SUFFIX[k]
  return base // a bare unit such as "V", "A", "s", "hz"
}

/** parseValue that throws a readable error. */
export function needValue(text: string | number | undefined | null, what: string): number {
  const v = parseValue(text)
  if (v === null) throw new Error(`${what}: “${String(text ?? '')}” is not a number (try 4.7k, 10u or 1meg).`)
  return v
}

const PREFIXES: [number, string][] = [
  [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f'],
]

/** 4700 → "4.7k"; 2.2e-9 → "2.2n". With a unit: "4.7 kΩ". */
export function formatValue(v: number, digits = 4, unit = ''): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? '∞' : '−∞'
  if (v === 0) return unit ? `0 ${unit}` : '0'
  const a = Math.abs(v)
  let pick = PREFIXES[PREFIXES.length - 1]
  for (const p of PREFIXES) {
    if (a >= p[0] * 0.9999999) { pick = p; break }
  }
  const scaled = v / pick[0]
  const t = Number(scaled.toPrecision(digits))
  const text = String(t)
  return unit ? `${text} ${pick[1]}${unit}` : `${text}${pick[1]}`
}

/** A SPICE-safe number: 4700 → "4.7k", 1e6 → "1meg", 0.000047 → "47u". */
export function spiceValue(v: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  const table: [number, string][] = [[1e12, 't'], [1e9, 'g'], [1e6, 'meg'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']]
  for (const [m, s] of table) {
    if (a >= m * 0.9999999) {
      const x = Number((v / m).toPrecision(6))
      if (Math.abs(x) < 1000) return `${x}${s}`
    }
  }
  return String(v)
}
