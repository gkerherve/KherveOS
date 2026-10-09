// The Filter tab: design a filter (Butterworth, Chebyshev I/II, FIR by windows, notch, or an "Advanced (scipy)" design),
// see its magnitude, phase, group delay, poles and zeros and its step / impulse response, compare two designs, apply it
// to the signal and listen to the result.

import { useMemo, useState } from 'react'
import { Copy, Loader2, Play, Square, Wand2 } from 'lucide-react'
import { Check, NumField, Section, SelectField } from './Fields'
import PlotlyChart from './PlotlyChart'
import { filterMetrics } from './filterInfo'
import {
  DEFAULT_FILTER, FAMILY_LABELS, describeSpec, designFilter, kaiserOrder, normalizeFilterSpec,
  type FilterDesign, type FilterFamily, type FilterSpec, type FilterType,
} from './filters'
import { groupDelayFigure, magnitudeFigure, phaseFigure, poleZeroFigure, stepFigure, type DesignLine, type Palette } from './figures'
import type { Process } from './project'
import { crossCheck, parsePythonOutput, pythonDesignCode, PY_METHOD_LABELS, specFromPython, type PyMethod, type PyResult } from './pyfilters'
import { fmtHz, fmtNum, fmtTime } from './stats'
import { WINDOW_LABELS, WINDOW_NAMES } from './windows'

export type PythonRunner = (code: string, onStatus: (text: string) => void) => Promise<string>

export interface FilterTabProps {
  fs: number
  spec: FilterSpec
  compare: FilterSpec | null
  process: Process
  design: FilterDesign | null
  error: string | null
  compareDesign: FilterDesign | null
  pal: Palette
  hasSignal: boolean
  hasProcessed: boolean
  playing: 'original' | 'processed' | null
  onSpec: (patch: Partial<FilterSpec>) => void
  onReplaceSpec: (spec: FilterSpec) => void
  onCompare: (spec: FilterSpec | null) => void
  onApply: () => void
  onRemove: () => void
  onPlay: (which: 'original' | 'processed') => void
  onStop: () => void
  runPython: PythonRunner
}

const TYPE_OPTIONS: Array<{ value: FilterType; label: string }> = [
  { value: 'lowpass', label: 'Low-pass' }, { value: 'highpass', label: 'High-pass' }, { value: 'bandpass', label: 'Band-pass' }, { value: 'bandstop', label: 'Band-stop' },
]

const PY_METHODS: PyMethod[] = ['remez', 'ellip', 'bessel', 'check']

interface PyState {
  busy: boolean
  status: string
  error: string | null
  method: PyMethod
  /** The result of the last run and the spec it made (design methods) or the comparison (check). */
  result: { label: string; spec: FilterSpec | null; check: { maxDiffDb: number; at: number; points: number } | null; scipy: string } | null
}

export default function FilterTab(p: FilterTabProps) {
  const { spec, fs } = p
  const band = spec.type === 'bandpass' || spec.type === 'bandstop'
  const isFir = spec.family === 'fir'
  const [log, setLog] = useState(false)
  const [kAtten, setKAtten] = useState(60)
  const [kWidth, setKWidth] = useState(Math.max(1, Math.round(fs / 80)))
  const [transition, setTransition] = useState(Math.max(1, Math.round(fs / 40)))
  const [py, setPy] = useState<PyState>({ busy: false, status: '', error: null, method: 'remez', result: null })
  const [preview, setPreview] = useState<FilterDesign | null>(null)

  const metrics = useMemo(() => (p.design ? filterMetrics(p.design) : null), [p.design])
  const lines: DesignLine[] = useMemo(() => {
    const out: DesignLine[] = []
    if (p.design) out.push({ design: p.design, name: p.design.label, color: p.pal.accent })
    if (p.compareDesign) out.push({ design: p.compareDesign, name: p.compareDesign.label, color: p.pal.link })
    if (preview) out.push({ design: preview, name: preview.label, color: p.pal.warning })
    return out
  }, [p.design, p.compareDesign, preview, p.pal])
  const figs = useMemo(() => (lines.length ? {
    mag: magnitudeFigure(lines, p.pal, { log }), phase: phaseFigure(lines, p.pal, log), gd: groupDelayFigure(lines, p.pal, log),
    pz: poleZeroFigure(lines, p.pal), step: stepFigure(lines, p.pal, 'step'), imp: stepFigure(lines, p.pal, 'impulse'),
  } : null), [lines, p.pal, log])

  const family = (f: FilterFamily) => {
    if (f === 'scipy') return
    const patch: Partial<FilterSpec> = { family: f, coeffs: undefined }
    if (f === 'fir' && spec.family !== 'fir') patch.order = spec.family === 'scipy' ? 51 : Math.max(21, spec.order * 10 + 1)
    if (f !== 'fir' && (spec.family === 'fir' || spec.family === 'scipy')) patch.order = 4
    if (f === 'notch') patch.type = 'bandstop'
    p.onSpec(patch)
  }
  const familyOptions = (Object.keys(FAMILY_LABELS) as FilterFamily[]).filter((f) => f !== 'scipy' || spec.family === 'scipy').map((f) => ({ value: f, label: FAMILY_LABELS[f] }))

  const compareFrom = (kind: string) => {
    if (!kind) return
    if (kind === 'keep') return p.onCompare(normalizeFilterSpec(JSON.parse(JSON.stringify(spec))))
    const base = { ...DEFAULT_FILTER, type: spec.type, f1: spec.f1, f2: spec.f2, zeroPhase: spec.zeroPhase }
    if (kind === 'butter') p.onCompare({ ...base, family: 'butter', order: isFir || spec.family === 'notch' ? 4 : spec.order })
    else if (kind === 'cheby1') p.onCompare({ ...base, family: 'cheby1', order: isFir || spec.family === 'notch' ? 4 : spec.order, rp: spec.rp })
    else if (kind === 'cheby2') p.onCompare({ ...base, family: 'cheby2', order: isFir || spec.family === 'notch' ? 4 : spec.order, rs: spec.rs })
    else if (kind === 'fir') p.onCompare({ ...base, family: 'fir', order: isFir ? spec.order : 51, window: spec.window, beta: spec.beta })
  }

  const runScipy = async () => {
    setPy((s) => ({ ...s, busy: true, error: null, status: 'Starting Python (the first time it downloads about 10 MB)…', result: null }))
    setPreview(null)
    try {
      const method = py.method
      const code = pythonDesignCode({ method, spec, fs, transition })
      const out = await p.runPython(code, (status) => setPy((s) => ({ ...s, status })))
      const r: PyResult = parsePythonOutput(out)
      if (method === 'check') {
        const cc = crossCheck(spec, fs, r)
        setPy((s) => ({ ...s, busy: false, status: '', result: { label: 'Cross-check', spec: null, check: cc, scipy: r.scipy } }))
      } else {
        const label = `${PY_METHOD_LABELS[method].replace(/ \(.*/, '')} ${spec.type === 'lowpass' ? 'low-pass' : spec.type === 'highpass' ? 'high-pass' : spec.type === 'bandpass' ? 'band-pass' : 'band-stop'}${method === 'remez' ? `, ${spec.order} taps` : `, order ${spec.order}`}`
        const made = specFromPython(spec, r, `${label} (scipy ${r.scipy})`)
        setPreview(designFilter(made, fs))
        setPy((s) => ({ ...s, busy: false, status: '', result: { label, spec: made, check: null, scipy: r.scipy } }))
      }
    } catch (e) {
      setPy((s) => ({ ...s, busy: false, status: '', error: e instanceof Error ? e.message : String(e) }))
    }
  }

  const copyCoefficients = async () => {
    if (!p.design) return
    const d = p.design
    const text = JSON.stringify(d.sos.length ? { fs, sos: d.sos } : { fs, b: d.b, a: d.a }, null, 1)
    try { await navigator.clipboard.writeText(text) } catch { /* no clipboard permission */ }
  }

  return (
    <div className="sg-filter">
      <div className="sg-filter-controls">
        <Section title="Design">
          <SelectField label="Family" value={spec.family} options={familyOptions} onChange={family} />
          <SelectField label="Type" value={spec.family === 'notch' ? 'bandstop' : spec.type} disabled={spec.family === 'notch'} options={TYPE_OPTIONS} onChange={(type) => p.onSpec({ type })} />
          <div className="sg-grid2">
            {spec.family !== 'scipy' && spec.family !== 'notch' && <NumField label={isFir ? 'Taps' : 'Order'} value={spec.order} min={isFir ? 3 : 1} max={isFir ? 8001 : 24} step={isFir ? 2 : 1} onChange={(v) => p.onSpec({ order: Math.round(v) })} />}
            {spec.family !== 'scipy' && <NumField label={spec.family === 'notch' ? 'Notch at' : band ? 'Lower edge' : 'Cutoff'} unit="Hz" value={spec.f1} min={0.001} step={isFir || fs > 20000 ? 100 : 10} onChange={(f1) => p.onSpec({ f1 })} />}
            {spec.family !== 'scipy' && spec.family !== 'notch' && band && <NumField label="Upper edge" unit="Hz" value={spec.f2} min={0.001} step={10} onChange={(f2) => p.onSpec({ f2 })} />}
            {spec.family === 'cheby1' && <NumField label="Ripple" unit="dB" value={spec.rp} min={0.001} max={39} step={0.5} onChange={(rp) => p.onSpec({ rp })} />}
            {spec.family === 'cheby2' && <NumField label="Stopband" unit="dB" value={spec.rs} min={1} max={199} step={5} onChange={(rs) => p.onSpec({ rs })} />}
            {spec.family === 'notch' && <NumField label="Q" value={spec.q} min={0.2} step={5} onChange={(q) => p.onSpec({ q })} title="Quality factor: the −3 dB width is the notch frequency divided by Q" />}
          </div>
          {isFir && (
            <>
              <SelectField label="Window" value={spec.window} options={WINDOW_NAMES.map((w) => ({ value: w, label: WINDOW_LABELS[w] }))} onChange={(window) => p.onSpec({ window })} />
              {spec.window === 'kaiser' && <NumField label="Kaiser β" value={spec.beta} min={0} max={30} step={0.5} onChange={(beta) => p.onSpec({ beta })} />}
              <details className="sg-details">
                <summary>Size from attenuation and transition</summary>
                <div className="sg-grid2">
                  <NumField label="Attenuation" unit="dB" value={kAtten} min={10} step={5} onChange={setKAtten} />
                  <NumField label="Transition" unit="Hz" value={kWidth} min={0.001} step={10} onChange={setKWidth} />
                </div>
                <button type="button" className="k-btn small" onClick={() => { const k = kaiserOrder(kAtten, kWidth, fs); p.onSpec({ window: 'kaiser', order: k.taps, beta: Number(k.beta.toFixed(4)) }) }}><Wand2 size={13} /> Set taps and β (Kaiser)</button>
              </details>
            </>
          )}
          {spec.family === 'scipy' && <div className="sg-hint k-muted">{spec.coeffs?.label ?? 'A filter designed with scipy.'} Pick another family above to design one here.</div>}
          <Check label="Zero phase (forwards and backwards)" checked={spec.zeroPhase} onChange={(zeroPhase) => p.onSpec({ zeroPhase })} title="filtfilt: no delay, the magnitude response is squared" />
          <Check label="Logarithmic frequency axis" checked={log} onChange={setLog} />
          {p.error && (
            <div className="sg-problem" role="alert">
              {p.error}
              {/Nyquist|between/.test(p.error) && <div><button type="button" className="k-btn small" onClick={() => p.onSpec({ f1: Math.round(fs / 8), f2: Math.round(fs / 4) })}>Set the edges to {fmtHz(fs / 8)} and {fmtHz(fs / 4)}</button></div>}
            </div>
          )}
          {p.design?.notes.map((n) => <div key={n} className="sg-hint k-muted">{n}</div>)}
        </Section>

        <Section title="Apply and listen">
          <div className="sg-btnrow">
            <button type="button" className="k-btn primary" disabled={!p.design || !p.hasSignal} onClick={p.onApply}>Apply to signal</button>
            <button type="button" className="k-btn" disabled={p.process.type === 'none'} onClick={p.onRemove}>Remove processing</button>
          </div>
          <div className="sg-hint k-muted">{p.process.type === 'filter' ? 'The processed trace in the Time and Spectrum tabs is this filter’s output.' : p.process.type === 'none' ? 'Applying draws the filtered signal over the original in the Time and Spectrum tabs.' : 'Another processing step is active; applying the filter replaces it.'}</div>
          <div className="sg-btnrow">
            {p.playing ? (
              <button type="button" className="k-btn" onClick={p.onStop}><Square size={13} /> Stop</button>
            ) : (
              <>
                <button type="button" className="k-btn" disabled={!p.hasSignal} onClick={() => p.onPlay('original')}><Play size={13} /> Original</button>
                <button type="button" className="k-btn" disabled={!p.hasProcessed} onClick={() => p.onPlay('processed')}><Play size={13} /> Processed</button>
              </>
            )}
          </div>
        </Section>

        <Section title="Compare with">
          <SelectField label="Second design" value="" onChange={compareFrom}
            options={[{ value: '', label: p.compare ? `Now: ${describeSpec(p.compare)}` : 'None', disabled: true }, { value: 'keep', label: 'Copy of the current design' }, { value: 'butter', label: 'Butterworth, same edges' }, { value: 'cheby1', label: 'Chebyshev I, same edges' }, { value: 'cheby2', label: 'Chebyshev II, same edges' }, { value: 'fir', label: 'FIR (51 taps), same edges' }]}
          />
          {p.compare && <button type="button" className="k-btn small" onClick={() => p.onCompare(null)}>Clear the comparison</button>}
          <div className="sg-hint k-muted">Drawn in blue on every plot. Change the current design to compare.</div>
        </Section>

        <Section title="Advanced (scipy)" defaultOpen={false}>
          <SelectField label="Method" value={py.method} onChange={(method) => setPy((s) => ({ ...s, method, result: null, error: null }))} options={PY_METHODS.map((m) => ({ value: m, label: PY_METHOD_LABELS[m] }))} />
          {py.method === 'remez' && <NumField label="Transition" unit="Hz" value={transition} min={0.001} step={10} onChange={setTransition} title="Width of each transition band" />}
          {py.method === 'ellip' && <div className="sg-hint k-muted">Uses the ripple ({fmtNum(spec.rp)} dB) and stopband ({fmtNum(spec.rs)} dB) values of the Chebyshev designs.</div>}
          {py.method === 'check' && <div className="sg-hint k-muted">Designs the current filter with scipy.signal and reports the largest difference in magnitude.</div>}
          <button type="button" className="k-btn" disabled={py.busy || (py.method !== 'check' && spec.family === 'scipy')} onClick={() => void runScipy()}>
            {py.busy ? <><Loader2 size={13} className="k-spin" /> Running…</> : 'Run in Python'}
          </button>
          {py.busy && <div className="sg-hint k-muted" role="status">{py.status || 'Working…'}</div>}
          {py.error && <div className="sg-problem" role="alert">{py.error}</div>}
          {py.result?.check && (
            <div className="sg-card" role="status">
              scipy {py.result.scipy} and kSignal agree to <strong>{py.result.check.maxDiffDb < 1e-6 ? `${py.result.check.maxDiffDb.toExponential(1)} dB` : `${fmtNum(py.result.check.maxDiffDb, 3)} dB`}</strong> (largest difference over {py.result.check.points} frequencies{py.result.check.maxDiffDb >= 1e-6 ? `, at ${fmtHz(py.result.check.at)}` : ''}).
            </div>
          )}
          {py.result?.spec && (
            <div className="sg-card" role="status">
              <div><strong>{py.result.label}</strong> (scipy {py.result.scipy}) is drawn in amber.</div>
              <div className="sg-btnrow">
                <button type="button" className="k-btn small primary" onClick={() => { p.onReplaceSpec(py.result!.spec!); setPreview(null); setPy((s) => ({ ...s, result: null })) }}>Use this filter</button>
                <button type="button" className="k-btn small" onClick={() => { setPreview(null); setPy((s) => ({ ...s, result: null })) }}>Discard</button>
              </div>
            </div>
          )}
        </Section>

        {metrics && p.design && (
          <Section title="This filter">
            <dl className="sg-readout">
              <div><dt>Kind</dt><dd>{metrics.kind}, {metrics.size} {metrics.kind === 'FIR' ? 'taps' : 'poles'}{metrics.stable ? '' : ' (unstable!)'}</dd></div>
              <div><dt>Gain at DC</dt><dd>{fmtNum(metrics.dcGainDb, 4)} dB</dd></div>
              <div><dt>Gain at Nyquist</dt><dd>{metrics.nyquistGainDb < -250 ? '< −250' : fmtNum(metrics.nyquistGainDb, 4)} dB</dd></div>
              <div><dt>−3 dB at</dt><dd>{metrics.cutoffs3dB.length ? metrics.cutoffs3dB.map((f) => fmtHz(f)).join(', ') : '–'}</dd></div>
              <div><dt>Group delay</dt><dd>{metrics.zeroPhase ? '0 (zero phase)' : `${fmtNum(metrics.groupDelayPass, 4)} samples (${fmtTime(metrics.groupDelayPass / fs)}), varies by ${fmtNum(metrics.groupDelaySpread, 3)}`}</dd></div>
            </dl>
            <details className="sg-details">
              <summary>Coefficients</summary>
              <button type="button" className="k-btn small" onClick={() => void copyCoefficients()}><Copy size={13} /> Copy as JSON</button>
              <div className="sg-coeffs">
                {p.design.sos.length > 0 ? (
                  <table className="sg-table"><thead><tr><th>b0</th><th>b1</th><th>b2</th><th>a1</th><th>a2</th></tr></thead>
                    <tbody>{p.design.sos.map((s, i) => <tr key={i}><td>{fmtNum(s[0], 8)}</td><td>{fmtNum(s[1], 8)}</td><td>{fmtNum(s[2], 8)}</td><td>{fmtNum(s[4], 8)}</td><td>{fmtNum(s[5], 8)}</td></tr>)}</tbody></table>
                ) : (
                  <code>{p.design.b.slice(0, 24).map((v) => fmtNum(v, 6)).join(', ')}{p.design.b.length > 24 ? ` … (${p.design.b.length} taps)` : ''}</code>
                )}
              </div>
            </details>
          </Section>
        )}
      </div>

      <div className="sg-filter-plots">
        {!figs ? <div className="sg-empty k-muted">{p.error ?? 'Choose a design to see its response.'}</div> : (
          <>
            <ChartCard title="Magnitude (dB)"><PlotlyChart figure={figs.mag} /></ChartCard>
            <ChartCard title="Phase"><PlotlyChart figure={figs.phase} /></ChartCard>
            <ChartCard title="Group delay"><PlotlyChart figure={figs.gd} /></ChartCard>
            <ChartCard title="Poles and zeros"><PlotlyChart figure={figs.pz} /></ChartCard>
            <ChartCard title="Step response"><PlotlyChart figure={figs.step} /></ChartCard>
            <ChartCard title="Impulse response"><PlotlyChart figure={figs.imp} /></ChartCard>
          </>
        )}
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="sg-card-chart" aria-label={title}>
      <figcaption>{title}</figcaption>
      <div className="sg-card-chart-body">{children}</div>
    </figure>
  )
}
