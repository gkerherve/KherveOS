// The live side of a running scene (no React): the fixed-step accumulator, the data recorder and the trails.
// The idea is the one of the games' loop (src/apps/minigames/loop.ts): physics moves in equal steps whatever the
// frame rate, and a stall in the browser never makes it fast-forward.

import { Recorder } from './analysis.ts'
import { Trails } from './render.ts'
import type { Sim } from './types.ts'

/** Never owe more than this many seconds of real time (after a stall, a background tab, a debugger). */
const MAX_OWED_REAL = 0.1
/** Longest time one frame may spend stepping before it gives up and lets the picture catch up (slows down instead of freezing). */
const FRAME_BUDGET_MS = 11

export class Runtime {
  sim: Sim
  rec: Recorder
  trails = new Trails()
  /** Speed multiplier (0.1 – 10) and the slow-motion switch (x0.1 on top). */
  speed = 1
  slow = false
  running = false
  /** Simulated time owed to the loop. */
  private owed = 0
  /** Largest vector magnitudes seen, to scale the arrows. */
  refV = 1e-9
  refA = 1e-9
  refF = 1e-9
  e0 = 0
  steps = 0
  /** Minimum distance between trail points, world units (set from the view). */
  trailMin = 0
  /** Set when the loop could not keep up. */
  behind = false
  columns: string[]

  constructor(sim: Sim, columns?: string[], interval?: number) {
    this.sim = sim
    this.columns = columns ?? sim.channels.map((c) => c.key)
    this.rec = new Recorder(this.columns, interval ?? sim.sampleDt)
    this.e0 = sim.energy()?.total ?? 0
    this.record()
    this.pushTrails()
  }

  /** A time factor of the simulation relative to wall time. */
  get rate(): number { return this.sim.realtime * this.speed * (this.slow ? 0.1 : 1) }

  record() { this.rec.offer(this.sim.t, () => this.sim.sample()) }

  pushTrails() {
    const f = this.sim.frame()
    this.trails.push(f.bodies, this.trailMin)
    this.noteScales(f.bodies)
  }

  private noteScales(bodies: { vx: number; vy: number; ax: number; ay: number; m: number }[]) {
    for (const b of bodies) {
      this.refV = Math.max(this.refV, Math.hypot(b.vx, b.vy))
      this.refA = Math.max(this.refA, Math.hypot(b.ax, b.ay))
      this.refF = Math.max(this.refF, b.m * Math.hypot(b.ax, b.ay))
    }
  }

  /** Called once per animation frame with the real time since the last one. Returns the number of steps taken. */
  advance(realSeconds: number): number {
    if (!this.running || this.sim.finished) return 0
    this.owed += Math.min(Math.max(realSeconds, 0), MAX_OWED_REAL) * this.rate
    const dt = this.sim.dt
    const t0 = performance.now()
    let n = 0
    const wanted = Math.floor(this.owed / dt)
    const trailEvery = Math.max(1, Math.ceil(wanted / 6))
    this.behind = false
    while (this.owed >= dt && !this.sim.finished) {
      this.sim.step(dt)
      this.owed -= dt
      n++
      this.record()
      if (n % trailEvery === 0) this.pushTrails()
      if ((n & 15) === 0 && performance.now() - t0 > FRAME_BUDGET_MS) {
        this.behind = true
        this.owed = 0
        break
      }
    }
    this.steps += n
    if (n > 0 && n % trailEvery !== 0) this.pushTrails()
    return n
  }

  /** One frame's worth of simulated time (what the Step button does). */
  stepOnce() {
    if (this.sim.finished) return
    const n = Math.min(5000, Math.max(1, Math.round(this.rate / 60 / this.sim.dt)))
    for (let i = 0; i < n && !this.sim.finished; i++) {
      this.sim.step(this.sim.dt)
      this.record()
    }
    this.steps += n
    this.pushTrails()
  }

  clearData() {
    this.rec.clear()
    this.trails.clear()
    this.record()
    this.pushTrails()
  }
}
