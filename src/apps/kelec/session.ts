// Running a simulation from a schematic or from netlist text, and turning results into the pieces the
// window and the AI tools show: signal lists, the power table, readable summaries. Pure.

import { analysisOf, settingsFrom, type SimSettings } from './settings.ts'
import { buildNetlist, type BuildResult } from './netlist.ts'
import type { Doc } from './model.ts'
import type { Analysis, Circuit } from './sim/circuit.ts'
import { diagnose, type Problem } from './sim/diagnose.ts'
import { SimError, simulate, type AcResult, type OpResult, type SimResult, type SweepResult, type TranResult } from './sim/engine.ts'
import { cornerFrequency, evalExpr, fallTime, fourier, frequencyOf, resonance, riseTime, stats } from './sim/measure.ts'
import { parseSpice, SpiceError, type ParsedNetlist } from './sim/spice.ts'
import { formatValue } from './sim/units.ts'

export interface Prepared {
  source: 'schematic' | 'netlist'
  circuit: Circuit
  analysis: Analysis
  problems: Problem[]
  build?: BuildResult
  parsed?: ParsedNetlist
  settings: SimSettings
}

/** Builds the circuit and the analysis to run. Throws an Error with a readable message. */
export function prepareSchematic(doc: Doc, settings: SimSettings, title = ''): Prepared {
  const build = buildNetlist(doc, title)
  const errors = build.problems.filter((p) => p.level === 'error')
  if (errors.length) throw new SimError(errors[0].message, errors[0].refs)
  if (build.circuit.elements.length === 0) throw new SimError('The circuit is empty: place some parts first.')
  return { source: 'schematic', circuit: build.circuit, analysis: analysisOf(settings), problems: build.problems, build, settings }
}

/** From SPICE text: the analysis is the text's own (.tran, .ac…), else the one in the settings. */
export function prepareNetlist(text: string, settings: SimSettings, which?: Analysis['type']): Prepared {
  let parsed: ParsedNetlist
  try { parsed = parseSpice(text) } catch (e) { if (e instanceof SpiceError) throw new SimError(e.message); throw e }
  if (parsed.circuit.elements.length === 0) throw new SimError('The netlist has no parts.')
  const own = which ? parsed.analyses.find((a) => a.type === which) : parsed.analyses[0]
  const analysis = own ?? analysisOf(settings, which)
  const problems = diagnose(parsed.circuit)
  const eff = own ? settingsFrom(own, settings) : settings
  return { source: 'netlist', circuit: parsed.circuit, analysis, problems, parsed, settings: eff }
}

export interface RunOutput {
  prepared: Prepared
  result: SimResult
  ms: number
}

export function runPrepared(p: Prepared): RunOutput {
  const t0 = Date.now()
  const result = simulate(p.circuit, p.analysis)
  return { prepared: p, result, ms: Date.now() - t0 }
}

// ------------------------------------------------------------------------------ signals

export function signalNames(r: SimResult): string[] {
  if (r.type === 'op') return Object.keys(r.op.values).filter((k) => !k.includes('#'))
  if (r.type === 'dc') return Object.keys(r.sweep.signals).filter((k) => !k.includes('#'))
  if (r.type === 'tran') return Object.keys(r.tran.signals).filter((k) => !k.includes('#'))
  return Object.keys(r.ac.mag).filter((k) => !k.includes('#'))
}

/** The x values and named signals of a time or sweep result. */
export function seriesOf(r: SimResult): { x: number[]; xLabel: string; signals: Record<string, ArrayLike<number>> } | null {
  if (r.type === 'tran') return { x: r.tran.t, xLabel: 'Time (s)', signals: r.tran.signals }
  if (r.type === 'dc') return { x: r.sweep.x, xLabel: `${r.sweep.xLabel} (V or A)`, signals: r.sweep.signals }
  return null
}

/** Traces to show first: labelled nets (names that are not N001-style), else the first few nodes. */
export function defaultTraces(r: SimResult, preferred: string[] = []): string[] {
  const names = signalNames(r)
  const have = preferred.filter((p) => { try { return r.type === 'ac' ? names.includes(p) || /^[VI]/.test(p) : true } catch { return false } })
  if (have.length) return have
  const volts = names.filter((n) => n.startsWith('V(') && !/^V\(N\d+\)$/.test(n) && !n.includes('.'))
  const pick = volts.filter((n) => !/^V\((in|vin|input)\)$/i.test(n))
  const out = [...volts.filter((n) => /^V\((in|vin|input)\)$/i.test(n)).slice(0, 1), ...pick.slice(-2)]
  return out.length ? [...new Set(out)] : names.filter((n) => n.startsWith('V(')).slice(0, 2)
}

/** Evaluates a trace expression over a time or sweep result. */
export function traceData(r: SimResult, expr: string): number[] {
  const s = seriesOf(r)
  if (!s) throw new Error('This result is not a waveform.')
  return evalExpr(expr, s.signals, s.x.length)
}

// ------------------------------------------------------------------------------ AC traces (complex)

interface Cx { re: number; im: number }

function acComplex(ac: AcResult, name: string): Cx[] {
  const m = ac.mag[name]
  const p = ac.phase[name]
  if (!m || !p) throw new Error(`There is no signal “${name}”.`)
  return m.map((mm, i) => ({ re: mm * Math.cos((p[i] * Math.PI) / 180), im: mm * Math.sin((p[i] * Math.PI) / 180) }))
}

const AC_EXPR = /^\s*(-?)\s*([VI][be]?\([^()\s]+\))\s*(?:([-+*/])\s*([VI][be]?\([^()\s]+\)))?\s*$/i

/** An AC trace: a signal, or the sum, difference, product or ratio of two. Returns magnitude and phase (degrees). */
export function acTrace(ac: AcResult, expr: string): { mag: number[]; phase: number[] } {
  const m = AC_EXPR.exec(expr)
  if (!m) throw new Error('In an AC sweep a trace is a signal such as V(out), or two of them combined: V(out)/V(in) or V(a)-V(b).')
  const norm = (s: string) => Object.keys(ac.mag).find((k) => k.toLowerCase() === s.toLowerCase()) ?? s
  const a = acComplex(ac, norm(m[2]))
  const sign = m[1] ? -1 : 1
  let z = a.map((c) => ({ re: sign * c.re, im: sign * c.im }))
  if (m[3] && m[4]) {
    const b = acComplex(ac, norm(m[4]))
    z = z.map((c, i) => {
      const d = b[i]
      switch (m[3]) {
        case '+': return { re: c.re + d.re, im: c.im + d.im }
        case '-': return { re: c.re - d.re, im: c.im - d.im }
        case '*': return { re: c.re * d.re - c.im * d.im, im: c.re * d.im + c.im * d.re }
        default: { const q = d.re * d.re + d.im * d.im; return { re: (c.re * d.re + c.im * d.im) / q, im: (c.im * d.re - c.re * d.im) / q } }
      }
    })
  }
  const mag = z.map((c) => Math.hypot(c.re, c.im))
  const phase: number[] = []
  let prev = 0
  z.forEach((c, i) => {
    let ph = (Math.atan2(c.im, c.re) * 180) / Math.PI
    if (i > 0) { while (ph - prev > 180) ph -= 360; while (ph - prev < -180) ph += 360 }
    prev = ph
    phase.push(ph)
  })
  return { mag, phase }
}

// ------------------------------------------------------------------------------ tables

export interface PowerRow { name: string; ref: string; power: number; current: number }

/** Per-element power (absorbed, negative = delivered), sorted by size, with the energy check. */
export function powerTable(op: OpResult, refOf?: Map<string, string>): { rows: PowerRow[]; supplied: number; dissipated: number; imbalance: number } {
  const rows = Object.keys(op.power).filter((n) => !n.includes('#')).map((n) => ({ name: n, ref: refOf?.get(n) ?? n, power: op.power[n], current: op.currents[n] }))
  rows.sort((a, b) => Math.abs(b.power) - Math.abs(a.power))
  return { rows, supplied: op.suppliedPower, dissipated: op.dissipatedPower, imbalance: op.suppliedPower - op.dissipatedPower }
}

// ------------------------------------------------------------------------------ summaries (for the AI and the status bar)

const sig = (v: number, d = 5) => Number(v.toPrecision(d))

export function summarize(out: RunOutput, signals: string[] = [], samples = 12): Record<string, unknown> {
  const r = out.result
  const base: Record<string, unknown> = { analysis: r.type, ms: out.ms }
  const warn = out.prepared.problems.filter((p) => p.level !== 'info').map((p) => p.message)
  if (warn.length) base.warnings = warn
  if (r.type === 'op') {
    const nodes: Record<string, number> = {}
    for (const [k, v] of Object.entries(r.op.nodes)) nodes[k] = sig(v)
    const currents: Record<string, number> = {}
    for (const [k, v] of Object.entries(r.op.currents)) if (!k.includes('#')) currents[k] = sig(v)
    const power: Record<string, number> = {}
    for (const [k, v] of Object.entries(r.op.power)) if (!k.includes('#') && Math.abs(v) > 1e-15) power[k] = sig(v)
    return { ...base, node_voltages_V: nodes, element_currents_A: currents, power_W: power, supplied_W: sig(r.op.suppliedPower), dissipated_W: sig(r.op.dissipatedPower), devices: r.op.devices }
  }
  if (r.type === 'ac') {
    const names = signals.length ? signals : defaultTraces(r)
    const traces: Record<string, unknown> = {}
    for (const n of names) {
      const t = acTrace(r.ac, n)
      const step = Math.max(1, Math.floor(r.ac.freq.length / samples))
      const pts = r.ac.freq.map((f, i) => ({ f: sig(f, 4), gain_dB: sig(20 * Math.log10(t.mag[i] || 1e-300), 4), phase_deg: sig(t.phase[i], 4) })).filter((_, i) => i % step === 0)
      const res = resonance(r.ac.freq, t.mag)
      traces[n] = {
        points: pts, low_frequency_gain_dB: sig(20 * Math.log10(t.mag[0] || 1e-300), 4), minus3dB_frequency_Hz: cornerFrequency(r.ac.freq, t.mag) ?? null,
        peak_frequency_Hz: sig(res.f0, 4), peak_gain_dB: sig(20 * Math.log10(res.peak || 1e-300), 4), Q: res.q === null ? null : sig(res.q, 3),
      }
    }
    return { ...base, traces }
  }
  const s = seriesOf(r)!
  const names = signals.length ? signals : defaultTraces(r)
  const traces: Record<string, unknown> = {}
  for (const n of names) {
    const y = traceData(r, n)
    const st = stats(s.x, y)
    const step = Math.max(1, Math.floor(s.x.length / samples))
    const t: Record<string, unknown> = { min: sig(st.min), max: sig(st.max), peak_to_peak: sig(st.pp), mean: sig(st.mean), rms: sig(st.rms), final: sig(st.last) }
    if (r.type === 'tran') {
      const f = frequencyOf(s.x, y)
      if (f) {
        t.frequency_Hz = sig(f, 4)
        try {
          const cycles = Math.max(1, Math.min(4, Math.floor((s.x[s.x.length - 1] - s.x[0]) * f) - 1))
          if (Math.floor((s.x[s.x.length - 1] - s.x[0]) * f) >= 3) t.thd_percent = sig(fourier(s.x, y, f, 9, cycles).thd * 100, 3)
        } catch { /* not periodic enough */ }
      }
      const rt = riseTime(s.x, y)
      if (rt) t.rise_time_s = sig(rt, 4)
      const ft = fallTime(s.x, y)
      if (ft) t.fall_time_s = sig(ft, 4)
    }
    t.samples = s.x.map((x, i) => ({ x: sig(x, 4), y: sig(y[i], 4) })).filter((_, i) => i % step === 0 || i === s.x.length - 1)
    traces[n] = t
  }
  return { ...base, x: s.xLabel, points: s.x.length, ...(r.type === 'tran' && r.tran.notes.length ? { notes: r.tran.notes } : {}), traces }
}

export type { OpResult, SweepResult, TranResult, SimResult }

/** "4.7 kΩ"-style helper for the UI. */
export const fmtV = (v: number, unit: string, digits = 4): string => formatValue(v, digits, unit)
