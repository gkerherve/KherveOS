// What sits on or in the cells besides values: charts (drawn by
// core/charts in Python), pictures and equations from the desktop, notes,
// links, checkboxes and drop-down lists, and the Solver.

import { os } from '@/os'
import { errorText, type Book, type ObjectRef } from './book'
import { layoutStep, newChart } from './ops'
import {
  colName, currentRegion, key, keyCol, keyRow, newId, type ChartSpec, type FloatObj, type Range, type Raw, type Sheet,
} from './model'

export const CHART_TYPES = [
  'Line', 'Line+Symbol', 'Scatter', 'Bar', 'Step', 'Stem', 'Histogram', 'Box', 'Pie', 'Doughnut', '3D Pie', 'Heatmap', '3D Surface',
]
export const PIE_TYPES = new Set(['Pie', 'Doughnut', '3D Pie'])
export const MATRIX_TYPES = new Set(['Heatmap', '3D Surface'])
/** core.charts' default series colours. */
export const CHART_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']

const colRange = (c: number, r1: number, r2: number) => `${colName(c)}${r1 + 1}:${colName(c)}${r2 + 1}`

function mostlyText(sh: Sheet, c: number, r1: number, r2: number): boolean {
  let text = 0
  let n = 0
  for (let r = r1; r <= r2; r++) {
    const cell = sh.cells.get(key(r, c))
    n++
    if (!cell?.t) {
      text++ // empty counts as "not a number", like the desktop's NaN test
      continue
    }
    if (cell.n === null && !Number.isFinite(Number(cell.t))) text++
  }
  return n > 0 && text / n > 0.5
}

/** Where a new chart goes: near the top-left of what is on screen, offset per chart. */
function newPlace(sh: Sheet, zoom: number) {
  const k = sh.charts.length
  return { left: Math.round(sh.scroll.x / zoom) + 40 + 30 * k, top: Math.round(sh.scroll.y / zoom) + 40 + 30 * k }
}

/**
 * A chart of the selection, chosen like the desktop's plot_from_sheet: the
 * first column is X when it holds text (categories) or is designated X,
 * every other column is a series; a text first row names the series.
 */
export function chartFromSelection(book: Book, type: string): ChartSpec | null {
  const sh = book.active
  let g: Range = sh.sel.ranges[0]
  if (g.r1 === g.r2 && g.c1 === g.c2) g = currentRegion(sh, g.r1, g.c1)
  if (g.r2 - g.r1 > 100000) {
    let last = g.r1
    for (const [k, cell] of sh.cells) if ((cell.s || cell.t) && keyCol(k) >= g.c1 && keyCol(k) <= g.c2) last = Math.max(last, keyRow(k))
    g = { ...g, r2: last }
  }
  const place = newPlace(sh, book.state.view.zoom)
  const base = { type, title: '', xLabel: 'X', yLabel: 'Y', legend: false, grid: false, width: 480, height: 320, ...place, trendlines: [] }
  const cols: number[] = []
  for (let c = g.c1; c <= g.c2; c++) cols.push(c)
  if (MATRIX_TYPES.has(type)) {
    const series = []
    for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 199); r++) series.push({ ref: `${colName(g.c1)}${r + 1}:${colName(g.c2)}${r + 1}`, name: `${r + 1}` })
    return { ...base, xLabel: '', yLabel: '', x: null, series, legend: false }
  }
  // A text first row over numbers: series names, data below it.
  let r1 = g.r1
  let header: ((c: number) => string) | null = null
  if (g.r2 > g.r1 && cols.some((c) => !mostlyText(sh, c, g.r1 + 1, g.r2))) {
    const top = cols.map((c) => sh.cells.get(key(g.r1, c)))
    if (top.every((cell) => cell?.t && cell.n === null && !Number.isFinite(Number(cell.t)))) {
      header = (c) => sh.cells.get(key(g.r1, c))?.t ?? colName(c)
      r1 = g.r1 + 1
    }
  }
  if (PIE_TYPES.has(type)) {
    const label = cols.find((c) => mostlyText(sh, c, r1, g.r2))
    const value = cols.find((c) => !mostlyText(sh, c, r1, g.r2))
    if (value === undefined) {
      book.showFlash('Select at least one column of numbers for a pie chart.')
      return null
    }
    return {
      ...base, xLabel: '', yLabel: '', legend: false,
      x: label !== undefined ? colRange(label, r1, g.r2) : null,
      series: [{ ref: colRange(value, r1, g.r2), name: header ? header(value) : 'Data' }],
    }
  }
  const desig = (c: number) => (sh.designations[String(c)] ?? '').toUpperCase()
  let yCols = cols.filter((c) => desig(c) !== 'X')
  if (!yCols.length && cols.length >= 2) yCols = cols.slice(1)
  let autoX: number | null = null
  if (cols.length >= 2 && yCols.includes(cols[0]) && mostlyText(sh, cols[0], r1, g.r2)) {
    autoX = cols[0]
    yCols = yCols.filter((c) => c !== cols[0])
  }
  const xFor = (yc: number): number | null => {
    if (autoX !== null && autoX < yc) return autoX
    for (let c = yc - 1; c >= 0; c--) if (desig(c) === 'X') return c
    return autoX
  }
  if (!yCols.length) {
    book.showFlash('Select the columns to plot first.')
    return null
  }
  const xc = xFor(yCols[0])
  const series = yCols.map((c) => ({ ref: colRange(c, r1, g.r2), name: header ? header(c) : colName(c) }))
  return {
    ...base,
    x: xc !== null ? colRange(xc, r1, g.r2) : null,
    xLabel: header && xc !== null ? header(xc) : 'X',
    yLabel: header && series.length === 1 ? series[0].name : 'Y',
    series,
    legend: series.length > 1,
  }
}

export function insertChart(book: Book, type: string) {
  const spec = chartFromSelection(book, type)
  if (!spec) return
  const ch = newChart(spec)
  layoutStep(book, `Insert ${type} Chart`, (s) => {
    s.charts.push(ch)
  })
  book.set({ object: { kind: 'chart', id: ch.id } })
  book.scheduleCharts(0)
}

export function updateChart(book: Book, id: string, spec: ChartSpec, label = 'Edit Chart') {
  layoutStep(book, label, (s) => {
    const ch = s.charts.find((c) => c.id === id)
    if (ch) {
      ch.spec = spec
      ch.stale = true
    }
  })
}

/** A chart's, picture's or equation's rectangle (sheet pixels). */
export function objectRect(sh: Sheet, ref: NonNullable<ObjectRef>): { left: number; top: number; width: number; height: number } | null {
  if (ref.kind === 'chart') {
    const ch = sh.charts.find((c) => c.id === ref.id)
    return ch ? { left: ch.spec.left, top: ch.spec.top, width: ch.spec.width, height: ch.spec.height } : null
  }
  const o = (ref.kind === 'image' ? sh.images : sh.equations).find((x) => x.id === ref.id)
  if (!o) return null
  return { left: num(o.d.pos_x), top: num(o.d.pos_y), width: num(o.d.width, 100), height: num(o.d.height, 60) }
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export function moveObject(book: Book, ref: NonNullable<ObjectRef>, rect: { left: number; top: number; width: number; height: number }) {
  const r = {
    left: Math.max(0, Math.round(rect.left)),
    top: Math.max(0, Math.round(rect.top)),
    width: Math.max(ref.kind === 'chart' ? 160 : 20, Math.round(rect.width)),
    height: Math.max(ref.kind === 'chart' ? 120 : 16, Math.round(rect.height)),
  }
  layoutStep(book, ref.kind === 'chart' ? 'Move Chart' : 'Move Object', (s) => {
    if (ref.kind === 'chart') {
      const ch = s.charts.find((c) => c.id === ref.id)
      if (!ch) return
      const resized = ch.spec.width !== r.width || ch.spec.height !== r.height
      ch.spec = { ...ch.spec, ...r }
      if (resized) ch.stale = true
    } else {
      const o = (ref.kind === 'image' ? s.images : s.equations).find((x) => x.id === ref.id)
      if (o) o.d = { ...o.d, pos_x: r.left, pos_y: r.top, width: r.width, height: r.height }
    }
  })
}

export function removeObject(book: Book, ref: NonNullable<ObjectRef>) {
  layoutStep(book, ref.kind === 'chart' ? 'Delete Chart' : 'Delete Object', (s) => {
    if (ref.kind === 'chart') s.charts = s.charts.filter((c) => c.id !== ref.id)
    else if (ref.kind === 'image') s.images = s.images.filter((o) => o.id !== ref.id)
    else s.equations = s.equations.filter((o) => o.id !== ref.id)
  })
  book.set({ object: null })
}

/** Bring to front (true) or send to back: charts draw in list order. */
export function restack(book: Book, ref: NonNullable<ObjectRef>, front: boolean) {
  layoutStep(book, front ? 'Bring to Front' : 'Send to Back', (s) => {
    const list = (ref.kind === 'chart' ? s.charts : ref.kind === 'image' ? s.images : s.equations) as { id: string }[]
    const i = list.findIndex((x) => x.id === ref.id)
    if (i < 0) return
    const [item] = list.splice(i, 1)
    if (front) list.push(item)
    else list.unshift(item)
  })
}

// --------------------------------------------------------------- equations

/** A new equation box, as the desktop's EmbeddedEquation saves it. */
export function insertEquation(book: Book, latex: string) {
  const sh = book.active
  const place = newPlace(sh, book.state.view.zoom)
  const eq: FloatObj = {
    id: newId('e'),
    d: { latex, fontsize: 16, color: '#1a1a1a', bg_color: '#ffffff', border_color: '#4472c4', border_width: 1.0, pos_x: place.left, pos_y: place.top, group_id: null, width: 260, height: 60 },
  }
  layoutStep(book, 'Insert Equation', (s) => {
    s.equations.push(eq)
  })
  book.set({ object: { kind: 'equation', id: eq.id } })
}

export function editEquation(book: Book, id: string, latex: string) {
  layoutStep(book, 'Edit Equation', (s) => {
    const o = s.equations.find((x) => x.id === id)
    if (o) o.d = { ...o.d, latex }
  })
}

/** Insert a picture from the drive (stored as PNG, like the desktop). */
export async function insertImage(book: Book) {
  const path = await os.dialog.openFile({ title: 'Insert Picture', extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'] })
  if (!path) return
  try {
    const bytes = await os.fs.readBytes(path)
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const url = canvas.toDataURL('image/png')
    const sh = book.active
    const place = newPlace(sh, book.state.view.zoom)
    const scale = Math.min(1, 480 / bitmap.width, 360 / bitmap.height)
    const img: FloatObj = {
      id: newId('i'),
      d: { pos_x: place.left, pos_y: place.top, width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale), data: url.slice(url.indexOf(',') + 1) },
    }
    layoutStep(book, 'Insert Picture', (s) => {
      s.images.push(img)
    })
    book.set({ object: { kind: 'image', id: img.id } })
  } catch (e) {
    book.showFlash(`The picture could not be read: ${errorText(e)}`)
  }
}

// ---------------------------------------------------- notes, links, controls

const rc = (r: number, c: number) => `${r},${c}`

export function noteText(sh: Sheet, r: number, c: number): string | null {
  const n = sh.insertOps.notes?.[rc(r, c)]
  if (!n) return null
  return typeof n === 'string' ? n : (n.text ?? '')
}

export function setNote(book: Book, r: number, c: number, text: string | null) {
  layoutStep(book, text ? 'Note' : 'Delete Note', (s) => {
    const notes = { ...(s.insertOps.notes ?? {}) }
    if (text) notes[rc(r, c)] = { text, kind: 'note' }
    else delete notes[rc(r, c)]
    s.insertOps = { ...s.insertOps, notes }
  })
}

export function linkOf(sh: Sheet, r: number, c: number): string | null {
  const v = sh.insertOps.links?.[rc(r, c)]
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') return (v as { url: string }).url
  return null
}

export async function setLink(book: Book, r: number, c: number, url: string | null, text?: string) {
  const sh = book.active
  layoutStep(book, url ? 'Link' : 'Remove Link', (s) => {
    const links = { ...(s.insertOps.links ?? {}) }
    if (url) links[rc(r, c)] = url
    else delete links[rc(r, c)]
    s.insertOps = { ...s.insertOps, links }
  })
  if (url && text !== undefined && (sh.cells.get(key(r, c))?.s ?? '') !== text) await book.setCells(sh, [[r, c, text || url]], 'Link')
}

export function isCheckbox(sh: Sheet, r: number, c: number): boolean {
  return !!sh.insertOps.checkboxes && rc(r, c) in sh.insertOps.checkboxes
}

/** Checkboxes hold TRUE/FALSE, which formulas and =PY cells read. */
export async function insertCheckboxes(book: Book) {
  const sh = book.active
  const cells: [number, number, string][] = []
  const keys: string[] = []
  for (const g of sh.sel.ranges)
    for (let r = g.r1; r <= g.r2 && r < g.r1 + 1000; r++)
      for (let c = g.c1; c <= g.c2 && c < g.c1 + 100; c++) {
        const t = (sh.cells.get(key(r, c))?.t ?? '').toUpperCase()
        keys.push(rc(r, c))
        if (t !== 'TRUE' && t !== 'FALSE') cells.push([r, c, 'FALSE'])
      }
  layoutStep(book, 'Checkbox', (s) => {
    const boxes = { ...(s.insertOps.checkboxes ?? {}) }
    for (const k of keys) boxes[k] = (s.cells.get(key(...(k.split(',').map(Number) as [number, number])))?.t ?? '').toUpperCase() === 'TRUE'
    s.insertOps = { ...s.insertOps, checkboxes: boxes }
  })
  if (cells.length) await book.setCells(sh, cells, 'Checkbox')
}

export async function toggleCheckbox(book: Book, r: number, c: number) {
  const sh = book.active
  const on = (sh.cells.get(key(r, c))?.t ?? '').toUpperCase() !== 'TRUE'
  sh.insertOps = { ...sh.insertOps, checkboxes: { ...(sh.insertOps.checkboxes ?? {}), [rc(r, c)]: on } }
  await book.setCells(sh, [[r, c, on ? 'TRUE' : 'FALSE']], 'Checkbox')
}

export function dropdownOf(sh: Sheet, r: number, c: number): string[] | null {
  const v = sh.insertOps.dropdowns?.[rc(r, c)]
  return Array.isArray(v) ? v.map((x) => String(x)) : null
}

export function setDropdown(book: Book, items: string[] | null) {
  const sh = book.active
  const keys: string[] = []
  for (const g of sh.sel.ranges) for (let r = g.r1; r <= g.r2 && r < g.r1 + 2000; r++) for (let c = g.c1; c <= g.c2 && c < g.c1 + 100; c++) keys.push(rc(r, c))
  layoutStep(book, items ? 'Dropdown' : 'Remove Dropdown', (s) => {
    const dd = { ...(s.insertOps.dropdowns ?? {}) }
    for (const k of keys) {
      if (items) dd[k] = items
      else delete dd[k]
    }
    s.insertOps = { ...s.insertOps, dropdowns: dd }
  })
}

// ----------------------------------------------------------------- solver

export interface SolverProblem {
  objective: string
  variables: string
  goal: 'min' | 'max' | 'value'
  target: number
  constraints: { cell: string; op: '<=' | '>=' | '='; value: number }[]
  nonNegative: boolean
  method: string
}

export interface SolverOutcome {
  success: boolean
  found: boolean
  message: string
  objective: number | null
}

/** Run core.solver on the active sheet; the changed cells are one undo step. */
export async function runSolver(book: Book, p: SolverProblem): Promise<SolverOutcome> {
  const sh = book.active
  sh.solverConfig = { ...(typeof sh.solverConfig === 'object' && sh.solverConfig ? sh.solverConfig : {}), ...p, web: true }
  // The variable cells' state before (parsed here like core.solver.parse_range).
  const cells: [number, number][] = []
  for (const part of p.variables.split(',')) {
    const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d+)\s*(?::\s*\$?([A-Za-z]{1,3})\$?(\d+))?\s*$/.exec(part)
    if (!m) continue
    const ci = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
    const r1 = Number(m[2]) - 1
    const c1 = ci(m[1])
    const r2 = m[4] ? Number(m[4]) - 1 : r1
    const c2 = m[3] ? ci(m[3]) : c1
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) cells.push([r, c])
  }
  const before: Raw[] = cells.map(([r, c]) => book.raw(sh, r, c))
  const a = await book.py<{ ok: boolean; outcome: SolverOutcome }>('solve', { sheet: sh.name, ...p }, ['scipy'])
  const after: Raw[] = cells.map(([r, c]) => book.raw(sh, r, c))
  if (a.outcome.found)
    book.record({
      label: 'Solver',
      sheet: sh.id,
      selBefore: sh.sel,
      selAfter: sh.sel,
      undo: () => book.putRaw(sh, before),
      redo: () => book.putRaw(sh, after),
    })
  return a.outcome
}

/** The Solver set-up saved with the sheet (the desktop's keys, or ours). */
export function savedSolver(sh: Sheet): Partial<SolverProblem> {
  const s = (sh.solverConfig && typeof sh.solverConfig === 'object' ? sh.solverConfig : {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const goal = str(s.goal) ?? (s.radio_max ? 'max' : s.radio_val ? 'value' : undefined)
  return {
    objective: str(s.objective) ?? str(s.objective_cell) ?? str(s.obj),
    variables: str(s.variables) ?? str(s.variable_cells) ?? str(s.vars),
    goal: goal === 'max' || goal === 'value' || goal === 'min' ? goal : undefined,
    target: typeof s.target === 'number' ? s.target : undefined,
    method: str(s.method),
    nonNegative: typeof s.nonNegative === 'boolean' ? s.nonNegative : typeof s.non_negative === 'boolean' ? s.non_negative : undefined,
  }
}

export const cellKeyOf = key
