// Opening and saving: .ksheet (the desktop's HDF5 workbook, read and written
// by h5py in Python), .csv (the active sheet, like the desktop), .xlsx
// (through core/xlsx and openpyxl), and the shipped examples.

import { os } from '@/os'
import { basename, dirname, extname, HOME } from '@/os/path'
import { errorText, PyError, type Book } from './book'
import { exampleFileName, fetchExample } from './examples'
import { applyFilter, newChart, NEW_SHEETS } from './ops'
import {
  DEFAULT_COLS, DEFAULT_COL_W, DEFAULT_ROWS, DEFAULT_ROW_H, cellSel, formatsFromJson, formatsToJson, key, keyCol, keyRow, newId,
  newSheet, type ChartSpec, type InsertOps, type Merge, type Raw,
} from './model'
import { addRecent } from './prefs'

export const OPEN_TYPES = ['.ksheet', '.csv', '.tsv', '.txt', '.xlsx', '.xlsm']

// ---------------------------------------------------------------- bytes

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// ---------------------------------------------------------- loading

interface Layout {
  name: string
  rows?: number
  cols?: number
  formats?: Record<string, unknown>
  merges?: Merge[]
  widths?: number[] | Record<string, number>
  designations?: Record<string, string>
  insertOps?: InsertOps
  pyLoops?: Record<string, number>
  charts?: ChartSpec[]
  images?: Record<string, unknown>[]
  shapes?: unknown[]
  equations?: Record<string, unknown>[]
  solverConfig?: unknown
  fitConfig?: unknown
  rowHeights?: Record<string, number>
  freeze?: [number, number] | null
}

/** Build the page's sheets from a load answer (snapshot + layouts). */
function adopt(book: Book, a: Record<string, unknown>) {
  const names = (a.sheets as string[]) ?? []
  const snap = (a.snapshot as Record<string, Raw[]>) ?? {}
  const layouts = new Map(((a.layouts as Layout[]) ?? []).map((l) => [l.name, l]))
  for (const sh of book.sheets) book.releaseUrls(sh)
  book.stopLoops()
  book.sheets = names.map((name) => {
    const lay = layouts.get(name)
    const sh = newSheet(name, Math.max(lay?.rows ?? 0, DEFAULT_ROWS), Math.max(lay?.cols ?? 0, DEFAULT_COLS))
    sh.fileRows = lay?.rows ?? 0
    sh.fileCols = lay?.cols ?? 0
    for (const [r, c, s, t, n] of snap[name] ?? []) {
      if (s || t) sh.cells.set(key(r, c), { s, t: t ?? '', n })
      sh.rows = Math.max(sh.rows, r + 1)
      sh.cols = Math.max(sh.cols, c + 1)
    }
    if (lay) {
      sh.formats = formatsFromJson(lay.formats)
      const w = lay.widths
      if (Array.isArray(w)) w.forEach((px, c) => px !== DEFAULT_COL_W && sh.colW.set(c, px))
      else if (w) for (const [c, px] of Object.entries(w)) if (Number(px) !== DEFAULT_COL_W) sh.colW.set(Number(c), Number(px))
      for (const [r, h] of Object.entries(lay.rowHeights ?? {})) if (Number(h) !== DEFAULT_ROW_H) sh.rowH.set(Number(r), Number(h))
      sh.merges = (lay.merges ?? []).filter((m) => Array.isArray(m) && m.length === 4).map((m) => m.map(Number) as Merge)
      sh.freeze = Array.isArray(lay.freeze) ? [Number(lay.freeze[0]) || 0, Number(lay.freeze[1]) || 0] : [0, 0]
      sh.designations = lay.designations ?? {}
      sh.insertOps = lay.insertOps ?? {}
      sh.pyLoops = lay.pyLoops ?? {}
      sh.charts = (lay.charts ?? []).map((spec) => newChart(spec))
      sh.images = (lay.images ?? []).map((d) => ({ id: newId('i'), d }))
      sh.equations = (lay.equations ?? []).map((d) => ({ id: newId('e'), d }))
      sh.shapes = lay.shapes ?? []
      sh.solverConfig = lay.solverConfig ?? null
      sh.fitConfig = lay.fitConfig ?? null
    }
    applyFilter(sh)
    return sh
  })
  if (!book.sheets.length) book.sheets = [newSheet('Sheet1')]
  book.layoutSettings = (a.layoutSettings as string | null) ?? null
  book.publishSheets()
  const first = book.sheets[0]
  book.set({ active: first.id, sel: first.sel, edit: null, object: null, ants: null })
  book.clearHistory()
  book.bump()
  book.scheduleCharts(0)
}

async function loadBytes(book: Book, bytes: Uint8Array, name: string, trust: boolean): Promise<Record<string, unknown>> {
  const ext = extname(name)
  if (ext === '.ksheet') {
    return book.bridge.call('load_ksheet', { data: toBase64(bytes), trust }, ['h5py'])
  }
  if (ext === '.xlsx' || ext === '.xlsm') return book.bridge.call('load_xlsx', { data: toBase64(bytes) })
  const text = new TextDecoder().decode(bytes)
  const sheetName = basename(name).replace(/\.[^.]+$/, '').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1'
  return book.bridge.call('load_csv', { text, name: sheetName })
}

/** Load a workbook into this window. */
async function load(book: Book, bytes: Uint8Array, name: string, opts: { path: string | null; untitled?: string; trust?: boolean }) {
  book.set({ loading: `Opening ${basename(name)}…` })
  try {
    if (book.state.edit) book.cancelEdit()
    await book.bridge.idle()
    const a = await loadBytes(book, bytes, name, !!opts.trust)
    if (!a.ok) throw new PyError(String(a.error ?? 'The file could not be read.'), a.trace as string | undefined)
    adopt(book, a)
    const ext = extname(name)
    book.docKind = ext === '.ksheet' ? 'ksheet' : ext === '.xlsx' || ext === '.xlsm' ? 'xlsx' : opts.path ? 'csv' : null
    book.set({
      path: opts.path,
      untitled: opts.untitled ?? 'Untitled',
      dirty: false,
      pyPending: Number(a.pyPending) || 0,
      pyCells: Number(a.pythonCells) || 0,
    })
    book.apply({ ok: true, py: a.py, pyPending: a.pyPending })
    if (book.state.pyPending === 0 && book.state.pyCells > 0) book.startLoops()
    return true
  } catch (e) {
    await os.dialog.alert(`${basename(name)} could not be opened.\n\n${errorText(e)}`, { title: 'KherveSheet' })
    return false
  } finally {
    book.set({ loading: null })
    book.refocus()
  }
}

/** Unsaved changes: Save, Don't Save or Cancel. True when it is fine to go on. */
export async function confirmDiscard(book: Book, action = 'closing'): Promise<boolean> {
  if (!book.state.dirty) return true
  const name = book.state.path ? basename(book.state.path) : book.state.untitled
  const choice = await os.dialog.choose(
    `Do you want to save the changes to "${name}" before ${action}?`,
    [
      { label: 'Cancel', value: 'cancel' },
      { label: "Don't Save", value: 'discard', danger: true },
      { label: 'Save', value: 'save', primary: true },
    ],
    { title: 'KherveSheet' },
  )
  if (choice === 'save') return save(book)
  return choice === 'discard'
}

export async function openPath(book: Book, path: string, ask = true): Promise<boolean> {
  if (ask && !(await confirmDiscard(book, 'opening another workbook'))) return false
  let bytes: Uint8Array
  try {
    bytes = await os.fs.readBytes(path)
  } catch (e) {
    await os.dialog.alert(`${basename(path)} could not be read: ${errorText(e)}`, { title: 'KherveSheet' })
    return false
  }
  const ok = await load(book, bytes, path, { path })
  if (!ok) return false
  addRecent(path)
  await askTrust(book)
  return true
}

/** Opening a workbook must not run the code it carries without asking (the desktop's _confirm_python_trust). */
export async function askTrust(book: Book) {
  const n = book.state.pyPending
  if (!n) return
  const choice = await os.dialog.choose(
    `This workbook contains ${n} Python (=PY) cell${n === 1 ? '' : 's'}.\n\nPython cells run real code in this window. Only run them if you trust where the file comes from.`,
    [
      { label: "Don't Run", value: 'no' },
      { label: 'Run Python Cells', value: 'yes', primary: true },
    ],
    { title: 'Python in workbook' },
  )
  if (choice === 'yes') await book.trustPython()
}

export async function openDialog(book: Book) {
  if (!(await confirmDiscard(book, 'opening another workbook'))) return
  const start = book.state.path ? dirname(book.state.path) : `${HOME}/Documents`
  const path = await os.dialog.openFile({ title: 'Open', startDir: start, extensions: OPEN_TYPES })
  if (path) await openPath(book, path, false)
}

/** Examples are trusted, as on the desktop (they travel with the app). */
export async function openExample(book: Book, file: string, title: string, ask = true) {
  if (ask && !(await confirmDiscard(book, 'opening an example'))) return
  try {
    book.set({ loading: `Opening ${title}…` })
    const bytes = await fetchExample(file)
    await load(book, bytes, file, { path: null, untitled: title, trust: true })
  } catch (e) {
    book.set({ loading: null })
    await os.dialog.alert(`The example could not be opened: ${errorText(e)}`, { title: 'KherveSheet' })
  }
}

export async function newWorkbook(book: Book, ask = true) {
  if (ask && !(await confirmDiscard(book, 'starting a new workbook'))) return
  if (book.state.edit) book.cancelEdit()
  await book.bridge.idle()
  try {
    const a = await book.bridge.call('new', { sheets: NEW_SHEETS })
    if (!a.ok) throw new PyError(String(a.error))
  } catch (e) {
    book.showFlash(errorText(e))
  }
  for (const sh of book.sheets) book.releaseUrls(sh)
  book.stopLoops()
  book.sheets = NEW_SHEETS.map((n) => newSheet(n))
  book.layoutSettings = null
  book.docKind = null
  book.publishSheets()
  book.set({ active: book.sheets[0].id, sel: cellSel(0, 0), edit: null, object: null, ants: null, path: null, untitled: 'Untitled', dirty: false, pyPending: 0, pyCells: 0 })
  book.clearHistory()
  book.bump()
}

// ------------------------------------------------------------ saving

function ksheetLayout(book: Book) {
  return {
    layoutSettings: book.layoutSettings,
    sheets: book.sheets.map((sh) => ({
      name: sh.name,
      rows: sh.fileRows || 0,
      cols: sh.fileCols || 0,
      formats: formatsToJson(sh.formats),
      merges: sh.merges,
      widths: Object.fromEntries([...sh.colW].map(([c, w]) => [String(c), w])),
      rowHeights: Object.fromEntries([...sh.rowH].map(([r, h]) => [String(r), h])),
      freeze: sh.freeze,
      designations: sh.designations,
      insertOps: sh.insertOps,
      pyLoops: sh.pyLoops,
      charts: sh.charts.map((c) => c.spec),
      images: sh.images.map((o) => o.d),
      shapes: sh.shapes,
      equations: sh.equations.map((o) => o.d),
      solverConfig: sh.solverConfig,
      fitConfig: sh.fitConfig,
    })),
  }
}

async function writeKsheet(book: Book, path: string) {
  const trend = book.sheets.some((s) => s.charts.some((c) => c.spec.trendlines?.length))
  const a = await book.bridge.call('save_ksheet', ksheetLayout(book), trend ? ['h5py', 'scipy'] : ['h5py'])
  if (!a.ok) throw new PyError(String(a.error ?? 'The workbook could not be saved.'), a.trace as string | undefined)
  await os.fs.writeBytes(path, fromBase64(String(a.data)), { mkdirs: true })
}

async function writeCsv(book: Book, path: string) {
  const a = await book.bridge.call('export_csv', { sheet: book.active.name })
  if (!a.ok) throw new PyError(String(a.error))
  await os.fs.writeText(path, String(a.text), { mkdirs: true })
}

async function writeXlsx(book: Book, path: string) {
  const sheets: Record<string, unknown> = {}
  const charts: unknown[] = []
  for (const sh of book.sheets) {
    sheets[sh.name] = {
      formats: [...sh.formats].map(([k, f]) => [keyRow(k), keyCol(k), f]),
      widths: [...sh.colW].map(([c, w]) => [c, w]),
      freezeRows: sh.freeze[0],
      freezeCols: sh.freeze[1],
    }
    const { rows, cols } = book.geometry(sh)
    for (const ch of sh.charts) charts.push({ ...ch.spec, sheet: sh.name, row: rows.at(ch.spec.top), col: cols.at(ch.spec.left) })
  }
  const a = await book.bridge.call('save_xlsx', { sheets, charts })
  if (!a.ok) throw new PyError(String(a.error ?? 'The workbook could not be exported.'), a.trace as string | undefined)
  await os.fs.writeBytes(path, fromBase64(String(a.data)), { mkdirs: true })
}

async function writeAs(book: Book, path: string): Promise<boolean> {
  if (book.state.edit) book.commitEdit()
  await book.bridge.idle()
  book.set({ loading: `Saving ${basename(path)}…` })
  try {
    const ext = extname(path)
    if (ext === '.csv') await writeCsv(book, path)
    else if (ext === '.xlsx') await writeXlsx(book, path)
    else await writeKsheet(book, path)
    return true
  } catch (e) {
    await os.dialog.alert(`${basename(path)} could not be saved.\n\n${errorText(e)}`, { title: 'KherveSheet' })
    return false
  } finally {
    book.set({ loading: null })
    book.refocus()
  }
}

/** Save: .ksheet and .csv files in place; anything else (an imported Excel file) asks where. */
export async function save(book: Book): Promise<boolean> {
  const path = book.state.path
  if (!path || book.docKind === 'xlsx' || book.docKind === null) return saveAs(book)
  const ok = await writeAs(book, path)
  if (ok) {
    book.markSaved()
    book.showFlash(`Saved ${basename(path)}`, 2500)
  }
  return ok
}

export async function saveAs(book: Book): Promise<boolean> {
  const path = book.state.path
  const base = path ? basename(path).replace(/\.[^.]+$/, '') : book.state.untitled === 'Untitled' ? 'Untitled' : exampleFileName(book.state.untitled).replace(/\.ksheet$/, '')
  const dir = path ? dirname(path) : `${HOME}/Documents`
  const target = await os.dialog.saveFile({ title: 'Save As', defaultName: `${dir}/${base}.ksheet`, extensions: ['.ksheet', '.csv'] })
  if (!target) return false
  return saveTo(book, target)
}

/** Save to this path without asking where (Save As after its dialog, the AI tools). */
export async function saveTo(book: Book, target: string): Promise<boolean> {
  const ok = await writeAs(book, target)
  if (!ok) return false
  book.docKind = extname(target) === '.csv' ? 'csv' : 'ksheet'
  book.set({ path: target })
  book.markSaved()
  addRecent(target)
  book.showFlash(`Saved ${basename(target)}`, 2500)
  return true
}

export async function exportAs(book: Book, ext: '.csv' | '.xlsx') {
  const path = book.state.path
  const base = path ? basename(path).replace(/\.[^.]+$/, '') : book.state.untitled
  const dir = path ? dirname(path) : `${HOME}/Documents`
  const target = await os.dialog.saveFile({ title: ext === '.csv' ? 'Export CSV' : 'Export Excel', defaultName: `${dir}/${base}${ext}`, extensions: [ext] })
  if (!target) return
  if (await writeAs(book, target)) book.showFlash(`Exported ${basename(target)}`, 2500)
}
