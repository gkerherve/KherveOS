// KherveFitting: XPS peak fitting, the web edition of the desktop
// KherveFitting (wxPython). The fitting is the desktop's own code without
// wx (public/apps/khervefitting/py/kfcore: Functions.fit_peaks, the peak
// models and backgrounds of libraries/Peak_Functions.py) running in this
// window's Python; the plot, tables and files are handled here. Workbooks are
// the desktop's .xlsx + .json pairs.

import './khervefitting.css'
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from 'zustand'
import { FolderOpen, LoaderCircle, MousePointerClick, Redo2, Save, Undo2, ZoomIn, ZoomOut, Maximize2, Activity } from 'lucide-react'
import { os, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { basename, dirname, extname, pretty } from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import type { KernelStatus } from '@/os/python/kernel'
import { Controls, type ControlActions } from './Controls'
import { AboutView, HelpView, ReportView, SettingsView } from './dialogs'
import { Doc, confirmDiscard } from './doc'
import type { ExampleMenu } from './examples'
import {
  IMPORT_TYPES, OPEN_TYPES, clearRecent, loadExamples, newDocument, openDialog, openExample, openPath, recentFiles, rememberSettings, save, saveAs,
  savedSettings,
} from './files'
import { num, peaksOf } from './model'
import { PeakTable } from './PeakTable'
import { Plot, type Zoom } from './Plot'
import { extent, ordered, zoomRange } from './plotmath'
import { ResultsTable } from './ResultsTable'

/** The desktop KherveFitting this edition follows (its develop branch). */
export const CORE_SOURCE = 'KherveFitting develop, 2026-10-07'
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent)
const MOD = MAC ? '⌘' : 'Ctrl+'
const SHIFT = MAC ? '⇧' : 'Shift+'
const STATUS: Record<KernelStatus, string> = { off: 'Python off', starting: 'Starting Python…', idle: 'Python ready', busy: 'Python working…', dead: 'Python stopped' }

export default function KherveFitting({ win, args }: AppProps) {
  const doc = useMemo(() => new Doc(`khervefitting-${win.id}`), [win.id])
  const st = useStore(doc.store)
  const { view, selected, busy } = st
  const rootRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<KernelStatus>(doc.bridge.status)
  const [examples, setExamples] = useState<ExampleMenu[] | 'loading' | 'error'>('loading')
  const [limits, setLimits] = useState<[number, number] | null>(null)
  const [zoom, setZoom] = useState<Zoom>({ x: null, y: null })
  const [showResiduals, setShowResiduals] = useState(true)
  const [addMode, setAddMode] = useState(false)
  const [bottomH, setBottomH] = useState(230)
  const [resultsW, setResultsW] = useState(46)
  const drag = useRef<{ pending: { i: number; x: number; y: number } | null; flying: boolean }>({ pending: null, flying: false })

  const saveDoc = () => save(doc)
  const after = (fn: () => unknown) => () => void Promise.resolve(fn()).finally(() => rootRef.current?.focus())

  // ------------------------------------------------------------ start-up
  useEffect(() => {
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
  useEffect(loadIndex, [])

  // A new core level: background limits from the stored background, zoom reset.
  const sheetKey = `${view?.file ?? ''}|${view?.sheet ?? ''}`
  useEffect(() => {
    setZoom({ x: null, y: null })
    if (!view || !view.x?.length) {
      setLimits(null)
      return
    }
    const b = view.background
    const lo = num(String(b?.low ?? ''))
    const hi = num(String(b?.high ?? ''))
    const ext = extent(view.x)!
    setLimits(lo !== null && hi !== null && hi > lo && b?.type ? [lo, hi] : [ext.min, ext.max])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey])

  // ---------------------------------------------------------- title, guard
  const name = st.path ? basename(st.path) : st.untitled
  useEffect(() => win.setTitle(`${st.dirty ? '• ' : ''}${name} — KherveFitting`), [win, name, st.dirty])
  useEffect(() => {
    win.setCloseGuard(() => confirmDiscard(doc, saveDoc, 'closing'))
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, doc])
  useEffect(() => win.setDocumentPath(st.path), [win, st.path])

  // ------------------------------------------------------------- actions
  const selectSheet = (sheet: string) => {
    doc.set({ selected: null, fitLog: [] })
    void doc.call('select', { sheet })
  }
  const stepSheet = (d: number) => {
    if (!view) return
    const i = view.sheets.indexOf(view.sheet) + d
    if (i >= 0 && i < view.sheets.length) selectSheet(view.sheets[i])
  }

  const applyBackground: ControlActions['background'] = ({ method, offsetLow, offsetHigh, record }) => {
    if (!limits) return
    void doc.call('background', { method, low: limits[0], high: limits[1], offsetLow, offsetHigh, record })
  }

  const settings = (patch: Record<string, unknown>) => {
    const keep: Record<string, unknown> = {}
    for (const k of ['model', 'maxIterations', 'optimization', 'weights', 'photons', 'instrument', 'libraryType', 'averagingPoints', 'workfunction'])
      if (k in patch) keep[k] = patch[k]
    if (Object.keys(keep).length) rememberSettings(keep)
    void doc.call('settings', patch)
  }

  const addPeak = async (at?: { x: number; y: number }) => {
    if (!view?.background?.type) {
      doc.flash('Make a background first: drag the dashed lines around the peaks and press Background.', true)
      return
    }
    const a = await doc.call('add_peak', at ? { x: at.x, y: at.y } : {})
    if (a.ok && typeof a.index === 'number') doc.set({ selected: a.index })
  }

  const removePeak = (index = selected) => {
    void doc.call('remove_peak', { index })
    doc.set({ selected: null })
  }

  const fit = async (iterations: number) => {
    doc.set({ loading: iterations > 1 ? `Fitting ${iterations} times…` : 'Fitting…' })
    const a = await doc.call('fit', { iterations })
    doc.set({ loading: null, fitLog: (a.log as typeof st.fitLog | undefined) ?? [] })
  }

  const report = async () => {
    const a = await doc.call('report')
    await os.dialog.alert(<ReportView report={String(a.report ?? '')} log={doc.state.fitLog} />, { title: `Fit report — ${view?.sheet ?? ''}` })
  }

  const editCell = (row: number, col: number, text: string) => {
    void doc.call('set_cell', { row, col, text }).then((a) => {
      if (!a.ok && a.rejected) doc.flash(a.error && a.error !== '' ? a.error : 'This value is not accepted.', true)
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
    if (phase === 'start') {
      void doc.call('checkpoint')
      return
    }
    drag.current.pending = { i, x, y }
    void pumpDrag()
  }

  const onLimits = (lo: number, hi: number, final: boolean) => {
    setLimits([lo, hi])
    const b = view?.background
    if (final && b?.type) {
      void doc.call('background', { method: b.type, low: lo, high: hi, offsetLow: Number(b.offsetLow) || 0, offsetHigh: Number(b.offsetHigh) || 0, record: 'replace' })
    }
  }

  const zoomBy = (factor: number) => {
    if (!view?.x) return
    const ext = extent(view.x)
    if (!ext) return
    const cur = zoom.x ?? ext
    setZoom({ x: zoomRange(cur, (cur.min + cur.max) / 2, factor), y: zoom.y })
  }

  const exportResults = () => void doc.call('export')

  const actions: ControlActions = {
    selectSheet,
    setLimits: (lo, hi) => onLimits(lo, hi, false),
    background: applyBackground,
    clearBackground: (only) => void doc.call('clear_background', { only }),
    settings,
    addPeak: () => void addPeak(),
    removePeak: () => removePeak(),
    fit: (n) => void fit(n),
    report: () => void report(),
    exportResults,
  }

  const openSettings = () =>
    void os.dialog.alert(<SettingsView settings={view?.settings ?? DEFAULT_SETTINGS} onChange={settings} />, { title: 'Quantification' }).finally(() => rootRef.current?.focus())

  const plotMenu = (e: ReactMouseEvent, at: { x: number; y: number; peak: number }) => {
    const items: MenuItem[] = []
    if (at.peak >= 0) {
      const p = peaksOf(view?.grid ?? [])[at.peak]
      items.push({ label: `Remove peak ${p?.letter ?? ''} (${p?.label ?? ''})`, danger: true, onClick: () => removePeak(at.peak) })
      items.push('-')
    }
    items.push({ label: `Add peak at ${at.x.toFixed(2)} eV`, disabled: !view?.background?.type, onClick: () => void addPeak(at) })
    if (limits) {
      items.push({ label: `Background low limit here (${at.x.toFixed(2)})`, onClick: () => onLimits(Math.min(at.x, limits[1]), Math.max(at.x, limits[1]), true) })
      items.push({ label: `Background high limit here (${at.x.toFixed(2)})`, onClick: () => onLimits(Math.min(at.x, limits[0]), Math.max(at.x, limits[0]), true) })
    }
    items.push('-', { label: 'Show Whole Spectrum', onClick: () => setZoom({ x: null, y: null }) })
    items.push({ label: 'Residuals', checked: showResiduals, onClick: () => setShowResiduals(!showResiduals) })
    os.contextMenu(e, items)
  }

  // --------------------------------------------------------------- menus
  const menus = useMemo<MenuBarMenu[]>(() => {
    const recent = recentFiles()
    const recentItems: MenuItem[] = recent.length
      ? [
          ...recent.map((p): MenuItem => ({ label: `${basename(p)}   ${pretty(dirname(p))}`, disabled: !os.fs.isFile(p), onClick: after(() => openPath(doc, p, saveDoc)) })),
          '-',
          { label: 'Clear Recent Files', onClick: () => clearRecent() },
        ]
      : [{ label: '(no recent files)', disabled: true }]
    const exampleItems: MenuItem[] = []
    if (examples === 'loading') exampleItems.push({ label: 'Loading examples…', disabled: true })
    else if (examples === 'error') exampleItems.push({ label: 'The examples could not be loaded — try again', onClick: loadIndex })
    else
      for (const m of examples) {
        const sub: MenuItem[] = m.items.map((x) => ({ label: x.title, onClick: after(() => openExample(doc, x.file, x.title, saveDoc)) }))
        for (const g of m.groups) sub.push({ label: g.name, submenu: g.items.map((x) => ({ label: x.title, onClick: after(() => openExample(doc, x.file, x.title, saveDoc)) })) })
        exampleItems.push({ label: m.name, submenu: sub.length ? sub : [{ label: '(none)', disabled: true }] })
      }
    const hasView = !!view?.sheet
    const hasPeaks = !!view?.grid.length
    const sheetItems: MenuItem[] = (view?.sheets ?? []).map((n) => ({ label: n, checked: n === view?.sheet, onClick: () => selectSheet(n) }))
    return [
      {
        label: 'File',
        items: [
          { label: 'New', onClick: after(() => newDocument(doc, saveDoc)) },
          { label: 'New Window', shortcut: `${SHIFT}${MOD}N`, onClick: () => os.open('khervefitting') },
          '-',
          { label: 'Open…', shortcut: `${MOD}O`, onClick: after(() => openDialog(doc, saveDoc)) },
          { label: 'Open Recent', submenu: recentItems },
          { label: 'Import Spectra (VAMAS, CSV, TXT)…', onClick: after(() => openDialog(doc, saveDoc, IMPORT_TYPES)) },
          '-',
          { label: 'Save', shortcut: `${MOD}S`, disabled: !hasView, onClick: after(saveDoc) },
          { label: 'Save As…', shortcut: `${SHIFT}${MOD}S`, disabled: !hasView, onClick: after(() => saveAs(doc)) },
          '-',
          { label: 'Close Window', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', shortcut: `${MOD}Z`, disabled: !st.canUndo, onClick: () => void doc.call('undo') },
          { label: 'Redo', shortcut: MAC ? `${SHIFT}${MOD}Z` : `${MOD}Y`, disabled: !st.canRedo, onClick: () => void doc.call('redo') },
          '-',
          { label: 'Quantification Settings…', onClick: openSettings },
        ],
      },
      {
        label: 'Fitting',
        items: [
          { label: 'Core Level', submenu: sheetItems.length ? sheetItems : [{ label: '(none)', disabled: true }] },
          { label: 'Previous Core Level', shortcut: `${MOD}[`, disabled: !hasView, onClick: () => stepSheet(-1) },
          { label: 'Next Core Level', shortcut: `${MOD}]`, disabled: !hasView, onClick: () => stepSheet(1) },
          '-',
          { label: 'Clear Background and Peaks', disabled: !hasView, onClick: () => actions.clearBackground(false) },
          { label: 'Add Peak', disabled: !view?.background?.type, onClick: () => void addPeak() },
          { label: 'Add Peaks by Clicking', checked: addMode, disabled: !view?.background?.type, onClick: () => setAddMode(!addMode) },
          { label: selected !== null ? `Remove Peak ${String.fromCharCode(65 + selected)}` : 'Remove Last Peak', disabled: !hasPeaks, onClick: () => removePeak() },
          '-',
          { label: 'Fit', shortcut: `${MOD}F`, disabled: !hasPeaks, onClick: () => void fit(1) },
          { label: 'Fit ×20', disabled: !hasPeaks, onClick: () => void fit(20) },
          { label: 'Fit Report…', disabled: !view?.fit, onClick: () => void report() },
          '-',
          { label: 'Export Results', disabled: !hasPeaks, onClick: exportResults },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom In', shortcut: `${MOD}=`, onClick: () => zoomBy(1 / 1.5) },
          { label: 'Zoom Out', shortcut: `${MOD}-`, onClick: () => zoomBy(1.5) },
          { label: 'Show Whole Spectrum', shortcut: 'Home', onClick: () => setZoom({ x: null, y: null }) },
          '-',
          { label: 'Residuals', checked: showResiduals, onClick: () => setShowResiduals(!showResiduals) },
        ],
      },
      { label: 'Examples', items: exampleItems },
      {
        label: 'Help',
        items: [
          { label: 'KherveFitting Help', shortcut: 'F1', onClick: () => void os.dialog.alert(<HelpView />, { title: 'KherveFitting — Help' }) },
          { label: 'About KherveFitting', onClick: () => void os.dialog.alert(<AboutView source={CORE_SOURCE} />, { title: 'About KherveFitting' }) },
        ],
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, win, examples, view, st.canUndo, st.canRedo, selected, addMode, showResiduals, st.path])

  useEffect(() => win.setMenus(menus), [win, menus])
  useEffect(() => () => win.setMenus(null), [win])

  // ------------------------------------------------------------ keyboard
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    const t = e.target as HTMLElement
    const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const run = (fn: () => unknown) => {
      e.preventDefault()
      void Promise.resolve(fn())
    }
    if (k === 'F1') return run(() => os.dialog.alert(<HelpView />, { title: 'KherveFitting — Help' }))
    if (mod && !e.altKey) {
      if (e.shiftKey) {
        if (k === 's') return run(() => saveAs(doc))
        if (k === 'n') return run(() => os.open('khervefitting'))
        if (k === 'z') return run(() => doc.call('redo'))
        return
      }
      const plain: Record<string, () => unknown> = {
        s: saveDoc,
        o: () => openDialog(doc, saveDoc),
        z: () => doc.call('undo'),
        y: () => doc.call('redo'),
        f: () => view?.grid.length && fit(1),
        '[': () => stepSheet(-1),
        ']': () => stepSheet(1),
        '=': () => zoomBy(1 / 1.5),
        '+': () => zoomBy(1 / 1.5),
        '-': () => zoomBy(1.5),
      }
      if (plain[k]) run(plain[k])
      return
    }
    if (typing || t.closest('.kf-table')) return
    const n = (view?.grid.length ?? 0) / 2
    if (k === 'Home' || k === '0') return run(() => setZoom({ x: null, y: null }))
    if (k === 'Tab' && n) return run(() => doc.set({ selected: selected === null ? 0 : (selected + 1) % n }))
    if (k === 'q' && n) return run(() => doc.set({ selected: selected === null ? n - 1 : (selected - 1 + n) % n }))
    if ((k === 'Delete' || k === 'Backspace') && selected !== null) return run(() => removePeak())
    if (k === 'Escape') return run(() => (addMode ? setAddMode(false) : doc.set({ selected: null })))
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

  // Resizing the bottom panel and the results column.
  const resize = (e: ReactPointerEvent<HTMLDivElement>, axis: 'y' | 'x') => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startX = e.clientX
    const h0 = bottomH
    const w0 = resultsW
    const width = rootRef.current?.querySelector('.kf-bottom')?.clientWidth ?? 1000
    const move = (ev: PointerEvent) => {
      if (axis === 'y') setBottomH(Math.max(90, Math.min(600, h0 - (ev.clientY - startY))))
      else setResultsW(Math.max(20, Math.min(75, w0 - ((ev.clientX - startX) / width) * 100)))
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  // ---------------------------------------------------------------- view
  const working = busy > 0 || status === 'starting'
  const message = st.loading ?? st.progress ?? (status === 'starting' ? 'Starting Python (the first time downloads it)…' : null)
  const location = st.path ? pretty(st.path) : view?.sheets.length ? `${st.untitled} · not saved yet` : ''

  return (
    <div
      className="k-app kf-app"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerDown={(e) => (e.target as HTMLElement).tagName === 'CANVAS' && rootRef.current?.focus()}
    >
      <div className="k-toolbar kf-toolbar">
        <button className="k-icon-btn" title={`Open (${MOD}O)`} onClick={after(() => openDialog(doc, saveDoc))}>
          <FolderOpen size={16} />
        </button>
        <button className="k-icon-btn" title={`Save (${MOD}S)`} disabled={!view?.sheets.length} onClick={after(saveDoc)}>
          <Save size={16} />
        </button>
        <span className="kf-sep" />
        <button className="k-icon-btn" title={`Undo (${MOD}Z)`} disabled={!st.canUndo} onClick={() => void doc.call('undo')}>
          <Undo2 size={16} />
        </button>
        <button className="k-icon-btn" title="Redo" disabled={!st.canRedo} onClick={() => void doc.call('redo')}>
          <Redo2 size={16} />
        </button>
        <span className="kf-sep" />
        <select className="k-input kf-sheet-select" value={view?.sheet ?? ''} disabled={!view?.sheets.length} onChange={(e) => selectSheet(e.target.value)} aria-label="Core level">
          {!view?.sheets.length && <option value="">No file</option>}
          {view?.sheets.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <span className="kf-sep" />
        <button className="k-icon-btn" title="Zoom in" onClick={() => zoomBy(1 / 1.5)}>
          <ZoomIn size={16} />
        </button>
        <button className="k-icon-btn" title="Zoom out" onClick={() => zoomBy(1.5)}>
          <ZoomOut size={16} />
        </button>
        <button className="k-icon-btn" title="Whole spectrum (Home)" onClick={() => setZoom({ x: null, y: null })}>
          <Maximize2 size={16} />
        </button>
        <button className={`k-icon-btn${showResiduals ? ' active' : ''}`} title="Residuals" onClick={() => setShowResiduals(!showResiduals)}>
          <Activity size={16} />
        </button>
        <button
          className={`k-icon-btn${addMode ? ' active' : ''}`}
          title="Add peaks by clicking on the plot (double-click always works)"
          disabled={!view?.background?.type}
          onClick={() => setAddMode(!addMode)}
        >
          <MousePointerClick size={16} />
        </button>
        <span className="kf-grow" />
        <button className="k-btn primary" disabled={!view?.grid.length || working} onClick={() => void fit(1)}>
          Fit
        </button>
      </div>

      <div className="kf-main">
        {view?.sheets.length ? (
          <Controls view={view} limits={limits} selected={selected} busy={working} actions={actions} />
        ) : null}
        <div className="kf-center">
          {view && view.x?.length ? (
            <>
              <Plot
                view={view}
                selected={selected}
                limits={limits}
                showResiduals={showResiduals}
                addMode={addMode}
                zoom={zoom}
                onZoom={(z) => setZoom({ x: z.x ? ordered(z.x.min, z.x.max) : null, y: z.y })}
                onSelect={(p) => doc.set({ selected: p })}
                onLimits={onLimits}
                onPeakDrag={onPeakDrag}
                onAdd={(x, y) => void addPeak({ x, y })}
                onContextMenu={plotMenu}
              />
              <div className="kf-hsplit" onPointerDown={(e) => resize(e, 'y')} />
              <div className="kf-bottom" style={{ height: bottomH }}>
                <div className="kf-peaks" style={{ width: `${100 - resultsW}%` }}>
                  <PeakTable grid={view.grid} selected={selected} onSelect={(p) => doc.set({ selected: p })} onEdit={editCell} compact={false} />
                </div>
                <div className="kf-vsplit" onPointerDown={(e) => resize(e, 'x')} />
                <div className="kf-res" style={{ width: `${resultsW}%` }}>
                  <ResultsTable
                    rows={view.results}
                    tableKey={view.resultsKey}
                    onExport={exportResults}
                    onToggle={(key, checked) => void doc.call('results_set', { key, field: 'checked', value: checked })}
                    onSet={(key, field, value) => void doc.call('results_set', { key, field, value })}
                    onDelete={(keys) => void doc.call('results_delete', { keys })}
                  />
                </div>
              </div>
            </>
          ) : (
            <Welcome
              starting={status === 'starting' || status === 'off'}
              examples={examples}
              onOpen={after(() => openDialog(doc, saveDoc))}
              onImport={after(() => openDialog(doc, saveDoc, IMPORT_TYPES))}
              onExample={(file, title) => void openExample(doc, file, title, saveDoc)}
            />
          )}
        </div>
      </div>

      <div className="k-statusbar kf-status">
        {(working || message) && <LoaderCircle size={13} className="kf-spin" />}
        <span className={st.message?.error ? 'kf-error' : ''}>{st.message?.text ?? message ?? (working ? 'Working…' : STATUS[status])}</span>
        <span className="kf-grow" />
        {view?.fit && view.fit.r2 !== null && (
          <span title={view.fit.text}>
            R² {view.fit.r2.toFixed(5)} · Red. χ² {view.fit.redChi2.toFixed(2)} · {view.fit.nfev} evaluations
          </span>
        )}
        {location && <span className="kf-path">{location}</span>}
      </div>
    </div>
  )
}

const DEFAULT_SETTINGS = {
  model: 'SGL (Area)', method: 'Smart', maxIterations: 200, optimization: 'least_squares', weights: 'uniform', photons: 1486.67,
  instrument: 'A-ALTHERMO1', libraryType: 'TPP-2M', averagingPoints: 5, workfunction: 0, instruments: [],
}

function Welcome(props: {
  starting: boolean
  examples: ExampleMenu[] | 'loading' | 'error'
  onOpen: () => void
  onImport: () => void
  onExample: (file: string, title: string) => void
}) {
  const picks = Array.isArray(props.examples)
    ? props.examples.flatMap((m) => [...m.items, ...m.groups.flatMap((g) => g.items)]).filter((x) => /Carbon SP2|Fe2O3|TiO2|SiO2|Pt4f|Mo/.test(x.file)).slice(0, 6)
    : []
  return (
    <div className="kf-welcome">
      <h2>KherveFitting</h2>
      <p>XPS peak fitting with the desktop KherveFitting's own engine.</p>
      <div className="kf-buttons">
        <button className="k-btn primary" onClick={props.onOpen}>
          Open Workbook…
        </button>
        <button className="k-btn" onClick={props.onImport}>
          Import VAMAS / CSV…
        </button>
      </div>
      {picks.length > 0 && (
        <>
          <p className="kf-note">Or start from an example (Examples menu for all of them):</p>
          <div className="kf-picks">
            {picks.map((x) => (
              <button key={x.file} className="k-btn" onClick={() => props.onExample(x.file, x.title)}>
                {x.title}
              </button>
            ))}
          </div>
        </>
      )}
      {props.starting && <p className="kf-note">Python is starting in this window (the first time it is downloaded, ~10 MB, then cached).</p>}
    </div>
  )
}
