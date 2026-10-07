// Sheet cells: an embedded KherveSheet-style workbook (the desktop's
// sheetcell.py). A sheet cell's `source` is JSON:
//
//   {"sheets": [{"name", "rows", "cols", "data": {"A1": "raw text or =formula"}}],
//    "active": "<sheet name>", "plots": [{"title", "png"}]}
//
// The legacy single grid {"rows", "cols", "data"} still loads, and plain
// CSV / TSV text becomes one sheet. Formulas are Python, computed in the
// kernel (see pyhelper.ts); this module only handles the stored grid.

export interface SheetData {
  name: string
  rows: number
  cols: number
  /** Raw cell text by A1 ref ("12.5", "label", "=sum(B2:B4)"). */
  data: Record<string, string>
}

export interface PlotView {
  title: string
  /** base64 PNG */
  png: string
}

export interface Workbook {
  sheets: SheetData[]
  active: string
  /** Static plot views (imported, or made with Create Plot). */
  plots: PlotView[]
}

export const DEFAULT_ROWS = 6
export const DEFAULT_COLS = 4
const MAX_ROWS = 100_000
const MAX_COLS = 702 // ZZ

const REF = /^([A-Z]{1,2})(\d{1,6})$/

/** 0 → A, 25 → Z, 26 → AA. */
export function colLetter(c: number): string {
  let out = ''
  let n = c + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export function letterCol(s: string): number {
  let c = 0
  for (const ch of s.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
  return c - 1
}

export const ref = (r: number, c: number) => `${colLetter(c)}${r + 1}`

export function parseRef(a1: string): { r: number; c: number } | null {
  const m = REF.exec(a1.trim().toUpperCase())
  return m ? { r: Number(m[2]) - 1, c: letterCol(m[1]) } : null
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt
}

function sheetFrom(model: Obj, fallbackName: string): SheetData {
  const rows = clampInt(model.rows, 1, MAX_ROWS, DEFAULT_ROWS)
  const cols = clampInt(model.cols, 1, MAX_COLS, DEFAULT_COLS)
  const data: Record<string, string> = {}
  if (isObj(model.data)) {
    for (const [k, v] of Object.entries(model.data)) {
      const p = parseRef(k)
      if (!p || p.r >= rows || p.c >= cols || v === null || v === undefined) continue
      const raw = typeof v === 'string' ? v : String(v)
      if (raw) data[ref(p.r, p.c)] = raw
    }
  }
  const name = typeof model.name === 'string' && model.name ? model.name : fallbackName
  return { name, rows, cols, data }
}

/** Plain text: lines are rows, tabs or commas separate the columns. */
function fromText(text: string): SheetData {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const grid = lines.map((l) => l.split(/\t|,/))
  const rows = Math.max(DEFAULT_ROWS, grid.length)
  const cols = Math.max(DEFAULT_COLS, ...grid.map((r) => r.length))
  const data: Record<string, string> = {}
  grid.forEach((row, r) => row.forEach((v, c) => v.trim() && (data[ref(r, c)] = v)))
  return { name: 'Sheet1', rows: Math.min(rows, MAX_ROWS), cols: Math.min(cols, MAX_COLS), data }
}

export function emptySheet(name = 'Sheet1'): SheetData {
  return { name, rows: DEFAULT_ROWS, cols: DEFAULT_COLS, data: {} }
}

export function parseWorkbook(source: string): Workbook {
  let doc: unknown = null
  try {
    doc = source.trim() ? JSON.parse(source) : null
  } catch {
    doc = undefined
  }
  if (doc === null) return { sheets: [emptySheet()], active: 'Sheet1', plots: [] }
  if (isObj(doc) && Array.isArray(doc.sheets)) {
    const sheets = doc.sheets.filter(isObj).map((s, i) => sheetFrom(s, `Sheet${i + 1}`))
    if (!sheets.length) sheets.push(emptySheet())
    const plots = (Array.isArray(doc.plots) ? doc.plots : [])
      .filter(isObj)
      .filter((p) => typeof p.png === 'string')
      .map((p) => ({ title: typeof p.title === 'string' ? p.title : 'Plot', png: p.png as string }))
    const active = typeof doc.active === 'string' && sheets.some((s) => s.name === doc.active) ? doc.active : sheets[0].name
    return { sheets, active, plots }
  }
  if (isObj(doc) && 'data' in doc) {
    const s = sheetFrom({ ...doc, name: 'Sheet1' }, 'Sheet1')
    return { sheets: [s], active: s.name, plots: [] }
  }
  const s = fromText(typeof doc === 'string' ? doc : source)
  return { sheets: [s], active: s.name, plots: [] }
}

/** The desktop's source(): sheets, the active one and the static plots. */
export function serializeWorkbook(b: Workbook): string {
  return JSON.stringify({
    sheets: b.sheets.map((s) => ({ name: s.name, rows: s.rows, cols: s.cols, data: s.data })),
    active: b.active,
    plots: b.plots,
  })
}

export const activeIndex = (b: Workbook) => Math.max(0, b.sheets.findIndex((s) => s.name === b.active))

// ------------------------------------------------------------------- values

/** Python's float() syntax: what the desktop's parse_value treats as a number. */
const PY_FLOAT = /^\s*[+-]?(?:(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?|inf(?:inity)?|nan)\s*$/i

export function isNumeric(raw: string): boolean {
  return PY_FLOAT.test(raw)
}

export function toNumber(raw: string): number {
  const t = raw.trim().replace(/_/g, '').toLowerCase()
  if (/^[+-]?inf(inity)?$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity
  if (/^[+-]?nan$/.test(t)) return NaN
  return Number(t)
}

export const isFormula = (raw: string) => raw.trimStart().startsWith('=')

// ------------------------------------------------------------- operations

const shiftData = (data: Record<string, string>, fn: (r: number, c: number) => [number, number] | null) => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) {
    const p = parseRef(k)
    if (!p) continue
    const to = fn(p.r, p.c)
    if (to) out[ref(to[0], to[1])] = v
  }
  return out
}

function update(b: Workbook, i: number, fn: (s: SheetData) => SheetData): Workbook {
  return { ...b, sheets: b.sheets.map((s, k) => (k === i ? fn(s) : s)) }
}

export function setCells(b: Workbook, i: number, edits: { r: number; c: number; raw: string }[]): Workbook {
  return update(b, i, (s) => {
    const data = { ...s.data }
    let rows = s.rows
    let cols = s.cols
    for (const e of edits) {
      if (e.r < 0 || e.c < 0 || e.r >= MAX_ROWS || e.c >= MAX_COLS) continue
      const k = ref(e.r, e.c)
      if (e.raw) data[k] = e.raw
      else delete data[k]
      rows = Math.max(rows, e.r + 1)
      cols = Math.max(cols, e.c + 1)
    }
    return { ...s, data, rows, cols }
  })
}

export const addRow = (b: Workbook, i: number) => update(b, i, (s) => ({ ...s, rows: Math.min(MAX_ROWS, s.rows + 1) }))
export const addCol = (b: Workbook, i: number) => update(b, i, (s) => ({ ...s, cols: Math.min(MAX_COLS, s.cols + 1) }))

/** Remove row `r` (the last one when r < 0); the rows below move up. */
export function deleteRow(b: Workbook, i: number, r: number): Workbook {
  return update(b, i, (s) => {
    if (s.rows <= 1) return s
    const row = r >= 0 && r < s.rows ? r : s.rows - 1
    return { ...s, rows: s.rows - 1, data: shiftData(s.data, (rr, cc) => (rr === row ? null : [rr > row ? rr - 1 : rr, cc])) }
  })
}

export function deleteCol(b: Workbook, i: number, c: number): Workbook {
  return update(b, i, (s) => {
    if (s.cols <= 1) return s
    const col = c >= 0 && c < s.cols ? c : s.cols - 1
    return { ...s, cols: s.cols - 1, data: shiftData(s.data, (rr, cc) => (cc === col ? null : [rr, cc > col ? cc - 1 : cc])) }
  })
}

export function addSheet(b: Workbook): Workbook {
  let n = b.sheets.length + 1
  while (b.sheets.some((s) => s.name === `Sheet${n}`)) n++
  const name = `Sheet${n}`
  return { ...b, sheets: [...b.sheets, emptySheet(name)], active: name }
}

/** A tab / newline block (Excel, KherveSheet) pasted at r0, c0; the grid grows to fit. */
export function pasteBlock(b: Workbook, i: number, r0: number, c0: number, text: string): Workbook {
  let t = text.replace(/\r\n?/g, '\n')
  if (t.endsWith('\n')) t = t.slice(0, -1)
  if (!t) return b
  const grid = t.split('\n').map((line) => line.split('\t'))
  const edits = grid.flatMap((row, dr) => row.map((raw, dc) => ({ r: r0 + dr, c: c0 + dc, raw })))
  return setCells(b, i, edits)
}

/** The selected block as tab / newline text (displayed values), for the clipboard. */
export function copyBlock(display: (r: number, c: number) => string, r1: number, c1: number, r2: number, c2: number): string {
  const lines: string[] = []
  for (let r = r1; r <= r2; r++) {
    const cells: string[] = []
    for (let c = c1; c <= c2; c++) cells.push(display(r, c))
    lines.push(cells.join('\t'))
  }
  return lines.join('\n')
}

/** The rows of a sheet as plain values (raw text), trimmed to the used range. */
export function usedRows(s: SheetData): string[][] {
  let maxR = -1
  let maxC = -1
  for (const k of Object.keys(s.data)) {
    const p = parseRef(k)
    if (!p) continue
    maxR = Math.max(maxR, p.r)
    maxC = Math.max(maxC, p.c)
  }
  const out: string[][] = []
  for (let r = 0; r <= maxR; r++) {
    const row: string[] = []
    for (let c = 0; c <= maxC; c++) row.push(s.data[ref(r, c)] ?? '')
    out.push(row)
  }
  return out
}

/** The active grid as a Markdown table (the desktop's .ipynb display of a sheet). */
export function workbookMarkdown(source: string): string {
  try {
    const b = parseWorkbook(source)
    const s = b.sheets[activeIndex(b)]
    const esc = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ')
    const header = '| ' + Array.from({ length: s.cols }, (_, c) => colLetter(c)).join(' | ') + ' |'
    const sep = '|' + '---|'.repeat(Math.max(1, s.cols))
    const body = Array.from({ length: s.rows }, (_, r) =>
      '| ' + Array.from({ length: s.cols }, (_, c) => esc(s.data[ref(r, c)] ?? '')).join(' | ') + ' |',
    ).join('\n')
    return `${header}\n${sep}\n${body}`
  } catch {
    return '```\n' + source + '\n```'
  }
}

/** A short description of each sheet for the AI prompt (variables a code cell sees). */
export function describeWorkbook(source: string, firstVar: number): { text: string; count: number } {
  const b = parseWorkbook(source)
  const lines = ['this sheet cell publishes these grids to code cells (each a list of rows; row 0 is the header):']
  b.sheets.forEach((s, k) => {
    const header = Array.from({ length: Math.min(s.cols, 16) }, (_, c) => s.data[ref(0, c)] ?? '').filter(Boolean)
    const cols = header.length ? `, columns ${JSON.stringify(header)}` : ''
    lines.push(`  sheet${firstVar + k} — name ${JSON.stringify(s.name)}, ${s.rows} rows x ${s.cols} cols${cols}`)
  })
  return { text: lines.join('\n'), count: b.sheets.length }
}
