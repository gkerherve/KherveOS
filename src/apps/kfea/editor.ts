// Editing operations on a model (pure, immutable: each returns a new model), picking, snapping and undo history.

import { libraryMaterial, type Material } from './materials.ts'
import {
  circlePoly, cloneModel, emptyPlate, isPlate, memberById, nextId, nodeById, signedArea, ccw, cw,
  type LoadDir, type Member, type MemberLoad, type Model, type NodeLoad, type PlateLoad, type PlateSupport, type Pt, type Support, type Target,
} from './model.ts'
import { librarySection, type Section } from './sections.ts'
import { LENGTH_M, toSI } from './units.ts'

export type Edit = (m: Model) => void

/** Applies a change to a copy of the model. */
export function edit(m: Model, fn: Edit): Model {
  const c = cloneModel(m)
  fn(c)
  return c
}

export const snapTo = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid : v)

/** A round grid step (1, 2 or 5 × a power of ten) for a drawing of this size. */
export function niceStep(extent: number): number {
  const raw = Math.max(extent, 1e-9) / 20
  const mag = 10 ** Math.floor(Math.log10(raw))
  const f = raw / mag
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag
}

// ---------------------------------------------------------------------------- history

export class History {
  past: Model[] = []
  future: Model[] = []
  limit = 200
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  push(m: Model) {
    this.past.push(m)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }
  undo(current: Model): Model | null {
    const p = this.past.pop()
    if (!p) return null
    this.future.push(current)
    return p
  }
  redo(current: Model): Model | null {
    const n = this.future.pop()
    if (!n) return null
    this.past.push(current)
    return n
  }
  clear() { this.past = []; this.future = [] }
}

// ---------------------------------------------------------------------------- libraries inside the model

export function ensureMaterial(m: Model, mat: Material): void {
  if (!m.materials.some((x) => x.id === mat.id)) m.materials.push({ ...mat })
}

export function ensureSection(m: Model, s: Section): void {
  if (!m.sections.some((x) => x.id === s.id)) m.sections.push(structuredClone(s))
}

/** Adds the library material / section by id (or finds the one the model already has). */
export function useMaterial(m: Model, id: string): string {
  if (m.materials.some((x) => x.id === id)) return id
  const lib = libraryMaterial(id)
  if (!lib) throw new Error(`There is no material “${id}”. Use one of the library (S235, S355, SS304, AL6061, TI64, CU, C30, TIMBER, CASTIRON, GLASS, ABS, PLA) or define it first.`)
  ensureMaterial(m, lib)
  return id
}

export function useSection(m: Model, id: string): string {
  const have = m.sections.find((x) => x.id === id || x.name === id)
  if (have) return have.id
  const lib = librarySection(id)
  if (!lib) throw new Error(`There is no section “${id}”. Examples: IPE200, HEA200, HEB300, UPN160, RECT100x200, CIRC50, TUBE114x6.`)
  ensureSection(m, lib)
  return lib.id
}

// ---------------------------------------------------------------------------- frames

export function addNode(m: Model, x: number, y: number, id?: string): { model: Model; id: string } {
  const tol = 1e-9 + 1e-7 * Math.max(1, ...m.nodes.map((n) => Math.abs(n.x) + Math.abs(n.y)))
  const near = m.nodes.find((n) => Math.hypot(n.x - x, n.y - y) <= tol)
  if (near) return { model: m, id: near.id }
  if (id && m.nodes.some((n) => n.id === id)) throw new Error(`The node id “${id}” is already used.`)
  const nid = id ?? nextId('N', m.nodes.map((n) => n.id))
  return { model: edit(m, (c) => { c.nodes.push({ id: nid, x, y }) }), id: nid }
}

/** The section and material a new member gets: those of the last member, or the first of the model. */
export function defaultMemberProps(m: Model): { section: string; material: string } {
  const last = m.members[m.members.length - 1]
  return { section: last?.section ?? m.sections[0]?.id ?? 'IPE200', material: last?.material ?? m.materials[0]?.id ?? 'S235' }
}

export function addMember(m: Model, n1: string, n2: string, props: Partial<Member> = {}, id?: string): { model: Model; id: string } {
  if (n1 === n2) throw new Error('A member needs two different nodes.')
  if (!nodeById(m, n1) || !nodeById(m, n2)) throw new Error('A member joins two nodes that exist.')
  const dup = m.members.find((x) => (x.n1 === n1 && x.n2 === n2) || (x.n1 === n2 && x.n2 === n1))
  if (dup) return { model: m, id: dup.id }
  if (id && m.members.some((x) => x.id === id)) throw new Error(`The member id “${id}” is already used.`)
  const mid = id ?? nextId('M', m.members.map((x) => x.id))
  const d = defaultMemberProps(m)
  return {
    model: edit(m, (c) => {
      const section = useSection(c, props.section ?? d.section)
      const material = useMaterial(c, props.material ?? d.material)
      const mem: Member = { id: mid, n1, n2, section, material }
      if (props.releaseStart) mem.releaseStart = true
      if (props.releaseEnd) mem.releaseEnd = true
      c.members.push(mem)
    }),
    id: mid,
  }
}

export function moveNodes(m: Model, ids: ReadonlySet<string>, dx: number, dy: number): Model {
  return edit(m, (c) => { for (const n of c.nodes) if (ids.has(n.id)) { n.x += dx; n.y += dy } })
}

export function setNodePos(m: Model, id: string, x: number, y: number): Model {
  return edit(m, (c) => { const n = c.nodes.find((q) => q.id === id); if (n) { n.x = x; n.y = y } })
}

/** Deletes nodes and members (a node takes its members, supports and loads with it). */
export function deleteItems(m: Model, ids: ReadonlySet<string>): Model {
  return edit(m, (c) => {
    const nodes = new Set(c.nodes.filter((n) => ids.has(n.id)).map((n) => n.id))
    c.members = c.members.filter((x) => !ids.has(x.id) && !nodes.has(x.n1) && !nodes.has(x.n2))
    const mems = new Set(c.members.map((x) => x.id))
    c.nodes = c.nodes.filter((n) => !nodes.has(n.id))
    c.supports = c.supports.filter((s) => !nodes.has(s.node))
    c.nodeLoads = c.nodeLoads.filter((l) => !nodes.has(l.node))
    c.memberLoads = c.memberLoads.filter((l) => mems.has(l.member))
  })
}

export type SupportKind = 'free' | 'pinned' | 'roller' | 'roller-x' | 'fixed' | 'spring'

export const SUPPORT_NAMES: Record<SupportKind, string> = {
  free: 'None', pinned: 'Pinned', roller: 'Roller (free along x)', 'roller-x': 'Roller (free along y)', fixed: 'Fixed', spring: 'Spring (vertical)',
}

export function supportOf(kind: SupportKind, node: string, id: string, k = 1e6): Support | null {
  switch (kind) {
    case 'free': return null
    case 'pinned': return { id, node, ux: true, uy: true, rz: false }
    case 'roller': return { id, node, ux: false, uy: true, rz: false }
    case 'roller-x': return { id, node, ux: true, uy: false, rz: false }
    case 'fixed': return { id, node, ux: true, uy: true, rz: true }
    default: return { id, node, ux: false, uy: false, rz: false, ky: k }
  }
}

/** The kind of a support, for the menus. */
export function supportKind(s: Support | undefined): SupportKind {
  if (!s) return 'free'
  if (s.kx || s.ky || s.kr) return 'spring'
  if (s.ux && s.uy && s.rz) return 'fixed'
  if (s.ux && s.uy) return 'pinned'
  if (s.uy && !s.ux) return 'roller'
  if (s.ux && !s.uy) return 'roller-x'
  return s.rz ? 'fixed' : 'free'
}

export function setSupport(m: Model, node: string, kind: SupportKind, k?: number): Model {
  return edit(m, (c) => {
    c.supports = c.supports.filter((s) => s.node !== node)
    const s = supportOf(kind, node, nextId('s', c.supports.map((x) => x.id)), k)
    if (s) c.supports.push(s)
  })
}

export function updateSupport(m: Model, node: string, patch: Partial<Support>): Model {
  return edit(m, (c) => {
    const s = c.supports.find((x) => x.node === node)
    if (!s) return
    Object.assign(s, patch)
    for (const key of ['kx', 'ky', 'kr', 'dx', 'dy', 'drz'] as const) if (!s[key]) delete s[key]
  })
}

export function setNodeLoad(m: Model, node: string, fx: number, fy: number, mz: number): Model {
  return edit(m, (c) => {
    c.nodeLoads = c.nodeLoads.filter((l) => l.node !== node)
    if (fx || fy || mz) c.nodeLoads.push({ id: nextId('l', c.nodeLoads.map((x) => x.id)), node, fx, fy, mz })
  })
}

export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

export function addMemberLoad(m: Model, load: DistributiveOmit<MemberLoad, 'id'>): Model {
  return edit(m, (c) => { c.memberLoads.push({ ...load, id: nextId('q', c.memberLoads.map((x) => x.id)) } as MemberLoad) })
}

export function removeLoad(m: Model, id: string): Model {
  return edit(m, (c) => {
    c.nodeLoads = c.nodeLoads.filter((l) => l.id !== id)
    c.memberLoads = c.memberLoads.filter((l) => l.id !== id)
    if (c.plate) { c.plate.loads = c.plate.loads.filter((l) => l.id !== id); c.plate.supports = c.plate.supports.filter((l) => l.id !== id) }
  })
}

export function setMemberProps(m: Model, ids: ReadonlySet<string>, patch: Partial<Pick<Member, 'section' | 'material' | 'releaseStart' | 'releaseEnd'>>): Model {
  return edit(m, (c) => {
    for (const mem of c.members) {
      if (!ids.has(mem.id)) continue
      if (patch.section) mem.section = useSection(c, patch.section)
      if (patch.material) mem.material = useMaterial(c, patch.material)
      if ('releaseStart' in patch) { if (patch.releaseStart) mem.releaseStart = true; else delete mem.releaseStart }
      if ('releaseEnd' in patch) { if (patch.releaseEnd) mem.releaseEnd = true; else delete mem.releaseEnd }
    }
  })
}

/** Puts a node on a member at distance `s` from its start and splits the member in two (its loads follow). */
export function splitMember(m: Model, memberId: string, s: number): { model: Model; node: string } {
  const mem = memberById(m, memberId)
  const a = mem && nodeById(m, mem.n1)
  const b = mem && nodeById(m, mem.n2)
  if (!mem || !a || !b) throw new Error('That member does not exist.')
  const L = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(s > 1e-9 * L && s < L * (1 - 1e-9))) throw new Error('The split is at an end of the member.')
  let node = ''
  const model = edit(m, (c) => {
    node = nextId('N', c.nodes.map((n) => n.id))
    c.nodes.push({ id: node, x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L })
    const second: Member = { id: nextId('M', c.members.map((x) => x.id)), n1: node, n2: mem.n2, section: mem.section, material: mem.material }
    const first = c.members.find((x) => x.id === memberId)!
    if (mem.releaseEnd) { second.releaseEnd = true; delete first.releaseEnd }
    first.n2 = node
    c.members.push(second)
    const loads: MemberLoad[] = []
    for (const l of c.memberLoads) {
      if (l.member !== memberId) { loads.push(l); continue }
      if (l.type === 'thermal') { loads.push(l, { ...l, id: `${l.id}b`, member: second.id }); continue }
      if (l.type === 'point') {
        if (l.a < s) loads.push(l); else loads.push({ ...l, member: second.id, a: l.a - s })
        continue
      }
      const ta = l.a ?? 0
      const tb = l.b ?? L
      const w = (t: number) => l.w1 + ((l.w2 - l.w1) * (t - ta)) / (tb - ta || 1)
      if (ta < s) loads.push({ ...l, w1: w(ta), w2: w(Math.min(tb, s)), a: ta, b: Math.min(tb, s) })
      if (tb > s) loads.push({ ...l, id: `${l.id}b`, member: second.id, w1: w(Math.max(ta, s)), w2: w(tb), a: Math.max(ta, s) - s, b: tb - s })
    }
    c.memberLoads = loads
  })
  return { model, node }
}

// ---------------------------------------------------------------------------- plates

export function setOutline(m: Model, pts: readonly Pt[]): Model {
  return edit(m, (c) => {
    if (!c.plate) c.plate = emptyPlate()
    c.plate.outline = ccw(pts)
    c.plate.supports = []
    c.plate.loads = c.plate.loads.filter((l) => l.type === 'thermal')
  })
}

export function addHole(m: Model, pts: readonly Pt[]): Model {
  return edit(m, (c) => { if (c.plate) c.plate.holes.push(cw(pts)) })
}

export function addCircleHole(m: Model, cx: number, cy: number, r: number, n = 32): Model {
  return addHole(m, circlePoly(cx, cy, r, n))
}

export function deleteHole(m: Model, hole: number): Model {
  return edit(m, (c) => {
    if (!c.plate) return
    c.plate.holes.splice(hole, 1)
    const loop = hole + 1
    const keep = <T extends { target: Target }>(l: T) => !('loop' in l.target && l.target.loop === loop)
    const shift = <T extends { target: Target }>(l: T): T => {
      if ('loop' in l.target && l.target.loop > loop) l.target = { ...l.target, loop: l.target.loop - 1 }
      return l
    }
    c.plate.supports = c.plate.supports.filter(keep).map(shift)
    c.plate.loads = c.plate.loads.filter((l) => l.type === 'thermal' || keep(l)).map((l) => (l.type === 'thermal' ? l : shift(l)))
  })
}

export function moveVertex(m: Model, loop: number, index: number, x: number, y: number): Model {
  return edit(m, (c) => {
    const lp = loop === 0 ? c.plate?.outline : c.plate?.holes[loop - 1]
    if (lp?.[index]) lp[index] = { x, y }
  })
}

export function moveLoop(m: Model, loop: number, dx: number, dy: number): Model {
  return edit(m, (c) => {
    const lp = loop === 0 ? c.plate?.outline : c.plate?.holes[loop - 1]
    if (lp) for (const p of lp) { p.x += dx; p.y += dy }
  })
}

/** Inserts a vertex on edge `edge` of a loop; supports and loads on that edge now cover both halves. */
export function insertVertex(m: Model, loop: number, edge: number, pt: Pt): Model {
  return edit(m, (c) => {
    const lp = loop === 0 ? c.plate?.outline : c.plate?.holes[loop - 1]
    if (!lp || !c.plate) return
    lp.splice(edge + 1, 0, pt)
    const fix = <T extends { id: string; target: Target }>(list: T[]): T[] => {
      const out: T[] = []
      for (const l of list) {
        const t = l.target
        if (t.kind === 'edge' && t.loop === loop) {
          if (t.edge > edge) out.push({ ...l, target: { ...t, edge: t.edge + 1 } })
          else if (t.edge === edge) out.push(l, { ...l, id: `${l.id}b`, target: { ...t, edge: edge + 1 } })
          else out.push(l)
        } else if (t.kind === 'vertex' && t.loop === loop && t.vertex > edge) out.push({ ...l, target: { ...t, vertex: t.vertex + 1 } })
        else out.push(l)
      }
      return out
    }
    c.plate.supports = fix(c.plate.supports)
    c.plate.loads = c.plate.loads.flatMap((l): PlateLoad[] => (l.type === 'thermal' ? [l] : (fix([l]) as PlateLoad[])))
  })
}

export function deleteVertex(m: Model, loop: number, index: number): Model {
  return edit(m, (c) => {
    const lp = loop === 0 ? c.plate?.outline : c.plate?.holes[loop - 1]
    if (!lp || !c.plate || lp.length <= 3) return
    lp.splice(index, 1)
    const fix = <T extends { target: Target }>(l: T): T | null => {
      const t = l.target
      if (t.kind === 'edge' && t.loop === loop) {
        if (t.edge === index) return null
        if (t.edge > index) return { ...l, target: { ...t, edge: t.edge - 1 } }
      }
      if (t.kind === 'vertex' && t.loop === loop) {
        if (t.vertex === index) return null
        if (t.vertex > index) return { ...l, target: { ...t, vertex: t.vertex - 1 } }
      }
      return l
    }
    c.plate.supports = c.plate.supports.map(fix).filter((x): x is PlateSupport => !!x)
    c.plate.loads = c.plate.loads.map((l) => (l.type === 'thermal' ? l : fix(l))).filter((x): x is PlateLoad => !!x)
  })
}

export function addPlateSupport(m: Model, target: Target, ux: boolean, uy: boolean): Model {
  return edit(m, (c) => { c.plate?.supports.push({ id: nextId('ps', c.plate.supports.map((x) => x.id)), target, ux, uy }) })
}

export function addPlateLoad(m: Model, load: DistributiveOmit<PlateLoad, 'id'>): Model {
  return edit(m, (c) => { c.plate?.loads.push({ ...load, id: nextId('pl', c.plate.loads.map((x) => x.id)) } as PlateLoad) })
}

/** Orientation check used by the outline tool. */
export const isClockwise = (pts: readonly Pt[]): boolean => signedArea(pts) < 0

// ---------------------------------------------------------------------------- picking

export type FramePick = { kind: 'node' | 'member'; id: string }

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function pickFrame(m: Model, x: number, y: number, tol: number): FramePick | null {
  let best: FramePick | null = null
  let bd = tol
  for (const n of m.nodes) {
    const d = Math.hypot(n.x - x, n.y - y)
    if (d <= bd) { bd = d; best = { kind: 'node', id: n.id } }
  }
  if (best) return best
  for (const mem of m.members) {
    const a = nodeById(m, mem.n1)
    const b = nodeById(m, mem.n2)
    if (!a || !b) continue
    const d = distToSegment(x, y, a.x, a.y, b.x, b.y)
    if (d <= bd) { bd = d; best = { kind: 'member', id: mem.id } }
  }
  return best
}

export type PlatePick = { kind: 'vertex'; loop: number; index: number } | { kind: 'edge'; loop: number; index: number; at: Pt }

export function pickPlate(m: Model, x: number, y: number, tol: number): PlatePick | null {
  const p = m.plate
  if (!p) return null
  const loops = [p.outline, ...p.holes]
  let best: PlatePick | null = null
  let bd = tol
  loops.forEach((lp, li) => lp.forEach((q, i) => { const d = Math.hypot(q.x - x, q.y - y); if (d <= bd) { bd = d; best = { kind: 'vertex', loop: li, index: i } } }))
  if (best) return best
  loops.forEach((lp, li) => {
    lp.forEach((q, i) => {
      const r = lp[(i + 1) % lp.length]
      const d = distToSegment(x, y, q.x, q.y, r.x, r.y)
      if (d <= bd) {
        bd = d
        const dx = r.x - q.x
        const dy = r.y - q.y
        const t = Math.max(0, Math.min(1, ((x - q.x) * dx + (y - q.y) * dy) / (dx * dx + dy * dy || 1)))
        best = { kind: 'edge', loop: li, index: i, at: { x: q.x + t * dx, y: q.y + t * dy } }
      }
    })
  })
  return best
}

/** Nodes and members inside a box. */
export function pickInBox(m: Model, x0: number, y0: number, x1: number, y1: number): string[] {
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) }
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) }
  const inside = (n: { x: number; y: number }) => n.x >= lo.x && n.x <= hi.x && n.y >= lo.y && n.y <= hi.y
  const ids: string[] = []
  const nodes = new Set<string>()
  for (const n of m.nodes) if (inside(n)) { ids.push(n.id); nodes.add(n.id) }
  for (const mem of m.members) if (nodes.has(mem.n1) && nodes.has(mem.n2)) ids.push(mem.id)
  return ids
}

// ---------------------------------------------------------------------------- entering numbers in display units

export function lengthToSI(v: number, m: Model): number {
  return toSI(v, 'length', m.units)
}

export { LENGTH_M, isPlate }
export type { LoadDir, NodeLoad }
