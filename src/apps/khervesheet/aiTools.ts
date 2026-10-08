// KherveSheet's AI tools (khervesheet_read_range, _set_cells, _add_sheet,
// _select, _chart, _save): what KherveAI and MCP clients can do in an open
// workbook. Their names, arguments and descriptions are in
// src/os/ai/appManifest.ts; KherveSheet.tsx registers these with useAppTools.
// Cells go through Book.setCells like typing (Python computes them, Undo works).

import { fs } from '@/os'
import { basename, extname, pretty } from '@/os/path'
import { drivePath } from '@/os/ai/tools'
import { waitUntil, type AppTools } from '@/os/ai/appTools'
import type { Book } from './book'
import { saveTo, save } from './files'
import { chartFromSelection } from './objects'
import { addSheet, layoutStep, newChart, validSheetName } from './ops'
import { a1, isFormula, isPython, parseCell, parseRange, rangeA1, splitSheetRef, usedExtent, type Range, type Sheet } from './model'

type Args = Record<string, unknown>

const MAX_READ = 400
const MAX_ECHO = 60

const optText = (a: Args, k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined)

async function ready(book: Book, signal?: AbortSignal) {
  const ok = await waitUntil(() => book.state.ready && !book.state.loading, 120_000, signal, 200)
  if (!ok) throw new Error('The spreadsheet engine (Python) is not ready yet. Try again in a moment.')
}

function sheetNamed(book: Book, name: string | undefined): Sheet {
  if (!name) return book.active
  const sh = book.byName(name)
  if (!sh) throw new Error(`There is no sheet "${name}". The sheets are: ${book.sheets.map((s) => s.name).join(', ')}.`)
  return sh
}

/** "B2:C5" or "Data!B2:C5" (a sheet in the reference wins over `sheet`). */
function rangeIn(book: Book, ref: string, sheet: string | undefined): { sh: Sheet; g: Range } {
  const { sheet: own, cells } = splitSheetRef(ref.trim())
  const sh = sheetNamed(book, own ?? sheet)
  const g = parseRange(cells.replace(/\s+/g, ''), sh.rows, sh.cols)
  if (!g) throw new Error(`"${ref}" is not a cell range. Write it like "A1:C10" or "B2".`)
  if (g.r2 >= sh.rows || g.c2 >= sh.cols) throw new Error(`${ref} is outside the sheet (${sh.rows} rows, ${sh.cols} columns).`)
  return { sh, g }
}

function show(book: Book, sh: Sheet) {
  if (book.state.active !== sh.id) book.activate(sh.id)
}

/** What a cell holds, for a model: its value (a number when it is one) and its formula. */
function cellInfo(book: Book, sh: Sheet, r: number, c: number) {
  const cell = book.cell(sh, r, c)
  const value = cell ? (cell.n ?? cell.t) : ''
  return { cell: a1(r, c), value, ...(cell && isFormula(cell.s) && { formula: cell.s }) }
}

/** A value from JSON as typed in a cell. */
function source(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return JSON.stringify(v)
}

/** {"A1": 1, "B2": "=A1*2", "A1:A3": [1, 2, 3]} → [row, col, source] (row by row for ranges). */
function cellsFrom(raw: unknown, sh: Sheet): [number, number, string][] {
  let obj = raw
  // [{cell: "A1", value: 1}…] also works.
  if (Array.isArray(raw)) {
    obj = Object.fromEntries(
      raw.map((x) => {
        const o = (x && typeof x === 'object' ? x : {}) as Args
        return [String(o.cell ?? o.ref ?? o.address ?? ''), o.value ?? o.formula ?? '']
      }),
    )
  }
  if (!obj || typeof obj !== 'object') throw new Error('"cells" must be an object like {"A1": 5, "A2": "=A1*2"}.')
  const out: [number, number, string][] = []
  const inside = (r: number, c: number, ref: string) => {
    if (r >= sh.rows || c >= sh.cols) throw new Error(`${ref} is outside the sheet (${sh.rows} rows, ${sh.cols} columns).`)
  }
  for (const [ref, v] of Object.entries(obj as Args)) {
    const k = ref.trim().replace(/\$/g, '')
    if (k.includes(':')) {
      const g = parseRange(k, sh.rows, sh.cols)
      if (!g) throw new Error(`"${ref}" is not a cell or range.`)
      inside(g.r2, g.c2, ref)
      if (Array.isArray(v) && v.length && v.every(Array.isArray)) {
        // Rows of values.
        ;(v as unknown[][]).forEach((row, i) =>
          row.forEach((x, j) => {
            if (g.r1 + i <= g.r2 && g.c1 + j <= g.c2) out.push([g.r1 + i, g.c1 + j, source(x)])
          }),
        )
      } else if (Array.isArray(v)) {
        // One list: down a column, or across a row.
        if (g.c1 !== g.c2 && g.r1 !== g.r2) throw new Error(`For the block ${ref}, give a list of rows, e.g. [[1, 2], [3, 4]].`)
        v.forEach((x, i) => {
          if (g.c1 === g.c2 && g.r1 + i <= g.r2) out.push([g.r1 + i, g.c1, source(x)])
          else if (g.c1 !== g.c2 && g.c1 + i <= g.c2) out.push([g.r1, g.c1 + i, source(x)])
        })
      } else {
        // One value for the whole range.
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) out.push([r, c, source(v)])
      }
      continue
    }
    const p = parseCell(k)
    if (!p) throw new Error(`"${ref}" is not a cell like "A1".`)
    inside(p.r, p.c, ref)
    out.push([p.r, p.c, source(v)])
  }
  if (!out.length) throw new Error('"cells" is empty: give at least one cell, e.g. {"A1": 5}.')
  if (out.length > 20000) throw new Error('That is too many cells for one call (at most 20000).')
  return out
}

export function sheetAiTools(book: Book): AppTools {
  return {
    async read_range(a, ctx) {
      await ready(book, ctx.signal)
      const ref = optText(a, 'range')
      let sh: Sheet
      let g: Range
      if (ref) ({ sh, g } = rangeIn(book, ref, optText(a, 'sheet')))
      else {
        sh = sheetNamed(book, optText(a, 'sheet'))
        const used = usedExtent(sh)
        if (used.rows < 0) return { sheet: sh.name, cells: [], note: 'The sheet is empty.', sheets: book.sheets.map((s) => s.name) }
        g = { r1: 0, c1: 0, r2: used.rows, c2: used.cols }
      }
      const cells: ReturnType<typeof cellInfo>[] = []
      let more = 0
      for (let r = g.r1; r <= g.r2; r++)
        for (let c = g.c1; c <= g.c2; c++) {
          const cell = book.cell(sh, r, c)
          if (!cell || (!cell.s && !cell.t)) continue
          if (cells.length < MAX_READ) cells.push(cellInfo(book, sh, r, c))
          else more++
        }
      return {
        sheet: sh.name,
        range: rangeA1(g),
        cells,
        ...(!cells.length && { note: 'No cell in this range holds anything.' }),
        ...(more && { truncated: true, more_cells: more }),
        sheets: book.sheets.map((s) => s.name),
      }
    },

    async set_cells(a, ctx) {
      await ready(book, ctx.signal)
      const sh = sheetNamed(book, optText(a, 'sheet'))
      const cells = cellsFrom(a.cells, sh)
      const python = cells.filter((x) => isPython(x[2])).map((x) => `# ${a1(x[0], x[1])}\n${x[2]}`)
      if (python.length && !(await ctx.allowPython(python.join('\n\n')))) throw new Error('The user did not allow these =PY (Python) cells to run.')
      if (book.state.edit) book.commitEdit()
      show(book, sh)
      book.set({ flash: null })
      await book.setCells(sh, cells, 'AI Edit', python.length > 0)
      await book.settle()
      // setCells puts the cells back and shows why when Python refuses them.
      const flash = book.state.flash
      if (flash && cells.some(([r, c, src]) => (book.cell(sh, r, c)?.s ?? '') !== src)) throw new Error(`kSheet did not take the cells: ${flash}`)
      const echo = cells.slice(0, MAX_ECHO).map(([r, c]) => cellInfo(book, sh, r, c))
      const errors = echo.filter((x) => typeof x.value === 'string' && x.value.startsWith('#')).map((x) => x.cell)
      return {
        sheet: sh.name,
        written: cells.length,
        cells: echo,
        ...(cells.length > MAX_ECHO && { note: `Showing the first ${MAX_ECHO}; khervesheet_read_range reads the rest.` }),
        ...(errors.length && { errors: `These cells show an error: ${errors.join(', ')}.` }),
      }
    },

    async add_sheet(a, ctx) {
      await ready(book, ctx.signal)
      const name = optText(a, 'name')
      if (name) {
        const bad = validSheetName(book, name)
        if (bad) throw new Error(bad)
      }
      const before = new Set(book.sheets)
      await addSheet(book, undefined, name)
      const added = book.sheets.find((s) => !before.has(s))
      if (!added) throw new Error(`The sheet could not be added${book.state.flash ? `: ${book.state.flash}` : '.'}`)
      return { sheet: added.name, sheets: book.sheets.map((s) => s.name) }
    },

    async select(a, ctx) {
      await ready(book, ctx.signal)
      const { sh, g } = rangeIn(book, String(a.range ?? ''), optText(a, 'sheet'))
      if (book.state.edit) book.commitEdit()
      show(book, sh)
      const at = { r: g.r1, c: g.c1 }
      book.select({ ranges: [g], active: at, anchor: at }, sh)
      book.bump()
      return { sheet: sh.name, selected: rangeA1(g) }
    },

    async chart(a, ctx) {
      await ready(book, ctx.signal)
      const { sh, g } = rangeIn(book, String(a.range ?? ''), optText(a, 'sheet'))
      const type = optText(a, 'type') ?? 'Line'
      if (book.state.edit) book.commitEdit()
      show(book, sh)
      const at = { r: g.r1, c: g.c1 }
      book.select({ ranges: [g], active: at, anchor: at }, sh)
      const spec = chartFromSelection(book, type)
      if (!spec) throw new Error(book.state.flash ?? `No chart can be made from ${rangeA1(g)}: select columns of numbers.`)
      const title = optText(a, 'title')
      if (title) spec.title = title
      const ch = newChart(spec)
      layoutStep(book, `Insert ${type} Chart`, (s) => void s.charts.push(ch))
      book.set({ object: { kind: 'chart', id: ch.id } })
      book.scheduleCharts(0)
      // Drawing it loads matplotlib the first time.
      await waitUntil(() => !ch.stale && (!!ch.url || !!ch.error), 60_000, ctx.signal, 200)
      if (ch.error) throw new Error(`The chart was added but could not be drawn: ${ch.error}`)
      return { chart: type, sheet: sh.name, x: spec.x ?? null, series: spec.series.map((s) => ({ name: s.name, data: s.ref })) }
    },

    async save(a, ctx) {
      await ready(book, ctx.signal)
      const given = optText(a, 'path')
      const current = book.state.path
      if (!given) {
        if (!current || (book.docKind !== 'ksheet' && book.docKind !== 'csv')) {
          throw new Error('This workbook has no .ksheet file yet: give "path", e.g. "~/Documents/data.ksheet".')
        }
        if (!(await save(book))) throw new Error(`${basename(current)} could not be saved (kSheet showed why).`)
        return { saved: pretty(current) }
      }
      let p = drivePath(given)
      if (/[\\/]\s*$/.test(given)) throw new Error(`"${given}" is a folder: add the file name.`)
      if (!extname(p)) p += '.ksheet'
      if (extname(p) !== '.ksheet' && extname(p) !== '.csv') throw new Error('kSheet saves .ksheet (or .csv) files.')
      if (fs.isDir(p)) throw new Error(`${pretty(p)} is a folder.`)
      if (fs.exists(p) && p !== current && !(await ctx.confirm(`replace ${pretty(p)}`, 'What is in it now will be lost.'))) {
        throw new Error(`The user did not allow replacing ${pretty(p)}.`)
      }
      if (!(await saveTo(book, p))) throw new Error(`${basename(p)} could not be saved (kSheet showed why).`)
      return { saved: pretty(p), ...(extname(p) === '.csv' && { note: 'A .csv file keeps only the values of the sheet shown.' }) }
    },
  }
}
