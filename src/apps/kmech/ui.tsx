// Small interface pieces shared by the three workbenches. Colours come from the theme variables (kmech.css).

import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { fmt } from './math'

/** A number box that commits on Enter or blur, and turns red for text that is not a number. */
export function NumField({ label, value, onChange, unit, min, max, step = 1, title, disabled, digits = 6, integer }: {
  label?: string
  value: number
  onChange(v: number): void
  unit?: string
  min?: number
  max?: number
  step?: number
  title?: string
  disabled?: boolean
  digits?: number
  integer?: boolean
}) {
  const shown = Number.isFinite(value) ? fmt(value, digits) : ''
  const [text, setText] = useState(shown)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setText(shown) }, [shown, editing])
  const parsed = text.trim() === '' ? NaN : Number(text.replace(',', '.'))
  const bad = editing && (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max))
  const commit = () => {
    setEditing(false)
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) { setText(shown); return }
    const v = integer ? Math.round(parsed) : parsed
    if (v !== value) onChange(v)
    else setText(shown)
  }
  const input = (
    <span className="mc-num">
      <input
        className={`k-input${bad ? ' mc-bad' : ''}`} value={text} disabled={disabled} inputMode="decimal" title={title} aria-label={label} aria-invalid={bad || undefined}
        onFocus={(e) => { setEditing(true); e.currentTarget.select() }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLElement).blur() }
          else if (e.key === 'Escape') { setText(shown); setEditing(false); (e.target as HTMLElement).blur() }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const base = Number.isFinite(parsed) ? parsed : value
            const next = base + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
            const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, integer ? Math.round(next) : Number(next.toPrecision(10))))
            setText(fmt(v, digits)); onChange(v)
          }
        }}
      />
      {unit && <em>{unit}</em>}
    </span>
  )
  if (!label) return input
  return <label className="mc-field"><span>{label}</span>{input}</label>
}

export function Seg<T extends string>({ options, value, onChange, label }: { options: ReadonlyArray<{ id: T; label: string; title?: string }>; value: T; onChange(v: T): void; label: string }) {
  return (
    <div className="mc-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={value === o.id} className={value === o.id ? 'on' : ''} title={o.title} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Check({ label, checked, onChange, title, disabled }: { label: string; checked: boolean; onChange(v: boolean): void; title?: string; disabled?: boolean }) {
  return (
    <label className="mc-check" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  )
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="mc-section">
      <h4><span>{title}</span>{right}</h4>
      {children}
    </section>
  )
}

export function Kv({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <table className="mc-kv"><tbody>{rows.map(([k, v], i) => <tr key={i}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
  )
}

export function Note({ kind = 'info', children }: { kind?: 'error' | 'warn' | 'ok' | 'info'; children: React.ReactNode }) {
  const Icon = kind === 'ok' ? CheckCircle2 : kind === 'info' ? Info : AlertTriangle
  return <div className={`mc-note ${kind}`}><Icon size={14} /><span>{children}</span></div>
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="mc-empty"><div className="mc-empty-card"><strong>{title}</strong>{children && <p className="k-muted">{children}</p>}</div></div>
}

export const f4 = (v: number | null | undefined, d = 4): string => (v === null || v === undefined || !Number.isFinite(v) ? '–' : fmt(v, d))

/** A text box that commits on Enter or blur (so typing a name is one undo step, not one per letter). */
export function TextField({ label, value, onChange, placeholder, rows }: { label?: string; value: string; onChange(v: string): void; placeholder?: string; rows?: number }) {
  const [text, setText] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setText(value) }, [value, editing])
  const commit = () => { setEditing(false); if (text !== value) onChange(text) }
  const common = {
    value: text, placeholder, 'aria-label': label, onFocus: () => setEditing(true), onBlur: commit,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setText(e.target.value),
  }
  const input = rows
    ? <textarea className="k-input" rows={rows} style={{ width: '100%', resize: 'vertical', font: 'inherit', fontSize: 12 }} {...common} />
    : <input className="k-input" type="text" {...common} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLElement).blur(); else if (e.key === 'Escape') { setText(value); setEditing(false); (e.target as HTMLElement).blur() } }} />
  return label ? <label className="mc-field"><span>{label}</span>{input}</label> : input
}
