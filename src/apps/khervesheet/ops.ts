// Editing a workbook: clear, copy/paste, fill, insert and delete rows or
// columns, sort and filter, formats, merges, sizes, and sheets. Each
// operation changes the page's mirror, asks Python to recompute, and
// records one undo step.

import { os } from '@/os'
import { errorText, PyError, type Book } from './book'
import { clipFor, parseTsv, setClip, toTsv } from './clip'
import {
  DEFAULT_COLS, DEFAULT_ROWS, MAX_COLS, MAX_ROWS, cellEmpty, colName, currentRegion, expandMerges, key, keyCol, keyRow,
  mergeRange, newId, newSheet, patchFmt, rangesMeet, selCells, shiftDesignations, shiftIndex, shiftIndexMap, shiftKeyMap,
  shiftMerges, shiftRcRecord, shiftRef, shiftSpan, shiftSparkline, usedExtent, type Axis, type Border, type Chart, type ChartSpec, type Filter,
  type FloatObj, type Fmt, type InsertOps, type Key, type Merge, type Range, type Raw, type Sheet, type Sparkline,
} from './model'

// ----------------------------------------------------------------- layout

/** What an undo step keeps of a sheet's layout. */
export interface LayoutSnap {
  colW: Map<number, number>
  rowH: Map<number, number>
  merges: Merge[]
  freeze: [number, number]
  insertOps: InsertOps
  designations: Record<string, string>
  pyLoops: Record<string, number>
  charts: { id: string; spec: ChartSpec }[]
  images: FloatObj[]
  equations: FloatObj[]
  filter: Filter | null
  rows: number
  cols: number
}

const clone = <T>(v: T): T => (v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T))

export function snapLayout(sh: Sheet): LayoutSnap {
  return {
    colW: new Map(sh.colW),
    rowH: new Map(sh.rowH),
    merges: sh.merges.map((m) => [...m] as Merge),
    freeze: [...sh.freeze] as [number, number],
    insertOps: clone(sh.insertOps),
    designations: { ...sh.designations },
    pyLoops: { ...sh.pyLoops },
    charts: sh.charts.map((c) => ({ id: c.id, spec: clone(c.spec) })),
    images: sh.images.map((o) => ({ id: o.id, d: clone(o.d) })),
    equations: sh.equations.map((o) => ({ id: o.id, d: clone(o.d) })),
    filter: clone(sh.filter),
    rows: sh.rows,
    cols: sh.cols,
  }
}

export function restoreLayout(book: Book, sh: Sheet, s: LayoutSnap) {
  sh.colW = new Map(s.colW)
  sh.rowH = new Map(s.rowH)
  sh.merges = s.merges.map((m) => [...m] as Merge)
  sh.freeze = [...s.freeze] as [number, number]
  sh.insertOps = clone(s.insertOps)
  sh.designations = { ...s.designations }
  sh.pyLoops = { ...s.pyLoops }
  const old = new Map(sh.charts.map((c) => [c.id, c]))
  sh.charts = s.charts.map(({ id, spec }) => {
    const prev = old.get(id)
    const same = prev && JSON.stringify(prev.spec) === JSON.stringify(spec)
    if (prev) old.delete(id)
    return prev ? { ...prev, spec: clone(spec), stale: prev.stale || !same } : newChart(spec, id)
  })
  for (const gone of old.values()) if (gone.url) URL.revokeObjectURL(gone.url)
  sh.images = s.images.map((o) => ({ id: o.id, d: clone(o.d) }))
  sh.equations = s.equations.map((o) => ({ id: o.id, d: clone(o.d) }))
  sh.filter = clone(s.filter)
  sh.rows = Math.max(sh.rows, s.rows)
  sh.cols = Math.max(sh.cols, s.cols)
  applyFilter(sh)
  sh.geomV++
  book.scheduleCharts(0)
  book.bump()
}

export function newChart(spec: ChartSpec, id = newId('c')): Chart {
  return { id, spec, url: null, error: null, fits: [], stale: true }
}

/** Change a sheet's layout as one undo step. */
export function layoutStep(book: Book, label: string, change: (sh: Sheet) => void, sh = book.active) {
  const before = snapLayout(sh)
  change(sh)
  sh.geomV++
  const after = snapLayout(sh)
  book.bump()
  book.scheduleCharts(0)
  book.record({
    label,
    sheet: sh.id,
    selBefore: sh.sel,
    selAfter: sh.sel,
    undo: async () => restoreLayout(book, sh, before),
    redo: async () => restoreLayout(book, sh, after),
  })
}

// ----------------------------------------------------------------- formats

type FmtEntry = [Key, Fmt | undefined]

/** Set formats; number formats are also sent to Python (they change what cells show). */
export async function applyFormats(book: Book, sh: Sheet, entries: FmtEntry[]) {
  const numfmts: [number, number, string | null][] = []
  for (const [k, f] of entries) {
    const old = sh.formats.get(k)
    if ((old?.number_format ?? null) !== (f?.number_format ?? null)) numfmts.push([keyRow(k), keyCol(k), f?.number_format ?? null])
    if (f) sh.formats.set(k, f)
    else sh.formats.delete(k)
  }
  book.bump()
  if (numfmts.length) await book.py('numfmt', { sheet: sh.name, cells: numfmts })
}

/**
 * The selection's cells for formatting. Whole rows or columns stop at the
 * cells in use (formats are kept per cell, as on the desktop).
 */
export function formatTargets(sh: Sheet): { r: number; c: number }[] {
  const used = usedExtent(sh)
  const ranges = sh.sel.ranges.map((g) => ({
    ...g,
    r2: g.r1 === 0 && g.r2 >= sh.rows - 1 ? Math.max(used.rows, 0) : g.r2,
    c2: g.c1 === 0 && g.c2 >= sh.cols - 1 ? Math.max(used.cols, 0) : g.c2,
  }))
  return selCells({ ...sh.sel, ranges })
}

/** Change the format of cells (the selection by default) as one undo step. */
export async function formatCells(
  book: Book,
  change: Partial<Fmt> | ((f: Fmt | undefined, r: number, c: number) => Fmt | undefined),
  label: string,
  cells?: { r: number; c: number }[],
) {
  const sh = book.active
  const list = cells ?? formatTargets(sh)
  const before: FmtEntry[] = []
  const after: FmtEntry[] = []
  for (const { r, c } of list) {
    const k = key(r, c)
    const old = sh.formats.get(k)
    const next = typeof change === 'function' ? change(old, r, c) : patchFmt(old, change)
    if (JSON.stringify(old ?? null) === JSON.stringify(next ?? null)) continue
    before.push([k, old])
    after.push([k, next])
  }
  if (!after.length) return
  try {
    await applyFormats(book, sh, after)
  } catch (e) {
    book.showFlash(errorText(e))
  }
  book.record({
    label,
    sheet: sh.id,
    selBefore: sh.sel,
    selAfter: sh.sel,
    undo: () => applyFormats(book, sh, before),
    redo: () => applyFormats(book, sh, after),
  })
}

/** Bold, italic, underline, wrap: on for all if the active cell is off. */
export function toggleFlag(book: Book, flag: 'bold' | 'italic' | 'underline' | 'wrap_text', label: string) {
  const sh = book.active
  const { r, c } = sh.sel.active
  const on = !sh.formats.get(key(r, c))?.[flag]
  void formatCells(book, { [flag]: on ? true : undefined }, label)
}

export type BorderKind =
  | 'all' | 'outside' | 'inside' | 'top' | 'bottom' | 'left' | 'right' | 'none' | 'thick'
  | 'thick_outside' | 'bottom_double' | 'thick_bottom' | 'top_bottom' | 'top_thick_bottom' | 'top_double_bottom'

/** The desktop's Borders menu (mainwindow._BORDER_PRESETS), in its order; null = separator. */
export const BORDER_PRESETS: ([string, BorderKind] | null)[] = [
  ['Bottom Border', 'bottom'],
  ['Top Border', 'top'],
  ['Left Border', 'left'],
  ['Right Border', 'right'],
  ['No Border', 'none'],
  null,
  ['All Borders', 'all'],
  ['Outside Borders', 'outside'],
  ['Thick Outside Borders', 'thick_outside'],
  null,
  ['Bottom Double Border', 'bottom_double'],
  ['Thick Bottom Border', 'thick_bottom'],
  ['Top and Bottom Border', 'top_bottom'],
  ['Top and Thick Bottom Border', 'top_thick_bottom'],
  ['Top and Double Bottom Border', 'top_double_bottom'],
]

/** Apply a border preset to the selection, as the desktop's _apply_border_preset. */
export function setBorders(book: Book, kind: BorderKind, color = '#000000') {
  const sh = book.active
  const thin: Border = { style: 1, color, width: 1 }
  const thick: Border = { style: 1, color, width: 2 }
  // The desktop approximates a double line with a dashed one.
  const double: Border = { style: 2, color, width: 1 }
  const ranges = sh.sel.ranges
  const edge = (r: number, c: number) => {
    const g = ranges.find((x) => r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2)!
    return { top: r === g.r1, bottom: r === g.r2, left: c === g.c1, right: c === g.c2 }
  }
  void formatCells(
    book,
    (f, r, c) => {
      const e = edge(r, c)
      const p: Partial<Fmt> = {}
      const box = (b: Border) => {
        if (e.top) p.b_top = b
        if (e.bottom) p.b_bottom = b
        if (e.left) p.b_left = b
        if (e.right) p.b_right = b
      }
      if (kind === 'none') Object.assign(p, { b_top: undefined, b_bottom: undefined, b_left: undefined, b_right: undefined })
      else if (kind === 'all') Object.assign(p, { b_top: thin, b_bottom: thin, b_left: thin, b_right: thin })
      else if (kind === 'outside') box(thin)
      else if (kind === 'thick' || kind === 'thick_outside') box(thick)
      else if (kind === 'inside') {
        if (!e.bottom) p.b_bottom = thin
        if (!e.right) p.b_right = thin
        if (!e.top) p.b_top = thin
        if (!e.left) p.b_left = thin
      } else if (kind === 'bottom_double') {
        if (e.bottom) p.b_bottom = double
      } else if (kind === 'thick_bottom') {
        if (e.bottom) p.b_bottom = thick
      } else if (kind === 'top_bottom' || kind === 'top_thick_bottom' || kind === 'top_double_bottom') {
        if (e.top) p.b_top = thin
        if (e.bottom) p.b_bottom = kind === 'top_bottom' ? thin : kind === 'top_thick_bottom' ? thick : double
      } else if (e[kind]) p[`b_${kind}` as const] = thin
      return patchFmt(f, p)
    },
    `Border: ${kind}`,
  )
}

/** Excel's alignment buttons: horizontal flag, vertically centred. */
export function align(book: Book, h: 'left' | 'center' | 'right' | null) {
  const flags = h === 'left' ? 0x1 : h === 'right' ? 0x2 : h === 'center' ? 0x4 : 0
  void formatCells(book, (f) => patchFmt(f, { alignment: flags ? flags | 0x80 : undefined }), 'Align')
}

export function setNumberFormat(book: Book, fmt: string | null) {
  void formatCells(book, { number_format: fmt && fmt !== 'General' ? fmt : undefined }, 'Number Format')
}

/** One more or one fewer decimal place (0 … 0.0000). */
export function stepDecimals(book: Book, d: 1 | -1) {
  const sh = book.active
  const { r, c } = sh.sel.active
  const cur = sh.formats.get(key(r, c))?.number_format
  const places = cur && /^0(\.0*)?$/.test(cur) ? (cur.split('.')[1] ?? '').length : 2
  const next = Math.max(0, Math.min(4, places + d))
  setNumberFormat(book, next ? `0.${'0'.repeat(next)}` : '0')
}

export async function clearFormats(book: Book) {
  await formatCells(book, () => undefined, 'Clear Formats')
}

// -------------------------------------------------------------- contents

export async function clearContents(book: Book, label = 'Clear') {
  const sh = book.active
  const cells: [number, number, string][] = []
  for (const { r, c } of selCells(sh.sel)) if (!cellEmpty(sh, r, c)) cells.push([r, c, ''])
  await book.setCells(sh, cells, label)
}

export async function clearAll(book: Book) {
  await clearContents(book, 'Clear All')
  await clearFormats(book)
}

// ---------------------------------------------------------------- copy

function grow(sh: Sheet, rows: number, cols: number) {
  if (rows > sh.rows || cols > sh.cols) {
    sh.rows = Math.min(MAX_ROWS, Math.max(sh.rows, rows))
    sh.cols = Math.min(MAX_COLS, Math.max(sh.cols, cols))
    sh.geomV++
  }
}

/** Copy (or cut) the selection; returns the text for the system clipboard. */
export function copySelection(book: Book, cut = false): string | null {
  const sh = book.active
  if (sh.sel.ranges.length > 1) {
    book.showFlash('That command cannot be used on several selections.')
    return null
  }
  const g = sh.sel.ranges[0]
  if ((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > 2_000_000) {
    book.showFlash('The selection is too large to copy.')
    return null
  }
  // Trim whole rows/columns to the cells in use.
  let r2 = g.r2
  let c2 = g.c2
  if (g.r2 - g.r1 > 2000 || g.c2 - g.c1 > 200) {
    let lr = g.r1
    let lc = g.c1
    for (const [k, cell] of sh.cells) {
      const r = keyRow(k)
      const c = keyCol(k)
      if ((cell.s || cell.t) && r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2) {
        lr = Math.max(lr, r)
        lc = Math.max(lc, c)
      }
    }
    r2 = lr
    c2 = lc
  }
  const range = { r1: g.r1, c1: g.c1, r2, c2 }
  const sources: string[][] = []
  const texts: string[][] = []
  const formats: (Fmt | undefined)[][] = []
  for (let r = range.r1; r <= range.r2; r++) {
    const s: string[] = []
    const t: string[] = []
    const f: (Fmt | undefined)[] = []
    for (let c = range.c1; c <= range.c2; c++) {
      const cell = sh.cells.get(key(r, c))
      s.push(cell?.s ?? '')
      t.push(cell?.t ?? '')
      f.push(sh.formats.get(key(r, c)))
    }
    sources.push(s)
    texts.push(t)
    formats.push(f)
  }
  const text = toTsv(texts)
  setClip({ text, sheetId: sh.id, range, sources, texts, formats })
  book.set({ ants: cut ? null : { sheet: sh.id, range } })
  if (cut) {
    const keep = sh.sel
    book.select({ ranges: [range], active: { r: range.r1, c: range.c1 }, anchor: { r: range.r1, c: range.c1 } })
    void clearAll(book).then(() => book.select(keep))
  }
  return text
}

/** Paste clipboard text at the selection (formulas and formats when it is this app's own copy). */
export async function pasteText(book: Book, text: string, valuesOnly = false) {
  const sh = book.active
  const g = sh.sel.ranges[0]
  const at = { r: g.r1, c: g.c1 }
  const clip = clipFor(text)
  let rows: string[][]
  let formats: (Fmt | undefined)[][] | null = null
  let shift: [number, number] | null = null
  if (clip && !valuesOnly) {
    rows = clip.sources
    formats = clip.formats
    shift = [at.r - clip.range.r1, at.c - clip.range.c1]
  } else if (clip) rows = clip.texts
  else rows = parseTsv(text)
  if (!rows.length) return
  const width = Math.max(...rows.map((r) => r.length))
  // One cell copied onto a larger selection fills it, like Excel.
  const tile = rows.length === 1 && width === 1 && sh.sel.ranges.length === 1 && (g.r2 > g.r1 || g.c2 > g.c1)
  const target = tile ? { ...g } : { r1: at.r, c1: at.c, r2: at.r + rows.length - 1, c2: at.c + width - 1 }
  if (target.r2 - target.r1 + 1 > MAX_ROWS || target.c2 >= MAX_COLS) {
    book.showFlash('The pasted block does not fit in the sheet.')
    return
  }
  grow(sh, target.r2 + 1, target.c2 + 1)
  const before = book.rawsIn(sh, target)
  const fBefore: FmtEntry[] = []
  const fAfter: FmtEntry[] = []
  for (let r = target.r1; r <= target.r2; r++)
    for (let c = target.c1; c <= target.c2; c++) {
      const f = formats ? formats[tile ? 0 : r - at.r]?.[tile ? 0 : c - at.c] : undefined
      if (!formats) continue
      fBefore.push([key(r, c), sh.formats.get(key(r, c))])
      fAfter.push([key(r, c), f])
    }
  try {
    const sources = rows.flat()
    const hints = book.hintsFor(sources)
    if (tile) {
      const src = rows[0][0]
      const reqs: Promise<unknown>[] = []
      for (let r = target.r1; r <= target.r2; r++)
        for (let c = target.c1; c <= target.c2; c++) {
          const sft = clip && shift ? [r - clip.range.r1, c - clip.range.c1] : null
          reqs.push(book.py('paste', { sheet: sh.name, at: [r, c], rows: [[src]], shift: sft, trust: true }, hints))
        }
      await Promise.all(reqs)
    } else await book.py('paste', { sheet: sh.name, at: [at.r, at.c], rows, shift, trust: true }, hints)
    if (formats) await applyFormats(book, sh, fAfter)
  } catch (e) {
    book.showFlash(errorText(e))
    return
  }
  const after = book.rawsIn(sh, target)
  const selAfter = { ranges: [target], active: at, anchor: at }
  book.record({
    label: 'Paste',
    sheet: sh.id,
    selBefore: sh.sel,
    selAfter,
    undo: async () => {
      await book.putRaw(sh, before)
      if (formats) await applyFormats(book, sh, fBefore)
    },
    redo: async () => {
      await book.putRaw(sh, after)
      if (formats) await applyFormats(book, sh, fAfter)
    },
  })
  book.select(selAfter)
}

// ------------------------------------------------------------------ fill

/** Fill `dst` from `src` (the fill handle, Ctrl+D, Ctrl+R): series, formulas and formats. */
export async function fillRange(book: Book, src: Range, dst: Range) {
  const sh = book.active
  if (src.r1 === dst.r1 && src.r2 === dst.r2 && src.c1 === dst.c1 && src.c2 === dst.c2) return
  grow(sh, dst.r2 + 1, dst.c2 + 1)
  const before = book.rawsIn(sh, dst)
  const fBefore: FmtEntry[] = []
  const fAfter: FmtEntry[] = []
  const h = src.r2 - src.r1 + 1
  const w = src.c2 - src.c1 + 1
  const mod = (a: number, n: number) => ((a % n) + n) % n
  for (let r = dst.r1; r <= dst.r2; r++)
    for (let c = dst.c1; c <= dst.c2; c++) {
      if (r >= src.r1 && r <= src.r2 && c >= src.c1 && c <= src.c2) continue
      const from = key(src.r1 + mod(r - src.r1, h), src.c1 + mod(c - src.c1, w))
      fBefore.push([key(r, c), sh.formats.get(key(r, c))])
      fAfter.push([key(r, c), sh.formats.get(from)])
    }
  const sources: string[] = []
  for (let r = src.r1; r <= src.r2; r++) for (let c = src.c1; c <= src.c2; c++) sources.push(sh.cells.get(key(r, c))?.s ?? '')
  try {
    await book.py('fill', { sheet: sh.name, src: [src.r1, src.c1, src.r2, src.c2], dst: [dst.r1, dst.c1, dst.r2, dst.c2] }, book.hintsFor(sources))
    await applyFormats(book, sh, fAfter)
  } catch (e) {
    book.showFlash(errorText(e))
    return
  }
  const after = book.rawsIn(sh, dst)
  const selAfter = { ranges: [dst], active: sh.sel.active, anchor: sh.sel.anchor }
  book.record({
    label: 'Fill',
    sheet: sh.id,
    selBefore: sh.sel,
    selAfter,
    undo: async () => {
      await book.putRaw(sh, before)
      await applyFormats(book, sh, fBefore)
    },
    redo: async () => {
      await book.putRaw(sh, after)
      await applyFormats(book, sh, fAfter)
    },
  })
  book.select(selAfter)
}

/** Ctrl+D / Ctrl+R: from the first row (column) of the selection, or the cell above (left). */
export function fillDownRight(book: Book, down: boolean) {
  const g = book.active.sel.ranges[0]
  if (down) {
    if (g.r2 > g.r1) void fillRange(book, { ...g, r2: g.r1 }, g)
    else if (g.r1 > 0) void fillRange(book, { ...g, r1: g.r1 - 1, r2: g.r1 - 1 }, { ...g, r1: g.r1 - 1 })
  } else if (g.c2 > g.c1) void fillRange(book, { ...g, c2: g.c1 }, g)
  else if (g.c1 > 0) void fillRange(book, { ...g, c1: g.c1 - 1, c2: g.c1 - 1 }, { ...g, c1: g.c1 - 1 })
}

/** Double-click on the fill handle: down as far as the next column's data (the desktop's _auto_fill_down). */
export function autoFill(book: Book) {
  const sh = book.active
  const g = sh.sel.ranges[sh.sel.ranges.length - 1]
  let last = g.r2
  for (const col of [g.c1 - 1, g.c2 + 1]) {
    if (col < 0 || col >= sh.cols) continue
    let r = g.r2 + 1
    while (r < sh.rows && !cellEmpty(sh, r, col)) r++
    last = r - 1
    if (last > g.r2) break
  }
  if (last > g.r2) void fillRange(book, g, { ...g, r2: last })
}

// -------------------------------------------- inserting / deleting rows, columns

function shiftLayout(book: Book, sh: Sheet, axis: Axis, at: number, n: number) {
  sh.formats = shiftKeyMap(sh.formats, axis, at, n)
  if (axis === 'rows') {
    sh.rowH = shiftIndexMap(sh.rowH, at, n)
    if (n > 0) sh.rows = Math.min(MAX_ROWS, sh.rows + n)
  } else {
    sh.colW = shiftIndexMap(sh.colW, at, n)
    sh.designations = shiftDesignations(sh.designations, at, n)
    if (n > 0) sh.cols = Math.min(MAX_COLS, sh.cols + n)
  }
  sh.merges = shiftMerges(sh.merges, axis, at, n)
  const ops: InsertOps = {}
  for (const [name, rec] of Object.entries(sh.insertOps)) {
    if (name === 'sparklines' && rec && typeof rec === 'object') {
      const moved = shiftRcRecord(rec as Record<string, Sparkline>, axis, at, n) ?? {}
      const out: Record<string, Sparkline> = {}
      for (const [k, sp] of Object.entries(moved)) {
        const s2 = shiftSparkline(sp, axis, at, n)
        if (s2) out[k] = s2
      }
      ops.sparklines = out
    } else if (rec && typeof rec === 'object' && !Array.isArray(rec)) ops[name] = shiftRcRecord(rec as Record<string, unknown>, axis, at, n)
    else ops[name] = rec
  }
  sh.insertOps = ops
  const loops = shiftRcRecord(sh.pyLoops, axis, at, n)
  sh.pyLoops = loops ?? {}
  if (sh.filter) {
    const g = sh.filter.range
    const span = axis === 'rows' ? shiftSpan(g.r1, g.r2, at, n) : shiftSpan(g.c1, g.c2, at, n)
    if (!span) sh.filter = null
    else {
      sh.filter.range = axis === 'rows' ? { ...g, r1: span[0], r2: span[1] } : { ...g, c1: span[0], c2: span[1] }
      if (axis === 'cols') {
        const keep: Filter['keep'] = {}
        for (const [c, v] of Object.entries(sh.filter.keep)) {
          const nc = shiftIndex(Number(c), at, n)
          if (nc !== null) keep[nc] = v
        }
        sh.filter.keep = keep
      }
    }
  }
  // Charts anywhere that read this sheet follow their data.
  for (const other of book.sheets)
    for (const ch of other.charts) {
      const s = ch.spec
      const x = s.x ? shiftRef(s.x, other.name, sh.name, axis, at, n) : s.x
      const series = s.series.map((ser) => ({ ...ser, ref: shiftRef(ser.ref, other.name, sh.name, axis, at, n) }))
      if (x !== s.x || series.some((ser, i) => ser.ref !== s.series[i].ref)) {
        ch.spec = { ...s, x, series }
        ch.stale = true
      }
    }
  applyFilter(sh)
  sh.geomV++
}

function allCharts(book: Book): Map<string, { id: string; spec: ChartSpec }[]> {
  return new Map(book.sheets.map((s) => [s.id, s.charts.map((c) => ({ id: c.id, spec: clone(c.spec) }))]))
}

function restoreCharts(book: Book, snap: Map<string, { id: string; spec: ChartSpec }[]>) {
  for (const sh of book.sheets) {
    const list = snap.get(sh.id)
    if (!list) continue
    const old = new Map(sh.charts.map((c) => [c.id, c]))
    sh.charts = list.map(({ id, spec }) => {
      const prev = old.get(id)
      return prev ? { ...prev, spec: clone(spec), stale: true } : newChart(clone(spec), id)
    })
  }
}

/** Insert (n > 0) or delete (n < 0) rows or columns at `at`. */
export async function restructure(book: Book, axis: Axis, at: number, n: number) {
  const sh = book.active
  const what = axis === 'rows' ? (Math.abs(n) === 1 ? 'Row' : 'Rows') : Math.abs(n) === 1 ? 'Column' : 'Columns'
  const label = `${n > 0 ? 'Insert' : 'Delete'} ${what}`
  const layoutBefore = snapLayout(sh)
  const fmtBefore = new Map(sh.formats)
  const chartsBefore = allCharts(book)
  const restore = n < 0 ? { cells: book.raws(sh), numfmts: book.numfmts(sh) } : null
  let others: { sheet: Sheet; before: Raw[]; after: Raw[] }[] = []
  try {
    const a = await book.bridge.call('restructure', { sheet: sh.name, axis, at, n })
    if (!a.ok) throw new PyError(a.error ?? 'Python could not do that.', a.trace)
    const bySheet = new Map<Sheet, [number, number][]>()
    for (const [name, r, c] of (a.sources as [string, number, number, string][]) ?? []) {
      const other = book.byName(name)
      if (!other || other === sh) continue
      if (!bySheet.has(other)) bySheet.set(other, [])
      bySheet.get(other)!.push([r, c])
    }
    others = [...bySheet].map(([other, cells]) => ({ sheet: other, before: cells.map(([r, c]) => book.raw(other, r, c)), after: [] }))
    book.apply(a)
    for (const o of others) o.after = o.before.map(([r, c]) => book.raw(o.sheet, r, c))
  } catch (e) {
    book.showFlash(errorText(e))
    return
  }
  shiftLayout(book, sh, axis, at, n)
  const layoutAfter = snapLayout(sh)
  const fmtAfter = new Map(sh.formats)
  const chartsAfter = allCharts(book)
  book.markDirty()
  book.scheduleCharts(0)
  book.bump()
  book.record({
    label,
    sheet: sh.id,
    selBefore: sh.sel,
    selAfter: sh.sel,
    undo: async () => {
      if (restore) {
        await book.py('replace', { sheet: sh.name, cells: restore.cells, numfmts: restore.numfmts })
        for (const o of others) await book.putRaw(o.sheet, o.before)
      } else await book.py('restructure', { sheet: sh.name, axis, at, n: -n })
      sh.formats = new Map(fmtBefore)
      restoreLayout(book, sh, layoutBefore)
      restoreCharts(book, chartsBefore)
    },
    redo: async () => {
      await book.py('restructure', { sheet: sh.name, axis, at, n })
      sh.formats = new Map(fmtAfter)
      restoreLayout(book, sh, layoutAfter)
      restoreCharts(book, chartsAfter)
    },
  })
}

/** Insert rows above (or below) the selected rows, as many as are selected. */
export function insertRows(book: Book, below = false) {
  const g = book.active.sel.ranges[0]
  const n = g.r2 - g.r1 + 1
  void restructure(book, 'rows', below ? g.r2 + 1 : g.r1, n)
}

export function insertCols(book: Book, right = false) {
  const g = book.active.sel.ranges[0]
  const n = g.c2 - g.c1 + 1
  void restructure(book, 'cols', right ? g.c2 + 1 : g.c1, n)
}

export function deleteRows(book: Book) {
  const g = book.active.sel.ranges[0]
  void restructure(book, 'rows', g.r1, -(g.r2 - g.r1 + 1))
}

export function deleteCols(book: Book) {
  const g = book.active.sel.ranges[0]
  void restructure(book, 'cols', g.c1, -(g.c2 - g.c1 + 1))
}

// ------------------------------------------------------------ sort, filter

/** The range a sort or filter works on: the selection, or the data around the active cell. */
export function dataRange(book: Book): Range {
  const sh = book.active
  const g = sh.sel.ranges[0]
  if (sh.sel.ranges.length === 1 && (g.r2 > g.r1 || g.c2 > g.c1)) {
    // Whole columns: down to the last row in use.
    if (g.r2 - g.r1 > 2000) {
      let last = g.r1
      for (const [k, cell] of sh.cells) if ((cell.s || cell.t) && keyCol(k) >= g.c1 && keyCol(k) <= g.c2) last = Math.max(last, keyRow(k))
      return { ...g, r2: last }
    }
    return g
  }
  return currentRegion(sh, sh.sel.active.r, sh.sel.active.c)
}

/** A header row: the first row is text where the next has numbers. */
export function looksLikeHeader(sh: Sheet, g: Range): boolean {
  if (g.r2 <= g.r1) return false
  let text = 0
  let nums = 0
  for (let c = g.c1; c <= g.c2; c++) {
    const top = sh.cells.get(key(g.r1, c))
    const next = sh.cells.get(key(g.r1 + 1, c))
    if (top?.t && top.n === null && Number.isNaN(Number(top.t))) text++
    if (next?.t && (next.n !== null || !Number.isNaN(Number(next.t)))) nums++
  }
  return text > 0 && (nums > 0 || text === g.c2 - g.c1 + 1)
}

export async function sortRange(book: Book, g: Range, col: number, ascending: boolean, header: boolean) {
  const sh = book.active
  const before = book.rawsIn(sh, g)
  const fBefore: FmtEntry[] = []
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) fBefore.push([key(r, c), sh.formats.get(key(r, c))])
  const opsBefore = clone(sh.insertOps)
  let perm: [number, number][]
  try {
    const a = await book.py<{ ok: boolean; perm: [number, number][] }>('sort', {
      sheet: sh.name, range: [g.r1, g.c1, g.r2, g.c2], key: col, ascending, header,
    })
    perm = a.perm
  } catch (e) {
    book.showFlash(errorText(e))
    return
  }
  // Formats and notes travel with their rows (Python moved the number formats).
  const oldFmt = new Map(fBefore)
  const fAfter: FmtEntry[] = []
  const rowMap = new Map(perm)
  for (const [nr, or] of perm) for (let c = g.c1; c <= g.c2; c++) fAfter.push([key(nr, c), oldFmt.get(key(or, c))])
  for (const [k, f] of fAfter) {
    if (f) sh.formats.set(k, f)
    else sh.formats.delete(k)
  }
  const ops: InsertOps = {}
  for (const [name, rec] of Object.entries(sh.insertOps)) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      ops[name] = rec
      continue
    }
    const out: Record<string, unknown> = {}
    const movedFrom = new Map([...rowMap].map(([nr, or]) => [or, nr]))
    for (const [rc, v] of Object.entries(rec as Record<string, unknown>)) {
      const [r, c] = rc.split(',').map(Number)
      const inside = r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2
      const nr = inside ? (movedFrom.get(r) ?? r) : r
      out[`${nr},${c}`] = v
    }
    ops[name] = out
  }
  sh.insertOps = ops
  const opsAfter = clone(sh.insertOps)
  const after = book.rawsIn(sh, g)
  book.bump()
  book.record({
    label: 'Sort',
    sheet: sh.id,
    selBefore: sh.sel,
    selAfter: sh.sel,
    undo: async () => {
      await book.putRaw(sh, before)
      await applyFormats(book, sh, fBefore)
      sh.insertOps = clone(opsBefore)
    },
    redo: async () => {
      await book.putRaw(sh, after)
      await applyFormats(book, sh, fAfter)
      sh.insertOps = clone(opsAfter)
    },
  })
}

export function quickSort(book: Book, ascending: boolean) {
  const sh = book.active
  const g = dataRange(book)
  const col = Math.min(Math.max(sh.sel.active.c, g.c1), g.c2)
  void sortRange(book, g, col, ascending, looksLikeHeader(sh, g))
}

/** Hide the rows the filter does not keep. */
export function applyFilter(sh: Sheet) {
  sh.hidden = new Set()
  const f = sh.filter
  if (!f) return
  const cols = Object.entries(f.keep).map(([c, v]) => [Number(c), new Set(v)] as const)
  if (!cols.length) return
  for (let r = f.range.r1 + 1; r <= f.range.r2; r++)
    for (const [c, keep] of cols) {
      if (!keep.has(sh.cells.get(key(r, c))?.t ?? '')) {
        sh.hidden.add(r)
        break
      }
    }
}

export function toggleFilter(book: Book) {
  const sh = book.active
  if (sh.filter) sh.filter = null
  else {
    const g = dataRange(book)
    if (g.r2 <= g.r1) {
      book.showFlash('Select a table with a header row to filter it.')
      return
    }
    sh.filter = { range: g, keep: {} }
  }
  applyFilter(sh)
  sh.geomV++
  book.markDirty()
  book.bump()
}

/** The different texts of a filter column, with how often each appears. */
export function filterValues(sh: Sheet, col: number): { text: string; count: number }[] {
  const f = sh.filter
  if (!f) return []
  const counts = new Map<string, number>()
  for (let r = f.range.r1 + 1; r <= f.range.r2; r++) {
    const t = sh.cells.get(key(r, col))?.t ?? ''
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const num = (s: string) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null)
  return [...counts]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => {
      const na = num(a.text)
      const nb = num(b.text)
      if (a.text === '') return 1
      if (b.text === '') return -1
      if (na !== null && nb !== null) return na - nb
      return a.text.localeCompare(b.text)
    })
}

export function setFilterKeep(book: Book, col: number, keep: string[] | null) {
  const sh = book.active
  if (!sh.filter) return
  if (keep) sh.filter.keep[col] = keep
  else delete sh.filter.keep[col]
  applyFilter(sh)
  sh.geomV++
  book.bump()
}

// ----------------------------------------------------------- merge, sizes

export async function mergeCells(book: Book) {
  const sh = book.active
  const targets = sh.sel.ranges.filter((g) => g.r2 > g.r1 || g.c2 > g.c1)
  if (!targets.length) return
  // Like the desktop, merging keeps the top-left cell and clears the others.
  const cleared: [number, number, string][] = []
  for (const g of targets)
    for (let r = g.r1; r <= g.r2; r++)
      for (let c = g.c1; c <= g.c2; c++) if ((r !== g.r1 || c !== g.c1) && !cellEmpty(sh, r, c)) cleared.push([r, c, ''])
  if (cleared.length) {
    const ok = await os.dialog.confirm('Merging keeps only the value of the top-left cell. Merge anyway?', { title: 'Merge Cells', okLabel: 'Merge' })
    if (!ok) return
    await book.setCells(sh, cleared, 'Merge Cells')
  }
  layoutStep(book, 'Merge Cells', (s) => {
    s.merges = s.merges.filter((m) => !targets.some((g) => rangesMeet(g, mergeRange(m))))
    for (const g of targets) s.merges.push([g.r1, g.c1, g.r2 - g.r1 + 1, g.c2 - g.c1 + 1])
  })
}

export function unmergeCells(book: Book) {
  const sh = book.active
  const hit = sh.merges.filter((m) => sh.sel.ranges.some((g) => rangesMeet(g, mergeRange(m))))
  if (!hit.length) return
  layoutStep(book, 'Unmerge Cells', (s) => {
    s.merges = s.merges.filter((m) => !hit.includes(m))
  })
}

export function toggleMerge(book: Book) {
  const sh = book.active
  const g = sh.sel.ranges[0]
  const covered = sh.merges.some((m) => rangesMeet(g, mergeRange(m)))
  if (covered) unmergeCells(book)
  else void mergeCells(book)
}

/** Selected columns (whole or partly selected). */
export function selectedCols(book: Book): number[] {
  const set = new Set<number>()
  for (const g of book.active.sel.ranges) for (let c = g.c1; c <= g.c2; c++) set.add(c)
  return [...set].sort((a, b) => a - b)
}

export function selectedRows(book: Book): number[] {
  const set = new Set<number>()
  for (const g of book.active.sel.ranges) for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 100000); r++) set.add(r)
  return [...set].sort((a, b) => a - b)
}

export function setColWidth(book: Book, cols: number[], w: number | null) {
  layoutStep(book, 'Column Width', (s) => {
    for (const c of cols) {
      if (w === null || w === 80) s.colW.delete(c)
      else s.colW.set(c, Math.max(0, Math.round(w)))
    }
  })
}

export function setRowHeight(book: Book, rows: number[], h: number | null) {
  layoutStep(book, 'Row Height', (s) => {
    for (const r of rows) {
      if (h === null || h === 20) s.rowH.delete(r)
      else s.rowH.set(r, Math.max(0, Math.round(h)))
    }
  })
}

/** Fit columns to their widest text (double-click on a header border). */
export function autoFitCols(book: Book, cols: number[], fontFor: (sh: Sheet, k: Key) => string) {
  const sh = book.active
  const measure = book.measure
  if (!measure) return
  const widths = new Map<number, number>()
  for (const [k, cell] of sh.cells) {
    const c = keyCol(k)
    if (!cols.includes(c) || !cell.t) continue
    const w = measure(cell.t, fontFor(sh, k)) + 10
    widths.set(c, Math.max(widths.get(c) ?? 0, w))
  }
  layoutStep(book, 'AutoFit Column Width', (s) => {
    for (const c of cols) {
      const w = Math.min(600, Math.max(40, Math.ceil(widths.get(c) ?? 80)))
      if (w === 80) s.colW.delete(c)
      else s.colW.set(c, w)
    }
  })
}

export function freezePanes(book: Book, rows: number, cols: number) {
  layoutStep(book, rows || cols ? 'Freeze Panes' : 'Unfreeze Panes', (s) => {
    s.freeze = [Math.max(0, rows), Math.max(0, cols)]
  })
}

export function setDesignation(book: Book, d: 'X' | 'Y' | null) {
  const cols = selectedCols(book)
  layoutStep(book, 'Set Column As', (s) => {
    for (const c of cols) {
      if (d) s.designations[String(c)] = d
      else delete s.designations[String(c)]
    }
  })
}

// ---------------------------------------------------------------- sheets

const BAD_NAME = /[\\/?*[\]:]/

export function validSheetName(book: Book, name: string, except?: Sheet): string | null {
  const n = name.trim()
  if (!n) return 'A sheet needs a name.'
  if (n.length > 31) return 'Sheet names are at most 31 characters.'
  if (BAD_NAME.test(n)) return 'Sheet names cannot contain \\ / ? * [ ] :'
  const other = book.byName(n)
  if (other && other !== except) return `A sheet is already called "${other.name}".`
  return null
}

function freshName(book: Book, base = 'Sheet'): string {
  for (let i = book.sheets.length + 1; ; i++) if (!book.byName(`${base}${i}`)) return `${base}${i}`
}

async function insertSheet(book: Book, sh: Sheet, index: number, withCells: boolean) {
  const cells = withCells ? book.raws(sh) : []
  const numfmts = withCells ? book.numfmts(sh) : []
  book.sheets.splice(index, 0, sh)
  book.publishSheets()
  await book.py('add_sheet', { name: sh.name, index, cells, numfmts }, book.hintsFor(cells.map((c) => c[2])))
  for (const ch of sh.charts) ch.stale = true
}

async function dropSheet(book: Book, sh: Sheet) {
  await book.py('remove_sheet', { name: sh.name })
  const i = book.sheets.indexOf(sh)
  book.sheets.splice(i, 1)
  book.publishSheets()
  if (book.state.active === sh.id) book.activate(book.sheets[Math.max(0, i - 1)].id)
}

export async function addSheet(book: Book, index = book.sheets.indexOf(book.active) + 1, name = freshName(book)) {
  const sh = newSheet(name)
  try {
    await insertSheet(book, sh, index, false)
  } catch (e) {
    book.sheets = book.sheets.filter((s) => s !== sh)
    book.publishSheets()
    book.showFlash(errorText(e))
    return
  }
  const from = book.state.active
  book.activate(sh.id)
  book.record({
    label: 'Insert Sheet',
    sheet: from,
    selBefore: book.sheet(from).sel,
    selAfter: sh.sel,
    undo: () => dropSheet(book, sh),
    redo: async () => {
      await insertSheet(book, sh, index, true)
      book.activate(sh.id)
    },
  })
}

export async function removeSheet(book: Book, id: string) {
  const sh = book.sheet(id)
  if (book.sheets.length <= 1) {
    book.showFlash('A workbook keeps at least one sheet.')
    return
  }
  const ok = await os.dialog.confirm(`Delete the sheet "${sh.name}"? Formulas that read it will show errors.`, {
    title: 'Delete Sheet', okLabel: 'Delete', danger: true,
  })
  if (!ok) return
  const index = book.sheets.indexOf(sh)
  try {
    await dropSheet(book, sh)
  } catch (e) {
    book.showFlash(errorText(e))
    return
  }
  book.record({
    label: 'Delete Sheet',
    sheet: book.state.active,
    selBefore: book.active.sel,
    selAfter: book.active.sel,
    undo: async () => {
      await insertSheet(book, sh, index, true)
      book.activate(sh.id)
    },
    redo: () => dropSheet(book, sh),
  })
}

export async function renameSheet(book: Book, id: string, name: string) {
  const sh = book.sheet(id)
  const to = name.trim()
  if (to === sh.name) return
  const bad = validSheetName(book, to, sh)
  if (bad) {
    book.showFlash(bad)
    return
  }
  const from = sh.name
  const rename = async (a: string, b: string) => {
    await book.py('rename_sheet', { old: a, new: b })
    sh.name = b
    book.publishSheets()
  }
  try {
    await rename(from, to)
  } catch (e) {
    book.showFlash(errorText(e))
    return
  }
  book.record({ label: 'Rename Sheet', sheet: sh.id, selBefore: sh.sel, selAfter: sh.sel, undo: () => rename(to, from), redo: () => rename(from, to) })
}

export async function moveSheet(book: Book, id: string, to: number) {
  const sh = book.sheet(id)
  const from = book.sheets.indexOf(sh)
  const dest = Math.max(0, Math.min(book.sheets.length - 1, to))
  if (from === dest) return
  const move = async (i: number) => {
    await book.py('move_sheet', { name: sh.name, index: i })
    book.sheets.splice(book.sheets.indexOf(sh), 1)
    book.sheets.splice(i, 0, sh)
    book.publishSheets()
  }
  try {
    await move(dest)
  } catch (e) {
    book.showFlash(errorText(e))
    return
  }
  book.record({ label: 'Move Sheet', sheet: sh.id, selBefore: sh.sel, selAfter: sh.sel, undo: () => move(from), redo: () => move(dest) })
}

export async function duplicateSheet(book: Book, id: string) {
  const src = book.sheet(id)
  let name = `${src.name} copy`.slice(0, 31)
  for (let i = 2; book.byName(name); i++) name = `${src.name} copy ${i}`.slice(0, 31)
  const sh = newSheet(name, src.rows, src.cols)
  for (const [k, cell] of src.cells) sh.cells.set(k, { ...cell })
  sh.formats = new Map([...src.formats].map(([k, f]) => [k, clone(f)]))
  const lay = snapLayout(src)
  lay.charts = lay.charts.map((c) => ({ id: newId('c'), spec: c.spec }))
  lay.images = lay.images.map((o) => ({ id: newId('i'), d: o.d }))
  lay.equations = lay.equations.map((o) => ({ id: newId('e'), d: o.d }))
  restoreLayout(book, sh, lay)
  const index = book.sheets.indexOf(src) + 1
  try {
    await insertSheet(book, sh, index, true)
  } catch (e) {
    book.sheets = book.sheets.filter((s) => s !== sh)
    book.publishSheets()
    book.showFlash(errorText(e))
    return
  }
  book.activate(sh.id)
  book.record({
    label: 'Duplicate Sheet',
    sheet: src.id,
    selBefore: src.sel,
    selAfter: sh.sel,
    undo: () => dropSheet(book, sh),
    redo: async () => {
      await insertSheet(book, sh, index, true)
      book.activate(sh.id)
    },
  })
}

// ----------------------------------------------------------- status bar

/** Sum, Average and Count of the selection's numbers (the desktop's status bar). */
export function selectionStats(sh: Sheet): { count: number; sum: number; avg: number; cells: number } | null {
  let count = 0
  let sum = 0
  let cells = 0
  const seen = new Set<Key>()
  for (const g of sh.sel.ranges) {
    const big = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > 50000
    const visit = (k: Key) => {
      if (seen.has(k) || sh.hidden.has(keyRow(k))) return
      seen.add(k)
      const cell = sh.cells.get(k)
      if (!cell || (!cell.t && !cell.s)) return
      cells++
      const v = cell.n !== null ? cell.n : cell.t.trim() !== '' && Number.isFinite(Number(cell.t)) ? Number(cell.t) : null
      if (v !== null) {
        count++
        sum += v
      }
    }
    if (big) {
      for (const k of sh.cells.keys()) if (keyRow(k) >= g.r1 && keyRow(k) <= g.r2 && keyCol(k) >= g.c1 && keyCol(k) <= g.c2) visit(k)
    } else for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) visit(key(r, c))
  }
  if (cells < 2 && count < 2) return null
  return { count, sum, avg: count ? sum / count : 0, cells }
}

/** The desktop's compact number display for the status bar. */
export function statText(v: number): string {
  if (Math.abs(v) < 1e-10) return '0'
  if (Math.abs(v) >= 1e6 || Math.abs(v) < 0.01) return Number(v.toPrecision(4)).toString()
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

/** A new workbook's first sheet names (the desktop opens with three). */
export const NEW_SHEETS = ['Sheet1', 'Sheet2', 'Sheet3']
export const NEW_SIZE = { rows: DEFAULT_ROWS, cols: DEFAULT_COLS }

/** Grow a merge-aware selection for the drag of a fill handle. */
export function fillTarget(sh: Sheet, src: Range, r: number, c: number): Range {
  const down = r - src.r2
  const up = src.r1 - r
  const right = c - src.c2
  const left = src.c1 - c
  const best = Math.max(down, up, right, left)
  if (best <= 0) return src
  if (best === down) return expandMerges({ ...src, r2: r }, sh.merges)
  if (best === up) return expandMerges({ ...src, r1: r }, sh.merges)
  if (best === right) return expandMerges({ ...src, c2: c }, sh.merges)
  return expandMerges({ ...src, c1: c }, sh.merges)
}

export const colLabel = colName

// ------------------------------------------------------------ sparklines

/** One sparkline per selected column, in a target row (insert_ops.insert_sparklines_bulk). */
export function insertSparklines(book: Book, targetRow: number, type: 'line' | 'bar' | 'winloss' = 'line', color = '#4472c4') {
  const g = book.active.sel.ranges[0]
  layoutStep(book, 'Insert Sparklines', (s) => {
    const sp = { ...(s.insertOps.sparklines ?? {}) }
    for (let c = g.c1; c <= g.c2; c++) sp[`${targetRow},${c}`] = { col: c, r1: g.r1, r2: g.r2, type, color }
    s.insertOps = { ...s.insertOps, sparklines: sp }
  })
}

/** A sparkline in one cell from a column range (insert_ops.SparklineDialog). */
export function insertSparkline(book: Book, r: number, c: number, data: Range, type: 'line' | 'bar' | 'winloss' = 'line', color = '#4472c4') {
  layoutStep(book, 'Insert Sparkline', (s) => {
    s.insertOps = { ...s.insertOps, sparklines: { ...(s.insertOps.sparklines ?? {}), [`${r},${c}`]: { col: data.c1, r1: data.r1, r2: data.r2, type, color } } }
  })
}

/** Remove the sparklines of the selected cells; false when there were none. */
export function removeSparklines(book: Book): boolean {
  const sh = book.active
  const sp = sh.insertOps.sparklines ?? {}
  const gone = Object.keys(sp).filter((rc) => {
    const [r, c] = rc.split(',').map(Number)
    return sh.sel.ranges.some((g) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2)
  })
  if (!gone.length) return false
  layoutStep(book, 'Remove Sparklines', (s) => {
    const next = { ...(s.insertOps.sparklines ?? {}) }
    for (const rc of gone) delete next[rc]
    s.insertOps = { ...s.insertOps, sparklines: next }
  })
  return true
}

/** Insert a character at the caret while typing, else after the cell's text (_insert_symbol). */
export function insertCharacters(book: Book, text: string) {
  const e = book.state.edit
  if (e) {
    const t = e.text.slice(0, e.caret) + text + e.text.slice(e.caret)
    book.setEdit({ text: t, caret: e.caret + text.length, point: null })
    return
  }
  const sh = book.active
  const { r, c } = sh.sel.active
  const old = sh.cells.get(key(r, c))?.s ?? ''
  void book.setCells(sh, [[r, c, old + text]], 'Insert Symbol')
}

// ------------------------------------------- statistics, transpose, cells

export { fmt6g, statisticsText } from './pytext'

/** The numbers in ranges of the sheet (cells that read as numbers). */
export function numbersIn(sh: Sheet, ranges: Range[]): number[] {
  const out: number[] = []
  for (const g of ranges)
    for (const [k, cell] of sh.cells) {
      const r = keyRow(k)
      const c = keyCol(k)
      if (r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2) continue
      const v = cell.n ?? (cell.t.trim() ? Number(cell.t) : NaN)
      if (Number.isFinite(v)) out.push(v)
    }
  return out
}

/** Insert ▸ Pivot / Transpose: swap the selection's rows and columns in place (insert_ops.transpose_selection). */
export async function transposeSelection(book: Book) {
  const sh = book.active
  const g = sh.sel.ranges[0]
  const nr = g.r2 - g.r1 + 1
  const nc = g.c2 - g.c1 + 1
  if (g.r1 + nc > sh.rows || g.c1 + nr > sh.cols) return book.showFlash('Not enough rows or columns for the transposed data.')
  const src = (r: number, c: number) => sh.cells.get(key(r, c))?.s ?? ''
  const out = new Map<Key, [number, number, string]>()
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) out.set(key(r, c), [r, c, ''])
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) out.set(key(g.r1 + c, g.c1 + r), [g.r1 + c, g.c1 + r, src(g.r1 + r, g.c1 + c)])
  const cells = [...out.values()].filter(([r, c, s]) => src(r, c) !== s)
  if (cells.length) await book.setCells(sh, cells, 'Transpose')
  const t = { r1: g.r1, c1: g.c1, r2: g.r1 + nc - 1, c2: g.c1 + nr - 1 }
  book.select({ ranges: [t], active: { r: t.r1, c: t.c1 }, anchor: { r: t.r1, c: t.c1 } })
}

/**
 * Insert Cells (shift down) / Delete Cells (shift up) in the selected
 * columns only (sheet._insert_cells / _delete_cells): the cells' contents
 * and formats move.
 */
export async function shiftCells(book: Book, down: boolean) {
  const sh = book.active
  const g = sh.sel.ranges[0]
  const n = g.r2 - g.r1 + 1
  const last = Math.min(sh.rows - 1, Math.max(usedExtent(sh).rows, g.r2) + n)
  const cells: [number, number, string][] = []
  const fmts: { r: number; c: number }[] = []
  const newFmt = new Map<Key, Fmt | undefined>()
  for (let c = g.c1; c <= g.c2; c++)
    for (let r = g.r1; r <= last; r++) {
      const from = down ? r - n : r + n
      const blank = down && r < g.r1 + n
      const value = blank ? '' : (sh.cells.get(key(from, c))?.s ?? '')
      if ((sh.cells.get(key(r, c))?.s ?? '') !== value) cells.push([r, c, value])
      const f = blank ? undefined : sh.formats.get(key(from, c))
      if (JSON.stringify(sh.formats.get(key(r, c)) ?? null) !== JSON.stringify(f ?? null)) {
        fmts.push({ r, c })
        newFmt.set(key(r, c), f)
      }
    }
  if (cells.length) await book.setCells(sh, cells, down ? 'Insert Cells' : 'Delete Cells')
  if (fmts.length) await formatCells(book, (_f, r, c) => newFmt.get(key(r, c)), down ? 'Insert Cells' : 'Delete Cells', fmts)
}
