// The side panels: parameters (sliders with units and numeric entry), readouts, overlays, the stopwatch and the data table.

import { useEffect, useRef, useState } from 'react'
import { Copy, Download, LineChart, Table2, Trash2 } from 'lucide-react'
import { METHODS, type Method } from './integrators'
import { fmt, paramsOf } from './common'
import type { Recorder } from './analysis'
import type { Overlays, Scales } from './render'
import type { Channel, ModeDef, ParamDef, ParamValue, Params, Preset, Readout, SceneDef, NumberParam } from './types'

// ------------------------------------------------------------------------------------------ parameters

const decimals = (step: number) => {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : Math.min(6, s.length - i - 1)
}

function formatParam(v: number, d: NumberParam): string {
  if (!Number.isFinite(v)) return ''
  const dg = d.digits ?? (d.step ? decimals(d.step) : 3)
  if (d.scale === 'log' || Math.abs(v) < 1e-3 && v !== 0) return Number(v.toPrecision(4)).toString()
  return v.toFixed(dg)
}

function NumberRow({ d, value, onChange }: { d: NumberParam; value: number; onChange(v: number): void }) {
  const log = d.scale === 'log'
  const toS = (v: number) => (log ? Math.log(v / d.min) / Math.log(d.max / d.min) : (v - d.min) / (d.max - d.min))
  const fromS = (s: number) => {
    const raw = log ? d.min * Math.pow(d.max / d.min, s) : d.min + s * (d.max - d.min)
    if (log) return Number(raw.toPrecision(3))
    return d.step ? Math.round(raw / d.step) * d.step : raw
  }
  const [text, setText] = useState(formatParam(value, d))
  const focus = useRef(false)
  useEffect(() => { if (!focus.current) setText(formatParam(value, d)) }, [value, d])
  const clamp = (v: number) => Math.min(d.max, Math.max(d.min, v))
  const commit = () => {
    const n = Number(text.replace(',', '.'))
    if (Number.isFinite(n)) onChange(clamp(n))
    else setText(formatParam(value, d))
  }
  const id = `mo-p-${d.key}`
  return (
    <div className="mo-field">
      <label htmlFor={id}>
        <span>{d.label}</span>
        {d.unit && <em>{d.unit}</em>}
      </label>
      <div className="mo-ctl">
        <input
          type="range" min={0} max={1000} step={1} aria-label={`${d.label} slider`}
          value={Math.round(1000 * Math.min(1, Math.max(0, toS(clamp(value)))))}
          onChange={(e) => onChange(clamp(Number(fromS(Number(e.target.value) / 1000).toFixed(8))))}
        />
        <input
          id={id} className="k-input" inputMode="decimal" value={text}
          onFocus={() => { focus.current = true }}
          onBlur={() => { focus.current = false; commit() }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              const st = d.step ?? (d.max - d.min) / 100
              onChange(clamp(Number((value + (e.key === 'ArrowUp' ? st : -st) * (e.shiftKey ? 10 : 1)).toFixed(8))))
            }
          }}
        />
      </div>
      {d.hint && <small>{d.hint}</small>}
    </div>
  )
}

export function ParamPanel({ scene, mode, params, onChange }: { scene: SceneDef; mode: string; params: Params; onChange(key: string, value: ParamValue): void }) {
  const defs = paramsOf(scene.params, mode).filter((d) => d.key !== 'world' && (!d.when || d.when(params)))
  return (
    <div role="group" aria-label="Parameters">
      {defs.map((d: ParamDef) => {
        if (d.kind === 'number') return <NumberRow key={d.key} d={d} value={typeof params[d.key] === 'number' ? (params[d.key] as number) : d.value} onChange={(v) => onChange(d.key, v)} />
        if (d.kind === 'bool') {
          return (
            <label key={d.key} className="mo-check">
              <input type="checkbox" checked={params[d.key] === true} onChange={(e) => onChange(d.key, e.target.checked)} />
              <span>{d.label}</span>
            </label>
          )
        }
        const cur = typeof params[d.key] === 'string' ? (params[d.key] as string) : d.value
        const short = d.options.length <= 3 && d.options.every((o) => o.label.length < 16)
        return (
          <div className="mo-field" key={d.key}>
            <label htmlFor={`mo-p-${d.key}`}><span>{d.label}</span></label>
            {short ? (
              <div className="mo-seg" role="radiogroup" aria-label={d.label}>
                {d.options.map((o) => (
                  <button key={o.value} role="radio" aria-checked={cur === o.value} className={cur === o.value ? 'on' : ''} onClick={() => onChange(d.key, o.value)}>{o.label}</button>
                ))}
              </div>
            ) : (
              <select id={`mo-p-${d.key}`} className="k-input" value={cur} onChange={(e) => onChange(d.key, e.target.value)}>
                {d.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {d.hint && <small>{d.hint}</small>}
          </div>
        )
      })}
    </div>
  )
}

export function ScenePicker({ scenes, current, onPick }: { scenes: SceneDef[]; current: string; onPick(id: string): void }) {
  return (
    <div className="mo-scenes" role="tablist" aria-label="Scenes">
      {scenes.map((s) => (
        <button key={s.id} role="tab" aria-selected={s.id === current} className={s.id === current ? 'on' : ''} title={s.blurb} onClick={() => onPick(s.id)}>
          {s.name.split(' ')[0].replace('&', '')}
        </button>
      ))}
    </div>
  )
}

export function ModePicker({ modes, mode, onPick }: { modes: ModeDef[]; mode: string; onPick(id: string): void }) {
  if (modes.length < 2) return <p className="mo-blurb">{modes[0]?.blurb}</p>
  const cur = modes.find((m) => m.id === mode)
  return (
    <>
      <div className="mo-row">
        <select className="k-input" aria-label="Model" value={mode} onChange={(e) => onPick(e.target.value)}>
          {modes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      <p className="mo-blurb">{cur?.blurb}</p>
    </>
  )
}

export function PresetChips({ presets, onPick }: { presets: Preset[]; onPick(p: Preset): void }) {
  if (!presets.length) return null
  return (
    <div className="mo-sec">
      <h4>Presets</h4>
      <div className="mo-chips">
        {presets.map((p) => <button key={p.name} className="mo-chip" onClick={() => onPick(p)}>{p.name}</button>)}
      </div>
    </div>
  )
}

export function IntegratorPicker({ methods, method, onPick }: { methods: Method[]; method: Method; onPick(m: Method): void }) {
  const info = METHODS.find((m) => m.id === method)
  if (!methods.length) return <p className="mo-blurb">This model is solved exactly between events: no integrator to choose.</p>
  return (
    <>
      <div className="mo-row">
        <select className="k-input" aria-label="Integrator" value={method} onChange={(e) => onPick(e.target.value as Method)}>
          {METHODS.filter((m) => methods.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      <p className="mo-blurb">{info ? `Order ${info.order}. ${info.note}` : ''}</p>
    </>
  )
}

// ------------------------------------------------------------------------------------------ readouts

export function ReadoutTable({ items }: { items: Readout[] }) {
  if (!items.length) return <p className="mo-blurb">Nothing to read yet.</p>
  return (
    <table className="mo-kv" aria-label="Readouts">
      <tbody>
        {items.map((r, i) => (
          <tr key={i} className={r.tone ?? ''}>
            <th scope="row">{r.label}</th>
            <td>{r.value}{r.theory && <small>{r.theory}</small>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ------------------------------------------------------------------------------------------ overlays

const OVERLAY_ROWS: [keyof Overlays, string][] = [
  ['trails', 'Trails'], ['velocity', 'Velocity vectors'], ['acceleration', 'Acceleration vectors'], ['force', 'Net force vectors'], ['com', 'Centre of mass'],
  ['energy', 'Energy bars (KE, PE, total)'], ['grid', 'Grid'], ['scaleBar', 'Scale bar'], ['labels', 'Labels'],
]

export function OverlayPanel({ overlays, scales, onOverlays, onScales, threeD, view3d, on3d }: {
  overlays: Overlays; scales: Scales; onOverlays(o: Overlays): void; onScales(s: Scales): void; threeD: boolean; view3d: boolean; on3d(b: boolean): void
}) {
  const sl = (key: keyof Scales, label: string) => (
    <div className="mo-field" key={key}>
      <label><span>{label} scale</span><em>×{fmt(scales[key], 2)}</em></label>
      <input type="range" min={-100} max={100} step={1} aria-label={`${label} arrow scale`} value={Math.round((Math.log(scales[key]) / Math.log(10)) * 50)} onChange={(e) => onScales({ ...scales, [key]: Math.pow(10, Number(e.target.value) / 50) })} />
    </div>
  )
  return (
    <div>
      {OVERLAY_ROWS.map(([k, label]) => (
        <label className="mo-check" key={k}>
          <input type="checkbox" checked={overlays[k]} onChange={(e) => onOverlays({ ...overlays, [k]: e.target.checked })} />
          <span>{label}</span>
        </label>
      ))}
      {threeD && (
        <label className="mo-check">
          <input type="checkbox" checked={view3d} onChange={(e) => on3d(e.target.checked)} />
          <span>3-D view (drag to rotate)</span>
        </label>
      )}
      {overlays.velocity && sl('velocity', 'Velocity')}
      {overlays.acceleration && sl('acceleration', 'Acceleration')}
      {overlays.force && sl('force', 'Force')}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ stopwatch

export interface StopwatchState {
  running: boolean
  /** Simulated time at the last start, and the time accumulated before it. */
  from: number
  acc: number
  laps: number[]
}

export const newStopwatch = (): StopwatchState => ({ running: false, from: 0, acc: 0, laps: [] })
export const stopwatchValue = (s: StopwatchState, t: number) => s.acc + (s.running ? t - s.from : 0)

export function Stopwatch({ state, t, unit, onChange }: { state: StopwatchState; t: number; unit: string; onChange(s: StopwatchState): void }) {
  const v = stopwatchValue(state, t)
  return (
    <div>
      <div className="mo-stopwatch" aria-live="off">{v.toFixed(3)} {unit}</div>
      <div className="mo-row">
        <button className="k-btn small" onClick={() => onChange(state.running ? { ...state, running: false, acc: v } : { ...state, running: true, from: t })}>{state.running ? 'Stop' : 'Start'}</button>
        <button className="k-btn small" disabled={!state.running} onClick={() => onChange({ ...state, laps: [...state.laps, v].slice(-12) })}>Lap</button>
        <button className="k-btn small" onClick={() => onChange(newStopwatch())}>Reset</button>
      </div>
      <p className="mo-blurb">Runs on simulated time, so slow motion does not change what you measure.</p>
      {state.laps.length > 0 && <ol className="mo-laps">{state.laps.map((l, i) => <li key={i}>{i + 1}. {l.toFixed(3)} {unit}{i > 0 ? `  (+${(l - state.laps[i - 1]).toFixed(3)})` : ''}</li>)}</ol>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------ data table

export function DataPanel({ rec, channels, tick, interval, onInterval, onClear, onCopy, onCsv, onKplot, onKstats, unit }: {
  rec: Recorder; channels: Channel[]; tick: number; interval: number; onInterval(v: number): void; onClear(): void; onCopy(cols: string[]): void; onCsv(cols: string[]): void
  onKplot(cols: string[]): void; onKstats(cols: string[]): void; unit: string
}) {
  const [cols, setCols] = useState<string[] | null>(null)
  const [text, setText] = useState(String(interval))
  useEffect(() => setText(String(Number(interval.toPrecision(4)))), [interval])
  const shown = cols ?? defaultColumns(channels)
  void tick
  const idx = shown.map((k) => rec.columns.indexOf(k)).filter((i) => i >= 0)
  const rows = rec.rows.slice(-400)
  return (
    <div className="mo-data">
      <div className="mo-data-bar">
        <label>
          every{' '}
          <input
            className="k-input" inputMode="decimal" aria-label={`Recording interval in ${unit}`} value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => { const n = Number(text); if (n > 0) onInterval(n); else setText(String(interval)) }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />{' '}
          {unit}
        </label>
        <span className="k-muted">{rec.rows.length} rows</span>
        <span style={{ flex: 1 }} />
        <button className="k-btn small" onClick={() => onCopy(shown)} title="Copy the table (tab separated)"><Copy size={13} /> Copy</button>
        <button className="k-btn small" onClick={() => onCsv(shown)}><Download size={13} /> CSV…</button>
        <button className="k-btn small" onClick={() => onKplot(shown)} title="Open the data in kPlot"><LineChart size={13} /> kPlot</button>
        <button className="k-btn small" onClick={() => onKstats(shown)} title="Open the data in kStats"><Table2 size={13} /> kStats</button>
        <button className="k-btn small" onClick={onClear}><Trash2 size={13} /> Clear</button>
      </div>
      <div className="mo-colpick" role="group" aria-label="Columns">
        {channels.map((c) => (
          <label key={c.key}>
            <input type="checkbox" checked={shown.includes(c.key)} onChange={(e) => setCols(e.target.checked ? [...shown, c.key] : shown.filter((k) => k !== c.key))} />
            {c.label}{c.unit ? ` (${c.unit})` : ''}
          </label>
        ))}
      </div>
      <div className="mo-table-wrap">
        {rows.length === 0 ? (
          <p className="mo-blurb" style={{ padding: 12 }}>No data yet. Press Play: a row is recorded every Δt of simulated time.</p>
        ) : (
          <table className="mo-table">
            <thead><tr>{idx.map((i) => <th key={rec.columns[i]}>{rec.columns[i]}</th>)}</tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k}>{idx.map((i) => <td key={i}>{fmt(r[i], 5)}</td>)}</tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function defaultColumns(channels: Channel[]): string[] {
  const prefer = ['t', 'x', 'y', 'vx', 'vy', 'speed', 'theta', 'omega', 'theta1', 'theta2', 'ke', 'pe', 'e', 'px', 'py', 'r']
  const have = new Set(channels.map((c) => c.key))
  const cols = prefer.filter((k) => have.has(k))
  return cols.length > 2 ? cols : channels.slice(0, 8).map((c) => c.key)
}
