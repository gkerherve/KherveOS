// The classic renderer: the desktop's model._model (a depth-sorted list of
// shape specs — lit spheres, sticks, cell edges, polyhedra, notes) and
// render.py's painting of those specs, here on a Canvas 2D. Used by the
// "Classic (vector drawing)" 3D renderer, the Explorer preview, the PNG
// export of the classic view and the 2D sketch export.

import { color as cpk, radius } from './elements.ts'
import { applyColors, coordinationPolyhedra, type LegendEntry } from './molcolor.ts'
import { centroid as centroidOf, proj, DEFAULT_AZ, DEFAULT_EL } from './model.ts'
import { luma, mix } from './molrepr.ts'
import { spread } from './scene.ts'
import type { Atom, Bond, Mol, Note, Vec3 } from './types.ts'

const BOND_COLOR = '#6b6f76'
const FRAME_COLOR = '#202020'
const EDGE_COLOR = '#555555'

export interface Fill {
  kind: 'sun' | 'radial' | 'linear' | 'solid'
  c1: string
  c2?: string
}

export interface Spec {
  shape: 'circle' | 'ellipse' | 'line' | 'polygon' | 'text' | string
  x?: number
  y?: number
  w?: number
  h?: number
  x1?: number
  y1?: number
  x2?: number
  y2?: number
  points?: [number, number][]
  stroke?: string
  width?: number
  fill?: string | Fill
  opacity?: number
  text?: string
  size?: number
  bold?: boolean
  anchor?: string
  _atom?: number
  _bond?: number
}

export function atomSpecs(cx: number, cy: number, r: number, element: string, label = false, color: string | null = null): Spec[] {
  const body = color || cpk(element)
  const spec: Spec = {
    shape: 'circle', x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, stroke: mix(body, '#000000', 0.52), width: Math.max(0.8, r * 0.1),
    fill: { kind: 'sun', c1: mix(body, '#000000', 0.4), c2: mix(body, '#ffffff', 0.62) },
  }
  if (!label) return [spec]
  const ink = luma(body) > 0.6 ? '#161616' : '#ffffff'
  return [spec, { shape: 'text', text: element, x: cx, y: cy, anchor: 'center', size: Math.max(6, Math.trunc(r * 0.85)), stroke: ink }]
}

export function bondSpecs(p1: [number, number], p2: [number, number], order = 1, width = 6, color = BOND_COLOR): Spec[] {
  const [x1, y1] = p1, [x2, y2] = p2
  const dx = x2 - x1, dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (length < 1e-6) return []
  const px = -dy / length, py = dx / length
  let rows: number[], lw: number, sep: number
  if (order <= 1) [rows, lw, sep] = [[0], width, 0]
  else if (order === 2) [rows, lw, sep] = [[-1, 1], width * 0.62, width * 0.85]
  else [rows, lw, sep] = [[-1, 0, 1], width * 0.52, width]
  return rows.map((o) => ({ shape: 'line', x1: x1 + px * o * sep, y1: y1 + py * o * sep, x2: x2 + px * o * sep, y2: y2 + py * o * sep, stroke: color, width: lw }))
}

function dashedLine(p1: [number, number], p2: [number, number], color: string, width: number, dash = 6, gap = 4): Spec[] {
  const [x1, y1] = p1, [x2, y2] = p2
  const length = Math.hypot(x2 - x1, y2 - y1) || 1
  const ux = (x2 - x1) / length, uy = (y2 - y1) / length
  const out: Spec[] = []
  for (let pos = 0; pos < length; ) {
    const end = Math.min(pos + dash, length)
    out.push({ shape: 'line', x1: x1 + ux * pos, y1: y1 + uy * pos, x2: x1 + ux * end, y2: y1 + uy * end, stroke: color, width })
    pos = end + gap
  }
  return out
}

export function noteSpecs(note: Note, pts: [number, number][], s: number): Spec[] {
  const color = note.color ?? '#22303c'
  if (note.kind === 'text') {
    const px = Math.max(6, Number(note.size ?? 1) * s)
    return [{ shape: 'text', text: String(note.text ?? ''), x: pts[0][0], y: pts[0][1], size: px * 0.8, stroke: color, anchor: 'center', bold: note.bold ?? true }]
  }
  if (note.kind === 'arrow') {
    const [[x1, y1], [x2, y2]] = pts
    const dx = x2 - x1, dy = y2 - y1
    const length = Math.hypot(dx, dy) || 1
    const px = -dy / length, py = dx / length
    const w = Math.max(2, Number(note.size ?? 1) * s * 0.1)
    const head = Math.min(length * 0.35, w * 5)
    const offsets = note.double ? [-w * 1.3, w * 1.3] : [0]
    const out: Spec[] = []
    offsets.forEach((off, k) => {
      let a: [number, number] = [x1 + px * off, y1 + py * off]
      let b: [number, number] = [x2 + px * off, y2 + py * off]
      if (k === 1) [a, b] = [b, a]
      const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length
      out.push({ shape: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: color, width: w })
      for (const sgn of [-1, 1])
        out.push({ shape: 'line', x1: b[0], y1: b[1], x2: b[0] - ux * head - sgn * uy * head * 0.55, y2: b[1] - uy * head + sgn * ux * head * 0.55, stroke: color, width: w })
    })
    return out
  }
  return []
}

export interface FitParams {
  scale: number
  origin: [number, number]
  centroid: Vec3
}

/** model.fit_params: the layout's scale / origin / centroid, kept while one atom is dragged. */
export function fitParams(atoms: readonly Atom[], w: number, h: number, az: number, el: number, bond: number, rscale = 0.92): FitParams {
  const c = centroidOf(atoms)
  const at = spread(atoms, null, bond, c).atoms
  const pr = at.map((a) => proj(a[1], a[2], a[3], az, el))
  const rad = at.map((a) => radius(a[0]) * rscale)
  const minx = Math.min(...pr.map((p, i) => p[0] - rad[i])), maxx = Math.max(...pr.map((p, i) => p[0] + rad[i]))
  const miny = Math.min(...pr.map((p, i) => p[1] - rad[i])), maxy = Math.max(...pr.map((p, i) => p[1] + rad[i]))
  const spanx = maxx - minx || 1, spany = maxy - miny || 1
  const m = 0.12 * Math.min(w, h)
  const s = Math.min((w - 2 * m) / spanx, (h - 2 * m) / spany)
  return { scale: s, origin: [(w - s * spanx) / 2 - s * minx, (h - s * spany) / 2 - s * miny], centroid: c }
}

interface ModelOptions {
  edges?: readonly (readonly unknown[])[] | null
  rscale?: number
  labels?: boolean
  margin?: number
  az?: number
  el?: number
  bondScale?: number
  tagAtoms?: boolean
  frozen?: FitParams | null
  poly?: boolean
  colors?: Record<string, string> | null
  notes?: readonly Note[] | null
}

/** model._model: the shape specs of a 3D structure in a (w, h) box, back to front. */
export function modelSpecs(atomsIn: readonly Atom[], bonds: readonly Bond[], w: number, h: number, o: ModelOptions = {}): Spec[] {
  const az = o.az ?? DEFAULT_AZ, el = o.el ?? DEFAULT_EL, bondScale = o.bondScale ?? 1, rscale = o.rscale ?? 1, margin = o.margin ?? 0.12
  let atoms = o.colors && Object.keys(o.colors).length ? applyColors(atomsIn, o.colors) : (atomsIn as Atom[])
  const fc = o.frozen ? o.frozen.centroid : null
  let notes = o.notes ?? null
  if (notes && bondScale !== 1 && atoms.length) {
    const c = fc ?? centroidOf(atoms)
    notes = notes.map((n) => {
      const out = { ...n }
      for (const k of ['pos', 'p1', 'p2'] as const) if (out[k]) out[k] = [c[0] + (out[k]![0] - c[0]) * bondScale, c[1] + (out[k]![1] - c[1]) * bondScale, c[2] + (out[k]![2] - c[2]) * bondScale]
      return out
    })
  }
  const sp = spread(atoms, o.edges ?? null, bondScale, fc)
  atoms = sp.atoms
  const pr = atoms.map((a) => proj(a[1], a[2], a[3], az, el))
  const rad = atoms.map((a) => radius(a[0]) * rscale)
  const xsLo = pr.map((p, i) => p[0] - rad[i]), xsHi = pr.map((p, i) => p[0] + rad[i])
  const ysLo = pr.map((p, i) => p[1] - rad[i]), ysHi = pr.map((p, i) => p[1] + rad[i])
  const pedges: [Vec3, Vec3, string][] = []
  for (const e of sp.edges ?? []) {
    const pa = proj(...e[0], az, el), pb = proj(...e[1], az, el)
    pedges.push([pa, pb, e[2]])
    for (const [px, py] of [pa, pb]) {
      xsLo.push(px)
      xsHi.push(px)
      ysLo.push(py)
      ysHi.push(py)
    }
  }
  const pnotes: [Note, Vec3[]][] = []
  for (const n of notes ?? []) {
    const pts = (['pos', 'p1', 'p2'] as const).filter((k) => n[k]).map((k) => proj(...n[k]!, az, el))
    pnotes.push([n, pts])
    const half = Number(n.size ?? 1)
    for (const [px, py] of pts) {
      if (n.kind === 'text') {
        const span = 0.3 * half * Math.max(1, String(n.text ?? '').length)
        xsLo.push(px - span)
        xsHi.push(px + span)
        ysLo.push(py - half)
        ysHi.push(py + half)
      } else {
        xsLo.push(px)
        xsHi.push(px)
        ysLo.push(py)
        ysHi.push(py)
      }
    }
  }
  if (!xsLo.length) return []
  const minx = Math.min(...xsLo), maxx = Math.max(...xsHi), miny = Math.min(...ysLo), maxy = Math.max(...ysHi)
  const spanx = maxx - minx || 1, spany = maxy - miny || 1
  let s: number, ox: number, oy: number
  if (o.frozen && o.frozen.scale) {
    s = o.frozen.scale
    ;[ox, oy] = o.frozen.origin
  } else {
    const m = margin * Math.min(w, h)
    s = Math.min((w - 2 * m) / spanx, (h - 2 * m) / spany)
    ox = (w - s * spanx) / 2 - s * minx
    oy = (h - s * spany) / 2 - s * miny
  }
  const T = (px: number, py: number): [number, number] => [ox + s * px, oy + s * py]
  const specs: Spec[] = []
  const ew = Math.max(2.2, s * 0.062)
  for (const [pa, pb, style] of pedges) {
    const p1 = T(pa[0], pa[1]), p2 = T(pb[0], pb[1])
    if (style === 'dash') specs.push(...dashedLine(p1, p2, EDGE_COLOR, Math.max(1, s * 0.028), s * 0.1, s * 0.07))
    else specs.push({ shape: 'line', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], stroke: FRAME_COLOR, width: ew })
  }
  const bw = Math.max(2, s * 0.11)
  bonds.forEach(([i, j, order], bi) => {
    const sticks = bondSpecs(T(pr[i][0], pr[i][1]), T(pr[j][0], pr[j][1]), order, bw)
    if (o.tagAtoms) for (const st of sticks) st._bond = bi
    specs.push(...sticks)
  })
  type Drawable = [number, number, number | [Vec3[], string]]
  const drawables: Drawable[] = atoms.map((_a, i) => [pr[i][2], 1, i])
  if (o.poly) {
    for (const [face, col] of coordinationPolyhedra(atoms, bonds)) {
      const pf = face.map((p) => proj(p[0], p[1], p[2], az, el))
      drawables.push([pf.reduce((t, q) => t + q[2], 0) / pf.length, 0, [pf, col]])
    }
  }
  drawables.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  for (const [, kind, payload] of drawables) {
    if (kind === 0) {
      const [pf, col] = payload as [Vec3[], string]
      specs.push({ shape: 'polygon', points: pf.map((q) => T(q[0], q[1])), fill: col, opacity: 0.32, stroke: mix(col, '#000000', 0.35), width: Math.max(1, s * 0.02) })
      continue
    }
    const idx = payload as number
    const [cx, cy] = T(pr[idx][0], pr[idx][1])
    const atom = atoms[idx]
    const a = atomSpecs(cx, cy, rad[idx] * s, atom[0], !!o.labels, atom.length > 4 ? ((atom[4] as string) ?? null) : null)
    if (o.tagAtoms && a.length) a[0]._atom = idx
    specs.push(...a)
  }
  for (const [n, pts] of pnotes) specs.push(...noteSpecs(n, pts.map((p) => T(p[0], p[1])), s))
  return specs
}

/** Molecule.specs (with the frozen fit of a tilted supercell). */
export function molSpecs(mol: Mol, w: number, h: number, opts: { tag?: boolean; labels?: boolean; frozen?: FitParams | null } = {}): Spec[] {
  let frozen = opts.frozen ?? null
  if (!frozen && mol.stacked && Object.keys(mol.tilts).length && mol.anchor_base) frozen = fitParams(mol.anchor_base.atoms, w, h, mol.az, mol.el, mol.bond, mol.rscale)
  return modelSpecs(mol.atoms, mol.bonds, w, h, {
    edges: mol.cell_visible ? mol.edges : null, rscale: mol.rscale, az: mol.az, el: mol.el, bondScale: mol.bond, tagAtoms: opts.tag,
    frozen, labels: opts.labels, poly: mol.poly, colors: mol.colors, notes: mol.notes,
  })
}

/** molcolor.legend_specs. */
export function legendSpecs(entries: readonly LegendEntry[], x = 0, y = 0, r = 10): Spec[] {
  const out: Spec[] = []
  const gap = r * 2.8
  entries.forEach((e, i) => {
    const cy = y + r + i * gap
    out.push(...atomSpecs(x + r, cy, r, e.element, false, e.color))
    out.push({ shape: 'text', text: e.label, x: x + r * 2.6, y: cy - r * 1.05, size: Math.max(Math.trunc(r * 1.3), 8), stroke: '#1a1a1a' })
  })
  return out
}

/** render.specs_from_graph2d: ball-and-stick specs of a flat graph (the Explorer's 2D preview). */
export function specsFromGraph2d(atoms: readonly [string, number, number][], bonds: readonly Bond[], r = 15, bondW = 6): Spec[] {
  const out: Spec[] = []
  for (const [i, j, order] of bonds) out.push(...bondSpecs([atoms[i][1], atoms[i][2]], [atoms[j][1], atoms[j][2]], order, bondW))
  for (const [el, x, y] of atoms) out.push(...atomSpecs(x, y, r, el))
  return out
}

// ----------------------------------------------------------- painting

const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif'

/** Qt point size → CSS px (Qt assumes 96 dpi on these screens: 1 pt = 4/3 px). */
const pt = (n: number) => (n * 4) / 3

function textBox(ctx: CanvasRenderingContext2D, s: Spec): { x: number; y: number; w: number; h: number; font: string } {
  const size = pt(Math.trunc(Number(s.size ?? 12)))
  const font = `${s.bold === false ? '' : 'bold '}${size}px ${FONT}`
  ctx.font = font
  const w = ctx.measureText(String(s.text ?? '')).width
  const h = size * 1.25
  let x = Number(s.x ?? 0), y = Number(s.y ?? 0)
  if (String(s.anchor ?? '').toLowerCase() === 'center') {
    x -= w / 2
    y -= h / 2
  }
  return { x, y, w, h, font }
}

/** The bounding box of specs (QGraphicsScene.itemsBoundingRect). */
export function specsBounds(ctx: CanvasRenderingContext2D, specs: readonly Spec[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (x: number, y: number, pad = 0) => {
    x0 = Math.min(x0, x - pad)
    y0 = Math.min(y0, y - pad)
    x1 = Math.max(x1, x + pad)
    y1 = Math.max(y1, y + pad)
  }
  for (const s of specs) {
    const pad = (Number(s.width ?? 2) || 0) / 2
    if (s.shape === 'line') {
      add(s.x1!, s.y1!, pad)
      add(s.x2!, s.y2!, pad)
    } else if (s.shape === 'circle' || s.shape === 'ellipse') {
      add(s.x!, s.y!, pad)
      add(s.x! + s.w!, s.y! + s.h!, pad)
    } else if (s.shape === 'polygon') for (const [px, py] of s.points ?? []) add(px, py, pad)
    else if (s.shape === 'text') {
      const b = textBox(ctx, s)
      add(b.x, b.y)
      add(b.x + b.w, b.y + b.h)
    }
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

function brush(ctx: CanvasRenderingContext2D, s: Spec): string | CanvasGradient | null {
  const f = s.fill
  if (!f || (typeof f === 'string' && f.toLowerCase() === 'none')) return null
  if (typeof f === 'string') return f
  const x = Number(s.x ?? 0), y = Number(s.y ?? 0), w = Number(s.w ?? 10), h = Number(s.h ?? 10)
  const c1 = f.c1 ?? '#cccccc', c2 = f.c2 ?? '#ffffff'
  if (f.kind === 'sun') {
    // QRadialGradient(centre 0.35, radius 0.95, focal 0.25) in the bounding box
    const g = ctx.createRadialGradient(x + 0.25 * w, y + 0.25 * h, 0, x + 0.35 * w, y + 0.35 * h, 0.95 * Math.max(w, h))
    g.addColorStop(0, c2)
    g.addColorStop(1, c1)
    return g
  }
  if (f.kind === 'radial') {
    const g = ctx.createRadialGradient(x + 0.5 * w, y + 0.5 * h, 0, x + 0.5 * w, y + 0.5 * h, 0.7071 * Math.max(w, h))
    g.addColorStop(0, c1)
    g.addColorStop(1, c2)
    return g
  }
  if (f.kind === 'linear') {
    const g = ctx.createLinearGradient(x, y, x, y + h)
    g.addColorStop(0, c1)
    g.addColorStop(1, c2)
    return g
  }
  return c1
}

function stroke(ctx: CanvasRenderingContext2D, s: Spec): boolean {
  const c = s.stroke ?? '#1a1a1a'
  if (!c || c.toLowerCase() === 'none') return false
  ctx.strokeStyle = c
  ctx.lineWidth = Number(s.width ?? 2)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  return true
}

/** Paint specs in order (later ones in front), in the context's current transform. */
export function paintSpecs(ctx: CanvasRenderingContext2D, specs: readonly Spec[]) {
  for (const s of specs) {
    const shape = String(s.shape ?? '').toLowerCase()
    ctx.save()
    if (shape === 'line') {
      if (stroke(ctx, s)) {
        ctx.beginPath()
        ctx.moveTo(s.x1!, s.y1!)
        ctx.lineTo(s.x2!, s.y2!)
        ctx.stroke()
      }
    } else if (shape === 'circle' || shape === 'ellipse') {
      const x = Number(s.x ?? 0), y = Number(s.y ?? 0), w = Number(s.w ?? 10), h = Number(s.h ?? 10)
      ctx.beginPath()
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      const b = brush(ctx, s)
      if (b) {
        ctx.fillStyle = b
        ctx.fill()
      }
      if (stroke(ctx, s)) ctx.stroke()
    } else if (shape === 'polygon') {
      const pts = s.points ?? []
      if (pts.length) {
        if (s.opacity !== undefined) ctx.globalAlpha = Number(s.opacity)
        ctx.beginPath()
        pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
        ctx.closePath()
        const b = brush(ctx, s)
        if (b) {
          ctx.fillStyle = b
          ctx.fill()
        }
        if (stroke(ctx, s)) ctx.stroke()
      }
    } else if (shape === 'text') {
      const b = textBox(ctx, s)
      ctx.font = b.font
      ctx.fillStyle = s.stroke ?? '#1a1a1a'
      ctx.textBaseline = 'top'
      ctx.fillText(String(s.text ?? ''), b.x, b.y + b.h * 0.08)
    }
    ctx.restore()
  }
}

/** QGraphicsView.fitInView(rect, KeepAspectRatio): the transform that shows *box* centred in (w, h). */
export function fitTransform(box: { x: number; y: number; w: number; h: number }, w: number, h: number, margin = 0): { k: number; tx: number; ty: number } {
  const bw = Math.max(box.w, 1e-6), bh = Math.max(box.h, 1e-6)
  const k = Math.min((w - 2 * margin) / bw, (h - 2 * margin) / bh)
  return { k, tx: w / 2 - (box.x + bw / 2) * k, ty: h / 2 - (box.y + bh / 2) * k }
}

/** render.render_image: specs scaled to fit a (w, h) picture with a margin, on a background. */
export function renderSpecsImage(specs: readonly Spec[], w: number, h: number, background = '#ffffff', margin = 24): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = background
  ctx.fillRect(0, 0, w, h)
  const box = specsBounds(ctx, specs) ?? { x: 0, y: 0, w: 1, h: 1 }
  const t = fitTransform(box, w, h, margin)
  ctx.setTransform(t.k, 0, 0, t.k, t.tx, t.ty)
  paintSpecs(ctx, specs)
  return canvas
}
