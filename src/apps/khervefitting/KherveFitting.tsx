// KherveFitting: the web edition of the desktop KherveFitting-AI (KherveFittingPro,
// branch dev-AI), laid out as its main window (KherveFitting.py MyFrame +
// libraries/Widgets_Toolbars.py create_widgets): the toolbar with the
// desktop's icons, sheet selector and BE-correction spin control; the
// vertical plot toolbar; the matplotlib-style plot on the left; on the right
// the Peak Fitting Parameters grid above the Results grid (or tabbed); the
// two-field status bar; the Peak Fitting window floating above; the desktop's
// menus in the KherveOS menu bar. The fitting is the desktop's own code
// without wx (public/apps/khervefitting/py/kfcore) in this window's Python.

import './khervefitting.css'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from 'zustand'
import { os, type AppProps, type MenuItem } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { basename, dirname, extname, pretty } from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import type { KernelStatus } from '@/os/python/kernel'
import { fittingAiTools } from './aiTools'
import { AboutView, HelpView, ReportView, SettingsView } from './dialogs'
import { Doc, confirmDiscard } from './doc'
import type { ExampleMenu } from './examples'
import { FittingWindow, type FitPass, type FittingActions } from './FittingWindow'
import {
  IMPORT_TYPES, OPEN_TYPES, clearRecent, openFromComputer, loadExamples, newDocument, openDialog, openExample, openPath, recentFiles, rememberSettings, save, saveAs,
  savedSettings,
} from './files'
import { PeakGrid, ResultsGrid } from './Grids'
import { buildMenus, type Handlers } from './menus'
import { peaksOf, sampleOf, type View } from './model'
import { DEFAULT_OPTIONS, Plot, type AreaFills, type DParamCurve, type IdLine, type Limits, type PlotMode, type PlotOptions } from './Plot'
import { defaultLimits } from './mpl'
import { FACTORY_GRID_RGB, FACTORY_THEME, GREEN_SHADES, themeVars, type PanelTheme } from './theme'
import { ICONS, MainToolbar, PlotToolbar, ResultsToolbar, TogglePopup, type ToolState } from './Toolbars'
import { PlotLimitsWindow } from './windows'
import { ExamplesWindow, AutoIdWindow, BeCorrectionWindow, CropWindow, DParamWindow, IdWindow, JoinWindow, MeasureAreaWindow, PcaWindow, SampleManagerWindow } from './tools'
import { libOpen, libSave } from './peaklib'
import { exportData, exportPlotPng, exportPlotSvg } from './exporting'

/** The desktop this edition follows. */
export const CORE_SOURCE = 'KherveFitting-AI v1.93 (KherveFittingPro dev-AI)'
/** Config_Edition.WINDOW_TITLE of the paid edition. */
export const WINDOW_TITLE = 'KherveFitting-AI-v1.93 - Cite this Paper ---> DOI: 10.1002/sia.70032'

const MAC = /Mac|iPhone|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')
const STATUS: Record<KernelStatus, string> = { off: 'Python off', starting: 'Starting Python…', idle: 'Python ready', busy: 'Python working…', dead: 'Python stopped' }
const UI_KEY = 'khervefitting.ui'

const LINKS: Record<string, string> = {
  paper: 'http://doi.org/10.1002/sia.70032',
  videos: 'https://www.youtube.com/@xpsexamples-imperialcolleg6571',
  'paper:multiplet': 'https://analyticalsciencejournals.onlinelibrary.wiley.com/doi/epdf/10.1002/sia.7383',
  'paper:ck': 'https://analyticalsciencejournals.onlinelibrary.wiley.com/doi/epdf/10.1002/sia.7410',
  'paper:shapes': 'https://analyticalsciencejournals.onlinelibrary.wiley.com/doi/epdf/10.1002/sia.70014',
  'paper:dparam': 'https://www.mdpi.com/2311-5629/7/3/51',
  'paper:c1s': 'https://drive.google.com/file/d/1fyXNfX46cN7q2sYRqwBM-jaj7C2cNSPA/view',
  'paper:tm1': 'https://drive.google.com/file/d/1Kxx_j2kCpj8Hrd3XwbmEcJ16qHpgDmuN/view',
  'paper:tm2': 'https://drive.google.com/file/d/1YYw7O1JVW4Ni_3GJv72uTE9KVE4Cg1S9/view',
  'link:biesinger': 'https://www.xpsfitting.com/',
  'link:harwell': 'https://www.harwellxps.guru/',
  'link:thermo': 'https://www.thermofisher.com/uk/en/home/materials-science/learning-center/periodic-table.html',
  'link:nist': 'https://srdata.nist.gov/xps',
  'link:oasis': 'https://xpsoasis.org/',
  'link:guide': 'https://pubs.aip.org/jva/collection/1440/Special-Topic-Collection-Reproducibility',
  'link:biesingerVideos': 'https://www.youtube.com/@markbiesinger/videos',
  'link:harwellVideos': 'https://www.youtube.com/@HarwellXPS',
  'link:casaVideos': 'https://www.youtube.com/@casaxpscasasoftware4605/videos',
  website: 'https://www.khervetools.com',
}

interface UiPrefs {
  theme: PanelTheme | 'Auto'
  grid: [number, number, number]
  layout: 'split' | 'tabbed'
  welcomeLogo: boolean
}

function readPrefs(): UiPrefs {
  const d: UiPrefs = { theme: FACTORY_THEME, grid: FACTORY_GRID_RGB, layout: 'split', welcomeLogo: true }
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Partial<UiPrefs>) }
  } catch {
    return d
  }
}

const EMPTY_VIEW: View = {
  file: '', sheets: [], sheet: '', grid: [], background: null, fit: null, resultsKey: '', results: [],
  settings: { model: 'SGL (Area)', method: 'Smart', maxIterations: 200, optimization: 'least_squares', weights: 'uniform', photons: 1486.67, instrument: 'A-ALTHERMO1', libraryType: 'TPP-2M', averagingPoints: 5, workfunction: 0, instruments: [] },
}

export interface KherveFittingProps extends AppProps {
  /** Tests: a document already holding a view (no Python). */
  doc?: Doc
}

export default function KherveFitting({ win, args, doc: given }: KherveFittingProps) {
  const doc = useMemo(() => given ?? new Doc(`khervefitting-${win.id}`), [win.id, given])
  const st = useStore(doc.store)
  const { view, selected, busy } = st
  const rootRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<KernelStatus>(given ? 'idle' : doc.bridge.status)
  const [examples, setExamples] = useState<ExampleMenu[] | 'loading' | 'error'>('loading')
  const [prefs, setPrefsState] = useState<UiPrefs>(readPrefs)
  const [compact, setCompact] = useState(true)
  const [rightHidden, setRightHidden] = useState(false)
  const [opts, setOpts] = useState<PlotOptions>(DEFAULT_OPTIONS)
  const [mode, setMode] = useState<PlotMode>('none')
  const [greenLine, setGreenLine] = useState<number | null>(null)
  const [limitsBySheet, setLimitsBySheet] = useState<Record<string, Limits>>({})
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  // args.tool opens a tool window with the file (e.g. { path, tool: 'fitting' }).
  const startTool = typeof args.tool === 'string' ? args.tool : ''
  const [fitWin, setFitWin] = useState<{ mini: boolean } | null>(startTool === 'fitting' ? { mini: false } : null)
  const [fitTab, setFitTab] = useState(typeof args.tab === 'number' ? args.tab : 0)
  const [vlines, setVlines] = useState<[number, number] | null>(() => defaultVlines(doc.state.view))
  const [activeRegion, setActiveRegion] = useState(-1)
  const [currentFit, setCurrentFit] = useState('')
  const [batchProgress, setBatchProgress] = useState('')
  const [toggles, setToggles] = useState<{ x: number; y: number } | null>(null)
  const [resultRow, setResultRow] = useState<number | null>(null)
  const [plotLimitsOpen, setPlotLimitsOpen] = useState(false)
  type Tool = 'area' | 'dparam' | 'id' | 'autoid' | 'be' | 'samples' | 'pca' | 'crop' | 'join' | 'examples'
  const [tools, setTools] = useState<Set<Tool>>(() => new Set(['area', 'dparam', 'id', 'autoid', 'be', 'samples', 'pca', 'crop', 'join', 'examples'].includes(startTool) ? [startTool as Tool] : []))
  const openTool = (t: Tool) => setTools((s) => new Set(s).add(t))
  const closeTool = (t: Tool) => setTools((s) => {
    const n = new Set(s)
    n.delete(t)
    return n
  })
  const [idLines, setIdLines] = useState<IdLine[]>([])
  const [split, setSplit] = useState(800 / 1452)
  const [innerSplit] = useState(0.6)
  const [gridTab, setGridTab] = useState(0)
  const drag = useRef<{ pending: { i: number; x: number; y: number } | null; flying: boolean }>({ pending: null, flying: false })

  const setPrefs = (p: Partial<UiPrefs>) =>
    setPrefsState((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(UI_KEY, JSON.stringify(next))
      } catch {
        /* not kept */
      }
      return next
    })
  const theme: PanelTheme = prefs.theme === 'Auto' ? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'Simple Darker' : 'Simple') : prefs.theme
  const saveDoc = () => save(doc)
  const after = (fn: () => unknown) => () => void Promise.resolve(fn()).finally(() => rootRef.current?.focus())
  const notReady = (what: string) => doc.flash(`${what} is not in the web edition of KherveFitting yet.`)

  // ------------------------------------------------------------ start-up
  useEffect(() => {
    if (given) return
    const unsub = doc.bridge.kernel.onStatus(setStatus)
    let alive = true
    void (async () => {
      await doc.call('new')
      const saved = savedSettings()
      if (Object.keys(saved).length) await doc.call('settings', saved)
      doc.set({ dirty: false, canUndo: false })
      if (alive && typeof args.path === 'string') await openPath(doc, args.path, saveDoc, false)
    })()
    return () => {
      alive = false
      unsub()
      doc.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  const loadIndex = () => {
    setExamples('loading')
    loadExamples().then(setExamples, () => setExamples('error'))
  }
  useEffect(() => {
    if (!given) loadIndex()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasData = !!view && !!view.sheet && !!view.x?.length
  const sheet = view?.sheet ?? ''
  const dataLimits = useMemo(() => (hasData ? defaultLimits(view!.x!, view!.y!) : null), [hasData, view?.x, view?.y])
  const limits: Limits = (sheet && limitsBySheet[sheet]) || (dataLimits ? { ...dataLimits } : { xmin: 0, xmax: 1350, ymin: 0, ymax: 1e6 })
  const setLimits = (l: Limits) => sheet && setLimitsBySheet((m) => ({ ...m, [sheet]: l }))
  const resetLimits = () => sheet && setLimitsBySheet((m) => {
    const n = { ...m }
    delete n[sheet]
    return n
  })

  // A new core level: the red lines go to its background range (show_hide_vlines).
  const sheetKey = `${view?.file ?? ''}|${sheet}`
  useEffect(() => {
    setActiveRegion(-1)
    setVlines(defaultVlines(view))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey])

  // ---------------------------------------------------------- title, guard
  useEffect(() => win.setTitle(WINDOW_TITLE), [win])
  useEffect(() => {
    win.setCloseGuard(() => confirmDiscard(doc, saveDoc, 'closing'))
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, doc])
  useEffect(() => win.setDocumentPath(st.path), [win, st.path])

  // ------------------------------------------------------------- actions
  const selectSheet = (name: string) => {
    doc.set({ selected: null, fitLog: [] })
    setCurrentFit('')
    void doc.call('select', { sheet: name })
  }
  const stepSheet = (d: number) => {
    if (!view) return
    const i = view.sheets.indexOf(view.sheet) + d
    if (i >= 0 && i < view.sheets.length) selectSheet(view.sheets[i])
  }

  const settings = (patch: Record<string, unknown>) => {
    const keep: Record<string, unknown> = {}
    for (const k of ['model', 'maxIterations', 'optimization', 'weights', 'photons', 'instrument', 'libraryType', 'averagingPoints', 'workfunction'])
      if (k in patch) keep[k] = patch[k]
    if (Object.keys(keep).length) rememberSettings(keep)
    void doc.call('settings', patch)
  }

  const addPeak = async (at?: { x: number; y: number }) => {
    if (!view?.background?.type) return doc.flash('Create a background region first (Peak Fitting window, BKG tab).', true)
    const a = await doc.call('add_peak', at ? { x: at.x, y: at.y } : {})
    if (a.ok && typeof a.index === 'number') doc.set({ selected: a.index })
  }

  const removePeak = (index: number | null = null) => {
    void doc.call('remove_peak', { index })
    doc.set({ selected: null })
  }

  const fit = async (fitMode: 'once' | 'stable', stable = 6) => {
    if (!view?.grid.length) return doc.flash('No peaks to fit. Add at least one peak first.', true)
    setCurrentFit(fitMode === 'stable' ? `1 (stable 0/${stable})` : '1')
    doc.set({ loading: fitMode === 'stable' ? 'Fitting until stable…' : 'Fitting…' })
    const a = await doc.call('fit', { mode: fitMode, stable, maxPasses: 40 })
    const log = (a.log as FitPass[] | undefined) ?? []
    doc.set({ loading: null, fitLog: log })
    setCurrentFit(a.ok ? 'Complete' : '')
  }

  const report = async () => {
    const a = await doc.call('report')
    await os.dialog.alert(<ReportView report={String(a.report ?? '')} log={doc.state.fitLog} />, { title: `Fit Report — ${sheet}` })
  }

  const editCell = (row: number, col: number, text: string) => {
    void doc.call('set_cell', { row, col, text }).then((a) => {
      if (!a.ok && a.rejected) doc.flash(a.error ? a.error : 'This value is not accepted.', true)
    })
  }

  // Dragging a peak: one request at a time, always the latest position.
  const pumpDrag = async () => {
    const d = drag.current
    if (d.flying || !d.pending) return
    const p = d.pending
    d.pending = null
    d.flying = true
    await doc.call('drag_peak', { index: p.i, x: p.x, y: p.y })
    d.flying = false
    void pumpDrag()
  }
  const onPeakDrag = (i: number, x: number, y: number, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') return void doc.call('checkpoint')
    drag.current.pending = { i, x, y }
    void pumpDrag()
  }

  const applyRegion = (record: 'append' | 'replace', method: string, offL: number, offR: number, lohi = vlines) => {
    if (!lohi) return
    void doc.call('background', { method, low: lohi[0], high: lohi[1], offsetHigh: offL, offsetLow: offR, record }).then((a) => {
      if (a.ok && record === 'append') setActiveRegion((a.view?.background?.ranges.length ?? 1) - 1)
    })
  }

  const exportCurrent = () => void doc.call('export')
  const deleteResults = (which: 'all' | 'first' | 'last' | 'selected') => {
    const rows = view?.resultsGrid ?? []
    if (!rows.length) return
    const keys = which === 'all' ? null : which === 'first' ? [rows[0].key] : which === 'last' ? [rows[rows.length - 1].key] : resultRow !== null && rows[resultRow] ? [rows[resultRow].key] : []
    if (keys && !keys.length) return doc.flash('Select a row of the Results grid first.', true)
    void doc.call('results_delete', { keys })
    setResultRow(null)
  }

  const feature = async (op: string, args: Record<string, unknown> = {}) => {
    const a = await doc.call(op, args)
    if (!a.ok && /Unknown request/.test(a.error ?? '')) doc.flash('This tool is not in the web edition of KherveFitting yet.', true)
    return a
  }

  const renameSheet = async () => {
    if (!sheet) return
    const name = await os.dialog.prompt('Enter new sheet name (single word only):', { title: 'Rename Sheet', defaultValue: sheet })
    if (!name || name === sheet) return
    if (name.trim().split(/\s+/).length > 1) return void os.dialog.alert('Only a single word is allowed for sheet names or core levels.', { title: 'Invalid Name' })
    await feature('sheet_rename', { sheet, name: name.trim() })
  }
  const deleteSheet = async () => {
    if (!sheet) return
    const ok = await os.dialog.confirm(`Delete the sheet "${sheet}" from the project?`, { title: 'Delete Sheet', danger: true, okLabel: 'Yes' })
    if (ok) await feature('sheet_delete', { sheet })
  }

  const onBe = (v: number) => void feature('be_set', { value: v })

  const openUrl = (url: string) => os.open('browser', { url })

  const toggle = (id: string) => {
    if (id === 'plot') setOpts((o) => ({ ...o, showFit: !o.showFit }))
    else if (id === 'peakFill') setOpts((o) => ({ ...o, peakFill: !o.peakFill }))
    else if (id === 'yAxis') setOpts((o) => ({ ...o, yAxis: ((o.yAxis + 1) % 3) as 0 | 1 | 2 }))
    else if (id === 'legend') setOpts((o) => ({ ...o, legend: ((o.legend + 1) % 3) as 0 | 1 | 2 }))
    else if (id === 'fitResults') setOpts((o) => ({ ...o, fitResults: !o.fitResults }))
    else if (id === 'residuals') setOpts((o) => ({ ...o, residuals: ((o.residuals + 1) % 3) as 0 | 1 | 2 }))
  }

  const adjust = (axis: 'high_be' | 'low_be' | 'high_int' | 'low_int', dir: 1 | -1) => {
    if (!hasData) return
    const l = { ...limits }
    const xstep = Math.max(Math.abs(l.xmax - l.xmin) * 0.02, 0.2)
    const ymax = Math.max(...(view!.y ?? []).filter((v): v is number => v !== null))
    const ystep = (fr: number) => (ymax > 0 ? fr * ymax : fr * Math.abs(l.ymax - l.ymin))
    // Each arrow moves its edge the way the icon points (reversed BE axis: high = left edge).
    if (axis === 'high_be') l.xmax += dir === 1 ? -xstep : xstep
    if (axis === 'low_be') l.xmin += dir === 1 ? -xstep : xstep
    if (axis === 'high_int') l.ymax = dir === 1 ? l.ymax + ystep(0.05) : Math.max(l.ymax - ystep(0.05), l.ymin)
    if (axis === 'low_int') l.ymin = dir === 1 ? Math.min(l.ymin + ystep(0.02), l.ymax) : l.ymin - ystep(0.02)
    setLimits(l)
  }

  const openFitting = (mini = false) => {
    if (!hasData) return doc.flash('Open a file first: File > Open, or an example.', true)
    setFitWin({ mini })
    setFitTab(0)
  }

  const H: Handlers = {
    new: after(() => newDocument(doc, saveDoc)),
    newInstance: () => os.open('khervefitting'),
    open: after(() => openDialog(doc, saveDoc)),
    openComputer: after(() => openFromComputer(doc, saveDoc)),
    openExamples: () => {
      loadIndex()
      openTool('examples')
    },
    clearRecent: () => clearRecent(),
    quickSave: after(saveDoc),
    saveAs: after(() => saveAs(doc)),
    exportExcel: after(saveDoc),
    exportAll: after(saveDoc),
    importVamas: after(() => openDialog(doc, saveDoc, IMPORT_TYPES)),
    importCsv: after(() => openDialog(doc, saveDoc, IMPORT_TYPES)),
    openLocation: st.path ? () => os.open('files', { path: dirname(st.path!) }) : undefined,
    exit: () => win.close(),
    undo: () => void doc.call('undo'),
    redo: () => void doc.call('redo'),
    exportCurrent: hasData ? exportCurrent : undefined,
    delAll: () => deleteResults('all'),
    delFirst: () => deleteResults('first'),
    delLast: () => deleteResults('last'),
    delSelected: () => deleteResults('selected'),
    copyCore: hasData ? () => void feature('sheet_copy', { sheet }) : undefined,
    pasteCore: hasData ? () => void feature('sheet_copy', { sheet }) : undefined,
    joinCores: hasData ? () => openTool('join') : undefined,
    crop: hasData ? () => openTool('crop') : undefined,
    sampleManager: () => openTool('samples'),
    measureArea: hasData ? () => openTool('area') : undefined,
    autoBE: hasData ? () => openTool('be') : undefined,
    pca: hasData ? () => openTool('pca') : undefined,
    dparam: hasData ? () => openTool('dparam') : undefined,
    autoId: hasData ? () => openTool('autoid') : undefined,
    id: hasData ? () => openTool('id') : undefined,
    deleteSheet: hasData ? () => void deleteSheet() : undefined,
    renameSheet: hasData ? () => void renameSheet() : undefined,
    settings: () => void os.dialog.alert(<SettingsView settings={view?.settings ?? EMPTY_VIEW.settings} onChange={settings} />, { title: 'Preferences' }),
    labels: undefined,
    'toggle:plot': () => toggle('plot'),
    'toggle:legend': () => toggle('legend'),
    'toggle:fitResults': () => toggle('fitResults'),
    'toggle:residuals': () => toggle('residuals'),
    welcomeLogo: () => setPrefs({ welcomeLogo: !prefs.welcomeLogo }),
    fitting: () => openFitting(false),
    miniFitting: () => openFitting(true),
    help: () => openUrl('https://www.khervetools.com'),
    about: () => void os.dialog.alert(<AboutView source={CORE_SOURCE} />, { title: 'About KherveFitting' }),
    website: () => openUrl(LINKS.website),
    exportSvg: hasData ? () => void exportPlotSvg(rootRef.current, view) : undefined,
    exportPng: hasData ? () => void exportPlotPng(rootRef.current, view) : undefined,
    exportTxt: hasData ? () => void exportData(view, 'txt') : undefined,
    exportCsv: hasData ? () => void exportData(view, 'csv') : undefined,
    exportDat: hasData ? () => void exportData(view, 'dat') : undefined,
    shortcuts: () => void os.dialog.alert(<HelpView />, { title: 'List of Shortcuts' }),
    nist: () => os.open('khervedb'),
    kherveAI: () => os.open('kherveai'),
  }
  for (const [k, url] of Object.entries(LINKS)) if (!(k in H) || k === 'paper' || k === 'videos') H[k] = () => openUrl(url)
  for (const t of ['None', 'Simple', 'Simple Dark', 'Simple Darker', 'Simple Very Dark', 'Raised', 'Sunken', 'Auto']) H[`theme:${t}`] = () => setPrefs({ theme: t as UiPrefs['theme'] })
  H['layout:split'] = () => setPrefs({ layout: 'split' })
  H['layout:tabbed'] = () => setPrefs({ layout: 'tabbed' })
  GREEN_SHADES.forEach((g, i) => (H[`green:${i}`] = () => setPrefs({ grid: g.rgb })))
  for (const p of recentFiles()) H[`recent:${p}`] = after(() => openPath(doc, p, saveDoc))

  // ------------------------------------------------------------- toolbar
  const onTool = (id: string, el: HTMLElement) => {
    const run: Record<string, () => void> = {
      open: H.open!, quickSave: H.quickSave!, exportExcel: H.exportExcel!, exportAll: H.exportAll!,
      undo: H.undo!, redo: H.redo!,
      sort: () => void feature('sheet_sort'),
      sampleManager: () => openTool('samples'),
      refresh: () => (st.path ? void openPath(doc, st.path, saveDoc) : notReady('Refresh (open a saved project first)')),
      deleteSheet: () => void deleteSheet(),
      renameSheet: () => void renameSheet(),
      crop: () => hasData && openTool('crop'),
      autoBE: () => hasData && openTool('be'),
      measureArea: () => hasData && openTool('area'),
      fitting: () => openFitting(false),
      miniFitting: () => openFitting(true),
      monteCarlo: () => {
        if (!view?.grid.length) return doc.flash('No peaks: build a peak model first.', true)
        doc.set({ loading: 'Monte Carlo (100 refits)…' })
        void feature('monte_carlo', { n: 100 }).then((a) => {
          doc.set({ loading: null })
          const r = a.report as { columns?: string[]; rows?: unknown[][] } | undefined
          if (a.ok && r?.columns && r.rows)
            void os.dialog.alert(
              <div className="kf-doc">
                <table className="kf-log">
                  <thead>
                    <tr>{r.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row, i) => (
                      <tr key={i}>{row.map((c, j) => <td key={j}>{String(c)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>,
              { title: 'Monte Carlo Uncertainties (±1σ)' },
            )
        })
      },
      dparam: () => hasData && openTool('dparam'),
      plotMod: () => notReady('Plot / data modifications'),
      thickogram: () => notReady('The thickness analysis'),
      vb: () => notReady('The VB / Fermi edge measurements'),
      pca: () => hasData && openTool('pca'),
      denoise: () => notReady('Spectral denoising'),
      profileCreator: () => notReady('The Profile Creator'),
      plotCreator: () => notReady('The Plot Creator'),
      autoId: () => hasData && openTool('autoid'),
      id: () => hasData && openTool('id'),
      nist: () => os.open('khervedb'),
      kherveAI: () => os.open('kherveai'),
      libOpen: () => void libOpen(doc, hasData),
      libSave: () => void libSave(doc, hasData),
      settings: H.settings!,
      toggleColumns: () => setCompact((c) => !c),
      toggleRightPanel: () => setRightHidden((v) => !v),
      // vertical toolbar
      toggles: () => {
        const r = el.getBoundingClientRect()
        const root = rootRef.current!.getBoundingClientRect()
        setToggles(toggles ? null : { x: r.right - root.left, y: r.top - root.top })
      },
      zoomIn: () => setMode((m) => (m === 'zoom' ? 'none' : 'zoom')),
      zoomOut: () => {
        setMode('none')
        resetLimits()
      },
      drag: () => setMode((m) => (m === 'drag' ? 'none' : 'drag')),
      plotLimits: () => setPlotLimitsOpen(true),
      greenLine: () => setGreenLine((g) => (g === null && hasData ? (limits.xmin + limits.xmax) / 2 : null)),
      highBePlus: () => adjust('high_be', 1),
      highBeMinus: () => adjust('high_be', -1),
      lowBePlus: () => adjust('low_be', 1),
      lowBeMinus: () => adjust('low_be', -1),
      highIntPlus: () => adjust('high_int', 1),
      highIntMinus: () => adjust('high_int', -1),
      lowIntPlus: () => adjust('low_int', 1),
      lowIntMinus: () => adjust('low_int', -1),
      fontUp: () => setOpts((o) => ({ ...o, fontDelta: Math.min(o.fontDelta + 1, 29) })),
      fontDown: () => setOpts((o) => ({ ...o, fontDelta: Math.max(o.fontDelta - 1, -6) })),
      labels: () => notReady('The Labels Manager'),
      // results toolbar
      exportCurrent: () => exportCurrent(),
      exportMultiple: () => notReady('Export several core levels'),
      delAll: () => deleteResults('all'),
      delFirst: () => deleteResults('first'),
      delLast: () => deleteResults('last'),
      delSelected: () => deleteResults('selected'),
    }
    run[id]?.()
    rootRef.current?.focus()
  }

  const toolStates: Record<string, ToolState> = {
    undo: { disabled: !st.canUndo },
    redo: { disabled: !st.canRedo },
    zoomIn: { checked: mode === 'zoom' },
    drag: { checked: mode === 'drag' },
    greenLine: { checked: greenLine !== null },
  }

  // --------------------------------------------------------------- menus
  const exampleItems: MenuItem[] = Array.isArray(examples)
    ? examples.map((m) => ({
        label: m.name,
        submenu: [
          ...m.items.map((x) => ({ label: x.title, onClick: after(() => openExample(doc, x.file, x.title, saveDoc)) })),
          ...m.groups.map((g) => ({ label: g.name, submenu: g.items.map((x) => ({ label: x.title, onClick: after(() => openExample(doc, x.file, x.title, saveDoc)) })) })),
        ],
      }))
    : [{ label: examples === 'loading' ? 'Loading examples…' : 'The examples could not be loaded', disabled: examples === 'loading', onClick: loadIndex }]
  const menus = buildMenus(H, {
    mac: MAC,
    recent: recentFiles().map((p) => ({ label: `${basename(p)}   ${pretty(dirname(p))}`, path: p, ok: os.fs.isFile(p) })),
    examples: exampleItems,
    sheets: view?.sheets ?? [],
    theme: prefs.theme,
    layout: prefs.layout,
    gridColour: GREEN_SHADES.find((g) => g.rgb.join() === prefs.grid.join())?.label ?? '',
    greens: GREEN_SHADES.map((g) => g.label),
    welcomeLogo: prefs.welcomeLogo,
    kineticEnergy: false,
    canUndo: st.canUndo,
    canRedo: st.canRedo,
  })
  const menuKey = JSON.stringify(menus, (_k, v) => (typeof v === 'function' ? 1 : v))
  useEffect(() => win.setMenus(menus), [win, menuKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => win.setMenus(null), [win])

  // ------------------------------------------------------------ AI tools
  useAppTools(win, fittingAiTools({ doc, open: (p) => openPath(doc, p, saveDoc, false), openExample: (f, t) => openExample(doc, f, t, saveDoc), examples: () => loadExamples() }))

  // ------------------------------------------------------------ keyboard
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    const t = e.target as HTMLElement
    const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const run = (fn?: () => unknown) => {
      if (!fn) return
      e.preventDefault()
      void Promise.resolve(fn())
    }
    if (mod && !e.altKey) {
      const map: Record<string, (() => unknown) | undefined> = {
        n: H.new, o: H.open, s: H.quickSave, z: e.shiftKey ? H.redo : H.undo, y: H.redo, p: H.fitting, q: H.exit,
        '[': () => stepSheet(-1), ']': () => stepSheet(1), '9': () => stepSheet(-1), '0': () => stepSheet(1),
      }
      return run(map[k])
    }
    if (typing || t.closest('.kf-grid')) return
    const n = (view?.grid.length ?? 0) / 2
    if (k === 'Tab' && fitWin && fitTab === 0 && view?.background?.ranges.length) return run(() => setActiveRegion((r) => (r + 1) % view!.background!.ranges.length))
    if (k === 'Tab' && n) return run(() => doc.set({ selected: selected === null ? 0 : (selected + 1) % n }))
    if (k === 'q' && n) return run(() => doc.set({ selected: selected === null ? n - 1 : (selected - 1 + n) % n }))
    if ((k === 'Delete' || k === 'Backspace') && selected !== null) return run(() => removePeak(selected))
    if (k === 'Escape') return run(() => (mode !== 'none' ? setMode('none') : doc.set({ selected: null })))
  }

  // --------------------------------------------------------- dropping files
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
      const paths = (JSON.parse(raw) as string[]).filter((p) => OPEN_TYPES.includes(extname(p).toLowerCase()))
      if (paths.length) void openPath(doc, paths[0], saveDoc)
      for (const p of paths.slice(1)) os.open('khervefitting', { path: p })
    } catch {
      /* not a list of paths */
    }
  }

  // The splitter between the plot and the grids (wx.SplitterWindow, sash gravity 0.5).
  const onSash = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const box = el.parentElement!.getBoundingClientRect()
    const move = (ev: PointerEvent) => setSplit(Math.max(0.2, Math.min(0.85, (ev.clientX - box.left) / box.width)))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  // The plot's right-click menu (On_Mouse_Defs.on_right_click, XPS sheet)
  const peakClipboard = useRef<string | null>(null)
  const plotMenu = (e: ReactMouseEvent, at: { x: number; y: number; peak: number }) => {
    const items: MenuItem[] = [
      { label: 'Zoom In', onClick: () => setMode('zoom') },
      { label: 'Zoom Out', onClick: () => { setMode('none'); resetLimits() } },
      { label: 'Overview', disabled: true },
      '-',
      { label: 'Copy Core Level', disabled: !hasData, onClick: () => void feature('sheet_copy', { sheet }) },
      { label: 'Paste Core Level', disabled: !hasData, onClick: () => void feature('sheet_copy', { sheet }) },
      { label: 'Crop Core Level', disabled: !hasData, onClick: () => openTool('crop') },
      '-',
      {
        label: 'Copy Peak Table',
        disabled: !view?.grid.length,
        onClick: () => void feature('lib_save', { kind: 'peaks' }).then((a) => {
          if (a.ok) {
            peakClipboard.current = String(a.json)
            doc.flash('Peak table copied.')
          }
        }),
      },
      { label: 'Paste Peak Table', disabled: !peakClipboard.current || !hasData, onClick: () => void feature('lib_load', { json: peakClipboard.current, mode: 'overwrite' }) },
      { label: 'Fit Uncertainties ±…', disabled: !view?.fit, onClick: () => void report() },
      '-',
      {
        label: 'Style',
        submenu: [
          { label: 'Peak Fill', checked: opts.peakFill, onClick: () => toggle('peakFill') },
          { label: 'Hatched Peaks', checked: opts.fillTypes[0] === 'Hatch', onClick: () => setOpts((o) => ({ ...o, fillTypes: o.fillTypes[0] === 'Hatch' ? [] : Array(30).fill('Hatch') })) },
          { label: 'Legend', onClick: () => toggle('legend') },
          { label: 'Residuals', onClick: () => toggle('residuals') },
          { label: 'Y Axis', onClick: () => toggle('yAxis') },
        ],
      },
      '-',
      {
        label: 'Export',
        submenu: [
          { label: 'Export plot as SVG [Best]', onClick: () => void exportPlotSvg(rootRef.current, view) },
          { label: 'Export plot as PNG', onClick: () => void exportPlotPng(rootRef.current, view) },
          { label: 'Export plot as PDF', disabled: true },
          '-',
          { label: 'Export plot data as XLSX', disabled: true },
          { label: 'Export plot data as CSV', onClick: () => void exportData(view, 'csv') },
          { label: 'Export plot data as KherveSheet', disabled: true },
        ],
      },
      '-',
      { label: `Rename '${sheet}'`, disabled: !hasData, onClick: () => void renameSheet() },
      { label: 'Edit Data', disabled: true },
      { label: 'Info', disabled: true },
    ]
    if (at.peak >= 0) {
      const p = peaksOf(view?.grid ?? [])[at.peak]
      items.unshift({ label: `Delete Peak ${p?.letter ?? ''} (${p?.label ?? ''})`, danger: true, onClick: () => removePeak(at.peak) }, '-')
    }
    os.contextMenu(e, items)
  }

  // ---------------------------------------------------------- fitting window
  const fitActs: FittingActions = {
    createRegion: (method, l, r) => applyRegion('append', method, l, r),
    updateRegion: (i, method, l, r) => {
      const rg = view?.background?.ranges[i]
      applyRegion('replace', method, l, r, rg ? [rg[2], rg[3]] : vlines)
    },
    removeRegion: (i) => void doc.call('remove_region', { index: i }).then(() => setActiveRegion(-1)),
    clearAll: () => void doc.call('clear_background', { only: false }),
    clearRegions: () => void doc.call('clear_background', { only: true }).then(() => setActiveRegion(-1)),
    settings,
    addPeak: () => void addPeak(),
    addDoublet: (name) => void feature('add_doublet', name ? { name } : {}),
    removeLast: () => removePeak(null),
    fit: (m, n) => void fit(m, n),
    report: () => void report(),
    propagate: (kind, sheets) =>
      void feature('propagate', { kind, sheets }).then((a) => {
        if (a.ok && a.message) {
          setBatchProgress(String(a.message).split('\n')[0])
          void os.dialog.alert(String(a.message), { title: 'Propagate' })
        }
      }),
    fitSheets: async (sheets, n) => {
      const start = sheet
      for (let k = 0; k < sheets.length; k++) {
        setBatchProgress(`${k + 1} / ${sheets.length}  ${sheets[k]}`)
        await doc.call('select', { sheet: sheets[k] })
        await doc.call('fit', { mode: 'stable', stable: n, maxPasses: 40 })
      }
      setBatchProgress(`Done: ${sheets.length} core levels`)
      if (start) await doc.call('select', { sheet: start })
    },
    askName: () => os.dialog.prompt('Doublet name (e.g. "Fe2p3/2 Fe(0)"):', { title: 'Add Doublet with Name' }),
    notReady,
    close: () => setFitWin(null),
  }
  // Region boxes: the active one's range goes to the red lines.
  useEffect(() => {
    const r = view?.background?.ranges[activeRegion]
    if (r) setVlines([Math.min(r[2], r[3]), Math.max(r[2], r[3])])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRegion])

  // ---------------------------------------------------------------- view
  const working = busy > 0 || status === 'starting'
  const message = st.message?.text ?? st.loading ?? st.progress ?? (status === 'starting' ? 'Starting Python (the first time downloads it)…' : null)
  const fileText = st.path ? pretty(st.path) : view?.sheets.length ? st.untitled : ''
  const leftStatus = message ?? (fileText ? `Selected File: ${fileText}` : `Working Directory: ${pretty('/home')}  ·  ${STATUS[status]}`)
  const rightStatus = cursor ? `BE: ${cursor.x.toFixed(3)} eV, I: ${cursor.y.toFixed(3)} CPS` : 'BE: 0 eV, I: 0 CPS'
  const showLines = hasData && ((!!fitWin && fitTab === 0) || tools.has('area') || tools.has('crop'))
  const extra = view?.extra ?? {}
  const be = typeof extra.beCorrection === 'number' ? extra.beCorrection : 0
  const rowNumber = sampleOf(sheet)

  const plotView = hasData ? view! : { ...EMPTY_VIEW, x: [], y: [] }
  const plot = (
    <Plot
      view={plotView}
      limits={limits}
      options={opts}
      selected={selected}
      vlines={showLines ? vlines : null}
      greenLine={greenLine}
      mode={mode}
      labels={extra.labels}
      idLines={idLines}
      dparam={(extra.dparam as DParamCurve | null | undefined) ?? null}
      areaFills={(extra.areaFills as AreaFills | null | undefined) ?? null}
      chi={view?.stats?.Chi ?? null}
      logo={!hasData && prefs.welcomeLogo ? `${ICONS}SplashScreen5.png` : null}
      onLimits={setLimits}
      onCursor={setCursor}
      onSelect={(p) => doc.set({ selected: p })}
      onPeakDrag={onPeakDrag}
      onVlines={(lo, hi) => setVlines([lo, hi])}
      onGreenLine={setGreenLine}
      onDoubleClick={() => setPlotLimitsOpen(true)}
      onContextMenu={plotMenu}
    />
  )

  const peakBox = (
    <fieldset className="kf-box">
      {prefs.layout === 'split' && <legend>Peak Fitting Parameters</legend>}
      <PeakGrid grid={view?.grid ?? []} colours={view?.gridColours} selected={selected}
        compact={compact}
        onSelect={(p) => doc.set({ selected: p })}
        onEdit={editCell}
        tips={(r, c) => {
          // Fit_Uncertainty.bind_grid_tooltips: hover Position / Height / FWHM / L/G / Area → value ± 1σ
          const q = ({ 2: 'Position', 3: 'Height', 4: 'FWHM', 5: 'L/G', 6: 'Area' } as Record<number, string>)[c]
          const e = r % 2 === 0 && q ? view?.peakErrors?.[r / 2] : undefined
          if (!e || !q) return undefined
          if (e[`${q}Status`] === 'fixed') return `${q}: fixed`
          const v = e[q]
          const note = e[`${q}Status`] ? `, ${e[`${q}Status`]}` : ''
          return typeof v === 'number' ? `${q}: ${view!.grid[r][c]} ± ${v.toPrecision(2)}  (${e.method ?? '1σ'}${note})` : undefined
        }}
      />
    </fieldset>
  )
  const resultsBox = (
    <fieldset className="kf-box">
      {prefs.layout === 'split' && <legend>Results [Row {rowNumber}]</legend>}
      <ResultsToolbar states={{}} onTool={onTool} />
      <ResultsGrid
        rows={view?.resultsGrid ?? []}
        compact={compact}
        selectedRow={resultRow}
        onSelectRow={setResultRow}
        onToggle={(key, checked) => void doc.call('results_set', { key, field: 'checked', value: checked })}
        onSet={(key, field, value) => void doc.call('results_set', { key, field, value })}
      />
    </fieldset>
  )

  return (
    <div
      className="k-app kf-app"
      ref={rootRef}
      tabIndex={-1}
      style={themeVars(theme, prefs.grid) as CSSProperties}
      data-theme={theme}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <MainToolbar sheets={view?.sheets ?? []} sheet={sheet} be={be} states={toolStates} onSheet={selectSheet} onBe={onBe} onTool={onTool} />
      <div className="kf-content">
        {!rightHidden && <PlotToolbar states={toolStates} onTool={onTool} />}
        <div className="kf-splitter">
          <div className="kf-plotpanel" style={{ width: rightHidden ? '100%' : `${split * 100}%` }}>
            {plot}
          </div>
          {!rightHidden && (
            <>
              <div className="kf-sash" onPointerDown={onSash} />
              <div className="kf-grids">
                {prefs.layout === 'split' ? (
                  <>
                    <div style={{ height: `${innerSplit * 100}%` }} className="kf-gridpane">
                      {peakBox}
                    </div>
                    <div style={{ height: `${(1 - innerSplit) * 100}%` }} className="kf-gridpane">
                      {resultsBox}
                    </div>
                  </>
                ) : (
                  <div className="kf-fnb">
                    <div className="kf-fnb-tabs">
                      {['Peak Parameters', 'Results', 'Sample Manager'].map((t, i) => (
                        <button key={t} type="button" className={gridTab === i ? 'kf-fnb-on' : ''} onClick={() => setGridTab(i)}>
                          {t}
                        </button>
                      ))}
                    </div>
                    <div className="kf-gridpane">{gridTab === 0 ? peakBox : gridTab === 1 ? resultsBox : <div className="kf-note" style={{ padding: 8 }}>
                          <button type="button" className="kf-wxbtn" onClick={() => openTool('samples')}>
                            Sample/Experiment Manager…
                          </button>
                        </div>}</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="kf-statusbar">
        <span className={`kf-sb-main${st.message?.error ? ' kf-error' : ''}`}>
          {working && <span className="kf-spin-dot" />}
          {leftStatus}
        </span>
        <span className="kf-sb-pos">{rightStatus}</span>
      </div>

      {toggles && <TogglePopup at={toggles} onTool={(id) => toggle(id)} onClose={() => setToggles(null)} />}
      {fitWin && view && hasData && (
        <FittingWindow
          view={view}
          tab={fitTab}
          onTab={setFitTab}
          vlines={vlines}
          onVlines={(lo, hi) => setVlines([lo, hi])}
          activeRegion={activeRegion}
          onActiveRegion={setActiveRegion}
          busy={working}
          log={st.fitLog as FitPass[]}
          currentFit={currentFit}
          batchProgress={batchProgress}
          act={fitActs}
          mini={fitWin.mini}
        />
      )}
      {tools.has('examples') && (
        <ExamplesWindow
          files={Array.isArray(examples) ? examples.flatMap((m) => [...m.items, ...m.groups.flatMap((g) => g.items)]).map((x) => x.file) : []}
          onOpen={(file, name) => void openExample(doc, file, name, saveDoc)}
          onRefresh={loadIndex}
          onClose={() => closeTool('examples')}
        />
      )}
      {view && hasData && tools.has('area') && (
        <MeasureAreaWindow view={view} call={feature} vlines={vlines} onVlines={(lo, hi) => setVlines([lo, hi])} onClose={() => closeTool('area')} notReady={notReady} onAutoId={() => openTool('autoid')} />
      )}
      {hasData && tools.has('dparam') && <DParamWindow call={feature} onClose={() => closeTool('dparam')} />}
      {hasData && tools.has('id') && (
        <IdWindow
          base={import.meta.env.BASE_URL}
          photons={view?.settings.photons ?? 1486.67}
          limits={limits}
          onLines={setIdLines}
          onAddLabels={(labels) => void feature('id_labels_add', { labels })}
          onClear={() => void feature('id_labels_clear')}
          onAutoId={() => openTool('autoid')}
          onClose={() => {
            setIdLines([])
            closeTool('id')
          }}
        />
      )}
      {hasData && tools.has('autoid') && <AutoIdWindow call={feature} onClose={() => closeTool('autoid')} />}
      {view && hasData && tools.has('be') && <BeCorrectionWindow call={feature} view={view} onClose={() => closeTool('be')} />}
      {view && tools.has('samples') && view.sheets.length > 0 && (
        <SampleManagerWindow
          call={feature}
          view={view}
          onSelect={selectSheet}
          onClose={() => closeTool('samples')}
          rename={(sample, current) =>
            void os.dialog.prompt(`Name of sample ${sample}:`, { title: 'Sample/Experiment Manager', defaultValue: current }).then((n) => { if (n !== null) void feature('sample_rename', { sample, name: n }) })
          }
        />
      )}
      {view && hasData && tools.has('pca') && <PcaWindow call={feature} view={view} onClose={() => closeTool('pca')} />}
      {view && hasData && tools.has('crop') && <CropWindow call={feature} view={view} vlines={vlines} onVlines={(lo, hi) => setVlines([lo, hi])} onClose={() => closeTool('crop')} />}
      {view && hasData && tools.has('join') && <JoinWindow call={feature} view={view} onClose={() => closeTool('join')} />}
      {plotLimitsOpen && hasData && (
        <PlotLimitsWindow limits={limits} onChange={setLimits} onReset={resetLimits} onClose={() => setPlotLimitsOpen(false)} />
      )}
    </div>
  )
}

/** Where the red region lines start (MyFrame.show_hide_vlines): the background range, else 1/15 and 14/15 of the data. */
function defaultVlines(view: View | null): [number, number] | null {
  const xs = (view?.x ?? []).filter((x): x is number => x !== null)
  if (!view?.sheet || !xs.length) return null
  const lo = Number(view.background?.low)
  const hi = Number(view.background?.high)
  if (view.background?.type && Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi) return [Math.min(lo, hi), Math.max(lo, hi)]
  const a = Math.min(...xs)
  const r = Math.max(...xs) - a
  return [a + r / 15, a + (14 * r) / 15]
}
