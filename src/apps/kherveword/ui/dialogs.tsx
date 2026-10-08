// KherveWord's dialogs: Page Setup, Paragraph, Header & Footer, Style,
// Equation, Hyperlink, Symbol, Footnote, Picture, Word Count, Templates.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import {
  FONTS, MARGIN_PRESETS, PAGE_SIZES, PT_PER_CM, resolveStyle,
  type DocSettings, type HeaderFooter, type PageSetup, type StyleDef,
} from '../model'
import { renderMath } from '../editor/math'
import { TEMPLATES, type TemplateId } from '../templates'

const cm = (pt: number) => Math.round((pt / PT_PER_CM) * 100) / 100
const pt = (cmv: number) => cmv * PT_PER_CM

export function Modal({ title, children, onClose, onOk, okLabel = 'OK', wide, extra }: { title: string; children: ReactNode; onClose: () => void; onOk?: () => void; okLabel?: string; wide?: boolean; extra?: ReactNode }) {
  return (
    <div className="kw-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`kw-modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
          if (e.key === 'Enter' && onOk && (e.target as HTMLElement).tagName !== 'TEXTAREA' && (e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault()
            onOk()
          }
        }}
      >
        <div className="kw-modal-title">
          <span>{title}</span>
          <button className="k-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="kw-modal-body">{children}</div>
        <div className="kw-modal-buttons">
          {extra}
          <span style={{ flex: 1 }} />
          <button className="k-btn" onClick={onClose}>
            {onOk ? 'Cancel' : 'Close'}
          </button>
          {onOk && (
            <button className="k-btn primary" onClick={onOk}>
              {okLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Num({ value, onChange, step = 0.1, min, max, suffix, width = 70 }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; width?: number }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <span className="kw-num">
      <input
        className="k-input"
        style={{ width }}
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
      />
      {suffix && <span className="k-muted">{suffix}</span>}
    </span>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kw-row">
      <span className="kw-row-label">{label}</span>
      <span className="kw-row-field">{children}</span>
    </label>
  )
}

// ------------------------------------------------------------------ page setup

export function PageSetupDialog({ page, onClose, onOk }: { page: PageSetup; onClose: () => void; onOk: (p: PageSetup) => void }) {
  const [p, setP] = useState<PageSetup>({ ...page, margins: { ...page.margins } })
  const setM = (k: keyof PageSetup['margins'], v: number) => setP((x) => ({ ...x, margins: { ...x.margins, [k]: pt(v) } }))
  return (
    <Modal title="Page Setup" onClose={onClose} onOk={() => onOk(p)}>
      <Row label="Paper size">
        <select
          className="k-input"
          value={p.size}
          onChange={(e) => {
            const s = PAGE_SIZES[e.target.value]
            setP((x) => (s ? { ...x, size: e.target.value, width: s.width, height: s.height } : { ...x, size: 'Custom' }))
          }}
        >
          {Object.entries(PAGE_SIZES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
          <option value="Custom">Custom</option>
        </select>
      </Row>
      {p.size === 'Custom' && (
        <Row label="Width × height">
          <Num value={cm(p.width)} onChange={(v) => setP((x) => ({ ...x, width: pt(v) }))} suffix="cm" />
          <Num value={cm(p.height)} onChange={(v) => setP((x) => ({ ...x, height: pt(v) }))} suffix="cm" />
        </Row>
      )}
      <Row label="Orientation">
        <span className="kw-seg">
          {(['portrait', 'landscape'] as const).map((o) => (
            <button key={o} className={`k-btn small${p.orientation === o ? ' primary' : ''}`} onClick={() => setP((x) => ({ ...x, orientation: o }))}>
              {o === 'portrait' ? 'Portrait' : 'Landscape'}
            </button>
          ))}
        </span>
      </Row>
      <Row label="Margins preset">
        <select
          className="k-input"
          value=""
          onChange={(e) => {
            const m = MARGIN_PRESETS[e.target.value]
            if (m) setP((x) => ({ ...x, margins: { ...x.margins, top: m.top, right: m.right, bottom: m.bottom, left: m.left } }))
          }}
        >
          <option value="">Choose…</option>
          {Object.entries(MARGIN_PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Top / bottom">
        <Num value={cm(p.margins.top)} onChange={(v) => setM('top', v)} suffix="cm" />
        <Num value={cm(p.margins.bottom)} onChange={(v) => setM('bottom', v)} suffix="cm" />
      </Row>
      <Row label="Left / right">
        <Num value={cm(p.margins.left)} onChange={(v) => setM('left', v)} suffix="cm" />
        <Num value={cm(p.margins.right)} onChange={(v) => setM('right', v)} suffix="cm" />
      </Row>
      <Row label="Header / footer from edge">
        <Num value={cm(p.margins.header)} onChange={(v) => setM('header', v)} suffix="cm" />
        <Num value={cm(p.margins.footer)} onChange={(v) => setM('footer', v)} suffix="cm" />
      </Row>
    </Modal>
  )
}

// ------------------------------------------------------------------ paragraph

export interface ParaValues {
  align: string
  indentLeft: number
  indentRight: number
  indentFirst: number
  spaceBefore: number
  spaceAfter: number
  lineHeight: number
  border: string | null
  shading: string | null
  tabs: { pos: number; align?: string }[]
}

export function ParagraphDialog({ initial, onClose, onOk }: { initial: ParaValues; onClose: () => void; onOk: (v: ParaValues) => void }) {
  const [v, setV] = useState<ParaValues>({ ...initial, tabs: [...initial.tabs] })
  const special = v.indentFirst < 0 ? 'hanging' : v.indentFirst > 0 ? 'first' : 'none'
  const [newTab, setNewTab] = useState('')
  const [newAlign, setNewAlign] = useState('left')
  return (
    <Modal title="Paragraph" onClose={onClose} onOk={() => onOk(v)}>
      <Row label="Alignment">
        <select className="k-input" value={v.align} onChange={(e) => setV({ ...v, align: e.target.value })}>
          <option value="left">Left</option>
          <option value="center">Centred</option>
          <option value="right">Right</option>
          <option value="justify">Justified</option>
        </select>
      </Row>
      <div className="kw-section">Indentation</div>
      <Row label="Left / right">
        <Num value={cm(v.indentLeft)} onChange={(x) => setV({ ...v, indentLeft: pt(x) })} suffix="cm" />
        <Num value={cm(v.indentRight)} onChange={(x) => setV({ ...v, indentRight: pt(x) })} suffix="cm" />
      </Row>
      <Row label="Special">
        <select
          className="k-input"
          value={special}
          onChange={(e) => setV({ ...v, indentFirst: e.target.value === 'none' ? 0 : e.target.value === 'first' ? Math.abs(v.indentFirst) || pt(1.27) : -(Math.abs(v.indentFirst) || pt(1.27)) })}
        >
          <option value="none">(none)</option>
          <option value="first">First line</option>
          <option value="hanging">Hanging</option>
        </select>
        {special !== 'none' && <Num value={cm(Math.abs(v.indentFirst))} onChange={(x) => setV({ ...v, indentFirst: (special === 'hanging' ? -1 : 1) * pt(x) })} suffix="cm" />}
      </Row>
      <div className="kw-section">Spacing</div>
      <Row label="Before / after">
        <Num value={v.spaceBefore} step={1} min={0} onChange={(x) => setV({ ...v, spaceBefore: x })} suffix="pt" />
        <Num value={v.spaceAfter} step={1} min={0} onChange={(x) => setV({ ...v, spaceAfter: x })} suffix="pt" />
      </Row>
      <Row label="Line spacing">
        <select className="k-input" value={[1, 1.15, 1.5, 2].includes(v.lineHeight) ? String(v.lineHeight) : 'multiple'} onChange={(e) => e.target.value !== 'multiple' && setV({ ...v, lineHeight: Number(e.target.value) })}>
          <option value="1">Single</option>
          <option value="1.15">1.15</option>
          <option value="1.5">1.5 lines</option>
          <option value="2">Double</option>
          <option value="multiple">Multiple</option>
        </select>
        <Num value={v.lineHeight} step={0.05} min={0.5} max={5} onChange={(x) => setV({ ...v, lineHeight: x })} suffix="×" />
      </Row>
      <div className="kw-section">Borders and shading</div>
      <Row label="Border">
        <select className="k-input" value={v.border ?? ''} onChange={(e) => setV({ ...v, border: e.target.value || null })}>
          <option value="">None</option>
          <option value="box">Box</option>
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="topBottom">Top and bottom</option>
        </select>
      </Row>
      <Row label="Shading">
        <input type="color" value={v.shading ?? '#ffffff'} onChange={(e) => setV({ ...v, shading: e.target.value })} />
        <button className="k-btn small" onClick={() => setV({ ...v, shading: null })}>
          No shading
        </button>
      </Row>
      <div className="kw-section">Tab stops</div>
      <div className="kw-tabs-list">
        {v.tabs.map((t, i) => (
          <span key={i} className="kw-chip">
            {cm(t.pos)} cm {t.align && t.align !== 'left' ? t.align : ''}
            <button className="k-icon-btn" aria-label="Remove tab stop" onClick={() => setV({ ...v, tabs: v.tabs.filter((_, k) => k !== i) })}>
              <X size={12} />
            </button>
          </span>
        ))}
        {!v.tabs.length && <span className="k-muted">Default stops every 1.27 cm. Click the ruler to add a stop.</span>}
      </div>
      <Row label="Add a stop">
        <input className="k-input" style={{ width: 70 }} placeholder="cm" value={newTab} onChange={(e) => setNewTab(e.target.value)} />
        <select className="k-input" style={{ width: 100 }} value={newAlign} onChange={(e) => setNewAlign(e.target.value)}>
          <option value="left">Left</option>
          <option value="center">Centre</option>
          <option value="right">Right</option>
          <option value="decimal">Decimal</option>
        </select>
        <button
          className="k-btn small"
          onClick={() => {
            const x = parseFloat(newTab)
            if (!(x > 0)) return
            setV({ ...v, tabs: [...v.tabs, { pos: pt(x), align: newAlign }].sort((a, b) => a.pos - b.pos) })
            setNewTab('')
          }}
        >
          Add
        </button>
      </Row>
    </Modal>
  )
}

// ------------------------------------------------------------------ header & footer

export function HeaderFooterDialog({ settings, onClose, onOk }: { settings: DocSettings; onClose: () => void; onOk: (s: Pick<DocSettings, 'header' | 'footer' | 'firstHeader' | 'firstFooter' | 'differentFirst'>) => void }) {
  const [header, setHeader] = useState<HeaderFooter>({ ...settings.header })
  const [footer, setFooter] = useState<HeaderFooter>({ ...settings.footer })
  const [diff, setDiff] = useState(settings.differentFirst)
  const [fHeader, setFHeader] = useState<HeaderFooter>({ left: '', center: '', right: '', ...settings.firstHeader })
  const [fFooter, setFFooter] = useState<HeaderFooter>({ left: '', center: '', right: '', ...settings.firstFooter })
  const [focus, setFocus] = useState<{ set: (h: HeaderFooter) => void; h: HeaderFooter; k: keyof HeaderFooter } | null>(null)
  const line = (label: string, h: HeaderFooter, set: (h: HeaderFooter) => void) => (
    <Row label={label}>
      {(['left', 'center', 'right'] as const).map((k) => (
        <input
          key={k}
          className="k-input"
          placeholder={k === 'left' ? 'Left' : k === 'center' ? 'Centre' : 'Right'}
          value={h[k]}
          style={{ textAlign: k }}
          onFocus={() => setFocus({ set, h, k })}
          onChange={(e) => {
            const nh = { ...h, [k]: e.target.value }
            set(nh)
            setFocus({ set, h: nh, k })
          }}
        />
      ))}
    </Row>
  )
  const token = (t: string) => {
    if (!focus) return
    const nh = { ...focus.h, [focus.k]: `${focus.h[focus.k]}${t}` }
    focus.set(nh)
    setFocus({ ...focus, h: nh })
  }
  return (
    <Modal title="Header & Footer" wide onClose={onClose} onOk={() => onOk({ header, footer, differentFirst: diff, firstHeader: diff ? fHeader : undefined, firstFooter: diff ? fFooter : undefined })}>
      <p className="k-muted kw-hint">Three places on each line: left, centre and right. Click a field, then a button to add a field.</p>
      <div className="kw-token-row">
        <button className="k-btn small" onClick={() => token('{PAGE}')}>
          Page number
        </button>
        <button className="k-btn small" onClick={() => token('{PAGES}')}>
          Number of pages
        </button>
        <button className="k-btn small" onClick={() => token('Page {PAGE} of {PAGES}')}>
          Page X of Y
        </button>
        <button className="k-btn small" onClick={() => token('{TITLE}')}>
          Title
        </button>
        <button className="k-btn small" onClick={() => token('{DATE}')}>
          Date
        </button>
      </div>
      {line('Header', header, setHeader)}
      {line('Footer', footer, setFooter)}
      <label className="kw-check">
        <input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> Different first page
      </label>
      {diff && line('First page header', fHeader, setFHeader)}
      {diff && line('First page footer', fFooter, setFFooter)}
    </Modal>
  )
}

// ------------------------------------------------------------------ styles

export function StyleDialog({ styles, style, isNew, onClose, onOk }: { styles: Record<string, StyleDef>; style: StyleDef; isNew: boolean; onClose: () => void; onOk: (s: StyleDef) => void }) {
  const [s, setS] = useState<StyleDef>({ ...style })
  const eff = resolveStyle({ ...styles, [s.id]: s }, s.id)
  const set = (patch: Partial<StyleDef>) => setS((x) => ({ ...x, ...patch }))
  return (
    <Modal title={isNew ? 'New Style' : `Modify Style: ${style.name}`} onClose={onClose} onOk={() => onOk({ ...s, name: s.name.trim() || s.id })}>
      <Row label="Name">
        <input className="k-input" value={s.name} onChange={(e) => set({ name: e.target.value })} />
      </Row>
      <Row label="Based on">
        <select className="k-input" value={s.basedOn ?? ''} onChange={(e) => set({ basedOn: e.target.value || undefined })} disabled={s.id === 'Normal'}>
          <option value="">(none)</option>
          {Object.values(styles)
            .filter((x) => x.id !== s.id)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </select>
      </Row>
      <Row label="Next paragraph">
        <select className="k-input" value={s.next ?? ''} onChange={(e) => set({ next: e.target.value || undefined })}>
          <option value="">(same style)</option>
          {Object.values(styles).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Font / size">
        <select className="k-input" value={eff.font ?? 'Calibri'} onChange={(e) => set({ font: e.target.value })}>
          {[...new Set([...(eff.font ? [eff.font] : []), ...FONTS])].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <Num value={eff.size ?? 11} step={0.5} min={1} onChange={(v) => set({ size: v })} suffix="pt" width={60} />
      </Row>
      <Row label="Look">
        <label className="kw-check">
          <input type="checkbox" checked={!!eff.bold} onChange={(e) => set({ bold: e.target.checked })} /> Bold
        </label>
        <label className="kw-check">
          <input type="checkbox" checked={!!eff.italic} onChange={(e) => set({ italic: e.target.checked })} /> Italic
        </label>
        <label className="kw-check">
          <input type="checkbox" checked={!!eff.underline} onChange={(e) => set({ underline: e.target.checked })} /> Underline
        </label>
        <label className="kw-check">
          <input type="checkbox" checked={!!eff.allCaps} onChange={(e) => set({ allCaps: e.target.checked })} /> Caps
        </label>
        <input type="color" value={eff.color ?? '#000000'} onChange={(e) => set({ color: e.target.value })} title="Colour" />
      </Row>
      <Row label="Alignment">
        <select className="k-input" value={eff.align ?? 'left'} onChange={(e) => set({ align: e.target.value as StyleDef['align'] })}>
          <option value="left">Left</option>
          <option value="center">Centred</option>
          <option value="right">Right</option>
          <option value="justify">Justified</option>
        </select>
      </Row>
      <Row label="Space before / after">
        <Num value={eff.spaceBefore ?? 0} step={1} min={0} onChange={(v) => set({ spaceBefore: v })} suffix="pt" />
        <Num value={eff.spaceAfter ?? 0} step={1} min={0} onChange={(v) => set({ spaceAfter: v })} suffix="pt" />
      </Row>
      <Row label="Line spacing">
        <Num value={eff.lineHeight ?? 1} step={0.05} min={0.5} onChange={(v) => set({ lineHeight: v })} suffix="×" />
      </Row>
      <Row label="Indent left / first line">
        <Num value={cm(eff.indentLeft ?? 0)} onChange={(v) => set({ indentLeft: pt(v) })} suffix="cm" />
        <Num value={cm(eff.indentFirst ?? 0)} onChange={(v) => set({ indentFirst: pt(v) })} suffix="cm" />
      </Row>
      <Row label="Outline level">
        <select className="k-input" value={String(s.outline ?? 0)} onChange={(e) => set({ outline: Number(e.target.value) || undefined })}>
          <option value="0">Body text</option>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              Level {n} (contents, navigation)
            </option>
          ))}
        </select>
      </Row>
      <label className="kw-check">
        <input type="checkbox" checked={!!s.quick} onChange={(e) => set({ quick: e.target.checked })} /> Show in the Styles gallery
      </label>
    </Modal>
  )
}

// ------------------------------------------------------------------ equation

const SNIPPETS: [string, string][] = [
  ['a/b', '\\frac{a}{b}'], ['x²', 'x^{2}'], ['xᵢ', 'x_{i}'], ['√x', '\\sqrt{x}'], ['ⁿ√x', '\\sqrt[n]{x}'], ['Σ', '\\sum_{i=1}^{n} '], ['∫', '\\int_{a}^{b} '],
  ['lim', '\\lim_{x \\to \\infty} '], ['( )', '\\left( \\right)'], ['matrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'], ['α', '\\alpha'], ['β', '\\beta'],
  ['π', '\\pi'], ['θ', '\\theta'], ['λ', '\\lambda'], ['μ', '\\mu'], ['σ', '\\sigma'], ['Δ', '\\Delta'], ['Ω', '\\Omega'], ['±', '\\pm'], ['×', '\\times'],
  ['≤', '\\leq'], ['≥', '\\geq'], ['≠', '\\neq'], ['≈', '\\approx'], ['∞', '\\infty'], ['→', '\\rightarrow'], ['∂', '\\partial'], ['∇', '\\nabla'], ['x̂', '\\hat{x}'],
  ['v⃗', '\\vec{v}'], ['text', '\\text{ }'],
]

export function EquationDialog({ latex: initial, display: d0, canChangeKind, onClose, onOk }: { latex: string; display: boolean; canChangeKind: boolean; onClose: () => void; onOk: (latex: string, display: boolean) => void }) {
  const [latex, setLatex] = useState(initial)
  const [display, setDisplay] = useState(d0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const preview = useMemo(() => renderMath(latex, display), [latex, display])
  useEffect(() => ref.current?.focus(), [])
  const insert = (s: string) => {
    const el = ref.current
    if (!el) return setLatex((l) => l + s)
    const a = el.selectionStart
    const b = el.selectionEnd
    const next = latex.slice(0, a) + s + latex.slice(b)
    setLatex(next)
    requestAnimationFrame(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = a + s.length
    })
  }
  return (
    <Modal title="Equation" wide onClose={onClose} onOk={() => latex.trim() && onOk(latex.trim(), display)} okLabel="Insert">
      <div className="kw-snippets">
        {SNIPPETS.map(([label, s]) => (
          <button key={label} className="k-btn small" title={s} onClick={() => insert(s)}>
            {label}
          </button>
        ))}
      </div>
      <textarea ref={ref} className="k-input kw-latex" rows={3} spellCheck={false} placeholder="LaTeX, e.g. E = mc^2" value={latex} onChange={(e) => setLatex(e.target.value)} />
      <div className="kw-eq-preview">{preview.ok ? <span dangerouslySetInnerHTML={{ __html: preview.html }} /> : <span className="k-muted">{latex.trim() ? 'KaTeX cannot read this yet…' : 'The equation appears here.'}</span>}</div>
      {canChangeKind && (
        <label className="kw-check">
          <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} /> On a line of its own (display)
        </label>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ link, footnote

export function LinkDialog({ text: t0, href: h0, onClose, onOk, onRemove }: { text: string; href: string; onClose: () => void; onOk: (text: string, href: string) => void; onRemove?: () => void }) {
  const [text, setText] = useState(t0)
  const [href, setHref] = useState(h0)
  return (
    <Modal
      title="Hyperlink"
      onClose={onClose}
      onOk={() => href.trim() && onOk(text, /^[a-z]+:|^#|^\//i.test(href.trim()) ? href.trim() : `https://${href.trim()}`)}
      extra={onRemove && <button className="k-btn" onClick={onRemove}>Remove link</button>}
    >
      <Row label="Text to show">
        <input className="k-input" value={text} onChange={(e) => setText(e.target.value)} />
      </Row>
      <Row label="Address">
        <input className="k-input" autoFocus placeholder="https://… or mailto:…" value={href} onChange={(e) => setHref(e.target.value)} />
      </Row>
    </Modal>
  )
}

export function TextDialog({ title, label, value, multiline, onClose, onOk }: { title: string; label: string; value: string; multiline?: boolean; onClose: () => void; onOk: (v: string) => void }) {
  const [v, setV] = useState(value)
  return (
    <Modal title={title} onClose={onClose} onOk={() => onOk(v)}>
      <div className="kw-section">{label}</div>
      {multiline ? <textarea className="k-input" rows={4} autoFocus value={v} onChange={(e) => setV(e.target.value)} /> : <input className="k-input" autoFocus value={v} onChange={(e) => setV(e.target.value)} />}
    </Modal>
  )
}

// ------------------------------------------------------------------ picture

export function ImageDialog({ attrs, onClose, onOk }: { attrs: Record<string, unknown>; onClose: () => void; onOk: (a: Record<string, unknown>) => void }) {
  const [w, setW] = useState(Number(attrs.width) || 200)
  const [h, setH] = useState(Number(attrs.height) || 150)
  const [lock, setLock] = useState(true)
  const ratio = (Number(attrs.height) || 150) / (Number(attrs.width) || 200)
  const [wrap, setWrap] = useState(String(attrs.wrap ?? 'inline'))
  const [alt, setAlt] = useState(String(attrs.alt ?? ''))
  return (
    <Modal title="Picture" onClose={onClose} onOk={() => onOk({ width: Math.round(w), height: Math.round(h), wrap, alt: alt || null })}>
      <Row label="Width × height">
        <Num value={Math.round(w)} step={1} min={8} onChange={(v) => (setW(v), lock && setH(v * ratio))} suffix="px" />
        <Num value={Math.round(h)} step={1} min={8} onChange={(v) => (setH(v), lock && setW(v / ratio))} suffix="px" />
      </Row>
      <label className="kw-check">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep proportions
      </label>
      <Row label="Text wrapping">
        <select className="k-input" value={wrap} onChange={(e) => setWrap(e.target.value)}>
          <option value="inline">In line with text</option>
          <option value="left">Square, picture on the left</option>
          <option value="right">Square, picture on the right</option>
        </select>
      </Row>
      <Row label="Alt text">
        <input className="k-input" value={alt} placeholder="Describe the picture for people who cannot see it" onChange={(e) => setAlt(e.target.value)} />
      </Row>
    </Modal>
  )
}

// ------------------------------------------------------------------ symbols

const SYMBOL_GROUPS: [string, string][] = [
  ['Punctuation', '–—‘’“”„«»‹›…•·°′″§¶†‡‰©®™¡¿‽'],
  ['Currency', '€£¥¢$₹₽₩₺₿¤'],
  ['Maths', '±×÷≠≈≡≤≥∞√∑∏∫∂∇∈∉⊂⊃∪∩∧∨¬∀∃∅∝∠⊥∥⌀½⅓¼¾⅔⅛'],
  ['Greek', 'αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'],
  ['Arrows', '←↑→↓↔↕⇐⇒⇔↩↪⟵⟶➔'],
  ['Letters', 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØŒÙÚÛÜÝßàáâãäåæçèéêëìíîïñòóôõöøœùúûüýÿĀāĒēĪīŌōŪūŁłŃńŚśŹźŻżČčŠšŽžŘřĞğİıŞş'],
  ['Shapes', '■□▪▫▲△▼▽◆◇○●◎★☆♠♣♥♦✓✔✗✘☐☑☒♪♫☀☁☂☎✉✂✏'],
  ['Spaces', '    ​‑­'],
]

export function SymbolDialog({ onClose, onPick }: { onClose: () => void; onPick: (s: string) => void }) {
  const [hover, setHover] = useState('')
  return (
    <Modal title="Symbol" wide onClose={onClose}>
      {SYMBOL_GROUPS.map(([name, chars]) => (
        <div key={name}>
          <div className="kw-section">{name}</div>
          <div className="kw-symbols">
            {[...chars].map((c, i) => (
              <button key={i} className="kw-symbol" onMouseEnter={() => setHover(`U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)} onClick={() => onPick(c)} title={name === 'Spaces' ? ['No-break space', 'En space', 'Em space', 'Thin space', 'Zero-width space', 'No-break hyphen', 'Soft hyphen'][i] : c}>
                {name === 'Spaces' ? '␣' : c}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="k-muted kw-hint">{hover || 'Click a symbol to insert it at the cursor.'}</div>
    </Modal>
  )
}

// ------------------------------------------------------------------ word count, templates

export function WordCountDialog({ stats, onClose }: { stats: { label: string; value: number | string }[]; onClose: () => void }) {
  return (
    <Modal title="Word Count" onClose={onClose}>
      <table className="kw-stats">
        <tbody>
          {stats.map((s) => (
            <tr key={s.label}>
              <td>{s.label}</td>
              <td>{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

export function TemplateDialog({ onClose, onPick }: { onClose: () => void; onPick: (id: TemplateId) => void }) {
  return (
    <Modal title="New from Template" wide onClose={onClose}>
      <div className="kw-templates">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="kw-template" onClick={() => onPick(t.id)}>
            <span className={`kw-template-page kw-tpl-${t.id}`}>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <b>{t.name}</b>
            <span className="k-muted">{t.description}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
