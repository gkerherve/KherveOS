// A technique app (KherveTGA, KherveBET…): the desktop KherveFitting-AI main
// window as it looks and behaves on a sheet of that technique.
//
// On such a sheet the desktop (Sheet_Operations.on_sheet_selected) slims the
// main toolbar to the common tools (TechniqueToolbar.apply_technique_toolbar:
// the XPS tools come off, separators stay), adds the technique button
// (TechniqueTool) and one tile per section of the technique's analysis
// window, and replaces the Peak Parameters / Results grids of the right frame
// by the technique overview (TechniqueOverview: companion plot, sheet chips,
// quick actions, info). The vertical plot toolbar, the plot, the status bar
// and the menus stay those of KherveFitting. Here the technique is fixed for
// the app, and every window the desktop opens (the analysis window, its
// sections) is the desktop's own wx code running in Python, drawn by WxUI.

import './khervetech.css'
import '@/apps/khervefitting/khervefitting.css'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { os, fs, type AppProps, type MenuItem } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { HOME, basename, dirname, extname, join, pretty } from '@/os/path'
import { DRAG_MIME } from '@/os/fileActions'
import { buildMenus, type Handlers } from '@/apps/khervefitting/menus'
import { MAIN_TOOLBAR, SHEET_HELP, type ToolSpec } from '@/apps/khervefitting/toolbarSpec'
import { ICONS as KF_ICONS, PlotToolbar, TogglePopup, type ToolState } from '@/apps/khervefitting/Toolbars'
import { FACTORY_GRID_RGB, FACTORY_THEME, themeVars } from '@/apps/khervefitting/theme'
import { PlotLimitsWindow } from '@/apps/khervefitting/windows'
import { SHORTCUTS_TEXT, adjustLimits, keyAction, type EdgeAxis } from '@/apps/khervefitting/interaction'
import { AboutView } from '@/apps/khervefitting/dialogs'
import { FigurePlot, type Limits, type PlotMode } from './FigurePlot'
import { TechDoc } from './doc'
import { mainAxes } from './figmath'
import { TechFloat, ModalFrame } from './frames'
import { WxProvider, WxView, type WxMsg } from './WxUI'
import { TECH_TOOL_AFTER, XPS_ONLY_TOOLS, appForSheets, isSheetOf, type TechAppSpec } from './spec'
import { techAiTools } from './aiTools'
import type { ActionTable } from './actions'
import type { ModalAnswer, ModalSpec } from './types'

export const TECH_ICONS = `${import.meta.env.BASE_URL}apps/khervetech/icons/`
const MAC = /Mac|iPhone|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')
const CORE_SOURCE = 'KherveFitting-AI v1.93 (KherveFittingPro dev-AI)'
const KF_LINKS: Record<string, string> = {
  paper: 'http://doi.org/10.1002/sia.70032',
  videos: 'https://www.youtube.com/@xpsexamples-imperialcolleg6571',
  website: 'https://www.khervetools.com',
}

export const examplesDir = (spec: TechAppSpec) => `${HOME}/Documents/${spec.name} Examples`

/** Copy the example files into ~/Documents/<App> Examples once (Files then opens them with the app). */
export async function seedExamples(spec: TechAppSpec): Promise<string[]> {
  const flag = `${spec.appId}.examples`
  const dir = examplesDir(spec)
  const base = `${import.meta.env.BASE_URL}examples/${spec.examples}/`
  try {
    const r = await fetch(`${base}index.json`, { cache: 'no-cache' })
    if (!r.ok) return []
    const index = (await r.json()) as { examples: { file: string; title: string }[] }
    const files = index.examples.map((e) => e.file).filter((f) => !f.includes('/') && !f.includes('..'))
    if (localStorage.getItem(flag) && fs.exists(dir)) return files
    for (const file of files) {
      const target = join(dir, file)
      if (fs.exists(target)) continue
      const f = await fetch(base + encodeURIComponent(file))
      if (f.ok) await fs.writeBytes(target, new Uint8Array(await f.arrayBuffer()), { mkdirs: true })
    }
    localStorage.setItem(flag, '1')
    return files
  } catch {
    return [] // offline: try again next time
  }
}

// ------------------------------------------------------------------ toolbar

interface TechToolbarProps {
  info: { icon: string; help: string; sections: { key: string; short: string; full: string; help: string }[] } | null
  technique: { icon: string; help: string } | null
  sheets: string[]
  sheet: string
  states: Record<string, ToolState>
  onSheet: (s: string) => void
  onTool: (id: string, el: HTMLElement) => void
  onTech: () => void
  onSection: (key: string) => void
}

/** The main toolbar in the technique's slim form (apply_technique_toolbar). */
function TechToolbar({ info, technique, sheets, sheet, states, onSheet, onTool, onTech, onSection }: TechToolbarProps) {
  const out: ReactNode[] = []
  const tool = (s: ToolSpec, k: number) => {
    const st = states[s.id!]
    return (
      <button key={k} type="button" className={`kf-tool${st?.checked ? ' kf-checked' : ''}`} title={s.help} aria-label={s.label} disabled={st?.disabled} onClick={(e) => onTool(s.id!, e.currentTarget)}>
        <img src={KF_ICONS + s.icon} width={25} height={25} alt="" draggable={false} />
      </button>
    )
  }
  MAIN_TOOLBAR.forEach((s, k) => {
    if (s.sep) out.push(<span key={k} className="kf-vsep" />)
    else if (s.stretch) out.push(<span key={k} className="kf-grow" />)
    else if (s.control === 'sheet')
      out.push(
        <span key={k} className="kf-control">
          <select className="kf-combo" value={sheet} title={SHEET_HELP} onChange={(e) => onSheet(e.target.value)} disabled={!sheets.length} aria-label="Sheet selector">
            {!sheets.length && <option value="" />}
            {sheets.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </span>,
      )
    else if (s.control || XPS_ONLY_TOOLS.has(s.id!)) {
      /* off the bar in a technique mode */
    } else out.push(tool(s, k))
    if (s.id === TECH_TOOL_AFTER && info) {
      const icon = technique?.icon ?? info.icon
      out.push(
        <button key="tech" type="button" className="kf-tool" title={technique?.help ?? info.help} aria-label="Technique Tool" onClick={onTech}>
          <img src={TECH_ICONS + icon} width={25} height={25} alt="" draggable={false} />
        </button>,
      )
      info.sections.forEach((sec, i) =>
        out.push(
          <button key={`sec-${sec.key}`} type="button" className="kf-tool" title={sec.help} aria-label={sec.full} onClick={() => onSection(sec.key)}>
            <span className={`kt-tile${i % 2 === 0 ? ' kt-tile-green' : ''}`}>{sec.short}</span>
          </button>,
        ),
      )
    }
  })
  return <div className="kf-toolbar">{out}</div>
}

/** The wx id a dialog button answers with (OK / Cancel / Yes / No by label). */

// ------------------------------------------------------------------ the app

export function TechApp({ win, args, spec, actions }: AppProps & { spec: TechAppSpec; actions?: ActionTable }) {
  const doc = useMemo(() => new TechDoc(`${spec.appId}-${win.id}`, spec.tech, spec.name), [win.id, spec])
  const st = useStore(doc.store)
  const rootRef = useRef<HTMLDivElement>(null)
  const [limitsBySheet, setLimitsBySheet] = useState<Record<string, Limits>>({})
  const [mode, setMode] = useState<PlotMode>('none')
  const [greenLine, setGreenLine] = useState<number | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [fontDelta, setFontDelta] = useState(0)
  const [plotLimitsOpen, setPlotLimitsOpen] = useState(false)
  const [toggles, setToggles] = useState<{ x: number; y: number } | null>(null)
  const [split, setSplit] = useState(800 / 1452)
  const [order, setOrder] = useState<number[]>([])
  const [modal, setModal] = useState<{ spec: ModalSpec; done: (a: ModalAnswer) => void } | null>(null)
  const [examples, setExamples] = useState<string[]>([])
  const [bounds, setBounds] = useState({ w: 1200, h: 700 })
  const lastPopup = useRef(0)
  const live = useRef<{ which: number; x: number } | null>(null)
  const liveFlying = useRef(false)
  const [legendOn, setLegendOn] = useState(true)
  const [yAxisState, setYAxisState] = useState(0)
  /** What the user typed in the tool windows and not yet sent (wx keeps it in the control until read). */
  const pending = useRef(new Map<number, unknown>()).current
  /** MyFrame.show_popup_message2: a balloon over the main window (wx.adv.RichToolTip). */
  const [tip, setTip] = useState<{ title: string; message: string; icon?: string } | null>(null)
  const tipTimer = useRef(0)
  const lastTip = useRef(0)

  const notReady = (what: string) => doc.flash(`${what} is not in the web edition yet.`)
  const sheet = st.sheet
  const fig = st.fig
  const main = mainAxes(fig)
  const hasData = !!sheet && !!main

  // ---------------------------------------------------------- start-up
  useEffect(() => {
    doc.onModalDialog = (m, done) => setModal({ spec: m, done: (a) => { setModal(null); done(a) } })
    doc.onEffect = (e) => {
      if (e.kind === 'opened' && e.path) setLimitsBySheet({})
      else if (e.kind === 'raise' && typeof e.frame === 'number') {
        const id = e.frame
        setOrder((o) => [...o.filter((x) => x !== id), id])
      } else if (e.kind === 'tip') {
        // on macOS the desktop shows at most one balloon every 5 s
        const now = Date.now()
        if (MAC && now - lastTip.current < 5000) return
        lastTip.current = now
        setTip({ title: e.title ?? '', message: e.message ?? '', icon: e.icon })
        window.clearTimeout(tipTimer.current)
        tipTimer.current = window.setTimeout(() => setTip(null), 7000)
      }
    }
    let alive = true
    // Python starts at once, in this window's own worker; the examples are copied meanwhile.
    void seedExamples(spec).then((files) => alive && setExamples(files))
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

  // frames: keep the engine's order, newly opened on top
  useEffect(() => {
    setOrder((cur) => [...cur.filter((id) => st.open.includes(id)), ...st.open.filter((id) => !cur.includes(id))])
  }, [st.open])

  useEffect(() => win.setTitle(st.file ? `${spec.name} — ${basename(st.file)}` : spec.name), [win, st.file, spec.name])
  useEffect(() => win.setDocumentPath(st.file || null), [win, st.file])

  // ---------------------------------------------------------- files
  /** Open a project or import a file; a project of another technique goes to its app (asked, unless this window was opened for it). */
  const openPath = async (path: string, startup = false) => {
    const a = await doc.call('open', { path })
    if (!a.ok) return false
    const sheets = doc.state.sheets
    const own = sheets.some((s) => isSheetOf(spec, s))
    const other = appForSheets(sheets)
    if (!own && other && other.appId !== spec.appId && extname(path).toLowerCase() === '.kfit') {
      if (startup) {
        os.open(other.appId, { path })
        win.close()
        return true
      }
      const go = await os.dialog.confirm(`"${basename(path)}" holds ${other.prefix} sheets. Open it in ${other.name}?`, { title: spec.name, okLabel: `Open in ${other.name}` })
      if (go) os.open(other.appId, { path })
    }
    return true
  }
  const openDialog = async () => {
    const path = await os.dialog.openFile({ title: 'Open KherveFitting HDF5 (.kfit)', extensions: ['.kfit'], startDir: st.file ? dirname(st.file) : examplesDir(spec) })
    if (path) await openPath(path)
  }
  const openFromComputer = async () => {
    const dir = `${HOME}/Documents/${spec.name}`
    const got = await os.upload(dir)
    if (got[0]) await openPath(got[0])
  }
  const quickSave = async () => {
    if (!st.file) return saveAs()
    const a = await doc.call('save', {})
    if (a.ok) doc.flash(`Saved ${pretty(String(a.path))}`)
  }
  const saveAs = async () => {
    if (!st.sheets.length) return
    const path = await os.dialog.saveFile({ title: 'Save As (.kfit)', defaultName: st.file || `${HOME}/Documents/${spec.name}/${spec.tech}_Data.kfit`, extensions: ['.kfit'] })
    if (path) {
      const a = await doc.call('save', { path })
      if (a.ok) doc.flash(`Saved ${pretty(String(a.path))}`)
    }
  }
  const exportTable = async (fmt: 'txt' | 'csv' | 'dat') => {
    if (!hasData) return
    const a = await doc.call('table', { sheet })
    const t = a.table as { columns: string[]; data: (number | null)[][] } | undefined
    if (!a.ok || !t) return
    const sep = fmt === 'csv' ? ',' : '\t'
    const n = Math.max(0, ...t.data.map((c) => c.length))
    const lines = [t.columns.join(sep)]
    for (let i = 0; i < n; i++) lines.push(t.data.map((c) => (c[i] === null || c[i] === undefined ? '' : String(c[i]))).join(sep))
    const path = await os.dialog.saveFile({ title: `Export data as ${fmt.toUpperCase()}`, defaultName: `${st.file ? dirname(st.file) : `${HOME}/Documents/${spec.name}`}/${sheet.replace(/[^\w.-]+/g, '_')}.${fmt}`, extensions: [`.${fmt}`] })
    if (path) await fs.writeText(path, lines.join('\n') + '\n', { mkdirs: true })
  }
  const plotSvg = () => {
    const svg = rootRef.current?.querySelector('.kt-mainplot svg')
    if (!svg) return null
    const text = new XMLSerializer().serializeToString(svg)
    return text.includes('xmlns=') ? text : text.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  const exportSvg = async () => {
    const svg = plotSvg()
    if (!svg) return
    const path = await os.dialog.saveFile({ title: 'Export plot as SVG', defaultName: `${HOME}/Documents/${spec.name}/${sheet.replace(/[^\w.-]+/g, '_')}.svg`, extensions: ['.svg'] })
    if (path) await fs.writeText(path, svg, { mkdirs: true })
  }
  const exportPng = async () => {
    const svg = plotSvg()
    const el = rootRef.current?.querySelector('.kt-mainplot svg') as SVGSVGElement | null
    if (!svg || !el) return
    const path = await os.dialog.saveFile({ title: 'Export plot as PNG', defaultName: `${HOME}/Documents/${spec.name}/${sheet.replace(/[^\w.-]+/g, '_')}.png`, extensions: ['.png'] })
    if (!path) return
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    await new Promise<void>((res, rej) => {
      img.onload = () => res()
      img.onerror = () => rej(new Error('The plot could not be drawn.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = el.width.baseVal.value * 2
    canvas.height = el.height.baseVal.value * 2
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (blob) await fs.writeBytes(path, new Uint8Array(await blob.arrayBuffer()), { mkdirs: true })
  }

  // ---------------------------------------------------------- the plot
  const figLimits = (): Limits | null => {
    if (!main) return null
    const [a, b] = [main.xlim[0] ?? 0, main.xlim[1] ?? 1]
    const [c, d] = [main.ylim[0] ?? 0, main.ylim[1] ?? 1]
    return { xmin: Math.min(a, b), xmax: Math.max(a, b), ymin: Math.min(c, d), ymax: Math.max(c, d) }
  }
  const userLimits = sheet ? limitsBySheet[sheet] ?? null : null
  const limits = userLimits ?? figLimits()
  const setLimits = (l: Limits) => sheet && setLimitsBySheet((m) => ({ ...m, [sheet]: l }))
  const resetLimits = () => sheet && setLimitsBySheet((m) => {
    const n = { ...m }
    delete n[sheet]
    return n
  })
  const mainYs = (): (number | null)[] => {
    const art = main?.artists.find((a) => (a.k === 'scatter' || a.k === 'line') && a.label)
    return art && typeof art.y === 'string' ? doc.arrays.get(art.y) ?? [] : []
  }
  const adjust = (axis: EdgeAxis, dir: 1 | -1) => {
    if (!limits) return
    setLimits(adjustLimits(limits, axis, dir === 1 ? 'increase' : 'decrease', mainYs(), true))
  }
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

  // ---------------------------------------------------------- actions
  const selectSheet = (name: string) => void doc.call('select', { sheet: name })
  const stepSheet = (d: number) => {
    const n = st.sheets.length
    if (!n) return
    const i = (((st.sheets.indexOf(sheet) + d) % n) + n) % n
    selectSheet(st.sheets[i])
  }
  const renameSheet = async () => {
    if (!sheet) return
    const name = await os.dialog.prompt('Enter new sheet name (single word only):', { title: 'Rename Sheet', defaultValue: sheet })
    if (!name || name === sheet) return
    if (name.trim().split(/\s+/).length > 1) return void os.dialog.alert('Only a single word is allowed for sheet names or core levels.', { title: 'Invalid Name' })
    await doc.call('sheet', { action: 'rename', sheet, name: name.trim() })
  }
  const deleteSheet = async () => {
    if (!sheet) return
    const ok = await os.dialog.confirm(`Delete the sheet "${sheet}" from the project?`, { title: 'Delete Sheet', danger: true, okLabel: 'Yes' })
    if (ok) await doc.call('sheet', { action: 'delete', sheet })
  }
  const display = (patch: { legend?: boolean; yAxis?: number }) => {
    if (patch.legend !== undefined) setLegendOn(patch.legend)
    if (patch.yAxis !== undefined) setYAxisState(patch.yAxis)
    void doc.call('display', { legend: patch.legend ?? legendOn, yAxis: patch.yAxis ?? yAxisState })
  }
  const openUrl = (url: string) => os.openUrl(url)

  const sendWx = (m: WxMsg) => {
    const sync = Object.fromEntries(pending)
    pending.clear()
    void doc.call('event', { msg: { ...m, sync } })
  }

  const H: Handlers = {
    new: () => void doc.call('new'),
    newInstance: () => os.open(spec.appId),
    openKfit: () => void openDialog(),
    openComputer: () => void openFromComputer(),
    quickSave: () => void quickSave(),
    exportKfit: () => void saveAs(),
    saveAs: () => void saveAs(),
    openLocation: st.file ? () => os.open('files', { path: dirname(st.file) }) : undefined,
    openExamples: () => void seedExamples(spec).then((files) => {
      setExamples(files)
      os.open('files', { path: examplesDir(spec) })
    }),
    exit: () => win.close(),
    undo: () => void doc.call('undo'),
    redo: () => void doc.call('redo'),
    deleteSheet: hasData ? () => void deleteSheet() : undefined,
    renameSheet: hasData ? () => void renameSheet() : undefined,
    copyCore: hasData ? () => void doc.call('sheet', { action: 'copy', sheet }) : undefined,
    exportSvg: hasData ? () => void exportSvg() : undefined,
    exportPng: hasData ? () => void exportPng() : undefined,
    exportTxt: hasData ? () => void exportTable('txt') : undefined,
    exportCsv: hasData ? () => void exportTable('csv') : undefined,
    exportDat: hasData ? () => void exportTable('dat') : undefined,
    'toggle:legend': () => display({ legend: !legendOn }),
    shortcuts: () => void os.dialog.alert(SHORTCUTS_TEXT.join('\n'), { title: 'Keyboard Shortcuts' }),
    about: () => void os.dialog.alert(<AboutView source={CORE_SOURCE} />, { title: `About ${spec.name}` }),
    help: () => openUrl(KF_LINKS.website),
    website: () => openUrl(KF_LINKS.website),
    paper: () => openUrl(KF_LINKS.paper),
    videos: () => openUrl(KF_LINKS.videos),
    kherveAI: () => os.open('kherveai'),
    nist: () => os.open('khervedb'),
  }

  const onTool = (id: string, el: HTMLElement) => {
    const run: Record<string, () => void> = {
      open: () => void openDialog(),
      quickSave: () => void quickSave(),
      exportExcel: () => notReady('Export to Excel / kSheet'),
      exportAll: () => notReady('Export all sheets to Excel / kSheet'),
      undo: () => void doc.call('undo'),
      redo: () => void doc.call('redo'),
      sort: () => void doc.call('sheet', { action: 'sort', sheet }),
      sampleManager: () => notReady('The Sample/Experiment Manager'),
      refresh: () => (st.file ? void openPath(st.file) : notReady('Refresh (open a saved project first)')),
      deleteSheet: () => void deleteSheet(),
      renameSheet: () => void renameSheet(),
      crop: () => notReady('Crop to a new sheet'),
      settings: () => notReady('Preferences'),
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
      plotLimits: () => hasData && setPlotLimitsOpen(true),
      greenLine: () => setGreenLine((g) => (g === null && limits ? (limits.xmin + limits.xmax) / 2 : null)),
      highBePlus: () => adjust('high_be', 1),
      highBeMinus: () => adjust('high_be', -1),
      lowBePlus: () => adjust('low_be', 1),
      lowBeMinus: () => adjust('low_be', -1),
      highIntPlus: () => adjust('high_int', 1),
      highIntMinus: () => adjust('high_int', -1),
      lowIntPlus: () => adjust('low_int', 1),
      lowIntMinus: () => adjust('low_int', -1),
      fontUp: () => setFontDelta((d) => Math.min(d + 1, 29)),
      fontDown: () => setFontDelta((d) => Math.max(d - 1, -6)),
      labels: () => notReady('The Labels Manager'),
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

  // ---------------------------------------------------------- menus
  const info = st.info
  const importItems: MenuItem[] = (info?.imports ?? []).map((x) => (x === '-' ? '-' : { label: x.label, onClick: () => void doc.call('menu', { id: x.id }) }))
  const toolItems: MenuItem[] = info
    ? [{ label: 'Full Window (all tabs)', onClick: () => void doc.call('tool', {}) }, '-', ...info.sections.map((s) => ({ label: s.full, onClick: () => void doc.call('tool', { section: s.key }) }))]
    : []
  const menus = buildMenus(H, {
    mac: MAC,
    recent: [],
    examples: [],
    sheets: st.sheets,
    theme: FACTORY_THEME,
    layout: 'tabbed',
    gridColour: '',
    greens: [],
    welcomeLogo: false,
    kineticEnergy: false,
    canUndo: st.canUndo,
    canRedo: st.canRedo,
    techImports: info ? { [info.menuLabel]: importItems } : undefined,
    techTools: info ? { [info.toolsLabel]: toolItems } : undefined,
    noun: 'Sheet',
  })
  // Examples: a submenu of the copied files, under Open Examples
  const fileMenu = menus[0]
  const exIdx = fileMenu.items.findIndex((i) => i !== '-' && i.label === 'Open Examples')
  if (exIdx >= 0 && examples.length)
    fileMenu.items.splice(exIdx + 1, 0, {
      label: `${spec.name} Examples`,
      submenu: examples.map((f) => ({ label: f, onClick: () => void openPath(join(examplesDir(spec), f)) })),
    })
  const menuKey = JSON.stringify(menus, (_k, v) => (typeof v === 'function' ? 1 : v))
  useEffect(() => win.setMenus(menus), [win, menuKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => win.setMenus(null), [win])

  // ---------------------------------------------------------- AI tools
  useAppTools(win, techAiTools({ doc, spec, actions, open: openPath, examples: () => seedExamples(spec), examplesDir: examplesDir(spec) }))

  // ---------------------------------------------------------- keyboard
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return
    const t = e.target as HTMLElement
    const typing = (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable
    const a = keyAction({ key: e.key, ctrl: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey }, { limits: hasData ? limits : null, ys: mainYs(), forward: true, selected: false, bkgTab: false, fitTab: false, hasPeaks: false, typing })
    if (!a) return
    e.preventDefault()
    e.stopPropagation()
    switch (a.type) {
      case 'limits':
        return setLimits(a.limits)
      case 'sheet':
        return stepSheet(a.step)
      case 'needFittingTab': {
        const now = Date.now()
        if (now - lastPopup.current > 10000) {
          lastPopup.current = now
          doc.flash('Open the Peak Fitting Tab to move or select a peak')
        }
        return
      }
      case 'command': {
        const run: Record<string, (() => unknown) | undefined> = {
          undo: H.undo, redo: H.redo, save: H.quickSave, open: H.openKfit, new: H.new, exit: H.exit, help: H.help, shortcuts: H.shortcuts,
          fitting: () => notReady('Peak fitting (KherveFitting) on a technique sheet'),
          energyScale: () => notReady('Show Kinetic Energy (Ctrl+B)'),
          manual: () => notReady('The full manual (Ctrl+M)'),
        }
        void Promise.resolve(run[a.id]?.())
      }
    }
  }

  // ---------------------------------------------------------- dropping files
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
      const paths = (JSON.parse(raw) as string[]).filter((p) => ['.kfit', ...spec.exts].includes(extname(p).toLowerCase()))
      if (paths.length) void openPath(paths[0])
    } catch {
      /* not a list of paths */
    }
  }

  // The splitter between the plot and the right frame
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

  // The plot's right-click menu (On_Mouse_Defs.on_right_click on a technique sheet: "Sheet" wording)
  const plotMenu = (e: ReactMouseEvent) => {
    const items: MenuItem[] = [
      { label: 'Zoom In', onClick: () => setMode((m) => (m === 'zoom' ? 'none' : 'zoom')) },
      { label: 'Zoom Out', onClick: () => { setMode('none'); resetLimits() } },
      { label: 'Overview', disabled: true },
      '-',
      { label: 'Copy Sheet', disabled: !hasData, onClick: H.copyCore },
      { label: 'Paste Sheet', disabled: true },
      { label: 'Crop Sheet', disabled: true },
      '-',
      { label: 'Copy Peak Table', disabled: true },
      { label: 'Paste Peak Table', disabled: true },
      { label: 'Fit Uncertainties ±…', disabled: true },
      '-',
      {
        label: 'Export',
        submenu: [
          { label: 'Export plot as SVG [Best]', onClick: () => void exportSvg() },
          { label: 'Export plot as PNG', onClick: () => void exportPng() },
          { label: 'Export plot as PDF', disabled: true },
          '-',
          { label: 'Export plot data as XLSX', disabled: true },
          { label: 'Export plot data as CSV', onClick: () => void exportTable('csv') },
          { label: 'Export plot data as kSheet', disabled: true },
        ],
      },
      '-',
      { label: `Rename '${sheet}'`, disabled: !hasData, onClick: () => void renameSheet() },
      { label: 'Edit Data', disabled: true },
      { label: 'Info', disabled: true },
    ]
    os.contextMenu(e, items)
  }

  // ---------------------------------------------------------- view
  const working = st.busy > 0 || !st.ready
  const message = st.message?.text ?? st.loading ?? st.progress ?? (!st.ready ? 'Starting Python (the first time downloads it)…' : null)
  const leftStatus = message ?? (st.file ? `Selected File: ${pretty(st.file)}` : `Working Directory: ${pretty(examplesDir(spec))}`)
  const rightStatus = cursor ? `BE: ${cursor.x.toFixed(3)} eV, I: ${cursor.y.toFixed(3)} CPS` : 'BE: 0 eV, I: 0 CPS'
  const rightCtx = {
    arrays: doc.arrays,
    pending,
    setPending: (id: number, v: unknown) => pending.set(id, v),
    send: sendWx,
  }
  const rightNode = st.right
  const onlyEmptyPages = !st.sheets.length

  return (
    <div
      className="k-app kf-app kt-app"
      ref={rootRef}
      tabIndex={-1}
      style={themeVars(FACTORY_THEME, FACTORY_GRID_RGB) as CSSProperties}
      data-theme={FACTORY_THEME}
      onKeyDownCapture={onKeyDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <TechToolbar
        info={info}
        technique={st.technique}
        sheets={st.sheets}
        sheet={sheet}
        states={toolStates}
        onSheet={selectSheet}
        onTool={onTool}
        onTech={() => void doc.call('tool', {})}
        onSection={(key) => void doc.call('tool', { section: key })}
      />
      <div className="kf-content">
        <PlotToolbar states={toolStates} onTool={onTool} />
        <div className="kf-splitter">
          <div className="kf-plotpanel kt-mainplot" style={{ width: `${split * 100}%` }}>
            {hasData ? (
              <FigurePlot
                fig={fig}
                arrays={doc.arrays}
                limits={limits}
                vlines={st.vlines}
                rangeActive={st.rangeActive}
                greenLine={greenLine}
                mode={mode}
                fontDelta={fontDelta}
                onLimits={setLimits}
                onModeDone={() => setMode('none')}
                onCursor={setCursor}
                onVline={onVline}
                onGreenLine={setGreenLine}
                onDoubleClick={() => setPlotLimitsOpen(true)}
                onContextMenu={(e) => plotMenu(e)}
              />
            ) : (
              <div className="kt-empty">
                <img src={`${import.meta.env.BASE_URL}icons/apps/${spec.appId}.png`} alt="" width={96} height={96} />
                <div>
                  {st.ready ? (
                    <>
                      <b>{spec.name}</b>
                      <br />
                      File › Import › {info?.menuLabel ?? spec.tech} — or File › Open Examples
                    </>
                  ) : (
                    'Starting Python…'
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="kf-sash" onPointerDown={onSash} />
          <div className="kf-grids kt-right">
            {rightNode && (
              <WxProvider value={rightCtx}>
                {onlyEmptyPages ? <div className="kt-hint">Open or import a {spec.tech} file: its overview (companion plot, sheets, quick actions) appears here.</div> : <WxView node={rightNode} />}
              </WxProvider>
            )}
          </div>
        </div>
      </div>
      <div className="kf-statusbar">
        <span className={`kf-sb-main${st.message?.error ? ' kf-error' : ''}`}>
          {working && <span className="kf-spin-dot" />}
          {leftStatus}
        </span>
        <span className="kf-sb-pos">{rightStatus}</span>
      </div>

      {toggles && (
        <TogglePopup
          at={toggles}
          onTool={(id) => {
            if (id === 'legend') display({ legend: !legendOn })
            else if (id === 'yAxis') display({ yAxis: (yAxisState + 1) % 3 })
          }}
          onClose={() => setToggles(null)}
        />
      )}
      {order.map((id, z) => {
        const f = st.frames[id]
        if (!f) return null
        return <TechFloat key={id} frame={f} arrays={doc.arrays} z={z} bounds={bounds} pending={pending} onFront={() => setOrder((o) => (o[o.length - 1] === id ? o : [...o.filter((x) => x !== id), id]))} send={sendWx} />
      })}
      {plotLimitsOpen && limits && <PlotLimitsWindow limits={limits} onChange={setLimits} onReset={resetLimits} onClose={() => setPlotLimitsOpen(false)} />}
      {modal && <ModalFrame spec={modal.spec} arrays={doc.arrays} done={modal.done} />}
      {tip && (
        <div className={`kt-tip kt-tip-${tip.icon ?? 'info'}`} role="status" onClick={() => setTip(null)}>
          <b>{tip.title}</b>
          <span>{tip.message}</span>
        </div>
      )}
    </div>
  )
}
