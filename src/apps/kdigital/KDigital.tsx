// kDigital — a digital-logic lab: a gate-level circuit editor with an event-driven four-valued simulator and a
// WaveDrom timing diagram; Boolean functions (truth tables, Quine–McCluskey, Karnaugh maps); a state-machine
// designer; number systems and IEEE-754; Verilog / VHDL export. Files are .kdig.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen, Binary, Cable, CircuitBoard, ClipboardPaste, Copy, FilePlus, FlipHorizontal2, FolderOpen, GitBranch, Library, Maximize, MousePointer2, PanelLeft, PanelRight, Pause, Play, Redo2,
  RotateCcw, RotateCw, Save, SkipForward, StepForward, StickyNote, Tag, Trash2, Undo2, Waypoints, Code2, Sigma, ZoomIn, ZoomOut, Eye,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, seedExampleFolder } from '@/os/exampleFiles'
import { kdigitalTools, type Hooks } from './aiTools'
import { BooleanTab } from './BooleanTab'
import { Canvas, type CanvasHandle, type Hit, type Tool, type View } from './Canvas'
import { History, cloneDoc, copyItems, deleteItems, mirrorItems, moveItems, pasteClip, rotateItems, clipIsEmpty, type Clip } from './editor'
import { EXAMPLES, type Example } from './examples'
import { canonicalIds, emptyFile, parseKdig, serializeKdig, type BooleanState, type KdigFile, type NumbersState, type Step, type TabId } from './file'
import { emptyFsm, type Fsm } from './fsm'
import { FsmTab } from './FsmTab'
import { HdlTab } from './HdlTab'
import { CATEGORIES, KIND_DEFS, KIND_LIST, emptyDoc, newId, newPart, nextRef, signalName, type Doc, type Kind, type Part, type Rot } from './model'
import { extractNets } from './netlist'
import { NumbersTab } from './NumbersTab'
import { Palette } from './Palette'
import { Inspector, ProblemsPanel, SimPanel } from './Panels'
import { bomCsv } from './bom'
import { DEFAULT_SIM, Simulator, type SimSettings } from './sim'
import { runSpec } from './session'
import { docToSvg, LIGHT_COLORS } from './svg'
import { Timing, type TimingExport } from './Timing'
import { defaultProbes, parseStimulus, stimulusText, type Probe } from './wave'
import { svgToPng } from './waveDom'
import './kdigital.css'

const DIR = `${HOME}/Documents/kDigital`
const EXAMPLES_FOLDER = 'kDigital Examples'
const PREFS_KEY = 'kherveos.kdigital.prefs'
const RECENT_KEY = 'kherveos.kdigital.recent'

type Side = 'props' | 'sim' | 'problems'

interface Prefs { grid: boolean; wheelZooms: boolean; palette: boolean; side: boolean; timing: boolean; dockH: number; speed: number }
const DEFAULT_PREFS: Prefs = { grid: true, wheelZooms: true, palette: true, side: true, timing: true, dockH: 270, speed: 50 }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { ...DEFAULT_PREFS, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in DEFAULT_PREFS && typeof v === typeof DEFAULT_PREFS[k as keyof Prefs])) }
  } catch { return DEFAULT_PREFS }
}
function savePrefs(p: Prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage blocked */ } }
function loadRecent(): string[] {
  try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown; return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string').slice(0, 8) : [] } catch { return [] }
}
function saveRecent(list: string[]) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))) } catch { /* storage blocked */ } }

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
const safeName = (name: string): string => name.trim().replace(/[^\w.+-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'circuit'

/** The clipboard is shared between windows (kDigital is a singleton). */
let sharedClip: Clip | null = null

const SPEEDS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000]

/** A stimulus for a machine's circuit: reset, then one input vector per clock edge (clock period 20, first edge at 10). */
function fsmStimulus(fsm: Fsm, sequence: string): { steps: Step[]; until: number } {
  const seq = sequence.replace(/[^01\s,]/g, '').split(/[\s,]+/).filter(Boolean)
  const steps: Step[] = [{ t: 0, set: { RST: 1 } }, { t: 8, set: { RST: 0 } }]
  const n = fsm.inputs.length
  seq.forEach((s, i) => {
    const bits = s.padStart(n, '0').slice(-n || undefined)
    steps.push({ t: 20 * i + 2, set: Object.fromEntries(fsm.inputs.map((name, k) => [name, Number(bits[k])])) })
  })
  return { steps, until: 20 * seq.length + 30 }
}

export default function KDigital({ win, args }: AppProps) {
  // ---- document state
  const [doc, setDocState] = useState<Doc>(emptyDoc)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [tool, setTool] = useState<Tool>({ kind: 'select' })
  const [settings, setSettingsState] = useState<SimSettings>(DEFAULT_SIM)
  const [stimulus, setStimulusState] = useState('')
  const [until, setUntilState] = useState(200)
  const [customProbes, setCustomProbes] = useState<Probe[] | null>(null)
  const [booleanState, setBooleanState] = useState<BooleanState>({ text: 'F = A & B | !C', style: 'as-is' })
  const [fsm, setFsmState] = useState<Fsm>(emptyFsm)
  const [fsmSeq, setFsmSeq] = useState('0 1 1 0 1 0 1 1')
  const [numbers, setNumbersState] = useState<NumbersState>({ value: '42', base: 10, bits: 8 })
  const [name, setName] = useState('Untitled')
  const [description, setDescription] = useState('')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('circuit')
  const [side, setSide] = useState<Side>('props')
  const [rev, setRev] = useState(0)
  const [savedRev, setSavedRev] = useState(0)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [width, setWidth] = useState(1100)
  const [hover, setHover] = useState<Hit | null>(null)
  const [zoom, setZoom] = useState(1)
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const [exampleCount, setExampleCount] = useState(0)

  // ---- simulation state
  const [tick, setTick] = useState(0)
  const [running, setRunning] = useState(false)
  const sim = useRef<Simulator | null>(null)
  const pending = useRef<Step[]>([])
  const pendingAt = useRef(0)

  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<CanvasHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const hist = useRef(new History())
  const fsmHist = useRef<{ past: Fsm[]; future: Fsm[] }>({ past: [], future: [] })
  const pasteCount = useRef(0)
  const live = useRef({ doc, settings, stimulus, until, name, rev, savedRev, tab, fsm, booleanState, customProbes, selection, tool, filePath, fsmSeq, numbers, description, running })
  live.current = { doc, settings, stimulus, until, name, rev, savedRev, tab, fsm, booleanState, customProbes, selection, tool, filePath, fsmSeq, numbers, description, running }
  const dirty = rev !== savedRev
  const compact = width < 900

  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })
  const touch = () => setRev((r) => r + 1)

  // ------------------------------------------------------------ document edits

  const commit = useCallback((next: Doc) => {
    hist.current.push(live.current.doc)
    live.current.doc = next
    setDocState(next)
    setRev((r) => r + 1)
  }, [])

  const replaceDoc = useCallback((next: Doc) => {
    hist.current.clear()
    live.current.doc = next
    setDocState(next)
    setSelection(new Set())
    setTool({ kind: 'select' })
  }, [])

  const undo = () => { const d = hist.current.undo(live.current.doc); if (d) { live.current.doc = d; setDocState(d); touch(); setSelection(new Set()) } }
  const redo = () => { const d = hist.current.redo(live.current.doc); if (d) { live.current.doc = d; setDocState(d); touch(); setSelection(new Set()) } }

  const setSettings = (patch: Partial<SimSettings>) => { setSettingsState((s) => ({ ...s, ...patch })); touch() }
  const setStimulus = (t: string) => { setStimulusState(t); touch() }
  const setUntil = (n: number) => { setUntilState(n); touch() }
  const setBoolean = (patch: Partial<BooleanState>) => { setBooleanState((b) => ({ ...b, ...patch })); touch() }
  const setNumbers = (patch: Partial<NumbersState>) => { setNumbersState((n) => ({ ...n, ...patch })); touch() }
  const setProbes = (p: Probe[] | null) => { setCustomProbes(p); touch() }

  const commitFsm = (f: Fsm) => {
    const h = fsmHist.current
    h.past.push(live.current.fsm)
    if (h.past.length > 100) h.past.shift()
    h.future = []
    live.current.fsm = f
    setFsmState(f)
    touch()
  }
  const undoFsm = () => { const h = fsmHist.current; const p = h.past.pop(); if (p) { h.future.push(live.current.fsm); live.current.fsm = p; setFsmState(p); touch() } }
  const redoFsm = () => { const h = fsmHist.current; const n = h.future.pop(); if (n) { h.past.push(live.current.fsm); live.current.fsm = n; setFsmState(n); touch() } }

  // ------------------------------------------------------------ simulation

  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const parsedStimulus = useMemo(() => parseStimulus(stimulus), [stimulus])
  const probes = useMemo(() => customProbes ?? defaultProbes(doc), [customProbes, doc])

  /** The simulator for the current drawing: made again when the drawing or the settings changed. */
  const ensureSim = useCallback((): Simulator => {
    const l = live.current
    const have = sim.current
    if (have && have.doc === l.doc && have.settings === l.settings) return have
    const s = new Simulator(l.doc, l.settings)
    sim.current = s
    pending.current = [...parseStimulus(l.stimulus).steps].sort((a, b) => a.t - b.t)
    pendingAt.current = 0
    return s
  }, [])

  const advanceTo = useCallback((s: Simulator, target: number) => {
    const steps = pending.current
    while (pendingAt.current < steps.length && steps[pendingAt.current].t <= target) {
      const st = steps[pendingAt.current++]
      s.run(Math.max(st.t, s.time))
      for (const [k, v] of Object.entries(st.set)) s.setInput(k, v)
    }
    s.run(target)
  }, [])

  const stepSim = (ticks: number) => { const s = ensureSim(); advanceTo(s, s.time + ticks); setTick((t) => t + 1) }
  const nextEvent = () => {
    const s = ensureSim()
    const t = s.nextTime()
    const st = pending.current[pendingAt.current]
    const target = t === null ? (st ? st.t : null) : st ? Math.min(t, st.t) : t
    if (target === null) { os.notify({ title: 'kDigital', body: 'Nothing is scheduled: no clock and no more input changes.' }); return }
    advanceTo(s, Math.max(target, s.time))
    setTick((x) => x + 1)
  }
  const resetSim = () => { setRunning(false); sim.current = null; pendingAt.current = 0; setTick((t) => t + 1) }

  /** Runs the stimulus at once up to “Run until” and shows the diagram. */
  const runStimulus = useCallback((steps?: Step[], untilTime?: number, set?: SimSettings) => {
    const l = live.current
    setRunning(false)
    const st = steps ?? parseStimulus(l.stimulus).steps
    const s = runSpec({ doc: l.doc, settings: set ?? l.settings, steps: st, until: untilTime ?? l.until })
    sim.current = s
    pending.current = []
    pendingAt.current = st.length
    setTick((t) => t + 1)
    setPrefsState((p) => (p.timing ? p : { ...p, timing: true }))
  }, [])

  // the run loop
  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const loop = (now: number) => {
      acc += ((now - last) / 1000) * prefsRef.current.speed
      last = now
      const whole = Math.floor(acc)
      if (whole > 0) {
        acc -= whole
        try { const s = ensureSim(); advanceTo(s, s.time + Math.min(whole, 2000)); setTick((t) => t + 1) } catch (e) { setRunning(false); void os.dialog.alert(msgOf(e), { title: 'Simulation' }); return }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [running, ensureSim, advanceTo])

  const toggleInput = (part: Part) => {
    const s = ensureSim()
    const n = signalName(part) || part.ref
    const cur = s.inputValue(n)
    s.setInput(n, cur === 1 ? 0 : 1)
    advanceTo(s, s.time + (live.current.running || live.current.settings.delayMode === 'zero' ? 0 : 10))
    setTick((t) => t + 1)
  }
  const pressInput = (part: Part, down: boolean) => {
    const s = ensureSim()
    const n = signalName(part) || part.ref
    const rest = part.props.value === '1' ? 1 : 0
    s.setInput(n, down ? 1 - rest : rest)
    advanceTo(s, s.time + (live.current.running ? 0 : 6))
    setTick((t) => t + 1)
  }

  const usable = sim.current && sim.current.doc === doc ? sim.current : null
  const problems = useMemo(() => (usable ? usable.problems() : extractNets(doc).problems), [usable, doc, tick])  // eslint-disable-line react-hooks/exhaustive-deps
  const extracted = useMemo(() => extractNets(doc), [doc])
  const dangling = useMemo(() => {
    const out = new Set<string>()
    for (const p of doc.parts) {
      if (p.kind === 'pull') continue
      for (const pin of KIND_DEFS[p.kind].shape(p).pins) {
        if (pin.dir !== 'in' || pin.def !== undefined) continue
        const n = extracted.nets[extracted.pinNet.get(`${p.ref}.${pin.name}`) ?? -1]
        if (n && n.pins.length <= 1 && !n.labelled) {
          const c = pinXY(p, pin.name)
          if (c) out.add(`${c.x},${c.y}`)
        }
      }
    }
    return out
  }, [doc, extracted])
  const probed = useMemo(() => {
    const m = new Map<string, string>()
    if (!customProbes) return m
    for (const p of customProbes) {
      const b = p.bits[0]
      const t = b.match(/^(\w+)\.(\w+)$/)
      if (t) { const part = doc.parts.find((q) => q.ref === t[1]); const c = part && pinXY(part, t[2]); if (c) m.set(`${c.x},${c.y}`, p.name) }
    }
    return m
  }, [customProbes, doc])

  // ------------------------------------------------------------ files

  const confirmDiscard = async (): Promise<boolean> => {
    if (live.current.rev === live.current.savedRev) return true
    return os.dialog.confirm('This document has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const remember = (p: string) => { const list = [p, ...loadRecent().filter((x) => x !== p)].slice(0, 8); saveRecent(list); setRecent(list) }

  const applyFile = useCallback((f: KdigFile, p: string | null, fileName: string) => {
    const circuit = f.circuit ?? emptyDoc()
    replaceDoc(circuit)
    const settingsNew = { ...DEFAULT_SIM, ...(f.sim ?? {}) }
    setSettingsState(settingsNew)
    const steps = f.stimulus ?? []
    setStimulusState(stimulusText(steps))
    setUntilState(f.until ?? 200)
    setCustomProbes(f.probes && f.probes.length ? f.probes : null)
    setBooleanState(f.boolean ?? { text: '', style: 'as-is' })
    setFsmState(f.fsm ?? emptyFsm())
    fsmHist.current = { past: [], future: [] }
    setNumbersState(f.numbers ?? { value: '42', base: 10, bits: 8 })
    setName(f.name || fileName)
    setDescription(f.description ?? '')
    setFilePath(p)
    setRev(0); setSavedRev(0)
    win.setDocumentPath(p)
    setTab(f.tab ?? 'circuit')
    sim.current = null
    setRunning(false)
    live.current.doc = circuit; live.current.settings = settingsNew; live.current.stimulus = stimulusText(steps); live.current.until = f.until ?? 200
    setTimeout(() => {
      canvas.current?.fit(circuit)
      if (circuit.parts.length && steps.length) runStimulus(steps as Step[], f.until ?? 200, settingsNew)
      else setTick((t) => t + 1)
    }, 40)
  }, [replaceDoc, runStimulus, win])

  const openText = useCallback((text: string, p: string | null, fileName: string) => {
    const f = parseKdig(text)
    applyFile(f, p, fileName)
  }, [applyFile])

  const openPath = useCallback(async (p: string) => {
    try { openText(await fs.readText(p), /\.kdig$/i.test(p) ? p : null, path.basename(p).replace(/\.[^.]+$/, '')); if (/\.kdig$/i.test(p)) remember(p) } catch (e) {
      await os.dialog.alert(`Could not open “${path.basename(p)}”: ${msgOf(e)}`, { title: 'Open' })
    }
  }, [openText])

  const openExample = useCallback(async (ex: Example, ask = true) => {
    if (ask && !(await confirmDiscard())) return
    applyFile(ex.build(), null, ex.title)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFile])

  useEffect(() => {
    if (args.path && fs.exists(args.path)) void openPath(args.path)
    else if (typeof args.text === 'string' && args.text.trim()) {
      try { openText(args.text, null, typeof args.name === 'string' ? args.name : 'Untitled') } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Open' }) }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path, args.text])

  useEffect(() => {
    let alive = true
    void seedExampleFolder({ app: 'kdigital', folderName: EXAMPLES_FOLDER, fs }).then((files) => alive && setExampleCount(files.length))
    return () => { alive = false }
  }, [])

  const openDialog = async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ extensions: ['.kdig'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await openPath(p)
  }

  const newDocument = async () => {
    if (!(await confirmDiscard())) return
    applyFile(emptyFile('Untitled'), null, 'Untitled')
  }

  const toFile = (): KdigFile => {
    const l = live.current
    const f: KdigFile = { format: 'kdig', version: 1, name: l.name, tab: l.tab, circuit: l.doc, stimulus: parseStimulus(l.stimulus).steps, until: l.until, sim: l.settings, boolean: l.booleanState, fsm: l.fsm, numbers: l.numbers }
    if (l.description) f.description = l.description
    if (l.customProbes) f.probes = l.customProbes
    return f
  }

  const writeKdig = async (p: string, withName?: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true })
    if (withName) { live.current.name = withName; setName(withName) }
    await fs.writeText(p, serializeKdig(toFile()))
    setFilePath(p)
    setSavedRev(live.current.rev)
    win.setDocumentPath(p)
    remember(p)
  }

  const saveAs = async (): Promise<boolean> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.name)}.kdig`, extensions: ['.kdig'], startDir: DIR })
    if (!p) return false
    const target = /\.kdig$/i.test(p) ? p : `${p}.kdig`
    await writeKdig(target, path.basename(target).replace(/\.kdig$/i, ''))
    os.notify({ title: 'Saved', body: path.pretty(target) })
    return true
  }

  const save = async (): Promise<boolean> => {
    const p = live.current.filePath
    if (!p) return saveAs()
    await writeKdig(p)
    os.notify({ title: 'Saved', body: path.pretty(p) })
    return true
  }

  const saveText = async (text: string | Uint8Array, defaultName: string, ext: string, title = 'Export') => {
    try {
      if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
      const p = await os.dialog.saveFile({ defaultName, extensions: [ext], startDir: DIR })
      if (!p) return
      await fs.mkdir(path.dirname(p), { recursive: true })
      if (typeof text === 'string') await fs.writeText(p, text); else await fs.writeBytes(p, text)
      os.notify({ title: 'Exported', body: path.pretty(p) })
    } catch (e) { await os.dialog.alert(msgOf(e), { title }) }
  }

  const exportSchematic = async (kind: 'svg' | 'png') => {
    const l = live.current
    const s = docToSvg(l.doc, LIGHT_COLORS, sim.current && sim.current.doc === l.doc ? sim.current : null)
    if (kind === 'svg') await saveText(s.svg, `${safeName(l.name)}.svg`, '.svg')
    else { try { await saveText(await svgToPng(s.svg, s.width, s.height, 2), `${safeName(l.name)}.png`, '.png') } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Export' }) } }
  }

  const exportTiming = (e: TimingExport) => {
    const base = `${safeName(live.current.name)}-timing`
    if (e.kind === 'svg') void saveText(e.data as string, `${base}.svg`, '.svg')
    else if (e.kind === 'png') void saveText(e.data as Uint8Array, `${base}.png`, '.png')
    else void saveText(e.data as string, `${base}.json`, '.json')
  }

  // ------------------------------------------------------------ close guard, title, size

  useEffect(() => { win.setTitle(`kDigital — ${name}${dirty ? ' •' : ''}`) }, [win, name, dirty])

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

  useEffect(() => () => { sim.current = null }, [])

  useEffect(() => {
    const el = root.current
    if (!el) return
    let first = true
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setWidth(w)
      if (first && w > 0) { first = false; if (w < 900) setPrefsState((p) => ({ ...p, palette: false, side: false })) }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ------------------------------------------------------------ editing commands

  const rotate = () => {
    const l = live.current
    if (l.tool.kind === 'place') { setTool({ ...l.tool, rot: (((l.tool.rot + 90) % 360) as Rot) }); return }
    if (l.selection.size) commit(rotateItems(l.doc, l.selection))
  }
  const mirror = () => {
    const l = live.current
    if (l.tool.kind === 'place') { setTool({ ...l.tool, mirror: !l.tool.mirror }); return }
    if (l.selection.size) commit(mirrorItems(l.doc, l.selection))
  }
  const removeSelection = () => { const l = live.current; if (!l.selection.size) return; commit(deleteItems(l.doc, l.selection)); setSelection(new Set()) }
  const copySel = () => { const l = live.current; if (l.selection.size) { sharedClip = copyItems(l.doc, l.selection); pasteCount.current = 0 } }
  const cutSel = () => { copySel(); removeSelection() }
  const paste = () => {
    if (clipIsEmpty(sharedClip)) return
    pasteCount.current += 1
    const off = 20 * pasteCount.current
    const r = pasteClip(live.current.doc, sharedClip!, off, off)
    commit(r.doc); setSelection(r.ids)
  }
  const duplicate = () => {
    const l = live.current
    if (!l.selection.size) return
    const r = pasteClip(l.doc, copyItems(l.doc, l.selection), 20, 20)
    commit(r.doc); setSelection(r.ids)
  }
  const selectAll = () => { const d = live.current.doc; setSelection(new Set([...d.parts.map((p) => p.id), ...d.wires.map((w) => w.id), ...d.labels.map((x) => x.id), ...d.notes.map((n) => n.id)])) }
  const nudge = (dx: number, dy: number) => { const l = live.current; if (l.selection.size) commit(moveItems(l.doc, l.selection, dx, dy)) }

  const armPart = (kind: Kind) => {
    setTool({ kind: 'place', part: kind, rot: 0, mirror: false })
    setSelection(new Set())
    if (compact) setPrefs({ palette: false })
    setTab('circuit')
    root.current?.querySelector<HTMLElement>('.dg-canvas')?.focus()
  }

  const updatePart = (id: string, patch: { props?: Record<string, string> }) => {
    const d = live.current.doc
    commit({ ...d, parts: d.parts.map((p) => (p.id === id ? { ...p, props: patch.props ?? p.props } : p)) })
  }

  const dropPart = (kind: Kind, x: number, y: number) => {
    const d = live.current.doc
    const part = newPart(d, kind, x, y)
    commit({ ...d, parts: [...d.parts, part] })
    setSelection(new Set([part.id]))
  }

  const askText = async (kind: 'label' | 'note', x: number, y: number) => {
    const d = live.current.doc
    if (kind === 'label') {
      const used = new Set(d.labels.map((l) => l.name))
      let guess = 'net1'
      for (let i = 1; used.has(guess); i++) guess = `net${i + 1}`
      const v = await os.dialog.prompt('Net label name (labels with the same name are connected):', { title: 'Net label', defaultValue: guess, okLabel: 'Place' })
      if (v && v.trim()) commit({ ...live.current.doc, labels: [...live.current.doc.labels, { id: newId('l'), name: v.trim(), x, y }] })
    } else {
      const v = await os.dialog.prompt('Text of the note:', { title: 'Note', defaultValue: 'Note', okLabel: 'Place' })
      if (v && v.trim()) commit({ ...live.current.doc, notes: [...live.current.doc.notes, { id: newId('n'), text: v, x, y }] })
    }
    setTool({ kind: 'select' })
  }

  const editHit = async (hit: Hit) => {
    if (hit.type === 'part') {
      setSide('props'); setPrefs({ side: true })
      setTimeout(() => nameRef.current?.focus(), 30)
    } else if (hit.type === 'label') {
      const l = live.current.doc.labels.find((x) => x.id === hit.id)
      if (!l) return
      const v = await os.dialog.prompt('Net label name:', { title: 'Rename net label', defaultValue: l.name })
      if (v && v.trim() && v.trim() !== l.name) commit({ ...live.current.doc, labels: live.current.doc.labels.map((x) => (x.id === l.id ? { ...x, name: v.trim() } : x)) })
    } else if (hit.type === 'note') { setSide('props'); setPrefs({ side: true }) }
  }

  const probeAt = (hit: Hit) => {
    const d = live.current.doc
    const ex = extractNets(d)
    let net: number | undefined
    if (hit.type === 'pin' && hit.ref && hit.pin) net = ex.pinNet.get(`${hit.ref}.${hit.pin}`)
    else if (hit.type === 'wire') { const w = d.wires.find((x) => x.id === hit.id); if (w) net = ex.pointNet.get(`${w.x1},${w.y1}`) }
    if (net === undefined) return
    const n = ex.nets[net]
    const driver = n.pins.find((p) => p.dir === 'out') ?? n.pins[0]
    const target = n.labelled ? n.labels[0] : driver ? `${driver.ref}.${driver.pin}` : n.name
    const cur = live.current.customProbes ?? defaultProbes(d)
    if (cur.some((p) => p.bits.length === 1 && p.bits[0] === target)) { os.notify({ title: 'kDigital', body: `${n.name} is already in the timing diagram.` }); return }
    setProbes([...cur, { name: n.name, bits: [target] }])
    setPrefs({ timing: true })
  }

  const contextMenu = (e: React.MouseEvent, hit: Hit) => {
    const items: MenuItem[] = []
    if (hit.type === 'none') {
      items.push(
        { label: 'Paste', icon: ClipboardPaste, shortcut: '⌘V', disabled: clipIsEmpty(sharedClip), onClick: paste },
        { label: 'Add net label', icon: Tag, shortcut: 'L', onClick: () => setTool({ kind: 'label' }) },
        { label: 'Add note', icon: StickyNote, shortcut: 'T', onClick: () => setTool({ kind: 'note' }) },
        '-', { label: 'Fit to window', icon: Maximize, shortcut: '⌘0', onClick: () => canvas.current?.fit(live.current.doc) },
      )
    } else {
      if (hit.type === 'part' || hit.type === 'pin' || hit.type === 'wire') items.push({ label: 'Add to the timing diagram', icon: Eye, onClick: () => probeAt(hit) }, '-')
      if (hit.type === 'part') items.push({ label: 'Properties', onClick: () => void editHit(hit) }, '-')
      if (hit.type === 'label') items.push({ label: 'Rename…', onClick: () => void editHit(hit) }, '-')
      items.push(
        { label: 'Rotate', icon: RotateCw, shortcut: 'R', onClick: rotate }, { label: 'Mirror', icon: FlipHorizontal2, shortcut: 'F', onClick: mirror },
        { label: 'Duplicate', icon: Copy, shortcut: '⌘D', onClick: duplicate }, { label: 'Copy', shortcut: '⌘C', onClick: copySel }, { label: 'Cut', shortcut: '⌘X', onClick: cutSel },
        '-', { label: 'Delete', icon: Trash2, shortcut: '⌫', danger: true, onClick: removeSelection },
      )
    }
    os.contextMenu(e, items)
  }

  /** Puts a drawing in the editor (Expression → circuit, state machine → flip-flops) and shows it. */
  const applyCircuit = useCallback(async (d: Doc, nm: string, extra?: { probes?: Probe[]; steps?: Step[]; until?: number }, ask = true) => {
    if (ask && live.current.doc.parts.length > 0 && !(await os.dialog.confirm('Replace the circuit with the new gates? (You can undo.)', { title: 'Replace the circuit', okLabel: 'Replace' }))) return
    commit(d)
    setSelection(new Set())
    sim.current = null
    setRunning(false)
    if (extra?.probes) setCustomProbes(extra.probes)
    if (extra?.steps) { setStimulusState(stimulusText(extra.steps)); live.current.stimulus = stimulusText(extra.steps) }
    if (extra?.until) { setUntilState(extra.until); live.current.until = extra.until }
    if (live.current.name === 'Untitled') setName(nm)
    setTab('circuit')
    setTimeout(() => { canvas.current?.fit(d); setTick((t) => t + 1) }, 40)
  }, [commit])

  const flashRefs = (refs: string[]) => {
    const ids = new Set(live.current.doc.parts.filter((p) => refs.includes(p.ref)).map((p) => p.id))
    if (ids.size === 0) return
    setSelection(ids); setFlash(ids)
    setTimeout(() => setFlash(new Set()), 3000)
  }

  const useCurrentAsInitial = () => {
    const s = sim.current
    const d = live.current.doc
    if (!s || s.doc !== d) { void os.dialog.alert('Run or step the simulation and set the switches first.', { title: 'Initial values' }); return }
    commit({ ...d, parts: d.parts.map((p) => { if (p.kind !== 'switch' && p.kind !== 'button') return p; const v = s.inputValue(signalName(p) || p.ref); return v === null || v > 1 ? p : { ...p, props: { ...p.props, value: String(v) } } }) })
  }

  // ------------------------------------------------------------ menus

  useEffect(() => {
    const placeItems = (cat: (typeof CATEGORIES)[number]): MenuItem[] => KIND_LIST.filter((d) => d.category === cat).map((d) => ({ label: d.name, onClick: () => armPart(d.kind) }))
    const groups = new Map<string, Example[]>()
    for (const ex of EXAMPLES) groups.set(ex.group, [...(groups.get(ex.group) ?? []), ex])
    const exampleItems: MenuItem[] = [...groups].map(([g, list]) => ({ label: g, submenu: list.map((ex) => ({ label: ex.title, onClick: () => void openExample(ex) })) }))
    const recentItems: MenuItem[] = recent.map((p) => ({ label: path.basename(p), onClick: () => void confirmDiscard().then((ok) => { if (ok) void openPath(p) }) }))
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, shortcut: '⌘N', onClick: () => void newDocument() },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          { label: 'Open Recent', disabled: recent.length === 0, submenu: recentItems },
          { label: 'Open Example', icon: Library, submenu: exampleItems },
          { label: 'Open Examples Folder', onClick: () => void seedExampleFolder({ app: 'kdigital', folderName: EXAMPLES_FOLDER, fs }).then((files) => { setExampleCount(files.length); os.open('files', { path: exampleFolderPath(EXAMPLES_FOLDER) }) }) },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save().catch((e) => os.dialog.alert(msgOf(e))) },
          { label: 'Save as…', shortcut: '⇧⌘S', onClick: () => void saveAs().catch((e) => os.dialog.alert(msgOf(e))) },
          '-',
          {
            label: 'Export', submenu: [
              { label: 'Schematic as SVG…', onClick: () => void exportSchematic('svg') }, { label: 'Schematic as PNG…', onClick: () => void exportSchematic('png') },
              { label: 'Bill of parts (CSV)…', onClick: () => void saveText(bomCsv(live.current.doc), `${safeName(live.current.name)}-parts.csv`, '.csv') },
              '-', { label: 'Timing diagram, WaveJSON…', onClick: () => setTab('circuit') },
              { label: 'Verilog / VHDL…', onClick: () => setTab('hdl') },
            ],
          },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: tab === 'fsm' ? fsmHist.current.past.length === 0 : !hist.current.canUndo, onClick: () => (live.current.tab === 'fsm' ? undoFsm() : undo()) },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: tab === 'fsm' ? fsmHist.current.future.length === 0 : !hist.current.canRedo, onClick: () => (live.current.tab === 'fsm' ? redoFsm() : redo()) },
          '-',
          { label: 'Cut', shortcut: '⌘X', disabled: selection.size === 0, onClick: cutSel }, { label: 'Copy', shortcut: '⌘C', disabled: selection.size === 0, onClick: copySel },
          { label: 'Paste', shortcut: '⌘V', disabled: clipIsEmpty(sharedClip), onClick: paste }, { label: 'Duplicate', shortcut: '⌘D', disabled: selection.size === 0, onClick: duplicate },
          { label: 'Delete', shortcut: '⌫', disabled: selection.size === 0, onClick: removeSelection }, { label: 'Select all', shortcut: '⌘A', onClick: selectAll },
          '-', { label: 'Rotate', icon: RotateCw, shortcut: 'R', onClick: rotate }, { label: 'Mirror', icon: FlipHorizontal2, shortcut: 'F', onClick: mirror },
        ],
      },
      {
        label: 'Place',
        items: [
          { label: 'Wire', icon: Cable, shortcut: 'W', checked: tool.kind === 'wire', onClick: () => { setTab('circuit'); setTool({ kind: 'wire' }) } },
          { label: 'Net label', icon: Tag, shortcut: 'L', onClick: () => { setTab('circuit'); setTool({ kind: 'label' }) } },
          { label: 'Text note', icon: StickyNote, shortcut: 'T', onClick: () => { setTab('circuit'); setTool({ kind: 'note' }) } },
          { label: 'Timing probe', icon: Eye, shortcut: 'B', checked: tool.kind === 'probe', onClick: () => { setTab('circuit'); setTool({ kind: 'probe' }) } },
          '-', ...CATEGORIES.map((c) => ({ label: c, submenu: placeItems(c) })),
        ],
      },
      {
        label: 'Simulate',
        items: [
          { label: running ? 'Pause' : 'Run', icon: running ? Pause : Play, shortcut: '⌘R', onClick: () => setRunning((r) => !r) },
          { label: 'Step one time unit', icon: StepForward, shortcut: '⌘.', onClick: () => stepSim(1) },
          { label: 'Step to the next event', icon: SkipForward, shortcut: '⇧⌘.', onClick: nextEvent },
          { label: 'Reset to time 0', icon: RotateCcw, shortcut: '⇧⌘R', onClick: resetSim },
          '-', { label: 'Run the stimulus now', onClick: () => runStimulus() },
          { label: 'Use the switch positions as initial values', onClick: useCurrentAsInitial },
          '-',
          { label: 'Unit delay', checked: settings.delayMode === 'unit', onClick: () => setSettings({ delayMode: 'unit' }) },
          { label: 'Per-gate delays', checked: settings.delayMode === 'gate', onClick: () => setSettings({ delayMode: 'gate' }) },
          { label: 'Zero delay', checked: settings.delayMode === 'zero', onClick: () => setSettings({ delayMode: 'zero' }) },
          { label: 'Inertial delay', checked: settings.inertial, onClick: () => setSettings({ inertial: !settings.inertial }) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom in', icon: ZoomIn, shortcut: '⌘+', onClick: () => canvas.current?.zoomBy(1.25) }, { label: 'Zoom out', icon: ZoomOut, shortcut: '⌘-', onClick: () => canvas.current?.zoomBy(0.8) },
          { label: 'Fit to window', shortcut: '⌘0', onClick: () => canvas.current?.fit(live.current.doc) },
          '-', { label: 'Grid', checked: prefs.grid, onClick: () => setPrefs({ grid: !prefs.grid }) }, { label: 'Scroll wheel zooms', checked: prefs.wheelZooms, onClick: () => setPrefs({ wheelZooms: !prefs.wheelZooms }) },
          '-', { label: 'Parts palette', checked: prefs.palette, onClick: () => setPrefs({ palette: !prefs.palette }) }, { label: 'Side panel', checked: prefs.side, onClick: () => setPrefs({ side: !prefs.side }) },
          { label: 'Timing diagram', checked: prefs.timing, onClick: () => setPrefs({ timing: !prefs.timing }) },
          '-',
          { label: 'Circuit', checked: tab === 'circuit', onClick: () => setTab('circuit') }, { label: 'Boolean', checked: tab === 'boolean', onClick: () => setTab('boolean') },
          { label: 'State machine', checked: tab === 'fsm', onClick: () => setTab('fsm') }, { label: 'Numbers', checked: tab === 'numbers', onClick: () => setTab('numbers') }, { label: 'HDL', checked: tab === 'hdl', onClick: () => setTab('hdl') },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'Keyboard shortcuts', icon: BookOpen, onClick: () => void os.dialog.alert(SHORTCUTS, { title: 'kDigital shortcuts' }) },
          { label: 'How to use kDigital', onClick: () => void os.dialog.alert(HELP, { title: 'kDigital' }) },
        ],
      },
    ]
    win.setMenus(menus)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, tool.kind, tab, running, selection.size, rev, settings, recent, exampleCount])

  // ------------------------------------------------------------ keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement
    const typing = !!target.closest('input, textarea, select, [contenteditable="true"], .cm-editor')
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (mod && !e.altKey) {
      if (k === 's') { e.preventDefault(); void (e.shiftKey ? saveAs() : save()).catch((x) => os.dialog.alert(msgOf(x))); return }
      if (k === 'o') { e.preventDefault(); void openDialog(); return }
      if (k === 'n') { e.preventDefault(); void newDocument(); return }
      if (k === 'r') { e.preventDefault(); if (e.shiftKey) resetSim(); else setRunning((r) => !r); return }
      if (k === '.') { e.preventDefault(); if (e.shiftKey) nextEvent(); else stepSim(1); return }
      if (typing) return
      if (tab === 'fsm') { if (k === 'z') { e.preventDefault(); if (e.shiftKey) redoFsm(); else undoFsm() } return }
      if (tab !== 'circuit') return
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (k === 'y') { e.preventDefault(); redo(); return }
      if (k === 'c') { e.preventDefault(); copySel(); return }
      if (k === 'x') { e.preventDefault(); cutSel(); return }
      if (k === 'v') { e.preventDefault(); paste(); return }
      if (k === 'd') { e.preventDefault(); duplicate(); return }
      if (k === 'a') { e.preventDefault(); selectAll(); return }
      if (k === '0') { e.preventDefault(); canvas.current?.fit(live.current.doc); return }
      if (k === '=' || k === '+') { e.preventDefault(); canvas.current?.zoomBy(1.25); return }
      if (k === '-') { e.preventDefault(); canvas.current?.zoomBy(0.8); return }
      return
    }
    if (typing || tab !== 'circuit' || e.altKey) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelection(); return }
    if (e.key === 'Escape') {
      if (canvas.current?.cancel()) return
      if (tool.kind !== 'select') setTool({ kind: 'select' }); else setSelection(new Set())
      return
    }
    const step = e.shiftKey ? 50 : 10
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); return }
    if (e.shiftKey) {
      const quick: Record<string, Kind> = { a: 'and', o: 'or', n: 'nand', r: 'nor', x: 'xor', i: 'not', d: 'dff', s: 'switch', l: 'led', c: 'clock' }
      if (quick[k]) { e.preventDefault(); armPart(quick[k]); return }
    }
    switch (k) {
      case 'r': rotate(); break
      case 'f': mirror(); break
      case 'w': setTool({ kind: 'wire' }); break
      case 'l': setTool({ kind: 'label' }); break
      case 't': setTool({ kind: 'note' }); break
      case 'b': setTool({ kind: 'probe' }); break
      case 'v': setTool({ kind: 'select' }); break
      case ' ': if (!typing) { e.preventDefault(); setRunning((r) => !r) } break
      case 'p': case '/': e.preventDefault(); setPrefs({ palette: true }); setTimeout(() => searchRef.current?.focus(), 20); break
      case '+': case '=': canvas.current?.zoomBy(1.25); break
      case '-': canvas.current?.zoomBy(0.8); break
      case '0': canvas.current?.fit(live.current.doc); break
      default: break
    }
  }

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => ({ doc: live.current.doc, settings: live.current.settings, name: live.current.name, tab: live.current.tab, booleanText: live.current.booleanState.text, fsm: live.current.fsm, dirty: live.current.rev !== live.current.savedRev, probes: live.current.customProbes ?? [], stimulus: parseStimulus(live.current.stimulus).steps, until: live.current.until }),
    showBoolean: (text, style, focus) => { setBooleanState({ text, style, ...(focus ? { focus } : {}) }); touch(); setTab('boolean') },
    applyCircuit: (d, nm) => { void applyCircuit(d, nm, undefined, false) },
    showRun: (steps, untilTime, set) => { setStimulusState(stimulusText(steps)); setUntilState(untilTime); setSettingsState(set); live.current.stimulus = stimulusText(steps); live.current.until = untilTime; live.current.settings = set; setTab('circuit'); setTimeout(() => runStimulus(steps, untilTime, set), 30) },
    openExample: async (ex) => { await openExample(ex, false) },
  }
  useAppTools(win, kdigitalTools(hooks))

  // ------------------------------------------------------------ rendering

  const hoverText = useMemo(() => {
    if (!hover) return ''
    const net = (i: number | undefined) => (i === undefined ? '' : ` · net ${extracted.nets[i].name}${usable ? ` = ${['0', '1', 'X', 'Z'][usable.netVal[i]]}` : ''}`)
    if (hover.type === 'pin') return `${hover.ref}.${hover.pin}${net(extracted.pinNet.get(`${hover.ref}.${hover.pin}`))}`
    if (hover.type === 'wire') { const w = doc.wires.find((x) => x.id === hover.id); return w ? `wire${net(extracted.pointNet.get(`${w.x1},${w.y1}`))}` : '' }
    if (hover.type === 'part') { const p = doc.parts.find((x) => x.id === hover.id); return p ? `${p.ref} ${KIND_DEFS[p.kind].name}${signalName(p) ? ` “${signalName(p)}”` : ''}` : '' }
    if (hover.type === 'label') return 'net label'
    return ''
  }, [hover, extracted, doc, usable])

  const time = sim.current?.time ?? 0
  const unit = settings.unit
  const timeText = `t = ${time} ${unit}`
  const oscillating = (usable?.oscillations.length ?? 0) > 0

  const dragDock = (e: React.PointerEvent) => {
    const startY = e.clientY
    const start = prefs.dockH
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setPrefsState((p) => ({ ...p, dockH: Math.min(620, Math.max(160, start + startY - ev.clientY)) }))
    const up = () => { el.removeEventListener('pointermove', move as EventListener); el.removeEventListener('pointerup', up); setPrefsState((p) => { savePrefs(p); return p }) }
    el.addEventListener('pointermove', move as EventListener)
    el.addEventListener('pointerup', up)
  }

  const toolBtn = (t: Tool['kind'], icon: React.ReactNode, title: string) => (
    <button className={`k-icon-btn${tool.kind === t ? ' active' : ''}`} title={title} aria-label={title} aria-pressed={tool.kind === t} onClick={() => { setTab('circuit'); setTool({ kind: t } as Tool) }}>{icon}</button>
  )

  const sidePanel = (
    <aside className="dg-side">
      <div className="dg-seg dg-side-tabs" role="tablist">
        {([['props', 'Properties'], ['sim', 'Simulation'], ['problems', 'Problems']] as [Side, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={side === id} className={side === id ? 'on' : ''} onClick={() => setSide(id)}>{label}{id === 'problems' && problems.some((p) => p.level === 'error' || p.level === 'warn') ? ' !' : ''}</button>
        ))}
      </div>
      <div className="dg-side-body">
        {side === 'props' && (
          <Inspector
            doc={doc} selection={selection} sim={usable} nameRef={nameRef} onPart={updatePart}
            onLabel={(id, n) => commit({ ...doc, labels: doc.labels.map((l) => (l.id === id ? { ...l, name: n } : l)) })}
            onNote={(id, text) => commit({ ...doc, notes: doc.notes.map((n) => (n.id === id ? { ...n, text } : n)) })}
            onRotate={rotate} onMirror={mirror} onDelete={removeSelection}
          />
        )}
        {side === 'sim' && <SimPanel settings={settings} stimulus={stimulus} stimulusErrors={parsedStimulus.errors} until={until} running={running} onSettings={setSettings} onStimulus={setStimulus} onUntil={setUntil} onRunStimulus={() => runStimulus()} />}
        {side === 'problems' && <ProblemsPanel problems={problems} onPick={flashRefs} />}
      </div>
    </aside>
  )

  const TABS: [TabId, string, typeof CircuitBoard][] = [['circuit', 'Circuit', CircuitBoard], ['boolean', 'Boolean', Sigma], ['fsm', 'State machine', GitBranch], ['numbers', 'Numbers', Binary], ['hdl', 'HDL', Code2]]

  return (
    <div className="k-app dg-app" ref={root} tabIndex={-1} data-size={compact ? 's' : width < 1150 ? 'm' : 'l'} onKeyDown={onKeyDown}>
      <div className="k-toolbar dg-toolbar">
        <button className="k-icon-btn" title="New (⌘N)" aria-label="New" onClick={() => void newDocument()}><FilePlus size={15} /></button>
        <button className="k-icon-btn" title="Open (⌘O)" aria-label="Open" onClick={() => void openDialog()}><FolderOpen size={15} /></button>
        <button className="k-icon-btn" title="Save (⌘S)" aria-label="Save" onClick={() => void save().catch((e) => os.dialog.alert(msgOf(e)))}><Save size={15} /></button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Undo (⌘Z)" aria-label="Undo" disabled={tab === 'fsm' ? fsmHist.current.past.length === 0 : !hist.current.canUndo} onClick={() => (tab === 'fsm' ? undoFsm() : undo())}><Undo2 size={15} /></button>
        <button className="k-icon-btn" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={tab === 'fsm' ? fsmHist.current.future.length === 0 : !hist.current.canRedo} onClick={() => (tab === 'fsm' ? redoFsm() : redo())}><Redo2 size={15} /></button>
        {tab === 'circuit' && (
          <>
            <span className="k-sep" />
            {toolBtn('select', <MousePointer2 size={15} />, 'Select and move (V)')}
            {toolBtn('wire', <Cable size={15} />, 'Draw a wire (W)')}
            {toolBtn('label', <Tag size={15} />, 'Net label (L)')}
            {toolBtn('note', <StickyNote size={15} />, 'Text note (T)')}
            {toolBtn('probe', <Eye size={15} />, 'Add a wire to the timing diagram (B)')}
            <span className="k-sep" />
            <button className="k-icon-btn" title="Rotate (R)" aria-label="Rotate" disabled={selection.size === 0 && tool.kind !== 'place'} onClick={rotate}><RotateCw size={15} /></button>
            <button className="k-icon-btn" title="Mirror (F)" aria-label="Mirror" disabled={selection.size === 0 && tool.kind !== 'place'} onClick={mirror}><FlipHorizontal2 size={15} /></button>
            <button className="k-icon-btn" title="Delete" aria-label="Delete" disabled={selection.size === 0} onClick={removeSelection}><Trash2 size={15} /></button>
            <span className="k-sep" />
            {running
              ? <button className="k-btn danger" onClick={() => setRunning(false)} title="Pause (⌘R or Space)"><Pause size={13} /> Pause</button>
              : <button className="k-btn primary" onClick={() => setRunning(true)} title="Run (⌘R or Space)"><Play size={13} /> Run</button>}
            <button className="k-icon-btn" title="Step one time unit (⌘.)" aria-label="Step one time unit" onClick={() => stepSim(1)}><StepForward size={15} /></button>
            <button className="k-icon-btn" title="Step to the next event (⇧⌘.)" aria-label="Step to the next event" onClick={nextEvent}><SkipForward size={15} /></button>
            <button className="k-icon-btn" title="Reset to time 0 (⇧⌘R)" aria-label="Reset" onClick={resetSim}><RotateCcw size={15} /></button>
            <select className="k-input dg-speed" value={prefs.speed} aria-label="Speed" title="Time units per second" onChange={(e) => setPrefs({ speed: Number(e.target.value) })}>
              {[...new Set([...SPEEDS, prefs.speed])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{s}/s</option>)}
            </select>
            <span className="dg-time" aria-live="off">{timeText}</span>
            <span className="k-spacer" />
            <button className={`k-icon-btn${prefs.palette ? ' active' : ''}`} title="Parts palette" aria-label="Parts palette" aria-pressed={prefs.palette} onClick={() => setPrefs({ palette: !prefs.palette, ...(compact && !prefs.palette ? { side: false } : {}) })}><PanelLeft size={15} /></button>
            <button className={`k-icon-btn${prefs.side ? ' active' : ''}`} title="Properties, simulation settings and problems" aria-label="Side panel" aria-pressed={prefs.side} onClick={() => setPrefs({ side: !prefs.side, ...(compact && !prefs.side ? { palette: false } : {}) })}><PanelRight size={15} /></button>
            <button className={`k-icon-btn${prefs.timing ? ' active' : ''}`} title="Timing diagram" aria-label="Timing diagram" aria-pressed={prefs.timing} onClick={() => setPrefs({ timing: !prefs.timing })}><Waypoints size={15} /></button>
          </>
        )}
      </div>
      <div className="dg-tabs" role="tablist">
        {TABS.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={13} /> {label}</button>)}
      </div>
      <div className="dg-body">
        {tab === 'circuit' && (
          <div className="dg-circuit">
            {prefs.palette && <aside className="dg-left"><Palette armed={tool.kind === 'place' ? tool.part : null} onArm={armPart} inputRef={searchRef} /></aside>}
            <div className="dg-center">
              {description && <div className="dg-banner"><span>{description}</span><button className="k-icon-btn" aria-label="Hide the description" onClick={() => setDescription('')}>×</button></div>}
              <div className="dg-sheet">
                <Canvas
                  ref={canvas} doc={doc} selection={selection} tool={tool} sim={usable} tick={tick} highlight={flash} dangling={dangling} probed={probed} showGrid={prefs.grid} wheelZooms={prefs.wheelZooms}
                  onSelect={setSelection} onChange={(d) => commit(d)} onTool={setTool} onHover={setHover} onEdit={(h) => void editHit(h)} onContext={contextMenu}
                  onText={(k, x, y) => void askText(k, x, y)} onDropPart={dropPart} onToggle={toggleInput} onPress={pressInput} onProbe={probeAt} onViewChange={(v: View) => setZoom(v.zoom)}
                />
              </div>
              {prefs.timing && (
                <>
                  <div className="dg-splitter" onPointerDown={dragDock} role="separator" aria-orientation="horizontal" aria-label="Resize the timing diagram" />
                  <div style={{ height: prefs.dockH }} className="dg-dock">
                    <Timing sim={usable} tick={tick} probes={probes} custom={customProbes !== null} running={running} unit={unit} onProbes={setProbes} onExport={exportTiming} onClose={() => setPrefs({ timing: false })} />
                  </div>
                </>
              )}
            </div>
            {prefs.side && sidePanel}
          </div>
        )}
        {tab === 'boolean' && <BooleanTab state={booleanState} circuit={doc} onState={setBoolean} onMakeCircuit={(d, nm) => void applyCircuit(d, nm)} />}
        {tab === 'fsm' && (
          <FsmTab
            fsm={fsm} sequence={fsmSeq} onChange={(f) => commitFsm(f)} onSequence={(s) => { setFsmSeq(s); touch() }}
            canUndo={fsmHist.current.past.length > 0} canRedo={fsmHist.current.future.length > 0} onUndo={undoFsm} onRedo={redoFsm}
            onImplement={(d, pr, nm, machine) => { const st = fsmStimulus(machine, fsmSeq); void applyCircuit(d, nm, { probes: pr, steps: st.steps, until: st.until }).then(() => setTimeout(() => runStimulus(st.steps, st.until), 80)) }}
          />
        )}
        {tab === 'numbers' && <NumbersTab state={numbers} onState={setNumbers} />}
        {tab === 'hdl' && <HdlTab doc={doc} fsm={fsm} name={name} stimulus={parsedStimulus.steps as Step[]} until={until} fsmSequence={fsmSeq} onSave={(text, def, ext) => void saveText(text, def, ext, 'Export HDL')} />}
      </div>
      <div className="k-statusbar dg-status">
        <span>{tab === 'circuit' ? `${hover ? `x ${Math.round(hover.x / 10)}, y ${Math.round(hover.y / 10)}` : 'x –, y –'} (grid units) · ${Math.round(zoom * 100)} %` : ''}</span>
        <span className="dg-status-hover">{hoverText}</span>
        <span className="k-spacer" />
        {tool.kind === 'place' && <span>Placing {KIND_DEFS[tool.part].name} — click to place, R rotates, Esc stops</span>}
        {tool.kind === 'wire' && <span>Wire — click pins and points; double-click or Esc ends</span>}
        {tool.kind === 'probe' && <span>Click a wire or pin to add it to the timing diagram</span>}
        <span className={`dg-sim-status${oscillating ? ' error' : running ? ' running' : ''}`}>{oscillating ? 'Oscillation detected' : running ? 'Running' : sim.current ? 'Paused' : 'Ready'}</span>
        <span>{doc.parts.length} parts</span>
      </div>
    </div>
  )
}

function pinXY(p: Part, pin: string): { x: number; y: number } | null {
  const def = KIND_DEFS[p.kind].shape(p).pins.find((d) => d.name === pin)
  if (!def) return null
  let x = p.mirror ? -def.x : def.x
  let y = def.y
  for (let i = 0; i < p.rot / 90; i++) { const t = x; x = -y; y = t }
  return { x: p.x + x, y: p.y + y }
}

void cloneDoc
void nextRef
void canonicalIds

const SHORTCUTS = [
  'V select · W wire · L net label · T note · B timing probe',
  'R rotate · F mirror · Delete remove · arrows nudge (Shift = 5 squares)',
  '⌘C copy · ⌘X cut · ⌘V paste · ⌘D duplicate · ⌘A select all',
  '⌘Z undo · ⇧⌘Z redo · ⌘S save · ⌘O open · ⌘N new',
  '⌘R or Space run / pause · ⌘. step one time unit · ⇧⌘. next event · ⇧⌘R reset',
  'P or / search the palette · Shift+A/O/N/R/X/I/D/S/L/C place AND, OR, NAND, NOR, XOR, NOT, D flip-flop, switch, LED, clock',
  'Click a switch to flip it, hold a push button to press it',
  'Wheel zooms (⌘/ctrl + wheel always); hold Space or the middle button and drag to pan · ⌘0 fit',
].join('\n\n')

const HELP = [
  '1. Pick a part in the palette (or press P and type its name) and click on the sheet to place it. R rotates it first.',
  '2. Press W, click a pin, click at each corner and on the pin where the wire ends. Parts with the same net-label name are joined without a wire.',
  '3. Press Run (or Space). Click the switches while it runs: wires turn green for 1, blue for 0, red for unknown (X), grey for high impedance (Z). Step moves one time unit; Next event jumps to what happens next.',
  '4. The Timing diagram shows inputs, clocks and outputs; use the probe tool (B) on any wire to add it. Click the diagram to place cursor A, Shift-click for B.',
  '5. Delays: unit delay makes glitches and hazards visible (open the “Static-1 hazard” example); zero delay settles instantly. A loop that never settles is reported as an oscillation.',
  'The Boolean tab minimises functions (Quine–McCluskey, Karnaugh maps) and draws them as gates; the State machine tab designs Moore and Mealy machines and builds their flip-flop circuit; Numbers explains two\'s complement and IEEE-754; HDL exports Verilog and VHDL.',
].join('\n\n')
