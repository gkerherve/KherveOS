// Wobbleland: the amusement-park pinball table and its rules. Plain logic
// with no DOM (drawing and sounds are in parkEngine.ts), on the collision
// maths of physics.ts, like the first Pinball.
//
// The table, in its own units (600 × 1000, y down the table):
// - PARK rollover lanes at the top (light all four: bonus multiplier);
// - three Teacup pop bumpers, and the Ferris Wheel behind them on the right:
//   its scoop locks balls in the gondolas, the third lock starts multiball;
// - the Roller Coaster: a wireform ramp on the left that loops the loop and
//   brings the ball back to the left inlane;
// - the High Striker in the middle: hit its pad hard and the puck climbs the
//   tower; ring the bell;
// - the Shooting Gallery: four duck drop targets on the right;
// - the Carousel: a spinning turntable in the middle that swings the ball;
// - T·I·X standup targets on the left (tickets, and the ball save again);
// - slingshots, inlanes, outlanes, two flippers, a plunger and a ball save.
// Ride all six rides for the Grand Finale.

import { bounce, crosses, flipperTip, hitArcInside, hitCapsule, hitCircle, hitFlipper, side, type FlipperShape, type Hit } from './physics.ts'

export const TW = 600
export const TH = 1000
export const BALL_R = 10
const GRAVITY = 1350
const MAX_MOVE = 2
const MAX_SPEED = 3200
const DAMPING = 0.06
const FLIP_UP = 26
const FLIP_DOWN = 15
const FLIPPER_E = 0.3
const WALL_E = 0.45
const RUBBER_E = 0.68
const BUMPER_KICK = 760
const SLING_KICK = 680
const SLING_TRIGGER = 130
const TARGET_TRIGGER = 70
const PLUNGER_PULL = 44
const PLUNGER_TIME = 0.9
const LAUNCH_MIN = 720
const LAUNCH_MAX = 2200
const BALL_SAVE = 10
const MULTIBALL_SAVE = 12
const BALLS = 3

// ------------------------------------------------------------- the table

export const LANE_X0 = 540
export const LANE_X1 = 576
export const LANE_X = (LANE_X0 + LANE_X1) / 2
export const PLUNGER_Y = 965
export const ARCH = { x: 298, y: 300, r: 278 }
/** The middle of the playfield (the flippers are mirrored about it). */
export const CX = (20 + LANE_X0) / 2
export const GATE_Y = 360

export type WallKind = 'wall' | 'rubber' | 'sling' | 'gate' | 'guide' | 'ramp'

export interface Wall {
  ax: number
  ay: number
  bx: number
  by: number
  r: number
  e: number
  kind: WallKind
  sling?: 0 | 1
  solid?: 1 | -1
}

export interface Bumper {
  x: number
  y: number
  r: number
  age: number
  /** The teacup's turn (radians), spun by hits. */
  spin: number
  spinV: number
}

export interface Target {
  ax: number
  ay: number
  bx: number
  by: number
  down: boolean
  lit: boolean
  age: number
}

export interface Flipper extends FlipperShape {
  side: 'L' | 'R'
  rest: number
  up: number
  pressed: boolean
  omega: number
}

type WireId = 'lane0' | 'lane1' | 'lane2' | 'lane3' | 'inlaneL' | 'inlaneR' | 'outlane' | 'gate' | 'ramp'

interface Wire {
  ax: number
  ay: number
  bx: number
  by: number
  id: WireId
}

const deg = (d: number) => (d * Math.PI) / 180
const mirror = (x: number) => 2 * CX - x
type Pt = readonly [number, number]

function wall(ax: number, ay: number, bx: number, by: number, kind: WallKind = 'wall', r = 3): Wall {
  return { ax, ay, bx, by, r, e: kind === 'rubber' || kind === 'sling' ? RUBBER_E : WALL_E, kind }
}

const FLIP = { px: 196, py: 890, len: 74, r1: 12, r2: 6, rest: deg(30), up: deg(-28) }
const SEP_X = 52
const SLING_X = 92
const SLING_TOP = 722

/** The bottom left corner from the flipper (see pinballRules.ts: the same construction, scaled). */
function bottomLeft() {
  const c = Math.cos(FLIP.rest)
  const s = Math.sin(FLIP.rest)
  const p1: Pt = [FLIP.px + s * FLIP.r1, FLIP.py - c * FLIP.r1]
  const p2: Pt = [FLIP.px + c * FLIP.len + s * FLIP.r2, FLIP.py + s * FLIP.len - c * FLIP.r2]
  const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
  const u: Pt = [(p2[0] - p1[0]) / len, (p2[1] - p1[1]) / len]
  const n: Pt = [u[1], -u[0]]
  const guideR = 2.5
  const g0: Pt = [p1[0] - n[0] * guideR, p1[1] - n[1] * guideR]
  const atX = (base: Pt, x: number): Pt => [x, base[1] + ((x - base[0]) * u[1]) / u[0]]
  const end: Pt = [g0[0] - u[0] * 12, g0[1] - u[1] * 12]
  const start = atX(g0, SEP_X)
  const edge: Pt = [g0[0] + n[0] * 33, g0[1] + n[1] * 33]
  return {
    guide: { a: start, b: end, r: guideR },
    sling: { a: [SLING_X, SLING_TOP] as Pt, b: atX(edge, SLING_X), c: atX(edge, 140) },
  }
}

const BOTTOM = bottomLeft()
const flipX = (p: Pt): Pt => [mirror(p[0]), p[1]]
export const SLINGS = [BOTTOM.sling, { a: flipX(BOTTOM.sling.a), b: flipX(BOTTOM.sling.b), c: flipX(BOTTOM.sling.c) }]
export const GUIDES = [BOTTOM.guide, { a: flipX(BOTTOM.guide.a), b: flipX(BOTTOM.guide.b), r: BOTTOM.guide.r }]
export const SEPARATORS = [SEP_X, mirror(SEP_X)]

/** The PARK lanes' guides (x) and how far down they run. */
export const LANE_GUIDES = [178, 234, 290, 346, 402]
export const LANE_TOP = 96
export const LANE_BOTTOM = 146
export const LANE_WIRE_Y = 124

/** The coaster's mouth on the left: a ball going up through it fast enough rides the ramp. */
export const RAMP = { x0: 22, x1: 98, y: 436, lip: 404, minSpeed: 430 }
/** The Ferris wheel (drawn) and its scoop (where balls are caught). */
export const WHEEL = { x: 462, y: 215, r: 76 }
export const SCOOP = { x: 470, y: 338, r: 15 }
/** The High Striker: the pad (a target facing down) and the tower above it. */
export const STRIKER = { x0: 262, x1: 318, y: 476, top: 334 }
/** The Carousel turntable. */
export const CAROUSEL = { x: 280, y: 612, r: 50, omega: 5.2 }
/** Ducks: four drop targets facing left, on the right. */
export const DUCK_X = 518
export const DUCK_YS = [430, 462, 494, 526]
export const DUCK_H = 26
/** T·I·X standups facing right, on the left. */
export const TIX_X = 32
export const TIX_YS = [500, 532, 564]
export const TIX_H = 24

function buildWalls(): Wall[] {
  const walls: Wall[] = [
    wall(20, ARCH.y, 20, TH + 40),
    wall(LANE_X1, ARCH.y, LANE_X1, TH + 40),
    wall(LANE_X0, GATE_Y, LANE_X0, TH + 40),
    ...LANE_GUIDES.map((x) => wall(x, LANE_TOP, x, LANE_BOTTOM, 'guide', 3)),
    // The coaster's lip: a ball too slow for the ramp falls back off it; one from above rolls off to the right.
    wall(20, RAMP.lip - 12, RAMP.x1, RAMP.lip + 6, 'ramp', 3),
    wall(RAMP.x1, RAMP.lip + 6, RAMP.x1 + 4, RAMP.y + 44, 'ramp', 3),
    // The ducks' bank: deflectors above and below.
    wall(LANE_X0, DUCK_YS[0] - 26, DUCK_X, DUCK_YS[0] - 4),
    wall(DUCK_X, DUCK_YS[3] + DUCK_H + 4, LANE_X0, DUCK_YS[3] + DUCK_H + 28),
    // The T·I·X standups: the same on the left.
    wall(20, TIX_YS[0] - 22, TIX_X, TIX_YS[0] - 6),
    wall(TIX_X, TIX_YS[2] + TIX_H + 6, 20, TIX_YS[2] + TIX_H + 22),
    // The scoop's little wall behind it, so a ball can drop in from below.
    wall(SCOOP.x + 22, SCOOP.y - 26, SCOOP.x + 24, SCOOP.y + 10, 'wall', 3),
  ]
  for (const [i, g] of GUIDES.entries()) {
    walls.push(wall(SEPARATORS[i], 700, g.a[0], g.a[1], 'wall', g.r), wall(g.a[0], g.a[1], g.b[0], g.b[1], 'wall', g.r))
  }
  const gate = wall(LANE_X0, GATE_Y, LANE_X1, GATE_Y - 26, 'gate', 2)
  gate.solid = side(LANE_X, GATE_Y - 80, gate.ax, gate.ay, gate.bx, gate.by) > 0 ? 1 : -1
  walls.push(gate)
  SLINGS.forEach((s, i) => {
    const kick = wall(s.a[0], s.a[1], s.c[0], s.c[1], 'sling', 4)
    kick.sling = i as 0 | 1
    walls.push(kick, wall(s.a[0], s.a[1], s.b[0], s.b[1], 'rubber', 4), wall(s.b[0], s.b[1], s.c[0], s.c[1], 'rubber', 4))
  })
  return walls
}

export const POSTS = [
  { x: SEP_X, y: 700, r: 5 },
  { x: mirror(SEP_X), y: 700, r: 5 },
  { x: RAMP.x1 + 4, y: RAMP.y + 44, r: 5 },
]

function buildWires(): Wire[] {
  const lanes = [0, 1, 2, 3].map((i): Wire => ({
    ax: LANE_GUIDES[i] + 4, ay: LANE_WIRE_Y, bx: LANE_GUIDES[i + 1] - 4, by: LANE_WIRE_Y, id: `lane${i}` as WireId,
  }))
  return [
    ...lanes,
    { ax: SEP_X + 3, ay: 760, bx: SLING_X, by: 760, id: 'inlaneL' },
    { ax: mirror(SEP_X + 3), ay: 760, bx: mirror(SLING_X), by: 760, id: 'inlaneR' },
    { ax: 22, ay: 760, bx: SEP_X - 3, by: 760, id: 'outlane' },
    { ax: mirror(22), ay: 760, bx: mirror(SEP_X - 3), by: 760, id: 'outlane' },
    { ax: LANE_X0, ay: GATE_Y, bx: LANE_X1, by: GATE_Y - 26, id: 'gate' },
    { ax: RAMP.x0, ay: RAMP.y, bx: RAMP.x1, by: RAMP.y, id: 'ramp' },
  ]
}

function makeFlipper(s: 'L' | 'R'): Flipper {
  const left = s === 'L'
  const rest = left ? FLIP.rest : Math.PI - FLIP.rest
  return {
    side: s, px: left ? FLIP.px : mirror(FLIP.px), py: FLIP.py, len: FLIP.len, r1: FLIP.r1, r2: FLIP.r2,
    rest, up: left ? FLIP.up : Math.PI - FLIP.up, angle: rest, prev: rest, pressed: false, omega: 0,
  }
}

// ------------------------------------------------------------ the coaster

/** The coaster's track, as points along it (table units), from the mouth to where it drops the ball in the left inlane. */
function buildTrack(): Pt[] {
  const pts: Pt[] = []
  const line = (a: Pt, b: Pt) => {
    const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 6))
    for (let i = pts.length ? 1 : 0; i <= n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
  }
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    const n = Math.ceil((Math.abs(a1 - a0) * r) / 6)
    for (let i = 1; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  }
  line([60, RAMP.y], [60, 300])
  // The loop the loop: all the way round.
  arc(112, 300, 52, Math.PI, Math.PI * 3)
  // Up the lift hill to the top left, over the crest, and the long drop down the left side.
  line([60, 300], [62, 210])
  arc(142, 210, 80, Math.PI, Math.PI * 1.62)
  const last = pts[pts.length - 1]
  line(last, [205, 175])
  arc(205, 235, 60, -Math.PI / 2, Math.PI * 0.18)
  const l2 = pts[pts.length - 1]
  line(l2, [150, 520])
  line([150, 520], [96, 640])
  line([96, 640], [72, 690])
  return pts
}

export const TRACK = buildTrack()
const TRACK_LEN: number[] = (() => {
  const acc = [0]
  for (let i = 1; i < TRACK.length; i++) acc.push(acc[i - 1] + Math.hypot(TRACK[i][0] - TRACK[i - 1][0], TRACK[i][1] - TRACK[i - 1][1]))
  return acc
})()
export const TRACK_LENGTH = TRACK_LEN[TRACK_LEN.length - 1]

/** A point on the track at distance d along it, and its direction. */
export function trackAt(d: number): { x: number; y: number; dx: number; dy: number } {
  const L = Math.max(0, Math.min(TRACK_LENGTH, d))
  let lo = 0
  let hi = TRACK_LEN.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (TRACK_LEN[mid] <= L) lo = mid
    else hi = mid
  }
  const seg = TRACK_LEN[hi] - TRACK_LEN[lo] || 1
  const t = (L - TRACK_LEN[lo]) / seg
  const [ax, ay] = TRACK[lo]
  const [bx, by] = TRACK[hi]
  const len = Math.hypot(bx - ax, by - ay) || 1
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / len, dy: (by - ay) / len }
}

// ------------------------------------------------------------- the rules

export type Ride = 'coaster' | 'wheel' | 'teacups' | 'striker' | 'gallery' | 'carousel'
export const RIDES: Ride[] = ['coaster', 'wheel', 'teacups', 'striker', 'gallery', 'carousel']
export const RIDE_NAMES: Record<Ride, string> = {
  coaster: 'Roller Coaster',
  wheel: 'Ferris Wheel',
  teacups: 'Teacups',
  striker: 'High Striker',
  gallery: 'Shooting Gallery',
  carousel: 'Carousel',
}
/** What each ride needs. */
export const RIDE_GOALS: Record<Ride, number> = { coaster: 3, wheel: 3, teacups: 30, striker: 1, gallery: 1, carousel: 5 }

export type ParkEvent =
  | { type: 'flipper'; side: 'L' | 'R'; up: boolean }
  | { type: 'bumper'; i: number; points: number }
  | { type: 'sling'; i: number }
  | { type: 'wall'; speed: number; x: number; y: number }
  | { type: 'duck'; i: number }
  | { type: 'gallery'; points: number }
  | { type: 'tix'; i: number }
  | { type: 'tixAll' }
  | { type: 'lane'; i: number; lit: boolean }
  | { type: 'lanes'; multiplier: number }
  | { type: 'skill'; points: number }
  | { type: 'inlane'; side: 'L' | 'R' }
  | { type: 'outlane' }
  | { type: 'launch'; power: number }
  | { type: 'rampStart' }
  | { type: 'rampEnd'; points: number; combo: boolean }
  | { type: 'rampFail' }
  | { type: 'scoop' }
  | { type: 'lock'; n: number }
  | { type: 'eject' }
  | { type: 'multiball' }
  | { type: 'jackpot'; points: number; x: number; y: number }
  | { type: 'multiballEnd' }
  | { type: 'striker'; level: number; bell: boolean; points: number }
  | { type: 'carouselTick' }
  | { type: 'ride'; ride: Ride; done: number }
  | { type: 'finale' }
  | { type: 'extraBall' }
  | { type: 'saved' }
  | { type: 'drain' }
  | { type: 'bonus'; bonus: number; multiplier: number }
  | { type: 'ball'; n: number }
  | { type: 'gameover' }

export type State = 'play' | 'drain' | 'dead'

export interface Ball {
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  /** free: rolling; ramp: on the coaster; scoop: held in the scoop. */
  mode: 'free' | 'ramp' | 'scoop'
  /** Ramp: distance along the track; scoop: seconds held. */
  t: number
  /** Ramp: speed along the track. */
  speed: number
  /** Seconds since it last moved much (to free a stuck ball). */
  still: number
}

const newBall = (x: number, y: number): Ball => ({ x, y, px: x, py: y, vx: 0, vy: 0, mode: 'free', t: 0, speed: 0, still: 0 })

export class Park {
  balls: Ball[] = []
  walls = buildWalls()
  bumpers: Bumper[] = [
    { x: 236, y: 212, r: 28, age: 9, spin: 0, spinV: 0.6 },
    { x: 344, y: 212, r: 28, age: 9, spin: 1, spinV: -0.6 },
    { x: 290, y: 292, r: 28, age: 9, spin: 2, spinV: 0.6 },
  ]
  ducks: Target[] = DUCK_YS.map((y) => ({ ax: DUCK_X, ay: y, bx: DUCK_X, by: y + DUCK_H, down: false, lit: false, age: 9 }))
  tix: Target[] = TIX_YS.map((y) => ({ ax: TIX_X, ay: y, bx: TIX_X, by: y + TIX_H, down: false, lit: false, age: 9 }))
  flippers: Flipper[] = [makeFlipper('L'), makeFlipper('R')]
  lanes = [false, false, false, false]
  slingAge = [9, 9]
  charge = 0
  charging = false
  plungerOffset = 0
  kickTime = 9

  score = 0
  ballNumber = 1
  extraBalls = 0
  bonus = 0
  multiplier = 1
  tickets = 0
  saveTime = 0
  skillLane = -1
  skillTime = 0
  state: State = 'play'
  stateTime = 0
  tally = { bonus: 0, multiplier: 1 }
  events: ParkEvent[] = []
  time = 0

  /** Progress on each ride this game, and which are done. */
  progress: Record<Ride, number> = { coaster: 0, wheel: 0, teacups: 0, striker: 0, gallery: 0, carousel: 0 }
  done: Record<Ride, boolean> = { coaster: false, wheel: false, teacups: false, striker: false, gallery: false, carousel: false }
  /** Balls waiting in the Ferris wheel's gondolas. */
  locked = 0
  multiball = false
  /** Grand Finale: every ride done; jackpots are worth more. */
  finale = false
  jackpot = 50000
  /** The High Striker's puck: how high it is going (0..1), how high it is, and the bell's ring. */
  strikerGoal = 0
  strikerLevel = 0
  strikerAge = 9
  bellAge = 9
  /** The carousel's turn (radians) and how long the ball has ridden it (seconds). */
  carouselAngle = 0
  carouselTime = 0
  /** The wheel's turn (radians), faster in multiball. */
  wheelAngle = 0
  /** A ramp shot right after an inlane scores double. */
  comboTime = 0
  /** Balls waiting to be shot out of the shooter lane automatically (multiball). */
  autoLaunch = 0
  private autoTimer = 0
  /** Ejections from the scoop still to come (multiball start). */
  private ejectQueue = 0
  private ejectTimer = 0
  private inPlay = false
  /** The scoop takes no ball for a moment after it kicked one out. */
  private scoopCool = 0
  private saveUsed = false
  private gallerySet = -1
  private tixReset = -1
  private carouselTick = 0
  private readonly wires = buildWires()
  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  get over(): boolean {
    return this.state === 'dead' && this.stateTime >= 1.8
  }

  get ridesDone(): number {
    return RIDES.filter((r) => this.done[r]).length
  }

  get ballInPlay(): boolean {
    return this.inPlay
  }

  get skillLit(): number {
    return this.skillLane >= 0 && (!this.inPlay || this.skillTime > 0) ? this.skillLane : -1
  }

  plungerY(): number {
    return this.charge * PLUNGER_PULL + this.plungerOffset
  }

  /** The ball resting on the plunger, if there is one. */
  plungerBall(charge = this.charge): Ball | null {
    return this.balls.find((b) => b.mode === 'free' && b.x > LANE_X0 && b.y >= PLUNGER_Y + charge * PLUNGER_PULL - BALL_R - 5 && Math.abs(b.vy) < 90) ?? null
  }

  reset() {
    this.score = 0
    this.ballNumber = 1
    this.extraBalls = 0
    this.tickets = 0
    this.locked = 0
    this.multiball = false
    this.finale = false
    this.jackpot = 50000
    for (const r of RIDES) {
      this.progress[r] = 0
      this.done[r] = false
    }
    this.events = []
    this.state = 'play'
    this.stateTime = 0
    this.time = 0
    this.startBall()
  }

  private startBall() {
    this.bonus = 0
    this.multiplier = 1
    this.lanes = [false, false, false, false]
    for (const d of this.ducks) d.down = false
    for (const t of this.tix) t.lit = false
    this.carouselTime = 0
    this.saveUsed = false
    this.balls = []
    this.serve()
  }

  /** A ball onto the plunger. */
  private serve() {
    const y = PLUNGER_Y - BALL_R
    this.balls.push(newBall(LANE_X, y))
    this.inPlay = false
    this.saveTime = 0
    this.charge = 0
    this.skillLane = Math.floor(this.rng() * 4)
    this.skillTime = 0
  }

  // ------------------------------------------------------------- controls

  setFlipper(s: 'L' | 'R', pressed: boolean) {
    const f = this.flippers[s === 'L' ? 0 : 1]
    if (f.pressed === pressed) return
    f.pressed = pressed
    if (this.state === 'dead') return
    this.events.push({ type: 'flipper', side: s, up: pressed })
    if (pressed && this.inPlay) {
      const l = this.lanes
      this.lanes = s === 'L' ? [l[1], l[2], l[3], l[0]] : [l[3], l[0], l[1], l[2]]
    }
  }

  setPlunger(pressed: boolean) {
    if (pressed === this.charging) return
    this.charging = pressed
    if (pressed) return
    const power = this.charge
    this.charge = 0
    const b = this.state === 'play' && power > 0.02 ? this.plungerBall(power) : null
    if (b) this.launch(b, power)
    else this.plungerOffset = power * PLUNGER_PULL
  }

  private launch(b: Ball, power: number) {
    b.y = b.py = PLUNGER_Y - BALL_R - 2
    b.x = b.px = LANE_X
    b.vy = -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * power)
    b.vx = 0
    this.plungerOffset = 0
    this.kickTime = 0
    if (!this.inPlay) this.skillTime = 4
    this.events.push({ type: 'launch', power })
  }

  releaseAll() {
    for (const f of this.flippers) f.pressed = false
    this.charging = false
    this.charge = 0
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    this.time += dt
    this.stateTime += dt
    for (const b of this.bumpers) {
      b.age += dt
      b.spin += b.spinV * dt
      b.spinV += (Math.sign(b.spinV) * 0.6 - b.spinV) * Math.min(1, dt * 0.8)
    }
    for (const t of this.ducks) t.age += dt
    for (const t of this.tix) t.age += dt
    this.slingAge[0] += dt
    this.slingAge[1] += dt
    this.strikerAge += dt
    this.bellAge += dt
    // The puck flies up to its height, stays a moment, then falls back down.
    const a = this.strikerAge
    this.strikerLevel = a < 0.45 ? this.strikerGoal * Math.sin((a / 0.45) * (Math.PI / 2)) : a < 0.75 ? this.strikerGoal : Math.max(0, this.strikerGoal * (1 - (a - 0.75) / 0.6))
    this.carouselAngle += CAROUSEL.omega * dt
    this.wheelAngle += (this.multiball ? 0.9 : 0.25) * dt
    this.comboTime = Math.max(0, this.comboTime - dt)
    this.scoopCool = Math.max(0, this.scoopCool - dt)
    if (this.inPlay) this.saveTime = Math.max(0, this.saveTime - dt)
    this.skillTime = Math.max(0, this.skillTime - dt)
    if (this.skillTime === 0 && this.inPlay) this.skillLane = -1
    this.plungerOffset = Math.max(0, this.plungerOffset - dt * 1100)
    this.kickTime += dt
    if (this.charging) this.charge = Math.min(1, this.charge + dt / PLUNGER_TIME)
    if (this.gallerySet >= 0 && (this.gallerySet -= dt) < 0) for (const d of this.ducks) d.down = false
    if (this.tixReset >= 0 && (this.tixReset -= dt) < 0) for (const t of this.tix) t.lit = false

    if (this.state !== 'play') {
      this.moveFlippers(dt)
      if (this.state === 'drain' && this.stateTime >= 2.2) this.nextBall()
      return
    }
    this.autoLaunchStep(dt)
    this.ejectStep(dt)
    this.step(dt)
  }

  private moveFlippers(dt: number) {
    for (const f of this.flippers) {
      f.prev = f.angle
      const target = f.pressed ? f.up : f.rest
      const speed = (f.pressed ? FLIP_UP : FLIP_DOWN) * dt
      f.angle = Math.abs(target - f.angle) <= speed ? target : f.angle + Math.sign(target - f.angle) * speed
      f.omega = (f.angle - f.prev) / dt
    }
  }

  /** In multiball the shooter lane fires by itself. */
  private autoLaunchStep(dt: number) {
    if (this.autoLaunch <= 0) return
    const b = this.plungerBall(0)
    if (!b) return
    if ((this.autoTimer += dt) < 0.7) return
    this.autoTimer = 0
    this.autoLaunch--
    this.launch(b, 0.72 + this.rng() * 0.12)
  }

  private ejectStep(dt: number) {
    const held = this.balls.find((b) => b.mode === 'scoop')
    if (held) {
      held.t += dt
      if (held.t >= 0.9) this.eject(held)
      return
    }
    if (this.ejectQueue > 0 && (this.ejectTimer -= dt) <= 0) {
      this.ejectQueue--
      this.ejectTimer = 0.8
      const b = newBall(SCOOP.x, SCOOP.y)
      b.mode = 'scoop'
      b.t = 0.6
      this.balls.push(b)
    }
  }

  private eject(b: Ball) {
    b.mode = 'free'
    b.x = b.px = SCOOP.x - SCOOP.r - 6
    b.y = b.py = SCOOP.y + 8
    this.scoopCool = 0.6
    b.vx = -380 - this.rng() * 160
    b.vy = 260 + this.rng() * 120
    this.events.push({ type: 'eject' })
  }

  private step(dt: number) {
    const free = this.balls.filter((b) => b.mode === 'free')
    for (const b of this.balls) {
      b.px = b.x
      b.py = b.y
    }
    for (const b of this.balls) if (b.mode === 'ramp') this.rideRamp(b, dt)

    let tip = 0
    for (const f of this.flippers) {
      const target = f.pressed ? f.up : f.rest
      if (Math.abs(target - f.angle) > 1e-9) tip = Math.max(tip, (f.pressed ? FLIP_UP : FLIP_DOWN) * (f.len + f.r2))
    }
    let fastest = 0
    for (const b of free) fastest = Math.max(fastest, Math.hypot(b.vx, b.vy))
    const n = Math.min(80, Math.max(1, Math.ceil(((fastest + GRAVITY * dt + tip) * dt) / MAX_MOVE)))
    const h = dt / n
    for (let i = 0; i < n && this.state === 'play'; i++) this.substep(h)

    for (const b of this.balls) {
      if (b.mode !== 'free') continue
      const moving = Math.hypot(b.vx, b.vy) > 25
      const parked = b.y > 780 || b.x > LANE_X0
      b.still = moving || parked ? 0 : b.still + dt
      if (b.still > 3) {
        b.still = 0
        b.vx = (this.rng() - 0.5) * 360
        b.vy = -300
      }
    }
  }

  private substep(h: number) {
    for (const f of this.flippers) {
      f.prev = f.angle
      const target = f.pressed ? f.up : f.rest
      const turn = (f.pressed ? FLIP_UP : FLIP_DOWN) * h
      f.angle = Math.abs(target - f.angle) <= turn ? target : f.angle + Math.sign(target - f.angle) * turn
      f.omega = (f.angle - f.prev) / h
    }
    const keep = 1 - DAMPING * h
    for (const b of this.balls) {
      if (b.mode !== 'free') continue
      b.vy += GRAVITY * h
      b.vx *= keep
      b.vy *= keep
      this.spinOnCarousel(b, h)
      const ox = b.x
      const oy = b.y
      b.x += b.vx * h
      b.y += b.vy * h
      for (let pass = 0; pass < 2; pass++) this.collide(b, ox, oy, pass === 0)
      const v = Math.hypot(b.vx, b.vy)
      if (v > MAX_SPEED) {
        b.vx *= MAX_SPEED / v
        b.vy *= MAX_SPEED / v
      }
      this.sensors(b, ox, oy)
    }
    this.ballsTogether()
    // Drained balls (and any lost off the table, which should never happen).
    for (const b of [...this.balls]) {
      if (b.mode !== 'free') continue
      if (b.y > TH + BALL_R * 3) this.lose(b)
      else if (b.x < 0 || b.x > TW || b.y < -40) {
        b.x = b.px = LANE_X
        b.y = b.py = PLUNGER_Y - BALL_R
        b.vx = b.vy = 0
      }
    }
  }

  /** Balls in multiball knock into each other. */
  private ballsTogether() {
    const free = this.balls.filter((b) => b.mode === 'free')
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i]
        const b = free[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy)
        if (d >= BALL_R * 2 || d < 1e-6) continue
        const nx = dx / d
        const ny = dy / d
        const push = (BALL_R * 2 - d) / 2
        a.x -= nx * push
        a.y -= ny * push
        b.x += nx * push
        b.y += ny * push
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
        if (rel <= 0) continue
        const k = rel * 0.95
        a.vx -= k * nx
        a.vy -= k * ny
        b.vx += k * nx
        b.vy += k * ny
      }
    }
  }

  /** The turntable drags a ball on it round with it. */
  private spinOnCarousel(b: Ball, h: number) {
    const dx = b.x - CAROUSEL.x
    const dy = b.y - CAROUSEL.y
    const d = Math.hypot(dx, dy)
    if (d > CAROUSEL.r) return
    const tx = -dy * CAROUSEL.omega
    const ty = dx * CAROUSEL.omega
    const k = Math.min(1, 4.5 * h)
    b.vx += (tx - b.vx) * k * 0.5
    b.vy += (ty - b.vy) * k * 0.5
    this.carouselTime += h
    this.carouselTick += h
    if (this.carouselTick >= 0.25) {
      this.carouselTick = 0
      this.score += 100
      this.bonus += 50
      this.events.push({ type: 'carouselTick' })
      const secs = Math.floor(this.carouselTime)
      if (secs > this.progress.carousel) this.advance('carousel', secs - this.progress.carousel)
    }
  }

  private resolve(b: Ball, hit: Hit, e: number, sx = 0, sy = 0): number {
    b.x += hit.nx * hit.depth
    b.y += hit.ny * hit.depth
    return bounce(b, hit, e, sx, sy)
  }

  private collide(b: Ball, ox: number, oy: number, first: boolean) {
    const R = BALL_R
    for (const w of this.walls) {
      if (b.x < Math.min(w.ax, w.bx) - R - w.r || b.x > Math.max(w.ax, w.bx) + R + w.r) continue
      if (b.y < Math.min(w.ay, w.by) - R - w.r || b.y > Math.max(w.ay, w.by) + R + w.r) continue
      if (w.solid) {
        if (side(ox, oy, w.ax, w.ay, w.bx, w.by) * w.solid <= 0) continue
        const len = Math.hypot(w.bx - w.ax, w.by - w.ay)
        const nx = (-(w.by - w.ay) / len) * w.solid
        const ny = ((w.bx - w.ax) / len) * w.solid
        if (b.vx * nx + b.vy * ny >= 0) continue
      }
      const hit = hitCapsule(b.x, b.y, R, ox, oy, w.ax, w.ay, w.bx, w.by, w.r)
      if (!hit) continue
      const impact = this.resolve(b, hit, w.e)
      if (!first) continue
      if (w.kind === 'sling' && impact > SLING_TRIGGER) {
        // Kicked across, but only gently upwards, so a ball can't ping-pong between the two for ever.
        this.kick(b, hit, SLING_KICK)
        if (b.vy < 0) b.vy *= 0.45
        this.slingAge[w.sling!] = 0
        this.score += 10
        this.events.push({ type: 'sling', i: w.sling! })
      } else if (w.kind === 'ramp' && hit.ny > 0.5 && impact > 200) this.events.push({ type: 'rampFail' })
      else if (impact > 160) this.events.push({ type: 'wall', speed: impact, x: hit.px, y: hit.py })
    }

    const arch = hitArcInside(b.x, b.y, R, ARCH.x, ARCH.y, ARCH.r, -Math.PI, 0)
    if (arch) {
      const impact = this.resolve(b, arch, 0.3)
      if (first && impact > 240) this.events.push({ type: 'wall', speed: impact, x: arch.px, y: arch.py })
    }

    for (const p of POSTS) {
      const hit = hitCircle(b.x, b.y, R, p.x, p.y, p.r)
      if (hit) this.resolve(b, hit, RUBBER_E)
    }

    this.bumpers.forEach((bu, i) => {
      const hit = hitCircle(b.x, b.y, R, bu.x, bu.y, bu.r)
      if (!hit) return
      this.resolve(b, hit, 0.6)
      if (bu.age < 0.05) return
      bu.age = 0
      bu.spinV = (i % 2 ? -1 : 1) * 9
      this.kick(b, hit, BUMPER_KICK)
      const points = this.done.teacups ? 1000 : 250
      this.score += points
      this.bonus += 100
      this.events.push({ type: 'bumper', i, points })
      this.advance('teacups', 1)
    })

    // The High Striker's pad: a hit from below sends the puck up the tower.
    {
      const hit = hitCapsule(b.x, b.y, R, ox, oy, STRIKER.x0, STRIKER.y, STRIKER.x1, STRIKER.y, 6)
      if (hit) {
        const impact = this.resolve(b, hit, RUBBER_E)
        if (first && hit.ny > 0.4 && impact > TARGET_TRIGGER && this.strikerAge > 0.5) this.strike(impact)
      }
    }

    this.ducks.forEach((t, i) => {
      if (t.down) return
      const hit = hitCapsule(b.x, b.y, R, ox, oy, t.ax, t.ay, t.bx, t.by, 4)
      if (!hit) return
      const impact = this.resolve(b, hit, 0.4)
      if (!first || hit.nx > -0.3 || impact < TARGET_TRIGGER || t.age < 0.15) return
      t.age = 0
      this.duck(t, i)
    })

    this.tix.forEach((t, i) => {
      const hit = hitCapsule(b.x, b.y, R, ox, oy, t.ax, t.ay, t.bx, t.by, 4)
      if (!hit) return
      const impact = this.resolve(b, hit, RUBBER_E)
      if (!first || hit.nx < 0.3 || impact < TARGET_TRIGGER || t.age < 0.15) return
      t.age = 0
      this.ticket(t, i)
    })

    // The scoop: a ball rolling over it drops in (unless it is flying over far too fast).
    if (this.scoopCool === 0 && Math.hypot(b.x - SCOOP.x, b.y - SCOOP.y) < SCOOP.r - 3 && Math.hypot(b.vx, b.vy) < 1500 && !this.balls.some((o) => o.mode === 'scoop')) {
      this.capture(b)
      return
    }

    for (const f of this.flippers) {
      const hit = hitFlipper(b.x, b.y, R, ox, oy, f)
      if (!hit) continue
      const sx = -f.omega * (hit.py - f.py)
      const sy = f.omega * (hit.px - f.px)
      this.resolve(b, hit, FLIPPER_E, sx, sy)
    }

    if (b.x > LANE_X0 - R) {
      const py = PLUNGER_Y + this.plungerY()
      const hit = hitCapsule(b.x, b.y, R, ox, oy, LANE_X0 + 2, py, LANE_X1 - 2, py, 2)
      if (hit) this.resolve(b, hit, 0.2)
    }
  }

  private kick(b: Ball, hit: Hit, speed: number) {
    const vn = b.vx * hit.nx + b.vy * hit.ny
    if (vn < speed) {
      b.vx += (speed - vn) * hit.nx
      b.vy += (speed - vn) * hit.ny
    }
  }

  private sensors(b: Ball, ox: number, oy: number) {
    for (const w of this.wires) {
      if (b.mode !== 'free' || !crosses(ox, oy, b.x, b.y, w.ax, w.ay, w.bx, w.by)) continue
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
        case 'lane3':
          if (down) this.rollover(Number(w.id.slice(4)))
          break
        case 'inlaneL':
        case 'inlaneR':
          if (down) {
            this.score += 1000
            this.bonus += 500
            this.comboTime = 3
            this.events.push({ type: 'inlane', side: w.id === 'inlaneL' ? 'L' : 'R' })
          }
          break
        case 'outlane':
          if (down) {
            this.score += 2500
            this.events.push({ type: 'outlane' })
          }
          break
        case 'ramp':
          if (!down && -b.vy > RAMP.minSpeed) this.enterRamp(b)
          break
      }
    }
  }

  // ------------------------------------------------------------ the rides

  private enterRamp(b: Ball) {
    b.mode = 'ramp'
    b.t = 0
    b.speed = Math.min(1100, Math.max(620, -b.vy * 0.9))
    this.events.push({ type: 'rampStart' })
  }

  /** The ball on the coaster: it slows on the climbs, speeds up on the drops. */
  private rideRamp(b: Ball, dt: number) {
    const p = trackAt(b.t)
    b.speed = Math.max(380, Math.min(1300, b.speed + GRAVITY * 0.55 * p.dy * dt))
    b.t += b.speed * dt
    const q = trackAt(b.t)
    b.x = q.x
    b.y = q.y
    if (b.t < TRACK_LENGTH) return
    b.mode = 'free'
    b.vx = q.dx * 420
    b.vy = Math.max(200, q.dy * 420)
    const combo = this.comboTime > 0
    const points = (this.done.coaster ? 25000 : 10000) * (combo ? 2 : 1)
    this.score += points
    this.bonus += 2000
    this.comboTime = 0
    this.events.push({ type: 'rampEnd', points, combo })
    this.advance('coaster', 1)
    if (this.multiball) this.award(this.jackpot / 2, 60, 300)
  }

  private capture(b: Ball) {
    b.mode = 'scoop'
    b.t = 0
    b.vx = b.vy = 0
    b.x = SCOOP.x
    b.y = SCOOP.y
    this.score += 2000
    this.events.push({ type: 'scoop' })
    if (this.multiball) {
      this.award(this.jackpot, SCOOP.x, SCOOP.y)
      return
    }
    // Lock it in a gondola: the ball rides up into the wheel and a new one comes to the plunger.
    this.locked++
    this.events.push({ type: 'lock', n: this.locked })
    this.balls = this.balls.filter((o) => o !== b)
    this.advance('wheel', 1)
    if (this.locked >= 3) this.startMultiball(3)
    else if (!this.balls.some((o) => o.mode !== 'scoop')) this.serve()
  }

  private startMultiball(n: number) {
    this.multiball = true
    this.locked = 0
    this.ejectQueue = n
    this.ejectTimer = 0.5
    this.saveTime = MULTIBALL_SAVE
    this.saveUsed = false
    this.events.push({ type: 'multiball' })
  }

  private award(points: number, x: number, y: number) {
    this.score += points
    this.events.push({ type: 'jackpot', points, x, y })
  }

  private strike(impact: number) {
    const level = Math.min(1, impact / 1250)
    this.strikerGoal = level
    this.strikerAge = 0
    const bell = level >= 0.9
    const points = bell ? 50000 : Math.round(level * 10) * 1000
    this.score += points
    this.bonus += 1000
    if (bell) {
      this.bellAge = 0
      this.advance('striker', 1)
    }
    this.events.push({ type: 'striker', level, bell, points })
  }

  private duck(t: Target, i: number) {
    t.down = true
    this.score += 1500
    this.bonus += 1000
    this.events.push({ type: 'duck', i })
    if (this.ducks.every((d) => d.down)) {
      const points = this.done.gallery ? 40000 : 25000
      this.score += points
      this.gallerySet = 1.6
      this.events.push({ type: 'gallery', points })
      this.advance('gallery', 1)
    }
  }

  private ticket(t: Target, i: number) {
    this.score += t.lit ? 500 : 2000
    this.tickets += t.lit ? 1 : 5
    this.bonus += 500
    t.lit = true
    this.events.push({ type: 'tix', i })
    if (this.tix.every((x) => x.lit) && this.tixReset < 0) {
      this.tickets += 25
      this.score += 15000
      this.tixReset = 1
      // A second chance: the ball save comes back for a while.
      this.saveTime = Math.max(this.saveTime, 12)
      this.saveUsed = false
      this.events.push({ type: 'tixAll' })
    }
  }

  private rollover(i: number) {
    if (this.skillLane >= 0 && this.skillTime > 0) {
      if (i === this.skillLane) {
        this.score += 20000
        this.events.push({ type: 'skill', points: 20000 })
      }
      this.skillLane = -1
    }
    if (this.lanes[i]) {
      this.score += 250
      this.events.push({ type: 'lane', i, lit: false })
      return
    }
    this.lanes[i] = true
    this.score += 1000
    this.bonus += 1000
    this.events.push({ type: 'lane', i, lit: true })
    if (this.lanes.every(Boolean)) {
      this.lanes = [false, false, false, false]
      if (this.multiplier < 6) this.multiplier++
      this.score += this.multiplier >= 6 ? 50000 : 10000
      this.events.push({ type: 'lanes', multiplier: this.multiplier })
    }
  }

  /** Progress on a ride; finishing it counts towards the Grand Finale. */
  private advance(ride: Ride, by: number) {
    if (this.done[ride]) return
    this.progress[ride] = Math.min(RIDE_GOALS[ride], this.progress[ride] + by)
    if (this.progress[ride] < RIDE_GOALS[ride]) return
    this.done[ride] = true
    this.score += 30000
    this.bonus += 10000
    const n = this.ridesDone
    this.events.push({ type: 'ride', ride, done: n })
    if (n === 3) {
      this.extraBalls++
      this.events.push({ type: 'extraBall' })
    }
    if (n === RIDES.length && !this.finale) {
      this.finale = true
      this.jackpot = 150000
      this.score += 250000
      this.events.push({ type: 'finale' })
      if (!this.multiball) this.startMultiball(2)
    }
  }

  // ------------------------------------------------------- end of a ball

  private lose(b: Ball) {
    const active = this.balls.filter((o) => o !== b)
    if (this.saveTime > 0 && this.inPlay) {
      // Saved: back to the shooter lane (fired by itself in multiball).
      this.balls = active
      this.events.push({ type: 'saved' })
      if (this.multiball || active.length > 0) {
        const y = PLUNGER_Y - BALL_R
        this.balls.push(newBall(LANE_X, y))
        this.autoLaunch++
      } else {
        this.saveUsed = true
        this.serve()
      }
      return
    }
    this.balls = active
    const left = active.length + this.ejectQueue
    if (left > 0) {
      if (this.multiball && left === 1 && this.ejectQueue === 0) {
        this.multiball = false
        this.events.push({ type: 'multiballEnd' })
      }
      return
    }
    this.multiball = false
    this.state = 'drain'
    this.stateTime = 0
    this.tally = { bonus: this.bonus, multiplier: this.multiplier }
    this.score += this.bonus * this.multiplier
    this.events.push({ type: 'drain' })
    this.events.push({ type: 'bonus', bonus: this.bonus, multiplier: this.multiplier })
  }

  private nextBall() {
    if (this.extraBalls > 0) {
      this.extraBalls--
      this.state = 'play'
      this.stateTime = 0
      this.startBall()
      this.events.push({ type: 'ball', n: this.ballNumber })
      return
    }
    if (this.ballNumber >= BALLS) {
      this.state = 'dead'
      this.stateTime = 0
      this.events.push({ type: 'gameover' })
      return
    }
    this.ballNumber++
    this.state = 'play'
    this.stateTime = 0
    this.startBall()
    this.events.push({ type: 'ball', n: this.ballNumber })
  }

  tipOf(f: Flipper): [number, number] {
    return flipperTip(f)
  }
}
