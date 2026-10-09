// What is drawn (pure): lists of drawing primitives in world coordinates (mm, y up) for the three workbenches.
// The canvas component paints them; sceneToSvg writes the same picture as an SVG figure. Sizes marked "px" stay the
// same on screen at any zoom. The mechanism is drawn in fixed legible colours on a fixed dark sheet.

import type { Cycle } from './analysis.ts'
import type { CamProfile, CamSpec } from './cam.ts'
import { followerAt } from './cam.ts'
import type { LinkageDoc } from './doc.ts'
import { esc, hypot, rad, TAU, type Pt } from './math.ts'
import type { Pick } from './edit.ts'
import { slideOf, type EngineSpec } from './engine.ts'
import { sliderX } from './fourbar.ts'
import { gearOutline, meshAngles, pairGeometry, placePoints, type GearGeometry, type PairGeometry } from './gear.ts'

export const COLORS = {
  bg: '#10161d', grid: '#19222c', gridMajor: '#243241', axis: '#3b4d5f', ground: '#8796a6', crank: '#34d399', rocker: '#f59e0b', coupler: '#60a5fa', other: '#a78bfa', sel: '#fde047',
  hover: '#ffffff', joint: '#0b0f14', jointRing: '#e6edf3', tracer: '#fb7185', slider: '#94a3b8', text: '#c9d4df', muted: '#7d8b99', velocity: '#22d3ee', warn: '#f87171',
  cam: '#34d399', camFill: 'rgba(52,211,153,0.16)', follower: '#fbbf24', construction: '#4b6a88', gearA: '#60a5fa', gearB: '#f59e0b', gearC: '#a78bfa', gearD: '#34d399',
} as const

export interface Style {
  stroke?: string
  fill?: string
  /** line width in px */
  width?: number
  /** dash pattern in px */
  dash?: number[]
  cap?: 'round' | 'butt'
}

export type Prim =
  | { k: 'path'; pts: readonly Pt[]; closed?: boolean; style: Style; hole?: readonly Pt[] }
  | { k: 'circle'; c: Pt; /** mm */ r?: number; /** px (when r is not given) */ rpx?: number; style: Style }
  | { k: 'text'; at: Pt; text: string; px: number; color: string; anchor?: 'start' | 'middle' | 'end'; /** px offset on screen */ dx?: number; dy?: number }
  | { k: 'arrow'; a: Pt; b: Pt; style: Style }
  | { k: 'ground'; at: Pt; px: number; color: string }
  | { k: 'block'; at: Pt; angle: number; /** px */ w: number; h: number; style: Style }

// ------------------------------------------------------------------------------ the sheet

export function gridPrims(box: { minX: number; minY: number; maxX: number; maxY: number }, step: number): Prim[] {
  const out: Prim[] = []
  const x0 = Math.floor(box.minX / step) * step; const y0 = Math.floor(box.minY / step) * step
  const nx = Math.ceil((box.maxX - x0) / step); const ny = Math.ceil((box.maxY - y0) / step)
  if (nx > 400 || ny > 400) return out
  for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step
    const major = Math.abs(Math.round(x / (step * 5)) * step * 5 - x) < step * 1e-6
    out.push({ k: 'path', pts: [{ x, y: box.minY }, { x, y: box.maxY }], style: { stroke: x === 0 ? COLORS.axis : major ? COLORS.gridMajor : COLORS.grid, width: 1 } })
  }
  for (let j = 0; j <= ny; j++) {
    const y = y0 + j * step
    const major = Math.abs(Math.round(y / (step * 5)) * step * 5 - y) < step * 1e-6
    out.push({ k: 'path', pts: [{ x: box.minX, y }, { x: box.maxX, y }], style: { stroke: y === 0 ? COLORS.axis : major ? COLORS.gridMajor : COLORS.grid, width: 1 } })
  }
  return out
}

// ------------------------------------------------------------------------------ linkage

export interface LinkageSceneOptions {
  pick?: Pick | null
  hover?: Pick | null
  /** paths of tracer points (from a cycle) */
  paths?: Record<string, readonly Pt[]>
  labels?: boolean
  dims?: boolean
  /** velocity arrows (point → vector in mm, already scaled) */
  arrows?: ReadonlyMap<string, Pt> | null
  /** world box for the infinite slider lines */
  extent?: { minX: number; minY: number; maxX: number; maxY: number }
  /** an engine (draws the cylinder) */
  engine?: EngineSpec | null
  /** current input angle in radians for the driver arc */
  theta?: number
}

const roleColor = (m: LinkageDoc, linkId: string): string => {
  const l = m.links.find((x) => x.id === linkId)!
  const drv = m.driver && l.pts.includes(m.driver.from) && l.pts.includes(m.driver.to)
  if (drv) return COLORS.crank
  if (l.pts.some((id) => m.points.find((p) => p.id === id)?.ground)) return COLORS.rocker
  return l.pts.length > 2 ? COLORS.other : COLORS.coupler
}

export function linkageScene(m: LinkageDoc, pts: ReadonlyMap<string, Pt>, o: LinkageSceneOptions = {}): Prim[] {
  const out: Prim[] = []
  const ext = o.extent ?? { minX: -300, minY: -300, maxX: 300, maxY: 300 }
  const diag = hypot(ext.maxX - ext.minX, ext.maxY - ext.minY) * 1.2 + 200
  // engine cylinder
  if (o.engine && m.sliders.length) {
    const s = m.sliders[0]
    if (s.line.kind === 'ground') {
      const e = o.engine; const sl = slideOf(e)
      const ang = rad(s.line.angle)
      const u = { x: Math.cos(ang), y: Math.sin(ang) }; const n = { x: -u.y, y: u.x }
      const o0 = { x: s.line.x, y: s.line.y }
      const at = (t: number, h: number): Pt => ({ x: o0.x + u.x * t + n.x * h, y: o0.y + u.y * t + n.y * h })
      // the piston-pin distance from the crank axis runs from l − r … l + r: the liner covers the stroke plus the piston
      const top = sliderX(sl, 0) + e.stroke * 0.35
      const bot = sliderX(sl, Math.PI) - e.stroke * 0.25
      const half = e.bore / 2
      out.push({ k: 'path', pts: [at(bot, half), at(top, half), at(top, -half), at(bot, -half)], style: { stroke: COLORS.construction, width: 2 } })
    }
  }
  // slider lines
  for (const s of m.sliders) {
    if (s.line.kind === 'ground') {
      const ang = rad(s.line.angle)
      const u = { x: Math.cos(ang), y: Math.sin(ang) }
      out.push({ k: 'path', pts: [{ x: s.line.x - u.x * diag, y: s.line.y - u.y * diag }, { x: s.line.x + u.x * diag, y: s.line.y + u.y * diag }], style: { stroke: COLORS.slider, width: 1, dash: [6, 5] } })
    }
  }
  // links
  for (const l of m.links) {
    const ps = l.pts.map((id) => pts.get(id)).filter((p): p is Pt => !!p)
    if (ps.length < 2) continue
    const sel = o.pick?.kind === 'link' && o.pick.id === l.id
    const hov = o.hover?.kind === 'link' && o.hover.id === l.id
    const col = sel ? COLORS.sel : roleColor(m, l.id)
    const width = sel ? 8 : hov ? 7 : 6
    if (l.shape === 'plate' && ps.length >= 3) {
      out.push({ k: 'path', pts: ps, closed: true, style: { stroke: col, fill: `${col}33`, width: sel ? 3 : 2 } })
    } else if (l.shape === 'star') {
      for (let i = 1; i < ps.length; i++) out.push({ k: 'path', pts: [ps[0], ps[i]], style: { stroke: col, width: width - 2, cap: 'round' } })
      out.push({ k: 'circle', c: ps[0], rpx: 11, style: { stroke: col, fill: `${col}55`, width: 2 } })
    } else {
      out.push({ k: 'path', pts: ps, style: { stroke: col, width, cap: 'round' } })
    }
    if (o.dims && !(l.shape === 'plate' && ps.length >= 3)) {
      for (let i = 0; i + 1 < ps.length; i++) {
        const a = ps[i]; const b = ps[i + 1]
        out.push({ k: 'text', at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, text: `${Number(hypot(b.x - a.x, b.y - a.y).toPrecision(4))}`, px: 11, color: COLORS.text, anchor: 'middle', dy: -9 })
      }
    }
  }
  // slider blocks
  for (const s of m.sliders) {
    const p = pts.get(s.point)
    if (!p) continue
    let ang = 0
    if (s.line.kind === 'ground') ang = rad(s.line.angle)
    else { const a = pts.get(s.line.a); const b = pts.get(s.line.b); if (a && b) ang = Math.atan2(b.y - a.y, b.x - a.x) }
    const sel = o.pick?.kind === 'slider' && o.pick.id === s.id
    out.push({ k: 'block', at: p, angle: ang, w: 26, h: 16, style: { stroke: sel ? COLORS.sel : COLORS.slider, fill: sel ? '#fde04733' : '#94a3b833', width: sel ? 3 : 2 } })
  }
  // ground symbols and joints
  for (const pt of m.points) {
    const p = pts.get(pt.id)
    if (!p) continue
    if (pt.ground) out.push({ k: 'ground', at: p, px: 13, color: COLORS.ground })
  }
  // tracer paths
  for (const [id, path] of Object.entries(o.paths ?? {})) {
    if (path.length > 1) out.push({ k: 'path', pts: path, style: { stroke: COLORS.tracer, width: 1.6, dash: id ? [] : [4, 3] } })
  }
  // velocity arrows
  if (o.arrows) for (const [id, v] of o.arrows) {
    const p = pts.get(id)
    if (p && hypot(v.x, v.y) > 1e-6) out.push({ k: 'arrow', a: p, b: { x: p.x + v.x, y: p.y + v.y }, style: { stroke: COLORS.velocity, width: 2 } })
  }
  for (const pt of m.points) {
    const p = pts.get(pt.id)
    if (!p) continue
    const sel = o.pick?.kind === 'point' && o.pick.id === pt.id
    const hov = o.hover?.kind === 'point' && o.hover.id === pt.id
    out.push({ k: 'circle', c: p, rpx: sel || hov ? 6.5 : 5, style: { stroke: sel ? COLORS.sel : pt.tracer ? COLORS.tracer : COLORS.jointRing, fill: COLORS.joint, width: sel ? 3 : 2 } })
    if (pt.tracer) out.push({ k: 'circle', c: p, rpx: 2, style: { fill: COLORS.tracer } })
    if (o.labels && (pt.label || pt.id)) out.push({ k: 'text', at: p, text: pt.label || pt.id, px: 11, color: COLORS.muted, anchor: 'start', dx: 8, dy: -8 })
  }
  // the driver’s arc
  if (m.driver) {
    const a = pts.get(m.driver.from); const b = pts.get(m.driver.to)
    if (a && b) {
      const L = hypot(b.x - a.x, b.y - a.y)
      const ang0 = Math.atan2(b.y - a.y, b.x - a.x)
      const arc: Pt[] = []
      for (let i = 0; i <= 24; i++) { const t = ang0 + (i / 24) * 0.9; arc.push({ x: a.x + 0.4 * L * Math.cos(t), y: a.y + 0.4 * L * Math.sin(t) }) }
      out.push({ k: 'path', pts: arc, style: { stroke: COLORS.crank, width: 1.5, dash: [3, 3] } })
      out.push({ k: 'arrow', a: arc[arc.length - 2], b: arc[arc.length - 1], style: { stroke: COLORS.crank, width: 1.5 } })
    }
  }
  return out
}

// ------------------------------------------------------------------------------ cam

export interface CamSceneOptions {
  theta: number
  profile: CamProfile
  showPitch?: boolean
  showCircles?: boolean
  /** compare: a second profile drawn faintly */
  ghost?: CamProfile | null
  warn?: boolean
}

const rot = (pts: readonly Pt[], a: number): Pt[] => {
  const c = Math.cos(a); const s = Math.sin(a)
  return pts.map((p) => ({ x: c * p.x - s * p.y, y: s * p.x + c * p.y }))
}

export function camScene(spec: CamSpec, o: CamSceneOptions): Prim[] {
  const out: Prim[] = []
  const th = rad(o.theta) * (spec.direction === 'cw' ? -1 : 1)
  const prof = o.profile
  const R = spec.baseRadius
  const circle = (r: number, c: Pt = { x: 0, y: 0 }, dash = [5, 4]): Prim => ({ k: 'circle', c, r, style: { stroke: COLORS.construction, width: 1, dash } })
  if (o.showCircles !== false) {
    out.push(circle(R), circle(prof.stats.primeRadius, { x: 0, y: 0 }, [2, 4]))
  }
  if (o.ghost) out.push({ k: 'path', pts: rot(o.ghost.profile, th), closed: true, style: { stroke: COLORS.rocker, width: 1.5, dash: [6, 4] } })
  if (o.showPitch) out.push({ k: 'path', pts: rot(prof.pitch, th), closed: true, style: { stroke: COLORS.construction, width: 1, dash: [3, 3] } })
  out.push({ k: 'path', pts: rot(prof.profile, th), closed: true, style: { stroke: o.warn ? COLORS.warn : COLORS.cam, fill: COLORS.camFill, width: 2.5 }, hole: undefined })
  // bore and centre
  if (spec.bore > 0) out.push({ k: 'circle', c: { x: 0, y: 0 }, r: spec.bore / 2, style: { stroke: COLORS.muted, width: 1.5 } })
  out.push({ k: 'circle', c: { x: 0, y: 0 }, rpx: 3, style: { fill: COLORS.muted } })
  // follower, in the fixed frame
  const f = followerAt(spec, o.theta)
  const col = COLORS.follower
  if (spec.follower === 'flat') {
    const half = Math.max(prof.stats.faceHalfWidth * 1.25, R * 0.35)
    out.push({ k: 'path', pts: [{ x: -half, y: f.tip.y }, { x: half, y: f.tip.y }], style: { stroke: col, width: 5, cap: 'round' } })
    out.push({ k: 'path', pts: [{ x: 0, y: f.tip.y }, { x: 0, y: f.tip.y + R * 1.6 }], style: { stroke: col, width: 5 } })
    out.push({ k: 'path', pts: [{ x: -R * 0.3, y: f.tip.y + R * 0.5 }, { x: -R * 0.3, y: f.tip.y + R * 1.7 }], style: { stroke: COLORS.construction, width: 1, dash: [4, 3] } })
  } else if (spec.motion === 'swing') {
    const piv = { x: spec.pivotDistance, y: 0 }
    out.push({ k: 'path', pts: [piv, f.tip], style: { stroke: col, width: 6, cap: 'round' } })
    out.push({ k: 'ground', at: piv, px: 13, color: COLORS.ground })
    out.push({ k: 'circle', c: piv, rpx: 5, style: { stroke: COLORS.jointRing, fill: COLORS.joint, width: 2 } })
    if (spec.follower === 'roller') out.push({ k: 'circle', c: f.tip, r: spec.rollerRadius, style: { stroke: col, fill: '#fbbf2433', width: 2.5 } })
    else out.push({ k: 'circle', c: f.tip, rpx: 4, style: { fill: col } })
  } else {
    out.push({ k: 'path', pts: [{ x: f.tip.x, y: f.tip.y }, { x: f.tip.x, y: f.tip.y + R * 2 }], style: { stroke: col, width: 6, cap: 'round' } })
    if (spec.follower === 'roller') {
      out.push({ k: 'circle', c: f.tip, r: spec.rollerRadius, style: { stroke: col, fill: '#fbbf2433', width: 2.5 } })
      out.push({ k: 'circle', c: f.tip, rpx: 2.5, style: { fill: col } })
    } else out.push({ k: 'path', pts: [{ x: f.tip.x - 5, y: f.tip.y + 9 }, { x: f.tip.x, y: f.tip.y }, { x: f.tip.x + 5, y: f.tip.y + 9 }], closed: true, style: { stroke: col, fill: col, width: 1.5 } })
  }
  return out
}

// ------------------------------------------------------------------------------ gears

export function outlineLoop(g: GearGeometry, cache?: Pt[]): Pt[] {
  return cache ?? gearOutline(g)
}

export interface PairSceneOptions {
  /** rotation of gear 1, radians */
  phi: number
  /** precomputed outlines */
  o1?: readonly Pt[]
  o2?: readonly Pt[]
  circles?: boolean
  contact?: boolean
  labels?: boolean
}

export function pairScene(pg: PairGeometry, o: PairSceneOptions): Prim[] {
  const out: Prim[] = []
  const a = meshAngles(pg.g1, pg.g2, o.phi)
  const c2 = { x: pg.aw, y: 0 }
  const o1 = o.o1 ?? gearOutline(pg.g1)
  const o2 = o.o2 ?? gearOutline(pg.g2)
  out.push({ k: 'path', pts: placePoints(o1, a.phi1), closed: true, style: { stroke: COLORS.gearA, fill: `${COLORS.gearA}2a`, width: 2 } })
  out.push({ k: 'path', pts: placePoints(o2, a.phi2, c2), closed: true, style: { stroke: COLORS.gearB, fill: `${COLORS.gearB}2a`, width: 2 } })
  if (o.circles !== false) {
    const rw1 = pg.g1.rb / Math.cos(pg.alphaW); const rw2 = pg.g2.rb / Math.cos(pg.alphaW)
    out.push({ k: 'circle', c: { x: 0, y: 0 }, r: rw1, style: { stroke: COLORS.construction, width: 1, dash: [5, 4] } })
    out.push({ k: 'circle', c: c2, r: rw2, style: { stroke: COLORS.construction, width: 1, dash: [5, 4] } })
    out.push({ k: 'circle', c: { x: 0, y: 0 }, r: pg.g1.rb, style: { stroke: COLORS.construction, width: 1, dash: [2, 3] } })
    out.push({ k: 'circle', c: c2, r: pg.g2.rb, style: { stroke: COLORS.construction, width: 1, dash: [2, 3] } })
  }
  if (o.contact !== false) {
    // the line of action: tangent to both base circles
    const aw = pg.aw; const al = pg.alphaW
    const T1 = { x: pg.g1.rb * Math.sin(al), y: pg.g1.rb * Math.cos(al) } // point on base circle 1 (above the line of centres)
    const T2 = { x: aw - pg.g2.rb * Math.sin(al), y: -pg.g2.rb * Math.cos(al) }
    out.push({ k: 'path', pts: [{ x: T1.x, y: -T1.y }, { x: T2.x, y: -T2.y }], style: { stroke: COLORS.velocity, width: 1.2, dash: [8, 4] } })
  }
  out.push({ k: 'circle', c: { x: 0, y: 0 }, rpx: 3, style: { fill: COLORS.muted } })
  out.push({ k: 'circle', c: c2, rpx: 3, style: { fill: COLORS.muted } })
  return out
}

/** A gear drawn alone (for export). */
export function gearScene(g: GearGeometry, phi = 0): Prim[] {
  const o = gearOutline(g)
  return [
    { k: 'path', pts: placePoints(o, phi), closed: true, style: { stroke: COLORS.gearA, fill: `${COLORS.gearA}2a`, width: 2 } },
    { k: 'circle', c: { x: 0, y: 0 }, r: g.d / 2, style: { stroke: COLORS.construction, width: 1, dash: [5, 4] } },
  ]
}

export interface TrainLayout {
  gears: Array<{ z: number; module: number; at: Pt; shaft: number; /** rotation = phase + ratio × (input rotation) */ phase: number; ratio: number; /** rpm */ speed: number; color: string }>
}

/**
 * Lays a chain of meshes out left to right, alternating up and down so compound gears on one shaft do not collide.
 * Each gear gets the phase that makes its teeth fit the previous gear at the start, and the ratio of its rotation to the input's.
 */
export function trainLayout(stages: ReadonlyArray<{ driver: number; driven: number; shared?: boolean; mesh?: string }>, module: number, inputRpm: number): TrainLayout {
  const gears: TrainLayout['gears'] = []
  if (!stages.length) return { gears }
  const palette = [COLORS.gearA, COLORS.gearB, COLORS.gearC, COLORS.gearD]
  let at: Pt = { x: 0, y: 0 }
  let speed = inputRpm
  let dir = 1
  let phase = 0
  let ratio = 1
  gears.push({ z: stages[0].driver, module, at, shaft: 0, phase, ratio, speed, color: palette[0] })
  stages.forEach((s, i) => {
    const rd = (s.driver * module) / 2; const rn = (s.driven * module) / 2
    const ang = (dir * Math.PI) / 5
    const next = { x: at.x + (rd + rn) * Math.cos(ang), y: at.y + (rd + rn) * Math.sin(ang) }
    const k = s.driver / s.driven
    speed *= s.mesh === 'internal' || s.mesh === 'worm' ? k : -k
    // meshAngles in a frame turned by `ang`
    phase = ang * (1 + k) + Math.PI + Math.PI / s.driven - k * phase
    ratio = -k * ratio
    gears.push({ z: s.driven, module, at: next, shaft: i + 1, phase, ratio, speed, color: palette[(i + 1) % 4] })
    const nx = stages[i + 1]
    if (nx && !s.shared) gears.push({ z: nx.driver, module, at: next, shaft: i + 1, phase, ratio, speed, color: palette[(i + 2) % 4] })
    at = next
    dir = -dir
  })
  return { gears }
}

/**
 * A planetary set: the planets mesh with the sun at their carrier angle, the ring follows the Willis relation
 * Zs(θs − θc) + Zr(θr − θc) = 0, with the phases chosen so that every tooth fits at the start.
 */
export function planetaryScene(Zs: number, Zr: number, n: number, module: number, thetaSun: number, thetaCarrier: number, outlines: { sun: readonly Pt[]; planet: readonly Pt[]; ring: readonly Pt[] }): Prim[] {
  const out: Prim[] = []
  const Zp = (Zr - Zs) / 2
  const rs = (Zs * module) / 2; const rp = (Zp * module) / 2; const rr = (Zr * module) / 2
  const carrier = rs + rp
  // is there a planet tooth or a gap on the line to the ring at the start?
  const planetPhase0 = Math.PI + Math.PI / Zp
  const frac = (planetPhase0 / (TAU / Zp)) % 1
  const toothAtZero = Math.abs(frac) < 1e-9 || Math.abs(frac - 1) < 1e-9
  const ring0 = toothAtZero ? -Math.PI / Zr : 0
  const thetaRing = thetaCarrier - (Zs / Zr) * (thetaSun - thetaCarrier) + ring0
  // the ring’s inside is the outline of an external gear of Zr teeth turned by half a pitch
  const ringIn = placePoints(outlines.ring, thetaRing + Math.PI / Zr)
  const outerR = rr + 2.6 * module
  const outer: Pt[] = Array.from({ length: 120 }, (_, i) => ({ x: outerR * Math.cos((i / 120) * TAU), y: outerR * Math.sin((i / 120) * TAU) }))
  out.push({ k: 'path', pts: outer, closed: true, hole: ringIn, style: { stroke: COLORS.gearC, fill: `${COLORS.gearC}26`, width: 2 } })
  out.push({ k: 'path', pts: placePoints(outlines.sun, thetaSun), closed: true, style: { stroke: COLORS.gearA, fill: `${COLORS.gearA}33`, width: 2 } })
  for (let i = 0; i < n; i++) {
    const a = thetaCarrier + (i / n) * TAU
    const at = { x: carrier * Math.cos(a), y: carrier * Math.sin(a) }
    const rot = a + planetPhase0 - (Zs / Zp) * (thetaSun - a)
    out.push({ k: 'path', pts: [{ x: 0, y: 0 }, at], style: { stroke: COLORS.construction, width: 3, cap: 'round' } })
    out.push({ k: 'path', pts: placePoints(outlines.planet, rot, at), closed: true, style: { stroke: COLORS.gearB, fill: `${COLORS.gearB}33`, width: 2 } })
    out.push({ k: 'circle', c: at, rpx: 3, style: { fill: COLORS.muted } })
  }
  out.push({ k: 'circle', c: { x: 0, y: 0 }, rpx: 4, style: { fill: COLORS.muted } })
  return out
}

export function beltScene(D: number, d: number, C: number, crossed: boolean, phase: number): Prim[] {
  const out: Prim[] = []
  const R = D / 2; const r = d / 2
  const c1 = { x: 0, y: 0 }; const c2 = { x: C, y: 0 }
  const spokes = (c: Pt, rad_: number, sign: number): Prim[] =>
    [0, 1, 2, 3, 4, 5].map((i) => {
      const a = sign * phase + (i / 6) * TAU
      return { k: 'path', pts: [c, { x: c.x + rad_ * 0.85 * Math.cos(a), y: c.y + rad_ * 0.85 * Math.sin(a) }], style: { stroke: COLORS.construction, width: 1.5 } } as Prim
    })
  out.push({ k: 'circle', c: c1, r: R, style: { stroke: COLORS.gearA, fill: `${COLORS.gearA}22`, width: 2 } })
  out.push({ k: 'circle', c: c2, r, style: { stroke: COLORS.gearB, fill: `${COLORS.gearB}22`, width: 2 } })
  out.push(...spokes(c1, R, 1), ...spokes(c2, r, (crossed ? -1 : 1) * (R / r)))
  const nx = crossed ? -(R + r) / C : (R - r) / C
  if (Math.abs(nx) < 1) {
    const ny = Math.sqrt(1 - nx * nx)
    for (const sy of [1, -1]) {
      const n = { x: nx, y: sy * ny }
      const a = { x: R * n.x, y: R * n.y }
      const b = crossed ? { x: C - r * n.x, y: -r * n.y } : { x: C + r * n.x, y: r * n.y }
      out.push({ k: 'path', pts: [a, b], style: { stroke: COLORS.velocity, width: 2.5 } })
    }
  }
  return out
}

// ------------------------------------------------------------------------------ SVG

/** A scene as an SVG figure; `pxPerMm` converts the "px" sizes to millimetres. */
export function sceneToSvg(prims: readonly Prim[], box: { minX: number; minY: number; maxX: number; maxY: number }, opts: { pxPerMm?: number; background?: string; title?: string } = {}): string {
  const k = 1 / (opts.pxPerMm ?? 2)
  const w = box.maxX - box.minX; const h = box.maxY - box.minY
  const X = (x: number) => Number((x - box.minX).toFixed(3))
  const Y = (y: number) => Number((box.maxY - y).toFixed(3))
  const fmtDash = (d?: number[]) => (d && d.length ? ` stroke-dasharray="${d.map((v) => Number((v * k).toFixed(3))).join(' ')}"` : '')
  const st = (s: Style) => `fill="${esc(s.fill ?? 'none')}" stroke="${esc(s.stroke ?? 'none')}" stroke-width="${Number(((s.width ?? 1) * k).toFixed(3))}"${fmtDash(s.dash)}${s.cap === 'round' ? ' stroke-linecap="round" stroke-linejoin="round"' : ''}`
  const body: string[] = []
  for (const p of prims) {
    if (p.k === 'path') {
      const d = (pts: readonly Pt[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.x)} ${Y(q.y)}`).join('') + 'Z'
      const dd = p.pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.x)} ${Y(q.y)}`).join('') + (p.closed ? 'Z' : '') + (p.hole ? d(p.hole) : '')
      body.push(`<path d="${dd}" ${st(p.style)}${p.hole ? ' fill-rule="evenodd"' : ''}/>`)
    } else if (p.k === 'circle') body.push(`<circle cx="${X(p.c.x)}" cy="${Y(p.c.y)}" r="${Number((p.r ?? (p.rpx ?? 3) * k).toFixed(3))}" ${st(p.style)}/>`)
    else if (p.k === 'text') body.push(`<text x="${X(p.at.x) + (p.dx ?? 0) * k}" y="${Y(p.at.y) + (p.dy ?? 0) * k}" font-size="${Number((p.px * k).toFixed(3))}" fill="${esc(p.color)}" font-family="sans-serif" text-anchor="${p.anchor ?? 'start'}">${esc(p.text)}</text>`)
    else if (p.k === 'arrow') {
      const ang = Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x); const hs = 8 * k
      const h1 = { x: p.b.x - hs * Math.cos(ang - 0.4), y: p.b.y - hs * Math.sin(ang - 0.4) }; const h2 = { x: p.b.x - hs * Math.cos(ang + 0.4), y: p.b.y - hs * Math.sin(ang + 0.4) }
      body.push(`<path d="M${X(p.a.x)} ${Y(p.a.y)}L${X(p.b.x)} ${Y(p.b.y)}M${X(h1.x)} ${Y(h1.y)}L${X(p.b.x)} ${Y(p.b.y)}L${X(h2.x)} ${Y(h2.y)}" ${st(p.style)}/>`)
    } else if (p.k === 'ground') {
      const s = p.px * k
      body.push(`<path d="M${X(p.at.x)} ${Y(p.at.y)}L${X(p.at.x) - s * 0.8} ${Y(p.at.y) + s}H${X(p.at.x) + s * 0.8}Z" fill="none" stroke="${esc(p.color)}" stroke-width="${Number((1.5 * k).toFixed(3))}"/>`)
    } else {
      const c = Math.cos(p.angle); const s = Math.sin(p.angle)
      const hw = (p.w * k) / 2; const hh = (p.h * k) / 2
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: p.at.x + c * x - s * y, y: p.at.y + s * x + c * y }))
      body.push(`<path d="${corners.map((q, i) => `${i ? 'L' : 'M'}${X(q.x)} ${Y(q.y)}`).join('')}Z" ${st(p.style)}/>`)
    }
  }
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Number(w.toFixed(2))}mm" height="${Number(h.toFixed(2))}mm" viewBox="0 0 ${Number(w.toFixed(3))} ${Number(h.toFixed(3))}">`,
    opts.title ? `<title>${esc(opts.title)}</title>` : '',
    `<rect width="100%" height="100%" fill="${opts.background ?? COLORS.bg}"/>`,
    ...body,
    `</svg>`,
    '',
  ].filter(Boolean).join('\n')
}

/** The box of everything in a scene (px sizes ignored). */
export function sceneBounds(prims: readonly Prim[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  for (const p of prims) {
    if (p.k === 'path') {
      // very long construction lines (grid, slider lines) are ignored: only drawn things count
      if (p.style.dash && p.pts.length === 2 && hypot(p.pts[1].x - p.pts[0].x, p.pts[1].y - p.pts[0].y) > 2000) continue
      for (const q of p.pts) add(q.x, q.y)
    } else if (p.k === 'circle') { const r = p.r ?? 4; add(p.c.x - r, p.c.y - r); add(p.c.x + r, p.c.y + r) }
    else if (p.k === 'arrow') { add(p.a.x, p.a.y); add(p.b.x, p.b.y) }
    else if (p.k === 'ground' || p.k === 'block') add(p.at.x, p.at.y)
  }
  if (!Number.isFinite(minX)) return { minX: -100, minY: -75, maxX: 100, maxY: 75 }
  return { minX, minY, maxX, maxY }
}

export const pairOf = pairGeometry
export type { Cycle }
