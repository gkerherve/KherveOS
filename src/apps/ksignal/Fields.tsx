// Small form controls shared by the kSignal panels (numbers with engineering suffixes, selects, checkboxes, sections).

import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { fmtNum, parseEng } from './stats'

export interface NumFieldProps {
  label?: string
  value: number
  onChange: (v: number) => void
  unit?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  title?: string
  /** Significant digits shown (default 7). */
  digits?: number
  /** Accept an empty field as this value (e.g. "auto"). */
  autoValue?: number
  autoLabel?: string
  narrow?: boolean
}

/** A number box: type "1k" or "2.5e3", commit with Enter or by leaving the field, arrow keys step it. */
export function NumField({ label, value, onChange, unit, min, max, step = 1, disabled, title, digits = 7, autoValue, autoLabel, narrow }: NumFieldProps) {
  const id = useId()
  const shown = autoValue !== undefined && value === autoValue ? '' : fmtNum(value, digits)
  const [text, setText] = useState(shown)
  const [bad, setBad] = useState(false)
  useEffect(() => { setText(shown); setBad(false) }, [shown])
  const commit = (raw: string) => {
    if (autoValue !== undefined && raw.trim() === '') { setBad(false); onChange(autoValue); return }
    const v = parseEng(raw)
    if (!Number.isFinite(v) || (min !== undefined && v < min) || (max !== undefined && v > max)) { setBad(true); setText(shown); return }
    setBad(false)
    if (v !== value) onChange(v)
    else setText(shown)
  }
  const nudge = (dir: number) => {
    const cur = parseEng(text)
    const base = Number.isFinite(cur) ? cur : value
    let v = Number((base + dir * step).toPrecision(12))
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    setText(fmtNum(v, digits))
    onChange(v)
  }
  return (
    <label className={`sg-field${narrow ? ' narrow' : ''}`} title={title} htmlFor={id}>
      {label && <span className="sg-field-label">{label}</span>}
      <span className="sg-field-box">
        <input
          id={id} className={`k-input sg-num${bad ? ' bad' : ''}`} value={text} disabled={disabled} inputMode="decimal" spellCheck={false}
          placeholder={autoLabel} aria-invalid={bad || undefined}
          onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).select() }
            else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(e.shiftKey ? 10 : 1) }
            else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(e.shiftKey ? -10 : -1) }
            else if (e.key === 'Escape') { setText(shown); setBad(false) }
          }}
        />
        {unit && <span className="sg-unit">{unit}</span>}
      </span>
    </label>
  )
}

const NONE = -1.2345e307

/** A number box that may be empty (null): cursors, limits left on automatic. */
export function OptNumField({ value, onChange, ...rest }: Omit<NumFieldProps, 'value' | 'onChange' | 'autoValue'> & { value: number | null; onChange: (v: number | null) => void }) {
  return <NumField {...rest} value={value ?? NONE} autoValue={NONE} onChange={(v) => onChange(v === NONE ? null : v)} />
}

export interface SelectFieldProps<T extends string> {
  label?: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  onChange: (v: T) => void
  disabled?: boolean
  title?: string
}

export function SelectField<T extends string>({ label, value, options, onChange, disabled, title }: SelectFieldProps<T>) {
  const id = useId()
  return (
    <label className="sg-field" title={title} htmlFor={id}>
      {label && <span className="sg-field-label">{label}</span>}
      <select id={id} className="k-input sg-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Check({ label, checked, onChange, disabled, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <label className="sg-check" title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

/** A collapsible group of controls. */
export function Section({ title, children, defaultOpen = true, extra }: { title: string; children: ReactNode; defaultOpen?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="sg-section">
      <header className="sg-section-head">
        <button type="button" className="sg-section-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{title}</span>
        </button>
        {extra}
      </header>
      {open && <div className="sg-section-body">{children}</div>}
    </section>
  )
}

/** A row of mutually exclusive buttons. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ value: T; label: string; icon?: ReactNode; title?: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="sg-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}
