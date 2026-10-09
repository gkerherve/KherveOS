// The built-in examples of kMech (pure data): linkages, cams and gears. Each one is a complete .kmech document;
// tools/export_kmech_examples.ts writes them to public/examples/kmech/ and the tests open and analyse every one.

import { circleIntersections, deg, rad, type Pt } from './math.ts'
import { fourBarPose, type FourBarLengths } from './fourbar.ts'
import { riseDwellReturn, type CamSpec, DEFAULT_CAM } from './cam.ts'
import { DEFAULT_ENGINE } from './engine.ts'
import { DEFAULT_GEAR } from './gear.ts'
import { defaultGearDoc, type CamDoc, type GearDoc, type KMechDoc, type LinkageDoc } from './doc.ts'
import type { LLink, LPoint, LSlider } from './linkage.ts'
import type { FourBarDesign } from './synthesis.ts'

export interface ExampleDef {
  id: string
  title: string
  group: string
  description: string
  doc: KMechDoc
}

const r4 = (v: number) => Math.round(v * 1e12) / 1e12
const P = (id: string, x: number, y: number, o: Partial<LPoint> = {}): LPoint => ({ id, x: r4(x), y: r4(y), ...o })
const G = (id: string, x: number, y: number, o: Partial<LPoint> = {}): LPoint => P(id, x, y, { ground: true, ...o })

// ------------------------------------------------------------------------------ four-bars

export interface FourBarOpts {
  /** the output pin B above (true) or below the line A–O4 */
  up?: boolean
  /** coupler point P as (a, b): a along A→B, b perpendicular, in units of |AB| */
  coupler?: [number, number]
  rpm?: number
  notes?: string
  extraTrace?: boolean
}

export function fourBarDoc(name: string, g: FourBarLengths, thDeg: number, o: FourBarOpts = {}): LinkageDoc {
  const th = rad(thDeg)
  const pose = fourBarPose(g, th, 0)!
  let { A, B } = pose
  const alt = fourBarPose(g, th, 1)
  if (alt && (o.up ?? true) !== (B.y >= alt.B.y)) { A = alt.A; B = alt.B }
  const points: LPoint[] = [G('O2', 0, 0, { label: 'O2' }), G('O4', g.d, 0, { label: 'O4' }), P('A', A.x, A.y, { label: 'A' }), P('B', B.x, B.y, { label: 'B' })]
  const links: LLink[] = [{ id: 'crank', pts: ['O2', 'A'], label: 'crank' }]
  if (o.coupler) {
    const ux = B.x - A.x; const uy = B.y - A.y
    points.push(P('P', A.x + o.coupler[0] * ux - o.coupler[1] * uy, A.y + o.coupler[0] * uy + o.coupler[1] * ux, { label: 'P', tracer: true }))
    links.push({ id: 'coupler', pts: ['A', 'B', 'P'], label: 'coupler', shape: 'plate' })
  } else {
    points[3].tracer = true
    links.push({ id: 'coupler', pts: ['A', 'B'], label: 'coupler' })
  }
  links.push({ id: 'rocker', pts: ['O4', 'B'], label: 'output' })
  return { name, points, links, sliders: [], driver: { from: 'O2', to: 'A', rpm: o.rpm ?? 30 }, notes: o.notes }
}

/** The four-bar a synthesis made, as a drawing in its first coupler position (the coupler plate carries the reference point). */
export function fourBarFromDesign(d: FourBarDesign, name: string, ref?: Pt): LinkageDoc {
  const points: LPoint[] = [G('O2', d.O2.x, d.O2.y, { label: 'O2' }), G('O4', d.O4.x, d.O4.y, { label: 'O4' }), P('A', d.A.x, d.A.y, { label: 'A' }), P('B', d.B.x, d.B.y, { label: 'B' })]
  const links: LLink[] = [{ id: 'crank', pts: ['O2', 'A'], label: 'crank' }, { id: 'coupler', pts: ['A', 'B'], label: 'coupler' }, { id: 'rocker', pts: ['O4', 'B'], label: 'output' }]
  if (ref) {
    points.push(P('P', ref.x, ref.y, { label: 'P', tracer: true }))
    links[1] = { id: 'coupler', pts: ['A', 'B', 'P'], label: 'coupler', shape: 'plate' }
  } else points[3].tracer = true
  return { name, points, links, sliders: [], driver: { from: 'O2', to: 'A', rpm: 20 } }
}

// ------------------------------------------------------------------------------ slider-crank

export function sliderCrankDoc(name: string, r: number, l: number, thDeg: number, rpm: number): LinkageDoc {
  const th = rad(thDeg)
  const A = { x: r * Math.cos(th), y: r * Math.sin(th) }
  const B = { x: A.x + Math.sqrt(l * l - A.y * A.y), y: 0 }
  return {
    name,
    points: [G('O', 0, 0, { label: 'O' }), P('A', A.x, A.y, { label: 'crank pin' }), P('B', B.x, B.y, { label: 'piston pin', tracer: true })],
    links: [{ id: 'crank', pts: ['O', 'A'], label: 'crank' }, { id: 'rod', pts: ['A', 'B'], label: 'rod' }],
    sliders: [{ id: 'piston', point: 'B', line: { kind: 'ground', x: 0, y: 0, angle: 0 }, label: 'piston', mass: 0.45 }],
    driver: { from: 'O', to: 'A', rpm },
  }
}

// ------------------------------------------------------------------------------ the others

function whitworth(): LinkageDoc {
  const d = 40; const R = 70; const rho = 120; const Ls = 220; const ell = 260
  const O1 = { x: 0, y: 0 }; const O2 = { x: 0, y: -d }
  const th = rad(125)
  const Pp = { x: O2.x + R * Math.cos(th), y: O2.y + R * Math.sin(th) }
  const len = Math.hypot(Pp.x, Pp.y)
  const u = { x: Pp.x / len, y: Pp.y / len }
  const Rm = { x: rho * u.x, y: rho * u.y }
  const L = { x: Ls * u.x, y: Ls * u.y }
  const S = { x: Rm.x + Math.sqrt(ell * ell - Rm.y * Rm.y), y: 0 }
  return {
    name: 'Whitworth quick-return',
    points: [
      G('O1', O1.x, O1.y, { label: 'lever pivot' }), G('O2', O2.x, O2.y, { label: 'crank pivot' }), P('P', Pp.x, Pp.y, { label: 'block' }), P('L', L.x, L.y, { label: 'lever end' }),
      P('Rm', Rm.x, Rm.y, { label: 'ram pin' }), P('S', S.x, S.y, { label: 'ram', tracer: true }),
    ],
    links: [
      { id: 'crank', pts: ['O2', 'P'], label: 'crank' },
      { id: 'lever', pts: ['O1', 'Rm', 'L'], label: 'slotted lever' },
      { id: 'ram', pts: ['Rm', 'S'], label: 'ram link' },
    ],
    sliders: [
      { id: 'block', point: 'P', line: { kind: 'link', a: 'O1', b: 'L' }, label: 'block in slot', mass: 0.15 },
      { id: 'ramslide', point: 'S', line: { kind: 'ground', x: 0, y: 0, angle: 0 }, label: 'ram', mass: 1 },
    ],
    driver: { from: 'O2', to: 'P', rpm: 30 },
    notes: `Crank R = ${R} mm turns about a point d = ${d} mm from the lever pivot (d < R, so the slotted lever turns all the way round). The ram goes forward slowly and back quickly: Q = (π + 2 asin(d/R)) / (π − 2 asin(d/R)) = 2.26.`,
  }
}

function scotchYoke(): LinkageDoc {
  const r = 40
  const th = rad(35)
  const Pp = { x: r * Math.cos(th), y: r * Math.sin(th) }
  const Y = { x: Pp.x, y: 0 }
  const Q = { x: Y.x + 40, y: 60 }
  const S = { x: Y.x, y: 80 }
  return {
    name: 'Scotch yoke',
    points: [G('O', 0, 0, { label: 'O' }), P('P', Pp.x, Pp.y, { label: 'pin' }), P('Y', Y.x, Y.y, { label: 'yoke', tracer: true }), P('Q', Q.x, Q.y, { label: 'guide' }), P('S', S.x, S.y, { label: 'slot end' })],
    links: [{ id: 'crank', pts: ['O', 'P'], label: 'crank' }, { id: 'yoke', pts: ['Y', 'Q', 'S'], label: 'yoke', shape: 'plate' }],
    sliders: [
      { id: 'yokeslide', point: 'Y', line: { kind: 'ground', x: 0, y: 0, angle: 0 }, label: 'yoke', mass: 0.5 },
      { id: 'guide', point: 'Q', line: { kind: 'ground', x: 0, y: 60, angle: 0 }, label: 'guide', mass: 0.05 },
      { id: 'slot', point: 'P', line: { kind: 'link', a: 'Y', b: 'S' }, label: 'pin in slot', mass: 0.05 },
    ],
    driver: { from: 'O', to: 'P', rpm: 60 },
    notes: 'The yoke moves in pure simple harmonic motion: x = r cos θ, with no obliquity of the rod.',
  }
}

function peaucellier(): LinkageDoc {
  const L = 100; const s = 40; const d = 50
  const O = { x: 0, y: 0 }; const Q = { x: d, y: 0 }
  const phi = rad(35)
  const R = { x: Q.x + d * Math.cos(phi), y: Q.y + d * Math.sin(phi) }
  const hits = circleIntersections(O, L, R, s)
  const A = hits[0]; const C = hits[1]
  // P is R reflected across the line AC
  const dx = C.x - A.x; const dy = C.y - A.y
  const t = ((R.x - A.x) * dx + (R.y - A.y) * dy) / (dx * dx + dy * dy)
  const F = { x: A.x + t * dx, y: A.y + t * dy }
  const Pp = { x: 2 * F.x - R.x, y: 2 * F.y - R.y }
  return {
    name: 'Peaucellier-Lipkin inversor',
    points: [G('O', 0, 0, { label: 'O' }), G('Q', Q.x, Q.y, { label: 'Q' }), P('A', A.x, A.y, { label: 'A' }), P('C', C.x, C.y, { label: 'C' }), P('R', R.x, R.y, { label: 'R' }), P('P', Pp.x, Pp.y, { label: 'P', tracer: true })],
    links: [
      { id: 'OA', pts: ['O', 'A'] }, { id: 'OC', pts: ['O', 'C'] }, { id: 'AR', pts: ['A', 'R'] }, { id: 'RC', pts: ['R', 'C'] }, { id: 'CP', pts: ['C', 'P'] }, { id: 'PA', pts: ['P', 'A'] },
      { id: 'crank', pts: ['Q', 'R'], label: 'crank' },
    ],
    sliders: [],
    driver: { from: 'Q', to: 'R', rpm: 20 },
    output: { kind: 'point', point: 'P', axis: 'x' },
    notes: `R is held on a circle through O by the crank QR (QR = QO = ${d}), so P, the inverse of R about O, moves on the exact straight line x = (L² − s²)/(2·QO) = ${(L * L - s * s) / (2 * d)} mm. The crank rocks (it cannot turn fully).`,
  }
}

function watt(): LinkageDoc {
  // the "Z": equal horizontal arms, a short vertical coupler; the ground pivots are offset by the coupler's length
  const L = 80; const b = 30
  return {
    name: "Watt's linkage",
    points: [G('O1', -L, b / 2, { label: 'O1' }), G('O2', L, -b / 2, { label: 'O2' }), P('A', 0, b / 2, { label: 'A' }), P('B', 0, -b / 2, { label: 'B' }), P('M', 0, 0, { label: 'M', tracer: true })],
    links: [{ id: 'left', pts: ['O1', 'A'], label: 'arm' }, { id: 'coupler', pts: ['A', 'B', 'M'], label: 'coupler' }, { id: 'right', pts: ['O2', 'B'], label: 'arm' }],
    sliders: [],
    driver: { from: 'O1', to: 'A', rpm: 20 },
    output: { kind: 'point', point: 'M', axis: 'x' },
    notes: 'Two equal arms joined by a short coupler: with the arms level, the coupler midpoint M follows a figure-eight whose crossing is very nearly a straight vertical line (an approximate straight-line mechanism: the sideways error grows with the fourth power of the swing).',
  }
}

function pantograph(): LinkageDoc {
  const a = 60; const b = 50
  const B = { x: a * Math.cos(rad(10)), y: a * Math.sin(rad(10)) }
  const D = { x: b * Math.cos(rad(100)), y: b * Math.sin(rad(100)) }
  const C = { x: B.x + D.x, y: B.y + D.y }
  const E = { x: 2 * B.x, y: 2 * B.y }
  const F = { x: 2 * D.x, y: 2 * D.y }
  const T = { x: 2 * C.x, y: 2 * C.y }
  const Gp = { x: C.x + 12, y: C.y - 16 }
  return {
    name: 'Pantograph',
    points: [
      G('O', 0, 0, { label: 'O' }), G('G', Gp.x, Gp.y, { label: 'crank pivot' }), P('B', B.x, B.y, { label: 'B' }), P('D', D.x, D.y, { label: 'D' }), P('C', C.x, C.y, { label: 'C (input)', tracer: true }),
      P('E', E.x, E.y, { label: 'E' }), P('F', F.x, F.y, { label: 'F' }), P('T', T.x, T.y, { label: 'T (output)', tracer: true }),
    ],
    links: [
      { id: 'bar1', pts: ['O', 'D', 'F'], label: 'bar 1' }, { id: 'bar2', pts: ['O', 'B', 'E'], label: 'bar 2' },
      { id: 'BC', pts: ['B', 'C'] }, { id: 'DC', pts: ['D', 'C'] }, { id: 'ET', pts: ['E', 'T'] }, { id: 'FT', pts: ['F', 'T'] },
      { id: 'crank', pts: ['G', 'C'], label: 'crank' },
    ],
    sliders: [],
    driver: { from: 'G', to: 'C', rpm: 20 },
    output: { kind: 'point', point: 'T', axis: 'x' },
    notes: 'A parallelogram O-B-C-D scaled by 2 about O: the tracer T always lies on the line OC at twice the distance, so it draws a circle twice the size of the circle the crank makes C draw.',
  }
}

function wiper(): LinkageDoc {
  const g: FourBarLengths = { a: 25, b: 110, c: 60, d: 100 }
  const base = fourBarDoc('Windscreen wiper', g, 60, { up: true })
  const O4 = base.points.find((p) => p.id === 'O4')!
  const B = base.points.find((p) => p.id === 'B')!
  const ux = O4.x - B.x; const uy = O4.y - B.y
  const W = { x: O4.x + 2.6 * ux, y: O4.y + 2.6 * uy }
  const nx = -uy / Math.hypot(ux, uy); const ny = ux / Math.hypot(ux, uy)
  const W2 = { x: W.x + 110 * nx, y: W.y + 110 * ny }
  base.points.push(P('W', W.x, W.y, { label: 'arm tip' }), P('W2', W2.x, W2.y, { label: 'blade tip', tracer: true }))
  const coupler = base.links.find((l) => l.id === 'coupler')!
  coupler.shape = 'bar'
  const rocker = base.links.find((l) => l.id === 'rocker')!
  rocker.pts = ['B', 'O4', 'W', 'W2']
  rocker.label = 'wiper arm'
  base.notes = 'A crank-rocker: the motor turns the crank all the way round and the wiper arm (the rocker, extended beyond its pivot) sweeps to and fro. The blade tip draws the wiped area.'
  return base
}

/** The Jansen leg: the lengths of the "holy numbers" with the topology found in Jansen's walking linkage. */
export function jansen(): LinkageDoc {
  const Lg = { b: 41.5, c: 39.3, d: 40.1, e: 55.8, f: 39.4, g: 36.7, h: 65.7, i: 49.0, j: 50.0, k: 61.9 }
  const O = { x: 0, y: 0 }
  const Pc = { x: 38, y: 7.8 }
  const m = 15
  const th = 0
  const K = { x: Pc.x + m * Math.cos(th), y: Pc.y + m * Math.sin(th) }
  const pick = (c0: Pt, r0: number, c1: Pt, r1: number, first: boolean): Pt => {
    const h = circleIntersections(c0, r0, c1, r1)
    return first ? h[0] : h[1]
  }
  const C = pick(O, Lg.b, K, Lg.j, true)
  const E = pick(O, Lg.c, K, Lg.k, false)
  const Dn = pick(O, Lg.d, C, Lg.e, true)
  const F = pick(C, Lg.h, E, Lg.i, false)
  const Foot = pick(Dn, Lg.f, F, Lg.g, true)
  return {
    name: "Theo Jansen's walking linkage",
    points: [
      G('O', O.x, O.y, { label: 'frame' }), G('Pc', Pc.x, Pc.y, { label: 'crank axis' }), P('K', K.x, K.y, { label: 'crank pin' }), P('C', C.x, C.y, { label: 'C' }), P('E', E.x, E.y, { label: 'E' }),
      P('D', Dn.x, Dn.y, { label: 'knee' }), P('F', F.x, F.y, { label: 'F' }), P('X', Foot.x, Foot.y, { label: 'foot', tracer: true }),
    ],
    links: [
      { id: 'crank', pts: ['Pc', 'K'], label: 'crank m' },
      { id: 'j', pts: ['K', 'C'] }, { id: 'k', pts: ['K', 'E'] },
      { id: 'bde', pts: ['O', 'C', 'D'], label: 'b-d-e', shape: 'plate' }, { id: 'c', pts: ['O', 'E'] },
      { id: 'h', pts: ['C', 'F'] }, { id: 'i', pts: ['E', 'F'] },
      { id: 'f', pts: ['D', 'X'] }, { id: 'g', pts: ['F', 'X'] },
    ],
    sliders: [],
    driver: { from: 'Pc', to: 'K', rpm: 20 },
    output: { kind: 'point', point: 'X', axis: 'y' },
    notes: 'Jansen’s eleven-bar leg with his “holy numbers” (a 38.0, b 41.5, c 39.3, d 40.1, e 55.8, f 39.4, g 36.7, h 65.7, i 49.0, j 50.0, k 61.9, l 7.8, m 15.0). The foot X goes round a path with a nearly flat stride on the ground.',
  }
}

export function geneva(n = 4): LinkageDoc {
  const a = 100
  const r = a * Math.sin(Math.PI / n)
  const rw = 96
  const O1 = { x: 0, y: 0 }; const O2 = { x: a, y: 0 }
  const slots: Pt[] = Array.from({ length: n }, (_, k) => ({ x: O2.x + rw * Math.cos(Math.PI + (2 * Math.PI * k) / n), y: O2.y + rw * Math.sin(Math.PI + (2 * Math.PI * k) / n) }))
  const half = deg(Math.PI / 2 - Math.PI / n)
  return {
    name: `Geneva drive (${n} slots)`,
    points: [
      G('O1', O1.x, O1.y, { label: 'driver' }), G('O2', O2.x, O2.y, { label: 'wheel' }), P('P', r, 0, { label: 'pin', tracer: true }),
      ...slots.map((s, k) => P(`S${k}`, s.x, s.y, { label: `slot ${k + 1}` })),
    ],
    links: [
      { id: 'crank', pts: ['O1', 'P'], label: 'driver crank' },
      { id: 'wheel', pts: ['O2', ...slots.map((_, k) => `S${k}`)], label: 'Geneva wheel', shape: 'star' },
    ],
    sliders: [{ id: 'pinslot', point: 'P', line: { kind: 'link', a: 'O2', b: 'S0' }, label: 'pin in slot', mass: 0.05 }],
    driver: { from: 'O1', to: 'P', rpm: 30 },
    limits: { min: -half, max: half },
    dwell: true,
    notes: `Engaged only while the driver turns through ±${half}° (π/2 − π/${n}); the analysis covers that window and the wheel then rests while the driver completes the turn. Wheel angle: tan φ = sin(π/${n})·sin θ / (1 − sin(π/${n})·cos θ); the wheel advances ${360 / n}° per turn.`,
  }
}

// ------------------------------------------------------------------------------ cams

function camDoc(name: string, o: Partial<CamSpec>, extra: Partial<CamDoc> = {}): CamDoc {
  return { name, ...DEFAULT_CAM, ...o, ...extra }
}

// ------------------------------------------------------------------------------ gears

function gearDoc(name: string, view: GearDoc['view'], f: (d: GearDoc) => void, notes?: string): GearDoc {
  const d = defaultGearDoc(name)
  d.view = view
  f(d)
  if (notes) d.notes = notes
  return d
}

// ------------------------------------------------------------------------------ the list

export const EXAMPLES: ExampleDef[] = [
  {
    id: 'crank-rocker', title: 'Crank-rocker four-bar', group: 'Four-bar linkages',
    description: 'A Grashof crank-rocker with a coupler point: the crank turns fully, the rocker swings. Coupler curve, transmission angle, Grashof label.',
    doc: { workbench: 'linkage', model: fourBarDoc('Crank-rocker four-bar', { a: 40, b: 100, c: 70, d: 90 }, 60, { coupler: [0.5, 0.6], notes: 'Shortest link (the crank) + longest link < sum of the other two: Grashof. The crank turns fully; the rocker swings between its two toggle positions.' }) },
  },
  {
    id: 'double-rocker', title: 'Double-rocker four-bar', group: 'Four-bar linkages',
    description: 'A non-Grashof four-bar: no link can turn fully, the input rocks between two lock-up angles.',
    doc: { workbench: 'linkage', model: fourBarDoc('Double-rocker four-bar', { a: 65, b: 90, c: 70, d: 100 }, 70, { coupler: [0.5, 0.5], notes: 'Shortest + longest > the other two: no link turns fully. The input stops at two lock-up angles (documented limits of the range).' }) },
  },
  {
    id: 'drag-link', title: 'Drag-link (double-crank)', group: 'Four-bar linkages',
    description: 'The shortest link is the frame: both cranks turn fully, the output speed varies during the turn.',
    doc: { workbench: 'linkage', model: fourBarDoc('Drag-link (double-crank)', { a: 80, b: 70, c: 75, d: 40 }, 50, { coupler: [0.5, 0.5], notes: 'Frame = shortest link: input and output both rotate all the way round (a drag link).' }) },
  },
  {
    id: 'parallelogram', title: 'Change-point parallelogram linkage', group: 'Four-bar linkages',
    description: 'Equal opposite links: s + l = p + q. The coupler stays parallel to the frame (translates on circles).',
    doc: { workbench: 'linkage', model: fourBarDoc('Parallelogram linkage (change-point)', { a: 50, b: 100, c: 50, d: 100 }, 64.5, { coupler: [0.5, 0.8], notes: 'A change-point four-bar (s + l = p + q): the coupler keeps its orientation and every coupler point draws the same circle as the crank pin. At the folded position the linkage could branch into an anti-parallelogram; kMech follows the parallelogram branch.' }) },
  },
  {
    id: 'slider-crank-engine', title: 'Slider-crank engine', group: 'Slider mechanisms',
    description: 'A single-cylinder engine: piston kinematics, a gas-pressure curve, indicated torque and flywheel energy fluctuation.',
    doc: { workbench: 'linkage', model: { ...sliderCrankDoc('Slider-crank engine', 40, 135, 40, 3000), engine: { ...DEFAULT_ENGINE, bore: 80, stroke: 80, rod: 135, rpm: 3000, cylinders: 1 }, notes: 'Bore 80 mm, stroke 80 mm, rod 135 mm, compression ratio 9.5:1. The pressure curve is computed from an adiabatic compression and expansion with a Wiebe burn.' } },
  },
  {
    id: 'whitworth', title: 'Whitworth quick-return mechanism', group: 'Slider mechanisms',
    description: 'A crank drives a slotted lever that turns fully; the ram strokes slowly forward and returns quickly (ratio 2.26).',
    doc: { workbench: 'linkage', model: whitworth() },
  },
  {
    id: 'scotch-yoke', title: 'Scotch yoke', group: 'Slider mechanisms',
    description: 'A pin in a slot drives a yoke in exact simple harmonic motion.',
    doc: { workbench: 'linkage', model: scotchYoke() },
  },
  {
    id: 'peaucellier', title: 'Peaucellier-Lipkin inversor', group: 'Straight lines and copying',
    description: 'Seven bars turn a circle into an exact straight line (inversion about O).',
    doc: { workbench: 'linkage', model: peaucellier() },
  },
  {
    id: 'watt', title: "Watt's linkage", group: 'Straight lines and copying',
    description: 'Two rockers and a coupler: the coupler midpoint follows an approximate straight line.',
    doc: { workbench: 'linkage', model: watt() },
  },
  {
    id: 'pantograph', title: 'Pantograph', group: 'Straight lines and copying',
    description: 'A parallelogram scaled about a fixed pivot: the tracer draws a copy twice the size.',
    doc: { workbench: 'linkage', model: pantograph() },
  },
  {
    id: 'wiper', title: 'Windscreen-wiper linkage', group: 'Real mechanisms',
    description: 'A crank-rocker whose rocker is extended into a wiper arm with a blade.',
    doc: { workbench: 'linkage', model: wiper() },
  },
  {
    id: 'jansen', title: "Theo Jansen's walking linkage", group: 'Real mechanisms',
    description: 'One leg of the Strandbeest: eleven bars turn a crank into a walking foot path.',
    doc: { workbench: 'linkage', model: jansen() },
  },
  {
    id: 'geneva', title: 'Geneva drive', group: 'Real mechanisms',
    description: 'A four-slot Geneva wheel indexing 90° per turn of the driver; analysed through the engaged window.',
    doc: { workbench: 'linkage', model: geneva(4) },
  },
  {
    id: 'cam-345', title: 'Cam: 3-4-5 polynomial rise-dwell-return', group: 'Cams',
    description: 'A translating roller follower rising 25 mm in 120°, dwelling 60°, returning in 120° with 3-4-5 polynomials.',
    doc: { workbench: 'cam', model: camDoc('Cam: 3-4-5 polynomial rise-dwell-return', { program: riseDwellReturn(25, 120, 60, 120, 'poly345'), baseRadius: 35, rollerRadius: 8 }, { notes: 'Zero velocity and acceleration at the start and end of every segment.' }) },
  },
  {
    id: 'cam-compare', title: 'Cam: cycloidal vs harmonic, roller follower', group: 'Cams',
    description: 'The same rise-dwell-return with a cycloidal law (smooth) compared with simple harmonic motion (acceleration jump).',
    doc: { workbench: 'cam', model: camDoc('Cam: cycloidal vs harmonic', { program: riseDwellReturn(20, 100, 60, 140, 'cycloidal'), baseRadius: 40, rollerRadius: 10 }, { compare: { label: 'Simple harmonic', program: riseDwellReturn(20, 100, 60, 140, 'harmonic') }, notes: 'The harmonic law jumps in acceleration at the ends of the rise and return; the cycloidal law does not, at the cost of a higher peak acceleration.' }) },
  },
  {
    id: 'cam-flat', title: 'Cam: flat-face follower, modified trapezoid', group: 'Cams',
    description: 'A flat-faced translating follower (zero pressure angle) with a modified-trapezoid rise and return.',
    doc: { workbench: 'cam', model: camDoc('Cam: flat-face follower, modified trapezoid', { program: riseDwellReturn(12, 140, 40, 140, 'trapezoid'), follower: 'flat', baseRadius: 30, rollerRadius: 0 }, { notes: 'The face half-width must cover the largest |ds/dθ|.' }) },
  },
  {
    id: 'cam-swing', title: 'Cam: swing-arm roller follower', group: 'Cams',
    description: 'An oscillating roller follower (arm 70 mm) swinging 25° with harmonic motion.',
    doc: { workbench: 'cam', model: camDoc('Cam: swing-arm roller follower', { program: riseDwellReturn(25, 150, 30, 150, 'harmonic'), motion: 'swing', baseRadius: 35, rollerRadius: 8, pivotDistance: 90, armLength: 70, maxPressure: 45 }, { notes: 'The program’s lift is in degrees of arm rotation. Pressure angle limit 45° for swing arms.' }) },
  },
  {
    id: 'gear-pair', title: 'Spur gear pair 20/40, 20°', group: 'Gears',
    description: 'The standard module-2 pair: d 40/80, contact ratio 1.6, centre distance 60 mm.',
    doc: { workbench: 'gear', model: gearDoc('Spur gear pair 20/40', 'pair', (d) => { d.pair.g1 = { ...DEFAULT_GEAR, z: 20 }; d.pair.g2 = { ...DEFAULT_GEAR, z: 40 } }, 'm = 2 mm, α = 20°, full-depth teeth. Watch the contact ratio stay above 1.2.') },
  },
  {
    id: 'gear-shifted', title: 'Profile-shifted pinion (12/40)', group: 'Gears',
    description: 'A 12-tooth pinion would be undercut; a profile shift of +0.4 on the pinion and −0.4 on the gear fixes it at the standard centre distance.',
    doc: { workbench: 'gear', model: gearDoc('Profile-shifted pinion 12/40', 'pair', (d) => { d.pair.g1 = { ...DEFAULT_GEAR, z: 12, x: 0.4 }; d.pair.g2 = { ...DEFAULT_GEAR, z: 40, x: -0.4 } }, 'Set the shift of the pinion to 0 to see the undercut warning.') },
  },
  {
    id: 'gear-compound', title: 'Compound gear train 9:1', group: 'Gears',
    description: 'Two stages (18→54 and 20→60) on a common intermediate shaft: speed and torque of every shaft.',
    doc: { workbench: 'gear', model: gearDoc('Compound gear train', 'train', (d) => { d.train = { stages: [{ driver: 18, driven: 54 }, { driver: 20, driven: 60 }], rpm: 1800, torque: 5, eff: 0.98 } }, 'Ratio = (18/54)·(20/60) = 1/9.') },
  },
  {
    id: 'gear-idler', title: 'Gear train with an idler', group: 'Gears',
    description: 'An idler reverses the sense of rotation without changing the ratio.',
    doc: { workbench: 'gear', model: gearDoc('Gear train with an idler', 'train', (d) => { d.train = { stages: [{ driver: 20, driven: 30, shared: true }, { driver: 30, driven: 60 }], rpm: 1200, torque: 8, eff: 0.98 } }, 'Only the 20-tooth driver and the 60-tooth gear set the ratio (1/3). The 30-tooth idler turns the output the same way as the input.') },
  },
  {
    id: 'planetary', title: 'Planetary gearset: ratios with each member fixed', group: 'Gears',
    description: 'Sun 24, ring 72, three 24-tooth planets: the Willis equation for every fixed member.',
    doc: { workbench: 'gear', model: gearDoc('Planetary gearset', 'planetary', (d) => { d.planetary = { Zs: 24, Zr: 72, n: 3, module: 1.5, fixed: 'ring', input: 'sun', speed: 1000 } }, 'Ring fixed, sun in, carrier out: 1 + Zr/Zs = 4:1.') },
  },
  {
    id: 'gear-helical', title: 'Helical gear pair', group: 'Gears',
    description: 'Module 2, 15° helix: transverse module, contact ratios and virtual teeth.',
    doc: { workbench: 'gear', model: gearDoc('Helical gear pair', 'helical', (d) => { d.helical = { mn: 2, z1: 24, z2: 48, beta: 15, alphaN: 20, width: 30 } }) },
  },
  {
    id: 'belt-chain', title: 'Belt and chain drives', group: 'Gears',
    description: 'An open belt between 200 and 80 mm pulleys and a roller chain between 17 and 41 sprockets.',
    doc: { workbench: 'gear', model: gearDoc('Belt and chain drives', 'belt', () => undefined) },
  },
]

export const exampleById = (id: string): ExampleDef | undefined => EXAMPLES.find((e) => e.id === id)

// re-exported for the tests
export { whitworth, scotchYoke, peaucellier, watt, pantograph, wiper }
export type { LSlider }
