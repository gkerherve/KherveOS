// Reaction Chain: atoms drop into a 7 × 10 rack. A connected group of atoms
// (touching side by side or one on top of the other) holding exactly the atoms
// of a molecule reacts: H + H + O touching make water and leave the board. The
// atoms above fall, and if they complete another molecule that one reacts too,
// a chain, each step worth more. A target molecule scores triple. Every 8
// reactions the level rises: a new element joins the mix and atoms drop on
// their own sooner. Dropping into a full column ends the game. Plain logic
// with no DOM, so it can be tested on its own.

export const COLS = 7
export const ROWS = 10
export const STEP = 1 / 60
/** Reactions per level. */
export const PER_LEVEL = 8
/** Largest molecule, in atoms. */
export const MAX_ATOMS = 5
/** Rows a second a falling atom moves. */
export const FALL_SPEED = 18
/** Seconds between the steps of a chain, so it can be watched. */
export const CHAIN_PAUSE = 0.35

export type El = 'H' | 'O' | 'C' | 'N' | 'Na' | 'Cl' | 'S'

export interface Molecule {
  formula: string
  name: string
  atoms: Partial<Record<El, number>>
  /** The level it first appears at (that of its newest element). */
  level: number
}

/** Each level adds an element (level 1 has two). */
export const LEVEL_ELEMENTS: El[][] = [['H', 'O'], ['C'], ['N'], ['Na', 'Cl'], ['S']]

export const MOLECULES: Molecule[] = [
  { formula: 'H₂O', name: 'water', atoms: { H: 2, O: 1 }, level: 1 },
  { formula: 'H₂O₂', name: 'hydrogen peroxide', atoms: { H: 2, O: 2 }, level: 1 },
  { formula: 'CO', name: 'carbon monoxide', atoms: { C: 1, O: 1 }, level: 2 },
  { formula: 'CO₂', name: 'carbon dioxide', atoms: { C: 1, O: 2 }, level: 2 },
  { formula: 'CH₄', name: 'methane', atoms: { C: 1, H: 4 }, level: 2 },
  { formula: 'NH₃', name: 'ammonia', atoms: { N: 1, H: 3 }, level: 3 },
  { formula: 'HCN', name: 'hydrogen cyanide', atoms: { H: 1, C: 1, N: 1 }, level: 3 },
  { formula: 'NO₂', name: 'nitrogen dioxide', atoms: { N: 1, O: 2 }, level: 3 },
  { formula: 'NaCl', name: 'table salt', atoms: { Na: 1, Cl: 1 }, level: 4 },
  { formula: 'HCl', name: 'hydrogen chloride', atoms: { H: 1, Cl: 1 }, level: 4 },
  { formula: 'NaOH', name: 'sodium hydroxide', atoms: { Na: 1, O: 1, H: 1 }, level: 4 },
  { formula: 'H₂S', name: 'hydrogen sulfide', atoms: { H: 2, S: 1 }, level: 5 },
  { formula: 'SO₂', name: 'sulfur dioxide', atoms: { S: 1, O: 2 }, level: 5 },
  { formula: 'SO₃', name: 'sulfur trioxide', atoms: { S: 1, O: 3 }, level: 5 },
]

/** How often each element comes up (hydrogen is in most molecules). */
const WEIGHTS: Record<El, number> = { H: 5, O: 3, C: 2, N: 2, Na: 1, Cl: 1, S: 1 }

export const atomCount = (m: Molecule) => Object.values(m.atoms).reduce((a, b) => a + (b ?? 0), 0)

/** Elements in play at a level. */
export function elementsAt(level: number): El[] {
  return LEVEL_ELEMENTS.slice(0, Math.max(1, level)).flat()
}

/** Molecules that can be made at a level. */
export function moleculesAt(level: number): Molecule[] {
  return MOLECULES.filter((m) => m.level <= level)
}

/** Seconds before an atom drops on its own. */
export function dropTime(level: number): number {
  return Math.max(2, 8 - level * 0.75)
}

/** Points for a molecule of `atoms` atoms, made at chain step `chain` (1 = no chain). */
export function pointsFor(atoms: number, chain: number, target: boolean): number {
  return 10 * atoms * atoms * chain * (target ? 3 : 1)
}

export interface Tile {
  el: El
  id: number
  /** Rows above its place it is still falling (drawn there; 0 = landed). */
  off: number
}

export interface Cell {
  c: number
  r: number
}

export interface Reaction {
  molecule: Molecule
  cells: Cell[]
  chain: number
  target: boolean
  points: number
}

export type ChainEvent =
  | { type: 'move' }
  | { type: 'drop'; c: number }
  | { type: 'react'; reaction: Reaction; atoms: { c: number; r: number; el: El }[] }
  | { type: 'level'; level: number; added: El[] }
  | { type: 'full' }
  | { type: 'over' }

export type State = 'play' | 'over'

const key = (c: number, r: number) => c * 64 + r

/** Atom counts of a group. */
function countOf(cols: Tile[][], cells: Cell[]): Partial<Record<El, number>> {
  const n: Partial<Record<El, number>> = {}
  for (const { c, r } of cells) {
    const el = cols[c][r].el
    n[el] = (n[el] ?? 0) + 1
  }
  return n
}

const fits = (n: Partial<Record<El, number>>, m: Molecule) => (Object.keys(n) as El[]).every((e) => (n[e] ?? 0) <= (m.atoms[e] ?? 0))
const equals = (n: Partial<Record<El, number>>, m: Molecule) =>
  fits(n, m) && (Object.keys(m.atoms) as El[]).every((e) => (n[e] ?? 0) === m.atoms[e])

/**
 * The best molecule on the board: every connected group of up to MAX_ATOMS
 * atoms is tried, the biggest molecule wins, then the target, then the one
 * lowest on the board. Null if nothing reacts.
 */
export function findReaction(cols: Tile[][], molecules: Molecule[], target: Molecule | null): { molecule: Molecule; cells: Cell[] } | null {
  let best: { molecule: Molecule; cells: Cell[]; rank: number } | null = null
  const seen = new Set<string>()
  const neighbours = ({ c, r }: Cell): Cell[] => {
    const out: Cell[] = []
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc
      const nr = r + dr
      if (nc >= 0 && nc < COLS && nr >= 0 && nr < cols[nc].length) out.push({ c: nc, r: nr })
    }
    return out
  }
  const visit = (cells: Cell[]) => {
    const id = cells.map((x) => key(x.c, x.r)).sort((a, b) => a - b).join(',')
    if (seen.has(id)) return
    seen.add(id)
    const n = countOf(cols, cells)
    const could = molecules.filter((m) => fits(n, m))
    if (!could.length) return
    for (const m of could)
      if (equals(n, m)) {
        const low = Math.min(...cells.map((x) => x.r))
        const rank = atomCount(m) * 1000 + (m === target ? 500 : 0) + (ROWS - low)
        if (!best || rank > best.rank) best = { molecule: m, cells: [...cells], rank }
      }
    if (cells.length >= MAX_ATOMS) return
    const inside = new Set(cells.map((x) => key(x.c, x.r)))
    for (const cell of cells)
      for (const nb of neighbours(cell))
        if (!inside.has(key(nb.c, nb.r))) visit([...cells, nb])
  }
  for (let c = 0; c < COLS; c++) for (let r = 0; r < cols[c].length; r++) if (cols[c][r].off === 0) visit([{ c, r }])
  const b = best as { molecule: Molecule; cells: Cell[] } | null
  return b ? { molecule: b.molecule, cells: b.cells } : null
}

export class ReactionChain {
  /** The rack, a stack per column (index 0 at the bottom). */
  cols: Tile[][] = []
  /** The atom over the rack and the two after it. */
  current: El = 'H'
  next: El[] = []
  /** Column the current atom is over. */
  column = 3
  level = 1
  reactions = 0
  score = 0
  /** Longest chain so far. */
  bestChain = 0
  /** Molecules made, by formula. */
  made: Record<string, number> = {}
  target: Molecule | null = null
  /** Seconds left before the atom drops on its own. */
  timer = dropTime(1)
  /** Chain step being resolved (0 = waiting for the player). */
  chain = 0
  private pause = 0
  state: State = 'play'
  stateTime = 0
  events: ChainEvent[] = []
  private ids = 0
  private lastAtom: El | null = null
  private run = 0
  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  get over(): boolean {
    return this.state === 'over' && this.stateTime >= 1.6
  }

  /** True while atoms fall or a chain is being resolved: the player waits. */
  get busy(): boolean {
    return this.chain > 0 || this.falling
  }

  get falling(): boolean {
    return this.cols.some((col) => col.some((t) => t.off > 0))
  }

  reset() {
    this.cols = Array.from({ length: COLS }, () => [])
    this.level = 1
    this.reactions = 0
    this.score = 0
    this.bestChain = 0
    this.made = {}
    this.column = Math.floor(COLS / 2)
    this.chain = 0
    this.pause = 0
    this.state = 'play'
    this.stateTime = 0
    this.events = []
    this.lastAtom = null
    this.run = 0
    this.target = this.pickTarget()
    this.next = [this.pickAtom(), this.pickAtom()]
    this.current = this.pickAtom()
    this.timer = dropTime(1)
  }

  private pickTarget(): Molecule {
    const list = moleculesAt(this.level)
    const others = list.filter((m) => m !== this.target)
    const pool = others.length ? others : list
    return pool[Math.floor(this.rng() * pool.length)]
  }

  /** A random element of the level, a little biased towards the target's atoms; a third in a row of the same is drawn again once. */
  pickAtom(): El {
    let el = this.drawAtom()
    if (this.run >= 2 && el === this.lastAtom) el = this.drawAtom()
    this.run = el === this.lastAtom ? this.run + 1 : 1
    this.lastAtom = el
    return el
  }

  private drawAtom(): El {
    const els = elementsAt(this.level)
    if (this.target && this.rng() < 0.3) {
      const want = Object.keys(this.target.atoms) as El[]
      return want[Math.floor(this.rng() * want.length)]
    }
    const total = els.reduce((a, e) => a + WEIGHTS[e], 0)
    let x = this.rng() * total
    for (const e of els) {
      x -= WEIGHTS[e]
      if (x < 0) return e
    }
    return els[els.length - 1]
  }

  // ------------------------------------------------------------ controls

  move(dc: number) {
    if (this.state !== 'play') return
    const c = Math.max(0, Math.min(COLS - 1, this.column + dc))
    if (c !== this.column) {
      this.column = c
      this.events.push({ type: 'move' })
    }
  }

  moveTo(c: number) {
    if (this.state !== 'play') return
    c = Math.max(0, Math.min(COLS - 1, Math.floor(c)))
    if (c !== this.column) {
      this.column = c
      this.events.push({ type: 'move' })
    }
  }

  /** Drops the current atom into its column. False if it can't now (busy, or the column is full). */
  drop(forced = false): boolean {
    if (this.state !== 'play' || this.busy) return false
    const col = this.cols[this.column]
    if (col.length >= ROWS) {
      if (forced || this.cols.every((x) => x.length >= ROWS)) this.end()
      else this.events.push({ type: 'full' })
      return false
    }
    col.push({ el: this.current, id: ++this.ids, off: ROWS + 0.6 - col.length })
    this.events.push({ type: 'drop', c: this.column })
    this.current = this.next.shift()!
    this.next.push(this.pickAtom())
    this.chain = 1
    this.pause = 0
    return true
  }

  // ------------------------------------------------------------ the clock

  update(dt = STEP) {
    this.stateTime += dt
    if (this.state !== 'play') return
    let moving = false
    for (const col of this.cols)
      for (const t of col)
        if (t.off > 0) {
          t.off = Math.max(0, t.off - FALL_SPEED * dt)
          moving = true
        }
    if (moving) return
    if (this.chain > 0) {
      this.pause -= dt
      if (this.pause <= 0) this.resolveStep()
      return
    }
    this.timer -= dt
    if (this.timer <= 0) {
      this.timer = dropTime(this.level)
      this.drop(true)
    }
  }

  /** One step of a chain: the best reaction on the board, then gravity. */
  private resolveStep(): boolean {
    const found = findReaction(this.cols, moleculesAt(this.level), this.target)
    if (!found) {
      this.chain = 0
      this.timer = dropTime(this.level)
      return false
    }
    const target = found.molecule === this.target
    const points = pointsFor(atomCount(found.molecule), this.chain, target)
    const reaction: Reaction = { molecule: found.molecule, cells: found.cells, chain: this.chain, target, points }
    const atoms = found.cells.map(({ c, r }) => ({ c, r, el: this.cols[c][r].el }))
    this.score += points
    this.reactions++
    this.bestChain = Math.max(this.bestChain, this.chain)
    this.made[found.molecule.formula] = (this.made[found.molecule.formula] ?? 0) + 1
    this.events.push({ type: 'react', reaction, atoms })
    // Take the atoms out; those above fall by as many places as were removed below them.
    const gone = new Set(found.cells.map((x) => key(x.c, x.r)))
    for (let c = 0; c < COLS; c++) {
      let removed = 0
      const kept: Tile[] = []
      this.cols[c].forEach((t, r) => {
        if (gone.has(key(c, r))) removed++
        else {
          t.off += removed
          kept.push(t)
        }
      })
      this.cols[c] = kept
    }
    if (target) this.target = this.pickTarget()
    if (this.reactions % PER_LEVEL === 0 && this.level < 99) {
      this.level++
      const added = LEVEL_ELEMENTS[this.level - 1] ?? []
      this.events.push({ type: 'level', level: this.level, added })
      if (added.length) this.target = this.pickTarget()
    }
    this.chain++
    this.pause = CHAIN_PAUSE
    return true
  }

  /** Lands every falling atom and resolves the whole chain at once (for the AI). Returns the reactions made. */
  settle(): Reaction[] {
    const out: Reaction[] = []
    for (const col of this.cols) for (const t of col) t.off = 0
    while (this.chain > 0) {
      const before = this.events.length
      if (!this.resolveStep()) break
      for (const e of this.events.slice(before)) if (e.type === 'react') out.push(e.reaction)
      for (const col of this.cols) for (const t of col) t.off = 0
    }
    return out
  }

  private end() {
    this.state = 'over'
    this.stateTime = 0
    this.chain = 0
    this.events.push({ type: 'over' })
  }
}
