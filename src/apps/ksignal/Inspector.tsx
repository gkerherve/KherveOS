// The right panel of kSignal: analysis settings, cursors with readouts, the peak table and the signal metrics.

import { Copy, Crosshair } from 'lucide-react'
import { Check, NumField, OptNumField, Section, SelectField } from './Fields'
import type { HeartRate, SignalStats, TimePeak } from './dsp'
import type { AnalysisSettings, Tab } from './project'
import type { SpectrumPeak, ToneMetrics } from './spectrum'
import { fmtHz, fmtNum, fmtTime } from './stats'
import { WINDOW_LABELS, WINDOW_NAMES, type WindowName } from './windows'

export interface Cursors { a: number | null; b: number | null }

export interface InspectorProps {
  tab: Tab
  analysis: AnalysisSettings
  onAnalysis: (patch: Partial<AnalysisSettings>) => void
  hasProcessed: boolean
  fs: number
  stats: SignalStats | null
  spectrum: { df: number; enbw: number; nfft: number; segments?: number } | null
  peaks: readonly SpectrumPeak[]
  tone: ToneMetrics | null
  timePeaks: readonly TimePeak[] | null
  heartRate: HeartRate | null
  /** Period found by autocorrelation, seconds (0: none). */
  period: number
  cursors: Cursors
  onCursors: (c: Cursors) => void
  /** Lines of the cursor readout, e.g. ["A", "1.5 ms, 0.4"]. */
  readouts: Array<[string, string]>
  onPeak: (freq: number) => void
  onCopyPeaks: () => void
}

const FFT_SIZES = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]
const STFT_SIZES = [64, 128, 256, 512, 1024, 2048, 4096, 8192]

export default function Inspector(p: InspectorProps) {
  const a = p.analysis
  const set = p.onAnalysis
  const unit = a.mode === 'welch' ? 'seg' : 'FFT'
  return (
    <div className="sg-panel">
      <Section title="Analysis">
        <SelectField label="Window" value={a.window} onChange={(window) => set({ window })} options={WINDOW_NAMES.map((w) => ({ value: w, label: WINDOW_LABELS[w] }))} />
        {a.window === 'kaiser' && <NumField label="Kaiser β" value={a.beta} min={0} max={30} step={0.5} onChange={(beta) => set({ beta })} />}
        <div className="sg-grid2">
          <SelectField label="Mode" value={a.mode} onChange={(mode) => set({ mode, scale: mode === 'welch' ? 'psd' : a.scale === 'psd' ? 'db' : a.scale })} options={[{ value: 'fft', label: 'Single FFT' }, { value: 'welch', label: 'Welch average' }]} />
          <SelectField label="Scale" value={a.scale} onChange={(scale) => set({ scale })} options={a.mode === 'welch' ? [{ value: 'psd', label: 'PSD (dB/Hz)' }] : [{ value: 'db', label: 'Amplitude dB' }, { value: 'linear', label: 'Amplitude' }]} />
          <SelectField label={`${unit} size`} value={String(a.fftSize)} onChange={(v) => set({ fftSize: Number(v) })} options={[{ value: '0', label: 'Auto' }, ...FFT_SIZES.map((n) => ({ value: String(n), label: String(n) }))]} title="Samples per FFT (Auto: the whole signal, up to 65536)" />
          {a.mode === 'welch'
            ? <SelectField label="Overlap" value={String(a.overlap)} onChange={(v) => set({ overlap: Number(v) })} options={[0, 0.25, 0.5, 0.75].map((o) => ({ value: String(o), label: `${o * 100}%` }))} title="Overlap of the averaged segments" />
            : <NumField label="Start" unit="s" value={a.start} min={0} step={0.1} onChange={(start) => set({ start })} title="Where the analysed segment starts" />}
          <OptNumField label="Max freq" unit="Hz" value={a.fMax} autoLabel="Nyquist" min={1} step={100} onChange={(fMax) => set({ fMax })} />
          <SelectField label="Axis" value={a.logFreq ? 'log' : 'lin'} onChange={(v) => set({ logFreq: v === 'log' })} options={[{ value: 'lin', label: 'Linear' }, { value: 'log', label: 'Log' }]} />
          <NumField label="Floor" unit="dB" value={a.dbMin} max={-10} step={10} onChange={(dbMin) => set({ dbMin })} />
          <OptNumField label="Ceiling" unit="dB" value={a.dbMax} autoLabel="auto" step={10} onChange={(dbMax) => set({ dbMax })} />
        </div>
        <SelectField label="Analyse" value={a.analyse} onChange={(analyse) => set({ analyse })} disabled={!p.hasProcessed} options={[{ value: 'original', label: 'Original trace' }, { value: 'processed', label: 'Processed trace' }]} />
        {p.spectrum && (
          <div className="sg-hint k-muted">
            Bin width {fmtHz(p.spectrum.df)} · noise bandwidth {fmtNum(p.spectrum.enbw, 4)} bins · {p.spectrum.nfft.toLocaleString('en')} points{p.spectrum.segments ? ` × ${p.spectrum.segments} segments` : ''}
          </div>
        )}
      </Section>

      {p.tab === 'spectrogram' && (
        <Section title="Spectrogram">
          <div className="sg-grid2">
            <SelectField label="Segment" value={String(a.stftSize)} onChange={(v) => set({ stftSize: Number(v) })} options={STFT_SIZES.map((n) => ({ value: String(n), label: `${n} samples` }))} title="Longer: finer in frequency, blurrier in time" />
            <SelectField label="Overlap" value={String(a.overlap)} onChange={(v) => set({ overlap: Number(v) })} options={[0, 0.5, 0.75, 0.875, 0.9375].map((o) => ({ value: String(o), label: `${o * 100}%` }))} />
            <NumField label="Floor" unit="dB" value={a.specMin} max={-10} step={10} onChange={(specMin) => set({ specMin })} />
            <OptNumField label="Ceiling" unit="dB" value={a.specMax} autoLabel="auto" step={10} onChange={(specMax) => set({ specMax })} />
          </div>
        </Section>
      )}

      {a.mode === 'fft' && p.tab === 'spectrum' && (
        <Section title="Compare windows" defaultOpen={a.compare.length > 0}>
          <div className="sg-checks">
            {WINDOW_NAMES.filter((w) => w !== a.window).map((w) => (
              <Check key={w} label={WINDOW_LABELS[w]} checked={a.compare.includes(w)} onChange={(on) => set({ compare: on ? [...a.compare, w as WindowName] : a.compare.filter((x) => x !== w) })} />
            ))}
          </div>
          <div className="sg-hint k-muted">Overlays the spectrum of the same segment with other windows: main-lobe width against side-lobe level.</div>
        </Section>
      )}

      <Section title="Cursors">
        <div className="sg-grid2">
          <OptNumField label="A" unit={p.tab === 'time' ? 's' : 'Hz'} value={p.cursors.a} autoLabel="none" onChange={(a2) => p.onCursors({ ...p.cursors, a: a2 })} />
          <OptNumField label="B" unit={p.tab === 'time' ? 's' : 'Hz'} value={p.cursors.b} autoLabel="none" onChange={(b2) => p.onCursors({ ...p.cursors, b: b2 })} />
        </div>
        <div className="sg-hint k-muted"><Crosshair size={12} style={{ verticalAlign: '-2px' }} /> Click the plot to place A, Shift-click (or choose B above the plot) to place B.</div>
        {p.readouts.length > 0 && (
          <dl className="sg-readout">
            {p.readouts.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
          </dl>
        )}
        {(p.cursors.a !== null || p.cursors.b !== null) && <button type="button" className="k-btn small" onClick={() => p.onCursors({ a: null, b: null })}>Clear cursors</button>}
      </Section>

      <Section title={`Peaks (${p.peaks.length})`} extra={<button type="button" className="k-icon-btn" title="Copy the peak table" aria-label="Copy the peak table" disabled={!p.peaks.length} onClick={p.onCopyPeaks}><Copy size={13} /></button>}>
        {p.peaks.length === 0 ? <div className="sg-hint k-muted">No peaks in the range. Lower the threshold below or look at the Spectrum tab.</div> : (
          <table className="sg-table">
            <thead><tr><th>#</th><th>Frequency</th><th>Amp.</th><th>dB</th><th>Phase</th></tr></thead>
            <tbody>
              {[...p.peaks].map((q, i) => (
                <tr key={i} tabIndex={0} onClick={() => p.onPeak(q.freq)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onPeak(q.freq) } }} title="Place cursor A on this peak">
                  <td>{i + 1}</td><td>{fmtNum(q.freq, 7)} Hz</td><td>{fmtNum(q.amp, 4)}</td><td>{fmtNum(q.ampDb, 4)}</td><td>{fmtNum(((q.phase ?? 0) * 180) / Math.PI, 3)}°</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="sg-grid2">
          <NumField label="Range" unit="dB" value={a.peakRangeDb} min={6} step={10} onChange={(peakRangeDb) => set({ peakRangeDb })} title="Ignore peaks this far below the highest" />
          <NumField label="Most" value={a.maxPeaks} min={1} max={100} step={1} onChange={(maxPeaks) => set({ maxPeaks: Math.round(maxPeaks) })} />
        </div>
        <div className="sg-hint k-muted">Phase is that of a cosine at the start of the segment (a sine reads −90°).</div>
      </Section>

      <Section title="Metrics">
        {p.stats ? (
          <dl className="sg-readout">
            <div><dt>Samples</dt><dd>{p.stats.n.toLocaleString('en')} at {fmtHz(p.fs)}</dd></div>
            <div><dt>Mean</dt><dd>{fmtNum(p.stats.mean)}</dd></div>
            <div><dt>RMS</dt><dd>{fmtNum(p.stats.rms)} ({fmtNum(20 * Math.log10(Math.max(p.stats.rms, 1e-30)), 4)} dB)</dd></div>
            <div><dt>Min / max</dt><dd>{fmtNum(p.stats.min)} / {fmtNum(p.stats.max)}</dd></div>
            <div><dt>Crest factor</dt><dd>{fmtNum(p.stats.crest)}</dd></div>
          </dl>
        ) : <div className="sg-hint k-muted">No signal.</div>}
        <NumField label="Fundamental" unit="Hz" value={a.fundamental} autoValue={0} autoLabel="strongest peak" min={0} step={10} onChange={(fundamental) => set({ fundamental })} title="For THD, SNR, SINAD and ENOB" />
        {p.tone ? (
          <dl className="sg-readout">
            <div><dt>Fundamental</dt><dd>{fmtNum(p.tone.fundamental, 7)} Hz, {fmtNum(p.tone.amplitude, 5)}</dd></div>
            <div><dt>THD</dt><dd>{fmtNum(p.tone.thdPercent, 4)} % ({fmtNum(p.tone.thdDb, 4)} dB)</dd></div>
            <div><dt>SNR</dt><dd>{fmtNum(p.tone.snrDb, 4)} dB</dd></div>
            <div><dt>SINAD</dt><dd>{fmtNum(p.tone.sinadDb, 4)} dB</dd></div>
            <div><dt>ENOB</dt><dd>{fmtNum(p.tone.enob, 4)} bits</dd></div>
            <div><dt>SFDR</dt><dd>{fmtNum(p.tone.sfdrDb, 4)} dB</dd></div>
            {p.tone.harmonics.filter((h) => h.amp > 0).slice(0, 4).map((h) => (<div key={h.order}><dt>H{h.order}</dt><dd>{fmtNum(h.freq, 6)} Hz, {fmtNum(h.db, 4)} dB</dd></div>))}
          </dl>
        ) : <div className="sg-hint k-muted">Tone metrics need a clear tone.</div>}
        <div className="sg-hint k-muted">Valid for a signal with one dominant tone; use a window with low side lobes.</div>
        <dl className="sg-readout">
          <div><dt>Period (autocorr.)</dt><dd>{p.period > 0 ? `${fmtTime(p.period)} → ${fmtHz(1 / p.period)}` : 'none found'}</dd></div>
        </dl>
      </Section>

      <Section title="Peaks in time" defaultOpen={a.timePeaks.enabled}>
        <Check label="Detect peaks (R peaks, pulses)" checked={a.timePeaks.enabled} onChange={(enabled) => set({ timePeaks: { ...a.timePeaks, enabled } })} />
        {a.timePeaks.enabled && (
          <>
            <div className="sg-grid2">
              <NumField label="Height ≥" value={a.timePeaks.height} step={0.05} onChange={(height) => set({ timePeaks: { ...a.timePeaks, height } })} />
              <NumField label="Apart" unit="s" value={a.timePeaks.minDistance} min={0} step={0.05} onChange={(minDistance) => set({ timePeaks: { ...a.timePeaks, minDistance } })} />
            </div>
            <dl className="sg-readout">
              <div><dt>Peaks</dt><dd>{p.timePeaks?.length ?? 0}</dd></div>
              {p.heartRate && <>
                <div><dt>Mean R–R</dt><dd>{fmtTime(p.heartRate.meanRR)}</dd></div>
                <div><dt>Rate</dt><dd>{fmtNum(p.heartRate.bpm, 4)} per minute</dd></div>
                <div><dt>SDNN</dt><dd>{fmtTime(p.heartRate.sdnn)}</dd></div>
              </>}
            </dl>
          </>
        )}
      </Section>
    </div>
  )
}
