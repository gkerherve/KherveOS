// Tetris rules: a 10×20 well, the seven tetrominoes dealt from a 7-bag, SRS
// rotation with wall kicks, hold, a next queue, lock delay with move resets,
// and guideline scoring (line clears, T-spins, back-to-back, combos, drop
// points). Plain logic with no DOM, so it can be tested on its own.

export type Kind = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z'
export const KINDS: readonly Kind[] = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']

export const COLS = 10
export const ROWS = 20
/** Rows kept above the visible well; pieces appear there. */
export const HIDDEN = 4
export const TOTAL = ROWS + HIDDEN

/** Seconds a piece may rest on the stack before it locks. */
export const LOCK_DELAY = 0.5
/** Moves and turns on the stack that restart the lock delay, per piece. */
export const MAX_RESETS = 15
/** Auto-repeat of a held arrow: the wait before repeating, then the repeat interval. */
export const DAS = 0.16
export const ARR = 0.04
/** Soft drop falls this many times faster than gravity. */
export const SOFT_DROP = 20
/** How long cleared lines flash before the stack falls. */
export const CLEAR_TIME = 0.3
/** The closing animation after topping out. */
export const END_TIME = 1.5

export type Cell = readonly [number, number]

/** Spawn shapes (rotation 0) in their bounding box: x right, y down. */
const SHAPES: Record<Kind, { size: number; cells: Cell[] }> = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  O: { size: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
}

/**
 * CELLS[kind][rotation]: rotations 0 (spawn), 1 (R), 2 and 3 (L), each a
 * clockwise quarter turn of the box — SRS's "true rotation". O never moves.
 */
export const CELLS = Object.fromEntries(
  KINDS.map((k) => {
    const { size, cells } = SHAPES[k]
    const states: Cell[][] = [cells]
    for (let r = 1; r < 4; r++) {
      states.push(k === 'O' ? cells : states[r - 1].map(([x, y]) => [size - 1 - y, x] as const))
    }
    return [k, states]
  }),
) as Record<Kind, Cell[][]>

type Kick = readonly [number, number]

// SRS wall kicks as published (x right, y UP), tried in order: "from>to".
const KICKS_JLSTZ: Record<string, Kick[]> = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
}
const KICKS_I: Record<string, Kick[]> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
}

/** The kick tests for a turn, in SRS's own coordinates (y up). */
export function kicks(kind: Kind, from: number, to: number): readonly Kick[] {
  if (kind === 'O') return [[0, 0]]
  return (kind === 'I' ? KICKS_I : KICKS_JLSTZ)[`${from}>${to}`]
}

/** Seconds per row at a level (the guideline curve, at full speed from level 20). */
export function gravity(level: number): number {
  const l = Math.min(Math.max(level, 1), 20) - 1
  return Math.pow(0.8 - l * 0.007, l)
}

// ---------------------------------------------------------------- scoring

export type Spin = 'none' | 'mini' | 'full'

export interface ClearResult {
  lines: number
  spin: Spin
  points: number
  /** Got the back-to-back bonus (a Tetris or T-spin right after another). */
  b2b: boolean
  /** Combo count for this clear (0 = the first clear in a row). */
  combo: number
  /** The well is empty afterwards. */
  perfect: boolean
  /** "Tetris", "T-Spin Double"… */
  name: string
}

const LINE_POINTS = [0, 100, 300, 500, 800]
const TSPIN_POINTS = [400, 800, 1200, 1600]
const MINI_POINTS = [100, 200, 400]
const PERFECT_POINTS = [0, 800, 1200, 1800, 2000]

export function clearName(lines: number, spin: Spin): string {
  const counts = ['', 'Single', 'Double', 'Triple', 'Tetris']
  if (spin === 'none') return counts[lines]
  return `${spin === 'mini' ? 'Mini ' : ''}T-Spin${lines ? ` ${counts[lines]}` : ''}`
}

/**
 * Points for a piece that cleared `lines` (or spun without clearing), at
 * `level`. `chain` carries the back-to-back and combo state from piece to
 * piece and is updated.
 */
export function scoreClear(lines: number, spin: Spin, level: number, chain: { b2b: boolean; combo: number }, perfect = false): ClearResult {
  let base = spin === 'full' ? TSPIN_POINTS[lines] : spin === 'mini' ? MINI_POINTS[Math.min(lines, 2)] : LINE_POINTS[lines]
  let b2b = false
  if (lines > 0) {
    const difficult = lines === 4 || spin !== 'none'
    if (difficult && chain.b2b) {
      base *= 1.5
      b2b = true
    }
    chain.b2b = difficult
    chain.combo += 1
  } else {
    chain.combo = -1
  }
  let points = Math.floor(base * level)
  if (lines > 0 && chain.combo > 0) points += 50 * chain.combo * level
  if (lines > 0 && perfect) points += PERFECT_POINTS[lines] * level
  return { lines, spin, points, b2b, combo: lines > 0 ? chain.combo : 0, perfect: lines > 0 && perfect, name: clearName(lines, spin) }
}

// -------------------------------------------------------------- the game

export type Action = 'left' | 'right' | 'down' | 'cw' | 'ccw' | 'drop' | 'hold'

export interface Piece {
  kind: Kind
  rot: number
  /** The top-left of the piece's box, in well cells (row 0 is the top hidden row). */
  x: number
  y: number
}

export type TetrisEvent =
  | { type: 'move' }
  | { type: 'rotate' }
  | { type: 'hold' }
  /** The falling piece touched the stack. */
  | { type: 'land' }
  | { type: 'lock'; kind: Kind; cells: Cell[] }
  /** A hard drop of `rows` rows; `from` is the piece's cells before falling. */
  | { type: 'drop'; kind: Kind; cells: Cell[]; from: Cell[]; rows: number }
  | { type: 'clear'; rows: number[]; result: ClearResult }
  /** A T-spin that cleared nothing (it still scores). */
  | { type: 'spin'; result: ClearResult }
  | { type: 'level'; level: number }
  | { type: 'topout' }

export class Tetris {
  /** COLS × TOTAL cells, row by row: 0 empty, else 1 + the index of the kind in KINDS. */
  board = new Uint8Array(COLS * TOTAL)
  piece: Piece | null = null
  hold: Kind | null = null
  canHold = true
  queue: Kind[] = []
  score = 0
  lines = 0
  level = 1
  /** Topped out; the closing animation runs for END_TIME. */
  dead = false
  endTime = 0
  /** Full rows flashing before they go. */
  clearing: { rows: number[]; t: number } | null = null
  /** What happened since the caller last emptied this (sounds, effects). */
  events: TetrisEvent[] = []

  private chain = { b2b: false, combo: -1 }
  private held = { left: false, right: false, down: false }
  private dir = 0
  private das = 0
  private arr = 0
  private fall = 0
  private lockTime = 0
  private resets = 0
  private lowest = 0
  private grounded = false
  /** The last thing the piece did was a turn, and which kick test it used (for T-spins). */
  private spun = false
  private kick = -1

  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  get over(): boolean {
    return this.dead && this.endTime >= END_TIME
  }
  get b2b(): boolean {
    return this.chain.b2b
  }
  get combo(): number {
    return this.chain.combo
  }
  /** 0..1 while the piece rests on the stack, waiting to lock. */
  get lockProgress(): number {
    return this.grounded ? Math.min(1, this.lockTime / LOCK_DELAY) : 0
  }

  reset() {
    this.board = new Uint8Array(COLS * TOTAL)
    this.piece = null
    this.hold = null
    this.canHold = true
    this.queue = []
    this.score = 0
    this.lines = 0
    this.level = 1
    this.dead = false
    this.endTime = 0
    this.clearing = null
    this.events = []
    this.chain = { b2b: false, combo: -1 }
    this.releaseAll()
    this.spawn()
  }

  /** The next pieces (at least three). */
  get next(): Kind[] {
    return this.queue.slice(0, 3)
  }

  // ------------------------------------------------------------ controls

  press(a: Action) {
    if (this.dead) return
    switch (a) {
      case 'left':
      case 'right': {
        const d = a === 'left' ? -1 : 1
        this.held[a] = true
        this.dir = d
        this.das = 0
        this.arr = 0
        if (this.piece && !this.clearing) this.shift(d)
        break
      }
      case 'down':
        this.held.down = true
        break
      case 'cw':
        this.turn(1)
        break
      case 'ccw':
        this.turn(-1)
        break
      case 'drop':
        this.hardDrop()
        break
      case 'hold':
        this.holdPiece()
        break
    }
  }

  release(a: Action) {
    if (a === 'left' || a === 'right') {
      const d = a === 'left' ? -1 : 1
      this.held[a] = false
      if (this.dir === d) {
        // Back to the other arrow if it is still held.
        const other = a === 'left' ? 'right' : 'left'
        this.dir = this.held[other] ? -d : 0
        this.das = 0
        this.arr = 0
      }
    } else if (a === 'down') this.held.down = false
  }

  releaseAll() {
    this.held = { left: false, right: false, down: false }
    this.dir = 0
    this.das = 0
    this.arr = 0
  }

  // -------------------------------------------------------------- the clock

  update(dt: number) {
    if (this.dead) {
      this.endTime += dt
      return
    }
    // A held arrow keeps charging between pieces, so the next one can move at once.
    if (this.dir !== 0) this.das += dt
    if (this.clearing) {
      this.clearing.t += dt
      if (this.clearing.t >= CLEAR_TIME) {
        this.collapse(this.clearing.rows)
        this.clearing = null
        this.spawn()
      }
      return
    }
    const p = this.piece
    if (!p) return

    if (this.dir !== 0 && this.das >= DAS) {
      this.arr += dt
      while (this.arr >= ARR) {
        this.arr -= ARR
        if (!this.shift(this.dir)) {
          this.arr = 0
          break
        }
      }
    }

    const perRow = gravity(this.level)
    this.fall += (this.held.down ? SOFT_DROP : 1) * (dt / perRow)
    while (this.fall >= 1) {
      if (!this.fits(p.kind, p.rot, p.x, p.y + 1)) {
        this.fall = 0
        break
      }
      p.y++
      this.fall -= 1
      this.spun = false
      if (this.held.down) this.score += 1
      this.noteLowest()
    }

    if (!this.fits(p.kind, p.rot, p.x, p.y + 1)) {
      if (!this.grounded) {
        this.grounded = true
        this.events.push({ type: 'land' })
      }
      this.lockTime += dt
      if (this.lockTime >= LOCK_DELAY) this.lockPiece()
    } else {
      this.grounded = false
      this.lockTime = 0
    }
  }

  // ---------------------------------------------------------------- queries

  /** Would piece `kind` in rotation `rot` fit with its box at (x, y)? Above the well counts as open. */
  fits(kind: Kind, rot: number, x: number, y: number): boolean {
    for (const [cx, cy] of CELLS[kind][rot]) {
      const bx = x + cx
      const by = y + cy
      if (bx < 0 || bx >= COLS || by >= TOTAL) return false
      if (by >= 0 && this.board[by * COLS + bx]) return false
    }
    return true
  }

  /** Where the falling piece would land (its box's y). */
  ghostY(): number {
    const p = this.piece
    if (!p) return 0
    let y = p.y
    while (this.fits(p.kind, p.rot, p.x, y + 1)) y++
    return y
  }

  cellsOf(p: Piece, y = p.y): Cell[] {
    return CELLS[p.kind][p.rot].map(([cx, cy]) => [p.x + cx, y + cy] as const)
  }

  cell(x: number, y: number): number {
    return y < 0 ? 0 : this.board[y * COLS + x]
  }

  // -------------------------------------------------------------- moves

  private shift(d: number): boolean {
    const p = this.piece
    if (!p || !this.fits(p.kind, p.rot, p.x + d, p.y)) return false
    p.x += d
    this.spun = false
    this.moved()
    this.events.push({ type: 'move' })
    return true
  }

  private turn(dir: 1 | -1): boolean {
    const p = this.piece
    if (!p || this.clearing || p.kind === 'O') return false
    const to = (p.rot + dir + 4) % 4
    const tests = kicks(p.kind, p.rot, to)
    for (let i = 0; i < tests.length; i++) {
      const nx = p.x + tests[i][0]
      const ny = p.y - tests[i][1] // the tables count y upwards
      if (this.fits(p.kind, to, nx, ny)) {
        p.x = nx
        p.y = ny
        p.rot = to
        this.spun = true
        this.kick = i
        this.moved()
        this.noteLowest()
        this.events.push({ type: 'rotate' })
        return true
      }
    }
    return false
  }

  /** A successful move or turn on the stack restarts the lock delay, a limited number of times. */
  private moved() {
    const p = this.piece!
    const onStack = !this.fits(p.kind, p.rot, p.x, p.y + 1)
    if ((this.lockTime > 0 || onStack) && this.resets < MAX_RESETS) {
      this.resets++
      this.lockTime = 0
    }
  }

  /** Reaching a new lowest row gives the piece its full set of resets back. */
  private noteLowest() {
    const p = this.piece!
    if (p.y > this.lowest) {
      this.lowest = p.y
      this.resets = 0
    }
  }

  private hardDrop() {
    const p = this.piece
    if (!p || this.clearing) return
    const from = this.cellsOf(p)
    const y = this.ghostY()
    const rows = y - p.y
    if (rows > 0) {
      p.y = y
      this.spun = false
    }
    this.score += rows * 2
    this.events.push({ type: 'drop', kind: p.kind, cells: this.cellsOf(p), from, rows })
    this.lockPiece()
  }

  private holdPiece() {
    const p = this.piece
    if (!p || !this.canHold || this.clearing) return
    const held = this.hold
    this.hold = p.kind
    this.canHold = false
    this.events.push({ type: 'hold' })
    this.spawn(held ?? undefined)
  }

  // ---------------------------------------------------- locking & clearing

  private spinKind(p: Piece): Spin {
    if (p.kind !== 'T' || !this.spun) return 'none'
    const cx = p.x + 1
    const cy = p.y + 1
    const filled = (x: number, y: number) => x < 0 || x >= COLS || y >= TOTAL || this.cell(x, y) !== 0
    // Corners: top-left, top-right, bottom-right, bottom-left.
    const corners = [filled(cx - 1, cy - 1), filled(cx + 1, cy - 1), filled(cx + 1, cy + 1), filled(cx - 1, cy + 1)]
    if (corners.filter(Boolean).length < 3) return 'none'
    // The two corners on the side the T points to.
    const [a, b] = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot]
    return (corners[a] && corners[b]) || this.kick === 4 ? 'full' : 'mini'
  }

  private lockPiece() {
    const p = this.piece
    if (!p) return
    const cells = this.cellsOf(p)
    const spin = this.spinKind(p)
    const value = KINDS.indexOf(p.kind) + 1
    let allHidden = true
    for (const [x, y] of cells) {
      if (y >= 0) this.board[y * COLS + x] = value
      if (y >= HIDDEN) allHidden = false
    }
    this.piece = null
    this.canHold = true
    this.grounded = false
    this.events.push({ type: 'lock', kind: p.kind, cells })
    if (allHidden) {
      this.topOut() // locked entirely above the well
      return
    }

    const rows: number[] = []
    for (let y = 0; y < TOTAL; y++) {
      let full = true
      for (let x = 0; x < COLS && full; x++) if (!this.board[y * COLS + x]) full = false
      if (full) rows.push(y)
    }

    if (rows.length === 0 && spin === 'none') {
      this.chain.combo = -1
      this.spawn()
      return
    }
    const result = scoreClear(rows.length, spin, this.level, this.chain, rows.length > 0 && this.emptyBesides(rows))
    this.score += result.points
    if (rows.length === 0) {
      this.events.push({ type: 'spin', result })
      this.spawn()
      return
    }
    this.events.push({ type: 'clear', rows, result })
    const before = this.level
    this.lines += rows.length
    this.level = Math.min(99, 1 + Math.floor(this.lines / 10))
    if (this.level > before) this.events.push({ type: 'level', level: this.level })
    this.clearing = { rows, t: 0 }
  }

  /** Is every cell outside these rows empty? (A perfect clear.) */
  private emptyBesides(rows: number[]): boolean {
    for (let y = 0; y < TOTAL; y++) {
      if (rows.includes(y)) continue
      for (let x = 0; x < COLS; x++) if (this.board[y * COLS + x]) return false
    }
    return true
  }

  /** Removes full rows; everything above falls down. */
  private collapse(rows: number[]) {
    const next = new Uint8Array(COLS * TOTAL)
    let dst = TOTAL - 1
    for (let y = TOTAL - 1; y >= 0; y--) {
      if (rows.includes(y)) continue
      next.set(this.board.subarray(y * COLS, (y + 1) * COLS), dst * COLS)
      dst--
    }
    this.board = next
  }

  private spawn(kind?: Kind) {
    const k = kind ?? this.take()
    const p: Piece = { kind: k, rot: 0, x: 3, y: HIDDEN - 2 }
    if (!this.fits(k, 0, p.x, p.y)) {
      this.piece = null
      this.topOut() // no room for the new piece
      return
    }
    if (this.fits(k, 0, p.x, p.y + 1)) p.y++ // drop into view straight away
    this.piece = p
    this.fall = 0
    this.lockTime = 0
    this.resets = 0
    this.lowest = p.y
    this.grounded = false
    this.spun = false
    this.kick = -1
  }

  private take(): Kind {
    while (this.queue.length < 8) this.queue.push(...this.bag())
    return this.queue.shift()!
  }

  /** The seven pieces in random order. */
  private bag(): Kind[] {
    const b = [...KINDS]
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[b[i], b[j]] = [b[j], b[i]]
    }
    return b
  }

  private topOut() {
    this.dead = true
    this.endTime = 0
    this.releaseAll()
    this.events.push({ type: 'topout' })
  }
}
