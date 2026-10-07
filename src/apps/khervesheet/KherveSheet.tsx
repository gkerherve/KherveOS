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
import { basename, dirname, extname } from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import { useSettings } from '@/os/settings'
import { Book, type ObjectRef } from './book'
import { BookContext, RootContext } from './Assist'
import { ChartDialog, SolverDialog, SortDialog, TrendlineDialog } from './chartdialogs'
import { getClip } from './clip'
import { ColorPopover, EquationDialog, FilterPopover, FindDialog, FormatCellsDialog, InsertFunctionDialog, ListDialog, TextDialog } from './dialogs'
import { loadExamples, type ExampleMenu } from './examples'
import { OPEN_TYPES, confirmDiscard, exportAs, newWorkbook, openDialog, openExample, openPath, save, saveAs } from './files'
import { FormulaBar, functionMenu, insertFunction } from './FormulaBar'
import { Grid, type GridActions } from './Grid'
import { cellFont } from './draw'
import { menuIcon, PLOT_ICONS } from './icons'
import { a1, key, parseRange, type Range } from './model'
import {
  CHART_TYPES, dropdownOf, editEquation, insertChart, insertCheckboxes, insertEquation, insertImage, linkOf, moveObject, noteKind, noteText,
  removeObject, restack, setDropdown, setLink, setNote, updateChart,
} from './objects'
import {
  addSheet, applyFilter, autoFitCols, clearContents, clearFormats, copySelection, dataRange, fillDownRight, formatCells, freezePanes,
  insertCols, insertRows, insertSparkline, insertSparklines, mergeCells, numbersIn, pasteText, quickSort, removeSparklines, selectedCols,
  selectedRows, selectionStats, setColWidth, setDesignation, setNumberFormat, setRowHeight, sortRange, statText, statisticsText,
  toggleFilter, toggleFlag, transposeSelection, unmergeCells,
} from './ops'
import { PythonCellDialog, showPythonHelp, type PyDialogTarget } from './PyEditor'
import { ScienceDialog, WEB_SCIENCE } from './science'
import { SheetTabs } from './SheetTabs'
import { SCIENCE_TOOLS, Toolbar, autoSum, borderMenu, equationMenu } from './Toolbar'
import { printSheet } from './print'
import { clearRecent, recentFiles } from './prefs'
import { useAppTools } from '@/os/ai/appTools'
import { sheetAiTools } from './aiTools'

/** The desktop KherveSheet this edition follows (its dev branch). */
export const CORE_SOURCE = 'KherveSheet dev @ cef25ce'
const GITHUB_URL = 'https://github.com/gkerherve/KherveSheet'
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
  | { kind: 'science'; tool: string }
  | { kind: 'insfn' }
  | { kind: 'equation'; id: string | null; initial: string }
  | { kind: 'dropdown'; initial: string[] }
  | { kind: 'note'; r: number; c: number; initial: string; note: 'comment' | 'note' }
  | { kind: 'filter'; col: number; at: { clientX: number; clientY: number } }
  | null

/** The desktop's NUMBER_FORMATS (Format ▸ Number Format); core/numbers reads these names as they are. */
const DESKTOP_NUMBER_FORMATS = ['General', '0', '0.0', '0.00', '0.000', '0.0000', 'Scientific', 'Percentage', 'Currency', 'Date', 'Time', 'Text']

// ------------------------------------------------------------------ help

function Kbd({ k }: { k: string }) {
  return <kbd>{k}</kbd>
}

function Shortcuts() {
  const rows: [string, string][] = [
    ['Enter / Tab', 'Keep the entry and move down / right (with Shift: up / left)'],
    ['F2 or double-click', 'Edit the cell (arrows then move the caret)'],
    ['Alt+Enter', 'A new line in the cell'],
    [`=PY then Enter`, 'Python code in the formula bar: Enter for a new line, ' + `${MOD}Enter to run it`],
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
    [`${SHIFT}F2 / ${MOD}Alt+M`, 'Note / comment'],
    [`${MOD}K`, 'Link'],
    [`${SHIFT}F3`, 'Insert a function'],
    [`${MOD}= / ${MOD}- / ${MOD}0`, 'Zoom in / out / reset'],
    [`${MOD}P`, 'Print'],
    [`${SHIFT}${MOD}A`, 'KherveAI chat'],
    [`${MOD}S / ${SHIFT}${MOD}S`, 'Save / save as'],
    [`${MOD}/ and ${MOD}Space (Python editor)`, 'Comment lines / complete a name'],
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
  /** The pop-out Python editor (non-modal, beside the other dialogs). */
  const [pyDialog, setPyDialog] = useState<PyDialogTarget | null>(null)
  /** Format ▸ Fill Color… / Font Color…: the palette under the formula bar. */
  const [colorPick, setColorPick] = useState<'fill' | 'ink' | null>(null)
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
  const picking = useStore(book.store, (s) => s.picking)
  const version = useStore(book.store, (s) => s.version)
  const light = useSettings((s) => s.lightApps.includes('khervesheet'))
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
  /** Insert ▸ Comment / Note (insert_ops.insert_comment / insert_note). */
  const editNote = (kind: 'comment' | 'note' = 'note', r = book.active.sel.active.r, c = book.active.sel.active.c) =>
    setDialog({ kind: 'note', r, c, initial: noteText(book.active, r, c) ?? '', note: kind })
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
  const showStats = (title: string, values: number[], head = '') => {
    const text = statisticsText(values)
    void os.dialog
      .alert(text ? <pre className="ks-stats">{head + text}</pre> : head ? 'No numeric data in column.' : 'No numeric data selected.', { title })
      .finally(() => book.refocus())
  }
  const statistics = () => showStats('Statistics', numbersIn(book.active, book.active.sel.ranges))
  const columnStatistics = (col: number) =>
    showStats('Statistics', numbersIn(book.active, [{ r1: 0, c1: col, r2: book.active.rows - 1, c2: col }]), `Column ${a1(0, col).replace(/\d+$/, '')}\n\n`)
  const sparklines = async () => {
    const g = book.active.sel.ranges[0]
    if (g.r1 === g.r2) return void os.dialog.alert('Select at least two rows of data for sparklines.', { title: 'Insert Sparklines' })
    const v = await os.dialog.prompt(`${g.c2 - g.c1 + 1} sparkline(s) will be created (one per selected column). Target row:`, {
      title: 'Insert Sparklines',
      defaultValue: String(Math.max(1, g.r1)),
    })
    const row = Number(v)
    if (v !== null && Number.isInteger(row) && row >= 1) insertSparklines(book, row - 1)
    book.refocus()
  }
  const sparkline = async () => {
    const { r, c } = book.active.sel.active
    const letter = a1(0, c).replace(/\d+$/, '')
    const v = await os.dialog.prompt('Data range:', { title: 'Insert Sparkline', defaultValue: r > 0 ? `${letter}1:${letter}${r}` : '' })
    const g = v ? parseRange(v.replace(/\$/g, ''), book.active.rows, book.active.cols) : null
    if (g) insertSparkline(book, r, c, g)
    else if (v) book.showFlash(`"${v}" is not a range.`)
    book.refocus()
  }
  const unsparkle = () => {
    if (!removeSparklines(book)) void os.dialog.alert('No sparklines in the selected cells.', { title: 'Remove Sparkline' })
  }
  const insertPython = () => {
    // Insert ▸ Python Cell: the formula bar in Python mode (_insert_python_cell).
    book.startEdit('=PY\n', 'bar')
    book.setEdit({ mode: 'edit', python: true })
  }
  const openPopOut = (code: string) => {
    const s = book.active
    setPyDialog({ sheet: s.id, r: s.sel.active.r, c: s.sel.active.c, code })
  }
  const equation = (latex: string | null) => (latex ? insertEquation(book, latex) : setDialog({ kind: 'equation', id: null, initial: '' }))
  const science = (tool: string) => {
    const t = tool.replace(/…$/, '')
    if (WEB_SCIENCE.has(t)) setDialog({ kind: 'science', tool: t })
    else void os.dialog.alert(`${t} is a desktop KherveSheet tool that is not in the web edition yet.`, { title: t })
  }
  const curveFitting = () => {
    const id = selectedChart()
    if (id) return setDialog({ kind: 'trend', id })
    void os.dialog.alert('Select a chart (Insert ▸ Chart) first: Curve Fitting fits its data with a trendline.', { title: 'Curve Fitting' })
  }
  const aiChat = () => os.open('kherveai')
  const zoomTo = (pct: number) => book.setView({ zoom: Math.max(0.25, Math.min(2, Math.round(pct) / 100)) })
  const zoomIn = () => zoomTo(Math.round(view.zoom * 100) + 10)
  const zoomOut = () => zoomTo(Math.round(view.zoom * 100) - 10)
  const objectMenu = (ref: NonNullable<ObjectRef>, at: { clientX: number; clientY: number }) => {
    if (at.clientX < 0) {
      // The Delete key.
      removeObject(book, ref)
      return
    }
    const items: MenuItem[] = []
    if (ref.kind === 'chart') {
      // The desktop's chart menu (graph.EmbeddedChart.contextMenuEvent).
      const ch = book.active.charts.find((c) => c.id === ref.id)
      const props = () => setDialog({ kind: 'chart', id: ref.id })
      const scale = (axis: 'x' | 'y', log: boolean) =>
        ch && updateChart(book, ref.id, { ...ch.spec, [axis === 'x' ? 'logX' : 'logY']: log || undefined }, `${axis.toUpperCase()} Axis Scale`)
      const axisMenu = (axis: 'x' | 'y'): MenuItem => ({
        label: `${axis.toUpperCase()} Axis`,
        submenu: [
          { label: 'Linear', checked: !(axis === 'x' ? ch?.spec.logX : ch?.spec.logY), onClick: () => scale(axis, false) },
          { label: 'Log₁₀', checked: !!(axis === 'x' ? ch?.spec.logX : ch?.spec.logY), onClick: () => scale(axis, true) },
          '-',
          { label: 'Invert Axis', disabled: true },
          '-',
          { label: 'Axis Properties…', onClick: props },
        ],
      })
      const size = (label: string, w: number, h: number): MenuItem => ({
        label,
        onClick: () => ch && moveObject(book, ref, { left: ch.spec.left, top: ch.spec.top, width: w, height: h }),
      })
      items.push(
        { label: 'Update Plot', onClick: () => ch && updateChart(book, ref.id, { ...ch.spec }, 'Update Plot') },
        '-',
        axisMenu('x'),
        axisMenu('y'),
        '-',
        { label: 'Pan Axes', disabled: true },
        { label: 'Add Trendline…', onClick: () => setDialog({ kind: 'trend', id: ref.id }) },
        { label: 'Annotations', submenu: [{ label: 'Add Text…', disabled: true }, { label: 'Add Arrow…', disabled: true }, { label: 'Add Line…', disabled: true }] },
        {
          label: 'Size',
          submenu: [
            size('Square (400×400)', 400, 400), size('Small (320×240)', 320, 240), size('Medium (480×320)', 480, 320), size('Large (640×480)', 640, 480),
            size('HD (960×540)', 960, 540), '-',
            size('Single column  (3.3″×2.5″ / 84×63 mm)', 330, 250), size('1.5 column  (5.0″×3.75″ / 127×95 mm)', 500, 375),
            size('Full width  (7.0″×5.25″ / 178×133 mm)', 700, 525), size('Full width short  (7.0″×4.0″ / 178×102 mm)', 700, 400),
            size('Nature single  (3.5″×2.6″ / 89×66 mm)', 350, 260), size('Nature double  (7.2″×5.4″ / 183×137 mm)', 720, 540),
            size('ACS single  (3.25″×2.5″ / 83×63 mm)', 325, 250), size('ACS double  (7.0″×4.0″ / 178×102 mm)', 700, 400),
            size('Square  (4.0″×4.0″ / 102×102 mm)', 400, 400),
          ],
        },
        {
          label: 'Export Image',
          submenu: [
            { label: 'Save as PNG…', onClick: () => void saveChartImage(ref.id, 'png') },
            { label: 'Save as PDF…', disabled: true },
            { label: 'Save as SVG…', onClick: () => void saveChartImage(ref.id, 'svg') },
          ],
        },
        '-',
        { label: 'Save as Plot Template…', disabled: true },
        { label: 'Apply Plot Template…', disabled: true },
        '-',
        { label: 'General Properties…', onClick: props },
        { label: 'Series Properties…', onClick: props },
        { label: 'Axis Properties…', onClick: props },
        { label: 'Edit Legend…', onClick: props },
        '-',
      )
    }
    if (ref.kind === 'equation') {
      const o = book.active.equations.find((x) => x.id === ref.id)
      items.push({ label: 'Edit Equation…', onClick: () => setDialog({ kind: 'equation', id: ref.id, initial: String(o?.d.latex ?? '') }) }, '-')
    }
    items.push({ label: 'Bring Forward', image: menuIcon('bring_forward'), onClick: () => restack(book, ref, true) }, { label: 'Send Backward', image: menuIcon('send_backward'), onClick: () => restack(book, ref, false) }, '-')
    items.push({ label: 'Delete', danger: true, onClick: () => removeObject(book, ref) })
    os.contextMenu(at, items)
  }
  /** Export Image ▸ Save as PNG… / SVG… (the chart as drawn; PNG at 2x). */
  const saveChartImage = async (id: string, kind: 'png' | 'svg') => {
    const ch = book.active.charts.find((c) => c.id === id)
    if (!ch?.url) return book.showFlash('The chart is not drawn yet.')
    const svg = await fetch(ch.url).then((r) => r.text())
    const base = (ch.spec.title || 'Chart').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Chart'
    const target = await os.dialog.saveFile({
      title: kind === 'png' ? 'Save Chart as PNG' : 'Save Chart as SVG',
      defaultName: `${path ? dirname(path) : '/home/user/Documents'}/${base}.${kind}`,
      extensions: [`.${kind}`],
    })
    if (!target) return
    if (kind === 'svg') await os.fs.writeText(target, svg, { mkdirs: true })
    else {
      const img = new Image()
      img.src = ch.url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(ch.spec.width * 2)
      canvas.height = Math.round(ch.spec.height * 2)
      const g = canvas.getContext('2d')
      if (!g) return
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.drawImage(img, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) return
      await os.fs.writeBytes(target, new Uint8Array(await blob.arrayBuffer()), { mkdirs: true })
    }
    book.showFlash(`Saved ${basename(target)}`)
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
    editNote: (r, c, kind) => editNote(kind ?? noteKind(book.active, r, c) ?? 'note', r, c),
    colWidth: () => void colWidth(),
    rowHeight: () => void rowHeight(),
    link: () => void link(),
    filterMenu: (col, at) => setDialog({ kind: 'filter', col, at }),
    editChart: (id) => setDialog({ kind: 'chart', id }),
    editEquation: (id) => {
      const o = book.active.equations.find((x) => x.id === id)
      setDialog({ kind: 'equation', id, initial: String(o?.d.latex ?? '') })
    },
    columnStats: columnStatistics,
    objectMenu,
  }

  // --------------------------------------------------------------- menus

  const menus = useMemo<MenuBarMenu[]>(() => {
    const recent = recentFiles()
    const recentItems: MenuItem[] = recent.length
      ? [
          ...recent.map((p): MenuItem => ({ label: basename(p), onClick: after(() => openPath(book, p)), disabled: !os.fs.isFile(p) })),
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
    const f = sh.formats.get(key(sh.sel.active.r, sh.sel.active.c))
    const desktopOnly = (label: string): MenuItem => ({ label, disabled: true })
    return [
      {
        label: 'File',
        items: [
          { label: 'New', shortcut: `${MOD}N`, onClick: after(() => newWorkbook(book)) },
          { label: 'New Window', shortcut: `${SHIFT}${MOD}N`, onClick: () => os.open('khervesheet') },
          '-',
          { label: 'Open…', shortcut: `${MOD}O`, onClick: after(() => openDialog(book)) },
          { label: 'Recent Files', submenu: recentItems },
          { label: 'Open File Location', disabled: !path, onClick: () => path && os.open('files', { path }) },
          '-',
          { label: 'Save', shortcut: `${MOD}S`, onClick: after(() => save(book)) },
          { label: 'Save As…', shortcut: `${SHIFT}${MOD}S`, onClick: after(() => saveAs(book)) },
          '-',
          { label: 'Import', submenu: [{ label: 'Text/CSV…', onClick: after(() => openDialog(book)) }, { label: 'Excel…', onClick: after(() => openDialog(book)) }] },
          { label: 'Export', submenu: [{ label: 'CSV…', onClick: after(() => exportAs(book, '.csv')) }, { label: 'Excel…', onClick: after(() => exportAs(book, '.xlsx')) }] },
          '-',
          { label: 'Print…', shortcut: `${MOD}P`, onClick: () => printSheet(book, view.gridlines) },
          '-',
          {
            label: 'Version Control',
            image: menuIcon('source_branch'),
            submenu: [desktopOnly('Version History…'), '-', desktopOnly('Push'), desktopOnly('Pull'), '-', desktopOnly('Configure Remote…')],
          },
          '-',
          { label: 'Exit', shortcut: `${MOD}Q`, onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: `${MOD}Z`, disabled: !canUndo, onClick: after(() => book.undo()) },
          { label: 'Redo', shortcut: `${MOD}Y`, disabled: !canRedo, onClick: after(() => book.redo()) },
          '-',
          { label: 'Cut', shortcut: `${MOD}X`, onClick: after(cut) },
          { label: 'Copy', shortcut: `${MOD}C`, onClick: after(copy) },
          { label: 'Paste', shortcut: `${MOD}V`, onClick: after(() => paste(false)) },
          { label: 'Paste Values Only', shortcut: `${SHIFT}${MOD}V`, onClick: after(() => paste(true)) },
          { label: 'Clear', shortcut: 'Del', onClick: after(() => clearContents(book)) },
          '-',
          { label: 'Preferences…', onClick: () => os.open('settings') },
          '-',
          // Web edition extras (shortcuts the desktop's grid also has).
          { label: 'Find…', shortcut: `${MOD}F`, onClick: () => setDialog({ kind: 'find', replace: false }) },
          { label: 'Replace…', shortcut: `${MOD}H`, onClick: () => setDialog({ kind: 'find', replace: true }) },
          { label: 'Fill Down', shortcut: `${MOD}D`, onClick: after(() => fillDownRight(book, true)) },
          { label: 'Fill Right', shortcut: `${MOD}R`, onClick: after(() => fillDownRight(book, false)) },
          { label: 'Select All', shortcut: `${MOD}A`, onClick: after(() => book.selectAll()) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Normal', checked: true, onClick: () => book.refocus() },
          { label: 'Page Layout', checked: false, disabled: true },
          '-',
          { label: 'Gridlines', checked: view.gridlines, onClick: after(() => book.setView({ gridlines: !view.gridlines })) },
          { label: 'Headings', checked: view.headings, onClick: after(() => book.setView({ headings: !view.headings })) },
          '-',
          { label: 'Zoom In', shortcut: `${MOD}=`, onClick: after(zoomIn) },
          { label: 'Zoom Out', shortcut: `${MOD}-`, onClick: after(zoomOut) },
          { label: 'Reset Zoom', shortcut: `${MOD}0`, onClick: after(() => zoomTo(100)) },
          '-',
          {
            label: 'Theme',
            submenu: [
              { label: 'Dark', checked: !light, onClick: () => setLight(false) },
              { label: 'Light (Emerald)', checked: light, onClick: () => setLight(true) },
            ],
          },
          '-',
          { label: 'Formulas', shortcut: `${MOD}\``, checked: view.formulas, onClick: after(() => book.setView({ formulas: !view.formulas })) },
          {
            label: 'Freeze Panes',
            submenu: [
              { label: 'Freeze at the Selected Cell', onClick: after(() => freezePanes(book, sh.sel.active.r, sh.sel.active.c)) },
              { label: 'Freeze Top Row', onClick: after(() => freezePanes(book, 1, 0)) },
              { label: 'Freeze First Column', onClick: after(() => freezePanes(book, 0, 1)) },
              { label: 'Unfreeze Panes', disabled: !fr[0] && !fr[1], onClick: after(() => freezePanes(book, 0, 0)) },
            ],
          },
        ],
      },
      {
        label: 'Insert',
        items: [
          { label: 'Row Above', onClick: after(() => insertRows(book)) },
          { label: 'Row Below', onClick: after(() => insertRows(book, true)) },
          { label: 'Column', onClick: after(() => insertCols(book)) },
          { label: 'Sheet', onClick: after(() => addSheet(book)) },
          '-',
          {
            label: 'Chart',
            submenu: [...CHART_TYPES.map((t): MenuItem => ({ label: t, image: menuIcon(PLOT_ICONS[t] ?? 'plot_line'), onClick: after(() => insertChart(book, t)) })), '-', desktopOnly('From Template…')],
          },
          { label: 'Image…', image: menuIcon('image'), onClick: after(() => insertImage(book)) },
          { label: 'Shapes', image: menuIcon('shapes'), submenu: [desktopOnly('Shapes are not in the web edition yet')] },
          { label: 'Equation', image: menuIcon('equation'), submenu: equationMenu(equation) },
          {
            label: 'Sparkline',
            image: menuIcon('sparkline'),
            submenu: [
              { label: 'Sparklines from Selection…', onClick: () => void sparklines() },
              { label: 'Single Sparkline…', onClick: () => void sparkline() },
              '-',
              { label: 'Remove Sparklines', onClick: unsparkle },
            ],
          },
          '-',
          { label: 'Function', submenu: functionMenu(book, (fn) => insertFunction(book, fn)) },
          { label: 'Python Cell', onClick: insertPython },
          '-',
          { label: 'Link', shortcut: `${MOD}K`, image: menuIcon('link'), onClick: () => void link() },
          { label: 'Comment', shortcut: `${MOD}Alt+M`, image: menuIcon('comment'), onClick: () => editNote('comment') },
          { label: 'Note', shortcut: `${SHIFT}F2`, image: menuIcon('note'), onClick: () => editNote('note') },
          '-',
          { label: 'Checkbox', image: menuIcon('checkbox'), onClick: after(() => insertCheckboxes(book)) },
          { label: 'Button…', image: menuIcon('checkbox'), disabled: true },
          { label: 'Dropdown…', image: menuIcon('dropdown'), onClick: () => setDialog({ kind: 'dropdown', initial: dropdownOf(sh, sh.sel.active.r, sh.sel.active.c) ?? [] }) },
          '-',
          { label: 'Pivot / Transpose', onClick: after(() => transposeSelection(book)) },
        ],
      },
      {
        label: 'Format',
        items: [
          { label: 'Format Cells…', shortcut: `${MOD}1`, onClick: () => setDialog({ kind: 'format' }) },
          '-',
          { label: 'Number Format', submenu: DESKTOP_NUMBER_FORMATS.map((n) => ({ label: n, checked: (f?.number_format ?? 'General') === n, onClick: after(() => setNumberFormat(book, n)) })) },
          '-',
          { label: 'Fill Color…', onClick: () => setColorPick('fill') },
          { label: 'Font Color…', onClick: () => setColorPick('ink') },
          { label: 'Borders', submenu: borderMenu(book) },
          '-',
          { label: 'Column Width…', onClick: () => void colWidth() },
          { label: 'Row Height…', onClick: () => void rowHeight() },
          '-',
          { label: 'Merge Cells', image: menuIcon('merge_cells'), onClick: after(() => mergeCells(book)) },
          { label: 'Unmerge Cells', image: menuIcon('unmerge_cells'), onClick: after(() => unmergeCells(book)) },
          { label: 'Wrap Text', image: menuIcon('wrap'), checked: !!f?.wrap_text, onClick: after(() => toggleFlag(book, 'wrap_text', 'Wrap Text')) },
          '-',
          { label: 'Table Design', image: menuIcon('table_large'), onClick: () => (rootRef.current?.querySelector('[aria-label="Table Design"]') as HTMLButtonElement | null)?.click() },
          '-',
          { label: 'Bring Forward', image: menuIcon('bring_forward'), disabled: !object, onClick: () => object && restack(book, object, true) },
          { label: 'Send Backward', image: menuIcon('send_backward'), disabled: !object, onClick: () => object && restack(book, object, false) },
          '-',
          { label: 'AutoFit Column Width', onClick: after(() => autoFitCols(book, selectedCols(book), fontFor)) },
          { label: 'Clear Formats', onClick: after(() => clearFormats(book)) },
        ],
      },
      {
        label: 'Formulas',
        items: [
          { label: 'AutoSum', shortcut: 'Alt+Shift+=', onClick: () => autoSum(book) },
          '-',
          ...functionMenu(book, (fn) => insertFunction(book, fn)),
          '-',
          { label: 'Insert Function…', shortcut: `${SHIFT}F3`, onClick: () => openFunctionMenu() },
        ],
      },
      {
        label: 'Data',
        items: [
          { label: 'Sort A → Z', onClick: after(() => quickSort(book, true)) },
          { label: 'Sort Z → A', onClick: after(() => quickSort(book, false)) },
          '-',
          {
            label: 'Set Column As',
            submenu: [
              { label: 'X', onClick: after(() => setDesignation(book, 'X')) },
              { label: 'Y', onClick: after(() => setDesignation(book, 'Y')) },
            ],
          },
          '-',
          // Web edition extras.
          { label: 'Sort…', onClick: () => setDialog({ kind: 'sort', range: dataRange(book) }) },
          { label: 'Filter', checked: !!sh.filter, shortcut: `${SHIFT}${MOD}L`, onClick: after(() => toggleFilter(book)) },
          { label: 'Calculate Now', shortcut: 'F9', onClick: after(() => book.recalc(true)) },
          { label: pyPending ? `Run Python Cells (${pyPending})` : 'Run Python Cells', disabled: !pyPending, onClick: after(() => book.trustPython()) },
          { label: 'Python Loops', checked: loops, disabled: !book.hasLoops(), onClick: () => book.setLoops(!loops) },
        ],
      },
      {
        label: 'Science',
        items: SCIENCE_TOOLS.map((t): MenuItem => (t ? { label: t, onClick: () => science(t) } : '-')),
      },
      {
        label: 'Tools',
        items: [
          { label: 'Spelling…', shortcut: 'F7', disabled: true },
          { label: 'Check Spelling as You Type', checked: false, disabled: true },
          '-',
          { label: 'Statistics on Selection', onClick: statistics },
          '-',
          { label: 'Curve Fitting…', onClick: curveFitting },
          { label: 'Solver…', onClick: () => setDialog({ kind: 'solver' }) },
          '-',
          { label: 'Trendline…', disabled: !chartId, onClick: () => chartId && setDialog({ kind: 'trend', id: chartId }) },
          { label: 'Restart Python', onClick: after(() => book.bridge.kernel.restart()) },
        ],
      },
      {
        label: 'AI',
        items: [
          { label: 'Connect to Claude (Simple)…', image: menuIcon('lan_connect'), onClick: aiChat },
          { label: 'ChatBox (KherveAI)', shortcut: `${SHIFT}${MOD}A`, image: menuIcon('robot'), onClick: aiChat },
        ],
      },
      { label: 'Examples', items: exampleItems },
      {
        label: 'Help',
        items: [
          { label: 'User Guide', shortcut: 'F1', onClick: () => void os.dialog.alert(<UserGuide />, { title: 'KherveSheet — User Guide' }).finally(() => book.refocus()) },
          { label: 'Python in KherveSheet', onClick: () => showPythonHelp(book) },
          { label: 'Keyboard Shortcuts', onClick: () => void os.dialog.alert(<div className="ks-doc"><Shortcuts /></div>, { title: 'KherveSheet shortcuts' }).finally(() => book.refocus()) },
          '-',
          { label: 'Check for Updates…', disabled: true },
          '-',
          { label: 'About', onClick: () => void os.dialog.alert(<About core={CORE_SOURCE} python={null} />, { title: 'About KherveSheet' }).finally(() => book.refocus()) },
          { label: 'GitHub Repository', onClick: () => os.openUrl(GITHUB_URL) },
        ],
      },
    ]
    // `version` refreshes notes, filters and freeze in the menus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, win, examples, canUndo, canRedo, view, sh, pyPending, loops, object, path, version, sel, ready, light])

  useEffect(() => {
    win.setMenus(menus)
  }, [win, menus])
  useEffect(() => () => win.setMenus(null), [win])

  function setLight(on: boolean) {
    const s = useSettings.getState()
    const others = s.lightApps.filter((a) => a !== 'khervesheet')
    s.set({ lightApps: on ? [...others, 'khervesheet'] : others })
  }
  function openFunctionMenu() {
    setDialog({ kind: 'insfn' })
  }

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
    if (k === 'F2' && e.shiftKey) return run(() => editNote('note'))
    if (k === 'F3' && e.shiftKey) {
      e.preventDefault()
      return openFunctionMenu()
    }
    if (mod && e.altKey && (e.code === 'KeyM' || k === 'm')) return run(() => editNote('comment'))
    if (e.altKey && e.shiftKey && (k === '=' || e.code === 'Equal') && !book.state.edit) return run(() => autoSum(book))
    if (!mod || e.altKey) return
    if (book.state.edit) return
    if (e.shiftKey) {
      const shifted: Record<string, () => unknown> = {
        s: () => saveAs(book),
        n: () => os.open('khervesheet'),
        z: () => book.redo(),
        v: () => paste(true),
        l: () => toggleFilter(book),
        a: () => aiChat(),
      }
      if (shifted[k]) return run(shifted[k])
      return
    }
    const plain: Record<string, () => unknown> = {
      s: () => save(book),
      o: () => openDialog(book),
      n: () => newWorkbook(book),
      p: () => printSheet(book, view.gridlines),
      q: () => win.close(),
      z: () => book.undo(),
      y: () => book.redo(),
      f: () => setDialog({ kind: 'find', replace: false }),
      h: () => setDialog({ kind: 'find', replace: true }),
      k: () => link(),
      '=': zoomIn,
      '+': zoomIn,
      '-': zoomOut,
      '0': () => zoomTo(100),
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
  const message =
    loading ??
    progress ??
    flash ??
    (status === 'starting' ? 'Starting Python (the first time downloads it)…' : !ready && status !== 'dead' ? 'Loading the spreadsheet engine…' : status === 'dead' ? 'Python stopped (Tools ▸ Restart Python)' : busy ? 'Computing…' : picking ? 'Click a cell to insert its ks("…") reference' : 'Ready')
  const spinning = !!loading || !!progress || status === 'starting' || (!ready && status !== 'dead') || (busy > 0 && message === 'Computing…')
  const pct = Math.round(view.zoom * 100)

  return (
    <BookContext.Provider value={book}>
      <RootContext.Provider value={rootRef}>
        <div className={`k-app ks-app${picking ? ' picking' : ''}`} ref={rootRef} onKeyDown={onKeyDown} onDragOver={onDragOver} onDrop={onDrop}>
          <Toolbar
            book={book}
            root={rootRef.current}
            actions={{
              newBook: after(() => newWorkbook(book)),
              open: after(() => openDialog(book)),
              save: after(() => save(book)),
              print: () => printSheet(book, view.gridlines),
              solver: () => setDialog({ kind: 'solver' }),
              fitting: curveFitting,
              science,
              aiChat,
              image: after(() => insertImage(book)),
              equation,
              comment: () => editNote('comment'),
              note: () => editNote('note'),
              dropdown: () => setDialog({ kind: 'dropdown', initial: dropdownOf(sh, sh.sel.active.r, sh.sel.active.c) ?? [] }),
              checkbox: after(() => insertCheckboxes(book)),
              sparklines: () => void sparklines(),
              sparkline: () => void sparkline(),
              removeSparklines: unsparkle,
            }}
          />
          <FormulaBar book={book} onPopOut={openPopOut} onInsertFunction={openFunctionMenu} />
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
            <span className="ks-sb-msg" title={path ?? undefined}>
              {message && spinning && <LoaderCircle size={12} className="k-spin" />}
              {message}
            </span>
            {stats && stats.count > 0 && (
              <span className="ks-sb-stats">
                Average: {statText(stats.avg)}   Count: {stats.count}   Sum: {statText(stats.sum)}
              </span>
            )}
            <span className="ks-sb-zoom">
              <button title="Zoom out" aria-label="Zoom out" onClick={zoomOut}>−</button>
              <input type="range" min={25} max={200} value={pct} aria-label="Zoom" onChange={(e) => zoomTo(Number(e.target.value))} />
              <span className="ks-sb-pct">{pct}%</span>
              <button title="Zoom in" aria-label="Zoom in" onClick={zoomIn}>+</button>
            </span>
          </div>

          {dialog?.kind === 'format' && <FormatCellsDialog book={book} onClose={closeDialog} />}
          {dialog?.kind === 'insfn' && <InsertFunctionDialog book={book} onClose={() => setDialog(null)} />}
          {dialog?.kind === 'chart' && <ChartDialog book={book} id={dialog.id} onClose={closeDialog} />}
          {dialog?.kind === 'trend' && <TrendlineDialog book={book} id={dialog.id} onClose={closeDialog} />}
          {dialog?.kind === 'solver' && <SolverDialog book={book} onClose={closeDialog} />}
          {dialog?.kind === 'sort' && <SortDialog book={book} range={dialog.range} onClose={closeDialog} />}
          {dialog?.kind === 'find' && <FindDialog book={book} replace={dialog.replace} onClose={closeDialog} />}
          {dialog?.kind === 'science' && <ScienceDialog key={dialog.tool} book={book} tool={dialog.tool} root={rootRef.current} onClose={closeDialog} />}
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
              title={dialog.note === 'comment' ? 'Edit Comment' : 'Edit Note'}
              label={`${dialog.note === 'comment' ? 'Comment' : 'Note'} for ${a1(dialog.r, dialog.c)}:`}
              initial={dialog.initial}
              multiline
              removable={!!dialog.initial}
              onDone={(text) => setNote(book, dialog.r, dialog.c, text && text.trim() ? text : null, dialog.note)}
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
                const fl = book.active.filter
                if (fl) void sortRange(book, fl.range, dialog.col, asc, true).then(() => toggleRefilter())
                closeDialog()
              }}
            />
          )}
          {colorPick && rootRef.current && (
            <ColorPopover
              root={rootRef.current}
              at={(rootRef.current.querySelector('.ks-fbar') ?? rootRef.current).getBoundingClientRect()}
              allowNone
              noneLabel={colorPick === 'fill' ? 'No Fill' : 'Automatic'}
              onPick={(c) => {
                if (colorPick === 'fill') void formatCellsColor('bg', c)
                else void formatCellsColor('font_color', c)
                book.refocus()
              }}
              onClose={() => setColorPick(null)}
            />
          )}
          {pyDialog && (
            <PythonCellDialog
              key={`${pyDialog.sheet}:${pyDialog.r},${pyDialog.c}`}
              book={book}
              target={pyDialog}
              root={rootRef.current}
              onClose={() => {
                setPyDialog(null)
                book.refocus()
              }}
            />
          )}
        </div>
      </RootContext.Provider>
    </BookContext.Provider>
  )

  function formatCellsColor(field: 'bg' | 'font_color', c: string | null) {
    return formatCells(book, { [field]: c ?? undefined }, field === 'bg' ? 'Fill Colour' : 'Font Colour')
  }
}
