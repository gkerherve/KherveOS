// Running a circuit from a description (stimulus + length) and summarising the result: shared by the timing
// tab, the AI tools and the tests. Pure.

import { vchar, type V } from './logic.ts'
import { Simulator, type SimSettings } from './sim.ts'
import { busText, defaultProbes, probeBitsAt, probeTextAt, type Probe } from './wave.ts'
import type { Step } from './file.ts'
import type { Doc } from './model.ts'

export interface RunSpec {
  doc: Doc
  settings: SimSettings
  steps: readonly Step[]
  until: number
}

/** Builds a simulator, applies the timed input changes and runs to `until`. */
export function runSpec(spec: RunSpec): Simulator {
  const sim = new Simulator(spec.doc, spec.settings)
  const sorted = [...spec.steps].sort((a, b) => a.t - b.t)
  for (const s of sorted) {
    if (s.t > spec.until) break
    sim.run(s.t)
    for (const [name, v] of Object.entries(s.set)) sim.setInput(name, v)
  }
  sim.run(spec.until)
  return sim
}

export interface SignalSummary {
  name: string
  /** the value now (at `until`) */
  final: string
  /** [time, value] for every change that was recorded, at most `max` of them */
  changes: [number, string][]
  /** one character per sample: 0 1 X Z, or the bus value */
  samples: string
}

export interface RunSummary {
  until: number
  step: number
  signals: SignalSummary[]
  glitches: { signal: string; time: number; width: number }[]
  problems: string[]
}

/** Finds pulses that are shorter than `maxWidth` (a 0 or 1 that lasts only an instant between two equal values). */
export function findGlitches(sim: Simulator, probe: Probe, maxWidth = 2, until = sim.time): { time: number; width: number }[] {
  if (probe.bits.length !== 1) return []
  const n = sim.netIndex(probe.bits[0])
  if (n < 0) return []
  const h = sim.hist[n]
  const out: { time: number; width: number }[] = []
  for (let i = 1; i + 1 < h.t.length; i++) {
    if (h.t[i + 1] > until) break
    const a = h.v[i - 1], b = h.v[i], c = h.v[i + 1]
    if (a === c && b !== a && a < 2 && b < 2 && h.t[i + 1] - h.t[i] <= maxWidth && h.t[i] > 0) out.push({ time: h.t[i], width: h.t[i + 1] - h.t[i] })
  }
  return out
}

export function summarizeRun(sim: Simulator, probes: readonly Probe[], until: number, opt: { samples?: number; maxChanges?: number } = {}): RunSummary {
  const columns = Math.max(2, Math.min(opt.samples ?? 64, until + 1))
  const step = Math.max(1, Math.ceil(until / columns))
  const maxChanges = opt.maxChanges ?? 40
  const signals: SignalSummary[] = []
  const glitches: RunSummary['glitches'] = []
  for (const p of probes) {
    const changes: [number, string][] = []
    // change times: union of the history of the nets involved
    const times = new Set<number>()
    for (const b of p.bits) {
      const n = sim.netIndex(b)
      if (n >= 0) for (const t of sim.hist[n].t) if (t <= until) times.add(t)
    }
    let last = ''
    for (const t of [...times].sort((a, b) => a - b)) {
      const v = probeTextAt(sim, p, t)
      if (v !== last) { changes.push([t, v]); last = v }
    }
    let samples = ''
    for (let t = 0; t <= until; t += step) {
      const bits = probeBitsAt(sim, p, t)
      samples += p.bits.length === 1 ? vchar(bits[0]) : (bits.some((b) => b > 1) ? 'x' : busText(bits, p.radix ?? 'hex')) + ' '
    }
    signals.push({ name: p.name, final: probeTextAt(sim, p, until), changes: changes.length > maxChanges ? changes.slice(0, maxChanges) : changes, samples: samples.trimEnd() })
    for (const g of findGlitches(sim, p, 2, until)) glitches.push({ signal: p.name, ...g })
  }
  return { until, step, signals, glitches, problems: sim.problems().filter((q) => q.level !== 'info').map((q) => q.message) }
}

/** The probes to use: those the user chose, else every input, clock, output and bus probe. */
export const probesOrDefault = (doc: Doc, probes: readonly Probe[] | undefined): Probe[] => (probes && probes.length ? [...probes] : defaultProbes(doc))

export const toV = (x: string | number): V => (x === 1 || x === '1' ? 1 : x === 0 || x === '0' ? 0 : String(x).toUpperCase() === 'Z' ? 3 : 2)
