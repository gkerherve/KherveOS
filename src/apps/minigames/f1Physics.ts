// Kherve Grand Prix: how a car moves. The player's car is a bicycle model
// (front and rear axle, slip angles, a Pacejka-like tyre curve, downforce
// growing with speed, drag, weight on each axle, the friction circle), run in
// small steps. The AI drives the speed profile of the racing line: the fastest
// speed each corner allows with the same grip and downforce, then the braking
// and accelerating that joins them up. No three.js here.

import type { Track } from './f1Track.ts'

export const G = 9.81

export type Series = 'modern' | 'classic'

export interface CarSpec {
  mass: number
  /** Yaw inertia (kg m²). */
  iz: number
  /** Centre of gravity to front and rear axle (m). */
  a: number
  b: number
  power: number
  cda: number
  cla: number
  rho: number
  /** Peak tyre friction of a new soft on dry asphalt. */
  mu: number
  /** Share of the downforce on the front axle. */
  aeroFront: number
  wheelR: number
  roll: number
  /** Top speed of each gear (km/h), the revs at idle and at the limiter. */
  gears: number[]
  idle: number
  redline: number
  /** The profile's top speed (m/s). */
  top: number
  /** The steering lock at walking pace (rad). */
  lock: number
}

const SPECS: Record<Series, CarSpec> = {
  // a modern single-seater: light, huge downforce, a hybrid V6
  modern: {
    mass: 800, iz: 1150, a: 1.72, b: 1.88, power: 760e3, cda: 1.25, cla: 3.6, rho: 1.2, mu: 1.75, aeroFront: 0.44, wheelR: 0.36, roll: 0.014,
    gears: [86, 128, 164, 199, 234, 268, 302, 340], idle: 4200, redline: 12400, top: 96, lock: 0.36,
  },
  // a late-1960s / early-70s sports coupé: heavier, almost no downforce, skinny tyres, a five-speed box
  classic: {
    mass: 1020, iz: 1450, a: 1.32, b: 1.0, power: 235e3, cda: 0.72, cla: 0.12, rho: 1.2, mu: 1.12, aeroFront: 0.45, wheelR: 0.31, roll: 0.015,
    gears: [72, 118, 165, 212, 262], idle: 2600, redline: 7900, top: 76, lock: 0.42,
  },
}

/** The car the physics drives now (the Grand Prix window is single-instance: it switches this with the series). */
export const CAR: CarSpec = { ...SPECS.modern }
export let TOP_SPEED = SPECS.modern.top
export let SERIES: Series = 'modern'

export function setSeries(s: Series) {
  Object.assign(CAR, SPECS[s])
  TOP_SPEED = SPECS[s].top
  SERIES = s
}

/** Gear and revs at a speed (m/s), for the sound and the dials. */
export function gearRpm(speed: number, gear: number): { gear: number; rpm: number } {
  const G = CAR.gears.map((k) => k / 3.6)
  const n = G.length
  const sp = Math.max(0, speed)
  if (gear < n && sp > G[gear - 1] * 0.97) gear++
  else if (gear > 1 && sp < G[gear - 2] * 0.8) gear--
  gear = Math.max(1, Math.min(n, gear))
  const lo = gear > 1 ? G[gear - 2] * 0.8 : 0
  const frac = Math.min(1, Math.max(0, (sp - lo) / (G[gear - 1] - lo)))
  return { gear, rpm: CAR.idle + frac * (CAR.redline - CAR.idle) }
}

export type Compound = 'soft' | 'medium' | 'hard'
export const COMPOUNDS: Record<Compound, { grip: number; life: number; color: string; letter: string; name: string }> = {
  soft: { grip: 1.0, life: 0.6, color: '#ff3b30', letter: 'S', name: 'Soft' },
  medium: { grip: 0.972, life: 0.95, color: '#ffd60a', letter: 'M', name: 'Medium' },
  hard: { grip: 0.945, life: 1.4, color: '#f2f2f2', letter: 'H', name: 'Hard' },
}
export const COMPOUND_LIST: Compound[] = ['soft', 'medium', 'hard']

export interface Tyres {
  compound: Compound
  /** 0 new, 1 worn out (it keeps going down after). */
  wear: number
  /** 0 cold, 1 in the window. */
  temp: number
}

export const newTyres = (compound: Compound, warm = false): Tyres => ({ compound, wear: 0, temp: warm ? 0.9 : 0.45 })

/** How much grip a set of tyres gives (1 = a warm new soft). */
export function tyreGrip(t: Tyres): number {
  const c = COMPOUNDS[t.compound]
  const w = Math.max(0, t.wear)
  const wearLoss = 0.16 * Math.pow(Math.min(w, 1), 1.7) + (w > 1 ? 0.3 * Math.min(1, w - 1) : 0)
  return c.grip * (1 - wearLoss) * (0.9 + 0.1 * Math.min(1, t.temp))
}

/** Laps a set lasts in a race of `laps` laps (they are made to need one stop). */
export const tyreLife = (c: Compound, laps: number) => Math.max(2.2, COMPOUNDS[c].life * Math.max(4, laps))

/** Wear and warm the tyres over `dist` metres with `usage` (0..1.5: share of the grip used). */
export function wearTyres(t: Tyres, dist: number, usage: number, dt: number, lapLen: number, raceLaps: number) {
  t.wear += (dist / (tyreLife(t.compound, raceLaps) * lapLen)) * (0.55 + 0.75 * Math.min(1.5, usage))
  const target = Math.min(1, 0.5 + 0.55 * usage + Math.min(0.25, dist / Math.max(dt, 1e-3) / 240))
  t.temp += (target - t.temp) * Math.min(1, dt * 0.06)
}

/** Most lateral acceleration at speed v with grip factor `grip` (m/s²). */
export function latLimit(v: number, grip: number): number {
  return (CAR.mu * grip * (CAR.mass * G + 0.5 * CAR.rho * CAR.cla * v * v)) / CAR.mass
}

/** Most forward acceleration at speed v (m/s²). */
export function accelLimit(v: number, grip: number): number {
  const fzR = (CAR.mass * G * CAR.a) / (CAR.a + CAR.b) + 0.5 * CAR.rho * CAR.cla * v * v * (1 - CAR.aeroFront)
  const traction = CAR.mu * grip * fzR * 0.92
  const engine = CAR.power / Math.max(v, 4)
  const drag = 0.5 * CAR.rho * CAR.cda * v * v + CAR.roll * CAR.mass * G
  return (Math.min(traction, engine) - drag) / CAR.mass
}

/** Most braking at speed v (m/s², positive). */
export function brakeLimit(v: number, grip: number): number {
  const drag = 0.5 * CAR.rho * CAR.cda * v * v
  return latLimit(v, grip) * 0.97 + drag / CAR.mass
}

/**
 * The speed profile of the racing line (m/s per sample) for a car with grip `grip`,
 * and the lap time it gives.
 */
export function speedProfile(t: Track, grip = 1, margin = 0.97): { v: Float32Array; lapTime: number } {
  const n = t.n
  const v = new Float32Array(n)
  const muC = (CAR.mu * grip * margin * 0.5 * CAR.rho * CAR.cla) / CAR.mass
  for (let i = 0; i < n; i++) {
    const k = Math.abs(t.lineK[i])
    const den = k - muC
    v[i] = den <= 1e-6 ? TOP_SPEED : Math.min(TOP_SPEED, Math.sqrt((CAR.mu * grip * margin * G) / den))
  }
  // braking (backwards) and accelerating (forwards) passes, twice round so the lap closes
  const step = (i: number) => t.ds * t.lineScale[i]
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 2 * n; j > 0; j--) {
      const i = j % n
      const p = (i + 1) % n
      const lat = v[i] * v[i] * Math.abs(t.lineK[i])
      const lim = latLimit(v[i], grip * margin)
      const share = Math.sqrt(Math.max(0.05, 1 - (lat / lim) ** 2))
      const vmax = Math.sqrt(v[p] * v[p] + 2 * brakeLimit(v[p], grip * margin) * share * step(i))
      if (v[i] > vmax) v[i] = vmax
    }
    for (let j = 0; j < 2 * n; j++) {
      const i = j % n
      const p = (i + 1) % n
      const lat = v[i] * v[i] * Math.abs(t.lineK[i])
      const lim = latLimit(v[i], grip * margin)
      const share = Math.sqrt(Math.max(0.05, 1 - (lat / lim) ** 2))
      const vmax = Math.sqrt(Math.max(0, v[i] * v[i] + 2 * Math.max(0.3, accelLimit(v[i], grip)) * share * step(i)))
      if (v[p] > vmax) v[p] = vmax
    }
  }
  let lapTime = 0
  for (let i = 0; i < n; i++) lapTime += step(i) / Math.max(1, (v[i] + v[(i + 1) % n]) / 2)
  return { v, lapTime }
}

// ---------------------------------------------------------------- the player's car

export interface CarInput {
  throttle: number
  brake: number
  /** -1 full left .. 1 full right. */
  steer: number
}

export interface CarEnv {
  /** Tyre grip × surface grip. */
  grip: number
  /** Extra drag in g (grass, gravel). */
  drag: number
  assists: boolean
  /** The steering comes from an analogue stick (no smoothing). */
  analog?: boolean
  /** DRS open: less drag. */
  drs?: boolean
}

export class CarBody {
  x = 0
  z = 0
  y = 0
  /** Heading: forward is (cos h, sin h) in x, z. */
  h = 0
  /** Forward and rightward speed in the car's frame (m/s), yaw rate (rad/s, + turning right). */
  vx = 0
  vy = 0
  r = 0
  /** The front wheels' angle (rad, + right). */
  steer = 0
  /** Wheel rotation (rad), for drawing. */
  wheelRot = 0
  gear = 1
  rpm = 4000
  /** Accelerations in the car's frame (m/s²), for the camera and the tyres. */
  ax = 0
  ay = 0
  /** Share of the grip in use (0..1+), slips for the sounds and the smoke. */
  usage = 0
  slide = 0
  spin = 0
  lock = 0
  private aF = 0
  private aR = 0

  get speed() {
    return Math.hypot(this.vx, this.vy)
  }

  place(x: number, z: number, h: number, speed = 0) {
    this.x = x
    this.z = z
    this.h = h
    this.vx = speed
    this.vy = 0
    this.r = 0
    this.aF = 0
    this.aR = 0
    this.steer = 0
    this.ax = 0
    this.ay = 0
  }

  step(dt: number, inp: CarInput, env: CarEnv) {
    // the steering wheel: limited at speed (a keyboard is all or nothing), turned at a finite rate
    const v = Math.abs(this.vx)
    const lock = CAR.lock / (1 + v / 19)
    const target = inp.steer * lock
    if (env.analog) this.steer = target
    else {
      const rate = (Math.abs(target) < Math.abs(this.steer) ? 3.2 : 1.9) * Math.max(0.6, lock / 0.2)
      const dS = target - this.steer
      this.steer += Math.sign(dS) * Math.min(Math.abs(dS), rate * dt)
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 480)))
    const h = dt / steps
    let usage = 0
    let slide = 0
    let spin = 0
    let lockup = 0
    for (let k = 0; k < steps; k++) {
      const o = this.sub(h, inp, env)
      usage += o.usage / steps
      slide += o.slide / steps
      spin += o.spin / steps
      lockup += o.lock / steps
    }
    this.usage = usage
    this.slide = slide
    this.spin = spin
    this.lock = lockup
    // the gearbox (automatic) and the revs, for the sound and the dials
    const sp = Math.max(0, this.vx)
    const gr = gearRpm(sp, this.gear)
    this.gear = gr.gear
    const want = gr.rpm + (spin > 0.2 ? 2000 * spin : 0) + (sp < 2 ? inp.throttle * (CAR.redline - CAR.idle) * 0.7 : 0)
    this.rpm += (want - this.rpm) * Math.min(1, dt * 14)
    this.wheelRot += (this.vx / CAR.wheelR) * dt + spin * dt * 40
  }

  private sub(h: number, inp: CarInput, env: CarEnv) {
    const { mass: m, a, b, iz, rho, cla, mu } = CAR
    const L = a + b
    const vx = this.vx
    const vy = this.vy
    const r = this.r
    const sp = Math.hypot(vx, vy)
    const aero = 0.5 * rho * cla * vx * vx
    // weight on each axle: static, downforce, and the weight transfer of braking and accelerating
    const transfer = (m * this.ax * 0.32) / L
    const fzF = Math.max(500, (m * G * b) / L + aero * CAR.aeroFront - transfer)
    const fzR = Math.max(500, (m * G * a) / L + aero * (1 - CAR.aeroFront) + transfer)
    const capF = mu * env.grip * fzF
    const capR = mu * env.grip * fzR
    const delta = this.steer

    // slip angles, with a little lag (the tyre's relaxation length)
    const u = Math.max(Math.abs(vx), 4)
    const sgn = vx >= -0.5 ? 1 : -1
    const aFt = Math.atan2(vy + a * r, u) - delta * sgn
    const aRt = Math.atan2(vy - b * r, u)
    const relax = Math.min(1, (u * h) / 0.35)
    this.aF += (aFt - this.aF) * relax
    this.aR += (aRt - this.aR) * relax
    const curve = (al: number) => Math.sin(1.5 * Math.atan(13 * al))

    // driving and braking
    let fxR = 0
    let fxF = 0
    let spin = 0
    let lockF = 0
    const reverse = inp.brake > 0.5 && inp.throttle < 0.05 && vx < 0.6 && this.reverseHold > 0.45
    this.reverseHold = inp.brake > 0.5 && inp.throttle < 0.05 && vx < 0.6 ? this.reverseHold + h : 0
    if (reverse) {
      fxR = vx > -5 ? -3200 : 0
    } else if (inp.throttle > 0) {
      let drive = inp.throttle * Math.min(CAR.power / Math.max(vx, 4), CAR.mass * 37)
      // traction control: never more than the grip the rear tyres have left after cornering
      if (env.assists) drive = Math.min(drive, Math.max(capR * 0.3, Math.sqrt(Math.max(0, (capR * 0.9) ** 2 - this.fyR * this.fyR))))
      if (drive > capR) {
        spin = Math.min(1, (drive - capR) / capR)
        drive = capR * 0.92
      }
      fxR = drive
    }
    if (inp.brake > 0 && !reverse && vx > 0.2) {
      const want = inp.brake * (capF + capR) * 1.12
      let bf = want * 0.6
      let br = want * 0.4
      if (env.assists) {
        bf = Math.min(bf, capF * 0.96)
        br = Math.min(br, capR * 0.96)
      }
      if (bf > capF) {
        lockF = 1
        bf = capF * 0.8
      }
      if (br > capR) br = capR * 0.8
      fxF -= bf
      fxR -= br
    }
    // the friction circle: what is left for cornering
    const latF = lockF ? capF * 0.25 : Math.sqrt(Math.max(0, capF * capF - fxF * fxF))
    const latR = spin > 0 ? capR * (0.5 - 0.25 * spin) : Math.sqrt(Math.max(0, capR * capR - fxR * fxR))
    let fyF = -latF * curve(this.aF)
    let fyR = -latR * curve(this.aR)
    if (sp < 1.2 && inp.throttle < 0.05) {
      // parked: the tyres just hold it
      fyF *= sp / 1.2
      fyR *= sp / 1.2
    }

    const cd = env.drs ? CAR.cda * 0.82 : CAR.cda
    const drag = 0.5 * rho * cd * vx * Math.abs(vx)
    const rollF = (CAR.roll + env.drag) * m * G * Math.tanh(vx * 2)
    const cosD = Math.cos(delta)
    const sinD = Math.sin(delta)
    const fx = fxR + fxF * cosD - fyF * sinD - drag - rollF
    const fy = fyR + fyF * cosD + fxF * sinD - (env.drag * m * G * Math.tanh(vy * 2))
    let mz = a * (fyF * cosD + fxF * sinD) - b * fyR

    // stability help (on with the assists): damps a slide before it becomes a spin
    if (env.assists && sp > 6) {
      const rWant = (vx * Math.tan(delta)) / L
      const rMax = latLimit(sp, env.grip) / Math.max(sp, 1)
      const rDes = Math.max(-rMax, Math.min(rMax, rWant))
      const err = r - rDes
      if (Math.abs(err) > 0.06) mz -= (err - Math.sign(err) * 0.06) * iz * 9
    }

    this.fyR = fyR
    this.ax = fx / m
    this.ay = fy / m
    this.vx += (fx / m + r * vy) * h
    this.vy += (fy / m - r * vx) * h
    this.r += (mz / iz) * h
    if (sp < 0.4 && inp.throttle < 0.05 && !reverse) {
      this.vx *= 0.9
      this.vy *= 0.8
      this.r *= 0.8
    }
    const ch = Math.cos(this.h)
    const sh = Math.sin(this.h)
    this.x += (this.vx * ch - this.vy * sh) * h
    this.z += (this.vx * sh + this.vy * ch) * h
    this.h += this.r * h
    const usage = Math.hypot(fx + drag, fy) / Math.max(1, capF + capR)
    const slide = Math.max(0, Math.abs(this.aR) - 0.09) * 6 + Math.max(0, Math.abs(this.aF) - 0.12) * 3
    return { usage, slide: Math.min(1, slide * Math.min(1, sp / 8)), spin, lock: lockF * Math.min(1, vx / 10) }
  }

  private reverseHold = 0
  /** The rear tyres' cornering force last step (traction control). */
  private fyR = 0
}
