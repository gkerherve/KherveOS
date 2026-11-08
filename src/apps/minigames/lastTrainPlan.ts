// Last Train: the plan of the city above each station, and the way its dead
// find their way through it. No three.js here: just the street grid, what
// stands on each block, and a walking grid (1 m cells) for the horde.
//
// The station's front is on the south side of Station Road (z = 23). North of
// it, a grid of streets: four running east-west, seven north-south, eighteen
// blocks between them. Station Road leaves the city at both ends: west into a
// military checkpoint, east along the avenue (the way on foot to the next
// station). Each station's city is laid out the same, but what stands on the
// blocks (a park, a square, a church, a petrol station, a building site, a
// supermarket, a hospital, a car park) changes with the station.

import { AVENUE, rng, STREET } from './lastTrainWorld'

export interface Box2 {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** A street running east-west: its south building line, the road's kerbs, its north building line. */
export interface EWStreet {
  name: string
  b0: number
  r0: number
  r1: number
  b1: number
}

/** A street running north-south: its centre line (the road is ±NS_ROAD, the building lines ±NS_HALF). */
export interface NSStreet {
  name: string
  x: number
}

export const EW: EWStreet[] = [
  { name: 'Station Road', b0: 23, r0: 34, r1: 46, b1: 52 },
  { name: 'Market Street', b0: 96, r0: 101, r1: 111, b1: 116 },
  { name: 'Lantern Street', b0: 160, r0: 165, r1: 175, b1: 180 },
  { name: 'Observatory Road', b0: 224, r0: 229, r1: 239, b1: 244 },
]

export const NS: NSStreet[] = [
  { name: 'West Rampart', x: -192 },
  { name: 'Faraday Street', x: -128 },
  { name: 'Curie Lane', x: -64 },
  { name: 'Kherve Street', x: 0 },
  { name: 'Planck Street', x: 64 },
  { name: 'Volta Lane', x: 128 },
  { name: 'East Rampart', x: 192 },
]

/** Half the width of a north-south street, building line to building line, and of its road. */
export const NS_HALF = 10
export const NS_ROAD = 5

/** The station's own front on Station Road (it covers both ticket halls and their ways out). */
export const STATION_FRONT = { x0: -43, x1: 27 }

export type BlockKind = 'buildings' | 'park' | 'square' | 'church' | 'petrol' | 'carpark' | 'works' | 'mart' | 'hospital'

export interface CityBlock extends Box2 {
  kind: BlockKind
  /** Row (0 nearest the station) and column (0 at the west). */
  row: number
  col: number
}

export interface CityPlan {
  blocks: CityBlock[]
  /** What every block is, by name: for the HUD's map and the guide. */
  landmarks: { kind: BlockKind; x: number; z: number }[]
}

/** Where the blocks are and what stands on each, for station `index`. */
export function planCity(index: number): CityPlan {
  const r = rng(7100 + index * 13)
  const blocks: CityBlock[] = []
  for (let row = 0; row < EW.length - 1; row++)
    for (let col = 0; col < NS.length - 1; col++)
      blocks.push({ x0: NS[col].x + NS_HALF, x1: NS[col + 1].x - NS_HALF, z0: EW[row].b1, z1: EW[row + 1].b0, row, col, kind: 'buildings' })
  const at = (row: number, col: number) => blocks.find((b) => b.row === row && b.col === col)!
  const free = (b: CityBlock) => b.kind === 'buildings' && !(b.row === 0 && (b.col === 2 || b.col === 3))
  // the square on Kherve Street, the road up from the station
  at(1 + Math.floor(r() * 2), r() < 0.5 ? 2 : 3).kind = 'square'
  const rest: BlockKind[] = ['park', 'church', 'petrol', 'carpark', 'works', 'mart', 'hospital']
  for (const kind of rest) {
    const pool = blocks.filter(free)
    // a petrol station and a supermarket want a main road: Station Road or Market Street
    const want = kind === 'petrol' || kind === 'mart' ? pool.filter((b) => b.row === 0 || b.row === 1) : pool
    const list = want.length ? want : pool
    list[Math.floor(r() * list.length)].kind = kind
  }
  return { blocks, landmarks: blocks.filter((b) => b.kind !== 'buildings').map((b) => ({ kind: b.kind, x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 })) }
}

// ---------------------------------------------------------------- the walking grid

/**
 * The city's ground in 1 m cells: what is free to walk, and (after `flow`) how many steps each cell is from
 * the nearest goal. Zombies walk downhill on it: round the blocks, through park gates, along the aisles.
 */
export class NavGrid {
  readonly x0: number
  readonly z0: number
  readonly w: number
  readonly h: number
  readonly blocked: Uint8Array
  readonly dist: Int32Array
  private queue: Int32Array

  constructor(blocks: Box2[], pad = 0.35) {
    this.x0 = STREET.x0
    this.z0 = STREET.z0
    this.w = Math.ceil(AVENUE.x1 - STREET.x0)
    this.h = Math.ceil(STREET.z1 - STREET.z0)
    const n = this.w * this.h
    this.blocked = new Uint8Array(n)
    this.dist = new Int32Array(n).fill(-1)
    this.queue = new Int32Array(n)
    // past the east end only the avenue's road is open
    for (let j = 0; j < this.h; j++) {
      const z = this.z0 + j + 0.5
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + i + 0.5
        if (x > STREET.x1 && (z < AVENUE.z0 + 0.4 || z > AVENUE.z1 - 0.4)) this.blocked[j * this.w + i] = 1
      }
    }
    for (const b of blocks) {
      if (b.z1 < this.z0 || b.x0 > AVENUE.x1) continue
      const i0 = Math.max(0, Math.ceil(b.x0 - pad - this.x0 - 0.5))
      const i1 = Math.min(this.w - 1, Math.floor(b.x1 + pad - this.x0 - 0.5))
      const j0 = Math.max(0, Math.ceil(b.z0 - pad - this.z0 - 0.5))
      const j1 = Math.min(this.h - 1, Math.floor(b.z1 + pad - this.z0 - 0.5))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.blocked[j * this.w + i] = 1
    }
  }

  /** The cell under (x, z), or -1 off the grid. */
  cell(x: number, z: number): number {
    const i = Math.floor(x - this.x0)
    const j = Math.floor(z - this.z0)
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1
    return j * this.w + i
  }

  free(x: number, z: number): boolean {
    const c = this.cell(x, z)
    return c >= 0 && !this.blocked[c]
  }

  /** Steps from every free cell to the nearest of `goals` (breadth first, four ways). */
  flow(goals: [number, number][]) {
    const { dist, blocked, queue, w, h } = this
    dist.fill(-1)
    let head = 0
    let tail = 0
    for (const [x, z] of goals) {
      let c = this.cell(x, z)
      if (c < 0) continue
      if (blocked[c]) c = this.nearestFreeCell(c)
      if (c < 0 || dist[c] === 0) continue
      dist[c] = 0
      queue[tail++] = c
    }
    while (head < tail) {
      const c = queue[head++]
      const d = dist[c] + 1
      const i = c % w
      const j = (c - i) / w
      if (i > 0 && dist[c - 1] < 0 && !blocked[c - 1]) ((dist[c - 1] = d), (queue[tail++] = c - 1))
      if (i < w - 1 && dist[c + 1] < 0 && !blocked[c + 1]) ((dist[c + 1] = d), (queue[tail++] = c + 1))
      if (j > 0 && dist[c - w] < 0 && !blocked[c - w]) ((dist[c - w] = d), (queue[tail++] = c - w))
      if (j < h - 1 && dist[c + w] < 0 && !blocked[c + w]) ((dist[c + w] = d), (queue[tail++] = c + w))
    }
  }

  private nearestFreeCell(c: number): number {
    const i0 = c % this.w
    const j0 = (c - i0) / this.w
    for (let r = 1; r < 6; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue
          const i = i0 + di
          const j = j0 + dj
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue
          if (!this.blocked[j * this.w + i]) return j * this.w + i
        }
    return -1
  }

  /** How many steps (x, z) is from the nearest goal (-1: no way there). */
  stepsAt(x: number, z: number): number {
    const c = this.cell(x, z)
    return c < 0 ? -1 : this.dist[c]
  }

  /** The way to walk from (x, z) towards the nearest goal: a unit vector, or null there (or with no way). */
  step(x: number, z: number): [number, number] | null {
    const { dist, blocked, w, h } = this
    const c = this.cell(x, z)
    if (c < 0) return null
    const here = dist[c]
    if (here === 0) return null
    const i = c % w
    const j = (c - i) / w
    let best = -1
    let bd = here < 0 ? Infinity : here
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue
        const ii = i + di
        const jj = j + dj
        if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue
        const n = jj * w + ii
        if (blocked[n] || dist[n] < 0) continue
        // no cutting a corner
        if (di && dj && (blocked[j * w + ii] || blocked[jj * w + i])) continue
        if (dist[n] < bd) {
          bd = dist[n]
          best = n
        }
      }
    if (best < 0) return null
    const bi = best % w
    const bj = (best - bi) / w
    const dx = this.x0 + bi + 0.5 - x
    const dz = this.z0 + bj + 0.5 - z
    const l = Math.hypot(dx, dz) || 1
    return [dx / l, dz / l]
  }

  /** Nothing in the way between two points (walls, cars, railings). */
  los(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az)
    const n = Math.ceil(d / 0.6)
    for (let k = 1; k < n; k++) {
      const c = this.cell(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)
      if (c >= 0 && this.blocked[c]) return false
    }
    return true
  }

  /** A free place between `min` and `max` metres from (x, z), or null. */
  around(x: number, z: number, min: number, max: number, tries = 24): [number, number] | null {
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * Math.PI * 2
      const d = min + Math.random() * (max - min)
      const px = x + Math.cos(a) * d
      const pz = z + Math.sin(a) * d
      if (px > STREET.x1 - 1 || pz < STREET.z0 + 0.5 || pz > STREET.z1 - 0.5 || px < STREET.x0 + 0.5) continue
      if (this.free(px, pz) && this.free(px + 0.6, pz) && this.free(px - 0.6, pz) && this.free(px, pz + 0.6) && this.free(px, pz - 0.6)) return [px, pz]
    }
    return null
  }
}
