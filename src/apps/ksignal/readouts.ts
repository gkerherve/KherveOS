// What the cursors read (pure): the values of the traces at a time, the level of a spectrum at a frequency, and the
// differences between cursor A and cursor B.

import type { Spectrum } from './spectrum.ts'
import { toDb } from './spectrum.ts'
import { fmtHz, fmtNum, fmtTime } from './stats.ts'

export interface CursorPair { a: number | null; b: number | null }

/** Linear interpolation of uniformly sampled data at time t (null outside the record). */
export function valueAtTime(x: ArrayLike<number>, fs: number, t: number): number | null {
  const p = t * fs
  if (!(p >= 0) || p > x.length - 1) return null
  const i = Math.floor(p)
  const f = p - i
  return i + 1 < x.length ? x[i] * (1 - f) + x[i + 1] * f : x[i]
}

/** Amplitude of a spectrum at a frequency (linear interpolation between bins). */
export function amplitudeAtFreq(s: Spectrum, f: number): number | null {
  const p = f / s.df
  if (!(p >= 0) || p > s.amp.length - 1) return null
  const i = Math.floor(p)
  const fr = p - i
  return i + 1 < s.amp.length ? s.amp[i] * (1 - fr) + s.amp[i + 1] * fr : s.amp[i]
}

export interface TimeTraces { original: ArrayLike<number>; fs: number; processed?: { x: ArrayLike<number>; fs: number } | null }

export function timeReadout(t: TimeTraces, c: CursorPair): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const one = (name: string, v: number | null) => {
    if (v === null) return null
    const o = valueAtTime(t.original, t.fs, v)
    const pr = t.processed ? valueAtTime(t.processed.x, t.processed.fs, v) : null
    out.push([name, `${fmtTime(v)}: ${o === null ? '–' : fmtNum(o, 5)}${pr === null ? '' : ` → ${fmtNum(pr, 5)}`}`])
    return { o, pr }
  }
  const a = one('A', c.a)
  const b = one('B', c.b)
  if (c.a !== null && c.b !== null) {
    const dt = c.b - c.a
    out.push(['Δt', `${fmtTime(dt)}${dt !== 0 ? ` (${fmtHz(1 / Math.abs(dt))})` : ''}`])
    if (a?.o != null && b?.o != null) out.push(['Δ value', fmtNum(b.o - a.o, 5)])
  }
  return out
}

export function spectrumReadout(s: Spectrum, c: CursorPair): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const amps: Array<number | null> = []
  for (const [name, f] of [['A', c.a], ['B', c.b]] as const) {
    if (f === null) { amps.push(null); continue }
    const a = amplitudeAtFreq(s, f)
    amps.push(a)
    out.push([name, `${fmtHz(f)}: ${a === null ? '–' : `${fmtNum(a, 5)} (${fmtNum(toDb(a), 4)} dB)`}`])
  }
  if (c.a !== null && c.b !== null) {
    out.push(['Δf', fmtHz(c.b - c.a)])
    if (c.a > 0) out.push(['f B / f A', fmtNum(c.b / c.a, 6)])
    if (amps[0] && amps[1]) out.push(['Δ level', `${fmtNum(toDb(amps[1]) - toDb(amps[0]), 4)} dB`])
  }
  return out
}
