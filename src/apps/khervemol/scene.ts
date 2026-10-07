// A structure laid out for drawing — the desktop's glview.Scene: spread
// atom positions, radii per style, colours, sticks, cell edges, polyhedra
// and notes, the camera fit, hit-testing and the vertex arrays the WebGL
// shaders (ported from glshaders.py) draw. No WebGL in here.

import { covalentRadius, radius, vdw, color as cpk } from './elements.ts'
import { applyColors, coordinationPolyhedra } from './molcolor.ts'
import { centroid as centroidOf } from './model.ts'
import type { Atom, Bond, Mol, Note, Vec3 } from './types.ts'
import { hexRgb } from './molrepr.ts'

export const SEL_COLOR = '#159c74'
export const CO_SEL_COLOR = '#7fbf3f'
export const CELL_COLOR = '#d98324'
export const STYLES = ['ball_and_stick', 'space_filling', 'sticks'] as const
export type Style = (typeof STYLES)[number]
export const STYLE_LABELS: Record<Style, string> = { ball_and_stick: 'Ball & stick', space_filling: 'Space filling', sticks: 'Sticks' }
export const STICK_RADIUS: Record<Style, number> = { ball_and_stick: 0.1, space_filling: 0, sticks: 0.13 }
export const STICK_BALL = 0.16
export const POLY_ALPHA = 0.32
export const BG_TOP = '#fdfdfe'
export const BG_BOTTOM = '#d5dde8'

export type RGB = [number, number, number]
export function rgb(color: string): RGB {
  const [r, g, b] = hexRgb(color)
  return [r / 255, g / 255, b / 255]
}

export function ballRadius(element: string, style: Style, rscale = 1): number {
  if (style === 'space_filling') return vdw(element) ?? 1.5 * covalentRadius(element)
  if (style === 'sticks') return STICK_BALL
  return radius(element) * rscale
}

export function spreadFactor(mol: Pick<Mol, 'bond'>, style: Style): number {
  if (style === 'space_filling') return 1
  return mol.bond == null ? 1 : Number(mol.bond)
}

/** (right, up, toward-viewer) unit vectors of the isometric camera of model._proj. */
export function viewBasis(az: number, el: number): [Vec3, Vec3, Vec3] {
  const ca = Math.cos(az), sa = Math.sin(az)
  const ce = Math.cos(el), se = Math.sin(el)
  return [
    [ca, -sa, 0],
    [-sa * se, -ca * se, ce],
    [sa * ce, ca * ce, se],
  ]
}

const sub = (p: Vec3, c: Vec3): Vec3 => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function spreadPoint(p: Vec3, c: Vec3, f: number): Vec3 {
  return [c[0] + (p[0] - c[0]) * f, c[1] + (p[1] - c[1]) * f, c[2] + (p[2] - c[2]) * f]
}

/** model._spread for atoms and edges. */
export function spread(atoms: readonly Atom[], edges: readonly (readonly unknown[])[] | null, factor: number, centroid?: Vec3 | null): { atoms: Atom[]; edges: [Vec3, Vec3, string][] | null } {
  const ed = edges ? edges.map((e) => [e[0] as Vec3, e[1] as Vec3, (e.length > 2 ? (e[2] as string) : 'solid')] as [Vec3, Vec3, string]) : null
  if (factor === 1 || !atoms.length) return { atoms: atoms as Atom[], edges: ed }
  const c = centroid ?? centroidOf(atoms)
  const at = atoms.map((a) => {
    const p = spreadPoint([a[1], a[2], a[3]], c, factor)
    return [a[0], p[0], p[1], p[2], ...a.slice(4)] as unknown as Atom
  })
  return { atoms: at, edges: ed ? ed.map(([p, q, s]) => [spreadPoint(p, c, factor), spreadPoint(q, c, factor), s] as [Vec3, Vec3, string]) : null }
}

function spreadNotes(notes: readonly Note[], factor: number, c: Vec3): Note[] {
  return notes.map((n) => {
    const out: Note = { ...n }
    for (const k of ['pos', 'p1', 'p2'] as const) if (out[k]) out[k] = spreadPoint(out[k]!, c, factor)
    return out
  })
}

/** glview.extent_of: (centre, bounding-sphere radius) of atoms, edges and notes. */
export function extentOf(pos: readonly Vec3[], radii: readonly number[], edges: readonly (readonly [Vec3, Vec3, ...unknown[]])[] = [], notes: readonly Note[] = []): [Vec3, number] {
  const pts: [Vec3, number][] = pos.map((p, i) => [p, radii[i]])
  for (const e of edges) pts.push([e[0], 0], [e[1], 0])
  for (const n of notes) {
    if (n.kind === 'text') {
      const size = Number(n.size ?? 1)
      pts.push([n.pos!, 0.32 * size * String(n.text ?? '').length + 0.4 * size])
    } else pts.push([n.p1!, 0], [n.p2!, 0])
  }
  if (!pts.length) return [[0, 0, 0], 1]
  const lo = [0, 1, 2].map((k) => Math.min(...pts.map(([p, r]) => p[k] - r)))
  const hi = [0, 1, 2].map((k) => Math.max(...pts.map(([p, r]) => p[k] + r)))
  const c: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
  let bound = 0
  for (const [p, r] of pts) bound = Math.max(bound, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) + r)
  return [c, bound]
}

export interface Frozen {
  centroid: Vec3
  center: Vec3
  bound: number
}

/** glview.tilt_anchor: a tilted supercell is laid out on its untilted geometry. */
export function tiltAnchor(mol: Mol, style: Style, factor: number): Frozen | null {
  const base = mol.anchor_base
  if (!base || !base.gl) return null
  const c0 = centroidOf(base.atoms)
  const sp = spread(base.atoms, base.edges as unknown as [Vec3, Vec3][], factor, c0)
  const pos = sp.atoms.map((a) => [a[1], a[2], a[3]] as Vec3)
  const radii = sp.atoms.map((a) => ballRadius(a[0], style, base.rscale))
  const [center, bound] = extentOf(pos, radii, sp.edges ?? [])
  return { centroid: c0, center, bound }
}

type ViewCache = { key: string; coords: Vec3[]; pan: [number, number]; half: [number, number] }

export class Scene {
  readonly style: Style
  readonly factor: number
  readonly atoms: Atom[]
  readonly pos: Vec3[]
  readonly elems: string[]
  readonly radii: number[]
  readonly colors: RGB[]
  readonly hex: string[]
  readonly bonds: [number, number, number][]
  readonly stick: number
  readonly edges: [Vec3, Vec3, string][]
  readonly poly: boolean
  readonly notes: Note[]
  readonly tight: boolean
  readonly centroid: Vec3
  readonly center: Vec3
  readonly bound: number
  private _faces: [Vec3[], RGB][] | null = null
  private cache: ViewCache | null = null

  constructor(mol: Mol, style: Style = 'ball_and_stick', frozen: Frozen | null = null) {
    this.style = (STYLES as readonly string[]).includes(style) ? style : 'ball_and_stick'
    this.factor = spreadFactor(mol, this.style)
    let raw = mol.atoms
    if (mol.colors && Object.keys(mol.colors).length) raw = applyColors(raw, mol.colors)
    if (frozen === null) frozen = tiltAnchor(mol, this.style, this.factor)
    const cen = frozen ? frozen.centroid : null
    const shown = mol.cell_visible ? mol.edges : null
    const sp = spread(raw, shown, this.factor, cen)
    this.centroid = cen ?? centroidOf(raw)
    this.atoms = sp.atoms
    this.pos = sp.atoms.map((a) => [a[1], a[2], a[3]])
    this.elems = sp.atoms.map((a) => a[0])
    this.radii = this.elems.map((e) => ballRadius(e, this.style, mol.rscale))
    this.hex = sp.atoms.map((a) => (a.length > 4 && a[4] ? (a[4] as string) : cpk(a[0])))
    this.colors = this.hex.map(rgb)
    this.bonds = mol.bonds.filter((b) => b[0] < this.pos.length && b[1] < this.pos.length).map((b) => [b[0], b[1], b[2]])
    this.stick = STICK_RADIUS[this.style]
    this.edges = sp.edges ?? []
    this.poly = !!mol.poly
    let notes = mol.notes
    if (notes && sp.atoms.length && this.factor !== 1) notes = spreadNotes(notes, this.factor, this.centroid)
    this.notes = (notes ?? []).filter((n) => n.kind === 'text' || n.kind === 'arrow')
    this.tight = this.notes.length > 0
    if (frozen) {
      this.center = frozen.center
      this.bound = frozen.bound
    } else {
      ;[this.center, this.bound] = extentOf(this.pos, this.radii, this.edges, this.notes)
    }
  }

  freeze(): Frozen {
    return { centroid: this.centroid, center: this.center, bound: this.bound }
  }

  /** Pixels per Å that fit the model in (w, h) at zoom 1. */
  fitPpa(w: number, h: number, az?: number, el?: number, margin = 0.04): number {
    if (this.tight && az !== undefined && el !== undefined) {
      let [hx, hy] = this.view(az, el).half
      hx = Math.max(hx, 0.5)
      hy = Math.max(hy, 0.5)
      return Math.min((w * (0.5 - margin)) / hx, (h * (0.5 - margin)) / hy)
    }
    const bound = Math.max(this.bound, 1.5)
    return (0.5 * Math.min(w, h) * (1 - 2 * margin)) / bound
  }

  relView(p: Vec3, az: number, el: number): Vec3 {
    const [r, u, f] = viewBasis(az, el)
    const d = sub(p, this.center)
    return [dot(d, r), dot(d, u), dot(d, f)]
  }

  noteBox(note: Note, az: number, el: number): [number, number][] {
    if (note.kind === 'arrow') return [note.p1!, note.p2!].map((p) => this.relView(p, az, el).slice(0, 2) as [number, number])
    const [x, y] = this.relView(note.pos!, az, el)
    const size = Number(note.size ?? 1)
    const hw = 0.32 * size * String(note.text ?? '').length
    const hh = 0.62 * size
    return [
      [x - hw, y - hh],
      [x + hw, y + hh],
    ]
  }

  view(az: number, el: number): ViewCache {
    const key = `${az}|${el}`
    if (this.cache && this.cache.key === key) return this.cache
    let coords = this.pos.map((p) => this.relView(p, az, el))
    let pan: [number, number] = [0, 0]
    let half: [number, number] = [0, 0]
    if (this.tight) {
      const xs: number[] = [], ys: number[] = []
      coords.forEach(([x, y], i) => {
        const r = this.radii[i]
        xs.push(x - r, x + r)
        ys.push(y - r, y + r)
      })
      for (const e of this.edges) {
        for (const q of [e[0], e[1]]) {
          const v = this.relView(q, az, el)
          xs.push(v[0])
          ys.push(v[1])
        }
      }
      for (const n of this.notes) {
        for (const [x, y] of this.noteBox(n, az, el)) {
          xs.push(x)
          ys.push(y)
        }
      }
      if (xs.length) {
        const mnx = Math.min(...xs), mxx = Math.max(...xs), mny = Math.min(...ys), mxy = Math.max(...ys)
        pan = [(mnx + mxx) / 2, (mny + mxy) / 2]
        half = [(mxx - mnx) / 2, (mxy - mny) / 2]
      }
    }
    coords = coords.map(([x, y, z]) => [x - pan[0], y - pan[1], z])
    this.cache = { key, coords, pan, half }
    return this.cache
  }

  pan(az: number, el: number): [number, number] {
    return this.view(az, el).pan
  }

  /** [(sx, sy, depth)] in pixels (y down). */
  screen(az: number, el: number, ppa: number, w: number, h: number): Vec3[] {
    return this.view(az, el).coords.map(([x, y, z]) => [w / 2 + x * ppa, h / 2 - y * ppa, z])
  }

  screenPoint(p: Vec3, az: number, el: number, ppa: number, w: number, h: number): [number, number] {
    const pan = this.view(az, el).pan
    const [x, y] = this.relView(p, az, el)
    return [w / 2 + (x - pan[0]) * ppa, h / 2 - (y - pan[1]) * ppa]
  }

  /** The front-most atom whose disc holds the pixel. */
  pickAtom(sx: number, sy: number, az: number, el: number, ppa: number, w: number, h: number): number | null {
    let best: number | null = null, bestZ = -1e30
    this.screen(az, el, ppa, w, h).forEach(([x, y, z], i) => {
      const rp = this.radii[i] * ppa
      const d2 = (sx - x) ** 2 + (sy - y) ** 2
      if (d2 <= rp * rp) {
        const front = z + Math.sqrt(Math.max(rp * rp - d2, 0)) / ppa
        if (front > bestZ) {
          best = i
          bestZ = front
        }
      }
    })
    return best
  }

  /** The bond whose projected stick passes within a few pixels. */
  pickBond(sx: number, sy: number, az: number, el: number, ppa: number, w: number, h: number, slack = 4): number | null {
    const pts = this.screen(az, el, ppa, w, h)
    const tol = Math.max(slack, this.stick * 2.6 * ppa)
    let best: number | null = null, bestD = tol
    this.bonds.forEach(([i, j], bi) => {
      const [x1, y1] = pts[i], [x2, y2] = pts[j]
      const dx = x2 - x1, dy = y2 - y1
      const ln = dx * dx + dy * dy
      const t = ln < 1e-9 ? 0 : Math.max(0, Math.min(1, ((sx - x1) * dx + (sy - y1) * dy) / ln))
      const d = Math.hypot(sx - (x1 + t * dx), sy - (y1 + t * dy))
      if (d <= bestD) {
        best = bi
        bestD = d
      }
    })
    return best
  }

  // ------------------------------------------------------ vertex arrays

  sphereData(): Float32Array {
    const out = new Float32Array(this.pos.length * 6 * 9)
    let o = 0
    this.pos.forEach((p, i) => {
      const r = this.radii[i], c = this.colors[i]
      for (const [cx, cy] of QUAD) {
        out.set([p[0], p[1], p[2], cx, cy, r, c[0], c[1], c[2]], o)
        o += 9
      }
    })
    return out
  }

  faces(): [Vec3[], RGB][] {
    if (!this.poly) return []
    if (!this._faces) this._faces = coordinationPolyhedra(this.atoms, this.bonds).map(([f, c]) => [f, rgb(c)])
    return this._faces
  }

  polyData(): Float32Array {
    const out: number[] = []
    for (const [face, c] of this.faces()) {
      if (face.length < 3) continue
      const a = face[0]
      for (let k = 1; k < face.length - 1; k++) {
        const b = face[k], d = face[k + 1]
        const u = sub(b, a), v = sub(d, a)
        let n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        const ln = Math.hypot(n[0], n[1], n[2]) || 1
        n = [n[0] / ln, n[1] / ln, n[2] / ln]
        for (const q of [a, b, d]) out.push(q[0], q[1], q[2], n[0], n[1], n[2], c[0], c[1], c[2])
      }
    }
    return new Float32Array(out)
  }

  haloData(selection: readonly number[], primary: number | null, color?: string): Float32Array {
    const out: number[] = []
    for (const i of selection) {
      if (i < 0 || i >= this.pos.length) continue
      const p = this.pos[i]
      const c = rgb(color ?? (i === primary ? SEL_COLOR : CO_SEL_COLOR))
      const r = this.radii[i]
      for (const [cx, cy] of QUAD) out.push(p[0], p[1], p[2], cx, cy, r, c[0], c[1], c[2])
    }
    return new Float32Array(out)
  }

  private segment(out: number[], p0: Vec3, p1: Vec3, radius: number, off: number, color: RGB) {
    for (const [u, v] of CQUAD) out.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], u, v, radius, off, color[0], color[1], color[2])
  }

  cylinderData(): Float32Array {
    const out: number[] = []
    const rb = this.stick
    if (rb > 0) {
      for (const [i, j, order] of this.bonds) {
        const p = this.pos[i], q = this.pos[j]
        if (p[0] === q[0] && p[1] === q[1] && p[2] === q[2]) continue
        const mid: Vec3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
        const ci = this.colors[i], cj = this.colors[j]
        let tubes: [number, number][]
        if (order <= 1) tubes = [[0, rb]]
        else if (order === 2) {
          const t = rb * 0.68
          tubes = [
            [-1.15 * t, t],
            [1.15 * t, t],
          ]
        } else {
          const t = rb * 0.58
          tubes = [
            [-2.2 * t, t],
            [0, t],
            [2.2 * t, t],
          ]
        }
        const same = ci[0] === cj[0] && ci[1] === cj[1] && ci[2] === cj[2]
        for (const [off, rad] of tubes) {
          if (same) this.segment(out, p, q, rad, off, ci)
          else {
            this.segment(out, p, mid, rad, off, ci)
            this.segment(out, mid, q, rad, off, cj)
          }
        }
      }
    }
    for (const e of this.edges) {
      if (e[2] === 'dash') this.dashes(out, e[0], e[1])
      else this.segment(out, e[0], e[1], -0.034, 0, [0.13, 0.15, 0.19])
    }
    this.polyEdges(out)
    return new Float32Array(out)
  }

  private polyEdges(out: number[]) {
    const seen = new Set<string>()
    const k4 = (p: Vec3) => p.map((x) => (Math.round(x * 1e4) / 1e4).toFixed(4)).join(',')
    for (const [face, c] of this.faces()) {
      const dark: RGB = [c[0] * 0.65, c[1] * 0.65, c[2] * 0.65]
      const n = face.length
      for (let k = 0; k < n; k++) {
        const p = face[k], q = face[(k + 1) % n]
        const key = [k4(p), k4(q)].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        this.segment(out, p, q, -0.02, 0, dark)
      }
    }
  }

  private dashes(out: number[], p: Vec3, q: Vec3, dash = 0.17, gap = 0.13) {
    const length = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
    if (length < 1e-6) return
    const step = Math.max(dash + gap, length / 240)
    const d = step > dash + gap ? (dash * step) / (dash + gap) : dash
    const u: Vec3 = [(q[0] - p[0]) / length, (q[1] - p[1]) / length, (q[2] - p[2]) / length]
    const col: RGB = [0.36, 0.39, 0.45]
    for (let pos = 0; pos < length; pos += step) {
      const end = Math.min(pos + d, length)
      this.segment(out, [p[0] + u[0] * pos, p[1] + u[1] * pos, p[2] + u[2] * pos], [p[0] + u[0] * end, p[1] + u[1] * end, p[2] + u[2] * end], -0.02, 0, col)
    }
  }
}

const QUAD: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, -1],
  [1, 1],
  [-1, 1],
]
const CQUAD: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 1],
  [0, -1],
  [1, 1],
  [0, 1],
]

export type { Bond }
