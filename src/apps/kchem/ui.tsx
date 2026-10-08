// Small pieces shared by kChem's tools: the typeset formula, labelled fields, cards, the
// Pin / Copy buttons and the context the tools use to talk to the app.

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { Copy, Pin } from 'lucide-react'
import { typeset } from './chem'
import type { Equation } from './balance'

export type ToolId =
  | 'formula' | 'balance' | 'stoich' | 'solutions' | 'dilution' | 'acids' | 'gases' | 'periodic' | 'converter' | 'notebook'

export interface KcApi {
  /** A tool tells the app its current result as plain text (for Copy result, Pin and the notebook). */
  report(tool: ToolId, text: string, slot?: string, label?: string): void
  /** Pin a result to the notebook (asks for a label). */
  pin(tool: ToolId, defaultLabel: string, text: string): void
  copy(text: string): void
  /** Appends an element symbol to the formula of the Formula tool. */
  insertElement(symbol: string): void
  go(tool: ToolId): void
}

export const KcContext = createContext<KcApi>({
  report() {}, pin() {}, copy() {}, insertElement() {}, go() {},
})
export const useKc = () => useContext(KcContext)

/** A formula with subscripts and superscripts. */
export function Fx({ f, className }: { f: string; className?: string }) {
  const parts = typeset(f)
  return (
    <span className={`kc-fx ${className ?? ''}`}>
      {parts.map((p, i) => (p.kind === 'sub' ? <sub key={i}>{p.text}</sub> : p.kind === 'sup' ? <sup key={i}>{p.text}</sup> : <span key={i}>{p.text}</span>))}
    </span>
  )
}

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`kc-stack ${className ?? ''}`}>
      <span className="kc-label">{label}</span>
      {children}
      {hint && <span className="k-muted kc-hint">{hint}</span>}
    </label>
  )
}

export function NumInput({ value, onChange, placeholder, label, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; disabled?: boolean }) {
  return (
    <input
      className="k-input kc-num"
      value={value}
      inputMode="decimal"
      spellCheck={false}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function Select<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (T | { id: T; label: string })[]; onChange: (v: T) => void; label: string }) {
  return (
    <select className="k-input kc-select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => {
        const id = typeof o === 'string' ? o : o.id
        const text = typeof o === 'string' ? o : o.label
        return <option key={id} value={id}>{text}</option>
      })}
    </select>
  )
}

/** A value with a unit selector next to it. */
export function WithUnit({ children, unit }: { children: ReactNode; unit: ReactNode }) {
  return <div className="kc-withunit">{children}{unit}</div>
}

export function Card({ title, icon, children, actions, className }: { title?: ReactNode; icon?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`kc-card ${className ?? ''}`}>
      {(title || actions) && (
        <div className="kc-cardhead">
          <h3 className="kc-h">{icon}{title}</h3>
          {actions && <div className="kc-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Err({ children }: { children: ReactNode }) {
  return <div className="kc-error" role="alert">{children}</div>
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="k-muted kc-hint">{children}</div>
}

/** Big highlighted answer. */
export function Answer({ children }: { children: ReactNode }) {
  return <div className="kc-answer">{children}</div>
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: readonly { id: T; label: string }[] }) {
  return (
    <div className="kc-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`kc-tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The Pin and Copy buttons of a result. `text` is the result as plain text; it is also reported to the app
 * (Edit > Copy result, File > notebook).
 */
export function ResultActions({ tool, label, text, slot = '' }: { tool: ToolId; label: string; text: string; slot?: string }) {
  const kc = useKc()
  useEffect(() => {
    kc.report(tool, text, slot, label)
  }, [kc, tool, text, slot, label])
  return (
    <div className="kc-actions">
      <button className="k-btn small" onClick={() => kc.copy(text)} title="Copy the result as text" disabled={!text}><Copy size={13} /> Copy</button>
      <button className="k-btn small" onClick={() => kc.pin(tool, label, text)} title="Add this calculation to the notebook" disabled={!text}><Pin size={13} /> Pin</button>
    </div>
  )
}

/** A balanced (or typed) equation, typeset: 4 Fe + 3 O₂ → 2 Fe₂O₃. */
export function EquationView({ eq, coeffs }: { eq: Equation; coeffs: (number | null)[] }) {
  const side = (list: Equation['reactants'], offset: number) =>
    list.map((s, i) => {
      const c = coeffs[offset + i]
      return (
        <span key={i} className="kc-term">
          {i > 0 && <span className="kc-plus"> + </span>}
          {c !== null && c !== 1 && <b className="kc-coeff">{Number.isInteger(c) ? c : Number(c.toFixed(3))}</b>}
          <Fx f={s.formula + (s.phase ? `(${s.phase})` : '')} />
        </span>
      )
    })
  return (
    <div className="kc-equation">
      {side(eq.reactants, 0)}
      <span className="kc-arrow"> → </span>
      {side(eq.products, eq.reactants.length)}
    </div>
  )
}
