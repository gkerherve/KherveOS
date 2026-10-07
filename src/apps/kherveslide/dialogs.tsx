// KherveSlide's dialogs: a property sheet for any object or setting (the
// desktop's right-click property dialogs), the colour button of the Format
// toolbar and the equation editor with a live KaTeX preview.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Ban, ChevronDown } from 'lucide-react'
import { mathHtml } from './texhtml'

export interface FieldSpec {
  key: string
  label: string
  kind: 'text' | 'textarea' | 'number' | 'color' | 'bool' | 'select'
  options?: [string, string][]
  min?: number
  max?: number
  step?: number
  hint?: string
  /** A section heading shown above this field. */
  section?: string
}

export type Values = Record<string, unknown>

function Modal({ title, children, onCancel, wide }: { title: string; children: ReactNode; onCancel: () => void; wide?: boolean }) {
  return (
    <div
      className="ks2-modal-back"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
        e.stopPropagation()
      }}
    >
      <div className={`ks2-modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="ks2-modal-title">{title}</div>
        {children}
      </div>
    </div>
  )
}

const HEX = /^#[0-9a-fA-F]{6}$/

function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="ks2-colorfield">
      <input type="color" value={HEX.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <input className="k-input" value={value} placeholder="none" onChange={(e) => onChange(e.target.value.trim())} spellCheck={false} />
      <button className="k-icon-btn" title="None" onClick={() => onChange('')} type="button">
        <Ban size={13} />
      </button>
    </span>
  )
}

/** A form for `fields`; resolves with the edited values (null when cancelled). */
export function FieldsDialog({
  title, fields, values, onDone, intro, extra,
}: {
  title: string
  fields: FieldSpec[]
  values: Values
  onDone: (v: Values | null) => void
  intro?: ReactNode
  /** Something above the fields that may replace values (e.g. a preset picker). */
  extra?: (set: (v: Values) => void) => ReactNode
}) {
  const [v, setV] = useState<Values>(values)
  const first = useRef<HTMLDivElement>(null)
  useEffect(() => {
    first.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }, [])
  const set = (k: string, x: unknown) => setV((o) => ({ ...o, [k]: x }))
  const ok = () => {
    const out: Values = { ...v }
    for (const f of fields) {
      if (f.kind === 'number') {
        let n = Number(out[f.key])
        if (!Number.isFinite(n)) n = Number(values[f.key]) || 0
        if (f.min !== undefined) n = Math.max(f.min, n)
        if (f.max !== undefined) n = Math.min(f.max, n)
        out[f.key] = n
      }
      if (f.kind === 'color' && out[f.key] && !HEX.test(String(out[f.key]))) out[f.key] = values[f.key]
    }
    onDone(out)
  }
  return (
    <Modal title={title} onCancel={() => onDone(null)} wide={fields.length > 12}>
      <div
        className="ks2-modal-body"
        ref={first}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            e.preventDefault()
            ok()
          }
        }}
      >
        {intro && <div className="ks2-modal-intro">{intro}</div>}
        {extra?.((nv) => setV((o) => ({ ...o, ...nv })))}
        <div className="ks2-fields">
          {fields.map((f) => (
            <FieldRow key={f.key} f={f} value={v[f.key]} onChange={(x) => set(f.key, x)} />
          ))}
        </div>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="k-btn primary" onClick={ok}>
          OK
        </button>
      </div>
    </Modal>
  )
}

function FieldRow({ f, value, onChange }: { f: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  let input: ReactNode
  switch (f.kind) {
    case 'bool':
      input = <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      break
    case 'color':
      input = <ColorField value={String(value ?? '')} onChange={onChange} />
      break
    case 'select':
      input = (
        <select className="k-input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(f.options ?? []).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
          {!(f.options ?? []).some(([val]) => val === String(value ?? '')) && <option value={String(value ?? '')}>{String(value ?? '')}</option>}
        </select>
      )
      break
    case 'number':
      input = (
        <input className="k-input" type="number" value={String(value ?? '')} min={f.min} max={f.max} step={f.step ?? 'any'} onChange={(e) => onChange(e.target.value)} />
      )
      break
    case 'textarea':
      input = <textarea className="k-input ks2-textarea" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} spellCheck={false} rows={5} />
      break
    default:
      input = <input className="k-input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
  }
  return (
    <>
      {f.section && <div className="ks2-field-section">{f.section}</div>}
      <label className={`ks2-field${f.kind === 'bool' ? ' bool' : ''}`}>
        <span className="ks2-field-label">{f.label}</span>
        <span className="ks2-field-input">{input}</span>
        {f.hint && <span className="ks2-field-hint">{f.hint}</span>}
      </label>
    </>
  )
}

// ------------------------------------------------------------------ colour button

const SWATCHES = [
  '#000000', '#404040', '#808080', '#BFBFBF', '#FFFFFF', '#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0',
  '#0070C0', '#002060', '#7030A0', '#1F4E79', '#003E74', '#0E7D7D', '#2E6B30', '#9E1B32',
]

/** A Format-toolbar colour: a swatch that opens a palette (with "none" and a custom colour). */
export function ColorButton({ icon, title, value, onChange, disabled, allowNone = true }: {
  icon: ReactNode
  title: string
  value: string
  onChange: (c: string) => void
  disabled?: boolean
  allowNone?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])
  return (
    <span className="ks2-colorbtn" ref={ref}>
      <button className="k-icon-btn" title={title} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <span className="ks2-colorbtn-icon">
          {icon}
          <span className="ks2-colorbtn-bar" style={{ background: value || 'transparent' }} />
        </span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="ks2-palette">
          {SWATCHES.map((c) => (
            <button
              key={c}
              className="ks2-swatch"
              style={{ background: c }}
              title={c}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
            />
          ))}
          <div className="ks2-palette-row">
            {allowNone && (
              <button
                className="k-btn"
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                None
              </button>
            )}
            <label className="k-btn">
              Custom…
              <input type="color" className="ks2-hidden-color" value={HEX.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
            </label>
          </div>
        </div>
      )}
    </span>
  )
}

// ------------------------------------------------------------------ equation editor

const SNIPPETS: [string, string][] = [
  ['\\frac{a}{b}', 'a/b'], ['x^{2}', 'xⁿ'], ['x_{i}', 'xᵢ'], ['\\sqrt{x}', '√'], ['\\int_{a}^{b}', '∫'], ['\\sum_{i=1}^{n}', 'Σ'],
  ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\Delta', 'Δ'], ['\\lambda', 'λ'], ['\\mu', 'μ'], ['\\pi', 'π'], ['\\theta', 'θ'],
  ['\\infty', '∞'], ['\\pm', '±'], ['\\times', '×'], ['\\cdot', '·'], ['\\approx', '≈'], ['\\leq', '≤'], ['\\geq', '≥'], ['\\rightarrow', '→'],
  ['\\partial', '∂'], ['\\nabla', '∇'], ['\\hbar', 'ℏ'], ['\\ce{H2O}', 'H₂O'],
]

/** Edit an equation (LaTeX maths) with a live preview. Resolves with the LaTeX, or null. */
export function EquationDialog({ initial, onDone }: { initial: string; onDone: (tex: string | null) => void }) {
  const [tex, setTex] = useState(initial)
  const area = useRef<HTMLTextAreaElement>(null)
  const preview = useMemo(() => mathHtml(tex || '\\square', true), [tex])
  useEffect(() => area.current?.focus(), [])
  const insert = (s: string) => {
    const el = area.current
    if (!el) return setTex((t) => t + s)
    const a = el.selectionStart
    const b = el.selectionEnd
    const next = tex.slice(0, a) + s + tex.slice(b)
    setTex(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + s.length, a + s.length)
    })
  }
  return (
    <Modal title="Equation" onCancel={() => onDone(null)} wide>
      <div className="ks2-modal-body">
        <div className="ks2-snippets">
          {SNIPPETS.map(([s, label]) => (
            <button key={s} className="k-btn" title={s} onClick={() => insert(s)}>
              {label}
            </button>
          ))}
        </div>
        <textarea
          ref={area}
          className="k-input ks2-textarea mono"
          value={tex}
          rows={4}
          spellCheck={false}
          placeholder="E = mc^2"
          onChange={(e) => setTex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onDone(tex)
          }}
        />
        <div className="ks2-eq-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        <div className="ks2-modal-intro">LaTeX maths, as in \[ … \]. The preview is KaTeX; the PDF is typeset by LaTeX. ⌘Enter inserts.</div>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="k-btn primary" onClick={() => onDone(tex)} disabled={!tex.trim()}>
          OK
        </button>
      </div>
    </Modal>
  )
}
