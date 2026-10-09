// AI tools of kSignal (the manifest is src/os/ai/manifests/ksignal.ts). Written against a small set of hooks the
// window provides, so the logic can be tested without a browser.

import type { useAppTools } from '@/os/ai/appTools'
import { analyzeProject, describeProcess, runProject, summarizeTrace, type AnalysisSummary } from './analysis.ts'
import { designFilter, describeSpec, normalizeFilterSpec, type FilterSpec } from './filters.ts'
import { filterMetrics } from './filterInfo.ts'
import { normalizeGenerator, sourceProblems } from './generators.ts'
import { EXAMPLES, exampleById, type Example } from './examples.ts'
import { DEFAULT_ANALYSIS, normalizeAnalysis, type KsigProject } from './project.ts'
import { isWindowName } from './windows.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface Hooks {
  state(): { project: KsigProject; samples: Float64Array | null; dirty: boolean }
  /** Puts a filter in the Filter tab; with `apply` also applies it to the signal. */
  setFilter(spec: FilterSpec, apply: boolean): void
  openExample(ex: Example): Promise<void>
  /** Shows a generated signal in the window as a new project. */
  showSignal(source: KsigProject['source'], name: string): void
}

const round = (v: number, d = 6): number => (Number.isFinite(v) ? Number(v.toPrecision(d)) : v)

/** The numbers of a summary rounded for a model to read. */
export function compactSummary(s: AnalysisSummary): Record<string, unknown> {
  return {
    name: s.name,
    sampleRate: s.fs,
    samples: s.samples,
    duration: round(s.duration),
    stats: { mean: round(s.stats.mean), rms: round(s.stats.rms), min: round(s.stats.min), max: round(s.stats.max), crest: round(s.stats.crest) },
    spectrum: { window: s.spectrum.window, fftLength: s.spectrum.nfft, binWidthHz: round(s.spectrum.binWidth), noiseBandwidthBins: round(s.spectrum.enbw, 4) },
    peaks: s.peaks.map((p, i) => ({ n: i + 1, freqHz: round(p.freq, 7), amplitude: round(p.amp, 5), db: round(p.ampDb, 4), phaseDeg: round(p.phaseDeg, 4) })),
    ...(s.tone ? {
      toneMetrics: {
        fundamentalHz: round(s.tone.fundamental, 7), amplitude: round(s.tone.amplitude, 5), thdPercent: round(s.tone.thdPercent, 4), thdDb: round(s.tone.thdDb, 4), snrDb: round(s.tone.snrDb, 4),
        sinadDb: round(s.tone.sinadDb, 4), enobBits: round(s.tone.enob, 3), sfdrDb: round(s.tone.sfdrDb, 4), harmonics: s.tone.harmonics.map((h) => ({ order: h.order, freqHz: round(h.freq, 7), db: round(h.db, 4) })),
      },
    } : {}),
    ...(s.timePeaks ? {
      timePeaks: {
        count: s.timePeaks.count,
        ...(s.timePeaks.heartRate ? { meanRRSeconds: round(s.timePeaks.heartRate.meanRR), beatsPerMinute: round(s.timePeaks.heartRate.bpm, 5), sdnnSeconds: round(s.timePeaks.heartRate.sdnn) } : {}),
      },
    } : {}),
  }
}

export function ksignalTools(h: Hooks): Tools {
  return {
    get_state: async () => {
      const { project, samples, dirty } = h.state()
      const base = {
        name: project.name,
        synthetic: !!project.synthetic,
        source: project.source.kind === 'generator' ? { kind: 'generator', sampleRate: project.source.fs, duration: project.source.duration, components: project.source.components.map((c) => c.type), noiseSigma: project.source.noise.sigma, bits: project.source.bits } : { kind: 'data', name: project.source.name, sampleRate: project.source.fs, samples: project.source.count },
        tab: project.tab,
        process: describeProcess(project.process),
        filter: describeSpec(project.filter),
        unsavedChanges: dirty,
        analysis: { window: project.analysis.window, fftSize: project.analysis.fftSize, mode: project.analysis.mode, analyse: project.analysis.analyse },
      }
      try {
        return { ...base, results: compactSummary(analyzeProject(project, samples)) }
      } catch (e) {
        return { ...base, problem: e instanceof Error ? e.message : String(e) }
      }
    },

    analyze: async (a, ctx) => {
      const analysis = normalizeAnalysis({ ...DEFAULT_ANALYSIS, ...(h.state().project.analysis) })
      if (a.window !== undefined) {
        if (!isWindowName(a.window)) throw new Error('window: rectangular, hann, hamming, blackman, blackmanharris, flattop or kaiser.')
        analysis.window = a.window
      }
      if (a.fft_size !== undefined && a.fft_size !== null) analysis.fftSize = Math.max(0, Math.round(Number(a.fft_size) || 0))
      if (a.max_peaks !== undefined && a.max_peaks !== null) analysis.maxPeaks = Math.max(1, Math.min(50, Math.round(Number(a.max_peaks) || 10)))
      if (a.fundamental !== undefined && a.fundamental !== null) analysis.fundamental = Math.max(0, Number(a.fundamental) || 0)
      if (a.signal && typeof a.signal === 'object') {
        const source = normalizeGenerator(a.signal)
        const problems = sourceProblems(source)
        if (problems.length) throw new Error(problems[0])
        const p = { ...h.state().project, source, analysis, process: { type: 'none' as const }, name: 'AI signal', synthetic: true }
        const r = runProject(p)
        const out = compactSummary(summarizeTrace('AI signal', r.original, analysis))
        if (a.show === true) {
          if (h.state().dirty && !(await ctx.confirm('Replace the signal in kSignal', 'The current signal has changes that are not saved.'))) return { ...out, shown: false }
          h.showSignal(source, 'AI signal')
          return { ...out, shown: true }
        }
        return out
      }
      const { project, samples } = h.state()
      return compactSummary(analyzeProject({ ...project, analysis: { ...analysis, analyse: project.analysis.analyse } }, samples))
    },

    design_filter: async (a) => {
      const { project } = h.state()
      const fs = a.fs !== undefined && a.fs !== null && Number(a.fs) > 0 ? Number(a.fs) : project.source.fs
      const raw = a.spec && typeof a.spec === 'object' ? (a.spec as Record<string, unknown>) : {}
      const spec = normalizeFilterSpec({ ...project.filter, ...raw, coeffs: undefined })
      if (spec.family === 'scipy') throw new Error('family: butter, cheby1, cheby2, fir or notch (scipy designs are made in the Filter tab).')
      const d = designFilter(spec, fs)
      const m = filterMetrics(d)
      const out: Record<string, unknown> = {
        design: d.label, sampleRate: fs, kind: m.kind, size: m.size, stable: m.stable,
        dcGainDb: round(m.dcGainDb, 5), nyquistGainDb: round(m.nyquistGainDb, 5), peakGainDb: round(m.peakGainDb, 5), cutoffs3dBHz: m.cutoffs3dB.map((v) => round(v, 6)),
        groupDelaySamplesDc: round(m.groupDelayDc, 5), groupDelayPassbandSpread: round(m.groupDelaySpread, 5), zeroPhase: m.zeroPhase, notes: d.notes,
      }
      if (a.coefficients === true) {
        if (d.sos.length) out.sos = d.sos.map((s) => s.map((v) => round(v, 12)))
        else out.b = d.b.map((v) => round(v, 12))
        if (!d.sos.length && d.a.length > 1) out.a = d.a.map((v) => round(v, 12))
      }
      if (a.apply === true) {
        h.setFilter(spec, true)
        out.applied = true
      }
      return out
    },

    load_example: async (a, ctx) => {
      const id = String(a.id ?? '').trim()
      if (!id) return { examples: EXAMPLES.map((e) => ({ id: e.id, title: e.title, topic: e.group, shows: e.description.split('. ')[0] })), note: 'Call load_example with an id to open one.' }
      const ex = exampleById(id)
      if (!ex) throw new Error(`No example “${id}”: call load_example without an id to list them.`)
      if (h.state().dirty && !(await ctx.confirm(`Open the example “${ex.title}”`, 'The current signal has changes that are not saved.'))) throw new Error('The user did not allow replacing the current signal.')
      await h.openExample(ex)
      // the numbers of the example itself (the window shows it after its next render)
      return { loaded: ex.title, description: ex.description, ...compactSummary(analyzeProject(ex.project, null)) }
    },
  }
}
