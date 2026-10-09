// What the drawing shows, as a list of simple primitives (lines, polygons, circles, text) in screen coordinates.
// The canvas of the app and the SVG / PNG / report exports both draw this list, so they always agree. Colours are
// names ('fg', 'accent'…) that the renderer maps to the theme (canvas) or to a fixed light palette (exports), or
// literal rgb() strings (result colours).

import type { FrameResult } from './frame.ts'
import type { Mesh } from './mesh.ts'
import { memberById, nodeById, type Model, type Pt, type Target } from './model.ts'
import type { ModalResult, BucklingResult } from './modal.ts'
import type { PlaneResult } from './plane.ts'
import {
  colorAt, cssColor, diagramMax, diagramMember, extremes, niceRange, plateField, PLATE_FIELDS, type ColorMapName, type PlateField,
} from './post.ts'
import { fmt, fromSI, label, type Quantity, type Units } from './units.ts'

export type Prim =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; c: string; w: number; dash?: number[] }
  | { t: 'poly'; pts: number[]; closed: boolean; fill?: string; stroke?: string; w: number; dash?: number[]; alpha?: number }
  | { t: 'circle'; x: number; y: number; r: number; fill?: string; stroke?: string; w: number }
  | { t: 'text'; x: number; y: number; s: string; c: string; size: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean }

export interface View {
  cx: number
  cy: number
  /** pixels per metre */
  scale: number
  w: number
  h: number
}

export const toScreen = (v: View, x: number, y: number): [number, number] => [v.w / 2 + (x - v.cx) * v.scale, v.h / 2 - (y - v.cy) * v.scale]
export const toWorld = (v: View, sx: number, sy: number): Pt => ({ x: v.cx + (sx - v.w / 2) / v.scale, y: v.cy - (sy - v.h / 2) / v.scale })

/** A view that shows the box with a margin (pixels). */
export function fitView(box: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, margin = 48): View {
  const bw = Math.max(box.x1 - box.x0, 1e-12)
  const bh = Math.max(box.y1 - box.y0, 1e-12)
  const scale = Math.max(1e-9, Math.min((w - 2 * margin) / bw, (h - 2 * margin) / bh))
  return { cx: (box.x0 + box.x1) / 2, cy: (box.y0 + box.y1) / 2, scale, w, h }
}

export type ResultKind = 'none' | 'deformed' | 'diagram' | 'contour' | 'mode'

export interface SceneOptions {
  units: Units
  showIds?: boolean
  showLoads?: boolean
  showSupports?: boolean
  showMesh?: boolean
  showGrid?: boolean
  grid?: number
  /** selection (ids of nodes / members, "plate:v:loop:i" vertices, "plate:e:loop:i" edges) */
  selected?: ReadonlySet<string>
  result?: ResultOptions
  /** draw the shaded contour as polygons (exports); the canvas rasterises it itself */
  contourPolys?: boolean
  /** do not fill the plate (a result is drawn under it) */
  noFill?: boolean
}

export interface ResultOptions {
  kind: ResultKind
  /** displacement magnification */
  scale: number
  undeformed: boolean
  diagram: 'N' | 'V' | 'M'
  field: PlateField
  nodalMode: 'nodal' | 'element'
  bands: number
  cmap: ColorMapName
  range?: [number, number]
  reactions: boolean
  minmax: boolean
  principal: boolean
  labels: boolean
  /** which mode of a modal / buckling result */
  modeIndex: number
}

export const DEFAULT_RESULT: ResultOptions = {
  kind: 'none', scale: 1, undeformed: true, diagram: 'M', field: 'vm', nodalMode: 'nodal', bands: 0, cmap: 'rainbow', reactions: true, minmax: true, principal: false, labels: true, modeIndex: 0,
}

// ---------------------------------------------------------------------------- helpers

function arrow(out: Prim[], x1: number, y1: number, x2: number, y2: number, c: string, w = 1.6, head = 7): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const l = Math.hypot(dx, dy)
  if (l < 1) return
  const ux = dx / l
  const uy = dy / l
  const h = Math.min(head, l * 0.6)
  out.push({ t: 'line', x1, y1, x2: x2 - ux * h * 0.6, y2: y2 - uy * h * 0.6, c, w })
  out.push({ t: 'poly', pts: [x2, y2, x2 - ux * h + uy * h * 0.4, y2 - uy * h - ux * h * 0.4, x2 - ux * h - uy * h * 0.4, y2 - uy * h + ux * h * 0.4], closed: true, fill: c, stroke: c, w: 1 })
}

/** A curved moment arrow around (x, y); positive = counter-clockwise (in world coordinates). */
function momentArrow(out: Prim[], x: number, y: number, r: number, ccw: boolean, c: string): void {
  const n = 14
  const pts: number[] = []
  const a0 = ccw ? Math.PI * 0.15 : Math.PI * 0.85
  const sweep = ccw ? Math.PI * 1.25 : -Math.PI * 1.25
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n
    pts.push(x + r * Math.cos(a), y - r * Math.sin(a))
  }
  out.push({ t: 'poly', pts, closed: false, stroke: c, w: 1.6 })
  const k = pts.length
  arrow(out, pts[k - 4], pts[k - 3], pts[k - 2], pts[k - 1], c, 1.6, 6)
}

function valueText(v: number, q: Quantity, u: Units): string {
  const l = label(q, u)
  return `${fmt(fromSI(v, q, u), 3)}${l ? ` ${l}` : ''}`
}

/** The polygon edges a target of the plate selects, as segments in metres (for drawing supports and loads). */
export function targetGeometry(plate: NonNullable<Model['plate']>, t: Target): Array<[number, number, number, number]> {
  const loops = [plate.outline, ...plate.holes]
  const out: Array<[number, number, number, number]> = []
  const tol = Math.max(1e-9, plate.mesh.size * 1e-3)
  const edgesOf = (li: number): Array<[number, number, number, number]> => {
    const lp = loops[li] ?? []
    return lp.map((p, i) => [p.x, p.y, lp[(i + 1) % lp.length].x, lp[(i + 1) % lp.length].y])
  }
  switch (t.kind) {
    case 'edge': { const e = edgesOf(t.loop)[t.edge]; if (e) out.push(e); break }
    case 'loop': out.push(...edgesOf(t.loop)); break
    case 'line': {
      const dx = t.x2 - t.x1
      const dy = t.y2 - t.y1
      const L = Math.hypot(dx, dy) || 1
      const on = (x: number, y: number) => {
        const along = ((x - t.x1) * dx + (y - t.y1) * dy) / L
        return Math.abs(((x - t.x1) * dy - (y - t.y1) * dx) / L) <= tol && along >= -tol && along <= L + tol
      }
      for (let li = 0; li < loops.length; li++) for (const e of edgesOf(li)) if (on(e[0], e[1]) && on(e[2], e[3])) out.push(e)
      break
    }
    case 'circle': {
      const on = (x: number, y: number) => Math.abs(Math.hypot(x - t.cx, y - t.cy) - t.r) <= tol
      for (let li = 0; li < loops.length; li++) for (const e of edgesOf(li)) if (on(e[0], e[1]) && on(e[2], e[3])) out.push(e)
      break
    }
    case 'vertex': { const p = loops[t.loop]?.[t.vertex]; if (p) out.push([p.x, p.y, p.x, p.y]); break }
    default: out.push([t.x, t.y, t.x, t.y])
  }
  return out
}

// ---------------------------------------------------------------------------- the model itself

function supportSymbol(out: Prim[], x: number, y: number, ux: boolean, uy: boolean, rz: boolean, dir: [number, number], spring: { x: boolean; y: boolean }, c: string): void {
  const s = 11
  if (spring.y || spring.x) {
    const [dx, dy] = spring.y ? [0, 1] : [-1, 0]
    const pts: number[] = [x, y]
    for (let i = 1; i <= 6; i++) { const t = (i / 7) * 22; const side = i % 2 ? 5 : -5; pts.push(x + dx * t + (dy ? side : 0), y + dy * t + (dx ? side : 0)) }
    pts.push(x + dx * 24, y + dy * 24)
    out.push({ t: 'poly', pts, closed: false, stroke: c, w: 1.4 })
    out.push({ t: 'line', x1: x + (dy ? -9 : dx * 24), y1: y + (dx ? -9 : dy * 24), x2: x + (dy ? 9 : dx * 24), y2: y + (dx ? 9 : dy * 24), c, w: 2 })
    return
  }
  if (ux && uy && rz) {
    // fixed: a wall perpendicular to the member
    const [mx, my] = dir
    const nx = -my
    const ny = mx
    out.push({ t: 'line', x1: x + nx * s * 1.1, y1: y + ny * s * 1.1, x2: x - nx * s * 1.1, y2: y - ny * s * 1.1, c, w: 3 })
    for (let i = -2; i <= 2; i++) out.push({ t: 'line', x1: x + nx * i * s * 0.5, y1: y + ny * i * s * 0.5, x2: x + nx * i * s * 0.5 - mx * s * 0.7 - nx * s * 0.25, y2: y + ny * i * s * 0.5 - my * s * 0.7 - ny * s * 0.25, c, w: 1 })
    return
  }
  if (ux && uy) {
    out.push({ t: 'poly', pts: [x, y, x - s * 0.8, y + s * 1.5, x + s * 0.8, y + s * 1.5], closed: true, stroke: c, w: 1.6, fill: 'bgmix' })
    ground(out, x, y + s * 1.5, c, false)
    return
  }
  if (uy) {
    out.push({ t: 'poly', pts: [x, y, x - s * 0.8, y + s * 1.3, x + s * 0.8, y + s * 1.3], closed: true, stroke: c, w: 1.6, fill: 'bgmix' })
    out.push({ t: 'circle', x: x - s * 0.4, y: y + s * 1.3 + 3, r: 2.6, stroke: c, w: 1.2 })
    out.push({ t: 'circle', x: x + s * 0.4, y: y + s * 1.3 + 3, r: 2.6, stroke: c, w: 1.2 })
    ground(out, x, y + s * 1.3 + 6, c, true)
    return
  }
  if (ux) {
    out.push({ t: 'poly', pts: [x, y, x - s * 1.3, y - s * 0.8, x - s * 1.3, y + s * 0.8], closed: true, stroke: c, w: 1.6, fill: 'bgmix' })
    out.push({ t: 'circle', x: x - s * 1.3 - 3, y: y - s * 0.4, r: 2.6, stroke: c, w: 1.2 })
    out.push({ t: 'circle', x: x - s * 1.3 - 3, y: y + s * 0.4, r: 2.6, stroke: c, w: 1.2 })
    out.push({ t: 'line', x1: x - s * 1.3 - 6, y1: y - s, x2: x - s * 1.3 - 6, y2: y + s, c, w: 1.6 })
    return
  }
  out.push({ t: 'poly', pts: [x - 5, y - 5, x + 5, y - 5, x + 5, y + 5, x - 5, y + 5], closed: true, stroke: c, w: 1.4 })
}

function ground(out: Prim[], x: number, y: number, c: string, _roller: boolean): void {
  out.push({ t: 'line', x1: x - 14, y1: y, x2: x + 14, y2: y, c, w: 1.6 })
  for (let i = -3; i <= 3; i++) out.push({ t: 'line', x1: x + i * 4.5, y1: y, x2: x + i * 4.5 - 4, y2: y + 5, c, w: 1 })
}

function frameModelPrims(model: Model, v: View, opts: SceneOptions, out: Prim[], dim: boolean): void {
  const sel = opts.selected ?? new Set<string>()
  const P = (id: string): [number, number] | null => { const n = nodeById(model, id); return n ? toScreen(v, n.x, n.y) : null }
  const base = dim ? 'muted' : 'fg'
  // members
  for (const m of model.members) {
    const a = P(m.n1)
    const b = P(m.n2)
    if (!a || !b) continue
    const on = sel.has(m.id)
    const truss = model.analysis === 'truss' || (!!m.releaseStart && !!m.releaseEnd)
    out.push({ t: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], c: on ? 'link' : base, w: on ? 3.4 : 2.4, dash: truss ? undefined : undefined })
    if (!truss) {
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const ux = (b[0] - a[0]) / l
      const uy = (b[1] - a[1]) / l
      if (m.releaseStart) out.push({ t: 'circle', x: a[0] + ux * 6, y: a[1] + uy * 6, r: 3.2, fill: 'bg', stroke: on ? 'link' : base, w: 1.4 })
      if (m.releaseEnd) out.push({ t: 'circle', x: b[0] - ux * 6, y: b[1] - uy * 6, r: 3.2, fill: 'bg', stroke: on ? 'link' : base, w: 1.4 })
    }
    if (opts.showIds && !dim) out.push({ t: 'text', x: (a[0] + b[0]) / 2 + 6, y: (a[1] + b[1]) / 2 - 6, s: m.id, c: 'muted', size: 11 })
  }
  // nodes
  for (const n of model.nodes) {
    const [x, y] = toScreen(v, n.x, n.y)
    const on = sel.has(n.id)
    out.push({ t: 'circle', x, y, r: on ? 5.5 : 3.6, fill: on ? 'link' : base, stroke: on ? 'link' : base, w: 1 })
    if (opts.showIds && !dim) out.push({ t: 'text', x: x + 7, y: y - 7, s: n.id, c: 'accent', size: 11, bold: true })
  }
  if (opts.showSupports === false) return
  // supports
  for (const s of model.supports) {
    const n = nodeById(model, s.node)
    if (!n) continue
    const [x, y] = toScreen(v, n.x, n.y)
    let dir: [number, number] = [1, 0]
    const mem = model.members.find((m) => m.n1 === s.node || m.n2 === s.node)
    if (mem) {
      const other = nodeById(model, mem.n1 === s.node ? mem.n2 : mem.n1)
      if (other) { const o = toScreen(v, other.x, other.y); const l = Math.hypot(o[0] - x, o[1] - y) || 1; dir = [(o[0] - x) / l, (o[1] - y) / l] }
    }
    supportSymbol(out, x, y, s.ux, s.uy, s.rz, dir, { x: !!s.kx, y: !!s.ky }, sel.has(s.node) ? 'link' : 'success')
    if (s.dx || s.dy || s.drz) out.push({ t: 'text', x: x + 10, y: y + 26, s: 'settles', c: 'warning', size: 10 })
  }
}

function frameLoadPrims(model: Model, v: View, opts: SceneOptions, out: Prim[]): void {
  const u = opts.units
  const maxF = Math.max(1e-300, ...model.nodeLoads.map((l) => Math.hypot(l.fx, l.fy)))
  const len = 54
  for (const l of model.nodeLoads) {
    const n = nodeById(model, l.node)
    if (!n) continue
    const [x, y] = toScreen(v, n.x, n.y)
    const f = Math.hypot(l.fx, l.fy)
    if (f > 0) {
      const k = Math.max(0.45, f / maxF) * len
      const dx = l.fx / f
      const dy = -l.fy / f
      arrow(out, x - dx * (k + 4), y - dy * (k + 4), x - dx * 4, y - dy * 4, 'danger', 2.2)
      out.push({ t: 'text', x: x - dx * (k + 6), y: y - dy * (k + 6) - (dy < 0 ? 0 : -12), s: valueText(f, 'force', u), c: 'danger', size: 11, anchor: dx > 0.5 ? 'end' : dx < -0.5 ? 'start' : 'middle' })
    }
    if (l.mz) {
      momentArrow(out, x, y, 17, l.mz > 0, 'danger')
      out.push({ t: 'text', x: x + 20, y: y - 18, s: valueText(Math.abs(l.mz), 'moment', u), c: 'danger', size: 11 })
    }
  }
  const maxW = Math.max(1e-300, ...model.memberLoads.map((l) => (l.type === 'dist' ? Math.max(Math.abs(l.w1), Math.abs(l.w2)) : 0)))
  for (const l of model.memberLoads) {
    const m = memberById(model, l.member)
    const a = m && nodeById(model, m.n1)
    const b = m && nodeById(model, m.n2)
    if (!m || !a || !b) continue
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    const ux = (b.x - a.x) / L
    const uy = (b.y - a.y) / L
    const at = (s: number): [number, number] => toScreen(v, a.x + ux * s, a.y + uy * s)
    if (l.type === 'thermal') {
      const [x, y] = at(L / 2)
      out.push({ t: 'text', x, y: y - 10, s: `ΔT ${fmt(l.dT, 3)} K${l.dTg ? `, gradient ${fmt(l.dTg, 3)} K` : ''}`, c: 'warning', size: 11, anchor: 'middle' })
      continue
    }
    // direction in the world
    const dirVec = (dir: typeof l.dir, sign: number): [number, number] => {
      switch (dir) {
        case 'x': return [sign, 0]
        case 'y': return [0, sign]
        case 'lx': return [ux * sign, uy * sign]
        default: return [-uy * sign, ux * sign]
      }
    }
    if (l.type === 'point') {
      const [x, y] = at(l.a)
      const [dx, dy] = dirVec(l.dir, l.p >= 0 ? 1 : -1)
      const k = 40
      arrow(out, x - dx * (k + 3), y + dy * (k + 3), x - dx * 3, y + dy * 3, 'danger', 2.2)
      out.push({ t: 'text', x: x - dx * (k + 5), y: y + dy * (k + 5) - 4, s: valueText(Math.abs(l.p), 'force', u), c: 'danger', size: 11, anchor: 'middle' })
      continue
    }
    const a0 = l.a ?? 0
    const b0 = l.b ?? L
    const n = Math.max(3, Math.min(14, Math.round(((b0 - a0) / L) * 10)))
    const pts: number[] = []
    const tips: Array<[number, number, number, number]> = []
    for (let i = 0; i <= n; i++) {
      const s = a0 + ((b0 - a0) * i) / n
      const w = l.w1 + ((l.w2 - l.w1) * i) / n
      const k = (Math.abs(w) / maxW) * 30
      const [dx, dy] = dirVec(l.dir, w >= 0 ? 1 : -1)
      const [x, y] = at(s)
      const tx = x - dx * k
      const ty = y + dy * k
      if (k > 3) tips.push([tx, ty, x, y])
      pts.push(tx, ty)
    }
    if (pts.length >= 4) out.push({ t: 'poly', pts, closed: false, stroke: 'danger', w: 1.4 })
    for (const [x1, y1, x2, y2] of tips) arrow(out, x1, y1, x2, y2, 'danger', 1.2, 5)
    const [mx, my] = at((a0 + b0) / 2)
    out.push({ t: 'text', x: mx, y: my - 36, s: l.w1 === l.w2 ? valueText(Math.abs(l.w1), 'lineLoad', u) : `${valueText(Math.abs(l.w1), 'lineLoad', u)} → ${valueText(Math.abs(l.w2), 'lineLoad', u)}`, c: 'danger', size: 11, anchor: 'middle' })
  }
  if (model.gravity > 0) out.push({ t: 'text', x: 12, y: v.h - 12, s: `self weight, g = ${fmt(model.gravity, 4)} m/s²`, c: 'warning', size: 11 })
}

// ---------------------------------------------------------------------------- plates

function plateGeometryPrims(model: Model, v: View, opts: SceneOptions, out: Prim[], mesh: Mesh | null): void {
  const plate = model.plate
  if (!plate) return
  const sel = opts.selected ?? new Set<string>()
  const loops = [plate.outline, ...plate.holes]
  loops.forEach((lp, li) => {
    if (lp.length < 2) return
    const pts: number[] = []
    for (const p of lp) pts.push(...toScreen(v, p.x, p.y))
    if (lp.length >= 3) out.push({ t: 'poly', pts, closed: true, fill: opts.noFill ? undefined : li === 0 ? 'plate' : 'bg', stroke: 'fg', w: 1.8 })
    else out.push({ t: 'poly', pts, closed: false, stroke: 'fg', w: 1.8 })
    lp.forEach((p, i) => {
      const [x, y] = toScreen(v, p.x, p.y)
      const on = sel.has(`plate:v:${li}:${i}`)
      out.push({ t: 'circle', x, y, r: on ? 5 : 2.8, fill: on ? 'link' : 'fg', stroke: on ? 'link' : 'fg', w: 1 })
    })
    // selected edges
    lp.forEach((p, i) => {
      if (!sel.has(`plate:e:${li}:${i}`)) return
      const q = lp[(i + 1) % lp.length]
      const [x1, y1] = toScreen(v, p.x, p.y)
      const [x2, y2] = toScreen(v, q.x, q.y)
      out.push({ t: 'line', x1, y1, x2, y2, c: 'link', w: 4 })
    })
  })
  if (opts.showMesh && mesh) {
    const s = mesh.stride
    for (let e = 0; e < mesh.nElems; e++) {
      const pts: number[] = []
      for (let k = 0; k < s; k++) { const nd = mesh.conn[s * e + k]; pts.push(...toScreen(v, mesh.xy[2 * nd], mesh.xy[2 * nd + 1])) }
      out.push({ t: 'poly', pts, closed: true, stroke: 'muted', w: 0.6 })
    }
  }
  for (const r of plate.mesh.refine) {
    const [x, y] = toScreen(v, r.x, r.y)
    out.push({ t: 'circle', x, y, r: 6, stroke: 'warning', w: 1.3 })
    out.push({ t: 'circle', x, y, r: 2, fill: 'warning', w: 1 })
  }
  if (opts.showSupports === false) return
  for (const s of plate.supports) {
    for (const [x1, y1, x2, y2] of targetGeometry(plate, s.target)) {
      const [ax, ay] = toScreen(v, x1, y1)
      const [bx, by] = toScreen(v, x2, y2)
      const l = Math.hypot(bx - ax, by - ay)
      if (l < 1) {
        out.push({ t: 'poly', pts: [ax, ay, ax - 7, ay + 12, ax + 7, ay + 12], closed: true, stroke: 'success', w: 1.6, fill: 'bgmix' })
        continue
      }
      // little hatches on the outside of the edge (the material is on the left of the directed edge)
      const nx = (by - ay) / l
      const ny = -(bx - ax) / l
      const n = Math.max(2, Math.round(l / 9))
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const px = ax + (bx - ax) * t
        const py = ay + (by - ay) * t
        const d = s.ux && s.uy ? 8 : 5
        out.push({ t: 'line', x1: px, y1: py, x2: px + nx * d - (by - ay) / l * 3, y2: py + ny * d + (bx - ax) / l * 3, c: 'success', w: 1.2 })
        if (!(s.ux && s.uy) && i % 2 === 0) out.push({ t: 'circle', x: px + nx * (d + 3), y: py + ny * (d + 3), r: 2, stroke: 'success', w: 1 })
      }
    }
  }
}

function plateLoadPrims(model: Model, v: View, opts: SceneOptions, out: Prim[]): void {
  const plate = model.plate
  if (!plate) return
  const u = opts.units
  const stress = (x: number) => valueText(x, 'stress', u)
  for (const l of plate.loads) {
    if (l.type === 'thermal') { out.push({ t: 'text', x: 12, y: v.h - 12, s: `ΔT = ${fmt(l.dT, 3)} K`, c: 'warning', size: 11 }); continue }
    if (l.type === 'point') {
      for (const [x1, y1] of targetGeometry(plate, l.target)) {
        const [x, y] = toScreen(v, x1, y1)
        const f = Math.hypot(l.fx, l.fy) || 1
        arrow(out, x - (l.fx / f) * 50, y + (l.fy / f) * 50, x, y, 'danger', 2.2)
        out.push({ t: 'text', x: x - (l.fx / f) * 54, y: y + (l.fy / f) * 54 - 4, s: valueText(f, 'force', u), c: 'danger', size: 11, anchor: 'middle' })
      }
      continue
    }
    const geo = targetGeometry(plate, l.target)
    let first = true
    for (const [x1, y1, x2, y2] of geo) {
      const [ax, ay] = toScreen(v, x1, y1)
      const [bx, by] = toScreen(v, x2, y2)
      const len = Math.hypot(bx - ax, by - ay)
      if (len < 2) continue
      // the traction on the edge: the outward normal of the material is (dy, −dx) in world coordinates
      const nxw = (y2 - y1) / (Math.hypot(x2 - x1, y2 - y1) || 1)
      const nyw = -(x2 - x1) / (Math.hypot(x2 - x1, y2 - y1) || 1)
      let tx = 0
      let ty = 0
      if (l.type === 'pressure') { tx = -l.p * nxw; ty = -l.p * nyw }
      else if (l.type === 'traction') { tx = l.tx; ty = l.ty }
      else { tx = l.fx; ty = l.fy }
      const tm = Math.hypot(tx, ty)
      if (tm === 0) continue
      const n = Math.max(1, Math.round(len / 22))
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const px = ax + (bx - ax) * t
        const py = ay + (by - ay) * t
        arrow(out, px - (tx / tm) * 30, py + (ty / tm) * 30, px, py, 'danger', 1.4, 6)
      }
      if (first) {
        const mx = (ax + bx) / 2 - (tx / tm) * 34
        const my = (ay + by) / 2 + (ty / tm) * 34
        const text = l.type === 'pressure' ? `p = ${stress(Math.abs(l.p))}` : l.type === 'traction' ? stress(tm) : `F = ${valueText(tm, 'force', u)}`
        out.push({ t: 'text', x: mx, y: my - 4, s: text, c: 'danger', size: 11, anchor: 'middle' })
        first = false
      }
    }
  }
  if (model.gravity > 0) out.push({ t: 'text', x: 12, y: v.h - 12, s: `self weight, g = ${fmt(model.gravity, 4)} m/s²`, c: 'warning', size: 11 })
}

/** Colour bar prims at the right of the view. */
export function colorBarPrims(v: View, lo: number, hi: number, cmap: ColorMapName, q: Quantity, u: Units, bands: number, title: string): Prim[] {
  const out: Prim[] = []
  const x = v.w - 34
  const h = Math.min(220, v.h - 90)
  const y0 = 46
  const n = bands > 0 ? bands : 40
  for (let i = 0; i < n; i++) {
    const t0 = 1 - (i + 1) / n
    const c = colorAt(cmap, bands > 0 ? t0 + 0.5 / n : t0 + 0.5 / n)
    const yy = y0 + (h * i) / n
    out.push({ t: 'poly', pts: [x, yy, x + 14, yy, x + 14, yy + h / n + 0.6, x, yy + h / n + 0.6], closed: true, fill: cssColor(c), stroke: cssColor(c), w: 0.5 })
  }
  out.push({ t: 'poly', pts: [x, y0, x + 14, y0, x + 14, y0 + h, x, y0 + h], closed: true, stroke: 'fg', w: 0.8 })
  const ticks = 5
  for (let i = 0; i <= ticks; i++) {
    const val = hi - ((hi - lo) * i) / ticks
    const yy = y0 + (h * i) / ticks
    out.push({ t: 'line', x1: x - 3, y1: yy, x2: x, y2: yy, c: 'fg', w: 0.8 })
    out.push({ t: 'text', x: x - 6, y: yy + 4, s: fmt(fromSI(val, q, u), 3), c: 'fg', size: 10, anchor: 'end' })
  }
  const unit = label(q, u)
  out.push({ t: 'text', x: x + 14, y: y0 - 18, s: unit ? `${title} [${unit}]` : title, c: 'fg', size: 11, anchor: 'end', bold: true })
  return out
}

/** Subdivided flat-coloured polygons of a field (for SVG exports). */
export function contourPolys(mesh: Mesh, pts: ArrayLike<number>, values: ArrayLike<number>, mode: 'nodal' | 'element', range: readonly [number, number], cmap: ColorMapName, bands: number, sub = 3): Prim[] {
  const out: Prim[] = []
  const [lo, hi] = range
  const span = hi - lo || 1
  const col = (val: number): string => {
    let t = (val - lo) / span
    if (bands > 0) t = (Math.min(bands - 1, Math.max(0, Math.floor(Math.max(0, Math.min(1, t)) * bands))) + 0.5) / bands
    return cssColor(colorAt(cmap, t))
  }
  const s = mesh.stride
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    const n = mode === 'nodal' ? sub : 1
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        // barycentric lattice: up triangles and down triangles
        const P = (p: number, q: number): [number, number, number] => {
          const r = n - p - q
          return [(p * a[0] + q * b[0] + r * c[0]) / n, (p * a[1] + q * b[1] + r * c[1]) / n, (p * a[2] + q * b[2] + r * c[2]) / n]
        }
        const cells: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [[P(i, j), P(i + 1, j), P(i, j + 1)]]
        if (j < n - i - 1) cells.push([P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)])
        for (const [p0, p1, p2] of cells) {
          const f = col((p0[2] + p1[2] + p2[2]) / 3)
          out.push({ t: 'poly', pts: [p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]], closed: true, fill: f, stroke: f, w: 0.5 })
        }
      }
    }
  }
  for (let e = 0; e < mesh.nElems; e++) {
    const nd = Array.from({ length: s }, (_, k) => mesh.conn[s * e + k])
    const val = nd.map((k) => (mode === 'nodal' ? values[k] : values[e]))
    const P = nd.map((k, i): [number, number, number] => [pts[2 * k], pts[2 * k + 1], val[i]])
    if (s === 3) tri(P[0], P[1], P[2])
    else {
      const c: [number, number, number] = [(P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4, (val[0] + val[1] + val[2] + val[3]) / 4]
      for (let k = 0; k < 4; k++) tri(P[k], P[(k + 1) % 4], c)
    }
  }
  return out
}

// ---------------------------------------------------------------------------- results

export type AnyResult = FrameResult | PlaneResult | ModalResult | BucklingResult

function frameResultPrims(model: Model, r: FrameResult, v: View, ro: ResultOptions, u: Units, out: Prim[]): void {
  if (ro.kind === 'deformed' || ro.kind === 'diagram') {
    // diagrams are drawn on the undeformed structure; the deformed shape on top of the ghost
  }
  if (ro.kind === 'deformed') {
    for (const mr of r.members) {
      const a = nodeById(model, mr.n1)
      if (!a) continue
      const c = Math.cos(mr.angle)
      const s = Math.sin(mr.angle)
      const pts: number[] = []
      for (const st of mr.stations) pts.push(...toScreen(v, a.x + st.x * c + ro.scale * st.dx, a.y + st.x * s + ro.scale * st.dy))
      out.push({ t: 'poly', pts, closed: false, stroke: 'accent', w: 2.6 })
    }
    for (const n of model.nodes) {
      const i = r.nodeIds.indexOf(n.id)
      const [x, y] = toScreen(v, n.x + ro.scale * r.u[3 * i], n.y + ro.scale * r.u[3 * i + 1])
      out.push({ t: 'circle', x, y, r: 3.2, fill: 'accent', w: 1 })
    }
    if (ro.labels) {
      for (const n of model.nodes) {
        const i = r.nodeIds.indexOf(n.id)
        const d = Math.hypot(r.u[3 * i], r.u[3 * i + 1])
        if (d <= 0) continue
        const [x, y] = toScreen(v, n.x + ro.scale * r.u[3 * i], n.y + ro.scale * r.u[3 * i + 1])
        out.push({ t: 'text', x: x + 7, y: y + 14, s: valueText(d, 'length', u), c: 'accent', size: 10 })
      }
    }
    out.push({ t: 'text', x: 12, y: 20, s: `Deformed shape ×${fmt(ro.scale, 3)}`, c: 'accent', size: 12, bold: true })
  }
  if (ro.kind === 'diagram') {
    const maxF = diagramMax(r, ro.diagram) || 1
    const heightPx = 70
    const scaleW = heightPx / v.scale / maxF // metres of offset per unit force
    const q: Quantity = ro.diagram === 'M' ? 'moment' : 'force'
    const col = ro.diagram === 'N' ? 'warning' : ro.diagram === 'V' ? 'success' : 'link'
    for (const mr of r.members) {
      const a = nodeById(model, mr.n1)
      const b = nodeById(model, mr.n2)
      if (!a || !b) continue
      const pl = diagramMember(model, mr, ro.diagram, scaleW)
      const pts: number[] = []
      for (const [x, y] of pl.pts) pts.push(...toScreen(v, x, y))
      const [ax, ay] = toScreen(v, a.x, a.y)
      const [bx, by] = toScreen(v, b.x, b.y)
      out.push({ t: 'poly', pts: [ax, ay, ...pts, bx, by], closed: true, fill: col, stroke: col, w: 1.6, alpha: 0.22 })
      // value labels at the extremes and ends
      if (ro.labels) {
        const vals = mr.stations.map((s) => (ro.diagram === 'N' ? s.N : ro.diagram === 'V' ? s.V : s.M))
        const idx = new Set<number>([0, vals.length - 1])
        let imax = 0
        vals.forEach((x, i) => { if (Math.abs(x) > Math.abs(vals[imax])) imax = i })
        idx.add(imax)
        for (const i of idx) {
          if (Math.abs(vals[i]) < 1e-9 * maxF) continue
          out.push({ t: 'text', x: pts[2 * i] + 4, y: pts[2 * i + 1] - 4, s: valueText(vals[i], q, u), c: col, size: 10 })
        }
      }
    }
    out.push({ t: 'text', x: 12, y: 20, s: ro.diagram === 'N' ? 'Axial force N (tension positive)' : ro.diagram === 'V' ? 'Shear force V' : 'Bending moment M (drawn on the tension side)', c: col, size: 12, bold: true })
  }
  if (ro.reactions) reactionPrims(r.reactions, (id) => nodeById(model, id), v, u, out)
}

function reactionPrims(reactions: FrameResult['reactions'], node: (id: string) => { x: number; y: number } | undefined, v: View, u: Units, out: Prim[]): void {
  const maxF = Math.max(1e-300, ...reactions.map((r) => Math.hypot(r.rx, r.ry)))
  for (const re of reactions) {
    const n = node(re.node)
    if (!n) continue
    const [x, y] = toScreen(v, n.x, n.y)
    const f = Math.hypot(re.rx, re.ry)
    if (f > 1e-9 * maxF) {
      const k = Math.max(0.4, f / maxF) * 46
      const dx = re.rx / f
      const dy = -re.ry / f
      arrow(out, x - dx * (k + 14), y - dy * (k + 14), x - dx * 14, y - dy * 14, 'success', 2.2)
      const parts = [Math.abs(re.rx) > 1e-9 * maxF ? `Rx ${valueText(re.rx, 'force', u)}` : '', Math.abs(re.ry) > 1e-9 * maxF ? `Ry ${valueText(re.ry, 'force', u)}` : ''].filter(Boolean)
      out.push({ t: 'text', x: x - dx * (k + 16), y: y - dy * (k + 16) + 12, s: parts.join('  '), c: 'success', size: 10, anchor: 'middle' })
    }
    if (Math.abs(re.mz) > 1e-9 * Math.max(maxF, 1)) out.push({ t: 'text', x: x + 14, y: y - 14, s: `M ${valueText(re.mz, 'moment', u)}`, c: 'success', size: 10 })
  }
}

function modeShapePrims(r: ModalResult | BucklingResult, v: View, ro: ResultOptions, u: Units, out: Prim[]): void {
  const mode = r.modes[Math.min(ro.modeIndex, r.modes.length - 1)]
  const model = r.model
  if (!mode) return
  const size = Math.max(1e-9, Math.hypot(v.w / v.scale, v.h / v.scale))
  const amp = ro.scale * 0.08 * size // shape is normalised to 1
  for (const m of model.members) {
    const i = model.nodes.findIndex((n) => n.id === m.n1)
    const j = model.nodes.findIndex((n) => n.id === m.n2)
    const a = model.nodes[i]
    const b = model.nodes[j]
    if (!a || !b) continue
    // a smooth curve through the two end states (cubic Hermite)
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    const c = (b.x - a.x) / L
    const s = (b.y - a.y) / L
    const loc = (n: number) => [c * mode.shape[3 * n] + s * mode.shape[3 * n + 1], -s * mode.shape[3 * n] + c * mode.shape[3 * n + 1], mode.shape[3 * n + 2]]
    const [u1, v1, t1] = loc(i)
    const [u2, v2, t2] = loc(j)
    const pts: number[] = []
    for (let k = 0; k <= 12; k++) {
      const x = k / 12
      const h1 = 1 - 3 * x * x + 2 * x ** 3, h2 = x - 2 * x * x + x ** 3, h3 = 3 * x * x - 2 * x ** 3, h4 = -x * x + x ** 3
      const vv = h1 * v1 + h2 * L * t1 + h3 * v2 + h4 * L * t2
      const uu = u1 + (u2 - u1) * x
      pts.push(...toScreen(v, a.x + c * (x * L + amp * uu) - s * amp * vv, a.y + s * (x * L + amp * uu) + c * amp * vv))
    }
    out.push({ t: 'poly', pts, closed: false, stroke: 'accent', w: 2.6 })
  }
  const text = r.kind === 'modal' ? `Mode ${ro.modeIndex + 1}: ${fmt((mode as ModalResult['modes'][number]).frequency, 5)} Hz` : `Buckling mode ${ro.modeIndex + 1}: load factor ${fmt((mode as BucklingResult['modes'][number]).factor, 5)}`
  out.push({ t: 'text', x: 12, y: 20, s: text, c: 'accent', size: 12, bold: true })
  void u
}

/** Everything but the shaded contour of a plate (which the canvas rasterises). */
function plateResultPrims(model: Model, r: PlaneResult, v: View, ro: ResultOptions, u: Units, out: Prim[], deformedPts: Float64Array): { range: [number, number]; values: Float64Array } {
  const spec = PLATE_FIELDS.find((f) => f.id === ro.field) ?? PLATE_FIELDS[0]
  const values = plateField(r, ro.field, ro.nodalMode)
  const ex = extremes(values)
  const range = ro.range ?? niceRange(ex.min, ex.max)
  void model
  if (ro.kind === 'contour') {
    out.push(...colorBarPrims(v, range[0], range[1], ro.cmap, spec.quantity, u, ro.bands, spec.short))
    out.push({ t: 'text', x: 12, y: 20, s: `${spec.label}${ro.kind === 'contour' ? ` (${ro.nodalMode === 'nodal' ? 'smooth, nodal averages' : 'per element'})` : ''}`, c: 'fg', size: 12, bold: true })
    if (ro.minmax && ro.nodalMode === 'nodal') {
      const mark = (i: number, text: string, c: string) => {
        const x = deformedPts[2 * i]
        const y = deformedPts[2 * i + 1]
        out.push({ t: 'circle', x, y, r: 5, stroke: c, w: 2 })
        out.push({ t: 'text', x: x + 8, y: y - 8, s: `${text} ${valueText(values[i], spec.quantity, u)}`, c: 'fg', size: 11, bold: true })
      }
      mark(ex.maxAt, 'max', 'danger')
      mark(ex.minAt, 'min', 'link')
    }
  }
  if (ro.principal) {
    const m = r.mesh
    const sIdx = m.stride
    const maxS = Math.max(1e-300, ...Array.from(r.elem.sx, Math.abs), ...Array.from(r.elem.sy, Math.abs))
    const every = Math.max(1, Math.round(m.nElems / 400))
    for (let e = 0; e < m.nElems; e += every) {
      let cx = 0, cy = 0
      for (let k = 0; k < sIdx; k++) { const nd = m.conn[sIdx * e + k]; cx += deformedPts[2 * nd] / sIdx; cy += deformedPts[2 * nd + 1] / sIdx }
      const sx = r.elem.sx[e], sy = r.elem.sy[e], t = r.elem.txy[e]
      const c = (sx + sy) / 2
      const R = Math.hypot((sx - sy) / 2, t)
      const ang = 0.5 * Math.atan2(2 * t, sx - sy)
      for (const [val, a] of [[c + R, ang], [c - R, ang + Math.PI / 2]] as const) {
        const len = Math.min(16, 3 + 13 * (Math.abs(val) / maxS))
        const dx = Math.cos(a) * len
        const dy = -Math.sin(a) * len
        out.push({ t: 'line', x1: cx - dx, y1: cy - dy, x2: cx + dx, y2: cy + dy, c: val >= 0 ? 'danger' : 'link', w: 1.3 })
      }
    }
  }
  if (ro.reactions && r.reactions.some((x) => Math.abs(x) > 0)) {
    const m = r.mesh
    // one arrow per supported node would be too busy: the total on each connected group of supported nodes is shown instead
    let tx = 0, ty = 0
    for (let i = 0; i < m.nNodes; i++) { tx += r.reactions[2 * i]; ty += r.reactions[2 * i + 1] }
    out.push({ t: 'text', x: 12, y: v.h - 12, s: `Sum of reactions: ${valueText(tx, 'force', u)}, ${valueText(ty, 'force', u)}`, c: 'success', size: 11 })
  }
  return { range, values }
}

// ---------------------------------------------------------------------------- the scene

export interface PlateDrawing {
  /** node positions in pixels (deformed when asked) for the rasteriser */
  pts: Float64Array
  values: Float64Array
  range: [number, number]
}

export interface Scene {
  prims: Prim[]
  /** for the canvas: what to rasterise under the primitives (a plate contour) */
  plate?: PlateDrawing
}

/** Positions of the nodes of a plate mesh in pixels, optionally displaced. */
export function meshPoints(mesh: Mesh, u: Float64Array | null, scale: number, v: View): Float64Array {
  const out = new Float64Array(2 * mesh.nNodes)
  for (let i = 0; i < mesh.nNodes; i++) {
    const [x, y] = toScreen(v, mesh.xy[2 * i] + (u ? scale * u[2 * i] : 0), mesh.xy[2 * i + 1] + (u ? scale * u[2 * i + 1] : 0))
    out[2 * i] = x
    out[2 * i + 1] = y
  }
  return out
}

export function buildScene(model: Model, result: AnyResult | null, v: View, opts: SceneOptions, mesh: Mesh | null = null): Scene {
  const out: Prim[] = []
  const ro = opts.result
  const showing = !!ro && ro.kind !== 'none' && !!result
  let plate: PlateDrawing | undefined
  if (opts.showGrid && opts.grid && opts.grid * v.scale > 6) {
    const g = opts.grid
    const w0 = toWorld(v, 0, v.h)
    const w1 = toWorld(v, v.w, 0)
    const gx0 = Math.floor(w0.x / g)
    const gx1 = Math.ceil(w1.x / g)
    const gy0 = Math.floor(w0.y / g)
    const gy1 = Math.ceil(w1.y / g)
    if ((gx1 - gx0) * (gy1 - gy0) < 12000) {
      for (let i = gx0; i <= gx1; i++) for (let j = gy0; j <= gy1; j++) { const [x, y] = toScreen(v, i * g, j * g); out.push({ t: 'circle', x, y, r: 0.9, fill: 'grid', w: 0 }) }
    }
  }
  if (model.plate) {
    if (showing && result!.kind === 'plane' && ro!.kind !== 'none') {
      const r = result as PlaneResult
      const pts = meshPoints(r.mesh, r.u, ro!.scale, v)
      const info = ro!.kind === 'contour' || ro!.kind === 'deformed' ? plateResultPrims(model, r, v, ro!, opts.units, [], pts) : null
      // geometry first (undeformed, light), then the contour polygons for exports, then the deformed mesh and annotations
      if (ro!.undeformed || ro!.kind !== 'contour') plateGeometryPrims(model, v, { ...opts, showMesh: false, noFill: true }, out, null)
      if (ro!.kind === 'contour' && info) {
        if (opts.contourPolys) out.push(...contourPolys(r.mesh, pts, info.values, ro!.nodalMode, info.range, ro!.cmap, ro!.bands))
        else plate = { pts, values: info.values, range: info.range }
      }
      const s = r.mesh.stride
      if (opts.showMesh || ro!.kind === 'deformed') {
        for (let e = 0; e < r.mesh.nElems; e++) {
          const pp: number[] = []
          for (let k = 0; k < s; k++) { const nd = r.mesh.conn[s * e + k]; pp.push(pts[2 * nd], pts[2 * nd + 1]) }
          out.push({ t: 'poly', pts: pp, closed: true, stroke: ro!.kind === 'contour' ? 'meshline' : 'accent', w: ro!.kind === 'contour' ? 0.5 : 1 })
        }
      }
      // the deformed outline
      for (const b of r.mesh.bsegs) out.push({ t: 'line', x1: pts[2 * b.a], y1: pts[2 * b.a + 1], x2: pts[2 * b.b], y2: pts[2 * b.b + 1], c: ro!.kind === 'contour' ? 'fg' : 'accent', w: 1.6 })
      if (info) plateResultPrims(model, r, v, ro!, opts.units, out, pts)
      if (ro!.kind === 'deformed') out.push({ t: 'text', x: 12, y: 20, s: `Deformed shape ×${fmt(ro!.scale, 3)}`, c: 'accent', size: 12, bold: true })
      if (opts.showLoads !== false) plateLoadPrims(model, v, opts, out)
    } else {
      plateGeometryPrims(model, v, opts, out, mesh)
      if (opts.showLoads !== false) plateLoadPrims(model, v, opts, out)
    }
    return { prims: out, plate }
  }
  // frames
  if (showing && (result!.kind === 'modal' || result!.kind === 'buckling')) {
    frameModelPrims(model, v, opts, out, true)
    modeShapePrims(result as ModalResult | BucklingResult, v, ro!, opts.units, out)
    return { prims: out }
  }
  if (showing && result!.kind === 'frame') {
    const r = result as FrameResult
    // the deformed shape is drawn over the undeformed one as a ghost; force diagrams are drawn on the full model
    if (ro!.kind === 'deformed') { if (ro!.undeformed) frameModelPrims(model, v, opts, out, true) }
    else frameModelPrims(model, v, opts, out, false)
    frameResultPrims(model, r, v, ro!, opts.units, out)
    return { prims: out }
  }
  frameModelPrims(model, v, opts, out, false)
  if (opts.showLoads !== false) frameLoadPrims(model, v, opts, out)
  return { prims: out }
}

// ---------------------------------------------------------------------------- SVG

export interface Palette { [key: string]: string }

export const LIGHT_PALETTE: Palette = {
  fg: '#1f2937', muted: '#6b7280', accent: '#2563eb', danger: '#dc2626', success: '#15803d', warning: '#b45309', link: '#0369a1', bg: '#ffffff', grid: '#cbd5e1', plate: '#f1f5f9', bgmix: '#ffffff', meshline: 'rgba(0,0,0,0.35)',
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0')

export function primsToSvg(prims: readonly Prim[], w: number, h: number, pal: Palette = LIGHT_PALETTE, background = true): string {
  const col = (c: string | undefined): string => (c === undefined ? 'none' : pal[c] ?? c)
  const body: string[] = []
  for (const p of prims) {
    switch (p.t) {
      case 'line':
        body.push(`<line x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(p.x2)}" y2="${num(p.y2)}" stroke="${col(p.c)}" stroke-width="${p.w}"${p.dash ? ` stroke-dasharray="${p.dash.join(' ')}"` : ''} stroke-linecap="round"/>`)
        break
      case 'poly': {
        const pts = []
        for (let i = 0; i + 1 < p.pts.length; i += 2) pts.push(`${num(p.pts[i])},${num(p.pts[i + 1])}`)
        body.push(`<${p.closed ? 'polygon' : 'polyline'} points="${pts.join(' ')}" fill="${col(p.fill)}"${p.alpha !== undefined ? ` fill-opacity="${p.alpha}"` : ''} stroke="${col(p.stroke)}" stroke-width="${p.w}" stroke-linejoin="round"/>`)
        break
      }
      case 'circle':
        body.push(`<circle cx="${num(p.x)}" cy="${num(p.y)}" r="${p.r}" fill="${col(p.fill)}" stroke="${col(p.stroke)}" stroke-width="${p.w}"/>`)
        break
      default:
        body.push(`<text x="${num(p.x)}" y="${num(p.y)}" fill="${col(p.c)}" font-size="${p.size}" font-family="Helvetica, Arial, sans-serif" text-anchor="${p.anchor ?? 'start'}"${p.bold ? ' font-weight="bold"' : ''}>${esc(p.s)}</text>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${background ? `<rect width="${w}" height="${h}" fill="${pal.bg}"/>` : ''}${body.join('')}</svg>`
}

/** A complete SVG picture of the model or of a result (for exports and reports). */
export function sceneSvg(model: Model, result: AnyResult | null, opts: SceneOptions, w = 900, h = 600, box?: { x0: number; y0: number; x1: number; y1: number }): string {
  const b = box ?? sceneBox(model, result)
  const v = fitView(b, w, h, 70)
  const sc = buildScene(model, result, v, { ...opts, contourPolys: true, showGrid: false })
  return primsToSvg(sc.prims, w, h)
}

/** The box to fit: the model, or the displaced mode shapes. */
export function sceneBox(model: Model, _result?: AnyResult | null): { x0: number; y0: number; x1: number; y1: number } {
  const pts: Pt[] = model.nodes.map((n) => ({ x: n.x, y: n.y }))
  if (model.plate) pts.push(...model.plate.outline)
  if (!pts.length) return { x0: -1, y0: -1, x1: 1, y1: 1 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  const pad = Math.max(x1 - x0, y1 - y0, 1e-9) * 0.06
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad }
}

