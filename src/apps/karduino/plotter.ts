// The serial plotter's data (pure: no React, no "@/" imports): reading numbers from
// the lines a board prints, and a buffer of the last samples per series.
//
// Formats understood on one line:  `512`   `1,2,3`   `1 2 3`   `a:1 b:2`   `temp=23.5, hum=40`
// (also `Temperature: 23.5 C`). Text without a number is not a sample.

export interface Reading {
  /** "temp" in `temp:23.5`, or null for a bare number. */
  label: string | null
  value: number
}

export const MAX_POINTS = 300
export const MAX_SERIES = 12

const NUMBER = /(?:([A-Za-z_][\w.-]*)\s*[:=]\s*)?(?<![\w.])([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(?![\d.])/g

/** The numbers of one serial line, or null when it has none. */
export function parseLine(line: string): Reading[] | null {
  const out: Reading[] = []
  for (const m of line.matchAll(NUMBER)) {
    const value = Number(m[2])
    if (!Number.isFinite(value)) continue
    out.push({ label: m[1] ?? null, value })
    if (out.length >= MAX_SERIES) break
  }
  return out.length ? out : null
}

/** Colours for the series: only theme variables (see the global theme list). */
export const SERIES_COLORS = [
  'var(--k-accent)',
  'var(--k-link)',
  'var(--k-warning)',
  'var(--k-danger)',
  'var(--k-success)',
  'color-mix(in srgb, var(--k-accent) 50%, var(--k-text))',
  'color-mix(in srgb, var(--k-link) 50%, var(--k-danger))',
  'color-mix(in srgb, var(--k-warning) 50%, var(--k-text))',
]
export const colorOf = (index: number): string => SERIES_COLORS[index % SERIES_COLORS.length]

export interface Column {
  name: string
  /** One value per sample, NaN where this series had none. */
  values: number[]
}

export class PlotBuffer {
  readonly max: number
  names: string[] = []
  private rows: number[][] = []
  /** Samples added since the start (the x axis keeps counting when old ones fall off). */
  total = 0

  constructor(max = MAX_POINTS) {
    this.max = max
  }

  get length(): number {
    return this.rows.length
  }

  clear(): void {
    this.names = []
    this.rows = []
    this.total = 0
  }

  /** Add one line's readings as a sample. Unlabelled values are called ch1, ch2… by position. */
  push(readings: Reading[]): void {
    const row: number[] = new Array(this.names.length).fill(Number.NaN)
    readings.forEach((r, i) => {
      const name = r.label ?? `ch${i + 1}`
      let col = this.names.indexOf(name)
      if (col < 0) {
        if (this.names.length >= MAX_SERIES) return
        col = this.names.length
        this.names.push(name)
        for (const old of this.rows) old.push(Number.NaN)
        row.push(Number.NaN)
      }
      row[col] = r.value
    })
    this.rows.push(row)
    this.total++
    if (this.rows.length > this.max) this.rows.shift()
  }

  /** Parse and add a line; false when it had no number. */
  pushLine(line: string): boolean {
    const r = parseLine(line)
    if (!r) return false
    this.push(r)
    return true
  }

  columns(): Column[] {
    return this.names.map((name, c) => ({ name, values: this.rows.map((r) => r[c]) }))
  }

  /** min and max over the series that are not hidden; null when there is nothing. */
  bounds(hidden: ReadonlySet<string> = new Set()): { min: number; max: number } | null {
    let min = Infinity
    let max = -Infinity
    this.names.forEach((n, c) => {
      if (hidden.has(n)) return
      for (const r of this.rows) {
        const v = r[c]
        if (Number.isFinite(v)) {
          if (v < min) min = v
          if (v > max) max = v
        }
      }
    })
    return min <= max ? { min, max } : null
  }

  toCsv(): string {
    const head = ['sample', ...this.names].join(',')
    const first = this.total - this.rows.length
    const lines = this.rows.map((r, i) => [first + i, ...r.map((v) => (Number.isFinite(v) ? v : ''))].join(','))
    return [head, ...lines].join('\n') + '\n'
  }
}

/** A y range with a little room, never flat. */
export function plotRange(b: { min: number; max: number } | null): { lo: number; hi: number } {
  if (!b) return { lo: 0, hi: 1 }
  let { min, max } = b
  if (min === max) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.06
  return { lo: min - pad, hi: max + pad }
}

/** Round tick values inside [lo, hi], about `count` of them. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo
  if (!(span > 0)) return [lo]
  const raw = span / Math.max(1, count)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? 10 * pow
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)))
  return ticks
}

/** SVG path data for a series: gaps (NaN) start a new sub-path. */
export function linePath(values: number[], x: (i: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
    pen = true
  })
  return d
}
