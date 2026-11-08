// Last Train: the road vehicles left in the street above the stations.
// Each car is built from its side profile: the body is that outline (with
// real wheel arches cut out of it) extruded across the car's width with a
// rounded bevel, the glasshouse a narrower extrusion on top with its pillars
// and roof in paint; tyres are turned on a lathe, alloys have spokes; head,
// tail and hazard lights, plates, mirrors, door seams and handles, a dark
// chassis between the wheels. Seven kinds (hatchback, saloon, estate, SUV,
// panel van, black cab, police estate) in four states (parked, abandoned with
// its hazards blinking, smashed, burnt out), and a red double-decker bus.
//
// Everything is in metres; a vehicle's group is centred on its footprint,
// its front towards +x, standing on y = 0. lastTrainCity.ts places them and
// merges their meshes by material.

import * as THREE from 'three'
import { canvas, rng, texture } from './lastTrainWorld'

export type CarKind = 'hatch' | 'saloon' | 'estate' | 'suv' | 'van' | 'cab' | 'police'
export type CarState = 'parked' | 'abandoned' | 'smashed' | 'burnt'

interface Spec {
  L: number
  W: number
  tyre: number
  /** Height of the sills (the underside between the arches). */
  clear: number
  axles: [number, number]
  /** The outline over the top, rear bottom to front bottom (x from the rear). */
  body: [number, number][]
  /** The glasshouse: rear bottom, rear top, front top, front bottom. */
  glass: [[number, number], [number, number], [number, number], [number, number]]
  /** Heights of the head and tail lights. */
  front: number
  rear: number
  doors: 2 | 4
}

const SPECS: Record<Exclude<CarKind, 'police'>, Spec> = {
  hatch: {
    L: 4.05, W: 1.78, tyre: 0.31, clear: 0.17, axles: [0.74, 3.3], front: 0.68, rear: 0.86, doors: 2,
    body: [[0.04, 0.3], [0, 0.62], [0.04, 0.98], [0.22, 1.02], [3.12, 0.95], [3.75, 0.84], [4.02, 0.68], [4.05, 0.42], [3.98, 0.24]],
    glass: [[0.24, 0.99], [0.44, 1.41], [2.3, 1.45], [3.13, 0.94]],
  },
  saloon: {
    L: 4.7, W: 1.82, tyre: 0.32, clear: 0.16, axles: [0.98, 3.78], front: 0.68, rear: 0.84, doors: 4,
    body: [[0.05, 0.3], [0, 0.6], [0.06, 0.9], [0.3, 0.98], [1.0, 1.0], [3.62, 0.95], [4.35, 0.84], [4.67, 0.66], [4.7, 0.42], [4.62, 0.24]],
    glass: [[1.0, 0.99], [1.5, 1.42], [2.95, 1.45], [3.63, 0.94]],
  },
  estate: {
    L: 4.75, W: 1.82, tyre: 0.32, clear: 0.16, axles: [0.95, 3.8], front: 0.68, rear: 0.9, doors: 4,
    body: [[0.04, 0.3], [0, 0.62], [0.05, 1.0], [0.2, 1.04], [3.7, 0.96], [4.38, 0.84], [4.72, 0.66], [4.75, 0.42], [4.66, 0.24]],
    glass: [[0.22, 1.02], [0.3, 1.45], [3.0, 1.48], [3.71, 0.95]],
  },
  suv: {
    L: 4.6, W: 1.9, tyre: 0.37, clear: 0.25, axles: [0.85, 3.65], front: 0.8, rear: 1.0, doors: 4,
    body: [[0.04, 0.4], [0, 0.75], [0.04, 1.12], [0.2, 1.17], [3.6, 1.1], [4.25, 1.0], [4.57, 0.86], [4.6, 0.52], [4.5, 0.34]],
    glass: [[0.22, 1.15], [0.32, 1.72], [3.05, 1.75], [3.61, 1.09]],
  },
  van: {
    L: 5.2, W: 2.0, tyre: 0.34, clear: 0.22, axles: [1.0, 4.25], front: 0.75, rear: 0.9, doors: 2,
    body: [[0.02, 0.36], [0, 2.25], [0.12, 2.33], [3.86, 2.33], [3.86, 1.22], [4.62, 1.2], [5.0, 1.05], [5.18, 0.86], [5.2, 0.46], [5.1, 0.32]],
    glass: [[3.86, 1.21], [3.86, 2.27], [4.12, 2.27], [4.61, 1.2]],
  },
  cab: {
    L: 4.58, W: 1.95, tyre: 0.33, clear: 0.2, axles: [0.95, 3.75], front: 0.72, rear: 0.92, doors: 4,
    body: [[0.05, 0.36], [0, 0.72], [0.08, 1.06], [0.3, 1.11], [3.55, 1.06], [4.2, 0.98], [4.52, 0.8], [4.58, 0.46], [4.5, 0.3]],
    glass: [[0.32, 1.09], [0.45, 1.79], [3.0, 1.82], [3.56, 1.05]],
  },
}

/** The materials every vehicle of a street shares (made by the street, disposed with it). */
export interface VehicleMats {
  glass: THREE.Material
  cracked: THREE.Material
  charred: THREE.Material
  burnt: THREE.Material
  tyre: THREE.Material
  rim: THREE.Material
  rustRim: THREE.Material
  chrome: THREE.Material
  plastic: THREE.Material
  chassis: THREE.Material
  headOn: THREE.Material
  headOff: THREE.Material
  tail: THREE.Material
  /** The amber of the hazard lights and the Belisha beacons: blinks (the street sets its glow). */
  hazard: THREE.MeshStandardMaterial
  /** Police blue: flashes. */
  blue: THREE.MeshStandardMaterial
  taxi: THREE.Material
  plateF: THREE.Material
  plateR: THREE.Material
  livery: THREE.Material
  busRed: THREE.Material
  black: THREE.Material
  blind: THREE.Material
  advert: THREE.Material
}

// ---------------------------------------------------------------- textures (made once, kept)

const cache = new Map<string, THREE.Texture>()
function once<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = cache.get(key) as T | undefined
  if (!t) {
    t = make()
    cache.set(key, t)
  }
  return t
}

function plateTex(rear: boolean): THREE.CanvasTexture {
  return once('plate' + rear, () => {
    const [c, g] = canvas(256, 56)
    g.fillStyle = rear ? '#f2c514' : '#f4f2ea'
    g.fillRect(0, 0, 256, 56)
    g.fillStyle = '#1f3c8c'
    g.fillRect(0, 0, 22, 56)
    g.fillStyle = '#111'
    g.font = 'bold 40px "Arial Narrow", Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(rear ? 'KH19 OSR' : 'KV71 PYD', 140, 30)
    g.strokeStyle = 'rgba(0,0,0,0.5)'
    g.strokeRect(1, 1, 254, 54)
    return texture(c)
  })
}

/** Glass crazed by a blow: a star of cracks and rings. */
function crackTex(): THREE.CanvasTexture {
  return once('crack', () => {
    const [c, g] = canvas(256, 256)
    g.fillStyle = '#0c1116'
    g.fillRect(0, 0, 256, 256)
    const r = rng(77)
    for (let s = 0; s < 3; s++) {
      const cx = 40 + r() * 176
      const cy = 40 + r() * 176
      g.strokeStyle = 'rgba(210,225,235,0.55)'
      g.lineWidth = 1
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r() * 0.3
        g.beginPath()
        g.moveTo(cx, cy)
        let x = cx
        let y = cy
        for (let j = 0; j < 6; j++) {
          x += Math.cos(a + (r() - 0.5) * 0.5) * (8 + r() * 14)
          y += Math.sin(a + (r() - 0.5) * 0.5) * (8 + r() * 14)
          g.lineTo(x, y)
        }
        g.stroke()
      }
      for (let ring = 1; ring < 4; ring++) {
        g.beginPath()
        for (let k = 0; k <= 16; k++) {
          const a = (k / 16) * Math.PI * 2
          const rr = ring * (10 + r() * 6)
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
        }
        g.stroke()
      }
      g.fillStyle = 'rgba(230,240,245,0.35)'
      g.beginPath()
      g.arc(cx, cy, 5, 0, Math.PI * 2)
      g.fill()
    }
    return texture(c)
  })
}

/** Paint burnt off to bare, rusting steel: soot, rust, a little grey primer. */
function burntTex(): THREE.CanvasTexture {
  return once('burnt', () => {
    const [c, g] = canvas(256, 256)
    const r = rng(91)
    g.fillStyle = '#2a1d16'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 260; i++) {
      const x = r() * 256
      const y = r() * 256
      const rad = 4 + r() * 26
      const grad = g.createRadialGradient(x, y, 0, x, y, rad)
      const col = r() < 0.45 ? '120,58,26' : r() < 0.6 ? '90,86,80' : '10,8,6'
      grad.addColorStop(0, `rgba(${col},${0.25 + r() * 0.5})`)
      grad.addColorStop(1, `rgba(${col},0)`)
      g.fillStyle = grad
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
    }
    const t = texture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    return t
  })
}

/** The blue and yellow chequers of a police car. */
function liveryTex(): THREE.CanvasTexture {
  return once('livery', () => {
    const [c, g] = canvas(512, 64)
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 2; y++) {
        g.fillStyle = (x + y) % 2 ? '#1c3fa8' : '#e8e21a'
        g.fillRect(x * 32, y * 32, 32, 32)
      }
    return texture(c)
  })
}

function blindTex(): THREE.CanvasTexture {
  return once('blind', () => {
    const [c, g] = canvas(512, 64)
    g.fillStyle = '#050505'
    g.fillRect(0, 0, 512, 64)
    g.fillStyle = '#ffb31a'
    g.font = 'bold 40px Helvetica, Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('NOT IN SERVICE', 256, 34)
    return texture(c)
  })
}

function advertTex(): THREE.CanvasTexture {
  return once('advert', () => {
    const [c, g] = canvas(1024, 128)
    const grad = g.createLinearGradient(0, 0, 1024, 0)
    grad.addColorStop(0, '#0f2a1c')
    grad.addColorStop(1, '#1b5c3a')
    g.fillStyle = grad
    g.fillRect(0, 0, 1024, 128)
    g.fillStyle = '#2fbf71'
    g.beginPath()
    g.arc(70, 64, 42, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#0f2a1c'
    g.beginPath()
    g.arc(70, 64, 26, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#fff'
    g.font = 'bold 54px Helvetica, Arial, sans-serif'
    g.textBaseline = 'middle'
    g.fillText('KherveOS', 130, 50)
    g.font = '30px Helvetica, Arial, sans-serif'
    g.fillStyle = '#bfe8cf'
    g.fillText('An OS for the people — free, for everyone', 132, 98)
    return texture(c)
  })
}

export function vehicleMats(own: <T extends { dispose(): void }>(x: T) => T): VehicleMats {
  const phys = (o: THREE.MeshPhysicalMaterialParameters) => own(new THREE.MeshPhysicalMaterial(o))
  const std = (o: THREE.MeshStandardMaterialParameters) => own(new THREE.MeshStandardMaterial(o))
  return {
    glass: phys({ color: 0x0b1116, roughness: 0.04, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 }),
    cracked: phys({ map: crackTex(), roughness: 0.15, metalness: 0.3, clearcoat: 0.6 }),
    charred: std({ color: 0x0a0807, roughness: 1 }),
    burnt: std({ map: burntTex(), roughness: 0.95, metalness: 0.35 }),
    tyre: std({ color: 0x141414, roughness: 0.92 }),
    rim: std({ color: 0xb8bcc0, roughness: 0.28, metalness: 0.95 }),
    rustRim: std({ color: 0x4a2e1e, roughness: 0.9, metalness: 0.5 }),
    chrome: std({ color: 0xd8dadc, roughness: 0.12, metalness: 1 }),
    plastic: std({ color: 0x1c1d1f, roughness: 0.65 }),
    chassis: std({ color: 0x090909, roughness: 1 }),
    headOn: std({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 3.2 }),
    headOff: phys({ color: 0x8e979c, roughness: 0.05, metalness: 0.6, clearcoat: 1 }),
    tail: std({ color: 0x5a0a08, emissive: 0xff1a10, emissiveIntensity: 0.45, roughness: 0.25 }),
    hazard: std({ color: 0x6a3a08, emissive: 0xff9a1a, emissiveIntensity: 0, roughness: 0.3 }),
    blue: std({ color: 0x0a1440, emissive: 0x2a5aff, emissiveIntensity: 0, roughness: 0.3 }),
    taxi: std({ color: 0x3a2a08, emissive: 0xffb020, emissiveIntensity: 1.8 }),
    plateF: std({ map: plateTex(false), roughness: 0.4 }),
    plateR: std({ map: plateTex(true), roughness: 0.4 }),
    livery: std({ map: liveryTex(), roughness: 0.35 }),
    busRed: phys({ color: 0xb3120f, roughness: 0.38, metalness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.2 }),
    black: std({ color: 0x08090a, roughness: 0.5 }),
    blind: std({ color: 0x000000, emissive: 0xffffff, emissiveMap: blindTex(), emissiveIntensity: 1.6 }),
    advert: std({ map: advertTex(), emissive: 0xffffff, emissiveMap: advertTex(), emissiveIntensity: 0.35, roughness: 0.4 }),
  }
}

/** A car's paint: metallic with a clear coat, a little dull from the dust. */
export function paint(own: <T extends { dispose(): void }>(x: T) => T, color: number, dusty = 0.4): THREE.Material {
  return own(new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.3 + dusty * 0.3, clearcoat: 1 - dusty * 0.6, clearcoatRoughness: 0.12 + dusty * 0.3 }))
}

// ---------------------------------------------------------------- geometry (made once per kind, kept)

const geoCache = new Map<string, THREE.BufferGeometry>()
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key)
  if (!g) {
    g = make()
    geoCache.set(key, g)
  }
  return g
}

/** A path through `pts`, each corner rounded off by up to `rad`. */
function rounded(path: THREE.Shape, pts: [number, number][], rad: number, start = true) {
  if (start) path.moveTo(pts[0][0], pts[0][1])
  else path.lineTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]
    const [cx, cy] = pts[i]
    const [nx, ny] = pts[i + 1]
    const d1 = Math.hypot(cx - px, cy - py)
    const d2 = Math.hypot(nx - cx, ny - cy)
    const r = Math.min(rad, d1 / 2, d2 / 2)
    path.lineTo(cx + ((px - cx) / d1) * r, cy + ((py - cy) / d1) * r)
    path.quadraticCurveTo(cx, cy, cx + ((nx - cx) / d2) * r, cy + ((ny - cy) / d2) * r)
  }
  const l = pts[pts.length - 1]
  path.lineTo(l[0], l[1])
}

/** The side outline with its wheel arches. */
function bodyShape(s: Spec): THREE.Shape {
  const sh = new THREE.Shape()
  rounded(sh, s.body, 0.13)
  const [xr, xf] = s.axles
  const ar = s.tyre + 0.11
  sh.lineTo(xf + ar, s.clear)
  sh.absarc(xf, s.tyre, ar, 0, Math.PI, false)
  sh.lineTo(xf - ar, s.clear)
  sh.lineTo(xr + ar, s.clear)
  sh.absarc(xr, s.tyre, ar, 0, Math.PI, false)
  sh.lineTo(xr - ar, s.clear)
  sh.lineTo(s.body[0][0] + 0.06, s.clear)
  sh.lineTo(s.body[0][0], s.body[0][1])
  return sh
}

function extrude(shape: THREE.Shape, width: number, bevel: number, segs = 3): THREE.BufferGeometry {
  const depth = Math.max(0.01, width - bevel * 2)
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: segs, curveSegments: 10 })
  g.translate(0, 0, -depth / 2)
  return g
}

/** A tyre turned on a lathe (its axis along z), the sidewalls rounded. */
function tyreGeo(r: number, w: number): THREE.BufferGeometry {
  return geo(`tyre${r}:${w}`, () => {
    const hw = w / 2
    const inner = r * 0.66
    const pts = [
      [inner, -hw * 0.9], [r - 0.05, -hw], [r - 0.012, -hw * 0.85], [r, -hw * 0.55], [r, hw * 0.55], [r - 0.012, hw * 0.85], [r - 0.05, hw], [inner, hw * 0.9],
    ].map(([x, y]) => new THREE.Vector2(x, y))
    const g = new THREE.LatheGeometry(pts, 28)
    g.rotateX(Math.PI / 2)
    return g
  })
}

/** An alloy wheel: a dished disc, five spokes, the hub. */
function rimGeo(r: number, w: number): THREE.BufferGeometry {
  return geo(`rim${r}:${w}`, () => {
    const rr = r * 0.66
    const parts: THREE.BufferGeometry[] = []
    const barrel = new THREE.CylinderGeometry(rr, rr, w * 0.85, 24, 1, true)
    barrel.rotateX(Math.PI / 2)
    parts.push(barrel)
    const lip = new THREE.TorusGeometry(rr, 0.018, 6, 24)
    lip.translate(0, 0, w * 0.42)
    parts.push(lip)
    const hub = new THREE.CylinderGeometry(rr * 0.22, rr * 0.26, 0.06, 12)
    hub.rotateX(Math.PI / 2)
    hub.translate(0, 0, w * 0.36)
    parts.push(hub)
    for (let k = 0; k < 5; k++) {
      const s = new THREE.BoxGeometry(0.055, rr * 0.82, 0.04)
      s.translate(0, rr * 0.5, w * 0.36)
      s.rotateZ((k / 5) * Math.PI * 2)
      parts.push(s)
    }
    // the dark of the wheel behind the spokes
    const back = new THREE.CircleGeometry(rr, 24)
    back.translate(0, 0, w * 0.2)
    parts.push(back)
    return merge(parts)
  })
}

/** Merge geometries (made non-indexed, uv kept) into one. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p
    for (const name of Object.keys(q.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') q.deleteAttribute(name)
    if (!q.attributes.uv) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((q.attributes.position.count) * 2), 2))
    if (!q.attributes.normal) q.computeVertexNormals()
    q.clearGroups()
    return q
  })
  let total = 0
  for (const f of flat) total += f.attributes.position.count
  const pos = new Float32Array(total * 3)
  const nrm = new Float32Array(total * 3)
  const uv = new Float32Array(total * 2)
  let o = 0
  for (const f of flat) {
    const n = f.attributes.position.count
    pos.set(f.attributes.position.array as Float32Array, o * 3)
    nrm.set(f.attributes.normal.array as Float32Array, o * 3)
    uv.set(f.attributes.uv.array as Float32Array, o * 2)
    o += n
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

const BOX = new THREE.BoxGeometry(1, 1, 1)
const PLANE = new THREE.PlaneGeometry(1, 1)

export interface Vehicle {
  group: THREE.Group
  L: number
  W: number
  H: number
  /** Its headlights are on (the street lays a pool of light in front). */
  lit: boolean
}

/** A box part: size, centre, an optional tilt about z. */
function part(parent: THREE.Object3D, mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rz = 0): THREE.Mesh {
  const m = new THREE.Mesh(BOX, mat)
  m.scale.set(sx, sy, sz)
  m.position.set(x, y, z)
  m.rotation.z = rz
  parent.add(m)
  return m
}

/** A thin bar from (x0, y0) to (x1, y1) in the side plane, at z. */
function bar(parent: THREE.Object3D, mat: THREE.Material, x0: number, y0: number, x1: number, y1: number, t: number, d: number, z: number) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  part(parent, mat, len, t, d, (x0 + x1) / 2, (y0 + y1) / 2, z, Math.atan2(y1 - y0, x1 - x0))
}

export function makeCar(kind: CarKind, state: CarState, body: THREE.Material, m: VehicleMats, seed: number): Vehicle {
  const s = SPECS[kind === 'police' ? 'estate' : kind]
  const r = rng(seed)
  const group = new THREE.Group()
  const car = new THREE.Group()
  car.position.x = -s.L / 2
  group.add(car)
  const burnt = state === 'burnt'
  const paintMat = burnt ? m.burnt : body
  const glassMat = burnt ? m.charred : state === 'smashed' ? m.cracked : m.glass
  const W = s.W
  // the body and the glasshouse
  car.add(new THREE.Mesh(geo(`body:${kind === 'police' ? 'estate' : kind}`, () => extrude(bodyShape(s), W, 0.07)), paintMat))
  const gs = new THREE.Shape()
  const [g0, g1, g2, g3] = s.glass
  rounded(gs, [g0, g1, g2, g3, [g0[0] + 0.02, g0[1]]], 0.07)
  const Wg = W - 0.2
  car.add(new THREE.Mesh(geo(`glass:${kind === 'police' ? 'estate' : kind}`, () => extrude(gs, Wg, 0.035, 2)), glassMat))
  // pillars and the roof, in paint
  const yB = (x: number) => g1[1] + ((x - g1[0]) / (g2[0] - g1[0])) * (g2[1] - g1[1])
  const xB = g3[0] - (g3[0] - g0[0]) * (s.doors === 4 ? 0.45 : 0.55)
  for (const side of [-1, 1]) {
    const z = side * (Wg / 2)
    bar(car, paintMat, g3[0], g3[1], g2[0], g2[1], 0.09, 0.045, z)
    bar(car, paintMat, g0[0], g0[1], g1[0], g1[1], 0.13, 0.045, z)
    bar(car, paintMat, xB, g0[1], xB, yB(xB), 0.1, 0.045, z)
    if (s.doors === 4 && kind !== 'van') bar(car, paintMat, g0[0] + (xB - g0[0]) * 0.35, g0[1], g0[0] + (xB - g0[0]) * 0.35, yB(g0[0] + (xB - g0[0]) * 0.35), 0.06, 0.04, z)
  }
  const roofLen = Math.hypot(g2[0] - g1[0], g2[1] - g1[1])
  part(car, paintMat, roofLen + 0.06, 0.05, Wg + 0.02, (g1[0] + g2[0]) / 2, (g1[1] + g2[1]) / 2 + 0.005, 0, Math.atan2(g2[1] - g1[1], g2[0] - g1[0]))
  // the chassis between the wheels, so the arches are not windows through the car
  part(car, m.chassis, s.L - 0.7, s.tyre + 0.22 - s.clear, W - 0.62, s.L / 2, (s.clear + s.tyre + 0.22) / 2 + 0.01, 0)
  // wheels (a burnt car sits on its rims)
  const tw = 0.22
  const lift = burnt ? -(s.tyre * 0.34) : 0
  for (const x of s.axles)
    for (const side of [-1, 1]) {
      const z = side * (W / 2 - 0.15)
      if (!burnt) {
        const t = new THREE.Mesh(tyreGeo(s.tyre, tw), m.tyre)
        t.position.set(x, s.tyre, z)
        car.add(t)
      }
      const rim = new THREE.Mesh(rimGeo(s.tyre, tw), burnt ? m.rustRim : m.rim)
      rim.position.set(x, s.tyre + lift, z)
      if (side < 0) rim.rotation.y = Math.PI
      car.add(rim)
    }
  // lights, grille, bumpers, plates
  const fx = s.L - 0.07
  const lights = state === 'abandoned' && r() < 0.6
  if (!burnt) {
    for (const side of [-1, 1]) {
      part(car, lights ? m.headOn : m.headOff, 0.12, 0.13, 0.36, fx, s.front, side * (W / 2 - 0.32))
      part(car, m.hazard, 0.1, 0.06, 0.1, fx - 0.03, s.front - 0.02, side * (W / 2 - 0.09))
      part(car, m.tail, 0.1, 0.15, 0.3, 0.05, s.rear, side * (W / 2 - 0.23))
      part(car, m.hazard, 0.09, 0.07, 0.08, 0.05, s.rear - 0.13, side * (W / 2 - 0.18))
      // mirrors
      part(car, paintMat, 0.12, 0.11, 0.18, g3[0] - 0.12, g3[1] + 0.06, side * (W / 2 + 0.07))
      // door seams and handles, a rubbing strip
      const zs = side * (W / 2 + 0.003)
      for (const x of [g3[0] - 0.04, xB, ...(s.doors === 4 ? [g0[0] + (kind === 'saloon' ? 0.15 : 0.55)] : [])]) part(car, m.chassis, 0.012, g0[1] - s.clear - 0.22, 0.004, x, (g0[1] + s.clear + 0.18) / 2, zs)
      part(car, m.chrome, 0.16, 0.03, 0.02, xB - 0.2, g0[1] - 0.14, side * (W / 2 + 0.01))
      if (s.doors === 4) part(car, m.chrome, 0.16, 0.03, 0.02, xB - (xB - g0[0]) * 0.55, g0[1] - 0.14, side * (W / 2 + 0.01))
      part(car, m.plastic, s.axles[1] - s.axles[0] - (s.tyre + 0.11) * 2 - 0.1, 0.07, 0.02, (s.axles[0] + s.axles[1]) / 2, 0.48, side * (W / 2 + 0.008))
    }
    part(car, m.plastic, 0.07, 0.16, W - 1.1, fx + 0.01, s.front - 0.13, 0)
    part(car, m.plastic, 0.1, 0.13, W - 0.12, s.L - 0.03, 0.34, 0)
    part(car, m.plastic, 0.1, 0.13, W - 0.12, 0.03, 0.4, 0)
    const pf = new THREE.Mesh(PLANE, m.plateF)
    pf.scale.set(0.52, 0.11, 1)
    pf.rotation.y = Math.PI / 2
    pf.position.set(s.L + 0.025, 0.47, 0)
    car.add(pf)
    const pr = new THREE.Mesh(PLANE, m.plateR)
    pr.scale.set(0.52, 0.11, 1)
    pr.rotation.y = -Math.PI / 2
    pr.position.set(-0.025, s.rear - 0.3, 0)
    car.add(pr)
  }
  if (kind === 'police' && !burnt) {
    for (const side of [-1, 1]) {
      const lv = new THREE.Mesh(PLANE, m.livery)
      lv.scale.set(s.L - 0.9, 0.3, 1)
      lv.position.set(s.L / 2 - 0.05, 0.66, side * (W / 2 + 0.006))
      if (side < 0) lv.rotation.y = Math.PI
      car.add(lv)
    }
    part(car, m.plastic, 0.3, 0.07, 1.2, (g1[0] + g2[0]) / 2 + 0.3, yB((g1[0] + g2[0]) / 2) + 0.06, 0)
    for (const z of [-0.4, 0.4]) part(car, m.blue, 0.24, 0.08, 0.32, (g1[0] + g2[0]) / 2 + 0.3, yB((g1[0] + g2[0]) / 2) + 0.12, z)
  }
  if (kind === 'cab' && !burnt) part(car, m.taxi, 0.16, 0.1, 0.5, g2[0] - 0.25, g2[1] + 0.07, 0)
  group.position.y = lift
  return { group, L: s.L, W, H: g2[1], lit: lights }
}

/** A red double-decker bus: lower and upper deck glazing in black surrounds, the destination blind, an advert. */
export function makeBus(m: VehicleMats, smashed: boolean): Vehicle {
  const L = 11.2
  const W = 2.52
  const H = 4.38
  const tyre = 0.5
  const [xr, xf] = [3.0, 8.85]
  const group = new THREE.Group()
  const bus = new THREE.Group()
  bus.position.x = -L / 2
  group.add(bus)
  const sh = new THREE.Shape()
  rounded(sh, [[0.05, 0.32], [0, 2.0], [0.02, H - 0.1], [0.3, H], [L - 0.35, H], [L - 0.05, H - 0.25], [L, 2.6], [L - 0.04, 1.0], [L + 0.02, 0.4], [L - 0.06, 0.3]], 0.3)
  const ar = tyre + 0.1
  sh.lineTo(xf + ar, 0.3)
  sh.absarc(xf, tyre, ar, 0, Math.PI, false)
  sh.lineTo(xf - ar, 0.3)
  sh.lineTo(xr + ar, 0.3)
  sh.absarc(xr, tyre, ar, 0, Math.PI, false)
  sh.lineTo(xr - ar, 0.3)
  sh.lineTo(0.1, 0.3)
  sh.lineTo(0.05, 0.32)
  bus.add(new THREE.Mesh(geo('bus', () => extrude(sh, W, 0.08)), m.busRed))
  part(bus, m.chassis, L - 1.2, 0.6, W - 0.7, L / 2, 0.62, 0)
  // glazing: a black surround, the glass, the pillars between the panes
  const band = (x0: number, x1: number, y0: number, y1: number, pitch: number, glass: THREE.Material) => {
    part(bus, m.black, x1 - x0 + 0.14, y1 - y0 + 0.14, W + 0.012, (x0 + x1) / 2, (y0 + y1) / 2, 0)
    part(bus, glass, x1 - x0, y1 - y0, W + 0.02, (x0 + x1) / 2, (y0 + y1) / 2, 0)
    for (let x = x0 + pitch; x < x1 - 0.2; x += pitch) part(bus, m.black, 0.09, y1 - y0, W + 0.03, x, (y0 + y1) / 2, 0)
  }
  band(0.5, 8.0, 1.5, 2.42, 1.25, m.glass)
  band(0.35, 10.75, 3.1, 4.02, 1.3, smashed ? m.cracked : m.glass)
  // the front: windscreens, the blind, lights, the grille
  part(bus, m.black, 0.06, 1.4, W - 0.25, L + 0.01, 1.85, 0)
  part(bus, smashed ? m.cracked : m.glass, 0.07, 1.3, W - 0.35, L + 0.02, 1.85, 0)
  part(bus, m.black, 0.06, 0.95, W - 0.25, L - 0.03, 3.55, 0)
  part(bus, m.glass, 0.07, 0.85, W - 0.35, L - 0.02, 3.55, 0)
  part(bus, m.blind, 0.05, 0.3, 1.5, L + 0.005, 2.8, 0)
  for (const side of [-1, 1]) {
    part(bus, m.headOff, 0.06, 0.18, 0.3, L + 0.02, 0.62, side * (W / 2 - 0.3))
    part(bus, m.tail, 0.06, 0.25, 0.14, 0.01, 0.9, side * (W / 2 - 0.12))
    part(bus, m.hazard, 0.06, 0.1, 0.14, L + 0.02, 0.85, side * (W / 2 - 0.12))
    // the advert between the decks
    const ad = new THREE.Mesh(PLANE, m.advert)
    ad.scale.set(5.6, 0.5, 1)
    ad.position.set(4.6, 2.78, side * (W / 2 + 0.005))
    if (side < 0) ad.rotation.y = Math.PI
    bus.add(ad)
  }
  part(bus, m.plastic, 0.05, 0.25, 1.4, L + 0.02, 0.45, 0)
  const pf = new THREE.Mesh(PLANE, m.plateF)
  pf.scale.set(0.52, 0.11, 1)
  pf.rotation.y = Math.PI / 2
  pf.position.set(L + 0.055, 0.32, 0)
  bus.add(pf)
  // the doors: glass leaves on the near side
  part(bus, m.black, 1.3, 2.05, 0.02, 9.95, 1.35, W / 2 + 0.01)
  for (const x of [9.65, 10.27]) part(bus, m.glass, 0.56, 1.9, 0.025, x, 1.35, W / 2 + 0.012)
  // wheels: single at the front, twin at the back
  for (const side of [-1, 1]) {
    for (const [x, zs] of [[xf, [W / 2 - 0.2]], [xr, [W / 2 - 0.18, W / 2 - 0.5]]] as [number, number[]][])
      for (const zz of zs) {
        const t = new THREE.Mesh(tyreGeo(tyre, 0.3), m.tyre)
        t.position.set(x, tyre, side * zz)
        bus.add(t)
        const rim = new THREE.Mesh(rimGeo(tyre, 0.3), m.rim)
        rim.position.set(x, tyre, side * zz)
        if (side < 0) rim.rotation.y = Math.PI
        bus.add(rim)
      }
  }
  return { group, L, W, H, lit: false }
}
