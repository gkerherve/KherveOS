// The Markdown report of a kSignal session (pure).

import { describeProcess, type AnalysisSummary } from './analysis.ts'
import { describeSpec } from './filters.ts'
import { COMPONENT_LABELS } from './generators.ts'
import type { KsigProject } from './project.ts'
import { fmtHz, fmtNum, fmtTime } from './stats.ts'
import { WINDOW_LABELS } from './windows.ts'

const row = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`

/** Describes a source in one line. */
export function describeSource(p: KsigProject): string {
  const s = p.source
  if (s.kind === 'data') return `Imported signal “${s.name}” (${s.origin}), ${s.count.toLocaleString('en')} samples at ${fmtHz(s.fs)}`
  const parts = s.components.map((c) => COMPONENT_LABELS[c.type].toLowerCase())
  if (s.noise.sigma > 0) parts.push(`${s.noise.color} noise σ ${fmtNum(s.noise.sigma)}`)
  return `Generated: ${parts.join(' + ') || 'silence'}; ${fmtHz(s.fs)}, ${fmtTime(s.duration)}${s.bits ? `, ${s.bits}-bit quantiser` : ''}`
}

export function buildReport(p: KsigProject, a: AnalysisSummary, date = new Date()): string {
  const L: string[] = []
  L.push(`# kSignal report: ${p.name}`, '')
  if (p.description) L.push(p.description, '')
  if (p.synthetic) L.push('*The signal is synthetic (generated from the specification in the project file).*', '')
  L.push('## Signal', '')
  L.push(`- Source: ${describeSource(p)}`)
  L.push(`- Samples: ${a.samples.toLocaleString('en')} at ${fmtHz(a.fs)} (${fmtTime(a.duration)}), Nyquist ${fmtHz(a.fs / 2)}`)
  L.push(`- Mean ${fmtNum(a.stats.mean)}, RMS ${fmtNum(a.stats.rms)}, minimum ${fmtNum(a.stats.min)}, maximum ${fmtNum(a.stats.max)}, crest factor ${fmtNum(a.stats.crest)}`)
  if (p.process.type !== 'none') L.push(`- Processing: ${describeProcess(p.process)}`)
  L.push('', '## Spectrum', '')
  L.push(`- Window ${WINDOW_LABELS[p.analysis.window]}, FFT length ${a.spectrum.nfft.toLocaleString('en')}, bin width ${fmtHz(a.spectrum.binWidth)}, noise bandwidth ${fmtNum(a.spectrum.enbw)} bins`, '')
  if (a.peaks.length) {
    L.push(row(['#', 'Frequency', 'Amplitude', 'Level (dB re 1)', 'Phase (°)']), row(['--:', '--:', '--:', '--:', '--:']))
    a.peaks.forEach((q, i) => L.push(row([i + 1, `${fmtNum(q.freq, 7)} Hz`, fmtNum(q.amp, 5), fmtNum(q.ampDb, 4), fmtNum(q.phaseDeg, 3)])))
    L.push('', 'Phase is that of a cosine at sample 0 (a sine reads −90°).')
  } else L.push('No peaks above the threshold.')
  if (a.tone) {
    const t = a.tone
    L.push('', '## Tone metrics', '')
    L.push(`- Fundamental ${fmtHz(t.fundamental)}, amplitude ${fmtNum(t.amplitude)}`)
    L.push(`- THD ${fmtNum(t.thdPercent, 3)} % (${fmtNum(t.thdDb, 4)} dB), SNR ${fmtNum(t.snrDb, 4)} dB, SINAD ${fmtNum(t.sinadDb, 4)} dB, ENOB ${fmtNum(t.enob, 3)} bits, SFDR ${fmtNum(t.sfdrDb, 4)} dB`)
  }
  if (a.timePeaks) {
    L.push('', '## Time-domain peaks', '')
    L.push(`- ${a.timePeaks.count} peaks`)
    const hr = a.timePeaks.heartRate
    if (hr) L.push(`- Mean R-R interval ${fmtTime(hr.meanRR)} (${fmtNum(hr.bpm, 4)} beats per minute), SDNN ${fmtTime(hr.sdnn)}`)
  }
  L.push('', '## Filter', '')
  L.push(`- Design: ${describeSpec(p.filter)}${p.filter.zeroPhase ? ', zero phase (forward and backward)' : ''}`)
  L.push(`- Applied to the signal: ${p.process.type === 'filter' ? 'yes' : 'no'}`)
  L.push('', '---', `Made with kSignal in KherveOS on ${date.toISOString().slice(0, 10)}.`, '')
  return L.join('\n')
}
