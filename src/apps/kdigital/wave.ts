// Timing diagrams: probes on nets → WaveJSON (for WaveDrom) from the simulator's recorded history, buses,
// the values under the cursors, and the default probe list of a circuit. Pure (WaveDrom itself is loaded by the UI).

import { signalName, type Doc } from './model.ts'
import { pinKey, type Extracted } from './netlist.ts'
import { vchar, type V } from './logic.ts'
import type { Simulator } from './sim.ts'

/** A signal of the timing diagram: one net, or a bus of nets (the first is the most significant bit). */
export interface Probe {
  name: string
  /** net names, signal names or pins ("U1.Y") */
  bits: string[]
  /** how a bus is shown */
  radix?: 'hex' | 'decimal' | 'binary'
}

export interface WaveOptions {
  t0: number
  t1: number
  /** time units per column */
  step: number
  hscale?: number
  /** only those probes (default all) */
  signals?: readonly Probe[]
}

export interface WaveSignal { name: string; wave: string; data?: string[] }
export interface WaveJson { signal: WaveSignal[]; config?: { hscale: number }; head?: { text?: string; tick?: number } }

export const MAX_COLUMNS = 1200

/** A bus value as text: hex, decimal or binary; X when a bit is unknown. */
export function busText(bits: readonly V[], radix: 'hex' | 'decimal' | 'binary' = 'hex'): string {
  if (bits.some((b) => b === 2)) {
    // partly known: show the bits
    if (radix !== 'binary' && bits.every((b) => b === 2)) return 'X'
    if (radix === 'binary' || bits.length <= 4) return bits.map(vchar).join('')
    return 'X'
  }
  if (bits.every((b) => b === 3)) return 'Z'
  if (bits.some((b) => b === 3)) return bits.map(vchar).join('')
  let n = 0n
  for (const b of bits) n = (n << 1n) | BigInt(b)
  if (radix === 'binary') return bits.map(vchar).join('')
  if (radix === 'decimal') return n.toString(10)
  return n.toString(16).toUpperCase().padStart(Math.ceil(bits.length / 4), '0')
}

/** Bit values of a probe at a time (MSB first). */
export function probeBitsAt(sim: Simulator, probe: Probe, t: number): V[] {
  return probe.bits.map((b) => {
    const n = sim.netIndex(b)
    return n < 0 ? (2 as V) : sim.valueAt(n, t)
  })
}

/** The value under a cursor, as text. */
export function probeTextAt(sim: Simulator, probe: Probe, t: number): string {
  const bits = probeBitsAt(sim, probe, t)
  return probe.bits.length === 1 ? vchar(bits[0]) : busText(bits, probe.radix ?? 'hex')
}

export function waveJson(sim: Simulator, probes: readonly Probe[], o: WaveOptions): WaveJson & { columns: number } {
  const step = Math.max(1, Math.round(o.step))
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.ceil((o.t1 - o.t0) / step) + 1))
  const signal: WaveSignal[] = []
  for (const probe of (o.signals ?? probes)) {
    const bus = probe.bits.length > 1
    let wave = ''
    const data: string[] = []
    let prev = ''
    for (let i = 0; i < columns; i++) {
      const t = o.t0 + i * step
      const bits = probeBitsAt(sim, probe, t)
      let token: string
      let label = ''
      if (!bus) token = bits[0] === 0 ? '0' : bits[0] === 1 ? '1' : bits[0] === 2 ? 'x' : 'z'
      else if (bits.some((b) => b === 2)) token = 'x'
      else if (bits.every((b) => b === 3)) token = 'z'
      else { token = '='; label = busText(bits, probe.radix ?? 'hex') }
      const key = token + label
      if (key === prev) wave += '.'
      else { wave += token; if (token === '=') data.push(label) }
      prev = key
    }
    signal.push(bus ? { name: probe.name, wave, data } : { name: probe.name, wave })
  }
  return { signal, config: { hscale: o.hscale ?? 1 }, head: { tick: 0 }, columns }
}

/** The tick label that WaveDrom prints above column i. */
export const columnTime = (o: Pick<WaveOptions, 't0' | 'step'>, i: number): number => o.t0 + i * Math.max(1, Math.round(o.step))

/** Every input, clock, output and bus probe of a circuit: the diagram you get without choosing anything. */
export function defaultProbes(doc: Doc, ex?: Extracted): Probe[] {
  const out: Probe[] = []
  const name = (p: { props: Record<string, string>; ref: string }) => signalName(p as never) || p.ref
  for (const p of doc.parts) if (p.kind === 'clock') out.push({ name: name(p), bits: [p.ref + '.Y'] })
  for (const p of doc.parts) if (p.kind === 'switch' || p.kind === 'button') out.push({ name: name(p), bits: [p.ref + '.Y'] })
  for (const p of doc.parts) {
    if (p.kind === 'led') out.push({ name: name(p), bits: [p.ref + '.A'] })
    else if (p.kind === 'probe') {
      const n = Math.max(1, Math.min(16, Number(p.props.bits) || 4))
      const radix = p.props.radix === 'decimal' ? 'decimal' : p.props.radix === 'binary' ? 'binary' : 'hex'
      out.push({ name: name(p), bits: Array.from({ length: n }, (_, i) => `${p.ref}.B${n - 1 - i}`), radix })
    } else if (p.kind === 'hex') out.push({ name: name(p), bits: ['D3', 'D2', 'D1', 'D0'].map((b) => `${p.ref}.${b}`), radix: 'hex' })
  }
  void ex
  void pinKey
  return out
}

/** A probe name that is not used yet. */
export function freshProbeName(probes: readonly Probe[], base: string): string {
  const used = new Set(probes.map((p) => p.name))
  if (!used.has(base)) return base
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`
}

/** Stimulus lines "20 A=1 B=0" → steps; blank lines and # comments are skipped. */
export function parseStimulus(text: string): { steps: { t: number; set: Record<string, string> }[]; errors: string[] } {
  const steps: { t: number; set: Record<string, string> }[] = []
  const errors: string[] = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) return
    const parts = line.split(/\s+/)
    const t = Number(parts[0])
    if (!Number.isFinite(t) || t < 0) { errors.push(`Line ${i + 1}: start with the time, e.g. “20 A=1 B=0”.`); return }
    const set: Record<string, string> = {}
    for (const kv of parts.slice(1)) {
      const m = /^([^=]+)=(.+)$/.exec(kv)
      if (!m) { errors.push(`Line ${i + 1}: “${kv}” should look like NAME=value.`); continue }
      set[m[1]] = m[2]
    }
    if (Object.keys(set).length === 0) {
      if (parts.length === 1) errors.push(`Line ${i + 1}: after the time give NAME=value, e.g. “${parts[0]} A=1”.`)
      return
    }
    steps.push({ t: Math.round(t), set })
  })
  return { steps, errors }
}

export function stimulusText(steps: readonly { t: number; set: Record<string, string | number> }[]): string {
  return steps.map((s) => `${s.t} ${Object.entries(s.set).map(([k, v]) => `${k}=${v}`).join(' ')}`).join('\n')
}

/** "Sum = S3, S2, S1, S0" or just "A" or "U1.Y": a probe from text (names are not checked here). */
export function parseProbeSpec(text: string): Probe | string {
  const t = text.trim()
  if (!t) return 'Type a net name, a signal name or a pin (U1.Y); for a bus: Sum = S3, S2, S1, S0.'
  const eq = t.indexOf('=')
  const name = eq > 0 ? t.slice(0, eq).trim() : ''
  const list = (eq > 0 ? t.slice(eq + 1) : t).split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
  if (list.length === 0) return 'Name at least one net.'
  if (list.length > 16) return 'A bus has at most 16 bits.'
  return { name: name || (list.length === 1 ? list[0] : `bus(${list[0]}…${list[list.length - 1]})`), bits: list, ...(list.length > 1 ? { radix: 'hex' as const } : {}) }
}
