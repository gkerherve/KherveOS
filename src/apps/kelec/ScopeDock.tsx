// The oscilloscope / plot panel: traces (V(node), I(part), P(part) or an expression), stacked or shared
// axes, two cursors with a readout, measurements, CSV and PNG export. Bode plots for AC sweeps.

import { useMemo, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Layers, Ruler, X, ChevronDown } from 'lucide-react'
import { ScopeChart, usePalette, type ScopeHandle } from './ScopeChart'
import { scopeFigure } from './figures'
import { acTrace, seriesOf, traceData } from './session'
import type { SimResult } from './sim/engine'
import { cornerFrequency, fallTime, fourier, frequencyOf, resonance, riseTime, stats, valueAt } from './sim/measure'
import { formatValue } from './sim/units'

interface Props {
  result: SimResult
  stale: boolean
  traces: string[]
  stacked: boolean
  signals: string[]
  onTraces(t: string[]): void
  onStacked(b: boolean): void
  onCsv(): void
  onPng(png: Uint8Array): void
  onClose(): void
}

const unit = (e: string) => (/^\s*I/i.test(e) ? 'A' : /^\s*P/i.test(e) ? 'W' : 'V')
const f = (v: number | null | undefined, u = '') => (v === null || v === undefined || !Number.isFinite(v) ? '–' : formatValue(v, 4, u))

export function ScopeDock({ result, stale, traces, stacked, signals, onTraces, onStacked, onCsv, onPng, onClose }: Props) {
  const pal = usePalette()
  const chart = useRef<ScopeHandle>(null)
  const [cursorsOn, setCursorsOn] = useState(false)
  const [cur, setCur] = useState<(number | null)[]>([null, null])
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [fftOn, setFftOn] = useState(false)

  const figure = useMemo(() => scopeFigure(result, { traces, stacked, cursors: cursorsOn ? cur : [] }, pal), [result, traces, stacked, cursorsOn, cur, pal])
  const isAc = result.type === 'ac'

  const addTrace = (expr: string) => {
    const e = expr.trim()
    if (!e) return
    try {
      if (result.type === 'ac') acTrace(result.ac, e)
      else traceData(result, e)
    } catch (x) { setErr(x instanceof Error ? x.message : String(x)); return }
    setErr(null)
    if (!traces.includes(e)) onTraces([...traces, e])
    setDraft('')
  }

  const onClickX = (x: number) => {
    if (!cursorsOn) return
    setCur((c) => (c[0] === null ? [x, null] : c[1] === null ? [c[0], x] : [x, null]))
  }

  const series = seriesOf(result)
  const readout = useMemo(() => {
    const a = cur[0]
    const b = cur[1]
    return traces.map((t) => {
      try {
        if (result.type === 'ac') {
          const tr = acTrace(result.ac, t)
          const at = (x: number | null, k: 'mag' | 'phase') => (x === null ? null : valueAt(result.ac.freq, tr[k], x))
          const db = (x: number | null) => { const m = at(x, 'mag'); return m === null ? null : 20 * Math.log10(Math.max(m, 1e-300)) }
          return { t, a: db(a), b: db(b), pa: at(a, 'phase'), pb: at(b, 'phase'), unit: 'dB' }
        }
        const y = traceData(result, t)
        const x = series!.x
        return { t, a: a === null ? null : valueAt(x, y, a), b: b === null ? null : valueAt(x, y, b), unit: unit(t) }
      } catch { return { t, a: null, b: null, unit: '' } }
    })
  }, [cur, traces, result, series])

  const measures = useMemo(() => {
    if (traces.length === 0) return null
    const t = traces[0]
    try {
      if (result.type === 'ac') {
        const tr = acTrace(result.ac, t)
        const res = resonance(result.ac.freq, tr.mag)
        return [
          ['Gain at the lowest frequency', `${(20 * Math.log10(Math.max(tr.mag[0], 1e-300))).toFixed(2)} dB`],
          ['−3 dB frequency', f(cornerFrequency(result.ac.freq, tr.mag), 'Hz')],
          ['Peak', `${(20 * Math.log10(Math.max(res.peak, 1e-300))).toFixed(2)} dB at ${f(res.f0, 'Hz')}`],
          ['Quality factor Q', res.q === null ? '–' : res.q.toFixed(2)],
        ]
      }
      const y = traceData(result, t)
      const x = series!.x
      const lo = cur[0] !== null && cur[1] !== null ? Math.min(cur[0], cur[1]) : -Infinity
      const hi = cur[0] !== null && cur[1] !== null ? Math.max(cur[0], cur[1]) : Infinity
      const s = stats(x, y, lo, hi)
      const u = unit(t)
      const rows: [string, string][] = [['Minimum', f(s.min, u)], ['Maximum', f(s.max, u)], ['Peak-to-peak', f(s.pp, u)], ['Average', f(s.mean, u)], ['RMS', f(s.rms, u)]]
      if (result.type === 'tran') {
        const fr = frequencyOf(x, y, lo)
        rows.push(['Frequency', fr ? f(fr, 'Hz') : '–'], ['Rise time 10–90 %', f(riseTime(x, y), 's')], ['Fall time', f(fallTime(x, y), 's')])
      }
      return rows
    } catch { return null }
  }, [traces, result, series, cur])

  const spectrum = useMemo(() => {
    if (!fftOn || result.type !== 'tran' || traces.length === 0) return null
    try {
      const y = traceData(result, traces[0])
      const x = series!.x
      const f0 = frequencyOf(x, y)
      if (!f0) return { error: 'No repeating waveform found: run longer so at least two periods are shown.' }
      const cycles = Math.max(1, Math.min(4, Math.floor((x[x.length - 1] - x[0]) * f0) - 1))
      return { f0, ...fourier(x, y, f0, 9, cycles) }
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }, [fftOn, result, traces, series])

  const exportPng = async () => {
    const png = await chart.current?.png(2)
    if (png) onPng(png)
  }

  const a = cur[0]
  const b = cur[1]
  return (
    <div className="ke-scope">
      <div className="ke-scope-bar">
        <b className="ke-scope-title">{isAc ? 'Bode plot' : result.type === 'dc' ? 'DC sweep' : 'Scope'}</b>
        {stale && <span className="ke-stale" title="The circuit changed after this run">out of date</span>}
        <div className="ke-chips">
          {traces.map((t) => (
            <span key={t} className="ke-chip">
              {t}
              <button aria-label={`Remove ${t}`} onClick={() => onTraces(traces.filter((x) => x !== t))}><X size={11} /></button>
            </span>
          ))}
          <input
            className="k-input ke-trace-input" list="ke-signals" value={draft} placeholder="Add trace: V(out), I(R1), V(a)-V(b)…" aria-label="Add a trace"
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addTrace(draft) }} onBlur={() => draft && addTrace(draft)}
          />
          <datalist id="ke-signals">{signals.filter((s) => !traces.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
        </div>
        {!isAc && <button className={`k-icon-btn${stacked ? ' active' : ''}`} title="One plot per trace (linked time axis)" aria-label="Stack the traces" onClick={() => onStacked(!stacked)}><Layers size={14} /></button>}
        <button className={`k-icon-btn${cursorsOn ? ' active' : ''}`} title="Cursors: click the plot to place A, then B" aria-label="Cursors" onClick={() => { setCursorsOn(!cursorsOn); setCur([null, null]) }}><Ruler size={14} /></button>
        <button className="k-icon-btn" title="Save the data as CSV" aria-label="Export CSV" onClick={onCsv}><Download size={14} /></button>
        <button className="k-icon-btn" title="Save the plot as PNG" aria-label="Export PNG" onClick={() => void exportPng()}><ImageIcon size={14} /></button>
        <button className="k-icon-btn" title="Hide the plot" aria-label="Hide the plot" onClick={onClose}><ChevronDown size={14} /></button>
      </div>
      {err && <div className="ke-scope-err">{err}</div>}
      <div className="ke-scope-body">
        <ScopeChart ref={chart} figure={figure} onClickX={onClickX} />
        <aside className="ke-readout">
          {cursorsOn && (
            <table>
              <thead><tr><th /><th>A</th><th>B</th><th>B−A</th></tr></thead>
              <tbody>
                <tr><td>{isAc ? 'f' : result.type === 'dc' ? 'x' : 't'}</td><td>{a === null ? '–' : f(a, isAc ? 'Hz' : result.type === 'tran' ? 's' : '')}</td><td>{b === null ? '–' : f(b, isAc ? 'Hz' : result.type === 'tran' ? 's' : '')}</td><td>{a !== null && b !== null ? f(b - a, isAc ? 'Hz' : result.type === 'tran' ? 's' : '') : '–'}</td></tr>
                {a !== null && b !== null && result.type === 'tran' && b !== a && <tr><td>1/Δt</td><td colSpan={3}>{f(1 / Math.abs(b - a), 'Hz')}</td></tr>}
                {readout.map((r) => (
                  <tr key={r.t}>
                    <td>{r.t}</td><td>{f(r.a, r.unit)}</td><td>{f(r.b, r.unit)}</td><td>{r.a !== null && r.b !== null ? f(r.b - r.a, r.unit) : '–'}</td>
                  </tr>
                ))}
                {isAc && readout.map((r) => <tr key={`${r.t}p`}><td>{r.t} φ</td><td>{'pa' in r && r.pa !== null && r.pa !== undefined ? `${r.pa.toFixed(1)}°` : '–'}</td><td>{'pb' in r && r.pb !== null && r.pb !== undefined ? `${r.pb.toFixed(1)}°` : '–'}</td><td /></tr>)}
              </tbody>
            </table>
          )}
          {measures && (
            <table className="ke-measures">
              <caption>{traces[0]}{!isAc && cur[0] !== null && cur[1] !== null ? ' between A and B' : ''}</caption>
              <tbody>{measures.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody>
            </table>
          )}
          {result.type === 'tran' && traces.length > 0 && (
            <button className="k-btn small" onClick={() => setFftOn(!fftOn)} title="Harmonics and total harmonic distortion of the first trace">{fftOn ? 'Hide harmonics' : 'Harmonics / THD'}</button>
          )}
          {spectrum && 'error' in spectrum && <p className="k-muted ke-hint">{spectrum.error}</p>}
          {spectrum && !('error' in spectrum) && (
            <table className="ke-measures">
              <caption>{traces[0]} · fundamental {f(spectrum.f0, 'Hz')} · THD {(spectrum.thd * 100).toFixed(2)} %</caption>
              <thead><tr><td>#</td><td>Level</td><td>% of 1st</td></tr></thead>
              <tbody>
                <tr><td>DC</td><td>{f(spectrum.dc, unit(traces[0]))}</td><td /></tr>
                {spectrum.harmonics.map((h) => <tr key={h.k}><td>{h.k}</td><td>{f(h.mag, unit(traces[0]))}</td><td>{spectrum.harmonics[0].mag > 0 ? ((h.mag / spectrum.harmonics[0].mag) * 100).toFixed(2) : '–'}</td></tr>)}
              </tbody>
            </table>
          )}
          {!cursorsOn && <p className="k-muted ke-hint">Use the ruler button, then click the plot to place cursors.</p>}
        </aside>
      </div>
    </div>
  )
}
