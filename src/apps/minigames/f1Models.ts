// Kherve Grand Prix: the models, all built from code. The car is a modern
// single-seater: a lofted monocoque and nose, sidepods and airbox (smooth
// super-ellipse sections), floor and diffuser, a three-element front wing,
// a rear wing with a DRS flap that opens, the halo, wishbones, mirrors, the
// driver's helmet, wheels with slick tyres (the compound's coloured band on
// the sidewall) and wheel covers, numbers and a livery per team. Shapes are
// merged by material, so a car is a handful of draw calls. Also: the team
// transporter trucks and the pit crew.

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Team } from './f1Race.ts'
import { COMPOUNDS, type Compound, type Damage } from './f1Physics.ts'

// ---------------------------------------------------------------- helpers

interface Section {
  x: number
  hw: number
  yb: number
  yt: number
  /** Super-ellipse exponent: 2 an ellipse, bigger a rounded box. */
  p: number
  zc?: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

/** A smooth body through the sections (along -x), closed at both ends; uv: u along, v around. */
export function loft(secs: Section[], radial = 28, sub = 5): THREE.BufferGeometry {
  // densify with Catmull-Rom through each value
  const dense: Section[] = []
  for (let i = 0; i < secs.length - 1; i++) {
    const a = secs[Math.max(0, i - 1)]
    const b = secs[i]
    const c = secs[i + 1]
    const d = secs[Math.min(secs.length - 1, i + 2)]
    for (let j = 0; j < sub; j++) {
      const t = j / sub
      const f = (k: keyof Section) => cr((a[k] as number) ?? 0, (b[k] as number) ?? 0, (c[k] as number) ?? 0, (d[k] as number) ?? 0, t)
      dense.push({ x: lerp(b.x, c.x, t), hw: Math.max(0.002, f('hw')), yb: f('yb'), yt: f('yt'), p: f('p'), zc: f('zc') })
    }
  }
  dense.push({ ...secs[secs.length - 1], zc: secs[secs.length - 1].zc ?? 0 })
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const x0 = dense[0].x
  const x1 = dense[dense.length - 1].x
  for (let i = 0; i < dense.length; i++) {
    const s = dense[i]
    const cy = (s.yb + s.yt) / 2
    const ry = (s.yt - s.yb) / 2
    const e = 2 / s.p
    for (let j = 0; j <= radial; j++) {
      // v = 0 at the bottom, 0.25 on the right (+z), 0.5 on top
      const th = -Math.PI / 2 + (j / radial) * Math.PI * 2
      const c = Math.cos(th)
      const sn = Math.sin(th)
      const zz = (s.zc ?? 0) + s.hw * Math.sign(c) * Math.pow(Math.abs(c), e)
      const yy = cy + ry * Math.sign(sn) * Math.pow(Math.abs(sn), e)
      pos.push(s.x, yy, zz)
      uv.push((s.x - x0) / (x1 - x0), j / radial)
    }
  }
  const row = radial + 1
  for (let i = 0; i < dense.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j
      const b = a + row
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  // caps
  for (const [i, flip] of [[0, false], [dense.length - 1, true]] as [number, boolean][]) {
    const s = dense[i]
    const center = pos.length / 3
    pos.push(s.x, (s.yb + s.yt) / 2, s.zc ?? 0)
    uv.push(i === 0 ? 0 : 1, 0.5)
    for (let j = 0; j < radial; j++) {
      const a = i * row + j
      if (flip) idx.push(center, a, a + 1)
      else idx.push(center, a + 1, a)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** A box from its centre and size, optionally turned (radians about x, y, z). */
function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d)
  g.rotateX(rx)
  g.rotateY(ry)
  g.rotateZ(rz)
  g.translate(x, y, z)
  return g
}

/** A thin rod between two points. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a)
  const g = new THREE.CylinderGeometry(r, r, d.length(), seg, 1)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())
  g.applyQuaternion(q)
  const m = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  g.translate(m.x, m.y, m.z)
  return g
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Merge geometries (made non-indexed, uv kept) into one. */
export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ready = list.map((g) => {
    let n = g.index ? g.toNonIndexed() : g
    if (!n.getAttribute('uv')) {
      const cnt = n.getAttribute('position').count
      n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(cnt * 2), 2))
    }
    if (!n.getAttribute('normal')) n.computeVertexNormals()
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k)
    n.clearGroups()
    if (n !== g) g.dispose()
    return n
  })
  const out = mergeGeometries(ready, false)!
  for (const g of ready) g.dispose()
  return out
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// ---------------------------------------------------------------- the car's shape

type Part = 'paint' | 'paint2' | 'carbon' | 'black' | 'metal' | 'halo' | 'helmet' | 'visor' | 'light' | 'tcam'

export interface CarGeometry {
  parts: Map<Part, THREE.BufferGeometry>
  /** The wings, apart from the body so that a crash can bend them or knock them off. */
  frontWing: Map<Part, THREE.BufferGeometry>
  rearWing: Map<Part, THREE.BufferGeometry>
  tyreF: THREE.BufferGeometry
  tyreR: THREE.BufferGeometry
  rim: THREE.BufferGeometry
  cover: THREE.BufferGeometry
  drsFlap: THREE.BufferGeometry
}

export const WHEELS = [
  { x: 1.8, z: 0.8, front: true, w: 0.3 },
  { x: 1.8, z: -0.8, front: true, w: 0.3 },
  { x: -1.8, z: 0.78, front: false, w: 0.4 },
  { x: -1.8, z: -0.78, front: false, w: 0.4 },
]
const R = 0.36

function tyreGeometry(w: number): THREE.BufferGeometry {
  const h = w / 2
  const pts = [
    [0.232, -h], [0.3, -h - 0.006], [0.343, -h + 0.012], [R, -h + 0.045], [R, h - 0.045], [0.343, h - 0.012], [0.3, h + 0.006], [0.232, h],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(pts, 48)
  g.rotateX(Math.PI / 2) // the axle along z
  return g
}

function rimGeometry(): THREE.BufferGeometry {
  const pts = [[0.04, -0.13], [0.2, -0.13], [0.232, -0.14], [0.232, 0.14], [0.2, 0.12], [0.06, 0.08]].map(([r, y]) => new THREE.Vector2(r, y))
  const g = new THREE.LatheGeometry(pts, 32)
  g.rotateX(Math.PI / 2)
  return g
}

export function buildCarGeometry(): CarGeometry {
  const P = new Map<Part, THREE.BufferGeometry[]>()
  const FW = new Map<Part, THREE.BufferGeometry[]>()
  const RW = new Map<Part, THREE.BufferGeometry[]>()
  /** Which piece the shapes go to: the body, or one of the wings. */
  let zone: 'body' | 'fw' | 'rw' = 'body'
  const add = (k: Part, g: THREE.BufferGeometry) => {
    const M = zone === 'fw' ? FW : zone === 'rw' ? RW : P
    let l = M.get(k)
    if (!l) M.set(k, (l = []))
    l.push(g)
  }
  // monocoque, nose and engine cover
  add('paint', loft([
    { x: 3.14, hw: 0.07, yb: 0.17, yt: 0.25, p: 2.2 },
    { x: 2.95, hw: 0.1, yb: 0.15, yt: 0.31, p: 2.4 },
    { x: 2.55, hw: 0.15, yb: 0.14, yt: 0.4, p: 2.6 },
    { x: 2.1, hw: 0.2, yb: 0.12, yt: 0.49, p: 2.8 },
    { x: 1.6, hw: 0.27, yb: 0.1, yt: 0.56, p: 3.0 },
    { x: 1.15, hw: 0.33, yb: 0.07, yt: 0.615, p: 3.4 },
    { x: 0.75, hw: 0.38, yb: 0.06, yt: 0.63, p: 3.6 },
    { x: 0.35, hw: 0.4, yb: 0.06, yt: 0.66, p: 3.6 },
    { x: 0.0, hw: 0.4, yb: 0.06, yt: 0.665, p: 3.4 },
    { x: -0.45, hw: 0.34, yb: 0.07, yt: 0.625, p: 3.0 },
    { x: -0.95, hw: 0.26, yb: 0.08, yt: 0.58, p: 2.8 },
    { x: -1.45, hw: 0.18, yb: 0.1, yt: 0.52, p: 2.6 },
    { x: -1.95, hw: 0.12, yb: 0.13, yt: 0.46, p: 2.4 },
    { x: -2.3, hw: 0.085, yb: 0.16, yt: 0.4, p: 2.2 },
  ], 32, 6))
  // airbox and roll hoop
  add('paint', loft([
    { x: 0.44, hw: 0.09, yb: 0.56, yt: 0.8, p: 2.4 },
    { x: 0.3, hw: 0.15, yb: 0.55, yt: 0.95, p: 2.7 },
    { x: -0.1, hw: 0.155, yb: 0.52, yt: 0.95, p: 2.7 },
    { x: -0.6, hw: 0.11, yb: 0.5, yt: 0.83, p: 2.4 },
    { x: -1.2, hw: 0.06, yb: 0.46, yt: 0.63, p: 2.2 },
    { x: -1.65, hw: 0.025, yb: 0.43, yt: 0.5, p: 2 },
  ], 24, 5))
  add('black', (() => {
    const g = new THREE.CircleGeometry(1, 20)
    g.scale(0.075, 0.085, 1)
    g.rotateY(Math.PI / 2)
    g.translate(0.445, 0.74, 0)
    return g
  })())
  // sidepods
  for (const sd of [1, -1]) {
    const secs: Section[] = [
      { x: 1.18, hw: 0.11, yb: 0.12, yt: 0.5, p: 3.0, zc: 0.56 * sd },
      { x: 0.9, hw: 0.2, yb: 0.08, yt: 0.545, p: 3.6, zc: 0.565 * sd },
      { x: 0.3, hw: 0.24, yb: 0.07, yt: 0.5, p: 3.6, zc: 0.55 * sd },
      { x: -0.3, hw: 0.21, yb: 0.07, yt: 0.42, p: 3.0, zc: 0.5 * sd },
      { x: -0.9, hw: 0.14, yb: 0.08, yt: 0.32, p: 2.6, zc: 0.42 * sd },
      { x: -1.45, hw: 0.06, yb: 0.1, yt: 0.23, p: 2.2, zc: 0.32 * sd },
    ]
    add('paint', loft(secs, 24, 5))
    const inlet = new THREE.CircleGeometry(1, 20)
    inlet.scale(0.13, 0.18, 1)
    inlet.rotateY(Math.PI / 2)
    inlet.translate(1.19, 0.33, 0.57 * sd)
    add('black', inlet)
    // mirrors on stalks
    add('carbon', rod(v3(0.98, 0.6, 0.3 * sd), v3(0.92, 0.72, 0.5 * sd), 0.012))
    add('paint2', box(0.07, 0.06, 0.16, 0.92, 0.73, 0.52 * sd))
    add('black', box(0.005, 0.045, 0.14, 0.885, 0.73, 0.52 * sd))
  }
  // the cockpit opening, the headrest
  add('black', (() => {
    const s = new THREE.Shape()
    s.absellipse(0, 0, 0.42, 0.24, 0, Math.PI * 2, false, 0)
    const g = new THREE.ShapeGeometry(s, 24)
    g.rotateX(-Math.PI / 2)
    g.translate(0.86, 0.637, 0)
    return g
  })())
  add('black', box(0.12, 0.08, 0.5, 0.5, 0.64, 0))
  // floor, plank, diffuser, bargeboards
  add('carbon', (() => {
    const s = new THREE.Shape()
    s.moveTo(1.45, -0.42)
    s.lineTo(1.2, -0.7)
    s.lineTo(-1.25, -0.74)
    s.lineTo(-1.62, -0.5)
    s.lineTo(-1.62, 0.5)
    s.lineTo(-1.25, 0.74)
    s.lineTo(1.2, 0.7)
    s.lineTo(1.45, 0.42)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false })
    g.rotateX(Math.PI / 2)
    g.translate(0, 0.06, 0)
    return g
  })())
  add('carbon', box(0.6, 0.012, 1.0, -1.95, 0.15, 0, 0, 0, 0.42))
  for (const z of [-0.5, -0.25, 0, 0.25, 0.5]) add('carbon', box(0.6, 0.18, 0.01, -1.95, 0.17, z, 0, 0, 0.42))
  for (const sd of [1, -1]) {
    add('carbon', box(0.9, 0.14, 0.012, 0.2, 0.13, 0.76 * sd, 0, 0, 0))
    add('carbon', box(0.35, 0.22, 0.012, 1.25, 0.2, 0.36 * sd, 0, 0.25 * sd, 0))
  }
  // front wing: main plane, flaps stacked outboard, endplates, the pylons to the nose
  zone = 'fw'
  add('carbon', box(0.36, 0.022, 1.88, 3.05, 0.085, 0, 0, 0, 0.06))
  for (let k = 0; k < 3; k++) {
    for (const sd of [1, -1]) {
      add(k === 0 ? 'carbon' : 'paint2', box(0.13, 0.016, 0.66, 2.93 - k * 0.09, 0.125 + k * 0.055, (0.58 + k * 0.01) * sd, 0, 0, 0.22 + k * 0.18))
    }
  }
  for (const sd of [1, -1]) {
    add('paint2', box(0.46, 0.25, 0.015, 3.02, 0.17, 0.94 * sd))
    add('carbon', box(0.05, 0.08, 0.012, 2.92, 0.13, 0.08 * sd))
  }
  // rear wing: endplates, main plane (the flap is separate: DRS), beam wing, swan neck
  zone = 'rw'
  for (const sd of [1, -1]) {
    add('paint2', (() => {
      const e = new THREE.Shape()
      e.moveTo(-2.0, 0.42)
      e.lineTo(-2.0, 0.78)
      e.quadraticCurveTo(-2.02, 1.0, -2.25, 1.0)
      e.lineTo(-2.6, 1.0)
      e.quadraticCurveTo(-2.64, 0.98, -2.64, 0.92)
      e.lineTo(-2.64, 0.5)
      e.quadraticCurveTo(-2.5, 0.38, -2.3, 0.4)
      e.closePath()
      const g = new THREE.ExtrudeGeometry(e, { depth: 0.018, bevelEnabled: false, curveSegments: 6 })
      g.translate(0, 0, 0.52 * sd - 0.009)
      return g
    })())
    add('carbon', box(0.02, 0.38, 0.03, -2.25, 0.62, 0.06 * sd, 0, 0, 0.12))
  }
  add('paint2', box(0.3, 0.022, 1.02, -2.33, 0.83, 0, 0, 0, 0.12))
  add('carbon', box(0.18, 0.018, 0.98, -2.36, 0.42, 0, 0, 0, 0.18))
  zone = 'body'
  add('carbon', box(0.3, 0.14, 0.12, -2.38, 0.31, 0))
  add('light', box(0.03, 0.05, 0.1, -2.53, 0.31, 0))
  // shark fin
  add('paint', (() => {
    const s = new THREE.Shape()
    s.moveTo(-0.05, 0.93)
    s.lineTo(-2.0, 0.82)
    s.lineTo(-2.0, 0.6)
    s.lineTo(-1.2, 0.62)
    s.lineTo(-0.5, 0.8)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false })
    g.translate(0, 0, -0.006)
    return g
  })())
  // halo
  const halo = new THREE.CatmullRomCurve3([
    v3(0.5, 0.64, -0.3), v3(0.6, 0.84, -0.29), v3(0.88, 0.9, -0.26), v3(1.2, 0.89, -0.15), v3(1.36, 0.875, 0),
    v3(1.2, 0.89, 0.15), v3(0.88, 0.9, 0.26), v3(0.6, 0.84, 0.29), v3(0.5, 0.64, 0.3),
  ])
  add('halo', new THREE.TubeGeometry(halo, 48, 0.024, 8, false))
  add('halo', rod(v3(1.36, 0.875, 0), v3(1.55, 0.6, 0), 0.025, 8))
  // suspension: wishbones and push rods (front and rear)
  for (const w of WHEELS) {
    const sd = Math.sign(w.z)
    const inner = w.front ? 0.2 : 0.12
    const hubZ = (Math.abs(w.z) - 0.1) * sd
    for (const y of [0.42, 0.2]) {
      add('carbon', rod(v3(w.x + 0.25, y + 0.03, inner * sd), v3(w.x, y, hubZ), 0.016))
      add('carbon', rod(v3(w.x - 0.25, y + 0.03, inner * sd), v3(w.x, y, hubZ), 0.016))
    }
    add('carbon', rod(v3(w.x - 0.05, 0.5, inner * sd), v3(w.x, 0.22, hubZ), 0.014))
    // the steering track rod / brake ducts
    add('black', box(0.2, 0.26, 0.08, w.x, 0.33, (Math.abs(w.z) - 0.2) * sd))
  }
  // driver: helmet and visor
  add('helmet', (() => {
    const g = new THREE.SphereGeometry(0.128, 20, 14)
    g.scale(1.08, 1, 0.95)
    g.translate(0.74, 0.715, 0)
    return g
  })())
  add('visor', (() => {
    const g = new THREE.SphereGeometry(0.131, 20, 6, Math.PI - 0.95, 1.9, 1.2, 0.42)
    g.scale(1.08, 1, 0.95)
    g.translate(0.74, 0.715, 0)
    return g
  })())
  add('tcam', box(0.12, 0.05, 0.07, 0.18, 0.975, 0))

  // ---- the finer details
  // pitot tube and camera pods on the nose, a radio aerial on the engine cover
  add('metal', rod(v3(3.13, 0.22, 0), v3(3.36, 0.22, 0), 0.006, 5))
  for (const sd of [1, -1]) {
    add('carbon', loft([
      { x: 2.78, hw: 0.018, yb: 0.3, yt: 0.33, p: 2, zc: 0.13 * sd },
      { x: 2.7, hw: 0.025, yb: 0.29, yt: 0.34, p: 2, zc: 0.14 * sd },
      { x: 2.58, hw: 0.018, yb: 0.3, yt: 0.33, p: 2, zc: 0.14 * sd },
    ], 8, 2))
    add('carbon', rod(v3(2.68, 0.3, 0.14 * sd), v3(2.68, 0.36, 0.12 * sd), 0.006, 4))
  }
  add('black', rod(v3(-0.55, 0.8, 0), v3(-0.62, 1.0, 0), 0.004, 4))
  // a fourth front-wing flap and the little cascade winglets on the endplates
  zone = 'fw'
  for (const sd of [1, -1]) {
    add('paint2', box(0.1, 0.014, 0.62, 2.68, 0.3, 0.6 * sd, 0, 0, 0.75))
    add('carbon', box(0.16, 0.012, 0.1, 2.95, 0.26, 0.86 * sd, 0, 0, 0.3))
    add('carbon', box(0.12, 0.01, 0.08, 2.88, 0.3, 0.8 * sd, 0, 0, 0.45))
    add('carbon', box(0.42, 0.012, 0.06, 3.02, 0.055, 0.92 * sd))
  }
  zone = 'body'
  // under the nose: turning vanes
  for (const z of [-0.12, -0.04, 0.04, 0.12]) add('carbon', box(0.28, 0.1, 0.008, 2.55, 0.11, z, 0, 0.12 * Math.sign(z), 0))
  // sidepod inlet lips, louvres on top of the sidepods, little vanes on their shoulders
  for (const sd of [1, -1]) {
    add('paint2', new THREE.TorusGeometry(1, 0.06, 6, 24).scale(0.13, 0.18, 1).rotateY(Math.PI / 2).translate(1.195, 0.33, 0.57 * sd))
    for (let k = 0; k < 7; k++) add('black', box(0.03, 0.006, 0.2, 0.2 - k * 0.09, 0.505 - k * 0.01, 0.55 * sd, 0, 0, -0.1))
    add('carbon', box(0.3, 0.07, 0.008, 0.75, 0.6, 0.66 * sd))
    // floor edge wings and the mirrors' glass
    add('carbon', box(0.5, 0.008, 0.08, -0.6, 0.075, 0.78 * sd, 0, 0, 0))
    add('metal', box(0.004, 0.04, 0.13, 0.879, 0.73, 0.52 * sd))
    // halo mounting fairings
    add('halo', box(0.12, 0.06, 0.06, 0.52, 0.63, 0.3 * sd))
  }
  // the exhaust: a single tailpipe above the crash structure, a wastegate either side
  add('metal', new THREE.CylinderGeometry(0.055, 0.06, 0.2, 14).rotateZ(Math.PI / 2).translate(-2.4, 0.46, 0))
  add('black', new THREE.CircleGeometry(0.045, 12).rotateY(-Math.PI / 2).translate(-2.501, 0.46, 0))
  for (const sd of [1, -1]) add('metal', new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8).rotateZ(Math.PI / 2).translate(-2.4, 0.56, 0.06 * sd))
  // the rear wing's DRS actuator pod
  zone = 'rw'
  add('carbon', box(0.1, 0.06, 0.05, -2.32, 0.88, 0))
  zone = 'body'
  // in the cockpit: the steering wheel with its screen and grips, padding round the driver's head
  add('black', box(0.04, 0.12, 0.26, 1.02, 0.66, 0, 0, 0, 0.35))
  add('light', box(0.005, 0.05, 0.09, 1.0, 0.68, 0))
  for (const sd of [1, -1]) {
    add('black', box(0.05, 0.1, 0.05, 1.04, 0.63, 0.14 * sd, 0, 0, 0.35))
    add('black', box(0.28, 0.1, 0.07, 0.68, 0.67, 0.19 * sd))
  }

  const parts = new Map<Part, THREE.BufferGeometry>()
  for (const [k, l] of P) parts.set(k, merge(l))
  const frontWing = new Map<Part, THREE.BufferGeometry>()
  for (const [k, l] of FW) frontWing.set(k, merge(l))
  const rearWing = new Map<Part, THREE.BufferGeometry>()
  for (const [k, l] of RW) rearWing.set(k, merge(l))
  const flap = box(0.17, 0.016, 1.02, -0.085, 0, 0)
  return {
    parts,
    frontWing,
    rearWing,
    tyreF: tyreGeometry(0.3),
    tyreR: tyreGeometry(0.4),
    rim: rimGeometry(),
    cover: (() => {
      const g = new THREE.CircleGeometry(0.228, 32)
      return g
    })(),
    drsFlap: flap,
  }
}

// ---------------------------------------------------------------- textures and materials

let carbonTex: THREE.Texture | null = null
function carbonTexture() {
  if (carbonTex) return carbonTex
  const [c, g] = canvas(64, 64)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const odd = (x + y) % 2
      const grd = odd ? g.createLinearGradient(x * 8, 0, x * 8 + 8, 0) : g.createLinearGradient(0, y * 8, 0, y * 8 + 8)
      grd.addColorStop(0, '#1a1c1f')
      grd.addColorStop(0.5, '#34383d')
      grd.addColorStop(1, '#16181a')
      g.fillStyle = grd
      g.fillRect(x * 8, y * 8, 8, 8)
    }
  }
  carbonTex = tex(c, true, true)
  carbonTex.repeat.set(6, 6)
  return carbonTex
}

const tyreTex = new Map<Compound, THREE.Texture>()
function tyreTexture(cmp: Compound) {
  let t = tyreTex.get(cmp)
  if (t) return t
  const [c, g] = canvas(1024, 128)
  g.fillStyle = '#121212'
  g.fillRect(0, 0, 1024, 128)
  // tread: a faint sheen; sidewalls: the compound's band and lettering
  g.fillStyle = '#1b1b1b'
  g.fillRect(0, 55, 1024, 18)
  const col = COMPOUNDS[cmp].color
  for (const y of [22, 106]) {
    g.fillStyle = col
    g.fillRect(0, y - 3, 1024, 6)
  }
  g.font = 'bold 13px system-ui, sans-serif'
  g.textBaseline = 'middle'
  for (const y of [9, 119]) {
    for (let x = 0; x < 1024; x += 256) {
      g.fillStyle = '#e8e8e8'
      g.fillText('KHERVE', x + 30, y)
      g.fillStyle = col
      g.fillText(COMPOUNDS[cmp].name.toUpperCase(), x + 140, y)
    }
  }
  t = tex(c)
  tyreTex.set(cmp, t)
  return t
}

function liveryTexture(team: Team, idx: number) {
  const [c, g] = canvas(512, 256)
  g.fillStyle = team.color
  g.fillRect(0, 0, 512, 256)
  // a stripe down the top of the nose and over the engine cover (v = 0.5 is the top)
  g.fillStyle = team.color2
  g.fillRect(0, 118, 512, 20)
  // side flashes (v 0.25 right, 0.75 left)
  for (const v of [64, 192]) {
    g.beginPath()
    g.moveTo(150, v + 22)
    g.quadraticCurveTo(300, v - 4, 512, v - 28)
    g.lineTo(512, v - 8)
    g.quadraticCurveTo(300, v + 14, 150, v + 30)
    g.closePath()
    g.fill()
  }
  // a thin accent line
  g.strokeStyle = team.accent
  g.lineWidth = 3
  g.beginPath()
  g.moveTo(0, 116)
  g.lineTo(512, 116)
  g.moveTo(0, 140)
  g.lineTo(512, 140)
  g.stroke()
  // the Kherve team gets its green glow on the lower sides
  if (idx === 0) {
    const grd = g.createLinearGradient(0, 0, 0, 256)
    grd.addColorStop(0, 'rgba(34,197,94,0.55)')
    grd.addColorStop(0.12, 'rgba(34,197,94,0)')
    grd.addColorStop(0.88, 'rgba(34,197,94,0)')
    grd.addColorStop(1, 'rgba(34,197,94,0.55)')
    g.fillStyle = grd
    g.fillRect(0, 0, 512, 256)
  }
  return tex(c)
}

function numberTexture(num: number, team: Team) {
  const [c, g] = canvas(256, 128)
  g.font = 'italic 900 96px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 10
  g.strokeStyle = team.color
  g.strokeText(String(num), 128, 68)
  g.fillStyle = team.accent
  g.fillText(String(num), 128, 68)
  return tex(c)
}

function nameTexture(text: string, team: Team) {
  const [c, g] = canvas(512, 128)
  g.fillStyle = team.color2
  g.fillRect(0, 0, 512, 128)
  g.font = '900 64px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = team.color
  g.fillText(text, 256, 68)
  return tex(c)
}

function coverTexture(team: Team) {
  const [c, g] = canvas(128, 128)
  g.fillStyle = '#16181b'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = team.color2
  g.lineWidth = 9
  g.beginPath()
  g.arc(64, 64, 52, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#2a2d31'
  g.beginPath()
  g.arc(64, 64, 12, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = team.accent
  g.font = 'bold 13px system-ui'
  g.textAlign = 'center'
  g.fillText('KHERVE', 64, 35)
  return tex(c)
}

export interface TeamLook {
  paint: THREE.MeshPhysicalMaterial
  paint2: THREE.MeshPhysicalMaterial
  helmet: THREE.MeshPhysicalMaterial
  cover: THREE.MeshStandardMaterial
  name: THREE.MeshStandardMaterial
}

export interface Shared {
  carbon: THREE.MeshStandardMaterial
  black: THREE.MeshStandardMaterial
  metal: THREE.MeshStandardMaterial
  halo: THREE.MeshStandardMaterial
  visor: THREE.MeshPhysicalMaterial
  light: THREE.MeshStandardMaterial
  tcamBlack: THREE.MeshStandardMaterial
  tcamYellow: THREE.MeshStandardMaterial
  rim: THREE.MeshStandardMaterial
  tyre: Record<Compound, THREE.MeshStandardMaterial>
}

export function sharedMaterials(): Shared {
  const tyre = {} as Record<Compound, THREE.MeshStandardMaterial>
  for (const k of Object.keys(COMPOUNDS) as Compound[]) tyre[k] = new THREE.MeshStandardMaterial({ map: tyreTexture(k), roughness: 0.82, metalness: 0 })
  return {
    carbon: new THREE.MeshStandardMaterial({ map: carbonTexture(), roughness: 0.38, metalness: 0.25, color: 0xffffff }),
    black: new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.25, metalness: 0.9 }),
    halo: new THREE.MeshStandardMaterial({ color: 0x16181b, roughness: 0.35, metalness: 0.4 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x0b0e16, roughness: 0.05, metalness: 0.6, clearcoat: 1 }),
    light: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1a1a, emissiveIntensity: 0.4 }),
    tcamBlack: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }),
    tcamYellow: new THREE.MeshStandardMaterial({ color: 0xffe600, roughness: 0.5, emissive: 0x332e00 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.35, metalness: 0.8 }),
    tyre,
  }
}

export function teamLook(team: Team, idx: number): TeamLook {
  return {
    paint: new THREE.MeshPhysicalMaterial({ map: liveryTexture(team, idx), roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 }),
    paint2: new THREE.MeshPhysicalMaterial({ color: team.color2, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: team.color2, roughness: 0.25, clearcoat: 1 }),
    cover: new THREE.MeshStandardMaterial({ map: coverTexture(team), roughness: 0.4, metalness: 0.5 }),
    name: new THREE.MeshStandardMaterial({ map: nameTexture(team.name.split(' ')[0].toUpperCase(), team), roughness: 0.4 }),
  }
}

// ---------------------------------------------------------------- one car

export interface CarModel {
  root: THREE.Group
  /** The body (rolls and pitches) inside the root. */
  body: THREE.Group
  wheels: { pivot: THREE.Group; spin: THREE.Group; tyre: THREE.Mesh; front: boolean; base: THREE.Vector3 }[]
  flap: THREE.Mesh
  light: THREE.MeshStandardMaterial
  setCompound(c: Compound): void
  /** Show what is broken: wings that droop, hang crooked or are gone, a wheel bent by the suspension. */
  setDamage(d: Damage): void
  /** The cockpit camera is in this car: hide what it draws itself (the wheel, the driver). */
  setCockpit?(on: boolean): void
  dispose(): void
}

/** Shared by both kinds of car: a part sags with damage, and at 0.75 it has come off. */
export function showDamage(piece: THREE.Object3D | null, amount: number, sag: number, tilt: number, side: number) {
  if (!piece) return
  piece.visible = amount < 0.75
  const a = amount < 0.25 ? 0 : amount
  piece.rotation.set(tilt * a * side, 0, -sag * a)
}

/** A bent wheel: camber on the damaged side. */
export function bendWheels(wheels: CarModel['wheels'], d: Damage) {
  for (const w of wheels) {
    const onSide = Math.sign(w.base.z) === Math.sign(d.side)
    w.pivot.rotation.x = onSide ? d.side * 0.22 * d.susp : 0
  }
}

export function buildCar(geo: CarGeometry, look: TeamLook, sh: Shared, team: Team, num: number, yellowCam: boolean): CarModel {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const mats: Record<Part, THREE.Material> = {
    paint: look.paint, paint2: look.paint2, carbon: sh.carbon, black: sh.black, metal: sh.metal, halo: sh.halo,
    helmet: look.helmet, visor: sh.visor, light: sh.light.clone(), tcam: yellowCam ? sh.tcamYellow : sh.tcamBlack,
  }
  const light = mats.light as THREE.MeshStandardMaterial
  for (const [k, g] of geo.parts) {
    const m = new THREE.Mesh(g, mats[k])
    m.castShadow = k !== 'visor' && k !== 'light'
    m.receiveShadow = k === 'paint' || k === 'carbon'
    body.add(m)
  }
  // the wings hang from pivots (where they meet the nose and the crash structure), so they can droop
  const wingGroup = (map: Map<Part, THREE.BufferGeometry>, px: number, py: number) => {
    const g = new THREE.Group()
    g.position.set(px, py, 0)
    for (const [k, geom] of map) {
      const m = new THREE.Mesh(geom, mats[k])
      m.position.set(-px, -py, 0)
      m.castShadow = true
      g.add(m)
    }
    body.add(g)
    return g
  }
  const frontWing = wingGroup(geo.frontWing, 2.85, 0.18)
  const rearWing = wingGroup(geo.rearWing, -2.25, 0.45)
  // numbers: on the nose, on the fin
  const numTex = numberTexture(num, team)
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  const nose = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.11), numMat)
  nose.geometry.rotateX(-Math.PI / 2)
  nose.geometry.rotateY(Math.PI / 2)
  nose.geometry.rotateZ(-0.24)
  nose.position.set(2.52, 0.415, 0)
  body.add(nose)
  for (const sd of [1, -1]) {
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), numMat)
    if (sd < 0) fin.geometry.rotateY(Math.PI)
    fin.position.set(-1.15, 0.73, 0.008 * sd)
    body.add(fin)
    const nm = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.13), look.name)
    if (sd < 0) nm.geometry.rotateY(Math.PI)
    nm.position.set(-2.31, 0.86, 0.532 * sd)
    body.add(nm)
  }
  // sponsors: the Kherve apps on the sidepods and the engine cover
  const sponsor = (text: string, w: number, h: number) => {
    const [c, g] = canvas(512, 96)
    g.font = '900 italic 64px system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillStyle = team.accent
    g.fillText(text, 256, 52)
    const t = tex(c)
    const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    decals.push(t, m)
    return { m, w, h }
  }
  const decals: { dispose(): void }[] = []
  const pod = sponsor('KherveOS', 0.62, 0.12)
  const cover = sponsor('free software', 0.44, 0.08)
  for (const sd of [1, -1]) {
    for (const [d, x, y, z] of [[pod, 0.35, 0.3, 0.797], [cover, -0.85, 0.42, 0.268]] as [typeof pod, number, number, number][]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.h), d.m)
      if (sd < 0) pl.geometry.rotateY(Math.PI)
      pl.position.set(x, y, z * sd)
      body.add(pl)
    }
  }
  const flap = new THREE.Mesh(geo.drsFlap, look.paint2)
  flap.position.set(-2.42 + 2.25, 0.935 - 0.45, 0)
  flap.rotation.z = 0.5
  flap.castShadow = true
  rearWing.add(flap)

  const wheels: CarModel['wheels'] = []
  for (const w of WHEELS) {
    const pivot = new THREE.Group()
    pivot.position.set(w.x, R, w.z)
    const spin = new THREE.Group()
    pivot.add(spin)
    const tyre = new THREE.Mesh(w.front ? geo.tyreF : geo.tyreR, sh.tyre.medium)
    tyre.castShadow = true
    spin.add(tyre)
    const rim = new THREE.Mesh(geo.rim, sh.rim)
    rim.scale.z = w.w / 0.3
    spin.add(rim)
    const cover = new THREE.Mesh(geo.cover, look.cover)
    cover.position.z = (w.w / 2 - 0.005) * Math.sign(w.z)
    if (w.z < 0) cover.rotation.y = Math.PI
    spin.add(cover)
    root.add(pivot)
    wheels.push({ pivot, spin, tyre, front: w.front, base: pivot.position.clone() })
  }
  return {
    root, body, wheels, flap, light,
    setCompound(c) {
      for (const w of wheels) w.tyre.material = sh.tyre[c]
    },
    setDamage(d) {
      showDamage(frontWing, d.fw, 0.28, 0.35, d.side)
      showDamage(rearWing, d.rw, -0.2, 0.3, d.side)
      bendWheels(wheels, d)
    },
    dispose() {
      numTex.dispose()
      numMat.dispose()
      for (const d of decals) d.dispose()
      nose.geometry.dispose()
      light.dispose()
      body.traverse((o) => {
        if (o instanceof THREE.Mesh && o.geometry !== geo.drsFlap && ![...geo.parts.values(), ...geo.frontWing.values(), ...geo.rearWing.values()].includes(o.geometry)) o.geometry.dispose()
      })
    },
  }
}

// ---------------------------------------------------------------- the transporter trucks

function truckLivery(team: Team, w: number, h: number) {
  const [c, g] = canvas(w, h)
  const grd = g.createLinearGradient(0, 0, 0, h)
  grd.addColorStop(0, '#16201a')
  grd.addColorStop(1, team.color)
  g.fillStyle = grd
  g.fillRect(0, 0, w, h)
  // sweeping green bands
  g.fillStyle = team.color2
  g.beginPath()
  g.moveTo(0, h * 0.78)
  g.bezierCurveTo(w * 0.35, h * 0.7, w * 0.6, h * 0.95, w, h * 0.62)
  g.lineTo(w, h * 0.7)
  g.bezierCurveTo(w * 0.6, h * 1.03, w * 0.35, h * 0.8, 0, h * 0.86)
  g.closePath()
  g.fill()
  g.globalAlpha = 0.35
  g.fillRect(0, h * 0.12, w, h * 0.012)
  g.globalAlpha = 1
  // the ringed K
  const cx = w * 0.16
  const cy = h * 0.42
  g.strokeStyle = team.color2
  g.lineWidth = h * 0.035
  g.beginPath()
  g.arc(cx, cy, h * 0.24, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#eafff1'
  g.font = `900 ${Math.round(h * 0.34)}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('K', cx, cy + h * 0.02)
  g.textAlign = 'left'
  g.font = `900 ${Math.round(h * 0.2)}px system-ui, sans-serif`
  g.fillText(team.name.toUpperCase(), w * 0.3, h * 0.36)
  g.fillStyle = team.color2
  g.font = `600 ${Math.round(h * 0.085)}px system-ui, sans-serif`
  g.fillText('KherveOS · an OS for the people · free and open source', w * 0.3, h * 0.55)
  return tex(c)
}

export function buildTruck(team: Team): THREE.Group {
  const root = new THREE.Group()
  const paint = new THREE.MeshPhysicalMaterial({ color: team.color, roughness: 0.3, metalness: 0.4, clearcoat: 1 })
  const accent = new THREE.MeshPhysicalMaterial({ color: team.color2, roughness: 0.3, metalness: 0.3, clearcoat: 1 })
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0d1418, roughness: 0.05, metalness: 0.5, clearcoat: 1 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.15, metalness: 1 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 })
  const tyreM = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 0.6 })
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 0.5 })
  const livery = truckLivery(team, 1024, 256)
  const side = new THREE.MeshPhysicalMaterial({ map: livery, roughness: 0.35, clearcoat: 0.8 })
  const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
    const mesh = new THREE.Mesh(g, m)
    mesh.castShadow = cast
    mesh.receiveShadow = true
    root.add(mesh)
    return mesh
  }
  // the cab: a side profile extruded across, with rounded edges
  const prof = new THREE.Shape()
  prof.moveTo(0, 0)
  prof.lineTo(2.25, 0)
  prof.lineTo(2.32, 1.05)
  prof.lineTo(2.12, 2.45)
  prof.lineTo(1.9, 2.75)
  prof.lineTo(0.05, 2.75)
  prof.closePath()
  const cab = new THREE.ExtrudeGeometry(prof, { depth: 2.3, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 3 })
  cab.translate(0, 0, -1.15)
  cab.translate(13.4, 1.1, 0)
  add(cab, paint)
  // windscreen and side windows
  const ws = new THREE.PlaneGeometry(2.1, 1.25)
  ws.rotateY(Math.PI / 2)
  ws.rotateZ(0.14)
  ws.translate(15.71, 2.95, 0)
  add(ws, glass, false)
  for (const sd of [1, -1]) {
    const sw = new THREE.PlaneGeometry(0.9, 0.85)
    if (sd < 0) sw.rotateY(Math.PI)
    sw.translate(15.1, 3.05, 1.235 * sd)
    add(sw, glass, false)
    // mirrors
    add(rod(v3(15.55, 3.2, 1.2 * sd), v3(15.75, 3.4, 1.45 * sd), 0.025), chrome)
    add(box(0.12, 0.55, 0.22, 15.75, 3.15, 1.47 * sd), paint)
    // steps and fuel tank
    add(box(0.6, 0.06, 0.3, 14.9, 0.7, 1.2 * sd), chrome)
    add(new THREE.CylinderGeometry(0.32, 0.32, 1.2, 18).rotateZ(Math.PI / 2).translate(13.6, 0.85, 1.05 * sd), chrome)
    // the accent swoosh on the cab doors
    add(box(1.6, 0.18, 0.02, 14.4, 2.1, 1.24 * sd, 0, 0, 0.18), accent, false)
  }
  // grille, bumper, lights, sun visor, roof fairing
  add(box(0.05, 0.85, 1.6, 15.83, 1.7, 0), dark)
  for (let k = 0; k < 5; k++) add(box(0.06, 0.04, 1.55, 15.86, 1.37 + k * 0.17, 0), chrome)
  add(box(0.3, 0.45, 2.45, 15.7, 0.85, 0), dark)
  for (const sd of [1, -1]) add(box(0.06, 0.16, 0.42, 15.87, 1.2, 0.9 * sd), lamp)
  add(box(0.5, 0.06, 2.3, 15.6, 3.88, 0, 0, 0, -0.2), dark)
  const fair = new THREE.Shape()
  fair.moveTo(0, 0)
  fair.lineTo(1.9, 0)
  fair.lineTo(0.4, 0.95)
  fair.lineTo(0, 0.95)
  fair.closePath()
  const fg = new THREE.ExtrudeGeometry(fair, { depth: 2.2, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 })
  fg.translate(13.5, 3.86, -1.1)
  add(fg, paint)
  // roof light bar, wheel arches, a chrome strip
  add(box(0.25, 0.14, 1.9, 15.35, 3.98, 0), dark)
  for (let k = 0; k < 6; k++) add(box(0.05, 0.1, 0.18, 15.48, 3.98, -0.8 + k * 0.32), lamp)
  for (const sd of [1, -1]) {
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.4, 20, 1, true, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(0).translate(15.0, 0.55, 1.12 * sd), dark)
    add(box(2.2, 0.06, 0.02, 14.5, 1.32, 1.245 * sd), chrome, false)
  }
  // chassis
  add(box(6.5, 0.35, 1.0, 12.6, 0.75, 0), dark)
  // the trailer: a box with the livery on its sides, skirts, doors, lights, legs
  const L = 13.6
  const trailer = new THREE.ExtrudeGeometry(
    (() => {
      const s = new THREE.Shape()
      s.moveTo(0, 0)
      s.lineTo(L, 0)
      s.lineTo(L, 2.85)
      s.lineTo(0, 2.85)
      s.closePath()
      return s
    })(),
    { depth: 2.45, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 },
  )
  trailer.translate(-0.4, 1.25, -1.225)
  add(trailer, paint)
  for (const sd of [1, -1]) {
    const pl = new THREE.PlaneGeometry(L, 2.85)
    if (sd < 0) pl.rotateY(Math.PI)
    pl.translate(L / 2 - 0.4, 1.25 + 1.425, (1.225 + 0.051) * sd)
    add(pl, side, false)
    add(box(8.2, 0.55, 0.04, 6.5, 0.95, 1.2 * sd), accent)
    add(box(0.06, 0.7, 0.06, 7.2, 0.6, 0.9 * sd), dark)
  }
  add(box(0.04, 2.6, 2.3, -0.47, 2.65, 0), dark)
  for (const sd of [1, -1]) add(box(0.05, 0.22, 0.35, -0.5, 1.45, 0.95 * sd), tail)
  add(box(0.3, 0.15, 2.4, -0.3, 1.0, 0), dark)
  // wheels: cab (front, two at the back), trailer (three axles)
  const tyreG = new THREE.CylinderGeometry(0.52, 0.52, 0.34, 26).rotateX(Math.PI / 2)
  const hubG = new THREE.CylinderGeometry(0.3, 0.3, 0.36, 18).rotateX(Math.PI / 2)
  const axles = [15.0, 11.6, 10.3, 2.8, 1.5, 0.2]
  for (const x of axles) {
    for (const sd of [1, -1]) {
      const zz = (x > 14 ? 1.05 : 1.0) * sd
      add(tyreG.clone().translate(x, 0.52, zz), tyreM)
      add(hubG.clone().translate(x, 0.52, zz + 0.01 * sd), chrome, false)
    }
  }
  tyreG.dispose()
  hubG.dispose()
  return root
}

// ---------------------------------------------------------------- pit crew

export function crewGeometry(): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const body = merge([
    new THREE.CapsuleGeometry(0.2, 0.75, 4, 10).translate(0, 0.78, 0),
    new THREE.CapsuleGeometry(0.075, 0.55, 3, 6).rotateZ(0.5).translate(0.22, 1.0, 0.18),
    new THREE.CapsuleGeometry(0.075, 0.55, 3, 6).rotateZ(0.5).translate(0.22, 1.0, -0.18),
  ])
  const head = new THREE.SphereGeometry(0.15, 12, 10).translate(0, 1.5, 0)
  return { body, head }
}
