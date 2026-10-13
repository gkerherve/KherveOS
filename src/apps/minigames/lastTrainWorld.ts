// Last Train: the 3D world. The station (tiled walls, pillars, benches,
// fluorescent tubes, posters, stairs, the track and the tunnels on both
// sides), the three-car train with its sliding doors, and every texture,
// drawn on canvases: no image files. lastTrainEngine.ts plays the game in it.
//
// Axes: x runs along the platform, y up, z from the track (z < 0) to the
// back wall (z = 10). The platform top is y = 0, the track bed y = -1.3.

import * as THREE from 'three'

export const PLATFORM = { x0: -39.4, x1: 39.4, z0: 0.35, z1: 9.55 }
export const TRACK_Y = -1.3
export const CEIL_Y = 4.5
export const PILLARS = [-30, -20, -10, 0, 10, 20, 30].map((x) => ({ x, z: 5, r: 0.62 }))
export const STAIRS = [-20, 20]
/** The middle car's floor (the one the player rides), its door centres, the car pitch. */
export const CAR = { x0: -9.55, x1: 9.55, z0: -2.85, z1: -0.62 }
export const CAR_Z = -1.75
export const DOORS = [-6.5, 0, 6.5]
export const CAR_PITCH = 20.6
/** How far the train (or the world, during a ride) travels into the tunnel. Multiple of the lamp pitch. */
export const TRAVEL = 156
const LAMP_PITCH = 12
const REACH = 236

export interface Station {
  name: string
  color: string
}

export const STATIONS: Station[] = [
  { name: 'Kherve Square', color: '#2fbf71' },
  { name: 'Photon Lane', color: '#e8b730' },
  { name: 'Electron Avenue', color: '#3b8fe0' },
  { name: 'Lattice Gardens', color: '#d0533f' },
  { name: 'Spectrum Hill', color: '#9a5fd6' },
  { name: 'Raman Row', color: '#2bb3b1' },
  { name: 'Fermi Gate', color: '#e07a2f' },
  { name: 'Pyodide Park', color: '#c94f8f' },
]

export const stationAt = (i: number): Station => STATIONS[i % STATIONS.length]

// ---------------------------------------------------------------- helpers

export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

export function texture(c: HTMLCanvasElement, repeat?: [number, number], color = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  if (color) t.colorSpace = THREE.SRGBColorSpace
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(repeat[0], repeat[1])
  }
  t.anisotropy = 8
  return t
}

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex)
  c.multiplyScalar(f)
  return '#' + c.getHexString()
}

/** Vertical grime streaks and blotches over a texture. */
function grime(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, amount: number) {
  for (let i = 0; i < 40 * amount; i++) {
    const x = r() * w
    const y = r() * h * 0.6
    const len = 30 + r() * h * 0.5
    const grad = g.createLinearGradient(0, y, 0, y + len)
    grad.addColorStop(0, 'rgba(40,34,20,0)')
    grad.addColorStop(0.3, `rgba(40,34,20,${0.05 + r() * 0.12})`)
    grad.addColorStop(1, 'rgba(40,34,20,0)')
    g.fillStyle = grad
    g.fillRect(x, y, 2 + r() * 6, len)
  }
  for (let i = 0; i < 14 * amount; i++) {
    const x = r() * w
    const y = r() * h
    const rad = 10 + r() * 50
    const grad = g.createRadialGradient(x, y, 0, x, y, rad)
    grad.addColorStop(0, `rgba(30,28,18,${0.08 + r() * 0.12})`)
    grad.addColorStop(1, 'rgba(30,28,18,0)')
    g.fillStyle = grad
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  const bottom = g.createLinearGradient(0, h * 0.75, 0, h)
  bottom.addColorStop(0, 'rgba(25,22,14,0)')
  bottom.addColorStop(1, `rgba(25,22,14,${0.25 * amount})`)
  g.fillStyle = bottom
  g.fillRect(0, h * 0.75, w, h * 0.25)
}

/** Glossy subway tiles in running bond, with a bump map of the grout lines. */
function tiles(base: string, seed: number, dirt: number): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 512
  const H = 512
  const [c, g] = canvas(W, H)
  const [bc, bg] = canvas(W, H)
  const r = rng(seed)
  g.fillStyle = '#6f736c'
  g.fillRect(0, 0, W, H)
  bg.fillStyle = '#000'
  bg.fillRect(0, 0, W, H)
  const tw = 128
  const th = 64
  const gap = 5
  for (let row = 0; row < H / th; row++) {
    const off = row % 2 ? tw / 2 : 0
    for (let col = -1; col < W / tw + 1; col++) {
      const x = col * tw + off + gap / 2
      const y = row * th + gap / 2
      const v = 0.9 + r() * 0.14
      const grad = g.createLinearGradient(x, y, x, y + th)
      grad.addColorStop(0, shade(base, v * 1.06))
      grad.addColorStop(0.5, shade(base, v))
      grad.addColorStop(1, shade(base, v * 0.9))
      g.fillStyle = grad
      g.fillRect(x, y, tw - gap, th - gap)
      if (r() < 0.04) {
        // a cracked tile
        g.strokeStyle = 'rgba(30,30,30,0.5)'
        g.lineWidth = 1.2
        g.beginPath()
        g.moveTo(x + r() * tw, y)
        g.lineTo(x + r() * tw, y + th * 0.5)
        g.lineTo(x + r() * tw, y + th - gap)
        g.stroke()
      }
      bg.fillStyle = '#fff'
      bg.fillRect(x + 1, y + 1, tw - gap - 2, th - gap - 2)
    }
  }
  grime(g, W, H, r, dirt)
  return { map: texture(c), bump: texture(bc, undefined, false) }
}

function concrete(seed: number, base: string, speck: number, w = 512): THREE.CanvasTexture {
  const [c, g] = canvas(w, w)
  const r = rng(seed)
  g.fillStyle = base
  g.fillRect(0, 0, w, w)
  for (let i = 0; i < w * w * speck; i++) {
    const v = r()
    g.fillStyle = v < 0.5 ? `rgba(0,0,0,${r() * 0.25})` : `rgba(255,255,255,${r() * 0.12})`
    const s = 1 + r() * 2.5
    g.fillRect(r() * w, r() * w, s, s)
  }
  grime(g, w, w, r, 0.6)
  return texture(c)
}

function gravel(): THREE.CanvasTexture {
  const w = 256
  const [c, g] = canvas(w, w)
  const r = rng(7)
  g.fillStyle = '#2a2724'
  g.fillRect(0, 0, w, w)
  for (let i = 0; i < 1800; i++) {
    const v = 40 + r() * 70
    g.fillStyle = `rgb(${v},${v * 0.95},${v * 0.88})`
    g.beginPath()
    g.ellipse(r() * w, r() * w, 1.5 + r() * 3.5, 1 + r() * 3, r() * 3, 0, Math.PI * 2)
    g.fill()
  }
  return texture(c)
}

function tactile(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128)
  g.fillStyle = '#d9b31c'
  g.fillRect(0, 0, 128, 128)
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const grad = g.createRadialGradient(16 + x * 32 - 3, 16 + y * 32 - 3, 1, 16 + x * 32, 16 + y * 32, 10)
      grad.addColorStop(0, '#fff2a8')
      grad.addColorStop(1, '#b38f10')
      g.fillStyle = grad
      g.beginPath()
      g.arc(16 + x * 32, 16 + y * 32, 9, 0, Math.PI * 2)
      g.fill()
    }
  return texture(c)
}

function words(text: string, w: number, h: number, bg: string, fg: string, font: string, border?: string): THREE.CanvasTexture {
  const [c, g] = canvas(w, h)
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)
  if (border) {
    // a mosaic frame of little square tiles
    const s = h / 10
    for (let x = 0; x < w; x += s)
      for (const y of [0, h - s]) {
        g.fillStyle = shade(border, 0.8 + ((x / s) % 3) * 0.12)
        g.fillRect(x + 1, y + 1, s - 2, s - 2)
      }
    for (let y = s; y < h - s; y += s)
      for (const x of [0, w - s]) {
        g.fillStyle = shade(border, 0.85 + ((y / s) % 2) * 0.15)
        g.fillRect(x + 1, y + 1, s - 2, s - 2)
      }
  }
  g.fillStyle = fg
  g.font = font
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, w / 2, h / 2 + 2)
  return texture(c)
}

const POSTERS: [string, string, string, string][] = [
  ['KherveOS', 'An OS for the people', '#0d2a1c', '#2fbf71'],
  ['Learn to code', 'Free lessons in kCode', '#1b2340', '#7aa7ff'],
  ['KherveFitting', 'Peak fitting, made easy', '#2b1d10', '#f0a540'],
  ['Open source', 'Open minds', '#102a2a', '#3fd0c9'],
  ['City Science Museum', 'Free entry every Sunday', '#2a1030', '#d07ae8'],
  ['Mind the gap', 'Stand behind the yellow line', '#303030', '#e8c330'],
  ['KherveSheet', 'Spreadsheets that do science', '#122818', '#7ee08a'],
  ['Night trains', 'Every 10 minutes', '#101626', '#9fb4ff'],
]

function poster(i: number, seed: number): THREE.CanvasTexture {
  const [title, sub, bg, fg] = POSTERS[i % POSTERS.length]
  const W = 384
  const H = 256
  const [c, g] = canvas(W, H)
  const r = rng(seed)
  const grad = g.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, bg)
  grad.addColorStop(1, shade(fg, 0.35))
  g.fillStyle = grad
  g.fillRect(0, 0, W, H)
  g.globalAlpha = 0.5
  for (let k = 0; k < 6; k++) {
    g.strokeStyle = fg
    g.lineWidth = 1 + r() * 3
    g.beginPath()
    g.arc(W * 0.78, H * 0.45, 20 + k * 16, 0, Math.PI * 2)
    g.stroke()
  }
  g.globalAlpha = 1
  g.fillStyle = fg
  g.font = 'bold 42px Helvetica, Arial, sans-serif'
  g.fillText(title, 22, 92)
  g.fillStyle = '#f2f2ea'
  g.font = '22px Helvetica, Arial, sans-serif'
  g.fillText(sub, 22, 132)
  g.fillRect(22, 150, 90, 4)
  // wear: a torn corner and scuffs
  g.fillStyle = 'rgba(230,225,210,0.85)'
  g.beginPath()
  g.moveTo(W, H)
  g.lineTo(W - 30 - r() * 40, H)
  g.lineTo(W, H - 20 - r() * 40)
  g.fill()
  grime(g, W, H, r, 0.5)
  return texture(c)
}

export function lineMap(current: number, w = 1024, h = 128): HTMLCanvasElement {
  const [c, g] = canvas(w, h)
  g.fillStyle = '#f1efe6'
  g.fillRect(0, 0, w, h)
  const n = 8
  const x0 = 60
  const dx = (w - 120) / (n - 1)
  g.fillStyle = '#2fbf71'
  g.fillRect(x0, h * 0.45 - 6, w - 120, 12)
  for (let k = 0; k < n; k++) {
    const idx = current - 2 + k
    if (idx < 0) continue
    const s = stationAt(idx)
    const x = x0 + k * dx
    g.fillStyle = idx === current ? s.color : '#fff'
    g.strokeStyle = '#1b1b1b'
    g.lineWidth = 4
    g.beginPath()
    g.arc(x, h * 0.45, idx === current ? 14 : 10, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    g.fillStyle = idx < current ? '#9a9a90' : '#1b1b1b'
    g.font = `${idx === current ? 'bold ' : ''}17px Helvetica, Arial, sans-serif`
    g.textAlign = 'center'
    g.fillText(s.name, x, h * 0.82)
  }
  return c
}

/** The dot-matrix "next train" board. */
export function drawBoard(c: HTMLCanvasElement, line1: string, line2: string) {
  const g = c.getContext('2d')!
  g.fillStyle = '#080604'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#ffae2a'
  g.font = 'bold 30px "Courier New", monospace'
  g.textBaseline = 'middle'
  g.fillText(line1, 16, c.height * 0.3)
  g.fillText(line2, 16, c.height * 0.72)
  // the LED grid
  g.fillStyle = 'rgba(0,0,0,0.55)'
  for (let x = 0; x < c.width; x += 4) g.fillRect(x, 0, 1, c.height)
  for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 1)
}

export function sprite(kind: 'soft' | 'flash' | 'hole' | 'shadow'): THREE.CanvasTexture {
  const s = 128
  const [c, g] = canvas(s, s)
  if (kind === 'soft') {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.6)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, s, s)
  } else if (kind === 'flash') {
    g.translate(64, 64)
    for (let k = 0; k < 7; k++) {
      g.rotate((Math.PI * 2) / 7)
      const grad = g.createLinearGradient(0, 0, 0, -62)
      grad.addColorStop(0, 'rgba(255,240,200,1)')
      grad.addColorStop(1, 'rgba(255,140,30,0)')
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(-9, 0)
      g.lineTo(0, -62 + (k % 2) * 18)
      g.lineTo(9, 0)
      g.fill()
    }
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 34)
    grad.addColorStop(0, 'rgba(255,255,240,1)')
    grad.addColorStop(1, 'rgba(255,170,60,0)')
    g.fillStyle = grad
    g.fillRect(-64, -64, 128, 128)
  } else if (kind === 'hole') {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 60)
    grad.addColorStop(0, 'rgba(0,0,0,1)')
    grad.addColorStop(0.18, 'rgba(10,8,6,0.95)')
    grad.addColorStop(0.3, 'rgba(60,55,45,0.6)')
    grad.addColorStop(1, 'rgba(40,36,30,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, s, s)
  } else {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(0,0,0,0.65)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, s, s)
  }
  return texture(c)
}

// ---------------------------------------------------------------- building blocks

const tmpBox = new THREE.BoxGeometry(1, 1, 1)
const tmpCyl = new THREE.CylinderGeometry(1, 1, 1, 18)

function box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(tmpBox, mat)
  m.scale.set(w, h, d)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

function cyl(parent: THREE.Object3D, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y'): THREE.Mesh {
  const m = new THREE.Mesh(tmpCyl, mat)
  m.scale.set(r, len, r)
  if (axis === 'x') m.rotation.z = Math.PI / 2
  if (axis === 'z') m.rotation.x = Math.PI / 2
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

/** A plane with its texture repeated per metre. */
function panel(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  const uv = m.geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h)
  parent.add(m)
  return m
}

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o)

// ---------------------------------------------------------------- the station

export interface StationBuild {
  group: THREE.Group
  /** Meshes bullets hit (walls, floors, pillars, furniture). */
  solids: THREE.Object3D[]
  /** The "next train" board (redrawn by the engine). */
  board: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  /** The signal lenses at the tunnel mouths. */
  signals: { red: THREE.MeshStandardMaterial; green: THREE.MeshStandardMaterial }
  /** The fluorescent tube that flickers. */
  flicker: { mat: THREE.MeshStandardMaterial; light: THREE.PointLight }
  /** Where bullet holes and pickups go (cleared with the station). */
  litter: THREE.Group
  dispose(): void
}

export function buildStation(index: number): StationBuild {
  const st = stationAt(index)
  const r = rng(1000 + index * 77)
  const group = new THREE.Group()
  const solids: THREE.Object3D[] = []
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T): T => (owned.push(x), x)
  const solid = (m: THREE.Mesh) => (solids.push(m), m)

  const white = tiles('#e9e6da', 11 + index, 1)
  const band = tiles(st.color, 31 + index, 0.4)
  owned.push(white.map, white.bump, band.map, band.bump)
  /** Tiles repeated rx × ry times per UV unit (panels have UVs in metres: 0.5). */
  const wallMat = (rx: number, ry: number) => {
    const map = white.map.clone()
    const bump = white.bump.clone()
    for (const t of [map, bump]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(rx, ry)
      t.needsUpdate = true
      own(t)
    }
    return own(std({ map, bumpMap: bump, bumpScale: 1.4, roughness: 0.22, metalness: 0 }))
  }
  const wallPanel = wallMat(1.5, 1.5)
  const bandMat = (w: number) => {
    const map = band.map.clone()
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.repeat.set(w / 2, 0.25)
    map.needsUpdate = true
    own(map)
    return own(std({ map, roughness: 0.2, metalness: 0 }))
  }

  const floorTex = own(concrete(41 + index, '#7d7a72', 0.02))
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
  floorTex.repeat.set(1 / 4, 1 / 4)
  const floorMat = own(std({ map: floorTex, roughness: 0.55, metalness: 0.05 }))
  const darkConcrete = own(concrete(5, '#3b3a37', 0.03))
  darkConcrete.wrapS = darkConcrete.wrapT = THREE.RepeatWrapping
  darkConcrete.repeat.set(1 / 4, 1 / 4)
  const darkMat = own(std({ map: darkConcrete, roughness: 0.9 }))
  const metal = own(std({ color: 0x8a8d8f, roughness: 0.35, metalness: 0.85 }))
  const darkMetal = own(std({ color: 0x24272a, roughness: 0.5, metalness: 0.7 }))
  const black = own(std({ color: 0x0a0a0a, roughness: 0.9 }))

  // -- platform slab, its edge, the yellow line, "mind the gap"
  const floor = solid(panel(group, floorMat, 80, 10.2))
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, 0, 4.9)
  const edge = solid(box(group, darkMat, 80, 1.3, 0.25, 0, -0.65, 0.12))
  edge.receiveShadow = true
  box(group, own(std({ color: 0xbfbcb2, roughness: 0.7 })), 80, 0.06, 0.32, 0, -0.03, 0.04)
  const tact = own(tactile())
  tact.wrapS = tact.wrapT = THREE.RepeatWrapping
  tact.repeat.set(80 / 0.4, 1)
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(80, 0.4), own(std({ map: tact, roughness: 0.6 })))
  strip.rotation.x = -Math.PI / 2
  strip.position.set(0, 0.004, 0.45)
  group.add(strip)
  const gapTex = own(words('MIND THE GAP', 512, 96, 'rgba(0,0,0,0)', '#f2f2e8', 'bold 64px Helvetica, Arial, sans-serif'))
  const gapMat = own(new THREE.MeshStandardMaterial({ map: gapTex, transparent: true, roughness: 0.6, depthWrite: false }))
  for (const x of [-27, -2, 23]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.48), gapMat)
    m.rotation.x = -Math.PI / 2
    m.position.set(x, 0.005, 0.95)
    group.add(m)
  }

  // -- puddles and litter
  const puddle = own(std({ color: 0x0b0c0c, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.75 }))
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.5 + r() * 0.8, 24), puddle)
    m.scale.set(1.6 + r(), 1, 1)
    m.rotation.x = -Math.PI / 2
    m.position.set(-36 + r() * 72, 0.006, 1.5 + r() * 7)
    group.add(m)
  }
  const paper = own(std({ color: 0xd8d4c8, roughness: 0.95 }))
  const can = own(std({ color: 0xb03a2e, roughness: 0.3, metalness: 0.8 }))
  for (let i = 0; i < 14; i++) {
    const m = box(group, paper, 0.3 + r() * 0.2, 0.006, 0.4, -38 + r() * 76, 0.006, 1 + r() * 8.3)
    m.rotation.y = r() * Math.PI
  }
  for (let i = 0; i < 6; i++) {
    const m = cyl(group, can, 0.033, 0.12, -38 + r() * 76, 0.033, 1 + r() * 8.3, 'x')
    m.rotation.y = r() * Math.PI
  }

  // -- back wall (z = 10) with two stair openings
  const segs: [number, number][] = [[-40, -22], [-18, 18], [22, 40]]
  for (const [a, b] of segs) {
    const w = b - a
    const m = solid(panel(group, wallPanel, w, CEIL_Y))
    m.rotation.y = Math.PI
    m.position.set((a + b) / 2, CEIL_Y / 2, 10)
    solid(box(group, bandMat(w), w, 0.42, 0.06, (a + b) / 2, 2.55, 9.97))
    box(group, darkMat, w, 0.25, 0.04, (a + b) / 2, 0.125, 9.98)
  }
  for (const sx of STAIRS) {
    const lintel = solid(panel(group, wallPanel, 4, 1.5))
    lintel.rotation.y = Math.PI
    lintel.position.set(sx, 3.75, 10)
    buildStairs(group, sx, solids, wallPanel, floorMat, metal, own)
  }

  // name plaques, posters, benches, bins on the back wall
  const nameTex = own(words(st.name.toUpperCase(), 1024, 160, '#f4f1e6', '#1d1d1b', 'bold 84px Helvetica, Arial, sans-serif', st.color))
  const nameMat = own(std({ map: nameTex, roughness: 0.3 }))
  for (const x of [-30, -10, 10, 30]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.66), nameMat)
    m.rotation.y = Math.PI
    m.position.set(x, 3.3, 9.95)
    group.add(m)
  }
  const frame = own(std({ color: 0x1c1d1f, roughness: 0.4, metalness: 0.6 }))
  for (const [k, x] of [-25, -5, 15, 35].entries()) {
    const t = own(poster(k + index, 300 + index * 10 + k))
    solid(box(group, frame, 2.5, 1.7, 0.05, x, 1.65, 9.96))
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.36, 1.56), own(std({ map: t, roughness: 0.35 })))
    m.rotation.y = Math.PI
    m.position.set(x, 1.65, 9.93)
    group.add(m)
  }
  const wood = own(std({ color: 0x6b4a2b, roughness: 0.6 }))
  for (const x of [-35, -15, 5, 25]) bench(group, x, wood, darkMetal, solids)
  for (const x of [-12, 12, -32]) {
    solid(cyl(group, darkMetal, 0.28, 0.85, x, 0.425, 9.45))
    cyl(group, metal, 0.29, 0.05, x, 0.86, 9.45)
  }
  vending(group, 31.5, st.color, solids, own)
  mapBoard(group, 5, index, solids, own, frame)

  // -- pillars
  for (const p of PILLARS) {
    const m = solid(new THREE.Mesh(new THREE.BoxGeometry(0.8, CEIL_Y, 0.8), wallMat(1.2, 6.75)))
    m.position.set(p.x, CEIL_Y / 2, p.z)
    group.add(m)
    box(group, bandMat(1), 0.84, 0.42, 0.84, p.x, 2.55, p.z)
    box(group, darkMat, 0.84, 0.25, 0.84, p.x, 0.125, p.z)
    for (const s of [-1, 1]) {
      const n = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.13), nameMat)
      n.position.set(p.x, 1.85, p.z + s * 0.415)
      if (s < 0) n.rotation.y = Math.PI
      group.add(n)
    }
  }

  // -- ceiling, beams, pipes, tubes and lights
  const ceilTex = own(concrete(9, '#2c2c2a', 0.02))
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping
  ceilTex.repeat.set(1 / 5, 1 / 5)
  const ceil = solid(panel(group, own(std({ map: ceilTex, roughness: 0.95 })), 80, 14.6))
  ceil.rotation.x = Math.PI / 2
  ceil.position.set(0, CEIL_Y, 2.7)
  for (let x = -40; x <= 40; x += 5) box(group, darkMat, 0.35, 0.4, 14.6, x, CEIL_Y - 0.2, 2.7)
  for (const [z, rad] of [[-3.9, 0.09], [-3.6, 0.06], [9.6, 0.12]] as const) cyl(group, darkMetal, rad, 80, 0, 4.1, z, 'x')
  box(group, darkMetal, 80, 0.04, 0.5, 0, 3.75, -3.7)

  const tubeMat = own(std({ color: 0xffffff, emissive: 0xeefff6, emissiveIntensity: 3.2 }))
  const flickerMat = own(std({ color: 0xffffff, emissive: 0xeefff6, emissiveIntensity: 3.2 }))
  const housing = own(std({ color: 0xcfd2cc, roughness: 0.5, metalness: 0.4 }))
  const flickerAt = Math.floor(r() * 14)
  let k = 0
  for (const z of [2.2, 7.2]) {
    for (let x = -35; x <= 35; x += 10) {
      box(group, housing, 2.5, 0.08, 0.3, x, 4.22, z)
      box(group, k === flickerAt ? flickerMat : tubeMat, 2.35, 0.05, 0.07, x, 4.16, z - 0.06)
      box(group, k === flickerAt ? flickerMat : tubeMat, 2.35, 0.05, 0.07, x, 4.16, z + 0.06)
      k++
    }
  }
  let flickerLight: THREE.PointLight | null = null
  for (let x = -35; x <= 35; x += 10) {
    const l = new THREE.PointLight(0xe9fff2, 14, 17, 1.4)
    l.position.set(x, 3.95, 4.2)
    group.add(l)
    if (!flickerLight && Math.abs(x - (-35 + (flickerAt % 8) * 10)) < 1) flickerLight = l
  }
  const trackLight = new THREE.PointLight(0xdfeee8, 6, 16, 1.5)
  trackLight.position.set(0, 3.6, -2.2)
  group.add(trackLight)

  // -- the hanging clock and the next-train board
  const clock = clockFace()
  own(clock)
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 40), own(std({ map: clock, roughness: 0.3 })))
    m.position.set(-16, 3.35, 2.2 + s * 0.06)
    if (s < 0) m.rotation.y = Math.PI
    group.add(m)
  }
  cyl(group, darkMetal, 0.35, 0.1, -16, 3.35, 2.2, 'z')
  cyl(group, darkMetal, 0.015, 0.8, -16, 3.95, 2.2)
  const [bc] = canvas(512, 96)
  const boardTex = own(texture(bc))
  const boardMat = own(std({ color: 0x000000, emissive: 0xffffff, emissiveMap: boardTex, emissiveIntensity: 1.6 }))
  for (const x of [-20, 20]) {
    box(group, darkMetal, 3.0, 0.62, 0.22, x, 3.25, 2.2)
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.5), boardMat)
      m.position.set(x, 3.25, 2.2 + s * 0.115)
      if (s < 0) m.rotation.y = Math.PI
      group.add(m)
    }
    cyl(group, darkMetal, 0.015, 0.9, x - 1.2, 3.95, 2.2)
    cyl(group, darkMetal, 0.015, 0.9, x + 1.2, 3.95, 2.2)
  }

  // -- end walls of the platform
  for (const s of [-1, 1]) {
    const m = solid(panel(group, wallPanel, 10, CEIL_Y))
    m.rotation.y = -s * Math.PI / 2
    m.position.set(s * 40, CEIL_Y / 2, 5)
    const door = box(group, own(std({ color: 0x3c4a44, roughness: 0.5, metalness: 0.5 })), 0.06, 2.1, 1.1, s * 39.97, 1.05, 7.5)
    solids.push(door)
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.24),
      own(std({ map: own(words('STAFF ONLY', 256, 56, '#b22a1f', '#fff', 'bold 34px Helvetica, Arial, sans-serif')) })),
    )
    sign.position.set(s * 39.93, 2.35, 7.5)
    sign.rotation.y = -s * Math.PI / 2
    group.add(sign)
    // the portal over the tunnel mouth
    const p = solid(panel(group, wallPanel, 4.6, 1.3))
    p.rotation.y = -s * Math.PI / 2
    p.position.set(s * 40, 3.85, -2.3)
  }

  // -- the track: bed, sleepers, rails, third rail, the far wall with posters
  const grav = own(gravel())
  grav.wrapS = grav.wrapT = THREE.RepeatWrapping
  grav.repeat.set(REACH, 2)
  const bed = solid(new THREE.Mesh(new THREE.PlaneGeometry(REACH * 2, 4.6), own(std({ map: grav, roughness: 1 }))))
  bed.rotation.x = -Math.PI / 2
  bed.position.set(0, TRACK_Y, -2.3)
  group.add(bed)
  const sleeperMat = own(std({ color: 0x5f5a52, roughness: 0.95 }))
  const nSleepers = Math.floor((REACH * 2) / 0.7)
  const sleepers = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.24, 0.14, 2.5)), sleeperMat, nSleepers)
  const mtx = new THREE.Matrix4()
  for (let i = 0; i < nSleepers; i++) {
    mtx.makeTranslation(-REACH + i * 0.7, TRACK_Y + 0.07, CAR_Z)
    sleepers.setMatrixAt(i, mtx)
  }
  group.add(sleepers)
  const railMat = own(std({ color: 0x6b6058, roughness: 0.45, metalness: 0.9 }))
  const railTop = own(std({ color: 0xd6d8da, roughness: 0.18, metalness: 1 }))
  for (const z of [CAR_Z - 0.72, CAR_Z + 0.72]) {
    box(group, railMat, REACH * 2, 0.14, 0.07, 0, TRACK_Y + 0.21, z)
    box(group, railTop, REACH * 2, 0.025, 0.075, 0, TRACK_Y + 0.29, z)
  }
  box(group, own(std({ color: 0x8a6a3a, roughness: 0.8 })), REACH * 2, 0.05, 0.3, 0, TRACK_Y + 0.33, -0.4)
  box(group, metal, REACH * 2, 0.08, 0.08, 0, TRACK_Y + 0.25, -0.4)

  const far = solid(panel(group, wallPanel, 80, CEIL_Y - TRACK_Y))
  far.position.set(0, (CEIL_Y + TRACK_Y) / 2, -4.6)
  box(group, bandMat(80), 80, 0.42, 0.06, 0, 2.55, -4.57)
  const farName = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.66), nameMat)
  for (const x of [-20, 0, 20]) {
    const m = farName.clone()
    m.position.set(x, 3.3, -4.55)
    group.add(m)
  }
  for (let i = 0; i < 9; i++) {
    const x = -32 + i * 8
    if (Math.abs(x - 0) < 3 || Math.abs(x - 20) < 3 || Math.abs(x + 20) < 3) continue
    const t = own(poster(i + 3 + index, 500 + index * 13 + i))
    box(group, frame, 2.7, 1.8, 0.05, x, 1.0, -4.57)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.56, 1.66), own(std({ map: t, roughness: 0.35 })))
    m.position.set(x, 1.0, -4.54)
    group.add(m)
  }

  // -- signals at the tunnel mouths
  const red = own(std({ color: 0x200000, emissive: 0xff2a1a, emissiveIntensity: 4 }))
  const green = own(std({ color: 0x002000, emissive: 0x22ff66, emissiveIntensity: 0 }))
  for (const s of [-1, 1]) {
    box(group, black, 0.3, 0.75, 0.25, s * 39, 2.2, -4.2)
    const a = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 10), red)
    a.position.set(s * 39 - s * 0.0, 2.38, -4.06)
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 10), green)
    b.position.set(s * 39, 2.08, -4.06)
    group.add(a, b)
  }

  // -- tunnels beyond both ends
  for (const s of [-1, 1]) buildTunnel(group, s, solids, own)

  const litter = new THREE.Group()
  group.add(litter)

  return {
    group,
    solids,
    board: { canvas: bc, tex: boardTex },
    signals: { red, green },
    flicker: { mat: flickerMat, light: flickerLight ?? trackLight },
    litter,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry && m.geometry !== tmpBox && m.geometry !== tmpCyl) m.geometry.dispose()
      })
      for (const o of owned) o.dispose()
    },
  }
}

function buildStairs(
  group: THREE.Group,
  sx: number,
  solids: THREE.Object3D[],
  wallMat: THREE.Material,
  floorMat: THREE.Material,
  metal: THREE.Material,
  own: <T extends { dispose(): void }>(x: T) => T,
) {
  const n = 19
  for (let i = 0; i < n; i++) {
    const m = box(group, floorMat, 3.9, 0.2, 0.32, sx, 0.1 + i * 0.2, 10.16 + i * 0.3)
    m.scale.y = 0.2 + i * 0.2
    m.position.y = (0.2 + i * 0.2) / 2
    solids.push(m)
  }
  for (const s of [-1, 1]) {
    const w = solid(panel(group, wallMat, 6.4, 7))
    w.rotation.y = s * Math.PI / 2 * -1
    w.position.set(sx + s * 2, 3.5, 13.2)
    // handrail
    const rail = cyl(group, metal, 0.03, 6.6, sx + s * 1.85, 2.0, 13.0, 'z')
    rail.rotation.x = Math.PI / 2 - Math.atan2(3.8, 5.7)
  }
  const top = solid(panel(group, own(std({ color: 0x050505, roughness: 1 })), 4, 7))
  top.rotation.y = Math.PI
  top.position.set(sx, 3.5, 16.0)
  const roof = panel(group, own(std({ color: 0x1a1a19, roughness: 1 })), 4, 6.4)
  roof.rotation.x = Math.PI / 2
  roof.position.set(sx, 6.4, 13.2)
  const exit = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 0.36),
    own(std({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1.8, emissiveMap: own(words('EXIT ↑', 256, 76, '#118a3a', '#fff', 'bold 50px Helvetica, Arial, sans-serif')) })),
  )
  exit.rotation.y = Math.PI
  exit.position.set(sx, 3.2, 9.94)
  group.add(exit)
  function solid(m: THREE.Mesh) {
    solids.push(m)
    return m
  }
}

function bench(group: THREE.Group, x: number, wood: THREE.Material, legs: THREE.Material, solids: THREE.Object3D[]) {
  for (let i = 0; i < 3; i++) solids.push(box(group, wood, 2.2, 0.05, 0.12, x, 0.46, 9.15 + i * 0.14))
  for (let i = 0; i < 2; i++) {
    const b = box(group, wood, 2.2, 0.11, 0.04, x, 0.72 + i * 0.16, 9.58)
    b.rotation.x = -0.12
  }
  for (const s of [-1, 1]) {
    box(group, legs, 0.06, 0.46, 0.5, x + s * 0.95, 0.23, 9.3)
    box(group, legs, 0.06, 0.5, 0.06, x + s * 0.95, 0.68, 9.6)
  }
}

function vending(group: THREE.Group, x: number, color: string, solids: THREE.Object3D[], own: <T extends { dispose(): void }>(x: T) => T) {
  const [c, g] = canvas(256, 512)
  g.fillStyle = '#0d0f12'
  g.fillRect(0, 0, 256, 512)
  g.fillStyle = color
  g.fillRect(0, 0, 256, 70)
  g.fillStyle = '#fff'
  g.font = 'bold 36px Helvetica, Arial, sans-serif'
  g.textAlign = 'center'
  g.fillText('Kherve Fizz', 128, 46)
  const cols = ['#e04a3a', '#3a8fe0', '#f2c230', '#2fbf71', '#d07ae8']
  for (let row = 0; row < 5; row++)
    for (let k = 0; k < 4; k++) {
      g.fillStyle = cols[(row + k) % cols.length]
      g.fillRect(24 + k * 54, 96 + row * 72, 34, 54)
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillRect(28 + k * 54, 100 + row * 72, 6, 46)
    }
  const t = own(texture(c))
  solids.push(box(group, own(std({ color: 0x1e2226, roughness: 0.4, metalness: 0.6 })), 1.1, 2.0, 0.8, x, 1.0, 9.5))
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.72), own(std({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.1 })))
  front.rotation.y = Math.PI
  front.position.set(x, 1.05, 9.09)
  group.add(front)
  const glow = new THREE.PointLight(new THREE.Color(color), 2.5, 4, 2)
  glow.position.set(x, 1.1, 8.6)
  group.add(glow)
}

function mapBoard(group: THREE.Group, x: number, index: number, solids: THREE.Object3D[], own: <T extends { dispose(): void }>(x: T) => T, frame: THREE.Material) {
  const t = own(texture(lineMap(index)))
  solids.push(box(group, frame, 5.2, 0.8, 0.05, x, 1.75, 9.96))
  const m = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 0.62), own(std({ map: t, roughness: 0.3 })))
  m.rotation.y = Math.PI
  m.position.set(x, 1.75, 9.93)
  group.add(m)
}

function clockFace(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#f4f2ea'
  g.beginPath()
  g.arc(128, 128, 126, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#1b1b1b'
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    const big = i % 5 === 0
    g.save()
    g.translate(128, 128)
    g.rotate(a)
    g.fillRect(-(big ? 4 : 1.5), -116, big ? 8 : 3, big ? 22 : 9)
    g.restore()
  }
  const d = new Date()
  const hand = (a: number, len: number, w: number, col: string) => {
    g.save()
    g.translate(128, 128)
    g.rotate(a)
    g.fillStyle = col
    g.fillRect(-w / 2, -len, w, len + 14)
    g.restore()
  }
  hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, 62, 9, '#1b1b1b')
  hand((d.getMinutes() / 60) * Math.PI * 2, 96, 6, '#1b1b1b')
  hand((d.getSeconds() / 60) * Math.PI * 2, 100, 2, '#c4331f')
  return texture(c)
}

/** The tunnel from the platform end (|x| = 40) to REACH: walls, cables, lamps every LAMP_PITCH metres. */
function buildTunnel(group: THREE.Group, s: number, solids: THREE.Object3D[], own: <T extends { dispose(): void }>(x: T) => T) {
  const len = REACH - 40
  const cx = s * (40 + len / 2)
  const tex = own(concrete(77, '#3a3936', 0.03))
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1 / 6, 1 / 6)
  const mat = own(std({ map: tex, roughness: 0.95 }))
  const h = 4.5
  const yc = TRACK_Y + h / 2
  for (const [z, ry] of [[-4.2, 0], [0.6, Math.PI]] as const) {
    const w = solids[solids.push(panel(group, mat, len, h)) - 1] as THREE.Mesh
    w.rotation.y = ry
    w.position.set(cx, yc, z)
  }
  const roof = panel(group, mat, len, 4.8)
  roof.rotation.x = Math.PI / 2
  roof.position.set(cx, TRACK_Y + h, -1.8)
  solids.push(roof)
  const cable = own(std({ color: 0x111111, roughness: 0.6 }))
  for (const [z, y] of [[-4.1, 1.6], [-4.1, 1.75], [-4.1, 1.9], [0.5, 1.2]] as const) cyl(group, cable, 0.025, len, cx, y, z, 'x')
  const lamp = own(std({ color: 0xffffff, emissive: 0xffe2a8, emissiveIntensity: 5 }))
  const cage = own(std({ color: 0x222222, roughness: 0.6, metalness: 0.5 }))
  const first = Math.ceil(46 / LAMP_PITCH) * LAMP_PITCH
  for (let x = first; x <= REACH; x += LAMP_PITCH) {
    box(group, cage, 0.34, 0.2, 0.14, s * x, 2.3, -4.12)
    box(group, lamp, 0.24, 0.1, 0.06, s * x, 2.3, -4.05)
    // a refuge alcove marker every other lamp
    if ((x / LAMP_PITCH) % 2 === 0) box(group, own(std({ color: 0xc9c9c0, roughness: 0.8 })), 0.5, 0.06, 0.02, s * x, 0.9, -4.17)
  }
}

// ---------------------------------------------------------------- the train

export interface TrainBuild {
  group: THREE.Group
  solids: THREE.Object3D[]
  /** Door leaves of every car, with their closed x and opening direction. */
  leaves: { mesh: THREE.Object3D; x: number; dir: number }[]
  light: THREE.PointLight
  stripe: THREE.MeshStandardMaterial
  map: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  dispose(): void
}

export function buildTrain(index: number): TrainBuild {
  const group = new THREE.Group()
  const solids: THREE.Object3D[] = []
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T): T => (owned.push(x), x)
  const leaves: TrainBuild['leaves'] = []

  const steel = own(std({ color: 0x9da3a8, roughness: 0.42, metalness: 0.75 }))
  const skirt = own(std({ color: 0x1b1d1f, roughness: 0.7, metalness: 0.4 }))
  const stripe = own(std({ color: stationAt(index).color, roughness: 0.35, metalness: 0.3 }))
  const glass = own(new THREE.MeshPhysicalMaterial({ color: 0x9fb8c0, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false }))
  const floorTex = own(concrete(3, '#30343a', 0.04, 256))
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
  floorTex.repeat.set(1 / 2, 1 / 2)
  const floor = own(std({ map: floorTex, roughness: 0.8 }))
  const inner = own(std({ color: 0xb8b6ac, roughness: 0.6 }))
  const seat = own(std({ color: 0x2f4f8f, roughness: 0.85 }))
  const chrome = own(std({ color: 0xe8eaec, roughness: 0.12, metalness: 1 }))
  const ceilingLight = own(std({ color: 0xffffff, emissive: 0xfffbea, emissiveIntensity: 0.85 }))
  const wheel = own(std({ color: 0x2a2726, roughness: 0.5, metalness: 0.8 }))
  const head = own(std({ color: 0x000000, emissive: 0xfff6d8, emissiveIntensity: 6 }))
  const tail = own(std({ color: 0x000000, emissive: 0xff2010, emissiveIntensity: 4 }))

  const mapCanvas = lineMap(index, 1024, 96)
  const mapTex = own(texture(mapCanvas))
  const mapMat = own(std({ map: mapTex, roughness: 0.4 }))
  const ads = [0, 2, 6, 3].map((k) => own(std({ map: own(poster(k, 900 + k)), roughness: 0.4 })))

  const L = 20
  const W = 3.0
  const zIn = CAR_Z - W / 2 // far side
  const zOut = CAR_Z + W / 2 // platform side

  for (const [ci, cx] of [-CAR_PITCH, 0, CAR_PITCH].entries()) {
    const car = new THREE.Group()
    car.position.x = cx
    group.add(car)
    // floor, roof, underframe
    solids.push(box(car, floor, L, 0.12, W, 0, -0.06, CAR_Z))
    box(car, inner, L, 0.06, W - 0.1, 0, 2.32, CAR_Z)
    const roof = box(car, steel, L + 0.1, 0.22, W - 0.2, 0, 2.5, CAR_Z)
    solids.push(roof)
    for (const s of [-1, 1]) {
      const eave = cyl(car, steel, 0.16, L + 0.1, 0, 2.38, CAR_Z + s * (W / 2 - 0.12), 'x')
      eave.scale.x = 0.16
    }
    box(car, skirt, L - 0.4, 0.75, W - 0.3, 0, -0.5, CAR_Z)
    for (const bx of [-7, 7]) {
      box(car, skirt, 2.4, 0.3, 1.9, bx, -0.9, CAR_Z)
      for (const wx of [-0.8, 0.8])
        for (const wz of [-0.72, 0.72]) cyl(car, wheel, 0.38, 0.12, bx + wx, TRACK_Y + 0.62, CAR_Z + wz, 'z')
    }
    // ceiling light strips and the interior
    for (const s of [-1, 1]) box(car, ceilingLight, L - 1.5, 0.03, 0.18, 0, 2.28, CAR_Z + s * 0.62)
    for (const s of [-1, 1]) {
      // longitudinal seats between the doors
      for (const [a, b] of [[-9.6, -7.3], [-5.7, -0.8], [0.8, 5.7], [7.3, 9.6]] as const) {
        const z = CAR_Z + s * (W / 2 - 0.36)
        solids.push(box(car, seat, b - a, 0.12, 0.48, (a + b) / 2, 0.46, z))
        box(car, seat, b - a, 0.52, 0.08, (a + b) / 2, 0.78, CAR_Z + s * (W / 2 - 0.1))
        box(car, skirt, b - a - 0.1, 0.4, 0.4, (a + b) / 2, 0.2, z)
      }
      cyl(car, chrome, 0.018, L - 1, 0, 1.95, CAR_Z + s * 0.75, 'x')
    }
    for (const d of DOORS)
      for (const s of [-1, 1]) cyl(car, chrome, 0.02, 2.3, d + s * 0.85, 1.15, CAR_Z + 0.95)
    for (const x of [-3.3, 3.3]) cyl(car, chrome, 0.02, 2.3, x, 1.15, CAR_Z)
    // line maps and ads above the windows
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.38), mapMat)
      m.position.set(-3.2 * s, 2.08, s < 0 ? zOut - 0.12 : zIn + 0.12)
      if (s < 0) m.rotation.y = Math.PI
      car.add(m)
      const a = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.36), ads[(ci + (s > 0 ? 1 : 0)) % ads.length])
      a.position.set(3.2 * s, 2.08, s < 0 ? zOut - 0.12 : zIn + 0.12)
      if (s < 0) a.rotation.y = Math.PI
      car.add(a)
    }

    // the two sides: panels with windows around the doors
    for (const side of [1, -1]) {
      const z = side > 0 ? zOut : zIn
      const spans: [number, number][] = [[-L / 2, -7.2], [-5.8, -0.7], [0.7, 5.8], [7.2, L / 2]]
      for (const [a, b] of spans) {
        const w = b - a
        const cxp = (a + b) / 2
        solids.push(box(car, steel, w, 0.95, 0.08, cxp, 0.475, z))
        box(car, steel, w, 0.55, 0.08, cxp, 2.08, z)
        box(car, stripe, w, 0.14, 0.02, cxp, 1.02, z + side * 0.05)
        const panes = Math.max(1, Math.round(w / 1.4))
        for (let p = 0; p <= panes; p++) box(car, steel, 0.1, 0.86, 0.08, a + (w * p) / panes, 1.38, z)
        box(car, glass, w, 0.86, 0.02, cxp, 1.38, z)
        if (side > 0) box(car, inner, w, 0.95, 0.02, cxp, 0.475, z - 0.06)
      }
      for (const d of DOORS) {
        box(car, steel, 1.6, 0.35, 0.08, d, 2.18, z)
        for (const half of [-1, 1]) {
          const leaf = new THREE.Group()
          leaf.position.set(d + half * 0.35, 0, z - side * 0.07)
          box(leaf, steel, 0.7, 1.0, 0.05, 0, 0.5, 0)
          box(leaf, steel, 0.7, 0.2, 0.05, 0, 1.9, 0)
          box(leaf, steel, 0.1, 0.8, 0.05, half * 0.3, 1.4, 0)
          box(leaf, glass, 0.5, 0.8, 0.02, -half * 0.05, 1.4, 0)
          box(leaf, own(std({ color: 0x202020, roughness: 0.8 })), 0.03, 2.0, 0.07, -half * 0.335, 1.0, 0)
          box(leaf, stripe, 0.7, 0.14, 0.02, 0, 1.02, side * 0.03)
          car.add(leaf)
          leaf.children.forEach((c) => solids.push(c))
          if (side > 0) leaves.push({ mesh: leaf, x: d + half * 0.35, dir: half })
        }
      }
    }
    // end walls with a gangway door
    for (const s of [-1, 1]) {
      const x = s * (L / 2)
      for (const z of [CAR_Z - 0.95, CAR_Z + 0.95]) solids.push(box(car, ci === 1 ? inner : steel, 0.08, 2.4, 1.1, x, 1.15, z))
      box(car, steel, 0.08, 0.5, 0.8, x, 2.1, CAR_Z)
      box(car, glass, 0.03, 1.0, 0.7, x, 1.4, CAR_Z)
      solids.push(box(car, skirt, 0.08, 0.9, 0.8, x, 0.45, CAR_Z))
      // the outer ends: a cab face with lights
      const outer = (ci === 0 && s < 0) || (ci === 2 && s > 0)
      if (outer) {
        box(car, stripe, 0.04, 0.3, W - 0.3, x + s * 0.05, 0.3, CAR_Z)
        for (const z of [-1, 1]) {
          const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), s > 0 ? head : tail)
          lamp.position.set(x + s * 0.08, 0.25, CAR_Z + z * 1.0)
          lamp.rotation.y = (s * Math.PI) / 2
          car.add(lamp)
        }
      }
    }
  }
  const light = new THREE.PointLight(0xfff7e6, 3.2, 12, 1.6)
  light.position.set(0, 2.05, CAR_Z)
  group.add(light)
  const light2 = new THREE.PointLight(0xfff7e6, 1.6, 8, 1.6)
  light2.position.set(30, 2.05, CAR_Z)
  group.add(light2)
  // the headlights throw light into the tunnel ahead
  const beam = new THREE.SpotLight(0xfff2d0, 60, 45, 0.5, 0.6, 1.2)
  beam.position.set(CAR_PITCH + 10.3, 0.4, CAR_Z)
  beam.target.position.set(CAR_PITCH + 30, -0.4, CAR_Z)
  group.add(beam, beam.target)

  return {
    group,
    solids,
    leaves,
    light,
    stripe,
    map: { canvas: mapCanvas, tex: mapTex },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry && m.geometry !== tmpBox && m.geometry !== tmpCyl) m.geometry.dispose()
      })
      for (const o of owned) o.dispose()
    },
  }
}

/** Redraw the line map inside the cars for a new station. */
export function updateTrainMap(t: TrainBuild, index: number) {
  const fresh = lineMap(index, t.map.canvas.width, t.map.canvas.height)
  t.map.canvas.getContext('2d')!.drawImage(fresh, 0, 0)
  t.map.tex.needsUpdate = true
  t.stripe.color.set(stationAt(index).color)
}
