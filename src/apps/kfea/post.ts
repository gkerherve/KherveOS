// Post-processing (pure): the fields of a plate result, colour scales, a software rasteriser for smooth contour
// images, probes, and the geometry of deformed shapes and force diagrams of frames.
// The colour scales are fixed scientific scales (they do not follow the theme).

import type { FrameResult, MemberResult } from './frame.ts'
import type { Mesh } from './mesh.ts'
import type { Model } from './model.ts'
import { derivedStress, type PlaneResult } from './plane.ts'
import type { Quantity } from './units.ts'

// ---------------------------------------------------------------------------- colour scales

export type ColorMapName = 'rainbow' | 'viridis' | 'coolwarm' | 'turbo' | 'grey'

export const COLORMAPS: Record<ColorMapName, string> = {
  rainbow: 'Rainbow (blue to red)', viridis: 'Viridis', coolwarm: 'Cool–warm (diverging)', turbo: 'Turbo', grey: 'Grey',
}

const STOPS: Record<ColorMapName, Array<[number, number, number]>> = {
  rainbow: [[0, 0, 255], [0, 140, 255], [0, 220, 220], [0, 200, 60], [170, 230, 0], [255, 200, 0], [255, 100, 0], [255, 0, 0]],
  viridis: [[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88], [181, 222, 43], [253, 231, 37]],
  coolwarm: [[59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249], [221, 221, 221], [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38]],
  turbo: [[48, 18, 59], [70, 107, 227], [40, 187, 236], [49, 242, 153], [163, 253, 61], [237, 207, 58], [251, 126, 33], [210, 49, 5], [122, 4, 3]],
  grey: [[30, 30, 30], [235, 235, 235]],
}

/** The colour of t in [0, 1] on a scale, as [r, g, b]. */
export function colorAt(map: ColorMapName, t: number): [number, number, number] {
  const s = STOPS[map]
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (s.length - 1)
  const i = Math.min(s.length - 2, Math.floor(x))
  const f = x - i
  return [s[i][0] + (s[i + 1][0] - s[i][0]) * f, s[i][1] + (s[i + 1][1] - s[i][1]) * f, s[i][2] + (s[i + 1][2] - s[i][2]) * f]
}

export const cssColor = (c: readonly number[]): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`

// ---------------------------------------------------------------------------- fields of a plate

export type PlateField = 'disp' | 'ux' | 'uy' | 'sx' | 'sy' | 'txy' | 'vm' | 'p1' | 'p2' | 'tmax' | 'sed' | 'sf'

export const PLATE_FIELDS: Array<{ id: PlateField; label: string; quantity: Quantity; short: string }> = [
  { id: 'vm', label: 'von Mises stress', quantity: 'stress', short: 'σ vM' },
  { id: 'sx', label: 'Normal stress σx', quantity: 'stress', short: 'σx' },
  { id: 'sy', label: 'Normal stress σy', quantity: 'stress', short: 'σy' },
  { id: 'txy', label: 'Shear stress τxy', quantity: 'stress', short: 'τxy' },
  { id: 'p1', label: 'Maximum principal stress σ1', quantity: 'stress', short: 'σ1' },
  { id: 'p2', label: 'Minimum principal stress σ2', quantity: 'stress', short: 'σ2' },
  { id: 'tmax', label: 'Maximum shear stress', quantity: 'stress', short: 'τmax' },
  { id: 'sed', label: 'Strain energy density', quantity: 'stress', short: 'W' },
  { id: 'sf', label: 'Safety factor (yield / von Mises)', quantity: 'none', short: 'SF' },
  { id: 'disp', label: 'Displacement magnitude', quantity: 'length', short: '|u|' },
  { id: 'ux', label: 'Displacement ux', quantity: 'length', short: 'ux' },
  { id: 'uy', label: 'Displacement uy', quantity: 'length', short: 'uy' },
]

export const SF_CAP = 10

/** The values of a field at the nodes (smooth, averaged) or at the elements (one value each), SI. */
export function plateField(r: PlaneResult, field: PlateField, mode: 'nodal' | 'element'): Float64Array {
  const m = r.mesh
  const nodalMode = mode === 'nodal'
  const count = nodalMode ? m.nNodes : m.nElems
  const out = new Float64Array(count)
  const set = nodalMode ? r.nodal : r.elem
  const nodeMean = (f: (i: number) => number): void => {
    // element value of a displacement field: the mean of its nodes
    const s = m.stride
    for (let e = 0; e < m.nElems; e++) { let a = 0; for (let k = 0; k < s; k++) a += f(m.conn[s * e + k]); out[e] = a / s }
  }
  switch (field) {
    case 'ux': if (nodalMode) for (let i = 0; i < count; i++) out[i] = r.u[2 * i]; else nodeMean((i) => r.u[2 * i]); break
    case 'uy': if (nodalMode) for (let i = 0; i < count; i++) out[i] = r.u[2 * i + 1]; else nodeMean((i) => r.u[2 * i + 1]); break
    case 'disp': if (nodalMode) for (let i = 0; i < count; i++) out[i] = Math.hypot(r.u[2 * i], r.u[2 * i + 1]); else nodeMean((i) => Math.hypot(r.u[2 * i], r.u[2 * i + 1])); break
    case 'sx': out.set(set.sx); break
    case 'sy': out.set(set.sy); break
    case 'txy': out.set(set.txy); break
    case 'sed': out.set(nodalMode ? r.nodalEnergy : r.elemEnergy); break
    default:
      for (let i = 0; i < count; i++) {
        const d = derivedStress(set.sx[i], set.sy[i], set.txy[i], set.sz[i])
        out[i] = field === 'vm' ? d.vm : field === 'p1' ? d.p1 : field === 'p2' ? d.p2 : field === 'tmax' ? d.tmax : d.vm > 0 ? Math.min(SF_CAP, r.yield / d.vm) : SF_CAP
      }
  }
  return out
}

export interface Extremes { min: number; max: number; minAt: number; maxAt: number }

export function extremes(v: ArrayLike<number>): Extremes {
  let min = Infinity, max = -Infinity, minAt = 0, maxAt = 0
  for (let i = 0; i < v.length; i++) {
    if (v[i] < min) { min = v[i]; minAt = i }
    if (v[i] > max) { max = v[i]; maxAt = i }
  }
  if (!v.length) return { min: 0, max: 0, minAt: 0, maxAt: 0 }
  return { min, max, minAt, maxAt }
}

/** Nice round limits for a colour bar. */
export function niceRange(min: number, max: number): [number, number] {
  if (!(max > min)) { const d = Math.abs(max) > 0 ? Math.abs(max) * 0.1 : 1; return [min - d, max + d] }
  return [min, max]
}

// ---------------------------------------------------------------------------- rasteriser

/**
 * Draws the mesh coloured by a field into an RGBA buffer (w×h). `pts` are the node positions in pixels
 * (2 per node). Nodal values are interpolated linearly in every triangle (a quad is drawn as four triangles around
 * its centre), element values are flat. `bands` > 0 quantises the colours into contour bands. Pixels not covered are
 * left as they are.
 */
export function rasterize(
  buf: Uint8ClampedArray, w: number, h: number, pts: ArrayLike<number>, mesh: Mesh, values: ArrayLike<number>, mode: 'nodal' | 'element',
  range: readonly [number, number], map: ColorMapName, bands = 0, alpha = 255,
): void {
  const [lo, hi] = range
  const span = hi - lo || 1
  const colorOf = (v: number): [number, number, number] => {
    let t = (v - lo) / span
    if (bands > 0) t = (Math.min(bands - 1, Math.max(0, Math.floor(Math.max(0, Math.min(1, t)) * bands))) + 0.5) / bands
    return colorAt(map, t)
  }
  const tri = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, v0: number, v1: number, v2: number) => {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
    const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)))
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
    const maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)))
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if (Math.abs(den) < 1e-12) return
    const eps = -1e-7
    const flat = v0 === v1 && v1 === v2
    const flatColor = flat ? colorOf(v0) : null
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den
        const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den
        const l2 = 1 - l0 - l1
        if (l0 < eps || l1 < eps || l2 < eps) continue
        const c = flatColor ?? colorOf(l0 * v0 + l1 * v1 + l2 * v2)
        const o = 4 * (y * w + x)
        buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = alpha
      }
    }
  }
  const s = mesh.stride
  for (let e = 0; e < mesh.nElems; e++) {
    const n = Array.from({ length: s }, (_, k) => mesh.conn[s * e + k])
    const v = n.map((nd) => (mode === 'nodal' ? values[nd] : values[e]))
    if (s === 3) tri(pts[2 * n[0]], pts[2 * n[0] + 1], pts[2 * n[1]], pts[2 * n[1] + 1], pts[2 * n[2]], pts[2 * n[2] + 1], v[0], v[1], v[2])
    else {
      const cx = (pts[2 * n[0]] + pts[2 * n[1]] + pts[2 * n[2]] + pts[2 * n[3]]) / 4
      const cy = (pts[2 * n[0] + 1] + pts[2 * n[1] + 1] + pts[2 * n[2] + 1] + pts[2 * n[3] + 1]) / 4
      const vc = (v[0] + v[1] + v[2] + v[3]) / 4
      for (let k = 0; k < 4; k++) {
        const a = n[k]
        const b = n[(k + 1) % 4]
        tri(pts[2 * a], pts[2 * a + 1], pts[2 * b], pts[2 * b + 1], cx, cy, v[k], v[(k + 1) % 4], vc)
      }
    }
  }
}

// ---------------------------------------------------------------------------- probes

export interface PlateProbe {
  element: number
  /** SI values of every field at the point (nodal interpolation) */
  values: Record<PlateField, number>
  /** the element-wise (unaveraged) values */
  elementValues: Record<PlateField, number>
}

/** Barycentric coordinates of (x, y) in a triangle, or null when outside. */
export function barycentric(x: number, y: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): [number, number, number] | null {
  const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
  if (Math.abs(den) < 1e-300) return null
  const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den
  const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den
  const l2 = 1 - l0 - l1
  const e = -1e-9
  return l0 >= e && l1 >= e && l2 >= e ? [l0, l1, l2] : null
}

/** The element under a point of the undeformed plate, with every field interpolated there. */
export function probePlate(r: PlaneResult, x: number, y: number): PlateProbe | null {
  const m = r.mesh
  const s = m.stride
  const nodal = new Map<PlateField, Float64Array>()
  const elemF = new Map<PlateField, Float64Array>()
  const get = (store: Map<PlateField, Float64Array>, f: PlateField, mode: 'nodal' | 'element') => {
    let a = store.get(f)
    if (!a) { a = plateField(r, f, mode); store.set(f, a) }
    return a
  }
  for (let e = 0; e < m.nElems; e++) {
    const n = Array.from({ length: s }, (_, k) => m.conn[s * e + k])
    const tris: number[][] = s === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]]
    for (const t of tris) {
      const [a, b, c] = t.map((k) => n[k])
      const bc = barycentric(x, y, m.xy[2 * a], m.xy[2 * a + 1], m.xy[2 * b], m.xy[2 * b + 1], m.xy[2 * c], m.xy[2 * c + 1])
      if (!bc) continue
      const values = {} as Record<PlateField, number>
      const elementValues = {} as Record<PlateField, number>
      for (const f of PLATE_FIELDS) {
        const nv = get(nodal, f.id, 'nodal')
        values[f.id] = bc[0] * nv[a] + bc[1] * nv[b] + bc[2] * nv[c]
        elementValues[f.id] = get(elemF, f.id, 'element')[e]
      }
      return { element: e, values, elementValues }
    }
  }
  return null
}

// ---------------------------------------------------------------------------- frames: deformed shape and diagrams

export type DiagramKind = 'N' | 'V' | 'M' | 'defl'

export interface Polyline { pts: Array<[number, number]>; values: number[] }

/** The position of a point of a member, with its displacement magnified. */
export function deformedMember(model: Model, mr: MemberResult, scale: number): Array<[number, number]> {
  const a = model.nodes.find((n) => n.id === mr.n1)!
  const c = Math.cos(mr.angle)
  const s = Math.sin(mr.angle)
  return mr.stations.map((st) => [a.x + st.x * c + scale * st.dx, a.y + st.x * s + scale * st.dy])
}

/** Largest force of the kind over all members (for the scale). */
export function diagramMax(r: FrameResult, kind: DiagramKind): number {
  let m = 0
  for (const mr of r.members) for (const st of mr.stations) m = Math.max(m, Math.abs(kind === 'N' ? st.N : kind === 'V' ? st.V : kind === 'M' ? st.M : 0))
  return m
}

/** Points of a force diagram drawn beside the member: V and N on the left (local +y), M on the tension side. */
export function diagramMember(model: Model, mr: MemberResult, kind: Exclude<DiagramKind, 'defl'>, scale: number): Polyline {
  const a = model.nodes.find((n) => n.id === mr.n1)!
  const c = Math.cos(mr.angle)
  const s = Math.sin(mr.angle)
  const sign = kind === 'M' ? -1 : 1
  const pts: Array<[number, number]> = []
  const values: number[] = []
  for (const st of mr.stations) {
    const v = kind === 'N' ? st.N : kind === 'V' ? st.V : st.M
    const off = sign * v * scale
    pts.push([a.x + st.x * c - s * off, a.y + st.x * s + c * off])
    values.push(v)
  }
  return { pts, values }
}

export interface MemberProbe { member: string; x: number; N: number; V: number; M: number; dx: number; dy: number; stress: number }

/** The member nearest to a point, with the forces at the nearest station. */
export function probeFrame(model: Model, r: FrameResult, px: number, py: number, maxDist: number): MemberProbe | null {
  let best: MemberProbe | null = null
  let bd = maxDist
  for (const mr of r.members) {
    const a = model.nodes.find((n) => n.id === mr.n1)!
    const c = Math.cos(mr.angle)
    const s = Math.sin(mr.angle)
    const t = Math.max(0, Math.min(mr.L, (px - a.x) * c + (py - a.y) * s))
    const d = Math.hypot(px - (a.x + t * c), py - (a.y + t * s))
    if (d >= bd) continue
    let st = mr.stations[0]
    for (const q of mr.stations) if (Math.abs(q.x - t) < Math.abs(st.x - t)) st = q
    const mem = model.sections.find((x) => x.id === model.members.find((mm) => mm.id === mr.id)?.section)
    bd = d
    best = { member: mr.id, x: st.x, N: st.N, V: st.V, M: st.M, dx: st.dx, dy: st.dy, stress: mem ? Math.abs(st.N) / mem.A + (mem.Z > 0 ? Math.abs(st.M) / mem.Z : 0) : 0 }
  }
  return best
}

/** A scale that makes the largest displacement a given fraction of the model size. */
export function autoScale(maxDisp: number, size: number, fraction = 0.1): number {
  if (!(maxDisp > 0) || !(size > 0)) return 1
  const raw = (fraction * size) / maxDisp
  const mag = 10 ** Math.floor(Math.log10(raw))
  return Math.max(1, Math.round(raw / mag) * mag)
}
