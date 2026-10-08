// Small form controls shared by kPlot's panels.

import { useEffect, useState, type ReactNode } from 'react'

export function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`kp-field${wide ? ' wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Check({ label, checked, onChange, title }: { label: string; checked: boolean; onChange(v: boolean): void; title?: string }) {
  return (
    <label className="kp-check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function Sel<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange(v: T): void; label: string }) {
  return (
    <select className="k-input kp-in" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

const parse = (t: string): number | null | undefined => {
  const s = t.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** A number box: empty means null (automatic). Typing "1." or "-" does not get rewritten. */
export function NumInput({ value, onChange, placeholder, label, title }: { value: number | null | undefined; onChange(v: number | null): void; placeholder?: string; label: string; title?: string }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value))
  useEffect(() => {
    const p = parse(text)
    const v = value ?? null
    if (p !== v) setText(v === null ? '' : String(v))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <input
      className="k-input kp-in"
      value={text}
      placeholder={placeholder}
      title={title}
      inputMode="decimal"
      spellCheck={false}
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value)
        const p = parse(e.target.value)
        if (p !== undefined) onChange(p)
      }}
    />
  )
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="kp-sec">
      <header>
        <h3>{title}</h3>
        {actions}
      </header>
      {children}
    </section>
  )
}
