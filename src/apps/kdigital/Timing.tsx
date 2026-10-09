// The timing diagram: the probes of the simulation as WaveDrom waveforms (buses included), two cursors with
// the values under them, glitch notes, the list of probes, and export as SVG / PNG / WaveJSON.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Download, Image as ImageIcon, MousePointer2, Plus, X, ZoomIn, ZoomOut } from 'lucide-react'
import { os } from '@/os'
import { findGlitches } from './session'
import { parseProbeSpec, probeTextAt, waveJson, type Probe, type WaveJson } from './wave'
import { drawCursors, renderWave, serializeSvg, svgToPng, type WaveInfo } from './waveDom'
import type { Simulator } from './sim'

export interface TimingExport { kind: 'svg' | 'png' | 'json'; data: string | Uint8Array }

interface Props {
  sim: Simulator | null
  /** changes on every simulation step */
  tick: number
  probes: Probe[]
  custom: boolean
  running: boolean
  unit: string
  onProbes(p: Probe[] | null): void
  onExport(e: TimingExport): void
  onClose?(): void
}

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
const COLUMNS = 100

function autoStep(end: number, cols: number): number {
  for (const s of STEPS) if (Math.ceil(end / s) + 1 <= cols) return s
  return STEPS[STEPS.length - 1]
}

export function Timing({ sim, tick, probes, custom, running, unit, onProbes, onExport, onClose }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const meta = useRef<{ svg: SVGSVGElement; info: WaveInfo; t0: number; step: number } | null>(null)
  const json = useRef<WaveJson | null>(null)
  const [stepSetting, setStepSetting] = useState<'auto' | number>('auto')
  const [hscale, setHscale] = useState(1)
  const [follow, setFollow] = useState(true)
  const [start, setStart] = useState(0)
  const [cursors, setCursors] = useState<[number | null, number | null]>([null, null])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const last = useRef(0)
  const cursorsRef = useRef(cursors)
  cursorsRef.current = cursors
  const end = sim ? Math.max(sim.time, 1) : 1
  const step = stepSetting === 'auto' ? autoStep(end, COLUMNS) : stepSetting
  const t0 = follow ? Math.max(0, Math.ceil((end - (COLUMNS - 1) * step) / step) * step) : Math.min(start, Math.max(0, end - step))

  const paintCursors = useCallback(() => {
    const m = meta.current
    if (!m) return
    const cs = cursorsRef.current
    const list: { name: string; column: number }[] = []
    cs.forEach((t, i) => { if (t !== null) { const col = (t - m.t0) / m.step; if (col >= -0.01 && col <= m.info.columns) list.push({ name: i === 0 ? 'A' : 'B', column: col }) } })
    drawCursors(m.svg, m.info, list)
  }, [])

  const draw = useCallback(async () => {
    last.current = Date.now()
    if (!sim || probes.length === 0) { host.current?.replaceChildren(); meta.current = null; json.current = null; return }
    try {
      const w = waveJson(sim, probes, { t0, t1: end, step, hscale })
      const labels = Array.from({ length: w.columns }, (_, i) => String(t0 + i * step))
      const { svg, info } = await renderWave(w, labels)
      json.current = { signal: w.signal, config: w.config, head: { tick: 0 } }
      meta.current = { svg, info, t0, step }
      host.current?.replaceChildren(svg)
      paintCursors()
      setError(null)
      if (follow && running && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [sim, probes, t0, end, step, hscale, follow, running, paintCursors])

  // redraw at most four times a second while it runs
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    const wait = running ? Math.max(0, 250 - (Date.now() - last.current)) : 0
    timer.current = window.setTimeout(() => { void draw() }, wait)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, tick])

  useEffect(() => { paintCursors() }, [cursors, paintCursors])

  const onClick = (e: React.MouseEvent) => {
    const m = meta.current
    if (!m) return
    const svg = m.svg
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const p = pt.matrixTransform(ctm.inverse())
    const x = p.x - m.info.laneX
    if (x < -m.info.colW / 2) return
    const col = Math.max(0, Math.min(m.info.columns - 1, Math.round(x / m.info.colW)))
    const t = m.t0 + col * m.step
    setCursors((c) => (e.shiftKey || e.altKey ? [c[0], t] : [t, c[1]]))
  }

  const glitches = useMemo(() => {
    if (!sim) return []
    const out: { signal: string; time: number }[] = []
    for (const p of probes) for (const g of findGlitches(sim, p, 2, sim.time)) out.push({ signal: p.name, time: g.time })
    return out.slice(0, 6)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, probes, tick])

  const exportSvg = () => { const m = meta.current; if (m) onExport({ kind: 'svg', data: serializeSvg(m.svg) }) }
  const exportPng = async () => {
    const m = meta.current
    if (!m) return
    try {
      const text = serializeSvg(m.svg)
      const w = Number(m.svg.getAttribute('width')) || 800
      const h = Number(m.svg.getAttribute('height')) || 200
      onExport({ kind: 'png', data: await svgToPng(text, w, h, 2) })
    } catch (e) { await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Export' }) }
  }
  const exportJson = () => { if (json.current) onExport({ kind: 'json', data: JSON.stringify(json.current, null, 2) + '\n' }) }

  const addProbe = () => {
    const p = parseProbeSpec(adding)
    if (typeof p === 'string') { setAddError(p); return }
    if (sim) {
      const missing = p.bits.filter((b) => sim.netIndex(b) < 0)
      if (missing.length) { setAddError(`No net, signal or pin called ${missing.join(', ')}.`); return }
    }
    setAddError(null)
    setAdding('')
    onProbes([...probes, p])
  }

  const rows = probes.map((p) => ({ p, a: cursors[0] !== null && sim ? probeTextAt(sim, p, cursors[0]) : '', b: cursors[1] !== null && sim ? probeTextAt(sim, p, cursors[1]) : '' }))

  return (
    <div className="dg-timing">
      <div className="dg-timing-bar">
        <b className="dg-timing-title">Timing diagram</b>
        <label className="dg-inline">Step
          <select className="k-input" value={String(stepSetting)} aria-label="Time units per column" onChange={(e) => setStepSetting(e.target.value === 'auto' ? 'auto' : Number(e.target.value))}>
            <option value="auto">auto ({step} {unit})</option>
            {STEPS.map((s) => <option key={s} value={s}>{s} {unit}</option>)}
          </select>
        </label>
        <button className="k-icon-btn" title="Narrower columns" aria-label="Narrower columns" disabled={hscale <= 1} onClick={() => setHscale((h) => Math.max(1, h - 1))}><ZoomOut size={14} /></button>
        <button className="k-icon-btn" title="Wider columns" aria-label="Wider columns" disabled={hscale >= 4} onClick={() => setHscale((h) => Math.min(4, h + 1))}><ZoomIn size={14} /></button>
        <label className="dg-inline"><input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); if (!e.target.checked) setStart(t0) }} /> Follow</label>
        {!follow && <input type="range" className="dg-range" min={0} max={Math.max(0, end - step)} step={step} value={Math.min(start, Math.max(0, end - step))} aria-label="Window start" onChange={(e) => setStart(Number(e.target.value))} />}
        <span className="k-spacer" />
        <button className="k-icon-btn" title="Clear the cursors" aria-label="Clear the cursors" disabled={cursors[0] === null && cursors[1] === null} onClick={() => setCursors([null, null])}><MousePointer2 size={14} /></button>
        <button className="k-btn" onClick={exportSvg} disabled={!meta.current} title="Save the diagram as SVG"><Download size={13} /> SVG</button>
        <button className="k-btn" onClick={() => void exportPng()} disabled={!meta.current} title="Save the diagram as PNG"><ImageIcon size={13} /> PNG</button>
        <button className="k-btn" onClick={exportJson} disabled={!json.current} title="Save the WaveJSON (open it in wavedrom.com)">WaveJSON</button>
        {onClose && <button className="k-icon-btn" title="Hide the diagram" aria-label="Hide the timing diagram" onClick={onClose}><X size={14} /></button>}
      </div>
      <div className="dg-timing-body">
        <div className="dg-timing-main">
          <div ref={scroller} className="dg-wave-scroll" onClick={onClick}>
            <div ref={host} className="dg-wave-host" />
            {(!sim || probes.length === 0) && (
              <div className="dg-wave-empty">
                {probes.length === 0 ? 'Nothing to show yet: the diagram lists the inputs, clocks and outputs of the circuit. Add a probe below, or use the probe tool on a wire.' : 'Press Run or Step to see the waveforms.'}
              </div>
            )}
            {error && <div className="dg-wave-empty dg-error">{error}</div>}
          </div>
          <div className="dg-probe-bar">
            <span className="dg-probe-chips">
              {probes.map((p, i) => (
                <span key={`${p.name}${i}`} className="dg-chip" title={p.bits.join(', ')}>{p.name}<button aria-label={`Remove probe ${p.name}`} onClick={() => onProbes(probes.filter((_, k) => k !== i))}><X size={11} /></button></span>
              ))}
            </span>
            <form className="dg-probe-add" onSubmit={(e) => { e.preventDefault(); addProbe() }}>
              <input className="k-input" value={adding} placeholder="Add a probe: net, U1.Y or Sum = S3, S2, S1, S0" aria-label="Add a probe" onChange={(e) => { setAdding(e.target.value); setAddError(null) }} />
              <button className="k-btn" type="submit" disabled={!adding.trim()}><Plus size={13} /> Add</button>
              {custom && <button className="k-btn" type="button" onClick={() => onProbes(null)} title="Show every input, clock and output again">Default signals</button>}
            </form>
            {addError && <div className="dg-error dg-small">{addError}</div>}
            {glitches.length > 0 && (
              <div className="dg-glitch" role="status"><AlertTriangle size={13} /> Glitch: {glitches.map((g) => `${g.signal} at t=${g.time}`).join(', ')}{glitches.length >= 6 ? ' …' : ''} (a pulse of one or two time units).</div>
            )}
          </div>
        </div>
        <aside className="dg-readout" aria-label="Values under the cursors">
          <p className="dg-hint k-muted">Click the diagram to place cursor A, Shift-click for B.</p>
          {(cursors[0] !== null || cursors[1] !== null) && (
            <table>
              <thead>
                <tr><th /><th>A{cursors[0] !== null ? ` ${cursors[0]}` : ''}</th><th>B{cursors[1] !== null ? ` ${cursors[1]}` : ''}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => <tr key={r.p.name}><td>{r.p.name}</td><td>{r.a}</td><td>{r.b}</td></tr>)}
                {cursors[0] !== null && cursors[1] !== null && <tr><td>Δt</td><td colSpan={2}>{Math.abs(cursors[1] - cursors[0])} {unit}</td></tr>}
              </tbody>
            </table>
          )}
        </aside>
      </div>
    </div>
  )
}
