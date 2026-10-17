// Kherve Grand Prix: the classic coupés of the Classics series, built from
// code like the single-seaters (f1Models.ts): a lofted body, wheel arches
// that bulge over the tyres, a tinted glasshouse with the driver inside,
// chrome bumpers, round headlamps, racing roundels with the number, a
// period livery and period wheels. Three fictional makes, shaped after the
// late-1960s / early-70s sports cars: the Stoccarda 901 RS (a rear-engined
// fastback with frog-eye lamps and a ducktail), the Dieppe A110 (a tiny
// low berlinette, four round lamps) and the Bavaria 30 CS (a big touring
// coupé with a shark nose, box flares and a tall rear wing). No makers'
// names or badges.

import * as THREE from 'three'
import { loft, merge, type CarModel, type Shared } from './f1Models.ts'
import type { ClassicModel, Team } from './f1Race.ts'
import type { Compound } from './f1Physics.ts'

type Sec = { x: number; hw: number; yb: number; yt: number; p: number; zc?: number }
type Part = 'paint' | 'plain' | 'stripe' | 'glass' | 'chrome' | 'black' | 'lamp' | 'tail' | 'helmet' | 'interior'

interface Shape {
  /** Axles (x), track half-widths, tyre radius and widths. */
  front: number
  rear: number
  trackF: number
  trackR: number
  r: number
  wF: number
  wR: number
  /** Where the driver's eyes are (cockpit camera) and the roof (T-cam). */
  eye: [number, number, number]
  roof: [number, number, number]
  build(add: (k: Part, g: THREE.BufferGeometry) => void): void
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  return new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z)
}

/** A round lamp facing forward (tilted up by `tilt`), its chrome ring. */
function lamp(add: (k: Part, g: THREE.BufferGeometry) => void, x: number, y: number, z: number, r: number, tilt = 0) {
  add('lamp', new THREE.CircleGeometry(r, 18).rotateY(Math.PI / 2).rotateZ(tilt).translate(x, y, z))
  add('chrome', new THREE.TorusGeometry(r, r * 0.16, 6, 18).rotateY(Math.PI / 2).rotateZ(tilt).translate(x - 0.005, y, z))
}

/** The glasshouse: tinted glass, a painted roof over it, a dark cabin inside, the driver. */
function cabin(add: (k: Part, g: THREE.BufferGeometry) => void, secs: Sec[], roofFrom: number, roofTo: number, driverX: number, driverY: number) {
  add('glass', loft(secs, 24, 5))
  const roof = secs.filter((s) => s.x <= roofFrom + 0.01 && s.x >= roofTo - 0.01).map((s) => ({ ...s, hw: s.hw + 0.006, yb: s.yt - 0.07, yt: s.yt + 0.006 }))
  if (roof.length >= 2) add('paint', loft(roof, 24, 4))
  const inner = secs.map((s) => ({ ...s, hw: s.hw * 0.9, yt: s.yb + (s.yt - s.yb) * 0.35 }))
  add('interior', loft(inner, 16, 3))
  add('helmet', new THREE.SphereGeometry(0.13, 16, 12).translate(driverX, driverY, -0.3))
}

const SHAPES: Record<ClassicModel, Shape> = {
  stoccarda: {
    front: 1.08, rear: -1.2, trackF: 0.69, trackR: 0.71, r: 0.31, wF: 0.2, wR: 0.25,
    eye: [-0.28, 1.04, -0.3], roof: [-0.25, 1.36, 0],
    build(add) {
      add('paint', loft([
        { x: 2.05, hw: 0.48, yb: 0.24, yt: 0.44, p: 2.4 },
        { x: 1.85, hw: 0.64, yb: 0.21, yt: 0.56, p: 3 },
        { x: 1.1, hw: 0.73, yb: 0.2, yt: 0.64, p: 3.6 },
        { x: 0.1, hw: 0.76, yb: 0.2, yt: 0.69, p: 3.8 },
        { x: -1.0, hw: 0.77, yb: 0.21, yt: 0.71, p: 3.6 },
        { x: -1.8, hw: 0.71, yb: 0.23, yt: 0.67, p: 3 },
        { x: -2.12, hw: 0.56, yb: 0.27, yt: 0.6, p: 2.6 },
      ], 32, 5))
      for (const sd of [1, -1]) {
        // the front wings with the frog-eye lamps on top, the wide rear hips
        add('plain', loft([
          { x: 1.98, hw: 0.08, yb: 0.42, yt: 0.62, p: 2.2, zc: 0.48 * sd },
          { x: 1.75, hw: 0.17, yb: 0.36, yt: 0.73, p: 2.4, zc: 0.53 * sd },
          { x: 1.1, hw: 0.2, yb: 0.34, yt: 0.77, p: 2.6, zc: 0.56 * sd },
          { x: 0.5, hw: 0.17, yb: 0.36, yt: 0.72, p: 2.4, zc: 0.56 * sd },
          { x: 0.15, hw: 0.06, yb: 0.42, yt: 0.66, p: 2.2, zc: 0.59 * sd },
        ], 20, 5))
        add('plain', loft([
          { x: -0.3, hw: 0.06, yb: 0.42, yt: 0.7, p: 2.2, zc: 0.6 * sd },
          { x: -0.75, hw: 0.2, yb: 0.34, yt: 0.78, p: 2.6, zc: 0.6 * sd },
          { x: -1.25, hw: 0.24, yb: 0.32, yt: 0.8, p: 2.8, zc: 0.59 * sd },
          { x: -1.75, hw: 0.2, yb: 0.34, yt: 0.75, p: 2.6, zc: 0.59 * sd },
          { x: -2.08, hw: 0.08, yb: 0.4, yt: 0.66, p: 2.2, zc: 0.53 * sd },
        ], 20, 5))
        lamp(add, 1.86, 0.63, 0.53 * sd, 0.085, 0.35)
        add('lamp', box(0.04, 0.05, 0.12, 2.02, 0.36, 0.42 * sd))
        add('tail', box(0.03, 0.07, 0.42, -2.13, 0.54, 0.38 * sd))
        // door mirror, door handle line
        add('chrome', box(0.1, 0.06, 0.09, 0.42, 0.8, 0.78 * sd))
        add('chrome', new THREE.CylinderGeometry(0.012, 0.012, 0.14, 5).rotateX(Math.PI / 2).translate(0.46, 0.77, 0.72 * sd))
      }
      // bumpers, ducktail, engine-lid grille
      add('chrome', box(0.07, 0.06, 1.05, 2.06, 0.3, 0))
      add('chrome', box(0.08, 0.06, 1.3, -2.18, 0.34, 0))
      add('paint', (() => {
        const s = new THREE.Shape()
        s.moveTo(-1.6, 0.74)
        s.lineTo(-2.14, 0.66)
        s.lineTo(-2.2, 0.76)
        s.lineTo(-1.9, 0.79)
        s.closePath()
        return new THREE.ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: false }).translate(0, 0, -0.6)
      })())
      for (let k = 0; k < 6; k++) add('black', box(0.25, 0.012, 0.05, -1.95, 0.775, -0.25 + k * 0.1, 0, 0, 0.1))
      cabin(add, [
        { x: 0.62, hw: 0.56, yb: 0.66, yt: 0.72, p: 2.4 },
        { x: 0.25, hw: 0.54, yb: 0.66, yt: 1.17, p: 2.8 },
        { x: -0.2, hw: 0.52, yb: 0.66, yt: 1.29, p: 3 },
        { x: -0.7, hw: 0.5, yb: 0.66, yt: 1.24, p: 3 },
        { x: -1.3, hw: 0.49, yb: 0.66, yt: 0.99, p: 2.8 },
        { x: -1.92, hw: 0.46, yb: 0.66, yt: 0.75, p: 2.4 },
      ], 0.25, -0.75, -0.25, 0.98)
    },
  },
  dieppe: {
    front: 1.02, rear: -1.08, trackF: 0.64, trackR: 0.65, r: 0.29, wF: 0.18, wR: 0.21,
    eye: [-0.3, 0.92, -0.28], roof: [-0.3, 1.2, 0],
    build(add) {
      add('paint', loft([
        { x: 1.98, hw: 0.36, yb: 0.24, yt: 0.4, p: 2.2 },
        { x: 1.8, hw: 0.56, yb: 0.2, yt: 0.52, p: 2.8 },
        { x: 1.0, hw: 0.68, yb: 0.18, yt: 0.6, p: 3.2 },
        { x: 0.0, hw: 0.72, yb: 0.18, yt: 0.62, p: 3.6 },
        { x: -1.0, hw: 0.72, yb: 0.19, yt: 0.64, p: 3.4 },
        { x: -1.65, hw: 0.66, yb: 0.21, yt: 0.62, p: 3 },
        { x: -1.92, hw: 0.56, yb: 0.25, yt: 0.58, p: 2.6 },
      ], 32, 5))
      for (const sd of [1, -1]) {
        add('plain', loft([
          { x: 1.9, hw: 0.08, yb: 0.36, yt: 0.52, p: 2.2, zc: 0.42 * sd },
          { x: 1.6, hw: 0.15, yb: 0.32, yt: 0.64, p: 2.4, zc: 0.49 * sd },
          { x: 1.02, hw: 0.17, yb: 0.3, yt: 0.67, p: 2.6, zc: 0.53 * sd },
          { x: 0.45, hw: 0.14, yb: 0.32, yt: 0.62, p: 2.4, zc: 0.54 * sd },
          { x: 0.15, hw: 0.05, yb: 0.38, yt: 0.58, p: 2.2, zc: 0.55 * sd },
        ], 18, 5))
        add('plain', loft([
          { x: -0.45, hw: 0.05, yb: 0.38, yt: 0.62, p: 2.2, zc: 0.57 * sd },
          { x: -0.75, hw: 0.15, yb: 0.32, yt: 0.68, p: 2.4, zc: 0.56 * sd },
          { x: -1.1, hw: 0.18, yb: 0.3, yt: 0.7, p: 2.6, zc: 0.55 * sd },
          { x: -1.55, hw: 0.14, yb: 0.32, yt: 0.66, p: 2.4, zc: 0.52 * sd },
          { x: -1.86, hw: 0.06, yb: 0.38, yt: 0.6, p: 2.2, zc: 0.46 * sd },
        ], 18, 5))
        // four round lamps: in the wings and down in the nose
        lamp(add, 1.76, 0.55, 0.47 * sd, 0.075, 0.25)
        lamp(add, 1.95, 0.4, 0.24 * sd, 0.06, 0.1)
        add('tail', new THREE.CircleGeometry(0.05, 12).rotateY(-Math.PI / 2).translate(-1.93, 0.5, 0.42 * sd))
        add('tail', new THREE.CircleGeometry(0.04, 12).rotateY(-Math.PI / 2).translate(-1.93, 0.5, 0.3 * sd))
        add('chrome', box(0.08, 0.05, 0.08, 0.35, 0.72, 0.73 * sd))
      }
      add('chrome', box(0.06, 0.05, 0.5, 2.0, 0.27, 0.42))
      add('chrome', box(0.06, 0.05, 0.5, 2.0, 0.27, -0.42))
      add('chrome', box(0.06, 0.05, 1.1, -1.96, 0.3, 0))
      // the louvred rear window frame and a fuel filler on the nose
      add('chrome', new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12).translate(1.45, 0.58, 0.2))
      cabin(add, [
        { x: 0.48, hw: 0.53, yb: 0.6, yt: 0.66, p: 2.4 },
        { x: 0.15, hw: 0.51, yb: 0.6, yt: 1.04, p: 2.8 },
        { x: -0.3, hw: 0.49, yb: 0.6, yt: 1.13, p: 3 },
        { x: -0.75, hw: 0.48, yb: 0.6, yt: 1.08, p: 3 },
        { x: -1.25, hw: 0.47, yb: 0.6, yt: 0.86, p: 2.8 },
        { x: -1.72, hw: 0.45, yb: 0.6, yt: 0.66, p: 2.4 },
      ], 0.15, -0.75, -0.3, 0.86)
    },
  },
  bavaria: {
    front: 1.3, rear: -1.33, trackF: 0.72, trackR: 0.74, r: 0.31, wF: 0.22, wR: 0.27,
    eye: [-0.12, 1.08, -0.32], roof: [-0.25, 1.42, 0],
    build(add) {
      add('paint', loft([
        { x: 2.32, hw: 0.7, yb: 0.36, yt: 0.66, p: 4.5 },
        { x: 2.22, hw: 0.77, yb: 0.2, yt: 0.7, p: 4.5 },
        { x: 1.3, hw: 0.8, yb: 0.19, yt: 0.74, p: 4.8 },
        { x: 0.0, hw: 0.82, yb: 0.19, yt: 0.78, p: 5 },
        { x: -1.3, hw: 0.82, yb: 0.2, yt: 0.8, p: 5 },
        { x: -2.1, hw: 0.78, yb: 0.24, yt: 0.8, p: 4.5 },
        { x: -2.3, hw: 0.72, yb: 0.3, yt: 0.76, p: 4 },
      ], 32, 5))
      for (const sd of [1, -1]) {
        // bolted-on box flares over all four wheels
        for (const [x0, x1, z] of [[1.75, 0.82, 0.8], [-0.85, -1.82, 0.82]] as [number, number, number][]) {
          add('plain', loft([
            { x: x0, hw: 0.04, yb: 0.3, yt: 0.62, p: 3, zc: z * sd },
            { x: x0 - 0.12, hw: 0.11, yb: 0.26, yt: 0.66, p: 4, zc: (z + 0.03) * sd },
            { x: x1 + 0.12, hw: 0.11, yb: 0.26, yt: 0.66, p: 4, zc: (z + 0.03) * sd },
            { x: x1, hw: 0.04, yb: 0.3, yt: 0.62, p: 3, zc: z * sd },
          ], 16, 3))
        }
        // twin round lamps each side of a wide grille, under the shark nose
        lamp(add, 2.3, 0.53, 0.58 * sd, 0.07)
        lamp(add, 2.3, 0.53, 0.4 * sd, 0.06)
        add('tail', box(0.03, 0.14, 0.34, -2.31, 0.62, 0.5 * sd))
        add('chrome', box(0.12, 0.07, 0.1, 0.5, 0.86, 0.84 * sd))
        // the rear wing's uprights
        add('black', box(0.12, 0.26, 0.03, -2.12, 0.92, 0.55 * sd))
      }
      add('black', box(0.03, 0.16, 0.42, 2.33, 0.53, 0))
      add('black', box(0.25, 0.08, 1.56, 2.28, 0.18, 0))
      add('chrome', box(0.06, 0.05, 1.6, -2.34, 0.4, 0))
      add('stripe', box(0.42, 0.03, 1.5, -2.16, 1.06, 0, 0, 0, -0.08))
      add('black', box(0.5, 0.03, 0.08, 1.2, 0.8, 0.45, 0, 0, 0.1))
      cabin(add, [
        { x: 0.75, hw: 0.68, yb: 0.76, yt: 0.82, p: 3 },
        { x: 0.35, hw: 0.66, yb: 0.76, yt: 1.27, p: 3.6 },
        { x: -0.1, hw: 0.64, yb: 0.76, yt: 1.36, p: 4 },
        { x: -0.9, hw: 0.63, yb: 0.76, yt: 1.34, p: 4 },
        { x: -1.35, hw: 0.62, yb: 0.76, yt: 1.12, p: 3.6 },
        { x: -1.6, hw: 0.6, yb: 0.76, yt: 0.84, p: 3 },
      ], 0.35, -0.95, -0.12, 1.03)
    },
  },
}

/** Where a classic's cameras sit (in the car's own frame). */
export function classicCams(model: ClassicModel): { eye: THREE.Vector3; roof: THREE.Vector3 } {
  const s = SHAPES[model]
  return { eye: v3(...s.eye), roof: v3(...s.roof) }
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
    const cols = [team.color2, team.accent, '#6b2bd9']
    cols.forEach((col, k) => {
      g.fillStyle = col
      for (const v of [64, 192]) g.fillRect(40, v - 34 + k * 7 + (v > 128 ? 54 : 0), 472, 5)
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
  const rim = r * 0.62
  const pts = [[rim, -h], [r * 0.85, -h - 0.004], [r * 0.97, -h + 0.02], [r, -h + 0.04], [r, h - 0.04], [r * 0.97, h - 0.02], [r * 0.85, h + 0.004], [rim, h]].map(([a, b]) => new THREE.Vector2(a, b))
  return new THREE.LatheGeometry(pts, 40).rotateX(Math.PI / 2)
}

export function buildClassic(model: ClassicModel, team: Team, num: number, sh: Shared): CarModel {
  const S = SHAPES[model]
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const parts = new Map<Part, THREE.BufferGeometry[]>()
  S.build((k, g) => {
    let l = parts.get(k)
    if (!l) parts.set(k, (l = []))
    l.push(g)
  })
  const livery = classicLivery(team, model)
  const light = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 0.4 })
  const mats: Record<Part, THREE.Material> = {
    paint: new THREE.MeshPhysicalMaterial({ map: livery, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
    plain: new THREE.MeshPhysicalMaterial({ color: team.color, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.05 }),
    stripe: new THREE.MeshPhysicalMaterial({ color: team.color2, roughness: 0.3, clearcoat: 1 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x101820, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.62, depthWrite: false, clearcoat: 1 }),
    chrome: sh.metal,
    black: sh.black,
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1cc, emissiveIntensity: 0.35, roughness: 0.1 }),
    tail: light,
    helmet: new THREE.MeshPhysicalMaterial({ color: team.color2, roughness: 0.25, clearcoat: 1 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.9 }),
  }
  const owned: (THREE.Material | THREE.Texture | THREE.BufferGeometry)[] = [livery, mats.paint, mats.plain, mats.stripe, mats.glass, mats.lamp, light, mats.helmet, mats.interior]
  for (const [k, list] of parts) {
    const g = merge(list)
    owned.push(g)
    const m = new THREE.Mesh(g, mats[k])
    m.castShadow = k !== 'glass' && k !== 'lamp'
    m.receiveShadow = k === 'paint'
    if (k === 'glass') m.renderOrder = 2
    body.add(m)
  }
  // racing roundels on the doors and the bonnet
  const rt = roundelTexture(num)
  const rm = new THREE.MeshStandardMaterial({ map: rt, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false })
  const rg = new THREE.CircleGeometry(0.2, 24)
  owned.push(rt, rm, rg)
  const halfW = model === 'bavaria' ? 0.825 : model === 'dieppe' ? 0.725 : 0.775
  for (const sd of [1, -1]) {
    const d = new THREE.Mesh(rg, rm)
    d.position.set(-0.15, model === 'bavaria' ? 0.52 : 0.46, (halfW + 0.012) * sd)
    if (sd < 0) d.rotation.y = Math.PI
    body.add(d)
  }
  const hood = new THREE.Mesh(rg, rm)
  hood.rotation.x = -Math.PI / 2
  hood.rotation.z = Math.PI / 2
  hood.position.set(model === 'bavaria' ? 1.65 : 1.45, model === 'bavaria' ? 0.755 : model === 'dieppe' ? 0.615 : 0.665, 0)
  hood.scale.setScalar(0.8)
  body.add(hood)

  // wheels
  const wt = wheelTexture(model)
  const wm = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.3, metalness: 0.7 })
  const tF = tyreGeometry(S.r, S.wF)
  const tR = tyreGeometry(S.r, S.wR)
  const disc = new THREE.CircleGeometry(S.r * 0.6, 28)
  owned.push(wt, wm, tF, tR, disc)
  const wheels: CarModel['wheels'] = []
  for (const [x, z, front] of [[S.front, S.trackF, true], [S.front, -S.trackF, true], [S.rear, S.trackR, false], [S.rear, -S.trackR, false]] as [number, number, boolean][]) {
    const pivot = new THREE.Group()
    pivot.position.set(x, S.r, z)
    const spin = new THREE.Group()
    pivot.add(spin)
    const tyre = new THREE.Mesh(front ? tF : tR, sh.tyre.medium)
    tyre.castShadow = true
    spin.add(tyre)
    const w = front ? S.wF : S.wR
    for (const side of [1, -1]) {
      const face = new THREE.Mesh(disc, wm)
      face.position.z = (w / 2 - 0.02) * side
      if (side < 0) face.rotation.y = Math.PI
      spin.add(face)
    }
    root.add(pivot)
    wheels.push({ pivot, spin, tyre, front, base: pivot.position.clone() })
  }
  const flap = new THREE.Mesh()
  return {
    root, body, wheels, flap, light,
    setCompound(c: Compound) {
      for (const w of wheels) w.tyre.material = sh.tyre[c]
    },
    dispose() {
      for (const o of owned) o.dispose()
    },
  }
}
