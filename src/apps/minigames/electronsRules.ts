// Electron Game rules, ported from KherveFitting's MiniGame.py: electrons
// pull on each other (a force falling off as distance^0.95, slowed by a
// little friction), the nucleus sits at their centre, and the camera follows
// it. "Stability" is how far the nucleus moved per step, averaged over the
// last 100 steps: 0.3 or less is very stable, 0.5 or less stable. As in the
// original, the simulation runs at 60 steps a second while stable and 150
// while unstable.
//
// The game around it (new in KherveOS): a two-minute experiment. Click to add
// electrons. A stable atom scores electrons² a second (double when very
// stable); an unstable one fills the decay meter, and a full meter ends the
// experiment early. Plain logic with no DOM, so it can be tested on its own.

export const W = 400
export const H = 400
/** The shell's clock (s); the physics takes 1 to 2.5 of its steps per tick. */
export const STEP = 1 / 60
export const ATTRACTION = 80
export const FRICTION = 0.03
export const TAIL = 20
export const ELECTRON_R = 7
export const NUCLEUS_R = 35
/** Steps averaged for the stability. */
export const WINDOW = 100
export const VERY_STABLE = 0.3
export const STABLE = 0.5
export const START_ELECTRONS = 3
export const MIN_ELECTRONS = 2
export const MAX_ELECTRONS = 24
/** Seconds in an experiment. */
export const DURATION = 120
/** Decay meter: filled per second per unit of stability value (counted up to 3) while unstable, emptied per second while stable. */
export const DECAY_RATE = 0.05
export const RECOVER_RATE = 0.08
const CAMERA_SPEED = 5
const PLOT = 240

export type Stability = 'Very Stable' | 'Stable' | 'Unstable'

export function stabilityOf(change: number): Stability {
  if (change <= VERY_STABLE) return 'Very Stable'
  if (change <= STABLE) return 'Stable'
  return 'Unstable'
}

/** Points a second for an atom of `n` electrons in this state. */
export function pointsPerSecond(n: number, s: Stability): number {
  if (s === 'Unstable') return 0
  return n * n * (s === 'Very Stable' ? 2 : 1)
}

export interface Vec {
  x: number
  y: number
}

export interface Electron {
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  /** Where it has been, oldest first. */
  tail: Vec[]
}

export type ElectronEvent =
  | { type: 'add'; x: number; y: number }
  | { type: 'remove'; x: number; y: number }
  | { type: 'full' }
  | { type: 'stable' }
  | { type: 'unstable' }
  | { type: 'decay' }
  | { type: 'timeup' }

export type State = 'play' | 'decayed' | 'timeup'

/** One physics step of the original's Particle.move, for every electron in turn. */
export function stepElectrons(list: Electron[], attraction = ATTRACTION, friction = FRICTION) {
  for (const p of list) {
    p.x += p.vx
    p.y += p.vy
    p.vx += p.ax
    p.vy += p.ay
    p.vx /= friction + 1
    p.vy /= friction + 1
    p.ax = 0
    p.ay = 0
    for (const o of list) {
      if (o === p) continue
      const dx = o.x - p.x
      const dy = o.y - p.y
      const dist = Math.hypot(dx, dy)
      if (dist === 0) continue
      const k = attraction / Math.pow(1 + dist, 0.95) / dist
      p.ax += dx * k
      p.ay += dy * k
    }
    p.tail.push({ x: p.x, y: p.y })
    if (p.tail.length > TAIL) p.tail.shift()
  }
}

export function centreOf(list: Electron[]): Vec {
  let x = 0
  let y = 0
  for (const p of list) {
    x += p.x
    y += p.y
  }
  const n = Math.max(1, list.length)
  return { x: x / n, y: y / n }
}

export class Electrons {
  electrons: Electron[] = []
  centre: Vec = { x: W / 2, y: H / 2 }
  /** Top-left of the view, in world units. */
  view: Vec = { x: 0, y: 0 }
  /** Physics steps a second: 60 while stable, 150 while unstable. */
  rate = 100
  /** The last WINDOW nucleus moves. */
  changes: number[] = []
  value = 0
  stability: Stability = 'Very Stable'
  /** Recent stability values, for the plot. */
  history: number[] = []
  stableTime = 0
  lastStableTime = 0
  longestStable = 0
  decay = 0
  timeLeft = DURATION
  score = 0
  mostElectrons = START_ELECTRONS
  /** Index into the colour sets (the C key). */
  colour = 0
  state: State = 'play'
  stateTime = 0
  events: ElectronEvent[] = []
  input = { left: false, right: false, up: false, down: false }

  private prev: Vec = { x: W / 2, y: H / 2 }
  private acc = 0
  private exact = 0
  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  get over(): boolean {
    return this.state !== 'play' && this.stateTime >= 1.6
  }

  reset() {
    this.electrons = []
    for (let i = 0; i < START_ELECTRONS; i++) this.electrons.push(this.makeElectron(Math.floor(this.rng() * (W + 1)), Math.floor(this.rng() * (H + 1))))
    this.centre = centreOf(this.electrons)
    this.prev = { ...this.centre }
    this.view = { x: 0, y: 0 }
    this.rate = 100
    this.changes = []
    this.history = []
    this.value = 0
    this.stability = 'Very Stable'
    this.stableTime = this.lastStableTime = this.longestStable = 0
    this.decay = 0
    this.timeLeft = DURATION
    this.score = 0
    this.exact = 0
    this.acc = 0
    this.mostElectrons = START_ELECTRONS
    this.state = 'play'
    this.stateTime = 0
    this.events = []
    this.input = { left: false, right: false, up: false, down: false }
  }

  makeElectron(x: number, y: number): Electron {
    return { x, y, vx: 0, vy: 0, ax: 0, ay: 0, tail: [] }
  }

  /** Adds an electron at a point on the screen (the view moves with the camera). */
  add(sx: number, sy: number): boolean {
    if (this.state !== 'play') return false
    if (this.electrons.length >= MAX_ELECTRONS) {
      this.events.push({ type: 'full' })
      return false
    }
    const x = sx + this.view.x
    const y = sy + this.view.y
    this.electrons.push(this.makeElectron(x, y))
    this.mostElectrons = Math.max(this.mostElectrons, this.electrons.length)
    this.events.push({ type: 'add', x, y })
    return true
  }

  /** Takes away the newest electron, keeping at least two. */
  remove(): boolean {
    if (this.state !== 'play' || this.electrons.length <= MIN_ELECTRONS) return false
    const e = this.electrons.pop()!
    this.events.push({ type: 'remove', x: e.x, y: e.y })
    return true
  }

  // ------------------------------------------------------------ the clock

  /** One tick of the shell's clock (STEP seconds of real time). */
  update(dt = STEP) {
    this.stateTime += dt
    if (this.state !== 'play') {
      // The atom flies apart, or simply stops.
      if (this.state === 'decayed')
        for (const e of this.electrons) {
          const dx = e.x - this.centre.x
          const dy = e.y - this.centre.y
          const d = Math.hypot(dx, dy) || 1
          e.x += (dx / d) * 4
          e.y += (dy / d) * 4
          e.tail.push({ x: e.x, y: e.y })
          if (e.tail.length > TAIL) e.tail.shift()
        }
      return
    }

    // The camera keys, one direction at a time as in the original.
    const i = this.input
    if (i.left) this.view.x -= CAMERA_SPEED
    else if (i.right) this.view.x += CAMERA_SPEED
    else if (i.up) this.view.y -= CAMERA_SPEED
    else if (i.down) this.view.y += CAMERA_SPEED

    this.acc += this.rate * dt
    while (this.acc >= 1) {
      this.acc -= 1
      this.physicsStep()
    }

    if (this.stability !== 'Unstable') {
      this.stableTime += dt
      this.longestStable = Math.max(this.longestStable, this.stableTime)
      this.exact += pointsPerSecond(this.electrons.length, this.stability) * dt
      this.score = Math.floor(this.exact)
      this.decay = Math.max(0, this.decay - RECOVER_RATE * dt)
    } else {
      if (this.stableTime > 0) this.lastStableTime = this.stableTime
      this.stableTime = 0
      this.decay = Math.min(1, this.decay + DECAY_RATE * Math.min(3, this.value) * dt)
    }
    this.history.push(this.value)
    if (this.history.length > PLOT) this.history.shift()

    this.timeLeft = Math.max(0, this.timeLeft - dt)
    if (this.decay >= 1) this.end('decayed')
    else if (this.timeLeft <= 0) this.end('timeup')
  }

  private physicsStep() {
    stepElectrons(this.electrons)
    this.centre = centreOf(this.electrons)
    // The camera eases towards the nucleus.
    this.view.x += (this.centre.x - W / 2 - this.view.x) * 0.05
    this.view.y += (this.centre.y - H / 2 - this.view.y) * 0.05

    const change = Math.hypot(this.centre.x - this.prev.x, this.centre.y - this.prev.y)
    this.prev = { ...this.centre }
    this.changes.push(change)
    if (this.changes.length > WINDOW) this.changes.shift()
    this.value = this.changes.reduce((a, b) => a + b, 0) / this.changes.length
    if (this.value > 1) this.rate = 150
    else if (this.value < STABLE) this.rate = 60

    const before = this.stability
    this.stability = stabilityOf(this.value)
    if (before === 'Unstable' && this.stability !== 'Unstable') this.events.push({ type: 'stable' })
    else if (before !== 'Unstable' && this.stability === 'Unstable') this.events.push({ type: 'unstable' })
  }

  private end(state: 'decayed' | 'timeup') {
    if (this.stableTime > 0) this.lastStableTime = this.stableTime
    this.state = state
    this.stateTime = 0
    this.input = { left: false, right: false, up: false, down: false }
    this.events.push({ type: state === 'decayed' ? 'decay' : 'timeup' })
  }
}
