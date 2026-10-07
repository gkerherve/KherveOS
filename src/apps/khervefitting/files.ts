// Opening and saving. KherveFitting's own format is a workbook (.xlsx, one
// sheet per core level) with a .json file of the same name beside it holding
// the backgrounds, peaks, constraints and results — both are read and
// written, so files go back and forth with the desktop app. VAMAS (.vms),
// .csv and .txt spectra are imported; the shipped examples come from
// public/examples/khervefitting/.

import { os } from '@/os'
import { basename, dirname, extname, HOME } from '@/os/path'
import { fromBase64, toBase64 } from './bridge'
import { confirmDiscard, errorText, type Doc } from './doc'
import { exampleFileName, jsonSibling, parseIndex, safeFile, type ExampleMenu } from './examples'

export const OPEN_TYPES = ['.xlsx', '.json', '.vms', '.csv', '.txt']
export const IMPORT_TYPES = ['.vms', '.csv', '.txt']

const EXAMPLES = `${import.meta.env.BASE_URL}examples/khervefitting/`
const RECENT_KEY = 'khervefitting.recent'
const SETTINGS_KEY = 'khervefitting.settings'

// ------------------------------------------------------- remembered things

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: kept until the window closes */
  }
}

export const recentFiles = (): string[] => {
  const v = readJson<unknown>(RECENT_KEY, [])
  return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []
}

function addRecent(path: string) {
  writeJson(RECENT_KEY, [path, ...recentFiles().filter((p) => p !== path)].slice(0, 10))
}

export const clearRecent = () => writeJson(RECENT_KEY, [])

/** Fitting settings remembered between windows (the desktop's config file). */
export const savedSettings = (): Record<string, unknown> => readJson<Record<string, unknown>>(SETTINGS_KEY, {})

export function rememberSettings(patch: Record<string, unknown>) {
  writeJson(SETTINGS_KEY, { ...savedSettings(), ...patch })
}

// ------------------------------------------------------------ examples

let indexPromise: Promise<ExampleMenu[]> | null = null

export function loadExamples(): Promise<ExampleMenu[]> {
  indexPromise ??= fetch(`${EXAMPLES}index.json`, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<unknown>
    })
    .then(parseIndex)
    .catch((e: unknown) => {
      indexPromise = null
      throw e
    })
  return indexPromise
}

async function fetchBytes(file: string): Promise<Uint8Array | null> {
  const r = await fetch(EXAMPLES + file.split('/').map(encodeURIComponent).join('/'))
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

// ------------------------------------------------------------- loading

async function loadWorkbook(doc: Doc, name: string, xlsx: Uint8Array, json: string | null) {
  const a = await doc.call('open', { name, xlsx: toBase64(xlsx), json }, { strict: true })
  const dismissed = (a.dismissed as [string, string][] | undefined) ?? []
  if (dismissed.length) {
    doc.flash(`Not shown: ${dismissed.map(([n, why]) => `${n} (${why})`).join('; ')}`)
  }
}

async function loadImport(doc: Doc, name: string, bytes: Uint8Array) {
  await doc.call('import', { name, bytes: toBase64(bytes) }, { strict: true })
}

/** Open a file of the drive (a workbook, its .json, or a spectrum to import). */
export async function openPath(doc: Doc, path: string, save: () => Promise<boolean>, ask = true): Promise<boolean> {
  if (ask && !(await confirmDiscard(doc, save, 'opening another file'))) return false
  let ext = extname(path).toLowerCase()
  if (ext === '.json') {
    // The JSON travels with a workbook of the same name: open that.
    const xlsx = path.replace(/\.json$/i, '.xlsx')
    if (!os.fs.isFile(xlsx)) {
      await os.dialog.alert(`${basename(path)} is the results file of a KherveFitting workbook, but ${basename(xlsx)} is not beside it.`, { title: 'KherveFitting' })
      return false
    }
    path = xlsx
    ext = '.xlsx'
  }
  doc.set({ loading: `Opening ${basename(path)}…` })
  try {
    const bytes = await os.fs.readBytes(path)
    if (ext === '.xlsx' || ext === '.xlsm') {
      const jp = jsonSibling(path)
      const json = os.fs.isFile(jp) ? await os.fs.readText(jp) : null
      await loadWorkbook(doc, basename(path), bytes, json)
      doc.set({ path, untitled: basename(path), dirty: false, selected: null, fitLog: [] })
    } else {
      await loadImport(doc, basename(path), bytes)
      // An import becomes a new workbook named after the file (the desktop writes <name>.xlsx).
      doc.set({ path: null, untitled: `${basename(path).replace(/\.[^.]+$/, '')}.xlsx`, dirty: true, selected: null, fitLog: [] })
    }
    addRecent(path)
    return true
  } catch (e) {
    await os.dialog.alert(`${basename(path)} could not be opened.\n\n${errorText(e)}`, { title: 'KherveFitting' })
    return false
  } finally {
    doc.set({ loading: null })
  }
}

export async function openDialog(doc: Doc, save: () => Promise<boolean>, types = OPEN_TYPES) {
  if (!(await confirmDiscard(doc, save, 'opening another file'))) return
  const start = doc.state.path ? dirname(doc.state.path) : `${HOME}/Documents`
  const path = await os.dialog.openFile({ title: types === IMPORT_TYPES ? 'Import Spectra' : 'Open', startDir: start, extensions: types })
  if (path) await openPath(doc, path, save, false)
}

/** An example (opened as an untitled copy; Save asks where to keep it). */
export async function openExample(doc: Doc, file: string, title: string, save: () => Promise<boolean>) {
  if (!safeFile(file)) return
  if (!(await confirmDiscard(doc, save, 'opening an example'))) return
  doc.set({ loading: `Opening ${title}…` })
  try {
    const bytes = await fetchBytes(file)
    if (!bytes) throw new Error('The example is missing.')
    if (/\.vms$/i.test(file)) await loadImport(doc, basename(file), bytes)
    else {
      const jb = await fetchBytes(jsonSibling(file))
      await loadWorkbook(doc, basename(file), bytes, jb ? new TextDecoder().decode(jb) : null)
    }
    doc.set({ path: null, untitled: exampleFileName(title), dirty: false, selected: null, fitLog: [] })
  } catch (e) {
    await os.dialog.alert(`The example could not be opened: ${errorText(e)}`, { title: 'KherveFitting' })
  } finally {
    doc.set({ loading: null })
  }
}

export async function newDocument(doc: Doc, save: () => Promise<boolean>) {
  if (!(await confirmDiscard(doc, save, 'starting again'))) return
  await doc.call('new')
  doc.set({ path: null, untitled: 'Untitled.xlsx', dirty: false, selected: null, fitLog: [] })
}

// -------------------------------------------------------------- saving

async function writeTo(doc: Doc, path: string): Promise<boolean> {
  doc.set({ loading: `Saving ${basename(path)}…` })
  try {
    const a = await doc.call('save', { name: basename(path) }, { strict: true })
    await os.fs.writeBytes(path, fromBase64(String(a.xlsx)), { mkdirs: true })
    await os.fs.writeText(jsonSibling(path), String(a.json), { mkdirs: true })
    doc.set({ path, untitled: basename(path), dirty: false })
    addRecent(path)
    doc.flash(`Saved ${basename(path)} and ${basename(jsonSibling(path))}`)
    return true
  } catch (e) {
    await os.dialog.alert(`The workbook could not be saved: ${errorText(e)}`, { title: 'KherveFitting' })
    return false
  } finally {
    doc.set({ loading: null })
  }
}

export async function saveAs(doc: Doc): Promise<boolean> {
  if (!doc.state.view?.sheets.length) {
    await os.dialog.alert('There is nothing to save yet: open a workbook, a VAMAS file or an example first.', { title: 'KherveFitting' })
    return false
  }
  const st = doc.state
  const name = st.path ?? `${HOME}/Documents/${st.untitled.replace(/\.[^.]+$/, '')}.xlsx`
  const path = await os.dialog.saveFile({ title: 'Save Workbook', defaultName: name, extensions: ['.xlsx'] })
  if (!path) return false
  return writeTo(doc, path)
}

export async function save(doc: Doc): Promise<boolean> {
  if (!doc.state.path) return saveAs(doc)
  return writeTo(doc, doc.state.path)
}

/**
 * Open from the computer: the chosen files (a workbook with its .json, or a
 * VAMAS / CSV / TXT spectrum) are copied to ~/Documents/KherveFitting on the
 * drive, then opened from there, so Save writes back beside them.
 */
export async function openFromComputer(doc: Doc, save: () => Promise<boolean>) {
  if (!(await confirmDiscard(doc, save, 'opening another file'))) return
  const written = await os.upload(`${HOME}/Documents/KherveFitting`)
  const pick = written.find((p) => /\.xlsx$/i.test(p)) ?? written.find((p) => OPEN_TYPES.includes(extname(p).toLowerCase()))
  if (pick) await openPath(doc, pick, save, false)
  else if (written.length) doc.flash('KherveFitting opens .xlsx workbooks (with their .json), .vms, .csv and .txt files.', true)
}
