// Small pieces shared by the tabs of kTitration: number fields that keep what is being typed, labelled rows,
// collapsible sections, segmented buttons, the colour bar of an indicator and the pKa picker.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { PKA, PKA_CATEGORIES, searchPka, type PkaEntry } from './data/pka'
import { indicatorGradient, type Indicator } from './data/indicators'
import { parseNumber, sig } from './format'

// ---------------------------------------------------------------------------------------------- numbers

/** A number field: you can type anything; the value is passed on when the text is a number. */
export function NumField({
  value, onChange, label, min, max, unit, width, digits = 6, disabled, placeholder, allowEmpty,
}: {
  value: number | null
  onChange: (v: number) => void
  label: string
  min?: number
  max?: number
  unit?: string
  width?: number
  digits?: number
  disabled?: boolean
  placeholder?: string
  /** An empty field means “automatic”: onEmpty is called. */
  allowEmpty?: { onEmpty: () => void }
}) {
  const show = (v: number | null) => (v === null || !Number.isFinite(v) ? '' : sig(v, digits))
  const [text, setText] = useState(show(value))
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current) return
    setText(show(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const parsed = parseNumber(text)
  const bad = text.trim() !== '' && (parsed === null || (min !== undefined && parsed < min) || (max !== undefined && parsed > max))
  return (
    <span className="ti-num">
      <input
        className={`k-input ti-input${bad ? ' bad' : ''}`}
        style={width ? { width } : undefined}
        value={text}
        inputMode="decimal"
        spellCheck={false}
        aria-label={label}
        aria-invalid={bad || undefined}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => { focused.current = true }}
        onBlur={() => {
          focused.current = false
          setText(show(value))
        }}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value.trim() === '' && allowEmpty) { allowEmpty.onEmpty(); return }
          const v = parseNumber(e.target.value)
          if (v !== null && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v)
        }}
      />
      {unit && <span className="ti-unit">{unit}</span>}
    </span>
  )
}

/** A list of numbers: “2.15, 7.2, 12.35”. */
export function NumListField({ value, onChange, label, width }: { value: number[]; onChange: (v: number[]) => void; label: string; width?: number }) {
  const show = (v: number[]) => v.join(', ')
  const [text, setText] = useState(show(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(show(value))
  }, [value])
  const parse = (t: string): number[] | null => {
    const parts = t.split(/[;\s]+|,(?=\s)|,(?=\d)/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length || parts.length > 8) return null
    const nums = parts.map((s) => parseNumber(s))
    return nums.every((n): n is number => n !== null) ? nums : null
  }
  const ok = parse(text) !== null
  return (
    <input
      className={`k-input ti-input${ok ? '' : ' bad'}`}
      style={width ? { width } : undefined}
      value={text}
      spellCheck={false}
      aria-label={label}
      aria-invalid={!ok || undefined}
      onFocus={() => { focused.current = true }}
      onBlur={() => { focused.current = false; setText(show(value)) }}
      onChange={(e) => {
        setText(e.target.value)
        const n = parse(e.target.value)
        if (n) onChange(n)
      }}
    />
  )
}

// ---------------------------------------------------------------------------------------------- layout

export function Row({ label, children, hint, wide }: { label: ReactNode; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <div className={`ti-row${wide ? ' wide' : ''}`} role="group">
      <span className="ti-row-label">{label}</span>
      <span className="ti-row-ctl">{children}</span>
      {hint && <span className="ti-hint">{hint}</span>}
    </div>
  )
}

export function Section({ title, children, actions, defaultOpen = true, id }: { title: ReactNode; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean; id?: string }) {
  const key = id ? `kherveos.ktitration.sec.${id}` : null
  const [open, setOpen] = useState(() => {
    if (!key) return defaultOpen
    try { const v = localStorage.getItem(key); return v === null ? defaultOpen : v === '1' } catch { return defaultOpen }
  })
  const toggle = () => {
    setOpen((o) => {
      if (key) { try { localStorage.setItem(key, o ? '0' : '1') } catch { /* storage blocked */ } }
      return !o
    })
  }
  const panel = useId()
  return (
    <section className="ti-section">
      <header className="ti-section-head">
        <button type="button" className="ti-section-toggle" aria-expanded={open} aria-controls={panel} onClick={toggle}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{title}</span>
        </button>
        {actions && <span className="ti-section-actions">{actions}</span>}
      </header>
      {open && <div id={panel} className="ti-section-body">{children}</div>}
    </section>
  )
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ id: T; label: ReactNode; title?: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ti-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} title={o.title} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Sel<T extends string>({ value, options, onChange, label, width }: { value: T; options: ReadonlyArray<{ id: T; label: string } | string>; onChange: (v: T) => void; label: string; width?: number }) {
  return (
    <select className="k-input ti-select" style={width ? { width } : undefined} value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => {
        const id = (typeof o === 'string' ? o : o.id) as T
        return <option key={id} value={id}>{typeof o === 'string' ? o : o.label}</option>
      })}
    </select>
  )
}

export function Check({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label className="ti-check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="ti-empty">
      {icon}
      <div>{children}</div>
    </div>
  )
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return <div className={`ti-notice ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>
}

export function Swatch({ color, size = 14, title }: { color: string; size?: number; title?: string }) {
  return <span className="ti-swatch" style={{ background: color, width: size, height: size }} title={title} aria-hidden="true" />
}

// ---------------------------------------------------------------------------------------------- indicators

/** The colours of an indicator from pH 0 to 14 as a bar, its transition range outlined, an optional marker. */
export function IndicatorBar({ ind, marker, jump, compact }: { ind: Indicator; marker?: number | null; jump?: [number, number] | null; compact?: boolean }) {
  const stops = useMemo(() => indicatorGradient(ind, 0, 14, 29), [ind])
  const grad = `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${((s.pH / 14) * 100).toFixed(2)}%`).join(', ')})`
  const pct = (v: number) => `${(Math.max(0, Math.min(14, v)) / 14) * 100}%`
  return (
    <div className={`ti-ibar${compact ? ' compact' : ''}`} role="img" aria-label={`${ind.name}: ${ind.acidName} below pH ${ind.lo}, ${ind.baseName} above pH ${ind.hi}`}>
      <div className="ti-ibar-bar" style={{ background: grad }}>
        {jump && <span className="ti-ibar-jump" style={{ left: pct(jump[0]), width: `calc(${pct(jump[1])} - ${pct(jump[0])})` }} />}
        <span className="ti-ibar-range" style={{ left: pct(ind.lo), width: `calc(${pct(ind.hi)} - ${pct(ind.lo)})` }} />
        {marker !== null && marker !== undefined && <span className="ti-ibar-marker" style={{ left: pct(marker) }} />}
      </div>
      {!compact && (
        <div className="ti-ibar-scale" aria-hidden="true">
          {[0, 2, 4, 6, 8, 10, 12, 14].map((v) => <span key={v} style={{ left: pct(v) }}>{v}</span>)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- the pKa picker

/** A button that opens a searchable list of the pKa table. */
export function PkaPicker({ value, label, onPick, buttonLabel }: { value: string | null; label: string; onPick: (e: PkaEntry) => void; buttonLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const list = useMemo(() => searchPka(q, (cat as (typeof PKA_CATEGORIES)[number]) || ''), [q, cat])
  const listId = useId()
  const current = value ? PKA.find((e) => e.id === value) : undefined
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  useEffect(() => setActive(0), [q, cat])
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])
  const pick = (e: PkaEntry) => {
    onPick(e)
    setOpen(false)
    setQ('')
  }
  return (
    <div className="ti-picker" ref={root}>
      <button type="button" className="k-btn ti-picker-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <Search size={13} />
        <span className="ti-picker-text">{buttonLabel ?? current?.name ?? 'Choose from the pKa table…'}</span>
      </button>
      {open && (
        <div className="ti-picker-pop" onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
          else if (e.key === 'Enter' && list[active]) { e.preventDefault(); pick(list[active]) }
        }}>
          <div className="ti-picker-bar">
            <input ref={inputRef} className="k-input" value={q} placeholder="Search name, formula or pKa…" aria-label="Search the pKa table" role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={list[active] ? `${listId}-${active}` : undefined} onChange={(e) => setQ(e.target.value)} />
            <select className="k-input" value={cat} aria-label="Category" onChange={(e) => setCat(e.target.value)}>
              <option value="">All</option>
              {PKA_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <ul id={listId} role="listbox" className="ti-picker-list" aria-label="pKa table">
            {list.map((e, i) => (
              <li key={e.id} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onPointerEnter={() => setActive(i)} onClick={() => pick(e)}>
                <span className="ti-picker-name">{e.name}</span>
                <span className="ti-picker-pka">pKa {e.pKa.join(', ')}</span>
              </li>
            ))}
            {list.length === 0 && <li className="ti-picker-none" role="presentation">Nothing matches “{q}”.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
