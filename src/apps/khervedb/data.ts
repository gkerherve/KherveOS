// The NIST XPS binding-energy database (recorded in 2019): loading, filtering
// and statistics. nist.bin is gzip-compressed, column-oriented JSON with
// dictionary-encoded strings; elements.json holds the element properties and
// the reference URLs. Both are exported from the Python KherveDB.
//
// No React and no Vite here, so a plain Node script can test it.

type StrCol = { dict: string[]; idx: number[] }
type NumCol = { num: (number | null)[] }
export type RawDb = { n: number; columns: string[]; cols: Record<string, StrCol | NumCol> }

export interface ElementMeta {
  row: number
  col: number
  cat: string
  z: number
  /** Main XPS line and its binding energy, shown on the tile. */
  main: string
  be: string
  props: Record<string, string | number>
  urls: { xpsfitting: string; harwell: string; thermo: string }
}

export interface ElementsFile {
  elements: Record<string, ElementMeta>
  /** Well-known overlaps that the NIST data alone does not show. */
  overlaps: Record<string, string>
}

export class NistDb {
  readonly n: number
  readonly columns: string[]
  private cols: Record<string, StrCol | NumCol>
  readonly element: string[]
  readonly line: string[]
  readonly be: Float64Array
  readonly formula: string[]
  readonly name: string[]
  readonly author: string[]
  readonly journal: string[]
  private formulaLower: string[]
  private nameLower: string[]
  /** Row numbers of each element, so filtering only walks that element. */
  private byElement = new Map<string, number[]>()

  constructor(raw: RawDb) {
    this.n = raw.n
    this.columns = raw.columns
    this.cols = raw.cols
    this.element = this.strings('Element')
    this.line = this.strings('Line')
    this.formula = this.strings('Formula')
    this.name = this.strings('Name')
    this.author = this.strings('Author')
    this.journal = this.strings('Journal')
    const b = (raw.cols['BE (eV)'] as NumCol).num
    this.be = Float64Array.from(b, (v) => (v == null ? NaN : v))
    this.formulaLower = this.formula.map((s) => s.toLowerCase())
    this.nameLower = this.name.map((s) => s.toLowerCase())
    for (let i = 0; i < this.n; i++) {
      const el = this.element[i]
      let list = this.byElement.get(el)
      if (!list) this.byElement.set(el, (list = []))
      list.push(i)
    }
  }

  private strings(col: string): string[] {
    const c = this.cols[col] as StrCol | undefined
    if (!c || !('dict' in c)) return new Array<string>(this.n).fill('')
    return c.idx.map((i) => (i < 0 ? '' : c.dict[i]))
  }

  /** Any column value for one row, for the details view and the export. */
  value(col: string, row: number): string {
    const c = this.cols[col]
    if (!c) return ''
    if ('dict' in c) {
      const i = c.idx[row]
      return i < 0 ? '' : String(c.dict[i])
    }
    const v = c.num[row]
    return v == null ? '' : String(v)
  }

  elementsWithData(): Set<string> {
    return new Set(this.byElement.keys())
  }

  linesFor(el: string): string[] {
    const s = new Set<string>()
    for (const i of this.byElement.get(el) ?? []) s.add(this.line[i])
    return [...s].sort()
  }

  /** Rows of an element (all elements when null), filtered by line and by parts of the formula and name. */
  filter(el: string | null, line: string, formula: string, name: string): number[] {
    const f = formula.trim().toLowerCase()
    const nm = name.trim().toLowerCase()
    const out: number[] = []
    const check = (i: number) => {
      if (line && this.line[i] !== line) return
      if (f && !this.formulaLower[i].includes(f)) return
      if (nm && !this.nameLower[i].includes(nm)) return
      out.push(i)
    }
    if (el) for (const i of this.byElement.get(el) ?? []) check(i)
    else for (let i = 0; i < this.n; i++) check(i)
    return out
  }
}

// ------------------------------------------------------------------ loading

/** Unzip nist.bin. Also takes data a server already unzipped on the way. */
export async function gunzipText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes)
  const stream = new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Parse JSON, saying clearly when the server sent a web page instead (a missing file). */
function parseJson<T>(text: string, file: string): T {
  if (text.trimStart().startsWith('<')) throw new Error(`${file} is missing on the server`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${file} is damaged`)
  }
}

export function decodeNist(text: string): NistDb {
  const raw = parseJson<RawDb>(text, 'nist.bin')
  if (!raw || typeof raw.n !== 'number' || !Array.isArray(raw.columns) || !raw.cols?.['BE (eV)']) {
    throw new Error('nist.bin is not a kDB database')
  }
  return new NistDb(raw)
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

export interface KdbData {
  db: NistDb
  meta: ElementsFile
}

let loading: Promise<KdbData> | null = null
let loaded: KdbData | null = null

/** Fetch both files once per page; every KherveDB window shares them. A failure is retried next time. */
export function loadAll(base: string): Promise<KdbData> {
  loading ??= (async () => {
    const [bin, json] = await Promise.all([fetchBytes(`${base}nist.bin`), fetchBytes(`${base}elements.json`)])
    const db = decodeNist(await gunzipText(bin))
    const meta = parseJson<ElementsFile>(new TextDecoder().decode(json), 'elements.json')
    if (!meta?.elements || !meta.overlaps) throw new Error('elements.json is not a kDB element table')
    loaded = { db, meta }
    return loaded
  })().catch((e: unknown) => {
    loading = null
    throw e
  })
  return loading
}

/** The data, when an earlier window already loaded it (the next windows open at once). */
export function loadedData(): KdbData | null {
  return loaded
}

// ------------------------------------------- per element/line statistics

export type LineStat = { el: string; line: string; median: number; lo: number; hi: number; count: number }

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const i = Math.floor(pos)
  const frac = pos - i
  return i + 1 < sorted.length ? sorted[i] + frac * (sorted[i + 1] - sorted[i]) : sorted[i]
}

/** Median and 5–95 % range per element and line, satellites excluded. */
export function lineStats(db: NistDb): LineStat[] {
  const groups = new Map<string, number[]>()
  for (let i = 0; i < db.n; i++) {
    const line = db.line[i]
    if (line.includes('sat') || Number.isNaN(db.be[i])) continue
    const key = db.element[i] + '|' + line
    let g = groups.get(key)
    if (!g) groups.set(key, (g = []))
    g.push(db.be[i])
  }
  const out: LineStat[] = []
  for (const [key, vals] of groups) {
    vals.sort((a, b) => a - b)
    const [el, line] = key.split('|')
    out.push({ el, line, median: quantile(vals, 0.5), lo: quantile(vals, 0.05), hi: quantile(vals, 0.95), count: vals.length })
  }
  return out
}

const SPIN_ORBIT: [string, string][] = [
  ['2p3/2', '2p1/2'], ['3p3/2', '3p1/2'], ['4p3/2', '4p1/2'], ['5p3/2', '5p1/2'],
  ['3d5/2', '3d3/2'], ['4d5/2', '4d3/2'], ['5d5/2', '5d3/2'], ['4f7/2', '4f5/2'],
]

export type ElementInfo = {
  mainLine: string | null
  peaks: LineStat[]
  spinOrbit: string[]
  known: string | null
  nearby: LineStat[]
}

/** What the right-click window shows: main line, peak positions, spin–orbit splitting, overlaps. */
export function elementInfo(el: string, meta: ElementsFile, stats: LineStat[]): ElementInfo {
  const mine = stats.filter((s) => s.el === el).sort((a, b) => b.count - a.count)
  const known = meta.overlaps[el] ?? null
  if (!mine.length) return { mainLine: null, peaks: [], spinOrbit: [], known, nearby: [] }

  const lines = new Set(mine.map((s) => s.line))
  const mainLine = lines.has(meta.elements[el]?.main) ? meta.elements[el].main : mine[0].line
  const byLine = new Map(mine.map((s) => [s.line, s]))
  const spinOrbit = SPIN_ORBIT.flatMap(([hi, lo]) => {
    const a = byLine.get(hi)
    const b = byLine.get(lo)
    return a && b && a.count >= 2 && b.count >= 2 ? [`${hi.slice(0, 2)} ${(b.median - a.median).toFixed(1)} eV`] : []
  })

  // Other elements with a line within ±5 eV of the main line: one (the closest) per element.
  const be = byLine.get(mainLine)!.median
  const seen = new Set<string>()
  const nearby = stats
    .filter((s) => s.el !== el && s.count >= 2 && Math.abs(s.median - be) <= 5)
    .sort((a, b) => Math.abs(a.median - be) - Math.abs(b.median - be))
    .filter((s) => (seen.has(s.el) ? false : (seen.add(s.el), true)))
    .slice(0, 6)

  const peaks = mine.slice(0, 6).sort((a, b) => b.median - a.median)
  return { mainLine, peaks, spinOrbit, known, nearby }
}

// ------------------------------------------------------------- sorting

export type SortKey = 'element' | 'line' | 'be' | 'formula' | 'name' | 'journal'
export type Sort = { key: SortKey; dir: 1 | -1 }

/** Rows in table order. Entries without a binding energy go last. */
export function sortRows(db: NistDb, rows: number[], { key, dir }: Sort): number[] {
  const out = rows.slice()
  if (key === 'be') {
    const be = db.be
    out.sort((a, b) => {
      const x = be[a]
      const y = be[b]
      if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) ? (Number.isNaN(y) ? 0 : 1) : -1
      return dir * (x - y)
    })
  } else {
    const arr = db[key]
    out.sort((a, b) => dir * arr[a].localeCompare(arr[b]))
  }
  return out
}

// ------------------------------------------------------------ the plot

/** The bin the web version picks: about 60 bars across the range, at least 0.1 eV. */
export function autoBin(lo: number, hi: number): number {
  return Math.max(0.1, Math.round(((hi - lo) / 60) * 10) / 10)
}

export interface Histogram {
  start: number
  bin: number
  counts: number[]
}

/** Count the values in [lo, hi] per bin; bins start on multiples of `bin`. */
export function histogram(values: ArrayLike<number>, lo: number, hi: number, bin: number): Histogram {
  const start = Math.floor(lo / bin + 1e-7) * bin
  const n = Math.max(1, Math.floor((hi - start) / bin + 1e-7) + 1)
  const counts = new Array<number>(n).fill(0)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!(v >= lo && v <= hi)) continue
    // The small nudge keeps values sitting on a bin edge (285.0 with 0.1 eV bins) in the bin they start.
    const k = Math.floor((v - start) / bin + 1e-7)
    if (k >= 0 && k < n) counts[k]++
  }
  return { start, bin, counts }
}

/**
 * Smooth curve through the histogram: a Gaussian kernel density estimate with
 * Silverman's bandwidth (as scipy's gaussian_kde in the Python KherveDB),
 * scaled to entries per bin.
 */
export function kdeCurve(values: ArrayLike<number>, lo: number, hi: number, bin: number, points = 300): [number, number][] {
  const n = values.length
  if (n < 2 || !(hi > lo)) return []
  let mean = 0
  for (let i = 0; i < n; i++) mean += values[i]
  mean /= n
  let ss = 0
  for (let i = 0; i < n; i++) ss += (values[i] - mean) ** 2
  const std = Math.sqrt(ss / (n - 1))
  if (!(std > 0)) return []
  const h = std * Math.pow((n * 3) / 4, -1 / 5)
  const sorted = Array.from(values).sort((a, b) => a - b)
  const norm = (n * bin) / (n * h * Math.sqrt(2 * Math.PI))
  const reach = 6 * h
  const out: [number, number][] = []
  let first = 0
  for (let p = 0; p <= points; p++) {
    const x = lo + ((hi - lo) * p) / points
    while (first < n && sorted[first] < x - reach) first++
    let sum = 0
    for (let i = first; i < n && sorted[i] <= x + reach; i++) {
      const u = (x - sorted[i]) / h
      sum += Math.exp(-0.5 * u * u)
    }
    out.push([x, sum * norm])
  }
  return out
}

/** Round axis ticks (1, 2 or 5 × 10ⁿ apart) covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, target: number): number[] {
  if (!(hi > lo)) return [lo]
  const raw = (hi - lo) / Math.max(1, target)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}

// ----------------------------------------------------- export and copy

/** One field for a CSV / tab-separated file, quoted when it has to be. */
function field(v: string, sep: string): string {
  return v.includes(sep) || v.includes('"') || v.includes('\n') || v.includes('\r') ? `"${v.replace(/"/g, '""')}"` : v
}

/** Every column of the given rows, as CSV (sep ",") or tab-separated text (the Python app's export). */
export function exportText(db: NistDb, rows: number[], sep: ',' | '\t'): string {
  const lines = [db.columns.map((c) => field(c, sep)).join(sep)]
  for (const r of rows) lines.push(db.columns.map((c) => field(db.value(c, r), sep)).join(sep))
  return lines.join('\n') + '\n'
}

/** The suggested export file name: NIST_XPS_<element>_<line>.txt */
export function exportName(element: string | null, line: string): string {
  const el = element ?? 'all'
  const ln = line ? line.replace(/[/\s,]+/g, '-') : 'all_lines'
  return `NIST_XPS_${el}_${ln}.txt`
}

/** "C 1s - 284.80 eV - C - graphite - Authors, Journal" for the clipboard (the Python app's format, plus the authors). */
export function referenceText(db: NistDb, r: number): string {
  const be = Number.isNaN(db.be[r]) ? '' : `${db.be[r].toFixed(2)} eV`
  const source = [db.author[r].trim(), db.journal[r].trim()].filter(Boolean).join(', ')
  return [`${db.element[r]} ${db.line[r]}`, be, db.formula[r], db.name[r], source].filter((s) => s.trim()).join(' - ')
}
