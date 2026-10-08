// kTGA: thermogravimetry and DSC. The analysis is KherveFitting-AI's own (its TGA code runs
// unchanged in Python, through the technique engine of src/apps/khervetech); the window is
// kTGA's own design on the OS theme: the sheets on the left, the plot in the middle and the
// TGA / DSC Analysis (Range, Mass, DTG, DSC, Heat Flow, Events, Chemistry, Cycles, Isothermal,
// Compare) docked on the right. Checklist: docs/parity/khervetga.md.

import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from 'zustand'
import {
  BarChart3, ChevronDown, Download, FileDown, FlaskConical, FolderOpen, Hand, Maximize2, PanelRightClose, PanelRightOpen,
  Redo2, Save, Table2, Thermometer, Undo2, Upload, ZoomIn,
} from 'lucide-react'
import { os, fs, type AppProps, type MenuItem } from '@/os'
import type { MenuBarMenu } from '@/os/ui/Menu'
import { useAppTools } from '@/os/ai/appTools'
import { HOME, basename, dirname, extname, join, pretty } from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import { TechDoc } from '@/apps/khervetech/doc'
import { FigurePlot, type Limits, type PlotMode } from '@/apps/khervetech/FigurePlot'
import { mainAxes } from '@/apps/khervetech/figmath'
import { FrameBody, ModalFrame, TechFloat } from '@/apps/khervetech/frames'
import type { WxMsg } from '@/apps/khervetech/WxUI'
import type { ModalAnswer, ModalSpec, WxNode } from '@/apps/khervetech/types'
import { appForSheets, isSheetOf, techApp } from '@/apps/khervetech/spec'
import { examplesDir, seedExamples } from '@/apps/khervetech/TechApp'
import { techAiTools } from '@/apps/khervetech/aiTools'
import { TGA_ACTIONS } from './actions'
import './khervetga.css'

const SPEC = techApp('khervetga')
const EXAMPLES = examplesDir(SPEC)

/** What a sheet holds, from the names the desktop gives them (TGA, TGA~Mass, TGA~DTG…). */
function sheetKind(name: string): string {
  const part = name.split('~')[1]?.toLowerCase() ?? ''
  if (!part) return 'Measured run'
  if (part.startsWith('mass')) return 'Mass vs temperature'
  if (part.startsWith('dtg')) return 'Derivative (DTG)'
  if (part.startsWith('dsc')) return 'DSC'
  if (part.startsWith('blank') || part.startsWith('corr')) return 'Blank correction'
  if (part.startsWith('iso')) return 'Isothermal'
  if (part.startsWith('cyc')) return 'Cycles'
  return part.charAt(0).toUpperCase() + part.slice(1)
}

export default function KherveTGA({ win, args }: AppProps) {
  const doc = useMemo(() => new TechDoc(`khervetga-${win.id}`, SPEC.tech, SPEC.name), [win.id])
  const st = useStore(doc.store)
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [examples, setExamples] = useState<string[]>([])
  const [modal, setModal] = useState<{ spec: ModalSpec; done: (a: ModalAnswer) => void } | null>(null)
  const [limitsBySheet, setLimitsBySheet] = useState<Record<string, Limits>>({})
  const [mode, setMode] = useState<PlotMode>('none')
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [panelW, setPanelW] = useState(520)
  const [panelOpen, setPanelOpen] = useState(true)
  const [bounds, setBounds] = useState({ w: 1200, h: 700 })
  const [order, setOrder] = useState<number[]>([])
  /** The analysis window docked on the right (the first window the engine opened for "tool"). */
  const [dockId, setDockId] = useState<number | null>(null)
  const wantDock = useRef(false)
  const pending = useRef(new Map<number, unknown>()).current
  const live = useRef<{ which: number; x: number } | null>(null)
  const liveFlying = useRef(false)

  const sheet = st.sheet
  const main = mainAxes(st.fig)
  const hasData = !!sheet && !!main
  const info = st.info

  // ---------------------------------------------------------- start-up
  useEffect(() => {
    doc.onModalDialog = (m, done) => setModal({ spec: m, done: (a) => { setModal(null); done(a) } })
    doc.onEffect = (e) => {
      if (e.kind === 'opened' && e.path) setLimitsBySheet({})
      else if (e.kind === 'raise' && typeof e.frame === 'number') {
        const id = e.frame
        setOrder((o) => [...o.filter((x) => x !== id), id])
      } else if (e.kind === 'tip') doc.flash([e.title, e.message].filter(Boolean).join(': '), e.icon === 'error')
    }
    let alive = true
    void seedExamples(SPEC).then((files) => alive && setExamples(files))
    void (async () => {
      const ok = await doc.start()
      if (alive && ok && typeof args.path === 'string') await openPath(args.path, true)
    })()
    return () => {
      alive = false
      doc.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBounds({ w: el.clientWidth, h: el.clientHeight - 60 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Windows of the engine: the first one opened for the analysis is docked, the others float.
  useEffect(() => {
    if (wantDock.current && dockId === null) {
      const first = st.open.find((id) => st.frames[id])
      if (first !== undefined) {
        setDockId(first)
        wantDock.current = false
      }
    }
    if (dockId !== null && !st.open.includes(dockId)) setDockId(null)
    setOrder((cur) => [...cur.filter((id) => st.open.includes(id)), ...st.open.filter((id) => !cur.includes(id))])
  }, [st.open, st.frames, dockId])

  useEffect(() => win.setTitle(st.file ? `kTGA — ${basename(st.file)}` : 'kTGA'), [win, st.file])
  useEffect(() => win.setDocumentPath(st.file || null), [win, st.file])

  // ---------------------------------------------------------- the analysis panel
  /** Show the analysis (docked), at one of its tabs if `section` is given. */
  const showAnalysis = async (section?: string) => {
    setPanelOpen(true)
    // the docked window has every tab: go to that tab rather than opening a window of its own
    const dock = dockId !== null ? doc.state.frames[dockId] : undefined
    if (dock) {
      if (!section) return
      const s = doc.state.info?.sections.find((x) => x.key === section)
      const book = dock.sizer ? findNotebook(dock.sizer) : null
      const want = [section, s?.short, s?.full.replace(/^.*?:\s*/, '')].filter(Boolean).map((x) => x!.toLowerCase())
      const i = book?.pages?.findIndex((p) => want.includes(p.title.toLowerCase())) ?? -1
      if (book && i >= 0) return i === book.sel ? undefined : sendWx({ id: book.id!, type: 'tab', sel: i })
    }
    if (dockId === null) wantDock.current = true
    await doc.call('tool', section ? { section } : {})
  }

  // ---------------------------------------------------------- files
  const openPath = async (path: string, startup = false) => {
    const a = await doc.call('open', { path })
    if (!a.ok) return false
    const sheets = doc.state.sheets
    const other = appForSheets(sheets)
    if (!sheets.some((s) => isSheetOf(SPEC, s)) && other && other.appId !== SPEC.appId && extname(path).toLowerCase() === '.kfit') {
      if (startup) {
        os.open(other.appId, { path })
        win.close()
        return true
      }
      if (await os.dialog.confirm(`"${basename(path)}" holds ${other.prefix} sheets. Open it in ${other.name}?`, { title: 'kTGA', okLabel: `Open in ${other.name}` })) os.open(other.appId, { path })
      return true
    }
    if (dockId === null) await showAnalysis()
    return true
  }
  const openDialog = async () => {
    const path = await os.dialog.openFile({ title: 'Open a TGA file', extensions: ['.kfit', ...SPEC.exts], startDir: st.file ? dirname(st.file) : EXAMPLES })
    if (path) await openPath(path)
  }
  const upload = async () => {
    const got = await os.upload(`${HOME}/Documents/kTGA`)
    if (got[0]) await openPath(got[0])
  }
  const save = async (as = false) => {
    if (!st.sheets.length) return
    let path: string | null = as || !st.file ? null : st.file
    if (!path) {
      path = await os.dialog.saveFile({ title: 'Save the project (.kfit)', defaultName: st.file || `${HOME}/Documents/kTGA/TGA_Data.kfit`, extensions: ['.kfit'] })
      if (!path) return
    }
    const a = await doc.call('save', path === st.file ? {} : { path })
    if (a.ok) doc.flash(`Saved ${pretty(String(a.path))}`)
  }
  const fileStem = () => `${st.file ? dirname(st.file) : `${HOME}/Documents/kTGA`}/${sheet.replace(/[^\w.-]+/g, '_')}`
  const exportTable = async () => {
    if (!hasData) return
    const a = await doc.call('table', { sheet })
    const t = a.table as { columns: string[]; data: (number | null)[][] } | undefined
    if (!a.ok || !t) return
    const n = Math.max(0, ...t.data.map((c) => c.length))
    const lines = [t.columns.join(',')]
    for (let i = 0; i < n; i++) lines.push(t.data.map((c) => (c[i] ?? '') + '').join(','))
    const path = await os.dialog.saveFile({ title: 'Export the sheet as CSV', defaultName: `${fileStem()}.csv`, extensions: ['.csv'] })
    if (path) await fs.writeText(path, lines.join('\n') + '\n', { mkdirs: true })
  }
  const plotSvg = () => {
    const svg = bodyRef.current?.querySelector('.tg-plot svg')
    if (!svg) return null
    const text = new XMLSerializer().serializeToString(svg)
    return { el: svg as SVGSVGElement, text: text.includes('xmlns=') ? text : text.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"') }
  }
  const exportPlot = async (fmt: 'svg' | 'png') => {
    const svg = plotSvg()
    if (!svg) return
    const path = await os.dialog.saveFile({ title: `Export the plot as ${fmt.toUpperCase()}`, defaultName: `${fileStem()}.${fmt}`, extensions: [`.${fmt}`] })
    if (!path) return
    if (fmt === 'svg') return void (await fs.writeText(path, svg.text, { mkdirs: true }))
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg.text], { type: 'image/svg+xml' }))
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('The plot could not be drawn.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = svg.el.width.baseVal.value * 2
    canvas.height = svg.el.height.baseVal.value * 2
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (blob) await fs.writeBytes(path, new Uint8Array(await blob.arrayBuffer()), { mkdirs: true })
  }

  // ---------------------------------------------------------- sheets
  const selectSheet = (name: string) => void doc.call('select', { sheet: name })
  const renameSheet = async (name: string) => {
    const to = await os.dialog.prompt('New name for the sheet (one word):', { title: 'Rename Sheet', defaultValue: name })
    if (!to || to === name) return
    if (to.trim().split(/\s+/).length > 1) return void os.dialog.alert('A sheet name is a single word.', { title: 'Rename Sheet' })
    await doc.call('sheet', { action: 'rename', sheet: name, name: to.trim() })
  }
  const deleteSheet = async (name: string) => {
    if (await os.dialog.confirm(`Delete the sheet "${name}" from the project?`, { title: 'Delete Sheet', danger: true, okLabel: 'Delete' })) await doc.call('sheet', { action: 'delete', sheet: name })
  }
  const sheetMenu = (e: React.MouseEvent, name: string) => {
    e.preventDefault()
    os.contextMenu(e, [
      { label: 'Show', onClick: () => selectSheet(name) },
      { label: 'Rename…', onClick: () => void renameSheet(name) },
      { label: 'Duplicate', onClick: () => void doc.call('sheet', { action: 'copy', sheet: name }) },
      '-',
      { label: 'Delete…', danger: true, onClick: () => void deleteSheet(name) },
    ])
  }

  // ---------------------------------------------------------- the plot
  const figLimits = (): Limits | null => {
    if (!main) return null
    const [a, b] = [main.xlim[0] ?? 0, main.xlim[1] ?? 1]
    const [c, d] = [main.ylim[0] ?? 0, main.ylim[1] ?? 1]
    return { xmin: Math.min(a, b), xmax: Math.max(a, b), ymin: Math.min(c, d), ymax: Math.max(c, d) }
  }
  const limits = (sheet ? limitsBySheet[sheet] : null) ?? figLimits()
  const setLimits = (l: Limits) => sheet && setLimitsBySheet((m) => ({ ...m, [sheet]: l }))
  const resetLimits = () => sheet && setLimitsBySheet((m) => {
    const n = { ...m }
    delete n[sheet]
    return n
  })
  const pumpLive = async () => {
    if (liveFlying.current || !live.current) return
    const job = live.current
    live.current = null
    liveFlying.current = true
    await doc.call('vline', { which: job.which, x: job.x, final: false })
    liveFlying.current = false
    void pumpLive()
  }
  const onVline = (which: number, x: number, final: boolean) => {
    if (final) {
      live.current = null
      void doc.call('vline', { which, x, final: true })
      return
    }
    live.current = { which, x }
    void pumpLive()
  }

  const sendWx = (m: WxMsg) => {
    const sync = Object.fromEntries(pending)
    pending.clear()
    void doc.call('event', { msg: { ...m, sync } })
  }

  // ---------------------------------------------------------- menus
  const importItems: MenuItem[] = (info?.imports ?? []).map((x) => (x === '-' ? '-' : { label: x.label, onClick: () => void doc.call('menu', { id: x.id }) }))
  const exampleItems: MenuItem[] = examples.map((f) => ({ label: f.replace(/\.[^.]+$/, '').replace(/_/g, ' '), onClick: () => void openPath(join(EXAMPLES, f)) }))
  const sectionItems: MenuItem[] = (info?.sections ?? []).map((s) => ({ label: s.full, disabled: !st.sheets.length, onClick: () => void showAnalysis(s.key) }))
  const menus: MenuBarMenu[] = [
    {
      label: 'File',
      items: [
        { label: 'Open…', shortcut: '⌘O', onClick: () => void openDialog() },
        { label: 'Import', submenu: importItems, disabled: !importItems.length },
        { label: 'Examples', submenu: exampleItems, disabled: !exampleItems.length },
        { label: 'Upload from this computer…', onClick: () => void upload() },
        '-',
        { label: 'Save', shortcut: '⌘S', disabled: !st.sheets.length, onClick: () => void save() },
        { label: 'Save As…', disabled: !st.sheets.length, onClick: () => void save(true) },
        '-',
        { label: 'Export sheet as CSV…', disabled: !hasData, onClick: () => void exportTable() },
        { label: 'Export plot as SVG…', disabled: !hasData, onClick: () => void exportPlot('svg') },
        { label: 'Export plot as PNG…', disabled: !hasData, onClick: () => void exportPlot('png') },
        '-',
        { label: 'New Project', onClick: () => void doc.call('new') },
        { label: 'Show in Files', disabled: !st.file, onClick: () => os.open('files', { path: dirname(st.file) }) },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: '⌘Z', disabled: !st.canUndo, onClick: () => void doc.call('undo') },
        { label: 'Redo', shortcut: '⇧⌘Z', disabled: !st.canRedo, onClick: () => void doc.call('redo') },
        '-',
        { label: 'Rename Sheet…', disabled: !hasData, onClick: () => void renameSheet(sheet) },
        { label: 'Delete Sheet…', disabled: !hasData, onClick: () => void deleteSheet(sheet) },
      ],
    },
    {
      label: 'Analysis',
      items: [
        { label: panelOpen ? 'Hide the Analysis Panel' : 'Show the Analysis Panel', disabled: !st.sheets.length, onClick: () => (panelOpen ? setPanelOpen(false) : void showAnalysis()) },
        '-',
        ...sectionItems,
      ],
    },
  ]
  const menuKey = JSON.stringify(menus, (_k, v) => (typeof v === 'function' ? 1 : v))
  useEffect(() => win.setMenus(menus), [win, menuKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => win.setMenus(null), [win])

  useAppTools(win, techAiTools({ doc, spec: SPEC, actions: TGA_ACTIONS, open: openPath, examples: () => seedExamples(SPEC), examplesDir: EXAMPLES }))

  // ---------------------------------------------------------- keyboard, drops, the sash
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
    const cmd = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    const run = cmd && k === 'o' ? openDialog : cmd && k === 's' ? () => save() : cmd && k === 'z' ? () => doc.call(e.shiftKey ? 'redo' : 'undo') : null
    if (!run) return
    e.preventDefault()
    void run()
  }
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = (e: DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    e.preventDefault()
    try {
      const paths = (JSON.parse(raw) as string[]).filter((p) => ['.kfit', ...SPEC.exts].includes(extname(p).toLowerCase()))
      if (paths.length) void openPath(paths[0])
    } catch {
      /* not a list of paths */
    }
  }
  const onSash = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startX = e.clientX
    const startW = panelW
    const box = bodyRef.current?.getBoundingClientRect()
    const max = box ? box.width - 380 : 900
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setPanelW(Math.max(340, Math.min(max, startW - (ev.clientX - startX))))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('k-dragging')
    }
    document.body.classList.add('k-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---------------------------------------------------------- view
  const working = st.busy > 0 || !st.ready
  const message = st.message?.text ?? st.loading ?? st.progress ?? (!st.ready ? 'Starting the analysis engine (the first time downloads Python)…' : null)
  const dock = dockId !== null ? st.frames[dockId] : undefined
  const xIsTemp = /temp|°c|\(k\)/i.test(main?.xlabel ?? '')

  return (
    <div className="k-app kf-app kt-app tg-app" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} onDragOver={onDragOver} onDrop={onDrop}>
      <div className="k-toolbar tg-toolbar">
        <button className="k-btn" onClick={() => void openDialog()} disabled={!st.ready}><FolderOpen size={14} /> Open</button>
        <Drop label="Import" icon={<Upload size={14} />} items={importItems} disabled={!st.ready || !importItems.length} />
        <Drop label="Examples" icon={<FlaskConical size={14} />} items={exampleItems} disabled={!st.ready || !exampleItems.length} />
        <span className="tg-sep" />
        <button className="k-icon-btn" title="Save (⌘S)" disabled={!st.sheets.length} onClick={() => void save()}><Save size={15} /></button>
        <Drop
          label="Export"
          icon={<Download size={14} />}
          disabled={!hasData}
          items={[
            { label: 'Sheet as CSV…', onClick: () => void exportTable() },
            { label: 'Plot as SVG…', onClick: () => void exportPlot('svg') },
            { label: 'Plot as PNG…', onClick: () => void exportPlot('png') },
            '-',
            { label: 'Project as .kfit…', onClick: () => void save(true) },
          ]}
        />
        <span className="tg-sep" />
        <button className="k-icon-btn" title="Undo (⌘Z)" disabled={!st.canUndo} onClick={() => void doc.call('undo')}><Undo2 size={15} /></button>
        <button className="k-icon-btn" title="Redo (⇧⌘Z)" disabled={!st.canRedo} onClick={() => void doc.call('redo')}><Redo2 size={15} /></button>
        <div className="tg-grow" />
        {st.file && <span className="tg-file" title={pretty(st.file)}>{basename(st.file)}</span>}
        <button
          className={`k-icon-btn${panelOpen ? ' tg-on' : ''}`}
          title={panelOpen ? 'Hide the analysis panel' : 'Show the analysis panel'}
          disabled={!st.sheets.length}
          onClick={() => (panelOpen ? setPanelOpen(false) : void showAnalysis())}
        >
          {panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
      </div>

      <div className="tg-body" ref={bodyRef}>
        <aside className="tg-side">
          <div className="tg-side-title">Sheets</div>
          {st.sheets.length === 0 && <div className="tg-side-empty">No data yet.</div>}
          {st.sheets.map((s) => (
            <button key={s} className={`tg-sheet${s === sheet ? ' tg-sel' : ''}${s.includes('~') ? ' tg-derived' : ''}`} onClick={() => selectSheet(s)} onContextMenu={(e) => sheetMenu(e, s)} title={s}>
              {s.includes('~') ? <Table2 size={13} /> : <Thermometer size={13} />}
              <span className="tg-sheet-name">{s.includes('~') ? s.split('~').slice(1).join('~') : s}</span>
              <span className="tg-sheet-kind">{sheetKind(s)}</span>
            </button>
          ))}
          {info && st.sheets.length > 0 && (
            <>
              <div className="tg-side-title">Analyses</div>
              <div className="tg-steps">
                {info.sections.map((s, i) => (
                  <button key={s.key} className="tg-step" title={s.help} onClick={() => void showAnalysis(s.key)}>
                    <span className="tg-step-n">{i + 1}</span>
                    {s.full.replace(/^.*?:\s*/, '')}
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        <main className="tg-main">
          {hasData ? (
            <>
              <div className="tg-plot-head">
                <div className="tg-plot-title">
                  <b>{sheet}</b>
                  <span>{sheetKind(sheet)}</span>
                </div>
                <div className="tg-plot-tools">
                  <button className={`k-icon-btn${mode === 'zoom' ? ' tg-on' : ''}`} title="Zoom: drag a box" onClick={() => setMode((m) => (m === 'zoom' ? 'none' : 'zoom'))}><ZoomIn size={15} /></button>
                  <button className={`k-icon-btn${mode === 'drag' ? ' tg-on' : ''}`} title="Pan" onClick={() => setMode((m) => (m === 'drag' ? 'none' : 'drag'))}><Hand size={15} /></button>
                  <button className="k-icon-btn" title="Fit the whole curve" onClick={() => { setMode('none'); resetLimits() }}><Maximize2 size={15} /></button>
                  <button className="k-icon-btn" title="Export the plot as PNG" onClick={() => void exportPlot('png')}><FileDown size={15} /></button>
                </div>
              </div>
              <div className="tg-plot">
                <FigurePlot
                  fig={st.fig}
                  arrays={doc.arrays}
                  limits={limits}
                  vlines={st.vlines}
                  rangeActive={st.rangeActive}
                  mode={mode}
                  onLimits={setLimits}
                  onModeDone={() => setMode('none')}
                  onCursor={setCursor}
                  onVline={onVline}
                />
              </div>
              {st.rangeActive && <div className="tg-plot-hint">Drag the red dashed lines to choose the range the analysis works on.</div>}
            </>
          ) : (
            <Welcome ready={st.ready} examples={examples} onOpen={() => void openDialog()} onExample={(f) => void openPath(join(EXAMPLES, f))} />
          )}
        </main>

        {panelOpen && st.sheets.length > 0 && (
          <>
            <div className="tg-sash" onPointerDown={onSash} />
            <section className="tg-panel" style={{ width: panelW }}>
              <div className="tg-panel-head">
                <BarChart3 size={14} />
                <span>{dock?.title ?? 'TGA / DSC Analysis'}</span>
              </div>
              <div className="tg-panel-body">
                {dock ? <FrameBody key={dock.id} frame={dock} arrays={doc.arrays} pending={pending} send={sendWx} /> : <div className="tg-panel-wait">Opening the analysis…</div>}
              </div>
            </section>
          </>
        )}
      </div>

      <div className="k-statusbar tg-status">
        <span className={st.message?.error ? 'tg-error' : ''}>
          {working && <span className="tg-spin" />}
          {message ?? (st.file ? pretty(st.file) : 'Open a TGA, STA or TRIOS file, or try an example.')}
        </span>
        {cursor && hasData && (
          <span className="tg-cursor">
            {xIsTemp ? 'T' : 'x'} = {cursor.x.toFixed(2)} · y = {cursor.y.toFixed(3)}
          </span>
        )}
      </div>

      {order.filter((id) => id !== dockId).map((id, z) => {
        const f = st.frames[id]
        if (!f) return null
        return <TechFloat key={id} frame={f} arrays={doc.arrays} z={z} bounds={bounds} pending={pending} onFront={() => setOrder((o) => [...o.filter((x) => x !== id), id])} send={sendWx} />
      })}
      {modal && <ModalFrame spec={modal.spec} arrays={doc.arrays} done={modal.done} />}
    </div>
  )
}

/** The first notebook (the analysis tabs) of a window's widgets. */
function findNotebook(n: WxNode): WxNode | null {
  if (n.pages) return n
  for (const c of [n.sizer, ...(n.items ?? []).map((i) => i.n)]) {
    const f = c ? findNotebook(c) : null
    if (f) return f
  }
  return null
}

/** A toolbar button with a menu. */
function Drop({ label, icon, items, disabled }: { label: string; icon: React.ReactNode; items: MenuItem[]; disabled?: boolean }) {
  return (
    <button
      className="k-btn"
      disabled={disabled}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        os.contextMenu({ clientX: r.left, clientY: r.bottom + 2 }, items)
      }}
    >
      {icon} {label} <ChevronDown size={12} />
    </button>
  )
}

function Welcome({ ready, examples, onOpen, onExample }: { ready: boolean; examples: string[]; onOpen: () => void; onExample: (f: string) => void }) {
  return (
    <div className="tg-welcome">
      <div className="tg-welcome-icon"><Thermometer size={34} /></div>
      <h2>kTGA</h2>
      <p>Thermogravimetry and DSC: mass steps, DTG peaks, DSC enthalpies, heat flow and glass transitions, events, redox cycles and isothermal kinetics.</p>
      <button className="k-btn tg-primary" onClick={onOpen} disabled={!ready}><FolderOpen size={14} /> Open a file…</button>
      <div className="tg-formats">.kfit projects · Netzsch / STA .csv and .txt · TA TRIOS .tri</div>
      {examples.length > 0 && (
        <div className="tg-examples">
          <div className="tg-side-title">Try an example</div>
          {examples.map((f) => (
            <button key={f} className="tg-example" disabled={!ready} onClick={() => onExample(f)}>
              <FlaskConical size={14} />
              {f.replace(/\.[^.]+$/, '').replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}
      {!ready && <div className="tg-formats"><span className="tg-spin" /> Starting the analysis engine…</div>}
    </div>
  )
}
