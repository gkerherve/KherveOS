// Last Train: the train. Three walk-through cars (stainless skin with a
// coloured stripe, sliding doors, windows, moquette seats, grab rails and
// straps, a curved roof, bogies and a rounded cab at each end) joined by
// rubber gangways, so the player can board any car and walk the whole train.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  box, CAR_L as L, CAR_PITCH, CAR_W as W, CAR_XS, CAR_Z, canvas, cyl, DOORS, grime, lineMap, panel, poster, rng, shade, stain, stationAt, std, texture,
  tmpBox, tmpCyl, TRACK_Y, vaultGeometry, vaultY, words,
} from './lastTrainWorld'

export interface TrainBuild {
  group: THREE.Group
  solids: THREE.Object3D[]
  /** Door leaves of every car (platform side), with their closed x and opening direction. */
  leaves: { mesh: THREE.Object3D; x: number; dir: number }[]
  light: THREE.PointLight
  lights: THREE.PointLight[]
  stripe: THREE.MeshStandardMaterial
  /** The amber lamps over the doors: lit while the doors move or stand open. */
  lamp: THREE.MeshStandardMaterial
  map: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  /** The LED panels above the doors, and the destination board on the cab. */
  display: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  dest: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }
  dispose(): void
}

// ---------------------------------------------------------------- textures

/** Brushed stainless steel with fine vertical flutes, rain streaks and a little rust at the bottom. */
function steelTexture(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const S = 256
  const [c, g] = canvas(S, S)
  const [bc, bg] = canvas(S, S)
  const r = rng(321)
  g.fillStyle = '#c6cbce'
  g.fillRect(0, 0, S, S)
  bg.fillStyle = '#808080'
  bg.fillRect(0, 0, S, S)
  for (let x = 0; x < S; x += 16) {
    const grad = g.createLinearGradient(x, 0, x + 16, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0.16)')
    grad.addColorStop(0.45, 'rgba(255,255,255,0)')
    grad.addColorStop(0.55, 'rgba(0,0,0,0)')
    grad.addColorStop(1, 'rgba(0,0,0,0.16)')
    g.fillStyle = grad
    g.fillRect(x, 0, 16, S)
    const bgrad = bg.createLinearGradient(x, 0, x + 16, 0)
    bgrad.addColorStop(0, '#d0d0d0')
    bgrad.addColorStop(0.5, '#808080')
    bgrad.addColorStop(1, '#303030')
    bg.fillStyle = bgrad
    bg.fillRect(x, 0, 16, S)
  }
  for (let i = 0; i < 260; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'
    g.fillRect(r() * S, r() * S, 1, 12 + r() * 50)
  }
  grime(g, S, S, r, 0.45)
  return { map: texture(c), bump: texture(bc, undefined, false) }
}

/** Woven seat fabric: the colour of the car with a repeating pattern, worn at the edges. */
function moquette(base: string, accent: string, seed: number): THREE.CanvasTexture {
  const S = 128
  const [c, g] = canvas(S, S)
  const r = rng(seed)
  g.fillStyle = base
  g.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y += 16)
    for (let x = 0; x < S; x += 16) {
      const ox = (y / 16) % 2 ? 8 : 0
      g.fillStyle = accent
      g.globalAlpha = 0.75
      g.beginPath()
      g.moveTo(x + ox + 8, y + 3)
      g.lineTo(x + ox + 13, y + 8)
      g.lineTo(x + ox + 8, y + 13)
      g.lineTo(x + ox + 3, y + 8)
      g.fill()
      g.globalAlpha = 0.5
      g.fillStyle = shade(base, 1.5)
      g.fillRect(x + ox + 7, y + 7, 2, 2)
    }
  g.globalAlpha = 1
  for (let i = 0; i < 700; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)'
    g.fillRect(r() * S, r() * S, 1 + r() * 2, 1)
  }
  return texture(c)
}

/** Dark moulded rubber flooring, worn lighter along the aisle. */
function rubberTexture(): THREE.CanvasTexture {
  const S = 256
  const [c, g] = canvas(S, S)
  const r = rng(77)
  g.fillStyle = '#3b3f45'
  g.fillRect(0, 0, S, S)
  for (let y = 0; y < S; y += 8)
    for (let x = 0; x < S; x += 8) {
      g.fillStyle = 'rgba(255,255,255,0.09)'
      g.beginPath()
      g.arc(x + 4, y + 4, 2.3, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = 'rgba(0,0,0,0.25)'
      g.beginPath()
      g.arc(x + 5, y + 5, 2, 0, Math.PI * 2)
      g.fill()
    }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'
    g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 2)
  }
  grime(g, S, S, r, 0.6)
  return texture(c)
}

/** Corrugated rubber: the walls of the gangways. */
function ribbedTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64)
  g.fillStyle = '#121315'
  g.fillRect(0, 0, 64, 64)
  for (let y = 0; y < 64; y += 8) {
    const grad = g.createLinearGradient(0, y, 0, y + 8)
    grad.addColorStop(0, 'rgba(255,255,255,0.18)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0)')
    grad.addColorStop(1, 'rgba(0,0,0,0.5)')
    g.fillStyle = grad
    g.fillRect(0, y, 64, 8)
  }
  return texture(c)
}

function hazardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64)
  g.fillStyle = '#e8b81c'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#17181a'
  for (let i = -2; i < 4; i++) {
    g.beginPath()
    g.moveTo(i * 32, 0)
    g.lineTo(i * 32 + 16, 0)
    g.lineTo(i * 32 + 16 + 64, 64)
    g.lineTo(i * 32 + 64, 64)
    g.fill()
  }
  return texture(c)
}

/** A smashed window: cracks fanning out of an impact, with a few white chips. */
function crackTexture(seed: number): THREE.CanvasTexture {
  const W2 = 256
  const H2 = 128
  const [c, g] = canvas(W2, H2)
  const r = rng(seed)
  const cx = W2 * (0.3 + r() * 0.4)
  const cy = H2 * (0.3 + r() * 0.4)
  g.strokeStyle = 'rgba(235,245,250,0.85)'
  g.lineCap = 'round'
  const spokes = 11
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + r() * 0.3
    let x = cx
    let y = cy
    g.lineWidth = 1.4
    g.beginPath()
    g.moveTo(x, y)
    for (let k = 0; k < 6; k++) {
      x += Math.cos(a + (r() - 0.5) * 0.4) * (14 + r() * 26)
      y += Math.sin(a + (r() - 0.5) * 0.4) * (14 + r() * 26)
      g.lineTo(x, y)
    }
    g.stroke()
  }
  for (let ring = 1; ring <= 3; ring++) {
    g.lineWidth = 0.9
    g.beginPath()
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2
      const rad = ring * 20 + r() * 8
      const x = cx + Math.cos(a) * rad
      const y = cy + Math.sin(a) * rad
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    }
    g.stroke()
  }
  g.fillStyle = 'rgba(255,255,255,0.9)'
  g.beginPath()
  g.arc(cx, cy, 4, 0, Math.PI * 2)
  g.fill()
  return texture(c)
}

function roundedRect(w: number, h: number, rad: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  s.moveTo(x + rad, 0)
  s.lineTo(x + w - rad, 0)
  s.quadraticCurveTo(x + w, 0, x + w, rad)
  s.lineTo(x + w, h - rad)
  s.quadraticCurveTo(x + w, h, x + w - rad, h)
  s.lineTo(x + rad, h)
  s.quadraticCurveTo(x, h, x, h - rad)
  s.lineTo(x, rad)
  s.quadraticCurveTo(x, 0, x + rad, 0)
  return s
}

/** The LED panel over the doors and on the cab: two amber lines. */
export function drawDisplay(c: HTMLCanvasElement, line1: string, line2: string, size = 30) {
  const g = c.getContext('2d')!
  g.fillStyle = '#070503'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#ffae2a'
  g.font = `bold ${size}px "Courier New", monospace`
  g.textBaseline = 'middle'
  g.textAlign = 'center'
  g.fillText(line1, c.width / 2, c.height * 0.3)
  g.fillText(line2, c.width / 2, c.height * 0.72)
  g.fillStyle = 'rgba(0,0,0,0.5)'
  for (let x = 0; x < c.width; x += 3) g.fillRect(x, 0, 1, c.height)
  for (let y = 0; y < c.height; y += 3) g.fillRect(0, y, c.width, 1)
}

// ---------------------------------------------------------------- the train

const SEAT_RUNS: [number, number][] = [[-9.55, -7.3], [-5.7, -0.8], [0.8, 5.7], [7.3, 9.55]]
const COLOURWAYS: [string, string][] = [
  ['#27467f', '#6f94d8'],
  ['#6e2530', '#d28a8a'],
  ['#24604f', '#79c9a9'],
]

export function buildTrain(index: number): TrainBuild {
  const group = new THREE.Group()
  const solids: THREE.Object3D[] = []
  const owned: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(x: T): T => (owned.push(x), x)
  const leaves: TrainBuild['leaves'] = []
  const solid = <T extends THREE.Object3D>(m: T): T => (solids.push(m), m)

  // -- materials
  const steel = steelTexture()
  owned.push(steel.map, steel.bump)
  const fluted = (rx: number, ry: number) => {
    const map = steel.map.clone()
    const bump = steel.bump.clone()
    for (const t of [map, bump]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(rx, ry)
      t.needsUpdate = true
      own(t)
    }
    return own(std({ map, bumpMap: bump, bumpScale: 0.3, roughness: 0.5, metalness: 0.66 }))
  }
  const skin = fluted(2, 2)
  const skinBox = fluted(1.4, 1.4)
  const roofMat = own(fluted(2, 2))
  roofMat.side = THREE.DoubleSide
  const frameMat = own(std({ color: 0x14171a, roughness: 0.55, metalness: 0.5 }))
  const rubber = own(std({ color: 0x0e0f10, roughness: 0.9 }))
  const stripe = own(std({ color: stationAt(index).color, roughness: 0.35, metalness: 0.3 }))
  const white = own(std({ color: 0xe9ebe8, roughness: 0.4, metalness: 0.2 }))
  const glass = own(new THREE.MeshPhysicalMaterial({ color: 0xa4c2cc, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false }))
  const windscreen = own(new THREE.MeshPhysicalMaterial({ color: 0x0a1218, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.88, depthWrite: false }))
  const chrome = own(std({ color: 0xe8eaec, roughness: 0.12, metalness: 1 }))
  const lining = own(std({ color: 0xd9d6cb, roughness: 0.55, metalness: 0.05 }))
  const liningLow = own(std({ color: 0xa79f8c, roughness: 0.6, metalness: 0.05 }))
  const ceilMat = own(std({ color: 0xe6e4da, roughness: 0.8, side: THREE.DoubleSide }))
  const underFrame = own(std({ color: 0x1b1d1f, roughness: 0.7, metalness: 0.45 }))
  const wheelMat = own(std({ color: 0x2a2726, roughness: 0.45, metalness: 0.85 }))
  const ceilingLight = own(std({ color: 0xffffff, emissive: 0xfffbea, emissiveIntensity: 0.55 }))
  const head = own(std({ color: 0x000000, emissive: 0xfff6d8, emissiveIntensity: 7 }))
  const tail = own(std({ color: 0x000000, emissive: 0xff2010, emissiveIntensity: 4.5 }))
  const lamp = own(std({ color: 0x000000, emissive: 0xffa010, emissiveIntensity: 0 }))
  const floorTex = own(rubberTexture())
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping
  floorTex.repeat.set(1, 1)
  const floorMat = own(std({ map: floorTex, roughness: 0.62, metalness: 0.05 }))
  const hazTex = own(hazardTexture())
  hazTex.wrapS = hazTex.wrapT = THREE.RepeatWrapping
  const hazard = own(std({ map: hazTex, roughness: 0.6 }))
  const ribTex = own(ribbedTexture())
  ribTex.wrapS = ribTex.wrapT = THREE.RepeatWrapping
  ribTex.repeat.set(1, 6)
  const ribs = own(std({ map: ribTex, roughness: 0.85, side: THREE.DoubleSide }))
  const plate = own(std({ color: 0x70767a, roughness: 0.4, metalness: 0.85 }))

  const mapCanvas = lineMap(index, 1024, 96)
  const mapTex = own(texture(mapCanvas))
  const mapMat = own(std({ map: mapTex, roughness: 0.4 }))
  const [dc] = canvas(512, 96)
  drawDisplay(dc, 'KHERVE LINE', stationAt(index + 1).name)
  const displayTex = own(texture(dc))
  const displayMat = own(std({ color: 0x000000, emissive: 0xffffff, emissiveMap: displayTex, emissiveIntensity: 1.5 }))
  const [dc2] = canvas(512, 96)
  drawDisplay(dc2, 'LAST TRAIN', stationAt(index + 1).name, 34)
  const destTex = own(texture(dc2))
  const destMat = own(std({ color: 0x000000, emissive: 0xffffff, emissiveMap: destTex, emissiveIntensity: 1.7 }))
  const ads = [0, 2, 6, 3, 1, 7].map((k) => own(std({ map: own(poster(k, 900 + k)), roughness: 0.4 })))
  const crackMats = [0, 1, 2, 3].map((k) => own(new THREE.MeshBasicMaterial({ map: own(crackTexture(40 + k)), transparent: true, depthWrite: false, opacity: 0.9 })))
  const bloodMats = [0, 1, 2].map((k) => own(new THREE.MeshBasicMaterial({ map: own(stain(900 + k)), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })))
  const seatGeo = own(new RoundedBoxGeometry(1, 1, 1, 3, 0.2))
  const ringGeo = own(new THREE.TorusGeometry(0.07, 0.012, 6, 16))
  const strapGeo = own(new THREE.BoxGeometry(0.035, 0.34, 0.012))

  const zOut = CAR_Z + W / 2

  // the faces are planes (UVs in metres); `face` is the way the plane looks
  const wall = (parent: THREE.Object3D, mat: THREE.Material, a: number, b: number, y0: number, y1: number, z: number, face: 1 | -1) => {
    const m = panel(parent, mat, b - a, y1 - y0)
    m.position.set((a + b) / 2, (y0 + y1) / 2, z)
    if (face < 0) m.rotation.y = Math.PI
    return m
  }

  for (const [ci, cx] of CAR_XS.entries()) {
    const car = new THREE.Group()
    car.position.x = cx
    group.add(car)
    const [seatBase, seatAccent] = COLOURWAYS[ci]
    const seatMat = own(std({ map: own(moquette(seatBase, seatAccent, 200 + ci)), roughness: 0.92 }))
    const B = (m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => box(car, m, w, h, d, x, y, z)

    // -- floor: a rubber top over the deck, thresholds, stains
    solid(B(underFrame, L, 0.12, W, 0, -0.06, CAR_Z))
    const deck = panel(car, floorMat, L, W - 0.18)
    deck.rotation.x = -Math.PI / 2
    deck.position.set(0, 0.002, CAR_Z)
    for (const d of DOORS) for (const side of [1, -1]) B(hazard, 1.4, 0.014, 0.16, d, 0.008, CAR_Z + side * 1.33).scale.set(1.4, 0.014, 0.16)
    for (let i = 0; i < 3; i++) {
      const s = 1 + (i + ci) * 0.4
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), bloodMats[(i + ci) % 3])
      m.rotation.x = -Math.PI / 2
      m.rotation.z = (i + ci * 2) * 1.7
      m.position.set(-7 + ((i * 5.3 + ci * 3.1) % 14), 0.006, CAR_Z + ((i * 0.7) % 1.1) - 0.5)
      car.add(m)
    }

    // -- underframe: skirts, boxes, bogies
    for (const [a, b] of [[-9.9, -8.7], [-5.4, 5.4], [8.7, 9.9]] as const) B(underFrame, b - a, 0.62, W - 0.34, (a + b) / 2, -0.43, CAR_Z)
    for (const bx of [-6.6, -3.9, 3.9, 6.6]) {
      B(underFrame, 1.0, 0.36, 0.8, bx + (bx < 0 ? 0.0 : 0.0), -0.43 - 0.45, CAR_Z + (bx > 0 ? 0.55 : -0.55))
    }
    for (const bx of [-7.0, 7.0]) {
      // bogie: frame, axles, wheels, a spring on each side
      B(underFrame, 2.9, 0.18, 0.16, bx, -0.78, CAR_Z - 0.62)
      B(underFrame, 2.9, 0.18, 0.16, bx, -0.78, CAR_Z + 0.62)
      B(underFrame, 0.22, 0.2, 1.5, bx, -0.78, CAR_Z)
      for (const wx of [-0.9, 0.9]) {
        cyl(car, chrome, 0.05, 1.7, bx + wx, TRACK_Y + 0.72, CAR_Z, 'z')
        for (const wz of [-0.72, 0.72]) {
          const w = cyl(car, wheelMat, 0.42, 0.1, bx + wx, TRACK_Y + 0.72, CAR_Z + wz, 'z')
          solids.push(w)
          cyl(car, chrome, 0.13, 0.12, bx + wx, TRACK_Y + 0.72, CAR_Z + wz * 1.04, 'z')
        }
        for (const sz of [-0.62, 0.62]) cyl(car, underFrame, 0.09, 0.28, bx + wx, -0.62, CAR_Z + sz)
      }
    }

    // -- roof: an arch, with the cooling units and vents on top, and gutters
    const roof = new THREE.Mesh(own(vaultGeometry(L + 0.1, W / 2 - 0.02, 0.3, 2.4, CAR_Z)), roofMat)
    car.add(roof)
    solids.push(roof)
    for (const s of [-1, 1]) cyl(car, rubber, 0.07, L + 0.1, 0, 2.39, CAR_Z + s * (W / 2 - 0.04), 'x')
    for (const ax of [-5.4, 5.4]) {
      B(white, 2.5, 0.3, 1.5, ax, 2.84, CAR_Z)
      for (let i = 0; i < 5; i++) B(frameMat, 0.04, 0.04, 1.4, ax - 1.0 + i * 0.5, 3.0, CAR_Z)
      cyl(car, frameMat, 0.28, 0.06, ax - 0.5, 3.02, CAR_Z)
    }
    for (const vx of [-1.8, 1.8]) cyl(car, white, 0.12, 0.2, vx, 2.78, CAR_Z)

    // -- ceiling and lights inside
    const ceil = new THREE.Mesh(own(vaultGeometry(L, W / 2 - 0.12, 0.17, 2.22, CAR_Z)), ceilMat)
    car.add(ceil)
    solids.push(ceil)
    for (const s of [-1, 1]) {
      const y = vaultY(CAR_Z + s * 0.62, W / 2 - 0.12, 0.17, 2.22, CAR_Z)
      B(ceilingLight, L - 1.6, 0.025, 0.2, 0, y - 0.012, CAR_Z + s * 0.62)
    }

    // -- the two sides: panels with big windows around the doors
    const spans: [number, number][] = [[-L / 2, -7.2], [-5.8, -0.7], [0.7, 5.8], [7.2, L / 2]]
    let crackNo = 0
    for (const side of [1, -1] as const) {
      const zo = CAR_Z + side * (W / 2)
      const zi = CAR_Z + side * (W / 2 - 0.09)
      for (const [a, b] of spans) {
        const w = b - a
        // the skin, the lining behind it, the livery
        solid(wall(car, skin, a, b, -0.1, 0.95, zo, side))
        solid(wall(car, skin, a, b, 1.8, 2.36, zo, side))
        solid(wall(car, liningLow, a, b, 0, 0.95, zi, (-side) as 1 | -1))
        solid(wall(car, lining, a, b, 1.8, 2.22, zi, (-side) as 1 | -1))
        wall(car, stripe, a, b, 0.66, 0.8, zo + side * 0.004, side)
        wall(car, white, a, b, 0.84, 0.86, zo + side * 0.004, side)
        // window frames, piers, glass
        const panes = Math.max(1, Math.round(w / 1.7))
        for (let p = 0; p <= panes; p++) {
          const px = a + (w * p) / panes
          if (p > 0 && p < panes) {
            // a pier between two panes
            wall(car, skin, px - 0.06, px + 0.06, 0.95, 1.8, zo, side)
            wall(car, lining, px - 0.06, px + 0.06, 0.95, 1.8, zi, (-side) as 1 | -1)
            B(frameMat, 0.12, 0.85, 0.09, px, 1.375, CAR_Z + side * (W / 2 - 0.045))
          } else {
            B(frameMat, 0.06, 0.85, 0.09, px + (p === 0 ? 0.03 : -0.03), 1.375, CAR_Z + side * (W / 2 - 0.045))
          }
        }
        B(frameMat, w, 0.035, 0.1, (a + b) / 2, 0.97, CAR_Z + side * (W / 2 - 0.045))
        B(frameMat, w, 0.035, 0.1, (a + b) / 2, 1.78, CAR_Z + side * (W / 2 - 0.045))
        B(liningLow, w, 0.03, 0.16, (a + b) / 2, 0.955, CAR_Z + side * (W / 2 - 0.1))
        const g = B(glass, w, 0.85, 0.012, (a + b) / 2, 1.375, CAR_Z + side * (W / 2 - 0.03))
        g.renderOrder = 2
        // a smashed pane here and there
        if ((ci * 3 + spans.findIndex(([x0]) => x0 === a) * 2 + (side > 0 ? 1 : 0)) % 5 === 0 && ci !== 1) {
          const cm = crackMats[(crackNo + ci * 2) % 4]
          const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(1.9, w / panes), 0.85), cm)
          m.position.set(a + (w / panes) * 0.5, 1.375, CAR_Z + side * (W / 2 - 0.02))
          if (side < 0) m.rotation.y = Math.PI
          car.add(m)
          crackNo++
        }
      }
      // the doors: a frame, a header with its sign, a lamp outside, and the leaves
      for (const d of DOORS) {
        wall(car, skin, d - 0.72, d + 0.72, 2.0, 2.36, zo, side)
        solid(wall(car, lining, d - 0.72, d + 0.72, 2.0, 2.22, zi, (-side) as 1 | -1))
        for (const s of [-1, 1]) B(frameMat, 0.06, 2.0, 0.12, d + s * 0.72, 1.0, CAR_Z + side * (W / 2 - 0.06))
        B(frameMat, 1.5, 0.06, 0.12, d, 2.0, CAR_Z + side * (W / 2 - 0.06))
        const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.16), displayMat)
        disp.position.set(d, 2.12, CAR_Z + side * (W / 2 - 0.095))
        if (side > 0) disp.rotation.y = Math.PI
        car.add(disp)
        if (side > 0) {
          const l = B(lamp, 0.16, 0.07, 0.03, d, 2.3, zo + 0.02)
          l.scale.set(0.16, 0.07, 0.03)
        }
        // the sliding leaves
        for (const half of [-1, 1]) {
          const leaf = new THREE.Group()
          leaf.position.set(d + half * 0.35, 0, CAR_Z + side * (W / 2 - 0.07))
          box(leaf, skinBox, 0.7, 1.0, 0.05, 0, 0.5, 0)
          box(leaf, skinBox, 0.7, 0.22, 0.05, 0, 1.89, 0)
          box(leaf, frameMat, 0.7, 0.07, 0.06, 0, 1.0, 0)
          box(leaf, frameMat, 0.7, 0.07, 0.06, 0, 1.78, 0)
          box(leaf, frameMat, 0.09, 0.78, 0.06, half * 0.305, 1.39, 0)
          box(leaf, frameMat, 0.06, 0.78, 0.06, -half * 0.32, 1.39, 0)
          box(leaf, glass, 0.52, 0.76, 0.015, -half * 0.01, 1.39, 0)
          box(leaf, hazard, 0.025, 2.0, 0.075, -half * 0.3375, 1.0, 0).scale.set(0.025, 2.0, 0.075)
          box(leaf, stripe, 0.7, 0.14, 0.012, 0, 0.73, side * 0.03)
          box(leaf, white, 0.7, 0.02, 0.012, 0, 0.85, side * 0.03)
          car.add(leaf)
          leaf.children.forEach((c) => solids.push(c))
          if (side > 0) leaves.push({ mesh: leaf, x: d + half * 0.35, dir: half })
        }
      }
    }

    // -- the car's number and a poster outside, line maps and ads inside
    const num = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.22),
      own(std({ map: own(words(`K${ci + 1}`, 192, 64, 'rgba(0,0,0,0)', '#d8dcde', 'bold 46px Helvetica, Arial, sans-serif')), transparent: true, roughness: 0.5, depthWrite: false })),
    )
    num.position.set(-9.0, 0.45, zOut + 0.006)
    car.add(num)
    for (const side of [1, -1] as const) {
      const zi = CAR_Z + side * (W / 2 - 0.1)
      for (const [k, x] of [-3.3, 3.3].entries()) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.24), mapMat)
        m.position.set(x, 1.98, zi - side * 0.002)
        if (side > 0) m.rotation.y = Math.PI
        m.position.z = CAR_Z + side * (W / 2 - 0.1)
        car.add(m)
        void k
      }
      for (const [k, x] of [-8.6, 8.6].entries()) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), ads[(ci * 2 + k + (side > 0 ? 1 : 0)) % ads.length])
        m.position.set(x, 2.0, CAR_Z + side * (W / 2 - 0.1))
        if (side > 0) m.rotation.y = Math.PI
        car.add(m)
      }
    }

    // -- seats: cushions and backs by the dozen (instanced), the frames under them
    const cushions: [number, number][] = []
    for (const side of [1, -1]) {
      for (const [a, b] of SEAT_RUNS) {
        const n = Math.max(1, Math.floor((b - a) / 0.58))
        const pitch = (b - a) / n
        for (let i = 0; i < n; i++) cushions.push([a + pitch * (i + 0.5), side])
        solid(B(underFrame, b - a, 0.36, 0.46, (a + b) / 2, 0.2, CAR_Z + side * (W / 2 - 0.37)))
        B(chrome, b - a, 0.025, 0.025, (a + b) / 2, 0.4, CAR_Z + side * (W / 2 - 0.62))
        // the heater grille under the seat
        for (let i = 0; i < 6; i++) B(frameMat, (b - a) * 0.8, 0.012, 0.01, (a + b) / 2, 0.08 + i * 0.04, CAR_Z + side * (W / 2 - 0.605))
      }
    }
    const cushion = new THREE.InstancedMesh(seatGeo, seatMat, cushions.length)
    const backs = new THREE.InstancedMesh(seatGeo, seatMat, cushions.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    cushions.forEach(([x, side], i) => {
      e.set(0, 0, 0)
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(x, 0.47, CAR_Z + side * (W / 2 - 0.37)), q, new THREE.Vector3(0.54, 0.12, 0.48))
      cushion.setMatrixAt(i, m4)
      e.set(side * 0.1, 0, 0)
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(x, 0.82, CAR_Z + side * (W / 2 - 0.17)), q, new THREE.Vector3(0.54, 0.56, 0.11))
      backs.setMatrixAt(i, m4)
    })
    car.add(cushion, backs)
    solids.push(cushion, backs)

    // -- grab rails, poles, straps
    for (const s of [-1, 1]) {
      cyl(car, chrome, 0.018, L - 1.2, 0, 1.96, CAR_Z + s * 0.78, 'x')
      for (const x of [-9.4, 9.4]) cyl(car, chrome, 0.012, 0.3, x, 2.1, CAR_Z + s * 0.78)
    }
    for (const d of DOORS) {
      cyl(car, chrome, 0.02, 2.3, d - 0.85, 1.1, CAR_Z + 0.95)
      cyl(car, chrome, 0.02, 2.3, d + 0.85, 1.1, CAR_Z + 0.95)
      cyl(car, chrome, 0.02, 2.3, d - 0.85, 1.1, CAR_Z - 0.95)
      cyl(car, chrome, 0.02, 2.3, d + 0.85, 1.1, CAR_Z - 0.95)
      cyl(car, chrome, 0.016, 1.7, d, 2.07, CAR_Z + 1.05, 'x').scale.set(0.016, 1.7, 0.016)
    }
    for (const x of [-3.3, 3.3]) cyl(car, chrome, 0.02, 2.3, x, 1.1, CAR_Z)
    const straps: THREE.Vector3[] = []
    for (const s of [-1, 1]) for (let x = -9; x <= 9; x += 1.3) if (!DOORS.some((d) => Math.abs(d - x) < 0.8)) straps.push(new THREE.Vector3(x, 1.76, CAR_Z + s * 0.78))
    const rings = new THREE.InstancedMesh(ringGeo, chrome, straps.length)
    const bands = new THREE.InstancedMesh(strapGeo, rubber, straps.length)
    straps.forEach((p, i) => {
      m4.makeTranslation(p.x, p.y - 0.28, p.z)
      rings.setMatrixAt(i, m4)
      m4.makeTranslation(p.x, p.y - 0.1, p.z)
      bands.setMatrixAt(i, m4)
    })
    car.add(rings, bands)

    // -- fittings: an extinguisher, an intercom, a route sign
    cyl(car, own(std({ color: 0xc02a1e, roughness: 0.4, metalness: 0.4 })), 0.055, 0.34, 9.78, 0.62, CAR_Z + 1.28)
    cyl(car, rubber, 0.012, 0.1, 9.78, 0.84, CAR_Z + 1.28)
    B(own(std({ color: 0x2f3438, roughness: 0.5, metalness: 0.6 })), 0.16, 0.22, 0.05, DOORS[1] + 0.95, 1.5, CAR_Z - 1.38)
    B(own(std({ color: 0xd22a1e, emissive: 0xd22a1e, emissiveIntensity: 0.6 })), 0.05, 0.05, 0.01, DOORS[1] + 0.95, 1.55, CAR_Z - 1.355)

    // -- the ends: a doorway into the next car, or a cab with its door; walls and a front
    for (const s of [-1, 1] as const) {
      const x = s * (L / 2)
      const outer = (ci === 0 && s < 0) || (ci === 2 && s > 0)
      const wallMat = ci === 1 ? lining : liningLow
      if (!outer) {
        // an open gangway door: walls each side, a header, a rubber frame
        for (const side of [-1, 1]) solid(B(wallMat, 0.08, 2.22, 0.72, x, 1.11, CAR_Z + side * 1.14))
        solid(B(wallMat, 0.08, 0.22, 1.6, x, 2.11, CAR_Z))
        for (const side of [-1, 1]) B(rubber, 0.14, 2.0, 0.07, x, 1.0, CAR_Z + side * 0.8)
        B(rubber, 0.14, 0.07, 1.67, x, 2.0, CAR_Z)
      } else {
        // the driver's cab: a partition with a door and a black window
        for (const side of [-1, 1]) solid(B(wallMat, 0.08, 2.22, 0.55, x, 1.11, CAR_Z + side * 1.2))
        solid(B(wallMat, 0.08, 0.22, 1.9, x, 2.11, CAR_Z))
        solid(B(own(std({ color: 0x3a4248, roughness: 0.5, metalness: 0.5 })), 0.06, 2.0, 1.0, x - s * 0.01, 1.0, CAR_Z))
        B(windscreen, 0.02, 0.5, 0.5, x - s * 0.05, 1.5, CAR_Z)
        B(own(std({ color: 0xd9b31c, roughness: 0.6 })), 0.01, 0.1, 0.4, x - s * 0.05, 0.9, CAR_Z)
        // the nose: a rounded front with a windscreen, destination board, lights, coupler
        const shape = roundedRect(W - 0.32, 2.62, 0.34)
        const nose = new THREE.Mesh(
          own(new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 5, curveSegments: 10 })),
          skin,
        )
        nose.rotation.y = (s * Math.PI) / 2
        nose.position.set(x + s * 0.08, -0.12, CAR_Z)
        car.add(nose)
        solids.push(nose)
        const fx = x + s * (0.08 + 0.32 + 0.004)
        const on = (m: THREE.Mesh, dx = 0) => {
          m.position.x = fx + s * dx
          m.rotation.y = (s * Math.PI) / 2
          car.add(m)
          return m
        }
        on(new THREE.Mesh(new THREE.PlaneGeometry(2.24, 0.98), frameMat), 0.001).position.set(fx + s * 0.001, 1.52, CAR_Z)
        const ws = on(new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.86), windscreen), 0.004)
        ws.position.y = 1.52
        ws.position.z = CAR_Z
        ws.renderOrder = 2
        const board = on(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), s > 0 ? destMat : frameMat), 0.003)
        board.position.set(fx + s * 0.003, 2.27, CAR_Z)
        // the band of the line colour around the nose, a warning panel under it
        const band = on(new THREE.Mesh(new THREE.PlaneGeometry(W - 0.5, 0.14), stripe), 0.002)
        band.position.set(fx + s * 0.002, 0.82, CAR_Z)
        const warn = on(new THREE.Mesh(new THREE.PlaneGeometry(W - 0.6, 0.34), hazard), 0.002)
        warn.position.set(fx + s * 0.002, 0.18, CAR_Z)
        for (const side of [-1, 1]) {
          const hl = on(new THREE.Mesh(new THREE.CircleGeometry(0.1, 22), s > 0 ? head : tail), 0.005)
          hl.position.set(fx + s * 0.005, 0.52, CAR_Z + side * 1.0)
          const ring = on(new THREE.Mesh(new THREE.RingGeometry(0.1, 0.135, 22), frameMat), 0.004)
          ring.position.set(fx + s * 0.004, 0.52, CAR_Z + side * 1.0)
          const mk = on(new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), s > 0 ? tail : head), 0.004)
          mk.position.set(fx + s * 0.004, 2.0, CAR_Z + side * 1.2)
          // wipers
          const wp = B(frameMat, 0.02, 0.025, 0.7, fx + s * 0.02, 1.2, CAR_Z + side * 0.5)
          wp.rotation.x = side * 0.25
        }
        cyl(car, plate, 0.075, 0.34, fx + s * 0.18, -0.35, CAR_Z, 'x')
        for (const side of [-1, 1]) {
          cyl(car, plate, 0.05, 0.22, fx + s * 0.08, -0.32, CAR_Z + side * 0.8, 'x')
          cyl(car, chrome, 0.1, 0.03, fx + s * 0.2, -0.32, CAR_Z + side * 0.8, 'x')
        }
        // the cab-side hand rails
        for (const side of [-1, 1]) cyl(car, chrome, 0.014, 1.0, fx - s * 0.1, 1.2, CAR_Z + side * 1.43)
      }
    }
  }

  // -- the gangways between cars: a rubber bellows outside, a passage inside
  for (const gx of [-CAR_PITCH / 2, CAR_PITCH / 2]) {
    const gap = CAR_PITCH - L + 0.1
    for (const side of [-1, 1]) {
      solid(box(group, ribs, gap, 2.34, 0.07, gx, 1.17, CAR_Z + side * (W / 2 - 0.1)))
      solid(box(group, ribs, gap, 2.2, 0.06, gx, 1.1, CAR_Z + side * 0.82))
    }
    solid(box(group, ribs, gap, 0.08, W - 0.12, gx, 2.34, CAR_Z))
    solid(box(group, plate, gap + 0.1, 0.07, 1.64, gx, -0.03, CAR_Z))
    for (let i = 0; i < 6; i++) box(group, rubber, 0.04, 0.02, 1.6, gx - 0.25 + i * 0.1, 0.008, CAR_Z)
    box(group, ceilMat, gap, 0.04, 1.6, gx, 2.2, CAR_Z)
    box(group, ceilingLight, gap - 0.1, 0.02, 0.12, gx, 2.17, CAR_Z)
  }

  const lights = CAR_XS.map((cx, i) => {
    const l = new THREE.PointLight(0xfff7e6, i === 1 ? 3.2 : 2.6, 12, 1.6)
    l.position.set(cx, 2.0, CAR_Z)
    group.add(l)
    return l
  })
  // the headlights throw light into the tunnel ahead
  const beam = new THREE.SpotLight(0xfff2d0, 60, 45, 0.5, 0.6, 1.2)
  beam.position.set(CAR_PITCH + 10.5, 0.4, CAR_Z)
  beam.target.position.set(CAR_PITCH + 30, -0.4, CAR_Z)
  group.add(beam, beam.target)

  return {
    group,
    solids,
    leaves,
    light: lights[1],
    lights,
    stripe,
    lamp,
    map: { canvas: mapCanvas, tex: mapTex },
    display: { canvas: dc, tex: displayTex },
    dest: { canvas: dc2, tex: destTex },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry && m.geometry !== tmpBox && m.geometry !== tmpCyl) m.geometry.dispose()
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose()
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

/** The LED panels: a headline and a station. */
export function setTrainDisplay(t: TrainBuild, line1: string, line2: string) {
  drawDisplay(t.display.canvas, line1, line2)
  t.display.tex.needsUpdate = true
  drawDisplay(t.dest.canvas, line1.length > 14 ? line2 : line1, line2, 34)
  t.dest.tex.needsUpdate = true
}
