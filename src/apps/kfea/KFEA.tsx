// kFEA — finite elements for structures: draw a truss, beam or frame (nodes, members, supports, loads) or a plate
// (a polygon outline with holes that is meshed), solve it (static, natural frequencies, buckling; plane stress and
// plane strain with the CST and Q4 elements), and read the displacements, forces, stress maps and diagrams.
// Files are .kfea (SI units inside). The pure code is in the other files of this folder; this one is the window.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle as CircleIcon, FilePlus, FolderOpen, Layers, Minus, MousePointer2, Play, Redo2, Save, Search, Square, Triangle, Undo2, CornerRightDown, ArrowDownToLine, Waypoints, Dot, PanelRight, ScanSearch,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, groupExamples, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { kfeaTools, type Hooks } from './aiTools'
import {
  History, niceStep, addCircleHole, addHole, addMember, addNode, addPlateLoad, addPlateSupport, deleteItems, deleteVertex, edit, insertVertex, moveLoop, moveNodes, moveVertex, setNodeLoad, setOutline, setSupport, splitMember,
  type SupportKind,
} from './editor'
import { EXAMPLES, type Example } from './examples'
import { KFEA_EXAMPLES_FOLDER } from './exampleFiles'
import { parseModel, safeName, serializeModel } from './file'
import { ANALYSIS_NAMES, checkModel, circlePoly, emptyModel, isPlate, modelBox, nextId, nodeById, pointInPolygon, type AnalysisType, type Model, type Pt, type Target } from './model'
import { meshPlate, type Mesh } from './mesh'
import { autoScale, probeFrame, probePlate, type MemberProbe, type PlateProbe } from './post'
import { convergenceStudy, type StudyPoint, type StudyQuantity } from './plane'
import { reportHtml, reportMarkdown, resultsCsv, type Figure } from './report'
import { DEFAULT_RESULT, sceneSvg, type ResultOptions, type SceneOptions } from './scene'
import { solveModel, type AnyResult } from './solve'
import { SolveError } from './linalg'
import { ModelPanel, PropertiesPanel, ResultsPanel } from './Panels'
import { ModelView, type CanvasAction, type ModelViewHandle, type Tool } from './ModelView'
import { fmt, fromSI, label, toSI, type Units } from './units'
import './kfea.css'

const DIR = `${HOME}/Documents/kFEA`
const PREFS_KEY = 'kherveos.kfea.prefs'
const RECENT_KEY = 'kherveos.kfea.recent'

type Tab = 'props' | 'model' | 'results'

interface Prefs { showIds: boolean; grid: boolean; snap: boolean; showMesh: boolean; panel: boolean; gridSize: number | null; tab: Tab }
const DEFAULT_PREFS: Prefs = { showIds: true, grid: true, snap: true, showMesh: false, panel: true, gridSize: null, tab: 'props' }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    const out = { ...DEFAULT_PREFS }
    for (const [k, v] of Object.entries(raw)) if (k in DEFAULT_PREFS && (typeof v === typeof DEFAULT_PREFS[k as keyof Prefs] || (k === 'gridSize' && (v === null || typeof v === 'number')))) (out as Record<string, unknown>)[k] = v
    if (!['props', 'model', 'results'].includes(out.tab)) out.tab = 'props'
    return out
  } catch { return DEFAULT_PREFS }
}
function savePrefs(p: Prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage blocked */ } }

function loadRecent(): string[] {
  try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string').slice(0, 8) : [] } catch { return [] }
}
function saveRecent(list: string[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))) } catch { /* storage blocked */ } }

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

const SHORTCUTS = `File: ⌘N new · ⌘O open · ⌘S save · ⇧⌘S save as
Edit: ⌘Z undo · ⇧⌘Z redo · Delete removes the selection · ⌘A selects all
Tools: V select · N node · M member · S support · L load · O outline · H hole · C circle · R refinement point · P probe
Draw: click to place; in the Member tool click two nodes (the chain goes on, Esc ends it); a plate outline closes with a double-click or Enter
View: ⌘+ / ⌘− zoom · ⌘0 fit · mouse wheel zooms · right button or Space+drag pans
Analysis: ⌘R solve · ⌘M mesh`

const HELP = `kFEA solves structures with finite elements.

1. Pick the kind of structure in the Model panel: 2-D truss, beam, 2-D frame, plane stress or plane strain (a plate).
2. Frames: draw nodes (N), join them with members (M), add supports (S) and loads (L). Click anything to edit its numbers in the Properties panel: section, material, hinges, distributed and thermal loads.
3. Plates: draw the outline (O) and holes (H or C), put supports and loads on the edges (S, L), set the element size in the Model panel and press Mesh.
4. Press Solve (⌘R). The Results panel shows deformed shapes, force diagrams, stress colour maps (von Mises, σx, σy, τxy, principal stresses), reactions and a safety factor against yield. The probe tool reads a value at a point.
5. The Convergence study solves the plate with smaller elements to show whether the mesh is fine enough.

All numbers are in the units you choose (Model panel); the file keeps SI. Open the examples: each one says what answer to expect.`

interface RunError { message: string; refs: string[] }

export default function KFEA({ win, args }: AppProps) {
  const [model, setModelState] = useState<Model>(() => emptyModel('frame'))
  const [sel, setSel] = useState<ReadonlySet<string>>(new Set())
  const [tool, setTool] = useState<Tool>({ kind: 'select' })
  const [rev, setRev] = useState(0)
  const [savedRev, setSavedRev] = useState(0)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [result, setResult] = useState<AnyResult | null>(null)
  const [resultRev, setResultRev] = useState(-1)
  const [runError, setRunError] = useState<RunError | null>(null)
  const [mesh, setMesh] = useState<Mesh | null>(null)
  const [meshing, setMeshing] = useState(false)
  const [ro, setRoState] = useState<ResultOptions>(DEFAULT_RESULT)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [width, setWidth] = useState(1100)
  const [probe, setProbe] = useState<{ plate?: PlateProbe; member?: MemberProbe } | null>(null)
  const [marker, setMarker] = useState<Pt | null>(null)
  const [study, setStudy] = useState<{ points: StudyPoint[]; quantity: StudyQuantity; running: boolean } | null>(null)
  const [fitKey, setFitKey] = useState(0)
  const [animate, setAnimate] = useState(false)
  const [phase, setPhase] = useState(0)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  const [psupport, setPsupport] = useState<{ ux: boolean; uy: boolean }>({ ux: true, uy: true })
  const [supportKind, setSupportKind] = useState<SupportKind>('pinned')
  const [pload, setPload] = useState<'pressure' | 'tx' | 'ty' | 'force'>('pressure')

  const root = useRef<HTMLDivElement>(null)
  const view = useRef<ModelViewHandle>(null)
  const hist = useRef(new History())
  const live = useRef({ model, sel, tool, rev, savedRev, filePath, result, resultRev, mesh, ro, prefs, psupport, supportKind, pload })
  live.current = { model, sel, tool, rev, savedRev, filePath, result, resultRev, mesh, ro, prefs, psupport, supportKind, pload }
  const dirty = rev !== savedRev
  const stale = result !== null && resultRev !== rev
  const compact = width < 820

  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })
  const setRo = (patch: Partial<ResultOptions>) => setRoState((r) => ({ ...r, ...patch }))
  const flash = useCallback((text: string) => { setMessage(text); window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 5000) }, [])

  useEffect(() => {
    let alive = true
    void seedExampleFolder({ app: 'kfea', folderName: KFEA_EXAMPLES_FOLDER, fs }).then((files) => alive && setExampleFiles(files))
    return () => { alive = false }
  }, [])

  // ------------------------------------------------------------ the model

  /** One change = one undo step. The mesh preview is dropped; results stay (marked out of date). */
  const commit = useCallback((next: Model, _what = '') => {
    if (next === live.current.model) return
    hist.current.push(live.current.model)
    live.current.model = next
    live.current.mesh = null
    live.current.rev += 1
    setModelState(next)
    setRev((r) => r + 1)
    setMesh(null)
    setProbe(null)
    setMarker(null)
    setStudy(null)
  }, [])

  const change = useCallback((fn: (m: Model) => Model, what: string) => commit(fn(live.current.model), what), [commit])

  const undo = () => {
    const m = hist.current.undo(live.current.model)
    if (m) { live.current.model = m; live.current.mesh = null; live.current.rev += 1; setModelState(m); setRev((r) => r + 1); setMesh(null); setSel(new Set()) }
  }
  const redo = () => {
    const m = hist.current.redo(live.current.model)
    if (m) { live.current.model = m; live.current.mesh = null; live.current.rev += 1; setModelState(m); setRev((r) => r + 1); setMesh(null); setSel(new Set()) }
  }

  const clearResults = () => { setResult(null); setResultRev(-1); setRunError(null); setProbe(null); setMarker(null); setStudy(null); setRoState(DEFAULT_RESULT); setAnimate(false) }

  const replaceModel = useCallback((m: Model, p: string | null) => {
    hist.current.clear()
    live.current.model = m
    setModelState(m)
    setSel(new Set())
    setTool({ kind: 'select' })
    setFilePath(p)
    setRev(0)
    setSavedRev(0)
    setMesh(null)
    clearResults()
    win.setDocumentPath(p)
    setFitKey((k) => k + 1)
    setPrefsState((x) => ({ ...x, tab: 'props' }))
  }, [win])

  // ------------------------------------------------------------ files

  const confirmDiscard = async (): Promise<boolean> => {
    if (live.current.rev === live.current.savedRev) return true
    return os.dialog.confirm('This model has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const remember = (p: string) => { const list = [p, ...loadRecent().filter((x) => x !== p)].slice(0, 8); saveRecent(list); setRecent(list) }

  const openText = useCallback((text: string, p: string | null) => {
    const m = parseModel(text)
    replaceModel(m, p)
    if (p) remember(p)
  }, [replaceModel])

  const openPath = useCallback(async (p: string) => {
    try { openText(await fs.readText(p), /\.kfea$/i.test(p) ? p : null) } catch (e) { await os.dialog.alert(`Could not open “${path.basename(p)}”: ${msgOf(e)}`, { title: 'Open' }) }
  }, [openText])

  const openDialog = async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ extensions: ['.kfea'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await openPath(p)
  }

  useEffect(() => {
    if (args.path && fs.exists(args.path)) void openPath(args.path)
    else if (typeof args.text === 'string' && args.text.trim()) { try { openText(args.text, null) } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Open' }) } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path, args.text])

  const newModel = async (analysis: AnalysisType) => {
    if (!(await confirmDiscard())) return
    replaceModel(emptyModel(analysis), null)
  }

  const loadExample = useCallback(async (ex: Example, ask = true) => {
    if (ask && !(await confirmDiscard())) return false
    replaceModel(structuredClone(ex.model), null)
    return true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceModel])

  const writeTo = async (p: string, name?: string): Promise<string> => {
    const m = name ? edit(live.current.model, (c) => { c.name = name }) : live.current.model
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeText(p, serializeModel(m))
    if (name) { live.current.model = m; setModelState(m) }
    setFilePath(p)
    setSavedRev(live.current.rev)
    win.setDocumentPath(p)
    remember(p)
    return p
  }

  const saveAs = async (): Promise<boolean> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.model.name)}.kfea`, extensions: ['.kfea'], startDir: DIR })
    if (!p) return false
    const target = /\.kfea$/i.test(p) ? p : `${p}.kfea`
    await writeTo(target, path.basename(target).replace(/\.kfea$/i, ''))
    os.notify({ title: 'Model saved', body: path.pretty(target) })
    return true
  }

  const save = async (): Promise<boolean> => {
    const p = live.current.filePath
    if (!p) return saveAs()
    await writeTo(p)
    os.notify({ title: 'Model saved', body: path.pretty(p) })
    return true
  }

  // ------------------------------------------------------------ solving

  const solve = useCallback(async (): Promise<AnyResult> => {
    const m = live.current.model
    setRunError(null)
    const errors = checkModel(m).filter((p) => p.level === 'error')
    if (errors.length) {
      const e: RunError = { message: errors[0].message, refs: errors[0].ref ? [errors[0].ref] : [] }
      setRunError(e)
      setPrefsState((p) => ({ ...p, tab: 'results', panel: true }))
      throw new SolveError(e.message, e.refs)
    }
    setMessage('Solving…')
    await new Promise((r) => setTimeout(r, 15))
    try {
      const t0 = performance.now()
      const keepMesh = isPlate(m.analysis) ? live.current.mesh ?? undefined : undefined
      const r = solveModel(m, { mesh: keepMesh })
      const ms = Math.round(performance.now() - t0)
      live.current.result = r
      live.current.resultRev = live.current.rev
      setResult(r)
      setResultRev(live.current.rev)
      if (r.kind === 'plane') setMesh(r.mesh)
      const size = Math.hypot(modelBox(m).x1 - modelBox(m).x0, modelBox(m).y1 - modelBox(m).y0)
      setProbe(null)
      setMarker(null)
      setRoState((prev) => {
        if (r.kind === 'frame') return { ...prev, kind: prev.kind === 'diagram' ? 'diagram' : 'deformed', scale: autoScale(r.maxDisp, size) }
        if (r.kind === 'plane') return { ...prev, kind: prev.kind === 'deformed' ? 'deformed' : 'contour', scale: autoScale(r.maxDisp, size, 0.05), field: PLATE_DEFAULT_FIELD.includes(prev.field) ? prev.field : 'vm' }
        return { ...prev, kind: 'mode', scale: 1, modeIndex: 0 }
      })
      setPrefsState((p) => ({ ...p, tab: 'results', panel: p.panel || !compactRef.current }))
      setMessage(`Solved in ${ms} ms`)
      window.setTimeout(() => setMessage((x) => (x?.startsWith('Solved') ? null : x)), 4000)
      if (r.kind === 'modal' || r.kind === 'buckling') setAnimate(true)
      return r
    } catch (e) {
      const err: RunError = { message: msgOf(e), refs: e instanceof SolveError ? e.refs : [] }
      setRunError(err)
      setMessage(null)
      setPrefsState((p) => ({ ...p, tab: 'results', panel: true }))
      if (err.refs.length) setSel(new Set(err.refs))
      throw e
    }
  }, [])

  const compactRef = useRef(compact)
  compactRef.current = compact

  const runMesh = async () => {
    const m = live.current.model
    if (!m.plate) return
    setMeshing(true)
    await new Promise((r) => setTimeout(r, 15))
    try {
      const mesh = meshPlate(m.plate)
      setMesh(mesh)
      setPrefsState((p) => ({ ...p, showMesh: true }))
      flash(`${mesh.nElems} elements, ${2 * mesh.nNodes} degrees of freedom`)
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Mesh' }) }
    setMeshing(false)
  }

  const runStudy = async (q: StudyQuantity) => {
    const m = live.current.model
    if (!m.plate) return
    setStudy({ points: [], quantity: q, running: true })
    await new Promise((r) => setTimeout(r, 15))
    try {
      const base = m.plate.mesh.size
      const sizes = [base * 2, base * 1.4, base, base / 1.4, base / 2].filter((s) => s > 0)
      const pts = convergenceStudy(m, sizes, q)
      setStudy({ points: pts, quantity: q, running: false })
    } catch (e) {
      setStudy(null)
      await os.dialog.alert(msgOf(e), { title: 'Convergence study' })
    }
  }

  // ------------------------------------------------------------ canvas actions

  const grid = useMemo(() => {
    if (prefs.gridSize) return prefs.gridSize
    const b = modelBox(model)
    const extent = Math.max(b.x1 - b.x0, b.y1 - b.y0)
    return extent > 0 && (model.nodes.length > 1 || (model.plate?.outline.length ?? 0) > 1) ? niceStep(extent) : toSI(1, 'length', model.units)
  }, [model, prefs.gridSize])

  const defaultForce = () => ({ N: 1000, kN: 10000, kip: 44482, lbf: 4448 })[live.current.model.units.force]

  const onAction = (a: CanvasAction) => {
    const m = live.current.model
    try {
      switch (a.type) {
        case 'select': {
          if (a.additive) setSel((s) => { const n = new Set(s); for (const id of a.ids) { if (n.has(id)) n.delete(id); else n.add(id) } return n })
          else setSel(new Set(a.ids))
          // selecting something shows its properties, unless a fresh solution is being read
          if (a.ids.length) setPrefsState((p) => (p.tab === 'props' || (p.tab === 'results' && live.current.result && live.current.resultRev === live.current.rev) ? p : { ...p, tab: 'props' }))
          break
        }
        case 'addNode': {
          if (a.onMember) {
            const mem = m.members.find((x) => x.id === a.onMember)!
            const n1 = nodeById(m, mem.n1)!
            const r = splitMember(m, a.onMember, Math.hypot(a.at.x - n1.x, a.at.y - n1.y))
            commit(r.model, 'Add node on member')
            setSel(new Set([r.node]))
          } else {
            const r = addNode(m, a.at.x, a.at.y)
            commit(r.model, 'Add node')
            setSel(new Set([r.id]))
          }
          break
        }
        case 'addMember': {
          let cur = m
          const ref = (n: string | Pt): string => {
            if (typeof n === 'string') return n
            const r = addNode(cur, n.x, n.y)
            cur = r.model
            return r.id
          }
          const from = ref(a.from)
          const to = ref(a.to)
          if (from === to) break
          const r = addMember(cur, from, to)
          commit(r.model, 'Add member')
          setSel(new Set([r.id]))
          break
        }
        case 'move': commit(moveNodes(m, new Set(a.ids), a.dx, a.dy), 'Move'); break
        case 'moveVertex': commit(moveVertex(m, a.loop, a.index, a.to.x, a.to.y), 'Move corner'); break
        case 'moveLoop': commit(moveLoop(m, a.loop, a.dx, a.dy), 'Move'); break
        case 'support': {
          const k = live.current.supportKind
          const cur = m.supports.find((s) => s.node === a.node)
          // clicking a node that already has this support takes it away
          const same = cur && ((k === 'pinned' && cur.ux && cur.uy && !cur.rz) || (k === 'fixed' && cur.ux && cur.uy && cur.rz) || (k === 'roller' && !cur.ux && cur.uy && !cur.rz && !cur.ky) || (k === 'roller-x' && cur.ux && !cur.uy && !cur.rz))
          commit(setSupport(m, a.node, same ? 'free' : k), 'Support')
          setSel(new Set([a.node]))
          break
        }
        case 'load': {
          if (a.node) {
            const has = m.nodeLoads.find((l) => l.node === a.node)
            if (!has) commit(setNodeLoad(m, a.node, 0, -defaultForce(), 0), 'Load')
            setSel(new Set([a.node]))
          } else if (a.member) {
            const has = m.memberLoads.some((l) => l.member === a.member)
            if (!has) commit(edit(m, (c) => { c.memberLoads.push({ id: nextId('q', c.memberLoads.map((x) => x.id)), member: a.member!, type: 'dist', dir: 'y', w1: -defaultForce(), w2: -defaultForce() }) }), 'Load')
            setSel(new Set([a.member]))
          }
          setPrefsState((p) => ({ ...p, tab: 'props', panel: true }))
          break
        }
        case 'outline': {
          const doIt = async () => {
            if (m.plate && m.plate.outline.length >= 3 && (m.plate.supports.length || m.plate.loads.length) && !(await os.dialog.confirm('A new outline replaces the old one and removes the supports and loads that were put on its edges. Continue?', { title: 'New outline', okLabel: 'Replace' }))) return
            commit(setOutline(live.current.model, a.pts), 'Outline')
            setTool({ kind: 'select' })
            setFitKey((k) => k + 1)
          }
          void doIt()
          break
        }
        case 'hole':
        case 'circle': {
          const pts = a.type === 'hole' ? a.pts : circlePoly(a.center.x, a.center.y, a.r, 32)
          if (!m.plate || m.plate.outline.length < 3) { flash('Draw the outline of the plate first.'); break }
          if (!pts.every((p) => pointInPolygon(p, m.plate!.outline))) { flash('A hole must lie inside the outline of the plate.'); break }
          commit(a.type === 'hole' ? addHole(m, a.pts) : addCircleHole(m, a.center.x, a.center.y, a.r), 'Hole')
          setTool({ kind: 'select' })
          break
        }
        case 'insertVertex': commit(insertVertex(m, a.loop, a.edge, a.at), 'Add corner'); setSel(new Set([`plate:v:${a.loop}:${a.edge + 1}`])); break
        case 'plateTarget': {
          const t: Target = a.target
          if (a.kind === 'support') {
            commit(addPlateSupport(m, t, live.current.psupport.ux, live.current.psupport.uy), 'Support')
          } else {
            const f = defaultForce()
            const kind = live.current.pload
            const isVertex = t.kind === 'vertex'
            if (isVertex) commit(addPlateLoad(m, { type: 'point', target: t, fx: 0, fy: -f }), 'Load')
            else if (kind === 'pressure') commit(addPlateLoad(m, { type: 'pressure', target: t, p: toSS(1, m.units) }), 'Load')
            else if (kind === 'force') commit(addPlateLoad(m, { type: 'edge-force', target: t, fx: 0, fy: -f }), 'Load')
            else commit(addPlateLoad(m, { type: 'traction', target: t, tx: kind === 'tx' ? toSS(1, m.units) : 0, ty: kind === 'ty' ? toSS(1, m.units) : 0 }), 'Load')
          }
          setSel(new Set(t.kind === 'edge' ? [`plate:e:${t.loop}:${t.edge}`] : t.kind === 'vertex' ? [`plate:v:${t.loop}:${t.vertex}`] : []))
          setPrefsState((p) => ({ ...p, tab: 'props', panel: true }))
          break
        }
        case 'refine': commit(edit(m, (c) => { c.plate!.mesh.refine.push({ x: a.at.x, y: a.at.y, size: c.plate!.mesh.size / 4 }) }), 'Refinement point'); break
        case 'probe': {
          const r = live.current.result
          if (!r) { flash('Solve first, then click on the result to read a value.'); break }
          setMarker(a.at)
          if (r.kind === 'plane') {
            const pr = probePlate(r, a.at.x, a.at.y)
            setProbe(pr ? { plate: pr } : null)
            if (!pr) flash('That point is not on the plate.')
          } else if (r.kind === 'frame') {
            const pr = probeFrame(m, r, a.at.x, a.at.y, 1e9)
            setProbe(pr ? { member: pr } : null)
          }
          setPrefsState((p) => ({ ...p, tab: 'results', panel: true }))
          break
        }
        case 'context': contextMenu(a); break
      }
    } catch (e) {
      void os.dialog.alert(msgOf(e), { title: 'kFEA' })
    }
  }

  const contextMenu = (a: Extract<CanvasAction, { type: 'context' }>) => {
    const items: MenuItem[] = []
    const m = live.current.model
    const t = a.target
    const fakeEvent = { clientX: a.x, clientY: a.y, preventDefault: () => {}, stopPropagation: () => {} } as unknown as React.MouseEvent
    if (t.kind === 'node') {
      items.push(
        { label: 'Pinned support', onClick: () => change((x) => setSupport(x, t.id!, 'pinned'), 'Support') },
        { label: 'Roller support', onClick: () => change((x) => setSupport(x, t.id!, 'roller'), 'Support') },
        { label: 'Fixed support', onClick: () => change((x) => setSupport(x, t.id!, 'fixed'), 'Support') },
        { label: 'No support', onClick: () => change((x) => setSupport(x, t.id!, 'free'), 'Support') },
        '-',
        { label: 'Delete node', danger: true, onClick: () => change((x) => deleteItems(x, new Set([t.id!])), 'Delete') },
      )
    } else if (t.kind === 'member') {
      items.push(
        { label: 'Hinge at the start', onClick: () => change((x) => edit(x, (c) => { const q = c.members.find((y) => y.id === t.id); if (q) q.releaseStart = !q.releaseStart || undefined }), 'Hinge') },
        { label: 'Hinge at the end', onClick: () => change((x) => edit(x, (c) => { const q = c.members.find((y) => y.id === t.id); if (q) q.releaseEnd = !q.releaseEnd || undefined }), 'Hinge') },
        '-',
        { label: 'Delete member', danger: true, onClick: () => change((x) => deleteItems(x, new Set([t.id!])), 'Delete') },
      )
    } else if (t.kind === 'vertex') {
      items.push({ label: 'Delete corner', danger: true, disabled: (t.loop === 0 ? m.plate?.outline.length : m.plate?.holes[t.loop! - 1]?.length ?? 0)! <= 3, onClick: () => change((x) => deleteVertex(x, t.loop!, t.index!), 'Delete corner') })
    } else if (t.kind === 'edge') {
      items.push(
        { label: 'Fixed support on this edge', onClick: () => change((x) => addPlateSupport(x, { kind: 'edge', loop: t.loop!, edge: t.index! }, true, true), 'Support') },
        { label: 'Hold x (symmetry)', onClick: () => change((x) => addPlateSupport(x, { kind: 'edge', loop: t.loop!, edge: t.index! }, true, false), 'Support') },
        { label: 'Hold y (symmetry)', onClick: () => change((x) => addPlateSupport(x, { kind: 'edge', loop: t.loop!, edge: t.index! }, false, true), 'Support') },
        '-',
        { label: 'Pressure on this edge', onClick: () => change((x) => addPlateLoad(x, { type: 'pressure', target: { kind: 'edge', loop: t.loop!, edge: t.index! }, p: toSS(1, x.units) }), 'Load') },
      )
    } else {
      items.push({ label: 'Fit to window', shortcut: '⌘0', onClick: () => view.current?.fit() }, { label: 'Select all', shortcut: '⌘A', onClick: selectAll })
    }
    os.contextMenu(fakeEvent, items)
  }

  const selectAll = () => {
    const m = live.current.model
    if (m.plate) setSel(new Set())
    else setSel(new Set([...m.nodes.map((n) => n.id), ...m.members.map((x) => x.id)]))
  }

  const deleteSelection = () => {
    const m = live.current.model
    const s = live.current.sel
    if (!s.size) return
    if (m.plate) {
      const v = [...s].map((x) => x.match(/^plate:v:(\d+):(\d+)$/)).find(Boolean)
      if (v) {
        const loop = Number(v[1])
        const n = loop === 0 ? m.plate.outline.length : m.plate.holes[loop - 1]?.length ?? 0
        if (n <= 3) { flash('A plate needs at least three corners.'); return }
        commit(deleteVertex(m, loop, Number(v[2])), 'Delete corner')
        setSel(new Set())
      }
      return
    }
    commit(deleteItems(m, s as Set<string>), 'Delete')
    setSel(new Set())
  }

  const setAnalysis = async (a: AnalysisType) => {
    const m = live.current.model
    if (a === m.analysis) return
    if (isPlate(a) !== isPlate(m.analysis)) {
      if ((m.nodes.length || m.plate?.outline.length) && !(await os.dialog.confirm(`Changing to ${ANALYSIS_NAMES[a]} starts a new ${isPlate(a) ? 'plate' : 'frame'} model: the current drawing is removed (undo brings it back). Continue?`, { title: 'Change the analysis', okLabel: 'Change' }))) return
      const n = emptyModel(a)
      n.name = m.name
      commit(n, 'Analysis')
      clearResults()
      setFitKey((k) => k + 1)
      return
    }
    commit(edit(m, (c) => { c.analysis = a }), 'Analysis')
  }

  // ------------------------------------------------------------ exports

  const sceneOptions: SceneOptions = { units: model.units, showIds: prefs.showIds, showLoads: true, showSupports: true, showMesh: prefs.showMesh, showGrid: prefs.grid, grid }
  const animatedScale = animate && (ro.kind === 'mode') ? ro.scale * Math.cos(phase) : ro.scale
  const resultOptions: ResultOptions = { ...ro, scale: animatedScale }

  useEffect(() => {
    if (!animate || ro.kind !== 'mode') return
    let raf = 0
    const t0 = performance.now()
    let last = 0
    const loop = (t: number) => {
      if (t - last > 33) { last = t; setPhase(((t - t0) / 1000) * 2 * Math.PI * 0.8) }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [animate, ro.kind])

  // an out-of-date solution is not drawn on a model that has changed (its nodes and members may be gone)
  const shownResult: AnyResult | null = result && !stale && ro.kind !== 'none' ? result : null
  const exportScene = (r: AnyResult | null, o: Partial<ResultOptions>) => sceneSvg(model, r, { units: model.units, showIds: prefs.showIds, result: { ...ro, scale: ro.scale, ...o } }, 1000, 640)

  const saveBytes = async (name: string, ext: string, data: string | Uint8Array): Promise<void> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.model.name)}${name}${ext}`, extensions: [ext], startDir: DIR })
    if (!p) return
    if (typeof data === 'string') await fs.writeText(p, data); else await fs.writeBytes(p, data)
    os.notify({ title: 'Exported', body: path.pretty(p) })
  }

  const exportImage = async (kind: 'png' | 'svg') => {
    try {
      if (kind === 'png') await saveBytes('', '.png', await view.current!.png())
      else await saveBytes('', '.svg', exportScene(shownResult, {}))
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Export' }) }
  }

  const exportCsv = async () => {
    const r = live.current.result
    if (!r) { await os.dialog.alert('Solve the model first: there are no results to export.', { title: 'Export' }); return }
    try { await saveBytes('-results', '.csv', resultsCsv(live.current.model, r)) } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Export' }) }
  }

  const exportReport = async (kind: 'md' | 'html') => {
    const r = live.current.result
    const m = live.current.model
    if (!r) { await os.dialog.alert('Solve the model first: the report contains the results.', { title: 'Report' }); return }
    try {
      const figs: Figure[] = [{ title: 'The model', svg: sceneSvg(m, null, { units: m.units, showIds: true }, 900, 560) }]
      const base = { ...ro, undeformed: true }
      if (r.kind === 'frame') {
        figs.push({ title: 'Deformed shape', svg: sceneSvg(m, r, { units: m.units, result: { ...base, kind: 'deformed' } }, 900, 560) })
        for (const d of ['N', 'V', 'M'] as const) figs.push({ title: { N: 'Axial force', V: 'Shear force', M: 'Bending moment' }[d], svg: sceneSvg(m, r, { units: m.units, result: { ...base, kind: 'diagram', diagram: d } }, 900, 560) })
      } else if (r.kind === 'plane') {
        for (const f of ['vm', 'sx', 'sy', 'disp'] as const) figs.push({ title: { vm: 'von Mises stress', sx: 'Stress σx', sy: 'Stress σy', disp: 'Displacement' }[f], svg: sceneSvg(m, r, { units: m.units, result: { ...base, kind: 'contour', field: f } }, 900, 560) })
      } else {
        r.modes.slice(0, 3).forEach((_, i) => figs.push({ title: `Mode ${i + 1}`, svg: sceneSvg(m, r, { units: m.units, result: { ...base, kind: 'mode', modeIndex: i, scale: 1 } }, 900, 560) }))
      }
      const date = new Date().toISOString().slice(0, 10)
      if (kind === 'md') await saveBytes('-report', '.md', reportMarkdown(m, r, figs, date))
      else await saveBytes('-report', '.html', reportHtml(m, r, figs, date))
    } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Report' }) }
  }

  // ------------------------------------------------------------ window: title, close guard, resize, menus

  useEffect(() => { win.setTitle(`kFEA — ${model.name}${dirty ? ' •' : ''}`) }, [win, model.name, dirty])

  useEffect(() => {
    win.setCloseGuard(async () => {
      if (live.current.rev === live.current.savedRev) return true
      const choice = await os.dialog.choose(
        `Save the changes to “${live.current.model.name}” before closing?`,
        [{ label: 'Cancel', value: 'cancel' }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
        { title: 'Unsaved changes' },
      )
      if (choice === 'save') { try { return await save() } catch { return false } }
      return choice === 'discard'
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  useEffect(() => {
    const el = root.current
    if (!el) return
    let first = true
    const ro2 = new ResizeObserver(() => {
      const w = el.clientWidth
      setWidth(w)
      if (first && w > 0) { first = false; if (w < 820) setPrefsState((p) => ({ ...p, panel: false })) }
    })
    ro2.observe(el)
    return () => ro2.disconnect()
  }, [])

  const plateMode = isPlate(model.analysis)

  useEffect(() => {
    const examples: MenuItem[] = (() => {
      const groups = new Map<string, Example[]>()
      for (const e of EXAMPLES) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
      return [...groups].map(([g, list]) => ({ label: g, submenu: list.map((e) => ({ label: e.title, onClick: () => void loadExample(e) })) }))
    })()
    const openExampleFile = (f: ExampleFile) => void confirmDiscard().then((ok) => { if (ok) void openPath(f.path) })
    const fileGroups = groupExamples(exampleFiles)
    const exampleFileItems: MenuItem[] = fileGroups.map((g) => ({ label: g.group || 'Other', submenu: g.files.map((f) => ({ label: f.title, onClick: () => openExampleFile(f) })) }))
    const recentItems: MenuItem[] = recent.filter((p) => fs.exists(p)).map((p) => ({ label: path.basename(p), onClick: () => void confirmDiscard().then((ok) => { if (ok) void openPath(p) }) }))
    const tools: Array<[string, string, Tool]> = plateMode
      ? [['Select', 'V', { kind: 'select' }], ['Outline', 'O', { kind: 'outline' }], ['Hole', 'H', { kind: 'hole' }], ['Circular hole', 'C', { kind: 'circle' }], ['Support', 'S', { kind: 'psupport', ux: psupport.ux, uy: psupport.uy }], ['Load', 'L', { kind: 'pload', load: pload }], ['Refinement point', 'R', { kind: 'refine' }], ['Probe', 'P', { kind: 'probe' }]]
      : [['Select', 'V', { kind: 'select' }], ['Node', 'N', { kind: 'node' }], ['Member', 'M', { kind: 'member' }], ['Support', 'S', { kind: 'support', support: supportKind }], ['Load', 'L', { kind: 'load' }], ['Probe', 'P', { kind: 'probe' }]]
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, submenu: (Object.keys(ANALYSIS_NAMES) as AnalysisType[]).map((a) => ({ label: ANALYSIS_NAMES[a], onClick: () => void newModel(a) })) },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          { label: 'Open recent', disabled: recentItems.length === 0, submenu: recentItems },
          { label: 'Open example', submenu: examples },
          { label: 'Open example file', disabled: exampleFiles.length === 0, submenu: exampleFileItems },
          { label: 'Open examples folder', onClick: () => void seedExampleFolder({ app: 'kfea', folderName: KFEA_EXAMPLES_FOLDER, fs }).then((files) => { setExampleFiles(files); os.open('files', { path: exampleFolderPath(KFEA_EXAMPLES_FOLDER) }) }) },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save().catch((e) => os.dialog.alert(msgOf(e))) },
          { label: 'Save as…', shortcut: '⇧⌘S', onClick: () => void saveAs().catch((e) => os.dialog.alert(msgOf(e))) },
          '-',
          {
            label: 'Export', submenu: [
              { label: 'Picture (PNG)…', onClick: () => void exportImage('png') }, { label: 'Picture (SVG)…', onClick: () => void exportImage('svg') }, '-',
              { label: 'Results (CSV)…', onClick: () => void exportCsv() },
              { label: 'Report (HTML)…', onClick: () => void exportReport('html') }, { label: 'Report (Markdown)…', onClick: () => void exportReport('md') },
            ],
          },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !hist.current.canUndo, onClick: undo },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !hist.current.canRedo, onClick: redo },
          '-',
          { label: 'Delete', shortcut: '⌫', disabled: sel.size === 0, onClick: deleteSelection },
          { label: 'Select all', shortcut: '⌘A', onClick: selectAll },
        ],
      },
      { label: 'Tools', items: tools.map(([name, key, t]) => ({ label: name, shortcut: key, checked: tool.kind === t.kind, onClick: () => setTool(t) })) },
      {
        label: 'Analysis',
        items: [
          { label: 'Solve', icon: Play, shortcut: '⌘R', onClick: () => void solve().catch(() => {}) },
          { label: 'Generate the mesh', shortcut: '⌘M', disabled: !plateMode, onClick: () => void runMesh() },
          '-',
          ...(Object.keys(ANALYSIS_NAMES) as AnalysisType[]).map((a) => ({ label: ANALYSIS_NAMES[a], checked: model.analysis === a, onClick: () => void setAnalysis(a) })),
          '-',
          ...(!plateMode ? (['static', 'modal', 'buckling'] as const).map((s) => ({ label: { static: 'Static analysis', modal: 'Natural frequencies', buckling: 'Buckling loads' }[s], checked: model.study === s, onClick: () => change((m) => edit(m, (c) => { c.study = s }), 'Study') })) : []),
          { label: 'Show the results', disabled: !result, onClick: () => setPrefs({ tab: 'results', panel: true }) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom in', shortcut: '⌘+', onClick: () => view.current?.zoomBy(1.25) },
          { label: 'Zoom out', shortcut: '⌘-', onClick: () => view.current?.zoomBy(0.8) },
          { label: 'Fit to window', shortcut: '⌘0', onClick: () => view.current?.fit() },
          '-',
          { label: 'Names of nodes and members', checked: prefs.showIds, onClick: () => setPrefs({ showIds: !prefs.showIds }) },
          { label: 'Grid', checked: prefs.grid, onClick: () => setPrefs({ grid: !prefs.grid }) },
          { label: 'Snap to the grid', checked: prefs.snap, onClick: () => setPrefs({ snap: !prefs.snap }) },
          { label: 'Grid size…', onClick: () => void gridDialog() },
          { label: 'Mesh', checked: prefs.showMesh, disabled: !plateMode, onClick: () => setPrefs({ showMesh: !prefs.showMesh }) },
          '-',
          { label: 'Side panel', checked: prefs.panel, onClick: () => setPrefs({ panel: !prefs.panel }) },
          { label: 'Properties', checked: prefs.tab === 'props', onClick: () => setPrefs({ tab: 'props', panel: true }) },
          { label: 'Model', checked: prefs.tab === 'model', onClick: () => setPrefs({ tab: 'model', panel: true }) },
          { label: 'Results', checked: prefs.tab === 'results', onClick: () => setPrefs({ tab: 'results', panel: true }) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'Keyboard shortcuts', onClick: () => void os.dialog.alert(SHORTCUTS, { title: 'kFEA shortcuts' }) },
          { label: 'How to use kFEA', onClick: () => void os.dialog.alert(HELP, { title: 'kFEA' }) },
        ],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, tool.kind, sel.size, rev, model.name, model.analysis, model.study, exampleFiles, recent, result, plateMode, psupport, pload, supportKind])

  const gridDialog = async () => {
    const u = live.current.model.units
    const v = await os.dialog.prompt(`Grid size in ${u.length} (empty = automatic):`, { title: 'Grid size', defaultValue: live.current.prefs.gridSize ? fmt(fromSI(live.current.prefs.gridSize, 'length', u), 6) : '' })
    if (v === null) return
    const n = Number(v.replace(',', '.'))
    if (!v.trim()) setPrefs({ gridSize: null })
    else if (Number.isFinite(n) && n > 0) setPrefs({ gridSize: toSI(n, 'length', u) })
  }

  // ------------------------------------------------------------ keyboard

  const toolFor = (key: string): Tool | null => {
    if (key === 'v') return { kind: 'select' }
    if (key === 'p') return { kind: 'probe' }
    if (plateMode) {
      if (key === 'o') return { kind: 'outline' }
      if (key === 'h') return { kind: 'hole' }
      if (key === 'c') return { kind: 'circle' }
      if (key === 's') return { kind: 'psupport', ux: psupport.ux, uy: psupport.uy }
      if (key === 'l') return { kind: 'pload', load: pload }
      if (key === 'r') return { kind: 'refine' }
    } else {
      if (key === 'n') return { kind: 'node' }
      if (key === 'm') return { kind: 'member' }
      if (key === 's') return { kind: 'support', support: supportKind }
      if (key === 'l') return { kind: 'load' }
    }
    return null
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    const typing = !!target.closest('input, textarea, select, [contenteditable="true"]')
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && !e.altKey) {
      if (k === 's') { e.preventDefault(); void (e.shiftKey ? saveAs() : save()).catch((x) => os.dialog.alert(msgOf(x))); return }
      if (k === 'o') { e.preventDefault(); void openDialog(); return }
      if (k === 'n') { e.preventDefault(); void newModel(live.current.model.analysis); return }
      if (k === 'r') { e.preventDefault(); void solve().catch(() => {}); return }
      if (k === 'm') { e.preventDefault(); if (plateMode) void runMesh(); return }
      if (typing) return
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (k === 'y') { e.preventDefault(); redo(); return }
      if (k === 'a') { e.preventDefault(); selectAll(); return }
      if (k === '0') { e.preventDefault(); view.current?.fit(); return }
      if (k === '=' || k === '+') { e.preventDefault(); view.current?.zoomBy(1.25); return }
      if (k === '-') { e.preventDefault(); view.current?.zoomBy(0.8); return }
      return
    }
    if (typing || e.altKey) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return }
    if (e.key === 'Enter') { if (view.current?.finish()) e.preventDefault(); return }
    if (e.key === 'Escape') {
      if (view.current?.cancel()) return
      if (tool.kind !== 'select') setTool({ kind: 'select' })
      else setSel(new Set())
      return
    }
    const nudge = e.shiftKey ? grid * 5 : grid
    if (!plateMode && sel.size && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault()
      const dx = e.key === 'ArrowLeft' ? -nudge : e.key === 'ArrowRight' ? nudge : 0
      const dy = e.key === 'ArrowDown' ? -nudge : e.key === 'ArrowUp' ? nudge : 0
      commit(moveNodes(live.current.model, sel as Set<string>, dx, dy), 'Move')
      return
    }
    if (k === '+' || k === '=') { view.current?.zoomBy(1.25); return }
    if (k === '-') { view.current?.zoomBy(0.8); return }
    if (k === '0') { view.current?.fit(); return }
    const t = toolFor(k)
    if (t) { e.preventDefault(); setTool(t) }
  }

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => ({ model: live.current.model, result: live.current.result, stale: live.current.result !== null && live.current.resultRev !== live.current.rev, dirty: live.current.rev !== live.current.savedRev, path: live.current.filePath }),
    apply: (m, what) => { commit(m, what); setFitKey((k) => k + 1) },
    solve: () => solve(),
    openModel: async (m, _name) => {
      if (!(await confirmDiscard())) return false
      replaceModel(m, null)
      return true
    },
  }
  useAppTools(win, kfeaTools(hooks))

  // ------------------------------------------------------------ render

  const empty = plateMode ? (model.plate?.outline.length ?? 0) < 3 : model.nodes.length === 0
  const toolButtons: Array<{ t: Tool; icon: LucideIcon; title: string }> = plateMode
    ? [
      { t: { kind: 'select' }, icon: MousePointer2, title: 'Select and move corners (V)' },
      { t: { kind: 'outline' }, icon: Square, title: 'Draw the outline: click the corners, double-click or Enter to close (O)' },
      { t: { kind: 'hole' }, icon: Layers, title: 'Draw a hole (H)' },
      { t: { kind: 'circle' }, icon: CircleIcon, title: 'Circular hole: click the centre, then the radius (C)' },
      { t: { kind: 'psupport', ux: psupport.ux, uy: psupport.uy }, icon: ArrowDownToLine, title: 'Support: click an edge or a corner (S)' },
      { t: { kind: 'pload', load: pload }, icon: CornerRightDown, title: 'Load: click an edge or a corner (L)' },
      { t: { kind: 'refine' }, icon: Dot, title: 'Refinement point for the mesh (R)' },
      { t: { kind: 'probe' }, icon: ScanSearch, title: 'Probe: read a result at a point (P)' },
    ]
    : [
      { t: { kind: 'select' }, icon: MousePointer2, title: 'Select and move (V)' },
      { t: { kind: 'node' }, icon: Dot, title: 'Add nodes: click (on a member: splits it) (N)' },
      { t: { kind: 'member' }, icon: Minus, title: 'Add members: click two nodes; Esc ends (M)' },
      { t: { kind: 'support', support: supportKind }, icon: Triangle, title: 'Supports: click a node (S)' },
      { t: { kind: 'load' }, icon: CornerRightDown, title: 'Loads: click a node or a member (L)' },
      { t: { kind: 'probe' }, icon: ScanSearch, title: 'Probe: read a result at a point (P)' },
    ]
  const sidePanel = (
    <aside className="fe-side" aria-label="Panels">
      <div className="fe-seg" role="tablist">
        {([['props', 'Properties'], ['model', 'Model'], ['results', 'Results']] as Array<[Tab, string]>).map(([id, text]) => (
          <button key={id} role="tab" aria-selected={prefs.tab === id} className={prefs.tab === id ? 'on' : ''} onClick={() => setPrefs({ tab: id })}>{text}{id === 'results' && runError ? ' !' : ''}</button>
        ))}
      </div>
      <div className="fe-side-body">
        {prefs.tab === 'props' && <PropertiesPanel model={model} sel={sel} edit={change} onDelete={deleteSelection} />}
        {prefs.tab === 'model' && <ModelPanel model={model} edit={change} mesh={mesh} meshing={meshing} onAnalysis={(a) => void setAnalysis(a)} onMesh={() => void runMesh()} />}
        {prefs.tab === 'results' && (
          <ResultsPanel
            model={model} result={result} stale={stale} error={runError?.message ?? null} warnings={result && 'warnings' in result ? result.warnings : []} ro={ro} setRo={setRo}
            onSolve={() => void solve().catch(() => {})} probe={probe} study={study} onStudy={(q) => void runStudy(q)} onCsv={() => void exportCsv()}
            onReport={(k) => void exportReport(k)} onImage={(k) => void exportImage(k)} animate={animate} setAnimate={setAnimate}
          />
        )}
      </div>
    </aside>
  )

  return (
    <div ref={root} className="k-app fe-app" data-size={compact ? 's' : 'l'} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="k-toolbar fe-toolbar" role="toolbar" aria-label="kFEA tools">
        <button className="k-icon-btn" title="Open (⌘O)" aria-label="Open" onClick={() => void openDialog()}><FolderOpen size={16} /></button>
        <button className="k-icon-btn" title="Save (⌘S)" aria-label="Save" onClick={() => void save().catch((e) => os.dialog.alert(msgOf(e)))}><Save size={16} /></button>
        <button className="k-icon-btn" title="Undo (⌘Z)" aria-label="Undo" disabled={!hist.current.canUndo} onClick={undo}><Undo2 size={16} /></button>
        <button className="k-icon-btn" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!hist.current.canRedo} onClick={redo}><Redo2 size={16} /></button>
        <span className="k-sep" />
        {toolButtons.map((b) => (
          <button key={b.t.kind} className={`k-icon-btn${tool.kind === b.t.kind ? ' active' : ''}`} title={b.title} aria-label={b.title} aria-pressed={tool.kind === b.t.kind} onClick={() => setTool(b.t)}><b.icon size={16} /></button>
        ))}
        {tool.kind === 'support' && (
          <select className="k-input fe-tool-opt" aria-label="Kind of support" value={supportKind} onChange={(e) => { const k = e.target.value as SupportKind; setSupportKind(k); setTool({ kind: 'support', support: k }) }}>
            <option value="pinned">Pinned</option><option value="roller">Roller (slides in x)</option><option value="roller-x">Roller (slides in y)</option><option value="fixed">Fixed</option><option value="spring">Spring</option>
          </select>
        )}
        {tool.kind === 'psupport' && (
          <select className="k-input fe-tool-opt" aria-label="Kind of support" value={`${psupport.ux ? 'x' : ''}${psupport.uy ? 'y' : ''}`} onChange={(e) => { const v = e.target.value; const s = { ux: v.includes('x'), uy: v.includes('y') }; setPsupport(s); setTool({ kind: 'psupport', ...s }) }}>
            <option value="xy">Fixed</option><option value="x">Hold x (symmetry)</option><option value="y">Hold y (symmetry)</option>
          </select>
        )}
        {tool.kind === 'pload' && (
          <select className="k-input fe-tool-opt" aria-label="Kind of load" value={pload} onChange={(e) => { const v = e.target.value as typeof pload; setPload(v); setTool({ kind: 'pload', load: v }) }}>
            <option value="pressure">Pressure</option><option value="tx">Traction x</option><option value="ty">Traction y</option><option value="force">Total force</option>
          </select>
        )}
        <span className="k-spacer" />
        {plateMode && <button className="k-btn" onClick={() => void runMesh()} disabled={meshing} title="Generate the mesh (⌘M)"><Waypoints size={14} /> Mesh</button>}
        <button className="k-btn primary" onClick={() => void solve().catch(() => {})} title="Solve (⌘R)"><Play size={14} /> Solve</button>
        <button className="k-icon-btn" title="Zoom to fit (⌘0)" aria-label="Fit" onClick={() => view.current?.fit()}><Search size={16} /></button>
        <button className={`k-icon-btn${prefs.panel ? ' active' : ''}`} title="Side panels" aria-label="Side panels" aria-pressed={prefs.panel} onClick={() => setPrefs({ panel: !prefs.panel })}><PanelRight size={16} /></button>
      </div>
      <div className="fe-main">
        <div className="fe-center">
          <ModelView
            ref={view} model={model} result={shownResult} mesh={mesh} scene={{ ...sceneOptions, result: resultOptions }} tool={tool} selection={sel} grid={grid} snap={prefs.snap} marker={marker}
            onAction={onAction} onCursor={setCursor} fitKey={fitKey}
          />
          {empty && (
            <div className="fe-empty">
              <div className="fe-empty-card">
                <strong>{plateMode ? 'Draw a plate' : 'Draw a structure'}</strong>
                <p>{plateMode ? 'Pick the Outline tool (O) and click the corners of the plate; double-click to close it. Then add supports and loads on the edges and press Solve.' : 'Pick the Node tool (N) and click to place nodes, then the Member tool (M) to join them. Add supports (S) and loads (L), then press Solve.'}</p>
                <div className="fe-actions">
                  {(plateMode ? ['plate-hole', 'plate-cook', 'plate-cylinder'] : ['truss-warren', 'beam-ss-udl', 'frame-portal']).map((id) => {
                    const ex = EXAMPLES.find((e) => e.id === id)!
                    return <button key={id} className="k-btn small" onClick={() => void loadExample(ex)}>{ex.title}</button>
                  })}
                </div>
                <small className="k-muted">…or open any of the examples from File › Open example. Each one says what answer to expect.</small>
              </div>
            </div>
          )}
          {runError && prefs.tab !== 'results' && <div className="fe-banner" role="alert" onClick={() => setPrefs({ tab: 'results', panel: true })}>{runError.message}</div>}
        </div>
        {prefs.panel && sidePanel}
      </div>
      <div className="k-statusbar fe-status">
        <span className="fe-status-main">{message ?? (stale ? 'Results are out of date' : result ? 'Solved' : toolHint(tool, plateMode))}</span>
        <span className="k-spacer" />
        {cursor && <span className="fe-mono">x {fmt(fromSI(cursor.x, 'length', model.units), 5)}  y {fmt(fromSI(cursor.y, 'length', model.units), 5)} {label('length', model.units)}</span>}
        <span>{plateMode ? `${model.plate?.outline.length ?? 0} corners · ${model.plate?.holes.length ?? 0} holes${mesh ? ` · ${mesh.nElems} elements` : ''}` : `${model.nodes.length} nodes · ${model.members.length} members`}</span>
        <span>{ANALYSIS_NAMES[model.analysis]} · {model.units.length}, {model.units.force}</span>
      </div>
    </div>
  )
}

const PLATE_DEFAULT_FIELD = ['vm', 'sx', 'sy', 'txy', 'p1', 'p2', 'tmax', 'sed', 'sf', 'disp', 'ux', 'uy']

function toSS(v: number, u: Units): number { return toSI(v, 'stress', u) }

function toolHint(t: Tool, plate: boolean): string {
  switch (t.kind) {
    case 'node': return 'Click to place a node; click on a member to split it'
    case 'member': return 'Click two nodes to join them; Esc ends the chain'
    case 'support': return 'Click a node to give it the support (click again to remove it)'
    case 'load': return 'Click a node or a member to put a load on it, then edit it in the Properties panel'
    case 'outline': return 'Click the corners; double-click or Enter closes the outline'
    case 'hole': return 'Click the corners of the hole; double-click or Enter closes it'
    case 'circle': return 'Click the centre of the hole, then a point on its edge'
    case 'psupport': return 'Click an edge or a corner to support it'
    case 'pload': return 'Click an edge (pressure, traction, force) or a corner (point force)'
    case 'refine': return 'Click where the mesh should be finer'
    case 'probe': return 'Click on the result to read its value'
    default: return plate ? 'Click a corner or an edge; drag a corner to move it; double-click an edge to add a corner' : 'Click to select, drag to move, drag on empty space to select several'
  }
}

