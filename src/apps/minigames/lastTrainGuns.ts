// Last Train: the weapons in the player's hands, and how they are reloaded.
// The pistol, rifle and shotgun are modelled in real sizes (the engine shrinks
// the whole viewmodel towards the eye). The right hand stays on the grip; the
// left arm is a two-bone arm that reaches for the magazine, takes the old one
// out (it falls to the floor, rounds showing), fetches a new one, seats it and
// works the slide, the charging handle or the pump. For the shotgun the hand
// feeds the shells in one at a time, then pumps.

import * as THREE from 'three'

/** The three actions the hands know how to work (reload, recoil, ejection): every gun is one of them. */
export type GunBase = 'pistol' | 'rifle' | 'shotgun'

export interface WeaponDef {
  id: 'pistol' | 'rifle' | 'shotgun' | 'magnum' | 'smg' | 'marksman' | 'autoshotgun'
  base: GunBase
  name: string
  /** The name on the HUD's slot list. */
  short: string
  /** Station from which the gun is found (0: from the start). */
  from: number
  /** Field of view taken off when aiming down the sights. */
  zoom: number
  auto: boolean
  damage: number
  pellets: number
  rpm: number
  mag: number
  /** Starting spare ammo; -1 = endless. */
  reserve: number
  /** Seconds for a full reload (a magazine) or for one shell. */
  reload: number
  /** Extra seconds when the gun was empty: the slide or bolt has to be worked. */
  rack: number
  spread: number
  kick: number
  range: number
}

export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', base: 'pistol', short: 'Pistol', from: 0, zoom: 14, name: 'K-9 Pistol', auto: false, damage: 34, pellets: 1, rpm: 380, mag: 12, reserve: -1, reload: 1.35, rack: 0.2, spread: 0.010, kick: 0.028, range: 80 },
  { id: 'rifle', base: 'rifle', short: 'Rifle', from: 0, zoom: 24, name: 'KR-4 Rifle', auto: true, damage: 26, pellets: 1, rpm: 640, mag: 30, reserve: 150, reload: 1.95, rack: 0.4, spread: 0.016, kick: 0.017, range: 120 },
  { id: 'shotgun', base: 'shotgun', short: 'Shotgun', from: 0, zoom: 14, name: 'Breacher 12', auto: false, damage: 15, pellets: 9, rpm: 72, mag: 6, reserve: 30, reload: 0.55, rack: 0, spread: 0.065, kick: 0.085, range: 40 },
  // found further down the line, one per station
  { id: 'smg', base: 'rifle', short: 'SMG', from: 1, zoom: 12, name: 'Vesper SMG', auto: true, damage: 17, pellets: 1, rpm: 980, mag: 40, reserve: 200, reload: 1.55, rack: 0.3, spread: 0.024, kick: 0.012, range: 60 },
  { id: 'magnum', base: 'pistol', short: 'Magnum', from: 2, zoom: 16, name: 'Warden .44', auto: false, damage: 115, pellets: 1, rpm: 130, mag: 6, reserve: 36, reload: 1.7, rack: 0.2, spread: 0.006, kick: 0.07, range: 100 },
  { id: 'autoshotgun', base: 'shotgun', short: 'Auto-12', from: 3, zoom: 12, name: 'Riot Auto-12', auto: true, damage: 13, pellets: 8, rpm: 230, mag: 8, reserve: 40, reload: 0.42, rack: 0, spread: 0.075, kick: 0.07, range: 34 },
  { id: 'marksman', base: 'rifle', short: 'Marksman', from: 4, zoom: 44, name: 'Longline DMR', auto: false, damage: 150, pellets: 1, rpm: 190, mag: 10, reserve: 50, reload: 2.2, rack: 0.4, spread: 0.004, kick: 0.05, range: 200 },
]

/** The two-bone left arm: shoulder and hand are given, the elbow follows. */
export interface LeftArm {
  root: THREE.Group
  /** Put the gloved hand at `hand` (gun-local); the arm bends to reach it. */
  set(hand: THREE.Vector3): void
}

export interface Gun {
  def: WeaponDef
  mag: number
  reserve: number
  model: THREE.Group
  muzzle: THREE.Object3D
  /** Where the spent casing leaves the gun. */
  port: THREE.Object3D
  /** The slide (pistol): back when firing, locked back when empty. */
  slide: THREE.Object3D | null
  /** The pump (shotgun). */
  pump: THREE.Object3D | null
  /** The charging handle (rifle). */
  charge: THREE.Object3D | null
  /** The magazine in the gun (pistol, rifle). */
  magMesh: THREE.Group | null
  /** A fresh magazine or shell in the left hand while reloading. */
  spare: THREE.Group
  /** The left hand at rest. */
  rest: THREE.Vector3
  arm: LeftArm
  /** Where the magazine sits, which way it slides out (down the well), how tall it is. */
  well: { at: THREE.Vector3; axis: THREE.Vector3; h: number }
}

// ---------------------------------------------------------------- building blocks

const boxGeo = new THREE.BoxGeometry(1, 1, 1)
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16)

function mat(color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

const M = {
  black: mat(0x1d1f22, 0.42, 0.8),
  dark: mat(0x2c2f33, 0.6, 0.5),
  polymer: mat(0x3a3d35, 0.75, 0.1),
  wood: mat(0x6a4425, 0.55),
  steel: mat(0x9ea3a8, 0.25, 1),
  glove: mat(0x222420, 0.85),
  sleeve: mat(0x2f4a3a, 0.9),
  brass: mat(0xc9a14a, 0.28, 1),
  copper: mat(0xb86a3a, 0.35, 0.9),
  red: mat(0x9a1c14, 0.5),
  mag: mat(0x24272b, 0.5, 0.7),
  plate: mat(0x101113, 0.7, 0.2),
  tan: mat(0x8a7a58, 0.75, 0.1),
  rubber: mat(0x141414, 0.95),
  white: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.5) }),
  lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 1.9) }),
  chrome: mat(0xc8ccd0, 0.18, 1),
  dot: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3) }),
  sight: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.5, 0.8) }),
  lens: new THREE.MeshStandardMaterial({ color: 0x223322, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.35 }),
}

// ---------------------------------------------------------------- surface: wear, grain, stippling

let surfaced = false

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, color = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  let seed = w * 7 + h
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  draw(g, r)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (color) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Once, in the browser: the finish of the guns (worn bluing, wood grain, stippled polymer, knurled steel). */
function surfaceMaterials() {
  if (surfaced || typeof document === 'undefined') return
  surfaced = true
  // worn metal: a roughness map with polish where hands rub and fine scratches
  const wear = canvasTex(256, 256, (g, r) => {
    g.fillStyle = '#9a9a9a'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 400; i++) {
      g.strokeStyle = `rgba(${r() < 0.5 ? '40,40,40' : '230,230,230'},${0.15 + r() * 0.3})`
      g.lineWidth = 0.5 + r()
      const x = r() * 256
      const y = r() * 256
      const a = r() * Math.PI
      const l = 4 + r() * 30
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      g.stroke()
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(30,30,30,${r() * 0.25})`
      g.beginPath()
      g.arc(r() * 256, r() * 256, 6 + r() * 30, 0, Math.PI * 2)
      g.fill()
    }
  }, false)
  for (const m of [M.black, M.dark, M.mag, M.steel, M.chrome]) {
    m.roughnessMap = wear
    m.needsUpdate = true
  }
  // the bluing worn to bright metal at the edges: a faint colour variation
  const blue = canvasTex(128, 128, (g, r) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${r() < 0.6 ? '120,130,150' : '200,200,200'},${r() * 0.12})`
      g.fillRect(r() * 128, r() * 128, 2 + r() * 20, 1 + r() * 3)
    }
  })
  M.black.map = blue
  M.black.needsUpdate = true
  // walnut: grain lines and pores
  const wood = canvasTex(256, 256, (g, r) => {
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 256, 256)
    for (let y = 0; y < 256; y += 2) {
      const k = 0.6 + Math.sin(y * 0.11 + Math.sin(y * 0.031) * 4) * 0.25 + r() * 0.1
      g.fillStyle = `rgba(${Math.round(140 * k)},${Math.round(90 * k)},${Math.round(50 * k)},0.55)`
      g.fillRect(0, y + Math.sin(y * 0.2) * 2, 256, 2)
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = 'rgba(40,20,10,0.35)'
      g.fillRect(r() * 256, r() * 256, 1 + r() * 4, 1)
    }
  })
  M.wood.map = wood
  M.wood.color.set(0xb07848)
  M.wood.needsUpdate = true
  // stippled polymer and knurled rubber: a bump map of tiny dimples
  const stipple = canvasTex(128, 128, (g, r) => {
    g.fillStyle = '#808080'
    g.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = r() < 0.5 ? '#5a5a5a' : '#a8a8a8'
      g.fillRect(r() * 128, r() * 128, 1.5, 1.5)
    }
  }, false)
  stipple.repeat.set(3, 3)
  for (const m of [M.polymer, M.tan, M.rubber, M.mag]) {
    m.bumpMap = stipple
    m.bumpScale = 1.2
    m.needsUpdate = true
  }
  const knurl = canvasTex(64, 64, (g) => {
    g.fillStyle = '#808080'
    g.fillRect(0, 0, 64, 64)
    g.strokeStyle = '#404040'
    for (let i = -64; i < 128; i += 6) {
      g.beginPath()
      g.moveTo(i, 0)
      g.lineTo(i + 64, 64)
      g.moveTo(i + 64, 0)
      g.lineTo(i, 64)
      g.stroke()
    }
  }, false)
  M.steel.bumpMap = knurl
  M.steel.bumpScale = 0.6
}

function B(p: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(boxGeo, m)
  mesh.scale.set(w, h, d)
  mesh.position.set(x, y, z)
  p.add(mesh)
  return mesh
}

/** A cylinder along z (barrels) or along y. */
function C(p: THREE.Object3D, m: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'y' | 'z' = 'z') {
  const mesh = new THREE.Mesh(cylGeo, m)
  mesh.scale.set(r, len, r)
  if (axis === 'z') mesh.rotation.x = Math.PI / 2
  mesh.position.set(x, y, z)
  p.add(mesh)
  return mesh
}

/** A cartridge standing on its base: brass case, copper bullet. Length ~ `len`. */
function cartridge(p: THREE.Object3D, r: number, len: number, x: number, y: number, z: number) {
  const g = new THREE.Group()
  C(g, M.brass, r, len * 0.62, 0, len * 0.31, 0, 'y')
  const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 0.92, len * 0.42, 10), M.copper)
  tip.position.y = len * 0.62 + len * 0.18
  g.add(tip)
  g.position.set(x, y, z)
  p.add(g)
  return g
}

/** A magazine, centred: body, base plate and the top rounds showing. Its local +y is up the well. */
export function makeMag(kind: 'pistol' | 'rifle'): THREE.Group {
  const g = new THREE.Group()
  if (kind === 'pistol') {
    B(g, M.mag, 0.024, 0.1, 0.034, 0, 0, 0)
    B(g, M.plate, 0.03, 0.014, 0.042, 0, -0.054, 0)
    B(g, M.steel, 0.026, 0.004, 0.036, 0, 0.049, 0)
    for (const [dx, dz] of [[-0.005, -0.008], [0.005, 0.008]] as const) cartridge(g, 0.0042, 0.026, dx, 0.05, dz)
  } else {
    B(g, M.mag, 0.034, 0.13, 0.058, 0, 0, 0)
    for (let i = 0; i < 4; i++) B(g, M.black, 0.036, 0.004, 0.06, 0, -0.04 + i * 0.026, 0)
    B(g, M.plate, 0.04, 0.014, 0.066, 0, -0.07, 0)
    B(g, M.steel, 0.032, 0.004, 0.054, 0, 0.065, 0)
    for (const [dx, dz] of [[-0.008, -0.012], [0.008, 0.012], [-0.008, 0.012], [0.008, -0.012]] as const) cartridge(g, 0.0046, 0.03, dx, 0.066, dz)
  }
  return g
}

/** A twelve-gauge shell lying along z: red hull, brass head. */
function makeShell(): THREE.Group {
  const g = new THREE.Group()
  C(g, M.red, 0.012, 0.05, 0, 0, -0.005)
  C(g, M.brass, 0.0125, 0.014, 0, 0, 0.026)
  C(g, M.steel, 0.0085, 0.004, 0, 0, 0.034)
  return g
}

// ---------------------------------------------------------------- the left arm

function makeLeftArm(shoulder: THREE.Vector3, upper: number, lower: number): LeftArm {
  const root = new THREE.Group()
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 12)
  const a = new THREE.Mesh(cyl, M.sleeve)
  const b = new THREE.Mesh(cyl, M.sleeve)
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.06, 12), M.glove)
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), M.sleeve)
  const hand = new THREE.Group()
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 10), M.glove)
  fist.scale.set(1, 1.1, 1.25)
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.04, 3, 8), M.glove)
  thumb.position.set(0.03, 0.01, -0.03)
  thumb.rotation.set(Math.PI / 2.4, 0, 0.5)
  const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.02, 0.02), M.glove)
  knuckles.position.set(0, 0.012, -0.05)
  hand.add(fist, thumb, knuckles)
  root.add(a, b, cuff, elbow, hand)
  for (const o of root.children) o.traverse((m) => (m.frustumCulled = false))
  const up = new THREE.Vector3(0, 1, 0)
  const pole = new THREE.Vector3(-0.45, -1, 0.2).normalize()
  const tmp = new THREE.Vector3()
  const place = (m: THREE.Object3D, p0: THREE.Vector3, p1: THREE.Vector3, r: number) => {
    tmp.subVectors(p1, p0)
    const len = tmp.length()
    m.position.copy(p0).addScaledVector(tmp, 0.5)
    m.quaternion.setFromUnitVectors(up, tmp.divideScalar(Math.max(1e-5, len)))
    m.scale.set(r, len, r)
  }
  const e = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const perp = new THREE.Vector3()
  const h = new THREE.Vector3()
  return {
    root,
    set(target) {
      dir.subVectors(target, shoulder)
      let L = dir.length()
      dir.divideScalar(Math.max(1e-5, L))
      L = THREE.MathUtils.clamp(L, Math.abs(upper - lower) + 0.01, upper + lower - 0.004)
      h.copy(shoulder).addScaledVector(dir, L)
      const x = (upper * upper - lower * lower + L * L) / (2 * L)
      const rise = Math.sqrt(Math.max(0, upper * upper - x * x))
      perp.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize()
      e.copy(shoulder).addScaledVector(dir, x).addScaledVector(perp, rise)
      place(a, shoulder, e, 0.04)
      place(b, e, h, 0.032)
      elbow.position.copy(e)
      tmp.subVectors(h, e).normalize()
      cuff.position.copy(h).addScaledVector(tmp, -0.04)
      cuff.quaternion.setFromUnitVectors(up, tmp)
      hand.position.copy(h)
      hand.quaternion.setFromUnitVectors(up, tmp)
    },
  }
}

function rightArm(p: THREE.Object3D, hand: THREE.Vector3, elbow: THREE.Vector3) {
  const dir = elbow.clone().sub(hand)
  const len = dir.length()
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, len, 4, 10), M.sleeve)
  arm.position.copy(hand).addScaledVector(dir, 0.5 + 0.06 / len)
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.05, 12), M.glove)
  cuff.position.copy(hand).addScaledVector(dir, 0.05)
  cuff.quaternion.copy(arm.quaternion)
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), M.glove)
  fist.scale.set(0.95, 1.1, 1.35)
  fist.position.copy(hand)
  p.add(arm, cuff, fist)
}

// ---------------------------------------------------------------- the guns

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
/** Where the rifle's charging handle sits when the bolt is closed. */
const CHARGE_Z = 0.06
const SHOULDER = V(-0.72, -0.72, 0.5)

export function buildGuns(): Gun[] {
  surfaceMaterials()
  const guns: Gun[] = []

  // -- pistol: the slide is the whole top, it cycles back; the magazine is in the grip
  const pistolGun = (def: WeaponDef): Gun => {
    const g = new THREE.Group()
    B(g, M.polymer, 0.03, 0.03, 0.17, 0, -0.03, 0)
    const grip = B(g, M.polymer, 0.03, 0.11, 0.045, 0, -0.085, 0.055)
    grip.rotation.x = -0.25
    B(g, M.polymer, 0.026, 0.012, 0.05, 0, -0.04, -0.045).rotation.x = 0
    // trigger guard
    B(g, M.polymer, 0.02, 0.008, 0.05, 0, -0.056, -0.025)
    B(g, M.polymer, 0.02, 0.025, 0.008, 0, -0.045, -0.05)
    B(g, M.black, 0.006, 0.018, 0.006, 0, -0.04, -0.012)
    const slide = new THREE.Group()
    B(slide, M.black, 0.034, 0.036, 0.2, 0, 0.0, -0.02)
    for (let i = 0; i < 5; i++) B(slide, M.dark, 0.036, 0.03, 0.004, 0, 0.0, 0.05 + i * 0.01)
    B(slide, M.black, 0.006, 0.012, 0.008, 0, 0.024, -0.11)
    B(slide, M.black, 0.026, 0.01, 0.01, 0, 0.022, 0.07)
    B(slide, M.sight, 0.004, 0.006, 0.004, 0, 0.0295, -0.11)
    // the ejection port: a dark slot on the right of the slide
    B(slide, M.plate, 0.004, 0.016, 0.05, 0.0175, 0.008, 0.0)
    g.add(slide)
    C(g, M.steel, 0.007, 0.03, 0, 0.004, -0.125)
    pistolDetail(g, slide)
    const muzzle = new THREE.Object3D()
    muzzle.position.set(0, 0.004, -0.15)
    g.add(muzzle)
    const port = new THREE.Object3D()
    port.position.set(0.02, 0.01, 0.0)
    g.add(port)
    const magMesh = makeMag('pistol')
    magMesh.rotation.x = -0.25
    magMesh.position.set(0, -0.085, 0.055)
    g.add(magMesh)
    const rest = V(-0.012, -0.085, 0.07)
    const arm = makeLeftArm(SHOULDER, 0.62, 0.62)
    g.add(arm.root)
    rightArm(g, V(0.005, -0.07, 0.06), V(0.1, -0.36, 0.4))
    return {
      def, mag: 0, reserve: 0, model: g, muzzle, port, slide, pump: null, charge: null, magMesh, spare: makeMag('pistol'), rest, arm,
      well: { at: V(0, -0.085, 0.055), axis: V(0, -Math.cos(0.25), Math.sin(0.25)), h: 0.1 },
    }
  }

  // -- rifle: receiver, handguard, red-dot, curved magazine, charging handle
  const rifleGun = (def: WeaponDef): Gun => {
    const g = new THREE.Group()
    B(g, M.black, 0.05, 0.06, 0.26, 0, 0, 0.02)
    B(g, M.dark, 0.055, 0.055, 0.24, 0, -0.005, -0.22)
    for (let i = 0; i < 6; i++) B(g, M.black, 0.058, 0.008, 0.02, 0, 0.026, -0.12 - i * 0.035)
    C(g, M.steel, 0.011, 0.2, 0, 0.0, -0.42)
    C(g, M.black, 0.018, 0.06, 0, 0.0, -0.53)
    // the magazine well, the pistol grip, the stock
    B(g, M.black, 0.044, 0.026, 0.07, 0, -0.04, -0.03)
    const grip = B(g, M.polymer, 0.035, 0.1, 0.045, 0, -0.07, 0.12)
    grip.rotation.x = -0.35
    B(g, M.polymer, 0.045, 0.07, 0.2, 0, -0.015, 0.25)
    // red-dot sight
    B(g, M.black, 0.03, 0.02, 0.08, 0, 0.045, 0.0)
    C(g, M.black, 0.024, 0.07, 0, 0.075, -0.0)
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 18), M.lens)
    lens.position.set(0, 0.075, 0.036)
    g.add(lens)
    const reddot = new THREE.Mesh(new THREE.CircleGeometry(0.0022, 10), M.dot)
    reddot.position.set(0, 0.075, 0.03)
    g.add(reddot)
    // the charging handle (right side, behind the sight)
    const charge = new THREE.Group()
    B(charge, M.steel, 0.012, 0.012, 0.04, 0, 0, 0)
    B(charge, M.black, 0.018, 0.02, 0.012, 0, 0, 0.022)
    charge.position.set(0.03, 0.028, 0.06)
    g.add(charge)
    B(g, M.plate, 0.004, 0.014, 0.05, 0.026, 0.012, 0.02)
    rifleDetail(g)
    const muzzle = new THREE.Object3D()
    muzzle.position.set(0, 0, -0.57)
    g.add(muzzle)
    const port = new THREE.Object3D()
    port.position.set(0.03, 0.012, 0.02)
    g.add(port)
    const magMesh = makeMag('rifle')
    magMesh.rotation.x = 0.2
    magMesh.position.set(0, -0.09, -0.03)
    g.add(magMesh)
    const rest = V(-0.012, -0.055, -0.24)
    const arm = makeLeftArm(SHOULDER, 0.66, 0.66)
    g.add(arm.root)
    rightArm(g, V(0.005, -0.07, 0.13), V(0.1, -0.36, 0.47))
    return {
      def, mag: 0, reserve: 0, model: g, muzzle, port, slide: null, pump: null, charge, magMesh, spare: makeMag('rifle'), rest, arm,
      well: { at: V(0, -0.09, -0.03), axis: V(0, -Math.cos(0.2), -Math.sin(0.2)), h: 0.13 },
    }
  }

  // -- shotgun: receiver with a loading port under it, tube magazine, pump
  const shotgunGun = (def: WeaponDef): Gun => {
    const g = new THREE.Group()
    B(g, M.black, 0.05, 0.065, 0.2, 0, 0, 0.0)
    C(g, M.steel, 0.014, 0.52, 0, 0.012, -0.34)
    C(g, M.black, 0.012, 0.44, 0, -0.018, -0.3)
    const pump = new THREE.Group()
    C(pump, M.wood, 0.022, 0.15, 0, 0, 0)
    for (let i = 0; i < 5; i++) C(pump, M.dark, 0.0235, 0.004, 0, 0, -0.05 + i * 0.025)
    pump.position.set(0, -0.018, -0.25)
    g.add(pump)
    B(g, M.wood, 0.045, 0.08, 0.28, 0, -0.04, 0.22).rotation.x = 0.12
    B(g, M.sight, 0.006, 0.008, 0.006, 0, 0.026, -0.6)
    // the loading port under the receiver and the ejection port on the right
    B(g, M.plate, 0.03, 0.006, 0.07, 0, -0.034, -0.02)
    B(g, M.plate, 0.004, 0.02, 0.06, 0.026, 0.008, -0.02)
    shotgunDetail(g, pump)
    const muzzle = new THREE.Object3D()
    muzzle.position.set(0, 0.012, -0.61)
    g.add(muzzle)
    const port = new THREE.Object3D()
    port.position.set(0.03, 0.01, -0.02)
    g.add(port)
    const rest = V(-0.012, -0.065, -0.25)
    const arm = makeLeftArm(SHOULDER, 0.66, 0.66)
    g.add(arm.root)
    rightArm(g, V(0.005, -0.07, 0.1), V(0.1, -0.36, 0.44))
    return {
      def, mag: 0, reserve: 0, model: g, muzzle, port, slide: null, pump, charge: null, magMesh: null, spare: makeShell(), rest, arm,
      well: { at: V(0, -0.045, -0.02), axis: V(0, -1, 0), h: 0.05 },
    }
  }

  const build = { pistol: pistolGun, rifle: rifleGun, shotgun: shotgunGun }
  for (const def of WEAPONS) {
    const gun = build[def.base](def)
    dressGun(gun)
    guns.push(gun)
  }

  for (const g of guns) {
    g.model.visible = false
    g.model.traverse((o) => (o.frustumCulled = false))
    g.spare.visible = false
    g.spare.traverse((o) => (o.frustumCulled = false))
    g.model.add(g.spare)
  }
  return guns
}

// ---------------------------------------------------------------- the small parts

/** A part turned about x (pins, levers seen from the side). */
function pin(p: THREE.Object3D, m: THREE.Material, r: number, len: number, x: number, y: number, z: number) {
  const c = C(p, m, r, len, x, y, z, 'y')
  c.rotation.z = Math.PI / 2
  return c
}

function pistolDetail(g: THREE.Group, slide: THREE.Object3D) {
  // the slide: front serrations, a lightening cut, three-dot sights, the extractor, the striker cap
  for (let i = 0; i < 4; i++) B(slide, M.dark, 0.0362, 0.026, 0.003, 0, -0.002, -0.085 + i * 0.008)
  for (const s of [-1, 1]) B(slide, M.plate, 0.001, 0.006, 0.07, s * 0.0172, 0.01, -0.06)
  B(slide, M.black, 0.022, 0.008, 0.014, 0, 0.022, 0.072)
  for (const s of [-1, 1]) B(slide, M.white, 0.003, 0.003, 0.001, s * 0.006, 0.0255, 0.065)
  B(slide, M.white, 0.003, 0.003, 0.001, 0, 0.0325, -0.113)
  B(slide, M.steel, 0.002, 0.005, 0.03, 0.0175, 0.012, 0.03)
  B(slide, M.dark, 0.012, 0.012, 0.002, 0, 0.002, 0.081)
  // the barrel hood showing in the port, the recoil spring guide at the muzzle
  B(slide, M.steel, 0.014, 0.004, 0.044, 0, 0.0185, 0.0)
  C(g, M.dark, 0.005, 0.01, 0, -0.026, -0.12)
  // the frame: accessory rail, takedown lever, slide stop, mag release, pins
  for (let i = 0; i < 3; i++) B(g, M.polymer, 0.026, 0.006, 0.006, 0, -0.049, -0.065 - i * 0.014)
  B(g, M.dark, 0.003, 0.006, 0.016, -0.0165, -0.02, -0.03)
  B(g, M.dark, 0.003, 0.005, 0.026, -0.0165, -0.012, 0.02)
  B(g, M.dark, 0.004, 0.01, 0.008, -0.0165, -0.045, -0.005)
  for (const z of [-0.02, 0.035]) pin(g, M.steel, 0.0025, 0.034, 0, -0.035, z)
  // the trigger, curved, with its safety blade
  const trig = B(g, M.dark, 0.006, 0.02, 0.005, 0, -0.045, -0.014)
  trig.rotation.x = 0.3
  B(g, M.black, 0.002, 0.012, 0.003, 0, -0.045, -0.017)
  // the grip: stippled panels, a beavertail, a flared magazine well
  const grip = new THREE.Group()
  grip.position.set(0, -0.085, 0.055)
  grip.rotation.x = -0.25
  g.add(grip)
  for (const s of [-1, 1]) B(grip, M.rubber, 0.002, 0.075, 0.036, s * 0.0158, 0.005, 0.002)
  B(grip, M.polymer, 0.026, 0.012, 0.016, 0, 0.055, 0.03)
  B(grip, M.polymer, 0.034, 0.008, 0.05, 0, -0.054, 0)
  for (let i = 0; i < 3; i++) B(grip, M.polymer, 0.031, 0.006, 0.004, 0, 0.03 - i * 0.025, -0.024)
}

function rifleDetail(g: THREE.Group) {
  // a picatinny rail along the top, its cross slots
  B(g, M.black, 0.024, 0.006, 0.5, 0, 0.033, -0.12)
  for (let i = 0; i < 24; i++) B(g, M.dark, 0.0265, 0.004, 0.006, 0, 0.037, 0.12 - i * 0.021)
  // the handguard's slots on both sides, a light on the right with its switch
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) B(g, M.plate, 0.002, 0.009, 0.026, s * 0.0285, -0.008, -0.14 - i * 0.04)
  C(g, M.black, 0.011, 0.07, 0.04, -0.01, -0.29)
  C(g, M.black, 0.014, 0.02, 0.04, -0.01, -0.33)
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), M.lamp)
  lens.position.set(0.04, -0.01, -0.341)
  lens.rotation.y = Math.PI
  g.add(lens)
  B(g, M.black, 0.012, 0.01, 0.02, 0.03, -0.01, -0.26)
  // the gas block, the folding front sight, the flash hider's slots, a sling loop
  B(g, M.dark, 0.026, 0.024, 0.03, 0, 0.002, -0.36)
  B(g, M.black, 0.02, 0.03, 0.012, 0, 0.05, -0.34)
  B(g, M.black, 0.004, 0.012, 0.004, 0, 0.068, -0.34)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4
    B(g, M.plate, 0.004, 0.004, 0.035, Math.cos(a) * 0.017, Math.sin(a) * 0.017, -0.535)
  }
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 14), M.dark)
  loop.position.set(-0.03, -0.02, -0.33)
  loop.rotation.y = Math.PI / 2
  g.add(loop)
  // the lower: magazine well flare, release button, bolt catch, selector, forward assist, brass deflector, dust cover hinge
  B(g, M.black, 0.05, 0.008, 0.08, 0, -0.054, -0.03)
  C(g, M.dark, 0.005, 0.004, 0.026, -0.04, 0.03, 'y').rotation.z = Math.PI / 2
  B(g, M.dark, 0.003, 0.016, 0.01, -0.026, -0.02, 0.0)
  const sel = B(g, M.dark, 0.003, 0.004, 0.022, -0.026, -0.03, 0.09)
  sel.rotation.x = -0.6
  C(g, M.black, 0.007, 0.022, 0.03, 0.014, 0.075)
  B(g, M.black, 0.008, 0.016, 0.012, 0.03, 0.012, 0.055)
  pin(g, M.steel, 0.0018, 0.056, 0, -0.005, 0.01)
  // the trigger and its guard
  B(g, M.dark, 0.005, 0.022, 0.005, 0, -0.045, 0.072).rotation.x = 0.25
  B(g, M.black, 0.018, 0.004, 0.06, 0, -0.06, 0.07)
  // the stock: buffer tube, adjustment lever, cheek riser, rubber pad, sling slot
  C(g, M.black, 0.017, 0.12, 0, 0.0, 0.2)
  B(g, M.polymer, 0.012, 0.01, 0.03, 0, -0.054, 0.2)
  B(g, M.polymer, 0.04, 0.02, 0.12, 0, 0.026, 0.28)
  B(g, M.rubber, 0.047, 0.076, 0.016, 0, -0.015, 0.355)
  B(g, M.plate, 0.047, 0.012, 0.025, 0, -0.04, 0.3)
}

function shotgunDetail(g: THREE.Group, pump: THREE.Object3D) {
  // a ventilated rib along the barrel, the barrel clamp, the magazine cap
  B(g, M.black, 0.01, 0.003, 0.46, 0, 0.029, -0.36)
  for (let i = 0; i < 12; i++) B(g, M.black, 0.006, 0.006, 0.006, 0, 0.025, -0.15 - i * 0.038)
  C(g, M.dark, 0.02, 0.025, 0, -0.002, -0.5)
  C(g, M.dark, 0.0135, 0.02, 0, -0.018, -0.53)
  B(g, M.steel, 0.008, 0.008, 0.004, 0, -0.018, -0.542)
  // the receiver: pins, the cross-bolt safety, the slide release, the trigger and its guard
  for (const z of [-0.06, 0.06]) pin(g, M.steel, 0.003, 0.054, 0, -0.022, z)
  pin(g, M.red, 0.004, 0.056, 0, -0.03, 0.07)
  B(g, M.dark, 0.003, 0.008, 0.014, -0.026, -0.03, 0.08)
  B(g, M.dark, 0.005, 0.022, 0.005, 0, -0.05, 0.07).rotation.x = 0.25
  B(g, M.black, 0.016, 0.004, 0.065, 0, -0.065, 0.07)
  B(g, M.black, 0.016, 0.025, 0.004, 0, -0.054, 0.04)
  // a side saddle of spare shells on the left
  B(g, M.polymer, 0.004, 0.05, 0.11, -0.027, 0.0, 0.0)
  for (let i = 0; i < 4; i++) {
    C(g, M.red, 0.0105, 0.055, -0.033, 0.0, -0.04 + i * 0.026, 'y')
    C(g, M.brass, 0.0112, 0.014, -0.033, -0.022, -0.04 + i * 0.026, 'y')
  }
  // the stock's pistol grip, the recoil pad, a sling swivel
  const wrist = B(g, M.wood, 0.04, 0.09, 0.045, 0, -0.07, 0.12)
  wrist.rotation.x = -0.35
  B(g, M.rubber, 0.047, 0.094, 0.022, 0, -0.06, 0.37).rotation.x = 0.12
  const swivel = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.002, 6, 12), M.steel)
  swivel.position.set(0, -0.09, 0.3)
  g.add(swivel)
  // the pump's grooves picked out, its action bars
  for (const s of [-1, 1]) B(pump, M.steel, 0.003, 0.006, 0.2, s * 0.012, 0.012, 0.08)
}

/** What makes the guns built on the same action look their own. */
function dressGun(g: Gun) {
  const m = g.model
  /** Swap one shared material for another throughout the gun (not the arms). */
  const recolour = (from: THREE.Material, to: THREE.Material) =>
    m.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === from) o.material = to
    })
  switch (g.def.id) {
    case 'smg': {
      // tan furniture, a fat suppressor, a vertical foregrip
      recolour(M.polymer, M.tan)
      C(m, M.black, 0.022, 0.2, 0, 0, -0.66)
      B(m, M.tan, 0.026, 0.07, 0.03, 0, -0.06, -0.26)
      g.muzzle.position.z = -0.77
      break
    }
    case 'magnum': {
      // a long steel barrel with a top rib, the cylinder in front of the grip, a polished frame
      recolour(M.black, M.chrome)
      C(m, M.chrome, 0.01, 0.14, 0, 0.004, -0.2)
      B(m, M.chrome, 0.012, 0.012, 0.15, 0, 0.018, -0.2)
      C(m, M.chrome, 0.024, 0.045, 0, -0.005, -0.04)
      B(m, M.wood, 0.034, 0.1, 0.046, 0, -0.088, 0.06).rotation.x = -0.25
      g.muzzle.position.z = -0.28
      break
    }
    case 'autoshotgun': {
      // a drum under the receiver, all black, a red band
      recolour(M.wood, M.polymer)
      const drum = C(m, M.mag, 0.07, 0.07, 0, -0.08, -0.04)
      drum.rotation.set(0, 0, Math.PI / 2)
      C(m, M.red, 0.0145, 0.03, 0, 0.012, -0.5)
      break
    }
    case 'marksman': {
      // a longer barrel with a brake, a scope on rings, a bipod folded under
      C(m, M.steel, 0.011, 0.24, 0, 0, -0.66)
      B(m, M.black, 0.03, 0.026, 0.06, 0, 0, -0.8)
      C(m, M.black, 0.02, 0.2, 0, 0.1, -0.02)
      C(m, M.black, 0.027, 0.05, 0, 0.1, -0.13)
      for (const z of [-0.07, 0.04]) B(m, M.black, 0.012, 0.03, 0.012, 0, 0.078, z)
      for (const s of [-1, 1]) C(m, M.dark, 0.005, 0.18, s * 0.012, -0.035, -0.4)
      g.muzzle.position.z = -0.83
      break
    }
  }
}

// ---------------------------------------------------------------- reloading

/** How a reload is going: seconds since it began, since the last frame, and what the gun was. */
export interface ReloadState {
  clock: number
  prev: number
  /** The gun was empty: the slide or the charging handle has to be worked at the end. */
  empty: boolean
  /** Shotgun: loading shells or pumping; the first shell also lifts the gun (a lead-in). */
  phase: 'mag' | 'load' | 'pump'
  first: boolean
}

export type ReloadEvent = 'release' | 'drop' | 'grab' | 'insert' | 'rack' | 'pull' | 'shell' | 'pumpBack' | 'pumpFwd'

/** What the reload does to the viewmodel: moves it up and turns it, additive to the usual pose. */
export interface Pose {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

/** Seconds a shotgun shell takes, and the lead-in of the first one, and the pump. */
export const SHELL_T = 0.55
export const SHELL_LEAD = 0.25
export const PUMP_T = 0.55

/** Total seconds of a magazine reload (pistol, rifle). */
export const magReloadTime = (g: Gun, empty: boolean) => g.def.reload + (empty ? g.def.rack : 0)

const sm = (t: number, a: number, b: number) => {
  const k = THREE.MathUtils.clamp((t - a) / (b - a), 0, 1)
  return k * k * (3 - 2 * k)
}
const lerp3 = (out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, k: number) => out.copy(a).lerp(b, k)

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()

/** Where the left hand holds a magazine that is `s` metres out of its well: under its base plate. */
function underMag(g: Gun, s: number, out: THREE.Vector3) {
  return out.copy(g.well.at).addScaledVector(g.well.axis, s + g.well.h / 2 + 0.04)
}

/** Put the spare magazine in the hand that holds it from below. */
function spareInHand(g: Gun, hand: THREE.Vector3) {
  g.spare.position.copy(hand).addScaledVector(g.well.axis, -(g.well.h / 2 + 0.04))
  g.spare.rotation.copy(g.magMesh!.rotation)
}

/** The gun with the left hand back on it, nothing in the hand, the magazine seated. */
export function restGun(g: Gun, pose: Pose, kick: number, cooldownK: number) {
  pose.x = pose.y = pose.z = pose.rx = pose.ry = pose.rz = 0
  g.spare.visible = false
  if (g.magMesh) {
    g.magMesh.visible = true
    g.magMesh.position.copy(g.well.at)
  }
  if (g.slide) g.slide.position.z = g.mag <= 0 ? 0.045 : kick * 0.04 // the slide cycles, and locks back when empty
  if (g.charge) g.charge.position.z = CHARGE_Z
  if (g.pump) g.pump.position.z = -0.25 + Math.sin(THREE.MathUtils.clamp(cooldownK, 0, 1) * Math.PI) * 0.07
  tmpA.copy(g.rest)
  if (g.pump) tmpA.z += g.pump.position.z + 0.25
  g.arm.set(tmpA)
}

/** Fire `name` once when the clock passes `t`. */
const cross = (s: ReloadState, t: number) => s.prev < t && s.clock >= t

export function poseReload(g: Gun, s: ReloadState, pose: Pose, emit: (e: ReloadEvent) => void) {
  const t = s.clock
  const hand = tmpC
  pose.x = pose.y = pose.z = pose.rx = pose.ry = pose.rz = 0
  g.spare.visible = false
  if (g.def.base === 'pistol') pistol(g, s, t, pose, hand, emit)
  else if (g.def.base === 'rifle') rifle(g, s, t, pose, hand, emit)
  else shotgun(g, s, t, pose, hand, emit)
  g.arm.set(hand)
}

/** The gun rises towards the middle and rolls over so the magazine well faces the player. */
function lift(pose: Pose, k: number, roll = 0.7) {
  pose.x = -0.07 * k
  pose.y = 0.17 * k
  pose.z = 0.04 * k
  pose.rx = 0.4 * k
  pose.ry = 0.05 * k
  pose.rz = -roll * k
}

function pistol(g: Gun, s: ReloadState, t: number, pose: Pose, hand: THREE.Vector3, emit: (e: ReloadEvent) => void) {
  const T = magReloadTime(g, s.empty)
  const POUCH = V(-0.14, -0.26, 0.12)
  lift(pose, sm(t, 0, 0.25) * (1 - sm(t, T - 0.3, T)))
  const mag = g.magMesh!
  let out = 0 // how far the old magazine is out of the grip
  let seated = true
  // the slide is locked back when the gun ran dry, until the hand lets it go
  if (s.empty) g.slide!.position.z = t < 1.3 ? 0.045 : 0.045 * (1 - sm(t, 1.3, 1.34)) - 0.004 * Math.sin(sm(t, 1.34, 1.4) * Math.PI)
  else g.slide!.position.z = 0

  if (t < 0.3) {
    lerp3(hand, g.rest, underMag(g, 0, tmpA), sm(t, 0, 0.3))
  } else if (t < 0.54) {
    // the old magazine slides down out of the grip, pulled by the hand
    out = 0.16 * sm(t, 0.3, 0.54)
    underMag(g, out, hand)
    if (cross(s, 0.32)) emit('release')
    seated = true
  } else if (t < 0.74) {
    seated = false
    if (cross(s, 0.54)) emit('drop')
    lerp3(hand, underMag(g, 0.16, tmpA), POUCH, sm(t, 0.54, 0.74))
  } else if (t < 1.0) {
    seated = false
    if (cross(s, 0.74)) emit('grab')
    const k = sm(t, 0.74, 1.0)
    lerp3(hand, POUCH, underMag(g, 0.17, tmpA), k)
    hand.y += Math.sin(k * Math.PI) * 0.04
    g.spare.visible = true
    spareInHand(g, hand)
  } else if (t < 1.16) {
    // the new magazine goes up into the grip
    seated = false
    const sOut = 0.17 * (1 - sm(t, 1.0, 1.16))
    underMag(g, sOut, hand)
    g.spare.visible = true
    spareInHand(g, hand)
    if (cross(s, 1.14)) emit('insert')
  } else {
    seated = true
    const slap = Math.sin(sm(t, 1.16, 1.24) * Math.PI) * 0.012
    if (s.empty) {
      // the thumb drops the slide
      if (t < 1.3) lerp3(hand, underMag(g, 0, tmpA), V(-0.04, -0.015, 0.025), sm(t, 1.2, 1.3))
      else lerp3(hand, V(-0.04, -0.015, 0.025), g.rest, sm(t, 1.34, T - 0.05))
      if (cross(s, 1.3)) emit('rack')
    } else {
      lerp3(hand, underMag(g, 0, tmpA), g.rest, sm(t, 1.2, T - 0.05))
    }
    hand.y += slap
    pose.y += slap * 0.4
  }
  mag.visible = seated || (t >= 0.3 && t < 0.54)
  mag.position.copy(g.well.at).addScaledVector(g.well.axis, out)
}

function rifle(g: Gun, s: ReloadState, t: number, pose: Pose, hand: THREE.Vector3, emit: (e: ReloadEvent) => void) {
  const T = magReloadTime(g, s.empty)
  const POUCH = V(-0.17, -0.28, 0.1)
  lift(pose, sm(t, 0, 0.32) * (1 - sm(t, T - 0.35, T)), 0.85)
  const mag = g.magMesh!
  const side = V(-0.052, 0.0, 0.0)
  let out = 0
  let seated = true
  g.charge!.position.z = CHARGE_Z

  const handOnMag = (so: number, o: THREE.Vector3) => o.copy(g.well.at).addScaledVector(g.well.axis, so).add(side)

  if (t < 0.32) {
    lerp3(hand, g.rest, handOnMag(0, tmpA), sm(t, 0, 0.32))
  } else if (t < 0.66) {
    out = 0.2 * sm(t, 0.32, 0.66)
    handOnMag(out, hand)
    if (cross(s, 0.36)) emit('release')
  } else if (t < 0.98) {
    seated = false
    if (cross(s, 0.66)) emit('drop')
    lerp3(hand, handOnMag(0.2, tmpA), POUCH, sm(t, 0.66, 0.98))
  } else if (t < 1.46) {
    seated = false
    if (cross(s, 0.98)) emit('grab')
    // the fresh magazine rides in the hand, held from the side, and comes up under the well
    const k = sm(t, 0.98, 1.46)
    tmpB.copy(POUCH).addScaledVector(g.well.axis, 0)
    lerp3(hand, tmpB, handOnMag(0.21, tmpA), k)
    hand.y += Math.sin(k * Math.PI) * 0.05
    g.spare.visible = true
    g.spare.position.copy(hand).sub(side)
    g.spare.rotation.copy(mag.rotation)
  } else if (t < 1.62) {
    seated = false
    const so = 0.21 * (1 - sm(t, 1.46, 1.62))
    handOnMag(so, hand)
    g.spare.visible = true
    g.spare.position.copy(hand).sub(side)
    g.spare.rotation.copy(mag.rotation)
    if (cross(s, 1.6)) emit('insert')
  } else {
    seated = true
    const slap = Math.sin(sm(t, 1.62, 1.72) * Math.PI) * 0.014
    if (s.empty) {
      // over the top to the charging handle, back, and let go
      const handle = V(0.0, 0.065, 0.1)
      if (t < 1.86) lerp3(hand, handOnMag(0, tmpA), handle, sm(t, 1.7, 1.86))
      else if (t < 2.02) {
        const k = sm(t, 1.9, 2.02)
        g.charge!.position.z = CHARGE_Z + 0.07 * k
        hand.copy(handle)
        hand.z += 0.07 * k
        if (cross(s, 1.9)) emit('pull')
      } else if (t < 2.08) {
        const k = 1 - sm(t, 2.02, 2.07)
        g.charge!.position.z = CHARGE_Z + 0.07 * k
        hand.copy(handle)
        hand.z += 0.07 * k
        if (cross(s, 2.07)) emit('rack')
      } else lerp3(hand, handle, g.rest, sm(t, 2.1, T - 0.05))
      if (t >= 1.86 && t < 1.9) hand.copy(handle)
    } else {
      lerp3(hand, handOnMag(0, tmpA), g.rest, sm(t, 1.7, T - 0.05))
    }
    hand.y += slap
  }
  // the charging handle stays forward unless it is being pulled
  mag.visible = seated || (t >= 0.32 && t < 0.66)
  mag.position.copy(g.well.at).addScaledVector(g.well.axis, out)
}

function shotgun(g: Gun, s: ReloadState, t: number, pose: Pose, hand: THREE.Vector3, emit: (e: ReloadEvent) => void) {
  const pump = g.pump!
  const PUMP_REST = g.rest
  const POUCH = V(-0.14, -0.25, 0.08)
  const PORT = V(-0.03, -0.095, -0.02)
  if (s.phase === 'pump') {
    // the gun comes back down and the hand works the pump
    lift(pose, 1 - sm(t, 0, 0.2), 0.8)
    const back = sm(t, 0.2, 0.34) * (1 - sm(t, 0.34, 0.48))
    pump.position.z = -0.25 + 0.085 * back
    if (cross(s, 0.2)) emit('pumpBack')
    if (cross(s, 0.34)) emit('pumpFwd')
    tmpA.copy(PUMP_REST)
    tmpA.z += pump.position.z + 0.25
    lerp3(hand, PORT, tmpA, sm(t, 0, 0.2))
    return
  }
  pump.position.z = -0.25
  // one shell per cycle; the first cycle starts with the gun being lifted
  const lead = s.first ? SHELL_LEAD : 0
  const c = t - lead
  lift(pose, s.first ? sm(t, 0, SHELL_LEAD) : 1, 0.8)
  if (c < 0) {
    lerp3(hand, PUMP_REST, POUCH, sm(t, 0, SHELL_LEAD))
    return
  }
  if (c < 0.17) {
    // from the port (or the pump) down to the pouch
    lerp3(hand, s.first ? POUCH : V(-0.04, -0.12, -0.02), POUCH, sm(c, 0, 0.17))
    if (c > 0.1) {
      g.spare.visible = true
      g.spare.position.copy(hand).add(V(0.025, 0.03, 0))
    }
    if (s.prev - lead < 0.1 && c >= 0.1) emit('grab')
  } else if (c < 0.38) {
    const k = sm(c, 0.17, 0.38)
    lerp3(hand, POUCH, PORT, k)
    g.spare.visible = true
    g.spare.position.copy(hand).add(V(0.03, 0.03, 0))
    g.spare.rotation.set(0, 0, 0)
  } else if (c < 0.5) {
    // the shell is pushed up into the port
    const k = sm(c, 0.38, 0.5)
    hand.copy(PORT).add(V(0.0, 0.015 * k, 0))
    g.spare.visible = k < 1
    g.spare.position.set(0.0, -0.085 + 0.045 * k, -0.02 - 0.01 * k)
    g.spare.rotation.set(0, 0, 0)
    if (s.prev - lead < 0.46 && c >= 0.46) emit('shell')
  } else {
    lerp3(hand, PORT, V(-0.045, -0.13, -0.02), sm(c, 0.5, 0.55))
  }
}
