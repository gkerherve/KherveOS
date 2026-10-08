// Small pieces shared by kReaction's tools: the context the tools use to talk to the window, structure
// pictures, typeset formulas, cards, tabs, result buttons.

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, Pin } from 'lucide-react'
import type { MainModule } from '@rdkit/rdkit'
import { typeset } from './formula'
import type { ArrowKind } from './reaction'
import { screenSvg } from './structures'
import type { ToolId, Workspace } from './workspace'

export interface KrApi {
  ws: Workspace
  update(fn: (w: Workspace) => Workspace): void
  patch<K extends 'builder' | 'library' | 'mechanism' | 'predict' | 'kinetics' | 'energy'>(key: K, p: Partial<Workspace[K]>): void
  rd: MainModule | null
  rdStatus: 'idle' | 'loading' | 'ready' | 'failed'
  /** Significant figures for numbers on screen. */
  sig: number
  go(tool: ToolId): void
  say(message: string): void
  copy(text: string): void
  /** Pins a result to the notebook (asks for a label). */
  pin(tool: string, defaultLabel: string, text: string, svgs?: string[]): void
  /** A tool reports its current result for Edit > Copy result / Pin result. */
  report(tool: ToolId, text: string, label: string, svgs?: () => string[]): void
  /** Saves a picture (data URL or SVG text) chosen by the user. */
  saveImage(name: string, data: string, format: 'png' | 'svg'): void
  /** Loads a library reaction into the builder, mechanism viewer or energy profile. */
  loadReaction(id: string, into: 'builder' | 'mechanism' | 'energy'): void
  /** Puts a reaction into the builder (species as names or SMILES) and optionally shows it. */
  setReaction(r: { reactants: string[]; products: string[]; arrow?: ArrowKind; above?: string; below?: string; coeffs?: number[] | null }, show?: boolean): void
  /** Saves a Markdown report of the reaction in the builder. */
  exportReport(): void
}

export const KrContext = createContext<KrApi | null>(null)

export function useKr(): KrApi {
  const api = useContext(KrContext)
  if (!api) throw new Error('KrContext is missing')
  return api
}

/** A formula with subscripts and superscripts. */
export function Fx({ f, charge = 0, className }: { f: string; charge?: number; className?: string }) {
  const parts = useMemo(() => typeset(f, charge), [f, charge])
  return (
    <span className={`kr-fx ${className ?? ''}`}>
      {parts.map((p, i) => (p.kind === 'sub' ? <sub key={i}>{p.text}</sub> : p.kind === 'sup' ? <sup key={i}>{p.text}</sup> : <span key={i}>{p.text}</span>))}
    </span>
  )
}

/** A structure drawn by RDKit in the theme's colours; the formula stands in while RDKit loads or when it fails. */
export function Mol({ smiles, width = 220, height = 150, fallback, className }: { smiles: string | null; width?: number; height?: number; fallback?: ReactNode; className?: string }) {
  const { rd, rdStatus } = useKr()
  const svg = useMemo(() => (rd && smiles ? screenSvg(rd, smiles, width, height) : null), [rd, smiles, width, height])
  if (svg) return <div className={`kr-mol ${className ?? ''}`} style={{ width, maxWidth: '100%' }} dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={smiles ?? 'structure'} />
  return (
    <div className={`kr-mol kr-mol-empty ${className ?? ''}`} style={{ width, maxWidth: '100%', minHeight: Math.min(height, 60) }}>
      {smiles === null ? fallback : rdStatus === 'loading' || rdStatus === 'idle' ? <span className="k-muted kr-small">drawing…</span> : fallback ?? <span className="k-muted kr-small">no picture</span>}
    </div>
  )
}

export function Field({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`kr-stack ${className ?? ''}`}>
      <span className="kr-label">{label}</span>
      {children}
      {hint && <span className="k-muted kr-hint">{hint}</span>}
    </label>
  )
}

export function Card({ title, icon, children, actions, className }: { title?: ReactNode; icon?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`kr-card ${className ?? ''}`}>
      {(title || actions) && (
        <div className="kr-cardhead">
          <h3 className="kr-h">{icon}{title}</h3>
          {actions && <div className="kr-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Err({ children }: { children: ReactNode }) {
  return <div className="kr-error" role="alert">{children}</div>
}

export function Hint({ children }: { children: ReactNode }) {
  return <div className="k-muted kr-hint">{children}</div>
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: readonly { id: T; label: string }[] }) {
  return (
    <div className="kr-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`kr-tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

/** The Copy and Pin buttons of a result; the text is also reported for Edit > Copy result. */
export function ResultActions({ tool, label, text, svgs }: { tool: ToolId; label: string; text: string; svgs?: () => string[] }) {
  const kr = useKr()
  useEffect(() => {
    kr.report(tool, text, label, svgs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, text, label])
  return (
    <div className="kr-actions">
      <button className="k-btn small" onClick={() => kr.copy(text)} disabled={!text} title="Copy the result as text"><Copy size={13} /> Copy</button>
      <button className="k-btn small" onClick={() => kr.pin(tool, label, text, svgs?.())} disabled={!text} title="Add this result to the notebook"><Pin size={13} /> Pin</button>
    </div>
  )
}

/** Plain text of a number field → number (comma or point; empty → NaN). */
export function toNum(text: string): number {
  const t = text.trim().replace(',', '.')
  return t === '' ? NaN : Number(t)
}

/** A value that follows `value` after it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
  const key = JSON.stringify(value)
  const [v, setV] = useState(value)
  const latest = useRef(value)
  latest.current = value
  useEffect(() => {
    const id = window.setTimeout(() => setV(latest.current), ms)
    return () => window.clearTimeout(id)
  }, [key, ms])
  return v
}

/** A number field that lets you clear it and type again; calls `onValid` with every valid positive number. */
export function PositiveInput({ value, onValid, className, label, title }: { value: number; onValid: (n: number) => void; className?: string; label: string; title?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setText((t) => (Number(t.replace(',', '.')) === value ? t : String(value)))
  }, [value])
  return (
    <input
      className={className}
      value={text}
      inputMode="decimal"
      aria-label={label}
      title={title}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value.replace(',', '.'))
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n > 0) onValid(n)
      }}
      onBlur={() => setText(String(value))}
    />
  )
}
