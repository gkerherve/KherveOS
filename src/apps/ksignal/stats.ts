// Small numeric helpers shared by the kSignal modules (pure).

export function median(values: readonly number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** A number with `digits` significant digits and no trailing zeros. */
export function fmtNum(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return '–'
  if (v === 0) return '0'
  return String(Number(v.toPrecision(digits)))
}

/** 1234 → "1.234 kHz", 0.5 → "0.5 Hz". */
export function fmtHz(f: number): string {
  if (!Number.isFinite(f)) return '–'
  const a = Math.abs(f)
  if (a >= 1e6) return `${fmtNum(f / 1e6)} MHz`
  if (a >= 1e3) return `${fmtNum(f / 1e3)} kHz`
  return `${fmtNum(f)} Hz`
}

/** Seconds as "1.5 s", "12 ms", "3.2 µs". */
export function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '–'
  const a = Math.abs(t)
  if (a === 0) return '0 s'
  if (a >= 1) return `${fmtNum(t)} s`
  if (a >= 1e-3) return `${fmtNum(t * 1e3)} ms`
  return `${fmtNum(t * 1e6)} µs`
}

/** "1k" → 1000, "2.5M" → 2.5e6, "250m" → 0.25, "1e3" → 1000, "1,5" → 1.5; NaN when it is not a number. */
export function parseEng(text: string): number {
  const t = text.trim().replace(',', '.').replace(/\s+/g, '')
  if (!t) return NaN
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([kKMGmuµn]?)(?:hz|s|v|db)?$/i.exec(t)
  if (!m) return NaN
  const mult: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, G: 1e9 }
  const div: Record<string, number> = { m: 1e3, u: 1e6, 'µ': 1e6, n: 1e9 } // dividing keeps 10u exactly 1e-5
  const v = Number(m[1])
  return m[2] in mult ? v * mult[m[2]] : m[2] in div ? v / div[m[2]] : v
}
