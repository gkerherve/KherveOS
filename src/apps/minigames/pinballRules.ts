// Pinball: one table and its rules. Gravity pulls the ball down the table;
// two flippers, a plunger, three pop bumpers, two slingshots, a bank of drop
// targets, three standup targets and three rollover lanes. The ball moves in
// sub-steps small enough that it can't jump through a wall or a flipper, even
// a fast one mid-flip (see physics.ts). Plain logic with no DOM, so it can be
// tested on its own.

import {
  angleIn, bounce, crosses, flipperTip, hitArcInside, hitCapsule, hitCircle, hitFlipper, side, type FlipperShape, type Hit,
} from './physics'

export const W = 380
export const H = 780
export const BALL_R = 8
/** Down the table, units per second². */
export const GRAVITY = 1050
/** No sub-step moves the ball (or a flipper's tip) further than this. */
export const MAX_MOVE = 2
export const MAX_SPEED = 2600
const DAMPING = 0.06
const FLIP_UP = 26 // rad/s
const FLIP_DOWN = 15
const FLIPPER_E = 0.3
const WALL_E = 0.45
const RUBBER_E = 0.68
const BUMPER_KICK = 640
const SLING_KICK = 560
const SLING_TRIGGER = 110
const TARGET_TRIGGER = 60
const PLUNGER_PULL = 34
const PLUNGER_TIME = 0.9
const LAUNCH_MIN = 560
const LAUNCH_MAX = 1680
const BALL_SAVE = 8
const SUPER_TIME = 20
const BALLS = 3

// ------------------------------------------------------------- the table

/** The shooter lane, on the right. */
export const LANE_X0 = 336
export const LANE_X1 = 366
export const LANE_X = (LANE_X0 + LANE_X1) / 2
export const PLUNGER_Y = 744
/** The arch over the top. */
export const ARCH = { x: 190, y: 196, r: 176 }
/** The playfield's middle, between the walls. */
export const CX = (14 + LANE_X0) / 2

export type WallKind = 'wall' | 'rubber' | 'sling' | 'gate' | 'guide'

export interface Wall {
  ax: number
  ay: number
  bx: number
  by: number
  /** Thickness (radius). */
  r: number
  e: number
  kind: WallKind
  /** Slingshots: which one. */
  sling?: 0 | 1
  /** One-way walls only stop a ball coming from this side (sign of side()). */
  solid?: 1 | -1
}

export interface Bumper {
  x: number
  y: number
  r: number
  /** Seconds since it last fired (for the flash). */
  age: number
}

export interface Target {
  ax: number
  ay: number
  bx: number
  by: number
  /** Drop targets fall when hit; standups stay up and light. */
  standup: boolean
  down: boolean
  lit: boolean
  age: number
}

export interface Flipper extends FlipperShape {
  side: 'L' | 'R'
  rest: number
  up: number
  pressed: boolean
  /** Angular speed during the last sub-step (rad/s). */
  omega: number
}

interface Wire {
  ax: number
  ay: number
  bx: number
  by: number
  id: 'lane0' | 'lane1' | 'lane2' | 'inlane' | 'outlane' | 'gate'
}

const deg = (d: number) => (d * Math.PI) / 180
const mirror = (x: number) => 2 * CX - x

function wall(ax: number, ay: number, bx: number, by: number, kind: WallKind = 'wall', r = 2.5): Wall {
  return { ax, ay, bx, by, r, e: kind === 'rubber' || kind === 'sling' ? RUBBER_E : WALL_E, kind }
}

/** The left flipper; the right one is its mirror image. */
const FLIP = { px: 109, py: 700, len: 54, r1: 9, r2: 4.5, rest: deg(30), up: deg(-28) }
/** The wall between the left outlane and inlane, and the slingshot's outer edge. */
const SEP_X = 38
const SLING_X = 68

type Pt = readonly [number, number]

/**
 * The bottom left corner, worked out from the flipper: the inlane guide runs
 * straight into the top of the resting flipper (no dip where they meet, so a
 * ball rolls on instead of stopping there), and the slingshot's lower edge
 * runs parallel to it, a ball's width and a bit above.
 */
function bottomLeft() {
  const c = Math.cos(FLIP.rest)
  const s = Math.sin(FLIP.rest)
  // The flipper's top surface, from the pivot's cap to the tip's.
  const p1: Pt = [FLIP.px + s * FLIP.r1, FLIP.py - c * FLIP.r1]
  const p2: Pt = [FLIP.px + c * FLIP.len + s * FLIP.r2, FLIP.py + s * FLIP.len - c * FLIP.r2]
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
  const u: Pt = [(p2[0] - p1[0]) / len, (p2[1] - p1[1]) / len] // down along it
  const n: Pt = [u[1], -u[0]] // up, away from it
  const guideR = 2
  const g0: Pt = [p1[0] - n[0] * guideR, p1[1] - n[1] * guideR]
  const atX = (base: Pt, x: number): Pt => [x, base[1] + ((x - base[0]) * u[1]) / u[0]]
  const end: Pt = [g0[0] - u[0] * 10, g0[1] - u[1] * 10]
  const start = atX(g0, SEP_X)
  const edge: Pt = [g0[0] + n[0] * 27, g0[1] + n[1] * 27]
  return {
    guide: { a: start, b: end, r: guideR },
    sling: { a: [SLING_X, 568] as Pt, b: atX(edge, SLING_X), c: atX(edge, 100) },
  }
}

const BOTTOM = bottomLeft()
const flipX = (p: Pt): Pt => [mirror(p[0]), p[1]]

/** Both slingshots (left, then right): the kicking face is a→c, the rubber sides a→b and b→c. */
export const SLINGS = [BOTTOM.sling, { a: flipX(BOTTOM.sling.a), b: flipX(BOTTOM.sling.b), c: flipX(BOTTOM.sling.c) }]

function buildWalls(): Wall[] {
  const walls: Wall[] = [
    wall(14, ARCH.y, 14, H + 40),
    wall(LANE_X1, ARCH.y, LANE_X1, H + 40),
    wall(LANE_X0, 252, LANE_X0, H + 40),
    // Top rollover lanes: four short guides.
    ...[115, 155, 195, 235].map((x) => wall(x, 64, x, 100, 'guide', 2.5)),
    // Left target bank: deflectors above and below.
    wall(14, 268, 27, 292),
    wall(27, 392, 14, 416),
    // Right standups, the same.
    wall(LANE_X0, 268, LANE_X0 - 13, 292),
    wall(LANE_X0 - 13, 392, LANE_X0, 416),
  ]
  // Inlane / outlane separators, then the inlane guides down to the flippers.
  const { a, b, r } = BOTTOM.guide
  walls.push(
    wall(SEP_X, 560, a[0], a[1], 'wall', r),
    wall(a[0], a[1], b[0], b[1], 'wall', r),
    wall(mirror(SEP_X), 560, mirror(a[0]), a[1], 'wall', r),
    wall(mirror(a[0]), a[1], mirror(b[0]), b[1], 'wall', r),
  )
  // The gate at the top of the shooter lane lets the ball out, not back in.
  const gate = wall(LANE_X0, 252, LANE_X1, 232, 'gate', 1.5)
  gate.solid = side(LANE_X, 180, gate.ax, gate.ay, gate.bx, gate.by) > 0 ? 1 : -1
  walls.push(gate)
  SLINGS.forEach((s, i) => {
    const kick = wall(s.a[0], s.a[1], s.c[0], s.c[1], 'sling', 3)
    kick.sling = i as 0 | 1
    walls.push(kick, wall(s.a[0], s.a[1], s.b[0], s.b[1], 'rubber', 3), wall(s.b[0], s.b[1], s.c[0], s.c[1], 'rubber', 3))
  })
  return walls
}

/** Rubber posts: the tops of the lane separators. */
export const POSTS = [
  { x: SEP_X, y: 560, r: 4 },
  { x: mirror(SEP_X), y: 560, r: 4 },
]

function buildWires(): Wire[] {
  return [
    { ax: 117, ay: 84, bx: 153, by: 84, id: 'lane0' },
    { ax: 157, ay: 84, bx: 193, by: 84, id: 'lane1' },
    { ax: 197, ay: 84, bx: 233, by: 84, id: 'lane2' },
    { ax: SEP_X + 2, ay: 600, bx: SLING_X - 3, by: 600, id: 'inlane' },
    { ax: mirror(SEP_X + 2), ay: 600, bx: mirror(SLING_X - 3), by: 600, id: 'inlane' },
    { ax: 16, ay: 600, bx: SEP_X - 2, by: 600, id: 'outlane' },
    { ax: mirror(16), ay: 600, bx: mirror(SEP_X - 2), by: 600, id: 'outlane' },
    { ax: LANE_X0, ay: 252, bx: LANE_X1, by: 232, id: 'gate' },
  ]
}

function makeFlipper(sideName: 'L' | 'R'): Flipper {
  const left = sideName === 'L'
  // The right flipper mirrors the left: its angles are measured from the other side.
  const rest = left ? FLIP.rest : Math.PI - FLIP.rest
  return {
    side: sideName,
    px: left ? FLIP.px : mirror(FLIP.px),
    py: FLIP.py,
    len: FLIP.len,
    r1: FLIP.r1,
    r2: FLIP.r2,
    rest,
    up: left ? FLIP.up : Math.PI - FLIP.up,
    angle: rest,
    prev: rest,
    pressed: false,
    omega: 0,
  }
}

// ------------------------------------------------------------- the rules

export type PinballEvent =
  | { type: 'flipper'; side: 'L' | 'R'; up: boolean }
  | { type: 'bumper'; i: number; points: number }
  | { type: 'sling'; i: number }
  | { type: 'wall'; speed: number }
  | { type: 'target'; i: number }
  | { type: 'bank' }
  | { type: 'standup'; i: number }
  | { type: 'jackpot'; points: number }
  | { type: 'lane'; i: number; lit: boolean }
  | { type: 'lanes'; multiplier: number }
  | { type: 'skill'; points: number }
  | { type: 'inlane' }
  | { type: 'outlane' }
  | { type: 'launch'; power: number }
  | { type: 'saved' }
  | { type: 'drain' }
  | { type: 'bonus'; bonus: number; multiplier: number }
  | { type: 'ball'; n: number }
  | { type: 'gameover' }
  | { type: 'superEnd' }

export type State = 'play' | 'drain' | 'dead'

export interface Ball {
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
}

export const LANE_LETTERS = ['K', 'O', 'S']

export class Pinball {
  ball: Ball = { x: LANE_X, y: PLUNGER_Y - BALL_R, px: LANE_X, py: PLUNGER_Y - BALL_R, vx: 0, vy: 0 }
  walls = buildWalls()
  bumpers: Bumper[] = [
    { x: 135, y: 160, r: 19, age: 9 },
    { x: 215, y: 160, r: 19, age: 9 },
    { x: 175, y: 222, r: 19, age: 9 },
  ]
  /** Three drop targets on the left, three standups on the right. */
  targets: Target[] = [
    ...[300, 330, 360].map((y) => ({ ax: 27, ay: y, bx: 27, by: y + 24, standup: false, down: false, lit: false, age: 9 })),
    ...[300, 330, 360].map((y) => ({ ax: LANE_X0 - 13, ay: y, bx: LANE_X0 - 13, by: y + 24, standup: true, down: false, lit: false, age: 9 })),
  ]
  flippers: Flipper[] = [makeFlipper('L'), makeFlipper('R')]
  lanes = [false, false, false]
  /** Seconds since each slingshot fired. */
  slingAge = [9, 9]
  /** The plunger: how far it is pulled (0..1), and whether Space is held. */
  charge = 0
  charging = false
  /** The plunger's tip springs back when let go without a ball on it. */
  plungerOffset = 0
  /** Seconds since the last launch (for drawing the plunger's kick). */
  kickTime = 9

  score = 0
  ballNumber = 1
  bonus = 0
  multiplier = 1
  /** The highest multiplier reached this game. */
  topMultiplier = 1
  /** Seconds of ball save left (counts down once the ball is in play). */
  saveTime = 0
  /** Super bumpers: seconds left. */
  superTime = 0
  /** The lane lit for a skill shot, while it can still be made (-1: none). */
  skillLane = -1
  skillTime = 0
  state: State = 'play'
  stateTime = 0
  /** The end-of-ball bonus being counted. */
  tally = { bonus: 0, multiplier: 1 }
  events: PinballEvent[] = []
  time = 0

  private inPlay = false
  private saveUsed = false
  private bankReset = -1
  private standupReset = -1
  private stillTime = 0
  private readonly wires = buildWires()
  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  get over(): boolean {
    return this.state === 'dead' && this.stateTime >= 1.6
  }

  /** The ball rests on the plunger, ready to be shot. */
  get onPlunger(): boolean {
    const b = this.ball
    return b.x > LANE_X0 && b.y >= PLUNGER_Y + this.plungerY() - BALL_R - 4 && Math.abs(b.vy) < 80
  }

  /** How far down the plunger's tip is now (units). */
  plungerY(): number {
    return this.charge * PLUNGER_PULL + this.plungerOffset
  }

  reset() {
    this.score = 0
    this.ballNumber = 1
    this.topMultiplier = 1
    this.events = []
    this.state = 'play'
    this.stateTime = 0
    this.time = 0
    this.newBall()
  }

  /** Puts a ball on the plunger with everything for this ball reset. */
  private newBall() {
    this.bonus = 0
    this.multiplier = 1
    this.lanes = [false, false, false]
    this.superTime = 0
    for (const t of this.targets) {
      t.down = false
      t.lit = false
    }
    this.saveUsed = false
    this.serve()
  }

  /** The ball back on the plunger (a new ball, or a saved one). */
  private serve() {
    const y = PLUNGER_Y - BALL_R
    this.ball = { x: LANE_X, y, px: LANE_X, py: y, vx: 0, vy: 0 }
    this.inPlay = false
    this.saveTime = 0
    this.charge = 0
    this.skillLane = Math.floor(this.rng() * 3)
    this.skillTime = 0
    this.stillTime = 0
  }

  // ------------------------------------------------------------- controls

  setFlipper(s: 'L' | 'R', pressed: boolean) {
    const f = this.flippers[s === 'L' ? 0 : 1]
    if (f.pressed === pressed) return
    f.pressed = pressed
    if (this.state === 'dead') return
    this.events.push({ type: 'flipper', side: s, up: pressed })
    // Flippers move the lit lanes left or right.
    if (pressed && this.inPlay) {
      const l = this.lanes
      this.lanes = s === 'L' ? [l[1], l[2], l[0]] : [l[2], l[0], l[1]]
    }
  }

  setPlunger(pressed: boolean) {
    if (pressed === this.charging) return
    this.charging = pressed
    if (pressed) return
    // Let go: the plunger springs back and shoots the ball if it sits on it.
    const power = this.charge
    this.charge = 0
    if (this.state === 'play' && power > 0.02 && this.onPlungerAt(power)) {
      // The tip snaps back up carrying the ball, which flies off.
      const b = this.ball
      b.y = b.py = PLUNGER_Y - BALL_R - 2
      b.x = b.px = LANE_X
      b.vy = -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * power)
      b.vx = 0
      this.plungerOffset = 0
      this.kickTime = 0
      this.skillTime = 4
      this.events.push({ type: 'launch', power })
    } else this.plungerOffset = power * PLUNGER_PULL
  }

  /** Lets go of everything at once (the window lost focus), quietly. */
  releaseAll() {
    for (const f of this.flippers) f.pressed = false
    this.charging = false
    this.charge = 0
  }

  private onPlungerAt(charge: number): boolean {
    const b = this.ball
    return b.x > LANE_X0 && b.y >= PLUNGER_Y + charge * PLUNGER_PULL - BALL_R - 4
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    this.time += dt
    this.stateTime += dt
    for (const b of this.bumpers) b.age += dt
    for (const t of this.targets) t.age += dt
    this.slingAge[0] += dt
    this.slingAge[1] += dt
    if (this.superTime > 0 && (this.superTime -= dt) <= 0) {
      this.superTime = 0
      this.events.push({ type: 'superEnd' })
    }
    if (this.inPlay) this.saveTime = Math.max(0, this.saveTime - dt)
    this.skillTime = Math.max(0, this.skillTime - dt)
    if (this.skillTime === 0 && this.inPlay) this.skillLane = -1
    this.plungerOffset = Math.max(0, this.plungerOffset - dt * 900)
    this.kickTime += dt
    if (this.charging) this.charge = Math.min(1, this.charge + dt / PLUNGER_TIME)
    this.resetBanks(dt)

    if (this.state === 'dead') {
      this.moveFlippers(dt)
      return
    }
    if (this.state === 'drain') {
      this.moveFlippers(dt)
      if (this.stateTime >= 1.8) this.nextBall()
      return
    }
    this.step(dt)
  }

  private resetBanks(dt: number) {
    if (this.bankReset >= 0 && (this.bankReset -= dt) < 0) {
      // Raise the targets again, unless the ball is in the way.
      const b = this.ball
      const blocked = this.targets.some((t) => !t.standup && hitCapsule(b.x, b.y, BALL_R + 2, b.x, b.y, t.ax, t.ay, t.bx, t.by, 3))
      if (blocked) this.bankReset = 0.2
      else for (const t of this.targets) if (!t.standup) t.down = false
    }
    if (this.standupReset >= 0 && (this.standupReset -= dt) < 0) {
      for (const t of this.targets) if (t.standup) t.lit = false
    }
  }

  /** Turns the flippers without a ball (between balls). */
  private moveFlippers(dt: number) {
    for (const f of this.flippers) {
      f.prev = f.angle
      const target = f.pressed ? f.up : f.rest
      const speed = (f.pressed ? FLIP_UP : FLIP_DOWN) * dt
      f.angle = Math.abs(target - f.angle) <= speed ? target : f.angle + Math.sign(target - f.angle) * speed
      f.omega = (f.angle - f.prev) / dt
    }
  }

  /** One fixed step: split into sub-steps so nothing moves more than MAX_MOVE at a time. */
  private step(dt: number) {
    const b = this.ball
    b.px = b.x
    b.py = b.y
    let tip = 0
    for (const f of this.flippers) {
      const target = f.pressed ? f.up : f.rest
      if (Math.abs(target - f.angle) > 1e-9) tip = Math.max(tip, (f.pressed ? FLIP_UP : FLIP_DOWN) * (f.len + f.r2))
    }
    const speed = Math.hypot(b.vx, b.vy) + GRAVITY * dt
    const n = Math.min(64, Math.max(1, Math.ceil(((speed + tip) * dt) / MAX_MOVE)))
    const h = dt / n
    for (let i = 0; i < n && this.state === 'play'; i++) this.substep(h)

    // A ball that stops somewhere it shouldn't (not on a flipper or the plunger) gets a nudge.
    const moving = Math.hypot(b.vx, b.vy) > 25
    const parked = b.y > 600 || b.x > LANE_X0
    this.stillTime = moving || parked ? 0 : this.stillTime + dt
    if (this.stillTime > 3) {
      this.stillTime = 0
      b.vx = (this.rng() - 0.5) * 300
      b.vy = -250
    }
  }

  private substep(h: number) {
    const b = this.ball
    for (const f of this.flippers) {
      f.prev = f.angle
      const target = f.pressed ? f.up : f.rest
      const turn = (f.pressed ? FLIP_UP : FLIP_DOWN) * h
      f.angle = Math.abs(target - f.angle) <= turn ? target : f.angle + Math.sign(target - f.angle) * turn
      f.omega = (f.angle - f.prev) / h
    }

    b.vy += GRAVITY * h
    const keep = 1 - DAMPING * h
    b.vx *= keep
    b.vy *= keep
    const ox = b.x
    const oy = b.y
    b.x += b.vx * h
    b.y += b.vy * h

    // Twice, so a ball wedged in a corner settles against both sides.
    for (let pass = 0; pass < 2; pass++) this.collide(ox, oy, pass === 0)

    const v = Math.hypot(b.vx, b.vy)
    if (v > MAX_SPEED) {
      b.vx *= MAX_SPEED / v
      b.vy *= MAX_SPEED / v
    }
    this.sensors(ox, oy)
    if (b.y > H + BALL_R * 3) this.drain()
    else if (b.x < 0 || b.x > W || b.y < -40) this.serve() // lost off the table: should never happen
  }

  /** Moves the ball out of `hit` and returns the impact speed. */
  private resolve(hit: Hit, e: number, sx = 0, sy = 0): number {
    const b = this.ball
    b.x += hit.nx * hit.depth
    b.y += hit.ny * hit.depth
    return bounce(b, hit, e, sx, sy)
  }

  private collide(ox: number, oy: number, first: boolean) {
    const b = this.ball
    const R = BALL_R

    for (const w of this.walls) {
      // Quick reject: far from the segment's box.
      if (b.x < Math.min(w.ax, w.bx) - R - w.r || b.x > Math.max(w.ax, w.bx) + R + w.r) continue
      if (b.y < Math.min(w.ay, w.by) - R - w.r || b.y > Math.max(w.ay, w.by) + R + w.r) continue
      if (w.solid) {
        // One-way: only a ball coming from the solid side, moving into it.
        if (side(ox, oy, w.ax, w.ay, w.bx, w.by) * w.solid <= 0) continue
        const len = Math.hypot(w.bx - w.ax, w.by - w.ay)
        const nx = (-(w.by - w.ay) / len) * w.solid
        const ny = ((w.bx - w.ax) / len) * w.solid
        if (b.vx * nx + b.vy * ny >= 0) continue
      }
      const hit = hitCapsule(b.x, b.y, R, ox, oy, w.ax, w.ay, w.bx, w.by, w.r)
      if (!hit) continue
      const impact = this.resolve(hit, w.e)
      if (!first) continue
      if (w.kind === 'sling' && impact > SLING_TRIGGER) {
        this.kick(hit, SLING_KICK)
        this.slingAge[w.sling!] = 0
        this.score += 10
        this.events.push({ type: 'sling', i: w.sling! })
      } else if (impact > 140) this.events.push({ type: 'wall', speed: impact })
    }

    const arch = hitArcInside(b.x, b.y, R, ARCH.x, ARCH.y, ARCH.r, -Math.PI, 0)
    if (arch) {
      const impact = this.resolve(arch, 0.3)
      if (first && impact > 200) this.events.push({ type: 'wall', speed: impact })
    }

    for (const p of POSTS) {
      const hit = hitCircle(b.x, b.y, R, p.x, p.y, p.r)
      if (hit) this.resolve(hit, RUBBER_E)
    }

    this.bumpers.forEach((bu, i) => {
      const hit = hitCircle(b.x, b.y, R, bu.x, bu.y, bu.r)
      if (!hit) return
      this.resolve(hit, 0.6)
      if (bu.age < 0.05) return
      bu.age = 0
      this.kick(hit, BUMPER_KICK)
      const points = this.superTime > 0 ? 500 : 100
      this.score += points
      this.bonus += 50
      this.events.push({ type: 'bumper', i, points })
    })

    this.targets.forEach((t, i) => {
      if (t.down) return
      const hit = hitCapsule(b.x, b.y, R, ox, oy, t.ax, t.ay, t.bx, t.by, 3)
      if (!hit) return
      const impact = this.resolve(hit, t.standup ? RUBBER_E : 0.4)
      // Only a real hit on the front counts (the faces point into the playfield).
      const front = t.standup ? hit.nx < -0.3 : hit.nx > 0.3
      if (!first || !front || impact < TARGET_TRIGGER || t.age < 0.15) return
      t.age = 0
      if (t.standup) this.hitStandup(t, i)
      else this.dropTarget(t, i)
    })

    for (const f of this.flippers) {
      const hit = hitFlipper(b.x, b.y, R, ox, oy, f)
      if (!hit) continue
      // The flipper's own speed where it touches the ball.
      const sx = -f.omega * (hit.py - f.py)
      const sy = f.omega * (hit.px - f.px)
      this.resolve(hit, FLIPPER_E, sx, sy)
    }

    // The plunger's tip, at the bottom of the shooter lane.
    if (b.x > LANE_X0 - R) {
      const py = PLUNGER_Y + this.plungerY()
      const hit = hitCapsule(b.x, b.y, R, ox, oy, LANE_X0 + 2, py, LANE_X1 - 2, py, 2)
      if (hit) this.resolve(hit, 0.2)
    }
  }

  /** Bumpers and slingshots fire the ball away at least this fast. */
  private kick(hit: Hit, speed: number) {
    const b = this.ball
    const vn = b.vx * hit.nx + b.vy * hit.ny
    if (vn < speed) {
      b.vx += (speed - vn) * hit.nx
      b.vy += (speed - vn) * hit.ny
    }
  }

  private sensors(ox: number, oy: number) {
    const b = this.ball
    for (const w of this.wires) {
      if (!crosses(ox, oy, b.x, b.y, w.ax, w.ay, w.bx, w.by)) continue
      const down = b.y > oy
      switch (w.id) {
        case 'gate':
          if (!down && !this.inPlay) {
            this.inPlay = true
            if (!this.saveUsed) this.saveTime = BALL_SAVE
          }
          break
        case 'lane0':
        case 'lane1':
        case 'lane2':
          if (down) this.rollover(Number(w.id.slice(4)))
          break
        case 'inlane':
          if (down) {
            this.score += 1000
            this.bonus += 500
            this.events.push({ type: 'inlane' })
          }
          break
        case 'outlane':
          if (down) {
            this.score += 500
            this.events.push({ type: 'outlane' })
          }
          break
      }
    }
  }

  // --------------------------------------------------------------- scoring

  private rollover(i: number) {
    if (this.skillLane >= 0 && this.skillTime > 0) {
      if (i === this.skillLane) {
        this.score += 5000
        this.events.push({ type: 'skill', points: 5000 })
      }
      this.skillLane = -1
    }
    if (this.lanes[i]) {
      this.score += 100
      this.events.push({ type: 'lane', i, lit: false })
      return
    }
    this.lanes[i] = true
    this.score += 500
    this.bonus += 1000
    this.events.push({ type: 'lane', i, lit: true })
    if (this.lanes.every(Boolean)) {
      this.lanes = [false, false, false]
      if (this.multiplier < 5) this.multiplier++
      this.topMultiplier = Math.max(this.topMultiplier, this.multiplier)
      this.score += this.multiplier >= 5 ? 25000 : 5000
      this.events.push({ type: 'lanes', multiplier: this.multiplier })
    }
  }

  private dropTarget(t: Target, i: number) {
    t.down = true
    this.score += 500
    this.bonus += 1000
    this.events.push({ type: 'target', i })
    const bank = this.targets.filter((x) => !x.standup)
    if (bank.every((x) => x.down)) {
      this.score += 5000
      this.superTime = SUPER_TIME
      this.bankReset = 1.5
      this.events.push({ type: 'bank' })
    }
  }

  private hitStandup(t: Target, i: number) {
    this.score += t.lit ? 250 : 750
    this.bonus += 500
    t.lit = true
    this.events.push({ type: 'standup', i })
    const all = this.targets.filter((x) => x.standup)
    if (all.every((x) => x.lit) && this.standupReset < 0) {
      const points = 15000
      this.score += points
      this.standupReset = 1
      this.events.push({ type: 'jackpot', points })
    }
  }

  // ------------------------------------------------------- end of a ball

  private drain() {
    if (this.saveTime > 0 && this.inPlay) {
      this.saveUsed = true
      this.saveTime = 0
      this.events.push({ type: 'saved' })
      this.serve()
      return
    }
    this.state = 'drain'
    this.stateTime = 0
    this.tally = { bonus: this.bonus, multiplier: this.multiplier }
    this.score += this.bonus * this.multiplier
    this.events.push({ type: 'drain' })
    this.events.push({ type: 'bonus', bonus: this.bonus, multiplier: this.multiplier })
    this.ball.vx = this.ball.vy = 0
    this.ball.y = H + 100
    this.ball.py = this.ball.y
  }

  private nextBall() {
    if (this.ballNumber >= BALLS) {
      this.state = 'dead'
      this.stateTime = 0
      this.events.push({ type: 'gameover' })
      return
    }
    this.ballNumber++
    this.state = 'play'
    this.stateTime = 0
    this.newBall()
    this.events.push({ type: 'ball', n: this.ballNumber })
  }

  // ------------------------------------------------------------ for drawing

  tipOf(f: Flipper): [number, number] {
    return flipperTip(f)
  }

  /** The lane lit for the skill shot blinks while the ball is being launched. */
  get skillLit(): number {
    return this.skillLane >= 0 && (!this.inPlay || this.skillTime > 0) ? this.skillLane : -1
  }

  get ballInPlay(): boolean {
    return this.inPlay
  }
}

/** For tests: is a point inside the arch's angle range? */
export const inArch = (x: number, y: number) => angleIn(Math.atan2(y - ARCH.y, x - ARCH.x), -Math.PI, 0)
