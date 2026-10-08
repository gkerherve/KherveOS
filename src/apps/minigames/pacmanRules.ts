// Pac-Man's rules: the maze, the dots, the four ghosts and how each one hunts,
// power pellets, the fruit, lives and levels. No drawing and no sound (those
// are in pacmanEngine.ts), so the rules can be tested on their own.
//
// Everything moves on a grid of tiles. An actor's position is in tiles (x to
// the right, y down; a whole number is the centre of a tile) and it only
// chooses a new direction when it reaches a tile centre, as in the arcade game.

export const COLS = 19
export const ROWS = 21
/** The row with the side tunnel: leave one edge and you come in at the other. */
export const TUNNEL_ROW = 9
/** The tile above the ghost house's door, where ghosts come out. */
export const DOOR_EXIT = { x: 9, y: 7 }
/** The middle of the ghost house. */
export const HOUSE = { x: 9, y: 9 }
export const FRUIT_TILE = { x: 9, y: 11 }

// # wall, . dot, o power pellet, - door of the ghost house, P Pac-Man.
const MAZE = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.### # ###.####',
  '####.#       #.####',
  '####.# ##-## #.####',
  '    .  #   #  .    ',
  '####.# ##### #.####',
  '####.#       #.####',
  '####.# ##### #.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....P.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
]

export const WALL: boolean[][] = MAZE.map((row) => row.split('').map((c) => c === '#'))
const DOOR: boolean[][] = MAZE.map((row) => row.split('').map((c) => c === '-'))

/** The dots as the level starts: 1 a dot, 2 a power pellet. */
function freshDots(): Uint8Array {
  const d = new Uint8Array(COLS * ROWS)
  MAZE.forEach((row, y) => {
    for (let x = 0; x < COLS; x++) d[y * COLS + x] = row[x] === '.' ? 1 : row[x] === 'o' ? 2 : 0
  })
  return d
}
export const TOTAL_DOTS = freshDots().reduce((n, v) => n + (v ? 1 : 0), 0)

export type Dir = 'U' | 'L' | 'D' | 'R'
export const VEC: Record<Dir, readonly [number, number]> = { U: [0, -1], L: [-1, 0], D: [0, 1], R: [1, 0] }
const ORDER: Dir[] = ['U', 'L', 'D', 'R'] // a tie goes to the first, as in the arcade game

export type GhostName = 'blinky' | 'pinky' | 'inky' | 'clyde'
/** house: waiting inside · leaving: on its way out · normal: hunting · eyes: eaten, going home · entering: going back in. */
export type GhostState = 'house' | 'leaving' | 'normal' | 'eyes' | 'entering'
export type Phase = 'ready' | 'run' | 'dying' | 'clear' | 'over'

export interface Actor {
  x: number
  y: number
  dx: number
  dy: number
}
export interface Ghost extends Actor {
  name: GhostName
  state: GhostState
  frightened: boolean
  /** Where it heads in scatter mode (a tile outside the maze corner). */
  corner: readonly [number, number]
  /** Dots Pac-Man must eat before it leaves the house. */
  releaseDots: number
  /** Where it waits in the house. */
  slot: readonly [number, number]
}

export type PacmanEvent =
  | { type: 'ready'; first: boolean }
  | { type: 'go' }
  | { type: 'dot' }
  | { type: 'pellet' }
  | { type: 'ghost'; points: number; x: number; y: number; chain: number }
  | { type: 'fruit'; points: number; x: number; y: number }
  | { type: 'death' }
  | { type: 'life' }
  | { type: 'frightEnd' }
  | { type: 'clear' }
  | { type: 'level'; level: number }
  | { type: 'over' }

export const FRUITS = [
  { name: 'Cherry', points: 100 },
  { name: 'Strawberry', points: 300 },
  { name: 'Orange', points: 500 },
  { name: 'Apple', points: 700 },
  { name: 'Melon', points: 1000 },
  { name: 'Galaxian', points: 2000 },
  { name: 'Bell', points: 3000 },
  { name: 'Key', points: 5000 },
] as const
export const fruitFor = (level: number) => Math.min(level, FRUITS.length) - 1

export const START_LIVES = 3
export const EXTRA_LIFE_AT = 10000
export const READY_FIRST = 2.4
export const READY_AGAIN = 1.6
export const DYING_TIME = 1.7
export const CLEAR_TIME = 2.2
export const FREEZE_TIME = 0.7
export const FRUIT_TIME = 9.5

const PAC_SPEED = 7.4 // tiles per second
const EYES_SPEED = 15
const DOOR_SPEED = 4.5

/** Seconds a power pellet frightens the ghosts, by level (0: they only turn around). */
export const frightTime = (level: number) => [0, 8, 7, 6, 5, 4, 7, 4, 3, 3, 2, 1, 1][Math.min(level, 12)] ?? 1
const ghostSpeed = (level: number) => Math.min(7.3, 6.3 + 0.35 * (level - 1))

/** [mode, seconds] in turn; the last one never ends. */
function schedule(level: number): [('scatter' | 'chase'), number][] {
  if (level === 1)
    return [['scatter', 7], ['chase', 20], ['scatter', 7], ['chase', 20], ['scatter', 5], ['chase', 20], ['scatter', 5], ['chase', Infinity]]
  const s = level <= 4 ? 7 : 5
  return [['scatter', s], ['chase', 20], ['scatter', s], ['chase', 20], ['scatter', 5], ['chase', 1033], ['scatter', 1 / 60], ['chase', Infinity]]
}

/** Is the tile open to actors? (The tunnel row goes on past both edges.) */
export function passable(x: number, y: number): boolean {
  if (y === TUNNEL_ROW && (x < 0 || x >= COLS)) return true
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return false
  return !WALL[y][x] && !DOOR[y][x]
}

const near = (v: number) => Math.abs(v - Math.round(v)) < 1e-6

/**
 * Moves an actor `dist` tiles along its direction. At every tile centre it
 * asks `decide` for a direction (which may set it to 0, 0: stand still).
 * Positions wrap round the tunnel: the period is COLS + 1 tiles.
 */
function advance(a: Actor, dist: number, decide: (a: Actor) => void) {
  for (let guard = 0; dist > 1e-9 && guard < 8; guard++) {
    let step: number
    if (near(a.x) && near(a.y)) {
      a.x = Math.round(a.x)
      a.y = Math.round(a.y)
      decide(a)
      if (!a.dx && !a.dy) return
      step = Math.min(dist, 1)
    } else {
      const toCentre = a.dx > 0 ? Math.ceil(a.x) - a.x : a.dx < 0 ? a.x - Math.floor(a.x) : a.dy > 0 ? Math.ceil(a.y) - a.y : a.y - Math.floor(a.y)
      step = Math.min(dist, toCentre)
    }
    a.x += a.dx * step
    a.y += a.dy * step
    dist -= step
    if (near(a.x)) a.x = Math.round(a.x)
    if (near(a.y)) a.y = Math.round(a.y)
    if (a.x < -1) a.x += COLS + 1
    else if (a.x > COLS) a.x -= COLS + 1
  }
}

/** Distance in tiles between two actors, the short way round the tunnel. */
function gap(a: Actor, b: Actor): number {
  let dx = Math.abs(a.x - b.x)
  dx = Math.min(dx, COLS + 1 - dx)
  return Math.hypot(dx, a.y - b.y)
}

const newGhost = (name: GhostName, corner: [number, number], releaseDots: number, slot: [number, number]): Ghost => ({
  x: slot[0], y: slot[1], dx: 0, dy: 0, name, state: 'house', frightened: false, corner, releaseDots, slot,
})

export class Pacman {
  score = 0
  level = 1
  lives = START_LIVES
  phase: Phase = 'ready'
  /** Seconds left of the current phase's wait (ready, dying, clear). */
  timer = READY_FIRST
  /** Time spent in the current phase. */
  phaseTime = 0
  /** The world stands still for a moment when a ghost is eaten. */
  freeze = 0
  dots = freshDots()
  dotsLeft = TOTAL_DOTS
  /** Dots eaten since the level started (for the fruit). */
  eaten = 0
  /** Dots eaten since Pac-Man last lost a life (for letting ghosts out). */
  lifeDots = 0
  idle = 0
  pac: Actor = { x: 9, y: 15, dx: -1, dy: 0 }
  /** The way the player wants to turn, and the way Pac-Man last faced. */
  want: Dir = 'L'
  face: Dir = 'L'
  /** Tiles Pac-Man has travelled (the mouth opens and closes with it). */
  odometer = 0
  ghosts: Ghost[] = []
  fright = 0
  frightChain = 0
  fruit: { t: number } | null = null
  fruitsShown = 0
  mode: 'scatter' | 'chase' = 'scatter'
  private modes = schedule(1)
  private modeIdx = 0
  private modeT = 0
  private extraGiven = false
  readonly events: PacmanEvent[] = []

  constructor() {
    this.reset()
  }

  reset() {
    this.score = 0
    this.level = 1
    this.lives = START_LIVES
    this.extraGiven = false
    this.newLevel(false)
    this.placeActors()
    this.setPhase('ready', READY_FIRST)
    this.events.length = 0
    this.events.push({ type: 'ready', first: true })
  }

  // ------------------------------------------------------------ setup

  private newLevel(announce = true) {
    this.dots = freshDots()
    this.dotsLeft = TOTAL_DOTS
    this.eaten = 0
    this.fruit = null
    this.modes = schedule(this.level)
    if (announce) this.events.push({ type: 'level', level: this.level })
  }

  /** Everyone back to the start (a new level, or after losing a life). */
  private placeActors() {
    this.pac = { x: 9, y: 15, dx: -1, dy: 0 }
    this.want = this.face = 'L'
    this.odometer = 0
    this.ghosts = [
      { ...newGhost('blinky', [16, -2], 0, [9, 7]), state: 'normal', dx: -1 },
      newGhost('pinky', [2, -2], 0, [9, 9]),
      newGhost('inky', [18, 22], 8, [8, 9]),
      newGhost('clyde', [0, 22], 20, [10, 9]),
    ]
    this.fright = 0
    this.frightChain = 0
    this.fruit = null
    this.modeIdx = 0
    this.modeT = 0
    this.mode = this.modes[0][0]
    this.lifeDots = 0
    this.idle = 0
    this.freeze = 0
  }

  private setPhase(p: Phase, timer = 0) {
    this.phase = p
    this.timer = timer
    this.phaseTime = 0
  }

  get over() {
    return this.phase === 'over'
  }

  // ------------------------------------------------------------ input

  /** The player asks to go that way: at the next junction, or at once to turn back. */
  press(d: Dir) {
    this.want = d
    const p = this.pac
    if (p.dx && VEC[d][0] === -p.dx && !VEC[d][1]) {
      p.dx = -p.dx
      this.face = d
    } else if (p.dy && VEC[d][1] === -p.dy && !VEC[d][0]) {
      p.dy = -p.dy
      this.face = d
    }
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    this.phaseTime += dt
    switch (this.phase) {
      case 'ready':
        if ((this.timer -= dt) <= 0) {
          this.setPhase('run')
          this.events.push({ type: 'go' })
        }
        return
      case 'dying':
        if ((this.timer -= dt) <= 0) {
          if (--this.lives <= 0) {
            this.lives = 0
            this.setPhase('over')
            this.events.push({ type: 'over' })
          } else {
            this.placeActors()
            this.setPhase('ready', READY_AGAIN)
            this.events.push({ type: 'ready', first: false })
          }
        }
        return
      case 'clear':
        if ((this.timer -= dt) <= 0) {
          this.level++
          this.newLevel()
          this.placeActors()
          this.setPhase('ready', READY_AGAIN)
          this.events.push({ type: 'ready', first: false })
        }
        return
      case 'over':
        return
    }
    this.run(dt)
  }

  private run(dt: number) {
    if (this.freeze > 0) {
      this.freeze -= dt
      return
    }

    // Scatter and chase take turns; they wait while the ghosts are frightened.
    if (this.fright > 0) {
      if ((this.fright -= dt) <= 0) {
        this.fright = 0
        for (const g of this.ghosts) g.frightened = false
        this.events.push({ type: 'frightEnd' })
      }
    } else if ((this.modeT += dt) >= this.modes[this.modeIdx][1]) {
      this.modeT = 0
      this.modeIdx++
      this.mode = this.modes[this.modeIdx][0]
      for (const g of this.ghosts) this.turnBack(g)
    }

    this.movePac(dt)
    this.eat()
    if (this.phase !== 'run') return // that was the last dot
    this.releaseGhosts(dt)
    for (const g of this.ghosts) this.moveGhost(g, dt)
    if (this.fruit && (this.fruit.t += dt) > FRUIT_TIME) this.fruit = null
    this.collide()
  }

  // ------------------------------------------------------------ Pac-Man

  private movePac(dt: number) {
    const p = this.pac
    const before = p.x
    const beforeY = p.y
    const speed = PAC_SPEED * (this.level >= 5 ? 1.04 : 1) * (this.fright > 0 ? 1.1 : 1)
    advance(p, speed * dt, (a) => {
      const [wx, wy] = VEC[this.want]
      if (passable(Math.round(a.x) + wx, Math.round(a.y) + wy)) {
        a.dx = wx
        a.dy = wy
        this.face = this.want
      } else if (!passable(Math.round(a.x) + a.dx, Math.round(a.y) + a.dy)) {
        a.dx = a.dy = 0
      }
    })
    let moved = Math.abs(p.x - before) + Math.abs(p.y - beforeY)
    if (moved > 1) moved = speed * dt // wrapped round the tunnel
    this.odometer += moved
  }

  private award(points: number) {
    const before = this.score
    this.score += points
    if (!this.extraGiven && before < EXTRA_LIFE_AT && this.score >= EXTRA_LIFE_AT) {
      this.extraGiven = true
      this.lives++
      this.events.push({ type: 'life' })
    }
  }

  private eat() {
    const x = Math.round(this.pac.x)
    const y = Math.round(this.pac.y)
    if (x >= 0 && x < COLS) {
      const i = y * COLS + x
      const d = this.dots[i]
      if (d) {
        this.dots[i] = 0
        this.dotsLeft--
        this.eaten++
        this.lifeDots++
        this.idle = 0
        if (d === 2) {
          this.award(50)
          this.events.push({ type: 'pellet' })
          this.frighten()
        } else {
          this.award(10)
          this.events.push({ type: 'dot' })
        }
        if (this.eaten === 25 || this.eaten === 60) this.fruit = { t: 0 }
        if (this.dotsLeft === 0) {
          this.setPhase('clear', CLEAR_TIME)
          this.events.push({ type: 'clear' })
          return
        }
      }
    }
    if (this.fruit && gap(this.pac, { x: FRUIT_TILE.x, y: FRUIT_TILE.y, dx: 0, dy: 0 }) < 0.7) {
      const points = FRUITS[fruitFor(this.level)].points
      this.award(points)
      this.events.push({ type: 'fruit', points, x: FRUIT_TILE.x, y: FRUIT_TILE.y })
      this.fruit = null
    }
  }

  private frighten() {
    this.frightChain = 0
    const t = frightTime(this.level)
    this.fright = t
    for (const g of this.ghosts) {
      if (g.state === 'eyes') continue
      if (t > 0) g.frightened = true
      this.turnBack(g)
    }
  }

  // ------------------------------------------------------------ ghosts

  /** Ghosts in the house come out when enough dots are eaten, or when Pac-Man dawdles. */
  private releaseGhosts(dt: number) {
    this.idle += dt
    const next = this.ghosts.find((g) => g.state === 'house')
    if (!next) return
    if (this.lifeDots >= next.releaseDots || this.idle > 4) {
      next.state = 'leaving'
      this.idle = 0
    }
  }

  /** Turn round at once (a mode change or a power pellet). */
  private turnBack(g: Ghost) {
    if (g.state !== 'normal') return
    g.dx = -g.dx
    g.dy = -g.dy
  }

  private speedOf(g: Ghost): number {
    if (g.state === 'eyes') return EYES_SPEED
    if (g.state === 'leaving' || g.state === 'entering') return DOOR_SPEED
    const tunnel = Math.round(g.y) === TUNNEL_ROW && (g.x < 3 || g.x > COLS - 4)
    if (tunnel) return 3.6
    if (g.frightened) return 3.9
    let s = ghostSpeed(this.level)
    if (g.name === 'blinky') s *= this.dotsLeft <= 10 ? 1.1 : this.dotsLeft <= 20 ? 1.05 : 1 // "Cruise Elroy"
    return s
  }

  private moveGhost(g: Ghost, dt: number) {
    const dist = this.speedOf(g) * dt
    switch (g.state) {
      case 'house':
        return
      case 'leaving': {
        // Slide to the middle, then up through the door.
        if (g.x !== HOUSE.x) {
          const d = Math.sign(HOUSE.x - g.x) * Math.min(Math.abs(HOUSE.x - g.x), dist)
          g.x += d
          if (Math.abs(g.x - HOUSE.x) < 1e-6) g.x = HOUSE.x
        } else {
          g.y -= dist
          if (g.y <= DOOR_EXIT.y) {
            g.y = DOOR_EXIT.y
            g.state = 'normal'
            g.dx = Math.random() < 0.5 ? -1 : 1
            g.dy = 0
          }
        }
        return
      }
      case 'entering':
        g.y += dist
        if (g.y >= HOUSE.y) {
          g.y = HOUSE.y
          g.frightened = false
          g.state = 'leaving'
        }
        return
      default:
        advance(g, dist, (a) => this.decide(a as Ghost))
    }
  }

  /** At a tile centre: pick the way that gets closest to the target. */
  private decide(g: Ghost) {
    const x = Math.round(g.x)
    const y = Math.round(g.y)
    if (g.state === 'eyes' && x === DOOR_EXIT.x && y === DOOR_EXIT.y) {
      g.state = 'entering'
      g.dx = 0
      g.dy = 1
      return
    }
    const options = ORDER.filter((d) => {
      const [dx, dy] = VEC[d]
      return passable(x + dx, y + dy) && !(dx === -g.dx && dy === -g.dy && (g.dx || g.dy))
    })
    if (!options.length) {
      g.dx = -g.dx
      g.dy = -g.dy
      return
    }
    let pick = options[0]
    if (g.frightened && g.state === 'normal') {
      pick = options[Math.floor(Math.random() * options.length)]
    } else {
      const [tx, ty] = this.target(g)
      let best = Infinity
      for (const d of options) {
        const [dx, dy] = VEC[d]
        const dist = (x + dx - tx) ** 2 + (y + dy - ty) ** 2
        if (dist < best) {
          best = dist
          pick = d
        }
      }
    }
    g.dx = VEC[pick][0]
    g.dy = VEC[pick][1]
  }

  /** The tile a ghost is heading for. */
  target(g: Ghost): [number, number] {
    if (g.state === 'eyes') return [DOOR_EXIT.x, DOOR_EXIT.y]
    const px = Math.round(this.pac.x)
    const py = Math.round(this.pac.y)
    if (this.mode === 'scatter' && !(g.name === 'blinky' && this.dotsLeft <= 20)) return [g.corner[0], g.corner[1]]
    const [fx, fy] = VEC[this.face]
    switch (g.name) {
      case 'blinky':
        return [px, py]
      case 'pinky':
        return [px + 4 * fx, py + 4 * fy]
      case 'inky': {
        const b = this.ghosts[0]
        const ax = px + 2 * fx
        const ay = py + 2 * fy
        return [ax * 2 - Math.round(b.x), ay * 2 - Math.round(b.y)]
      }
      case 'clyde':
        return (px - g.x) ** 2 + (py - g.y) ** 2 > 64 ? [px, py] : [g.corner[0], g.corner[1]]
    }
  }

  // ------------------------------------------------------------ meeting

  private collide() {
    for (const g of this.ghosts) {
      if (g.state !== 'normal' && g.state !== 'leaving') continue
      if (gap(this.pac, g) > 0.5) continue
      if (g.frightened) {
        g.frightened = false
        g.state = 'eyes'
        const points = 200 * 2 ** this.frightChain
        this.frightChain = Math.min(this.frightChain + 1, 3)
        this.award(points)
        this.freeze = FREEZE_TIME
        this.events.push({ type: 'ghost', points, x: g.x, y: g.y, chain: this.frightChain })
      } else {
        this.setPhase('dying', DYING_TIME)
        this.events.push({ type: 'death' })
        return
      }
    }
  }
}
