// Importing the user's own CSV time series: guessing which column is the time (a year, a decimal year, a date, or a
// year and a month) and which are values, then building the series. Pure.

import { medianDt, monthT, type Kind, type Series, type Step } from './series.ts'

export interface ImportedColumn {
  key: string
  name: string
  unit: string
  kind: Kind
}

/** A dataset the user imported: it is stored inside the .kclim file. NaN is stored as null. */
export interface ImportedDataset {
  /** "user:name" */
  id: string
  name: string
  step: Step
  synthetic?: boolean
  columns: ImportedColumn[]
  t: number[]
  values: Record<string, Array<number | null>>
}

export type TimeMode = 'year' | 'decimal' | 'date' | 'year-month' | 'row'

export interface ImportMapping {
  /** "," ";" "\t" or " " */
  delimiter: string
  hasHeader: boolean
  timeMode: TimeMode
  timeCol: number
  /** For "year-month". */
  monthCol: number
  valueCols: number[]
  /** One name per value column. */
  names: string[]
  unit: string
  kind: Kind
  /** Cell texts that mean "missing". */
  missing: string[]
  /** For "row": the first year (rows are consecutive years). */
  startYear: number
  datasetName: string
}

export interface ParsedTable {
  headers: string[]
  rows: string[][]
  delimiter: string
  hasHeader: boolean
}

export const DEFAULT_MISSING = ['NA', 'N/A', 'NaN', 'nan', 'null', '-', '-999', '-9999', '-99.99', '-999.99', '9999', '***']

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).slice(0, 10)
  let best = ','
  let bestScore = -1
  for (const d of [',', ';', '\t']) {
    const counts = lines.map((l) => l.split(d).length - 1)
    const score = counts.length && counts[0] > 0 && counts.every((c) => c === counts[0]) ? counts[0] * 100 : Math.min(...counts, 0) + (counts[0] ?? 0)
    if (score > bestScore) { bestScore = score; best = d }
  }
  if (bestScore <= 0) {
    const ws = lines.map((l) => l.trim().split(/\s+/).length - 1)
    if (ws.length && ws[0] > 0 && ws.every((c) => c === ws[0])) return ' '
  }
  return best
}

const stripQuotes = (c: string) => c.trim().replace(/^"(.*)"$/, '$1').trim()

/** Splits a CSV text (comment lines starting with # are skipped; a first row with any non-number cell is the header). */
export function parseCsv(text: string, delimiter?: string, headerOverride?: boolean): ParsedTable {
  const d = delimiter ?? detectDelimiter(text)
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
  const cells = lines.map((l) => (d === ' ' ? l.trim().split(/\s+/) : l.split(d)).map(stripQuotes))
  if (!cells.length) return { headers: [], rows: [], delimiter: d, hasHeader: false }
  const width = Math.max(...cells.map((r) => r.length))
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  const first = cells[0]
  const hasHeader = headerOverride ?? first.some((c) => c !== '' && !Number.isFinite(Number(c.replace(',', '.'))) && !parseDateCell(c))
  const body = (hasHeader ? cells.slice(1) : cells).map(pad)
  const headers = hasHeader ? pad(first).map((h, i) => h || `column ${i + 1}`) : Array.from({ length: width }, (_, i) => `column ${i + 1}`)
  return { headers, rows: body, delimiter: d, hasHeader }
}

export interface DateParts {
  year: number
  /** 1–12, or 0 when the cell is a year only. */
  month: number
  /** Decimal year (the middle of the day, month or year). */
  t: number
  /** The text had a day. */
  day: boolean
  /** Only DD/MM vs MM/DD was guessed. */
  ambiguous?: boolean
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

function dayFraction(y: number, m: number, d: number): number {
  let doy = d
  for (let k = 1; k < m; k++) doy += daysIn(y, k)
  return y + (doy - 0.5) / (isLeap(y) ? 366 : 365)
}

/** Reads a date cell: 2024, 2024-03, 2024-03-15 (with a time after it), 2024/03/15, 15/03/2024, Mar 2024, 2024 Mar. */
export function parseDateCell(cell: string): DateParts | null {
  const s = cell.trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo) ? { year: y, month: mo, t: dayFraction(y, mo, d), day: true } : null
  }
  m = /^(\d{4})[-/](\d{1,2})$/.exec(s)
  if (m) {
    const [y, mo] = [Number(m[1]), Number(m[2])]
    return mo >= 1 && mo <= 12 ? { year: y, month: mo, t: monthT(y, mo), day: false } : null
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])]
    const y = Number(m[3])
    let ambiguous = false
    if (a <= 12 && b > 12) [a, b] = [b, a] // MM/DD/YYYY
    else if (a <= 12 && b <= 12 && a !== b) ambiguous = true // read as DD/MM/YYYY
    const [d, mo] = [a, b]
    return mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo) ? { year: y, month: mo, t: dayFraction(y, mo, d), day: true, ambiguous } : null
  }
  m = /^([A-Za-z]{3})[a-z]*\.?[\s,-]+(\d{4})$/.exec(s) ?? /^(\d{4})[\s,-]+([A-Za-z]{3})[a-z]*\.?$/.exec(s)
  if (m) {
    const name = (/^\d/.test(m[1]) ? m[2] : m[1]).toLowerCase()
    const y = Number(/^\d/.test(m[1]) ? m[1] : m[2])
    const mo = MONTH_NAMES.indexOf(name) + 1
    return mo ? { year: y, month: mo, t: monthT(y, mo), day: false } : null
  }
  return null
}

const numberOf = (c: string, missing: Set<string>): number => {
  const t = c.trim()
  if (t === '' || missing.has(t)) return NaN
  const v = Number(/^[-+]?\d+,\d+$/.test(t) ? t.replace(',', '.') : t)
  return Number.isFinite(v) ? v : NaN
}

/** A guess at the mapping: the first column that reads as a year, a decimal year or dates is the time; other numeric columns are values. */
export function inferMapping(table: ParsedTable, name = 'My data'): ImportMapping {
  const missing = new Set(DEFAULT_MISSING)
  const width = table.headers.length
  const sample = table.rows.slice(0, 200)
  let timeMode: TimeMode = 'row'
  let timeCol = 0
  let monthCol = -1
  const frac = (c: number) => sample.map((r) => numberOf(r[c] ?? '', missing)).filter(Number.isFinite)
  const dateCols = Array.from({ length: width }, (_, c) => c).filter((c) => sample.length > 0 && sample.filter((r) => parseDateCell(r[c] ?? '')).length >= 0.9 * sample.length)
  const yearish = (c: number) => {
    const v = frac(c)
    return v.length >= 0.7 * sample.length && v.every((x) => x >= 1000 && x <= 2200) && v.every((x, i) => i === 0 || x >= v[i - 1])
  }
  const named = (re: RegExp) => table.headers.findIndex((h) => re.test(h))
  const yc = named(/^(year|yr|jahr|année|annee)$/i)
  const mc = named(/^(month|mon|mo|mois|monat)$/i)
  if (dateCols.length) { timeMode = 'date'; timeCol = dateCols[0] }
  else if (yc >= 0 && mc >= 0 && yearish(yc)) { timeMode = 'year-month'; timeCol = yc; monthCol = mc }
  else {
    const c = Array.from({ length: width }, (_, i) => i).find(yearish)
    if (c !== undefined) {
      const v = frac(c)
      timeCol = c
      timeMode = v.every((x) => Number.isInteger(x)) ? 'year' : 'decimal'
    }
  }
  const valueCols = Array.from({ length: width }, (_, c) => c).filter((c) => {
    if ((timeMode !== 'row' && c === timeCol) || c === monthCol) return false
    return frac(c).length >= 0.5 * sample.length
  })
  return {
    delimiter: table.delimiter, hasHeader: table.hasHeader, timeMode, timeCol, monthCol, valueCols,
    names: valueCols.map((c) => table.headers[c]), unit: '', kind: 'level', missing: DEFAULT_MISSING.slice(), startYear: 2000, datasetName: name,
  }
}

export type ImportResult = { dataset: ImportedDataset; warnings: string[] } | { error: string }

const safeKey = (name: string, used: Set<string>): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value'
  let k = base
  for (let i = 2; used.has(k); i++) k = `${base}_${i}`
  used.add(k)
  return k
}

/** Builds the dataset from a parsed table and a mapping. */
export function buildImport(table: ParsedTable, mp: ImportMapping, opts: { synthetic?: boolean } = {}): ImportResult {
  if (!mp.valueCols.length) return { error: 'Choose at least one column of values.' }
  const missing = new Set(mp.missing.map((m) => m.trim()).filter(Boolean))
  const warnings: string[] = []
  const rows: Array<{ t: number; v: number[]; month: number }> = []
  let bad = 0
  let ambiguous = false
  table.rows.forEach((r, i) => {
    let t = NaN
    let month = 0
    switch (mp.timeMode) {
      case 'row': t = mp.startYear + i + 0.5; break
      case 'year': { const y = numberOf(r[mp.timeCol] ?? '', missing); t = Number.isFinite(y) ? y + 0.5 : NaN; break }
      case 'decimal': t = numberOf(r[mp.timeCol] ?? '', missing); break
      case 'year-month': {
        const y = numberOf(r[mp.timeCol] ?? '', missing)
        const m = numberOf(r[mp.monthCol] ?? '', missing)
        if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) { t = monthT(y, Math.round(m)); month = Math.round(m) }
        break
      }
      case 'date': {
        const d = parseDateCell(r[mp.timeCol] ?? '')
        if (d) { t = d.t; month = d.month; if (d.ambiguous) ambiguous = true }
        break
      }
    }
    if (!Number.isFinite(t)) { bad++; return }
    rows.push({ t, v: mp.valueCols.map((c) => numberOf(r[c] ?? '', missing)), month })
  })
  if (bad > 0) warnings.push(`${bad} row${bad === 1 ? '' : 's'} with no readable time ${bad === 1 ? 'was' : 'were'} skipped.`)
  if (ambiguous) warnings.push('Dates like 03/04/2020 were read as day/month/year.')
  if (rows.length < 3) return { error: `Only ${rows.length} usable rows. Check the time column.` }
  // sort by time (keeps the first of equal times)
  rows.sort((a, b) => a.t - b.t)
  const kept = rows.filter((r, i) => i === 0 || r.t > rows[i - 1].t)
  if (kept.length < rows.length) warnings.push(`${rows.length - kept.length} rows with a repeated time were dropped (kept the first).`)
  const dt = medianDt(kept.map((r) => r.t))
  let step: Step = 'irregular'
  const monthlyTimes = mp.timeMode === 'year-month' || ((mp.timeMode === 'date') && dt > 0.07 && dt < 0.1 && kept.every((r) => r.month > 0))
  if (monthlyTimes || (mp.timeMode === 'decimal' && dt > 0.075 && dt < 0.092 && kept.length >= 24)) step = 'monthly'
  else if (mp.timeMode === 'year' || mp.timeMode === 'row' || (dt > 0.92 && dt < 1.08)) step = 'annual'
  let t = kept.map((r) => r.t)
  if (step === 'monthly' && mp.timeMode === 'date') t = kept.map((r) => monthT(Math.floor(r.t + 1e-9), r.month))
  if (step === 'annual' && mp.timeMode !== 'year' && mp.timeMode !== 'row') t = t.map((x) => Math.floor(x + 1e-9) + 0.5)
  const used = new Set<string>()
  const columns: ImportedColumn[] = mp.valueCols.map((c, k) => ({ key: safeKey(mp.names[k] || table.headers[c] || `column ${c + 1}`, used), name: mp.names[k] || table.headers[c] || `column ${c + 1}`, unit: mp.unit, kind: mp.kind }))
  const values: Record<string, Array<number | null>> = {}
  columns.forEach((c, k) => { values[c.key] = kept.map((r) => (Number.isFinite(r.v[k]) ? r.v[k] : null)) })
  for (const c of columns) if (values[c.key].every((v) => v === null)) warnings.push(`Column “${c.name}” has no numbers.`)
  const slug = mp.datasetName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'data'
  return { dataset: { id: `user:${slug}`, name: mp.datasetName.trim() || 'My data', step, columns, t, values, ...(opts.synthetic ? { synthetic: true } : {}) }, warnings }
}

/** The series of an imported dataset. */
export function importedSeries(d: ImportedDataset): Series[] {
  return d.columns.map((c) => ({
    id: `${d.id}.${c.key}`, name: d.synthetic ? `${c.name} (synthetic)` : c.name, unit: c.unit, t: d.t.slice(), y: (d.values[c.key] ?? []).map((v) => (v === null || v === undefined ? NaN : v)),
    step: d.step, kind: c.kind, dataset: d.id, ...(d.synthetic ? { synthetic: true } : {}),
  }))
}

/** CSV text of a series set: the shared time columns and one column per series (for the "export data" command). */
export function seriesToCsv(list: Series[]): string {
  if (!list.length) return ''
  const monthly = list.every((s) => s.step === 'monthly')
  const times = [...new Set(list.flatMap((s) => s.t))].sort((a, b) => a - b)
  const maps = list.map((s) => new Map(s.t.map((t, i) => [t, s.y[i]] as const)))
  const esc = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)
  const head = [...(monthly ? ['year', 'month'] : ['time']), ...list.map((s) => esc(s.unit ? `${s.name} (${s.unit})` : s.name))]
  const lines = [head.join(',')]
  for (const t of times) {
    const y = Math.floor(t + 1e-9)
    const time = monthly ? [String(y), String(Math.floor((t - y) * 12 + 1e-6) + 1)] : [String(Number(t.toFixed(4)))]
    lines.push([...time, ...maps.map((m) => { const v = m.get(t); return v === undefined || !Number.isFinite(v) ? '' : String(Number(v.toPrecision(8))) })].join(','))
  }
  return lines.join('\n') + '\n'
}
