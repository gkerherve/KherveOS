// Rune Keep: the levels. A level is a grid of 1 m cells; each open cell has
// a floor and a ceiling height and its textures. Rooms, stairs, liquids,
// doors, lifts and secrets are carved with a small builder, and things
// (the start, monsters, items, lights, the exit) are placed by cell
// coordinates. Pure data: no three.js here (tools/tests/runekeep-maps.test.ts
// checks every level can be finished).

export type Tex = 'stone' | 'brick' | 'metal' | 'wood' | 'rune' | 'grate' | 'tech' | 'dirt' | 'slab'
export type Liquid = 'lava' | 'slime'
export type Key = 'silver' | 'gold'

export interface Cell {
  solid: boolean
  f: number
  c: number
  wall: Tex
  floor: Tex
  ceil: Tex
  sky?: boolean
  liquid?: Liquid
  door?: number
  lift?: number
  secret?: number
}

export interface Door {
  id: number
  x0: number
  z0: number
  x1: number
  z1: number
  key?: Key
}

export interface Lift {
  id: number
  x0: number
  z0: number
  x1: number
  z1: number
  low: number
  high: number
}

export type MonsterKind = 'grunt' | 'hound' | 'knight' | 'brute' | 'wraith' | 'ravager'
export type ItemKind =
  | 'shotgun2' | 'nailgun' | 'supernail' | 'grenadel' | 'rocketl' | 'thunder'
  | 'shells' | 'nails' | 'rockets' | 'cells'
  | 'health' | 'health25' | 'mega' | 'armor1' | 'armor2' | 'armor3' | 'quad'
  | 'key_silver' | 'key_gold'

export interface Ent {
  kind: 'start' | 'exit' | 'light' | MonsterKind | ItemKind
  x: number
  z: number
  /** Height above the floor (lights), or absolute for wraiths. */
  y?: number
  angle?: number
  color?: number
  power?: number
  /** A light hung on a wall (torch) or from the ceiling (lamp). */
  style?: 'torch' | 'lamp' | 'none'
}

export interface MapDef {
  name: string
  w: number
  h: number
  cells: Cell[]
  doors: Door[]
  lifts: Lift[]
  ents: Ent[]
  secrets: number
  /** The exit only opens once every monster is dead. */
  exitNeedsKills?: boolean
  fog: number
  fogColor: number
  sun: { dir: [number, number, number]; power: number; color: number }
  skyTint: [number, number, number]
}

export const MONSTERS: MonsterKind[] = ['grunt', 'hound', 'knight', 'brute', 'wraith', 'ravager']

class Builder {
  cells: Cell[]
  doors: Door[] = []
  lifts: Lift[] = []
  ents: Ent[] = []
  secrets = 0
  name: string
  w: number
  h: number
  constructor(name: string, w: number, h: number) {
    this.name = name
    this.w = w
    this.h = h
    this.cells = []
    for (let i = 0; i < w * h; i++) this.cells.push({ solid: true, f: 0, c: 0, wall: 'stone', floor: 'stone', ceil: 'stone' })
  }
  private each(x0: number, z0: number, x1: number, z1: number, fn: (c: Cell, x: number, z: number) => void) {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        if (x < 1 || z < 1 || x >= this.w - 1 || z >= this.h - 1) throw new Error(`${this.name}: cell ${x},${z} on or past the edge`)
        fn(this.cells[z * this.w + x], x, z)
      }
  }
  /** An open box of cells, inclusive bounds. */
  room(x0: number, z0: number, x1: number, z1: number, f: number, c: number, t: Partial<Pick<Cell, 'wall' | 'floor' | 'ceil' | 'sky'>> = {}) {
    this.each(x0, z0, x1, z1, (cell) => {
      Object.assign(cell, { solid: false, f, c, wall: t.wall ?? 'stone', floor: t.floor ?? 'stone', ceil: t.ceil ?? 'stone', sky: !!t.sky })
      delete cell.liquid
    })
    return this
  }
  solid(x0: number, z0: number, x1: number, z1: number) {
    this.each(x0, z0, x1, z1, (c) => (c.solid = true))
    return this
  }
  /** Steps rising from f0 (first row/column in `dir`) to f1 (last). */
  stairs(x0: number, z0: number, x1: number, z1: number, dir: '+x' | '-x' | '+z' | '-z', f0: number, f1: number, c: number, t: Partial<Pick<Cell, 'wall' | 'floor' | 'ceil' | 'sky'>> = {}) {
    const n = dir[1] === 'x' ? Math.abs(x1 - x0) : Math.abs(z1 - z0)
    this.each(x0, z0, x1, z1, (cell, x, z) => {
      let k = dir[1] === 'x' ? x - Math.min(x0, x1) : z - Math.min(z0, z1)
      if (dir[0] === '-') k = n - k
      const f = n === 0 ? f1 : f0 + ((f1 - f0) * k) / n
      Object.assign(cell, { solid: false, f: Math.round(f * 100) / 100, c, wall: t.wall ?? 'stone', floor: t.floor ?? 'slab', ceil: t.ceil ?? 'stone', sky: !!t.sky })
    })
    return this
  }
  liquid(x0: number, z0: number, x1: number, z1: number, kind: Liquid, f: number) {
    this.each(x0, z0, x1, z1, (c) => {
      c.liquid = kind
      c.f = f
    })
    return this
  }
  door(x0: number, z0: number, x1: number, z1: number, key?: Key) {
    const id = this.doors.length
    this.doors.push({ id, x0, z0, x1, z1, key })
    this.each(x0, z0, x1, z1, (c) => {
      if (c.solid) throw new Error(`${this.name}: door ${id} over a solid cell`)
      c.door = id
    })
    return this
  }
  lift(x0: number, z0: number, x1: number, z1: number, low: number, high: number) {
    const id = this.lifts.length
    this.lifts.push({ id, x0, z0, x1, z1, low, high })
    this.each(x0, z0, x1, z1, (c) => {
      c.lift = id
      c.f = low
      c.floor = 'grate'
    })
    return this
  }
  secret(x0: number, z0: number, x1: number, z1: number) {
    const id = ++this.secrets
    this.each(x0, z0, x1, z1, (c) => (c.secret = id))
    return this
  }
  put(kind: Ent['kind'], x: number, z: number, o: Partial<Ent> = {}) {
    this.ents.push({ kind, x: x + 0.5, z: z + 0.5, ...o })
    return this
  }
  torch(x: number, z: number, color = 0xffa040, power = 1) {
    return this.put('light', x, z, { y: 2.4, color, power, style: 'torch' })
  }
  lamp(x: number, z: number, y: number, color = 0xdfe8ff, power = 1.2) {
    return this.put('light', x, z, { y, color, power, style: 'lamp' })
  }
  done(o: Omit<MapDef, 'name' | 'w' | 'h' | 'cells' | 'doors' | 'lifts' | 'ents' | 'secrets'>): MapDef {
    return { name: this.name, w: this.w, h: this.h, cells: this.cells, doors: this.doors, lifts: this.lifts, ents: this.ents, secrets: this.secrets, ...o }
  }
}

// ---------------------------------------------------------------- E1: The Outer Gate

function outerGate(): MapDef {
  const b = new Builder('The Outer Gate', 34, 74)
  // start chamber and its hidden niche
  b.room(4, 4, 13, 13, 0, 5, { wall: 'stone', floor: 'slab' })
  b.room(1, 8, 3, 9, 0, 3, { wall: 'brick', floor: 'slab' }).secret(1, 8, 2, 9)
  b.solid(4, 7, 4, 7).solid(4, 10, 4, 10) // the pillars that hide it
  b.put('start', 8, 6, { angle: 0 })
  b.torch(5, 4).torch(12, 4).torch(4, 12).torch(13, 12)
  b.put('shells', 11, 11).put('nailgun', 1, 8).put('nails', 2, 9)

  // corridor north
  b.room(7, 14, 10, 23, 0, 4, { wall: 'brick', floor: 'slab' })
  b.lamp(8, 18, 3.7)
  b.put('grunt', 8, 21, { angle: Math.PI })

  // the courtyard under the sky, a slime moat with a bridge
  b.room(2, 24, 29, 45, 0, 14, { wall: 'stone', floor: 'dirt', sky: true })
  b.liquid(2, 33, 29, 36, 'slime', -0.5)
  b.room(14, 33, 17, 36, 0, 14, { wall: 'stone', floor: 'wood', sky: true })
  // the east ledge and the stairs up to it
  b.room(26, 24, 29, 45, 3, 14, { wall: 'stone', floor: 'slab', sky: true })
  b.stairs(20, 40, 25, 44, '+x', 0.5, 3, 14, { sky: true })
  b.put('key_silver', 28, 25).put('armor1', 27, 44).put('health', 3, 25).put('shells', 4, 44)
  b.put('grunt', 6, 28, { angle: Math.PI }).put('grunt', 22, 29, { angle: Math.PI }).put('hound', 12, 41, { angle: Math.PI })
  b.put('grunt', 5, 42, { angle: Math.PI }).put('wraith', 27, 31, { y: 6 })
  b.torch(13, 45, 0xffa040).torch(18, 45, 0xffa040)

  // the gate (silver key) and the keep hall
  b.room(14, 46, 17, 46, 0, 5, { wall: 'metal', floor: 'slab' }).door(14, 46, 17, 46, 'silver')
  b.room(10, 47, 21, 62, 0, 7, { wall: 'rune', floor: 'stone', ceil: 'stone' })
  b.solid(12, 50, 12, 50).solid(19, 50, 19, 50).solid(12, 58, 12, 58).solid(19, 58, 19, 58)
  b.liquid(14, 53, 17, 55, 'lava', -0.5)
  b.torch(10, 52).torch(21, 52).torch(10, 60)
  b.put('knight', 13, 56, { angle: Math.PI }).put('knight', 18, 52, { angle: Math.PI }).put('grunt', 11, 61, { angle: Math.PI })
  b.put('health25', 20, 48).put('shells', 11, 48).put('shotgun2', 15, 61)

  // the lift up to the balcony, the balcony, the exit
  b.room(20, 60, 21, 61, 0, 7, { wall: 'metal' }).lift(20, 60, 21, 61, 0, 4)
  b.room(22, 52, 29, 62, 4, 9, { wall: 'metal', floor: 'grate', ceil: 'metal' })
  b.lamp(25, 57, 8.6)
  b.put('grunt', 27, 54, { angle: -Math.PI / 2 }).put('grunt', 24, 61, { angle: -Math.PI / 2 }).put('health', 28, 61).put('armor2', 28, 53)
  b.room(24, 63, 27, 67, 4, 8, { wall: 'brick', floor: 'slab' })
  b.room(22, 68, 29, 72, 4, 9, { wall: 'rune', floor: 'tech' })
  b.put('exit', 25, 71).lamp(23, 70, 8.6, 0x9fd0ff).lamp(28, 70, 8.6, 0x9fd0ff)
  return b.done({ fog: 0.012, fogColor: 0x1a120c, sun: { dir: [-0.4, 1, 0.3], power: 1.5, color: 0xffd9a8 }, skyTint: [0.55, 0.3, 0.18] })
}

// ---------------------------------------------------------------- E2: Halls of Embers

function hallsOfEmbers(): MapDef {
  const b = new Builder('Halls of Embers', 64, 66)
  b.room(30, 2, 41, 9, 0, 5, { wall: 'metal', floor: 'tech', ceil: 'metal' })
  b.put('start', 35, 3, { angle: 0 })
  b.lamp(32, 5, 4.6).lamp(39, 5, 4.6)
  b.put('shells', 31, 8).put('nails', 40, 8)
  // a secret niche: megahealth
  b.room(42, 4, 44, 6, 0, 3, { wall: 'brick', floor: 'slab' }).secret(43, 4, 44, 6)
  b.put('mega', 43, 5)

  // the lava cavern with stone walkways
  b.room(20, 10, 51, 35, -2, 12, { wall: 'rune', floor: 'stone', ceil: 'stone' })
  b.liquid(20, 10, 51, 35, 'lava', -2)
  b.room(34, 10, 37, 20, 0, 12, { wall: 'rune', floor: 'slab' }) // causeway north
  b.room(28, 21, 43, 25, 0, 12, { wall: 'rune', floor: 'slab' }) // the cross platform
  b.room(22, 21, 25, 34, 0, 12, { wall: 'rune', floor: 'slab' }) // west walkway
  b.room(26, 21, 27, 22, 0, 12, { wall: 'rune', floor: 'slab' })
  b.room(26, 31, 33, 34, 0, 12, { wall: 'rune', floor: 'slab' }) // back to the middle
  b.room(34, 26, 37, 35, 0, 12, { wall: 'rune', floor: 'slab' }) // causeway to the door
  b.room(42, 26, 43, 29, 0.5, 12, { wall: 'rune', floor: 'slab' })
  b.room(44, 27, 48, 31, 1, 12, { wall: 'rune', floor: 'slab' }) // the rocket island
  b.put('rocketl', 46, 29).put('rockets', 47, 30)
  b.put('grunt', 30, 23, { angle: Math.PI }).put('grunt', 41, 23, { angle: Math.PI }).put('hound', 23, 30, { angle: Math.PI })
  b.put('wraith', 28, 16, { y: 5 }).put('wraith', 44, 18, { y: 6 }).put('knight', 35, 33, { angle: Math.PI })
  b.put('health', 23, 33).put('nails', 24, 22).put('supernail', 26, 33)
  b.torch(34, 10).torch(37, 10).torch(22, 21).torch(43, 21)

  // the hall north of the cavern
  b.room(34, 36, 37, 36, 0, 6, { wall: 'metal', floor: 'slab' }).door(34, 36, 37, 36)
  b.room(26, 37, 45, 50, 0, 8, { wall: 'brick', floor: 'stone', ceil: 'stone' })
  b.solid(30, 41, 31, 42).solid(40, 41, 41, 42).solid(30, 46, 31, 47).solid(40, 46, 41, 47)
  b.torch(26, 40).torch(45, 40).torch(26, 48)
  b.put('knight', 29, 44, { angle: Math.PI }).put('grunt', 38, 49, { angle: Math.PI }).put('grunt', 27, 38, { angle: Math.PI })
  b.put('shells', 44, 38).put('armor1', 27, 49)
  // the lift to the gold key room
  b.room(44, 49, 45, 50, 0, 8, { wall: 'metal' }).lift(44, 49, 45, 50, 0, 5)
  b.room(46, 40, 55, 50, 5, 10, { wall: 'metal', floor: 'grate', ceil: 'metal' })
  b.lamp(50, 45, 9.6, 0xffc080)
  b.put('key_gold', 53, 44).put('brute', 50, 42, { angle: Math.PI }).put('armor2', 54, 49).put('rockets', 47, 41)

  // the gold door and the last room under the sky
  b.room(34, 51, 37, 51, 0, 6, { wall: 'metal', floor: 'slab' }).door(34, 51, 37, 51, 'gold')
  b.room(28, 52, 43, 63, 0, 12, { wall: 'tech', floor: 'slab', sky: true })
  b.liquid(29, 57, 32, 60, 'lava', -0.5).liquid(39, 57, 42, 60, 'lava', -0.5)
  b.put('knight', 30, 54, { angle: Math.PI }).put('knight', 41, 54, { angle: Math.PI }).put('brute', 35, 59, { angle: Math.PI })
  b.put('health25', 28, 62).put('health25', 43, 62)
  b.put('exit', 35, 62).torch(28, 55).torch(43, 55)
  return b.done({ fog: 0.016, fogColor: 0x220c05, sun: { dir: [0.3, 1, -0.5], power: 1.1, color: 0xff9a60 }, skyTint: [0.7, 0.22, 0.08] })
}

// ---------------------------------------------------------------- E3: The Rune Vault

function runeVault(): MapDef {
  const b = new Builder('The Rune Vault', 64, 62)
  b.room(28, 2, 35, 7, 0, 5, { wall: 'rune', floor: 'slab' })
  b.put('start', 31, 3, { angle: 0 })
  b.torch(28, 4).torch(35, 4)
  b.put('shells', 29, 6).put('nails', 34, 6).put('rockets', 31, 6)
  b.room(30, 8, 33, 15, 0, 4, { wall: 'brick', floor: 'slab' })
  b.lamp(31, 12, 3.7, 0xff8060)

  // the arena
  b.room(12, 16, 51, 51, 0, 16, { wall: 'rune', floor: 'stone', sky: true })
  b.room(26, 28, 37, 39, 0.5, 16, { wall: 'rune', floor: 'slab', sky: true })
  b.room(28, 30, 35, 37, 1, 16, { wall: 'rune', floor: 'rune', sky: true })
  b.liquid(14, 18, 19, 23, 'lava', -0.5).liquid(44, 18, 49, 23, 'lava', -0.5).liquid(14, 44, 19, 49, 'lava', -0.5).liquid(44, 44, 49, 49, 'lava', -0.5)
  b.solid(22, 24, 23, 25).solid(40, 24, 41, 25).solid(22, 42, 23, 43).solid(40, 42, 41, 43)
  b.put('thunder', 31, 33).put('cells', 32, 34).put('cells', 30, 34)
  b.put('armor3', 13, 33).put('mega', 50, 33).put('rockets', 31, 17).put('grenadel', 31, 50).put('shells', 13, 17).put('nails', 50, 50)
  b.put('quad', 31, 29)
  for (const [x, z] of [[12, 26], [12, 41], [51, 26], [51, 41], [24, 51], [39, 51], [24, 16], [39, 16]]) b.torch(x, z, 0xff7040, 1.2)
  b.put('knight', 20, 30, { angle: 0 }).put('knight', 43, 30, { angle: 0 }).put('knight', 20, 38).put('knight', 43, 38)
  b.put('brute', 31, 45, { angle: Math.PI }).put('brute', 16, 34).put('ravager', 47, 34).put('ravager', 31, 22)
  b.put('wraith', 20, 20, { y: 8 }).put('wraith', 44, 46, { y: 9 }).put('wraith', 44, 20, { y: 8 })
  b.put('grunt', 26, 47).put('grunt', 37, 47).put('hound', 14, 28).put('hound', 49, 28)

  // the vault exit, sealed until the arena is clear
  b.room(29, 52, 34, 58, 0, 6, { wall: 'tech', floor: 'tech', ceil: 'metal' })
  b.put('exit', 31, 57).lamp(30, 55, 5.6, 0x9fd0ff).lamp(33, 55, 5.6, 0x9fd0ff)
  return b.done({ exitNeedsKills: true, fog: 0.01, fogColor: 0x0c0614, sun: { dir: [0.2, 1, 0.4], power: 1.0, color: 0xb89cff }, skyTint: [0.35, 0.18, 0.55] })
}

export const LEVELS: (() => MapDef)[] = [outerGate, hallsOfEmbers, runeVault]

// ---------------------------------------------------------------- queries shared by the game and the tests

export const STEP = 0.6

export function cellOf(m: MapDef, x: number, z: number): Cell | null {
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  if (cx < 0 || cz < 0 || cx >= m.w || cz >= m.h) return null
  return m.cells[cz * m.w + cx]
}
