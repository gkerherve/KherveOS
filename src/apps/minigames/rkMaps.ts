// Rune Keep: the levels. A level is a grid of 1 m cells; each open cell has
// a floor and a ceiling height and its textures. Rooms, stairs, liquids,
// doors, lifts and secrets are carved with a small builder, and things
// (the start, monsters, items, lights, the exit) are placed by cell
// coordinates. Mazes of corridors and open hills with trees are generated
// from a seed, so a level is the same every time. Pure data: no three.js here (tools/tests/runekeep-maps.test.ts
// checks every level can be finished).

export type Tex = 'stone' | 'brick' | 'metal' | 'wood' | 'rune' | 'grate' | 'tech' | 'dirt' | 'slab' | 'grass' | 'ash'
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
  door(x0: number, z0: number, x1: number, z1: number, key?: Key) {
    const id = this.doors.length
    this.doors.push({ id, x0: x0 + this.ox, z0: z0 + this.oz, x1: x1 + this.ox, z1: z1 + this.oz, key })
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

// ---------------------------------------------------------------- E1: The Outer Gate

function outerGate(): MapDef {
  const b = new Builder('The Outer Gate', 72, 116)
  // start chamber and its hidden niche
  b.room(30, 2, 39, 9, 0, 5, { wall: 'stone', floor: 'slab' })
  b.room(27, 5, 29, 6, 0, 3, { wall: 'brick', floor: 'slab' }).secret(27, 5, 28, 6)
  b.put('start', 34, 3, { angle: 0 })
  b.torch(30, 2).torch(39, 2)
  b.put('shells', 38, 8).put('nailgun', 27, 5).put('nails', 28, 6)

  // the cellars: a maze of brick corridors
  b.room(35, 10, 36, 11, 0, 3.5, { wall: 'brick', floor: 'slab' })
  const A = b.maze(14, 12, 12, 8, 11, 0, 3.5, { wall: 'brick', floor: 'slab', ceil: 'wood' })
  const [ax, az] = A.at(1, 7)
  b.room(ax, az + 2, ax + 1, az + 4, 0, 3.5, { wall: 'brick', floor: 'slab' })
  b.room(ax, az + 5, ax + 1, az + 5, 0, 3.5, { wall: 'metal', floor: 'slab' }).door(ax, az + 5, ax + 1, az + 5)
  const cellar: [string, number, number][] = [['grunt', 5, 1], ['grunt', 9, 3], ['hound', 2, 4], ['grunt', 6, 6], ['grunt', 10, 7], ['hound', 3, 2]]
  for (const [k, i, j] of cellar) b.put(k as Ent['kind'], ...A.at(i, j), { angle: Math.PI })
  const ends = A.deadEnds
  for (const [n, k] of (['health', 'shells', 'armor1', 'shells', 'health'] as Ent['kind'][]).entries()) if (ends[n]) b.put(k, ...A.at(...ends[n]))

  // out onto the hills: grass, trees, open sky
  b.hills(4, az + 6, 66, 86, 0, 5, 7, 22)
  const hx = (x: number, z: number) => b.height(x, z)
  b.put('grunt', 12, 50, { angle: Math.PI }).put('grunt', 40, 56, { angle: Math.PI }).put('hound', 22, 66, { angle: Math.PI })
  b.put('hound', 52, 70, { angle: Math.PI }).put('grunt', 60, 48, { angle: -Math.PI / 2 }).put('knight', 34, 78, { angle: Math.PI })
  b.put('wraith', 46, 62, { y: 7 }).put('wraith', 16, 76, { y: 7 })
  // the silver key on the highest ground
  let top: [number, number] = [30, 60]
  for (let z = 44; z <= 82; z++) for (let x = 8; x <= 62; x++) if (hx(x, z) > hx(...top)) top = [x, z]
  b.put('key_silver', ...top).put('armor2', top[0] + 1, top[1] + 1)
  b.put('health', 8, 46).put('shells', 58, 80).put('health25', 44, 72).put('nails', 26, 54).put('shotgun2', 62, 58)
  b.trees(5, az + 7, 65, 85, 90, 21)

  // the keep gate (silver key) and the keep's corridors
  b.room(31, 87, 32, 87, 0, 4, { wall: 'metal', floor: 'slab' }).door(31, 87, 32, 87, 'silver')
  b.torch(30, 86).torch(33, 86)
  const B = b.maze(10, 88, 14, 7, 5, 0, 4, { wall: 'rune', floor: 'stone', ceil: 'stone' }, 0.15, 0xff8050)
  const keep: [string, number, number][] = [['knight', 4, 2], ['grunt', 9, 1], ['knight', 11, 4], ['grunt', 2, 5], ['brute', 7, 6], ['grunt', 13, 3]]
  for (const [k, i, j] of keep) b.put(k as Ent['kind'], ...B.at(i, j), { angle: Math.PI })
  for (const [n, k] of (['health25', 'rockets', 'shells', 'health', 'grenadel'] as Ent['kind'][]).entries()) if (B.deadEnds[n]) b.put(k, ...B.at(...B.deadEnds[n]))

  // the last hall and the exit
  const [bx, bz] = B.at(13, 6)
  b.room(bx + 2, bz, bx + 6, bz + 1, 0, 4, { wall: 'rune', floor: 'stone' })
  b.room(bx + 7, bz - 6, bx + 16, bz + 7, 0, 7, { wall: 'rune', floor: 'tech', ceil: 'stone' })
  b.liquid(bx + 10, bz - 2, bx + 13, bz + 1, 'lava', -0.5)
  b.put('knight', bx + 9, bz + 4, { angle: -Math.PI / 2 }).put('knight', bx + 14, bz - 4, { angle: -Math.PI / 2 })
  b.put('exit', bx + 15, bz + 6).lamp(bx + 9, bz + 6, 6.6, 0x9fd0ff).lamp(bx + 14, bz - 5, 6.6, 0x9fd0ff)
  b.torch(bx + 7, bz - 4).torch(bx + 16, bz + 2)
  return b.done({ fog: 0.011, fogColor: 0x2a2418, sun: { dir: [-0.4, 1, 0.3], power: 1.6, color: 0xffe2b8 }, skyTint: [0.5, 0.42, 0.3] })
}

// ---------------------------------------------------------------- E2: Halls of Embers

function hallsOfEmbers(): MapDef {
  const b = new Builder('Halls of Embers', 96, 140)
  b.room(30, 2, 41, 9, 0, 5, { wall: 'metal', floor: 'tech', ceil: 'metal' })
  b.put('start', 35, 3, { angle: 0 })
  b.lamp(32, 5, 4.6).lamp(39, 5, 4.6)
  b.put('shells', 31, 8).put('nails', 40, 8)
  // a secret niche: megahealth
  b.room(42, 4, 44, 6, 0, 3, { wall: 'brick', floor: 'slab' }).secret(43, 4, 44, 6)
  b.put('mega', 43, 5)

  // the furnace ducts: a maze of metal corridors
  b.room(34, 10, 35, 11, 0, 3.5, { wall: 'metal', floor: 'grate', ceil: 'metal' })
  const M = b.maze(22, 12, 10, 6, 41, 0, 3.5, { wall: 'metal', floor: 'grate', ceil: 'metal' }, 0.15, 0xffb070)
  b.room(34, 29, 35, 31, 0, 3.5, { wall: 'metal', floor: 'grate', ceil: 'metal' })
  for (const [k, i, j] of [['grunt', 2, 1], ['hound', 7, 2], ['grunt', 1, 4], ['grunt', 8, 5], ['hound', 5, 3]] as [Ent['kind'], number, number][]) b.put(k, ...M.at(i, j), { angle: Math.PI })
  for (const [n, k] of (['shells', 'health', 'nails', 'armor1'] as Ent['kind'][]).entries()) if (M.deadEnds[n]) b.put(k, ...M.at(...M.deadEnds[n]))

  // everything after the ducts sits 22 cells further on
  b.offset(0, 22)

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

  // the gold door, and out under a burning sky: ash hills and dead trees
  b.room(34, 51, 37, 51, 0, 6, { wall: 'metal', floor: 'slab' }).door(34, 51, 37, 51, 'gold')
  b.room(34, 52, 37, 55, 0, 6, { wall: 'metal', floor: 'slab' })
  b.offset(0, 0)
  b.hills(4, 78, 90, 136, 0, 6, 13, 24, 'ash', 'rune')
  b.put('knight', 30, 92, { angle: Math.PI }).put('knight', 52, 98, { angle: Math.PI }).put('brute', 20, 110, { angle: Math.PI })
  b.put('brute', 66, 116, { angle: Math.PI }).put('hound', 44, 104, { angle: Math.PI }).put('hound', 76, 90, { angle: Math.PI })
  b.put('wraith', 40, 120, { y: 8 }).put('wraith', 14, 96, { y: 8 }).put('knight', 80, 128, { angle: Math.PI })
  b.put('health25', 10, 86).put('health25', 84, 104).put('rockets', 50, 118).put('armor2', 28, 124).put('nails', 64, 86)
  b.put('exit', 46, 133)
  b.trees(5, 79, 89, 135, 70, 17, ['dead'])
  return b.done({ fog: 0.013, fogColor: 0x220c05, sun: { dir: [0.3, 1, -0.5], power: 1.1, color: 0xff9a60 }, skyTint: [0.7, 0.22, 0.08] })
}

// ---------------------------------------------------------------- E3: The Rune Vault

function runeVault(): MapDef {
  const b = new Builder('The Rune Vault', 64, 108)
  b.room(28, 2, 35, 7, 0, 5, { wall: 'rune', floor: 'slab' })
  b.put('start', 31, 3, { angle: 0 })
  b.torch(28, 4).torch(35, 4)
  b.put('shells', 29, 6).put('nails', 34, 6).put('rockets', 31, 6)

  // the rune labyrinth before the vault
  b.room(29, 8, 30, 9, 0, 4, { wall: 'rune', floor: 'slab' })
  const L = b.maze(17, 10, 10, 7, 77, 0, 4, { wall: 'rune', floor: 'slab', ceil: 'stone' }, 0.1, 0xff7040)
  for (const [k, i, j] of [['knight', 2, 2], ['grunt', 7, 1], ['hound', 8, 4], ['knight', 1, 5], ['grunt', 5, 4]] as [Ent['kind'], number, number][]) b.put(k, ...L.at(i, j), { angle: Math.PI })
  for (const [n, k] of (['health25', 'shells', 'nails', 'armor1'] as Ent['kind'][]).entries()) if (L.deadEnds[n]) b.put(k, ...L.at(...L.deadEnds[n]))

  // a walk over the moor under the violet sky
  b.room(29, 30, 30, 30, 0, 4, { wall: 'rune', floor: 'slab' })
  b.hills(6, 31, 57, 53, 0, 5, 29, 20)
  b.put('hound', 14, 40, { angle: Math.PI }).put('hound', 48, 44, { angle: Math.PI }).put('knight', 36, 48, { angle: Math.PI }).put('wraith', 22, 46, { y: 7 })
  b.put('health', 10, 34).put('shells', 52, 50).put('cells', 40, 36)
  b.trees(7, 32, 56, 52, 45, 9, ['pine', 'dead'])

  // the arena and the vault sit 46 cells further on
  b.offset(0, 46)
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
