// The spectrum plot, drawn as the desktop's matplotlib figure (PlotManager in
// Plot_Operations.py): white figure, axes at left 0.10 / right 0.95 / top 0.95
// / bottom 0.10, the residuals in a strip below (rows 18–19 of a 20-row grid),
// data as black dots, the background dashed brown, the envelope black, peaks
// filled (solid, hatched or as lines) down to the background, the legend of
// the peaks (upper left), the core-level title (top right), the intensity in
// ×10ⁿ, a binding-energy axis running from high to low, χ beside the
// residuals. SVG, so the same component renders in Node for tests.
//
// Mouse, as the desktop (On_Mouse_Defs.MouseEventHandler, PeakManipulation):
//  - Peak Fitting window on its BKG tab: a press near a red line drags it, a
//    press elsewhere brings the nearer line there and drags it; Ctrl+drag
//    moves both lines; Shift+press / Shift+drag sets the background offset of
//    the nearer line from the mouse height; the region is redrawn on release;
//  - Fitting tab: a press within 100 px of the selected peak's top (blue ×)
//    drags it (Shift: its width); a press elsewhere deselects it; the wheel
//    widens / narrows the selected peak;
//  - the green line drags anywhere; Zoom In tool: one green box; Drag tool:
//    one pan; double-click: Plot Limits; right-click: the plot's menu.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent } from 'react'
import { peaksOf, reversedAxis, xLabel, type View } from './model'
import { PLOT_STYLE, PT, autoTicks, formatTicks, formatSheetName, legendPeaks, mathPieces, minorTicks, peakColours } from './mpl'
import { valueAt } from './plotmath'

export interface Limits {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

/** The display toggles (ToggleToolbar, View menu, Preferences). */
export interface PlotOptions {
  /** 0 off, 1 on the main plot (scaled), 2 in a strip below (default). */
  residuals: 0 | 1 | 2
  /** 0 hidden, 1 full (data, background, fit, peaks), 2 peaks only (default). */
  legend: 0 | 1 | 2
  /** 0 values, 1 hidden, 2 "Intensity (a.u.)" without values. */
  yAxis: 0 | 1 | 2
  peakFill: boolean
  fitResults: boolean
  /** Show the fitted model at all (Toggle Plot). */
  showFit: boolean
  /** A+ / A− steps added to every font size. */
  fontDelta: number
  /** Per-peak fill: 'Solid Fill' | 'Hatch' | 'None'. */
  fillTypes: string[]
  hatches: string[]
}

export const DEFAULT_OPTIONS: PlotOptions = {
  residuals: 2, legend: 2, yAxis: 0, peakFill: true, fitResults: false, showFit: true, fontDelta: 0, fillTypes: [], hatches: [],
}

export type PlotMode = 'none' | 'zoom' | 'drag'

/** Which window drives the plot: the Fitting window's BKG tab, its Fitting tab, a tool that owns the red lines, or nothing. */
export type PlotInteraction = 'none' | 'bkg' | 'peak' | 'lines'

export interface PlotLabel {
  text: string
  x: number
  y?: number | null
  rotation?: number
  fontsize?: number
}

/** The D-parameter derivative the desktop draws instead of the fit (Dpara_Screen). */
export interface DParamCurve {
  x: number[]
  y: number[]
  color_after_calculate?: string
  hide?: string[]
}

/** Measure Area fills: data above the background, per area row (AreaFit_Screen). */
export interface AreaFills {
  fills: { label: string; peak_index: number; x: number[]; y: number[]; bkg: number[] }[]
  envelope: boolean
}

/** A Survey Identification line (survey.plot_element_lines): fraction of the axis height. */
export interface IdLine {
  x: number
  frac: number
  text: string
}

export interface PlotProps {
  view: View
  limits: Limits
  options: PlotOptions
  selected: number | null
  /** The red dashed region lines (binding energies), or null when hidden. */
  vlines: [number, number] | null
  greenLine: number | null
  mode: PlotMode
  /** What a press on the plot does (default 'none'). */
  interaction?: PlotInteraction
  /** Averaging Points of the BKG tab: the red/grey averaging marks at each line (add_averaging_indicator_lines). */
  averagingPoints?: number | null
  labels?: PlotLabel[]
  chi?: number | null
  dparam?: DParamCurve | null
  areaFills?: AreaFills | null
  idLines?: IdLine[]
  /** The empty plot's faint KherveFitting picture (plot_initial_logo). */
  logo?: string | null
  /** Fixed size (tests); otherwise the plot follows its panel. */
  size?: { w: number; h: number }
  onLimits?: (l: Limits) => void
  onCursor?: (at: { x: number; y: number } | null) => void
  /** A press away from the selected peak (deselect_all_peaks). */
  onSelect?: (peak: number | null) => void
  onPeakDrag?: (peak: number, x: number, y: number, phase: 'start' | 'move' | 'end') => void
  /** Shift+drag of the selected peak: its width follows x (update_peak_fwhm). */
  onPeakWidth?: (peak: number, x: number, phase: 'start' | 'move' | 'end') => void
  /** Wheel over the plot with the selected peak (Fitting tab). */
  onPeakWheel?: (peak: number, up: boolean) => void
  onVlines?: (lo: number, hi: number, final: boolean) => void
  /** Shift+press / Shift+drag on the BKG tab: the mouse position (binding energy, intensity). */
  onOffset?: (x: number, y: number, final: boolean) => void
  /** The Zoom In box or the Drag pan is done (the tool turns itself off, as on the desktop). */
  onModeDone?: () => void
  onGreenLine?: (x: number) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: ReactMouseEvent, at: { x: number; y: number; peak: number }) => void
}

interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

interface Frame {
  main: Box
  resid: Box | null
  /** BE → px */
  X: (v: number) => number
  /** px → BE */
  iX: (px: number) => number
  Y: (v: number) => number
  iY: (py: number) => number
  R: ((v: number) => number) | null
  rlim: [number, number] | null
  rev: boolean
}

const px = (pt: number) => pt * PT
const FONT = PLOT_STYLE.font

/** Width of a text in pixels (canvas when there is one, a Calibri-like estimate otherwise). */
let measureCtx: CanvasRenderingContext2D | null | undefined
export function textWidth(text: string, size: number, bold = false): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
    } catch {
      measureCtx = null
    }
  }
  if (measureCtx) {
    measureCtx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`
    return measureCtx.measureText(text).width
  }
  let w = 0
  for (const ch of text) w += /[ilI.,:;'|!()[\]]/.test(ch) ? 0.25 : /[mwMW]/.test(ch) ? 0.8 : /[A-Z]/.test(ch) ? 0.6 : /\d/.test(ch) ? 0.507 : 0.47
  return w * size * (bold ? 1.06 : 1)
}

/** matplotlib line styles in pixels for a line width in points. */
const DASH = (lw: number) => `${px(3.7 * lw).toFixed(2)} ${px(1.6 * lw).toFixed(2)}`

function pathOf(xs: readonly (number | null)[], ys: readonly (number | null)[] | null | undefined, X: (v: number) => number, Y: (v: number) => number): string {
  if (!ys) return ''
  let d = ''
  let on = false
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const y = ys[i]
    if (x === null || y === null || y === undefined || !Number.isFinite(y)) {
      on = false
      continue
    }
    d += `${on ? 'L' : 'M'}${X(x).toFixed(2)} ${Y(y).toFixed(2)}`
    on = true
  }
  return d
}

/** fill_between(x, lower, upper): one closed polygon per run of finite values. */
function fillPath(xs: readonly (number | null)[], lower: readonly (number | null)[], upper: readonly (number | null)[], X: (v: number) => number, Y: (v: number) => number): string {
  let d = ''
  let run: number[] = []
  const flush = () => {
    if (run.length > 1) {
      d += run.map((i, k) => `${k ? 'L' : 'M'}${X(xs[i]!).toFixed(2)} ${Y(upper[i]!).toFixed(2)}`).join('')
      for (let k = run.length - 1; k >= 0; k--) d += `L${X(xs[run[k]]!).toFixed(2)} ${Y(lower[run[k]]!).toFixed(2)}`
      d += 'Z'
    }
    run = []
  }
  for (let i = 0; i < xs.length; i++) {
    const ok = xs[i] !== null && upper[i] !== null && upper[i] !== undefined && lower[i] !== null && lower[i] !== undefined && Number.isFinite(upper[i]!) && Number.isFinite(lower[i]!)
    if (ok) run.push(i)
    else flush()
  }
  flush()
  return d
}

/** matplotlib hatch patterns ('/', '\\', '|', '-', '+', 'x', '.', 'o', '*') as SVG pattern content. */
function hatchPattern(id: string, hatch: string, density: number, colour: string, alpha: number): ReactNode {
  const n = (c: string) => hatch.split('').filter((h) => h === c).length * density
  const cell = px(72)
  const lines: ReactNode[] = []
  const stroke = { stroke: colour, strokeOpacity: alpha, strokeWidth: px(1), fill: 'none' }
  const ne = n('/') + n('x') + n('X')
  const se = n('\\') + n('x') + n('X')
  const ve = n('|') + n('+')
  const ho = n('-') + n('+')
  const dots = n('.') + n('o') + n('O') + n('*')
  // Size the tile to one line spacing so the pattern repeats seamlessly.
  const k = Math.max(ne, se, ve, ho, dots, 1)
  const s = cell / k
  if (ne) lines.push(<path key="ne" d={`M0 ${s}L${s} 0M${-s} ${s}L${s} ${-s}M0 ${2 * s}L${2 * s} 0`} {...stroke} />)
  if (se) lines.push(<path key="se" d={`M0 0L${s} ${s}M${-s} 0L${s} ${2 * s}M0 ${-s}L${2 * s} ${s}`} {...stroke} />)
  if (ve) lines.push(<path key="v" d={`M${s / 2} 0V${s}`} {...stroke} />)
  if (ho) lines.push(<path key="h" d={`M0 ${s / 2}H${s}`} {...stroke} />)
  if (dots) lines.push(<circle key="o" cx={s / 2} cy={s / 2} r={Math.max(0.8, s / 6)} fill={colour} fillOpacity={alpha} />)
  return (
    <pattern key={id} id={id} patternUnits="userSpaceOnUse" width={s} height={s}>
      {lines}
    </pattern>
  )
}

/** The measured FWHM of a peak curve above the background (for the selected peak's note). */
function measuredFwhm(xs: readonly (number | null)[], curve: readonly (number | null)[], bkg: readonly (number | null)[]): number | null {
  let imax = -1
  let vmax = -Infinity
  for (let i = 0; i < xs.length; i++) {
    const c = curve[i]
    const b = bkg[i]
    if (c === null || b === null || xs[i] === null) continue
    if (c - b > vmax) {
      vmax = c - b
      imax = i
    }
  }
  if (imax < 0 || !(vmax > 0)) return null
  const half = vmax / 2
  const cross = (dir: 1 | -1) => {
    for (let i = imax; i >= 0 && i < xs.length; i += dir) {
      const j = i + dir
      if (j < 0 || j >= xs.length) return null
      const a = (curve[i] ?? NaN) - (bkg[i] ?? NaN)
      const b = (curve[j] ?? NaN) - (bkg[j] ?? NaN)
      if (!Number.isFinite(b)) return null
      if (a >= half && b < half) return xs[i]! + ((a - half) / (a - b)) * (xs[j]! - xs[i]!)
    }
    return null
  }
  const l = cross(-1)
  const r = cross(1)
  return l !== null && r !== null ? Math.abs(r - l) : null
}

/** A size for plots rendered without a layout engine (Node tests). */
export const PlotSizeHint = createContext<{ w: number; h: number } | null>(null)

export function Plot(props: PlotProps) {
  const { view, limits, options: o, selected, vlines, greenLine, mode } = props
  const interaction = props.interaction ?? 'none'
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const hint = useContext(PlotSizeHint)
  const [measured, setMeasured] = useState({ w: 800, h: 600 })
  const size = props.size ?? hint ?? measured
  const [drag, setDrag] = useState<
    | { kind: 'peak'; peak: number; x: number; y: number }
    | { kind: 'width'; peak: number }
    | { kind: 'vline'; other: number }
    | { kind: 'both'; ref: number; gap: number; lo: number }
    | { kind: 'offset' }
    | { kind: 'green' }
    | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
    | { kind: 'pan'; px0: number; py0: number; l: Limits }
    | null
  >(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || props.size) return
    const ro = new ResizeObserver(() => setMeasured({ w: Math.max(240, el.clientWidth), h: Math.max(200, el.clientHeight) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [props.size])

  const xs = view.x ?? []
  const ys = view.y ?? []
  const bkg = view.bkg ?? []
  const peaks = peaksOf(view.grid)
  const rev = reversedAxis(view.sheet)
  // Survey and wide scans draw their raw data as a line, the other sheets as dots
  // (Plot_Operations: "survey" or "wide" in the sheet name, any case).
  const lineScan = /survey|wide/i.test(view.sheet)
  const hide = new Set(props.dparam?.hide ?? [])
  if (props.areaFills && !props.areaFills.envelope) {
    hide.add('envelope')
    hide.add('residuals')
  }
  const hasResid = !hide.has('residuals') && o.showFit && o.residuals === 2 && !!view.residuals && view.residuals.some((v) => v !== null)
  const fs = {
    tick: PLOT_STYLE.axisNumberSize + o.fontDelta,
    title: PLOT_STYLE.axisTitleSize + o.fontDelta,
    legend: PLOT_STYLE.legendFontSize + o.fontDelta,
    core: PLOT_STYLE.coreLevelTextSize + o.fontDelta,
  }

  // ------------------------------------------------------------ geometry
  const frame: Frame = useMemo(() => {
    const W = size.w
    const H = size.h
    const left = 0.1 * W
    const right = 0.95 * W
    const top = 0.05 * H
    const bottomAll = 0.9 * H
    const mainBottom = hasResid ? H * (1 - 0.185) : bottomAll
    const main = { x0: left, x1: right, y0: top, y1: mainBottom }
    const resid = hasResid ? { x0: left, x1: right, y0: mainBottom, y1: bottomAll } : null
    const [a, b] = rev ? [limits.xmax, limits.xmin] : [limits.xmin, limits.xmax]
    const X = (v: number) => left + ((v - a) / (b - a || 1)) * (right - left)
    const iX = (p: number) => a + ((p - left) / (right - left)) * (b - a)
    const Y = (v: number) => mainBottom - ((v - limits.ymin) / (limits.ymax - limits.ymin || 1)) * (mainBottom - top)
    const iY = (p: number) => limits.ymin + ((mainBottom - p) / (mainBottom - top)) * (limits.ymax - limits.ymin)
    let R: Frame['R'] = null
    let rlim: [number, number] | null = null
    if (resid && view.residuals) {
      // setup_residual_subplot: min/max of the residuals ± 10 %
      let lo = Infinity
      let hi = -Infinity
      for (const v of view.residuals) {
        if (v === null || !Number.isFinite(v)) continue
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      if (lo <= hi) {
        const m = hi !== lo ? 0.1 * (hi - lo) : 0.1
        rlim = [lo - m, hi + m]
      } else rlim = [-1, 1]
      const [r0, r1] = rlim
      R = (v: number) => resid.y1 - ((v - r0) / (r1 - r0 || 1)) * (resid.y1 - resid.y0)
    }
    return { main, resid, X, iX, Y, iY, R, rlim, rev }
  }, [size.w, size.h, hasResid, rev, limits.xmin, limits.xmax, limits.ymin, limits.ymax, view.residuals])

  const { main, resid, X, Y } = frame

  // ------------------------------------------------------------ ticks
  const xr = [limits.xmin, limits.xmax] as const
  const xTicks = autoTicks(xr[0], xr[1], main.x1 - main.x0, fs.tick, 'x')
  const xFmt = formatTicks(xTicks, xr[0], xr[1], false)
  const xMinor = minorTicks(xTicks, xr[0], xr[1], PLOT_STYLE.xSublines + 1)
  const yTicks = autoTicks(limits.ymin, limits.ymax, main.y1 - main.y0, fs.tick, 'y')
  const yFmt = formatTicks(yTicks, limits.ymin, limits.ymax, true)
  const yMinor = minorTicks(yTicks, limits.ymin, limits.ymax, PLOT_STYLE.ySublines + 1)
  const rTicks = resid && frame.rlim ? autoTicks(frame.rlim[0], frame.rlim[1], resid.y1 - resid.y0, fs.tick, 'y') : []
  const rFmt = resid && frame.rlim ? formatTicks(rTicks, frame.rlim[0], frame.rlim[1], true) : null

  // ------------------------------------------------------------ peaks
  const labels = peaks.map((p) => p.label)
  const colours = peakColours(labels, PLOT_STYLE.peakColors, PLOT_STYLE.peakAlpha)
  const fillOf = (i: number) => o.fillTypes[colours[i]?.styleOf ?? i] ?? 'Solid Fill'
  const hatchOf = (i: number) => o.hatches[colours[i]?.styleOf ?? i] ?? '/'
  const curves = o.showFit ? (view.peaks ?? []) : []
  const unfitted = (i: number) => /^Unfitted|^D-parameter|^Fermi|^VBM|^Cut-Off|^SurveyID/.test(peaks[i]?.model ?? '')

  const inView = (t: number, lo: number, hi: number) => t >= lo - Math.abs(hi - lo) * 1e-9 && t <= hi + Math.abs(hi - lo) * 1e-9

  // ------------------------------------------------------------ mouse
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const inMain = (p: { x: number; y: number }) => p.x >= main.x0 && p.x <= main.x1 && p.y >= main.y0 && p.y <= main.y1
  const topOf = (i: number) => {
    const p = peaks[i]
    if (!p || !Number.isFinite(p.position) || !Number.isFinite(p.height)) return null
    if (drag?.kind === 'peak' && drag.peak === i) return { x: X(drag.x), y: Y(drag.y) }
    const b = valueAt(xs, bkg, p.position) ?? 0
    return { x: X(p.position), y: Y(p.height + b) }
  }
  /** PeakManipulation.get_peak_index_from_position: only the selected peak, within 100 px of its top. */
  const nearSelected = (p: { x: number; y: number }) => {
    if (selected === null || !curves[selected]) return -1
    const t = topOf(selected)
    if (!t) return -1
    return Math.hypot(t.x - p.x, t.y - p.y) < 100 ? selected : -1
  }
  // adaptive_threshold = max(some_threshold 0.1, 2 % of the data range), in binding energy
  const dataRange = (() => {
    let lo = Infinity
    let hi = -Infinity
    for (const x of xs) if (x !== null) {
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
    return hi > lo ? hi - lo : 0
  })()
  const lineThreshold = Math.max(0.1, dataRange * 0.02)

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const p = local(e)
    if (!inMain(p)) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (mode === 'zoom') return setDrag({ kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y })
    if (mode === 'drag') return setDrag({ kind: 'pan', px0: p.x, py0: p.y, l: limits })
    const bx = frame.iX(p.x)
    const by = frame.iY(p.y)
    const ctrl = e.ctrlKey || e.metaKey
    // BKG tab: Ctrl+drag moves both lines, Shift sets the offsets
    if ((interaction === 'bkg' || interaction === 'lines') && vlines && ctrl) {
      return setDrag({ kind: 'both', ref: bx, gap: vlines[1] - vlines[0], lo: vlines[0] })
    }
    if (interaction === 'bkg' && vlines && e.shiftKey) {
      props.onOffset?.(bx, by, false)
      return setDrag({ kind: 'offset' })
    }
    // Fitting tab, Shift: the selected peak's width
    if (interaction === 'peak' && e.shiftKey && selected !== null && nearSelected(p) >= 0) {
      props.onPeakWidth?.(selected, bx, 'start')
      return setDrag({ kind: 'width', peak: selected })
    }
    // the green line (works on every tab)
    if (greenLine !== null && Math.abs(greenLine - bx) <= lineThreshold) return setDrag({ kind: 'green' })
    if ((interaction === 'bkg' || interaction === 'lines') && vlines) {
      props.onSelect?.(null)
      const d0 = Math.abs(bx - vlines[0])
      const d1 = Math.abs(bx - vlines[1])
      const other = d0 < d1 ? vlines[1] : vlines[0]
      // Not near a line: the nearer one comes to the click
      if (Math.min(d0, d1) > lineThreshold) props.onVlines?.(Math.min(bx, other), Math.max(bx, other), false)
      return setDrag({ kind: 'vline', other })
    }
    if (interaction === 'peak') {
      const peak = nearSelected(p)
      if (peak >= 0) {
        setDrag({ kind: 'peak', peak, x: bx, y: by })
        props.onPeakDrag?.(peak, bx, by, 'start')
        return
      }
    }
    props.onSelect?.(null)
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = local(e)
    const inside = inMain(p) || (resid && p.x >= resid.x0 && p.x <= resid.x1 && p.y >= resid.y0 && p.y <= resid.y1)
    props.onCursor?.(inside ? { x: frame.iX(p.x), y: frame.iY(p.y) } : null)
    if (!drag) return
    const dx = frame.iX(p.x)
    const dy = frame.iY(p.y)
    if (drag.kind === 'peak') {
      setDrag({ ...drag, x: dx, y: dy })
      props.onPeakDrag?.(drag.peak, dx, dy, 'move')
    } else if (drag.kind === 'width') props.onPeakWidth?.(drag.peak, dx, 'move')
    else if (drag.kind === 'vline') props.onVlines?.(Math.min(dx, drag.other), Math.max(dx, drag.other), false)
    else if (drag.kind === 'both') {
      const lo = drag.lo + (dx - drag.ref)
      props.onVlines?.(Math.min(lo, lo + drag.gap), Math.max(lo, lo + drag.gap), false)
    } else if (drag.kind === 'offset') {
      if (inMain(p)) props.onOffset?.(dx, dy, false)
    } else if (drag.kind === 'green') props.onGreenLine?.(dx)
    else if (drag.kind === 'box') setDrag({ ...drag, x1: p.x, y1: p.y })
    else if (drag.kind === 'pan') {
      const l = drag.l
      const sx = (l.xmax - l.xmin) / (main.x1 - main.x0)
      const sy = (l.ymax - l.ymin) / (main.y1 - main.y0)
      const ddx = (p.x - drag.px0) * sx * (rev ? 1 : -1)
      const ddy = (p.y - drag.py0) * sy
      props.onLimits?.({ xmin: l.xmin + ddx, xmax: l.xmax + ddx, ymin: l.ymin + ddy, ymax: l.ymax + ddy })
    }
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const cur = drag
    setDrag(null)
    if (!cur) return
    const p = local(e)
    const dx = frame.iX(p.x)
    const dy = frame.iY(p.y)
    if (cur.kind === 'peak') props.onPeakDrag?.(cur.peak, dx, dy, 'end')
    else if (cur.kind === 'width') props.onPeakWidth?.(cur.peak, dx, 'end')
    else if (cur.kind === 'vline') props.onVlines?.(Math.min(dx, cur.other), Math.max(dx, cur.other), true)
    else if (cur.kind === 'both') {
      const lo = cur.lo + (dx - cur.ref)
      props.onVlines?.(Math.min(lo, lo + cur.gap), Math.max(lo, lo + cur.gap), true)
    }
    else if (cur.kind === 'offset') props.onOffset?.(dx, dy, true)
    else if (cur.kind === 'box') {
      // RectangleSelector(minspanx=5, minspany=5): smaller boxes are ignored and the tool stays on
      if (Math.abs(cur.x1 - cur.x0) < 5 || Math.abs(cur.y1 - cur.y0) < 5) return
      const a = frame.iX(cur.x0)
      const b = frame.iX(cur.x1)
      const c = frame.iY(cur.y0)
      const d = frame.iY(cur.y1)
      props.onLimits?.({ xmin: Math.min(a, b), xmax: Math.max(a, b), ymin: Math.min(c, d), ymax: Math.max(c, d) })
      props.onModeDone?.()
    } else if (cur.kind === 'pan') props.onModeDone?.()
  }

  // On_Mouse_Defs.on_mouse_wheel: only the selected peak's width (Fitting tab); nothing else.
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    if (interaction !== 'peak' || selected === null || !curves[selected]) return
    if (!inMain(local(e))) return
    props.onPeakWheel?.(selected, e.deltaY < 0)
  }

  const onContextMenu = (e: ReactMouseEvent<SVGSVGElement>) => {
    e.preventDefault()
    const p = local(e)
    props.onContextMenu?.(e, { x: frame.iX(p.x), y: frame.iY(p.y), peak: inMain(p) ? nearSelected(p) : -1 })
  }

  // ------------------------------------------------------------ drawing
  const clipMain = `kf-clip-main-${view.sheet.replace(/\W/g, '')}`
  const clipRes = `${clipMain}-r`
  const defs: ReactNode[] = []
  const fills: ReactNode[] = []
  const lines: ReactNode[] = []
  const lw = px(1)

  if (o.showFit) {
    curves.forEach((curve, i) => {
      if (!curve) return
      const c = colours[i]
      const ft = fillOf(i)
      if (unfitted(i)) {
        if (props.areaFills || props.dparam) return
        // Area measurement (no peak model): data above the background, alpha 0.5
        fills.push(<path key={`u${i}`} d={fillPath(xs, bkg, curve, X, Y)} fill={c.colour} fillOpacity={0.5} stroke="none" />)
        return
      }
      if (o.peakFill && ft === 'Solid Fill') fills.push(<path key={`f${i}`} d={fillPath(xs, bkg, curve, X, Y)} fill={c.colour} fillOpacity={c.alpha} stroke="none" />)
      else if (o.peakFill && ft === 'Hatch') {
        const id = `${clipMain}-h${i}`
        defs.push(hatchPattern(id, hatchOf(i), PLOT_STYLE.hatchDensity, c.colour, c.alpha))
        fills.push(<path key={`f${i}`} d={fillPath(xs, bkg, curve, X, Y)} fill={`url(#${id})`} stroke={c.colour} strokeOpacity={c.alpha} strokeWidth={lw} />)
      }
      const lineColour = o.peakFill ? PLOT_STYLE.peakLineColor : c.colour
      const lineAlpha = o.peakFill ? PLOT_STYLE.peakLineAlpha : Math.min(c.alpha + 0.1, 1)
      lines.push(<path key={`l${i}`} d={pathOf(xs, curve, X, Y)} fill="none" stroke={lineColour} strokeOpacity={lineAlpha} strokeWidth={lw} />)
    })
  }

  if (props.areaFills) {
    for (const f of props.areaFills.fills) {
      const c = colours[f.peak_index] ?? { colour: PLOT_STYLE.peakColors[f.peak_index % PLOT_STYLE.peakColors.length], alpha: 0.5 }
      fills.push(<path key={`a${f.peak_index}`} d={fillPath(f.x, f.bkg, f.y, X, Y)} fill={c.colour} fillOpacity={0.5} stroke="none" />)
    }
  }
  if (props.dparam) {
    lines.push(<path key="dparam" d={pathOf(props.dparam.x, props.dparam.y, X, Y)} fill="none" stroke={props.dparam.color_after_calculate ?? 'red'} strokeWidth={lw} />)
  }

  // Legend entries (update_legend)
  const handleBox = (i: number) => {
    const c = colours[i]
    const ft = fillOf(i)
    if (!o.peakFill) return { kind: 'line' as const, colour: c.colour, alpha: Math.min(c.alpha + 0.1, 1) }
    if (ft === 'Hatch') return { kind: 'hatch' as const, colour: c.colour, alpha: c.alpha, i }
    if (ft === 'None') return { kind: 'line' as const, colour: PLOT_STYLE.peakLineColor, alpha: PLOT_STYLE.peakLineAlpha }
    return { kind: 'solid' as const, colour: c.colour, alpha: unfitted(i) ? 0.5 : c.alpha }
  }
  const legendEntries: { text: string; h: ReturnType<typeof handleBox> | { kind: 'dots' | 'dash' | 'env' } }[] = []
  if (o.legend && o.showFit && !hide.has('legend')) {
    const shown = legendPeaks(labels, view.sheet).filter((e) => curves[e.index])
    if (o.legend === 1) {
      // The desktop labels the raw data only on the dot plots: a survey's line has no legend entry.
      if (!lineScan) legendEntries.push({ text: 'Raw Data', h: { kind: 'dots' } })
      if (view.background?.type) legendEntries.push({ text: 'Background', h: { kind: 'dash' } })
      if (view.envelope) legendEntries.push({ text: 'Overall Fit', h: { kind: 'env' } })
      for (const e of shown) legendEntries.push({ text: labels[e.index].replace(/(\d+\/\d+)/g, '$_{$1}$'), h: handleBox(e.index) })
    } else for (const e of shown) legendEntries.push({ text: e.text, h: handleBox(e.index) })
  }

  const bkgShown = !!view.background?.type && bkg.length > 0 && !hide.has('background')
  const dataR = Math.sqrt(PLOT_STYLE.scatterSize) * PT / 2 + px(0.5)
  let dots = ''
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]
    const y = ys[i]
    if (x === null || y === null) continue
    const cx = X(x)
    const cy = Y(y)
    dots += `M${(cx - dataR).toFixed(2)} ${cy.toFixed(2)}a${dataR.toFixed(2)} ${dataR.toFixed(2)} 0 1 0 ${(2 * dataR).toFixed(2)} 0a${dataR.toFixed(2)} ${dataR.toFixed(2)} 0 1 0 ${(-2 * dataR).toFixed(2)} 0`
  }

  // Residuals on the main plot (state 1)
  let residOnMain: ReactNode = null
  let yLabel = o.yAxis === 2 ? 'Intensity (a.u.)' : 'Intensity (CPS)'
  if (o.showFit && o.residuals === 1 && view.residuals && !hide.has('residuals')) {
    const yv = ys.filter((v): v is number => v !== null)
    const maxY = Math.max(...yv)
    const minY = Math.min(...yv)
    const maxR = Math.max(...view.residuals.map((v) => (v === null ? 0 : Math.abs(v))))
    const k = maxR ? (0.05 * (maxY - minY)) / maxR : 1
    const base = 1.07 * maxY
    residOnMain = (
      <g>
        <line x1={main.x0} x2={main.x1} y1={Y(base)} y2={Y(base)} stroke="grey" strokeOpacity={0.1} strokeDasharray={`${px(6.4)} ${px(1.6)} ${px(1)} ${px(1.6)}`} strokeWidth={lw} />
        <path d={pathOf(xs, view.residuals.map((v) => (v === null ? null : v * k + base)), X, Y)} fill="none" stroke={PLOT_STYLE.residualColor} strokeOpacity={PLOT_STYLE.residualAlpha} strokeWidth={lw} />
      </g>
    )
    if (o.yAxis !== 2) yLabel = `Intensity (CPS), residual x ${k.toFixed(2)}`
  }

  // MyFrame.add_averaging_indicator_lines (BKG tab): at each red line, two red
  // marks bracketing the Averaging Points and a grey one at their centre, on the background.
  let averaging: ReactNode = null
  if (interaction === 'bkg' && vlines && props.averagingPoints && xs.length) {
    const n = Math.max(1, Math.round(props.averagingPoints))
    const ext = 0.1 * (limits.ymax - limits.ymin)
    const by = (i: number) => bkg[i] ?? ys[i] ?? 0
    const nearest = (v: number) => {
      let best = 0
      let bd = Infinity
      xs.forEach((x, i) => {
        if (x !== null && Math.abs(x - v) < bd) {
          bd = Math.abs(x - v)
          best = i
        }
      })
      return best
    }
    const marks: ReactNode[] = []
    const lo = Math.min(...vlines)
    const hi = Math.max(...vlines)
    for (const v of vlines) {
      const vr = Math.round(v * 100) / 100
      const idx = nearest(vr)
      const high = vr > lo + (hi - lo) / 2
      const i2 = high ? Math.max(0, idx + n - 1) : Math.min(xs.length - 1, idx - n + 1)
      const j2 = Math.max(0, Math.min(xs.length - 1, i2))
      const c = Math.floor((idx + j2) / 2)
      for (const [i, colour] of [[idx, 'red'], [j2, 'red'], [c, 'grey']] as const) {
        const x = xs[i]
        if (x === null) continue
        marks.push(<line key={`av${marks.length}`} x1={X(x)} x2={X(x)} y1={Y(by(i) - ext)} y2={Y(by(i) + ext)} stroke={colour} strokeOpacity={0.5} strokeWidth={px(0.5)} strokeDasharray={DASH(0.5)} />)
      }
    }
    averaging = <g pointerEvents="none">{marks}</g>
  }

  // Selected peak: the blue × with its letter and note (add_cross_to_peak)
  let cross: ReactNode = null
  if (selected !== null && curves[selected] && peaks[selected]) {
    const t = topOf(selected)
    if (t) {
      const s = px(15) / 2
      const p = peaks[selected]
      const yOff = Math.abs(Y(limits.ymax * 0.02) - Y(0))
      const fw = drag?.kind === 'peak' ? null : measuredFwhm(xs, curves[selected]!, bkg)
      const areaCell = view.grid[selected * 2]?.[6] ?? ''
      cross = (
        <g pointerEvents="none">
          <path d={`M${t.x - s} ${t.y - s}L${t.x + s} ${t.y + s}M${t.x - s} ${t.y + s}L${t.x + s} ${t.y - s}`} stroke="blue" strokeWidth={px(1)} />
          <text x={t.x} y={t.y - yOff} fontSize={px(12 + o.fontDelta)} textAnchor="middle" fontFamily={FONT}>
            {p.letter}
          </text>
          {fw !== null && (
            <text x={X(p.position - fw / 2)} y={t.y - yOff} fontSize={px(8)} fill="grey" fontFamily={FONT}>
              {[`Model: ${p.model}`, `Position: ${Number(view.grid[selected * 2]?.[2] ?? 0)} eV`, `FWHM meas.: ${fw.toFixed(3)} eV`, `Area: ${areaCell} CPS`, '', '\u00BF Change width ?', 'Scroll the wheel'].map((line, k) => (
                <tspan key={k} x={X(p.position - fw / 2)} dy={k ? px(8) * 1.2 : px(8)}>
                  {line}
                </tspan>
              ))}
            </text>
          )}
        </g>
      )
    }
  }

  // ------------------------------------------------------------ axes art
  const tickLen = px(3.5)
  const minorLen = px(2)
  const tickW = px(0.8)
  const minorW = px(0.6)
  const tickFont = px(fs.tick)
  const axisFont = px(fs.title)
  const showXOnMain = !resid

  const xAxis = (b: Box, labelsOn: boolean, pad: number) => (
    <g>
      {xMinor.filter((t) => inView(t, xr[0], xr[1])).map((t, k) => (
        <line key={`m${k}`} x1={X(t)} x2={X(t)} y1={b.y1} y2={b.y1 + minorLen} stroke="black" strokeWidth={minorW} />
      ))}
      {xTicks.map((t, k) =>
        inView(t, xr[0], xr[1]) ? (
          <g key={k}>
            <line x1={X(t)} x2={X(t)} y1={b.y1} y2={b.y1 + tickLen} stroke="black" strokeWidth={tickW} />
            {labelsOn && (
              <text x={X(t)} y={b.y1 + tickLen + px(pad) + tickFont * 0.78} fontSize={tickFont} textAnchor="middle" fontFamily={FONT}>
                {xFmt.labels[k]}
              </text>
            )}
          </g>
        ) : null,
      )}
      {labelsOn && (
        <text x={(b.x0 + b.x1) / 2} y={b.y1 + tickLen + px(pad) + tickFont + px(4) + axisFont * 0.8} fontSize={axisFont} textAnchor="middle" fontFamily={FONT}>
          {xLabel(view.sheet)}
        </text>
      )}
    </g>
  )

  const offsetText = (order: number, b: Box, size: number) =>
    order ? (
      <text x={b.x0} y={b.y0 - px(3)} fontSize={size} fontFamily={FONT}>
        ×10<tspan fontSize={size * 0.7} dy={-size * 0.38}>{String(order).replace('-', '−')}</tspan>
      </text>
    ) : null

  const yTickLabelWidth = Math.max(0, ...yFmt.labels.map((l) => textWidth(l, tickFont)))
  const yAxis = (
    <g>
      {o.yAxis !== 1 &&
        yMinor.filter((t) => inView(t, limits.ymin, limits.ymax)).map((t, k) => (
          <line key={`m${k}`} x1={main.x0 - minorLen} x2={main.x0} y1={Y(t)} y2={Y(t)} stroke="black" strokeWidth={minorW} />
        ))}
      {o.yAxis !== 1 &&
        yTicks.map((t, k) =>
          inView(t, limits.ymin, limits.ymax) ? (
            <g key={k}>
              <line x1={main.x0 - tickLen} x2={main.x0} y1={Y(t)} y2={Y(t)} stroke="black" strokeWidth={tickW} />
              {o.yAxis === 0 && (
                <text x={main.x0 - tickLen - px(3.5)} y={Y(t) + tickFont * 0.35} fontSize={tickFont} textAnchor="end" fontFamily={FONT}>
                  {yFmt.labels[k]}
                </text>
              )}
            </g>
          ) : null,
        )}
      {o.yAxis === 0 && offsetText(yFmt.order, main, tickFont)}
      {o.yAxis !== 1 && (
        <text
          transform={`translate(${main.x0 - tickLen - px(3.5) - (o.yAxis === 0 ? yTickLabelWidth : 0) - px(4)} ${(main.y0 + main.y1) / 2}) rotate(-90)`}
          fontSize={axisFont}
          textAnchor="middle"
          fontFamily={FONT}
        >
          {yLabel}
        </text>
      )}
    </g>
  )

  // Residual strip (setup_residual_subplot)
  let residArt: ReactNode = null
  if (resid && frame.R && frame.rlim && rFmt && view.residuals) {
    const R = frame.R
    const [r0, r1] = frame.rlim
    const rLabelW = Math.max(0, ...rFmt.labels.map((l) => textWidth(l, tickFont)))
    residArt = (
      <g>
        <g clipPath={`url(#${clipRes})`}>
          {/* grid(True, alpha=0.8) */}
          {xTicks.filter((t) => inView(t, xr[0], xr[1])).map((t, k) => (
            <line key={`gx${k}`} x1={X(t)} x2={X(t)} y1={resid.y0} y2={resid.y1} stroke="#b0b0b0" strokeOpacity={0.8} strokeWidth={px(0.8)} />
          ))}
          {rTicks.filter((t) => inView(t, r0, r1)).map((t, k) => (
            <line key={`gy${k}`} x1={resid.x0} x2={resid.x1} y1={R(t)} y2={R(t)} stroke="#b0b0b0" strokeOpacity={0.8} strokeWidth={px(0.8)} />
          ))}
          <path d={pathOf(xs, view.residuals, X, R)} fill="none" stroke={PLOT_STYLE.residualColor} strokeOpacity={PLOT_STYLE.residualAlpha} strokeWidth={lw} />
        </g>
        <rect x={resid.x0} y={resid.y0} width={resid.x1 - resid.x0} height={resid.y1 - resid.y0} fill="none" stroke="black" strokeWidth={px(1)} />
        {o.yAxis !== 1 &&
          rTicks.map((t, k) =>
            inView(t, r0, r1) ? (
              <g key={k}>
                <line x1={resid.x0 - tickLen} x2={resid.x0} y1={R(t)} y2={R(t)} stroke="black" strokeWidth={tickW} />
                {o.yAxis === 0 && (
                  <text x={resid.x0 - tickLen - px(3.5)} y={R(t) + tickFont * 0.35} fontSize={tickFont} textAnchor="end" fontFamily={FONT}>
                    {rFmt.labels[k]}
                  </text>
                )}
              </g>
            ) : null,
          )}
        {o.yAxis === 0 && offsetText(rFmt.order, resid, tickFont)}
        {o.yAxis !== 1 && (
          <text
            transform={`translate(${resid.x0 - tickLen - px(3.5) - (o.yAxis === 0 ? rLabelW : 0) - px(4)} ${(resid.y0 + resid.y1) / 2}) rotate(-90)`}
            fontSize={axisFont}
            textAnchor="middle"
            fontFamily={FONT}
          >
            Res.
          </text>
        )}
        {xAxis(resid, true, 8)}
        {props.chi !== undefined && props.chi !== null && (
          <text x={X(limits.xmin + (rev ? 0.2 : -0.4))} y={(resid.y0 + resid.y1) / 2 + px(9) * 0.35} fontSize={px(9)} textAnchor="end" fontFamily={FONT}>
            χ: {props.chi.toFixed(2)}
          </text>
        )}
      </g>
    )
  }

  // Legend (loc='upper left', fancybox, framealpha 0.1, edgecolor gray)
  let legend: ReactNode = null
  if (legendEntries.length) {
    const F = px(fs.legend)
    const pad = 0.4 * F
    const hl = 2 * F
    const hh = 0.7 * F
    const gap = 0.8 * F
    const row = F * 1.2
    const spacing = 0.5 * F
    const tw = Math.max(...legendEntries.map((e) => mathPieces(e.text).reduce((s, p) => s + textWidth(p.text, p.sub ? F * 0.7 : F), 0)))
    const bx = main.x0 + 0.5 * F
    const by = main.y0 + 0.5 * F
    const bw = pad * 2 + hl + gap + tw
    const bh = pad * 2 + legendEntries.length * row + (legendEntries.length - 1) * spacing
    legend = (
      <g>
        <rect x={bx} y={by} width={bw} height={bh} rx={0.2 * F} fill="white" fillOpacity={0.1} stroke="gray" strokeOpacity={0.1} strokeWidth={px(1)} />
        {legendEntries.map((e, k) => {
          const cy = by + pad + k * (row + spacing) + row / 2
          const hx = bx + pad
          const h = e.h
          let handle: ReactNode
          if (h.kind === 'solid') handle = <rect x={hx} y={cy - hh / 2} width={hl} height={hh} fill={h.colour} fillOpacity={h.alpha} />
          else if (h.kind === 'hatch') {
            const id = `${clipMain}-lh${k}`
            defs.push(hatchPattern(id, hatchOf(h.i), PLOT_STYLE.hatchDensity, h.colour, h.alpha))
            handle = <rect x={hx} y={cy - hh / 2} width={hl} height={hh} fill={`url(#${id})`} stroke={h.colour} strokeOpacity={h.alpha} strokeWidth={lw} />
          } else if (h.kind === 'line') handle = <line x1={hx} x2={hx + hl} y1={cy} y2={cy} stroke={h.colour} strokeOpacity={h.alpha} strokeWidth={lw} />
          else if (h.kind === 'dots') handle = <circle cx={hx + hl / 2} cy={cy} r={dataR} fill="black" />
          else if (h.kind === 'dash')
            handle = <line x1={hx} x2={hx + hl} y1={cy} y2={cy} stroke={PLOT_STYLE.backgroundColor} strokeOpacity={PLOT_STYLE.backgroundAlpha} strokeDasharray={DASH(1)} strokeWidth={lw} />
          else handle = <line x1={hx} x2={hx + hl} y1={cy} y2={cy} stroke={PLOT_STYLE.envelopeColor} strokeOpacity={PLOT_STYLE.envelopeAlpha} strokeWidth={lw} />
          return (
            <g key={k}>
              {handle}
              <text x={hx + hl + gap} y={cy + F * 0.33} fontSize={F} fontFamily={FONT}>
                {mathPieces(e.text).map((p, j) =>
                  p.sub ? (
                    <tspan key={j} fontSize={F * 0.7} dy={F * 0.2}>
                      {p.text}
                    </tspan>
                  ) : (
                    <tspan key={j} dy={j && mathPieces(e.text)[j - 1].sub ? -F * 0.2 : 0}>
                      {p.text}
                    </tspan>
                  ),
                )}
              </text>
            </g>
          )
        })}
      </g>
    )
  }

  // Fit results box (toggle_fitting_results)
  let fitBox: ReactNode = null
  if (o.fitResults && view.fit && view.fit.r2 !== null) {
    const F = px(9 + o.fontDelta)
    const linesTxt = [`R²: ${view.fit.r2.toFixed(5)}`, `χ: ${(props.chi ?? view.fit.rsd ?? 0).toFixed(2)}`, `Red. χ²: ${view.fit.redChi2.toFixed(2)}`]
    fitBox = (
      <text x={main.x1 - 0.02 * (main.x1 - main.x0)} y={main.y0 + 0.02 * (main.y1 - main.y0) + px(fs.core) * 1.3 + F} fontSize={F} textAnchor="end" fontFamily={FONT}>
        {linesTxt.map((l, k) => (
          <tspan key={k} x={main.x1 - 0.02 * (main.x1 - main.x0)} dy={k ? F * 1.2 : 0}>
            {l}
          </tspan>
        ))}
      </text>
    )
  }

  const cursor = mode === 'zoom' ? 'crosshair' : mode === 'drag' ? 'pointer' : 'default'
  const W = size.w
  const H = size.h

  return (
    <div className="kf-plot" ref={wrapRef}>
      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => !drag && props.onCursor?.(null)}
        onWheel={onWheel}
        onDoubleClick={(e) => inMain(local(e)) && props.onDoubleClick?.()}
        onContextMenu={onContextMenu}
      >
        <defs>
          <clipPath id={clipMain}>
            <rect x={main.x0} y={main.y0} width={main.x1 - main.x0} height={main.y1 - main.y0} />
          </clipPath>
          {resid && (
            <clipPath id={clipRes}>
              <rect x={resid.x0} y={resid.y0} width={resid.x1 - resid.x0} height={resid.y1 - resid.y0} />
            </clipPath>
          )}
          {defs}
        </defs>
        <rect x={0} y={0} width={W} height={H} fill="white" />
        <g clipPath={`url(#${clipMain})`}>
          {props.logo && (
            <g opacity={0.07} style={{ opacity: 0.07 }}>
              <image href={props.logo} x={main.x0} y={main.y0} width={main.x1 - main.x0} height={main.y1 - main.y0} preserveAspectRatio="none" />
            </g>
          )}
          {fills}
          {lines}
          {bkgShown && (
            <path d={pathOf(xs, bkg, X, Y)} fill="none" stroke={PLOT_STYLE.backgroundColor} strokeOpacity={PLOT_STYLE.backgroundAlpha} strokeWidth={lw} strokeDasharray={DASH(1)} />
          )}
          {lineScan ? (
            // the survey's raw data: a black line, 1 pt, alpha 0.7 (line_width, line_alpha)
            <path d={pathOf(xs, ys, X, Y)} fill="none" stroke={PLOT_STYLE.scatterColor} strokeOpacity={0.7} strokeWidth={lw} />
          ) : (
            <path d={dots} fill={PLOT_STYLE.scatterColor} />
          )}
          {o.showFit && view.envelope && !hide.has('envelope') && (
            <path d={pathOf(xs, view.envelope, X, Y)} fill="none" stroke={PLOT_STYLE.envelopeColor} strokeOpacity={PLOT_STYLE.envelopeAlpha} strokeWidth={lw} />
          )}
          {residOnMain}
          {vlines && mode === 'none' && averaging}
          {vlines && mode === 'none' &&
            vlines.map((v, k) => {
              // add_vline_text_labels: grey 10 pt in a white rounded box, high BE at 90 % of the height, low BE at 80 %
              const ty = Y(limits.ymin + (k === 1 ? 0.9 : 0.8) * (limits.ymax - limits.ymin))
              const t = v.toFixed(2)
              const tw = textWidth(t, px(10)) + px(4)
              return (
                <g key={`v${k}`}>
                  <line x1={X(v)} x2={X(v)} y1={main.y0} y2={main.y1} stroke="red" strokeOpacity={0.7} strokeWidth={lw} strokeDasharray={DASH(1)} />
                  <rect x={X(v) - tw / 2} y={ty - px(10) * 0.65} width={tw} height={px(10) * 1.3} rx={px(2)} fill="white" fillOpacity={0.8} stroke="black" strokeOpacity={0.8} strokeWidth={px(0.5)} />
                  <text x={X(v)} y={ty + px(10) * 0.35} fontSize={px(10)} fill="grey" textAnchor="middle" fontFamily={FONT}>
                    {t}
                  </text>
                </g>
              )
            })}
          {greenLine !== null && (
            <g>
              <line x1={X(greenLine)} x2={X(greenLine)} y1={main.y0} y2={main.y1} stroke="green" strokeOpacity={0.7} strokeWidth={lw} />
              <rect
                x={X(greenLine) - textWidth(greenLine.toFixed(2), px(10)) / 2 - px(2)}
                y={main.y0 + 0.05 * (main.y1 - main.y0)}
                width={textWidth(greenLine.toFixed(2), px(10)) + px(4)}
                height={px(10) * 1.25}
                rx={px(2)}
                fill="lightgreen"
                fillOpacity={0.8}
                stroke="black"
                strokeOpacity={0.8}
                strokeWidth={px(0.5)}
              />
              <text x={X(greenLine)} y={main.y0 + 0.05 * (main.y1 - main.y0) + px(10)} fontSize={px(10)} fill="darkgreen" textAnchor="middle" fontFamily={FONT}>
                {greenLine.toFixed(2)}
              </text>
            </g>
          )}
          {(props.idLines ?? []).map((l, k) => {
            const h = l.frac * (main.y1 - main.y0)
            return (
              <g key={`id${k}`}>
                <line x1={X(l.x)} x2={X(l.x)} y1={main.y1 + h} y2={main.y1 - h} stroke="blue" strokeWidth={lw} />
                <text transform={`translate(${X(l.x + (rev ? 0.1 : -0.1))} ${main.y1 - 0.01 * (main.y1 - main.y0)}) rotate(-90)`} fontSize={px(7)} fontFamily={FONT}>
                  {mathPieces(l.text).map((p, j) => (p.sub ? <tspan key={j} fontSize={px(5)} dy={px(1.5)}>{p.text}</tspan> : <tspan key={j}>{p.text}</tspan>))}
                </text>
              </g>
            )
          })}
          {(props.labels ?? []).map((l, k) => {
            const lx = X(l.x)
            const ly = l.y !== null && l.y !== undefined ? Y(l.y) : main.y0 + 0.1 * (main.y1 - main.y0)
            const fsz = px((l.fontsize ?? 10) + o.fontDelta)
            return (
              <text key={`lb${k}`} transform={`translate(${lx} ${ly}) rotate(${-(l.rotation ?? 0)})`} fontSize={fsz} textAnchor={l.rotation ? 'start' : 'middle'} fontFamily={FONT}>
                {mathPieces(l.text).map((p, j) => (p.sub ? <tspan key={j} fontSize={fsz * 0.7} dy={fsz * 0.2}>{p.text}</tspan> : <tspan key={j} dy={j && mathPieces(l.text)[j - 1].sub ? -fsz * 0.2 : 0}>{p.text}</tspan>))}
              </text>
            )
          })}
          {cross}
          {drag?.kind === 'box' && (
            <rect
              x={Math.min(drag.x0, drag.x1)}
              y={Math.min(drag.y0, drag.y1)}
              width={Math.abs(drag.x1 - drag.x0)}
              height={Math.abs(drag.y1 - drag.y0)}
              fill="green"
              fillOpacity={0.3}
              stroke="green"
              strokeOpacity={0.3}
            />
          )}
        </g>
        <rect x={main.x0} y={main.y0} width={main.x1 - main.x0} height={main.y1 - main.y0} fill="none" stroke="black" strokeWidth={px(1)} />
        {showXOnMain && xAxis(main, true, 3.5)}
        {yAxis}
        {view.sheet && (
          <text x={main.x1 - 0.02 * (main.x1 - main.x0)} y={main.y0 + 0.02 * (main.y1 - main.y0) + px(fs.core) * 0.92} fontSize={px(fs.core)} fontWeight="bold" textAnchor="end" fontFamily={FONT}>
            {formatSheetName(view.sheet)}
          </text>
        )}
        {legend}
        {fitBox}
        {residArt}
      </svg>
    </div>
  )
}
