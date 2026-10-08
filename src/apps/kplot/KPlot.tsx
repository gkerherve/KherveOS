// kPlot — publication-quality plots from a table. Two engines draw the same figure: the
// interactive one (Plotly: zoom, pan, hover) and the publication one (our own SVG), which is also
// what "Export SVG" saves. The data is an editable grid; the whole plot (data and options) is a
// .kplot project file. Images: SVG, PNG at 1×/2×/4×, Plotly SVG, or the clipboard.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Clipboard, Download, FolderOpen, LineChart, Redo2, Save, Undo2 } from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import DataPanel from './DataPanel'
import Inspector from './Inspector'
import PlotlyView, { type PlotlyHandle } from './PlotlyView'
import { blobBytes, copyImage, plotlyImage, svgToPng } from './exporters'
import {
  SAMPLE, buildFigure, cloneTable, optionsAfterRemove, parseProject, parseTable, serializeProject, withNewData, withTable, type Table,
} from './data'
import {
  PLOT_TYPES, SIZE_PRESETS, defaultOptions, isPlotlyOnly, type ChartType, type Engine, type FigureInput, type LegendPos, type Options, type PaletteName, type ScaleKind, type SizePreset, type ThemeName,
} from './figure'
import { plotSvg } from './plot'
import { plotlySize, toPlotly } from './plotly'
import { kplotTools } from './aiTools'
import './kplot.css'

export const PLOT_DIR = `${HOME}/Documents/kPlot`
const DATA_EXT = ['.csv', '.tsv', '.txt', '.dat']
const RECENT_KEY = 'kplot.recent'

interface Doc {
  table: Table
  opt: Options
}

function newDoc(): Doc {
  const table = parseTable(SAMPLE)
  return { table, opt: withNewData(defaultOptions(), table) }
}

function recentList(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}
function remember(p: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([p, ...recentList().filter((q) => q !== p)].slice(0, 8)))
  } catch { /* private window: no recent list */ }
}

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim()

export default function KPlot({ win, args }: AppProps) {
  const [doc, setDoc] = useState<Doc>(() => {
    if (typeof args.text === 'string' && args.text.trim()) {
      const table = parseTable(args.text)
      return { table, opt: withNewData(defaultOptions(), table) }
    }
    return newDoc()
  })
  const docRef = useRef(doc)
  docRef.current = doc
  const hist = useRef<{ past: Doc[]; future: Doc[]; key: string; at: number }>({ past: [], future: [], key: '', at: 0 })
  const [, bump] = useState(0)
  const [name, setName] = useState<string | null>(typeof args.name === 'string' ? args.name : null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const [status, setStatusText] = useState('')
  const statusTimer = useRef<number | undefined>(undefined)
  const [plotlyError, setPlotlyError] = useState<string | null>(null)
  const handle = useRef<PlotlyHandle>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 600, h: 400 })

  const { table, opt } = doc
  const setStatus = useCallback((m: string) => {
    setStatusText(m)
    window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatusText(''), 6000)
  }, [])

  // ------------------------------------------------------------ the document and its history

  const commit = useCallback((next: Doc, key?: string) => {
    const cur = docRef.current
    if (next === cur) return
    const h = hist.current
    const now = Date.now()
    if (!(key && key === h.key && now - h.at < 1200)) {
      h.past.push(cur)
      if (h.past.length > 100) h.past.shift()
    }
    h.key = key ?? ''
    h.at = now
    h.future = []
    docRef.current = next
    setDoc(next)
    setDirty(true)
  }, [])

  const setTable = useCallback((t: Table, key?: string) => commit({ table: t, opt: withTable(docRef.current.opt, t) }, key), [commit])
  const setOpt = useCallback((fn: (o: Options) => Options, key?: string) => commit({ table: docRef.current.table, opt: fn(docRef.current.opt) }, key), [commit])
  const removeColumn = useCallback((i: number) => {
    const cur = docRef.current
    const t = cloneTable(cur.table)
    t.headers.splice(i, 1)
    t.rows.forEach((r) => r.splice(i, 1))
    commit({ table: t, opt: withTable(optionsAfterRemove(cur.opt, i), t) })
  }, [commit])

  const undo = useCallback(() => {
    const h = hist.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push(docRef.current)
    h.key = ''
    docRef.current = prev
    setDoc(prev)
    setDirty(true)
    bump((n) => n + 1)
  }, [])
  const redo = useCallback(() => {
    const h = hist.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(docRef.current)
    h.key = ''
    docRef.current = next
    setDoc(next)
    setDirty(true)
    bump((n) => n + 1)
  }, [])

  /** Replace everything (a new file): history starts again. */
  const replace = useCallback((d: Doc, title: string | null, project: string | null) => {
    hist.current = { past: [], future: [], key: '', at: 0 }
    docRef.current = d
    setDoc(d)
    setName(title)
    setProjectPath(project)
    setDirty(false)
    setPlotlyError(null)
    bump((n) => n + 1)
  }, [])

  // ------------------------------------------------------------ the figure

  const fig: FigureInput = useMemo(() => buildFigure(table, opt), [table, opt])
  const size = useMemo(() => plotlySize(fig), [fig])
  const wantsPlotly = opt.engine === 'plotly' && !plotlyError
  const plotlyOnly = isPlotlyOnly(opt.type)
  const scale = Math.min(3, Math.max(0.3, Math.min((box.w - 8) / size.width, (box.h - 8) / size.height)))
  const previewFig = useMemo(() => (wantsPlotly ? toPlotly({ ...fig, fontSize: (fig.fontSize ?? opt.fontSize) * scale }) : null), [wantsPlotly, fig, scale, opt.fontSize])
  const svg = useMemo(() => (wantsPlotly ? '' : plotSvg(fig)), [wantsPlotly, fig])
  const empty = opt.series.length === 0 && !['heatmap', 'contour', 'surface'].includes(opt.type)

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    win.setTitle(`kPlot${name ? ` — ${name}` : ''}${dirty ? ' •' : ''}`)
  }, [win, name, dirty])

  // ------------------------------------------------------------ files

  const loadText = useCallback((text: string, title: string | null) => {
    const t = parseTable(text)
    replace({ table: t, opt: withNewData(docRef.current.opt, t) }, title, null)
    setDirty(false)
  }, [replace])

  const loadProject = useCallback(async (p: string) => {
    try {
      const { table: t, options } = parseProject(await fs.readText(p))
      replace({ table: t, opt: withTable(options, t) }, path.basename(p), p)
      win.setDocumentPath(p)
      remember(p)
      bump((n) => n + 1)
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Open project' })
    }
  }, [replace, win])

  const loadPath = useCallback(async (p: string) => {
    if (p.toLowerCase().endsWith('.kplot')) return loadProject(p)
    try {
      loadText(await fs.readText(p), path.basename(p))
    } catch (e) {
      await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Open data' })
    }
  }, [loadProject, loadText])

  useEffect(() => {
    if (typeof args.path === 'string' && args.path) void loadPath(args.path)
    // opened once, with the arguments the window was made with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveRef = useRef<() => Promise<boolean>>(async () => false)
  /** Ask about unsaved work; false when the user cancels. */
  const settle = useCallback(async (): Promise<boolean> => {
    if (!dirtyRef.current) return true
    const c = await os.dialog.choose('Save the changes to this plot before closing it?', [
      { label: 'Save', value: 'save', primary: true },
      { label: "Don't save", value: 'discard' },
      { label: 'Cancel', value: 'cancel' },
    ], { title: 'kPlot' })
    if (c === 'save') return saveRef.current()
    return c === 'discard'
  }, [])

  useEffect(() => {
    win.setCloseGuard(() => settle())
    return () => win.setCloseGuard(null)
  }, [win, settle])

  const newPlot = async () => {
    if (!(await settle())) return
    replace(newDoc(), null, null)
    win.setDocumentPath(null)
  }

  const openData = async () => {
    const p = await os.dialog.openFile({ title: 'Open data', extensions: DATA_EXT })
    if (p) await loadPath(p)
  }

  const openProject = async (p?: string) => {
    const target = p ?? (await os.dialog.openFile({ title: 'Open plot project', extensions: ['.kplot'], startDir: fs.isDir(PLOT_DIR) ? PLOT_DIR : undefined }))
    if (target) await loadProject(target)
  }

  async function saveProject(asNew = false): Promise<boolean> {
    let target = projectPath
    if (!target || asNew || !fs.exists(path.dirname(target))) {
      await fs.mkdir(PLOT_DIR, { recursive: true })
      target = await os.dialog.saveFile({ title: 'Save plot project', defaultName: `${PLOT_DIR}/${fileSafe(docRef.current.opt.title || name?.replace(/\.[^.]+$/, '') || 'plot')}.kplot`, extensions: ['.kplot'] })
    }
    if (!target) return false
    await fs.writeText(target, serializeProject(docRef.current.table, docRef.current.opt))
    setProjectPath(target)
    setName(path.basename(target))
    setDirty(false)
    win.setDocumentPath(target)
    remember(target)
    setStatus(`Saved ${path.pretty(target)}`)
    return true
  }

  saveRef.current = () => saveProject()

  // ------------------------------------------------------------ images

  const baseName = () => fileSafe(opt.title || (name ?? '').replace(/\.[^.]+$/, '') || 'plot') || 'plot'

  const writeOut = async (data: string | Uint8Array, ext: string, wanted?: string): Promise<string> => {
    await fs.mkdir(PLOT_DIR, { recursive: true })
    const base = fileSafe(wanted ?? baseName()) || 'plot'
    const p = `${PLOT_DIR}/${fs.uniqueName(PLOT_DIR, `${base}${ext}`)}`
    if (typeof data === 'string') await fs.writeText(p, data)
    else await fs.writeBytes(p, data)
    setStatus(`Saved ${path.pretty(p)}`)
    return p
  }

  /** The figure as SVG text: ours (publication) or Plotly's. */
  const makeSvg = async (kind: 'publication' | 'plotly' = 'publication'): Promise<string> => {
    if (kind === 'plotly' || isPlotlyOnly(docRef.current.opt.type)) return (await plotlyImage(fig, 'svg', 1, handle.current?.ranges())).text()
    return plotSvg(fig)
  }

  /** The figure as a PNG, `scale` × (1 = 96 dpi) from the engine in use. */
  const makePng = async (scale2: number, engine: Engine = opt.engine): Promise<Blob> => {
    if ((engine === 'plotly' && !plotlyError) || isPlotlyOnly(docRef.current.opt.type)) return plotlyImage(fig, 'png', scale2, handle.current?.ranges())
    return svgToPng(plotSvg(fig), size.width, size.height, scale2)
  }

  const run = async <T,>(what: string, job: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await job()
    } catch (e) {
      setStatus(`${what} failed: ${e instanceof Error ? e.message : String(e)}`)
      return undefined
    }
  }

  const exportSvg = (kind: 'publication' | 'plotly' = 'publication') => run('Export', async () => {
    const p = await writeOut(await makeSvg(kind), '.svg')
    os.notify({ title: 'Plot saved', body: path.pretty(p), icon: LineChart, onClick: () => os.openFile(p) })
    return p
  })
  const exportPng = (scale2: number) => run('Export', async () => {
    const p = await writeOut(await blobBytes(await makePng(scale2)), scale2 === 1 ? '.png' : `@${scale2}x.png`)
    os.notify({ title: 'Plot saved', body: path.pretty(p), icon: LineChart, onClick: () => os.openFile(p) })
    return p
  })
  const copyPlot = () => run('Copy', async () => {
    await copyImage(await makePng(2))
    setStatus('Copied the image to the clipboard')
  })

  const pasteData = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) { setStatus('The clipboard has no text'); return }
      loadText(text, null)
      setDirty(true)
    } catch {
      setStatus('The browser did not allow reading the clipboard')
    }
  }

  // ------------------------------------------------------------ AI tools

  useAppTools(win, kplotTools({
    setData: (text) => {
      const t = parseTable(text)
      commit({ table: t, opt: withNewData(docRef.current.opt, t) })
      return { rows: t.rows.length, columns: t.headers }
    },
    table: () => docRef.current.table,
    options: () => docRef.current.opt,
    setOptions: (fn) => setOpt(fn),
    saveSvg: async (wanted) => writeOut(await makeSvg(), '.svg', wanted),
    exportImage: async (format, scale2, wanted, engine) => {
      if (format === 'clipboard') { await copyImage(await makePng(2, engine)); return { copied: true } }
      if (format === 'svg') return { path: await writeOut(await makeSvg('publication'), '.svg', wanted) }
      if (format === 'plotly_svg') return { path: await writeOut(await makeSvg('plotly'), '.svg', wanted) }
      return { path: await writeOut(await blobBytes(await makePng(scale2, engine)), scale2 === 1 ? '.png' : `@${scale2}x.png`, wanted) }
    },
    svgText: () => plotSvg(fig),
  }))

  // ------------------------------------------------------------ menus

  const [recents, setRecents] = useState<string[]>(recentList)
  useEffect(() => setRecents(recentList()), [projectPath])

  const menus = useMemo<MenuBarMenu[]>(() => {
    const radio = <T extends string>(items: [T, string][], current: T, set: (v: T) => void) =>
      items.map(([v, label]) => ({ label, checked: current === v, onClick: () => set(v) }))
    const patch = (p: Partial<Options>) => setOpt((o) => ({ ...o, ...p }))
    const scaleMenu = (label: string, which: 'x' | 'y') => ({
      label,
      submenu: radio<ScaleKind>([['linear', 'Linear'], ['log10', 'Log10'], ['ln', 'ln']], opt[which].scale, (v) => setOpt((o) => ({ ...o, [which]: { ...o[which], scale: v } }))),
    })
    const types = PLOT_TYPES.map(([v, label]) => ({ label, checked: opt.type === v, onClick: () => patch({ type: v, ...(isPlotlyOnly(v) ? { engine: 'plotly' as Engine } : {}) }) }))
    return [
      {
        label: 'File',
        items: [
          { label: 'New', shortcut: 'Ctrl+N', onClick: () => void newPlot() },
          { label: 'Open Data…', shortcut: 'Ctrl+Shift+O', onClick: () => void openData() },
          { label: 'Open Project…', shortcut: 'Ctrl+O', onClick: () => void openProject() },
          {
            label: 'Open Recent',
            disabled: recents.length === 0,
            submenu: recents.map((p) => ({ label: path.basename(p), onClick: () => void openProject(p) })),
          },
          '-',
          { label: 'Save Project', shortcut: 'Ctrl+S', onClick: () => void saveProject() },
          { label: 'Save Project As…', shortcut: 'Ctrl+Shift+S', onClick: () => void saveProject(true) },
          '-',
          { label: 'Export SVG', shortcut: 'Ctrl+E', disabled: empty, onClick: () => void exportSvg() },
          { label: 'Export PNG', disabled: empty, submenu: [1, 2, 4].map((s) => ({ label: `${s}×  (${size.width * s} × ${size.height * s} px)`, onClick: () => void exportPng(s) })) },
          { label: 'Export Plotly SVG', disabled: empty, onClick: () => void exportSvg('plotly') },
          { label: 'Copy Image', shortcut: 'Ctrl+Shift+C', disabled: empty, onClick: () => void copyPlot() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: 'Ctrl+Z', disabled: hist.current.past.length === 0, onClick: undo },
          { label: 'Redo', shortcut: 'Ctrl+Shift+Z', disabled: hist.current.future.length === 0, onClick: redo },
          '-',
          { label: 'Paste Data from Clipboard', onClick: () => void pasteData() },
          { label: 'Drop Empty Rows', onClick: () => setTable({ headers: table.headers, rows: table.rows.filter((r) => r.some((c) => c.trim() !== '')) }) },
        ],
      },
      {
        label: 'Plot',
        items: [
          { label: 'Type', submenu: types },
          { label: 'Engine', submenu: radio<Engine>([['plotly', 'Interactive (Plotly)'], ['svg', 'Publication (SVG)']], opt.engine, (v) => { setPlotlyError(null); patch({ engine: v }) }) },
          '-',
          scaleMenu('x Scale', 'x'),
          scaleMenu('y Scale', 'y'),
          { label: 'Reverse x Axis', checked: opt.x.invert, onClick: () => setOpt((o) => ({ ...o, x: { ...o.x, invert: !o.x.invert } })) },
          { label: 'Grid', checked: opt.x.grid && opt.y.grid, onClick: () => { const on = !(opt.x.grid && opt.y.grid); setOpt((o) => ({ ...o, x: { ...o.x, grid: on }, y: { ...o.y, grid: on } })) } },
          '-',
          {
            label: 'Legend',
            submenu: radio<LegendPos>(
              [['auto', 'Automatic'], ['top-right', 'Inside, top right'], ['top-left', 'Inside, top left'], ['bottom-right', 'Inside, bottom right'], ['bottom-left', 'Inside, bottom left'], ['outside-right', 'Outside, right'], ['outside-top', 'Outside, top'], ['none', 'None']],
              opt.legend, (v) => patch({ legend: v }),
            ),
          },
          { label: 'Colours', submenu: radio<PaletteName>([['publication', 'Publication'], ['okabe-ito', 'Colour-blind safe'], ['greyscale', 'Greyscale'], ['kherve-green', 'Kherve Green']], opt.palette, (v) => patch({ palette: v })) },
          { label: 'Theme', submenu: radio<ThemeName>([['white', 'White (publication)'], ['dark', 'Dark'], ['transparent', 'Transparent']], opt.theme, (v) => patch({ theme: v })) },
          {
            label: 'Figure Size',
            submenu: [
              ...Object.entries(SIZE_PRESETS).map(([k, v]) => ({
                label: v.label, checked: opt.sizePreset === k,
                onClick: () => patch({ sizePreset: k as SizePreset, width: v.w, height: v.h, fontSize: v.font }),
              })),
            ],
          },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Reset Zoom', disabled: !wantsPlotly, onClick: () => handle.current?.reset() },
          '-',
          { label: 'Interactive (Plotly)', checked: opt.engine === 'plotly', onClick: () => { setPlotlyError(null); patch({ engine: 'plotly' }) } },
          { label: 'Publication (SVG)', checked: opt.engine === 'svg', onClick: () => patch({ engine: 'svg' }) },
        ],
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opt, table, recents, empty, size, wantsPlotly, doc])

  useEffect(() => {
    win.setMenus(menus)
  }, [menus, win])
  useEffect(() => () => win.setMenus(null), [win])

  const exportMenu = (e: React.MouseEvent) => {
    os.contextMenu(e, [
      { label: 'SVG (publication)', disabled: empty, onClick: () => void exportSvg() },
      ...[1, 2, 4].map((s) => ({ label: `PNG ${s}×  (${size.width * s} × ${size.height * s} px)`, disabled: empty, onClick: () => void exportPng(s) })),
      { label: 'SVG from Plotly', disabled: empty, onClick: () => void exportSvg('plotly') },
      '-',
      { label: 'Copy image', disabled: empty, onClick: () => void copyPlot() },
    ])
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    const k = e.key.toLowerCase()
    const t = e.target as HTMLElement
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable
    if (k === 's') { e.preventDefault(); void saveProject(e.shiftKey) }
    else if (k === 'o') { e.preventDefault(); if (e.shiftKey) void openData(); else void openProject() }
    else if (k === 'n') { e.preventDefault(); void newPlot() }
    else if (k === 'e') { e.preventDefault(); void exportSvg() }
    else if (k === 'c' && e.shiftKey) { e.preventDefault(); void copyPlot() }
    else if (k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
  }

  // ------------------------------------------------------------ render

  const type = opt.type
  return (
    <div className="k-app kp-app" onKeyDown={onKeyDown}>
      <div className="k-toolbar kp-toolbar">
        <select
          className="k-input kp-in kp-type"
          value={type}
          aria-label="Plot type"
          title="Plot type"
          onChange={(e) => {
            const v = e.target.value as ChartType
            setOpt((o) => ({ ...o, type: v, ...(isPlotlyOnly(v) ? { engine: 'plotly' as Engine } : {}) }))
            if (isPlotlyOnly(v)) setPlotlyError(null)
          }}
        >
          {PLOT_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <div className="kp-seg" role="group" aria-label="Engine">
          <button className={opt.engine === 'plotly' ? 'active' : ''} onClick={() => { setPlotlyError(null); setOpt((o) => ({ ...o, engine: 'plotly' })) }} title="Zoom, pan and hover with Plotly">Interactive</button>
          <button className={opt.engine === 'svg' ? 'active' : ''} onClick={() => setOpt((o) => ({ ...o, engine: 'svg' }))} title="The publication figure: what Export SVG saves">Publication</button>
        </div>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Open data (Ctrl+Shift+O)" aria-label="Open data" onClick={() => void openData()}><FolderOpen size={15} /></button>
        <button className="k-icon-btn" title="Save project (Ctrl+S)" aria-label="Save project" onClick={() => void saveProject()}><Save size={15} /></button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={hist.current.past.length === 0} onClick={undo}><Undo2 size={15} /></button>
        <button className="k-icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={hist.current.future.length === 0} onClick={redo}><Redo2 size={15} /></button>
        <span className="k-spacer" />
        {wantsPlotly && <button className="k-btn" title="Back to the automatic axis ranges" onClick={() => handle.current?.reset()}>Reset zoom</button>}
        <button className="k-btn" title="Copy the image to the clipboard (Ctrl+Shift+C)" disabled={empty} onClick={() => void copyPlot()}><Clipboard size={13} /> Copy</button>
        <button className="k-btn" title="Export an image" disabled={empty} onClick={exportMenu}><Download size={13} /> Export</button>
      </div>

      <div className="kp-body">
        <aside className="kp-left">
          <DataPanel
            table={table}
            xi={opt.xi}
            onChange={setTable}
            onRemoveColumn={removeColumn}
            onSetX={(i) => setOpt((o) => ({ ...o, xi: i, series: o.series.filter((s) => s.col !== i) }))}
            onStatus={setStatus}
          />
        </aside>

        <section className="kp-center">
          {plotlyError && opt.engine === 'plotly' && (
            <div className="kp-banner">The interactive view could not be loaded ({plotlyError}). Showing the publication view.</div>
          )}
          {!wantsPlotly && plotlyOnly && !plotlyError && (
            <div className="kp-banner">This chart type is drawn by the interactive engine only; the publication view shows a scatter plot instead.</div>
          )}
          <div className="kp-stage" ref={stage}>
            {empty ? (
              <div className="k-muted kp-emptyplot"><LineChart size={18} /> Add at least one column to plot (Plot tab, Series).</div>
            ) : wantsPlotly && previewFig ? (
              <PlotlyView
                ref={handle}
                figure={previewFig}
                width={Math.round(size.width * scale)}
                height={Math.round(size.height * scale)}
                onFail={(m) => setPlotlyError(m)}
              />
            ) : (
              <div className="kp-svg" style={{ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }} dangerouslySetInnerHTML={{ __html: svg }} />
            )}
          </div>
        </section>

        <aside className="kp-right">
          <Inspector opt={opt} table={table} setOpt={setOpt} />
        </aside>
      </div>

      <div className="k-statusbar">
        <span>{table.rows.length} rows × {table.headers.length} columns</span>
        <span>{opt.series.filter((s) => !s.hidden).length} series</span>
        <span>{wantsPlotly ? 'Interactive' : 'Publication'} · {Math.round(opt.width)} × {Math.round(opt.height)} mm</span>
        {status && <span className="kp-status">{status}</span>}
      </div>
    </div>
  )
}
