// Breakout rules and physics: the paddle, the balls, bricks laid out level by
// level (some take several hits, steel never breaks), and power-ups. The ball
// moves in small sub-steps, so even a fast ball can't slip between bricks.
// Plain logic with no DOM, so it can be tested on its own.

export const W = 480
export const H = 480
export const COLS = 13
export const BRICK_W = 34
export const BRICK_H = 14
export const GAP = 2
export const PITCH_X = BRICK_W + GAP
export const PITCH_Y = BRICK_H + GAP
export const LEFT = (W - (COLS * PITCH_X - GAP)) / 2
export const TOP = 52
export const PADDLE_Y = 440
export const PADDLE_H = 10
export const PADDLE_W = 66
export const WIDE_W = 106
export const BALL_R = 5.5
export const MAX_BALLS = 9
/** The steepest bounce off the paddle's ends, from straight up (radians). */
export const MAX_ANGLE = (60 * Math.PI) / 180
const PADDLE_SPEED = 560
const DROP_SPEED = 115
const DROP_CHANCE = 0.14
const WIDE_TIME = 15
const SLOW_TIME = 10
const START_LIVES = 3
const MAX_LIVES = 5

export type PowerKind = 'wide' | 'multi' | 'slow' | 'life'

/** Colour letters in the layouts, and what their bricks are worth. */
export const BRICK_POINTS: Record<string, number> = { r: 70, o: 60, y: 50, g: 40, c: 30, b: 20, p: 20 }

interface Layout {
  name: string
  rows: string[]
}

// 13 columns. Letters are coloured bricks, 2 and 3 take that many hits, # is steel.
export const LEVELS: Layout[] = [
  {
    name: 'Rainbow Wall',
    rows: ['rrrrrrrrrrrrr', 'ooooooooooooo', 'yyyyyyyyyyyyy', 'ggggggggggggg', 'ccccccccccccc', 'bbbbbbbbbbbbb'],
  },
  {
    name: 'Pyramid',
    rows: ['......3......', '.....222.....', '....ppppp....', '...bbbbbbb...', '..ccccccccc..', '.ggggggggggg.', 'yyyyyyyyyyyyy'],
  },
  {
    name: 'Checkers',
    rows: ['r.o.y.g.c.b.p', '.2.2.2.2.2.2.', 'p.b.c.g.y.o.r', '.2.2.2.2.2.2.', 'r.o.y.g.c.b.p', '.2.2.2.2.2.2.'],
  },
  {
    name: 'Invader',
    rows: ['...g.....g...', '....g...g....', '...ggggggg...', '..gg#ggg#gg..', '.ggggggggggg.', '.g.ggggggg.g.', '.g.g.....g.g.', '....gg.gg....'],
  },
  {
    name: 'Diamond',
    rows: ['......c......', '.....cbc.....', '....cb2bc....', '...cb232bc...', '..cb23332bc..', '...cb232bc...', '....cb2bc....', '.....cbc.....', '......c......'],
  },
  {
    name: 'Castle',
    rows: ['r.r.r...r.r.r', 'rrrrr...rrrrr', 'o3o3o...o3o3o', 'ooooo...ooooo', 'yyyyyyyyyyyyy', '2y2y2y2y2y2y2', '####.....####'],
  },
  {
    name: 'The K',
    rows: ['...32....gg..', '...22...gg...', '...22..gg....', '...22.gg.....', '...2222g.....', '...22.gg.....', '...22..gg....', '...22...gg...', '...23....gg..'],
  },
  {
    name: 'Sunrise',
    rows: ['r...........r', 'or.........ro', 'yor.......roy', 'gyor.....royg', 'cgyor...roygc', 'bcgyor.roygcb', 'pbcgyorroygcb', '##2#######2##'],
  },
]

export interface Brick {
  col: number
  row: number
  x: number
  y: number
  /** Hits left. */
  hits: number
  max: number
  steel: boolean
  /** A colour letter, '2'/'3' for strong bricks, '#' for steel. */
  kind: string
  points: number
  alive: boolean
  /** Seconds since it was last hit, for the flash. */
  hitAge: number
}

export interface Ball {
  x: number
  y: number
  /** Where it was before the last step (for smooth drawing). */
  px: number
  py: number
  vx: number
  vy: number
  /** Resting on the paddle, waiting to be launched. */
  stuck: boolean
}

export interface Drop {
  x: number
  y: number
  kind: PowerKind
  age: number
}

export type BreakoutEvent =
  | { type: 'paddle'; x: number }
  | { type: 'wall' }
  | { type: 'brick'; brick: Brick; broken: boolean }
  | { type: 'steel'; brick: Brick }
  | { type: 'drop'; drop: Drop }
  | { type: 'power'; kind: PowerKind; x: number }
  | { type: 'launch' }
  | { type: 'lost' }
  | { type: 'cleared'; bonus: number }
  | { type: 'level'; level: number; name: string }
  | { type: 'gameover' }

export type State = 'serve' | 'play' | 'lost' | 'cleared' | 'dead'

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

export class Breakout {
  level = 1
  name = ''
  bricks: Brick[] = []
  rows = 0
  balls: Ball[] = []
  drops: Drop[] = []
  paddle = { x: W / 2, w: PADDLE_W, target: PADDLE_W, vx: 0 }
  lives = START_LIVES
  score = 0
  wideTime = 0
  slowTime = 0
  /** Speed factor, easing down while "slow" is on. */
  slow = 1
  /** Paddle hits this level: the ball speeds up a little with each. */
  paddleHits = 0
  state: State = 'serve'
  stateTime = 0
  events: BreakoutEvent[] = []
  /** Held arrows, and where the mouse wants the paddle (null: keys are in charge). */
  input = { left: false, right: false, pointer: null as number | null }

  private grid: (Brick | null)[] = []
  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  /** The game is over and its last moment has played out. */
  get over(): boolean {
    return this.state === 'dead' && this.stateTime >= 1.2
  }

  reset() {
    this.lives = START_LIVES
    this.score = 0
    this.events = []
    this.paddle = { x: W / 2, w: PADDLE_W, target: PADDLE_W, vx: 0 }
    this.input = { left: false, right: false, pointer: null }
    this.loadLevel(1)
  }

  loadLevel(n: number) {
    this.level = n
    const layout = LEVELS[(n - 1) % LEVELS.length]
    this.name = layout.name
    this.rows = layout.rows.length
    this.bricks = []
    this.grid = new Array(COLS * this.rows).fill(null)
    layout.rows.forEach((line, row) => {
      for (let col = 0; col < COLS; col++) {
        const ch = line[col] ?? '.'
        if (ch === '.') continue
        const steel = ch === '#'
        const max = ch === '2' ? 2 : ch === '3' ? 3 : 1
        const brick: Brick = {
          col, row,
          x: LEFT + col * PITCH_X,
          y: TOP + row * PITCH_Y,
          hits: steel ? Infinity : max,
          max,
          steel,
          kind: ch,
          points: steel ? 0 : max > 1 ? 50 * max + 50 : BRICK_POINTS[ch] ?? 30,
          alive: true,
          hitAge: 9,
        }
        this.bricks.push(brick)
        this.grid[row * COLS + col] = brick
      }
    })
    this.drops = []
    this.wideTime = 0
    this.slowTime = 0
    this.slow = 1
    this.paddle.target = PADDLE_W
    this.paddleHits = 0
    this.serve()
    this.events.push({ type: 'level', level: n, name: this.name })
  }

  /** A new ball resting on the paddle. */
  serve() {
    const p = this.paddle
    const y = PADDLE_Y - BALL_R - 0.5
    this.balls = [{ x: p.x, y, px: p.x, py: y, vx: 0, vy: 0, stuck: true }]
    this.state = 'serve'
    this.stateTime = 0
  }

  launch() {
    if (this.state !== 'serve') return
    const b = this.balls[0]
    // A little to one side, leaning the way the paddle moves.
    let a = (this.rng() * 2 - 1) * 0.45 + clamp(this.paddle.vx / 2000, -0.25, 0.25)
    if (Math.abs(a) < 0.12) a = a < 0 ? -0.12 : 0.12
    const s = this.speed()
    b.vx = s * Math.sin(a)
    b.vy = -s * Math.cos(a)
    b.stuck = false
    this.state = 'play'
    this.stateTime = 0
    this.events.push({ type: 'launch' })
  }

  /** Ball speed now: faster each level and as the rally goes on, slower with the power-up. */
  speed(): number {
    const base = 290 + 16 * Math.min(this.level - 1, 14)
    return Math.min(660, base + Math.min(this.paddleHits, 40) * 4) * this.slow
  }

  get destructibleLeft(): number {
    let n = 0
    for (const b of this.bricks) if (b.alive && !b.steel) n++
    return n
  }

  // -------------------------------------------------------------- the clock

  update(dt: number) {
    this.stateTime += dt
    for (const b of this.bricks) b.hitAge += dt
    this.movePaddle(dt)
    for (const b of this.balls) {
      b.px = b.x
      b.py = b.y
    }
    if (this.state === 'dead') return
    if (this.state === 'cleared') {
      if (this.stateTime >= 1.8) this.loadLevel(this.level + 1)
      return
    }
    if (this.state === 'lost') {
      if (this.stateTime >= 0.9) this.serve()
      return
    }

    this.wideTime = Math.max(0, this.wideTime - dt)
    this.slowTime = Math.max(0, this.slowTime - dt)
    if (this.wideTime === 0) this.paddle.target = PADDLE_W
    const slowTarget = this.slowTime > 0 ? 0.6 : 1
    this.slow += clamp(slowTarget - this.slow, -1.5 * dt, 1.5 * dt)

    for (const b of this.balls) {
      if (b.stuck) {
        b.x = this.paddle.x
        b.y = PADDLE_Y - BALL_R - 0.5
        b.px = b.x
        b.py = b.y
      } else this.stepBall(b, dt)
    }
    this.balls = this.balls.filter((b) => b.y - BALL_R <= H)
    if (this.balls.length === 0 && this.state === 'play') this.loseLife()

    this.updateDrops(dt)
    if (this.state === 'play' && this.destructibleLeft === 0) this.clearLevel()
  }

  private movePaddle(dt: number) {
    const p = this.paddle
    p.w += clamp(p.target - p.w, -170 * dt, 170 * dt)
    const before = p.x
    const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0)
    if (dir !== 0) {
      this.input.pointer = null // the keys take over from the mouse
      p.x += dir * PADDLE_SPEED * dt
    } else if (this.input.pointer !== null) p.x = this.input.pointer
    p.x = clamp(p.x, p.w / 2, W - p.w / 2)
    p.vx = (p.x - before) / dt
  }

  // ------------------------------------------------------------- the ball

  private stepBall(b: Ball, dt: number) {
    // Keep the ball at the current speed (levels, rallies and power-ups change it smoothly).
    const s = this.speed()
    const v = Math.hypot(b.vx, b.vy) || 1
    b.vx *= s / v
    b.vy *= s / v
    // Sub-steps of at most half a radius: never past a brick or the paddle in one go.
    const n = Math.max(1, Math.ceil((s * dt) / (BALL_R * 0.5)))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      b.x += b.vx * h
      b.y += b.vy * h
      this.hitWalls(b)
      this.hitPaddle(b)
      this.hitBricks(b)
      if (b.y - BALL_R > H) return
    }
  }

  private hitWalls(b: Ball) {
    let hit = false
    if (b.x < BALL_R) {
      b.x = BALL_R
      if (b.vx < 0) {
        b.vx = -b.vx
        hit = true
      }
    } else if (b.x > W - BALL_R) {
      b.x = W - BALL_R
      if (b.vx > 0) {
        b.vx = -b.vx
        hit = true
      }
    }
    if (b.y < BALL_R) {
      b.y = BALL_R
      if (b.vy < 0) {
        b.vy = -b.vy
        hit = true
      }
    }
    if (hit) {
      this.keepAngle(b)
      this.events.push({ type: 'wall' })
    }
  }

  private hitPaddle(b: Ball) {
    if (b.vy <= 0) return
    const p = this.paddle
    const left = p.x - p.w / 2
    const right = p.x + p.w / 2
    const cx = clamp(b.x, left, right)
    const cy = clamp(b.y, PADDLE_Y, PADDLE_Y + PADDLE_H)
    const dx = b.x - cx
    const dy = b.y - cy
    if (dx * dx + dy * dy > BALL_R * BALL_R) return
    if (b.y > PADDLE_Y + PADDLE_H) return // already past it
    // Where it lands decides the angle: the middle sends it straight up, the ends out to the side.
    const off = clamp((b.x - p.x) / (p.w / 2 + BALL_R * 0.5), -1, 1)
    const a = off * MAX_ANGLE
    const s = Math.hypot(b.vx, b.vy)
    b.vx = s * Math.sin(a)
    b.vy = -s * Math.cos(a)
    b.y = PADDLE_Y - BALL_R
    this.paddleHits++
    this.events.push({ type: 'paddle', x: b.x })
  }

  private brickAt(col: number, row: number): Brick | null {
    if (col < 0 || col >= COLS || row < 0 || row >= this.rows) return null
    const b = this.grid[row * COLS + col]
    return b && b.alive ? b : null
  }

  /** How the ball touches a brick: the way out (normal) and how deep it is, or null. */
  private contact(b: Ball, k: Brick): { nx: number; ny: number; depth: number } | null {
    const cx = clamp(b.x, k.x, k.x + BRICK_W)
    const cy = clamp(b.y, k.y, k.y + BRICK_H)
    const dx = b.x - cx
    const dy = b.y - cy
    const d2 = dx * dx + dy * dy
    if (d2 >= BALL_R * BALL_R) return null
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2)
      let nx = dx / d
      let ny = dy / d
      const corner = (cx === k.x || cx === k.x + BRICK_W) && (cy === k.y || cy === k.y + BRICK_H)
      if (corner) {
        // A corner shared with a neighbouring brick acts like the flat face it is part of.
        const sx = Math.sign(nx)
        const sy = Math.sign(ny)
        const side = this.brickAt(k.col + sx, k.row)
        const above = this.brickAt(k.col, k.row + sy)
        if (side && !above) {
          nx = 0
          ny = sy
        } else if (above && !side) {
          nx = sx
          ny = 0
        }
      }
      return { nx, ny, depth: BALL_R - (dx * nx + dy * ny) }
    }
    // The centre is inside the brick (only when something pushed it there): out the nearest side.
    const left = b.x - k.x
    const right = k.x + BRICK_W - b.x
    const top = b.y - k.y
    const bottom = k.y + BRICK_H - b.y
    const m = Math.min(left, right, top, bottom)
    if (m === top) return { nx: 0, ny: -1, depth: top + BALL_R }
    if (m === bottom) return { nx: 0, ny: 1, depth: bottom + BALL_R }
    if (m === left) return { nx: -1, ny: 0, depth: left + BALL_R }
    return { nx: 1, ny: 0, depth: right + BALL_R }
  }

  private hitBricks(b: Ball) {
    const c0 = Math.floor((b.x - BALL_R - LEFT) / PITCH_X)
    const c1 = Math.floor((b.x + BALL_R - LEFT) / PITCH_X)
    const r0 = Math.floor((b.y - BALL_R - TOP) / PITCH_Y)
    const r1 = Math.floor((b.y + BALL_R - TOP) / PITCH_Y)
    let best: { brick: Brick; nx: number; ny: number; depth: number } | null = null
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = this.brickAt(c, r)
        if (!k) continue
        const hit = this.contact(b, k)
        if (hit && (!best || hit.depth > best.depth)) best = { brick: k, ...hit }
      }
    }
    if (!best) return
    const vn = b.vx * best.nx + b.vy * best.ny
    b.x += best.nx * best.depth
    b.y += best.ny * best.depth
    if (vn >= 0) return // already leaving it
    b.vx -= 2 * vn * best.nx
    b.vy -= 2 * vn * best.ny
    this.keepAngle(b)
    this.damage(best.brick)
  }

  /** Never let the ball fly almost flat: it would take forever to come back. */
  private keepAngle(b: Ball) {
    const s = Math.hypot(b.vx, b.vy)
    const min = s * 0.26
    if (Math.abs(b.vy) >= min) return
    b.vy = (b.vy < 0 ? -1 : 1) * min
    b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(s * s - min * min)
  }

  private damage(k: Brick) {
    k.hitAge = 0
    if (k.steel) {
      this.events.push({ type: 'steel', brick: k })
      return
    }
    k.hits--
    if (k.hits > 0) {
      this.score += 10
      this.events.push({ type: 'brick', brick: k, broken: false })
      return
    }
    k.alive = false
    this.grid[k.row * COLS + k.col] = null
    this.score += k.points
    this.events.push({ type: 'brick', brick: k, broken: true })
    if (this.rng() < DROP_CHANCE && this.drops.length < 3) this.spawnDrop(k.x + BRICK_W / 2, k.y + BRICK_H / 2)
  }

  // -------------------------------------------------------------- power-ups

  private spawnDrop(x: number, y: number) {
    const r = this.rng()
    const kind: PowerKind =
      this.lives < MAX_LIVES && r < 0.1 ? 'life' : r < 0.42 ? 'wide' : r < 0.72 ? 'multi' : 'slow'
    const drop = { x, y, kind, age: 0 }
    this.drops.push(drop)
    this.events.push({ type: 'drop', drop })
  }

  private updateDrops(dt: number) {
    const p = this.paddle
    this.drops = this.drops.filter((d) => {
      d.y += DROP_SPEED * dt
      d.age += dt
      if (d.y + 6 >= PADDLE_Y && d.y - 6 <= PADDLE_Y + PADDLE_H && Math.abs(d.x - p.x) <= p.w / 2 + 13) {
        this.apply(d.kind)
        this.events.push({ type: 'power', kind: d.kind, x: d.x })
        return false
      }
      return d.y < H + 10
    })
  }

  apply(kind: PowerKind) {
    this.score += 100
    switch (kind) {
      case 'wide':
        this.paddle.target = WIDE_W
        this.wideTime = WIDE_TIME
        break
      case 'slow':
        this.slowTime = SLOW_TIME
        break
      case 'life':
        this.lives = Math.min(MAX_LIVES, this.lives + 1)
        break
      case 'multi': {
        if (this.state === 'serve') this.launch()
        for (const b of this.balls.slice()) {
          if (b.stuck) continue
          for (const a of [-0.42, 0.42]) {
            if (this.balls.length >= MAX_BALLS) break
            const c = Math.cos(a)
            const s = Math.sin(a)
            const nb: Ball = { ...b, vx: b.vx * c - b.vy * s, vy: b.vx * s + b.vy * c }
            this.keepAngle(nb)
            this.balls.push(nb)
          }
        }
        break
      }
    }
  }

  // ---------------------------------------------------------- lives, levels

  private loseLife() {
    this.lives--
    this.drops = []
    this.wideTime = 0
    this.slowTime = 0
    this.paddle.target = PADDLE_W
    this.stateTime = 0
    if (this.lives <= 0) {
      this.lives = 0
      this.state = 'dead'
      this.events.push({ type: 'gameover' })
    } else {
      this.state = 'lost'
      this.events.push({ type: 'lost' })
    }
  }

  private clearLevel() {
    const bonus = 1000 * this.level
    this.score += bonus
    this.state = 'cleared'
    this.stateTime = 0
    this.drops = []
    this.events.push({ type: 'cleared', bonus })
  }
}
