// KherveSheet: the web edition of the desktop KherveSheet (PyQt5), the
// Excel-like workbench of the Kherve tools. Every formula is computed by
// the desktop's own Qt-free core (khervesheet/core, ~290 functions, =PY
// cells, charts, the Solver) running in this window's Python; the grid,
// formats and files are handled here. Workbooks are the desktop's .ksheet.

import './khervesheet.css'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { LoaderCircle, Play, X } from 'lucide-react'
import { os, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { basename, dirname, extname, pretty } from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import type { KernelStatus } from '@/os/python/kernel'
import { Book, type ObjectRef } from './book'
import { BookContext, RootContext } from './Assist'
import { ChartDialog, SolverDialog, SortDialog, TrendlineDialog } from './chartdialogs'
import { getClip } from './clip'
import { EquationDialog, FilterPopover, FindDialog, FormatCellsDialog, ListDialog, PythonOutputDialog, TextDialog } from './dialogs'
import { loadExamples, type ExampleMenu } from './examples'
import { OPEN_TYPES, confirmDiscard, exportAs, newWorkbook, openDialog, openExample, openPath, save, saveAs } from './files'
import { FormulaBar, functionMenu, insertFunction } from './FormulaBar'
import { Grid, type GridActions } from './Grid'
import { cellFont } from './draw'
import { NUMBER_FORMATS, a1, key, type Range } from './model'
import {
  CHART_TYPES, dropdownOf, editEquation, insertChart, insertCheckboxes, insertEquation, insertImage, linkOf, noteText,
  removeObject, restack, setDropdown, setLink, setNote,
} from './objects'
import {
  addSheet, applyFilter, autoFitCols, clearAll, clearContents, clearFormats, copySelection, dataRange, fillDownRight, freezePanes,
  insertCols, insertRows, mergeCells, pasteText, quickSort, selectedCols, selectedRows, selectionStats, setColWidth, setDesignation,
  setNumberFormat, setRowHeight, sortRange, statText, toggleFilter, toggleFlag, unmergeCells,
} from './ops'
import { SheetTabs } from './SheetTabs'
import { autoSum, Toolbar } from './Toolbar'
import { clearRecent, recentFiles } from './prefs'
import { useAppTools } from '@/os/ai/appTools'
import { sheetAiTools } from './aiTools'

/** The desktop KherveSheet this edition follows (its dev branch). */
export const CORE_SOURCE = 'KherveSheet dev @ cef25ce'
const ISSUES_URL = 'https://github.com/gkerherve/KherveSheet/issues'
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)
const MOD = MAC ? '⌘' : 'Ctrl+'
const SHIFT = MAC ? '⇧' : 'Shift+'

type DialogState =
  | { kind: 'format' }
  | { kind: 'chart'; id: string }
  | { kind: 'trend'; id: string }
  | { kind: 'solver' }
  | { kind: 'sort'; range: Range }
  | { kind: 'find'; replace: boolean }
  | { kind: 'py'; r: number; c: number }
  | { kind: 'equation'; id: string | null; initial: string }
  | { kind: 'dropdown'; initial: string[] }
  | { kind: 'note'; r: number; c: number; initial: string }
  | { kind: 'filter'; col: number; at: { clientX: number; clientY: number } }
  | null

const STATUS_LABEL: Record<KernelStatus, string> = { off: 'off', starting: 'starting…', idle: 'ready', busy: 'computing…', dead: 'stopped' }

// ------------------------------------------------------------------ help

function Kbd({ k }: { k: string }) {
  return <kbd>{k}</kbd>
}

function Shortcuts() {
  const rows: [string, string][] = [
    ['Enter / Tab', 'Keep the entry and move down / right (with Shift: up / left)'],
    ['F2 or double-click', 'Edit the cell (arrows then move the caret)'],
    ['Alt+Enter', 'A new line in the cell'],
    [`${MOD}Enter`, 'Fill every selected cell with the entry'],
    ['Esc', 'Cancel the entry'],
    [`${MOD}Arrow`, 'To the edge of the data'],
    [`${SHIFT}Arrow, ${SHIFT}${MOD}Arrow`, 'Grow the selection'],
    [`${MOD}A`, 'Select all'],
    [`${MOD}C / ${MOD}X / ${MOD}V`, 'Copy / cut / paste (tab-separated, works with other apps)'],
    [`${MOD}D / ${MOD}R`, 'Fill down / right'],
    [`${MOD}Z / ${MOD}Y`, 'Undo / redo'],
    [`${MOD}B / ${MOD}I / ${MOD}U`, 'Bold / italic / underline'],
    [`${MOD}1`, 'Format Cells'],
    [`${MOD}F / ${MOD}H`, 'Find / replace'],
    [`${MOD}\``, 'Show formulas'],
    ['F9', 'Calculate again (random numbers, =PY cells)'],
    [`${SHIFT}F2`, 'Note'],
    [`${MOD}S / ${SHIFT}${MOD}S`, 'Save / save as'],
  ]
  return (
    <table className="ks-keys">
      <tbody>
        {rows.map(([k, what]) => (
          <tr key={k}>
            <td><Kbd k={k} /></td>
            <td>{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function UserGuide() {
  return (
    <div className="ks-doc ks-guide">
      <p>
        KherveSheet is a spreadsheet for science and everyday work. This web edition computes every formula with the desktop KherveSheet's own engine,
        running in Python in your browser, so a workbook gives the same numbers in both. Workbooks are <code>.ksheet</code> files on your KherveOS drive,
        shared with the desktop app.
      </p>
      <Section title="Typing">
        <ul>
          <li>Type a number, a text, or a formula starting with <code>=</code>: <code>=SUM(A1:A10)</code>, <code>=B2*2</code>, <code>=Data!A1</code>.</li>
          <li>While a formula waits for a reference (after <code>=</code>, <code>(</code>, <code>,</code> or an operator), click a cell or drag over a range to insert it, or use the arrows.</li>
          <li>Function names complete as you type (Tab or Enter picks one); the bar below shows how to call the function.</li>
          <li>About 290 functions: Excel's (math, text, dates, lookups, statistics, finance, engineering) and data analysis ones (derivatives, integrals, smoothing, filters, FFT, interpolation, peaks, baselines).</li>
        </ul>
      </Section>
      <Section title="Python cells (=PY)">
        <p>
          A cell starting with <code>=PY</code> runs Python: <code>ks("A1:A10")</code> reads cells (a range comes as a NumPy array), <code>ks_set("C1", values)</code>{' '}
          writes, and the last line is the result — a value, a list (spilled down), a matplotlib figure (drawn beside the cell) or any object. <code>np</code>,{' '}
          <code>plt</code>, <code>pd</code> and <code>math</code> are ready; SciPy and other packages load when used. Python cells of a file you open run only after you allow them
          (examples are trusted, as on the desktop).
        </p>
      </Section>
      <Section title="Formats, charts, data">
        <p>
          Format cells from the second toolbar row or Format › Format Cells ({MOD}1): number formats, fonts, colours, borders, alignment, merged cells. The grid
          is dark: pale fills show deep with the same hue, and the file keeps your colours. Select columns and insert a chart (Insert › Chart): it follows its
          data; double-click it to edit it, right-click to add a trendline. Data › Sort and Filter work on the table around the selected cell; Tools › Solver
          finds the values that make a cell as large, small or close to a target as possible.
        </p>
      </Section>
      <Section title="Files">
        <p>
          File › Save writes <code>.ksheet</code> (or <code>.csv</code>); File › Export writes CSV or Excel <code>.xlsx</code>. Open reads <code>.ksheet</code>,{' '}
          <code>.csv</code> and <code>.xlsx</code>. The Examples menu has the desktop app's worked examples, Python examples, exercises and templates.
        </p>
      </Section>
      <Section title="Keyboard">
        <Shortcuts />
      </Section>
    </div>
  )
}

function About({ core, python }: { core: string; python: string | null }) {
  return (
    <div className="ks-doc ks-about">
      <h2>
        <span className="ks-brand-k">Kherve</span>
        <span className="ks-brand-s">Sheet</span>
      </h2>
      <p className="k-muted">Web edition for KherveOS · calculation core from {core}</p>
      <p>An Excel-inspired spreadsheet workbench: formulas, Python cells, charts, curve fitting and the Solver.</p>
      <p>
        <b>Created by Gwilherm Kerherve</b>
        <br />
        Part of the Kherve family of scientific apps. {python ? `Python ${python} runs in your browser (Pyodide).` : 'Python runs in your browser (Pyodide).'}
      </p>
      <p className="k-muted">Licensed under the GNU GPL v3.0.</p>
    </div>
  )
}

// ------------------------------------------------------------------- app

export default function KherveSheet({ win, args }: AppProps) {
  const [book] = useState(() => new Book(`sheet-${win.id}`))
  useAppTools(win, useMemo(() => sheetAiTools(book), [book]))
  const rootRef = useRef<HTMLDivElement>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [examples, setExamples] = useState<ExampleMenu[] | 'loading' | 'error'>('loading')
  const [bannerHidden, setBannerHidden] = useState(false)

  const path = useStore(book.store, (s) => s.path)
  const untitled = useStore(book.store, (s) => s.untitled)
  const dirty = useStore(book.store, (s) => s.dirty)
  const status = useStore(book.store, (s) => s.status)
  const busy = useStore(book.store, (s) => s.busy)
  const progress = useStore(book.store, (s) => s.progress)
  const flash = useStore(book.store, (s) => s.flash)
  const loading = useStore(book.store, (s) => s.loading)
  const canUndo = useStore(book.store, (s) => s.canUndo)
  const canRedo = useStore(book.store, (s) => s.canRedo)
  const pyPending = useStore(book.store, (s) => s.pyPending)
  const ready = useStore(book.store, (s) => s.ready)
  const view = useStore(book.store, (s) => s.view)
  const object = useStore(book.store, (s) => s.object)
  const sel = useStore(book.store, (s) => s.sel)
  const active = useStore(book.store, (s) => s.active)
  const loops = useStore(book.store, (s) => s.loops)
  const version = useStore(book.store, (s) => s.version)
  const sh = book.sheet(active)
  const name = path ? basename(path) : `${untitled}`

  // Python lives as long as the window.
  useEffect(() => {
    book.mount()
    return () => book.unmount()
  }, [book])

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (typeof args.path === 'string' && args.path) void openPath(book, args.path, false)
    else if (typeof args.example === 'string') void openExample(book, args.example, typeof args.title === 'string' ? args.title : basename(args.example), false)
    else void book.bridge.call('new', { sheets: book.sheets.map((s) => s.name) })
  }, [book, args])

  useEffect(() => {
    win.setTitle(`${dirty ? '• ' : ''}${name} — KherveSheet`)
  }, [win, dirty, name])
  useEffect(() => win.setDocumentPath(path), [win, path])
  useEffect(() => {
    win.setCloseGuard(() => confirmDiscard(book, 'closing'))
    return () => win.setCloseGuard(null)
  }, [win, book])

  const loadIndex = () => {
    setExamples('loading')
    loadExamples().then(setExamples, () => setExamples('error'))
  }
  useEffect(loadIndex, [])
  useEffect(() => setBannerHidden(false), [path, untitled])

  // ------------------------------------------------------------- actions

  const after = (fn: () => Promise<unknown> | unknown) => () => {
    void Promise.resolve(fn()).finally(() => book.refocus())
  }
  const copy = () => {
    const text = copySelection(book)
    if (text !== null) void navigator.clipboard?.writeText(text).catch(() => {})
  }
  const cut = () => {
    const text = copySelection(book, true)
    if (text !== null) void navigator.clipboard?.writeText(text).catch(() => {})
  }
  const paste = async (values = false) => {
    let text: string | null = null
    try {
      text = await navigator.clipboard.readText()
    } catch {
      text = getClip()?.text ?? null
    }
    if (text) await pasteText(book, text, values)
    else book.showFlash('The clipboard is empty (or the browser did not allow reading it: use ' + MOD + 'V).')
  }
  const editNote = (r = book.active.sel.active.r, c = book.active.sel.active.c) => setDialog({ kind: 'note', r, c, initial: noteText(book.active, r, c) ?? '' })
  const askNumber = async (title: string, label: string, value: number): Promise<number | null> => {
    const v = await os.dialog.prompt(label, { title, defaultValue: String(value) })
    if (v === null) return null
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) {
      book.showFlash('Type a number of pixels.')
      return null
    }
    return n
  }
  const colWidth = async () => {
    const cols = selectedCols(book)
    const w = await askNumber('Column Width', 'Width (pixels):', book.geometry(book.active).cols.size(cols[0] ?? 0))
    if (w !== null) setColWidth(book, cols, w)
    book.refocus()
  }
  const rowHeight = async () => {
    const rows = selectedRows(book)
    const h = await askNumber('Row Height', 'Height (pixels):', book.geometry(book.active).rows.size(rows[0] ?? 0))
    if (h !== null) setRowHeight(book, rows, h)
    book.refocus()
  }
  const link = async () => {
    const s = book.active
    const { r, c } = s.sel.active
    const url = await os.dialog.prompt('Web address:', { title: 'Link', defaultValue: linkOf(s, r, c) ?? 'https://', placeholder: 'https://…' })
    if (url === null) return book.refocus()
    const text = s.cells.get(key(r, c))?.t || url
    await setLink(book, r, c, url.trim() && url.trim() !== 'https://' ? url.trim() : null, text)
    book.refocus()
  }
  const objectMenu = (ref: NonNullable<ObjectRef>, at: { clientX: number; clientY: number }) => {
    if (at.clientX < 0) {
      // The Delete key.
      removeObject(book, ref)
      return
    }
    const items: MenuItem[] = []
    if (ref.kind === 'chart') {
      items.push({ label: 'Edit Chart…', onClick: () => setDialog({ kind: 'chart', id: ref.id }) })
      items.push({ label: 'Trendline…', onClick: () => setDialog({ kind: 'trend', id: ref.id }) })
      items.push({ label: 'Save as SVG…', onClick: () => void saveChartSvg(ref.id) })
      items.push('-')
    }
    if (ref.kind === 'equation') {
      const o = book.active.equations.find((x) => x.id === ref.id)
      items.push({ label: 'Edit Equation…', onClick: () => setDialog({ kind: 'equation', id: ref.id, initial: String(o?.d.latex ?? '') }) }, '-')
    }
    items.push({ label: 'Bring to Front', onClick: () => restack(book, ref, true) }, { label: 'Send to Back', onClick: () => restack(book, ref, false) }, '-')
    items.push({ label: 'Delete', danger: true, onClick: () => removeObject(book, ref) })
    os.contextMenu(at, items)
  }
  const saveChartSvg = async (id: string) => {
    const ch = book.active.charts.find((c) => c.id === id)
    if (!ch?.url) return book.showFlash('The chart is not drawn yet.')
    const svg = await fetch(ch.url).then((r) => r.text())
    const base = (ch.spec.title || 'Chart').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Chart'
    const target = await os.dialog.saveFile({ title: 'Save Chart as SVG', defaultName: `${path ? dirname(path) : '/home/user/Documents'}/${base}.svg`, extensions: ['.svg'] })
    if (target) {
      await os.fs.writeText(target, svg, { mkdirs: true })
      book.showFlash(`Saved ${basename(target)}`)
    }
  }
  const selectedChart = (): string | null => {
    if (object?.kind === 'chart') return object.id
    return book.active.charts.length === 1 ? book.active.charts[0].id : null
  }

  const closeDialog = () => {
    setDialog(null)
    book.refocus()
  }
  /** After sorting a filtered table, hide again what the filter hides. */
  const toggleRefilter = () => {
    applyFilter(book.active)
    book.active.geomV++
    book.bump()
  }
  const fontFor = (s: typeof sh, k: number) => cellFont(s.formats.get(k), getComputedStyle(rootRef.current ?? document.body).getPropertyValue('--k-font').trim() || 'sans-serif')

  const gridActions: GridActions = {
    formatCells: () => setDialog({ kind: 'format' }),
    editNote: (r, c) => editNote(r, c),
    showPython: (r, c) => setDialog({ kind: 'py', r, c }),
    colWidth: () => void colWidth(),
    rowHeight: () => void rowHeight(),
    link: () => void link(),
    filterMenu: (col, at) => setDialog({ kind: 'filter', col, at }),
    editChart: (id) => setDialog({ kind: 'chart', id }),
    editEquation: (id) => {
      const o = book.active.equations.find((x) => x.id === id)
      setDialog({ kind: 'equation', id, initial: String(o?.d.latex ?? '') })
    },
    objectMenu,
  }

  // --------------------------------------------------------------- menus

  const menus = useMemo<MenuBarMenu[]>(() => {
    const recent = recentFiles()
    const recentItems: MenuItem[] = recent.length
      ? [
          ...recent.map((p): MenuItem => ({ label: `${basename(p)}   ${pretty(dirname(p))}`, disabled: !os.fs.isFile(p), onClick: after(() => openPath(book, p)) })),
          '-',
          { label: 'Clear Recent Files', onClick: () => clearRecent() },
        ]
      : [{ label: '(no recent files)', disabled: true }]
    const exampleItems: MenuItem[] = []
    if (examples === 'loading') exampleItems.push({ label: 'Loading examples…', disabled: true })
    else if (examples === 'error') exampleItems.push({ label: 'The examples could not be loaded — try again', onClick: loadIndex })
    else
      for (const m of examples) {
        const sub: MenuItem[] = m.items.map((x) => ({ label: x.title, onClick: after(() => openExample(book, x.file, x.title)) }))
        for (const g of m.groups) sub.push({ label: g.name, submenu: g.items.map((x) => ({ label: x.title, onClick: after(() => openExample(book, x.file, x.title)) })) })
        exampleItems.push({ label: m.name, submenu: sub.length ? sub : [{ label: '(none)', disabled: true }] })
      }
    const fr = sh.freeze
    const chartId = selectedChart()
    return [
      {
        label: 'File',
        items: [
          { label: 'New', shortcut: `${MOD}N`, onClick: after(() => newWorkbook(book)) },
          { label: 'New Window', shortcut: `${SHIFT}${MOD}N`, onClick: () => os.open('khervesheet') },
          '-',
          { label: 'Open…', shortcut: `${MOD}O`, onClick: after(() => openDialog(book)) },
          { label: 'Open Recent', submenu: recentItems },
          '-',
          { label: 'Save', shortcut: `${MOD}S`, onClick: after(() => save(book)) },
          { label: 'Save As…', shortcut: `${SHIFT}${MOD}S`, onClick: after(() => saveAs(book)) },
          '-',
          { label: 'Import', submenu: [{ label: 'Text / CSV…', onClick: after(() => openDialog(book)) }, { label: 'Excel (.xlsx)…', onClick: after(() => openDialog(book)) }] },
          { label: 'Export', submenu: [{ label: 'CSV (this sheet)…', onClick: after(() => exportAs(book, '.csv')) }, { label: 'Excel (.xlsx)…', onClick: after(() => exportAs(book, '.xlsx')) }] },
          '-',
          { label: 'Close Window', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: `${MOD}Z`, disabled: !canUndo, onClick: after(() => book.undo()) },
          { label: 'Redo', shortcut: MAC ? `${SHIFT}${MOD}Z` : `${MOD}Y`, disabled: !canRedo, onClick: after(() => book.redo()) },
          '-',
          { label: 'Cut', shortcut: `${MOD}X`, onClick: after(cut) },
          { label: 'Copy', shortcut: `${MOD}C`, onClick: after(copy) },
          { label: 'Paste', shortcut: `${MOD}V`, onClick: after(() => paste(false)) },
          { label: 'Paste Values Only', shortcut: `${SHIFT}${MOD}V`, onClick: after(() => paste(true)) },
          '-',
          { label: 'Fill Down', shortcut: `${MOD}D`, onClick: after(() => fillDownRight(book, true)) },
          { label: 'Fill Right', shortcut: `${MOD}R`, onClick: after(() => fillDownRight(book, false)) },
          '-',
          { label: 'Clear Contents', shortcut: 'Del', onClick: after(() => clearContents(book)) },
          { label: 'Clear Formats', onClick: after(() => clearFormats(book)) },
          { label: 'Clear All', onClick: after(() => clearAll(book)) },
          '-',
          { label: 'Find…', shortcut: `${MOD}F`, onClick: () => setDialog({ kind: 'find', replace: false }) },
          { label: 'Replace…', shortcut: `${MOD}H`, onClick: () => setDialog({ kind: 'find', replace: true }) },
          { label: 'Select All', shortcut: `${MOD}A`, onClick: after(() => book.selectAll()) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Formatting Toolbar', checked: view.formatBar, onClick: after(() => book.setView({ formatBar: !view.formatBar })) },
          { label: 'Gridlines', checked: view.gridlines, onClick: after(() => book.setView({ gridlines: !view.gridlines })) },
          { label: 'Headings', checked: view.headings, onClick: after(() => book.setView({ headings: !view.headings })) },
          { label: 'Formulas', shortcut: `${MOD}\``, checked: view.formulas, onClick: after(() => book.setView({ formulas: !view.formulas })) },
          '-',
          {
            label: 'Freeze Panes',
            submenu: [
              { label: 'Freeze at the Selected Cell', onClick: after(() => freezePanes(book, sh.sel.active.r, sh.sel.active.c)) },
              { label: 'Freeze Top Row', onClick: after(() => freezePanes(book, 1, 0)) },
              { label: 'Freeze First Column', onClick: after(() => freezePanes(book, 0, 1)) },
              { label: 'Unfreeze Panes', disabled: !fr[0] && !fr[1], onClick: after(() => freezePanes(book, 0, 0)) },
            ],
          },
          '-',
          { label: 'Zoom In', shortcut: `${MOD}=`, onClick: after(() => book.setView({ zoom: Math.min(4, Math.round(view.zoom * 110) / 100) })) },
          { label: 'Zoom Out', shortcut: `${MOD}-`, onClick: after(() => book.setView({ zoom: Math.max(0.25, Math.round((view.zoom / 1.1) * 100) / 100) })) },
          { label: 'Actual Size', onClick: after(() => book.setView({ zoom: 1 })) },
        ],
      },
      {
        label: 'Insert',
        items: [
          { label: 'Rows Above', onClick: after(() => insertRows(book)) },
          { label: 'Rows Below', onClick: after(() => insertRows(book, true)) },
          { label: 'Columns Left', onClick: after(() => insertCols(book)) },
          { label: 'Columns Right', onClick: after(() => insertCols(book, true)) },
          { label: 'Sheet', onClick: after(() => addSheet(book)) },
          '-',
          { label: 'Chart', submenu: CHART_TYPES.map((t) => ({ label: t, onClick: after(() => insertChart(book, t)) })) },
          { label: 'Function', submenu: functionMenu(book, (fn) => insertFunction(book, fn)) },
          { label: 'AutoSum', onClick: () => autoSum(book) },
          { label: 'Python Cell (=PY)', onClick: () => {
            book.startEdit('=PY\n', 'bar')
            book.setEdit({ mode: 'edit' })
          } },
          '-',
          { label: 'Equation…', onClick: () => setDialog({ kind: 'equation', id: null, initial: '' }) },
          { label: 'Picture…', onClick: after(() => insertImage(book)) },
          '-',
          { label: noteText(sh, sh.sel.active.r, sh.sel.active.c) !== null ? 'Edit Note…' : 'Note…', shortcut: `${SHIFT}F2`, onClick: () => editNote() },
          { label: 'Link…', shortcut: `${MOD}K`, onClick: () => void link() },
          { label: 'Checkbox', onClick: after(() => insertCheckboxes(book)) },
          { label: 'Dropdown List…', onClick: () => setDialog({ kind: 'dropdown', initial: dropdownOf(sh, sh.sel.active.r, sh.sel.active.c) ?? [] }) },
        ],
      },
      {
        label: 'Format',
        items: [
          { label: 'Format Cells…', shortcut: `${MOD}1`, onClick: () => setDialog({ kind: 'format' }) },
          { label: 'Number Format', submenu: NUMBER_FORMATS.map((n) => ({ label: n.label, onClick: after(() => setNumberFormat(book, n.fmt)) })) },
          '-',
          { label: 'Bold', shortcut: `${MOD}B`, onClick: after(() => toggleFlag(book, 'bold', 'Bold')) },
          { label: 'Italic', shortcut: `${MOD}I`, onClick: after(() => toggleFlag(book, 'italic', 'Italic')) },
          { label: 'Underline', shortcut: `${MOD}U`, onClick: after(() => toggleFlag(book, 'underline', 'Underline')) },
          { label: 'Wrap Text', onClick: after(() => toggleFlag(book, 'wrap_text', 'Wrap Text')) },
          '-',
          { label: 'Merge Cells', onClick: after(() => mergeCells(book)) },
          { label: 'Unmerge Cells', onClick: after(() => unmergeCells(book)) },
          '-',
          { label: 'Column Width…', onClick: () => void colWidth() },
          { label: 'AutoFit Column Width', onClick: after(() => autoFitCols(book, selectedCols(book), fontFor)) },
          { label: 'Row Height…', onClick: () => void rowHeight() },
          '-',
          { label: 'Clear Formats', onClick: after(() => clearFormats(book)) },
        ],
      },
      {
        label: 'Data',
        items: [
          { label: 'Sort A → Z', onClick: after(() => quickSort(book, true)) },
          { label: 'Sort Z → A', onClick: after(() => quickSort(book, false)) },
          { label: 'Sort…', onClick: () => setDialog({ kind: 'sort', range: dataRange(book) }) },
          '-',
          { label: 'Filter', checked: !!sh.filter, shortcut: `${SHIFT}${MOD}L`, onClick: after(() => toggleFilter(book)) },
          '-',
          {
            label: 'Set Column As',
            submenu: [
              { label: 'X', onClick: after(() => setDesignation(book, 'X')) },
              { label: 'Y', onClick: after(() => setDesignation(book, 'Y')) },
              { label: 'None', onClick: after(() => setDesignation(book, null)) },
            ],
          },
          '-',
          { label: 'Calculate Now', shortcut: 'F9', onClick: after(() => book.recalc(true)) },
          { label: pyPending ? `Run Python Cells (${pyPending})` : 'Run Python Cells', disabled: !pyPending, onClick: after(() => book.trustPython()) },
          { label: 'Python Loops', checked: loops, disabled: !book.hasLoops(), onClick: () => book.setLoops(!loops) },
        ],
      },
      {
        label: 'Tools',
        items: [
          { label: 'Solver…', onClick: () => setDialog({ kind: 'solver' }) },
          { label: 'Trendline…', disabled: !chartId, onClick: () => chartId && setDialog({ kind: 'trend', id: chartId }) },
          '-',
          { label: 'Restart Python', onClick: after(() => book.bridge.kernel.restart()) },
        ],
      },
      { label: 'Examples', items: exampleItems },
      {
        label: 'Help',
        items: [
          { label: 'User Guide', shortcut: 'F1', onClick: () => void os.dialog.alert(<UserGuide />, { title: 'KherveSheet — User Guide' }).finally(() => book.refocus()) },
          { label: 'Keyboard Shortcuts', onClick: () => void os.dialog.alert(<div className="ks-doc"><Shortcuts /></div>, { title: 'KherveSheet shortcuts' }).finally(() => book.refocus()) },
          '-',
          { label: 'Report an Issue / Feedback…', onClick: () => os.openUrl(ISSUES_URL) },
          { label: 'About KherveSheet', onClick: () => void os.dialog.alert(<About core={CORE_SOURCE} python={null} />, { title: 'About KherveSheet' }).finally(() => book.refocus()) },
        ],
      },
    ]
    // `version` refreshes notes, filters and freeze in the menus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, win, examples, canUndo, canRedo, view, sh, pyPending, loops, object, path, version, sel, ready])

  useEffect(() => {
    win.setMenus(menus)
  }, [win, menus])
  useEffect(() => () => win.setMenus(null), [win])

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const run = (fn: () => unknown) => {
      e.preventDefault()
      void Promise.resolve(fn()).finally(() => book.refocus())
    }
    if (k === 'F1') return run(() => os.dialog.alert(<UserGuide />, { title: 'KherveSheet — User Guide' }))
    if (k === 'F2' && e.shiftKey) return run(() => editNote())
    if (k === 'F3' && e.shiftKey) {
      e.preventDefault()
      const r = rootRef.current?.querySelector('.ks-fx')?.getBoundingClientRect()
      if (r) os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, functionMenu(book, (fn) => insertFunction(book, fn)))
      return
    }
    if (!mod || e.altKey) return
    if (book.state.edit) return
    if (e.shiftKey) {
      const shifted: Record<string, () => unknown> = {
        s: () => saveAs(book),
        n: () => os.open('khervesheet'),
        z: () => book.redo(),
        v: () => paste(true),
        l: () => toggleFilter(book),
      }
      if (shifted[k]) return run(shifted[k])
      return
    }
    const plain: Record<string, () => unknown> = {
      s: () => save(book),
      o: () => openDialog(book),
      n: () => newWorkbook(book),
      z: () => book.undo(),
      y: () => book.redo(),
      f: () => setDialog({ kind: 'find', replace: false }),
      h: () => setDialog({ kind: 'find', replace: true }),
      k: () => link(),
      '=': () => book.setView({ zoom: Math.min(4, Math.round(view.zoom * 110) / 100) }),
      '+': () => book.setView({ zoom: Math.min(4, Math.round(view.zoom * 110) / 100) }),
      '-': () => book.setView({ zoom: Math.max(0.25, Math.round((view.zoom / 1.1) * 100) / 100) }),
    }
    if (plain[k]) run(plain[k])
  }

  // ---------------------------------------------------- dropping files

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    e.preventDefault()
    try {
      const paths = (JSON.parse(raw) as string[]).filter((p) => OPEN_TYPES.includes(extname(p)))
      if (paths.length) void openPath(book, paths[0])
      for (const p of paths.slice(1)) os.open('khervesheet', { path: p })
    } catch {
      /* not a list of paths */
    }
  }

  // ---------------------------------------------------------------- view

  const stats = useMemo(() => selectionStats(sh), [sh, sel, version])
  const location = path ? pretty(path) : untitled !== 'Untitled' ? `${untitled} · example, not saved` : 'Not saved yet'
  const message = loading ?? progress ?? flash ?? (status === 'starting' ? 'Starting Python (the first time downloads it)…' : !ready && status !== 'dead' ? 'Loading the spreadsheet engine…' : busy ? 'Computing…' : null)
  const spinning = !!loading || !!progress || status === 'starting' || (!ready && status !== 'dead') || (busy > 0 && message === 'Computing…')
  const g = sel.ranges[sel.ranges.length - 1]
  const sizeNote = sel.ranges.length === 1 && (g.r1 !== g.r2 || g.c1 !== g.c2) ? `${g.r2 - g.r1 + 1}R × ${g.c2 - g.c1 + 1}C` : a1(sel.active.r, sel.active.c)

  return (
    <BookContext.Provider value={book}>
      <RootContext.Provider value={rootRef}>
        <div className="k-app ks-app" ref={rootRef} onKeyDown={onKeyDown} onDragOver={onDragOver} onDrop={onDrop}>
          <Toolbar
            book={book}
            root={rootRef.current}
            actions={{
              newBook: after(() => newWorkbook(book)),
              open: after(() => openDialog(book)),
              save: after(() => save(book)),
              cut: after(cut),
              copy: after(copy),
              paste: after(() => paste(false)),
              solver: () => setDialog({ kind: 'solver' }),
              equation: () => setDialog({ kind: 'equation', id: null, initial: '' }),
              note: () => editNote(),
              image: after(() => insertImage(book)),
            }}
          />
          <FormulaBar book={book} onPythonOutput={() => setDialog({ kind: 'py', r: sel.active.r, c: sel.active.c })} />
          {pyPending > 0 && !bannerHidden && (
            <div className="ks-banner" role="status">
              <Play size={14} />
              <span>
                This workbook has {pyPending} Python (=PY) cell{pyPending === 1 ? '' : 's'} that did not run. Python cells run code in this window: run them
                only if you trust where the file comes from.
              </span>
              <button className="k-btn small primary" onClick={() => void book.trustPython()}>Run Python Cells</button>
              <button className="k-icon-btn" title="Hide" aria-label="Hide" onClick={() => setBannerHidden(true)}>
                <X size={14} />
              </button>
            </div>
          )}
          <div className="ks-body">
            <Grid book={book} actions={gridActions} />
            {loading && (
              <div className="ks-loading">
                <LoaderCircle size={18} className="k-spin" />
                {loading}
              </div>
            )}
          </div>
          <SheetTabs book={book} />
          <div className="k-statusbar ks-statusbar">
            <span className="ks-sb-file" title={path ?? undefined}>{location}</span>
            <span className="ks-sb-msg">
              {message && spinning && <LoaderCircle size={12} className="k-spin" />}
              {message}
            </span>
            {stats && (
              <span className="ks-sb-stats">
                {stats.count > 0 && <>Average: {statText(stats.avg)}   </>}
                Count: {stats.count > 0 ? stats.count : stats.cells}
                {stats.count > 0 && <>   Sum: {statText(stats.sum)}</>}
              </span>
            )}
            <span className="ks-sb-sel">{sizeNote}</span>
            <button className="ks-sb-zoom" title="Zoom (Ctrl + wheel)" onClick={() => book.setView({ zoom: 1 })}>
              {Math.round(view.zoom * 100)}%
            </button>
            <span className={`ks-sb-py ${status}`} title={`Python ${STATUS_LABEL[status]}`}>
              <i /> Python {STATUS_LABEL[status]}
            </span>
          </div>

          {dialog?.kind === 'format' && <FormatCellsDialog book={book} onClose={closeDialog} />}
          {dialog?.kind === 'chart' && <ChartDialog book={book} id={dialog.id} onClose={closeDialog} />}
          {dialog?.kind === 'trend' && <TrendlineDialog book={book} id={dialog.id} onClose={closeDialog} />}
          {dialog?.kind === 'solver' && <SolverDialog book={book} onClose={closeDialog} />}
          {dialog?.kind === 'sort' && <SortDialog book={book} range={dialog.range} onClose={closeDialog} />}
          {dialog?.kind === 'find' && <FindDialog book={book} replace={dialog.replace} onClose={closeDialog} />}
          {dialog?.kind === 'py' && <PythonOutputDialog book={book} r={dialog.r} c={dialog.c} onClose={closeDialog} />}
          {dialog?.kind === 'equation' && (
            <EquationDialog
              initial={dialog.initial}
              onDone={(latex) => {
                if (dialog.id) editEquation(book, dialog.id, latex)
                else insertEquation(book, latex)
              }}
              onClose={closeDialog}
            />
          )}
          {dialog?.kind === 'dropdown' && (
            <ListDialog title="Dropdown List" label="One choice per line:" initial={dialog.initial} onDone={(items) => setDropdown(book, items)} onClose={closeDialog} />
          )}
          {dialog?.kind === 'note' && (
            <TextDialog
              title={`Note — ${a1(dialog.r, dialog.c)}`}
              label="Note:"
              initial={dialog.initial}
              multiline
              removable={!!dialog.initial}
              onDone={(text) => setNote(book, dialog.r, dialog.c, text && text.trim() ? text : null)}
              onClose={closeDialog}
            />
          )}
          {dialog?.kind === 'filter' && rootRef.current && (
            <FilterPopover
              book={book}
              root={rootRef.current}
              col={dialog.col}
              at={dialog.at}
              onClose={closeDialog}
              onSort={(asc) => {
                const f = book.active.filter
                if (f) void sortRange(book, f.range, dialog.col, asc, true).then(() => toggleRefilter())
                closeDialog()
              }}
            />
          )}
        </div>
      </RootContext.Provider>
    </BookContext.Provider>
  )
}
