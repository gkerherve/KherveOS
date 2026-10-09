// Editing a linkage drawing (pure): every function returns a new document. Used by the canvas and by the tests.

import type { LinkageDoc } from './doc.ts'
import { makeSolver, type LLink, type LPoint, type LSlider } from './linkage.ts'
import { hypot, rad, type Pt } from './math.ts'

export type Pick = { kind: 'point' | 'link' | 'slider'; id: string }

const used = (m: LinkageDoc): Set<string> => new Set([...m.points.map((p) => p.id), ...m.links.map((l) => l.id), ...m.sliders.map((s) => s.id)])

export function newId(m: LinkageDoc, prefix: string): string {
  const taken = used(m)
  for (let i = 1; ; i++) if (!taken.has(`${prefix}${i}`)) return `${prefix}${i}`
}

/** The label to show for a point (its label, else its id). */
export const pointName = (m: LinkageDoc, id: string): string => m.points.find((p) => p.id === id)?.label || id

export function addPoint(m: LinkageDoc, x: number, y: number, ground = false): { m: LinkageDoc; id: string } {
  const id = newId(m, ground ? 'G' : 'P')
  const p: LPoint = { id, x, y, ...(ground ? { ground: true } : {}) }
  return { m: { ...m, points: [...m.points, p] }, id }
}

export function updatePoint(m: LinkageDoc, id: string, patch: Partial<Omit<LPoint, 'id'>>): LinkageDoc {
  return { ...m, points: m.points.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

/** The direction (unit vector) of a ground slider at a point, if the point has one. */
function groundSliderAt(m: LinkageDoc, id: string): LSlider | undefined {
  return m.sliders.find((s) => s.point === id && s.line.kind === 'ground')
}

/** Moves a point; a point on a ground slider stays on its line. */
export function movePoint(m: LinkageDoc, id: string, x: number, y: number): LinkageDoc {
  const s = groundSliderAt(m, id)
  if (s && s.line.kind === 'ground') {
    const ang = rad(s.line.angle)
    const t = (x - s.line.x) * Math.cos(ang) + (y - s.line.y) * Math.sin(ang)
    x = s.line.x + t * Math.cos(ang)
    y = s.line.y + t * Math.sin(ang)
  }
  return updatePoint(m, id, { x, y })
}

export function deleteSlider(m: LinkageDoc, id: string): LinkageDoc {
  return { ...m, sliders: m.sliders.filter((s) => s.id !== id) }
}

export function deleteLink(m: LinkageDoc, id: string): LinkageDoc {
  const l = m.links.find((x) => x.id === id)
  if (!l) return m
  const driver = m.driver && l.pts.includes(m.driver.from) && l.pts.includes(m.driver.to) ? null : m.driver
  return { ...m, links: m.links.filter((x) => x.id !== id), driver }
}

/** Removes a point with everything that hangs on it (links shrink, sliders and the driver go). */
export function deletePoint(m: LinkageDoc, id: string): LinkageDoc {
  const links: LLink[] = []
  for (const l of m.links) {
    if (!l.pts.includes(id)) { links.push(l); continue }
    const pts = l.pts.filter((p) => p !== id)
    if (pts.length >= 2) links.push({ ...l, pts, ...(pts.length < 3 && l.shape === 'plate' ? { shape: 'bar' as const } : {}) })
  }
  const sliders = m.sliders.filter((s) => s.point !== id && !(s.line.kind === 'link' && (s.line.a === id || s.line.b === id)))
  const driver = m.driver && (m.driver.from === id || m.driver.to === id) ? null : m.driver
  const out: LinkageDoc = { ...m, points: m.points.filter((p) => p.id !== id), links, sliders, driver }
  if (m.output && ((m.output.kind === 'point' || m.output.kind === 'slider') && m.output.point === id || (m.output.kind === 'link' && (m.output.from === id || m.output.to === id)))) out.output = undefined
  if (m.loads) out.loads = m.loads.filter((l) => l.point !== id)
  return out
}

export function deletePick(m: LinkageDoc, pick: Pick): LinkageDoc {
  if (pick.kind === 'point') return deletePoint(m, pick.id)
  if (pick.kind === 'link') return deleteLink(m, pick.id)
  return deleteSlider(m, pick.id)
}

/** A bar between two points (nothing is added if one joins them already). */
export function addLink(m: LinkageDoc, a: string, b: string): { m: LinkageDoc; id: string | null } {
  if (a === b) return { m, id: null }
  if (m.links.some((l) => l.pts.length === 2 && l.pts.includes(a) && l.pts.includes(b))) return { m, id: null }
  const pa = m.points.find((p) => p.id === a); const pb = m.points.find((p) => p.id === b)
  if (!pa || !pb) return { m, id: null }
  if (pa.ground && pb.ground) return { m, id: null }
  // the first point of a link is the moving one when only one end is on the ground, so the base never lies on the frame
  const pts = pa.ground && !pb.ground ? [b, a] : [a, b]
  const id = newId(m, 'L')
  return { m: { ...m, links: [...m.links, { id, pts }] }, id }
}

/** Adds a coupler point to a link (the link becomes a plate once it has three points). */
export function addCouplerPoint(m: LinkageDoc, linkId: string, x: number, y: number): { m: LinkageDoc; id: string } | null {
  const l = m.links.find((q) => q.id === linkId)
  if (!l) return null
  const id = newId(m, 'P')
  const links = m.links.map((q) => (q.id === linkId ? { ...q, pts: [...q.pts, id], shape: q.pts.length + 1 >= 3 && (q.shape ?? 'bar') === 'bar' && q.pts.length === 2 ? ('plate' as const) : q.shape } : q))
  return { m: { ...m, points: [...m.points, { id, x, y }], links }, id }
}

/** Puts a point on a ground slider (line through the point at `angle` degrees). */
export function addSlider(m: LinkageDoc, pointId: string, angle = 0): LinkageDoc {
  const p = m.points.find((q) => q.id === pointId)
  if (!p || p.ground) return m
  const rest = m.sliders.filter((s) => s.point !== pointId)
  const id = newId({ ...m, sliders: rest }, 'S')
  return { ...m, sliders: [...rest, { id, point: pointId, line: { kind: 'ground', x: p.x, y: p.y, angle }, mass: 0.1 }] }
}

export function updateSlider(m: LinkageDoc, id: string, patch: Partial<Omit<LSlider, 'id'>>): LinkageDoc {
  return { ...m, sliders: m.sliders.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

/** The driver: the link's ground pin turns the link; `rpm` keeps the old speed when omitted. */
export function setDriverOnLink(m: LinkageDoc, linkId: string, rpm?: number): LinkageDoc {
  const l = m.links.find((q) => q.id === linkId)
  if (!l) return m
  const ground = l.pts.find((id) => m.points.find((p) => p.id === id)?.ground)
  if (!ground) return m
  const other = l.pts.find((id) => id !== ground && !m.points.find((p) => p.id === id)?.ground)
  if (!other) return m
  // the end of the link next to the ground pin in the link order (a crank has just two points)
  return { ...m, driver: { from: ground, to: other, rpm: rpm ?? m.driver?.rpm ?? 30 } }
}

export function toggleTracer(m: LinkageDoc, id: string): LinkageDoc {
  const p = m.points.find((q) => q.id === id)
  return p ? updatePoint(m, id, { tracer: p.tracer ? undefined : true }) : m
}

export function setGround(m: LinkageDoc, id: string, ground: boolean): LinkageDoc {
  return updatePoint(m, id, { ground: ground ? true : undefined })
}

/** Writes the solver's corrected pose into the points (after an edit that left a slider off its line). */
export function settle(m: LinkageDoc): LinkageDoc {
  const s = makeSolver(m)
  if (!s.ok) return m
  let changed = false
  const points = m.points.map((p) => {
    const i = s.sys.index.get(p.id)
    if (i === undefined) return p
    const x = s.X0[2 * i]; const y = s.X0[2 * i + 1]
    if (Math.abs(x - p.x) < 1e-9 && Math.abs(y - p.y) < 1e-9) return p
    changed = true
    return { ...p, x, y }
  })
  return changed ? { ...m, points } : m
}

const segDist = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b.x - a.x; const dy = b.y - a.y
  const L2 = dx * dx + dy * dy
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2))
  return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function inPolygon(poly: readonly Pt[], p: Pt): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > p.y) !== (poly[j].y > p.y) && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c
  }
  return c
}

/** What is under a world point: points first, then links (by their sticks, or inside a plate). `tol` in mm. */
export function pickAt(m: LinkageDoc, pts: ReadonlyMap<string, Pt>, p: Pt, tol: number): Pick | null {
  let best: { id: string; d: number } | null = null
  for (const pt of m.points) {
    const q = pts.get(pt.id)
    if (!q) continue
    const d = hypot(q.x - p.x, q.y - p.y)
    if (d <= tol && (!best || d < best.d)) best = { id: pt.id, d }
  }
  if (best) return { kind: 'point', id: best.id }
  let bestLink: { id: string; d: number } | null = null
  for (const l of m.links) {
    const ps = l.pts.map((id) => pts.get(id)).filter((q): q is Pt => !!q)
    if (ps.length < 2) continue
    let d = Infinity
    if (l.shape === 'star') for (let i = 1; i < ps.length; i++) d = Math.min(d, segDist(p, ps[0], ps[i]))
    else for (let i = 0; i + 1 < ps.length; i++) d = Math.min(d, segDist(p, ps[i], ps[i + 1]))
    if (l.shape === 'plate' && ps.length >= 3) {
      d = Math.min(d, segDist(p, ps[ps.length - 1], ps[0]))
      if (inPolygon(ps, p)) d = 0
    }
    if (d <= tol && (!bestLink || d < bestLink.d)) bestLink = { id: l.id, d }
  }
  return bestLink ? { kind: 'link', id: bestLink.id } : null
}

/** The nearest point (of any kind) within `tol`, for snapping a new link end onto it. */
export function nearestPoint(m: LinkageDoc, pts: ReadonlyMap<string, Pt>, p: Pt, tol: number): string | null {
  const hit = pickAt({ ...m, links: [] }, pts, p, tol)
  return hit && hit.kind === 'point' ? hit.id : null
}

/** Bounds of the drawing (points, slider ends and tracer paths if given). */
export function boundsOf(pts: Iterable<Pt>): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
  if (!Number.isFinite(minX)) return { minX: -100, minY: -75, maxX: 100, maxY: 75 }
  return { minX, minY, maxX, maxY }
}

/** Link length (first two points). */
export function linkLength(m: LinkageDoc, linkId: string): number {
  const l = m.links.find((q) => q.id === linkId)
  if (!l || l.pts.length < 2) return 0
  const a = m.points.find((p) => p.id === l.pts[0]); const b = m.points.find((p) => p.id === l.pts[1])
  return a && b ? hypot(b.x - a.x, b.y - a.y) : 0
}

/** A link's lengths for display: the distances between consecutive points. */
export function linkSpans(m: LinkageDoc, l: LLink): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < l.pts.length; i++) {
    const a = m.points.find((p) => p.id === l.pts[i]); const b = m.points.find((p) => p.id === l.pts[i + 1])
    out.push(a && b ? hypot(b.x - a.x, b.y - a.y) : 0)
  }
  return out
}

/** Sets a link's length by moving its second point along the link (the first stays). */
export function setLinkLength(m: LinkageDoc, linkId: string, length: number): LinkageDoc {
  const l = m.links.find((q) => q.id === linkId)
  if (!l || l.pts.length < 2 || !(length > 0)) return m
  const a = m.points.find((p) => p.id === l.pts[0]); const b = m.points.find((p) => p.id === l.pts[1])
  if (!a || !b) return m
  const d = hypot(b.x - a.x, b.y - a.y)
  if (d < 1e-9) return m
  // the first point stays; the second and the other points of the link scale along the link
  const f = length / d
  const nb = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  const rest = l.pts.slice(2)
  return {
    ...m,
    points: m.points.map((p) => {
      if (p.id === b.id && !p.ground) return { ...p, ...nb }
      if (rest.includes(p.id) && !p.ground) return { ...p, x: a.x + (p.x - a.x) * f, y: a.y + (p.y - a.y) * f }
      return p
    }),
  }
}

// ------------------------------------------------------------------------------ the drawing tools

export type Tool = 'select' | 'ground' | 'joint' | 'link' | 'coupler' | 'slider' | 'driver' | 'tracer' | 'erase'

export interface LinkStart {
  /** an existing joint, or null for a new one at `at` */
  id: string | null
  at: Pt
}

export interface ToolResult {
  /** the new drawing, when the click changed it */
  model?: LinkageDoc
  /** the new selection (null clears it) */
  pick?: Pick | null
  /** the bar being drawn: set after the first click, cleared (undefined) when done or refused */
  linkFrom?: LinkStart | null
  /** something to tell the user */
  say?: string
  /** a drag of a joint starts (select tool) */
  drag?: { id: string; dx: number; dy: number }
}

const NO_GROUND_LINK = 'That bar has no ground pin to turn about.'

/**
 * What one click of a tool does. `p` is the click in the drawing, `sp` the same snapped to the grid, `pts` the pose the
 * click is made on (the drawn pose) and `tol` the pick distance in mm.
 */
export function toolClick(m: LinkageDoc, tool: Tool, p: Pt, sp: Pt, tol: number, linkFrom: LinkStart | null): ToolResult {
  const pts = new Map(m.points.map((q) => [q.id, { x: q.x, y: q.y }]))
  const hit = pickAt(m, pts, p, tol)
  switch (tool) {
    case 'select': {
      if (hit?.kind === 'point') {
        const pt = m.points.find((q) => q.id === hit.id)!
        return { pick: hit, drag: { id: hit.id, dx: pt.x - p.x, dy: pt.y - p.y } }
      }
      return { pick: hit }
    }
    case 'ground':
    case 'joint': {
      if (hit?.kind === 'point') return { pick: hit }
      const r = addPoint(m, sp.x, sp.y, tool === 'ground')
      return { model: r.m, pick: { kind: 'point', id: r.id } }
    }
    case 'link': {
      const existing = hit?.kind === 'point' ? hit.id : nearestPoint(m, pts, p, tol)
      const here = existing ? pts.get(existing)! : sp
      if (!linkFrom) return { linkFrom: { id: existing, at: here }, say: 'Now click the other end of the bar (Esc cancels).' }
      let next = m
      let a = linkFrom.id
      if (!a) { const r = addPoint(next, linkFrom.at.x, linkFrom.at.y); next = r.m; a = r.id }
      let b = existing
      if (!b) { const r = addPoint(next, sp.x, sp.y); next = r.m; b = r.id }
      const r = addLink(next, a, b)
      if (!r.id) return { linkFrom: null, say: a === b ? 'A bar needs two different joints.' : 'Those joints are already joined by a bar (or both are ground pins).' }
      // keep going from the joint just made: a chain of bars
      return { model: r.m, pick: { kind: 'link', id: r.id }, linkFrom: { id: b, at: { x: r.m.points.find((q) => q.id === b)!.x, y: r.m.points.find((q) => q.id === b)!.y } } }
    }
    case 'coupler': {
      if (hit?.kind !== 'link') return { say: 'Click on a link to attach a point to it.' }
      const r = addCouplerPoint(m, hit.id, sp.x, sp.y)
      return r ? { model: r.m, pick: { kind: 'point', id: r.id } } : {}
    }
    case 'slider': {
      if (hit?.kind !== 'point') return { say: 'Click a joint to make it a slider.' }
      const pt = m.points.find((q) => q.id === hit.id)!
      if (pt.ground) return { say: 'A ground pin cannot slide: pick a free joint.' }
      const next = addSlider(m, hit.id, 0)
      return { model: next, pick: { kind: 'slider', id: next.sliders.find((s) => s.point === hit.id)!.id } }
    }
    case 'driver': {
      let linkId: string | null = hit?.kind === 'link' ? hit.id : null
      if (hit?.kind === 'point') linkId = m.links.find((l) => l.pts.includes(hit.id) && l.pts.some((id) => m.points.find((q) => q.id === id)?.ground))?.id ?? null
      if (!linkId) return { say: 'Click a bar that has a ground pin: it becomes the crank.' }
      const next = setDriverOnLink(m, linkId)
      return next === m ? { say: NO_GROUND_LINK } : { model: next, pick: { kind: 'link', id: linkId } }
    }
    case 'tracer':
      return hit?.kind === 'point' ? { model: toggleTracer(m, hit.id), pick: hit } : { say: 'Click a joint to trace its path.' }
    case 'erase':
      return hit ? { model: deletePick(m, hit), pick: null } : {}
  }
}
