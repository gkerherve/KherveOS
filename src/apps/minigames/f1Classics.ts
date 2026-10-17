// Kherve Grand Prix: the classic coupés of the Classics series, built from
// code to the proportions of the real cars of the early 1970s: a body
// generated from its side profile, plan and cross-sections (sides that tuck
// in towards the top, wings that stand above a low bonnet, real wheel arches
// cut round the tyres), a glasshouse with A, B and C pillars, a painted roof
// and framed windows, round lamps, bumpers, period wheels, a livery and racing
// roundels. Three fictional makes, no makers' names or badges: the Stoccarda
// 901 RS (shaped after the rear-engined fastback of 1973, ducktail and all),
// the Dieppe A110 (after the tiny French berlinette) and the Bavaria 30 CS
// (after the big touring coupé with the shark nose, box flares and wing).

import * as THREE from 'three'
import { bendWheels, merge, showDamage, type CarModel, type Shared } from './f1Models.ts'
import type { ClassicModel, Team } from './f1Race.ts'
import type { Compound, Damage } from './f1Physics.ts'

type Zone = 'body' | 'fw' | 'rw'
type Part =
  | 'paint' | 'plain' | 'decal' | 'stripe' | 'glass' | 'chrome' | 'black' | 'lamp' | 'amber' | 'tail' | 'helmet' | 'interior'
  /** What the cockpit camera hides (its own wheel, dials and hands are drawn instead). */
  | 'cockpit' | 'shoulders'
type Add = (k: Part, g: THREE.BufferGeometry) => void
type KF = [number, number][]

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  return new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z)
}

/** A thin rod between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a)
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()))
  const m = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  return g.translate(m.x, m.y, m.z)
}

/** A smooth curve through keyframes [x, value] (x from the nose back, either order). */
function curve(points: KF): (x: number) => number {
  const P = [...points].sort((a, b) => a[0] - b[0])
  return (x: number) => {
    if (x <= P[0][0]) return P[0][1]
    if (x >= P[P.length - 1][0]) return P[P.length - 1][1]
    let i = 0
    while (i < P.length - 2 && x > P[i + 1][0]) i++
    const p0 = P[Math.max(0, i - 1)]
    const p1 = P[i]
    const p2 = P[i + 1]
    const p3 = P[Math.min(P.length - 1, i + 2)]
    const t = (x - p1[0]) / (p2[0] - p1[0])
    // Catmull-Rom on the values, with tangents scaled to uneven spacing
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0])
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0])
    const t2 = t * t
    const t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2
  }
}

// ---------------------------------------------------------------- the body generator

interface Station {
  x: number
  /** Half-width, bottom, top of the side (the wing or belt line), top at the centre, how much the sides lean in, top curve exponent. */
  hw: number
  yb: number
  ys: number
  yc: number
  tumble: number
  k: number
}

const CORNER = 0.05

/** One half of a cross-section, from the bottom centre round the right side to the top centre: [z, y]. */
function halfSection(s: Station, nSide = 9, nTop = 11): { pts: [number, number][]; shoulder: number } {
  const pts: [number, number][] = []
  const yb = Math.min(s.yb, s.ys - 0.07, s.yc - 0.05)
  pts.push([0, yb], [s.hw * 0.62, yb], [s.hw - CORNER * 0.5, yb + CORNER * 0.35])
  const top = s.ys - 0.035
  for (let i = 0; i <= nSide; i++) {
    const t = i / nSide
    pts.push([s.hw * (1 - s.tumble * t * t), yb + CORNER + t * Math.max(0.01, top - yb - CORNER)])
  }
  const zs = s.hw * (1 - s.tumble) - 0.014
  pts.push([zs, s.ys - 0.006])
  const shoulder = pts.length - 1
  for (let i = 1; i <= nTop; i++) {
    const t = 1 - i / nTop
    pts.push([(zs - 0.02) * t, s.yc + (s.ys - s.yc) * Math.pow(t, s.k)])
  }
  return { pts, shoulder }
}

/** The whole ring: right half, then the left half mirrored, closing at the bottom centre (the uv seam). */
function ring(s: Station): [number, number][] {
  const { pts } = halfSection(s)
  const left = pts.slice(0, -1).reverse().map(([z, y]) => [-z, y] as [number, number])
  return [...pts, ...left]
}

/** The top only (shoulder to shoulder), pushed out a little: a roof panel over the glass. */
function topStrip(s: Station, out = 0.005): [number, number][] {
  const { pts, shoulder } = halfSection(s)
  const right = pts.slice(shoulder)
  // right shoulder to the centre, then on to the left shoulder (the same way round as the ring)
  const all = [...right, ...right.slice(0, -1).reverse().map(([z, y]) => [-z, y] as [number, number])]
  return all.map(([z, y]) => [z * (1 + out), y + out])
}

/** One side only (bottom corner to shoulder), right (+1) or left (-1), pushed out a little: a painted panel on the glass. */
function sideStrip(s: Station, sd: number, out = 0.005): [number, number][] {
  const { pts, shoulder } = halfSection(s)
  const side = pts.slice(2, shoulder + 1).map(([z, y]) => [(z + out) * sd, y] as [number, number])
  return sd > 0 ? side : side.reverse()
}

/** A skin through the stations' point lists (all of the same length); uv: u along, v round. Optionally closed at both ends. */
function skin(stations: { x: number; pts: [number, number][] }[], caps: boolean): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const n = stations[0].pts.length
  const x0 = stations[0].x
  const x1 = stations[stations.length - 1].x
  for (const st of stations) {
    let total = 0
    const acc = [0]
    for (let i = 1; i < n; i++) {
      total += Math.hypot(st.pts[i][0] - st.pts[i - 1][0], st.pts[i][1] - st.pts[i - 1][1])
      acc.push(total)
    }
    for (let i = 0; i < n; i++) {
      pos.push(st.x, st.pts[i][1], st.pts[i][0])
      uv.push((st.x - x0) / (x1 - x0 || 1), total ? acc[i] / total : 0)
    }
  }
  for (let j = 0; j < stations.length - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i
      const b = a + n
      // counter-clockwise seen from outside
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  if (caps) {
    for (const [j, flip] of [[0, false], [stations.length - 1, true]] as [number, boolean][]) {
      const st = stations[j]
      let cy = 0
      for (const p of st.pts) cy += p[1] / n
      const c = pos.length / 3
      pos.push(st.x, cy, 0)
      uv.push(j === 0 ? 0 : 1, 0.5)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i
        if (flip) idx.push(c, a, a + 1)
        else idx.push(c, a + 1, a)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------- the three cars

interface Design {
  nose: number
  tail: number
  /** Axles, tyre radius and widths, wheel centres' half-track. */
  front: number
  rear: number
  r: number
  wF: number
  wR: number
  trackF: number
  trackR: number
  sill: number
  tumble: number
  /** Plan half-width, top of the sides (wings, belt line), top at the centre (bonnet, deck); the bottom lifting at the ends. */
  hw: KF
  ys: KF
  yc: KF
  lift: KF
  archF: number
  archR: number
  /** The glasshouse: from the windscreen's foot (x0) to where the rear glass meets the deck (x3). */
  cabin: { x0: number; x3: number; roof: KF; hw: KF; hwRoof: number; roofFrom: number; roofTo: number; b?: number; c: number }
  eye: [number, number, number]
  roofCam: [number, number, number]
  /** Doors (front and rear edges), exhaust pipes (z). */
  door: [number, number]
  pipes: number[]
  extras(add: Add, zone: (z: Zone) => void, at: Surface): void
}

interface Surface {
  hw(x: number): number
  ys(x: number): number
  yc(x: number): number
  yb(x: number): number
  /** The body side's z at height y (the tumblehome). */
  side(x: number, y: number): number
  /** Where the glasshouse meets the body, its roof line, its half-width at the belt. */
  belt(x: number): number
  roof(x: number): number
  cabinHw(x: number): number
}

/** The body's shapes and the functions to place things on it. */
function surface(D: Design): Surface {
  const hw = curve(D.hw)
  const ys = curve(D.ys)
  const yc = curve(D.yc)
  const lift = curve(D.lift)
  const roof = curve(D.cabin.roof)
  const cabHw = curve(D.cabin.hw)
  const arch = (x: number) => {
    let y = 0
    for (const [xw, A] of [[D.front, D.archF], [D.rear, D.archR]]) {
      const dx = x - xw
      if (Math.abs(dx) < A) y = Math.max(y, D.r + Math.sqrt(A * A - dx * dx))
    }
    return y
  }
  const yb = (x: number) => Math.min(Math.max(D.sill, lift(x), arch(x)), ys(x) - 0.08, yc(x) - 0.06)
  return {
    hw, ys, yc, yb,
    side(x, y) {
      const b = yb(x) + CORNER
      const t = Math.max(0, Math.min(1, (y - b) / Math.max(0.01, ys(x) - 0.035 - b)))
      return hw(x) * (1 - D.tumble * t * t)
    },
    belt: (x) => Math.min(ys(x), yc(x)) - 0.03,
    roof,
    cabinHw: cabHw,
  }
}

const DESIGNS: Record<ClassicModel, Design> = {
  // after the 1973 rear-engined fastback: 4.15 m long, 2.27 m wheelbase, 1.32 m tall,
  // the bonnet low between upright wings and headlamps, wide rear hips, a ducktail
  stoccarda: {
    nose: 1.97, tail: -2.18, front: 1.135, rear: -1.135, r: 0.315, wF: 0.19, wR: 0.225, trackF: 0.685, trackR: 0.7, sill: 0.2, tumble: 0.12,
    hw: [[1.97, 0.5], [1.9, 0.66], [1.75, 0.76], [1.5, 0.8], [1.15, 0.81], [0.7, 0.795], [0, 0.785], [-0.7, 0.79], [-1.0, 0.815], [-1.25, 0.83], [-1.6, 0.815], [-1.95, 0.74], [-2.12, 0.62], [-2.18, 0.5]],
    ys: [[1.97, 0.44], [1.9, 0.56], [1.75, 0.7], [1.58, 0.79], [1.3, 0.785], [1.0, 0.775], [0.7, 0.775], [0, 0.8], [-0.7, 0.81], [-1.1, 0.84], [-1.35, 0.845], [-1.75, 0.8], [-2.0, 0.73], [-2.18, 0.62]],
    yc: [[1.97, 0.44], [1.9, 0.5], [1.7, 0.58], [1.4, 0.65], [1.0, 0.72], [0.7, 0.78], [0, 0.8], [-0.7, 0.81], [-1.1, 0.83], [-1.5, 0.82], [-1.85, 0.79], [-2.06, 0.77], [-2.18, 0.7]],
    lift: [[1.97, 0.34], [1.85, 0.22], [1.7, 0.2], [-1.98, 0.2], [-2.1, 0.27], [-2.18, 0.36]],
    archF: 0.37, archR: 0.38,
    cabin: {
      x0: 0.7, x3: -1.95, roofFrom: 0.12, roofTo: -0.62, b: -0.62, c: -1.15, hwRoof: 0.555,
      roof: [[0.7, 0.8], [0.45, 1.06], [0.15, 1.27], [-0.2, 1.315], [-0.6, 1.3], [-1.0, 1.21], [-1.4, 1.06], [-1.75, 0.9], [-1.95, 0.81]],
      hw: [[0.7, 0.7], [0, 0.72], [-1.0, 0.72], [-1.95, 0.62]],
    },
    eye: [-0.25, 1.06, -0.32], roofCam: [-0.3, 1.43, 0], door: [0.62, -0.62], pipes: [-0.32],
    extras(add, zone, at) {
      for (const sd of [1, -1]) {
        // upright headlamps at the front of the wings, chrome rims, the indicators below
        const hx = 1.79
        add('lamp', new THREE.CircleGeometry(0.088, 22).rotateY(Math.PI / 2).rotateZ(0.42).translate(hx + 0.012, 0.665, 0.6 * sd))
        add('chrome', new THREE.TorusGeometry(0.09, 0.013, 6, 22).rotateY(Math.PI / 2).rotateZ(0.42).translate(hx + 0.008, 0.665, 0.6 * sd))
        add('amber', box(0.02, 0.04, 0.12, 1.955, 0.36, 0.5 * sd))
        // door mirror, fuel filler on the left wing, the window surround
        add('chrome', rod(v3(0.5, at.belt(0.5), at.side(0.5, at.belt(0.5)) * sd), v3(0.47, at.belt(0.5) + 0.07, (at.side(0.5, at.belt(0.5)) + 0.07) * sd), 0.012))
        add('chrome', new THREE.SphereGeometry(0.055, 12, 8).scale(0.6, 1, 1).translate(0.47, at.belt(0.5) + 0.1, (at.side(0.5, at.belt(0.5)) + 0.09) * sd))
        // the engine lid's louvres and the rear lamps
        add('tail', box(0.02, 0.07, 0.36, -2.165, 0.55, 0.42 * sd))
      }
      add('chrome', new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16).translate(1.3, at.ys(1.3) + 0.004, -0.6))
      for (let k = 0; k < 9; k++) add('black', box(0.16, 0.008, 0.035, -1.82 + k * 0.0, at.yc(-1.82) + 0.006, -0.32 + k * 0.08))
      // bumpers: body colour with a black rubber strip, the red lamp band across the tail
      zone('fw')
      add('plain', box(0.09, 0.1, 1.3, 1.93, 0.31, 0))
      add('black', box(0.02, 0.03, 1.26, 1.978, 0.32, 0))
      zone('rw')
      add('plain', box(0.12, 0.13, 1.4, -2.14, 0.34, 0))
      add('black', box(0.02, 0.03, 1.36, -2.205, 0.36, 0))
      add('tail', box(0.012, 0.04, 0.5, -2.172, 0.55, 0))
      // the ducktail: a lip along the top of the engine lid, black rubber edge
      add('plain', (() => {
        const sh = new THREE.Shape()
        sh.moveTo(-1.86, 0)
        sh.lineTo(-2.17, 0)
        sh.lineTo(-2.2, 0.085)
        sh.lineTo(-2.08, 0.075)
        sh.closePath()
        return new THREE.ExtrudeGeometry(sh, { depth: 1.18, bevelEnabled: false }).translate(0, at.yc(-2.0) - 0.02, -0.59)
      })())
      add('black', box(0.03, 0.012, 1.18, -2.19, at.yc(-2.0) + 0.065, 0))
      zone('body')
    },
  },
  // after the French berlinette: 3.85 m long, 2.10 m wheelbase, only 1.13 m tall, a pointed nose with four lamps
  dieppe: {
    nose: 1.87, tail: -1.98, front: 1.05, rear: -1.05, r: 0.29, wF: 0.17, wR: 0.19, trackF: 0.645, trackR: 0.64, sill: 0.19, tumble: 0.14,
    hw: [[1.87, 0.28], [1.8, 0.48], [1.65, 0.64], [1.4, 0.72], [1.05, 0.755], [0.5, 0.745], [0, 0.74], [-0.7, 0.745], [-1.05, 0.765], [-1.5, 0.74], [-1.85, 0.64], [-1.98, 0.5]],
    ys: [[1.87, 0.34], [1.8, 0.44], [1.65, 0.56], [1.45, 0.63], [1.05, 0.655], [0.5, 0.655], [0, 0.665], [-0.7, 0.68], [-1.05, 0.7], [-1.5, 0.67], [-1.85, 0.62], [-1.98, 0.56]],
    yc: [[1.87, 0.35], [1.75, 0.43], [1.5, 0.51], [1.1, 0.585], [0.55, 0.655], [0, 0.665], [-0.7, 0.68], [-1.3, 0.68], [-1.75, 0.65], [-1.98, 0.6]],
    lift: [[1.87, 0.3], [1.78, 0.22], [1.6, 0.19], [-1.85, 0.2], [-1.98, 0.32]],
    archF: 0.33, archR: 0.335,
    cabin: {
      x0: 0.52, x3: -1.78, roofFrom: 0.02, roofTo: -0.55, b: -0.55, c: -1.0, hwRoof: 0.47,
      roof: [[0.52, 0.66], [0.3, 0.92], [0.05, 1.1], [-0.3, 1.125], [-0.7, 1.09], [-1.1, 0.97], [-1.45, 0.82], [-1.78, 0.68]],
      hw: [[0.52, 0.64], [0, 0.655], [-1.0, 0.65], [-1.78, 0.56]],
    },
    eye: [-0.3, 0.94, -0.3], roofCam: [-0.3, 1.26, 0], door: [0.48, -0.55], pipes: [0.3, 0.38],
    extras(add, zone, at) {
      for (const sd of [1, -1]) {
        // the main lamps faired into the wings, the driving lamps low in the nose
        add('lamp', new THREE.CircleGeometry(0.08, 20).rotateY(Math.PI / 2).rotateZ(0.5).translate(1.665, 0.555, 0.5 * sd))
        add('chrome', new THREE.TorusGeometry(0.082, 0.012, 6, 20).rotateY(Math.PI / 2).rotateZ(0.5).translate(1.66, 0.555, 0.5 * sd))
        add('glass', new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2 + 0.5).scale(0.5, 1, 1).translate(1.67, 0.555, 0.5 * sd))
        add('lamp', new THREE.CircleGeometry(0.062, 18).rotateY(Math.PI / 2).translate(1.83, 0.4, 0.22 * sd))
        add('chrome', new THREE.TorusGeometry(0.064, 0.011, 6, 18).rotateY(Math.PI / 2).translate(1.826, 0.4, 0.22 * sd))
        add('amber', box(0.02, 0.03, 0.08, 1.8, 0.3, 0.42 * sd))
        add('tail', new THREE.CircleGeometry(0.05, 14).rotateY(-Math.PI / 2).translate(-1.965, 0.5, 0.42 * sd))
        add('tail', new THREE.CircleGeometry(0.04, 14).rotateY(-Math.PI / 2).translate(-1.965, 0.5, 0.3 * sd))
        add('chrome', new THREE.SphereGeometry(0.045, 12, 8).scale(0.6, 1, 1).translate(0.38, at.belt(0.38) + 0.08, (at.side(0.38, at.belt(0.38)) + 0.07) * sd))
        // leather bonnet straps
        add('black', box(0.05, 0.006, 0.36, 1.58, at.yc(1.58) + 0.004, 0.2 * sd, 0, 0, -0.32))
      }
      add('chrome', new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16).translate(1.3, at.yc(1.3) + 0.004, 0.18))
      // louvres over the rear window
      for (let k = 0; k < 7; k++) add('black', box(0.025, 0.012, 0.66, -1.12 - k * 0.075, at.roof(-1.12 - k * 0.075) + 0.012, 0))
      zone('fw')
      for (const sd of [1, -1]) add('chrome', box(0.06, 0.05, 0.42, 1.83, 0.27, 0.42 * sd))
      zone('rw')
      add('chrome', box(0.06, 0.05, 1.06, -1.96, 0.3, 0))
      zone('body')
    },
  },
  // after the big lightweight touring coupé: 4.63 m long, 2.63 m wheelbase, a forward-leaning shark nose,
  // a pillarless glasshouse, bolted-on box flares, a front air dam and a tall rear wing
  bavaria: {
    nose: 2.26, tail: -2.38, front: 1.31, rear: -1.31, r: 0.315, wF: 0.2, wR: 0.225, trackF: 0.715, trackR: 0.71, sill: 0.21, tumble: 0.06,
    hw: [[2.26, 0.74], [2.2, 0.82], [2.0, 0.835], [1.31, 0.87], [0.9, 0.84], [0, 0.835], [-0.9, 0.84], [-1.31, 0.875], [-1.9, 0.845], [-2.3, 0.8], [-2.38, 0.72]],
    ys: [[2.26, 0.68], [2.2, 0.71], [1.8, 0.735], [1.31, 0.75], [0.8, 0.765], [0, 0.785], [-1.0, 0.8], [-1.31, 0.805], [-1.9, 0.81], [-2.3, 0.8], [-2.38, 0.75]],
    yc: [[2.26, 0.69], [2.2, 0.72], [1.8, 0.745], [1.3, 0.765], [0.82, 0.79], [0, 0.8], [-1.0, 0.81], [-1.6, 0.82], [-2.3, 0.81], [-2.38, 0.77]],
    lift: [[2.26, 0.42], [2.2, 0.24], [2.1, 0.21], [-2.3, 0.22], [-2.38, 0.3]],
    archF: 0.375, archR: 0.38,
    cabin: {
      x0: 0.82, x3: -1.6, roofFrom: 0.18, roofTo: -1.05, b: -0.62, c: -1.12, hwRoof: 0.67,
      roof: [[0.82, 0.8], [0.55, 1.1], [0.2, 1.34], [-0.2, 1.365], [-0.9, 1.36], [-1.15, 1.3], [-1.4, 1.04], [-1.6, 0.84]],
      hw: [[0.82, 0.78], [0, 0.8], [-1.6, 0.76]],
    },
    eye: [-0.12, 1.1, -0.34], roofCam: [-0.3, 1.48, 0], door: [0.78, -0.7], pipes: [-0.4, -0.3],
    extras(add, zone, at) {
      // the shark nose: a black grille set back under the leaning front, four round lamps in it
      add('black', box(0.03, 0.3, 1.5, 2.2, 0.46, 0))
      for (const sd of [1, -1]) {
        for (const [z, r] of [[0.62, 0.075], [0.44, 0.065]] as [number, number][]) {
          add('lamp', new THREE.CircleGeometry(r, 20).rotateY(Math.PI / 2).translate(2.218, 0.5, z * sd))
          add('chrome', new THREE.TorusGeometry(r + 0.004, 0.011, 6, 20).rotateY(Math.PI / 2).translate(2.215, 0.5, z * sd))
        }
        add('amber', box(0.02, 0.04, 0.1, 2.2, 0.36, 0.66 * sd))
        add('tail', box(0.02, 0.13, 0.36, -2.372, 0.63, 0.5 * sd))
        add('chrome', new THREE.SphereGeometry(0.06, 12, 8).scale(0.6, 0.8, 1).translate(0.62, at.belt(0.62) + 0.1, (at.side(0.62, at.belt(0.62)) + 0.08) * sd))
        // the rear wing's uprights
        add('black', box(0.12, 0.26, 0.03, -2.14, at.yc(-2.14) + 0.12, 0.56 * sd))
      }
      // a wide horizontal centre grille, chrome trim along the bonnet's leading edge
      add('chrome', box(0.02, 0.08, 0.5, 2.225, 0.5, 0))
      add('chrome', box(0.02, 0.012, 1.48, 2.262, 0.67, 0))
      zone('fw')
      add('black', box(0.28, 0.1, 1.62, 2.12, 0.17, 0))
      add('black', box(0.12, 0.012, 1.66, 2.24, 0.12, 0))
      zone('rw')
      add('chrome', box(0.06, 0.05, 1.6, -2.36, 0.4, 0))
      add('stripe', box(0.42, 0.03, 1.5, -2.16, at.yc(-2.16) + 0.26, 0, 0, 0, -0.08))
      zone('body')
    },
  },
}

/** Build the car's shapes: body, glasshouse, pillars, interior, details. */
function buildShape(model: ClassicModel, add: Add, zone: (z: Zone) => void) {
  const D = DESIGNS[model]
  const at = surface(D)
  // the body: a station every 2.5 cm, so the arches come out round
  const stations: { x: number; pts: [number, number][] }[] = []
  const N = Math.round((D.nose - D.tail) / 0.025)
  for (let i = 0; i <= N; i++) {
    const x = D.nose - (i / N) * (D.nose - D.tail)
    stations.push({ x, pts: ring({ x, hw: at.hw(x), yb: at.yb(x), ys: at.ys(x), yc: at.yc(x), tumble: D.tumble, k: at.ys(x) > at.yc(x) ? 3.5 : 2.2 }) })
  }
  add('paint', skin(stations, true))
  // the glasshouse
  const C = D.cabin
  const cab = (x: number): Station => {
    const yb = at.belt(x) - 0.04
    const yc = Math.max(at.roof(x), yb + 0.05)
    return { x, hw: at.cabinHw(x), yb, ys: Math.max(yc - 0.05, yb + 0.03), yc, tumble: 1 - C.hwRoof / at.cabinHw(x), k: 2.2 }
  }
  const cs: Station[] = []
  const CN = Math.round((C.x0 - C.x3) / 0.03)
  for (let i = 0; i <= CN; i++) cs.push(cab(C.x0 - (i / CN) * (C.x0 - C.x3)))
  add('glass', skin(cs.map((s) => ({ x: s.x, pts: ring(s) })), true))
  // the painted roof, and the broad rear pillars down the sides of the rear glass
  add('paint', skin(cs.filter((s) => s.x <= C.roofFrom && s.x >= C.roofTo).map((s) => ({ x: s.x, pts: topStrip(s) })), false))
  for (const sd of [1, -1]) add('plain', skin(cs.filter((s) => s.x <= C.c).map((s) => ({ x: s.x, pts: sideStrip(s, sd) })), false))
  // pillars: the A pillars along the windscreen's edges, the B pillar behind the door, a chrome window surround
  const edge = (x: number, sd: number, drop = 0.05) => v3(x, at.roof(x) - drop, (C.hwRoof + 0.01) * sd)
  for (const sd of [1, -1]) {
    const foot = v3(C.x0 - 0.02, at.belt(C.x0), (at.cabinHw(C.x0) - 0.02) * sd)
    add('plain', rod(foot, edge(C.roofFrom + 0.02, sd), 0.026, 8))
    if (C.b !== undefined) add('plain', rod(v3(C.b, at.belt(C.b) + 0.02, (at.cabinHw(C.b) + 0.004) * sd), edge(C.b - 0.06, sd, 0.06), C.b > -0.6 && model === 'bavaria' ? 0.012 : 0.03, 8))
    let prev = edge(C.roofFrom + 0.02, sd, 0.055)
    for (let x = C.roofFrom; x >= C.c; x -= 0.12) {
      const p = edge(x, sd, 0.055)
      add('chrome', rod(prev, p, 0.009, 5))
      prev = p
    }
  }
  // the rubber at the foot of the windscreen
  add('black', rod(v3(C.x0 - 0.01, at.belt(C.x0) + 0.01, -(at.cabinHw(C.x0) - 0.05)), v3(C.x0 - 0.01, at.belt(C.x0) + 0.01, at.cabinHw(C.x0) - 0.05), 0.012, 5))
  // the dark cabin below the windows, the driver
  const inner = cs.map((s) => ({ x: s.x, pts: ring({ ...s, hw: s.hw * 0.93, yc: s.yb + (s.yc - s.yb) * 0.32, ys: s.yb + (s.yc - s.yb) * 0.3 }) }))
  add('interior', skin(inner, true))
  add('helmet', new THREE.SphereGeometry(0.13, 16, 12).translate(D.eye[0], D.eye[1] - 0.02, D.eye[2]))
  // arch lips round the wheel openings
  for (const [xw, A] of [[D.front, D.archF], [D.rear, D.archR]]) {
    for (const sd of [1, -1]) {
      const z = at.side(xw, D.r + A * 0.6) + 0.004
      add('plain', new THREE.TorusGeometry(A, 0.018, 6, 24, Math.PI).translate(xw, D.r, z * sd))
    }
  }
  D.extras(add, zone, at)
  return { D, at }
}

/** Shut-lines, chrome trim, wipers, exhausts, wheel wells, the cabin's roll cage, seat, wheel and driver, a tow hook. */
function details(add: Add, D: Design, at: Surface) {
  const [eyeX, eyeY, eyeZ] = D.eye
  const sill = D.sill
  for (const sd of [1, -1]) {
    // the doors' shut-lines, a handle, the sill
    for (const x of D.door) {
      const yTop = at.belt(x) - 0.02
      const y0 = Math.max(sill + 0.03, at.yb(x) + 0.03)
      for (let k = 0; k < 4; k++) {
        const ya = y0 + ((yTop - y0) * k) / 4
        const yb2 = y0 + ((yTop - y0) * (k + 1)) / 4
        add('black', rod(v3(x, ya, (at.side(x, ya) + 0.003) * sd), v3(x, yb2, (at.side(x, yb2) + 0.003) * sd), 0.005, 4))
      }
    }
    const hx = D.door[1] + 0.18
    const hy = at.belt(hx) - 0.08
    add('chrome', box(0.12, 0.02, 0.02, hx, hy, (at.side(hx, hy) + 0.008) * sd))
    // dark wheel wells behind the tyres
    for (const [x, track, w, A] of [[D.front, D.trackF, D.wF, D.archF], [D.rear, D.trackR, D.wR, D.archR]] as [number, number, number, number][]) {
      add('black', new THREE.CylinderGeometry(A - 0.01, A - 0.01, 0.25, 22, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(x, D.r, (track - w / 2 - 0.1) * sd))
      add('black', new THREE.CircleGeometry(A - 0.01, 22, 0, Math.PI).translate(x, D.r, (track - w / 2 - 0.22) * sd))
    }
    // the roll cage, seen through the glass
    add('chrome', rod(v3(eyeX - 0.42, at.belt(eyeX) - 0.1, 0.42 * sd), v3(eyeX - 0.42, eyeY + 0.12, 0.38 * sd), 0.018))
    add('chrome', rod(v3(eyeX - 0.42, at.belt(eyeX) - 0.1, 0.42 * sd), v3(eyeX + 0.55, at.belt(eyeX) - 0.05, 0.44 * sd), 0.016))
    // a sticker on each front wing
    const sx = D.front + 0.52
    const sy = at.yb(sx) + 0.12
    add('decal', new THREE.PlaneGeometry(0.42, 0.09).rotateY(sd < 0 ? Math.PI : 0).translate(sx, sy, (at.side(sx, sy) + 0.012) * sd))
  }
  add('chrome', rod(v3(eyeX - 0.42, eyeY + 0.12, 0.38), v3(eyeX - 0.42, eyeY + 0.12, -0.38), 0.018))
  add('chrome', rod(v3(eyeX - 0.42, eyeY + 0.12, 0.38), v3(eyeX - 0.42, at.belt(eyeX) - 0.1, -0.42), 0.014))
  // the bucket seat; the steering wheel and the shoulders (the cockpit camera draws its own)
  add('interior', box(0.12, 0.55, 0.42, eyeX - 0.3, eyeY - 0.38, eyeZ))
  add('cockpit', new THREE.TorusGeometry(0.17, 0.018, 6, 20).rotateY(Math.PI / 2).rotateZ(-0.45).translate(eyeX + 0.42, eyeY - 0.17, eyeZ))
  add('shoulders', box(0.2, 0.18, 0.42, eyeX - 0.08, eyeY - 0.28, eyeZ))
  // windscreen wipers resting at the foot of the screen
  const C = D.cabin
  for (const z of [-0.42, 0.02]) add('black', box(0.02, 0.012, 0.42, C.x0 - 0.06, at.belt(C.x0) + 0.05, z + 0.2, 0, 0.12, 0))
  // exhaust pipes under the tail, a red tow hook at the front
  for (const z of D.pipes) {
    add('chrome', new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10).rotateZ(Math.PI / 2).translate(D.tail + 0.02, sill + 0.02, z))
    add('black', new THREE.CircleGeometry(0.026, 10).rotateY(-Math.PI / 2).translate(D.tail - 0.081, sill + 0.02, z))
  }
  add('tail', box(0.1, 0.03, 0.05, D.nose, 0.22, -0.3))
}

/** Where a classic's cameras sit (in the car's own frame). */
export function classicCams(model: ClassicModel): { eye: THREE.Vector3; roof: THREE.Vector3 } {
  const D = DESIGNS[model]
  return { eye: v3(...D.eye), roof: v3(...D.roofCam) }
}

// ---------------------------------------------------------------- textures

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}
function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Period livery on the body loft: v = 0.5 is the top, 0.25 / 0.75 the sides. */
function classicLivery(team: Team, model: ClassicModel) {
  const [c, g] = canvas(512, 256)
  g.fillStyle = team.color
  g.fillRect(0, 0, 512, 256)
  g.fillStyle = team.color2
  if (model === 'bavaria') {
    // three thin stripes sweeping over the wings
    // three stripes along the shoulders (v ≈ 0.3 and 0.7 on the body)
    const cols = [team.color2, team.accent, '#6b2bd9']
    cols.forEach((col, k) => {
      g.fillStyle = col
      g.fillRect(0, 72 + k * 6, 512, 4)
      g.fillRect(0, 172 + k * 6, 512, 4)
    })
  } else if (model === 'dieppe') {
    // a bold stripe over the bonnet and roof
    g.fillRect(0, 112, 512, 32)
  } else {
    // twin racing stripes and a band low along the sides
    g.fillRect(0, 106, 512, 14)
    g.fillRect(0, 136, 512, 14)
    for (const v of [56, 200]) g.fillRect(0, v - 6, 512, 12)
  }
  return tex(c)
}

/** A period sponsor sticker: the team's second colour, the KherveOS name. */
function stickerTexture(team: Team) {
  const [c, g] = canvas(512, 112)
  g.fillStyle = team.color2
  g.beginPath()
  g.roundRect(6, 6, 500, 100, 18)
  g.fill()
  g.fillStyle = team.color === team.color2 ? '#111' : team.color
  g.font = '900 italic 66px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('KherveOS', 256, 60)
  return tex(c)
}

function roundelTexture(num: number) {
  const [c, g] = canvas(128, 128)
  g.fillStyle = '#f7f5ee'
  g.beginPath()
  g.arc(64, 64, 60, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#111'
  g.lineWidth = 4
  g.stroke()
  g.fillStyle = '#111'
  g.font = '900 64px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(String(num), 64, 68)
  return tex(c)
}

/** Period wheels: five-spoke, eight-spoke or cross-spoke alloys. */
function wheelTexture(model: ClassicModel) {
  const [c, g] = canvas(128, 128)
  g.fillStyle = '#1b1c1e'
  g.fillRect(0, 0, 128, 128)
  const metal = model === 'dieppe' ? '#c8ccd2' : model === 'stoccarda' ? '#d9dcdf' : '#b9bcc0'
  g.fillStyle = metal
  g.beginPath()
  g.arc(64, 64, 62, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#1b1c1e'
  const holes = model === 'stoccarda' ? 5 : model === 'dieppe' ? 8 : 10
  for (let k = 0; k < holes; k++) {
    const a = (k / holes) * Math.PI * 2
    g.beginPath()
    g.ellipse(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36, model === 'stoccarda' ? 16 : 9, model === 'stoccarda' ? 11 : 15, a, 0, Math.PI * 2)
    g.fill()
  }
  g.fillStyle = '#8d9196'
  g.beginPath()
  g.arc(64, 64, 13, 0, Math.PI * 2)
  g.fill()
  return tex(c)
}

// ---------------------------------------------------------------- the car

function tyreGeometry(r: number, w: number): THREE.BufferGeometry {
  const h = w / 2
  const rim = r * 0.6
  const pts = [[rim, -h], [r * 0.82, -h - 0.006], [r * 0.95, -h + 0.012], [r, -h + 0.035], [r, h - 0.035], [r * 0.95, h - 0.012], [r * 0.82, h + 0.006], [rim, h]].map(([a, b]) => new THREE.Vector2(a, b))
  return new THREE.LatheGeometry(pts, 44).rotateX(Math.PI / 2)
}

export function buildClassic(model: ClassicModel, team: Team, num: number, sh: Shared): CarModel {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const parts = new Map<Part, THREE.BufferGeometry[]>()
  const pieces: Record<Zone, Map<Part, THREE.BufferGeometry[]>> = { body: parts, fw: new Map(), rw: new Map() }
  let zone: Zone = 'body'
  const addPart: Add = (k, g) => {
    const M = pieces[zone]
    let l = M.get(k)
    if (!l) M.set(k, (l = []))
    l.push(g)
  }
  const { D, at } = buildShape(model, addPart, (z) => (zone = z))
  zone = 'body'
  details(addPart, D, at)
  const livery = classicLivery(team, model)
  const light = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 0.4 })
  const paintOpts = { roughness: 0.26, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 }
  const mats: Record<Part, THREE.Material> = {
    paint: new THREE.MeshPhysicalMaterial({ map: livery, ...paintOpts }),
    plain: new THREE.MeshPhysicalMaterial({ color: team.color, ...paintOpts }),
    stripe: new THREE.MeshPhysicalMaterial({ color: team.color2, roughness: 0.3, clearcoat: 1 }),
    decal: new THREE.MeshStandardMaterial({ map: stickerTexture(team), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x1a2630, roughness: 0.03, metalness: 0.2, transparent: true, opacity: 0.5, depthWrite: false, clearcoat: 1, envMapIntensity: 1.4 }),
    chrome: sh.metal,
    black: sh.black,
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1cc, emissiveIntensity: 0.35, roughness: 0.1 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0x6a3a00, roughness: 0.2 }),
    tail: light,
    helmet: new THREE.MeshPhysicalMaterial({ color: team.color2, roughness: 0.25, clearcoat: 1 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.9 }),
    cockpit: sh.black,
    shoulders: new THREE.MeshStandardMaterial({ color: team.color2, roughness: 0.7 }),
  }
  const owned: (THREE.Material | THREE.Texture | THREE.BufferGeometry)[] = [
    livery, mats.paint, mats.plain, mats.decal, (mats.decal as THREE.MeshStandardMaterial).map!, mats.stripe, mats.glass, mats.lamp, mats.amber, light, mats.helmet, mats.interior, mats.shoulders,
  ]
  const hideInCockpit: THREE.Mesh[] = []
  for (const [k, list] of parts) {
    const g = merge(list)
    owned.push(g)
    const m = new THREE.Mesh(g, mats[k])
    m.castShadow = k !== 'glass' && k !== 'lamp' && k !== 'decal'
    m.receiveShadow = k === 'paint' || k === 'plain'
    if (k === 'glass') m.renderOrder = 2
    if (k === 'cockpit' || k === 'shoulders' || k === 'helmet') hideInCockpit.push(m)
    body.add(m)
  }
  // the bumpers (and the Bavaria's wing) hang from pivots at their ends, so a crash can bend them or knock them off
  const piece = (z: 'fw' | 'rw', px: number, py: number) => {
    const g = new THREE.Group()
    g.position.set(px, py, 0)
    for (const [k, list] of pieces[z]) {
      const geom = merge(list)
      owned.push(geom)
      const m = new THREE.Mesh(geom, mats[k])
      m.position.set(-px, -py, 0)
      m.castShadow = true
      g.add(m)
    }
    body.add(g)
    return g
  }
  const front = piece('fw', D.nose - 0.1, 0.3)
  const rear = piece('rw', D.tail + 0.15, 0.4)
  // racing roundels on the doors and the bonnet
  const rt = roundelTexture(num)
  const rm = new THREE.MeshStandardMaterial({ map: rt, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false })
  const rg = new THREE.CircleGeometry(0.19, 28)
  owned.push(rt, rm, rg)
  const dx = (D.door[0] + D.door[1]) / 2
  const dy = (at.belt(dx) + Math.max(D.sill, at.yb(dx))) / 2 + 0.02
  for (const sd of [1, -1]) {
    const d = new THREE.Mesh(rg, rm)
    d.position.set(dx, dy, (at.side(dx, dy) + 0.006) * sd)
    if (sd < 0) d.rotation.y = Math.PI
    body.add(d)
  }
  const hx = D.cabin.x0 + (D.nose - D.cabin.x0) * 0.42
  const hood = new THREE.Mesh(rg, rm)
  hood.rotation.x = -Math.PI / 2
  hood.rotation.z = Math.PI / 2
  hood.position.set(hx, at.yc(hx) + 0.006, 0)
  hood.scale.setScalar(0.75)
  body.add(hood)

  // wheels: period alloys, a tyre with a rounded sidewall
  const wt = wheelTexture(model)
  const wm = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.3, metalness: 0.7 })
  const tF = tyreGeometry(D.r, D.wF)
  const tR = tyreGeometry(D.r, D.wR)
  const disc = new THREE.CircleGeometry(D.r * 0.6, 28)
  const lip = new THREE.TorusGeometry(D.r * 0.6, 0.012, 6, 28)
  owned.push(wt, wm, tF, tR, disc, lip)
  const wheels: CarModel['wheels'] = []
  for (const [x, z, isFront] of [[D.front, D.trackF, true], [D.front, -D.trackF, true], [D.rear, D.trackR, false], [D.rear, -D.trackR, false]] as [number, number, boolean][]) {
    const pivot = new THREE.Group()
    pivot.position.set(x, D.r, z)
    const spin = new THREE.Group()
    pivot.add(spin)
    const tyre = new THREE.Mesh(isFront ? tF : tR, sh.tyre.medium)
    tyre.castShadow = true
    spin.add(tyre)
    const w = isFront ? D.wF : D.wR
    for (const side of [1, -1]) {
      const face = new THREE.Mesh(disc, wm)
      face.position.z = (w / 2 - 0.025) * side
      if (side < 0) face.rotation.y = Math.PI
      spin.add(face)
      const rim = new THREE.Mesh(lip, sh.metal)
      rim.position.z = (w / 2 - 0.02) * side
      spin.add(rim)
    }
    root.add(pivot)
    wheels.push({ pivot, spin, tyre, front: isFront, base: pivot.position.clone() })
  }
  const flap = new THREE.Mesh()
  return {
    root, body, wheels, flap, light,
    setCompound(c: Compound) {
      for (const w of wheels) w.tyre.material = sh.tyre[c]
    },
    setDamage(d: Damage) {
      showDamage(front, d.fw, 0.35, 0.4, d.side)
      showDamage(rear, d.rw, -0.3, 0.35, d.side)
      bendWheels(wheels, d)
    },
    setCockpit(on: boolean) {
      for (const m of hideInCockpit) m.visible = !on
    },
    dispose() {
      for (const o of owned) o.dispose()
    },
  }
}
