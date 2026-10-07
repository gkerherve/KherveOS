// KherveSheet's workbook as the page keeps it: a mirror of what Python holds
// for each cell (what was typed, what it shows, its number) and everything
// the grid keeps itself — formats, column widths, merges, charts… — in the
// desktop's .ksheet layout (CellFormat dicts, "r,c" keys, Qt alignment flags).
//
// Pure data and helpers only: no React, no Python.

export const MAX_COLS = 16384
export const MAX_ROWS = 1048576
/** New sheets are 5,000 × 50, like the desktop's engine. */
export const DEFAULT_ROWS = 5000
export const DEFAULT_COLS = 50
/** The desktop's QTableWidget defaults. */
export const DEFAULT_COL_W = 80
export const DEFAULT_ROW_H = 20

export type Key = number
export const key = (r: number, c: number): Key => r * MAX_COLS + c
export const keyRow = (k: Key) => Math.floor(k / MAX_COLS)
export const keyCol = (k: Key) => k % MAX_COLS

/** One cell: what was typed (source), what it shows (text), its number. */
export interface Cell {
  s: string
  t: string
  n: number | null
}

/** [r, c, source, text, number]: a cell exactly as it was (undo, snapshots). */
export type Raw = [number, number, string, string | null, number | null]

export interface Border {
  /** Qt pen style: 1 solid, 2 dash, 3 dot, 4 dash-dot, 5 dash-dot-dot. */
  style: number
  color: string
  width: number
}

/** The desktop's CellFormat.to_dict(): every key optional. */
export interface Fmt {
  bg?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  font_family?: string
  font_size?: number
  font_color?: string
  /** Qt alignment flags (ALIGN). */
  alignment?: number
  number_format?: string
  wrap_text?: boolean
  b_top?: Border
  b_bottom?: Border
  b_left?: Border
  b_right?: Border
}

export const ALIGN = { left: 0x1, right: 0x2, hcenter: 0x4, justify: 0x8, top: 0x20, bottom: 0x40, vcenter: 0x80 }
export const H_MASK = 0x0f
export const V_MASK = 0xe0

export interface Pos {
  r: number
  c: number
}
export interface Range {
  r1: number
  c1: number
  r2: number
  c2: number
}
export interface Selection {
  ranges: Range[]
  active: Pos
  anchor: Pos
}
/** [row, col, rows, cols] like the desktop's merged_ranges. */
export type Merge = [number, number, number, number]

export interface ChartSeries {
  ref: string
  name?: string | null
  color?: string | null
  /** The desktop's own type for this series, when it differs. */
  plotType?: string
}
export interface Trendline {
  series: number
  model: string
  polyOrder?: number
  maPeriod?: number
  color?: string | null
  showEquation?: boolean
  showR2?: boolean
  forward?: number
  backward?: number
  linestyle?: string
  linewidth?: number
  name?: string
}
/** core.charts' chart spec, plus where the chart sits (left/top, px). */
export interface ChartSpec {
  type: string
  title?: string
  xLabel?: string
  yLabel?: string
  x?: string | null
  series: ChartSeries[]
  legend?: boolean
  grid?: boolean
  logX?: boolean
  logY?: boolean
  width: number
  height: number
  left: number
  top: number
  trendlines?: Trendline[]
  pie?: Record<string, unknown>
  bins?: number | string
  data?: Record<string, unknown[]>
  desktop?: Record<string, unknown>
}
export interface Fit {
  model?: string
  equation?: string
  params?: Record<string, number | null>
  errors?: Record<string, number | null>
  gof?: Record<string, number | null>
  error?: string
}
export interface Chart {
  id: string
  spec: ChartSpec
  /** Object URL of the drawn SVG. */
  url: string | null
  error: string | null
  fits: Fit[]
  /** Its data changed since it was drawn. */
  stale: boolean
}
/** A picture or an equation from the desktop (its saved dict, pos_x…). */
export interface FloatObj {
  id: string
  d: Record<string, unknown>
}
export interface PyOut {
  fig: string | null
  err: string | null
  out: string | null
  /** Object URL of the figure. */
  url: string | null
}
export interface Sparkline {
  col: number
  r1: number
  r2: number
  type?: string
  color?: string
}
export interface InsertOps {
  notes?: Record<string, { text?: string; kind?: string } | string>
  links?: Record<string, unknown>
  dropdowns?: Record<string, unknown[]>
  sparklines?: Record<string, Sparkline>
  checkboxes?: Record<string, boolean>
  buttons?: Record<string, unknown>
  [other: string]: unknown
}
/** A basic AutoFilter: the header row of a range and the values each column keeps. */
export interface Filter {
  range: Range
  /** Column → the shown texts it keeps (missing: all). */
  keep: Record<number, string[]>
}

export interface Sheet {
  /** Stable id (names change). */
  id: string
  name: string
  rows: number
  cols: number
  /** The size the file had (written back at least as large). */
  fileRows: number
  fileCols: number
  cells: Map<Key, Cell>
  formats: Map<Key, Fmt>
  colW: Map<number, number>
  rowH: Map<number, number>
  merges: Merge[]
  /** Frozen [rows, cols]. */
  freeze: [number, number]
  designations: Record<string, string>
  insertOps: InsertOps
  pyLoops: Record<string, number>
  charts: Chart[]
  images: FloatObj[]
  equations: FloatObj[]
  shapes: unknown[]
  solverConfig: unknown
  fitConfig: unknown
  /** =PY outputs: figure, traceback, printed text. */
  py: Map<Key, PyOut>
  /** Typed but not answered by Python yet: key → the cell as it was before. */
  pending: Map<Key, Raw>
  filter: Filter | null
  /** Rows hidden by the filter. */
  hidden: Set<number>
  sel: Selection
  scroll: { x: number; y: number }
  /** Bumped when row heights, column widths or hidden rows change. */
  geomV: number
}

let nextId = 1
export const newId = (prefix: string) => `${prefix}${nextId++}`

export const cellSel = (r: number, c: number): Selection => ({ ranges: [{ r1: r, c1: c, r2: r, c2: c }], active: { r, c }, anchor: { r, c } })

export function newSheet(name: string, rows = DEFAULT_ROWS, cols = DEFAULT_COLS): Sheet {
  return {
    id: newId('s'),
    name,
    rows,
    cols,
    fileRows: 0,
    fileCols: 0,
    cells: new Map(),
    formats: new Map(),
    colW: new Map(),
    rowH: new Map(),
    merges: [],
    freeze: [0, 0],
    designations: {},
    insertOps: {},
    pyLoops: {},
    charts: [],
    images: [],
    equations: [],
    shapes: [],
    solverConfig: null,
    fitConfig: null,
    py: new Map(),
    pending: new Map(),
    filter: null,
    hidden: new Set(),
    sel: cellSel(0, 0),
    scroll: { x: 0, y: 0 },
    geomV: 0,
  }
}

// ------------------------------------------------------------------- A1

/** 0 → A, 25 → Z, 26 → AA. */
export function colName(c: number): string {
  let s = ''
  let n = c
  for (;;) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
    if (n < 0) return s
  }
}

/** A → 0, AA → 26. */
export function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export const a1 = (r: number, c: number) => `${colName(c)}${r + 1}`

export function rangeA1(g: Range): string {
  const a = a1(g.r1, g.c1)
  return g.r1 === g.r2 && g.c1 === g.c2 ? a : `${a}:${a1(g.r2, g.c2)}`
}

const CELL_RE = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/
const COLS_RE = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/
const ROWS_RE = /^\$?(\d{1,7}):\$?(\d{1,7})$/

export function parseCell(text: string): Pos | null {
  const m = CELL_RE.exec(text.trim())
  if (!m) return null
  const r = Number(m[2]) - 1
  return r >= 0 ? { r, c: colIndex(m[1]) } : null
}

/** "A1", "A1:B5", "B:B" or "3:5" (whole columns/rows up to `rows`/`cols`). */
export function parseRange(text: string, rows = DEFAULT_ROWS, cols = DEFAULT_COLS): Range | null {
  const t = text.trim()
  const parts = t.split(':')
  if (parts.length === 1) {
    const p = parseCell(t)
    return p ? { r1: p.r, c1: p.c, r2: p.r, c2: p.c } : null
  }
  if (parts.length !== 2) return null
  const a = parseCell(parts[0])
  const b = parseCell(parts[1])
  if (a && b) return normRange(a.r, a.c, b.r, b.c)
  let m = COLS_RE.exec(t)
  if (m) return normRange(0, colIndex(m[1]), rows - 1, colIndex(m[2]))
  m = ROWS_RE.exec(t)
  if (m) return normRange(Number(m[1]) - 1, 0, Number(m[2]) - 1, cols - 1)
  return null
}

/** "Sheet2!A1:B5" → the sheet (null: the chart's/cell's own) and the range. */
export function splitSheetRef(ref: string): { sheet: string | null; cells: string } {
  const i = ref.lastIndexOf('!')
  if (i < 0) return { sheet: null, cells: ref }
  return { sheet: ref.slice(0, i).trim().replace(/^'|'$/g, '').replace(/''/g, "'"), cells: ref.slice(i + 1) }
}

/** A sheet name as formulas write it ('My data'!A1). */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_]\w*$/.test(name) ? name : `'${name.replace(/'/g, '')}'`
}

// ---------------------------------------------------------------- ranges

export function normRange(r1: number, c1: number, r2: number, c2: number): Range {
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) }
}

export const inRange = (g: Range, r: number, c: number) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2
export const rangesMeet = (a: Range, b: Range) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2
export const rangeSize = (g: Range) => (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1)
export const sameRange = (a: Range, b: Range) => a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2

/** The rectangle around every selected range. */
export function selBounds(sel: Selection): Range {
  const g = { ...sel.ranges[0] }
  for (const x of sel.ranges) {
    g.r1 = Math.min(g.r1, x.r1)
    g.c1 = Math.min(g.c1, x.c1)
    g.r2 = Math.max(g.r2, x.r2)
    g.c2 = Math.max(g.c2, x.c2)
  }
  return g
}

export const lastRange = (sel: Selection) => sel.ranges[sel.ranges.length - 1]

export function inSelection(sel: Selection, r: number, c: number): boolean {
  return sel.ranges.some((g) => inRange(g, r, c))
}

/** The merge covering a cell, if any. */
export function mergeAt(merges: Merge[], r: number, c: number): Merge | null {
  for (const m of merges) if (r >= m[0] && r < m[0] + m[2] && c >= m[1] && c < m[1] + m[3]) return m
  return null
}

export const mergeRange = (m: Merge): Range => ({ r1: m[0], c1: m[1], r2: m[0] + m[2] - 1, c2: m[1] + m[3] - 1 })

/** Grow a range until every merge it touches is wholly inside. */
export function expandMerges(g: Range, merges: Merge[]): Range {
  if (!merges.length) return g
  const out = { ...g }
  for (let changed = true; changed; ) {
    changed = false
    for (const m of merges) {
      const mr = mergeRange(m)
      if (!rangesMeet(out, mr)) continue
      if (mr.r1 < out.r1 || mr.c1 < out.c1 || mr.r2 > out.r2 || mr.c2 > out.c2) {
        out.r1 = Math.min(out.r1, mr.r1)
        out.c1 = Math.min(out.c1, mr.c1)
        out.r2 = Math.max(out.r2, mr.r2)
        out.c2 = Math.max(out.c2, mr.c2)
        changed = true
      }
    }
  }
  return out
}

/** Every cell of the selection, once each (row by row). */
export function selCells(sel: Selection): Pos[] {
  const seen = new Set<Key>()
  const out: Pos[] = []
  for (const g of sel.ranges)
    for (let r = g.r1; r <= g.r2; r++)
      for (let c = g.c1; c <= g.c2; c++) {
        const k = key(r, c)
        if (!seen.has(k)) {
          seen.add(k)
          out.push({ r, c })
        }
      }
  return out
}

/** The last row and column holding something (−1 when empty). */
export function usedExtent(sheet: Sheet): { rows: number; cols: number } {
  let rows = -1
  let cols = -1
  for (const [k, cell] of sheet.cells) {
    if (!cell.s && !cell.t) continue
    rows = Math.max(rows, keyRow(k))
    cols = Math.max(cols, keyCol(k))
  }
  return { rows, cols }
}

export function cellEmpty(sheet: Sheet, r: number, c: number): boolean {
  const cell = sheet.cells.get(key(r, c))
  return !cell || (!cell.s && !cell.t)
}

/** The block of filled cells around (r, c), Excel's "current region". */
export function currentRegion(sheet: Sheet, r: number, c: number): Range {
  const g = { r1: r, c1: c, r2: r, c2: c }
  const filled = (rr: number, cc: number) => rr >= 0 && cc >= 0 && !cellEmpty(sheet, rr, cc)
  for (let grew = true; grew; ) {
    grew = false
    const tryGrow = (test: () => boolean, apply: () => void) => {
      if (test()) {
        apply()
        grew = true
      }
    }
    const rowHas = (rr: number) => {
      for (let cc = g.c1 - 1; cc <= g.c2 + 1; cc++) if (filled(rr, cc)) return true
      return false
    }
    const colHas = (cc: number) => {
      for (let rr = g.r1 - 1; rr <= g.r2 + 1; rr++) if (filled(rr, cc)) return true
      return false
    }
    tryGrow(() => g.r1 > 0 && rowHas(g.r1 - 1), () => g.r1--)
    tryGrow(() => rowHas(g.r2 + 1), () => g.r2++)
    tryGrow(() => g.c1 > 0 && colHas(g.c1 - 1), () => g.c1--)
    tryGrow(() => colHas(g.c2 + 1), () => g.c2++)
  }
  return g
}

// --------------------------------------------------------------- formats

/** "r,c" → key, as the desktop stores per-cell dicts. */
export function rcKey(s: string): Key | null {
  const [r, c] = s.split(',').map(Number)
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 ? key(r, c) : null
}
export const keyRc = (k: Key) => `${keyRow(k)},${keyCol(k)}`

export function fmtEmpty(f: Fmt | undefined): boolean {
  return !f || Object.values(f).every((v) => v === undefined || v === null)
}

export function formatsFromJson(obj: unknown): Map<Key, Fmt> {
  const out = new Map<Key, Fmt>()
  if (!obj || typeof obj !== 'object') return out
  for (const [s, f] of Object.entries(obj as Record<string, Fmt>)) {
    const k = rcKey(s)
    if (k !== null && f && typeof f === 'object' && !fmtEmpty(f)) out.set(k, f)
  }
  return out
}

export function formatsToJson(map: Map<Key, Fmt>): Record<string, Fmt> {
  const out: Record<string, Fmt> = {}
  for (const [k, f] of map) {
    if (fmtEmpty(f)) continue
    const clean: Fmt = {}
    for (const [name, v] of Object.entries(f)) if (v !== undefined && v !== null) (clean as Record<string, unknown>)[name] = v
    out[keyRc(k)] = clean
  }
  return out
}

/** Merge a change into a format; undefined values remove a key. */
export function patchFmt(f: Fmt | undefined, patch: Partial<Fmt>): Fmt | undefined {
  const next: Record<string, unknown> = { ...(f ?? {}) }
  for (const [name, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === false && (name === 'bold' || name === 'italic' || name === 'underline' || name === 'wrap_text'))
      delete next[name]
    else next[name] = v
  }
  return fmtEmpty(next as Fmt) ? undefined : (next as Fmt)
}

/** Number formats the Format menu offers (the desktop's NUMBER_FORMATS). */
export const NUMBER_FORMATS: { label: string; fmt: string }[] = [
  { label: 'General', fmt: 'General' },
  { label: 'Number (0)', fmt: '0' },
  { label: 'Number (0.0)', fmt: '0.0' },
  { label: 'Number (0.00)', fmt: '0.00' },
  { label: 'Number (0.000)', fmt: '0.000' },
  { label: 'Number (0.0000)', fmt: '0.0000' },
  { label: 'Scientific', fmt: 'Sci:4' },
  { label: 'Percentage', fmt: 'Percentage' },
  { label: 'Currency ($)', fmt: 'Currency:$' },
  { label: 'Currency (€)', fmt: 'Currency:€' },
  { label: 'Currency (£)', fmt: 'Currency:£' },
  { label: 'Date (2025-03-15)', fmt: 'Date:%Y-%m-%d' },
  { label: 'Date (15/03/2025)', fmt: 'Date:%d/%m/%Y' },
  { label: 'Time (13:30:00)', fmt: 'Time:%H:%M:%S' },
  { label: 'Time (13:30)', fmt: 'Time:%H:%M' },
  { label: 'Text', fmt: 'Text' },
]

/** A short name for a number format (toolbar, Format Cells). */
export function numberFormatLabel(fmt: string | undefined): string {
  if (!fmt || fmt === 'General') return 'General'
  const hit = NUMBER_FORMATS.find((n) => n.fmt === fmt)
  if (hit) return hit.label
  if (fmt.startsWith('Sci') || fmt === 'Scientific') return 'Scientific'
  if (fmt.startsWith('Currency')) return 'Currency'
  if (fmt.startsWith('Date')) return 'Date'
  if (fmt.startsWith('Time')) return 'Time'
  return fmt
}

// ------------------------------------------- inserting / deleting rows, columns

export type Axis = 'rows' | 'cols'

/** Where index i goes when n rows/columns are inserted (n > 0) or deleted (n < 0) at `at`. */
export function shiftIndex(i: number, at: number, n: number): number | null {
  if (n > 0) return i >= at ? i + n : i
  const gone = -n
  if (i < at) return i
  if (i < at + gone) return null
  return i - gone
}

/** Where the span i1..i2 goes (null: all of it deleted). */
export function shiftSpan(i1: number, i2: number, at: number, n: number): [number, number] | null {
  const lo = Math.min(i1, i2)
  const hi = Math.max(i1, i2)
  if (n > 0) return [shiftIndex(lo, at, n)!, shiftIndex(hi, at, n)!]
  const gone = -n
  const end = at + gone
  if (lo >= at && hi < end) return null
  const nlo = lo < at ? lo : lo < end ? at : lo - gone
  const nhi = hi < at ? hi : hi < end ? at - 1 : hi - gone
  return [nlo, nhi]
}

export function shiftKeyMap<T>(map: Map<Key, T>, axis: Axis, at: number, n: number): Map<Key, T> {
  const out = new Map<Key, T>()
  for (const [k, v] of map) {
    const r = keyRow(k)
    const c = keyCol(k)
    if (axis === 'rows') {
      const nr = shiftIndex(r, at, n)
      if (nr !== null) out.set(key(nr, c), v)
    } else {
      const nc = shiftIndex(c, at, n)
      if (nc !== null) out.set(key(r, nc), v)
    }
  }
  return out
}

export function shiftIndexMap<T>(map: Map<number, T>, at: number, n: number): Map<number, T> {
  const out = new Map<number, T>()
  for (const [i, v] of map) {
    const ni = shiftIndex(i, at, n)
    if (ni !== null) out.set(ni, v)
  }
  return out
}

/** "r,c"-keyed records (notes, links, checkboxes…) after the change. */
export function shiftRcRecord<T>(rec: Record<string, T> | undefined, axis: Axis, at: number, n: number): Record<string, T> | undefined {
  if (!rec) return rec
  const out: Record<string, T> = {}
  for (const [s, v] of Object.entries(rec)) {
    const k = rcKey(s)
    if (k === null) continue
    let r = keyRow(k)
    let c = keyCol(k)
    const moved = shiftIndex(axis === 'rows' ? r : c, at, n)
    if (moved === null) continue
    if (axis === 'rows') r = moved
    else c = moved
    out[`${r},${c}`] = v
  }
  return out
}

export function shiftMerges(merges: Merge[], axis: Axis, at: number, n: number): Merge[] {
  const out: Merge[] = []
  for (const [r, c, rs, cs] of merges) {
    if (axis === 'rows') {
      const span = shiftSpan(r, r + rs - 1, at, n)
      if (span && (span[1] > span[0] || cs > 1)) out.push([span[0], c, span[1] - span[0] + 1, cs])
    } else {
      const span = shiftSpan(c, c + cs - 1, at, n)
      if (span && (span[1] > span[0] || rs > 1)) out.push([r, span[0], rs, span[1] - span[0] + 1])
    }
  }
  return out
}

/** A chart's range after rows/columns of `target` changed (`own`: the chart's sheet). */
export function shiftRef(ref: string, own: string, target: string, axis: Axis, at: number, n: number): string {
  if (!ref || ref.startsWith('@')) return ref
  const { sheet, cells } = splitSheetRef(ref)
  if ((sheet ?? own).toLowerCase() !== target.toLowerCase()) return ref
  const prefix = sheet === null ? '' : ref.slice(0, ref.lastIndexOf('!') + 1)
  const parts = cells.split(':')
  const ends = parts.map((p) => {
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/.exec(p.trim())
    return m ? { d1: m[1], col: colIndex(m[2]), d2: m[3], row: Number(m[4]) - 1 } : null
  })
  if (parts.length === 2 && ends[0] && ends[1]) {
    const [a, b] = ends as NonNullable<(typeof ends)[number]>[]
    const span = axis === 'rows' ? shiftSpan(a.row, b.row, at, n) : shiftSpan(a.col, b.col, at, n)
    if (!span) return '#REF!'
    const fa = { ...a }
    const fb = { ...b }
    if (axis === 'rows') [fa.row, fb.row] = a.row <= b.row ? span : [span[1], span[0]]
    else [fa.col, fb.col] = a.col <= b.col ? span : [span[1], span[0]]
    const txt = (e: typeof fa) => `${e.d1}${colName(e.col)}${e.d2}${e.row + 1}`
    return `${prefix}${txt(fa)}:${txt(fb)}`
  }
  if (parts.length === 1 && ends[0]) {
    const e = { ...ends[0] }
    const moved = shiftIndex(axis === 'rows' ? e.row : e.col, at, n)
    if (moved === null) return '#REF!'
    if (axis === 'rows') e.row = moved
    else e.col = moved
    return `${prefix}${e.d1}${colName(e.col)}${e.d2}${e.row + 1}`
  }
  const cm = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})$/.exec(cells.trim())
  if (cm && axis === 'cols') {
    const span = shiftSpan(colIndex(cm[2]), colIndex(cm[4]), at, n)
    if (!span) return '#REF!'
    return `${prefix}${cm[1]}${colName(span[0])}:${cm[3]}${colName(span[1])}`
  }
  return ref
}

/** A sparkline's data (one column, rows r1..r2) after the change. */
export function shiftSparkline(sp: Sparkline, axis: Axis, at: number, n: number): Sparkline | null {
  if (axis === 'cols') {
    const col = shiftIndex(sp.col, at, n)
    return col === null ? null : { ...sp, col }
  }
  const span = shiftSpan(sp.r1, sp.r2, at, n)
  return span ? { ...sp, r1: span[0], r2: span[1] } : null
}

/** Designations ({"col": "X"}) after columns changed. */
export function shiftDesignations(d: Record<string, string>, at: number, n: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [s, v] of Object.entries(d)) {
    const c = shiftIndex(Number(s), at, n)
    if (c !== null) out[String(c)] = v
  }
  return out
}

/** "B(x1)", "C(y1)": a column header with its X/Y designation, like the desktop. */
export function columnLabels(designations: Record<string, string>, upTo: number): (c: number) => string {
  const marks = new Map<number, string>()
  let x = 0
  for (let c = 0; c <= upTo; c++) {
    const d = (designations[String(c)] ?? '').toUpperCase()
    if (d === 'X') x++
    if (d === 'X' || d === 'Y') marks.set(c, `${d.toLowerCase()}${x}`)
  }
  return (c) => {
    const m = marks.get(c)
    return m ? `${colName(c)}(${m})` : colName(c)
  }
}

// ----------------------------------------------------------------- values

/** A cell's number for sums and sorting (null: not a number). */
export function cellNumber(cell: Cell | undefined): number | null {
  if (!cell || !cell.t) return null
  if (cell.n !== null && Number.isFinite(cell.n)) return cell.n
  const v = Number(cell.t)
  return cell.t.trim() !== '' && Number.isFinite(v) ? v : null
}

export const isError = (t: string) => /^#(DIV\/0!|NAME\?|NUM!|VALUE!|REF!|N\/A|ERROR|PYERR|NULL!)$/.test(t)
export const isPython = (s: string) => /^\s*=PY(\s|$)/i.test(s)
export const isFormula = (s: string) => s.startsWith('=') && s.length > 1
