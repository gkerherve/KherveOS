// The kFEA model (pure data, SI units): a frame (trusses, beams, frames: nodes, members, supports, loads) or a
// plate (a polygon outline with holes, meshed for plane stress / plane strain). Everything the solvers, the file
// and the editor share. No React, no browser.

import { cleanMaterial, libraryMaterial, type Material } from './materials.ts'
import { cleanSection, librarySection, type Section } from './sections.ts'
import { DEFAULT_UNITS, parseUnits, type Units } from './units.ts'

export type AnalysisType = 'truss' | 'beam' | 'frame' | 'plane-stress' | 'plane-strain'

export const ANALYSIS_NAMES: Record<AnalysisType, string> = {
  truss: '2-D truss', beam: 'Beam', frame: '2-D frame', 'plane-stress': 'Plane stress', 'plane-strain': 'Plane strain',
}

export const isPlate = (a: AnalysisType): boolean => a === 'plane-stress' || a === 'plane-strain'

export interface Pt { x: number; y: number }

export interface FNode {
  id: string
  x: number
  y: number
}

export interface Member {
  id: string
  n1: string
  n2: string
  section: string
  material: string
  /** moment released (hinge) at the start / end node */
  releaseStart?: boolean
  releaseEnd?: boolean
}

/** A support at a node: which displacements are held, optional elastic springs and prescribed settlements. */
export interface Support {
  id: string
  node: string
  ux: boolean
  uy: boolean
  rz: boolean
  /** spring stiffnesses, N/m and N·m/rad (a spring holds the node elastically instead of fixing it) */
  kx?: number
  ky?: number
  kr?: number
  /** prescribed displacements (settlement), m and rad: used where the direction is held */
  dx?: number
  dy?: number
  drz?: number
}

export interface NodeLoad {
  id: string
  node: string
  /** N, N, N·m */
  fx: number
  fy: number
  mz: number
}

export type LoadDir = 'x' | 'y' | 'lx' | 'ly'

export type MemberLoad =
  | { id: string; member: string; type: 'dist'; dir: LoadDir; w1: number; w2: number; a?: number; b?: number }
  | { id: string; member: string; type: 'point'; dir: LoadDir; p: number; a: number }
  | { id: string; member: string; type: 'thermal'; dT: number; dTg: number }

// ---------------------------------------------------------------------------- plates

export type Target =
  | { kind: 'edge'; loop: number; edge: number }
  | { kind: 'loop'; loop: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'vertex'; loop: number; vertex: number }
  | { kind: 'point'; x: number; y: number }

export interface PlateSupport { id: string; target: Target; ux: boolean; uy: boolean; dx?: number; dy?: number }

export type PlateLoad =
  | { id: string; type: 'traction'; target: Target; tx: number; ty: number }
  | { id: string; type: 'pressure'; target: Target; p: number }
  | { id: string; type: 'edge-force'; target: Target; fx: number; fy: number }
  | { id: string; type: 'point'; target: Target; fx: number; fy: number }
  | { id: string; type: 'thermal'; dT: number }

export interface RefinePoint { x: number; y: number; size: number }

export interface MeshSettings {
  /** target element size, m */
  size: number
  type: 'tri' | 'quad'
  /** size near holes as a fraction of the size (1 = none) */
  holeFactor: number
  /** extra refinement around points (fixed points, load points) */
  refine: RefinePoint[]
  /** rectangular regions (4 corners, no holes): a regular grid of quads (or of triangle pairs) */
  structured: boolean
  /** the number of cells along the first and second direction of a structured mesh (otherwise from the size) */
  divisions?: [number, number]
  smooth: number
}

export const DEFAULT_MESH: MeshSettings = { size: 0.1, type: 'tri', holeFactor: 0.5, refine: [], structured: false, smooth: 6 }

export interface Plate {
  /** counter-clockwise outline, then holes (clockwise) */
  outline: Pt[]
  holes: Pt[][]
  thickness: number
  material: string
  mesh: MeshSettings
  supports: PlateSupport[]
  loads: PlateLoad[]
}

export type Study = 'static' | 'modal' | 'buckling'

export interface Model {
  format: 'kfea'
  version: 1
  name: string
  description: string
  analysis: AnalysisType
  /** what to compute for frames: the static solution, the natural frequencies or the buckling loads */
  study: Study
  units: Units
  materials: Material[]
  sections: Section[]
  nodes: FNode[]
  members: Member[]
  supports: Support[]
  nodeLoads: NodeLoad[]
  memberLoads: MemberLoad[]
  /** gravity (self weight) acceleration, m/s², 0 for none */
  gravity: number
  plate: Plate | null
  /** results the file expects (examples): checked by the tests, shown in the description */
  expected?: Record<string, number>
}

export function emptyModel(analysis: AnalysisType = 'frame'): Model {
  const plate = isPlate(analysis)
  return {
    format: 'kfea', version: 1, name: 'Untitled', description: '', analysis, study: 'static',
    units: { ...DEFAULT_UNITS, length: plate ? 'mm' : 'm', force: plate ? 'N' : 'kN' },
    materials: [libraryMaterial('S235')!], sections: [librarySection('IPE200')!],
    nodes: [], members: [], supports: [], nodeLoads: [], memberLoads: [], gravity: 0,
    plate: plate ? emptyPlate() : null,
  }
}

export function emptyPlate(): Plate {
  return { outline: [], holes: [], thickness: 0.01, material: 'S235', mesh: { ...DEFAULT_MESH, refine: [] }, supports: [], loads: [] }
}

// ---------------------------------------------------------------------------- lookups

export const nodeById = (m: Model, id: string): FNode | undefined => m.nodes.find((n) => n.id === id)
export const memberById = (m: Model, id: string): Member | undefined => m.members.find((x) => x.id === id)
export const materialOf = (m: Model, id: string): Material | undefined => m.materials.find((x) => x.id === id) ?? libraryMaterial(id)
export const sectionOf = (m: Model, id: string): Section | undefined => m.sections.find((x) => x.id === id) ?? librarySection(id)

export function memberLength(m: Model, mem: Member): number {
  const a = nodeById(m, mem.n1)
  const b = nodeById(m, mem.n2)
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
}

/** Next unused id like "N7", "M3". */
export function nextId(prefix: string, ids: readonly string[]): string {
  const used = new Set(ids)
  let i = 1
  for (const id of ids) {
    const m = id.match(/^[A-Za-z]+(\d+)$/)
    if (m && id.startsWith(prefix)) i = Math.max(i, Number(m[1]) + 1)
  }
  while (used.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}

// ---------------------------------------------------------------------------- polygons

export const signedArea = (poly: readonly Pt[]): number => {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export const ccw = (poly: readonly Pt[]): Pt[] => (signedArea(poly) < 0 ? [...poly].reverse() : [...poly])
export const cw = (poly: readonly Pt[]): Pt[] => (signedArea(poly) > 0 ? [...poly].reverse() : [...poly])

export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** The polygon loops of a plate: the outline counter-clockwise, the holes clockwise (the material is on the left). */
export function plateLoops(p: Plate): Pt[][] {
  return [ccw(p.outline), ...p.holes.map(cw)]
}

export function pointInPlate(pt: Pt, p: Plate): boolean {
  if (!pointInPolygon(pt, p.outline)) return false
  return !p.holes.some((h) => pointInPolygon(pt, h))
}

/** Puts the outline counter-clockwise and the holes clockwise (the material on the left of every edge), renumbering the edge and vertex targets of the supports and loads when a loop had to be reversed. */
export function normalizePlate(p: Plate): void {
  const loops = [p.outline, ...p.holes]
  const targets: Target[] = [...p.supports.map((s) => s.target), ...p.loads.flatMap((l) => (l.type === 'thermal' ? [] : [l.target]))]
  loops.forEach((lp, li) => {
    const a = signedArea(lp)
    if (lp.length < 3 || (li === 0 ? a >= 0 : a <= 0)) return
    const n = lp.length
    lp.reverse()
    for (const t of targets) {
      if (t.kind === 'vertex' && t.loop === li) t.vertex = n - 1 - t.vertex
      else if (t.kind === 'edge' && t.loop === li) t.edge = (2 * n - 2 - t.edge) % n
    }
  })
}

export function plateArea(p: Plate): number {
  return Math.abs(signedArea(p.outline)) - p.holes.reduce((s, h) => s + Math.abs(signedArea(h)), 0)
}

/** A regular polygon approximating a circle (counter-clockwise). */
export function circlePoly(cx: number, cy: number, r: number, n = 32, start = 0): Pt[] {
  return Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos(start + (2 * Math.PI * i) / n), y: cy + r * Math.sin(start + (2 * Math.PI * i) / n) }))
}

// ---------------------------------------------------------------------------- bounding box

export function modelBox(m: Model): { x0: number; y0: number; x1: number; y1: number } {
  const pts: Pt[] = m.nodes.map((n) => ({ x: n.x, y: n.y }))
  if (m.plate) pts.push(...m.plate.outline)
  if (!pts.length) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  return { x0, y0, x1, y1 }
}

// ---------------------------------------------------------------------------- checks

export interface Problem { level: 'error' | 'warning'; message: string; ref?: string }

/** Problems found before solving, in plain language. */
export function checkModel(m: Model): Problem[] {
  const out: Problem[] = []
  const err = (message: string, ref?: string) => out.push({ level: 'error', message, ref })
  const warn = (message: string, ref?: string) => out.push({ level: 'warning', message, ref })
  if (isPlate(m.analysis)) {
    const p = m.plate
    if (!p || p.outline.length < 3) { err('Draw the outline of the plate first (Outline tool: click the corners, double-click to close).'); return out }
    if (!materialOf(m, p.material)) err(`The plate uses a material “${p.material}” that does not exist.`)
    if (!(p.thickness > 0)) err('The plate thickness must be positive.')
    if (!p.supports.length) err('The plate has no support: it would float away. Add a support on an edge or a corner.')
    if (!p.loads.length && !(m.gravity > 0)) warn('There is no load on the plate: the result will be zero.')
    if (!(p.mesh.size > 0)) err('The mesh size must be positive.')
    if (Math.abs(signedArea(p.outline)) < 1e-18) err('The outline has no area.')
    return out
  }
  if (!m.nodes.length) { err('Add some nodes first (Node tool), then join them with members.'); return out }
  if (!m.members.length) { err('Add members between the nodes (Member tool: click two nodes).'); return out }
  const ids = new Set(m.nodes.map((n) => n.id))
  for (const mem of m.members) {
    if (!ids.has(mem.n1) || !ids.has(mem.n2)) err(`Member ${mem.id} refers to a node that does not exist.`, mem.id)
    else if (mem.n1 === mem.n2 || memberLength(m, mem) < 1e-12) err(`Member ${mem.id} has zero length.`, mem.id)
    if (!materialOf(m, mem.material)) err(`Member ${mem.id} uses a material “${mem.material}” that does not exist.`, mem.id)
    if (!sectionOf(m, mem.section)) err(`Member ${mem.id} uses a section “${mem.section}” that does not exist.`, mem.id)
  }
  for (const s of m.supports) if (!ids.has(s.node)) err(`A support is on node ${s.node}, which does not exist.`)
  for (const l of m.nodeLoads) if (!ids.has(l.node)) err(`A load is on node ${l.node}, which does not exist.`)
  const memIds = new Set(m.members.map((x) => x.id))
  for (const l of m.memberLoads) if (!memIds.has(l.member)) err(`A load is on member ${l.member}, which does not exist.`)
  if (!m.supports.length) err('The structure has no support: it is free in space. Add supports (Support tool).')
  const used = new Set(m.members.flatMap((x) => [x.n1, x.n2]))
  for (const n of m.nodes) if (!used.has(n.id)) warn(`Node ${n.id} is not connected to any member.`, n.id)
  if (!m.nodeLoads.length && !m.memberLoads.length && !(m.gravity > 0) && !m.supports.some((s) => s.dx || s.dy || s.drz)) warn('There is no load: the result will be zero.')
  return out
}

// ---------------------------------------------------------------------------- cleaning (files, AI calls)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numOr = (v: unknown, d: number): number => (isNum(v) ? v : d)
const bool = (v: unknown): boolean => v === true
const optNum = (v: unknown): number | undefined => (isNum(v) && v !== 0 ? v : undefined)
const strOr = (v: unknown, d = ''): string => (typeof v === 'string' ? v : isNum(v) ? String(v) : d)

function cleanTarget(t: unknown): Target {
  const o = (t ?? {}) as Record<string, unknown>
  switch (o.kind) {
    case 'edge': return { kind: 'edge', loop: numOr(o.loop, 0), edge: numOr(o.edge, 0) }
    case 'loop': return { kind: 'loop', loop: numOr(o.loop, 0) }
    case 'line': return { kind: 'line', x1: numOr(o.x1, 0), y1: numOr(o.y1, 0), x2: numOr(o.x2, 0), y2: numOr(o.y2, 0) }
    case 'circle': return { kind: 'circle', cx: numOr(o.cx, 0), cy: numOr(o.cy, 0), r: numOr(o.r, 1) }
    case 'vertex': return { kind: 'vertex', loop: numOr(o.loop, 0), vertex: numOr(o.vertex, 0) }
    default: return { kind: 'point', x: numOr(o.x, 0), y: numOr(o.y, 0) }
  }
}

function cleanPts(v: unknown): Pt[] {
  return (Array.isArray(v) ? v : []).map((p) => ({ x: numOr((p as Pt)?.x, 0), y: numOr((p as Pt)?.y, 0) }))
}

/** A model from parsed JSON: fields checked, unknown things dropped, ids made unique. Throws only for a wrong format. */
export function cleanModel(raw: unknown): Model {
  if (!raw || typeof raw !== 'object') throw new Error('This is not a kFEA file.')
  const o = raw as Record<string, unknown>
  if (o.format !== 'kfea') throw new Error('This is not a kFEA file (the format field should be “kfea”).')
  if (isNum(o.version) && o.version > 1) throw new Error(`This file was made by a newer kFEA (version ${o.version}).`)
  const analyses: AnalysisType[] = ['truss', 'beam', 'frame', 'plane-stress', 'plane-strain']
  const analysis = analyses.includes(o.analysis as AnalysisType) ? (o.analysis as AnalysisType) : 'frame'
  const base = emptyModel(analysis)
  const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>> : [])
  const seen = new Set<string>()
  const uid = (v: unknown, prefix: string): string => {
    let id = strOr(v) || `${prefix}${seen.size + 1}`
    while (seen.has(`${prefix}:${id}`)) id += '_'
    seen.add(`${prefix}:${id}`)
    return id
  }
  const m: Model = {
    ...base,
    name: strOr(o.name, 'Untitled') || 'Untitled',
    description: strOr(o.description),
    study: o.study === 'modal' || o.study === 'buckling' ? o.study : 'static',
    units: parseUnits(o.units),
    materials: list(o.materials).map((x) => cleanMaterial({ ...(x as Partial<Material>), id: strOr(x.id, 'MAT') })),
    sections: list(o.sections).map((x) => cleanSection({ ...(x as Partial<Section>), id: strOr(x.id, 'SEC') })),
    nodes: [], members: [], supports: [], nodeLoads: [], memberLoads: [],
    gravity: Math.max(0, numOr(o.gravity, 0)),
    plate: null,
  }
  if (m.materials.length === 0) m.materials = base.materials
  if (m.sections.length === 0) m.sections = isPlate(analysis) ? [] : base.sections
  for (const x of list(o.nodes)) m.nodes.push({ id: uid(x.id, 'n'), x: numOr(x.x, 0), y: numOr(x.y, 0) })
  for (const x of list(o.members)) {
    const mem: Member = { id: uid(x.id, 'm'), n1: strOr(x.n1), n2: strOr(x.n2), section: strOr(x.section, m.sections[0]?.id ?? ''), material: strOr(x.material, m.materials[0].id) }
    if (bool(x.releaseStart)) mem.releaseStart = true
    if (bool(x.releaseEnd)) mem.releaseEnd = true
    m.members.push(mem)
  }
  for (const x of list(o.supports)) {
    const s: Support = { id: uid(x.id, 's'), node: strOr(x.node), ux: bool(x.ux), uy: bool(x.uy), rz: bool(x.rz) }
    for (const k of ['kx', 'ky', 'kr', 'dx', 'dy', 'drz'] as const) { const v = optNum(x[k]); if (v !== undefined) s[k] = v }
    m.supports.push(s)
  }
  for (const x of list(o.nodeLoads)) m.nodeLoads.push({ id: uid(x.id, 'l'), node: strOr(x.node), fx: numOr(x.fx, 0), fy: numOr(x.fy, 0), mz: numOr(x.mz, 0) })
  const dirs: LoadDir[] = ['x', 'y', 'lx', 'ly']
  for (const x of list(o.memberLoads)) {
    const id = uid(x.id, 'q')
    const member = strOr(x.member)
    const dir = dirs.includes(x.dir as LoadDir) ? (x.dir as LoadDir) : 'y'
    if (x.type === 'point') m.memberLoads.push({ id, member, type: 'point', dir, p: numOr(x.p, 0), a: numOr(x.a, 0) })
    else if (x.type === 'thermal') m.memberLoads.push({ id, member, type: 'thermal', dT: numOr(x.dT, 0), dTg: numOr(x.dTg, 0) })
    else {
      const l: MemberLoad = { id, member, type: 'dist', dir, w1: numOr(x.w1, 0), w2: numOr(x.w2, numOr(x.w1, 0)) }
      if (isNum(x.a)) l.a = x.a
      if (isNum(x.b)) l.b = x.b
      m.memberLoads.push(l)
    }
  }
  if (isPlate(analysis)) {
    const p = (o.plate ?? {}) as Record<string, unknown>
    const ms = (p.mesh ?? {}) as Record<string, unknown>
    const plate = emptyPlate()
    plate.outline = cleanPts(p.outline)
    plate.holes = (Array.isArray(p.holes) ? p.holes : []).map(cleanPts)
    plate.thickness = isNum(p.thickness) && p.thickness > 0 ? p.thickness : plate.thickness
    plate.material = strOr(p.material, m.materials[0].id)
    plate.mesh = {
      size: isNum(ms.size) && ms.size > 0 ? ms.size : DEFAULT_MESH.size,
      type: ms.type === 'quad' ? 'quad' : 'tri',
      holeFactor: isNum(ms.holeFactor) && ms.holeFactor > 0 && ms.holeFactor <= 1 ? ms.holeFactor : DEFAULT_MESH.holeFactor,
      refine: list(ms.refine).map((r) => ({ x: numOr(r.x, 0), y: numOr(r.y, 0), size: numOr(r.size, DEFAULT_MESH.size / 3) })),
      structured: bool(ms.structured),
      ...(Array.isArray(ms.divisions) && ms.divisions.length === 2 && ms.divisions.every((d) => isNum(d) && d >= 1) ? { divisions: [Math.round(ms.divisions[0] as number), Math.round(ms.divisions[1] as number)] as [number, number] } : {}),
      smooth: isNum(ms.smooth) ? Math.max(0, Math.min(40, Math.round(ms.smooth))) : DEFAULT_MESH.smooth,
    }
    plate.supports = list(p.supports).map((x) => {
      const s: PlateSupport = { id: uid(x.id, 'ps'), target: cleanTarget(x.target), ux: bool(x.ux), uy: bool(x.uy) }
      const dx = optNum(x.dx); const dy = optNum(x.dy)
      if (dx !== undefined) s.dx = dx
      if (dy !== undefined) s.dy = dy
      return s
    })
    plate.loads = list(p.loads).map((x): PlateLoad => {
      const id = uid(x.id, 'pl')
      switch (x.type) {
        case 'pressure': return { id, type: 'pressure', target: cleanTarget(x.target), p: numOr(x.p, 0) }
        case 'edge-force': return { id, type: 'edge-force', target: cleanTarget(x.target), fx: numOr(x.fx, 0), fy: numOr(x.fy, 0) }
        case 'point': return { id, type: 'point', target: cleanTarget(x.target), fx: numOr(x.fx, 0), fy: numOr(x.fy, 0) }
        case 'thermal': return { id, type: 'thermal', dT: numOr(x.dT, 0) }
        default: return { id, type: 'traction', target: cleanTarget(x.target), tx: numOr(x.tx, 0), ty: numOr(x.ty, 0) }
      }
    })
    normalizePlate(plate)
    m.plate = plate
    m.nodes = []
    m.members = []
  }
  // library materials / sections used but not stored are added
  for (const mem of m.members) {
    if (!m.materials.some((x) => x.id === mem.material)) { const lib = libraryMaterial(mem.material); if (lib) m.materials.push(lib) }
    if (!m.sections.some((x) => x.id === mem.section)) { const lib = librarySection(mem.section); if (lib) m.sections.push(lib) }
  }
  if (m.plate && !m.materials.some((x) => x.id === m.plate!.material)) { const lib = libraryMaterial(m.plate.material); if (lib) m.materials.push(lib) }
  if (o.expected && typeof o.expected === 'object') {
    const e: Record<string, number> = {}
    for (const [k, v] of Object.entries(o.expected as Record<string, unknown>)) if (isNum(v)) e[k] = v
    if (Object.keys(e).length) m.expected = e
  }
  return m
}

export const cloneModel = (m: Model): Model => structuredClone(m)
