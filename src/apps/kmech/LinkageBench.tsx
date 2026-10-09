// The Linkages workbench: draw a planar mechanism (ground pins, bars, plates, sliders, one driver), play it, and
// analyse it. All the mathematics is in linkage.ts, analysis.ts, engine.ts, dynamics.ts and synthesis.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Anchor, Circle, Crosshair, Eraser, Maximize, MousePointer2, MoveHorizontal, Pause, PanelRight, Play, RotateCw, Slash, SkipBack, Spline, ZoomIn, ZoomOut, LineChart, X, Download,
} from 'lucide-react'
import { os, type MenuBarMenu } from '@/os'
import type { MenuItem } from '@/os/ui/Menu'
import { analyseCycle, couplerAtlas, cycleArrows, cyclePose, staticTorqueCurve, type Cycle } from './analysis'
import type { DynResult } from './dynamics'
import type { LinkageDoc } from './doc'
import {
  addCouplerPoint, addPoint, addSlider, boundsOf, deletePick, pickAt, setDriverOnLink, settle, toggleTracer, movePoint, toolClick, type LinkStart, type Pick, type Tool,
} from './edit'
import { runEngine } from './engine'
import {
  couplerFigure, dynamicsFigure, engineTorqueFigure, jointForceFigure, motionFigure, pressureFigure, stacked, transmissionFigure, type Figure,
} from './figures'
import { loadPrefs, savePrefs, svgToPng, safeName } from './io'
import { designPoints } from './linkage'
import { deg, fmt, rad, type Pt } from './math'
import { MechCanvas, type CanvasHandle } from './MechCanvas'
import { LinkagePanels, type PanelApi, type SideTab } from './LinkagePanels'
import PlotlyChart, { usePalette, type ChartHandle } from './PlotlyChart'
import { linkageScene, sceneBounds, sceneToSvg, COLORS, type Prim } from './scene'
import type { Shell } from './shell'
import { engineTable, motionTable, tracerTable, dynamicsTable } from './tables'
import { toCsv, toTsv } from './exportGeom'
import { niceStep, snapTo } from './view'
import { Empty } from './ui'
import { EXAMPLES } from './examples'

const TOOLS: Array<{ id: Tool; label: string; key: string; Icon: typeof Anchor; hint: string }> = [
  { id: 'select', label: 'Select and move', key: 'V', Icon: MousePointer2, hint: 'Click to select; drag a joint to redraw the mechanism (the link lengths follow the drawing).' },
  { id: 'ground', label: 'Ground pin', key: 'G', Icon: Anchor, hint: 'Click to place a fixed pivot on the frame.' },
  { id: 'joint', label: 'Joint', key: 'J', Icon: Circle, hint: 'Click to place a free joint.' },
  { id: 'link', label: 'Link (bar)', key: 'L', Icon: Slash, hint: 'Click a joint (or empty space) and then another to join them with a rigid bar.' },
  { id: 'coupler', label: 'Coupler point', key: 'C', Icon: Spline, hint: 'Click on a link to add a point rigidly attached to it (a coupler point).' },
  { id: 'slider', label: 'Slider', key: 'S', Icon: MoveHorizontal, hint: 'Click a joint to make it slide on a straight line (set the angle in the panel).' },
  { id: 'driver', label: 'Driver (crank)', key: 'D', Icon: RotateCw, hint: 'Click a link that has a ground pin to make it the motor-driven crank.' },
  { id: 'tracer', label: 'Tracer', key: 'T', Icon: Crosshair, hint: 'Click a joint to trace its path.' },
  { id: 'erase', label: 'Delete', key: 'X', Icon: Eraser, hint: 'Click an item to delete it (or press Delete on the selection).' },
]

interface Prefs {
  grid: boolean
  snap: boolean
  labels: boolean
  dims: boolean
  vel: boolean
  paths: boolean
  side: boolean
  dock: boolean
  dockH: number
  speed: number
  tab: SideTab
}
const DEFAULT_PREFS: Prefs = { grid: true, snap: true, labels: true, dims: false, vel: false, paths: true, side: true, dock: true, dockH: 270, speed: 1, tab: 'edit' }
const PREFS_KEY = 'kherveos.kmech.linkage.prefs'

export type PlotKind = 'motion' | 'transmission' | 'coupler' | 'atlas' | 'pressure' | 'enginetorque' | 'static' | 'dynamics' | 'joints'

const driverAngleDeg = (m: LinkageDoc): number => {
  if (!m.driver) return 0
  const a = m.points.find((p) => p.id === m.driver!.from); const b = m.points.find((p) => p.id === m.driver!.to)
  return a && b ? deg(Math.atan2(b.y - a.y, b.x - a.x)) : 0
}

const HELP = [
  'Draw: pick Ground pin (G) and click to fix pivots on the frame; Link (L) joins two joints with a rigid bar (click empty space to make a joint on the way); Coupler point (C) adds a point to a bar (a bar with three points becomes a plate); Slider (S) makes a joint slide on a line; Driver (D) turns a bar that has a ground pin into the motor-driven crank; Tracer (T) records the path of a joint.',
  'A mechanism needs exactly one input: the driver. If it has more freedom than that the panel tells you how many extra links are needed.',
  'Play (P) animates the input, the slider scrubs it. The Analysis tab gives the Grashof class, the range of motion, transmission angle, quick-return ratio and plots; Coupler shows coupler curves and an atlas; Engine appears for a slider-crank; Forces runs a static (virtual work) analysis and the dynamic model; Synthesis designs a four-bar for given coupler positions or a function.',
  'Dragging a joint redraws the mechanism: link lengths always follow the drawing. Edit exact numbers in the Edit tab.',
].join('\n\n')

const SHORTCUTS = [
  'V select · G ground pin · J joint · L link · C coupler point · S slider · D driver · T tracer · X delete',
  'P play / pause · ← → step the input by 1° (Shift 10°) · Home back to the drawn pose',
  'F or ⌘0 fit to window · + / − zoom · space + drag or middle button pans · wheel zooms',
  'Delete removes the selection · Esc cancels a tool · ⌘Z undo · ⇧⌘Z redo · ⌘S save · ⌘O open · ⌘N new',
].join('\n\n')

export default function LinkageBench({ shell }: { shell: Shell<LinkageDoc> }) {
  const m = shell.model
  const pal = usePalette()
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(DEFAULT_PREFS, PREFS_KEY))
  const setPrefs = (p: Partial<Prefs>) => setPrefsState((old) => { const n = { ...old, ...p }; savePrefs(n, PREFS_KEY); return n })
  const [tool, setToolState] = useState<Tool>('select')
  const [pick, setPick] = useState<Pick | null>(null)
  const [hover, setHover] = useState<Pick | null>(null)
  const [linkFrom, setLinkFrom] = useState<LinkStart | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const [theta, setTheta] = useState(() => driverAngleDeg(m))
  const [playing, setPlaying] = useState(false)
  const [plot, setPlot] = useState<PlotKind>('motion')
  const [dyn, setDyn] = useState<DynResult | null>(null)
  const [atlasLink, setAtlasLink] = useState<string>('')
  const [showAtlas, setShowAtlas] = useState(false)
  const [dragging, setDragging] = useState(false)
  const canvas = useRef<CanvasHandle>(null)
  const chart = useRef<ChartHandle>(null)
  const dir = useRef(1)
  const live = useRef({ m, theta, tool, pick })
  live.current = { m, theta, tool, pick }

  // ------------------------------------------------------------ the analysis (debounced while editing)
  const [analysis, setAnalysis] = useState<{ model: LinkageDoc; cycle: Cycle }>(() => ({ model: m, cycle: analyseCycle(m, { steps: 360, output: m.output }) }))
  useEffect(() => {
    if (analysis.model === m) return
    const t = setTimeout(() => setAnalysis({ model: m, cycle: analyseCycle(m, { steps: 360, output: m.output }) }), dragging ? 350 : 110)
    return () => clearTimeout(t)
  }, [m, analysis.model, dragging])
  const fresh = analysis.model === m
  const cycle = analysis.cycle
  const live2 = fresh && cycle.ok

  // a different document: back to its drawn pose
  const firstDoc = useRef(shell.docId)
  useEffect(() => {
    if (firstDoc.current === shell.docId) return
    firstDoc.current = shell.docId
    setTheta(driverAngleDeg(live.current.m)); setPlaying(false); setPick(null); setDyn(null); setLinkFrom(null); setShowAtlas(false)
  }, [shell.docId])

  // ------------------------------------------------------------ playing
  const lo = live2 && cycle.frames.length ? deg(cycle.frames[0].theta) : theta
  const hi = live2 && cycle.frames.length ? deg(cycle.frames[cycle.frames.length - 1].theta) : theta
  const dwell = !!m.dwell
  useEffect(() => {
    if (!playing || !live2) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const rate = 60 * prefs.speed
      setTheta((t) => {
        if (cycle.range.full || dwell) return t + rate * dt
        let n = t + dir.current * rate * dt
        if (n > hi) { n = hi; dir.current = -1 } else if (n < lo) { n = lo; dir.current = 1 }
        return n
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, live2, prefs.speed, cycle, dwell, hi, lo])

  const ensureDesign = () => {
    const t0 = driverAngleDeg(live.current.m)
    if (playing) setPlaying(false)
    if (Math.abs(live.current.theta - t0) > 1e-9) setTheta(t0)
  }

  // ------------------------------------------------------------ what is shown
  const design = useMemo(() => designPoints(m), [m])
  const posed = live2 && !dragging ? cyclePose(cycle, theta) : null
  const pts: ReadonlyMap<string, Pt> = posed ? posed.points : design
  const bounds = useMemo(() => {
    const b = boundsOf([...design.values(), ...Object.values(fresh ? cycle.tracers : {}).flat()])
    const pad = Math.max(20, 0.12 * Math.max(b.maxX - b.minX, b.maxY - b.minY))
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
  }, [design, cycle, fresh])
  // after a new document the view is fitted once more when its analysis (and so its traced paths) is ready
  const fitPending = useRef(true)
  const [fitTick, setFitTick] = useState(0)
  useEffect(() => { fitPending.current = true }, [shell.docId])
  useEffect(() => { if (fitPending.current && fresh) { fitPending.current = false; setFitTick((t) => t + 1) } }, [fresh, shell.docId])
  const fitKey = `${shell.docId}|${fitTick}|${m.points.length > 0}`
  const arrows = prefs.vel && posed && live2 ? cycleArrows(cycle, posed, 0.18 * Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)) : null

  const atlas = useMemo(() => {
    if (!showAtlas || !live2 || cycle.frames.length < 3) return []
    const link = m.links.find((l) => l.id === atlasLink) ?? m.links.find((l) => l.pts.length >= 3) ?? m.links.find((l) => l.pts.length === 2 && !l.pts.every((id) => m.points.find((p) => p.id === id)?.ground))
    return link ? couplerAtlas(cycle, link) : []
  }, [showAtlas, live2, cycle, atlasLink, m])

  const prims: Prim[] = useMemo(() => {
    const ps: Prim[] = []
    for (const a of atlas) ps.push({ k: 'path', pts: a.path, closed: a.closed, style: { stroke: a.cusps ? '#fb923c' : '#475569', width: 1 } })
    ps.push(...linkageScene(m, pts, {
      pick, hover, paths: prefs.paths && live2 ? cycle.tracers : undefined, labels: prefs.labels, dims: prefs.dims, arrows, extent: bounds, engine: m.engine ?? null,
    }))
    if (linkFrom && cursor) {
      const a = linkFrom.id ? pts.get(linkFrom.id) ?? linkFrom.at : linkFrom.at
      ps.push({ k: 'path', pts: [a, cursor], style: { stroke: COLORS.sel, width: 2, dash: [6, 4] } })
    }
    return ps
  }, [m, pts, pick, hover, prefs.paths, prefs.labels, prefs.dims, live2, cycle, arrows, bounds, linkFrom, cursor, atlas])

  // ------------------------------------------------------------ editing
  const setTool = (t: Tool) => {
    setToolState(t)
    setLinkFrom(null)
    shell.say(TOOLS.find((x) => x.id === t)!.hint)
  }

  const snapPt = (p: Pt, scale: number): Pt => {
    if (!prefs.snap) return p
    const step = niceStep(scale, 18)
    return { x: snapTo(p.x, step), y: snapTo(p.y, step) }
  }

  const removePick = () => {
    if (!pick) return
    shell.commit(deletePick(m, pick))
    setPick(null)
  }

  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)

  const onDown = (p: Pt, _e: React.PointerEvent, scale: number): boolean => {
    ensureDesign()
    const base = live.current.m
    const r = toolClick(base, tool, p, snapPt(p, scale), 10 / scale, linkFrom)
    if (r.say) shell.say(r.say)
    if (r.model) shell.commit(r.model)
    if (r.pick !== undefined) setPick(r.pick)
    if (r.linkFrom !== undefined) setLinkFrom(r.linkFrom)
    if (r.drag) {
      drag.current = r.drag
      shell.begin()
      setDragging(true)
      return true
    }
    return false
  }

  const onMove = (p: Pt, _e: React.PointerEvent, scale: number) => {
    const sp = snapPt(p, scale)
    if (tool === 'link') setCursor(sp)
    const d = drag.current
    if (d) {
      const t = snapPt({ x: p.x + d.dx, y: p.y + d.dy }, scale)
      shell.preview(movePoint(live.current.m, d.id, t.x, t.y))
      return
    }
    const hit = pickAt(live.current.m, pts, p, 10 / scale)
    setHover((old) => (old?.kind === hit?.kind && old?.id === hit?.id ? old : hit))
  }

  const onUp = () => {
    if (drag.current) {
      drag.current = null
      // slider lines and slots may be left a little off by the move: tidy the pose, in the same undo step
      const tidy = settle(live.current.m)
      if (tidy !== live.current.m) shell.preview(tidy)
      shell.end()
      setDragging(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); canvas.current?.fit() }
      return
    }
    const k = e.key.toLowerCase()
    const t = TOOLS.find((x) => x.key.toLowerCase() === k)
    if (t) { e.preventDefault(); setTool(t.id); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removePick(); return }
    if (e.key === 'Escape') { if (linkFrom) setLinkFrom(null); else if (tool !== 'select') setTool('select'); else setPick(null); return }
    if (k === 'p') { e.preventDefault(); togglePlay(); return }
    if (k === 'f') { canvas.current?.fit(); return }
    if (k === '+' || k === '=') { canvas.current?.zoomBy(1.25); return }
    if (k === '-') { canvas.current?.zoomBy(0.8); return }
    if (e.key === 'Home') { ensureDesign(); return }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); setTheta((t0) => clampTheta(t0 + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1))) }
  }

  const clampTheta = (t: number): number => (live2 && !cycle.range.full && !dwell ? Math.min(hi, Math.max(lo, t)) : t)
  const togglePlay = () => {
    if (!live2) { shell.say(cycle.message ?? 'Nothing to play yet: finish the mechanism and give it a driver.'); return }
    setPlaying((p) => !p)
  }

  const onContext = (p: Pt, e: React.MouseEvent) => {
    const base = live.current.m
    const hit = pickAt(base, designPoints(base), p, 10 / (canvas.current?.getView().scale ?? 2))
    const sp = snapPt(p, canvas.current?.getView().scale ?? 2)
    const items: MenuItem[] = []
    if (!hit) {
      items.push(
        { label: 'Add ground pin here', onClick: () => { const r = addPoint(base, sp.x, sp.y, true); shell.commit(r.m); setPick({ kind: 'point', id: r.id }) } },
        { label: 'Add joint here', onClick: () => { const r = addPoint(base, sp.x, sp.y); shell.commit(r.m); setPick({ kind: 'point', id: r.id }) } },
        '-', { label: 'Fit to window', shortcut: 'F', onClick: () => canvas.current?.fit() },
      )
    } else if (hit.kind === 'point') {
      const pt = base.points.find((q) => q.id === hit.id)!
      items.push(
        { label: pt.ground ? 'Make it a free joint' : 'Make it a ground pin', onClick: () => shell.commit({ ...base, points: base.points.map((q) => (q.id === pt.id ? { ...q, ground: q.ground ? undefined : true } : q)) }) },
        { label: pt.tracer ? 'Stop tracing' : 'Trace its path', onClick: () => shell.commit(toggleTracer(base, pt.id)) },
        ...(!pt.ground ? [{ label: 'Make it a slider', onClick: () => shell.commit(addSlider(base, pt.id, 0)) }] : []),
        '-', { label: 'Delete', shortcut: '⌫', danger: true, onClick: () => { shell.commit(deletePick(base, hit)); setPick(null) } },
      )
    } else if (hit.kind === 'link') {
      items.push(
        { label: 'Make it the driver', onClick: () => shell.commit(setDriverOnLink(base, hit.id)) },
        { label: 'Add a coupler point here', onClick: () => { const r = addCouplerPoint(base, hit.id, sp.x, sp.y); if (r) { shell.commit(r.m); setPick({ kind: 'point', id: r.id }) } } },
        '-', { label: 'Delete', shortcut: '⌫', danger: true, onClick: () => { shell.commit(deletePick(base, hit)); setPick(null) } },
      )
    } else {
      items.push({ label: 'Delete', shortcut: '⌫', danger: true, onClick: () => { shell.commit(deletePick(base, hit)); setPick(null) } })
    }
    os.contextMenu(e, items)
  }

  // ------------------------------------------------------------ the numbers shown on the sheet
  const outInfo = (() => {
    if (!live2 || cycle.frames.length < 2) return null
    const f = (rad(theta) - cycle.frames[0].theta) / (cycle.frames[cycle.frames.length - 1].theta - cycle.frames[0].theta)
    const wrapped = cycle.range.full ? ((f % 1) + 1) % 1 : Math.min(1, Math.max(0, f))
    const i = Math.min(cycle.frames.length - 1, Math.max(0, Math.round(wrapped * (cycle.frames.length - 1))))
    return { i, out: cycle.pos[i], mu: cycle.mu[i], vel: cycle.vel[i] }
  })()
  const thetaShown = live2 && posed ? deg(posed.theta) : theta

  // ------------------------------------------------------------ exports
  const figureSvg = (): { svg: string; box: ReturnType<typeof sceneBounds> } => {
    const ps = linkageScene(m, pts, { pick: null, paths: live2 ? cycle.tracers : undefined, labels: true, dims: prefs.dims, extent: bounds, engine: m.engine ?? null })
    const b = boundsOf([...pts.values(), ...Object.values(live2 ? cycle.tracers : {}).flat()])
    const pad = 0.1 * Math.max(b.maxX - b.minX, b.maxY - b.minY, 40)
    const box = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad }
    return { svg: sceneToSvg(ps, box, { pxPerMm: Math.max(1, 900 / Math.max(box.maxX - box.minX, 1)), title: m.name }), box }
  }
  const exportSvg = async () => { try { await shell.saveFile(`${safeName(m.name)}.svg`, '.svg', figureSvg().svg) } catch (e) { await os.dialog.alert(String((e as Error).message ?? e), { title: 'Export' }) } }
  const exportPng = async () => {
    try {
      const { svg, box } = figureSvg()
      const w = 1600; const h = Math.round((w * (box.maxY - box.minY)) / (box.maxX - box.minX))
      await shell.saveFile(`${safeName(m.name)}.png`, '.png', await svgToPng(svg, 800, Math.round(h / 2), 2))
    } catch (e) { await os.dialog.alert(String((e as Error).message ?? e), { title: 'Export' }) }
  }
  const tableOf = useCallback((): { header: string[]; rows: number[][]; name: string } | null => {
    if (plot === 'dynamics' || plot === 'joints') return dyn ? { ...dynamicsTable(dyn), name: `${m.name} dynamics` } : null
    if (plot === 'pressure' || plot === 'enginetorque') return m.engine ? { ...engineTable(runEngine(m.engine)), name: `${m.name} engine` } : null
    if (plot === 'coupler' || plot === 'atlas') return live2 ? { ...tracerTable(cycle), name: `${m.name} coupler curves` } : null
    return live2 ? { ...motionTable(cycle), name: `${m.name} motion` } : null
  }, [plot, dyn, m, live2, cycle])
  const exportCsv = async () => { const t = tableOf(); if (!t) { shell.say('Nothing to export yet.'); return } await shell.saveFile(`${safeName(t.name)}.csv`, '.csv', toCsv(t.header, t.rows)) }
  const toKplot = () => { const t = tableOf(); if (!t) { shell.say('Nothing to send to kPlot yet.'); return } shell.openInKplot(toTsv(t.header, t.rows), t.name) }

  // ------------------------------------------------------------ the plot
  const engineRes = useMemo(() => (m.engine ? runEngine(m.engine) : null), [m.engine])
  const staticLoads = m.loads ?? []
  const figure: Figure | null = useMemo(() => {
    switch (plot) {
      case 'motion': return live2 ? motionFigure(cycle, pal) : null
      case 'transmission': return live2 ? transmissionFigure(cycle, pal) : null
      case 'coupler': {
        if (!live2) return null
        return couplerFigure(Object.entries(cycle.tracers).map(([id, path]) => ({ name: m.points.find((p) => p.id === id)?.label || id, x: path.map((q) => q.x), y: path.map((q) => q.y) })), pal)
      }
      case 'atlas': return live2 && atlas.length ? couplerFigure(atlas.map((a) => ({ name: `a=${a.a}, b=${a.b}`, x: a.path.map((q) => q.x), y: a.path.map((q) => q.y) })).slice(0, 30), pal) : null
      case 'pressure': return engineRes ? pressureFigure(engineRes, pal) : null
      case 'enginetorque': return engineRes ? engineTorqueFigure(engineRes, pal) : null
      case 'static': {
        if (!live2 || !staticLoads.length) return null
        const t = staticTorqueCurve(cycle, staticLoads).map((v) => (v === null ? NaN : v / 1000))
        return stacked([{ title: 'input torque (N·m)', traces: [{ type: 'scatter', mode: 'lines', x: cycle.theta, y: t, name: 'torque', line: { color: pal.accent, width: 2 }, showlegend: false }] }], 'input angle (°)', pal)
      }
      case 'dynamics': return dyn?.ok ? dynamicsFigure(dyn, live2 ? cycle : null, pal) : null
      case 'joints': return dyn?.ok ? jointForceFigure(dyn, pal) : null
    }
  }, [plot, live2, cycle, pal, m.points, engineRes, atlas, staticLoads, dyn])

  // ------------------------------------------------------------ menus
  const panelApi: PanelApi = {
    m, shell, pick, setPick, cycle, fresh, plot, setPlot, dyn, setDyn, tab: prefs.tab, atlasLink, setAtlasLink, showAtlas, setShowAtlas, canvas, setTool, theta: thetaShown,
    openDock: () => setPrefs({ dock: true }),
  }

  useEffect(() => {
    const view: MenuItem[] = [
      { label: 'Zoom in', icon: ZoomIn, shortcut: '+', onClick: () => canvas.current?.zoomBy(1.25) },
      { label: 'Zoom out', icon: ZoomOut, shortcut: '−', onClick: () => canvas.current?.zoomBy(0.8) },
      { label: 'Fit to window', icon: Maximize, shortcut: 'F', onClick: () => canvas.current?.fit() },
      '-',
      { label: 'Grid', checked: prefs.grid, onClick: () => setPrefs({ grid: !prefs.grid }) },
      { label: 'Snap to grid', checked: prefs.snap, onClick: () => setPrefs({ snap: !prefs.snap }) },
      { label: 'Point names', checked: prefs.labels, onClick: () => setPrefs({ labels: !prefs.labels }) },
      { label: 'Link lengths', checked: prefs.dims, onClick: () => setPrefs({ dims: !prefs.dims }) },
      { label: 'Velocity arrows', checked: prefs.vel, onClick: () => setPrefs({ vel: !prefs.vel }) },
      { label: 'Traced paths', checked: prefs.paths, onClick: () => setPrefs({ paths: !prefs.paths }) },
      '-',
      { label: 'Side panel', checked: prefs.side, onClick: () => setPrefs({ side: !prefs.side }) },
      { label: 'Plots', checked: prefs.dock, onClick: () => setPrefs({ dock: !prefs.dock }) },
    ]
    const draw: MenuItem[] = TOOLS.map((t) => ({ label: t.label, shortcut: t.key, checked: tool === t.id, onClick: () => setTool(t.id) }))
    const analyse: MenuItem[] = [
      { label: playing ? 'Pause' : 'Play', icon: playing ? Pause : Play, shortcut: 'P', onClick: togglePlay },
      { label: 'Back to the drawn pose', shortcut: 'Home', onClick: ensureDesign },
      '-',
      ...(['motion', 'transmission', 'coupler', 'atlas'] as PlotKind[]).map((k) => ({ label: `Plot: ${PLOT_LABELS[k]}`, checked: plot === k && prefs.dock, onClick: () => { setPlot(k); if (k === 'atlas') setShowAtlas(true); setPrefs({ dock: true }) } })),
      ...(m.engine ? (['pressure', 'enginetorque'] as PlotKind[]).map((k) => ({ label: `Plot: ${PLOT_LABELS[k]}`, checked: plot === k && prefs.dock, onClick: () => { setPlot(k); setPrefs({ dock: true }) } })) : []),
      '-',
      { label: 'Analysis', checked: prefs.tab === 'analysis' && prefs.side, onClick: () => setPrefs({ tab: 'analysis', side: true }) },
      { label: 'Coupler curves', checked: prefs.tab === 'coupler' && prefs.side, onClick: () => setPrefs({ tab: 'coupler', side: true }) },
      { label: 'Engine', checked: prefs.tab === 'engine' && prefs.side, onClick: () => setPrefs({ tab: 'engine', side: true }) },
      { label: 'Forces and dynamics', checked: prefs.tab === 'forces' && prefs.side, onClick: () => setPrefs({ tab: 'forces', side: true }) },
      { label: 'Synthesis', checked: prefs.tab === 'synthesis' && prefs.side, onClick: () => setPrefs({ tab: 'synthesis', side: true }) },
    ]
    const exports: MenuItem[] = [
      { label: 'Mechanism figure (SVG)…', onClick: () => void exportSvg() },
      { label: 'Mechanism figure (PNG)…', onClick: () => void exportPng() },
      { label: 'Plot data (CSV)…', onClick: () => void exportCsv() },
      { label: 'Open the plot data in kPlot', onClick: toKplot },
    ]
    const menus: MenuBarMenu[] = [
      shell.fileMenu(exports),
      shell.editMenu([{ label: 'Delete selection', shortcut: '⌫', disabled: !pick, onClick: removePick }, { label: 'Deselect', shortcut: 'Esc', onClick: () => setPick(null) }]),
      { label: 'Draw', items: draw },
      { label: 'Analyse', items: analyse },
      { label: 'View', items: view },
      shell.helpMenu(SHORTCUTS, HELP),
    ]
    shell.win.setMenus(menus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.version, prefs, tool, playing, plot, pick, live2, dyn, m.engine, theta])

  // ------------------------------------------------------------ the dock
  const dragDock = (e: React.PointerEvent) => {
    const startY = e.clientY; const start = prefs.dockH
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setPrefsState((p) => ({ ...p, dockH: Math.min(620, Math.max(150, start + startY - ev.clientY)) }))
    const up = () => { el.removeEventListener('pointermove', move as EventListener); el.removeEventListener('pointerup', up); setPrefsState((p) => { savePrefs(p, PREFS_KEY); return p }) }
    el.addEventListener('pointermove', move as EventListener); el.addEventListener('pointerup', up)
  }

  const plotChoices: PlotKind[] = ['motion', 'transmission', 'coupler', ...(showAtlas ? ['atlas' as PlotKind] : []), ...(m.engine ? ['pressure' as PlotKind, 'enginetorque' as PlotKind] : []), ...(staticLoads.length ? ['static' as PlotKind] : []), ...(dyn?.ok ? ['dynamics' as PlotKind, 'joints' as PlotKind] : [])]

  const empty = m.points.length === 0
  const loadExample = async (id: string) => { const e = EXAMPLES.find((x) => x.id === id); if (e) await shell.replace(e.doc) }

  return (
    <div className="mc-body" onKeyDown={undefined}>
      <div className="mc-tools" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
        {TOOLS.map((t) => (
          <button key={t.id} className={`k-icon-btn${tool === t.id ? ' active' : ''}`} title={`${t.label} (${t.key})`} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
            <t.Icon size={16} />
          </button>
        ))}
        <span className="k-sep" />
        <button className="k-icon-btn" title="Fit to window (F)" aria-label="Fit to window" onClick={() => canvas.current?.fit()}><Maximize size={16} /></button>
        <button className={`k-icon-btn${prefs.dock ? ' active' : ''}`} title="Plots" aria-label="Plots" aria-pressed={prefs.dock} onClick={() => setPrefs({ dock: !prefs.dock })}><LineChart size={16} /></button>
        <button className={`k-icon-btn${prefs.side ? ' active' : ''}`} title="Side panel" aria-label="Side panel" aria-pressed={prefs.side} onClick={() => setPrefs({ side: !prefs.side })}><PanelRight size={16} /></button>
      </div>
      <div className="mc-main">
        <div className="mc-stage">
          <MechCanvas
            ref={canvas} prims={prims} fitTo={bounds} fitKey={fitKey} grid={prefs.grid} label="Mechanism drawing" cursor={tool === 'select' ? (hover ? 'pointer' : 'default') : 'crosshair'}
            onDown={onDown} onMove={onMove} onUp={onUp} onContextMenu={onContext} onLeave={() => { setHover(null); setCursor(null) }} onKeyDown={onKeyDown}
          >
            {empty && (
              <Empty title="An empty sheet">
                Pick the Ground pin tool (G) and click to fix a pivot, then draw bars with the Link tool (L), give one bar a driver (D) and press play. Or open an example from File › Open Example.
                <span className="mc-actions" style={{ justifyContent: 'center', pointerEvents: 'auto' }}>
                  <button className="k-btn" onClick={() => void loadExample('crank-rocker')}>Crank-rocker</button>
                  <button className="k-btn" onClick={() => void loadExample('slider-crank-engine')}>Slider-crank engine</button>
                  <button className="k-btn" onClick={() => void loadExample('jansen')}>Theo Jansen leg</button>
                </span>
              </Empty>
            )}
            {!empty && (
              <div className="mc-overlay-info" aria-live="off">
                <b>{m.name}</b>
                {live2 && cycle.grashof ? <> · {cycle.grashof.label}</> : null}
                {!cycle.ok && fresh ? <><br />{cycle.message}</> : null}
                {live2 && outInfo ? <><br />input {fmt(thetaShown, 4)}°{cycle.output ? ` · output ${fmt(outInfo.out, 4)}${cycle.outputUnit === 'deg' ? '°' : ' mm'}` : ''}{outInfo.mu !== null ? ` · μ ${fmt(outInfo.mu, 3)}°` : ''}</> : null}
              </div>
            )}
            <div className="mc-play">
              <button className="k-icon-btn" title="Back to the drawn pose (Home)" aria-label="Back to the drawn pose" onClick={ensureDesign}><SkipBack size={15} /></button>
              <button className={`k-btn${playing ? '' : ' primary'}`} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play / pause (P)">{playing ? <Pause size={13} /> : <Play size={13} />}</button>
              <input
                type="range" aria-label="Input angle" disabled={!live2} min={live2 ? lo : 0} max={live2 ? (cycle.range.full || dwell ? lo + 360 : hi) : 1} step={0.5}
                value={live2 ? (cycle.range.full || dwell ? lo + ((((theta - lo) % 360) + 360) % 360) : Math.min(hi, Math.max(lo, theta))) : 0}
                onChange={(e) => { setPlaying(false); setTheta(Number(e.target.value)) }}
              />
              <span className="mc-readout">{live2 ? `${fmt(thetaShown, 4)}°` : '–'}</span>
              <select className="k-input" aria-label="Playback speed" value={prefs.speed} onChange={(e) => setPrefs({ speed: Number(e.target.value) })}>
                {[0.25, 0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </div>
          </MechCanvas>
          {prefs.side && <LinkagePanels api={panelApi} tab={prefs.tab} setTab={(t) => setPrefs({ tab: t })} onClose={() => setPrefs({ side: false })} />}
        </div>
        {prefs.dock && (
          <>
            <div className="mc-splitter" onPointerDown={dragDock} role="separator" aria-orientation="horizontal" aria-label="Resize the plots" />
            <div className="mc-dock" style={{ height: prefs.dockH }}>
              <div className="mc-dock-bar">
                <div className="mc-seg" role="tablist" aria-label="Plot">
                  {plotChoices.map((k) => <button key={k} role="tab" aria-selected={plot === k} className={plot === k ? 'on' : ''} onClick={() => setPlot(k)}>{PLOT_LABELS[k]}</button>)}
                </div>
                <span className="k-spacer" />
                <button className="k-btn" title="Save the plot as a PNG" onClick={() => void chart.current?.png().then((b) => shell.saveFile(`${safeName(m.name)}-${plot}.png`, '.png', b)).catch((e) => os.dialog.alert(String(e.message ?? e)))}><Download size={13} /> PNG</button>
                <button className="k-btn" title="Save the plot as an SVG" onClick={() => void chart.current?.svg().then((s) => shell.saveFile(`${safeName(m.name)}-${plot}.svg`, '.svg', s)).catch((e) => os.dialog.alert(String(e.message ?? e)))}>SVG</button>
                <button className="k-btn" title="Open the data in kPlot" onClick={toKplot}>Open in kPlot</button>
                <button className="k-icon-btn" title="Close the plots" aria-label="Close the plots" onClick={() => setPrefs({ dock: false })}><X size={14} /></button>
              </div>
              <div className="mc-dock-body">
                {figure ? <PlotlyChart figure={figure} handle={chart} /> : <PlotHint plot={plot} cycle={cycle} fresh={fresh} hasDyn={!!dyn} hasLoads={staticLoads.length > 0} />}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export const PLOT_LABELS: Record<PlotKind, string> = {
  motion: 'Output vs input', transmission: 'Transmission angle', coupler: 'Coupler curves', atlas: 'Coupler atlas', pressure: 'Gas pressure', enginetorque: 'Engine torque', static: 'Static torque', dynamics: 'Dynamics', joints: 'Joint forces',
}

function PlotHint({ plot, cycle, fresh, hasDyn, hasLoads }: { plot: PlotKind; cycle: Cycle; fresh: boolean; hasDyn: boolean; hasLoads: boolean }) {
  let text = 'Nothing to plot yet.'
  if (!fresh) text = 'Updating the analysis…'
  else if ((plot === 'motion' || plot === 'transmission' || plot === 'coupler' || plot === 'atlas') && !cycle.ok) text = cycle.message ?? 'The mechanism cannot be analysed yet.'
  else if (plot === 'static' && !hasLoads) text = 'Add a load in the Forces tab to see the static input torque.'
  else if ((plot === 'dynamics' || plot === 'joints') && !hasDyn) text = 'Run the dynamic model in the Forces tab.'
  else if (plot === 'atlas') text = 'Switch on the coupler atlas in the Coupler tab.'
  return <div className="mc-chart-note k-muted" style={{ position: 'relative', height: '100%' }}>{text}</div>
}

