// Meteor Smash rules, ported from KherveFitting's Asteroid.py: a ship that
// turns, thrusts and drifts (with a little friction) across a wrapping
// screen, bullets that live for a second, and rocks that split in two when
// shot: large → medium → small → dust. A cleared screen brings a new wave of
// 5 + score ÷ 1000 rocks. Speeds are per frame at 60 frames a second, as in
// the original. Plain logic with no DOM, so it can be tested on its own.

export const W = 800
export const H = 600
/** The game runs in frames of 1/60 s, like the pygame original. */
export const STEP = 1 / 60

export const SHIP_SIZE = 10
export const SHIP_THRUST = 0.3
export const SHIP_ROTATION = 5
export const SHIP_FRICTION = 0.99
export const BULLET_SPEED = 10
export const BULLET_LIFE = 60
export const BULLET_R = 2
export const INITIAL_ROCKS = 5
export const START_LIVES = 3
/** Rocks never appear closer than this to the ship. */
export const SAFE_DISTANCE = 100
/** Seconds a new ship can't be hit (blinking), so it isn't lost again at once. */
export const SHIELD_TIME = 2.5
/** Seconds the wreck drifts before the next ship. */
const RESPAWN_TIME = 1.2

export type Size = 1 | 2 | 3

export interface Ship {
  x: number
  y: number
  px: number
  py: number
  /** Degrees, 0 = pointing right, growing clockwise (screen y is down). */
  angle: number
  vx: number
  vy: number
  radius: number
  thrusting: boolean
}

export interface Bullet {
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  life: number
  radius: number
}

export interface Rock {
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  size: Size
  radius: number
  angle: number
  spin: number
  /** The outline, around (0, 0) before turning. */
  points: { x: number; y: number }[]
}

export type AsteroidsEvent =
  | { type: 'shoot' }
  | { type: 'hit'; x: number; y: number; size: Size; points: number }
  | { type: 'crash'; x: number; y: number }
  | { type: 'respawn' }
  | { type: 'wave'; wave: number; rocks: number }
  | { type: 'gameover' }

export type State = 'play' | 'respawn' | 'dead'

/** Points for a rock: small ones are hardest to hit. */
export const rockPoints = (size: Size) => (4 - size) * 20

/** Wraps v into 0..max, like Python's %. */
export const wrap = (v: number, max: number) => ((v % max) + max) % max

export function collides(a: { x: number; y: number; radius: number }, b: { x: number; y: number; radius: number }): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < a.radius + b.radius
}

const rad = (deg: number) => (deg * Math.PI) / 180

export class Asteroids {
  ship!: Ship
  bullets: Bullet[] = []
  rocks: Rock[] = []
  score = 0
  lives = START_LIVES
  wave = 0
  /** Seconds of shield left. */
  shield = 0
  state: State = 'play'
  stateTime = 0
  events: AsteroidsEvent[] = []
  input = { left: false, right: false, thrust: false }

  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  /** The game is over and the last wreck has drifted away. */
  get over(): boolean {
    return this.state === 'dead' && this.stateTime >= 1.5
  }

  reset() {
    this.score = 0
    this.lives = START_LIVES
    this.wave = 0
    this.bullets = []
    this.events = []
    this.input = { left: false, right: false, thrust: false }
    this.ship = this.newShip()
    this.shield = 0
    this.state = 'play'
    this.stateTime = 0
    this.nextWave()
  }

  private newShip(): Ship {
    return { x: W / 2, y: H / 2, px: W / 2, py: H / 2, angle: -90, vx: 0, vy: 0, radius: SHIP_SIZE, thrusting: false }
  }

  private uniform(a: number, b: number) {
    return a + this.rng() * (b - a)
  }

  makeRock(x: number, y: number, size: Size): Rock {
    const radius = size * 15
    const points = []
    for (let i = 0; i < 8; i++) {
      const a = rad((360 / 8) * i)
      const d = radius + this.uniform(-5, 5)
      points.push({ x: Math.cos(a) * d, y: Math.sin(a) * d })
    }
    return {
      x, y, px: x, py: y,
      vx: this.uniform(-2, 2),
      vy: this.uniform(-2, 2),
      size, radius,
      angle: this.uniform(0, 360),
      spin: this.uniform(-5, 5),
      points,
    }
  }

  /** `n` rocks of random sizes, none within SAFE_DISTANCE of the ship. */
  makeRocks(n: number): Rock[] {
    const out: Rock[] = []
    for (let i = 0; i < n; i++) {
      let x = 0
      let y = 0
      for (let tries = 0; tries < 200; tries++) {
        x = Math.floor(this.rng() * (W + 1))
        y = Math.floor(this.rng() * (H + 1))
        if (Math.hypot(x - this.ship.x, y - this.ship.y) > SAFE_DISTANCE) break
      }
      const size = (1 + Math.floor(this.rng() * 3)) as Size
      out.push(this.makeRock(x, y, size))
    }
    return out
  }

  /** The two smaller rocks a hit rock breaks into (none for a small one). */
  split(rock: Rock): Rock[] {
    if (rock.size <= 1) return []
    const out: Rock[] = []
    for (let i = 0; i < 2; i++) {
      const r = this.makeRock(rock.x, rock.y, (rock.size - 1) as Size)
      const a = rad(this.uniform(0, 360))
      const s = this.uniform(1, 3)
      r.vx = Math.cos(a) * s
      r.vy = Math.sin(a) * s
      out.push(r)
    }
    return out
  }

  /** Rocks for the next wave: five, plus one for every thousand points. */
  nextWave() {
    this.wave++
    const n = INITIAL_ROCKS + Math.floor(this.score / 1000)
    this.rocks = this.makeRocks(n)
    this.events.push({ type: 'wave', wave: this.wave, rocks: n })
  }

  // ------------------------------------------------------------ controls

  /** One bullet per press, from the ship's centre, the way it points. */
  shoot(): boolean {
    if (this.state !== 'play') return false
    const s = this.ship
    this.bullets.push({
      x: s.x, y: s.y, px: s.x, py: s.y,
      vx: Math.cos(rad(s.angle)) * BULLET_SPEED,
      vy: Math.sin(rad(s.angle)) * BULLET_SPEED,
      life: BULLET_LIFE,
      radius: BULLET_R,
    })
    this.events.push({ type: 'shoot' })
    return true
  }

  // ------------------------------------------------------------ the clock

  /** One frame. */
  update() {
    this.stateTime += STEP
    const s = this.ship
    s.px = s.x
    s.py = s.y
    for (const b of this.bullets) {
      b.px = b.x
      b.py = b.y
    }
    for (const r of this.rocks) {
      r.px = r.x
      r.py = r.y
    }

    // The rocks keep drifting whatever happens to the ship.
    for (const r of this.rocks) {
      r.x = wrap(r.x + r.vx, W)
      r.y = wrap(r.y + r.vy, H)
      r.angle += r.spin
    }
    this.moveBullets()

    if (this.state === 'dead') return
    if (this.state === 'respawn') {
      if (this.stateTime >= RESPAWN_TIME) {
        this.ship = this.newShip()
        this.shield = SHIELD_TIME
        this.state = 'play'
        this.stateTime = 0
        this.events.push({ type: 'respawn' })
      }
      this.hitRocks()
      return
    }

    if (this.input.left) s.angle -= SHIP_ROTATION
    if (this.input.right) s.angle += SHIP_ROTATION
    s.thrusting = this.input.thrust
    if (s.thrusting) {
      s.vx += Math.cos(rad(s.angle)) * SHIP_THRUST
      s.vy += Math.sin(rad(s.angle)) * SHIP_THRUST
    }
    s.vx *= SHIP_FRICTION
    s.vy *= SHIP_FRICTION
    s.x = wrap(s.x + s.vx, W)
    s.y = wrap(s.y + s.vy, H)
    this.shield = Math.max(0, this.shield - STEP)

    this.hitRocks()
    this.hitShip()
    if (this.state === 'play' && this.rocks.length === 0) this.nextWave()
  }

  private moveBullets() {
    for (const b of this.bullets) {
      b.x = wrap(b.x + b.vx, W)
      b.y = wrap(b.y + b.vy, H)
      b.life--
    }
    this.bullets = this.bullets.filter((b) => b.life > 0)
  }

  /** Each bullet breaks the first rock it touches. */
  private hitRocks() {
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i]
      const j = this.rocks.findIndex((r) => collides(b, r))
      if (j < 0) continue
      const rock = this.rocks[j]
      this.bullets.splice(i--, 1)
      this.rocks.splice(j, 1)
      const points = rockPoints(rock.size)
      this.score += points
      this.rocks.push(...this.split(rock))
      this.events.push({ type: 'hit', x: rock.x, y: rock.y, size: rock.size, points })
    }
  }

  private hitShip() {
    if (this.shield > 0) return
    const s = this.ship
    if (!this.rocks.some((r) => collides(s, r))) return
    this.lives--
    s.thrusting = false
    this.events.push({ type: 'crash', x: s.x, y: s.y })
    this.stateTime = 0
    if (this.lives <= 0) {
      this.state = 'dead'
      this.events.push({ type: 'gameover' })
    } else this.state = 'respawn'
  }
}
