// CSV import and export of signals (pure): "time,value", "time,a,b,c" or a single column of values; comma, semicolon,
// tab or space separated; an optional header line.

import { median } from './stats.ts'

export interface CsvSignal {
  samples: Float64Array
  fs: number
  /** The sample rate was found from the time column (otherwise it is the one that was passed in). */
  fsFromData: boolean
  header: string[]
  /** Columns in the file, and which one was read. */
  columns: number
  column: number
  hasTime: boolean
  warnings: string[]
}

export interface CsvOptions {
  /** Sample rate when the file has no time column. */
  fs?: number
  /** Value column (0-based, not counting the time column). */
  column?: number
}

function splitLine(line: string, delim: string | RegExp): string[] {
  return line.split(delim).map((s) => s.trim().replace(/^"|"$/g, ''))
}

function detectDelimiter(lines: string[]): string | RegExp {
  const sample = lines.slice(0, 10).join('\n')
  for (const d of ['\t', ';', ',']) if (sample.includes(d)) return d
  return /\s+/
}

/** Reads a signal from CSV text. Throws a readable error when there are no numbers. */
export function parseCsv(text: string, opts: CsvOptions = {}): CsvSignal {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (!lines.length) throw new Error('The file is empty.')
  const delim = detectDelimiter(lines)
  const rows = lines.map((l) => splitLine(l, delim))
  const isNum = (s: string) => s !== '' && Number.isFinite(Number(s.replace(',', '.')))
  let header: string[] = []
  let first = 0
  if (!rows[0].some(isNum) || (rows[0].every((c) => !isNum(c)) && rows.length > 1)) { header = rows[0]; first = 1 }
  const data = rows.slice(first)
  const cols = Math.max(...data.map((r) => r.length))
  if (!data.length) throw new Error('The file has a header but no numbers.')
  const nums = data.map((r) => r.map((c) => Number(c.replace(',', '.'))))
  const warnings: string[] = []
  // a first column that strictly increases is time
  let hasTime = false
  if (cols >= 2) {
    const t = nums.map((r) => r[0])
    hasTime = t.every((v, i) => Number.isFinite(v) && (i === 0 || v > t[i - 1]))
  }
  const valueCols = hasTime ? cols - 1 : cols
  const column = Math.max(0, Math.min(valueCols - 1, Math.round(opts.column ?? 0)))
  const col = column + (hasTime ? 1 : 0)
  const raw: number[] = []
  let skipped = 0
  const times: number[] = []
  for (const r of nums) {
    const v = r[col]
    if (Number.isFinite(v)) { raw.push(v); if (hasTime) times.push(r[0]) } else skipped++
  }
  if (raw.length < 2) throw new Error('There are fewer than two numbers in that column.')
  if (skipped) warnings.push(`${skipped} row${skipped > 1 ? 's' : ''} without a number were skipped.`)
  let fs = opts.fs && opts.fs > 0 ? opts.fs : 1
  let fsFromData = false
  let samples = Float64Array.from(raw)
  if (hasTime) {
    const dts = times.slice(1).map((t, i) => t - times[i])
    const dt = median(dts)
    fs = 1 / dt
    fsFromData = true
    const jitter = Math.max(...dts.map((d) => Math.abs(d - dt))) / dt
    if (jitter > 0.01) {
      // not evenly spaced: interpolate onto a uniform grid
      const n = Math.max(2, Math.round((times[times.length - 1] - times[0]) / dt) + 1)
      const out = new Float64Array(n)
      let j = 0
      for (let i = 0; i < n; i++) {
        const t = times[0] + i * dt
        while (j < times.length - 2 && times[j + 1] < t) j++
        const f = (t - times[j]) / (times[j + 1] - times[j])
        out[i] = raw[j] + (raw[j + 1] - raw[j]) * Math.min(1, Math.max(0, f))
      }
      samples = out
      warnings.push('The time stamps are not evenly spaced: the signal was interpolated onto an even grid.')
    }
  } else if (!(opts.fs && opts.fs > 0)) warnings.push('There is no time column: set the sample rate.')
  return { samples, fs, fsFromData, header, columns: valueCols, column, hasTime, warnings }
}

/** CSV text: time then one column per signal. */
export function toCsv(columns: Array<{ name: string; x: ArrayLike<number> }>, fs: number, precision = 9): string {
  const n = Math.max(0, ...columns.map((c) => c.x.length))
  const lines = [['time_s', ...columns.map((c) => c.name)].join(',')]
  for (let i = 0; i < n; i++) {
    const row = [Number((i / fs).toPrecision(precision))]
    for (const c of columns) row.push(i < c.x.length ? Number(c.x[i].toPrecision(precision)) : NaN)
    lines.push(row.map((v) => (Number.isFinite(v) ? String(v) : '')).join(','))
  }
  return lines.join('\n') + '\n'
}
