// A recorded matplotlib figure (types.ts Fig), drawn as matplotlib draws it:
// the main axes and its twins with their outward right spines (TGA's mass and
// DSC axes), lines, scatters, fills, texts, annotations, arrows (the Label
// Manager's step labels), tables (the TGA companion tables), legends, ticks
// and ×10ⁿ labels from KherveFitting's tick code. SVG, so it also renders in
// Node for tests.
//
// Mouse on the main axes, as the desktop main plot (On_Mouse_Defs) in a
// technique mode: with a range window open (rangeActive) a press grabs the
// nearer red line and drags it; the Zoom In tool draws one green box; the
// Drag tool pans once; the green line drags anywhere near it; double-click
// opens Plot Limits; right-click the plot's menu; moving reports the cursor.

import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PLOT_STYLE } from '../khervefitting/mpl'
import { textWidth } from '../khervefitting/Plot'
import { axesBox, axisTicks, dashArray, legendPlace, limitsOf, mainAxes, makeScale, mathRuns, nearestLine, px, zOf, type Box, type Scale } from './figmath'
import type { Arrays, ArtistJ, AxesJ, Fig, LegendJ } from './types'

export interface Limits {
  xmin: number
  xmax: number
  ymin: number
  ymax: number
}

export type PlotMode = 'none' | 'zoom' | 'drag'

export interface FigurePlotProps {
  fig: Fig | null
  arrays: Arrays
  /** The user's zoom of the main axes (null: the figure's own limits). */
  limits?: Limits | null
  /** The red range lines (vline1 / vline2) and whether a tool window drives them. */
  vlines?: Record<string, number>
  rangeActive?: boolean
  greenLine?: number | null
  mode?: PlotMode
  /** Extra font size (A+ / A−). */
  fontDelta?: number
  /** Static (the companion canvas): no mouse except double-click. */
  still?: boolean
  size?: { w: number; h: number }
  onLimits?: (l: Limits) => void
  onModeDone?: () => void
  onCursor?: (at: { x: number; y: number } | null) => void
  onVline?: (which: number, x: number, final: boolean) => void
  onGreenLine?: (x: number) => void
  onDoubleClick?: () => void
  onContextMenu?: (e: ReactMouseEvent, at: { x: number; y: number }) => void
}

const FONT = PLOT_STYLE.font
const TICK_LEN = px(3.5)
const MINOR_LEN = px(2)

function data(arrays: Arrays, ref: string | number | null | undefined): (number | null)[] {
  if (typeof ref !== 'string') return []
  return arrays.get(ref) ?? []
}

function pathOf(xs: (number | null)[], ys: (number | null)[], X: (v: number) => number, Y: (v: number) => number, steps?: string): string {
  let d = ''
  let on = false
  let px0 = 0
  let py0 = 0
  const n = Math.min(xs.length, ys.length)
  for (let i = 0; i < n; i++) {
    const x = xs[i]
    const y = ys[i]
    if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) {
      on = false
      continue
    }
    const sx = X(x)
    const sy = Y(y)
    if (on && steps === 'steps-pre') d += `L${px0.toFixed(2)} ${sy.toFixed(2)}`
    else if (on && steps === 'steps-post') d += `L${sx.toFixed(2)} ${py0.toFixed(2)}`
    d += `${on ? 'L' : 'M'}${sx.toFixed(2)} ${sy.toFixed(2)}`
    px0 = sx
    py0 = sy
    on = true
  }
  return d
}

function fillPath(xs: (number | null)[], lo: (number | null)[], hi: (number | null)[], X: (v: number) => number, Y: (v: number) => number, horizontal = false): string {
  let d = ''
  let run: number[] = []
  const P = (a: number, b: number) => (horizontal ? `${X(b).toFixed(2)} ${Y(a).toFixed(2)}` : `${X(a).toFixed(2)} ${Y(b).toFixed(2)}`)
  const flush = () => {
    if (run.length > 1) {
      d += run.map((i, k) => `${k ? 'L' : 'M'}${P(xs[i]!, hi[i]!)}`).join('')
      for (let k = run.length - 1; k >= 0; k--) d += `L${P(xs[run[k]]!, lo[run[k]]!)}`
      d += 'Z'
    }
    run = []
  }
  for (let i = 0; i < xs.length; i++) {
    const ok = xs[i] !== null && hi[i] !== null && lo[i] !== null && hi[i] !== undefined && lo[i] !== undefined && Number.isFinite(hi[i]!) && Number.isFinite(lo[i]!)
    if (ok) run.push(i)
    else flush()
  }
  flush()
  return d
}

/** Text with mathtext runs as tspans. */
type Baseline = 'alphabetic' | 'hanging' | 'middle' | 'central' | 'text-after-edge' | 'text-before-edge' | 'auto'

export function MText({ text, x, y, size, color, anchor = 'start', baseline, rotate, bold, italic, family }: { text: string; x: number; y: number; size: number; color?: string | null; anchor?: 'start' | 'middle' | 'end'; baseline?: Baseline; rotate?: number; bold?: boolean; italic?: boolean; family?: string }) {
  const runs = mathRuns(text)
  const lines = runs.length === 1 && runs[0].t.includes('\n') && !runs[0].s ? runs[0].t.split('\n') : null
  const common = {
    x, y, fontSize: size, fill: color ?? 'black', textAnchor: anchor, dominantBaseline: baseline, fontFamily: family ? `${family}, ${FONT}` : FONT,
    fontWeight: bold ? 'bold' : undefined, fontStyle: italic ? 'italic' : undefined,
    transform: rotate ? `rotate(${-rotate} ${x} ${y})` : undefined, style: { whiteSpace: 'pre' as const },
  }
  if (lines) {
    const lh = size * 1.2
    const off = baseline === 'hanging' || baseline === 'text-before-edge' ? 0 : baseline === 'middle' || baseline === 'central' ? -((lines.length - 1) * lh) / 2 : -(lines.length - 1) * lh
    return (
      <text {...common}>
        {lines.map((l, i) => (
          <tspan key={i} x={x} dy={i === 0 ? off : lh}>
            {l}
          </tspan>
        ))}
      </text>
    )
  }
  return (
    <text {...common}>
      {runs.map((r, i) => (
        <tspan key={i} baselineShift={r.s === 'sup' ? 'super' : r.s === 'sub' ? 'sub' : undefined} fontSize={r.s ? size * 0.7 : undefined} fontStyle={r.italic ? 'italic' : undefined}>
          {r.t}
        </tspan>
      ))}
    </text>
  )
}

const anchorOf = (ha?: string): 'start' | 'middle' | 'end' => (ha === 'center' || ha === 'centre' ? 'middle' : ha === 'right' ? 'end' : 'start')
const baselineOf = (va?: string): Baseline => (va === 'top' ? 'text-before-edge' : va === 'center' || va === 'center_baseline' ? 'central' : va === 'bottom' ? 'text-after-edge' : 'alphabetic')

function markerShape(m: string, cx: number, cy: number, r: number, fill: string, stroke: string, key: string | number): ReactNode {
  switch (m) {
    case '+':
      return <path key={key} d={`M${cx - r} ${cy}H${cx + r}M${cx} ${cy - r}V${cy + r}`} stroke={stroke} strokeWidth={px(1)} fill="none" />
    case 'x':
      return <path key={key} d={`M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx - r} ${cy + r}L${cx + r} ${cy - r}`} stroke={stroke} strokeWidth={px(1)} fill="none" />
    case 's':
      return <rect key={key} x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={fill} stroke={stroke} strokeWidth={0.5} />
    case '^':
      return <path key={key} d={`M${cx} ${cy - r}L${cx + r} ${cy + r}L${cx - r} ${cy + r}Z`} fill={fill} stroke={stroke} strokeWidth={0.5} />
    case 'v':
      return <path key={key} d={`M${cx} ${cy + r}L${cx + r} ${cy - r}L${cx - r} ${cy - r}Z`} fill={fill} stroke={stroke} strokeWidth={0.5} />
    case 'D':
    case 'd':
      return <path key={key} d={`M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`} fill={fill} stroke={stroke} strokeWidth={0.5} />
    default:
      return <circle key={key} cx={cx} cy={cy} r={m === '.' ? r * 0.5 : r} fill={fill} stroke={stroke} strokeWidth={0.5} />
  }
}

interface AxesGeo {
  ax: AxesJ
  box: Box
  X: Scale
  Y: Scale
}

/** Arrow heads of a FancyArrowPatch arrowstyle ('-|>', '<|-|>', '->', '<->'). */
function arrowPath(a: [number, number], b: [number, number], style: string, scale: number, colour: string, lw: number, key: string | number, dash?: string): ReactNode {
  const [x0, y0] = a
  const [x1, y1] = b
  const len = Math.hypot(x1 - x0, y1 - y0) || 1
  const ux = (x1 - x0) / len
  const uy = (y1 - y0) / len
  const hl = px(0.4 * scale)
  const hw = px(0.2 * scale)
  const head = (x: number, y: number, dx: number, dy: number, filled: boolean) => {
    const bx = x - dx * hl
    const by = y - dy * hl
    const p1 = `${bx - dy * hw} ${by + dx * hw}`
    const p2 = `${bx + dy * hw} ${by - dx * hw}`
    return filled ? <path d={`M${x} ${y}L${p1}L${p2}Z`} fill={colour} stroke={colour} strokeWidth={0.5} /> : <path d={`M${p1}L${x} ${y}L${p2}`} fill="none" stroke={colour} strokeWidth={lw} />
  }
  const end = style.endsWith('|>') || style.endsWith('>')
  const start = style.startsWith('<|') || style.startsWith('<')
  const filled = style.includes('|')
  return (
    <g key={key}>
      <line x1={x0 + (start && filled ? ux * hl * 0.8 : 0)} y1={y0 + (start && filled ? uy * hl * 0.8 : 0)} x2={x1 - (end && filled ? ux * hl * 0.8 : 0)} y2={y1 - (end && filled ? uy * hl * 0.8 : 0)} stroke={colour} strokeWidth={lw} strokeDasharray={dash} />
      {end && head(x1, y1, ux, uy, filled)}
      {start && head(x0, y0, -ux, -uy, filled)}
    </g>
  )
}

function legendNode(lg: LegendJ, box: Box, sizePt: number, key: string): ReactNode {
  const fs = px(lg.fontsize ?? sizePt)
  const items = lg.items.filter((i) => i.label && !i.label.startsWith('_'))
  if (!items.length) return null
  const handleW = 2 * fs
  const pad = 0.4 * fs
  const rowH = fs * 1.2 + 0.5 * fs
  const w = pad * 2 + handleW + 0.8 * fs + Math.max(...items.map((i) => textWidth(i.label.replace(/\$/g, ''), fs)))
  const h = pad * 2 + items.length * rowH - 0.5 * fs + (lg.title ? rowH : 0)
  const at = legendPlace(lg.loc, box, w, h, fs)
  return (
    <g key={key}>
      {lg.frameon && <rect x={at.x} y={at.y} width={w} height={h} rx={0.2 * fs} fill="white" fillOpacity={lg.framealpha} stroke={lg.edgecolor ?? '#cccccc'} strokeOpacity={lg.framealpha < 0.3 ? 0.6 : 1} strokeWidth={px(0.8)} />}
      {items.map((it, i) => {
        const cy = at.y + pad + (lg.title ? rowH : 0) + i * rowH + fs * 0.6
        const hx = at.x + pad
        let handle: ReactNode = null
        if (it.h === 'line') handle = (
          <g>
            <line x1={hx} x2={hx + handleW} y1={cy} y2={cy} stroke={it.color ?? 'black'} strokeWidth={px(it.lw ?? 1)} strokeOpacity={it.alpha ?? 1} strokeDasharray={dashArray(it.ls, it.lw ?? 1)} />
            {it.marker && markerShape(it.marker, hx + handleW / 2, cy, px(3), it.color ?? 'black', it.color ?? 'black', 'm')}
          </g>
        )
        else if (it.h === 'scatter') handle = markerShape(it.marker ?? 'o', hx + handleW / 2, cy, px(2.5), it.color ?? 'black', it.color ?? 'black', 's')
        else if (it.h === 'patch') handle = <rect x={hx} y={cy - fs * 0.35} width={handleW} height={fs * 0.7} fill={it.color ?? '#1f77b4'} fillOpacity={it.alpha ?? 1} />
        return (
          <g key={i}>
            {handle}
            <MText text={it.label} x={hx + handleW + 0.8 * fs} y={cy} size={fs} baseline="central" />
          </g>
        )
      })}
    </g>
  )
}

export function FigurePlot(props: FigurePlotProps) {
  const { fig, arrays, still } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // The real size of the panel, measured before the first paint and on every resize: the figure is laid
  // out for exactly that (nothing is drawn until it is known).
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null)
  const size = props.size ?? measured ?? { w: 0, h: 0 }
  const [drag, setDrag] = useState<
    | { kind: 'vline'; which: number; x: number }
    | { kind: 'green' }
    | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
    | { kind: 'pan'; px0: number; py0: number; l: Limits }
    | null
  >(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el || props.size) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const w = Math.floor(r.width)
      const h = Math.floor(r.height)
      if (w > 0 && h > 0) setMeasured((m) => (m && m.w === w && m.h === h ? m : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [props.size])

  const W = size.w
  const H = size.h
  const delta = props.fontDelta ?? 0
  const main = mainAxes(fig)
  const geos: AxesGeo[] = []
  if (fig) {
    // inset axes (ax.inset_axes: Label Manager insets) are drawn after their parent, placed in its frame
    const all: AxesJ[] = []
    for (const ax of fig.axes) {
      all.push(ax)
      for (const c of ax.children ?? []) {
        const [px, py, pw, ph] = ax.pos
        const [cx, cy, cw, ch] = c.pos
        all.push({ ...c, pos: [px + cx * pw, py + cy * ph, cw * pw, ch * ph], z: (ax.z ?? 0) + 0.5 })
      }
    }
    for (const ax of all) {
      if (!ax.visible) continue
      const box = axesBox(ax.pos, W, H)
      const lim = limitsOf(ax)
      let x = lim.x
      let y = lim.y
      const user = props.limits
      if (user && (ax === main || ax.twinOf === main?.id)) {
        const forward = lim.x[0] <= lim.x[1]
        x = forward ? [user.xmin, user.xmax] : [user.xmax, user.xmin]
        if (ax === main) y = [user.ymin, user.ymax]
      }
      geos.push({ ax, box, X: makeScale(x, box.x0, box.x1, ax.xscale === 'log'), Y: makeScale(y, box.y1, box.y0, ax.yscale === 'log') })
    }
  }
  const mg = geos.find((g) => g.ax === main) ?? null

  // ------------------------------------------------------------ mouse (main axes)
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * W) / (r.width || W), y: ((e.clientY - r.top) * H) / (r.height || H) }
  }
  const inMain = (p: { x: number; y: number }) => !!mg && p.x >= mg.box.x0 && p.x <= mg.box.x1 && p.y >= mg.box.y0 && p.y <= mg.box.y1
  const currentLimits = (): Limits | null => (mg ? { xmin: mg.X.lo, xmax: mg.X.hi, ymin: mg.Y.lo, ymax: mg.Y.hi } : null)
  const xRange = mg ? Math.abs(mg.X.hi - mg.X.lo) : 1
  const threshold = Math.max(0.1, 0.02 * xRange)

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (still || e.button !== 0 || !mg) return
    const p = local(e)
    if (!inMain(p)) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const mode = props.mode ?? 'none'
    if (mode === 'zoom') return setDrag({ kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y })
    if (mode === 'drag') return setDrag({ kind: 'pan', px0: p.x, py0: p.y, l: currentLimits()! })
    const bx = mg.X.from(p.x)
    if (props.greenLine !== null && props.greenLine !== undefined && Math.abs(props.greenLine - bx) <= threshold) return setDrag({ kind: 'green' })
    if (props.rangeActive && props.vlines && Object.keys(props.vlines).length) {
      const which = nearestLine(bx, props.vlines)
      if (which !== null) setDrag({ kind: 'vline', which, x: props.vlines[String(which)] })
    }
  }
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!mg) return
    const p = local(e)
    props.onCursor?.(inMain(p) ? { x: mg.X.from(p.x), y: mg.Y.from(p.y) } : null)
    if (!drag) return
    const dx = mg.X.from(p.x)
    if (drag.kind === 'vline') {
      if (!inMain(p)) return
      setDrag({ ...drag, x: dx })
      props.onVline?.(drag.which, dx, false)
    } else if (drag.kind === 'green') props.onGreenLine?.(dx)
    else if (drag.kind === 'box') setDrag({ ...drag, x1: p.x, y1: p.y })
    else if (drag.kind === 'pan') {
      const l = drag.l
      const sx = (l.xmax - l.xmin) / (mg.box.x1 - mg.box.x0)
      const sy = (l.ymax - l.ymin) / (mg.box.y1 - mg.box.y0)
      const forward = mg.X.to(l.xmax) > mg.X.to(l.xmin)
      const ddx = (p.x - drag.px0) * sx * (forward ? -1 : 1)
      const ddy = (p.y - drag.py0) * sy
      props.onLimits?.({ xmin: l.xmin + ddx, xmax: l.xmax + ddx, ymin: l.ymin + ddy, ymax: l.ymax + ddy })
    }
  }
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const cur = drag
    setDrag(null)
    if (!cur || !mg) return
    const p = local(e)
    if (cur.kind === 'vline') props.onVline?.(cur.which, cur.x, true)
    else if (cur.kind === 'box') {
      if (Math.abs(cur.x1 - cur.x0) < 5 || Math.abs(cur.y1 - cur.y0) < 5) return
      const a = mg.X.from(cur.x0)
      const b = mg.X.from(cur.x1)
      const c = mg.Y.from(cur.y0)
      const d = mg.Y.from(cur.y1)
      props.onLimits?.({ xmin: Math.min(a, b), xmax: Math.max(a, b), ymin: Math.min(c, d), ymax: Math.max(c, d) })
      props.onModeDone?.()
    } else if (cur.kind === 'pan') props.onModeDone?.()
    void p
  }
  const onContextMenu = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (still || !mg) return
    e.preventDefault()
    const p = local(e)
    props.onContextMenu?.(e, { x: mg.X.from(p.x), y: mg.Y.from(p.y) })
  }

  // ------------------------------------------------------------ drawing
  const nodes: ReactNode[] = []
  const overlays: ReactNode[] = []
  const tickSize = (ax: AxesJ, which: 'x' | 'y') => px(((which === 'x' ? ax.xtickp : ax.ytickp).size ?? PLOT_STYLE.axisNumberSize) + delta)
  const labelSize = (st: { size?: number }) => px((st.size ?? PLOT_STYLE.axisTitleSize) + delta)

  const sorted = [...geos].sort((a, b) => a.ax.z - b.ax.z)
  sorted.forEach((g, gi) => {
    const { ax, box, X, Y } = g
    const clip = `kt-clip-${ax.id}-${gi}`
    const isTwin = ax.twinOf !== undefined
    const items: ReactNode[] = []
    if (ax.patchVisible && ax.facecolor && ax.facecolor !== 'none') items.push(<rect key="bg" x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} fill={ax.facecolor} />)
    const coord = (tr: string | undefined, x: number, y: number): [number, number] => {
      const [tx, ty] = (tr ?? 'data').split('|')
      const cx = tx === 'axes' ? box.x0 + x * (box.x1 - box.x0) : tx === 'figure' ? x * W : X.to(x)
      const yk = ty ?? tx
      const cy = yk === 'axes' ? box.y1 - y * (box.y1 - box.y0) : yk === 'figure' ? H - y * H : Y.to(y)
      return [cx, cy]
    }
    const coordOf = (c: string | string[] | undefined, x: number, y: number): [number, number] => {
      if (Array.isArray(c)) {
        const xs = c[0] === 'axes fraction' ? box.x0 + x * (box.x1 - box.x0) : c[0] === 'figure fraction' ? x * W : X.to(x)
        const ys = c[1] === 'axes fraction' ? box.y1 - y * (box.y1 - box.y0) : c[1] === 'figure fraction' ? H - y * H : Y.to(y)
        return [xs, ys]
      }
      if (c === 'axes fraction') return [box.x0 + x * (box.x1 - box.x0), box.y1 - y * (box.y1 - box.y0)]
      if (c === 'figure fraction') return [x * W, H - y * H]
      if (c === 'axes pixels') return [box.x0 + x, box.y1 - y]
      return [X.to(x), Y.to(y)]
    }
    const clipped: ReactNode[] = []
    const free: ReactNode[] = []
    const arts = [...ax.artists].map((a, i) => ({ a, i })).sort((p, q) => zOf(p.a.k, p.a.z) - zOf(q.a.k, q.a.z) || p.i - q.i)
    for (const { a, i } of arts) {
      if (a.hidden) continue
      const key = `${a.id}-${i}`
      const op = a.alpha ?? 1
      if (a.k === 'line') {
        const xs = data(arrays, a.x)
        const ys = data(arrays, a.y)
        const lw = px(a.lw ?? 1.5)
        const transformed = a.tr && a.tr !== 'data'
        const Xf = transformed ? (v: number) => coord(a.tr, v, 0)[0] : X.to
        const Yf = transformed ? (v: number) => coord(a.tr, 0, v)[1] : Y.to
        if (a.ls !== 'none') clipped.push(<path key={key} d={pathOf(xs, ys, Xf, Yf, a.drawstyle)} fill="none" stroke={a.color ?? 'black'} strokeWidth={lw} strokeOpacity={op} strokeDasharray={dashArray(a.ls, a.lw ?? 1.5)} strokeLinejoin="round" />)
        if (a.marker) {
          const r = px(a.ms ?? 6) / 2
          const marks: ReactNode[] = []
          for (let k = 0; k < Math.min(xs.length, ys.length); k++) {
            const xv = xs[k]
            const yv = ys[k]
            if (xv === null || yv === null) continue
            marks.push(markerShape(a.marker, Xf(xv), Yf(yv), r, a.mfc ?? a.color ?? 'black', a.mec ?? a.color ?? 'black', k))
          }
          clipped.push(<g key={`${key}m`} opacity={op}>{marks}</g>)
        }
      } else if (a.k === 'axline') {
        const v = a.at
        if (v === null || v === undefined) continue
        const dragging = drag?.kind === 'vline' && a.tags?.vline === drag.which
        const at = dragging ? drag.x : v
        const lw = px(a.lw ?? 1.5)
        const [s0, s1] = a.span ?? [0, 1]
        if (a.dir === 'v') {
          const x = X.to(at)
          clipped.push(<line key={key} x1={x} x2={x} y1={box.y1 - s0 * (box.y1 - box.y0)} y2={box.y1 - s1 * (box.y1 - box.y0)} stroke={a.color ?? 'black'} strokeWidth={lw} strokeOpacity={op} strokeDasharray={dashArray(a.ls, a.lw ?? 1.5)} />)
        } else {
          const y = Y.to(at)
          clipped.push(<line key={key} y1={y} y2={y} x1={box.x0 + s0 * (box.x1 - box.x0)} x2={box.x0 + s1 * (box.x1 - box.x0)} stroke={a.color ?? 'black'} strokeWidth={lw} strokeOpacity={op} strokeDasharray={dashArray(a.ls, a.lw ?? 1.5)} />)
        }
      } else if (a.k === 'scatter') {
        const xs = data(arrays, a.x)
        const ys = data(arrays, a.y)
        const r = (Math.sqrt(a.s ?? 20) * px(1)) / 2
        const marker = a.marker ?? 'o'
        const colour = a.color ?? '#1f77b4'
        if (marker === 'o' || marker === '.') {
          let d = ''
          for (let k = 0; k < Math.min(xs.length, ys.length); k++) {
            const xv = xs[k]
            const yv = ys[k]
            if (xv === null || yv === null) continue
            const cx = X.to(xv)
            const cy = Y.to(yv)
            d += `M${(cx - r).toFixed(2)} ${cy.toFixed(2)}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`
          }
          clipped.push(<path key={key} d={d} fill={colour} fillOpacity={op} stroke={a.ec ?? colour} strokeOpacity={op} strokeWidth={0.5} />)
        } else {
          const marks: ReactNode[] = []
          for (let k = 0; k < Math.min(xs.length, ys.length); k++) {
            const xv = xs[k]
            const yv = ys[k]
            if (xv === null || yv === null) continue
            marks.push(markerShape(marker, X.to(xv), Y.to(yv), r, colour, a.ec ?? colour, k))
          }
          clipped.push(<g key={key} opacity={op}>{marks}</g>)
        }
      } else if (a.k === 'fill') {
        const xs = data(arrays, a.x)
        clipped.push(<path key={key} d={fillPath(xs, data(arrays, a.y1), data(arrays, a.y2), X.to, Y.to, a.horizontal)} fill={a.fc ?? '#1f77b4'} fillOpacity={op} stroke={a.ec ?? 'none'} strokeOpacity={op} />)
      } else if (a.k === 'text') {
        if (a.x === null || a.y === null || typeof a.x !== 'number' || typeof a.y !== 'number') continue
        const [cx, cy] = coord(a.tr, a.x, a.y)
        free.push(textNode(a, cx, cy, key, delta))
      } else if (a.k === 'annotation') {
        const xy = a.xy ?? [null, null]
        if (xy[0] === null || xy[1] === null) continue
        const [ax0, ay0] = coordOf(a.xycoords, xy[0], xy[1])
        let tx = ax0
        let ty = ay0
        if (a.xytext && a.xytext[0] !== null && a.xytext[1] !== null) {
          if (a.textcoords === 'offset points') {
            tx = ax0 + px(a.xytext[0])
            ty = ay0 - px(a.xytext[1])
          } else if (a.textcoords === 'offset pixels') {
            tx = ax0 + a.xytext[0]
            ty = ay0 - a.xytext[1]
          } else [tx, ty] = coordOf(a.textcoords ?? a.xycoords, a.xytext[0], a.xytext[1])
        }
        if (a.arrow) free.push(arrowPath([tx, ty], [ax0, ay0], a.arrow.style, 15, a.arrow.color ?? 'black', px(a.arrow.lw), `${key}a`))
        free.push(textNode(a, tx, ty, key, delta))
      } else if (a.k === 'patch') {
        clipped.push(patchNode(a, g, coord, key))
      } else if (a.k === 'table') {
        overlays.push(tableNode(a, box, key))
      }
    }
    items.push(
      <g key="data" clipPath={`url(#${clip})`}>
        {clipped}
      </g>,
    )
    items.push(<g key="free">{free}</g>)

    // spines, ticks, labels
    if (ax.axisOn) {
      const sp = ax.spines
      const spineColour = (s: { color: string | null }) => s.color ?? 'black'
      if (!isTwin) {
        if (sp.left.visible) items.push(<line key="sl" x1={box.x0} x2={box.x0} y1={box.y0} y2={box.y1} stroke={spineColour(sp.left)} strokeWidth={px(sp.left.lw ?? 0.8)} />)
        if (sp.right.visible) items.push(<line key="sr" x1={box.x1} x2={box.x1} y1={box.y0} y2={box.y1} stroke={spineColour(sp.right)} strokeWidth={px(sp.right.lw ?? 0.8)} />)
        if (sp.top.visible) items.push(<line key="st" x1={box.x0} x2={box.x1} y1={box.y0} y2={box.y0} stroke={spineColour(sp.top)} strokeWidth={px(sp.top.lw ?? 0.8)} />)
        if (sp.bottom.visible) items.push(<line key="sb" x1={box.x0} x2={box.x1} y1={box.y1} y2={box.y1} stroke={spineColour(sp.bottom)} strokeWidth={px(sp.bottom.lw ?? 0.8)} />)
        // x axis
        if (ax.xaxisVisible) {
          const fsT = tickSize(ax, 'x')
          const t = axisTicks([X.lo, X.hi], box.x1 - box.x0, fsT / px(1), 'x', ax.xformat, ax.xticks, ax.xticklabels, ax === main ? PLOT_STYLE.xSublines + 1 : 0)
          const tc = ax.xtickp.color ?? 'black'
          t.major.forEach((v, k) => {
            const x = X.to(v)
            items.push(<line key={`xt${k}`} x1={x} x2={x} y1={box.y1} y2={box.y1 + TICK_LEN} stroke={tc} strokeWidth={px(0.8)} />)
            items.push(<MText key={`xl${k}`} text={t.labels[k] ?? ''} x={x} y={box.y1 + TICK_LEN + px(3.5)} size={fsT} anchor="middle" baseline="text-before-edge" color={tc} />)
          })
          t.minor.forEach((v, k) => {
            const x = X.to(v)
            items.push(<line key={`xm${k}`} x1={x} x2={x} y1={box.y1} y2={box.y1 + MINOR_LEN} stroke={tc} strokeWidth={px(0.6)} />)
          })
          if (t.corner) items.push(<MText key="xc" text={t.corner} x={box.x1} y={box.y1 + TICK_LEN + fsT * 2.2} size={fsT} anchor="end" baseline="text-before-edge" color={tc} />)
          if (ax.xlabel) items.push(<MText key="xlab" text={ax.xlabel} x={(box.x0 + box.x1) / 2} y={box.y1 + TICK_LEN + px(3.5) + fsT * 1.25 + px(4)} size={labelSize(ax.xlabelStyle)} anchor="middle" baseline="text-before-edge" color={ax.xlabelStyle.color ?? 'black'} bold={ax.xlabelStyle.bold} />)
        }
      }
      // y axis: left for the main axes, right (outward) for a twin
      if (ax.yaxisVisible) {
        const right = isTwin || ax.ySide === 'right'
        const outward = right ? px(sp.right.outward) : 0
        const sx = right ? box.x1 + outward : box.x0
        const dir = right ? 1 : -1
        const fsT = tickSize(ax, 'y')
        const tc = ax.ytickp.color ?? 'black'
        if (isTwin && sp.right.visible) items.push(<line key="tsr" x1={sx} x2={sx} y1={box.y0} y2={box.y1} stroke={sp.right.color ?? 'black'} strokeWidth={px(sp.right.lw ?? 0.8)} />)
        const t = axisTicks([Y.lo, Y.hi], box.y1 - box.y0, fsT / px(1), 'y', ax.yformat, ax.yticks, ax.yticklabels, ax === main ? PLOT_STYLE.ySublines + 1 : 0)
        let widest = 0
        t.major.forEach((v, k) => {
          const y = Y.to(v)
          const label = t.labels[k] ?? ''
          widest = Math.max(widest, textWidth(label, fsT))
          items.push(<line key={`yt${k}`} x1={sx} x2={sx + dir * TICK_LEN} y1={y} y2={y} stroke={tc} strokeWidth={px(0.8)} />)
          items.push(<MText key={`yl${k}`} text={label} x={sx + dir * (TICK_LEN + px(3.5))} y={y} size={fsT} anchor={right ? 'start' : 'end'} baseline="central" color={tc} />)
        })
        t.minor.forEach((v, k) => {
          const y = Y.to(v)
          items.push(<line key={`ym${k}`} x1={sx} x2={sx + dir * MINOR_LEN} y1={y} y2={y} stroke={tc} strokeWidth={px(0.6)} />)
        })
        if (t.corner) items.push(<MText key="yc" text={t.corner} x={right ? sx : box.x0} y={box.y0 - px(4)} size={fsT} anchor={right ? 'end' : 'start'} baseline="text-after-edge" color={tc} />)
        if (ax.ylabel) {
          const lx = sx + dir * (TICK_LEN + px(3.5) + widest + px(4))
          const ly = (box.y0 + box.y1) / 2
          items.push(<MText key="ylab" text={ax.ylabel} x={lx} y={ly} size={labelSize(ax.ylabelStyle)} anchor="middle" baseline={right ? 'text-before-edge' : 'text-after-edge'} rotate={90} color={ax.ylabelStyle.color ?? 'black'} bold={ax.ylabelStyle.bold} />)
        }
      }
      if (ax.title) items.push(<MText key="title" text={ax.title} x={(box.x0 + box.x1) / 2} y={box.y0 - px(6)} size={labelSize(ax.titleStyle)} anchor="middle" baseline="text-after-edge" bold={ax.titleStyle.bold} />)
    }
    if (ax.legend && !ax.legend.hidden) overlays.push(legendNode(ax.legend, box, PLOT_STYLE.legendFontSize + delta, `lg${ax.id}`))
    nodes.push(
      <g key={`ax${ax.id}-${gi}`}>
        <defs>
          <clipPath id={clip}>
            <rect x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />
          </clipPath>
        </defs>
        {items}
      </g>,
    )
  })
  for (const [i, t] of (fig?.texts ?? []).entries()) {
    if (typeof t.x === 'number' && typeof t.y === 'number') nodes.push(textNode(t, t.x * W, H - t.y * H, `ft${i}`, delta))
  }

  // the green line (vertical toolbar) and the zoom box
  if (mg && props.greenLine !== null && props.greenLine !== undefined) {
    const x = mg.X.to(props.greenLine)
    overlays.push(
      <g key="green">
        <line x1={x} x2={x} y1={mg.box.y0} y2={mg.box.y1} stroke="green" strokeWidth={px(1)} />
        <MText text={props.greenLine.toFixed(2)} x={x} y={mg.box.y1 - 0.95 * (mg.box.y1 - mg.box.y0)} size={px(9)} anchor="middle" color="green" />
      </g>,
    )
  }
  if (drag?.kind === 'box') overlays.push(<rect key="zoom" x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} fill="green" fillOpacity={0.15} stroke="green" strokeWidth={1} />)

  return (
    <div className="kt-figure" ref={wrapRef} style={props.size ? { width: W, height: H } : undefined}>
      {W > 0 && H > 0 && <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className={`kt-svg${props.mode === 'drag' ? ' kt-pan' : props.mode === 'zoom' ? ' kt-zoom' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => props.onCursor?.(null)}
        onDoubleClick={() => props.onDoubleClick?.()}
        onContextMenu={onContextMenu}
        fontFamily={FONT}
      >
        <rect x={0} y={0} width={W} height={H} fill={fig?.facecolor && fig.facecolor !== 'none' ? fig.facecolor : 'white'} />
        {nodes}
        {overlays}
      </svg>}
    </div>
  )
}

function textNode(a: ArtistJ, x: number, y: number, key: string, delta: number): ReactNode {
  const size = px((a.size ?? 10) + delta)
  const anchor = anchorOf(a.ha)
  const baseline = baselineOf(a.va)
  const label = <MText key={key} text={a.text ?? ''} x={x} y={y} size={size} anchor={anchor} baseline={baseline} color={a.color} rotate={a.rotation} bold={a.bold} italic={a.italic} family={a.family} />
  if (!a.bbox) return label
  const w = textWidth(a.text ?? '', size) + 2 * a.bbox.pad * size
  const h = size * 1.2 + 2 * a.bbox.pad * size
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w + a.bbox.pad * size : x - a.bbox.pad * size
  const y0 = baseline === 'text-before-edge' ? y - a.bbox.pad * size : baseline === 'central' ? y - h / 2 : y - h + a.bbox.pad * size
  return (
    <g key={key} opacity={a.alpha ?? 1}>
      <rect x={x0} y={y0} width={w} height={h} fill={a.bbox.fc ?? 'white'} fillOpacity={a.bbox.alpha} stroke={a.bbox.ec ?? 'none'} strokeOpacity={a.bbox.alpha} />
      {label}
    </g>
  )
}

function patchNode(a: ArtistJ, g: AxesGeo, coord: (tr: string | undefined, x: number, y: number) => [number, number], key: string): ReactNode {
  const geom = (a.geom ?? {}) as Record<string, unknown>
  const fill = a.fc && a.fc !== 'none' ? a.fc : 'none'
  const stroke = a.ec ?? (a.shape === 'arrow' ? a.fc ?? 'black' : 'none')
  const lw = px(a.lw ?? 1)
  const op = a.alpha ?? 1
  const dash = dashArray(a.ls, a.lw ?? 1)
  const pt = (p: unknown): [number, number] => {
    const q = p as [number, number]
    return coord(a.tr, q[0], q[1])
  }
  const { box, X, Y } = g
  switch (a.shape) {
    case 'arrow':
      return <g key={key} opacity={op}>{arrowPath(pt(geom.a), pt(geom.b), String(geom.style ?? '-|>'), Number(geom.scale ?? 15), (a.ec ?? a.fc ?? 'black') as string, lw, 'ar', dash)}</g>
    case 'rect': {
      const [x0, y0] = pt(geom.xy)
      const [x1, y1] = coord(a.tr, (geom.xy as number[])[0] + Number(geom.w ?? 0), (geom.xy as number[])[1] + Number(geom.h ?? 0))
      return <rect key={key} x={Math.min(x0, x1)} y={Math.min(y0, y1)} width={Math.abs(x1 - x0)} height={Math.abs(y1 - y0)} fill={fill} fillOpacity={op} stroke={stroke} strokeWidth={lw} strokeOpacity={op} strokeDasharray={dash} />
    }
    case 'vspan': {
      const x0 = X.to(Number(geom.x0))
      const x1 = X.to(Number(geom.x1))
      return <rect key={key} x={Math.min(x0, x1)} y={box.y0} width={Math.abs(x1 - x0)} height={box.y1 - box.y0} fill={fill === 'none' ? '#1f77b4' : fill} fillOpacity={op} stroke="none" />
    }
    case 'hspan': {
      const y0 = Y.to(Number(geom.y0))
      const y1 = Y.to(Number(geom.y1))
      return <rect key={key} x={box.x0} y={Math.min(y0, y1)} width={box.x1 - box.x0} height={Math.abs(y1 - y0)} fill={fill === 'none' ? '#1f77b4' : fill} fillOpacity={op} stroke="none" />
    }
    case 'circle':
    case 'ellipse':
    case 'arc':
    case 'wedge': {
      const [cx, cy] = pt(geom.center)
      const rx = Math.abs(X.to((geom.center as number[])[0] + Number(geom.r ?? Number(geom.w ?? 0) / 2)) - cx)
      const ry = Math.abs(Y.to((geom.center as number[])[1] + Number(geom.r ?? Number(geom.h ?? 0) / 2)) - cy)
      return <ellipse key={key} cx={cx} cy={cy} rx={rx} ry={ry} fill={a.shape === 'arc' ? 'none' : fill} fillOpacity={op} stroke={stroke === 'none' ? 'black' : stroke} strokeWidth={lw} strokeOpacity={op} />
    }
    case 'polygon': {
      const pts = (geom.xy as number[][] | undefined) ?? []
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${pt(p).join(' ')}`).join('') + (geom.closed === false ? '' : 'Z')
      return <path key={key} d={d} fill={fill} fillOpacity={op} stroke={stroke} strokeWidth={lw} strokeOpacity={op} />
    }
    default:
      return null
  }
}

function tableNode(a: ArtistJ, box: Box, key: string): ReactNode {
  const cells = a.cells ?? []
  const fs = px(a.fontsize ?? 9)
  return (
    <foreignObject key={key} x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0}>
      <div className="kt-mpltable">
        <table style={{ fontSize: fs }}>
          <tbody>
            {cells.map((row, r) => (
              <tr key={r} style={{ height: fs * 1.4 * (a.yscale ?? 1) }}>
                {row.map((c, k) =>
                  c ? (
                    <td key={k} style={{ background: c.fc ?? 'white', borderColor: c.ec ?? '#d1d1d1', fontWeight: c.bold ? 'bold' : undefined, textAlign: (a.align as 'center') ?? 'center' }}>
                      {c.t}
                    </td>
                  ) : (
                    <td key={k} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </foreignObject>
  )
}
