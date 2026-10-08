// Simulation settings as the user types them (strings in engineering notation) and their conversion
// to an Analysis. Pure.

import type { Analysis } from './sim/circuit.ts'
import { parseValue } from './sim/units.ts'

export type AnalysisKind = 'op' | 'dc' | 'ac' | 'tran'

export interface SimSettings {
  analysis: AnalysisKind
  dcSource: string
  dcStart: string
  dcStop: string
  dcStep: string
  acStart: string
  acStop: string
  acPoints: string
  tranStop: string
  tranStep: string
  tranMax: string
  uic: boolean
}

export const DEFAULT_SETTINGS: SimSettings = {
  analysis: 'op', dcSource: 'V1', dcStart: '0', dcStop: '5', dcStep: '0.1',
  acStart: '1', acStop: '1meg', acPoints: '20', tranStop: '10m', tranStep: '', tranMax: '', uic: false,
}

function need(text: string, what: string): number {
  const v = parseValue(text)
  if (v === null) throw new Error(`${what}: “${text}” is not a number (try 4.7k, 10u or 1meg).`)
  return v
}

export function analysisOf(s: SimSettings, kind: AnalysisKind = s.analysis): Analysis {
  switch (kind) {
    case 'op': return { type: 'op' }
    case 'dc': {
      if (!s.dcSource.trim()) throw new Error('DC sweep: name the source to sweep (V1…).')
      const step = need(s.dcStep, 'DC sweep step')
      if (step === 0) throw new Error('DC sweep step cannot be zero.')
      return { type: 'dc', source: s.dcSource.trim(), start: need(s.dcStart, 'DC sweep start'), stop: need(s.dcStop, 'DC sweep stop'), step }
    }
    case 'ac': return { type: 'ac', fstart: need(s.acStart, 'AC start frequency'), fstop: need(s.acStop, 'AC stop frequency'), perDecade: Math.max(2, need(s.acPoints, 'AC points per decade')) }
    case 'tran': {
      const a: Analysis = { type: 'tran', tstop: need(s.tranStop, 'Stop time') }
      if (!(a.tstop > 0)) throw new Error('Stop time must be above zero.')
      if (s.tranStep.trim()) a.tstep = need(s.tranStep, 'Time step')
      if (s.tranMax.trim()) a.tmax = need(s.tranMax, 'Max step')
      if (s.uic) a.uic = true
      return a
    }
  }
}

/** Settings from an Analysis (the parsed .tran / .ac lines of a netlist). */
export function settingsFrom(a: Analysis, base: SimSettings = DEFAULT_SETTINGS): SimSettings {
  const s = { ...base, analysis: a.type as AnalysisKind }
  const t = (v: number) => String(Number(v.toPrecision(6)))
  if (a.type === 'dc') Object.assign(s, { dcSource: a.source, dcStart: t(a.start), dcStop: t(a.stop), dcStep: t(a.step) })
  if (a.type === 'ac') Object.assign(s, { acStart: t(a.fstart), acStop: t(a.fstop), acPoints: t(a.perDecade) })
  if (a.type === 'tran') Object.assign(s, { tranStop: t(a.tstop), tranStep: a.tstep ? t(a.tstep) : '', tranMax: a.tmax ? t(a.tmax) : '', uic: !!a.uic })
  return s
}
