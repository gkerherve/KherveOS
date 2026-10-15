// Last Train: what the 3D world is made of. Constants of the layout, the
// stations of the line, and every texture, drawn on canvases: no image files.
// The station itself is built in lastTrainStation.ts, the train in
// lastTrainCars.ts, and lastTrainEngine.ts plays the game in them.
//
// Axes: x runs along the platform, y up, z from the track (z < 0) to the
// back wall (z = 10). The platform top is y = 0, the track bed y = -1.3.

import * as THREE from 'three'
import type { FloorKind, WallKind } from './lastTrainStyles'

export const PLATFORM = { x0: -39.4, x1: 39.4, z0: 0.35, z1: 9.55 }
export const TRACK_Y = -1.3
export const CEIL_Y = 4.5
export const STAIRS = [-20, 20]
/** The stairs: steps from z = 10, the landing at the top, the gate that shuts the street. */
export const STAIR = { z0: 10, tread: 0.3, rise: 0.2, steps: 19, halfW: 1.8 }
export const LANDING = { y: STAIR.rise * STAIR.steps, z0: STAIR.z0 + STAIR.tread * STAIR.steps, gateZ: 18.2, endZ: 23 }
/** Height of the stairs under (z): the step's top, 0 below the first step, the landing above the last. */
export function stairY(z: number): number {
  if (z <= STAIR.z0) return 0
  if (z >= LANDING.z0) return LANDING.y
  return STAIR.rise * (Math.floor((z - STAIR.z0) / STAIR.tread) + 1)
}
/** The smooth slope through the steps: for zombies' feet. */
export function stairSlope(z: number): number {
  return THREE.MathUtils.clamp(((z - STAIR.z0) / (LANDING.z0 - STAIR.z0)) * LANDING.y + 0.08, 0, LANDING.y)
}
/**
 * The ticket hall above each landing: through the staff door in the landing's left wall (x = sx - 2),
 * up a short flight, into a hall with a line of ticket gates. Measured by u = sx - 2 - x (into the hall).
 */
export const HALL = {
  doorZ0: 16.2, doorZ1: 17.2, laneZ: 16.7,
  /** The flight: 10 steps of 0.3 × 0.2 from u0 to u1, 2 m wide. */
  flightU0: 0.4, flightU1: 3.4, flightZ0: 15.7, flightZ1: 17.7, steps: 10, rise: 0.2,
  /** The hall itself, its floor 2 m above the landing. */
  u1: 15.5, z0: 12, z1: 22, height: 3.4,
  /** The line of ticket gates across the hall, and the wide gate in the middle (z = laneZ ± laneW). */
  gatesU: 9, laneW: 0.85,
  y: LANDING.y + 2,
}
/** The stairway whose hall (x, z) is in, and how far into it: null on the platform and the stairs. */
export function hallAt(x: number, z: number): { sx: number; u: number } | null {
  if (z < HALL.z0 - 0.5 || z > HALL.z1 + 0.5) return null
  for (const sx of STAIRS) {
    const u = sx - 2 - x
    if (u > -0.05 && u < HALL.u1 + 0.5) return { sx, u }
  }
  return null
}
/** The floor of the hall at u: the landing, the steps, the hall (smooth: for zombies' feet). */
export function hallY(u: number, smooth = false): number {
  const k = (u - HALL.flightU0) / (HALL.flightU1 - HALL.flightU0)
  if (k <= 0) return LANDING.y
  if (k >= 1) return HALL.y
  return LANDING.y + (smooth ? k * HALL.steps : Math.floor(k * HALL.steps) + 1) * HALL.rise
}
/** The cars: the train rides three of them, each with its own floor. */
export const CAR = { x0: -9.55, x1: 9.55, z0: -2.85, z1: -0.62 }
export const CAR_Z = -1.75
export const DOORS = [-6.5, 0, 6.5]
export const CAR_PITCH = 20.6
export const CAR_L = 20
export const CAR_W = 3.0
export const CAR_XS = [-CAR_PITCH, 0, CAR_PITCH]
/** How far the train (or the world, during a ride) travels into the tunnel. Multiple of the lamp pitch. */
export const TRAVEL = 156
export const REACH = 236
export const LAMP_PITCH = 12

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

/** The last stop: its gate opens when the wave is cleared, and the way up is free. */
export const FINAL_STATION = STATIONS.length - 1

export const stationAt = (i: number): Station => STATIONS[Math.min(Math.max(0, i), STATIONS.length - 1)]

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

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
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

export function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex)
  c.multiplyScalar(f)
  return '#' + c.getHexString()
}

/** `hex` with its hue shifted by dh and its lightness scaled by f. */
function tint(hex: string, dh: number, f: number): string {
  const c = new THREE.Color(hex)
  c.offsetHSL(dh, 0, 0)
  c.multiplyScalar(f)
  return '#' + c.getHexString()
}

/** Vertical grime streaks and blotches over a texture. */
export function grime(g: CanvasRenderingContext2D, w: number, h: number, r: () => number, amount: number) {
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

// ---------------------------------------------------------------- walls

interface TileOpts {
  tw: number
  th: number
  gap: number
  bond: 'running' | 'stack'
  vary: number
  grout: string
  /** A darker tile now and then, in a repeating pattern. */
  accent?: boolean
  /** Hue shifts between tiles (mosaics). */
  hue?: number
  /** Rough, pitted surface (bricks). */
  pitted?: boolean
}

/** Tiles or bricks in a grid, with a bump map of the grout lines. */
function gridTiles(base: string, seed: number, dirt: number, o: TileOpts): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 512
  const H = 512
  const [c, g] = canvas(W, H)
  const [bc, bg] = canvas(W, H)
  const r = rng(seed)
  g.fillStyle = o.grout
  g.fillRect(0, 0, W, H)
  bg.fillStyle = '#000'
  bg.fillRect(0, 0, W, H)
  const { tw, th, gap } = o
  for (let row = 0; row < H / th; row++) {
    const off = o.bond === 'running' && row % 2 ? tw / 2 : 0
    for (let col = -1; col < W / tw + 1; col++) {
      const x = col * tw + off + gap / 2
      const y = row * th + gap / 2
      let v = 1 - o.vary / 2 + r() * o.vary
      if (o.accent && (col + row * 2) % 5 === 0) v *= 0.82
      const b = o.hue ? tint(base, (r() - 0.5) * o.hue, 1) : base
      const grad = g.createLinearGradient(x, y, x, y + th)
      grad.addColorStop(0, shade(b, v * 1.06))
      grad.addColorStop(0.5, shade(b, v))
      grad.addColorStop(1, shade(b, v * 0.9))
      g.fillStyle = grad
      g.fillRect(x, y, tw - gap, th - gap)
      if (o.pitted) {
        for (let k = 0; k < 14; k++) {
          g.fillStyle = r() < 0.5 ? 'rgba(20,10,6,0.22)' : 'rgba(255,230,200,0.1)'
          g.fillRect(x + r() * (tw - gap), y + r() * (th - gap), 1 + r() * 3, 1 + r() * 2)
        }
      }
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

/** Glossy subway tiles in running bond (the original look of the first station). */
export function tiles(base: string, seed: number, dirt: number) {
  return gridTiles(base, seed, dirt, { tw: 128, th: 64, gap: 5, bond: 'running', vary: 0.14, grout: '#6f736c' })
}

/** Riveted steel plates, a rust streak under each rivet. */
function plates(base: string, seed: number, dirt: number): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 512
  const [c, g] = canvas(W, W)
  const [bc, bg] = canvas(W, W)
  const r = rng(seed)
  g.fillStyle = '#1c1f20'
  g.fillRect(0, 0, W, W)
  bg.fillStyle = '#000'
  bg.fillRect(0, 0, W, W)
  const n = 2
  const s = W / n
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = i * s + 3
      const y = j * s + 3
      const v = 0.9 + r() * 0.2
      const grad = g.createLinearGradient(x, y, x + s, y + s)
      grad.addColorStop(0, shade(base, v * 1.12))
      grad.addColorStop(0.5, shade(base, v))
      grad.addColorStop(1, shade(base, v * 0.85))
      g.fillStyle = grad
      g.fillRect(x, y, s - 6, s - 6)
      bg.fillStyle = '#888'
      bg.fillRect(x, y, s - 6, s - 6)
      // brushed scratches
      for (let k = 0; k < 30; k++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'
        g.fillRect(x + r() * (s - 20), y + r() * (s - 6), 20 + r() * 80, 1)
      }
      // rivets along the edges
      for (let k = 0; k <= 6; k++) {
        const t = 12 + (k * (s - 30)) / 6
        for (const [rx, ry] of [[x + t, y + 8], [x + t, y + s - 14], [x + 8, y + t], [x + s - 14, y + t]] as const) {
          const rad = 3.2
          g.fillStyle = 'rgba(0,0,0,0.35)'
          g.beginPath()
          g.arc(rx + 1, ry + 1.5, rad + 0.6, 0, Math.PI * 2)
          g.fill()
          g.fillStyle = shade(base, 1.35)
          g.beginPath()
          g.arc(rx, ry, rad, 0, Math.PI * 2)
          g.fill()
          g.fillStyle = 'rgba(255,255,255,0.35)'
          g.beginPath()
          g.arc(rx - 1, ry - 1, rad * 0.4, 0, Math.PI * 2)
          g.fill()
          bg.fillStyle = '#fff'
          bg.beginPath()
          bg.arc(rx, ry, rad, 0, Math.PI * 2)
          bg.fill()
          if (r() < 0.5) {
            const len = 14 + r() * 40
            const grad2 = g.createLinearGradient(0, ry, 0, ry + len)
            grad2.addColorStop(0, 'rgba(120,60,20,0.35)')
            grad2.addColorStop(1, 'rgba(120,60,20,0)')
            g.fillStyle = grad2
            g.fillRect(rx - 1.5, ry, 3, len)
          }
        }
      }
    }
  grime(g, W, W, r, dirt)
  return { map: texture(c), bump: texture(bc, undefined, false) }
}

/** Dark marble slabs with pale veins. */
function marble(base: string, seed: number, dirt: number): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 512
  const [c, g] = canvas(W, W)
  const [bc, bg] = canvas(W, W)
  const r = rng(seed)
  bg.fillStyle = '#000'
  bg.fillRect(0, 0, W, W)
  const n = 2
  const s = W / n
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = i * s + 2
      const y = j * s + 2
      const v = 0.85 + r() * 0.3
      g.fillStyle = shade(base, v)
      g.fillRect(x, y, s - 4, s - 4)
      bg.fillStyle = '#fff'
      bg.fillRect(x, y, s - 4, s - 4)
      g.save()
      g.beginPath()
      g.rect(x, y, s - 4, s - 4)
      g.clip()
      for (let k = 0; k < 7; k++) {
        g.strokeStyle = `rgba(${200 + r() * 40},${190 + r() * 40},${230 + r() * 25},${0.14 + r() * 0.3})`
        g.lineWidth = 0.6 + r() * 2.2
        g.beginPath()
        let px = x + r() * s
        let py = y
        g.moveTo(px, py)
        while (py < y + s) {
          px += (r() - 0.5) * 46
          py += 14 + r() * 24
          g.lineTo(px, py)
        }
        g.stroke()
      }
      g.restore()
      g.fillStyle = 'rgba(190,150,70,0.65)' // a brass joint between slabs
      g.fillRect(x - 2, y - 2, s, 2.4)
      g.fillRect(x - 2, y - 2, 2.4, s)
    }
  grime(g, W, W, r, dirt * 0.6)
  return { map: texture(c), bump: texture(bc, undefined, false) }
}

export function wallTexture(kind: WallKind, base: string, seed: number, dirt: number) {
  switch (kind) {
    case 'square':
      return gridTiles(base, seed, dirt, { tw: 128, th: 128, gap: 6, bond: 'stack', vary: 0.12, grout: '#77746a', accent: true })
    case 'stack':
      return gridTiles(base, seed, dirt, { tw: 64, th: 256, gap: 5, bond: 'stack', vary: 0.1, grout: '#6c7274' })
    case 'brick':
      return gridTiles(base, seed, dirt * 1.2, { tw: 128, th: 64, gap: 8, bond: 'running', vary: 0.34, grout: '#a29b8e', pitted: true })
    case 'mosaic':
      return gridTiles(base, seed, dirt, { tw: 16, th: 16, gap: 2, bond: 'stack', vary: 0.3, grout: '#a8b4b2', hue: 0.05 })
    case 'plates':
      return plates(base, seed, dirt)
    case 'marble':
      return marble(base, seed, dirt)
    default:
      return tiles(base, seed, dirt)
  }
}

// ---------------------------------------------------------------- floors, ceilings, ground

export function concrete(seed: number, base: string, speck: number, w = 512): THREE.CanvasTexture {
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

/** The platform floor: a texture that covers 4 m. */
export function floorTexture(kind: FloorKind, a: string, b: string, seed: number): THREE.CanvasTexture {
  if (kind === 'concrete') {
    const t = concrete(seed, a, 0.02)
    // expansion joints and cracks
    const g = t.image.getContext('2d') as CanvasRenderingContext2D
    const r = rng(seed + 5)
    g.strokeStyle = 'rgba(0,0,0,0.35)'
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(0, 256)
    g.lineTo(512, 256)
    g.moveTo(256, 0)
    g.lineTo(256, 512)
    g.stroke()
    g.lineWidth = 1
    for (let i = 0; i < 4; i++) {
      let x = r() * 512
      let y = r() * 512
      g.beginPath()
      g.moveTo(x, y)
      for (let k = 0; k < 8; k++) g.lineTo((x += (r() - 0.5) * 60), (y += (r() - 0.3) * 40))
      g.stroke()
    }
    t.needsUpdate = true
    return t
  }
  const W = 512
  const [c, g] = canvas(W, W)
  const r = rng(seed)
  if (kind === 'checker' || kind === 'terracotta') {
    const n = 8
    const s = W / n
    g.fillStyle = shade(kind === 'checker' ? '#303030' : b, 0.7)
    g.fillRect(0, 0, W, W)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const base = kind === 'checker' ? ((i + j) % 2 ? b : a) : (i + j) % 3 === 0 ? b : a
        const v = 0.92 + r() * 0.16
        g.fillStyle = shade(base, v)
        g.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3)
        if (r() < 0.12) {
          g.strokeStyle = 'rgba(20,16,10,0.4)'
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(i * s + r() * s, j * s)
          g.lineTo(i * s + r() * s, j * s + s)
          g.stroke()
        }
      }
  } else if (kind === 'terrazzo') {
    g.fillStyle = a
    g.fillRect(0, 0, W, W)
    const chips = [b, '#d8d2dc', '#5e566a', '#a79bb8', '#e8e1d0']
    for (let i = 0; i < 2400; i++) {
      g.fillStyle = shade(chips[Math.floor(r() * chips.length)], 0.85 + r() * 0.3)
      g.beginPath()
      const x = r() * W
      const y = r() * W
      const rad = 1.2 + r() * 3.6
      g.moveTo(x + rad, y)
      for (let k = 1; k < 6; k++) g.lineTo(x + Math.cos((k * Math.PI) / 3 + r()) * rad * (0.6 + r() * 0.6), y + Math.sin((k * Math.PI) / 3 + r()) * rad * (0.6 + r() * 0.6))
      g.fill()
    }
    g.fillStyle = 'rgba(200,170,90,0.75)' // brass divider strips
    for (const p of [0, 256]) {
      g.fillRect(p, 0, 3, W)
      g.fillRect(0, p, W, 3)
    }
  } else if (kind === 'slate') {
    const n = 4
    const s = W / n
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const grad = g.createLinearGradient(i * s, j * s, (i + 1) * s, (j + 1) * s)
        grad.addColorStop(0, shade(a, 0.9 + r() * 0.3))
        grad.addColorStop(1, shade(b, 0.9 + r() * 0.3))
        g.fillStyle = grad
        g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4)
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(200,220,255,${r() * 0.09})`
          g.fillRect(i * s + r() * s, j * s + r() * s, 1 + r() * 3, 1)
        }
      }
    g.fillStyle = 'rgba(190,215,240,0.55)' // an inlaid guide line
    g.fillRect(0, W / 2 - 3, W, 6)
  } else {
    // diamond plate
    g.fillStyle = a
    g.fillRect(0, 0, W, W)
    const s = 32
    for (let j = 0; j < W / s; j++)
      for (let i = 0; i < W / s; i++) {
        g.save()
        g.translate(i * s + s / 2, j * s + s / 2)
        g.rotate(((i + j) % 2 ? 1 : -1) * 0.6)
        const grad = g.createLinearGradient(-9, 0, 9, 0)
        grad.addColorStop(0, shade(b, 0.7))
        grad.addColorStop(0.5, shade(a, 1.6))
        grad.addColorStop(1, shade(b, 0.7))
        g.fillStyle = grad
        g.beginPath()
        g.ellipse(0, 0, 10, 3, 0, 0, Math.PI * 2)
        g.fill()
        g.restore()
      }
    g.strokeStyle = 'rgba(0,0,0,0.5)'
    g.lineWidth = 3
    for (const p of [0, 256]) {
      g.strokeRect(p, 0, 256, W)
    }
  }
  grime(g, W, W, r, 0.7)
  // spilled stains
  for (let i = 0; i < 5; i++) {
    const x = r() * W
    const y = r() * W
    const rad = 14 + r() * 40
    const grad = g.createRadialGradient(x, y, 0, x, y, rad)
    grad.addColorStop(0, 'rgba(20,12,8,0.3)')
    grad.addColorStop(1, 'rgba(20,12,8,0)')
    g.fillStyle = grad
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  return texture(c)
}

/** Suspended ceiling tiles (0.6 m); some missing, some stained, some hanging crooked. */
export function ceilingTiles(base: string, seed: number): THREE.CanvasTexture {
  const W = 512
  const [c, g] = canvas(W, W)
  const r = rng(seed)
  g.fillStyle = '#111'
  g.fillRect(0, 0, W, W)
  const n = 8
  const s = W / n
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (r() < 0.07) {
        // a missing tile: the dark void and a cable
        g.fillStyle = '#050505'
        g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4)
        g.strokeStyle = '#222'
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(i * s, j * s + r() * s)
        g.lineTo(i * s + s, j * s + r() * s)
        g.stroke()
        continue
      }
      g.fillStyle = shade(base, 0.85 + r() * 0.3)
      g.fillRect(i * s + 2, j * s + 2, s - 4, s - 4)
      for (let k = 0; k < 26; k++) {
        g.fillStyle = `rgba(0,0,0,${r() * 0.18})`
        g.fillRect(i * s + 4 + r() * (s - 8), j * s + 4 + r() * (s - 8), 1 + r() * 3, 1 + r() * 3)
      }
      if (r() < 0.22) {
        const grad = g.createRadialGradient(i * s + s / 2, j * s + s / 2, 0, i * s + s / 2, j * s + s / 2, s * 0.6)
        grad.addColorStop(0, 'rgba(90,70,30,0.5)')
        grad.addColorStop(1, 'rgba(90,70,30,0)')
        g.fillStyle = grad
        g.fillRect(i * s, j * s, s, s)
      }
    }
  return texture(c)
}

export function gravel(): THREE.CanvasTexture {
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

export function tactile(): THREE.CanvasTexture {
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

export function words(text: string, w: number, h: number, bg: string, fg: string, font: string, border?: string): THREE.CanvasTexture {
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

export function poster(i: number, seed: number): THREE.CanvasTexture {
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

/** Spray paint on a wall: words in a shaky hand, drips running down. Transparent around the letters. */
export function graffiti(text: string, color: string, seed: number): THREE.CanvasTexture {
  const W = 640
  const H = 200
  const [c, g] = canvas(W, H)
  const r = rng(seed)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  let size = 112
  g.font = `bold ${size}px "Marker Felt", "Segoe Print", "Comic Sans MS", cursive`
  while (g.measureText(text).width > W - 60 && size > 30) {
    size -= 6
    g.font = `bold ${size}px "Marker Felt", "Segoe Print", "Comic Sans MS", cursive`
  }
  g.save()
  g.translate(W / 2, H * 0.45)
  g.rotate((r() - 0.5) * 0.09)
  g.shadowColor = color
  g.shadowBlur = 9
  g.fillStyle = color
  g.fillText(text, 0, 0)
  g.shadowBlur = 0
  g.globalAlpha = 0.55
  g.lineWidth = 2
  g.strokeStyle = 'rgba(255,255,255,0.4)'
  g.strokeText(text, 0, 0)
  g.restore()
  // drips
  g.fillStyle = color
  for (let i = 0; i < 9; i++) {
    const x = W * 0.12 + r() * W * 0.76
    const len = 14 + r() * 56
    g.globalAlpha = 0.8
    g.fillRect(x, H * 0.45 + size * 0.2, 2.4, len)
    g.beginPath()
    g.arc(x + 1.2, H * 0.45 + size * 0.2 + len, 2.6, 0, Math.PI * 2)
    g.fill()
  }
  return texture(c)
}

/** A dried-blood splatter or smear, transparent around it: for floors, walls and glass. */
export function stain(seed: number, color = '70,8,6'): THREE.CanvasTexture {
  const S = 256
  const [c, g] = canvas(S, S)
  const r = rng(seed)
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2
    const d = Math.pow(r(), 1.6) * S * 0.38
    const x = S / 2 + Math.cos(a) * d
    const y = S / 2 + Math.sin(a) * d
    const rad = 3 + r() * (d < 30 ? 36 : 12)
    const grad = g.createRadialGradient(x, y, 0, x, y, rad)
    grad.addColorStop(0, `rgba(${color},${0.55 + r() * 0.35})`)
    grad.addColorStop(0.7, `rgba(${color},${0.3 + r() * 0.2})`)
    grad.addColorStop(1, `rgba(${color},0)`)
    g.fillStyle = grad
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  // a smear trailing off to one side
  const sa = r() * Math.PI * 2
  g.strokeStyle = `rgba(${color},0.45)`
  g.lineCap = 'round'
  g.lineWidth = 7 + r() * 8
  g.beginPath()
  g.moveTo(S / 2, S / 2)
  g.quadraticCurveTo(S / 2 + Math.cos(sa) * 50, S / 2 + Math.sin(sa) * 50 + 20, S / 2 + Math.cos(sa) * 100, S / 2 + Math.sin(sa) * 100)
  g.stroke()
  return texture(c)
}

/** Ivy and creepers climbing a wall: stems and leaves on transparency. */
export function vines(seed: number): THREE.CanvasTexture {
  const W = 256
  const H = 512
  const [c, g] = canvas(W, H)
  const r = rng(seed)
  const leaf = (x: number, y: number, a: number, s: number) => {
    g.save()
    g.translate(x, y)
    g.rotate(a)
    g.fillStyle = `hsl(${95 + r() * 40},${42 + r() * 25}%,${20 + r() * 20}%)`
    g.beginPath()
    g.moveTo(0, 0)
    g.quadraticCurveTo(s * 0.7, -s * 0.25, s, 0)
    g.quadraticCurveTo(s * 0.7, s * 0.25, 0, 0)
    g.fill()
    g.restore()
  }
  for (let v = 0; v < 6; v++) {
    let x = 20 + r() * (W - 40)
    let y = H
    g.strokeStyle = '#2b3d1e'
    g.lineWidth = 2 + r() * 2
    g.beginPath()
    g.moveTo(x, y)
    const pts: [number, number][] = []
    while (y > r() * 160) {
      x += (r() - 0.5) * 40
      y -= 16 + r() * 22
      g.lineTo(x, y)
      pts.push([x, y])
    }
    g.stroke()
    for (const [px, py] of pts) {
      leaf(px, py, -Math.PI / 2 + (r() - 0.5) * 3.2, 14 + r() * 20)
      if (r() < 0.6) leaf(px, py, -Math.PI / 2 + (r() - 0.5) * 3.2, 12 + r() * 16)
    }
  }
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
    if (idx < 0 || idx >= STATIONS.length) continue
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

export const tmpBox = new THREE.BoxGeometry(1, 1, 1)
export const tmpCyl = new THREE.CylinderGeometry(1, 1, 1, 18)

export function box(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(tmpBox, mat)
  m.scale.set(w, h, d)
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

export function cyl(parent: THREE.Object3D, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y'): THREE.Mesh {
  const m = new THREE.Mesh(tmpCyl, mat)
  m.scale.set(r, len, r)
  if (axis === 'x') m.rotation.z = Math.PI / 2
  if (axis === 'z') m.rotation.x = Math.PI / 2
  m.position.set(x, y, z)
  parent.add(m)
  return m
}

/** A plane with its texture repeated per metre. */
export function panel(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  const uv = m.geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h)
  parent.add(m)
  return m
}

export const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o)

/**
 * A barrel vault along x, `len` long, spanning z = zc ± hw, springing at y0 and
 * rising `rise` at the crown. Its UVs are metres (u along x, v along the arc).
 */
export function vaultGeometry(len: number, hw: number, rise: number, y0: number, zc: number, segs = 36): THREE.BufferGeometry {
  const R = (hw * hw + rise * rise) / (2 * rise)
  const yc = y0 + rise - R
  const a0 = Math.asin(hw / R)
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const a = -a0 + (2 * a0 * i) / segs
    const z = zc + R * Math.sin(a)
    const y = yc + R * Math.cos(a)
    for (const sx of [-1, 1]) {
      pos.push((sx * len) / 2, y, z)
      nor.push(0, -Math.cos(a), -Math.sin(a))
      uv.push(sx > 0 ? len : 0, R * (a + a0))
    }
    if (i > 0) {
      const k = i * 2
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

/** The height of the same vault at z. */
export function vaultY(z: number, hw: number, rise: number, y0: number, zc: number): number {
  const R = (hw * hw + rise * rise) / (2 * rise)
  const dz = Math.min(Math.abs(z - zc), hw)
  return y0 + rise - R + Math.sqrt(Math.max(0, R * R - dz * dz))
}

/** A wall in the plane x = const whose top is the vault: the end of the hall. UVs are metres. */
export function archWallGeometry(x: number, hw: number, rise: number, y0: number, zc: number, segs = 36): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const z = zc - hw + (2 * hw * i) / segs
    const y = vaultY(z, hw, rise, y0, zc)
    pos.push(x, y0, z, x, y, z)
    uv.push(z, y0, z, y)
    if (i > 0) {
      const k = i * 2
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}
