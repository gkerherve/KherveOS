// kMotion — a classical-mechanics sandbox: projectiles, pendulums, oscillators, collisions, orbits, rigid bodies
// (planck) and rotating frames, with live plots, measuring tools, data export and a library of experiments.
// The physics is in the pure files of this folder (tools/tests/kmotion.test.ts runs it headless); this file is the window.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera, ChevronsLeft, Eye, FilePlus, FolderOpen, Gauge, Library, Maximize, PanelLeft, PanelRight, Pause, Play, DraftingCompass as ProtractorIcon, Redo2, Ruler, RotateCcw, Save, SkipForward, Snail, Undo2,
  Hand, ZoomIn, ZoomOut,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, groupExamples, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { kmotionTools, type Hooks } from './aiTools'
import { compareIntegrators, tableText, type DriftCurve } from './analysis'
import { motionExamples } from './examples'
import { METHODS, type Method } from './integrators'
import { driftFigure, plotFigure, sweepFigure } from './figures'
import PlotlyChart, { usePalette } from './PlotlyChart'
import { DataPanel, IntegratorPicker, ModePicker, OverlayPanel, ParamPanel, PresetChips, ReadoutTable, ScenePicker, Stopwatch, newStopwatch, stopwatchValue, type StopwatchState } from './Panels'
import { cleanParams, defaultDoc, defaultMethod, FileError, makeSim, parseKmotion, SCENES, sceneById, serializeKmotion } from './registry'
import { DEFAULT_OVERLAYS, fitView, type Camera3, type Measures, type Overlays, type Scales } from './render'
import { Runtime } from './runtime'
import { SandboxBar, SandboxInspector, useSandboxEditor } from './SandboxEditor'
import { readSpec, type SandboxSpec } from './scenes/sandbox'
import SimCanvas, { type CanvasHandle, type CanvasTool } from './SimCanvas'
import type { KMotionDoc, ParamValue, Params, Sweep, View } from './types'
import { KMOTION_EXAMPLES_FOLDER } from './exampleFiles'
import './kmotion.css'

const DIR = `${HOME}/Documents/kMotion`
const PREFS_KEY = 'kherveos.kmotion.prefs'
const RECENT_KEY = 'kherveos.kmotion.recent'

interface Prefs {
  overlays: Overlays
  scales: Scales
  left: boolean
  right: boolean
  dock: boolean
  dockH: number
}
const DEFAULT_PREFS: Prefs = { overlays: DEFAULT_OVERLAYS, scales: { velocity: 1, acceleration: 1, force: 1 }, left: true, right: true, dock: true, dockH: 270 }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return {
      ...DEFAULT_PREFS, ...raw,
      overlays: { ...DEFAULT_OVERLAYS, ...(raw.overlays ?? {}) },
      scales: { ...DEFAULT_PREFS.scales, ...(raw.scales ?? {}) },
    }
  } catch { return DEFAULT_PREFS }
}
function savePrefs(p: Prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage blocked */ } }
function loadRecent(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch { return [] }
}
function saveRecent(list: string[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))) } catch { /* storage blocked */ } }

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'kMotion'
const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10]

const HELP = `kMotion is a classical-mechanics sandbox.

1. Pick a scene on the left (Projectile, Pendulums, Oscillators, Collisions, Orbits, Rigid bodies, Circular motion), then a model and a preset.
2. Press Play (Space). Sliders change the parameters; sliders marked live act while it runs, the others restart the run.
3. The picture: drag to pan, scroll to zoom, double-click to fit. Overlays on the right add trails, velocity, acceleration and force vectors, the centre of mass and energy bars. Ruler and protractor measure on the picture; the stopwatch runs on simulated time.
4. The dock below has live plots (closed-form curves are dashed), the recorded data table, the resonance sweep and the integrator comparison.
5. Export the data as CSV, copy it, or open it in kPlot or kStats. Save the scene as a .kmotion file.`

const SHORTCUTS = `Space  play / pause
.  or  →  one step
R  reset
F  fit the view
T  trails
V  velocity vectors
A  acceleration vectors
G  grid
⌘S / ⇧⌘S  save / save as
⌘O  open
⌘N  new scene
⌘E  export the data as CSV
⌘0  fit · ⌘+ / ⌘−  zoom
Sandbox: ⌘Z / ⇧⌘Z undo / redo · Delete removes the selection · Esc cancels`

export default function KMotion({ win, args }: AppProps) {
  const initial = useMemo(() => defaultDoc('projectile'), [])
  const [doc, setDocState] = useState<KMotionDoc>(initial)
  const [name, setName] = useState('Untitled')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [rev, setRev] = useState(0)
  const [savedRev, setSavedRev] = useState(0)
  const [rt, setRt] = useState<Runtime | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [simError, setSimError] = useState<string | null>(null)
  const [running, setRunningState] = useState(false)
  const [speed, setSpeedState] = useState(1)
  const [slow, setSlowState] = useState(false)
  const [tick, setTick] = useState(0)
  const [plotTick, setPlotTick] = useState(0)
  const [view, setViewState] = useState<View | null>(null)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [tool, setTool] = useState<CanvasTool>('pan')
  const [measures, setMeasures] = useState<Measures>({ rulers: [], live: null, protractor: null })
  const [stopwatch, setStopwatch] = useState<StopwatchState>(newStopwatch)
  const [dockTab, setDockTab] = useState('')
  const [view3d, setView3d] = useState(false)
  const [cam3, setCam3] = useState<Camera3>({ yaw: 0.6, pitch: 1.0 })
  const [width, setWidth] = useState(1100)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  const [sweep, setSweep] = useState<{ key: string; data: Sweep | null } | null>(null)
  const [drift, setDrift] = useState<{ key: string; curves: DriftCurve[] } | null>(null)
  const [driftDur, setDriftDur] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sandboxHistory, setSandboxHistory] = useState<{ past: SandboxSpec[]; future: SandboxSpec[] }>({ past: [], future: [] })

  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<CanvasHandle>(null)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userMoved = useRef(false)
  const intervalOverride = useRef<number | null>(null)
  const coalescing = useRef(false)
  const pal = usePalette()

  const live = useRef({ doc, rt, rev, savedRev, name, filePath, running, view, speed, slow })
  live.current = { doc, rt, rev, savedRev, name, filePath, running, view, speed, slow }
  const dirty = rev !== savedRev
  const compact = width < 900
  const size = width < 700 ? 's' : width < 1000 ? 'm' : 'l'

  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })

  const scene = sceneById(doc.scene)!
  const mode = String(doc.params.mode)
  const sim = rt?.sim ?? null

  // ------------------------------------------------------------ the simulation

  const build = useCallback((d: KMotionDoc, keepRunning: boolean): boolean => {
    try {
      const s = makeSim(d)
      const next = new Runtime(s)
      next.speed = live.current.speed
      next.slow = live.current.slow
      next.running = keepRunning && !s.finished
      if (intervalOverride.current !== null) next.rec.interval = intervalOverride.current
      setRt(next)
      live.current.rt = next
      setEpoch((e) => e + 1)
      setSimError(null)
      setRunningState(next.running)
      setTick((t) => t + 1)
      setPlotTick((t) => t + 1)
      return true
    } catch (e) {
      setSimError(msgOf(e))
      setRunningState(false)
      if (live.current.rt) live.current.rt.running = false
      return false
    }
  }, [])

  useEffect(() => { build(initial, false); setTimeout(() => canvas.current?.fit(), 40) }, [build, initial])

  const refit = () => { userMoved.current = false; setViewState(null); setTimeout(() => canvas.current?.fit(), 30) }

  const setRunning = (r: boolean) => {
    const cur = live.current.rt
    if (!cur) return
    if (r && cur.sim.finished) { build(live.current.doc, true); return }
    cur.running = r
    setRunningState(r)
    setPlotTick((t) => t + 1)
  }

  const reset = () => { build(live.current.doc, false); setStopwatch(newStopwatch()) }

  const setSpeed = (v: number) => { setSpeedState(v); if (live.current.rt) live.current.rt.speed = v }
  const setSlow = (b: boolean) => { setSlowState(b); if (live.current.rt) live.current.rt.slow = b }

  const stepOnce = () => {
    const cur = live.current.rt
    if (!cur) return
    cur.running = false
    setRunningState(false)
    cur.stepOnce()
    setTick((t) => t + 1)
    setPlotTick((t) => t + 1)
  }

  // ------------------------------------------------------------ the document

  const touch = () => setRev((r) => r + 1)

  /** Replaces the document (a new scene, a loaded file, a preset). */
  const applyDoc = (d: KMotionDoc, o: { clean?: boolean; name?: string; path?: string | null; keepView?: boolean } = {}) => {
    live.current.doc = d
    setDocState(d)
    build(d, false)
    setMeasures({ rulers: [], live: null, protractor: null })
    setStopwatch(newStopwatch())
    setSweep(null)
    setDrift(null)
    setSandboxHistory({ past: [], future: [] })
    setView3d(false)
    if (o.name !== undefined) setName(o.name)
    if (o.path !== undefined) { setFilePath(o.path); win.setDocumentPath(o.path) }
    if (o.clean) { setRev(0); setSavedRev(0) } else touch()
    if (d.view && o.keepView !== false) { setViewState(d.view); userMoved.current = true } else refit()
  }

  const confirmDiscard = async (): Promise<boolean> => {
    if (live.current.rev === live.current.savedRev) return true
    return os.dialog.confirm('This scene has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const newScene = async (id: string, modeId?: string) => {
    const cur = live.current.doc
    if (id === cur.scene) {
      if (modeId && modeId !== cur.params.mode) changeMode(modeId)
      return
    }
    if (!(await confirmDiscard())) return
    intervalOverride.current = null
    applyDoc(defaultDoc(id as never, modeId), { clean: true, name: 'Untitled', path: null })
  }

  /** The doc with the current params replaced, the sim restarted after a short delay (sliders coalesce). */
  const commitDoc = (d: KMotionDoc, restart: 'now' | 'soon' | 'none') => {
    live.current.doc = d
    setDocState(d)
    touch()
    if (restart === 'none') return
    if (restartTimer.current) clearTimeout(restartTimer.current)
    const go = () => { build(live.current.doc, live.current.running); if (!userMoved.current) setTimeout(() => canvas.current?.fit(), 30) }
    if (restart === 'now') go()
    else restartTimer.current = setTimeout(go, 140)
  }

  const changeParam = (key: string, value: ParamValue) => {
    const d = live.current.doc
    const def = sceneById(d.scene)!
    const pd = def.params.find((x) => x.key === key)
    const params = cleanParams(d.scene, { ...d.params, [key]: value })
    // the sandbox's friction and restitution sliders act on every body at once (single bodies keep their own in the inspector)
    if (d.scene === 'sandbox' && (key === 'friction' || key === 'restitution')) {
      const w = readSpec(params.world)
      params.world = { ...w, bodies: w.bodies.map((b) => ({ ...b, [key]: params[key] as number })) } as unknown as Record<string, unknown>
      coalescing.current = false
      setSandboxHistory((h) => ({ past: [...h.past.slice(-60), w], future: [] }))
    }
    const next = { ...d, params }
    if (pd?.live && live.current.rt) {
      live.current.rt.sim.params[key] = params[key] // the same object: the scenes keep references to it
      commitDoc(next, 'none')
      setTick((t) => t + 1)
      setPlotTick((t) => t + 1)
      // closed-form overlays that read the parameters need a redraw only
    } else commitDoc(next, 'soon')
    return params
  }

  const changeMode = (m: string) => {
    const d = live.current.doc
    const def = sceneById(d.scene)!
    const params = def.defaults(m)
    userMoved.current = false
    commitDoc({ ...d, params, method: defaultMethod(d.scene, m) }, 'now')
    setSandboxHistory({ past: [], future: [] })
    setSweep(null)
    setDrift(null)
    setDockTab('')
    setView3d(false)
    setViewState(null)
  }

  const applyPreset = (p: { name: string; params: Params }) => {
    const d = live.current.doc
    const m = typeof p.params.mode === 'string' ? p.params.mode : String(d.params.mode)
    const def = sceneById(d.scene)!
    const params = cleanParams(d.scene, { ...def.defaults(m), ...p.params, mode: m })
    userMoved.current = false
    commitDoc({ ...d, params }, 'now')
    setSweep(null)
    setDrift(null)
    setViewState(null)
    setTimeout(() => canvas.current?.fit(), 30)
  }

  const setMethod = (m: Method) => {
    commitDoc({ ...live.current.doc, method: m }, 'now')
  }

  // ------------------------------------------------------------ sandbox editing

  const world: SandboxSpec = useMemo(() => (doc.scene === 'sandbox' ? readSpec(doc.params.world) : { bodies: [], joints: [] }), [doc])

  const editWorld = useCallback((next: SandboxSpec, history: 'push' | 'coalesce') => {
    const d = live.current.doc
    const prev = readSpec(d.params.world)
    if (history === 'push' || sandboxHistory.past.length === 0 || !coalescing.current) {
      setSandboxHistory((h) => ({ past: [...h.past.slice(-60), prev], future: [] }))
    }
    coalescing.current = history === 'coalesce'
    commitDoc({ ...d, params: { ...d.params, world: next as unknown as Record<string, unknown> } }, 'now')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxHistory.past.length])

  const undoWorld = () => {
    const h = sandboxHistory
    if (!h.past.length) return
    const prev = h.past[h.past.length - 1]
    const cur = readSpec(live.current.doc.params.world)
    setSandboxHistory({ past: h.past.slice(0, -1), future: [cur, ...h.future] })
    coalescing.current = false
    commitDoc({ ...live.current.doc, params: { ...live.current.doc.params, world: prev as unknown as Record<string, unknown> } }, 'now')
  }
  const redoWorld = () => {
    const h = sandboxHistory
    if (!h.future.length) return
    const next = h.future[0]
    const cur = readSpec(live.current.doc.params.world)
    setSandboxHistory({ past: [...h.past, cur], future: h.future.slice(1) })
    coalescing.current = false
    commitDoc({ ...live.current.doc, params: { ...live.current.doc.params, world: next as unknown as Record<string, unknown> } }, 'now')
  }

  const editor = useSandboxEditor(
    world, doc.params.snap !== false, { friction: Number(doc.params.friction ?? 0.5), restitution: Number(doc.params.restitution ?? 0.1) }, editWorld, sim ? { pointer: (k, x, y) => sim.pointer?.(k, x, y) ?? false } : null,
    () => (view ?? (sim ? fitView(sim.bounds(), canvas.current?.size().w ?? 800, canvas.current?.size().h ?? 500) : { cx: 0, cy: 0, scale: 40 })).scale,
    (m) => setNote(m),
  )
  const isSandbox = doc.scene === 'sandbox'
  // starting the sandbox switches to the tool that throws things
  const wasRunning = useRef(false)
  useEffect(() => {
    if (isSandbox && running && !wasRunning.current && editor.tool !== 'grab') editor.setTool('grab')
    wasRunning.current = running
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, isSandbox])
  useEffect(() => { if (note) { const t = setTimeout(() => setNote(null), 4000); return () => clearTimeout(t) } }, [note])

  // ------------------------------------------------------------ files

  const rememberRecent = (p: string) => {
    const list = [p, ...recent.filter((x) => x !== p)].slice(0, 8)
    setRecent(list)
    saveRecent(list)
  }

  const docToSave = (): KMotionDoc => {
    const d = live.current.doc
    const v = live.current.view
    return { ...d, view: v ?? undefined, title: d.title ?? live.current.name }
  }

  const openText = (text: string, p: string | null, fileName: string) => {
    const d = parseKmotion(text)
    applyDoc(d, { clean: true, name: d.title ?? fileName, path: p })
  }

  const openPath = useCallback(async (p: string) => {
    try {
      openText(await fs.readText(p), /\.kmotion$/i.test(p) ? p : null, path.basename(p).replace(/\.[^.]+$/, ''))
      if (/\.kmotion$/i.test(p)) rememberRecent(p)
    } catch (e) {
      await os.dialog.alert(`Could not open “${path.basename(p)}”: ${e instanceof FileError ? e.message : msgOf(e)}`, { title: 'Open' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent])

  const openDialog = async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ extensions: ['.kmotion'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await openPath(p)
  }

  useEffect(() => {
    let alive = true
    void seedExampleFolder({ app: 'kmotion', folderName: KMOTION_EXAMPLES_FOLDER, fs }).then((files) => alive && setExampleFiles(files))
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (args.path && fs.exists(args.path as string)) void openPath(args.path as string)
    else if (typeof args.text === 'string' && args.text.trim()) {
      try { openText(args.text, null, typeof args.name === 'string' ? args.name : 'Untitled') } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Open' }) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path, args.text])

  const writeDoc = async (p: string, withName?: string) => {
    const l = live.current
    await fs.mkdir(path.dirname(p), { recursive: true })
    const d = docToSave()
    if (withName) d.title = withName
    await fs.writeText(p, serializeKmotion(d))
    if (withName) { l.name = withName; setName(withName); l.doc = { ...l.doc, title: withName }; setDocState(l.doc) }
    setFilePath(p)
    setSavedRev(l.rev)
    win.setDocumentPath(p)
    rememberRecent(p)
  }

  const saveAs = async (): Promise<boolean> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.name)}.kmotion`, extensions: ['.kmotion'], startDir: DIR })
    if (!p) return false
    const target = /\.kmotion$/i.test(p) ? p : `${p}.kmotion`
    await writeDoc(target, path.basename(target).replace(/\.kmotion$/i, ''))
    os.notify({ title: 'Scene saved', body: path.pretty(target) })
    return true
  }

  const save = async (): Promise<boolean> => {
    const p = live.current.filePath
    if (!p) return saveAs()
    await writeDoc(p)
    os.notify({ title: 'Scene saved', body: path.pretty(p) })
    return true
  }

  const safely = (fn: () => Promise<unknown>, title = 'kMotion') => void fn().catch((e) => os.dialog.alert(msgOf(e), { title }))

  // ------------------------------------------------------------ data export

  const exportCsv = async (cols?: string[]) => {
    const cur = live.current.rt
    if (!cur || cur.rec.rows.length === 0) { await os.dialog.alert('There is no data yet. Press Play to record some.', { title: 'Export data' }); return }
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.name)}-data.csv`, extensions: ['.csv'], startDir: DIR })
    if (!p) return
    await fs.writeText(p, tableText(cur.rec, ',', cols))
    os.notify({ title: 'Data exported', body: `${cur.rec.rows.length} rows · ${path.pretty(p)}` })
  }

  const copyTable = async (cols?: string[]) => {
    const cur = live.current.rt
    if (!cur) return
    try {
      await navigator.clipboard.writeText(tableText(cur.rec, '\t', cols))
      os.notify({ title: 'Table copied', body: `${cur.rec.rows.length} rows, tab separated` })
    } catch { setNote('The browser did not allow copying. Use CSV… instead.') }
  }

  const sendTo = (app: 'kplot' | 'kstats', cols?: string[]) => {
    const cur = live.current.rt
    if (!cur || cur.rec.rows.length === 0) { setNote('There is no data yet. Press Play to record some.'); return }
    try {
      os.open(app, { text: tableText(cur.rec, ',', cols), name: `${live.current.name} data` })
    } catch (e) { void os.dialog.alert(`${app === 'kplot' ? 'kPlot' : 'kStats'} could not be opened: ${msgOf(e)}`, { title: 'Open in' }) }
  }

  const snapshot = async () => {
    const blob = await canvas.current?.snapshot()
    if (!blob) { setNote('Nothing to save yet.'); return }
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.name)}.png`, extensions: ['.png'], startDir: DIR })
    if (!p) return
    await fs.writeBytes(p, new Uint8Array(await blob.arrayBuffer()))
    os.notify({ title: 'Snapshot saved', body: path.pretty(p) })
  }

  // ------------------------------------------------------------ window: title, close guard, resize

  useEffect(() => { win.setTitle(`kMotion — ${name}${dirty ? ' •' : ''}`) }, [win, name, dirty])

  useEffect(() => {
    win.setCloseGuard(async () => {
      if (live.current.rev === live.current.savedRev) return true
      const choice = await os.dialog.choose(
        `Save the changes to “${live.current.name}” before closing?`,
        [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') { try { return await save() } catch { return false } }
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  useEffect(() => () => { if (restartTimer.current) clearTimeout(restartTimer.current); if (live.current.rt) live.current.rt.running = false }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    let first = true
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setWidth(w)
      if (first && w > 0) { first = false; if (w < 900) setPrefsState((p) => ({ ...p, left: false, right: false, dock: w >= 640 && p.dock })) }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // plots refresh a few times a second while it runs
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setPlotTick((t) => t + 1), 300)
    return () => clearInterval(id)
  }, [running])

  // ------------------------------------------------------------ derived

  const readouts = useMemo(() => {
    void tick
    try { return rt ? rt.sim.readouts() : [] } catch { return [] }
  }, [rt, tick])

  const plots = sim?.plots ?? []
  const hasSweep = !!scene.sweep && (mode === 'driven')
  const hasDrift = !!sim && sim.conservative && sim.methods.length > 0
  const tabs = useMemo(() => [
    ...plots.map((p) => ({ id: `plot:${p.id}`, label: p.title })),
    ...(hasSweep ? [{ id: 'sweep', label: 'Resonance sweep' }] : []),
    ...(hasDrift ? [{ id: 'drift', label: 'Integrators' }] : []),
    { id: 'data', label: 'Data' },
  ], [plots, hasSweep, hasDrift])
  const activeTab = tabs.some((t) => t.id === dockTab) ? dockTab : (tabs[0]?.id ?? '')

  const figure = useMemo(() => {
    void plotTick
    if (!rt || !prefs.dock || !activeTab.startsWith('plot:')) return null
    const spec = rt.sim.plots.find((p) => `plot:${p.id}` === activeTab)
    if (!spec) return null
    try { return plotFigure(spec, rt.rec, rt.sim.channels, rt.sim.extra?.() ?? {}, pal) } catch { return null }
  }, [rt, prefs.dock, activeTab, plotTick, pal])

  const sweepKey = JSON.stringify([doc.scene, doc.params, doc.method])
  const sweepFig = useMemo(() => (sweep && sweep.key === sweepKey && sweep.data ? sweepFigure(sweep.data, pal) : null), [sweep, sweepKey, pal])
  const driftFig = useMemo(() => (drift && drift.key === sweepKey && drift.curves.length ? driftFigure(drift.curves, pal) : null), [drift, sweepKey, pal])

  const runSweep = () => {
    setBusy('sweep')
    setTimeout(() => {
      try { setSweep({ key: sweepKey, data: scene.sweep?.(cleanParams(doc.scene, doc.params), (doc.method ?? 'rk4') as Method) ?? null }) } catch (e) { setNote(msgOf(e)); setSweep(null) }
      setBusy(null)
    }, 20)
  }

  const runDrift = () => {
    if (!sim) return
    setBusy('drift')
    const dur = driftDur ?? 12 * sim.realtime
    setTimeout(() => {
      try {
        const heavy = doc.scene === 'orbit' && (mode === 'nbody' || mode === 'solar')
        setDrift({ key: sweepKey, curves: compareIntegrators(doc, dur, 160, heavy ? 3000 : 40000) })
      } catch (e) { setNote(msgOf(e)) }
      setBusy(null)
    }, 20)
  }

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => {
      const cur = live.current.rt
      const d = live.current.doc
      return {
        doc: d, dirty: live.current.rev !== live.current.savedRev, t: cur?.sim.t ?? 0, running: live.current.running, method: cur?.sim.method ?? 'rk4',
        sample: cur ? cur.sim.sample() : {}, readouts: cur ? cur.sim.readouts() : [], finished: cur?.sim.finished ?? false, title: live.current.name,
      }
    },
    load: (d, label) => applyDoc(d, { clean: true, name: label ?? d.title ?? 'Untitled', path: null, keepView: false }),
    setParam: (k, v) => changeParam(k, v),
    setMethod: (m) => setMethod(m),
    setMode: (m) => { changeMode(m); return live.current.doc.params },
  }
  useAppTools(win, kmotionTools(hooks))

  // ------------------------------------------------------------ menus

  const openExampleFile = (f: ExampleFile) => void confirmDiscard().then((ok) => { if (ok) void openPath(f.path) })
  const openBuiltin = (id: string) => void confirmDiscard().then((ok) => {
    const ex = motionExamples().find((e) => e.id === id)
    if (ok && ex) applyDoc(ex.doc, { clean: true, name: ex.title, path: null, keepView: false })
  })

  const toggle = (k: keyof Overlays) => setPrefs({ overlays: { ...prefs.overlays, [k]: !prefs.overlays[k] } })

  useEffect(() => {
    const groups = groupExamples(exampleFiles)
    const exampleItems: MenuItem[] = exampleFiles.length
      ? groups.map((g) => ({ label: g.group || 'Other', submenu: g.files.map((f) => ({ label: f.title, onClick: () => openExampleFile(f) })) }))
      : [...new Set(motionExamples().map((e) => e.group))].map((g) => ({ label: g, submenu: motionExamples().filter((e) => e.group === g).map((e) => ({ label: e.title, onClick: () => openBuiltin(e.id) })) }))
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New scene', icon: FilePlus, shortcut: '⌘N', submenu: SCENES.map((s) => ({ label: s.name, onClick: () => void newScene(s.id) })) },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          { label: 'Open Example', icon: Library, submenu: exampleItems },
          { label: 'Open Examples Folder', onClick: () => void seedExampleFolder({ app: 'kmotion', folderName: KMOTION_EXAMPLES_FOLDER, fs }).then((files) => { setExampleFiles(files); os.open('files', { path: exampleFolderPath(KMOTION_EXAMPLES_FOLDER) }) }) },
          { label: 'Open Recent', disabled: recent.length === 0, submenu: recent.map((p) => ({ label: path.basename(p), onClick: () => void confirmDiscard().then((ok) => { if (ok) void openPath(p) }) })) },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => safely(save, 'Save') },
          { label: 'Save As…', shortcut: '⇧⌘S', onClick: () => safely(saveAs, 'Save') },
          '-',
          { label: 'Export Data as CSV…', shortcut: '⌘E', onClick: () => safely(() => exportCsv(), 'Export') },
          { label: 'Save Snapshot (PNG)…', icon: Camera, onClick: () => safely(snapshot, 'Snapshot') },
          { label: 'Open Data in kPlot', onClick: () => sendTo('kplot') },
          { label: 'Open Data in kStats', onClick: () => sendTo('kstats') },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !isSandbox || sandboxHistory.past.length === 0, onClick: undoWorld },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !isSandbox || sandboxHistory.future.length === 0, onClick: redoWorld },
          '-',
          { label: 'Copy Data Table', onClick: () => void copyTable() },
          { label: 'Clear Recorded Data', onClick: () => { live.current.rt?.clearData(); setPlotTick((t) => t + 1) } },
          { label: 'Clear Measurements', onClick: () => { setMeasures({ rulers: [], live: null, protractor: null }); setStopwatch(newStopwatch()) } },
        ],
      },
      {
        label: 'Scene',
        items: [
          ...SCENES.map((s) => ({
            label: s.name, checked: s.id === doc.scene,
            submenu: s.modes.map((m) => ({ label: m.label, checked: s.id === doc.scene && m.id === mode, onClick: () => void newScene(s.id, m.id) })),
          })),
          '-',
          { label: 'Presets', disabled: !sim, submenu: scene.presets(mode).map((p) => ({ label: p.name, onClick: () => applyPreset(p) })) },
        ] as MenuItem[],
      },
      {
        label: 'Simulation',
        items: [
          { label: running ? 'Pause' : 'Play', icon: running ? Pause : Play, shortcut: 'Space', onClick: () => setRunning(!live.current.running) },
          { label: 'Step', icon: SkipForward, shortcut: '.', onClick: stepOnce },
          { label: 'Reset', icon: RotateCcw, shortcut: 'R', onClick: reset },
          '-',
          { label: 'Slow Motion (×0.1)', icon: Snail, checked: slow, onClick: () => setSlow(!slow) },
          { label: 'Speed', icon: Gauge, submenu: SPEEDS.map((s) => ({ label: `×${s}`, checked: speed === s, onClick: () => setSpeed(s) })) },
          { label: 'Integrator', disabled: !sim || sim.methods.length === 0, submenu: METHODS.filter((m) => !sim || sim.methods.includes(m.id)).map((m) => ({ label: m.label, checked: (doc.method ?? sim?.method) === m.id, onClick: () => setMethod(m.id) })) },
          { label: 'Compare Integrators', disabled: !hasDrift, onClick: () => { setPrefs({ dock: true }); setDockTab('drift'); runDrift() } },
          { label: 'Resonance Sweep', disabled: !hasSweep, onClick: () => { setPrefs({ dock: true }); setDockTab('sweep'); runSweep() } },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom In', icon: ZoomIn, shortcut: '⌘+', onClick: () => canvas.current?.zoomBy(1.25) },
          { label: 'Zoom Out', icon: ZoomOut, shortcut: '⌘−', onClick: () => canvas.current?.zoomBy(0.8) },
          { label: 'Fit to Window', icon: Maximize, shortcut: '⌘0', onClick: refit },
          '-',
          { label: 'Trails', shortcut: 'T', checked: prefs.overlays.trails, onClick: () => toggle('trails') },
          { label: 'Velocity Vectors', shortcut: 'V', checked: prefs.overlays.velocity, onClick: () => toggle('velocity') },
          { label: 'Acceleration Vectors', shortcut: 'A', checked: prefs.overlays.acceleration, onClick: () => toggle('acceleration') },
          { label: 'Net Force Vectors', checked: prefs.overlays.force, onClick: () => toggle('force') },
          { label: 'Centre of Mass', checked: prefs.overlays.com, onClick: () => toggle('com') },
          { label: 'Energy Bars', checked: prefs.overlays.energy, onClick: () => toggle('energy') },
          { label: 'Grid', shortcut: 'G', checked: prefs.overlays.grid, onClick: () => toggle('grid') },
          { label: 'Scale Bar', checked: prefs.overlays.scaleBar, onClick: () => toggle('scaleBar') },
          { label: '3-D View', disabled: !sim?.threeD, checked: view3d, onClick: () => setView3d(!view3d) },
          '-',
          { label: 'Parameters Panel', icon: PanelLeft, checked: prefs.left, onClick: () => setPrefs({ left: !prefs.left }) },
          { label: 'Readouts Panel', icon: PanelRight, checked: prefs.right, onClick: () => setPrefs({ right: !prefs.right }) },
          { label: 'Plots and Data', checked: prefs.dock, onClick: () => setPrefs({ dock: !prefs.dock }) },
        ],
      },
      {
        label: 'Tools',
        items: [
          { label: 'Pan', icon: Hand, checked: tool === 'pan', onClick: () => setTool('pan') },
          { label: 'Ruler', icon: Ruler, checked: tool === 'ruler', onClick: () => setTool('ruler') },
          { label: 'Protractor', icon: ProtractorIcon, checked: tool === 'protractor', onClick: () => setTool('protractor') },
          '-',
          { label: 'Start / Stop Stopwatch', onClick: () => setStopwatch((s) => (s.running ? { ...s, running: false, acc: stopwatchValue(s, live.current.rt?.sim.t ?? 0) } : { ...s, running: true, from: live.current.rt?.sim.t ?? 0 })) },
          { label: 'Reset Stopwatch', onClick: () => setStopwatch(newStopwatch()) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'Keyboard Shortcuts', onClick: () => void os.dialog.alert(SHORTCUTS, { title: 'kMotion shortcuts' }) },
          { label: 'How to Use kMotion', onClick: () => void os.dialog.alert(HELP, { title: 'kMotion' }) },
        ],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, doc, mode, running, slow, speed, tool, view3d, exampleFiles, recent, rev, sandboxHistory, hasDrift, hasSweep, sim])

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    const typing = !!target.closest('input, textarea, select, [contenteditable="true"]')
    const onButton = !!target.closest('button')
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && !e.altKey) {
      if (k === 's') { e.preventDefault(); safely(e.shiftKey ? saveAs : save, 'Save'); return }
      if (k === 'o') { e.preventDefault(); void openDialog(); return }
      if (k === 'n') { e.preventDefault(); void newScene(live.current.doc.scene); return }
      if (k === 'e') { e.preventDefault(); safely(() => exportCsv(), 'Export'); return }
      if (k === 'r') { e.preventDefault(); reset(); return }
      if (typing) return
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redoWorld(); else undoWorld(); return }
      if (k === 'y') { e.preventDefault(); redoWorld(); return }
      if (k === '0') { e.preventDefault(); refit(); return }
      if (k === '=' || k === '+') { e.preventDefault(); canvas.current?.zoomBy(1.25); return }
      if (k === '-') { e.preventDefault(); canvas.current?.zoomBy(0.8); return }
      return
    }
    if (typing) return
    if (isSandbox && editor.onKey(e)) { e.preventDefault(); return }
    if (e.key === 'Escape') { if (tool !== 'pan') setTool('pan'); return }
    if (e.altKey) return
    if (e.key === ' ' && !onButton) { e.preventDefault(); setRunning(!live.current.running); return }
    if (e.key === '.' || e.key === 'ArrowRight') { e.preventDefault(); stepOnce(); return }
    switch (k) {
      case 'r': reset(); break
      case 'f': refit(); break
      case 't': toggle('trails'); break
      case 'v': toggle('velocity'); break
      case 'a': toggle('acceleration'); break
      case 'g': toggle('grid'); break
      default: break
    }
  }

  // ------------------------------------------------------------ rendering

  const t = rt?.sim.t ?? 0
  const unit = sim?.timeUnit ?? 's'
  const customTool = isSandbox ? 'custom' : tool
  const methodNow = (doc.method ?? sim?.method ?? 'rk4') as Method

  const onSplit = (e: React.PointerEvent) => {
    const startY = e.clientY
    const startH = prefs.dockH
    const move = (ev: PointerEvent) => setPrefsState((p) => ({ ...p, dockH: Math.min(Math.max(120, startH - (ev.clientY - startY)), 640) }))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setPrefsState((p) => { savePrefs(p); return p }) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const showLeft = prefs.left
  const showRight = prefs.right

  return (
    <div ref={root} className="mo-app k-app" data-size={size} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="k-toolbar mo-toolbar" role="toolbar" aria-label="Simulation controls">
        <button className={`k-icon-btn ${showLeft ? 'on' : ''}`} aria-pressed={showLeft} title="Parameters" aria-label="Parameters panel" onClick={() => setPrefs({ left: !prefs.left, ...(compact && !prefs.left ? { right: false } : {}) })}><PanelLeft size={16} /></button>
        <span className="k-sep" />
        <button className="k-icon-btn" title={running ? 'Pause (Space)' : 'Play (Space)'} aria-label={running ? 'Pause' : 'Play'} onClick={() => setRunning(!running)}>{running ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="k-icon-btn" title="Step (.)" aria-label="Step" onClick={stepOnce}><SkipForward size={16} /></button>
        <button className="k-icon-btn" title="Reset (R)" aria-label="Reset" onClick={reset}><RotateCcw size={16} /></button>
        <span className="mo-time" aria-label="Simulated time">t = {t.toFixed(3)} {unit}</span>
        <span className="k-sep" />
        <label className="mo-speed" title="Speed relative to real time">
          <Gauge size={14} />
          <input
            type="range" min={-100} max={100} step={1} aria-label="Speed" value={Math.round(Math.log10(speed) * 100)}
            onChange={(e) => { const v = Math.pow(10, Number(e.target.value) / 100); setSpeed(Number(v.toPrecision(2))) }}
            onDoubleClick={() => setSpeed(1)}
          />
          <span>×{speed < 1 ? speed.toFixed(2) : speed.toFixed(speed < 10 ? 1 : 0)}</span>
        </label>
        <button className={`k-icon-btn ${slow ? 'on' : ''}`} aria-pressed={slow} title="Slow motion (×0.1 more)" aria-label="Slow motion" onClick={() => setSlow(!slow)}><Snail size={16} /></button>
        <span className="k-sep" />
        <button className={`k-icon-btn ${tool === 'pan' && !isSandbox ? 'on' : ''}`} aria-pressed={tool === 'pan'} title="Pan and zoom" aria-label="Pan tool" onClick={() => setTool('pan')} disabled={isSandbox}><Hand size={16} /></button>
        <button className={`k-icon-btn ${tool === 'ruler' ? 'on' : ''}`} aria-pressed={tool === 'ruler'} title="Ruler: drag on the picture" aria-label="Ruler" onClick={() => setTool(tool === 'ruler' ? 'pan' : 'ruler')} disabled={isSandbox}><Ruler size={16} /></button>
        <button className={`k-icon-btn ${tool === 'protractor' ? 'on' : ''}`} aria-pressed={tool === 'protractor'} title="Protractor: click the vertex, then two points" aria-label="Protractor" onClick={() => setTool(tool === 'protractor' ? 'pan' : 'protractor')} disabled={isSandbox}><ProtractorIcon size={16} /></button>
        <button className="k-icon-btn" title="Fit (F)" aria-label="Fit to window" onClick={refit}><Maximize size={16} /></button>
        <button className={`k-icon-btn ${prefs.overlays.trails ? 'on' : ''}`} aria-pressed={prefs.overlays.trails} title="Trails (T)" aria-label="Trails" onClick={() => toggle('trails')}><Eye size={16} /></button>
        <span className="k-spacer" />
        <span className="mo-title k-muted" title={name}>{name}{dirty ? ' •' : ''}</span>
        <button className={`k-icon-btn ${showRight ? 'on' : ''}`} aria-pressed={showRight} title="Readouts and overlays" aria-label="Readouts panel" onClick={() => setPrefs({ right: !prefs.right, ...(compact && !prefs.right ? { left: false } : {}) })}><PanelRight size={16} /></button>
        <button className={`k-icon-btn ${prefs.dock ? 'on' : ''}`} aria-pressed={prefs.dock} title="Plots and data" aria-label="Plots and data" onClick={() => setPrefs({ dock: !prefs.dock })}><ChevronsLeft size={16} style={{ transform: 'rotate(-90deg)' }} /></button>
      </div>

      {isSandbox && <SandboxBar ed={editor} />}

      <div className="mo-body">
        {showLeft && (
          <aside className="mo-left" aria-label="Scene and parameters">
            <ScenePicker scenes={SCENES} current={doc.scene} onPick={(id) => void newScene(id)} />
            <div className="mo-scroll">
              <div className="mo-sec">
                <ModePicker modes={scene.modes} mode={mode} onPick={changeMode} />
              </div>
              <PresetChips presets={scene.presets(mode)} onPick={applyPreset} />
              <div className="mo-sec">
                <h4>Parameters</h4>
                <ParamPanel scene={scene} mode={mode} params={doc.params} onChange={(k, v) => changeParam(k, v)} />
              </div>
              {sim && (
                <div className="mo-sec">
                  <h4>Integrator</h4>
                  <IntegratorPicker methods={sim.methods} method={methodNow} onPick={setMethod} />
                </div>
              )}
              {isSandbox && (
                <div className="mo-sec">
                  <h4>Selection</h4>
                  <SandboxInspector spec={world} selected={editor.selected} edit={editWorld} />
                </div>
              )}
            </div>
          </aside>
        )}

        <div className="mo-center">
          {simError ? (
            <div className="mo-stage" style={{ display: 'grid', placeItems: 'center' }}>
              <div className="mo-card"><strong>This scene could not start</strong><p>{simError}</p><button className="k-btn small" onClick={() => applyDoc(defaultDoc(doc.scene), { clean: true })}>Back to the defaults</button></div>
            </div>
          ) : rt ? (
            <SimCanvas
              ref={canvas} rt={rt} epoch={epoch} view={view}
              onView={(v, manual) => { if (manual) userMoved.current = true; setViewState(v) }}
              overlays={prefs.overlays} scales={prefs.scales} tool={customTool}
              measures={measures} onMeasures={setMeasures}
              onPointer={isSandbox ? (k, x, y) => { const r = editor.onPointer(k, x, y); if (k === 'up') coalescing.current = false; return r } : undefined}
              onDoubleClick={isSandbox ? () => editor.onDoubleClick() : undefined}
              ghost={isSandbox ? editor.ghost : undefined} selection={isSandbox && editor.tool !== 'grab' ? editor.selection : undefined}
              cam3={view3d && sim?.threeD ? cam3 : null} onCam3={setCam3}
              onTick={() => setTick((x) => x + 1)} onFinished={() => { if (live.current.rt) live.current.rt.running = false; setRunningState(false); setTick((x) => x + 1); setPlotTick((x) => x + 1) }}
              cursor={isSandbox ? (editor.tool === 'grab' ? 'grab' : editor.tool === 'select' ? 'default' : 'crosshair') : undefined}
            >
              {sim && sim.finished && <div className="mo-hud" role="status">Finished at t = {sim.t.toFixed(3)} {unit}. Press Play or R to run again.</div>}
              {note && <div className="mo-hud" style={{ top: 'auto', bottom: 34 }} role="status">{note}</div>}
              {isSandbox && world.bodies.length === 0 && (
                <div className="mo-overlay-msg"><div className="mo-card"><strong>An empty world</strong><p>Draw a box or a circle with the tools above, add a ground, press Play. Or pick a ready-made world under Presets.</p></div></div>
              )}
            </SimCanvas>
          ) : <div className="mo-stage" />}

          {prefs.dock && sim && (
            <>
              <div className="mo-splitter" onPointerDown={onSplit} role="separator" aria-orientation="horizontal" aria-label="Resize plots" />
              <div className="mo-dock" style={{ height: prefs.dockH }}>
                <div className="mo-tabs" role="tablist" aria-label="Plots">
                  {tabs.map((tb) => (
                    <button key={tb.id} role="tab" aria-selected={tb.id === activeTab} className={tb.id === activeTab ? 'on' : ''} onClick={() => setDockTab(tb.id)}>{tb.label}</button>
                  ))}
                </div>
                <div className="mo-dock-body">
                  {activeTab.startsWith('plot:') && <PlotlyChart figure={figure} />}
                  {activeTab === 'data' && rt && (
                    <DataPanel
                      rec={rt.rec} channels={sim.channels} tick={plotTick} interval={rt.rec.interval} unit={unit}
                      onInterval={(v) => { intervalOverride.current = v; rt.rec.interval = v; setPlotTick((x) => x + 1) }}
                      onClear={() => { rt.clearData(); setPlotTick((x) => x + 1) }}
                      onCopy={(c) => void copyTable(c)} onCsv={(c) => safely(() => exportCsv(c), 'Export')} onKplot={(c) => sendTo('kplot', c)} onKstats={(c) => sendTo('kstats', c)}
                    />
                  )}
                  {activeTab === 'sweep' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div className="mo-data-bar">
                        <button className="k-btn small primary" disabled={busy === 'sweep'} onClick={runSweep}>{busy === 'sweep' ? 'Working…' : sweepFig ? 'Run again' : 'Run the sweep'}</button>
                        <span className="k-muted">Drives the system at 36–40 frequencies and measures the steady-state amplitude and phase.</span>
                      </div>
                      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>{sweepFig ? <PlotlyChart figure={sweepFig} /> : <p className="mo-blurb" style={{ padding: 14 }}>Press “Run the sweep” to draw the resonance curve from the current parameters.</p>}</div>
                    </div>
                  )}
                  {activeTab === 'drift' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <div className="mo-data-bar">
                        <button className="k-btn small primary" disabled={busy === 'drift'} onClick={runDrift}>{busy === 'drift' ? 'Working…' : driftFig ? 'Run again' : 'Compare'}</button>
                        <label>for <input className="k-input" inputMode="decimal" aria-label="Duration" value={driftDur ?? Number((12 * sim.realtime).toPrecision(3))} onChange={(e) => { const n = Number(e.target.value); setDriftDur(Number.isFinite(n) && n > 0 ? n : null) }} /> {unit}</label>
                        <span className="k-muted">Same step and start for every method: Euler grows, Verlet stays bounded, RK4 and RK45 are tiny.</span>
                      </div>
                      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>{driftFig ? <PlotlyChart figure={driftFig} /> : <p className="mo-blurb" style={{ padding: 14 }}>Press Compare to run the scene with every integrator and plot the energy error.</p>}</div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {showRight && (
          <aside className="mo-right" aria-label="Readouts and overlays">
            <div className="mo-scroll">
              <div className="mo-sec">
                <h4>Readouts</h4>
                <ReadoutTable items={readouts} />
              </div>
              <div className="mo-sec">
                <h4>Overlays</h4>
                <OverlayPanel
                  overlays={prefs.overlays} scales={prefs.scales} onOverlays={(o) => setPrefs({ overlays: o })} onScales={(s) => setPrefs({ scales: s })}
                  threeD={!!sim?.threeD} view3d={view3d} on3d={setView3d}
                />
              </div>
              <div className="mo-sec">
                <h4>Stopwatch</h4>
                <Stopwatch state={stopwatch} t={t} unit={unit} onChange={setStopwatch} />
              </div>
              <div className="mo-sec">
                <h4>Measure</h4>
                <div className="mo-seg" role="radiogroup" aria-label="Measuring tool">
                  {(['pan', 'ruler', 'protractor'] as const).map((tl) => <button key={tl} role="radio" aria-checked={tool === tl} className={tool === tl ? 'on' : ''} disabled={isSandbox} onClick={() => setTool(tl)}>{tl === 'pan' ? 'Pan' : tl === 'ruler' ? 'Ruler' : 'Protractor'}</button>)}
                </div>
                <p className="mo-blurb">{tool === 'ruler' ? 'Drag on the picture: distance, Δx, Δy and angle.' : tool === 'protractor' ? 'Click the vertex, then one point on each arm.' : 'Choose a tool, then measure on the picture.'}</p>
                {(measures.rulers.length > 0 || measures.protractor) && <button className="k-btn small" onClick={() => setMeasures({ rulers: [], live: null, protractor: null })}>Clear measurements</button>}
              </div>
            </div>
          </aside>
        )}
      </div>

      <div className="k-statusbar">
        <span>{scene.name} · {scene.modes.find((m) => m.id === mode)?.label}</span>
        <span>{sim && sim.methods.length ? METHODS.find((m) => m.id === methodNow)?.label : 'exact between events'}</span>
        <span>{sim ? `step ${fmtStep(sim.dt)} ${unit}` : ''}</span>
        <span>{rt?.behind ? 'slower than real time: the computer cannot keep up' : running ? 'running' : sim?.finished ? 'finished' : 'paused'}</span>
        <span style={{ flex: 1 }} />
        <span>{sim?.status?.() ?? ''}</span>
      </div>
    </div>
  )
}

function fmtStep(dt: number): string {
  if (dt >= 0.01) return dt.toFixed(3)
  return dt.toExponential(1)
}

