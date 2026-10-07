// Flappy Khervey rules, ported from KherveFitting's Flappybird.py ("Khervey
// the Flappy Bird"): flap through the gaps between pipes, and shoot the
// enemy birds and bees that fly at you. Three difficulties set the pipe
// speed, the gap and how often enemies come. A day goes by every 48 seconds:
// dawn, day, dusk and night. Everything moves per frame at 60 frames a
// second, as in the original. Plain logic with no DOM, so it can be tested
// on its own.

export const W = 400
export const H = 600
export const STEP = 1 / 60
/** Top of the grass. */
export const GROUND_Y = H - 100
export const BIRD_X = 50
export const BIRD_W = 40
export const BIRD_H = 30
export const PIPE_W = 80
export const GRAVITY = 0.4
export const JUMP = -7
export const BULLET_W = 12
export const BULLET_H = 8
export const BULLET_SPEED = 8
/** Frames between shots while the fire key is held. */
export const SHOOT_DELAY = 10
export const BEE_W = 25
export const BEE_H = 20
/** A new pipe once the last one is this far from the right edge. */
export const PIPE_SPACING = 200
/** Points to reach each next stage. */
export const STAGES = [20, 40, 70, 100, 140, 190, 250, 320, 400, 500]
/** Frames in a day (24 h in minutes, half a minute per frame). */
export const DAY = 1440
const SUN_SPEED = 0.5

export type Difficulty = 'easy' | 'medium' | 'hard'

export const DIFFICULTIES: Record<Difficulty, { label: string; pipeSpeed: number; pipeGap: number; enemyRate: number }> = {
  easy: { label: 'Easy', pipeSpeed: 2, pipeGap: 220, enemyRate: 0.003 },
  medium: { label: 'Medium', pipeSpeed: 3, pipeGap: 180, enemyRate: 0.005 },
  hard: { label: 'Hard', pipeSpeed: 4, pipeGap: 140, enemyRate: 0.008 },
}

export const ENEMY_COLORS = ['#ff0000', '#8a2be2', '#00bfff', '#ff1493', '#ff8c00', '#32cd32']
export const POINTS = { pipe: 1, enemy: 5, bee: 3 }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Pygame's Rect.colliderect: overlapping, touching edges don't count. */
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

export interface Bird {
  y: number
  py: number
  vy: number
  /** Degrees the bird leans, nose up < 0 < nose down. */
  angle: number
  /** Frames left of the wing-down pose after a flap. */
  flap: number
}

export interface Pipe {
  x: number
  px: number
  /** Bottom of the top pipe. */
  gapY: number
  gap: number
  passed: boolean
  /** The "XPS" sign in the gap, on a quarter of the pipes. */
  sign: boolean
  stoneTop: boolean
  stoneBottom: boolean
}

export interface Enemy {
  x: number
  y: number
  px: number
  py: number
  vy: number
  color: string
  wing: number
}

export interface Bee {
  x: number
  y: number
  px: number
  py: number
  hover: number
  wing: number
}

export interface Shot {
  x: number
  y: number
  px: number
}

export type FlappyEvent =
  | { type: 'flap' }
  | { type: 'shoot' }
  | { type: 'pipe'; stage: boolean }
  | { type: 'kill'; what: 'enemy' | 'bee'; x: number; y: number; points: number }
  | { type: 'crash'; x: number; y: number; what: 'pipe' | 'ground' | 'enemy' | 'bee' }
  | { type: 'stage'; stage: number }
  | { type: 'gameover' }

export type State = 'play' | 'falling' | 'dead'

export const pipeTopRect = (p: Pipe): Rect => ({ x: p.x, y: 0, w: PIPE_W, h: p.gapY })
export const pipeBottomRect = (p: Pipe): Rect => ({ x: p.x, y: p.gapY + p.gap, w: PIPE_W, h: GROUND_Y - (p.gapY + p.gap) })
export const birdRect = (b: Bird): Rect => ({ x: BIRD_X, y: Math.trunc(b.y), w: BIRD_W, h: BIRD_H })
export const enemyRect = (e: Enemy): Rect => ({ x: Math.trunc(e.x), y: Math.trunc(e.y), w: BIRD_W, h: BIRD_H })
export const beeRect = (b: Bee): Rect => ({ x: Math.trunc(b.x), y: Math.trunc(b.y), w: BEE_W, h: BEE_H })
export const shotRect = (s: Shot): Rect => ({ x: Math.trunc(s.x), y: Math.trunc(s.y), w: BULLET_W, h: BULLET_H })

// ----------------------------------------------------------------- the sky

/** Sky colour at a time of day (minutes, 0..1440): night, an orange dawn, day, an orange dusk. */
export function skyColor(t: number): [number, number, number] {
  if (t >= 420 && t <= 1020) return [135, 206, 235]
  if (t >= 1140 || t <= 300) return [25, 25, 60]
  if (t > 300 && t < 420) {
    const p = (t - 300) / 120
    return [Math.trunc(255 - 120 * p), Math.trunc(140 + 66 * p), Math.trunc(60 + 175 * p)]
  }
  const p = (t - 1020) / 120
  return [Math.trunc(135 + 120 * p), Math.trunc(206 - 66 * p), Math.trunc(235 - 175 * p)]
}

/** Where the sun is (6 am to 6 pm), on an arc from the ground on the left to the ground on the right. */
export function sunPosition(t: number): { x: number; y: number } | null {
  if (t < 360 || t > 1080) return null
  const p = (t - 360) / 720
  return { x: W * p, y: GROUND_Y - Math.sin(Math.PI * p) * GROUND_Y }
}

export function moonPosition(t: number): { x: number; y: number } | null {
  if (t >= 360 && t <= 1080) return null
  const p = t > 1080 ? (t - 1080) / 720 : (t + 360) / 720
  return { x: W * p, y: GROUND_Y - Math.sin(Math.PI * p) * GROUND_Y }
}

// ----------------------------------------------------------------- the game

export class Flappy {
  difficulty: Difficulty = 'medium'
  bird!: Bird
  pipes: Pipe[] = []
  enemies: Enemy[] = []
  bees: Bee[] = []
  shots: Shot[] = []
  score = 0
  stage = 1
  /** Time of day, minutes. */
  time = 420
  /** How far the ground has scrolled (for the grass), 0..20. */
  ground = 0
  cooldown = 0
  state: State = 'play'
  stateTime = 0
  /** Frames since the start, for animations. */
  frame = 0
  events: FlappyEvent[] = []
  input = { fire: false }

  private readonly rng: () => number

  constructor(rng: () => number = Math.random, difficulty: Difficulty = 'medium') {
    this.rng = rng
    this.difficulty = difficulty
    this.reset()
  }

  get settings() {
    return DIFFICULTIES[this.difficulty]
  }

  /** The game is over and the bird has landed. */
  get over(): boolean {
    return this.state === 'dead' && this.stateTime >= 0.8
  }

  reset() {
    this.bird = { y: H / 2, py: H / 2, vy: 0, angle: 0, flap: 0 }
    this.pipes = [this.newPipe(W)]
    this.enemies = []
    this.bees = []
    this.shots = []
    this.score = 0
    this.stage = 1
    this.time = 420 // 7 am: start in daylight
    this.ground = 0
    this.cooldown = 0
    this.state = 'play'
    this.stateTime = 0
    this.frame = 0
    this.events = []
    this.input = { fire: false }
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d
    this.reset()
  }

  private randint(a: number, b: number) {
    return a + Math.floor(this.rng() * (b - a + 1))
  }

  newPipe(x: number): Pipe {
    const gap = this.settings.pipeGap
    return {
      x, px: x,
      gapY: this.randint(150, H - gap - 150),
      gap,
      passed: false,
      sign: this.rng() < 0.25,
      stoneTop: this.rng() < 0.1,
      stoneBottom: this.rng() < 0.1,
    }
  }

  // ------------------------------------------------------------ controls

  flap() {
    if (this.state !== 'play') return
    this.bird.vy = JUMP
    this.bird.flap = 10
    this.events.push({ type: 'flap' })
  }

  // ------------------------------------------------------------ the clock

  /** One frame. */
  update() {
    this.stateTime += STEP
    this.frame++
    const b = this.bird
    b.py = b.y
    for (const p of this.pipes) p.px = p.x
    for (const e of this.enemies) {
      e.px = e.x
      e.py = e.y
    }
    for (const e of this.bees) {
      e.px = e.x
      e.py = e.y
    }
    for (const s of this.shots) s.px = s.x

    if (this.state === 'dead') return
    if (this.state === 'falling') {
      // Knocked out: tumble down to the grass.
      b.vy = Math.min(b.vy + GRAVITY * 1.2, 12)
      b.y = Math.min(b.y + b.vy, GROUND_Y - BIRD_H)
      b.angle = Math.min(90, b.angle + 6)
      if (b.y >= GROUND_Y - BIRD_H) this.die()
      return
    }

    const speed = this.settings.pipeSpeed
    // The bird.
    b.vy += GRAVITY
    b.y += b.vy
    b.angle = Math.max(-30, Math.min(30, b.vy * 3))
    if (b.flap > 0) b.flap--
    if (b.y < 0) {
      b.y = 0
      b.vy = 0
    }
    this.ground = (((this.ground - speed) % 20) + 20) % 20
    this.time = (this.time + SUN_SPEED) % DAY

    // Held fire key: one shot every SHOOT_DELAY frames.
    if (this.input.fire && this.cooldown <= 0) {
      this.shots.push({ x: BIRD_X + BIRD_W, y: b.y + BIRD_H / 2, px: BIRD_X + BIRD_W })
      this.cooldown = SHOOT_DELAY
      this.events.push({ type: 'shoot' })
    }
    if (this.cooldown > 0) this.cooldown--

    if (b.y + BIRD_H >= GROUND_Y) {
      b.y = GROUND_Y - BIRD_H
      this.crash('ground', true)
      return
    }

    // Pipes: move, hit, pass, and a new one when there is room.
    const br = birdRect(b)
    for (const p of this.pipes) {
      p.x -= speed
      if (this.state === 'play' && (overlaps(pipeTopRect(p), br) || overlaps(pipeBottomRect(p), br))) this.crash('pipe')
      if (!p.passed && p.x + PIPE_W < BIRD_X) {
        p.passed = true
        this.score += POINTS.pipe
        this.passPipe()
      }
    }
    this.pipes = this.pipes.filter((p) => p.x + PIPE_W >= 0)
    if (this.pipes.length === 0 || this.pipes[this.pipes.length - 1].x < W - PIPE_SPACING) this.pipes.push(this.newPipe(W))

    // Enemies come in from the right.
    const rate = this.settings.enemyRate
    if (this.rng() < rate) this.enemies.push(this.newEnemy())
    if (this.rng() < rate * 1.5) this.bees.push({ x: W, y: this.randint(50, H - 150), px: W, py: 0, hover: 0, wing: 0 })

    for (const e of this.enemies) {
      e.x -= 2
      e.wing = (e.wing + 1) % 20
      // Enemy birds move against Khervey: up when he falls, down when he climbs.
      if (b.vy > 0) e.vy = -1.5
      else if (b.vy < 0) e.vy = 1.5
      else e.vy *= 0.9
      e.y += e.vy
      if (e.y < 50) {
        e.y = 50
        e.vy = 0
      } else if (e.y > H - 150) {
        e.y = H - 150
        e.vy = 0
      }
    }
    this.enemies = this.enemies.filter((e) => e.x + BIRD_W >= 0)
    if (this.state === 'play' && this.enemies.some((e) => overlaps(enemyRect(e), br))) this.crash('enemy')

    for (const e of this.bees) {
      e.x -= 3
      e.wing = (e.wing + 1) % 10
      e.hover += 0.2
      e.y += Math.sin(e.hover) * 0.5
    }
    this.bees = this.bees.filter((e) => e.x + BEE_W >= 0)
    if (this.state === 'play' && this.bees.some((e) => overlaps(beeRect(e), br))) this.crash('bee')

    // Shots.
    for (const s of this.shots) s.x += BULLET_SPEED
    this.shots = this.shots.filter((s) => s.x <= W)
    this.shotHits()
  }

  private newEnemy(): Enemy {
    const y = this.randint(50, H - 150)
    return { x: W, y, px: W, py: y, vy: 0, color: ENEMY_COLORS[Math.floor(this.rng() * ENEMY_COLORS.length)], wing: 0 }
  }

  private passPipe() {
    const reached = this.stage <= STAGES.length && this.score >= STAGES[this.stage - 1]
    this.events.push({ type: 'pipe', stage: reached })
    if (reached) {
      this.stage++
      this.events.push({ type: 'stage', stage: this.stage })
    }
  }

  /** A shot takes out the first enemy bird it touches, or else a bee. */
  private shotHits() {
    for (let i = 0; i < this.shots.length; i++) {
      const r = shotRect(this.shots[i])
      const e = this.enemies.findIndex((x) => overlaps(r, enemyRect(x)))
      if (e >= 0) {
        const [hit] = this.enemies.splice(e, 1)
        this.shots.splice(i--, 1)
        this.score += POINTS.enemy
        this.events.push({ type: 'kill', what: 'enemy', x: hit.x + BIRD_W / 2, y: hit.y + BIRD_H / 2, points: POINTS.enemy })
        continue
      }
      const k = this.bees.findIndex((x) => overlaps(r, beeRect(x)))
      if (k >= 0) {
        const [hit] = this.bees.splice(k, 1)
        this.shots.splice(i--, 1)
        this.score += POINTS.bee
        this.events.push({ type: 'kill', what: 'bee', x: hit.x + 12, y: hit.y + 10, points: POINTS.bee })
      }
    }
  }

  private crash(what: 'pipe' | 'ground' | 'enemy' | 'bee', landed = false) {
    if (this.state !== 'play') return
    this.input.fire = false
    this.events.push({ type: 'crash', x: BIRD_X + BIRD_W / 2, y: this.bird.y + BIRD_H / 2, what })
    if (landed) this.die()
    else {
      this.state = 'falling'
      this.stateTime = 0
      this.bird.vy = Math.min(this.bird.vy, -3)
    }
  }

  private die() {
    this.state = 'dead'
    this.stateTime = 0
    this.events.push({ type: 'gameover' })
  }
}
