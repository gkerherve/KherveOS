// kPCB — printed-circuit-board design: a board editor (parts, tracks, vias, zones, outline), a footprint
// library, nets and a ratsnest, an interactive router and an auto-router, design-rule checks, a 3D
// preview and exports (Gerber, drill, SVG, PNG, BOM, pick and place). Boards are .kpcb files.

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  Box, CircleDot, Component, FilePlus, FlipHorizontal2, FolderOpen, Frame, HelpCircle, Hexagon, MousePointer2, Redo2, Ruler, Save, ShieldCheck, Undo2, Waypoints, WandSparkles, Circle,
  PanelLeft, PanelRight, CircuitBoard, Link2,
} from 'lucide-react'
import { os, fs, path as osPath, HOME, type AppProps, type MenuBarMenu, type MenuItem } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { exampleFolderPath, seedExampleFolder, type ExampleFile } from '@/os/exampleFiles'
import { kpcbTools } from './aiTools'
import type { Hooks } from './aiTools'
import { History } from './history'
import { newDesign, reid } from './board'
import { analyze, ratsnest } from './analysis'
import { runDrc, drcSummary } from './drc'
import { fillZones } from './zones'
import { autoroute, unroute } from './autoroute'
import type { RouteResult } from './autoroute'
import { arrangeParts, suggestBoardSize } from './arrange'
import { EXAMPLES, routedExample } from './examples'
import { parseNetlist, applyNetlist } from './netlist'
import type { NetlistReport } from './netlist'
import { parseDesign, serializeDesign } from './file'
import {
  OUTLINE_PRESETS, alignParts, applyOutlinePreset, boardZone, connectedTrack, copyItems, deleteItems, deleteNetCopper, distributeParts, flipParts, pasteClipboard, rotateParts,
  setOutlineRect, setPartProps,
} from './ops'
import type { Clipboard, Item } from './ops'
import { gerberZip } from './export/zip'
import { renderSvg } from './export/svg'
import { bomCsv, bomMarkdown, pickAndPlaceCsv } from './export/bom'
import { boardSummary, summaryText } from './export/summary'
import { renderBoardCanvas, LAYER_LABELS } from './draw'
import type { Appearance } from './draw'
import { BoardView } from './BoardView'
import type { BoardViewHandle } from './BoardView'
import { View3D } from './View3D'
import { DrcPanel, LayersPanel, LibraryPanel, NetsPanel, PropsPanel, viaOptions, widthOptions } from './Panels'
import { HelpDialog, TextDialog } from './Dialogs'
import { GRIDS_MIL, GRIDS_MM, LAYERS } from './types'
import type { CopperId, Design, Fills, Violation } from './types'
import { gridLabel, fmtLen, loadAutosave, loadPrefs, loadRecent, pushRecent, savePrefs, saveAutosave, NETLIST_HELP } from './ui'
import type { Editor, Tool, UIState } from './ui'
import './kpcb.css'

const DIR = `${HOME}/Documents/kPCB`
const EXAMPLES_FOLDER = 'kPCB Examples'
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const tick = (ms = 30) => new Promise<void>((r) => setTimeout(r, ms))
const TOOLS: Array<{ id: Tool; label: string; key: string; icon: typeof Box }> = [
  { id: 'select', label: 'Select', key: 'Esc', icon: MousePointer2 },
  { id: 'route', label: 'Route tracks', key: 'X', icon: Waypoints },
  { id: 'via', label: 'Add vias', key: 'V', icon: CircleDot },
  { id: 'zone', label: 'Draw a copper zone', key: 'Z', icon: Hexagon },
  { id: 'outline', label: 'Draw the board outline (rectangle)', key: '', icon: Frame },
  { id: 'hole', label: 'Mounting holes', key: 'H', icon: Circle },
  { id: 'measure', label: 'Measure', key: 'M', icon: Ruler },
]

/** The pointer position in the status bar: it re-renders alone, not the whole window. */
function CursorReadout({ bus, unit }: { bus: Set<(p: { x: number; y: number } | null) => void>; unit: 'mm' | 'mil' }) {
  const [p, setP] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    bus.add(setP)
    return () => { bus.delete(setP) }
  }, [bus])
  return <span className="kb-coords">{p ? `x ${fmtLen(p.x, unit)}   y ${fmtLen(p.y, unit)}` : 'x –   y –'}</span>
}

export default function KPCB({ win, args }: AppProps) {
  const hist = useRef<History>(null as unknown as History)
  if (!hist.current) hist.current = new History(newDesign())
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const design = hist.current.design
  const savedRef = useRef<Design>(design)
  const dirty = design !== savedRef.current

  const [ui, setUiState] = useState<UIState>(loadPrefs)
  const uiRef = useRef(ui)
  uiRef.current = ui
  const setUI = useCallback((p: Partial<UIState>) => {
    uiRef.current = { ...uiRef.current, ...p }
    setUiState(uiRef.current)
  }, [])
  const patchAp = useCallback((p: Partial<Appearance>) => setUI({ ap: { ...uiRef.current.ap, ...p } }), [setUI])

  const [sel, setSelState] = useState<Item[]>([])
  const selRef = useRef(sel)
  selRef.current = sel
  const setSel = useCallback((items: Item[]) => {
    selRef.current = items
    setSelState(items)
  }, [])
  const [hover, setHover] = useState('')
  const [fills, setFills] = useState<Fills>({})
  const fillsRef = useRef(fills)
  fillsRef.current = fills
  const [filePath, setFilePath] = useState<string | null>(null)
  const pathRef = useRef<string | null>(null)
  pathRef.current = filePath
  const [violations, setViolations] = useState<Violation[]>([])
  const [drcRan, setDrcRan] = useState(false)
  const [marker, setMarker] = useState<string | null>(null)
  const [leftTab, setLeftTab] = useState<'library' | 'nets' | 'layers'>('library')
  const [rightTab, setRightTab] = useState<'props' | 'drc'>('props')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [size, setSize] = useState<'s' | 'm' | 'l'>('l')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const cursorBus = useRef(new Set<(p: { x: number; y: number } | null) => void>())
  const [dialog, setDialog] = useState<null | { kind: 'netlist' } | { kind: 'help' }>(null)
  const [netMode, setNetMode] = useState<'replace' | 'update'>('update')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  // the example boards copied to ~/Documents/kPCB Examples (File > Open example file)
  const [exampleFiles, setExampleFiles] = useState<ExampleFile[]>([])
  useEffect(() => {
    let alive = true
    void seedExampleFolder({ app: 'kpcb', folderName: EXAMPLES_FOLDER, fs }).then((files) => alive && setExampleFiles(files))
    return () => { alive = false }
  }, [])
  const root = useRef<HTMLDivElement>(null)
  const view = useRef<BoardViewHandle>(null)
  const search = useRef<HTMLInputElement>(null)
  const clip = useRef<Clipboard | null>(null)
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const actRef = useRef<(cmd: string) => void>(() => {})
  const live = useRef({ dirty, design })
  live.current = { dirty, design }

  const say = useCallback((m: string) => {
    setMessage(m)
    if (msgTimer.current) clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMessage(''), 7000)
  }, [])

  // ------------------------------------------------------------ derived

  const analysis = useMemo(() => analyze(design, fills), [design, fills])
  const rats = useMemo(() => ratsnest(design, analysis), [design, analysis])
  const liveViolations = useMemo(() => (ui.liveDrc ? runDrc(design, fills, { light: true }) : null), [ui.liveDrc, design, fills])
  const shownViolations = liveViolations ?? violations
  const drcCounts = drcSummary(shownViolations)

  // zones are filled a moment after the last change
  useEffect(() => {
    if (!design.zones.length) {
      if (Object.keys(fillsRef.current).length) setFills({})
      return
    }
    const t = setTimeout(() => setFills(fillZones(design)), hist.current.inGesture ? 700 : 200)
    return () => clearTimeout(t)
  }, [design])

  const refill = useCallback(() => {
    const d = hist.current.design
    setFills(d.zones.length ? fillZones(d) : {})
  }, [])

  // ------------------------------------------------------------ editing

  const afterChange = useCallback(() => bump(), [])
  const edit = useCallback((fn: (d: Design) => Design) => {
    try {
      const next = fn(hist.current.design)
      if (next !== hist.current.design) {
        hist.current.commit(next)
        afterChange()
      }
    } catch (e) {
      say(errText(e))
      void os.dialog.alert(errText(e), { title: 'kPCB' })
    }
  }, [afterChange, say])

  const ed: Editor = useMemo(() => ({
    get design() { return hist.current.design },
    get fills() { return fillsRef.current },
    get ui() { return uiRef.current },
    get sel() { return selRef.current },
    commit: (d) => { hist.current.commit(d); afterChange() },
    begin: () => hist.current.begin(),
    preview: (d) => { hist.current.preview(d); afterChange() },
    end: () => { hist.current.end(); afterChange() },
    cancel: () => { hist.current.cancel(); afterChange() },
    setSel,
    setHover,
    patchUI: setUI,
    say,
    refill,
    menu: (e, items) => os.contextMenu(e, items),
    ask: (m, def) => os.dialog.prompt(m, { title: 'kPCB', defaultValue: def }),
    onCursor: (p) => { for (const f of cursorBus.current) f(p) },
    act: (c) => actRef.current(c),
  }), [afterChange, setSel, setUI, say, refill])

  // ------------------------------------------------------------ files

  const loadDesign = useCallback((d: Design, from: string | null) => {
    const fixed = d.parts.every((p) => p.id) ? d : reid(d)
    hist.current.reset(fixed)
    savedRef.current = fixed
    setFilePath(from)
    win.setDocumentPath(from)
    setSel([])
    setViolations([])
    setDrcRan(false)
    setMarker(null)
    setFills({})
    bump()
    requestAnimationFrame(() => view.current?.fit())
  }, [win, setSel])

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (!live.current.dirty) return true
    return os.dialog.confirm('This board has changes that are not saved. Continue and lose them?', { title: 'Unsaved changes', okLabel: 'Continue', danger: true })
  }, [])

  const writeDesign = useCallback(async (to: string) => {
    await fs.writeText(to, serializeDesign(hist.current.design), { mkdirs: true })
    savedRef.current = hist.current.design
    setFilePath(to)
    win.setDocumentPath(to)
    setRecent(pushRecent(to))
    saveAutosave(null)
    bump()
    os.notify({ title: 'Board saved', body: osPath.pretty(to) })
  }, [win])

  const saveAs = useCallback(async (): Promise<boolean> => {
    const p = await os.dialog.saveFile({ defaultName: `${hist.current.design.name}.kpcb`, extensions: ['.kpcb'], startDir: fs.isDir(DIR) ? DIR : undefined })
    if (!p) return false
    try {
      await writeDesign(p)
      return true
    } catch (e) {
      await os.dialog.alert(`Could not save: ${errText(e)}`)
      return false
    }
  }, [writeDesign])

  const save = useCallback(async (): Promise<boolean> => {
    if (!pathRef.current) return saveAs()
    try {
      await writeDesign(pathRef.current)
      return true
    } catch (e) {
      await os.dialog.alert(`Could not save: ${errText(e)}`)
      return false
    }
  }, [saveAs, writeDesign])

  const newBoard = useCallback(async () => {
    if (!(await confirmDiscard())) return
    loadDesign(newDesign(), null)
  }, [confirmDiscard, loadDesign])

  const openFile = useCallback(async (p?: string) => {
    if (!p) {
      if (!(await confirmDiscard())) return
      p = (await os.dialog.openFile({ extensions: ['.kpcb'], startDir: fs.isDir(DIR) ? DIR : undefined })) ?? undefined
    }
    if (!p) return
    try {
      loadDesign(parseDesign(await fs.readText(p)), p)
      setRecent(pushRecent(p))
    } catch (e) {
      await os.dialog.alert(`Could not open the board: ${errText(e)}`, { title: 'kPCB' })
    }
  }, [confirmDiscard, loadDesign])

  const loadExample = useCallback(async (id: string, skipConfirm = false): Promise<{ title: string }> => {
    const info = EXAMPLES.find((e) => e.id === id)
    if (!info) throw new Error(`No example "${id}".`)
    if (!skipConfirm && !(await confirmDiscard())) return { title: info.title }
    setBusy(`Routing ${info.title}…`)
    await tick()
    try {
      loadDesign(routedExample(id), null)
      setFills(fillZones(hist.current.design))
      say(`${info.title}: ${info.description}`)
    } finally {
      setBusy(null)
    }
    return { title: info.title }
  }, [confirmDiscard, loadDesign, say])

  // ------------------------------------------------------------ netlists

  const doImport = useCallback((input: unknown, mode: 'replace' | 'update', nameHint?: string): NetlistReport => {
    const imp = parseNetlist(input)
    const cur = hist.current.design
    const named = nameHint && cur.name === 'untitled' ? { ...cur, name: nameHint.replace(/[^\w.-]+/g, '_') } : cur
    const r = applyNetlist(named, imp, mode)
    let next = r.design
    const o = cur.outline.rect
    if (mode === 'replace' && !cur.parts.length && o && o.x === 0 && o.y === 0 && o.w === 50 && o.h === 50 && o.r === 0) {
      const s = suggestBoardSize(next)
      next = setOutlineRect(next, 0, 0, s.w, s.h, 0)
    }
    if (r.report.added.length) next = arrangeParts(next, { refs: r.report.added })
    hist.current.commit(next)
    afterChange()
    if (mode === 'replace' || r.report.added.length) requestAnimationFrame(() => view.current?.fit())
    const bits = [`${r.report.added.length} added`, r.report.removed.length ? `${r.report.removed.length} removed from the netlist` : '', r.report.changed.length ? `${r.report.changed.length} changed` : ''].filter(Boolean)
    say(`Netlist ${imp.name}: ${imp.parts.length} parts, ${imp.nets.length} nets (${bits.join(', ')})${r.report.warnings.length ? `. ${r.report.warnings.length} warning${r.report.warnings.length > 1 ? 's' : ''}: ${r.report.warnings[0]}` : ''}`)
    return r.report
  }, [afterChange, say])

  // opened with a file, text or a netlist (from kElec)
  useEffect(() => {
    void (async () => {
      if (typeof args.path === 'string' && args.path) {
        await openFile(args.path)
        return
      }
      if (typeof args.text === 'string' && args.text.trim()) {
        try {
          const t = args.text.trim()
          if (t.startsWith('{') && (JSON.parse(t) as { format?: string }).format === 'kpcb') loadDesign(parseDesign(t), null)
          else doImport(t, hist.current.design.parts.length ? 'update' : 'replace', typeof args.name === 'string' ? args.name : undefined)
        } catch (e) {
          await os.dialog.alert(`Could not read the text: ${errText(e)}`, { title: 'kPCB' })
        }
        return
      }
      if (args.netlist !== undefined && args.netlist !== null) {
        try {
          const name = typeof args.name === 'string' ? args.name : undefined
          const incoming = parseNetlist(args.netlist).name
          const cur = hist.current.design
          let mode: 'replace' | 'update' | null = cur.parts.length ? 'update' : 'replace'
          if (cur.parts.length && cur.name !== incoming && cur.name !== name?.replace(/[^\w.-]+/g, '_')) {
            const c = await os.dialog.choose(
              `A netlist “${name ?? incoming}” arrived, and the open board is “${cur.name}”. Update this board (keep placement and routing, add new parts, flag the removed ones) or start a new board from the netlist?`,
              [{ label: 'Cancel', value: 'cancel' }, { label: 'New board', value: 'replace' }, { label: 'Update this board', value: 'update', primary: true }],
              { title: 'Netlist from kElec' },
            )
            mode = c === 'update' ? 'update' : c === 'replace' && (await confirmDiscard()) ? 'replace' : null
            if (mode === 'replace') loadDesign(newDesign(), null)
          }
          if (mode) doImport(args.netlist, mode, name)
        } catch (e) {
          await os.dialog.alert(`Could not read the netlist: ${errText(e)}`, { title: 'kPCB' })
        }
        return
      }
      // a board from an earlier session that was never saved
      const auto = loadAutosave()
      if (auto && (await os.dialog.confirm(`Recover the unsaved board “${auto.name}” from ${new Date(auto.savedAt).toLocaleString()}?`, { title: 'kPCB', okLabel: 'Recover' }))) {
        try {
          const d = parseDesign(auto.text)
          loadDesign(d, null)
          savedRef.current = newDesign()
          bump()
        } catch {
          saveAutosave(null)
        }
      } else if (auto) saveAutosave(null)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.path, args.text, args.netlist])

  // autosave of unsaved work
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => saveAutosave({ text: serializeDesign(design), savedAt: Date.now(), name: design.name }), 2500)
    return () => clearTimeout(t)
  }, [dirty, design])

  useEffect(() => { savePrefs(ui) }, [ui])

  // ------------------------------------------------------------ checks, routing

  const runChecks = useCallback((show = true): Violation[] => {
    const d = hist.current.design
    const f = d.zones.length ? fillZones(d) : {}
    setFills(f)
    const v = runDrc(d, f)
    setViolations(v)
    setDrcRan(true)
    if (show) {
      setRightTab('drc')
      setRightOpen(true)
    }
    const s = drcSummary(v)
    say(v.length ? `Design-rule check: ${s.errors} error${s.errors === 1 ? '' : 's'}, ${s.warnings} warning${s.warnings === 1 ? '' : 's'}` : 'Design-rule check: no violations')
    return v
  }, [say])

  const route = useCallback(async (nets?: string[]): Promise<RouteResult> => {
    setBusy(nets ? `Routing ${nets.join(', ')}…` : 'Auto-routing…')
    await tick()
    try {
      const r = autoroute(hist.current.design, nets ? { nets } : {})
      hist.current.commit(r.design)
      afterChange()
      refill()
      say(`Auto-router: ${r.completion}% complete${r.failedNets.length ? ` (could not route ${r.failedNets.join(', ')})` : ''}; ${r.tracksAdded} tracks and ${r.viasAdded} vias in ${(r.ms / 1000).toFixed(1)} s`)
      return r
    } finally {
      setBusy(null)
    }
  }, [afterChange, refill, say])

  // ------------------------------------------------------------ export

  const needFills = () => (hist.current.design.zones.length ? fillZones(hist.current.design) : {})

  const writeOut = useCallback(async (to: string, data: string | Uint8Array) => {
    await fs.mkdir(osPath.dirname(to), { recursive: true })
    if (typeof data === 'string') await fs.writeText(to, data, { mkdirs: true })
    else await fs.writeBytes(to, data, { mkdirs: true })
  }, [])

  const pngBytes = useCallback(async (side: 'F' | 'B', scheme: 'board' | 'bw'): Promise<Uint8Array> => {
    const d = hist.current.design
    const b = d.outline.pts.length ? d.outline.pts : [{ x: 0, y: 0 }, { x: 50, y: 50 }]
    const w = Math.max(...b.map((p) => p.x)) - Math.min(...b.map((p) => p.x))
    const h = Math.max(...b.map((p) => p.y)) - Math.min(...b.map((p) => p.y))
    const ppmm = Math.max(4, Math.min(24, 3600 / Math.max(w, h, 1)))
    const canvas = renderBoardCanvas(d, needFills(), side, scheme, ppmm)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('The browser could not make the image.')
    return new Uint8Array(await blob.arrayBuffer())
  }, [])

  const askScheme = async (): Promise<'board' | 'bw' | null> => {
    const c = await os.dialog.choose('Colours of the image:', [
      { label: 'Cancel', value: 'cancel' },
      { label: 'Black and white (print)', value: 'bw' },
      { label: 'Realistic green board', value: 'board', primary: true },
    ], { title: 'Export image' })
    return c === 'bw' || c === 'board' ? c : null
  }

  const exportAs = useCallback(async (what: 'gerber' | 'svg-top' | 'svg-bottom' | 'png-top' | 'png-bottom' | 'bom-csv' | 'bom-md' | 'pnp' | 'summary') => {
    const d = hist.current.design
    const f = needFills()
    if ((what === 'gerber') && d.outline.pts.length < 3) {
      await os.dialog.alert('The board has no outline: draw or choose one first (Edge.Cuts).', { title: 'Export' })
      return
    }
    if (what === 'gerber') {
      const v = runDrc(d, f)
      const s = drcSummary(v)
      if (s.errors > 0 && !(await os.dialog.confirm(`The design-rule check finds ${s.errors} error${s.errors === 1 ? '' : 's'}. Export the Gerber files anyway?`, { title: 'Export', okLabel: 'Export anyway' }))) return
    }
    const side = what.endsWith('bottom') ? 'B' : 'F'
    const names: Record<string, [string, string]> = {
      gerber: [`${d.name}-gerbers.zip`, '.zip'], 'svg-top': [`${d.name}-top.svg`, '.svg'], 'svg-bottom': [`${d.name}-bottom.svg`, '.svg'],
      'png-top': [`${d.name}-top.png`, '.png'], 'png-bottom': [`${d.name}-bottom.png`, '.png'], 'bom-csv': [`${d.name}-bom.csv`, '.csv'],
      'bom-md': [`${d.name}-bom.md`, '.md'], pnp: [`${d.name}-pnp.csv`, '.csv'], summary: [`${d.name}-summary.txt`, '.txt'],
    }
    const scheme = what.startsWith('svg') || what.startsWith('png') ? await askScheme() : 'board'
    if (!scheme) return
    const to = await os.dialog.saveFile({ defaultName: names[what][0], extensions: [names[what][1]], startDir: fs.isDir(DIR) ? DIR : HOME })
    if (!to) return
    try {
      if (what === 'gerber') await writeOut(to, gerberZip(d, f))
      else if (what.startsWith('svg')) await writeOut(to, renderSvg(d, f, { side, scheme }))
      else if (what.startsWith('png')) await writeOut(to, await pngBytes(side, scheme))
      else if (what === 'bom-csv') await writeOut(to, bomCsv(d))
      else if (what === 'bom-md') await writeOut(to, bomMarkdown(d))
      else if (what === 'pnp') await writeOut(to, pickAndPlaceCsv(d))
      else await writeOut(to, `${summaryText(boardSummary(d, f))}\n`)
      os.notify({ title: 'Exported', body: osPath.pretty(to) })
    } catch (e) {
      await os.dialog.alert(`Could not write the file: ${errText(e)}`, { title: 'Export' })
    }
  }, [pngBytes, writeOut])

  // ------------------------------------------------------------ commands

  actRef.current = (cmd: string) => {
    const d = hist.current.design
    const parts = selRef.current.filter((i) => i.kind === 'part').map((i) => i.id)
    const u = uiRef.current
    try {
      if (cmd.startsWith('ref:')) return edit((x) => setPartProps(x, parts[0], { ref: cmd.slice(4) }))
      if (cmd.startsWith('fp:')) return edit((x) => setPartProps(x, parts[0], { fp: cmd.slice(3) }))
      if (cmd.startsWith('side:')) return edit((x) => setPartProps(x, parts[0], { side: cmd.slice(5) === 'B' ? 'B' : 'F' }))
      if (cmd.startsWith('rot:')) return edit((x) => setPartProps(x, parts[0], { rot: Number(cmd.slice(4)) || 0 }))
      if (cmd.startsWith('outline:')) {
        const r = JSON.parse(cmd.slice(8)) as { x: number; y: number; w: number; h: number; r: number }
        return edit((x) => setOutlineRect(x, r.x, r.y, r.w, r.h, r.r))
      }
      if (cmd.startsWith('preset:')) {
        edit((x) => applyOutlinePreset(x, cmd.slice(7)))
        requestAnimationFrame(() => view.current?.fit())
        return
      }
      switch (cmd) {
        case 'undo':
          if (view.current?.busy()) return say('Finish or cancel the route first (Esc).')
          if (hist.current.undo()) {
            setSel([])
            afterChange()
          }
          return
        case 'redo':
          if (hist.current.redo()) {
            setSel([])
            afterChange()
          }
          return
        case 'rotate':
        case 'rotate-cw': {
          const deg = cmd === 'rotate' ? 90 : -90
          if (u.tool === 'place') setUI({ placeRot: (u.placeRot + deg + 360) % 360 })
          else if (parts.length) edit((x) => rotateParts(x, parts, deg, true))
          return
        }
        case 'flip':
          if (u.tool === 'place') setUI({ placeSide: u.placeSide === 'F' ? 'B' : 'F' })
          else if (parts.length) edit((x) => flipParts(x, parts))
          return
        case 'delete':
          if (selRef.current.length) {
            edit((x) => {
              let n = deleteItems(x, selRef.current)
              if (selRef.current.some((i) => i.kind === 'outline')) n = { ...n, outline: { pts: [] } }
              return n
            })
            setSel([])
            refill()
          }
          return
        case 'copy':
          clip.current = copyItems(d, selRef.current)
          if (clip.current) say('Copied.')
          return
        case 'paste': {
          if (!clip.current) return say('Nothing to paste.')
          const c = view.current?.cursor() ?? { x: clip.current.origin.x + 5, y: clip.current.origin.y + 5 }
          const r = pasteClipboard(d, clip.current, c)
          hist.current.commit(r.design)
          setSel(r.items)
          afterChange()
          return
        }
        case 'duplicate': {
          const c = copyItems(d, selRef.current)
          if (!c) return
          const r = pasteClipboard(d, c, { x: c.origin.x + 2.54, y: c.origin.y + 2.54 })
          hist.current.commit(r.design)
          setSel(r.items)
          afterChange()
          return
        }
        case 'select-all':
          return setSel([
            ...d.parts.map((p) => ({ kind: 'part' as const, id: p.id })), ...d.tracks.map((t) => ({ kind: 'track' as const, id: t.id })),
            ...d.vias.map((v) => ({ kind: 'via' as const, id: v.id })), ...d.zones.map((z) => ({ kind: 'zone' as const, id: z.id })), ...d.holes.map((h) => ({ kind: 'hole' as const, id: h.id })),
          ])
        case 'select-run': {
          const t = selRef.current.find((i) => i.kind === 'track')
          if (t) setSel(connectedTrack(d, t.id).map((id) => ({ kind: 'track' as const, id })))
          return
        }
        case 'delete-run': {
          const t = selRef.current.find((i) => i.kind === 'track')
          if (t) {
            edit((x) => deleteItems(x, connectedTrack(x, t.id).map((id) => ({ kind: 'track' as const, id }))))
            setSel([])
            refill()
          }
          return
        }
        case 'delete-net-copper': {
          const t = d.tracks.find((q) => selRef.current.some((i) => i.kind === 'track' && i.id === q.id))
          if (t?.net) {
            edit((x) => deleteNetCopper(x, t.net))
            setSel([])
            refill()
          } else say('This track has no net.')
          return
        }
        case 'route-net':
        case 'reroute-net': {
          const sel0 = selRef.current
          const t = d.tracks.find((q) => sel0.some((i) => i.kind === 'track' && i.id === q.id))
          const v = d.vias.find((q) => sel0.some((i) => i.kind === 'via' && i.id === q.id))
          const net = t?.net || v?.net || u.assignNet
          if (!net || !d.nets.some((n) => n.name === net)) return say('Select a track or a via of the net, or choose the net in the Nets panel.')
          if (cmd === 'reroute-net') edit((x) => deleteNetCopper(x, net))
          setSel([])
          void route([net])
          return
        }
        case 'toggle-lock':
          return edit((x) => ({ ...x, parts: x.parts.map((p) => (parts.includes(p.id) ? { ...p, locked: !p.locked } : p)) }))
        case 'fill':
          refill()
          return say('Zones filled.')
        case 'library':
          setLeftTab('library')
          setLeftOpen(true)
          setTimeout(() => search.current?.focus(), 30)
          return
        case 'fit':
          return view.current?.fit()
        case 'ground-plane': {
          let n = d
          if (!n.nets.some((x) => x.name === 'GND')) n = { ...n, nets: [...n.nets, { name: 'GND', cls: 'Power', pins: [] }] }
          edit(() => boardZone(n, 'GND', 'B.Cu', 0.6))
          refill()
          return say('A GND zone now covers the bottom layer. Put pads on GND in the Nets panel; then press B to refill.')
        }
        case 'place-all':
          edit((x) => arrangeParts(x))
          return say('Parts laid out in rows inside the board; connected parts are kept together.')
      }
    } catch (e) {
      say(errText(e))
    }
  }

  // ------------------------------------------------------------ keys

  const cycleWidth = () => {
    const opts = widthOptions(uiRef.current.unit).map((o) => o[0])
    const i = opts.indexOf(uiRef.current.trackWidth)
    const w = opts[(i + 1) % opts.length]
    setUI({ trackWidth: w })
    say(w === 0 ? 'Track width: by net class' : `Track width: ${fmtLen(w, uiRef.current.unit)}`)
  }
  const cycleGrid = () => {
    const list = uiRef.current.unit === 'mil' ? GRIDS_MIL.map((m) => m * 0.0254) : GRIDS_MM
    const i = list.findIndex((g) => Math.abs(g - uiRef.current.grid) < 1e-6)
    const g = list[(i + 1) % list.length]
    setUI({ grid: g })
    say(`Grid: ${gridLabel(g, uiRef.current.unit)}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    if (t.matches('input, textarea, select') && e.key !== 'Escape') return
    if (dialog) return
    if (view.current?.key(e.nativeEvent)) {
      e.preventDefault()
      return
    }
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    const act = (c: string) => {
      e.preventDefault()
      actRef.current(c)
    }
    if (mod && !e.altKey) {
      if (k === 'z') return act(e.shiftKey ? 'redo' : 'undo')

      if (k === 'y') return act('redo')
      if (k === 'c') return act('copy')
      if (k === 'v') return act('paste')
      if (k === 'd' && !e.shiftKey) return act('duplicate')
      if (k === 'a') return act('select-all')
      if (k === 's') { e.preventDefault(); void (e.shiftKey ? saveAs() : save()); return }
      if (k === 'n') { e.preventDefault(); void newBoard(); return }
      if (k === 'o') { e.preventDefault(); void openFile(); return }
      if (k === '0') return act('fit')
      if (k === 'd' && e.shiftKey) { e.preventDefault(); runChecks(); return }
      if (k === 'r' && e.shiftKey) { e.preventDefault(); void route(); return }
      return
    }
    if (e.altKey) return
    const u = uiRef.current
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        if (u.tool !== 'select') setUI({ tool: 'select' })
        else if (selRef.current.length) setSel([])
        return
      case 'Delete':
      case 'Backspace': return act('delete')
      case 'PageUp': e.preventDefault(); return setUI({ active: 'F.Cu' })
      case 'PageDown': e.preventDefault(); return setUI({ active: 'B.Cu' })
      case 'Home': return act('fit')
    }
    if (e.key === 'F' && e.shiftKey) { e.preventDefault(); setUI({ flipView: !u.flipView }); return }
    if (e.shiftKey && k === 'r') return act('rotate-cw')
    switch (k) {
      case 'r': return act('rotate')
      case 'f': return act('flip')
      case 'x': e.preventDefault(); return setUI({ tool: 'route' })
      case 'v': e.preventDefault(); return setUI({ tool: 'via' })
      case 'z': e.preventDefault(); return setUI({ tool: 'zone' })
      case 'h': e.preventDefault(); return setUI({ tool: 'hole' })
      case 'm': e.preventDefault(); return setUI({ tool: 'measure' })
      case 'b': return act('fill')
      case 'w': e.preventDefault(); return cycleWidth()
      case 'g': e.preventDefault(); return cycleGrid()
      case 'p': return act('library')
      case '1': return setUI({ active: 'F.Cu' })
      case '2': return setUI({ active: 'B.Cu' })
      case '3': return setUI({ view3d: !u.view3d })
    }
  }

  // ------------------------------------------------------------ window

  useEffect(() => {
    win.setTitle(`kPCB — ${design.name}${dirty ? ' •' : ''}`)
  }, [win, design.name, dirty])

  useEffect(() => {
    win.setCloseGuard(async () => {
      if (!live.current.dirty) return true
      const c = await os.dialog.choose(`Save the changes to “${live.current.design.name}” before closing?`, [
        { label: 'Cancel', value: 'cancel' },
        { label: "Don't save", value: 'discard', danger: true },
        { label: 'Save', value: 'save', primary: true },
      ], { title: 'Unsaved changes' })
      if (c === 'save') return save()
      if (c === 'discard') {
        saveAutosave(null)
        return true
      }
      return false
    })
    return () => win.setCloseGuard(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win])

  useEffect(() => {
    const el = root.current
    if (!el) return
    let first = true
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      setSize(w < 760 ? 's' : w < 1050 ? 'm' : 'l')
      if (first && w > 0) {
        first = false
        setLeftOpen(w >= 760)
        setRightOpen(w >= 1050)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // selecting something shows its properties
  useEffect(() => {
    if (sel.length) setRightTab((t) => (t === 'drc' ? t : 'props'))
  }, [sel])

  // ------------------------------------------------------------ AI tools

  useAppTools(win, kpcbTools({
    get: () => hist.current.design,
    fills: () => needFills(),
    commit: (d) => {
      hist.current.commit(d)
      afterChange()
      refill()
    },
    load: (id) => loadExample(id, true),
    importNetlist: (input, mode) => doImport(input, mode),
    drc: () => runChecks(false),
    route: (nets) => {
      // the router is synchronous; run it now so the result can be returned
      const r = autoroute(hist.current.design, nets ? { nets } : {})
      hist.current.commit(r.design)
      afterChange()
      refill()
      say(`Auto-router: ${r.completion}% complete`)
      return r
    },
    write: writeOut,
    png: pngBytes,
  } satisfies Hooks))

  // ------------------------------------------------------------ menus

  const tool = (t: Tool) => setUI({ tool: t })
  const widthItems: MenuItem[] = widthOptions(ui.unit).map(([w, label]) => ({ label, checked: ui.trackWidth === w, onClick: () => setUI({ trackWidth: w }) }))
  const viaItems: MenuItem[] = viaOptions(ui.unit).map(([i, label]) => ({ label, checked: ui.viaIndex === i, onClick: () => setUI({ viaIndex: i }) }))
  const gridList = ui.unit === 'mil' ? GRIDS_MIL.map((m) => m * 0.0254) : GRIDS_MM
  const hasParts = design.parts.length > 0

  const canUndo = hist.current.canUndo
  const canRedo = hist.current.canRedo
  const hasSel = sel.length > 0
  const hasTrackSel = sel.some((i) => i.kind === 'track')
  useEffect(() => {
    const A = (cmd: string) => () => actRef.current(cmd)
    const selParts = () => selRef.current.filter((i) => i.kind === 'part').map((i) => i.id)
    const menus: MenuBarMenu[] = [
      {
        label: 'File',
        items: [
          { label: 'New board', icon: FilePlus, shortcut: '⌘N', onClick: () => void newBoard() },
          { label: 'Open…', icon: FolderOpen, shortcut: '⌘O', onClick: () => void openFile() },
          { label: 'Open recent', submenu: recent.length ? recent.map((p) => ({ label: osPath.pretty(p), onClick: () => void confirmDiscard().then(async (ok) => { if (ok) await openFile(p) }) })) : [{ label: 'No recent boards', disabled: true }] },
          { label: 'Open example', submenu: EXAMPLES.map((e) => ({ label: e.title, onClick: () => void loadExample(e.id) })) },
          {
            label: 'Open example file',
            disabled: exampleFiles.length === 0,
            submenu: exampleFiles.map((f) => ({ label: f.title, onClick: () => void confirmDiscard().then(async (ok) => { if (ok) await openFile(f.path) }) })),
          },
          { label: 'Open examples folder', onClick: () => void seedExampleFolder({ app: 'kpcb', folderName: EXAMPLES_FOLDER, fs }).then((files) => { setExampleFiles(files); os.open('files', { path: exampleFolderPath(EXAMPLES_FOLDER) }) }) },
          '-',
          { label: 'Save', icon: Save, shortcut: '⌘S', onClick: () => void save() },
          { label: 'Save as…', shortcut: '⇧⌘S', onClick: () => void saveAs() },
          '-',
          {
            label: 'Export',
            submenu: [
              { label: 'Gerber and drill files (zip)…', onClick: () => void exportAs('gerber') },
              { label: 'Image of the top (SVG)…', onClick: () => void exportAs('svg-top') },
              { label: 'Image of the bottom (SVG)…', onClick: () => void exportAs('svg-bottom') },
              { label: 'Image of the top (PNG)…', onClick: () => void exportAs('png-top') },
              { label: 'Image of the bottom (PNG)…', onClick: () => void exportAs('png-bottom') },
              '-',
              { label: 'Bill of materials (CSV)…', onClick: () => void exportAs('bom-csv') },
              { label: 'Bill of materials (Markdown)…', onClick: () => void exportAs('bom-md') },
              { label: 'Pick and place (CSV)…', onClick: () => void exportAs('pnp') },
              { label: 'Board summary (text)…', onClick: () => void exportAs('summary') },
            ],
          },
          '-',
          { label: 'Close', onClick: () => win.close() },
        ],
      },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', icon: Undo2, shortcut: '⌘Z', disabled: !canUndo, onClick: A('undo') },
          { label: 'Redo', icon: Redo2, shortcut: '⇧⌘Z', disabled: !canRedo, onClick: A('redo') },
          '-',
          { label: 'Copy', shortcut: '⌘C', disabled: !hasSel, onClick: A('copy') },
          { label: 'Paste', shortcut: '⌘V', onClick: A('paste') },
          { label: 'Duplicate', shortcut: '⌘D', disabled: !hasSel, onClick: A('duplicate') },
          { label: 'Delete', shortcut: '⌫', disabled: !hasSel, onClick: A('delete') },
          { label: 'Select all', shortcut: '⌘A', onClick: A('select-all') },
          '-',
          { label: 'Rotate left', shortcut: 'R', onClick: A('rotate') },
          { label: 'Rotate right', shortcut: '⇧R', onClick: A('rotate-cw') },
          { label: 'Flip to the other side', shortcut: 'F', onClick: A('flip') },
          { label: 'Lock / unlock', onClick: A('toggle-lock') },
        ],
      },
      {
        label: 'Place',
        items: [
          { label: 'Place a part…', icon: Component, shortcut: 'P', onClick: A('library') },
          { label: 'Place all parts', icon: WandSparkles, disabled: !hasParts, onClick: A('place-all') },
          '-',
          {
            label: 'Board outline',
            submenu: [
              ...OUTLINE_PRESETS.map((p) => ({ label: p.name, onClick: () => A(`preset:${p.id}`)() })),
              '-' as const,
              { label: 'Draw a rectangle', onClick: () => tool('outline') },
              { label: 'Draw a polygon', onClick: () => tool('outline-poly') },
            ],
          },
          { label: 'Mounting hole', shortcut: 'H', onClick: () => tool('hole') },
          '-',
          {
            label: 'Align',
            submenu: (['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((m) => ({
              label: { left: 'Left', hcenter: 'Centres horizontally', right: 'Right', top: 'Top', vcenter: 'Centres vertically', bottom: 'Bottom' }[m],
              onClick: () => edit((x) => alignParts(x, selParts(), m)),
            })),
          },
          { label: 'Distribute horizontally', onClick: () => edit((x) => distributeParts(x, selParts(), 'h')) },
          { label: 'Distribute vertically', onClick: () => edit((x) => distributeParts(x, selParts(), 'v')) },
          '-',
          { label: 'Import a netlist…', icon: Link2, onClick: () => setDialog({ kind: 'netlist' }) },
        ],
      },
      {
        label: 'Route',
        items: [
          { label: 'Route tracks', icon: Waypoints, shortcut: 'X', checked: ui.tool === 'route', onClick: () => tool('route') },
          { label: 'Add vias', shortcut: 'V', checked: ui.tool === 'via', onClick: () => tool('via') },
          { label: 'Draw a copper zone', shortcut: 'Z', checked: ui.tool === 'zone', onClick: () => tool('zone') },
          { label: 'Fill zones', shortcut: 'B', onClick: A('fill') },
          { label: 'Ground plane on B.Cu', onClick: A('ground-plane') },
          '-',
          { label: 'Track width', submenu: widthItems },
          { label: 'Via size', submenu: viaItems },
          { label: 'Corners', submenu: (['45', '90', 'free'] as const).map((m) => ({ label: m === 'free' ? 'Free angle' : `${m}°`, checked: ui.routeMode === m, onClick: () => setUI({ routeMode: m }) })) },
          '-',
          { label: 'Auto-route everything', icon: WandSparkles, shortcut: '⇧⌘R', onClick: () => void route() },
          { label: 'Auto-route the selected net', onClick: A('route-net') },
          { label: 'Rip up and route the selected net again', disabled: !hasTrackSel && !ui.assignNet, onClick: A('reroute-net') },
          { label: 'Undo auto-routing', onClick: () => edit((x) => unroute(x)) },
          { label: 'Remove all tracks and vias', onClick: () => edit((x) => unroute(x, true)) },
        ],
      },
      {
        label: 'Inspect',
        items: [
          { label: 'Run the design-rule check', icon: ShieldCheck, shortcut: '⇧⌘D', onClick: () => runChecks() },
          { label: 'Live check (quick)', checked: ui.liveDrc, onClick: () => setUI({ liveDrc: !ui.liveDrc }) },
          '-',
          { label: 'Measure', icon: Ruler, shortcut: 'M', checked: ui.tool === 'measure', onClick: () => tool('measure') },
          { label: 'Board summary', onClick: () => void os.dialog.alert(<pre className="kb-summary">{summaryText(boardSummary(hist.current.design, fillsRef.current))}</pre>, { title: 'Board summary' }) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: '2D board', checked: !ui.view3d, onClick: () => setUI({ view3d: false }) },
          { label: '3D view', icon: Box, shortcut: '3', checked: ui.view3d, onClick: () => setUI({ view3d: true }) },
          '-',
          { label: 'Active layer', submenu: (['F.Cu', 'B.Cu'] as CopperId[]).map((l) => ({ label: LAYER_LABELS[l], checked: ui.active === l, onClick: () => setUI({ active: l }) })) },
          { label: 'Layers', submenu: LAYERS.map((l) => ({ label: LAYER_LABELS[l], checked: ui.ap.visible[l], onClick: () => patchAp({ visible: { ...ui.ap.visible, [l]: !ui.ap.visible[l] } }) })) },
          { label: 'Show only the active layer', checked: ui.ap.dim, onClick: () => patchAp({ dim: !ui.ap.dim }) },
          { label: 'View from the bottom', shortcut: '⇧F', checked: ui.flipView, onClick: () => setUI({ flipView: !ui.flipView }) },
          '-',
          { label: 'Ratsnest', checked: ui.ap.ratsnest, onClick: () => patchAp({ ratsnest: !ui.ap.ratsnest }) },
          { label: 'Pad numbers', checked: ui.ap.padNumbers, onClick: () => patchAp({ padNumbers: !ui.ap.padNumbers }) },
          { label: 'Grid', checked: ui.ap.grid, onClick: () => patchAp({ grid: !ui.ap.grid }) },
          { label: 'Grid size', shortcut: 'G', submenu: gridList.map((g) => ({ label: gridLabel(g, ui.unit), checked: Math.abs(g - ui.grid) < 1e-6, onClick: () => setUI({ grid: g }) })) },
          { label: 'Units', submenu: (['mm', 'mil'] as const).map((x) => ({ label: x === 'mm' ? 'Millimetres' : 'Mils', checked: ui.unit === x, onClick: () => setUI({ unit: x, grid: x === 'mil' ? 25 * 0.0254 : 0.5 }) })) },
          '-',
          { label: 'Zoom to fit', shortcut: '⌘0', onClick: A('fit') },
          { label: 'Zoom in', onClick: () => view.current?.zoomBy(1.4) },
          { label: 'Zoom out', onClick: () => view.current?.zoomBy(1 / 1.4) },
          '-',
          { label: 'Left panel', checked: leftOpen, onClick: () => setLeftOpen((v) => !v) },
          { label: 'Right panel', checked: rightOpen, onClick: () => setRightOpen((v) => !v) },
        ],
      },
      {
        label: 'Help',
        items: [
          { label: 'kPCB help', icon: HelpCircle, onClick: () => setDialog({ kind: 'help' }) },
          { label: 'Netlist formats', onClick: () => void os.dialog.alert(<pre className="kb-netlist-help">{NETLIST_HELP}</pre>, { title: 'Netlist formats' }) },
        ],
      },
    ]
    win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui, canUndo, canRedo, hasSel, hasTrackSel, hasParts, recent, exampleFiles, leftOpen, rightOpen, win])

  // ------------------------------------------------------------ pieces

  const moveCursorTo = (v: Violation) => {
    setMarker(v.id)
    setUI({ view3d: false })
    requestAnimationFrame(() => view.current?.zoomTo({ x: v.x, y: v.y }, 30))
  }

  const toolbtn = (t: (typeof TOOLS)[number]) => (
    <button key={t.id} className={`k-icon-btn${ui.tool === t.id ? ' active' : ''}`} title={`${t.label}${t.key ? ` (${t.key})` : ''}`} aria-label={t.label} aria-pressed={ui.tool === t.id} onClick={() => tool(t.id)}>
      <t.icon size={15} />
    </button>
  )

  const empty = design.parts.length === 0 && design.tracks.length === 0 && !busy
  const unconnected = rats.length
  const errorsShown = drcCounts.errors
  const sizeLabel = design.outline.rect ? `${design.outline.rect.w} × ${design.outline.rect.h} mm` : design.outline.pts.length ? 'polygon outline' : 'no outline'
  const overlayPanels = size === 's'

  return (
    <div className="k-app kb-app" ref={root} data-size={size} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="k-toolbar kb-toolbar">
        <button className="k-icon-btn" aria-label="New board" title="New board (⌘N)" onClick={() => void newBoard()}><FilePlus size={15} /></button>
        <button className="k-icon-btn" aria-label="Open" title="Open… (⌘O)" onClick={() => void openFile()}><FolderOpen size={15} /></button>
        <button className="k-icon-btn" aria-label="Save" title="Save (⌘S)" onClick={() => void save()}><Save size={15} /></button>
        <span className="k-sep" />
        <button className="k-icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={() => actRef.current('undo')}><Undo2 size={15} /></button>
        <button className="k-icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={() => actRef.current('redo')}><Redo2 size={15} /></button>
        <span className="k-sep" />
        <button className={`k-icon-btn${ui.tool === 'place' ? ' active' : ''}`} aria-label="Place a part" title="Place a part (P)" onClick={() => actRef.current('library')}><Component size={15} /></button>
        {TOOLS.map(toolbtn)}
        <span className="k-sep" />
        <select className="k-input kb-sel" value={ui.active} onChange={(e) => setUI({ active: e.target.value as CopperId })} aria-label="Active layer" title="Active copper layer (1 / 2)">
          <option value="F.Cu">F.Cu</option>
          <option value="B.Cu">B.Cu</option>
        </select>
        <select className="k-input kb-sel" value={ui.trackWidth} onChange={(e) => setUI({ trackWidth: Number(e.target.value) })} aria-label="Track width" title="Track width (W)">
          {widthOptions(ui.unit).map(([w, label]) => <option key={w} value={w}>{w === 0 ? 'Track: auto' : label}</option>)}
        </select>
        <select className="k-input kb-sel" value={ui.viaIndex} onChange={(e) => setUI({ viaIndex: Number(e.target.value) })} aria-label="Via size" title="Via size">
          {viaOptions(ui.unit).map(([i, label]) => <option key={i} value={i}>{i === -1 ? 'Via: auto' : label}</option>)}
        </select>
        <select className="k-input kb-sel" value={ui.grid} onChange={(e) => setUI({ grid: Number(e.target.value) })} aria-label="Grid" title="Grid (G)">
          {gridList.map((g) => <option key={g} value={g}>{gridLabel(g, ui.unit)}</option>)}
        </select>
        <button className="k-btn small kb-unit" title="Millimetres or mils" onClick={() => setUI({ unit: ui.unit === 'mm' ? 'mil' : 'mm', grid: ui.unit === 'mm' ? 25 * 0.0254 : 0.5 })}>{ui.unit}</button>
        <span className="k-sep" />
        <button className={`k-icon-btn${ui.flipView ? ' active' : ''}`} aria-label="View from the bottom" title="View from the bottom (⇧F)" onClick={() => setUI({ flipView: !ui.flipView })}><FlipHorizontal2 size={15} /></button>
        <div className="kb-seg" role="group" aria-label="2D or 3D">
          <button className={!ui.view3d ? 'on' : ''} onClick={() => setUI({ view3d: false })}>2D</button>
          <button className={ui.view3d ? 'on' : ''} onClick={() => setUI({ view3d: true })} title="3D view (3)">3D</button>
        </div>
        <span className="k-spacer" />
        <button className="k-btn small" onClick={() => runChecks()} title="Run the design-rule check (⇧⌘D)"><ShieldCheck size={13} /> Check{drcRan || ui.liveDrc ? <span className={`kb-badge ${errorsShown ? 'bad' : 'ok'}`}>{errorsShown || '✓'}</span> : null}</button>
        <button className="k-btn small" disabled={!hasParts} onClick={() => void route()} title="Auto-route everything missing (⇧⌘R)"><WandSparkles size={13} /> Route all</button>
        <button className={`k-icon-btn${leftOpen ? ' active' : ''}`} aria-label="Left panel" title="Library, nets, layers" onClick={() => setLeftOpen((v) => !v)}><PanelLeft size={15} /></button>
        <button className={`k-icon-btn${rightOpen ? ' active' : ''}`} aria-label="Right panel" title="Properties and checks" onClick={() => setRightOpen((v) => !v)}><PanelRight size={15} /></button>
      </div>

      <div className="kb-body">
        {leftOpen && (
          <aside className={`kb-side kb-left${overlayPanels ? ' overlay' : ''}`}>
            <div className="kb-tabs" role="tablist">
              {([['library', 'Library'], ['nets', 'Nets'], ['layers', 'Layers']] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={leftTab === id} className={leftTab === id ? 'on' : ''} onClick={() => setLeftTab(id)}>{label}</button>
              ))}
            </div>
            {leftTab === 'library' && (
              <LibraryPanel current={ui.placeFp} searchRef={search} onPick={(fp) => { setUI({ placeFp: fp, tool: 'place' }); say(`Click on the board to place ${fp}.`) }} />
            )}
            {leftTab === 'nets' && (
              <NetsPanel design={design} rats={rats} ui={ui} hover={hover} edit={edit} ed={ed} onNetlistText={() => { setNetMode(hasParts ? 'update' : 'replace'); setDialog({ kind: 'netlist' }) }} onUpdateNetlist={() => { setNetMode('update'); setDialog({ kind: 'netlist' }) }} />
            )}
            {leftTab === 'layers' && <LayersPanel ui={ui} patchAp={patchAp} patchUI={setUI} />}
          </aside>
        )}

        <main className="kb-main">
          {ui.view3d ? (
            <View3D design={design} fills={fills} />
          ) : (
            <BoardView
              ref={view} ed={ed} design={design} fills={fills} ratsnest={rats} markers={shownViolations} sel={sel} hoverNet={hover} ui={ui} selectedMarker={marker}
            />
          )}
          {empty && !ui.view3d && (
            <div className="kb-empty">
              <div className="kb-empty-card">
                <CircuitBoard size={34} />
                <h2>Design a circuit board</h2>
                <p className="k-muted">Place parts, route copper, check the design rules, then export Gerber files. Start from an example, a netlist, or a blank board.</p>
                <div className="kb-empty-grid">
                  {EXAMPLES.map((e) => (
                    <button key={e.id} className="k-btn kb-empty-ex" onClick={() => void loadExample(e.id)}>
                      <b>{e.title}</b>
                      <span className="k-muted">{e.description}</span>
                    </button>
                  ))}
                </div>
                <div className="kb-btnrow kb-empty-row">
                  <button className="k-btn" onClick={() => { setNetMode('replace'); setDialog({ kind: 'netlist' }) }}><Link2 size={13} /> Import a netlist</button>
                  <button className="k-btn" onClick={() => void openFile()}><FolderOpen size={13} /> Open a board</button>
                  <button className="k-btn" onClick={() => { actRef.current('library') }}><Component size={13} /> Place parts</button>
                </div>
                <div className="kb-btnrow kb-empty-row">
                  <span className="k-muted">Board outline:</span>
                  {OUTLINE_PRESETS.map((p) => <button key={p.id} className="k-btn small" onClick={() => actRef.current(`preset:${p.id}`)}>{p.name.split(',')[0]}</button>)}
                </div>
              </div>
            </div>
          )}
          {busy && <div className="kb-busy"><div className="kb-spinner" />{busy}</div>}
        </main>

        {rightOpen && (
          <aside className={`kb-side kb-right${overlayPanels ? ' overlay' : ''}`}>
            <div className="kb-tabs" role="tablist">
              <button role="tab" aria-selected={rightTab === 'props'} className={rightTab === 'props' ? 'on' : ''} onClick={() => setRightTab('props')}>Properties</button>
              <button role="tab" aria-selected={rightTab === 'drc'} className={rightTab === 'drc' ? 'on' : ''} onClick={() => setRightTab('drc')}>
                Checks{drcRan || ui.liveDrc ? <span className={`kb-badge ${errorsShown ? 'bad' : 'ok'}`}>{shownViolations.length || '✓'}</span> : null}
              </button>
            </div>
            {rightTab === 'props' && <PropsPanel design={design} fills={fills} sel={sel} ui={ui} edit={edit} ed={ed} />}
            {rightTab === 'drc' && (
              <DrcPanel design={design} violations={shownViolations} ran={drcRan || ui.liveDrc} ui={ui} selected={marker} onRun={() => runChecks()} onPick={moveCursorTo} edit={edit} ed={ed} />
            )}
          </aside>
        )}
      </div>

      <div className="k-statusbar kb-status">
        <CursorReadout bus={cursorBus.current} unit={ui.unit} />
        <span>grid {gridLabel(ui.grid, ui.unit)}</span>
        <span className="kb-layer-tag" style={{ color: ui.ap.colors[ui.active] }}>{ui.active}</span>
        <span>track {ui.trackWidth ? fmtLen(ui.trackWidth, ui.unit) : 'by class'}</span>
        {ui.tool === 'route' && <span>corners {ui.routeMode === 'free' ? 'free' : `${ui.routeMode}°`}</span>}
        <span className={unconnected ? 'kb-bad' : ''}>{unconnected} unconnected</span>
        <span className={errorsShown ? 'kb-bad' : ''}>{drcRan || ui.liveDrc ? `${errorsShown} DRC error${errorsShown === 1 ? '' : 's'}` : 'DRC not run'}</span>
        <span>{sizeLabel}</span>
        <span className="kb-msg">{message}</span>
      </div>

      {dialog?.kind === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'netlist' && (
        <TextDialog
          title="Import a netlist"
          hint={'One part per line:  REF VALUE FOOTPRINT | NET:PIN NET:PIN …   (KiCad netlists work too; see Help)\ne.g.   R1 10k R_0805 | VCC:1 OUT:2'}
          okLabel={netMode === 'replace' ? 'Import' : 'Update the board'}
          onCancel={() => setDialog(null)}
          onSubmit={(text) => {
            try {
              doImport(text, netMode)
              setDialog(null)
            } catch (e) {
              void os.dialog.alert(errText(e), { title: 'Netlist' })
            }
          }}
          extra={
            hasParts ? (
              <div className="kb-radio">
                <label><input type="radio" checked={netMode === 'update'} onChange={() => setNetMode('update')} /> Update: keep placed parts and tracks, add new parts, flag removed ones</label>
                <label><input type="radio" checked={netMode === 'replace'} onChange={() => setNetMode('replace')} /> Replace all parts, nets and tracks</label>
              </div>
            ) : null
          }
        />
      )}
    </div>
  )
}

