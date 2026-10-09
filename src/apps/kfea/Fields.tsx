// Small form pieces shared by the panels: a number field in display units, a select, a labelled row, a line chart.

import { useEffect, useState, type ReactNode } from 'react'
import { fmt, fromSI, label, parseNumber, toSI, type Quantity, type Units } from './units'

interface NumProps {
  /** the value in SI */
  value: number
  q: Quantity
  units: Units
  onCommit(si: number): void
  /** the unit label is shown after the field */
  unit?: boolean
  digits?: number
  disabled?: boolean
  min?: number
  title?: string
  width?: number
  /** the quantity is written as it is (K, a ratio…) */
  raw?: boolean
}

/** A number the user types in the display units; Enter or leaving the field commits, Escape gives the old value back. */
export function NumField({ value, q, units, onCommit, unit = true, digits = 6, disabled, min, title, width, raw }: NumProps) {
  const shown = fmt(raw ? value : fromSI(value, q, units), digits)
  const [text, setText] = useState(shown)
  const [focus, setFocus] = useState(false)
  useEffect(() => { if (!focus) setText(shown) }, [shown, focus])
  const commit = () => {
    const v = parseNumber(text)
    if (v === null || (min !== undefined && v < min)) { setText(shown); return }
    const si = raw ? v : toSI(v, q, units)
    if (Math.abs(si - value) > 1e-12 * Math.max(1, Math.abs(value))) onCommit(si)
    else setText(shown)
  }
  return (
    <span className="fe-num">
      <input
        className="k-input" value={text} disabled={disabled} title={title} style={width ? { width } : undefined} inputMode="decimal" spellCheck={false}
        onChange={(e) => setText(e.target.value)} onFocus={(e) => { setFocus(true); e.target.select() }}
        onBlur={() => { setFocus(false); commit() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { e.preventDefault(); setText(shown); (e.target as HTMLInputElement).blur() }
          e.stopPropagation()
        }}
      />
      {unit && !raw && label(q, units) ? <em>{label(q, units)}</em> : null}
    </span>
  )
}

export function Row({ label: text, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="fe-row">
      <span>{text}</span>
      <span className="fe-row-in">{children}</span>
      {hint ? <small className="k-muted">{hint}</small> : null}
    </label>
  )
}

export function Select<T extends string>({ value, options, onChange, disabled, title }: { value: T; options: ReadonlyArray<{ value: T; label: string; group?: string }>; onChange(v: T): void; disabled?: boolean; title?: string }) {
  const groups = [...new Set(options.map((o) => o.group ?? ''))]
  return (
    <select className="k-input fe-select" value={value} disabled={disabled} title={title} onChange={(e) => onChange(e.target.value as T)} onKeyDown={(e) => e.stopPropagation()}>
      {groups.map((g) => {
        const items = options.filter((o) => (o.group ?? '') === g)
        const rendered = items.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
        return g ? <optgroup key={g} label={g}>{rendered}</optgroup> : rendered
      })}
    </select>
  )
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange(v: boolean): void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="fe-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

export function Collapse({ title, open = true, children, extra }: { title: string; open?: boolean; children: ReactNode; extra?: ReactNode }) {
  const [on, setOn] = useState(open)
  return (
    <section className="fe-sec">
      <h4><button type="button" onClick={() => setOn(!on)} aria-expanded={on}>{on ? '▾' : '▸'} {title}</button>{extra}</h4>
      {on ? <div className="fe-sec-body">{children}</div> : null}
    </section>
  )
}

export interface ChartPoint { x: number; y: number }

/** A small line chart in SVG (the convergence study). Colours come from the theme. */
export function LineChart({ points, xLabel, yLabel, reference, height = 170 }: { points: ChartPoint[]; xLabel: string; yLabel: string; reference?: { y: number; label: string }; height?: number }) {
  const W = 280
  const H = height
  const m = { l: 52, r: 10, t: 10, b: 32 }
  if (points.length < 1) return null
  const xs = points.map((p) => p.x)
  const ys = [...points.map((p) => p.y), ...(reference ? [reference.y] : [])]
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  let y0 = Math.min(...ys)
  let y1 = Math.max(...ys)
  if (y1 - y0 < 1e-12 * Math.max(1, Math.abs(y1))) { y0 -= 1; y1 += 1 }
  const padY = (y1 - y0) * 0.08
  y0 -= padY; y1 += padY
  const X = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r)
  const Y = (y: number) => H - m.b - ((y - y0) / (y1 - y0)) * (H - m.t - m.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  const yt = Array.from({ length: 4 }, (_, i) => y0 + ((y1 - y0) * i) / 3)
  return (
    <svg className="fe-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}`}>
      <rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} className="fe-chart-box" />
      {yt.map((v, i) => (
        <g key={i}><line x1={m.l - 3} x2={m.l} y1={Y(v)} y2={Y(v)} className="fe-chart-axis" /><text x={m.l - 5} y={Y(v) + 3} textAnchor="end" className="fe-chart-text">{fmt(v, 3)}</text></g>
      ))}
      {points.map((p, i) => (
        <g key={i}><line x1={X(p.x)} x2={X(p.x)} y1={H - m.b} y2={H - m.b + 3} className="fe-chart-axis" />{i % Math.ceil(points.length / 5) === 0 ? <text x={X(p.x)} y={H - m.b + 13} textAnchor="middle" className="fe-chart-text">{fmt(p.x, 3)}</text> : null}</g>
      ))}
      {reference ? <g><line x1={m.l} x2={W - m.r} y1={Y(reference.y)} y2={Y(reference.y)} className="fe-chart-ref" /><text x={W - m.r - 2} y={Y(reference.y) - 3} textAnchor="end" className="fe-chart-text">{reference.label}</text></g> : null}
      <path d={path} className="fe-chart-line" />
      {points.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={3} className="fe-chart-dot" />)}
      <text x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle" className="fe-chart-text">{xLabel}</text>
      <text x={11} y={(m.t + H - m.b) / 2} textAnchor="middle" transform={`rotate(-90 11 ${(m.t + H - m.b) / 2})`} className="fe-chart-text">{yLabel}</text>
    </svg>
  )
}
