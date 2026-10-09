// Project-level analysis (pure): the samples of a project, its processed version, the spectrum, peaks, tone metrics
// and time-domain peak detection that the Spectrum tab, the AI tools and the tests all use.

import {
  decimate, findTimePeaks, heartRate, hilbertEnvelope, medianFilter, movingAverage, savgol, signalStats, type HeartRate, type SignalStats, type TimePeak,
} from './dsp.ts'
import { applyFilter, designFilter, describeSpec, type FilterDesign } from './filters.ts'
import { generate } from './generators.ts'
import type { AnalysisSettings, KsigProject, Process, Source } from './project.ts'
import {
  ampSpectrum, spectrumPeaks, toneMetrics, welch, type Psd, type Spectrum, type ToneMetrics,
} from './spectrum.ts'

export interface Trace { x: Float64Array; fs: number }

/** The samples of a project's source: generated, or the imported ones passed in. */
export function sourceSamples(source: Source, imported?: Float64Array | null): Trace {
  if (source.kind === 'generator') return { x: generate(source), fs: source.fs }
  if (!imported) throw new Error('This signal has no samples: import the file again.')
  return { x: imported, fs: source.fs }
}

/** What the "Process" step does to a trace. Throws when the filter cannot be designed. */
export function processTrace(t: Trace, process: Process, filter: FilterDesign | null): Trace {
  switch (process.type) {
    case 'none': return t
    case 'filter': {
      if (!filter) throw new Error('There is no filter to apply.')
      return { x: applyFilter(filter, t.x), fs: t.fs }
    }
    case 'smooth': {
      const x = process.method === 'ma' ? movingAverage(t.x, process.width) : process.method === 'median' ? medianFilter(t.x, process.width) : savgol(t.x, process.width, process.order)
      return { x, fs: t.fs }
    }
    case 'envelope': return { x: hilbertEnvelope(t.x), fs: t.fs }
    case 'decimate': {
      const d = decimate(t.x, process.factor, t.fs)
      return { x: d.x, fs: d.fs }
    }
  }
}

export const PROCESS_LABELS: Record<Process['type'], string> = { none: 'None', filter: 'Filter', smooth: 'Smoothing', envelope: 'Hilbert envelope', decimate: 'Decimate' }

export function describeProcess(p: Process, filter?: FilterDesign | null): string {
  switch (p.type) {
    case 'none': return 'none'
    case 'filter': return filter ? filter.label + (filter.spec.zeroPhase ? ' (zero phase)' : '') : 'filter'
    case 'smooth': return `${p.method === 'ma' ? 'moving average' : p.method === 'median' ? 'median' : `Savitzky–Golay order ${p.order}`}, ${p.width} samples`
    case 'envelope': return 'Hilbert envelope'
    case 'decimate': return `decimate by ${p.factor}`
  }
}

/** Largest power of two ≤ n. */
export const floorPow2 = (n: number): number => 2 ** Math.floor(Math.log2(Math.max(1, n)))

/** The FFT length of the Spectrum tab for a signal of n samples. */
export function resolveFftSize(a: AnalysisSettings, n: number): number {
  return a.fftSize > 0 ? a.fftSize : Math.min(65536, Math.max(8, n))
}

export function resolveWelchSize(a: AnalysisSettings, n: number): number {
  return Math.min(n, a.fftSize > 0 ? a.fftSize : Math.max(256, Math.min(8192, floorPow2(n / 8))))
}

/** The Spectrum tab's single-FFT spectrum of a trace. */
export function traceSpectrum(t: Trace, a: AnalysisSettings, window = a.window): Spectrum {
  const start = Math.min(t.x.length - 8, Math.max(0, Math.round(a.start * t.fs)))
  const nfft = resolveFftSize(a, t.x.length - Math.max(0, start))
  return ampSpectrum(t.x, t.fs, { window, beta: a.beta, nfft, start: Math.max(0, start), length: Math.min(nfft, t.x.length - Math.max(0, start)) })
}

export function traceWelch(t: Trace, a: AnalysisSettings): Psd {
  return welch(t.x, t.fs, { nperseg: resolveWelchSize(a, t.x.length), overlap: a.overlap, window: a.window, beta: a.beta, scaling: 'density' })
}

export interface AnalysisSummary {
  name: string
  fs: number
  samples: number
  duration: number
  stats: SignalStats
  spectrum: { window: string; nfft: number; binWidth: number; enbw: number }
  peaks: Array<{ freq: number; amp: number; ampDb: number; phaseDeg: number }>
  tone: ToneMetrics | null
  timePeaks?: { count: number; heartRate: HeartRate | null; peaks: TimePeak[] }
}

/** The numbers an AI tool reports for a trace. */
export function summarizeTrace(name: string, t: Trace, a: AnalysisSettings, extra: { tone?: boolean } = {}): AnalysisSummary {
  const spec = traceSpectrum(t, a)
  const peaks = spectrumPeaks(spec, { rangeDb: a.peakRangeDb, maxPeaks: a.maxPeaks })
  const out: AnalysisSummary = {
    name, fs: t.fs, samples: t.x.length, duration: t.x.length / t.fs, stats: signalStats(t.x),
    spectrum: { window: spec.window, nfft: spec.nfft, binWidth: spec.df, enbw: spec.enbw },
    peaks: peaks.map((p) => ({ freq: p.freq, amp: p.amp, ampDb: p.ampDb, phaseDeg: ((p.phase ?? 0) * 180) / Math.PI })),
    tone: extra.tone === false ? null : toneMetrics(spec, { fundamental: a.fundamental || undefined, beta: a.beta }),
  }
  if (a.timePeaks.enabled) {
    const peaksT = findTimePeaks(t.x, t.fs, a.timePeaks.height, a.timePeaks.minDistance)
    out.timePeaks = { count: peaksT.length, heartRate: heartRate(peaksT), peaks: peaksT }
  }
  return out
}

export interface ProjectResult {
  original: Trace
  processed: Trace | null
  filter: FilterDesign | null
  filterError: string | null
}

/** Generates the signal, designs the filter and runs the process of a project. */
export function runProject(p: KsigProject, imported?: Float64Array | null): ProjectResult {
  const original = sourceSamples(p.source, imported)
  let filter: FilterDesign | null = null
  let filterError: string | null = null
  try { filter = designFilter(p.filter, original.fs) } catch (e) { filterError = e instanceof Error ? e.message : String(e) }
  const processed = p.process.type === 'none' ? null : processTrace(original, p.process, filter)
  return { original, processed, filter, filterError }
}

/** The summary of a project's analysed trace (original or processed, as its settings say). */
export function analyzeProject(p: KsigProject, imported?: Float64Array | null): AnalysisSummary & { process: string; filter: string } {
  const r = runProject(p, imported)
  const trace = p.analysis.analyse === 'processed' && r.processed ? r.processed : r.original
  const s = summarizeTrace(p.name, trace, p.analysis)
  return { ...s, process: describeProcess(p.process, r.filter), filter: describeSpec(p.filter) }
}
