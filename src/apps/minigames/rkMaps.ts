// DataCenter Assault (the app id is still runekeep): the levels. A level is a grid
// of 1 m cells; each open cell has a floor and a ceiling height and its textures.
// Rooms, rack rows, desks, doors (sliding, shutters, double, blast), lifts and
// secrets are carved with a small builder, and things (the start, enemies, items,
// lights, the exit) are placed by cell coordinates. The three levels are laid
// out by hand: corridors and long rooms, the same every time. Pure data: no three.js here (tools/tests/runekeep-maps.test.ts
// checks every level can be finished).

export type Tex = 'stone' | 'brick' | 'metal' | 'wood' | 'rune' | 'grate' | 'tech' | 'dirt' | 'slab' | 'grass' | 'ash' | 'server' | 'panel' | 'raised' | 'ceiltile' | 'hazard'
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
  /** Outdoor ground: drawn as a smooth slope between neighbouring terrain cells. */
  terrain?: boolean
  /** A tree stands here (blocks walking and shots). */
  tree?: TreeKind
}

export type TreeKind = 'pine' | 'oak' | 'dead'

/** How a door opens: slides up (the default), a roll-up shutter, double doors parting sideways, a heavy blast door. */
export type DoorStyle = 'slide' | 'shutter' | 'split' | 'blast'

export interface Door {
  id: number
  x0: number
  z0: number
  x1: number
  z1: number
  key?: Key
  style?: DoorStyle
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

/** grunt rifleman, hound attack dog, knight commando, brute heavy gunner, wraith drone, ravager android; core: a core server to destroy. */
export type MonsterKind = 'grunt' | 'hound' | 'knight' | 'brute' | 'wraith' | 'ravager' | 'core'
export type ItemKind =
  | 'pistol' | 'shotgun2' | 'nailgun' | 'supernail' | 'grenadel' | 'rocketl' | 'thunder' | 'railgun'
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

export const MONSTERS: MonsterKind[] = ['grunt', 'hound', 'knight', 'brute', 'wraith', 'ravager', 'core']

/** A small seeded random generator (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Maze {
  /** Top-left cell of maze cell (i, j); each is 2×2 cells, 3 m apart. */
  at(i: number, j: number): [number, number]
  /** Maze cells with a single way out, farthest from (0, 0) first. */
  deadEnds: [number, number][]
}

type Look = Partial<Pick<Cell, 'wall' | 'floor' | 'ceil' | 'sky'>>

class Builder {
  cells: Cell[]
  /** Offset added to every coordinate (to move a block of a level). */
  ox = 0
  oz = 0
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
    x0 += this.ox
    x1 += this.ox
    z0 += this.oz
    z1 += this.oz
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
      let k = dir[1] === 'x' ? x - this.ox - Math.min(x0, x1) : z - this.oz - Math.min(z0, z1)
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
  door(x0: number, z0: number, x1: number, z1: number, key?: Key, style?: DoorStyle) {
    const id = this.doors.length
    this.doors.push({ id, x0: x0 + this.ox, z0: z0 + this.oz, x1: x1 + this.ox, z1: z1 + this.oz, key, style })
    this.each(x0, z0, x1, z1, (c) => {
      if (c.solid) throw new Error(`${this.name}: door ${id} over a solid cell`)
      c.door = id
    })
    return this
  }
  lift(x0: number, z0: number, x1: number, z1: number, low: number, high: number) {
    const id = this.lifts.length
    this.lifts.push({ id, x0: x0 + this.ox, z0: z0 + this.oz, x1: x1 + this.ox, z1: z1 + this.oz, low, high })
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
    this.ents.push({ kind, x: x + this.ox + 0.5, z: z + this.oz + 0.5, ...o })
    return this
  }
  torch(x: number, z: number, color = 0xffa040, power = 1) {
    return this.put('light', x, z, { y: 2.4, color, power, style: 'torch' })
  }
  lamp(x: number, z: number, y: number, color = 0xdfe8ff, power = 1.2) {
    return this.put('light', x, z, { y, color, power, style: 'lamp' })
  }
  /** Shift what follows by (dx, dz) cells. */
  offset(dx: number, dz: number) {
    this.ox = dx
    this.oz = dz
    return this
  }
  /**
   * A maze of corridors 2 m wide with 1 m walls: `cols` × `rows` maze cells
   * from (x0, z0). A seeded depth-first maze, with a few extra openings
   * (`loops`, 0..1) so it has more than one way round; a lamp every few cells.
   */
  maze(x0: number, z0: number, cols: number, rows: number, seed: number, f: number, c: number, t: Look = {}, loops = 0.12, light = 0xffa040): Maze {
    const r = seeded(seed)
    const at = (i: number, j: number): [number, number] => [x0 + i * 3, z0 + j * 3]
    const open = (i: number, j: number) => {
      const [x, z] = at(i, j)
      this.room(x, z, x + 1, z + 1, f, c, t)
    }
    const seen = new Set<number>()
    const links = new Map<number, number>()
    const pairs = new Set<string>()
    const link = (a: number, b: number) => {
      if (pairs.has(`${a},${b}`) || pairs.has(`${b},${a}`)) return
      pairs.add(`${a},${b}`)
      links.set(a, (links.get(a) ?? 0) + 1)
      links.set(b, (links.get(b) ?? 0) + 1)
      const [ai, aj] = [a % cols, Math.floor(a / cols)]
      const [bi, bj] = [b % cols, Math.floor(b / cols)]
      const [x, z] = at(Math.min(ai, bi), Math.min(aj, bj))
      if (ai !== bi) this.room(x + 2, z, x + 2, z + 1, f, c, t)
      else this.room(x, z + 2, x + 1, z + 2, f, c, t)
    }
    const nbrs = (k: number) => {
      const i = k % cols
      const j = Math.floor(k / cols)
      const out: number[] = []
      if (i > 0) out.push(k - 1)
      if (i < cols - 1) out.push(k + 1)
      if (j > 0) out.push(k - cols)
      if (j < rows - 1) out.push(k + cols)
      return out
    }
    const stack = [0]
    seen.add(0)
    open(0, 0)
    while (stack.length) {
      const k = stack[stack.length - 1]
      const next = nbrs(k).filter((n) => !seen.has(n))
      if (!next.length) {
        stack.pop()
        continue
      }
      const n = next[Math.floor(r() * next.length)]
      seen.add(n)
      open(n % cols, Math.floor(n / cols))
      link(k, n)
      stack.push(n)
    }
    // knock through some walls so it is not a single path
    for (let k = 0; k < cols * rows; k++)
      for (const n of nbrs(k)) if (n > k && r() < loops * 0.5) link(k, n)
    // lamps
    for (let j = 0; j < rows; j++)
      for (let i = (j * 2) % 4; i < cols; i += 4) {
        const [x, z] = at(i, j)
        this.put('light', x, z, { y: c - 0.5, color: light, power: 0.9, style: 'torch' })
      }
    const deadEnds: [number, number][] = []
    for (let k = 0; k < cols * rows; k++) if ((links.get(k) ?? 0) === 1) deadEnds.push([k % cols, Math.floor(k / cols)])
    deadEnds.sort((a, b) => b[0] + b[1] - a[0] - a[1])
    return { at, deadEnds }
  }
  /**
   * Open country under the sky: rolling hills that flatten towards the edges
   * (so paths in and out meet them level), never steeper than a step.
   */
  hills(x0: number, z0: number, x1: number, z1: number, base: number, amp: number, seed: number, c: number, floor: Tex = 'grass', wall: Tex = 'stone') {
    const r = seeded(seed)
    const waves = Array.from({ length: 5 }, () => ({ a: r() * Math.PI * 2, k: 0.12 + r() * 0.16, p: r() * 10, w: 0.5 + r() }))
    const sum = waves.reduce((s, w) => s + w.w, 0)
    const hs = new Map<string, number>()
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        let n = 0
        for (const w of waves) n += w.w * Math.sin((x * Math.cos(w.a) + z * Math.sin(w.a)) * w.k + w.p)
        n = (n / sum + 1) / 2 // 0..1
        const edge = Math.min(1, Math.min(x - x0, x1 - x, z - z0, z1 - z) / 7)
        hs.set(`${x},${z}`, base + amp * n * n * edge * edge * (3 - 2 * edge))
      }
    // never steeper than a step: lower anything that rises too fast
    for (let pass = 0; pass < 40; pass++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          let h = hs.get(`${x},${z}`)!
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const o = hs.get(`${x + dx},${z + dz}`)
            if (o !== undefined) h = Math.min(h, o + 0.4)
          }
          hs.set(`${x},${z}`, h)
        }
    this.each(x0, z0, x1, z1, (cell, x, z) => {
      const f = Math.round(hs.get(`${x - this.ox},${z - this.oz}`)! * 100) / 100
      Object.assign(cell, { solid: false, f, c, wall, floor, ceil: 'stone', sky: true, terrain: true })
      delete cell.liquid
    })
    return this
  }
  /** Rows of server racks: blocks 2.2 m high with the rack fronts on their sides (too tall to climb). */
  racks(x0: number, z0: number, x1: number, z1: number, base: number, c: number, ceil: Tex = 'ceiltile') {
    return this.room(x0, z0, x1, z1, base + 2.2, c, { wall: 'server', floor: 'metal', ceil })
  }
  /** Desks and consoles: waist-high blocks. */
  desks(x0: number, z0: number, x1: number, z1: number, base: number, c: number, ceil: Tex = 'ceiltile') {
    return this.room(x0, z0, x1, z1, base + 0.9, c, { wall: 'metal', floor: 'wood', ceil })
  }
  /** A ceiling lamp every `step` cells over a box. */
  lamps(x0: number, z0: number, x1: number, z1: number, y: number, step: number, color = 0xdfe8ff, power = 1.1) {
    for (let z = z0; z <= z1; z += step) for (let x = x0; x <= x1; x += step) this.lamp(x, z, y, color, power)
    return this
  }
  /** The ground height at a cell (to stand things on hills). */
  height(x: number, z: number) {
    return this.cells[(z + this.oz) * this.w + x + this.ox].f
  }
  /**
   * Scatter `count` trees over the terrain in a box: never next to another
   * tree, a wall, a path or a thing, so they never close a way through.
   */
  trees(x0: number, z0: number, x1: number, z1: number, count: number, seed: number, kinds: TreeKind[] = ['pine', 'oak']) {
    const r = seeded(seed)
    const taken = new Set(this.ents.map((e) => `${Math.floor(e.x)},${Math.floor(e.z)}`))
    for (let tries = 0, n = 0; n < count && tries < count * 40; tries++) {
      const x = x0 + this.ox + Math.floor(r() * (x1 - x0 + 1))
      const z = z0 + this.oz + Math.floor(r() * (z1 - z0 + 1))
      let ok = true
      for (let dz = -1; dz <= 1 && ok; dz++)
        for (let dx = -1; dx <= 1 && ok; dx++) {
          const c = this.cells[(z + dz) * this.w + x + dx]
          if (!c || c.solid || !c.terrain || c.tree || c.liquid) ok = false
        }
      for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2 && ok; dx++) if (taken.has(`${x + dx},${z + dz}`)) ok = false
      if (!ok) continue
      this.cells[z * this.w + x].tree = kinds[Math.floor(r() * kinds.length)]
      n++
    }
    return this
  }
  done(o: Omit<MapDef, 'name' | 'w' | 'h' | 'cells' | 'doors' | 'lifts' | 'ents' | 'secrets'>): MapDef {
    return { name: this.name, w: this.w, h: this.h, cells: this.cells, doors: this.doors, lifts: this.lifts, ents: this.ents, secrets: this.secrets, ...o }
  }
}

// ---------------------------------------------------------------- the data centre's looks

/** White panels, raised floor, ceiling tiles: offices, corridors, server halls. */
const DC: Look = { wall: 'panel', floor: 'raised', ceil: 'ceiltile' }
/** Plant rooms: machinery walls, grating, bare metal overhead. */
const PLANT: Look = { wall: 'tech', floor: 'grate', ceil: 'metal' }
/** Loading bays, shafts and vaults: steel walls, concrete floors. */
const DOCK: Look = { wall: 'metal', floor: 'slab', ceil: 'metal' }
const ALARM = 0xff4030

// ---------------------------------------------------------------- 1: The Perimeter (soldiers)

function perimeter(): MapDef {
  const b = new Builder('The Perimeter', 60, 90)
  // the loading bay where the truck dropped you, crates for cover
  b.room(18, 2, 41, 11, 0, 6, DOCK)
  b.solid(23, 6, 24, 7).solid(35, 5, 36, 6)
  b.put('start', 30, 3, { angle: 0 })
  b.lamps(22, 4, 38, 10, 5.6, 8)
  b.put('shells', 20, 10).put('nails', 40, 10).put('health', 20, 3)
  // a roll-up shutter into the building
  b.room(29, 12, 31, 12, 0, 3.4, DC).door(29, 12, 31, 12, undefined, 'shutter')
  b.room(29, 13, 31, 30, 0, 3.4, DC)
  b.lamps(30, 16, 30, 28, 3.1, 6)
  b.put('grunt', 30, 25, { angle: Math.PI })
  // the guard room behind double doors
  b.room(28, 19, 28, 20, 0, 3.4, DC).door(28, 19, 28, 20, undefined, 'split')
  b.room(18, 15, 27, 25, 0, 3.4, DC)
  b.desks(20, 17, 23, 18, 0, 3.4)
  b.lamps(20, 17, 26, 23, 3.1, 6)
  b.put('shotgun2', 25, 23).put('armor1', 19, 24).put('shells', 26, 16)
  b.put('grunt', 21, 21, { angle: Math.PI / 2 }).put('knight', 25, 16, { angle: Math.PI / 2 })
  // server hall A: rows of racks, aisles between them
  b.room(8, 31, 51, 46, 0, 5, DC)
  for (const z of [34, 38, 42]) b.racks(11, z, 20, z + 1, 0, 5).racks(24, z, 34, z + 1, 0, 5).racks(38, z, 47, z + 1, 0, 5)
  b.lamps(12, 32, 48, 44, 4.7, 9)
  b.put('grunt', 15, 37, { angle: Math.PI }).put('grunt', 44, 41, { angle: Math.PI }).put('grunt', 26, 44, { angle: Math.PI })
  b.put('hound', 30, 45, { angle: Math.PI }).put('hound', 9, 40, { angle: Math.PI })
  b.put('knight', 45, 33, { angle: Math.PI }).put('wraith', 30, 36, { y: 3.8 })
  b.put('nailgun', 50, 44).put('nails', 9, 32).put('health', 50, 32).put('key_silver', 49, 45)
  // the blue-card door and the corridor to the offices
  b.room(29, 47, 31, 47, 0, 3.4, DC).door(29, 47, 31, 47, 'silver', 'slide')
  b.room(29, 48, 31, 58, 0, 3.4, DC)
  b.lamps(30, 50, 30, 56, 3.1, 6)
  b.put('grunt', 30, 55, { angle: Math.PI })
  // open-plan offices: desks, a couple of partitions
  b.room(12, 59, 47, 74, 0, 3.6, { wall: 'panel', floor: 'slab', ceil: 'ceiltile' })
  b.solid(20, 59, 20, 65).solid(37, 68, 37, 74)
  for (const [x0, z0, x1, z1] of [[14, 62, 17, 63], [14, 68, 17, 69], [22, 62, 26, 63], [32, 64, 35, 65], [40, 62, 44, 63], [40, 69, 44, 70], [22, 70, 26, 71]]) b.desks(x0, z0, x1, z1, 0, 3.6)
  b.lamps(14, 61, 46, 73, 3.3, 8)
  b.put('grunt', 16, 66, { angle: Math.PI }).put('grunt', 43, 66, { angle: Math.PI }).put('knight', 30, 72, { angle: Math.PI })
  b.put('brute', 34, 61, { angle: Math.PI }).put('hound', 24, 67, { angle: Math.PI })
  b.put('health25', 13, 73).put('shells', 46, 60).put('nails', 13, 60)
  // the blast door and the stairwell down (the exit)
  b.room(29, 75, 31, 75, 0, 3.6, DOCK).door(29, 75, 31, 75, undefined, 'blast')
  b.room(25, 76, 35, 84, 0, 4, DOCK)
  b.lamp(30, 80, 3.7, ALARM).put('exit', 30, 82)
  return b.done({ fog: 0.012, fogColor: 0x0a0e14, sun: { dir: [0.3, 1, 0.2], power: 0.4, color: 0xbcd0ff }, skyTint: [0.2, 0.25, 0.35] })
}

// ---------------------------------------------------------------- 2: The Cooling Plant (heavier units, the first androids)

function coolingPlant(): MapDef {
  const b = new Builder('The Cooling Plant', 64, 100)
  b.room(24, 2, 39, 9, 0, 4, DC)
  b.put('start', 31, 3, { angle: 0 })
  b.lamps(26, 4, 38, 8, 3.7, 6)
  b.put('shells', 25, 8).put('nails', 38, 8)
  b.room(30, 10, 32, 10, 0, 3.4, DC).door(30, 10, 32, 10, undefined, 'split')
  b.room(30, 11, 32, 23, 0, 3.4, DC)
  b.lamps(31, 13, 31, 22, 3.1, 5)
  // a side armoury behind a shutter
  b.room(33, 15, 33, 16, 0, 3.4, PLANT).door(33, 15, 33, 16, undefined, 'shutter')
  b.room(34, 13, 40, 19, 0, 3.4, PLANT)
  b.lamp(37, 16, 3.1)
  b.put('supernail', 39, 18).put('nails', 35, 14).put('armor1', 39, 14).put('grunt', 37, 16, { angle: -Math.PI / 2 })
  // the plant hall: pillars, a big cooling unit, a lift up to the gantry
  b.room(6, 24, 57, 47, 0, 8, PLANT)
  for (const x of [14, 24, 38, 48]) for (const z of [30, 40]) b.solid(x, z, x + 1, z + 1)
  b.room(27, 31, 35, 36, 3, 8, { wall: 'tech', floor: 'metal', ceil: 'metal' })
  b.lamps(10, 27, 54, 45, 7.6, 11, 0xbfe0ff, 1.3)
  b.put('grunt', 20, 28, { angle: Math.PI }).put('grunt', 44, 27, { angle: Math.PI }).put('grunt', 52, 35, { angle: Math.PI })
  b.put('brute', 50, 44, { angle: Math.PI }).put('knight', 10, 30, { angle: Math.PI }).put('hound', 40, 45, { angle: Math.PI })
  b.put('wraith', 31, 40, { y: 5 }).put('wraith', 20, 44, { y: 5 })
  b.put('grenadel', 55, 26).put('rockets', 54, 46).put('health', 8, 26).put('health25', 30, 45)
  b.room(7, 47, 8, 47, 0, 8, PLANT).lift(7, 47, 8, 47, 0, 3.6)
  b.room(6, 48, 17, 55, 3.6, 8, PLANT)
  b.lamp(12, 52, 7.6, ALARM)
  b.put('key_silver', 16, 54).put('armor2', 7, 54).put('brute', 12, 52, { angle: 0 })
  // the blue-card shutter to server hall B, where the androids are
  b.room(30, 48, 32, 48, 0, 3.6, PLANT).door(30, 48, 32, 48, 'silver', 'shutter')
  b.room(30, 49, 32, 55, 0, 3.6, DC)
  b.room(8, 56, 55, 73, 0, 5, DC)
  for (const z of [59, 63, 67]) b.racks(11, z, 20, z + 1, 0, 5).racks(24, z, 29, z + 1, 0, 5).racks(34, z, 43, z + 1, 0, 5).racks(47, z, 52, z + 1, 0, 5)
  b.lamps(12, 57, 52, 71, 4.7, 8)
  b.put('ravager', 15, 62, { angle: Math.PI }).put('ravager', 49, 66, { angle: Math.PI })
  b.put('grunt', 26, 57, { angle: Math.PI }).put('grunt', 45, 71, { angle: Math.PI }).put('knight', 36, 61, { angle: Math.PI })
  b.put('wraith', 30, 70, { y: 3.8 }).put('hound', 10, 71, { angle: Math.PI })
  b.put('key_gold', 54, 72).put('health', 9, 57).put('nails', 54, 57).put('rockets', 20, 71)
  // the red-card blast door and the control room
  b.room(30, 74, 32, 74, 0, 4, DOCK).door(30, 74, 32, 74, 'gold', 'blast')
  b.room(22, 75, 41, 88, 0, 4.5, DC)
  b.desks(25, 80, 29, 81, 0, 4.5).desks(34, 80, 38, 81, 0, 4.5)
  b.lamps(24, 77, 40, 86, 4.2, 8, ALARM)
  b.put('brute', 31, 85, { angle: Math.PI }).put('grunt', 24, 86, { angle: Math.PI }).put('grunt', 39, 86, { angle: Math.PI })
  b.put('knight', 31, 78, { angle: Math.PI }).put('health25', 23, 76)
  b.put('exit', 31, 87)
  return b.done({ fog: 0.012, fogColor: 0x0a1014, sun: { dir: [0.3, 1, 0.2], power: 0.4, color: 0xbcd0ff }, skyTint: [0.2, 0.25, 0.35] })
}

// ---------------------------------------------------------------- 3: The Core (androids; destroy every core server)

function theCore(): MapDef {
  const b = new Builder('The Core', 64, 100)
  b.room(27, 2, 36, 7, 0, 4, PLANT)
  b.put('start', 31, 3, { angle: 0 })
  b.lamp(31, 5, 3.7)
  b.put('shells', 28, 6).put('nails', 35, 6).put('rockets', 31, 6).put('cells', 28, 3)
  b.room(30, 8, 32, 8, 0, 3.4, DC).door(30, 8, 32, 8, undefined, 'split')
  b.room(30, 9, 32, 17, 0, 3.4, DC)
  b.lamps(31, 10, 31, 16, 3.1, 6)
  // the armoury (blue card): the railgun
  b.room(33, 12, 33, 13, 0, 3.4, DC).door(33, 12, 33, 13, 'silver', 'slide')
  b.room(34, 9, 42, 16, 0, 3.4, PLANT)
  b.lamp(38, 12, 3.1, 0x60c0ff)
  b.put('railgun', 41, 15).put('cells', 41, 10).put('armor3', 35, 15).put('mega', 38, 12)
  // server hall C, with the first three cores among the racks
  b.room(6, 18, 57, 43, 0, 6, DC)
  for (const z of [21, 26, 31, 36]) b.racks(9, z, 18, z + 1, 0, 6).racks(22, z, 28, z + 1, 0, 6).racks(35, z, 41, z + 1, 0, 6).racks(45, z, 54, z + 1, 0, 6)
  b.lamps(10, 19, 54, 41, 5.7, 8)
  b.put('core', 31, 24).put('core', 20, 40).put('core', 50, 29)
  b.put('ravager', 15, 24, { angle: Math.PI }).put('ravager', 47, 34, { angle: Math.PI }).put('ravager', 26, 39, { angle: Math.PI })
  b.put('grunt', 8, 20, { angle: Math.PI }).put('grunt', 55, 41, { angle: Math.PI }).put('grunt', 40, 29, { angle: Math.PI })
  b.put('brute', 31, 35, { angle: Math.PI }).put('knight', 52, 19, { angle: Math.PI })
  b.put('wraith', 20, 30, { y: 4.5 }).put('wraith', 44, 22, { y: 4.5 })
  b.put('key_silver', 55, 20).put('nails', 7, 42).put('health25', 56, 42).put('shells', 7, 20).put('rockets', 31, 42)
  // the shutter to the core chamber
  b.room(30, 44, 32, 44, 0, 3.6, DC).door(30, 44, 32, 44, undefined, 'shutter')
  b.room(30, 45, 32, 50, 0, 3.6, DC)
  // the core chamber: five cores on a dais, the androids guarding them
  b.room(8, 51, 55, 80, 0, 10, PLANT)
  b.room(22, 60, 41, 71, 0.5, 10, { wall: 'tech', floor: 'metal', ceil: 'metal' })
  b.solid(14, 56, 15, 57).solid(48, 56, 49, 57).solid(14, 74, 15, 75).solid(48, 74, 49, 75)
  b.lamps(12, 54, 52, 78, 9.5, 10, 0x60c0ff, 1.4)
  b.put('core', 25, 63).put('core', 38, 63).put('core', 25, 68).put('core', 38, 68).put('core', 31, 65)
  for (const [x, z] of [[12, 60], [51, 60], [12, 72], [51, 72], [31, 77]]) b.put('ravager', x, z, { angle: Math.PI })
  b.put('brute', 20, 55, { angle: Math.PI }).put('brute', 43, 55, { angle: Math.PI })
  b.put('wraith', 31, 58, { y: 6 }).put('wraith', 18, 66, { y: 6 }).put('wraith', 45, 66, { y: 6 })
  b.put('grunt', 10, 78, { angle: Math.PI }).put('grunt', 53, 78, { angle: Math.PI })
  b.put('health', 9, 52).put('health', 54, 52).put('armor2', 31, 53).put('cells', 9, 79).put('rockets', 54, 79).put('quad', 31, 74)
  // the way out, behind a blast door: it only lets you go once every core is down
  b.room(30, 81, 32, 81, 0, 4, DOCK).door(30, 81, 32, 81, undefined, 'blast')
  b.room(26, 82, 37, 90, 0, 4, DOCK)
  b.lamp(31, 85, 3.7, ALARM).put('exit', 31, 88)
  return b.done({ exitNeedsKills: true, fog: 0.011, fogColor: 0x060c14, sun: { dir: [0.3, 1, 0.2], power: 0.4, color: 0xbcd0ff }, skyTint: [0.2, 0.25, 0.35] })
}

export const LEVELS: (() => MapDef)[] = [perimeter, coolingPlant, theCore]

// ---------------------------------------------------------------- queries shared by the game and the tests

export const STEP = 0.6

export function cellOf(m: MapDef, x: number, z: number): Cell | null {
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  if (cx < 0 || cz < 0 || cx >= m.w || cz >= m.h) return null
  return m.cells[cz * m.w + cx]
}
