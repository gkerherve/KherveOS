// Recording and measuring (pure): the data table, CSV, headless runs for the AI tools and the tests, and the
// energy-drift comparison of the integrators.

import { METHODS, type Method } from './integrators.ts'
import { cleanParams, defaultMethod, makeSim, sceneById } from './registry.ts'
import type { KMotionDoc, Params, Readout, Sim } from './types.ts'

/** Samples of a running simulation, one row per recording instant. */
export class Recorder {
  columns: string[] = []
  rows: number[][] = []
  interval: number
  maxRows: number
  private next = 0

  constructor(columns: string[], interval: number, maxRows = 20000) {
    this.columns = columns
    this.interval = interval
    this.maxRows = maxRows
  }

  /** Records the sample if it is time for the next row (called after every simulation step). */
  offer(t: number, sample: () => Record<string, number>) {
    if (t + 1e-12 < this.next) return
    const s = sample()
    this.rows.push(this.columns.map((c) => (typeof s[c] === 'number' ? s[c] : NaN)))
    this.next = Math.max(this.next + this.interval, t + this.interval * 0.5)
    if (this.rows.length > this.maxRows) {
      // keep every second row and sample half as often
      this.rows = this.rows.filter((_, i) => i % 2 === 0)
      this.interval *= 2
    }
  }

  clear() {
    this.rows = []
    this.next = 0
  }

  column(key: string): number[] {
    const i = this.columns.indexOf(key)
    return i < 0 ? [] : this.rows.map((r) => r[i])
  }

  get length() { return this.rows.length }
}

const cell = (x: number) => (Number.isFinite(x) ? String(Number(x.toPrecision(10))) : '')

/** The table as CSV (comma) or TSV (tab, for pasting into a spreadsheet). */
export function tableText(rec: Recorder, sep = ',', columns?: string[]): string {
  const idx = (columns ?? rec.columns).map((c) => rec.columns.indexOf(c)).filter((i) => i >= 0)
  return [idx.map((i) => rec.columns[i]).join(sep), ...rec.rows.map((r) => idx.map((i) => cell(r[i])).join(sep))].join('\n') + '\n'
}

// ------------------------------------------------------------------------------------------ headless runs

export interface RunOptions {
  /** Simulated time, in the scene's time unit. */
  duration: number
  method?: Method
  /** Safety cap on the number of steps. */
  maxSteps?: number
  /** How many samples of the main channels to return. */
  samples?: number
  /** Stops at the end of the motion (a landing, a finished collision) instead of running to `duration`. */
  untilFinished?: boolean
  /** Gives up after this many milliseconds of real time (the result then says `truncated`). */
  maxMillis?: number
}

export interface RunResult {
  scene: string
  mode: string
  method: Method
  timeUnit: string
  lengthUnit: string
  /** Time reached. */
  t: number
  steps: number
  finished: boolean
  /** The run was cut short by the step or time cap. */
  truncated: boolean
  final: Record<string, number>
  min: Record<string, number>
  max: Record<string, number>
  samples: Record<string, number>[]
  readouts: Readout[]
  /** Largest relative change of the total energy during the run (null when the scene has no conserved energy). */
  energyDrift: number | null
}

const MAIN = ['t', 'x', 'y', 'vx', 'vy', 'speed', 'theta', 'omega', 'theta1', 'theta2', 'r', 'ke', 'pe', 'e', 'px', 'py', 'lz']

/** Runs a document without any drawing, with the simulation's own step. */
export function runHeadless(doc: KMotionDoc, o: RunOptions): RunResult {
  const sim = makeSim(doc, o.method)
  return runSim(sim, o)
}

export function runSim(sim: Sim, o: RunOptions): RunResult {
  const maxSteps = o.maxSteps ?? 2_000_000
  const wanted = Math.max(2, Math.min(200, o.samples ?? 12))
  const total = Math.max(1, Math.round(o.duration / sim.dt))
  const every = Math.max(1, Math.floor(total / wanted))
  const e0 = sim.energy()?.total
  const min: Record<string, number> = {}
  const max: Record<string, number> = {}
  const samples: Record<string, number>[] = []
  let steps = 0
  let drift = 0
  let truncated = false
  const started = Date.now()
  const note = (s: Record<string, number>) => {
    for (const [k, v] of Object.entries(s)) {
      if (!Number.isFinite(v)) continue
      if (!(k in min) || v < min[k]) min[k] = v
      if (!(k in max) || v > max[k]) max[k] = v
    }
  }
  const pick = (s: Record<string, number>) => {
    const out: Record<string, number> = {}
    for (const k of MAIN) if (k in s && Number.isFinite(s[k])) out[k] = Number(s[k].toPrecision(8))
    return out
  }
  samples.push(pick(sim.sample()))
  while (steps < total && steps < maxSteps && !(o.untilFinished && sim.finished)) {
    sim.step(sim.dt)
    steps++
    if (steps % every === 0 || steps === total) {
      const s = sim.sample()
      note(s)
      samples.push(pick(s))
    }
    if (e0 !== undefined && sim.conservative && steps % 10 === 0) {
      const e = sim.energy()!.total
      drift = Math.max(drift, Math.abs(e - e0) / (Math.abs(e0) || 1))
    }
    if (sim.finished && !o.untilFinished) break // a finished motion has nothing more to say
    if (o.maxMillis !== undefined && (steps & 255) === 0 && Date.now() - started > o.maxMillis) { truncated = true; break }
  }
  const fin = sim.sample()
  const clean = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => [k, Number(v.toPrecision(10))]))
  return {
    scene: sim.scene, mode: sim.mode, method: sim.method, timeUnit: sim.timeUnit, lengthUnit: sim.lengthUnit, t: sim.t, steps, finished: sim.finished, truncated: truncated || (steps >= maxSteps && sim.t < o.duration - sim.dt && !sim.finished),
    final: clean(fin), min: clean(min), max: clean(max), samples, readouts: sim.readouts(), energyDrift: sim.conservative && e0 !== undefined ? drift : null,
  }
}

// ------------------------------------------------------------------------------------------ integrator comparison

export interface DriftCurve {
  method: Method
  label: string
  t: number[]
  /** |ΔE/E| at those times. */
  drift: number[]
  /** Final relative error and how many accelerations it took. */
  final: number
  evals: number
  failed: boolean
}

/** Energy drift of every integrator on the same scene, with the same step, over `duration`. */
export function compareIntegrators(doc: KMotionDoc, duration: number, points = 160, maxSteps = 60000): DriftCurve[] {
  const def = sceneById(doc.scene)
  if (!def) return []
  const params: Params = cleanParams(doc.scene, doc.params)
  const first = def.create(params, defaultMethod(doc.scene, String(params.mode)))
  if (!first.conservative || first.methods.length === 0) return []
  const dt = first.dt
  const steps = Math.min(maxSteps, Math.max(10, Math.round(duration / dt)))
  const every = Math.max(1, Math.floor(steps / points))
  const out: DriftCurve[] = []
  for (const m of first.methods) {
    const sim = def.create(params, m)
    const e0 = sim.energy()?.total ?? 0
    const t: number[] = [0]
    const drift: number[] = [1e-17]
    let failed = false
    for (let i = 1; i <= steps; i++) {
      sim.step(dt)
      if (i % every === 0 || i === steps) {
        const e = sim.energy()?.total ?? NaN
        const d = Math.abs(e - e0) / (Math.abs(e0) || 1)
        if (!Number.isFinite(d) || d > 1e6) { failed = true; t.push(sim.t); drift.push(NaN); break }
        t.push(sim.t)
        drift.push(Math.max(d, 1e-17))
      }
    }
    const evals = (sim as unknown as { o?: { evals: number } }).o?.evals ?? 0
    out.push({ method: m, label: METHODS.find((x) => x.id === m)?.label ?? m, t, drift, final: drift[drift.length - 1], evals, failed })
  }
  return out
}

/** A one-line summary of a readout list, for the AI tools. */
export const readoutText = (r: Readout) => `${r.label}: ${r.value}${r.theory ? ` (${r.theory})` : ''}`

