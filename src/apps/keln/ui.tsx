// Small shared pieces of kELN's screens: a modal, sanitised HTML, number inputs, chips, a status badge.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Entry } from './model'
import { safeHtml } from './files'

/** HTML from our own writers or KaTeX/RDKit, always through DOMPurify. */
export function Html({ html, className }: { html: string; className?: string }) {
  // eslint-disable-next-line react/no-danger
  return <div className={className} dangerouslySetInnerHTML={{ __html: safeHtml(html) }} />
}

export function Modal({ title, children, onClose, width = 480, footer }: { title: string; children: ReactNode; onClose: () => void; width?: number; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const el = ref.current
    const body = el?.querySelector<HTMLElement>('.ln-modal-body')
    ;(body?.querySelector<HTMLElement>('input:not([type=checkbox]):not([hidden]), textarea, select') ?? el?.querySelector<HTMLElement>('.ln-modal-foot .primary, .ln-modal-foot button'))?.focus()
  }, [])
  return (
    <div className="ln-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="ln-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width: `min(${width}px, calc(100% - 24px))` }} ref={ref}>
        <div className="ln-modal-head">
          <h3 id={titleId}>{title}</h3>
          <button className="k-icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button>
        </div>
        <div className="ln-modal-body">{children}</div>
        {footer && <div className="ln-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="ln-field">
      <span>{label}</span>
      {children}
      {hint && <small className="k-muted">{hint}</small>}
    </label>
  )
}

/** A number box that keeps what is being typed ("1.", "-") and tells the parent the number (or null when empty). */
export function NumInput({ value, onChange, disabled, placeholder, className, title, width }: {
  value: number | null; onChange(v: number | null): void; disabled?: boolean; placeholder?: string; className?: string; title?: string; width?: number
}) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setText(value == null ? '' : String(value)) }, [value])
  return (
    <input
      className={`ln-cell num ${className ?? ''}`} inputMode="decimal" value={text} disabled={disabled} placeholder={placeholder} title={title} style={width ? { width } : undefined}
      onFocus={() => { focused.current = true }}
      onBlur={() => { focused.current = false; setText(value == null ? '' : String(value)) }}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        const n = t.trim() === '' ? null : Number(t.replace(',', '.'))
        if (n === null || Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', signed: 'Signed', witnessed: 'Witnessed' }

export function StatusBadge({ entry }: { entry: Entry }) {
  return (
    <span className="ln-badges">
      <span className={`ln-badge ln-${entry.status}`}>{STATUS_LABEL[entry.status]}</span>
      {entry.addenda.length > 0 && <span className="ln-badge ln-amended">Amended</span>}
    </span>
  )
}

export function Chip({ children, on, onClick, title }: { children: ReactNode; on?: boolean; onClick?: () => void; title?: string }) {
  return <button type="button" className={`ln-chip${on ? ' on' : ''}`} onClick={onClick} title={title} aria-pressed={on}>{children}</button>
}

export const shortDate = (iso: string): string => iso.slice(0, 10)
export const shortTime = (iso: string): string => iso.slice(11, 16)
export const stamp = (iso: string): string => iso.replace('T', ' ').slice(0, 16)
