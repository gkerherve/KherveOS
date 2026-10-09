// Small shared controls of kClimate: fields, a series picker, baseline and smoothing selectors, a framed chart with
// picture export. Colours come from the theme variables (kclimate.css).

import { forwardRef, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Image as ImageIcon, Info } from 'lucide-react'
import type { Env } from './env'
import PlotlyChart, { type ChartHandle } from './PlotlyChart'
import type { Figure, Palette } from './figures'
import { BASELINES, MONTHS, type SmoothSpec } from './series'
import type { SeriesView } from './project'

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={`cl-field${wide ? ' wide' : ''}`}>
      <span className="cl-label">{label}</span>
      {children}
      {hint && <span className="cl-hint k-muted">{hint}</span>}
    </label>
  )
}

export function Check({ checked, onChange, label, title, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; title?: string; disabled?: boolean }) {
  return (
    <label className="cl-check" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="cl-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  )
}

/** A year, or empty for "no limit". Edits are committed on blur or Enter. */
export function YearInput({ value, onChange, placeholder, label }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; label: string }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => { setText(value === null ? '' : String(value)) }, [value])
  const commit = () => {
    const t = text.trim()
    if (t === '') { if (value !== null) onChange(null); return }
    const n = Math.round(Number(t))
    if (Number.isFinite(n) && n >= -10000 && n <= 3000) { if (n !== value) onChange(n) } else setText(value === null ? '' : String(value))
  }
  return (
    <input
      className="k-input cl-year" inputMode="numeric" aria-label={label} placeholder={placeholder ?? 'any'} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
    />
  )
}

/** A number box that accepts any text while typing and commits valid numbers. */
export function NumInput({ value, onChange, min, max, step, label, width }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; width?: number }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const commit = () => {
    const n = Number(text.replace(',', '.'))
    if (text.trim() !== '' && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) { if (n !== value) onChange(n) } else setText(String(value))
  }
  return (
    <input
      className="k-input cl-num" style={width ? { width } : undefined} inputMode="decimal" aria-label={label} data-step={step} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
    />
  )
}

export function Slider({ label, value, min, max, step, onChange, format, unit }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; unit?: string }) {
  const id = useId()
  return (
    <div className="cl-slider">
      <label htmlFor={id} className="cl-label">{label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output className="cl-value">{format ? format(value) : value}{unit ? ` ${unit}` : ''}</output>
    </div>
  )
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return (
    <div className={`cl-notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      {kind === 'info' ? <Info size={14} /> : <AlertTriangle size={14} />}
      <div>{children}</div>
    </div>
  )
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="cl-card">
      {(title || actions) && <header><h3>{title}</h3>{actions}</header>}
      {children}
    </section>
  )
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`cl-stat${tone ? ` ${tone}` : ''}`}>
      <div className="cl-stat-label">{label}</div>
      <div className="cl-stat-value">{value}</div>
      {sub && <div className="cl-stat-sub k-muted">{sub}</div>}
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="cl-empty">
      <h3>{title}</h3>
      {children && <p className="k-muted">{children}</p>}
      {action}
    </div>
  )
}

/** The panel of settings and the results beside it; the settings fold away in a narrow window. */
export function Split({ env, controls, children }: { env: Env; controls: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const show = env.narrow ? open : env.settings
  return (
    <div className={`cl-split${env.narrow ? ' narrow' : ''}${show ? '' : ' nocontrols'}`}>
      <aside className="cl-controls" aria-label="Settings">
        {env.narrow && <button type="button" className="k-btn small" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide settings' : 'Show settings'}</button>}
        {show && <div className="cl-controls-body">{controls}</div>}
      </aside>
      <div className="cl-results">{children}</div>
    </div>
  )
}

/** A chart with a title, a short caption and buttons that save it as a picture. */
export const ChartFrame = forwardRef<ChartHandle, {
  env: Env
  title: string
  name: string
  build: (pal: Palette) => Figure | null
  height?: number
  caption?: ReactNode
  empty?: string
  primary?: boolean
}>(function ChartFrame({ env, title, name, build, height = 340, caption, empty, primary }, ref) {
  const local = useRef<ChartHandle | null>(null)
  const chartRef = env.chartRef
  const attach = useCallback((h: ChartHandle | null) => {
    local.current = h
    if (typeof ref === 'function') ref(h)
    else if (ref) ref.current = h
    if (primary) chartRef.current = h
  }, [ref, primary, chartRef])
  return (
    <section className="cl-chartframe">
      <header>
        <h3>{title}</h3>
        <span className="cl-spacer" />
        <button type="button" className="k-icon-btn" title="Save the chart as a PNG picture" aria-label="Save chart as PNG" onClick={() => env.saveImage(local.current, 'png', name, title)}><ImageIcon size={14} /></button>
        <button type="button" className="k-btn small" title="Save the chart as an SVG drawing" onClick={() => env.saveImage(local.current, 'svg', name, title)}>SVG</button>
      </header>
      <PlotlyChart ref={attach} build={build} height={height} empty={empty} />
      {caption && <p className="cl-caption k-muted">{caption}</p>}
    </section>
  )
})

// --------------------------------------------------------------------------------------------- series choice

/** The series to choose from, grouped by dataset; for monthly series a month selector gives "id@month". */
export function SeriesPicker({ env, value, onChange, monthlyOnly, allowMonth, label }: { env: Env; value: string; onChange: (ref: string) => void; monthlyOnly?: boolean; allowMonth?: boolean; label: string }) {
  const m = /^(.*)@(\d{1,2})$/.exec(value)
  const base = m ? m[1] : value
  const month = m ? Number(m[2]) : 0
  const refs = monthlyOnly ? env.refs.filter((r) => r.step === 'monthly') : env.refs
  const groups = new Map<string, typeof refs>()
  for (const r of refs) groups.set(r.dataset, [...(groups.get(r.dataset) ?? []), r])
  const selected = env.refs.find((r) => r.ref === base)
  return (
    <span className="cl-picker">
      <select className="k-input" aria-label={label} value={base} onChange={(e) => { env.ensureRef(e.target.value); onChange(month && selected?.step === 'monthly' ? `${e.target.value}@${month}` : e.target.value) }}>
        {!selected && <option value={base}>{base || '(choose a series)'}</option>}
        {[...groups].map(([ds, list]) => (
          <optgroup key={ds} label={env.datasetTitle(ds)}>
            {list.map((r) => <option key={r.ref} value={r.ref}>{r.name}{r.unit ? ` (${r.unit})` : ''}</option>)}
          </optgroup>
        ))}
      </select>
      {allowMonth && selected?.step === 'monthly' && (
        <select className="k-input cl-month" aria-label={`${label}: which months`} value={month} onChange={(e) => onChange(Number(e.target.value) ? `${base}@${e.target.value}` : base)}>
          <option value={0}>every month</option>
          {MONTHS.map((n, i) => <option key={n} value={i + 1}>only {n}</option>)}
        </select>
      )}
    </span>
  )
}

export function BaselineSelect({ value, onChange, label, native = true, inherit }: { value: string; onChange: (v: string) => void; label: string; native?: boolean; inherit?: string }) {
  const known = BASELINES.some((b) => b.id === value) || value === 'native' || value === ''
  return (
    <select className="k-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {inherit !== undefined && <option value="">same as the plot ({inherit})</option>}
      {native && <option value="native">as published (provider’s baseline)</option>}
      {BASELINES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
      {!known && <option value={value}>{value}</option>}
    </select>
  )
}

export function SmoothSelect({ value, onChange }: { value: SmoothSpec; onChange: (v: SmoothSpec) => void }) {
  const years = value.kind === 'running' || value.kind === 'lowess' ? value.years : value.kind === 'decadal' ? (value.years ?? 11) : 1
  const kinds: Array<[SmoothSpec['kind'], string]> = [['none', 'None'], ['running', 'Running mean'], ['lowess', 'LOWESS'], ['annual', 'Annual means'], ['decadal', '11-year mean']]
  return (
    <span className="cl-inline">
      <select className="k-input" aria-label="Smoothing" value={value.kind} onChange={(e) => {
        const k = e.target.value as SmoothSpec['kind']
        onChange(k === 'running' ? { kind: 'running', years: 1 } : k === 'lowess' ? { kind: 'lowess', years: 15 } : k === 'decadal' ? { kind: 'decadal', years: 11 } : { kind: k })
      }}>
        {kinds.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
      {(value.kind === 'running' || value.kind === 'lowess') && (
        <>
          <NumInput label="Window in years" value={years} min={0.1} max={200} onChange={(v) => onChange({ ...value, years: v })} width={64} />
          <span className="k-muted">years</span>
        </>
      )}
    </span>
  )
}

/** Applies a change to the series view's i-th line. */
export function lineChange(env: Env, i: number, fn: (l: SeriesView['lines'][number]) => void): void {
  env.update((p) => { if (p.series.lines[i]) fn(p.series.lines[i]) })
}

export const fmt = (v: number | null | undefined, d = 3): string => (typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toPrecision(d))) : '–')
export const signed = (v: number, d = 3): string => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${String(Number(Math.abs(v).toPrecision(d)))}` : '–')
export const pText = (p: number): string => (!Number.isFinite(p) ? '–' : p < 1e-4 ? 'p < 0.0001' : `p = ${p.toFixed(4)}`)
