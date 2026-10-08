// kElec — electronics: draw a circuit (parts, wires, net labels) and simulate it with a small SPICE:
// DC operating point, DC sweep, AC sweep (Bode) and transient analysis, with an oscilloscope, a netlist
// editor, a library of examples and a set of calculators. Files are .kelec; "Send to kPCB" hands the
// netlist to the PCB designer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, BookOpen, Calculator as CalcIcon, CircuitBoard, Cable, ClipboardPaste, Copy, FilePlus, FlipHorizontal2, FolderOpen, Library, LineChart, MousePointer2, PanelLeft, PanelRight, Play,
  Redo2, RotateCw, Save, Square, StickyNote, Tag, Trash2, Undo2, Zap, FileCode, Maximize, ZoomIn, ZoomOut,
} from 'lucide-react'
import { os, fs, path, HOME, type AppProps, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { useAppTools } from '@/os/ai/appTools'
import { kelecTools, type ExportFormat, type Hooks } from './aiTools'
import { annotations } from './annotate'
import { bomCsv, bomMarkdown } from './bom'
import { Calculators } from './Calculators'
import { Canvas, type CanvasHandle, type Hit, type Tool, type View } from './Canvas'
import {
  History, cloneDoc, copyItems, deleteItems, mirrorItems, pasteClip, rotateItems, type Clip, clipIsEmpty,
} from './editor'
import { ExamplesTab } from './ExamplesTab'
import { EXAMPLES, exampleDoc, type Example } from './examples'
import { parseKelec, serializeKelec } from './file'
import { traceCsv } from './figures'
import { EXPORT_EXT, safeName, svgToPng } from './io'
import { CATEGORIES, PART_DEFS, PART_LIST, emptyDoc, newId, nextRef, toWorld, type Doc, type Part, type PartKind, type Rot } from './model'
import { buildNetlist, circuitToDoc } from './netlist'
import { toKNetlist } from './netlistExport'
import { NetlistTab } from './NetlistTab'
import { Palette } from './Palette'
import { Inspector, ResultsPanel, SimPanel } from './Panels'
import { ScopeDock } from './ScopeDock'
import { DEFAULT_SETTINGS, analysisOf, settingsFrom, type AnalysisKind, type SimSettings } from './settings'
import {
  acTrace, defaultTraces, prepareNetlist, prepareSchematic, signalNames, traceData, type Prepared, type RunOutput,
} from './session'
import { startSimulation, type SimJob } from './simClient'
import type { Analysis } from './sim/circuit'
import { SimError, type SimResult } from './sim/engine'
import { parseSpice, SpiceError, toSpice } from './sim/spice'
import { docToSvg, LIGHT_COLORS } from './svg'
import './kelec.css'

const DIR = `${HOME}/Documents/kElec`
const PREFS_KEY = 'kherveos.kelec.prefs'

type Tab = 'schematic' | 'netlist' | 'calc' | 'examples'
type Side = 'props' | 'sim' | 'results'

interface Prefs { grid: boolean; wheelZooms: boolean; volts: boolean; amps: boolean; palette: boolean; side: boolean; scope: boolean; dockH: number }
const DEFAULT_PREFS: Prefs = { grid: true, wheelZooms: true, volts: true, amps: true, palette: true, side: true, scope: true, dockH: 290 }

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
    return { ...DEFAULT_PREFS, ...Object.fromEntries(Object.entries(raw).filter(([k, v]) => k in DEFAULT_PREFS && typeof v === typeof DEFAULT_PREFS[k as keyof Prefs])) }
  } catch { return DEFAULT_PREFS }
}
function savePrefs(p: Prefs) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* storage blocked */ } }

interface RunState {
  status: 'idle' | 'running' | 'done' | 'error'
  out: RunOutput | null
  error: { message: string; refs: string[] } | null
  docVer: number
  msg: string | null
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The clip is shared between windows (kElec is a singleton, so this is one clipboard). */
let sharedClip: Clip | null = null

export default function KElec({ win, args }: AppProps) {
  const [doc, setDocState] = useState<Doc>(emptyDoc)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [tool, setTool] = useState<Tool>({ kind: 'select' })
  const [sim, setSimState] = useState<SimSettings>(DEFAULT_SETTINGS)
  const [netlist, setNetlistState] = useState('')
  const [tab, setTab] = useState<Tab>('schematic')
  const [side, setSide] = useState<Side>('props')
  const [name, setName] = useState('Untitled')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [rev, setRev] = useState(0)
  const [savedRev, setSavedRev] = useState(0)
  const [docVer, setDocVer] = useState(0)
  const [run, setRun] = useState<RunState>({ status: 'idle', out: null, error: null, docVer: -1, msg: null })
  const [traces, setTraces] = useState<string[]>([])
  const [stacked, setStacked] = useState(false)
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs)
  const [hover, setHover] = useState<Hit | null>(null)
  const [zoom, setZoom] = useState(1)
  const [flash, setFlash] = useState<Set<string>>(new Set())
  const [calcId, setCalcId] = useState('ohm')
  const [calcInputs, setCalcInputs] = useState<Record<string, Record<string, string>>>({})
  const [width, setWidth] = useState(1100)
  const [netMsg, setNetMsg] = useState<{ level: 'error' | 'ok' | 'info'; text: string } | null>(null)

  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<CanvasHandle>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const hist = useRef(new History())
  const job = useRef<SimJob | null>(null)
  const preferred = useRef<string[]>([])
  const pasteCount = useRef(0)

  const live = useRef({ doc, sim, netlist, name, tab, selection, tool, rev, savedRev, run, traces, filePath, docVer })
  live.current = { doc, sim, netlist, name, tab, selection, tool, rev, savedRev, run, traces, filePath, docVer }
  const dirty = rev !== savedRev

  const setPrefs = (patch: Partial<Prefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n })
  const compact = width < 900

  // ------------------------------------------------------------ document

  const touch = () => setRev((r) => r + 1)

  const commit = useCallback((next: Doc) => {
    hist.current.push(live.current.doc)
    live.current.doc = next
    setDocState(next)
    setDocVer((v) => v + 1)
    setRev((r) => r + 1)
  }, [])

  const replaceDoc = useCallback((next: Doc) => {
    hist.current.clear()
    live.current.doc = next
    setDocState(next)
    setDocVer((v) => v + 1)
    setSelection(new Set())
    setTool({ kind: 'select' })
  }, [])

  const setSim = (patch: Partial<SimSettings>) => { setSimState((s) => ({ ...s, ...patch })); touch() }
  const setNetlist = (t: string) => { setNetlistState(t); touch() }

  const built = useMemo(() => buildNetlist(doc, name), [doc, name])
  const dangling = useMemo(() => {
    const byName = new Map(built.nets.map((n) => [n.name, n]))
    const out = new Set<string>()
    for (const p of doc.parts) {
      if (p.kind === 'ground') continue
      const def = PART_DEFS[p.kind]
      for (const d of def.pins) {
        if (p.kind.startsWith('opamp') && (d.name === 'V+' || d.name === 'V-')) continue
        const n = byName.get(built.pinNet.get(`${p.ref}.${d.name}`) ?? '')
        if (n && n.pins.length <= 1 && !n.labelled && !n.ground) {
          const pos = pinPos(p, d.name)
          if (pos) out.add(`${pos.x},${pos.y}`)
        }
      }
    }
    return out
  }, [doc, built])

  const undo = () => { const d = hist.current.undo(live.current.doc); if (d) { live.current.doc = d; setDocState(d); setDocVer((v) => v + 1); touch(); setSelection(new Set()) } }
  const redo = () => { const d = hist.current.redo(live.current.doc); if (d) { live.current.doc = d; setDocState(d); setDocVer((v) => v + 1); touch(); setSelection(new Set()) } }

  // ------------------------------------------------------------ files

  const confirmDiscard = async (): Promise<boolean> => {
    if (live.current.rev === live.current.savedRev) return true
    return os.dialog.confirm('This circuit has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }

  const resetRun = () => setRun({ status: 'idle', out: null, error: null, docVer: -1, msg: null })

  const load = useCallback((l: { doc: Doc; sim: SimSettings; name: string; netlist: string }, p: string | null) => {
    replaceDoc(l.doc)
    setSimState(l.sim)
    setNetlistState(l.netlist)
    setName(l.name)
    setFilePath(p)
    setRev(0)
    setSavedRev(0)
    resetRun()
    setTraces([])
    preferred.current = []
    win.setDocumentPath(p)
    setTab('schematic')
    setTimeout(() => canvas.current?.fit(l.doc), 30)
  }, [replaceDoc, win])

  const openText = useCallback((text: string, p: string | null, fileName: string) => {
    const trimmed = text.trimStart()
    if (trimmed.startsWith('{')) {
      const l = parseKelec(text)
      load({ ...l, name: l.name || fileName }, p)
      return
    }
    // a SPICE netlist: draw it and keep the text
    const parsed = parseSpice(text)
    const d = circuitToDoc(parsed.circuit)
    const s = parsed.analyses[0] ? settingsFrom(parsed.analyses[0], DEFAULT_SETTINGS) : DEFAULT_SETTINGS
    load({ doc: d, sim: s, name: parsed.circuit.title || fileName, netlist: text }, null)
  }, [load])

  const openPath = useCallback(async (p: string) => {
    try { openText(await fs.readText(p), /\.kelec$/i.test(p) ? p : null, path.basename(p).replace(/\.[^.]+$/, '')) } catch (e) {
      await os.dialog.alert(`Could not open “${path.basename(p)}”: ${e instanceof SpiceError ? e.message : msgOf(e)}`, { title: 'Open' })
    }
  }, [openText])

  const openDialog = async () => {
    if (!(await confirmDiscard())) return
    const p = await os.dialog.openFile({ extensions: ['.kelec', '.cir', '.sp', '.net', '.spice'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (p) await openPath(p)
  }

  useEffect(() => {
    if (args.path && fs.exists(args.path)) void openPath(args.path)
    else if (typeof args.text === 'string' && args.text.trim()) {
      try { openText(args.text, null, typeof args.name === 'string' ? args.name : 'Untitled') } catch (e) { void os.dialog.alert(msgOf(e), { title: 'Open' }) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path, args.text])

  const newDocument = async () => {
    if (!(await confirmDiscard())) return
    load({ doc: emptyDoc(), sim: DEFAULT_SETTINGS, name: 'Untitled', netlist: '' }, null)
    setRev(0)
  }

  const writeKelec = async (p: string, withName?: string): Promise<string> => {
    const l = live.current
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeText(p, serializeKelec(l.doc, l.sim, withName ?? l.name, l.netlist))
    if (withName) { l.name = withName; setName(withName) }
    setFilePath(p)
    setSavedRev(l.rev)
    win.setDocumentPath(p)
    return p
  }

  const saveAs = async (): Promise<boolean> => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.name)}.kelec`, extensions: ['.kelec'], startDir: DIR })
    if (!p) return false
    const target = /\.kelec$/i.test(p) ? p : `${p}.kelec`
    await writeKelec(target, path.basename(target).replace(/\.kelec$/i, ''))
    os.notify({ title: 'Circuit saved', body: path.pretty(target) })
    return true
  }

  const save = async (): Promise<boolean> => {
    const p = live.current.filePath
    if (!p) return saveAs()
    await writeKelec(p)
    os.notify({ title: 'Circuit saved', body: path.pretty(p) })
    return true
  }

  // ------------------------------------------------------------ exports

  const schematicSvg = () => docToSvg(live.current.doc, LIGHT_COLORS)

  const exportBytes = async (format: ExportFormat): Promise<string | Uint8Array> => {
    const l = live.current
    switch (format) {
      case 'kelec': return serializeKelec(l.doc, l.sim, l.name, l.netlist)
      case 'svg': return schematicSvg().svg
      case 'png': { const s = schematicSvg(); return svgToPng(s.svg, s.width, s.height, 2) }
      case 'cir': {
        if (l.doc.parts.length === 0 && l.netlist.trim()) return l.netlist
        const b = buildNetlist(l.doc, l.name)
        const errors = b.problems.filter((p) => p.level === 'error')
        if (errors.length) throw new Error(errors[0].message)
        let an: Analysis[]
        try { an = [analysisOf(l.sim)] } catch { an = [] }
        return toSpice(b.circuit, an, { comments: true })
      }
      case 'bom': return bomCsv(l.doc)
      case 'bom-md': return bomMarkdown(l.doc, `${l.name}: bill of materials`)
      case 'knetlist': return JSON.stringify(toKNetlist(l.doc, l.name), null, 2) + '\n'
      case 'csv': {
        const r = l.run.out?.result
        if (!r || r.type === 'op') throw new Error('Run a transient, DC sweep or AC analysis first: there is no plot data yet.')
        return traceCsv(r, l.traces)
      }
      default: throw new Error('Unknown format.')
    }
  }

  const savePlotPng = async (png: Uint8Array) => {
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.name)}-plot.png`, extensions: ['.png'], startDir: DIR })
    if (p) { await fs.writeBytes(p, png); os.notify({ title: 'Plot saved', body: path.pretty(p) }) }
  }

  const defaultPath = (format: ExportFormat) => `${DIR}/${safeName(live.current.name)}${EXPORT_EXT[format]}`

  const sendToKpcb = async (): Promise<string> => {
    const l = live.current
    if (l.doc.parts.filter((p) => p.kind !== 'ground').length === 0) throw new Error('The schematic has no parts to send.')
    const netlistObj = toKNetlist(l.doc, l.name)
    try {
      os.open('kpcb', { netlist: netlistObj, name: l.name })
    } catch (e) {
      throw new Error(`kPCB could not be opened: ${msgOf(e)}`)
    }
    os.notify({ title: 'Sent to kPCB', body: `${netlistObj.components.length} components, ${netlistObj.nets.length} nets` })
    return `${netlistObj.components.length} components and ${netlistObj.nets.length} nets sent to kPCB.`
  }

  const exportAs = async (format: ExportFormat, target: string | null): Promise<string> => {
    if (format === 'kpcb') return sendToKpcb()
    if (format === 'kelec' && target) return writeKelec(target)
    const data = await exportBytes(format)
    let p = target
    if (!p) {
      if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
      const ext = EXPORT_EXT[format]
      p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.name)}${ext}`, extensions: [ext.slice(ext.lastIndexOf('.'))], startDir: DIR })
      if (!p) return ''
    }
    await fs.mkdir(path.dirname(p), { recursive: true })
    if (typeof data === 'string') await fs.writeText(p, data)
    else await fs.writeBytes(p, data)
    os.notify({ title: 'Exported', body: path.pretty(p) })
    return p
  }

  const doExport = async (format: ExportFormat) => {
    try { await exportAs(format, null) } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Export' }) }
  }

  // ------------------------------------------------------------ simulation

  const execute = async (prepared: Prepared): Promise<RunOutput> => {
    job.current?.cancel()
    const j = startSimulation(prepared.circuit, prepared.analysis)
    job.current = j
    const ver = live.current.docVer
    setRun((r) => ({ ...r, status: 'running', error: null, msg: `Running ${prepared.analysis.type === 'op' ? 'DC operating point' : prepared.analysis.type === 'dc' ? 'DC sweep' : prepared.analysis.type === 'ac' ? 'AC sweep' : 'transient'}…` }))
    const t0 = Date.now()
    try {
      const result: SimResult = await j.promise
      const out: RunOutput = { prepared, result, ms: Date.now() - t0 }
      const prev = live.current.run.out?.result.type
      const names = signalNames(result)
      const valid = (t: string) => { try { if (result.type === 'ac') acTrace(result.ac, t); else traceData(result, t); return true } catch { return false } }
      if (result.type !== 'op') {
        const keep = prev === result.type && live.current.traces.length > 0 && live.current.traces.every(valid)
        if (!keep) setTraces(defaultTraces(result, preferred.current.filter((t) => names.includes(t) || /[-+*/]/.test(t))))
        setPrefsState((p) => (p.scope ? p : { ...p, scope: true }))
      }
      const label = result.type === 'op' ? 'DC operating point' : result.type === 'dc' ? 'DC sweep' : result.type === 'ac' ? 'AC sweep' : 'Transient'
      setRun({ status: 'done', out, error: null, docVer: ver, msg: `${label}: done in ${out.ms} ms` })
      if (result.type === 'op') setSide('results')
      return out
    } catch (e) {
      const refs = e instanceof SimError ? e.refs : []
      const message = msgOf(e)
      if (message === 'Stopped.') setRun((r) => ({ ...r, status: 'idle', msg: 'Stopped.' }))
      else {
        setRun((r) => ({ ...r, status: 'error', error: { message, refs }, msg: 'Simulation failed' }))
        setSide('results')
        flashRefs(refs)
      }
      throw e
    } finally {
      if (job.current === j) job.current = null
    }
  }

  const flashRefs = (refs: string[]) => {
    const ids = new Set(live.current.doc.parts.filter((p) => refs.includes(p.ref)).map((p) => p.id))
    if (ids.size === 0) return
    setFlash(ids)
    setTimeout(() => setFlash(new Set()), 4000)
  }

  const runSim = async (kind?: AnalysisKind): Promise<void> => {
    const l = live.current
    const settings = kind ? { ...l.sim, analysis: kind } : l.sim
    if (kind) setSimState(settings)
    let prepared: Prepared
    try {
      prepared = l.tab === 'netlist' ? prepareNetlist(l.netlist, settings, kind) : prepareSchematic(l.doc, settings, l.name)
    } catch (e) {
      const refs = e instanceof SimError ? e.refs : []
      setRun((r) => ({ ...r, status: 'error', error: { message: msgOf(e), refs }, msg: 'Cannot simulate' }))
      setSide('results')
      flashRefs(refs)
      return
    }
    if (l.tab === 'netlist') { setSimState(prepared.settings); setNetMsg(null) }
    try { await execute(prepared) } catch { /* shown in the panel */ }
  }

  const stopSim = () => { job.current?.cancel() }

  // ------------------------------------------------------------ editing

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
  const removeSelection = () => {
    const l = live.current
    if (!l.selection.size) return
    commit(deleteItems(l.doc, l.selection))
    setSelection(new Set())
  }
  const copySel = () => { const l = live.current; if (l.selection.size) { sharedClip = copyItems(l.doc, l.selection); pasteCount.current = 0 } }
  const cutSel = () => { copySel(); removeSelection() }
  const paste = () => {
    if (clipIsEmpty(sharedClip)) return
    pasteCount.current += 1
    const off = 20 * pasteCount.current
    const r = pasteClip(live.current.doc, sharedClip!, off, off)
    commit(r.doc)
    setSelection(r.ids)
  }
  const duplicate = () => {
    const l = live.current
    if (!l.selection.size) return
    const clip = copyItems(l.doc, l.selection)
    const r = pasteClip(l.doc, clip, 20, 20)
    commit(r.doc)
    setSelection(r.ids)
  }
  const selectAll = () => {
    const l = live.current.doc
    setSelection(new Set([...l.parts.map((p) => p.id), ...l.wires.map((w) => w.id), ...l.labels.map((x) => x.id), ...l.notes.map((n) => n.id)]))
  }
  const nudge = (dx: number, dy: number) => {
    const l = live.current
    if (!l.selection.size) return
    commit(moveSel(l.doc, l.selection, dx, dy))
  }

  const armPart = (kind: PartKind) => {
    setTool({ kind: 'place', part: kind, rot: 0, mirror: false })
    setSelection(new Set())
    if (compact) setPrefs({ palette: false })
    setTab('schematic')
    root.current?.querySelector<HTMLElement>('.ke-canvas')?.focus()
  }

  const updatePart = (id: string, patch: Partial<Pick<Part, 'ref' | 'value' | 'rot' | 'mirror'>> & { props?: Record<string, string> }) => {
    const d = live.current.doc
    commit({ ...d, parts: d.parts.map((p) => (p.id === id ? { ...p, ...patch, props: patch.props ?? p.props } : p)) })
  }

  const askText = async (kind: 'label' | 'note', x: number, y: number) => {
    const d = live.current.doc
    if (kind === 'label') {
      const used = new Set(d.labels.map((l) => l.name))
      let guess = 'out'
      if (used.has(guess)) for (let i = 1; ; i++) { guess = `net${i}`; if (!used.has(guess)) break }
      const v = await os.dialog.prompt('Net label name (labels with the same name are connected; 0 or GND is ground):', { title: 'Net label', defaultValue: guess, okLabel: 'Place' })
      if (v && v.trim()) commit({ ...live.current.doc, labels: [...live.current.doc.labels, { id: newId('l'), name: v.trim(), x, y }] })
    } else {
      const v = await os.dialog.prompt('Text of the note:', { title: 'Note', defaultValue: 'Note', okLabel: 'Place' })
      if (v && v.trim()) commit({ ...live.current.doc, notes: [...live.current.doc.notes, { id: newId('n'), text: v, x, y }] })
    }
    setTool({ kind: 'select' })
  }

  const editHit = async (hit: Hit) => {
    if (hit.type === 'part') {
      const part = live.current.doc.parts.find((x) => x.id === hit.id)
      if (part?.kind === 'switch') {
        // a manual switch flips on double-click
        updatePart(part.id, { value: part.value === 'open' ? 'closed' : 'open' })
        return
      }
      setSide('props')
      setPrefs({ side: true })
      setTimeout(() => valueRef.current?.focus(), 30)
    } else if (hit.type === 'label') {
      const l = live.current.doc.labels.find((x) => x.id === hit.id)
      if (!l) return
      const v = await os.dialog.prompt('Net label name:', { title: 'Rename net label', defaultValue: l.name })
      if (v && v.trim() && v.trim() !== l.name) commit({ ...live.current.doc, labels: live.current.doc.labels.map((x) => (x.id === l.id ? { ...x, name: v.trim() } : x)) })
    } else if (hit.type === 'note') {
      setSide('props')
      setPrefs({ side: true })
    }
  }

  const dropPart = (kind: PartKind, x: number, y: number) => {
    const d = live.current.doc
    const part: Part = { id: newId('p'), kind, ref: kind === 'ground' ? '' : nextRef(d, PART_DEFS[kind].prefix), value: PART_DEFS[kind].value?.default ?? '', x, y, rot: 0, mirror: false, props: Object.fromEntries(PART_DEFS[kind].props.map((p) => [p.key, p.default])) }
    commit({ ...d, parts: [...d.parts, part] })
    setSelection(new Set([part.id]))
  }

  const contextMenu = (e: React.MouseEvent, hit: Hit) => {
    const l = live.current
    const items: MenuItem[] = []
    if (hit.type === 'none') {
      items.push(
        { label: 'Paste', icon: ClipboardPaste, shortcut: '⌘V', disabled: clipIsEmpty(sharedClip), onClick: paste },
        { label: 'Add net label', icon: Tag, shortcut: 'L', onClick: () => setTool({ kind: 'label' }) },
        { label: 'Add note', icon: StickyNote, shortcut: 'T', onClick: () => setTool({ kind: 'note' }) },
        '-',
        { label: 'Fit to window', icon: Maximize, shortcut: '⌘0', onClick: () => canvas.current?.fit(l.doc) },
      )
    } else {
      if (hit.type === 'part') items.push({ label: 'Properties', onClick: () => void editHit(hit) }, '-')
      if (hit.type === 'label') items.push({ label: 'Rename…', onClick: () => void editHit(hit) }, '-')
      items.push(
        { label: 'Rotate', icon: RotateCw, shortcut: 'R', onClick: rotate },
        { label: 'Mirror', icon: FlipHorizontal2, shortcut: 'F', onClick: mirror },
        { label: 'Duplicate', icon: Copy, shortcut: '⌘D', onClick: duplicate },
        { label: 'Copy', shortcut: '⌘C', onClick: copySel },
        { label: 'Cut', shortcut: '⌘X', onClick: cutSel },
        '-',
        { label: 'Delete', icon: Trash2, shortcut: '⌫', danger: true, onClick: removeSelection },
      )
    }
    os.contextMenu(e, items)
  }

  // ------------------------------------------------------------ examples, netlist

  const loadExample = useCallback(async (ex: Example, ask = true) => {
    if (ask && !(await confirmDiscard())) return
    const d = exampleDoc(ex)
    const s: SimSettings = { ...DEFAULT_SETTINGS, ...ex.sim }
    load({ doc: d, sim: s, name: ex.title, netlist: '' }, null)
    preferred.current = ex.show
    setStacked(!!ex.stacked)
    setSide('props')
    setTimeout(() => { void runSim() }, 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const netlistFromSchematic = () => {
    const l = live.current
    const b = buildNetlist(l.doc, l.name)
    const errors = b.problems.filter((p) => p.level === 'error')
    if (errors.length) { setNetMsg({ level: 'error', text: errors[0].message }); return }
    let an: Analysis[]
    try { an = [analysisOf(l.sim)] } catch { an = [] }
    setNetlist(toSpice(b.circuit, an, { comments: true }))
    setNetMsg({ level: 'ok', text: `Written from the schematic: ${b.circuit.elements.length} elements.` })
  }

  const netlistToSchematic = () => {
    try {
      const parsed = parseSpice(live.current.netlist)
      if (parsed.circuit.elements.length === 0) { setNetMsg({ level: 'error', text: 'The netlist has no parts.' }); return }
      commit(circuitToDoc(parsed.circuit))
      if (parsed.analyses[0]) setSimState(settingsFrom(parsed.analyses[0], live.current.sim))
      if (parsed.circuit.title) setName((n) => (n === 'Untitled' ? parsed.circuit.title : n))
      setTab('schematic')
      setTimeout(() => canvas.current?.fit(live.current.doc), 30)
    } catch (e) { setNetMsg({ level: 'error', text: msgOf(e) }) }
  }

  const importNetlist = async () => {
    const p = await os.dialog.openFile({ extensions: ['.cir', '.sp', '.net', '.spice', '.txt'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (!p) return
    try { setNetlist(await fs.readText(p)); setTab('netlist') } catch (e) { await os.dialog.alert(msgOf(e), { title: 'Import' }) }
  }

  const exportNetlistText = async () => {
    const text = live.current.netlist
    if (!text.trim()) { setNetMsg({ level: 'info', text: 'There is no text to save yet.' }); return }
    if (!fs.isDir(DIR)) await fs.mkdir(DIR, { recursive: true })
    const p = await os.dialog.saveFile({ defaultName: `${safeName(live.current.name)}.cir`, extensions: ['.cir'], startDir: DIR })
    if (!p) return
    await fs.writeText(p, text)
    os.notify({ title: 'Netlist saved', body: path.pretty(p) })
  }

  const netStatus = useMemo(() => {
    if (!netlist.trim()) return null
    try {
      const p = parseSpice(netlist)
      const an = p.analyses.map((a) => a.type).join(', ')
      return { level: 'ok' as const, text: `${p.circuit.elements.length} elements${an ? ` · analyses: ${an}` : ''}${p.warnings.length ? ` · ${p.warnings[0]}` : ''}` }
    } catch (e) { return { level: 'error' as const, text: e instanceof SpiceError ? e.message : msgOf(e) } }
  }, [netlist])

  // ------------------------------------------------------------ window: title, close guard, menus

  useEffect(() => { win.setTitle(`kElec — ${name}${dirty ? ' •' : ''}`) }, [win, name, dirty])

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

  useEffect(() => () => { job.current?.cancel() }, [])

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

  useEffect(() => {
    const placeItems = (cat: (typeof CATEGORIES)[number]): MenuItem[] => PART_LIST.filter((d) => d.category === cat).map((d) => ({ label: d.name, onClick: () => armPart(d.kind) }))
    const examples: MenuItem[] = EXAMPLES.map((ex) => ({ label: ex.title, onClick: () => void loadExample(ex) }))
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New', icon: FilePlus, shortcut: '⌘N', onClick: () => void newDocument() },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openDialog() },
          { label: 'Open example', icon: Library, submenu: examples },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save().catch((e) => os.dialog.alert(msgOf(e))) },
          { label: 'Save as…', shortcut: '⇧⌘S', onClick: () => void saveAs().catch((e) => os.dialog.alert(msgOf(e))) },
          '-',
          { label: 'Import SPICE netlist…', icon: FileCode, onClick: () => void importNetlist() },
          {
            label: 'Export', submenu: [
              { label: 'Schematic as SVG…', onClick: () => void doExport('svg') }, { label: 'Schematic as PNG…', onClick: () => void doExport('png') },
              { label: 'SPICE netlist (.cir)…', onClick: () => void doExport('cir') }, '-',
              { label: 'Bill of materials (CSV)…', onClick: () => void doExport('bom') }, { label: 'Bill of materials (Markdown)…', onClick: () => void doExport('bom-md') }, '-',
              { label: 'Netlist for kPCB (JSON)…', onClick: () => void doExport('knetlist') }, { label: 'Plot data (CSV)…', onClick: () => void doExport('csv') },
            ],
          },
          '-',
          { label: 'Send to kPCB', icon: CircuitBoard, onClick: () => void sendToKpcb().catch((e) => os.dialog.alert(msgOf(e), { title: 'kPCB' })) },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !hist.current.canUndo, onClick: undo },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !hist.current.canRedo, onClick: redo },
          '-',
          { label: 'Cut', shortcut: '⌘X', disabled: selection.size === 0, onClick: cutSel },
          { label: 'Copy', shortcut: '⌘C', disabled: selection.size === 0, onClick: copySel },
          { label: 'Paste', shortcut: '⌘V', disabled: clipIsEmpty(sharedClip), onClick: paste },
          { label: 'Duplicate', shortcut: '⌘D', disabled: selection.size === 0, onClick: duplicate },
          { label: 'Delete', shortcut: '⌫', disabled: selection.size === 0, onClick: removeSelection },
          { label: 'Select all', shortcut: '⌘A', onClick: selectAll },
          '-',
          { label: 'Rotate', icon: RotateCw, shortcut: 'R', onClick: rotate },
          { label: 'Mirror', icon: FlipHorizontal2, shortcut: 'F', onClick: mirror },
        ],
      },
      {
        label: 'Place',
        items: [
          { label: 'Wire', icon: Cable, shortcut: 'W', checked: tool.kind === 'wire', onClick: () => { setTab('schematic'); setTool({ kind: 'wire' }) } },
          { label: 'Ground', shortcut: 'G', onClick: () => armPart('ground') },
          { label: 'Net label', icon: Tag, shortcut: 'L', onClick: () => { setTab('schematic'); setTool({ kind: 'label' }) } },
          { label: 'Text note', icon: StickyNote, shortcut: 'T', onClick: () => { setTab('schematic'); setTool({ kind: 'note' }) } },
          '-',
          ...CATEGORIES.map((c) => ({ label: c, submenu: placeItems(c) })),
        ],
      },
      {
        label: 'Simulate',
        items: [
          { label: 'Run DC operating point', icon: Zap, onClick: () => void runSim('op') },
          { label: 'Run DC sweep', onClick: () => void runSim('dc') },
          { label: 'Run AC sweep', onClick: () => void runSim('ac') },
          { label: 'Run transient', onClick: () => void runSim('tran') },
          '-',
          { label: 'Run the selected analysis', icon: Play, shortcut: '⌘R', onClick: () => void runSim() },
          { label: 'Stop', icon: Square, shortcut: '⌘.', disabled: run.status !== 'running', onClick: stopSim },
          '-',
          { label: 'Voltages on the schematic', checked: prefs.volts, onClick: () => setPrefs({ volts: !prefs.volts }) },
          { label: 'Currents on the schematic', checked: prefs.amps, onClick: () => setPrefs({ amps: !prefs.amps }) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Zoom in', icon: ZoomIn, shortcut: '⌘+', onClick: () => canvas.current?.zoomBy(1.25) },
          { label: 'Zoom out', icon: ZoomOut, shortcut: '⌘-', onClick: () => canvas.current?.zoomBy(0.8) },
          { label: 'Fit to window', shortcut: '⌘0', onClick: () => canvas.current?.fit(live.current.doc) },
          '-',
          { label: 'Grid', checked: prefs.grid, onClick: () => setPrefs({ grid: !prefs.grid }) },
          { label: 'Scroll wheel zooms', checked: prefs.wheelZooms, onClick: () => setPrefs({ wheelZooms: !prefs.wheelZooms }) },
          '-',
          { label: 'Parts palette', checked: prefs.palette, onClick: () => setPrefs({ palette: !prefs.palette }) },
          { label: 'Side panel', checked: prefs.side, onClick: () => setPrefs({ side: !prefs.side }) },
          { label: 'Plot', checked: prefs.scope, onClick: () => setPrefs({ scope: !prefs.scope }) },
          '-',
          { label: 'Schematic', checked: tab === 'schematic', onClick: () => setTab('schematic') },
          { label: 'Netlist', checked: tab === 'netlist', onClick: () => setTab('netlist') },
          { label: 'Calculators', checked: tab === 'calc', onClick: () => setTab('calc') },
          { label: 'Examples', checked: tab === 'examples', onClick: () => setTab('examples') },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'Keyboard shortcuts', icon: BookOpen, onClick: () => void os.dialog.alert(SHORTCUTS, { title: 'kElec shortcuts' }) },
          { label: 'How to use kElec', onClick: () => void os.dialog.alert(HELP, { title: 'kElec' }) },
        ],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, tool.kind, tab, run.status, selection.size, rev, name, compact, docVer])

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
      if (k === 'r') { e.preventDefault(); void runSim(); return }
      if (k === '.') { e.preventDefault(); stopSim(); return }
      if (typing || tab !== 'schematic') return
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
    if (typing || tab !== 'schematic') return
    if (e.altKey) return
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelection(); return }
    if (e.key === 'Escape') {
      if (canvas.current?.cancel()) return
      if (tool.kind !== 'select') setTool({ kind: 'select' })
      else setSelection(new Set())
      return
    }
    const step = e.shiftKey ? 50 : 10
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); return }
    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); return }
    if (e.shiftKey) {
      const quick: Record<string, PartKind> = { r: 'resistor', c: 'capacitor', l: 'inductor', v: 'battery', d: 'diode', q: 'npn', o: 'opamp', i: 'isource', s: 'switch', z: 'zener' }
      if (quick[k]) { e.preventDefault(); armPart(quick[k]); return }
    }
    switch (k) {
      case 'r': rotate(); break
      case 'f': mirror(); break
      case 'w': setTool({ kind: 'wire' }); break
      case 'g': armPart('ground'); break
      case 'l': setTool({ kind: 'label' }); break
      case 't': setTool({ kind: 'note' }); break
      case 'v': setTool({ kind: 'select' }); break
      case 'p': case '/': e.preventDefault(); setPrefs({ palette: true }); setTimeout(() => searchRef.current?.focus(), 20); break
      case '+': case '=': canvas.current?.zoomBy(1.25); break
      case '-': canvas.current?.zoomBy(0.8); break
      case '0': canvas.current?.fit(live.current.doc); break
      default: break
    }
  }

  // ------------------------------------------------------------ AI tools

  const hooks: Hooks = {
    state: () => ({ doc: live.current.doc, sim: live.current.sim, name: live.current.name, netlist: live.current.netlist, dirty: live.current.rev !== live.current.savedRev, tab: live.current.tab }),
    apply: (d, _what, extra) => {
      commit(d)
      if (extra?.sim) setSimState((s) => ({ ...s, ...extra.sim }))
      if (extra?.name) setName(extra.name)
      if (extra?.netlist !== undefined) setNetlistState(extra.netlist)
      setTab('schematic')
      if (extra?.fit) setTimeout(() => canvas.current?.fit(live.current.doc), 30)
    },
    run: (p) => execute(p),
    showCalculator: (id, inputs) => { setCalcId(id); setCalcInputs((c) => ({ ...c, [id]: inputs })); setTab('calc') },
    openExample: async (ex) => { await loadExample(ex, true) },
    center: () => canvas.current?.center() ?? { x: 200, y: 150 },
    defaultPath,
    exportAs,
  }
  useAppTools(win, kelecTools(hooks))

  // ------------------------------------------------------------ derived for rendering

  const result = run.out?.result ?? null
  const stale = run.docVer !== docVer
  const annots = useMemo(() => {
    if (!run.out || run.out.result.type !== 'op' || stale || tab !== 'schematic') return []
    const b = run.out.prepared.build
    if (!b) return []
    return annotations(doc, b, run.out.result.op, { voltages: prefs.volts, currents: prefs.amps })
  }, [run.out, stale, tab, doc, prefs.volts, prefs.amps])
  const highlight = useMemo(() => {
    const ids = new Set(flash)
    return ids
  }, [flash])
  const sources = useMemo(() => built.circuit.elements.filter((e) => e.kind === 'V' || e.kind === 'I').map((e) => e.name), [built])
  const op = result?.type === 'op' && !stale ? result.op : null
  const hoverText = useMemo(() => {
    if (!hover) return ''
    const net = (n: string | undefined) => (n === undefined ? '' : ` · net ${n}${op && n in op.nodes ? ` = ${formatV(op.nodes[n])}` : ''}`)
    if (hover.type === 'pin') return `${hover.ref}.${hover.pin}${net(built.pinNet.get(`${hover.ref}.${hover.pin}`))}`
    if (hover.type === 'wire') { const w = doc.wires.find((x) => x.id === hover.id); return w ? `wire${net(built.pointNet.get(`${w.x1},${w.y1}`))}` : '' }
    if (hover.type === 'part') { const p = doc.parts.find((x) => x.id === hover.id); return p ? `${p.ref || 'ground'} ${PART_DEFS[p.kind].name}${p.value ? ` · ${p.value}` : ''}` : '' }
    if (hover.type === 'label') return 'net label'
    return ''
  }, [hover, built, doc, op])

  const sidePanel = (
    <aside className="ke-side">
      <div className="ke-seg ke-side-tabs" role="tablist">
        {([['props', 'Properties'], ['sim', 'Simulate'], ['results', 'Results']] as [Side, string][]).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={side === id} className={side === id ? 'on' : ''} onClick={() => setSide(id)}>{label}{id === 'results' && built.problems.some((p) => p.level === 'error') ? ' !' : ''}</button>
        ))}
      </div>
      <div className="ke-side-body">
        {side === 'props' && (
          <Inspector
            doc={doc} selection={selection} built={built} op={op} valueRef={valueRef} onPart={updatePart}
            onLabel={(id, n) => commit({ ...doc, labels: doc.labels.map((l) => (l.id === id ? { ...l, name: n } : l)) })}
            onNote={(id, text) => commit({ ...doc, notes: doc.notes.map((n) => (n.id === id ? { ...n, text } : n)) })}
            onRotate={rotate} onMirror={mirror} onDelete={removeSelection}
          />
        )}
        {side === 'sim' && <SimPanel s={sim} sources={sources} running={run.status === 'running'} message={run.msg} onChange={setSim} onRun={(k) => void runSim(k)} onStop={stopSim} />}
        {side === 'results' && (
          <ResultsPanel
            result={result} built={run.out?.prepared.build ?? null} problems={tab === 'netlist' ? run.out?.prepared.problems ?? [] : built.problems.filter((p) => p.level !== 'info')} error={run.error}
            stale={stale && tab === 'schematic'} running={run.status === 'running'}
            onPick={(refs) => { const ids = new Set(doc.parts.filter((p) => refs.includes(p.ref)).map((p) => p.id)); if (ids.size) { setSelection(ids); flashRefs(refs) } }}
          />
        )}
      </div>
    </aside>
  )

  const showDock = (tab === 'schematic' || tab === 'netlist') && prefs.scope && !!result && result.type !== 'op'
  const dragDock = (e: React.PointerEvent) => {
    const startY = e.clientY
    const start = prefs.dockH
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setPrefsState((p) => ({ ...p, dockH: Math.min(560, Math.max(160, start + startY - ev.clientY)) }))
    const up = () => { el.removeEventListener('pointermove', move as EventListener); el.removeEventListener('pointerup', up); setPrefsState((p) => { savePrefs(p); return p }) }
    el.addEventListener('pointermove', move as EventListener)
    el.addEventListener('pointerup', up)
  }

  const toolBtn = (t: Tool['kind'], icon: React.ReactNode, title: string) => (
    <button className={`k-icon-btn${tool.kind === t ? ' active' : ''}`} title={title} aria-label={title} aria-pressed={tool.kind === t} onClick={() => { setTab('schematic'); setTool({ kind: t } as Tool) }}>{icon}</button>
  )

  return (
    <div className="k-app ke-app" ref={root} tabIndex={-1} data-size={compact ? 's' : width < 1150 ? 'm' : 'l'} onKeyDown={onKeyDown}>
      <div className="k-toolbar ke-toolbar">
        <button className="k-icon-btn" title="New (⌘N)" aria-label="New" onClick={() => void newDocument()}><FilePlus size={15} /></button>
        <button className="k-icon-btn" title="Open (⌘O)" aria-label="Open" onClick={() => void openDialog()}><FolderOpen size={15} /></button>
        <button className="k-icon-btn" title="Save (⌘S)" aria-label="Save" onClick={() => void save().catch((e) => os.dialog.alert(msgOf(e)))}><Save size={15} /></button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="Undo (⌘Z)" aria-label="Undo" disabled={!hist.current.canUndo} onClick={undo}><Undo2 size={15} /></button>
        <button className="k-icon-btn" title="Redo (⇧⌘Z)" aria-label="Redo" disabled={!hist.current.canRedo} onClick={redo}><Redo2 size={15} /></button>
        <span className="k-sep" />
        {toolBtn('select', <MousePointer2 size={15} />, 'Select and move (V)')}
        {toolBtn('wire', <Cable size={15} />, 'Draw a wire (W)')}
        {toolBtn('label', <Tag size={15} />, 'Net label (L)')}
        {toolBtn('note', <StickyNote size={15} />, 'Text note (T)')}
        <span className="k-sep" />
        <button className="k-icon-btn" title="Rotate (R)" aria-label="Rotate" disabled={selection.size === 0 && tool.kind !== 'place'} onClick={rotate}><RotateCw size={15} /></button>
        <button className="k-icon-btn" title="Mirror (F)" aria-label="Mirror" disabled={selection.size === 0 && tool.kind !== 'place'} onClick={mirror}><FlipHorizontal2 size={15} /></button>
        <button className="k-icon-btn" title="Delete" aria-label="Delete" disabled={selection.size === 0} onClick={removeSelection}><Trash2 size={15} /></button>
        <span className="k-sep" />
        <select className="k-input ke-analysis" value={sim.analysis} aria-label="Analysis" onChange={(e) => setSim({ analysis: e.target.value as AnalysisKind })}>
          <option value="op">DC operating point</option><option value="dc">DC sweep</option><option value="ac">AC sweep</option><option value="tran">Transient</option>
        </select>
        {run.status === 'running'
          ? <button className="k-btn danger" onClick={stopSim} title="Stop (⌘.)"><Square size={13} /> Stop</button>
          : <button className="k-btn primary" onClick={() => void runSim()} title="Run the analysis (⌘R)"><Play size={13} /> Run</button>}
        <button className={`k-icon-btn${prefs.volts ? ' active' : ''}`} title="Show voltages after a DC run" aria-label="Show voltages" aria-pressed={prefs.volts} onClick={() => setPrefs({ volts: !prefs.volts })}><Activity size={15} /></button>
        <span className="k-spacer" />
        <button className="k-btn" title="Open this circuit in the PCB designer" onClick={() => void sendToKpcb().catch((e) => os.dialog.alert(msgOf(e), { title: 'kPCB' }))}><CircuitBoard size={13} /> {compact ? '' : 'Send to kPCB'}</button>
        {tab === 'schematic' && <button className={`k-icon-btn${prefs.palette ? ' active' : ''}`} title="Parts palette" aria-label="Parts palette" aria-pressed={prefs.palette} onClick={() => setPrefs({ palette: !prefs.palette, ...(compact && !prefs.palette ? { side: false } : {}) })}><PanelLeft size={15} /></button>}
        {tab === 'schematic' && <button className={`k-icon-btn${prefs.side ? ' active' : ''}`} title="Properties, simulation settings and results" aria-label="Side panel" aria-pressed={prefs.side} onClick={() => setPrefs({ side: !prefs.side, ...(compact && !prefs.side ? { palette: false } : {}) })}><PanelRight size={15} /></button>}
      </div>
      <div className="ke-tabs" role="tablist">
        {([['schematic', 'Schematic', CircuitBoard], ['netlist', 'Netlist', FileCode], ['calc', 'Calculators', CalcIcon], ['examples', 'Examples', Library]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={13} /> {label}</button>
        ))}
        {result && result.type !== 'op' && !prefs.scope && tab !== 'calc' && tab !== 'examples' && <button className="ke-tab-extra" onClick={() => setPrefs({ scope: true })}><LineChart size={13} /> Show plot</button>}
      </div>
      <div className="ke-body">
        {tab === 'schematic' && (
          <div className="ke-schematic">
            {prefs.palette && <aside className="ke-left"><Palette armed={tool.kind === 'place' ? tool.part : null} onArm={armPart} inputRef={searchRef} /></aside>}
            <div className="ke-center">
              <div className="ke-sheet">
                <Canvas
                  ref={canvas} doc={doc} selection={selection} tool={tool} annotations={annots} highlight={highlight} dangling={dangling} showGrid={prefs.grid} wheelZooms={prefs.wheelZooms}
                  onSelect={setSelection} onChange={(d) => commit(d)} onTool={setTool} onHover={setHover} onEdit={(h) => void editHit(h)} onContext={contextMenu}
                  onText={(k, x, y) => void askText(k, x, y)} onDropPart={dropPart} onViewChange={(v: View) => setZoom(v.zoom)}
                />
              </div>
              {showDock && result && (
                <>
                  <div className="ke-splitter" onPointerDown={dragDock} role="separator" aria-orientation="horizontal" aria-label="Resize the plot" />
                  <div style={{ height: prefs.dockH }} className="ke-dock">
                    <ScopeDock
                      result={result} stale={stale} traces={traces} stacked={stacked} signals={signalNames(result)} onTraces={setTraces} onStacked={setStacked}
                      onCsv={() => void doExport('csv')}
                      onPng={(png) => void savePlotPng(png)}
                      onClose={() => setPrefs({ scope: false })}
                    />
                  </div>
                </>
              )}
            </div>
            {prefs.side && sidePanel}
          </div>
        )}
        {tab === 'netlist' && (
          <div className="ke-netlist-wrap">
            <NetlistTab
              text={netlist} message={netMsg ?? netStatus} running={run.status === 'running'} onText={(t) => { setNetlist(t); setNetMsg(null) }}
              onFromSchematic={netlistFromSchematic} onToSchematic={netlistToSchematic} onRun={() => void runSim()} onExport={() => void exportNetlistText()}
            />
            {showDock && result && (
              <div style={{ height: prefs.dockH }} className="ke-dock">
                <ScopeDock
                  result={result} stale={false} traces={traces} stacked={stacked} signals={signalNames(result)} onTraces={setTraces} onStacked={setStacked}
                  onCsv={() => void doExport('csv')} onPng={(png) => void savePlotPng(png)} onClose={() => setPrefs({ scope: false })}
                />
              </div>
            )}
            {result?.type === 'op' && run.out?.prepared.source === 'netlist' && <div className="ke-netlist-res">{sidePanelResults(result, run.out)}</div>}
          </div>
        )}
        {tab === 'calc' && <Calculators id={calcId} inputs={calcInputs} onSelect={setCalcId} onInputs={(id, v) => setCalcInputs((c) => ({ ...c, [id]: v }))} />}
        {tab === 'examples' && <ExamplesTab onOpen={(ex) => void loadExample(ex)} />}
      </div>
      <div className="k-statusbar ke-status">
        <span>{tab === 'schematic' ? `${hover ? `x ${Math.round(hover.x / 10)}, y ${Math.round(hover.y / 10)}` : 'x –, y –'} (grid units)` : ''}</span>
        {tab === 'schematic' && <span>{Math.round(zoom * 100)} %</span>}
        <span className="ke-status-hover">{hoverText}</span>
        <span className="k-spacer" />
        {tool.kind === 'place' && <span>Placing {PART_DEFS[tool.part].name} — click to place, R rotates, Esc stops</span>}
        {tool.kind === 'wire' && <span>Wire — click pins and points; double-click or Esc ends</span>}
        <span className={`ke-sim-status ${run.status}`}>{run.status === 'running' ? 'Simulating…' : run.msg ?? 'Ready'}{stale && run.status === 'done' && tab === 'schematic' ? ' (out of date)' : ''}</span>
        <span>{doc.parts.filter((p) => p.kind !== 'ground').length} parts</span>
      </div>
    </div>
  )

  function sidePanelResults(r: SimResult, out: RunOutput) {
    return <ResultsPanel result={r} built={null} problems={out.prepared.problems} error={null} stale={false} running={false} onPick={() => undefined} />
  }
}

// ------------------------------------------------------------------------------ helpers

function pinPos(p: Part, pin: string): { x: number; y: number } | null {
  const def = PART_DEFS[p.kind].pins.find((d) => d.name === pin)
  return def ? toWorld(p, def.x, def.y) : null
}

function moveSel(doc: Doc, ids: ReadonlySet<string>, dx: number, dy: number): Doc {
  const d = cloneDoc(doc)
  d.parts = d.parts.map((p) => (ids.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p))
  d.wires = d.wires.map((w) => (ids.has(w.id) ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w))
  d.labels = d.labels.map((l) => (ids.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l))
  d.notes = d.notes.map((n) => (ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n))
  return d
}

function formatV(v: number): string { return `${Number(v.toPrecision(4))} V` }

const SHORTCUTS = [
  'V select · W wire · G ground · L net label · T note',
  'R rotate · F mirror · Delete remove · arrows nudge (Shift = 5 squares)',
  '⌘C copy · ⌘X cut · ⌘V paste · ⌘D duplicate · ⌘A select all',
  '⌘Z undo · ⇧⌘Z redo · ⌘S save · ⌘O open · ⌘N new',
  '⌘R run the analysis · ⌘. stop',
  'P or / search the palette · Shift+R/C/L/V/D/Q/O/I/S/Z place a resistor, capacitor, inductor, voltage source, diode, NPN, op-amp, current source, switch, Zener',
  'Wheel zooms (⌘/ctrl + wheel always); hold Space or the middle button and drag to pan',
  '⌘0 fit to window · ⌘+ / ⌘- zoom',
].join('\n\n')

const HELP = [
  '1. Pick a part in the palette (or press P and type its name), click on the sheet to place it. R rotates it before you click.',
  '2. Press W, click a pin, click again at each corner and on the pin where the wire ends. Or drag from a pin. Parts with the same net label name are joined without a wire.',
  '3. Select a part (double-click jumps to its value) to change it in the Properties panel: 4.7k, 100n, 2.2u, 1meg. Double-click a manual switch to flip it.',
  '4. Put a ground symbol (G) on the node that is 0 V, then Run: DC operating point shows voltages and currents on the schematic; AC and transient open the plot.',
  'Everything can also be typed as a SPICE netlist in the Netlist tab. The Examples tab has ready circuits, and Calculators has the everyday formulas.',
  'Oscillators have no DC operating point: tick “start from initial conditions” in Simulate (kElec does it for you when the DC solution fails) and give a capacitor a little initial voltage to start them.',
].join('\n\n')
