// Kherve Grand Prix: the sessions. Qualifying (cars leave the garages, out
// lap, flying laps, back to the garage; the best lap sets the grid) and the
// race (five red lights, laps, pit stops for tyres, the chequered flag). The
// player's car runs on the physics (f1Physics.ts) except in the pit lane,
// where it is driven for them like the AI cars, which follow the racing line
// at their pace, overtake and keep out of each other's way. Timing: sectors,
// laps, gaps from twenty timing points a lap. No three.js here.

import { ahead, barrierAt, inRange, locate, pitOffset, pointAt, sampleAt, surfaceAt, wrap, type Surface, type Track } from './f1Track.ts'
import { accelLimit, brakeLimit, CAR, CarBody, COMPOUNDS, damagePace, gearRpm, newTyres, noDamage, SERIES, setSeries, TOP_SPEED, tyreGrip, wearTyres, type CarInput, type Compound, type Damage, type Series, type Tyres } from './f1Physics.ts'

export interface Team {
  name: string
  short: string
  /** Body colour, second colour (stripes, wings), accent (numbers). */
  color: string
  color2: string
  accent: string
  /** Classics: which coupé the team races. */
  model?: ClassicModel
}

/** The classic coupés (fictional makes, shaped after the late-1960s / early-70s sports cars). */
export type ClassicModel = 'stoccarda' | 'dieppe' | 'bavaria'
export const CLASSIC_MODELS: Record<ClassicModel, { name: string; blurb: string }> = {
  stoccarda: { name: 'Stoccarda 901 RS', blurb: 'The rear-engined flat-six fastback with frog-eye headlamps and a ducktail.' },
  dieppe: { name: 'Dieppe A110', blurb: 'The tiny French blue berlinette: low, light, four round lamps up front.' },
  bavaria: { name: 'Bavaria 30 CS', blurb: 'The big touring coupé with a shark nose, wide arches and a tall rear wing.' },
}
export const CLASSIC_LIST: ClassicModel[] = ['stoccarda', 'dieppe', 'bavaria']

/** Every car of a class is balanced to the same pace: the choice is about looks and feel. */
const CLASSIC_TEAMS: Team[] = [
  { name: 'Kherve Racing', short: 'KHV', color: '#0d120f', color2: '#22c55e', accent: '#eafff1', model: 'stoccarda' },
  { name: 'Équipe Dieppe', short: 'DIE', color: '#1d4fc4', color2: '#f4f4f4', accent: '#ffffff', model: 'dieppe' },
  { name: 'Scuderia Lago', short: 'LAG', color: '#8ec5e8', color2: '#f2711c', accent: '#13213f', model: 'stoccarda' },
  { name: 'Bavaria Sport', short: 'BAV', color: '#f4f4f2', color2: '#1f5fd0', accent: '#d21f2a', model: 'bavaria' },
  { name: 'Rallye Rouge', short: 'RRG', color: '#c8201f', color2: '#f8f6ee', accent: '#111111', model: 'dieppe' },
  { name: 'Riviera Classic', short: 'RIV', color: '#e9e3d0', color2: '#0f3f2e', accent: '#c8a548', model: 'bavaria' },
]

const MODERN_TEAMS: Team[] = [
  { name: 'Kherve Racing', short: 'KHV', color: '#0d120f', color2: '#22c55e', accent: '#eafff1' },
  { name: 'Pyodide GP', short: 'PYO', color: '#1f4fd8', color2: '#ffd43b', accent: '#ffffff' },
  { name: 'Aurora Motorsport', short: 'AUR', color: '#f9731c', color2: '#13213f', accent: '#ffffff' },
  { name: 'Silverline', short: 'SLV', color: '#c3cad2', color2: '#0f9488', accent: '#0b1220' },
  { name: 'Rosso Veloce', short: 'RSV', color: '#d61f26', color2: '#f8fafc', accent: '#ffffff' },
  { name: 'Violet Works', short: 'VLW', color: '#6b2bd9', color2: '#f4c430', accent: '#ffffff' },
]

/** The teams of the series being raced (switched with setRaceSeries). */
export let TEAMS: Team[] = MODERN_TEAMS

/** Switch the series: the car physics and the teams (the player's team races `playerModel` in the classics). */
export function setRaceSeries(s: Series, playerTeam = 0) {
  setSeries(s)
  // the player's choice of car takes the first place (the player and their team mate drive it); the rest follow
  const list = teamsOf(s)
  const k = Math.max(0, Math.min(list.length - 1, playerTeam))
  TEAMS = [list[k], ...list.filter((_, i) => i !== k)]
}

/** Every team of a series, in the menu's order (the cars the player can choose from). */
export function teamsOf(s: Series): Team[] {
  return s === 'classic' ? CLASSIC_TEAMS : MODERN_TEAMS
}

export interface Driver {
  name: string
  code: string
  num: number
  team: number
  /** Pace against the profile (before the difficulty). */
  skill: number
}

/** Car 0 is the player's; car 1 is their team mate. */
export const DRIVERS: Driver[] = [
  { name: 'You', code: 'YOU', num: 7, team: 0, skill: 1 },
  { name: 'Ekin Kerherve', code: 'KER', num: 17, team: 0, skill: 0.992 },
  { name: 'Homer Slight', code: 'SLI', num: 3, team: 1, skill: 0.996 },
  { name: 'Aiko Tanaka', code: 'TAN', num: 22, team: 1, skill: 0.989 },
  { name: 'Alex Perero', code: 'PER', num: 11, team: 2, skill: 0.998 },
  { name: 'Priya Nair', code: 'NAI', num: 29, team: 2, skill: 0.99 },
  { name: 'Jonas Becker', code: 'BEC', num: 5, team: 3, skill: 0.993 },
  { name: 'Sofia Russo', code: 'RUS', num: 44, team: 3, skill: 0.985 },
  { name: 'Marco Bellini', code: 'BEL', num: 16, team: 4, skill: 1.0 },
  { name: 'Chloé Dubois', code: 'DUB', num: 8, team: 4, skill: 0.988 },
  { name: 'Kwame Mensah', code: 'MEN', num: 31, team: 5, skill: 0.991 },
  { name: 'Ana Kovač', code: 'KOV', num: 12, team: 5, skill: 0.983 },
]

export type Difficulty = 'easy' | 'medium' | 'hard'
export const DIFFICULTY: Record<Difficulty, { pace: number; name: string; mult: number }> = {
  easy: { pace: 0.905, name: 'Easy', mult: 1 },
  medium: { pace: 0.948, name: 'Medium', mult: 1.5 },
  hard: { pace: 0.985, name: 'Hard', mult: 2 },
}

export type PitState = 'none' | 'in' | 'stop' | 'out' | 'toGarage' | 'garage' | 'fromGarage'

export interface RaceCar {
  i: number
  driver: Driver
  team: number
  player: boolean
  // where it is
  x: number
  z: number
  y: number
  h: number
  speed: number
  steer: number
  wheelRot: number
  rpm: number
  gear: number
  /** Centre-line distance, lateral offset, last sample (a search hint). */
  s: number
  lat: number
  hint: number
  /** Distance since the start line at the start of the session (race: negative on the grid). */
  dist: number
  // the AI's driving
  v: number
  lane: number
  laneTarget: number
  pace: number
  lapPace: number
  /** Seconds left before it moves (the start). */
  hold: number
  // timing
  laps: number
  lapStart: number
  lapTimed: boolean
  lapValid: boolean
  lastLap: number
  bestLap: number
  sector: number
  sectorStart: number
  sectors: [number, number, number]
  bestSectors: [number, number, number]
  marks: number[]
  // tyres and stops
  tyres: Tyres
  used: Compound[]
  pit: PitState
  pitT: number
  pitLen: number
  pitPlan: number
  nextCompound: Compound
  stops: number
  // quali runs
  leaveAt: number
  runLaps: number
  runs: number
  // the end
  finished: boolean
  finishTime: number
  penalty: number
  drs: boolean
  drsZone: number
  /** Something the player hit (0..1), for the sound and the camera. */
  hit: number
  /** What is broken, and when it last got worse (for the debris). */
  damage: Damage
  surface: Surface
  /** Multiplayer: another game drives this car (a player, or the host's AI); its state comes over the network. */
  remote: boolean
  /** Multiplayer: nobody drives this car (no AI): it stays in its garage and out of the order. */
  out: boolean
}

export interface SessionOpts {
  track: Track
  /** The racing line's speed profile (warm new softs). */
  profile: Float32Array
  profileLap: number
  kind: 'qualifying' | 'race'
  laps: number
  minutes: number
  difficulty: Difficulty
  assists: boolean
  playerName: string
  /** Race: car indices in grid order. */
  grid?: number[]
  /** Race: the player's starting tyres. */
  compound?: Compound
  seed?: number
  /** A demo race behind the menu: every car (the player's too) drives itself, no lights. */
  demo?: boolean
  /** Crashes break wings and suspension (on by default). */
  damage?: boolean
  /** Multiplayer: who drives each car (by car index; null keeps the usual driver). */
  names?: ({ name: string; code: string; num: number } | null)[]
  /** Multiplayer: the cars driven elsewhere, and the cars nobody drives. */
  remote?: number[]
  out?: number[]
}

/** A blow the engine shows: debris, sparks, a bang. */
export interface Impact {
  x: number
  y: number
  z: number
  /** 0..1 */
  strength: number
  /** What broke ('' a knock that broke nothing), and whether it was a wall scrape. */
  part: '' | 'fw' | 'rw' | 'susp'
  car: number
  scrape: boolean
}

export interface SessionEvent {
  text: string
  kind: 'info' | 'good' | 'best' | 'bad' | 'flag'
  t: number
}

export interface Classified {
  car: number
  name: string
  code: string
  team: number
  num: number
  best: number
  /** Race: total time (with penalties), laps done; qualifying: the gap. */
  time: number
  laps: number
  gap: string
  penalty: number
  stops: number
  player: boolean
}

const fmtGap = (s: number) => (s >= 0 ? '+' : '') + s.toFixed(3)
export const fmtLap = (s: number) => (isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}` : '—')

const MARKS = 20

function rng(seed: number) {
  let a = seed >>> 0 || 1
  return () => {
    a ^= a << 13
    a ^= a >>> 17
    a ^= a << 5
    return ((a >>> 0) % 1e6) / 1e6
  }
}

/** A driver's three-letter code from their name. */
export const codeOf = (name: string) => name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X')

export class Session {
  readonly t: Track
  readonly kind: 'qualifying' | 'race'
  readonly laps: number
  readonly duration: number
  readonly cars: RaceCar[] = []
  readonly player: RaceCar
  readonly body = new CarBody()
  readonly opts: SessionOpts
  private readonly profile: Float32Array
  private readonly rand: () => number
  private readonly diff: number

  /** Session clock (race: from lights out; before that negative). */
  time = 0
  phase: 'lights' | 'green' | 'chequered' | 'done' = 'green'
  /** Race start: red lights lit (0..5), and when they go out. */
  lights = 0
  private lightsT = 0
  private outAt = 0
  private jumped = false
  private gridLat = new Map<number, number>()
  /** Qualifying: the flag has fallen, the lap in progress may finish. */
  overtime = false
  doneAt = 0
  events: SessionEvent[] = []
  bestLap = { car: -1, time: Infinity }
  bestSectors: [number, number, number] = [Infinity, Infinity, Infinity]
  input: CarInput & { analog: boolean } = { throttle: 0, brake: 0, steer: 0, analog: false }
  boxRequest = false
  drsOpen = false
  /** The player's chosen tyres for the next stop. */
  compound: Compound = 'soft'
  readonly mustChange: boolean
  /** The race length the tyres are made for (qualifying: soft ones last about six laps). */
  private readonly wearLaps: number

  constructor(o: SessionOpts) {
    this.opts = o
    this.t = o.track
    this.kind = o.kind
    this.laps = o.laps
    this.duration = o.minutes * 60
    this.profile = o.profile
    this.rand = rng(o.seed ?? Date.now())
    this.diff = DIFFICULTY[o.difficulty].pace
    this.mustChange = o.kind === 'race' && o.laps >= 3
    this.wearLaps = o.kind === 'qualifying' ? 10 : Math.max(o.laps, 5)
    for (let i = 0; i < DRIVERS.length; i++) {
      const named = o.names?.[i]
      const d = named ? { ...DRIVERS[i], ...named } : i === 0 ? { ...DRIVERS[0], name: o.playerName || 'You', code: codeOf(o.playerName || 'YOU') } : DRIVERS[i]
      this.cars.push(this.makeCar(i, d))
    }
    this.player = this.cars[0]
    for (const i of o.remote ?? []) if (i > 0 && this.cars[i]) this.cars[i].remote = true
    for (const i of o.out ?? []) if (i > 0 && this.cars[i]) this.cars[i].out = true
    if (o.kind === 'qualifying') this.setupQuali()
    else this.setupRace((o.grid ?? this.cars.map((c) => c.i)).filter((i) => !this.cars[i].out), o.compound ?? 'medium')
    // the cars nobody drives wait in their garages
    for (const c of this.cars)
      if (c.out) {
        c.pit = 'garage'
        c.s = this.garageS(c)
        c.lat = this.t.pit.side * (this.t.pit.garageOff + 3.5)
        c.dist = c.s - this.t.len
        c.leaveAt = Infinity
        this.poseKinematic(c, 0)
      }
  }

  private makeCar(i: number, d: Driver): RaceCar {
    const pace = d.skill * this.diff * (1 + (this.rand() - 0.5) * 0.004)
    return {
      i, driver: d, team: d.team, player: i === 0,
      x: 0, z: 0, y: 0, h: 0, speed: 0, steer: 0, wheelRot: 0, rpm: 4000, gear: 1,
      s: 0, lat: 0, hint: -1, dist: 0,
      v: 0, lane: 0, laneTarget: 0, pace, lapPace: pace, hold: 0,
      laps: 0, lapStart: 0, lapTimed: false, lapValid: true, lastLap: 0, bestLap: Infinity,
      sector: 0, sectorStart: 0, sectors: [0, 0, 0], bestSectors: [Infinity, Infinity, Infinity], marks: [],
      tyres: newTyres('soft', true), used: [], pit: 'none', pitT: 0, pitLen: 2.5, pitPlan: -1, nextCompound: 'medium', stops: 0,
      leaveAt: 0, runLaps: 0, runs: 0,
      finished: false, finishTime: 0, penalty: 0, drs: false, drsZone: -1, hit: 0, damage: noDamage(), surface: 'asphalt',
      remote: false, out: false,
    }
  }

  // ---------------------------------------------------------------- set-up

  private boxS(c: RaceCar) {
    return this.t.pit.boxes[c.team]
  }
  private garageS(c: RaceCar) {
    const mate = this.cars.findIndex((o) => o.team === c.team)
    return this.boxS(c) + (mate === c.i ? -3.6 : 3.6)
  }

  private setupQuali() {
    const order = this.cars.map((c) => c.i).sort(() => this.rand() - 0.5)
    for (const c of this.cars) {
      c.pit = 'garage'
      c.s = this.garageS(c)
      c.lat = this.t.pit.side * (this.t.pit.garageOff + 3.5)
      c.tyres = newTyres('soft', true)
      c.nextCompound = 'soft'
      c.leaveAt = c.player ? Infinity : 6 + order.indexOf(c.i) * 7 + this.rand() * 4
      // distances count from the start line: the garages are just before it
      c.dist = c.s > this.t.len / 2 ? c.s - this.t.len : c.s
      this.poseKinematic(c, 0)
    }
    this.phase = 'green'
    this.event('Qualifying: set your fastest lap. Choose tyres (1 · 2 · 3), then throttle to leave the garage.', 'info')
  }

  private setupRace(grid: number[], compound: Compound) {
    const t = this.t
    const lineSide = Math.sign(sampleAt(t, t.line, 60)) || 1
    grid.forEach((ci, k) => {
      const c = this.cars[ci]
      const s = -14 - k * 8
      const lat = (k % 2 === 0 ? lineSide : -lineSide) * 2.7
      this.gridLat.set(ci, lat)
      c.pit = 'none'
      c.s = wrap(s, t.len)
      c.dist = s
      c.lat = lat
      c.lane = lat - sampleAt(t, t.line, s)
      c.laneTarget = c.lane
      c.v = 0
      c.hold = Infinity
      c.lapStart = 0
      c.lapTimed = true
      c.marks = []
      if (c.player) {
        c.tyres = newTyres(compound, true)
      } else {
        const start: Compound = this.laps <= 3 ? 'soft' : this.rand() < 0.55 ? 'medium' : 'soft'
        c.tyres = newTyres(start, true)
        // stops spread over the race; a car boxes at the end of lap pitPlan + 1 (the pit lane is just before the line),
        // so the last chance is the end of the second-last lap
        c.pitPlan = this.laps >= 2 ? Math.max(0, Math.min(this.laps - 2, Math.round(this.laps * (start === 'soft' ? 0.38 : 0.55) + (this.rand() - 0.5) * Math.max(2, this.laps * 0.45)))) : -1
        c.nextCompound = start === 'soft' ? (this.rand() < 0.6 ? 'medium' : 'hard') : this.rand() < 0.6 ? 'hard' : 'soft'
      }
      c.used = [c.tyres.compound]
      this.poseKinematic(c, 0)
    })
    const p = this.player
    this.body.place(p.x, p.z, p.h, 0)
    this.body.y = p.y
    this.x0 = p.x
    this.z0 = p.z
    this.compound = p.tyres.compound === 'soft' ? 'medium' : p.tyres.compound === 'medium' ? 'hard' : 'medium'
    this.phase = 'lights'
    this.time = 0
    this.lightsT = 0
    if (this.opts.demo) {
      this.phase = 'green'
      // everyone stops once in the first laps, to show the pit crews at work
      for (const c of this.cars) {
        c.hold = 0.2 + this.rand() * 0.6
        c.pitPlan = 1 + (c.i % 3)
      }
      return
    }
    this.event(`Race: ${this.laps} lap${this.laps > 1 ? 's' : ''}. Watch the lights.${this.mustChange ? ' Use two tyre compounds (one pit stop) or take 10 s.' : ''}`, 'info')
  }

  event(text: string, kind: SessionEvent['kind'] = 'info') {
    this.events.push({ text, kind, t: this.time })
    if (this.events.length > 30) this.events.shift()
  }

  // ---------------------------------------------------------------- the clock

  step(dt: number) {
    dt = Math.min(dt, 1 / 20)
    if (this.impacts.length > 60) this.impacts.splice(0, this.impacts.length - 60)
    if (this.phase === 'done') {
      this.time += dt
      this.moveAll(dt)
      return
    }
    if (this.phase === 'lights') {
      this.lightsT += dt
      const lit = Math.min(5, Math.floor(this.lightsT - 0.6))
      if (lit > this.lights && lit >= 1) this.lights = lit
      if (this.lights === 5 && !this.outAt) this.outAt = this.lightsT + 0.6 + this.rand() * 1.9
      // the player can move (and jump the start)
      this.drivePlayer(dt)
      const moved = Math.hypot(this.body.x - this.x0, this.body.z - this.z0)
      if (!this.jumped && moved > 0.6) {
        this.jumped = true
        this.player.penalty += 5
        this.event('Jump start: 5 s penalty', 'bad')
      }
      if (this.outAt && this.lightsT >= this.outAt) {
        this.lights = 0
        this.phase = 'green'
        this.time = 0
        for (const c of this.cars) if (!c.player) c.hold = 0.18 + this.rand() * 0.3 + (1 - c.pace) * 3
        this.event('Lights out — go!', 'flag')
      }
      return
    }
    this.time += dt
    this.moveAll(dt)
    if (this.kind === 'qualifying') this.qualiClock()
    else this.raceClock()
  }

  private moveAll(dt: number) {
    const demo = !!this.opts.demo
    for (const c of this.cars) {
      if ((c.player && !demo) || c.remote || c.out) continue
      if (c.pit !== 'none') this.pitMove(c, dt)
      else this.aiDrive(c, dt)
    }
    const p = this.player
    if (!demo) {
      if (p.pit !== 'none') this.pitMove(p, dt)
      else this.drivePlayer(dt)
    }
    this.collide()
    for (const c of this.cars) this.timing(c)
  }

  private qualiClock() {
    if (!this.overtime && this.time >= this.duration) {
      this.overtime = true
      this.event('Chequered flag: finish the lap you are on', 'flag')
    }
    if (this.overtime && this.phase !== 'done') {
      const p = this.player
      const flying = p.pit === 'none' && p.lapTimed && p.lapStart < this.duration
      if (!flying) this.finishQuali()
    }
  }

  /** End qualifying now: laps in progress are estimated, cars without a time get one. */
  finishQuali() {
    if (this.phase === 'done') return
    for (const c of this.cars) {
      if (c.player) continue
      const onLap = c.pit === 'none' && c.lapTimed && c.lapValid
      if (onLap) {
        const done = c.dist - c.laps * this.t.len
        const elapsed = this.time - c.lapStart
        if (done > this.t.len * 0.3) {
          const est = elapsed + (this.t.len - done) / Math.max(30, this.t.len / (this.opts.profileLap / c.pace))
          c.bestLap = Math.min(c.bestLap, est)
        }
      }
      if (!isFinite(c.bestLap)) c.bestLap = this.simLap(c)
    }
    for (const c of this.cars) if (c.bestLap < this.bestLap.time) this.bestLap = { car: c.i, time: c.bestLap }
    this.phase = 'done'
    this.doneAt = this.time
  }

  private simLap(c: RaceCar) {
    return (this.opts.profileLap / c.pace) * (1 + (this.rand() - 0.3) * 0.006)
  }

  private raceClock() {
    const leader = this.order()[0]
    if (this.phase === 'green' && leader.dist >= this.laps * this.t.len) {
      this.phase = 'chequered'
      this.event('Chequered flag!', 'flag')
    }
    // the demo never ends (it is given thousands of laps)
    if (this.opts.demo) return
    if (this.player.finished && this.phase !== 'done' && this.time - this.player.finishTime > 3.5) {
      this.phase = 'done'
      this.doneAt = this.time
    }
  }

  // ---------------------------------------------------------------- the player

  private x0 = 0
  private z0 = 0

  private drivePlayer(dt: number) {
    const p = this.player
    const t = this.t
    const b = this.body
    const near = locate(t, b.x, b.z, p.hint)
    p.hint = near.i
    const surf = surfaceAt(t, near.i, near.d)
    p.surface = surf
    const gripSurf = surf === 'asphalt' ? 1 : surf === 'kerb' ? 0.93 : surf === 'grass' ? 0.55 : 0.42
    // gravel slows a fast car hard but lets a slow one drive out
    const drag = surf === 'grass' ? 0.1 : surf === 'gravel' ? 0.06 + 0.5 * Math.min(1, b.speed / 22) : 0
    const inp = { ...this.input }
    // the race start: the car stands still until the lights go out, unless the player goes (a jump start)
    const parked = this.phase === 'lights' && inp.throttle < 0.05 && b.speed < 0.3
    if (p.finished) {
      inp.throttle = Math.min(inp.throttle, 0.35)
    }
    const zone = this.drsZoneOf(near.s)
    // DRS: allowed or not is decided as the car enters each zone (within a second of the car ahead in the race)
    const zi = t.drs.findIndex((z) => inRange(near.s, z[0], z[1], t.len))
    if (zi !== p.drsZone) {
      p.drsZone = zi
      p.drs = zi >= 0 && this.drsAllowed(p)
    }
    const drsOk = this.drsOpen && p.drs && inRange(near.s, zone[0], zone[1], t.len)
    if (this.drsOpen && (inp.brake > 0.1 || !drsOk)) this.drsOpen = false
    if (!parked) b.step(dt, inp, { grip: tyreGrip(p.tyres) * gripSurf, drag, assists: this.opts.assists, analog: this.input.analog, drs: this.drsOpen, damage: p.damage })
    // the barriers
    const after = locate(t, b.x, b.z, near.i)
    const lim = barrierAt(t, after.s)
    const half = 1.0
    let hit = 0
    if (after.d > lim.r - half || after.d < -(lim.l - half)) {
      const side = after.d > 0 ? 1 : -1
      const max = (side > 0 ? lim.r : lim.l) - half
      const push = Math.abs(after.d) - max
      const nx = t.nx[after.i] * side
      const nz = t.nz[after.i] * side
      b.x -= nx * push
      b.z -= nz * push
      const ch = Math.cos(b.h)
      const sh = Math.sin(b.h)
      let wx = b.vx * ch - b.vy * sh
      let wz = b.vx * sh + b.vy * ch
      const vn = wx * nx + wz * nz
      // sliding along the wall throws sparks
      if (b.speed > 12 && Math.random() < 0.5) this.impacts.push({ x: b.x + nx * 0.9, y: b.y + 0.2, z: b.z + nz * 0.9, strength: 0.2, part: '', car: 0, scrape: true })
      if (vn > 0) {
        hit = Math.min(1, vn / 25)
        // which end met the wall: the nose, the tail, or a wheel (the suspension)
        const fwd = nx * ch + nz * sh
        const right = -nx * sh + nz * ch
        const part = fwd > 0.55 ? 'fw' : fwd < -0.55 ? 'rw' : 'susp'
        this.hurt(p, part, (vn - (part === 'susp' ? 9 : 7)) / (part === 'susp' ? 26 : 20), Math.sign(right) || 1, b.x + nx, b.y + 0.4, b.z + nz)
        wx -= vn * nx * 1.35
        wz -= vn * nz * 1.35
        const keep = 1 - Math.min(0.6, vn / 40)
        wx *= keep
        wz *= keep
        b.vx = wx * ch + wz * sh
        b.vy = -wx * sh + wz * ch
        b.r *= 0.4
      }
    }
    p.hit = Math.max(p.hit * Math.exp(-dt * 4), hit)
    // where it is now
    const q = locate(t, b.x, b.z, after.i)
    p.hint = q.i
    let dS = q.s - p.s
    if (dS > t.len / 2) dS -= t.len
    if (dS < -t.len / 2) dS += t.len
    p.dist += dS
    p.s = q.s
    p.lat = q.d
    b.y = q.y
    p.x = b.x
    p.z = b.z
    p.y = q.y
    p.h = b.h
    p.speed = b.speed
    p.steer = b.steer
    p.wheelRot = b.wheelRot
    p.rpm = b.rpm
    p.gear = b.gear
    if (this.phase !== 'lights') wearTyres(p.tyres, Math.abs(b.vx) * dt, b.usage, dt, t.len, this.wearLaps)
    // track limits (qualifying): all four wheels off
    if (q.dist > t.width / 2 + 2.6 && p.lapTimed && p.lapValid && this.kind === 'qualifying' && (surf === 'grass' || surf === 'gravel')) {
      p.lapValid = false
      this.event('Track limits: lap deleted', 'bad')
    }
    // into the pit lane: asked for (P), or driven into it
    const pit = t.pit
    const hw = t.width / 2
    const wantsIn = this.boxRequest && inRange(q.s, pit.entry - 25, pit.entry + 40, t.len) && q.d * pit.side > -hw
    const drivesIn = inRange(q.s, pit.entry, pit.entryFull, t.len) && q.d * pit.side > hw + 0.6
    if ((wantsIn || drivesIn) && this.phase !== 'lights' && !p.finished && this.phase !== 'done') {
      p.pit = 'in'
      p.v = Math.max(0, b.vx)
      p.lane = 0
      p.nextCompound = this.compound
      this.boxRequest = false
      this.drsOpen = false
      this.event('Pit lane: the limiter is on', 'info')
    }
  }

  private drsZoneOf(s: number): [number, number] {
    for (const z of this.t.drs) if (inRange(s, z[0], z[1], this.t.len)) return z
    return [0, 0]
  }

  // ---------------------------------------------------------------- the AI

  private aiDrive(c: RaceCar, dt: number) {
    const t = this.t
    const hw = t.width / 2
    if (c.hold > 0) {
      c.hold -= dt
      c.speed = 0
      this.poseKinematic(c, dt)
      return
    }
    const look = c.s + Math.max(2, c.v * 0.12)
    let vt = sampleAt(t, this.profile, look) * c.lapPace * Math.sqrt(tyreGrip(c.tyres)) * damagePace(c.damage)
    // quali out laps and in laps are slower
    if (this.kind === 'qualifying' && (!c.lapTimed || c.runLaps >= 3)) vt *= 0.8
    if (c.finished || (this.kind === 'qualifying' && this.overtime && !c.lapTimed)) vt *= 0.72
    // DRS: a little more on the straight
    const zone = this.t.drs.findIndex((z) => inRange(c.s, z[0], z[1], t.len))
    if (zone !== c.drsZone) {
      c.drsZone = zone
      c.drs = zone >= 0 && this.drsAllowed(c)
    }
    if (c.drs && zone >= 0) vt = Math.min(vt * 1.05, TOP_SPEED * 1.05)
    // off the line in a corner: slower
    const kHere = Math.abs(sampleAt(t, t.lineK, c.s))
    vt *= 1 - Math.min(0.06, Math.abs(c.lane) * kHere * 2.2)

    // traffic
    const lineHere = sampleAt(t, t.line, c.s)
    let blocked = false
    let clearAhead = true
    for (const o of this.cars) {
      if (o === c || o.pit !== 'none' || (o.player && this.phase === 'lights')) continue
      const gap = ahead(c.s, o.s, t.len)
      const dLat = o.lat - c.lat
      if (gap < 70 && Math.abs(dLat) < 3.2) clearAhead = false
      if (gap > 50 || gap < 0.5) continue
      if (Math.abs(dLat) > 2.3) continue
      const closing = c.v - o.speed
      if (gap < 7 + Math.max(0, closing) * 1.3) {
        // go round it if there is room on one side
        const sides = dLat > 0 ? [-1, 1] : [1, -1]
        let moved = false
        for (const sd of sides) {
          const want = o.lat + sd * 3.1
          if (Math.abs(want) > hw - 1.1) continue
          if (this.sideBusy(c, want)) continue
          c.laneTarget = want - lineHere
          moved = true
          break
        }
        if (!moved || gap < 5) {
          blocked = true
          vt = Math.min(vt, o.speed - (gap < 4 ? 3 : 0.5))
        }
      }
    }
    if (clearAhead && !this.sideBusy(c, lineHere)) c.laneTarget *= Math.exp(-dt * 0.8)
    // going to pit: drift over to the pit side first
    const p = t.pit
    if (this.wantsPit(c) && inRange(c.s, p.entry - 260, p.entry + 2, t.len)) c.laneTarget = p.side * (hw - 1.4) - lineHere
    const dl = c.laneTarget - c.lane
    c.lane += Math.sign(dl) * Math.min(Math.abs(dl), (blocked ? 2.6 : 1.8) * dt)

    const acc = accelLimit(c.v, tyreGrip(c.tyres)) * (0.92 + c.pace * 0.08)
    const brk = brakeLimit(c.v, tyreGrip(c.tyres))
    const dv = vt - c.v
    c.v = Math.max(0, c.v + (dv > 0 ? Math.min(dv, Math.max(0.5, acc) * dt) : Math.max(dv, -brk * 1.1 * dt)))
    const scale = sampleAt(t, t.lineScale, c.s) || 1
    const adv = (c.v * dt) / scale
    c.s = wrap(c.s + adv, t.len)
    c.dist += adv
    c.lat = Math.max(-(hw - 0.9), Math.min(hw - 0.9, sampleAt(t, t.line, c.s) + c.lane))
    c.speed = c.v
    wearTyres(c.tyres, c.v * dt, 0.75, dt, t.len, this.wearLaps)
    // into the pits
    if (this.wantsPit(c) && inRange(c.s, p.entry - 1, p.entry + 25, t.len)) {
      c.pit = 'in'
      c.pitLen = 2.2 + this.rand() * 0.9
    }
    this.poseKinematic(c, dt)
  }

  private wantsPit(c: RaceCar): boolean {
    if (c.finished || this.phase === 'done') return false
    if (this.kind === 'qualifying') return c.runLaps >= 3 || (this.overtime && !c.lapTimed)
    if (this.phase === 'chequered') return false
    // a broken car comes in for repairs
    if ((c.damage.fw > 0.35 || c.damage.rw > 0.35 || c.damage.susp > 0.5) && c.laps < this.laps - 1) return true
    return (c.laps === c.pitPlan && c.stops === 0) || (c.tyres.wear > 1.25 && c.laps < this.laps - 1)
  }

  private drsAllowed(c: RaceCar): boolean {
    // the classics had no such thing
    if (SERIES === 'classic') return false
    if (this.kind === 'qualifying') return true
    if (this.phase !== 'green' || c.laps < 1) return false
    const ord = this.order()
    const k = ord.indexOf(c)
    if (k <= 0) return false
    const front = ord[k - 1]
    const m = Math.floor(c.dist / (this.t.len / MARKS))
    if (m < 0 || front.marks[m] === undefined || c.marks[m] === undefined) return false
    return c.marks[m] - front.marks[m] < 1.0
  }

  /** Is there a car alongside c at lateral position `lat`? */
  private sideBusy(c: RaceCar, lat: number): boolean {
    for (const o of this.cars) {
      if (o === c || o.pit !== 'none') continue
      const g = ahead(c.s, o.s, this.t.len)
      const near = g < 9 || g > this.t.len - 7
      if (!near) continue
      if (Math.abs(o.lat - lat) < 2.4 && Math.sign(o.lat - c.lat) === Math.sign(lat - c.lat)) return true
    }
    return false
  }

  // ---------------------------------------------------------------- the pit lane

  private pitMove(c: RaceCar, dt: number) {
    const t = this.t
    const p = t.pit
    const box = c.pit === 'toGarage' || c.pit === 'garage' || c.pit === 'fromGarage' ? this.garageS(c) : this.boxS(c)
    if (c.pit === 'garage') {
      c.v = 0
      c.speed = 0
      c.s = box
      c.lat = p.side * (p.garageOff + 3.5)
      if (!c.player && this.time >= c.leaveAt && (!this.overtime || false)) this.leaveGarage(c)
      this.poseKinematic(c, dt)
      return
    }
    if (c.pit === 'toGarage' || c.pit === 'fromGarage') {
      c.pitT += dt
      const f = Math.min(1, c.pitT / 2.6)
      const e = f * f * (3 - 2 * f)
      const a = p.side * p.boxOff
      const g = p.side * (p.garageOff + 3.5)
      c.lat = c.pit === 'toGarage' ? a + (g - a) * e : g + (a - g) * e
      c.s = box
      c.speed = 0
      c.v = 0
      if (f >= 1) {
        if (c.pit === 'toGarage') {
          c.pit = 'garage'
          // the mechanics mend whatever was broken
          c.damage = noDamage()
          c.tyres = newTyres(c.player ? this.compound : 'soft', true)
          if (!c.player) {
            c.runs++
            c.leaveAt = this.time + 25 + this.rand() * 25
            if (this.time + 25 + (this.opts.profileLap / c.pace) * 2.2 > this.duration) c.leaveAt = Infinity
          }
        } else {
          c.pit = 'out'
          c.pitT = 0
        }
      }
      this.poseKinematic(c, dt, c.pit === 'toGarage' || c.pit === 'garage' ? Math.PI : 0)
      return
    }
    if (c.pit === 'stop') {
      c.pitT += dt
      c.v = 0
      c.speed = 0
      c.lat = p.side * p.boxOff
      if (c.pitT >= c.pitLen) {
        const d = c.damage
        if (c.player && (d.fw > 0.05 || d.rw > 0.05 || d.susp > 0.1)) this.event(`Repaired: ${[d.fw > 0.05 ? 'new front wing' : '', d.rw > 0.05 ? 'new rear wing' : '', d.susp > 0.1 ? 'suspension' : ''].filter(Boolean).join(', ')}`, 'good')
        c.damage = noDamage()
        const old = c.tyres.compound
        c.tyres = newTyres(c.player ? this.compound : c.nextCompound, true)
        if (!c.used.includes(c.tyres.compound)) c.used.push(c.tyres.compound)
        c.stops++
        c.pit = 'out'
        if (c.player) this.event(`${c.pitLen.toFixed(1)} s stop: ${COMPOUNDS[old].name} → ${COMPOUNDS[c.tyres.compound].name}`, 'good')
      }
      this.poseKinematic(c, dt)
      return
    }
    // driving down the lane: 'in' to the box, 'out' to the exit
    const stopping = c.pit === 'in'
    const toBox = ahead(c.s, box, t.len)
    let vt: number
    if (stopping) {
      const toLimit = ahead(c.s, p.limitIn, t.len)
      const inZone = inRange(c.s, p.limitIn, p.limitOut, t.len)
      vt = inZone ? p.limit : Math.min(TOP_SPEED, Math.sqrt(p.limit * p.limit + 2 * 16 * toLimit))
      if (toBox < 60 && toBox < t.len / 2) vt = Math.min(vt, Math.sqrt(2 * 7 * Math.max(0, toBox - 0.2)) + 0.3)
    } else {
      vt = inRange(c.s, p.limitIn, p.limitOut, t.len) ? p.limit : TOP_SPEED * 0.9
    }
    const acc = c.v < vt ? Math.max(1, accelLimit(c.v, 1)) * 0.9 : -30
    c.v = c.v < vt ? Math.min(vt, c.v + acc * dt) : Math.max(vt, c.v + acc * dt)
    const adv = c.v * dt
    c.s = wrap(c.s + adv, t.len)
    c.dist += adv
    // sideways: into the lane, to the box, and back out to the track
    let target = pitOffset(t, c.s)
    if (stopping && toBox < 40) target = p.side * (p.laneOff + (p.boxOff - p.laneOff) * Math.min(1, (40 - toBox) / 25))
    if (!stopping && c.pitT < 1.6 && ahead(box, c.s, t.len) < 30) target = p.side * (p.boxOff + (p.laneOff - p.boxOff) * Math.min(1, ahead(box, c.s, t.len) / 25))
    if (!stopping) c.pitT += dt
    const rate = 5 * dt
    c.lat += Math.max(-rate, Math.min(rate, target - c.lat))
    c.speed = c.v
    if (stopping && toBox < 0.35) {
      c.v = 0
      c.speed = 0
      c.s = box
      c.pitT = 0
      if (this.kind === 'qualifying') c.pit = 'toGarage'
      else {
        c.pit = 'stop'
        c.pitLen = (c.player ? 2.3 + this.rand() * 0.5 : c.pitLen) + this.repairTime(c)
      }
      // a quali lap ends in the pits
      c.lapTimed = false
    }
    // out of the lane
    if (!stopping && inRange(c.s, p.exit - 2, p.exit + 30, t.len)) {
      c.pit = 'none'
      c.lane = c.lat - sampleAt(t, t.line, c.s)
      c.laneTarget = 0
      c.runLaps = 0
      if (c.player) {
        const pt = pointAt(t, c.s, c.lat)
        this.body.place(pt.x, pt.z, Math.atan2(pt.tz, pt.tx), c.v)
        this.body.gear = 3
        c.hint = locate(t, pt.x, pt.z).i
        this.event('Back on track', 'info')
      }
    }
    this.poseKinematic(c, dt)
  }

  /** Leave the garage (qualifying). */
  leaveGarage(c: RaceCar) {
    if (c.pit !== 'garage') return
    if (this.overtime) return
    if (c.player) c.tyres = newTyres(this.compound, true)
    if (!c.used.includes(c.tyres.compound)) c.used.push(c.tyres.compound)
    c.pit = 'fromGarage'
    c.pitT = 0
    c.lapTimed = false
    if (c.player) this.event('Out of the garage: an out lap, then push!', 'info')
  }

  // ---------------------------------------------------------------- poses

  private poseKinematic(c: RaceCar, dt: number, turn = 0) {
    const t = this.t
    const pt = pointAt(t, c.s, c.lat)
    const pt2 = pointAt(t, c.s + 1.5, c.lat + (c.pit === 'none' ? (c.laneTarget - c.lane) * 0.05 : 0))
    let h = Math.atan2(pt2.z - pt.z, pt2.x - pt.x) + turn
    if (c.pit === 'none' && dt > 0) {
      // the nose points along its path
      const nx = pt.x - c.x
      const nz = pt.z - c.z
      if (nx * nx + nz * nz > 0.0004) h = Math.atan2(nz, nx)
    }
    if (c.pit === 'garage' || c.pit === 'toGarage') h = Math.atan2(pt.tz, pt.tx)
    if (c.pit === 'fromGarage') h = Math.atan2(pt.tz, pt.tx)
    const prevH = c.h
    c.x = pt.x
    c.z = pt.z
    c.y = pt.y
    let dh = h - prevH
    while (dh > Math.PI) dh -= Math.PI * 2
    while (dh < -Math.PI) dh += Math.PI * 2
    c.h = dt > 0 ? prevH + dh * Math.min(1, dt * 14) : h
    c.steer = dt > 0 ? Math.max(-0.3, Math.min(0.3, (dh / Math.max(dt, 1e-3)) * 0.06)) : 0
    c.wheelRot += (c.speed / CAR.wheelR) * dt
    // revs for the sound
    const gr = gearRpm(c.speed, c.gear || 1)
    c.gear = gr.gear
    c.rpm = gr.rpm
  }

  // ---------------------------------------------------------------- contact

  private collide() {
    const p = this.player
    if (p.pit !== 'none' || this.opts.demo) return
    const b = this.body
    const pc = [
      [b.x + Math.cos(b.h) * 1.5, b.z + Math.sin(b.h) * 1.5],
      [b.x - Math.cos(b.h) * 1.4, b.z - Math.sin(b.h) * 1.4],
    ]
    for (const o of this.cars) {
      if (o.player || o.pit !== 'none') continue
      const dx0 = o.x - b.x
      const dz0 = o.z - b.z
      if (dx0 * dx0 + dz0 * dz0 > 49) continue
      const oc = [
        [o.x + Math.cos(o.h) * 1.5, o.z + Math.sin(o.h) * 1.5],
        [o.x - Math.cos(o.h) * 1.4, o.z - Math.sin(o.h) * 1.4],
      ]
      let best = Infinity
      let nx = 0
      let nz = 0
      let mine = 0
      let theirs = 0
      for (let ia = 0; ia < 2; ia++) {
        const a = pc[ia]
        for (let ib = 0; ib < 2; ib++) {
          const q = oc[ib]
          const dx = a[0] - q[0]
          const dz = a[1] - q[1]
          const d = Math.hypot(dx, dz)
          if (d < best) {
            best = d
            mine = ia
            theirs = ib
            nx = d > 1e-4 ? dx / d : 1
            nz = d > 1e-4 ? dz / d : 0
          }
        }
      }
      const R = 2.05
      if (best >= R) continue
      const push = R - best
      b.x += nx * push * 0.7
      b.z += nz * push * 0.7
      // the other car is shoved a little sideways
      const side = nx * this.t.nx[p.hint] + nz * this.t.nz[p.hint]
      o.lane -= side * push * 0.3
      const ch = Math.cos(b.h)
      const sh = Math.sin(b.h)
      let wx = b.vx * ch - b.vy * sh
      let wz = b.vx * sh + b.vy * ch
      const ox = Math.cos(o.h) * o.speed
      const oz = Math.sin(o.h) * o.speed
      const rel = (wx - ox) * nx + (wz - oz) * nz
      if (rel < 0) {
        // the player's car and the other one share the blow
        wx -= rel * nx * 1.1
        wz -= rel * nz * 1.1
        b.vx = wx * ch + wz * sh
        b.vy = -wx * sh + wz * ch
        b.r += (Math.random() - 0.5) * Math.min(1.5, -rel * 0.08)
        o.v = Math.max(0, o.v + rel * 0.35 * Math.sign(ahead(p.s, o.s, this.t.len) < this.t.len / 2 ? -1 : 1))
        p.hit = Math.max(p.hit, Math.min(1, -rel / 15))
        // the ends that touched take the blow: front wing (front circle) or rear wing (rear circle), on both cars
        const amount = (-rel - 4) / 14
        const cx = (b.x + o.x) / 2
        const cz = (b.z + o.z) / 2
        this.hurt(p, mine === 0 ? 'fw' : 'rw', amount, 1, cx, b.y + 0.4, cz)
        this.hurt(o, theirs === 0 ? 'fw' : 'rw', amount * 0.9, 1, cx, b.y + 0.4, cz)
      }
    }
    // AI cars side by side nudge apart
    for (let i = 1; i < this.cars.length; i++) {
      const a = this.cars[i]
      if (a.pit !== 'none') continue
      for (let j = i + 1; j < this.cars.length; j++) {
        const c = this.cars[j]
        if (c.pit !== 'none') continue
        const g = ahead(a.s, c.s, this.t.len)
        const gap = g > this.t.len / 2 ? g - this.t.len : g
        if (Math.abs(gap) > 5.2 || Math.abs(a.lat - c.lat) > 1.9) continue
        const sd = a.lat < c.lat ? -1 : 1
        a.lane += sd * 0.04
        c.lane -= sd * 0.04
        if (gap > 0) a.v = Math.min(a.v, c.v)
        else c.v = Math.min(c.v, a.v)
      }
    }
  }

  // ---------------------------------------------------------------- timing

  private timing(c: RaceCar) {
    const t = this.t
    const L = t.len
    if (this.phase === 'lights') return
    const step = L / MARKS
    const m = Math.floor(c.dist / step)
    if (m >= 0) for (let k = c.marks.length; k <= m; k++) c.marks[k] = this.time
    const lapNow = Math.max(0, Math.floor(c.dist / L))
    const rel = c.dist - lapNow * L
    const sector = c.dist < 0 ? 0 : rel < t.sectors[0] ? 0 : rel < t.sectors[1] ? 1 : 2
    // when exactly a line was crossed this step (the car went past it by `over` metres)
    const at = (line: number) => this.time - Math.max(0, c.dist - line) / Math.max(2, c.speed)
    if (lapNow > c.laps && c.dist >= L * (c.laps + 1)) {
      // a lap
      const now = at(L * lapNow)
      const lapTime = now - c.lapStart
      if (c.lapTimed) c.sectors[2] = now - c.sectorStart
      this.sectorDone(c, 2)
      const counts = c.lapTimed && (c.lapValid || this.kind === 'race')
      c.laps = lapNow
      if (counts) {
        c.lastLap = lapTime
        const pb = lapTime < c.bestLap
        if (pb) c.bestLap = lapTime
        const overall = lapTime < this.bestLap.time
        if (overall) this.bestLap = { car: c.i, time: lapTime }
        if (c.player) {
          if (overall) this.event(`Fastest lap ${fmtLap(lapTime)}`, 'best')
          else if (pb) this.event(`Personal best ${fmtLap(lapTime)}`, 'good')
          else this.event(`Lap ${fmtLap(lapTime)}`, 'info')
        }
      } else if (c.player && c.lapTimed && !c.lapValid) this.event('Lap deleted (track limits)', 'bad')
      c.lapStart = now
      c.sectorStart = now
      c.sector = 0
      c.lapTimed = c.pit === 'none' && !(this.kind === 'qualifying' && this.overtime)
      c.lapValid = true
      if (this.kind === 'qualifying' && !c.player && c.pit === 'none') c.runLaps++
      if (this.kind === 'race') {
        if (c.laps >= this.laps && this.phase === 'green') {
          this.phase = 'chequered'
          this.event('Chequered flag!', 'flag')
        }
        if (this.phase === 'chequered' && !c.finished && !this.opts.demo) {
          c.finished = true
          c.finishTime = now
          if (c.player) {
            const pos = this.order().indexOf(c) + 1
            this.event(`Finished P${pos}!`, 'flag')
          }
        } else if (c.player && !c.finished) {
          const left = this.laps - c.laps
          if (left === 1) this.event('Final lap!', 'flag')
          else if (left > 1) this.event(`Lap ${c.laps + 1} of ${this.laps}`, 'info')
        }
      }
      return
    }
    if (sector !== c.sector && c.dist >= 0) {
      const now = at(lapNow * L + t.sectors[Math.max(0, sector - 1)])
      if (sector > c.sector) {
        c.sectors[c.sector] = now - c.sectorStart
        this.sectorDone(c, c.sector)
      }
      c.sector = sector
      c.sectorStart = now
    }
  }

  /** Blows since the engine last looked (it shows debris and sparks, then empties this). */
  impacts: Impact[] = []

  /** Damage `part` of car c by `amount` (nothing below 0). */
  private hurt(c: RaceCar, part: 'fw' | 'rw' | 'susp', amount: number, side: number, x: number, y: number, z: number) {
    if (amount <= 0 || this.opts.damage === false) {
      if (amount > -0.3) this.impacts.push({ x, y, z, strength: 0.25, part: '', car: c.i, scrape: false })
      return
    }
    const d = c.damage
    const before = d[part]
    d[part] = Math.min(1, before + amount)
    if (part === 'susp') d.side = side
    this.impacts.push({ x, y, z, strength: Math.min(1, 0.3 + amount), part, car: c.i, scrape: false })
    if (!c.player) return
    const name = part === 'fw' ? (SERIES === 'classic' ? 'Nose' : 'Front wing') : part === 'rw' ? (SERIES === 'classic' ? 'Tail' : 'Rear wing') : 'Suspension'
    if (before < 0.75 && d[part] >= 0.75) this.event(`${name} broken! Box (P) to repair it`, 'bad')
    else if (before < 0.25 && d[part] >= 0.25) this.event(`${name} damaged`, 'bad')
  }

  /** Seconds a pit stop takes to mend the car. */
  private repairTime(c: RaceCar) {
    const d = c.damage
    return (d.fw > 0.05 ? 4.5 : 0) + (d.rw > 0.05 ? 5.5 : 0) + (d.susp > 0.1 ? 3 + 6 * d.susp : 0)
  }

  /** Last sector colours for the player: purple, green or yellow. */
  sectorColors: ('purple' | 'green' | 'yellow' | '')[] = ['', '', '']

  private sectorDone(c: RaceCar, k: number) {
    if (!c.lapTimed || !c.lapValid) return
    const v = c.sectors[k]
    if (!(v > 0)) return
    let color: 'purple' | 'green' | 'yellow' = 'yellow'
    if (v < c.bestSectors[k]) {
      c.bestSectors[k] = v
      color = 'green'
    }
    if (v < this.bestSectors[k]) {
      this.bestSectors[k] = v
      color = 'purple'
    }
    if (c.player) {
      if (k === 0) this.sectorColors = [color, '', '']
      else this.sectorColors[k] = color
    }
  }

  // ---------------------------------------------------------------- order and results

  order(): RaceCar[] {
    const list = this.cars.filter((c) => !c.out)
    if (this.kind === 'qualifying') return list.sort((a, b) => a.bestLap - b.bestLap || a.i - b.i)
    return list.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1
      if (a.finished && b.finished) return a.finishTime - b.finishTime
      return b.dist - a.dist
    })
  }

  /** Gap of c to the car in front of the order (or to the leader), as text. */
  gapText(c: RaceCar, toLeader = true): string {
    const ord = this.order()
    const k = ord.indexOf(c)
    if (this.kind === 'qualifying') {
      if (!isFinite(c.bestLap)) return 'no time'
      if (k === 0) return fmtLap(c.bestLap)
      return fmtGap(c.bestLap - ord[0].bestLap)
    }
    if (k === 0) return this.phase === 'lights' ? '' : 'Leader'
    const ref = toLeader ? ord[0] : ord[k - 1]
    const down = Math.floor((ref.dist - c.dist) / this.t.len)
    if (down >= 1 && !(ref.finished && c.finished)) return `+${down} lap${down > 1 ? 's' : ''}`
    if (ref.finished && c.finished) return fmtGap(c.finishTime - ref.finishTime)
    const m = Math.floor(c.dist / (this.t.len / MARKS))
    if (m < 0 || ref.marks[m] === undefined || c.marks[m] === undefined) return ''
    return fmtGap(c.marks[m] - ref.marks[m])
  }

  /** The classification at the end (the race: unfinished cars are estimated). */
  results(): Classified[] {
    const t = this.t
    if (this.kind === 'qualifying') {
      const ord = this.order()
      return ord.map((c) => this.row(c, c.bestLap, 0, c === ord[0] ? fmtLap(c.bestLap) : isFinite(c.bestLap) ? fmtGap(c.bestLap - ord[0].bestLap) : 'no time'))
    }
    const rows = this.cars.filter((c) => !c.out).map((c) => {
      let time: number
      let laps: number
      if (c.finished) {
        time = c.finishTime
        laps = c.laps
      } else {
        const done = Math.max(0, c.dist)
        const avg = done / Math.max(1, this.time)
        laps = Math.min(this.laps, Math.floor(done / t.len) + 1)
        const leaderLaps = this.laps
        if (Math.floor(done / t.len) + 1 < leaderLaps) laps = Math.floor(done / t.len) + 1
        time = this.time + (laps * t.len - done) / Math.max(20, avg)
      }
      let pen = c.penalty
      if (this.mustChange && c.used.length < 2) pen += 10
      return { c, time: time + pen, laps, pen }
    })
    rows.sort((a, b) => b.laps - a.laps || a.time - b.time)
    const lead = rows[0]
    return rows.map((r) => {
      const gap = r === lead ? fmtLap(r.time) : r.laps < lead.laps ? `+${lead.laps - r.laps} lap${lead.laps - r.laps > 1 ? 's' : ''}` : fmtGap(r.time - lead.time)
      const row = this.row(r.c, r.time, r.laps, gap)
      row.penalty = r.pen
      return row
    })
  }

  private row(c: RaceCar, time: number, laps: number, gap: string): Classified {
    return { car: c.i, name: c.driver.name, code: c.driver.code, team: c.team, num: c.driver.num, best: c.bestLap, time, laps, gap, penalty: c.penalty, stops: c.stops, player: c.player }
  }

}
