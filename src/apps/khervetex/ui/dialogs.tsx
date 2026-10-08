// KherveTeX's dialogs. Each one calls `done(result)` (or `done(null)` when
// cancelled); the window shows one at a time through its dialog host.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HardDrive, Image as ImageIcon, Laptop, X } from 'lucide-react'
import { renderMath } from '../editor/math'
import { SYMBOL_GROUPS } from '../symbols'
import { PAGE_SIZES } from '../pageSizes'
import { DEFAULT_PACKAGES, type DocMeta } from '../model'

export type Done<T> = (value: T | null) => void

// --------------------------------------------------------------- the frame

export function Modal({
  title, children, onCancel, onOk, okLabel = 'OK', okDisabled, width = 460, extra,
}: {
  title: string
  children: ReactNode
  onCancel: () => void
  onOk?: () => void
  okLabel?: string
  okDisabled?: boolean
  width?: number
  extra?: ReactNode
}) {
  return (
    <div className="ktx-modal" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="k-dialog ktx-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: `min(${width}px, 100%)` }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && onOk && !okDisabled && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName !== 'TEXTAREA')) {
            e.preventDefault()
            onOk()
          }
        }}
      >
        <div className="k-dialog-title">
          <span>{title}</span>
        </div>
        <div className="k-dialog-body">
          {children}
          <div className="k-dialog-buttons">
            {extra}
            <span style={{ flex: 1 }} />
            <button className="k-btn" onClick={onCancel}>
              Cancel
            </button>
            {onOk && (
              <button className="k-btn primary" disabled={okDisabled} onClick={onOk}>
                {okLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="ktx-field">
      <span className="ktx-field-label">{label}</span>
      {children}
      {hint && <span className="ktx-field-hint">{hint}</span>}
    </label>
  )
}

function useAutofocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select()
  }, [])
  return ref
}

// ---------------------------------------------------------------- text

export function TextDialog({
  title, label, initial = '', multiline, mono, placeholder, okLabel, hint, done,
}: {
  title: string
  label: string
  initial?: string
  multiline?: boolean
  mono?: boolean
  placeholder?: string
  okLabel?: string
  hint?: ReactNode
  done: Done<string>
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useAutofocus<HTMLInputElement>()
  const areaRef = useAutofocus<HTMLTextAreaElement>()
  return (
    <Modal title={title} onCancel={() => done(null)} onOk={() => done(value)} okLabel={okLabel} width={multiline ? 600 : 440}>
      <Field label={label} hint={hint}>
        {multiline ? (
          <textarea
            ref={areaRef}
            className={`k-input ktx-textarea${mono ? ' mono' : ''}`}
            rows={10}
            value={value}
            placeholder={placeholder}
            spellCheck={!mono}
            onChange={(e) => setValue(e.target.value)}
          />
        ) : (
          <input ref={inputRef} className={`k-input${mono ? ' mono' : ''}`} value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
        )}
      </Field>
    </Modal>
  )
}

// ---------------------------------------------------------------- maths

export interface MathResult {
  latex: string
  display: boolean
  numbered: boolean
  label: string | null
}

const MATH_TEMPLATES: [string, string][] = [
  ['Fraction', '\\frac{a}{b}'],
  ['Square root', '\\sqrt{x}'],
  ['Power / index', 'x^{2}_{i}'],
  ['Sum', '\\sum_{i=1}^{n} x_i'],
  ['Integral', '\\int_{a}^{b} f(x)\\,dx'],
  ['Limit', '\\lim_{x \\to 0} f(x)'],
  ['Derivative', '\\frac{\\mathrm{d}y}{\\mathrm{d}x}'],
  ['Partial derivative', '\\frac{\\partial f}{\\partial x}'],
  ['Vector', '\\vec{v}'],
  ['Matrix (2×2)', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
  ['Cases', 'f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}'],
  ['Chemistry (mhchem)', '\\ce{2H2 + O2 -> 2H2O}'],
]

/** Display environments (Insert ▸ Math environment), as in the desktop. */
export const MATH_ENVIRONMENTS: [string, string][] = [
  ['equation', '\\begin{equation}\n\\square\n\\end{equation}'],
  ['equation*', '\\begin{equation*}\n\\square\n\\end{equation*}'],
  ['align', '\\begin{align}\n\\square &= \\square \\\\\n\\square &= \\square\n\\end{align}'],
  ['align*', '\\begin{align*}\n\\square &= \\square \\\\\n\\square &= \\square\n\\end{align*}'],
  ['gather', '\\begin{gather}\n\\square \\\\\n\\square\n\\end{gather}'],
  ['gather*', '\\begin{gather*}\n\\square \\\\\n\\square\n\\end{gather*}'],
  ['multline', '\\begin{multline}\n\\square \\\\\n\\square\n\\end{multline}'],
  ['cases', '\\begin{cases}\n\\square & \\text{if } \\square \\\\\n\\square & \\text{otherwise}\n\\end{cases}'],
  ['split', '\\begin{split}\n\\square &= \\square \\\\\n\\square &= \\square\n\\end{split}'],
  ['pmatrix', '\\begin{pmatrix}\n\\square & \\square \\\\\n\\square & \\square\n\\end{pmatrix}'],
  ['bmatrix', '\\begin{bmatrix}\n\\square & \\square \\\\\n\\square & \\square\n\\end{bmatrix}'],
]

export function MathDialog({ initial, canSwitch = true, done }: { initial: MathResult; canSwitch?: boolean; done: Done<MathResult> }) {
  const [latex, setLatex] = useState(initial.latex)
  const [display, setDisplay] = useState(initial.display)
  const [numbered, setNumbered] = useState(initial.numbered)
  const [label, setLabel] = useState(initial.label ?? '')
  const ref = useAutofocus<HTMLTextAreaElement>()
  const preview = useMemo(() => renderMath(latex, display), [latex, display])
  const insert = (snippet: string) => {
    const el = ref.current
    if (!el) return setLatex((l) => l + snippet)
    const { selectionStart: a, selectionEnd: b } = el
    const next = latex.slice(0, a) + snippet + latex.slice(b)
    setLatex(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(a + snippet.length, a + snippet.length)
    })
  }
  return (
    <Modal
      title={initial.latex ? 'Edit equation' : display ? 'Insert display equation' : 'Insert inline maths'}
      onCancel={() => done(null)}
      onOk={() => done({ latex: latex.trim(), display, numbered: display && numbered, label: display && numbered && label.trim() ? label.trim() : null })}
      okDisabled={!latex.trim()}
      okLabel={initial.latex ? 'Apply' : 'Insert'}
      width={640}
    >
      <Field label="LaTeX" hint="⌘↩ to insert. Shown with KaTeX here; the PDF is typeset by LaTeX.">
        <textarea
          ref={ref}
          className="k-input ktx-textarea mono"
          rows={display ? 5 : 3}
          value={latex}
          spellCheck={false}
          placeholder={display ? 'E = mc^2' : 'x^2 + y^2'}
          onChange={(e) => setLatex(e.target.value)}
        />
      </Field>
      <div className="ktx-math-templates">
        <select className="k-input" value="" onChange={(e) => e.target.value && insert(e.target.value)}>
          <option value="">Insert a template…</option>
          {MATH_TEMPLATES.map(([name, tex]) => (
            <option key={name} value={tex}>{name}</option>
          ))}
        </select>
        <select className="k-input" value="" onChange={(e) => e.target.value && insert(e.target.value)}>
          <option value="">Symbol…</option>
          {SYMBOL_GROUPS.map(([group, items]) => (
            <optgroup key={group} label={group}>
              {items.map(([tex, glyph]) => (
                <option key={tex} value={tex}>{glyph}  {tex}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className={`ktx-math-preview${display ? ' display' : ''}`}>
        {latex.trim() ? (
          preview.ok ? <span dangerouslySetInnerHTML={{ __html: preview.html }} /> : <span className="k-muted">KaTeX can't preview this; LaTeX may still typeset it.</span>
        ) : (
          <span className="k-muted">Preview</span>
        )}
      </div>
      {canSwitch && (
        <div className="ktx-row">
          <label className="ktx-check">
            <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} /> On its own line (display)
          </label>
        </div>
      )}
      {display && (
        <div className="ktx-row">
          <label className="ktx-check">
            <input type="checkbox" checked={numbered} onChange={(e) => setNumbered(e.target.checked)} /> Numbered
          </label>
          {numbered && (
            <input className="k-input" style={{ flex: 1 }} value={label} placeholder="Label, e.g. eq:energy" onChange={(e) => setLabel(e.target.value)} />
          )}
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- figures

export interface FigureResult {
  /** A new picture, when one was chosen. */
  picture: { name: string; bytes: Uint8Array } | null
  caption: string
  label: string | null
  width: string
}

const WIDTHS = ['0.4\\textwidth', '0.6\\textwidth', '0.8\\textwidth', '\\textwidth']

export function FigureDialog({
  edit, initial, pickFromDrive, done,
}: {
  /** Editing an existing figure: the caption is LaTeX. Inserting: it is plain text. */
  edit: boolean
  initial: { caption: string; label: string | null; width: string; previewUrl: string | null }
  pickFromDrive: () => Promise<{ name: string; bytes: Uint8Array } | null>
  done: Done<FigureResult>
}) {
  const [picture, setPicture] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [preview, setPreview] = useState<string | null>(initial.previewUrl)
  const [caption, setCaption] = useState(initial.caption)
  const [label, setLabel] = useState(initial.label ?? '')
  const [width, setWidth] = useState(initial.width || '0.8\\textwidth')
  const fileInput = useRef<HTMLInputElement>(null)
  const owned = useRef<string | null>(null)
  useEffect(() => () => {
    if (owned.current) URL.revokeObjectURL(owned.current)
  }, [])
  const choose = (p: { name: string; bytes: Uint8Array }) => {
    setPicture(p)
    if (owned.current) URL.revokeObjectURL(owned.current)
    const ext = p.name.toLowerCase().split('.').pop() ?? ''
    const type = ext === 'svg' ? 'image/svg+xml' : ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`
    owned.current = ext === 'pdf' ? null : URL.createObjectURL(new Blob([p.bytes as BlobPart], { type }))
    setPreview(owned.current)
  }
  const ready = edit || !!picture
  return (
    <Modal
      title={edit ? 'Figure' : 'Insert figure'}
      onCancel={() => done(null)}
      onOk={() => done({ picture, caption: caption.trim(), label: label.trim() || null, width: width.trim() || '0.8\\textwidth' })}
      okDisabled={!ready}
      okLabel={edit ? 'Apply' : 'Insert'}
      width={540}
    >
      <div className="ktx-figure-pick">
        <div className="ktx-figure-preview">
          {preview ? <img src={preview} alt="" /> : <ImageIcon size={36} className="k-muted" />}
          {picture && !preview && <span className="k-muted">{picture.name}</span>}
        </div>
        <div className="ktx-figure-pick-buttons">
          <button className="k-btn" onClick={async () => { const p = await pickFromDrive(); if (p) choose(p) }}>
            <HardDrive size={14} /> {edit ? 'Replace from drive…' : 'From the drive…'}
          </button>
          <button className="k-btn" onClick={() => fileInput.current?.click()}>
            <Laptop size={14} /> From this computer…
          </button>
          <span className="ktx-field-hint">PNG, JPEG or PDF; other pictures (SVG, GIF, WebP…) become PNG.</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,.pdf"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) choose({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })
              e.target.value = ''
            }}
          />
        </div>
      </div>
      <Field label={edit ? 'Caption (LaTeX)' : 'Caption'}>
        <input className="k-input" value={caption} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      <div className="ktx-row">
        <Field label="Label">
          <input className="k-input" value={label} placeholder="fig:my-figure" onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Width">
          <input className="k-input mono" list="ktx-widths" value={width} onChange={(e) => setWidth(e.target.value)} />
          <datalist id="ktx-widths">
            {WIDTHS.map((w) => <option key={w} value={w} />)}
          </datalist>
        </Field>
      </div>
    </Modal>
  )
}

// ----------------------------------------------------------------- tables

export interface TableInsertResult {
  rows: number
  cols: number
  caption: string
  label: string | null
}

export function TableInsertDialog({ done }: { done: Done<TableInsertResult> }) {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)
  const [caption, setCaption] = useState('')
  const [label, setLabel] = useState('')
  return (
    <Modal title="Insert table" onCancel={() => done(null)} onOk={() => done({ rows, cols, caption: caption.trim(), label: label.trim() || null })} okLabel="Insert" width={400}>
      <div className="ktx-row">
        <Field label="Rows">
          <input className="k-input" type="number" min={1} max={50} value={rows} onChange={(e) => setRows(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
        </Field>
        <Field label="Columns">
          <input className="k-input" type="number" min={1} max={20} value={cols} onChange={(e) => setCols(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
        </Field>
      </div>
      <Field label="Caption">
        <input className="k-input" value={caption} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      <Field label="Label">
        <input className="k-input" value={label} placeholder="tab:my-table" onChange={(e) => setLabel(e.target.value)} />
      </Field>
    </Modal>
  )
}

export interface TablePropsResult {
  caption: string
  label: string | null
  alignment: string
  style: string
}

export function TablePropsDialog({ initial, done }: { initial: TablePropsResult; done: Done<TablePropsResult> }) {
  const [caption, setCaption] = useState(initial.caption)
  const [label, setLabel] = useState(initial.label ?? '')
  const [alignment, setAlignment] = useState(initial.alignment)
  const [style, setStyle] = useState(initial.style)
  return (
    <Modal
      title="Table"
      onCancel={() => done(null)}
      onOk={() => done({ caption: caption.trim(), label: label.trim() || null, alignment: alignment.trim(), style })}
      okLabel="Apply"
      width={460}
    >
      <Field label="Caption (LaTeX)">
        <input className="k-input" value={caption} onChange={(e) => setCaption(e.target.value)} autoFocus />
      </Field>
      <Field label="Label">
        <input className="k-input" value={label} placeholder="tab:my-table" onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <div className="ktx-row">
        <Field label="Columns" hint="e.g. lcr, l|c|r or p{3cm}l — empty: automatic">
          <input className="k-input mono" value={alignment} onChange={(e) => setAlignment(e.target.value)} />
        </Field>
        <Field label="Rules">
          <select className="k-input" value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="">\hline</option>
            <option value="booktabs">booktabs</option>
          </select>
        </Field>
      </div>
      <p className="ktx-field-hint">Cells hold LaTeX: write \&amp; for &amp;, $x^2$ for maths.</p>
    </Modal>
  )
}

// ------------------------------------------------------------------ links

export function LinkDialog({ initialUrl, askText, done }: { initialUrl: string; askText: boolean; done: Done<{ url: string; text: string }> }) {
  const [url, setUrl] = useState(initialUrl)
  const [text, setText] = useState('')
  const ref = useAutofocus<HTMLInputElement>()
  return (
    <Modal title="Hyperlink" onCancel={() => done(null)} onOk={() => done({ url: url.trim(), text: text.trim() })} okDisabled={!url.trim()}>
      <Field label="Address">
        <input ref={ref} className="k-input" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
      </Field>
      {askText && (
        <Field label="Text to show" hint="Empty: the address itself (\url{}).">
          <input className="k-input" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
    </Modal>
  )
}

// -------------------------------------------------------------- citations

export function CitationDialog({
  initial, entries, done,
}: {
  initial: { keys: string[]; style: string }
  entries: { key: string; text: string }[]
  done: Done<{ keys: string[]; style: string }>
}) {
  const [keys, setKeys] = useState(initial.keys.join(', '))
  const [style, setStyle] = useState(initial.style || 'cite')
  const [filter, setFilter] = useState('')
  const ref = useAutofocus<HTMLInputElement>()
  const list = keys.split(',').map((k) => k.trim()).filter(Boolean)
  const shown = entries.filter((e) => !filter || `${e.key} ${e.text}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 200)
  return (
    <Modal title="Citation" onCancel={() => done(null)} onOk={() => done({ keys: list, style })} okDisabled={!list.length} width={560}>
      <div className="ktx-row">
        <Field label="BibTeX keys (comma-separated)">
          <input ref={ref} className="k-input mono" value={keys} onChange={(e) => setKeys(e.target.value)} />
        </Field>
        <Field label="Command">
          <select className="k-input" value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="cite">\cite — [1]</option>
            <option value="citep">\citep — (Smith, 2020)</option>
            <option value="citet">\citet — Smith (2020)</option>
          </select>
        </Field>
      </div>
      {entries.length > 0 && (
        <>
          <input className="k-input" value={filter} placeholder="Search the bibliography…" onChange={(e) => setFilter(e.target.value)} />
          <div className="ktx-picklist">
            {shown.map((e) => (
              <button
                key={e.key}
                className={`ktx-pick${list.includes(e.key) ? ' on' : ''}`}
                onClick={() => setKeys((list.includes(e.key) ? list.filter((k) => k !== e.key) : [...list, e.key]).join(', '))}
              >
                <code>{e.key}</code> <span>{e.text}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {!entries.length && (
        <p className="ktx-field-hint">
          No bibliography found. Keys come from a .bib file named in a raw <code>\bibliography{'{…}'}</code> block (beside the document), a
          <code>thebibliography</code> block, or the kRef entries a .ktex carries.
        </p>
      )}
    </Modal>
  )
}

// --------------------------------------------------------- cross-references

export function CrossRefDialog({
  labels, initial, done,
}: {
  labels: { label: string; what: string }[]
  initial: { label: string; kind: string }
  done: Done<{ label: string; kind: string }>
}) {
  const [label, setLabel] = useState(initial.label)
  const [kind, setKind] = useState(initial.kind || 'ref')
  const ref = useAutofocus<HTMLInputElement>()
  return (
    <Modal title="Cross-reference" onCancel={() => done(null)} onOk={() => done({ label: label.trim(), kind })} okDisabled={!label.trim()} width={480}>
      <div className="ktx-row">
        <Field label="Label">
          <input ref={ref} className="k-input mono" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Command">
          <select className="k-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="ref">\ref — 2.1</option>
            <option value="eqref">\eqref — (3)</option>
            <option value="pageref">\pageref — page</option>
          </select>
        </Field>
      </div>
      {labels.length > 0 ? (
        <div className="ktx-picklist">
          {labels.map((l) => (
            <button key={l.label} className={`ktx-pick${l.label === label ? ' on' : ''}`} onClick={() => setLabel(l.label)} onDoubleClick={() => done({ label: l.label, kind })}>
              <code>{l.label}</code> <span>{l.what}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="ktx-field-hint">No labels yet: give a heading, equation, figure or table a label first (right-click it).</p>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------- symbol palette

export function SymbolPalette({ onPick, onClose }: { onPick: (latex: string) => void; onClose: () => void }) {
  return (
    <div className="ktx-symbols" onMouseDown={(e) => e.preventDefault()}>
      <div className="ktx-symbols-head">
        <span>Symbols</span>
        <button className="k-icon-btn" title="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="ktx-symbols-body">
        {SYMBOL_GROUPS.map(([group, items]) => (
          <div key={group}>
            <div className="ktx-symbols-group">{group}</div>
            <div className="ktx-symbols-grid">
              {items.map(([latex, glyph]) => (
                <button key={latex} className="ktx-symbol" title={latex} onClick={() => onPick(latex)}>
                  {glyph}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------ document settings

/** The document classes offered (the desktop's toolbar list). */
export const TEMPLATE_CHOICES = [
  'article', 'report', 'book', 'letter', 'beamer', 'memoir',
  'scrartcl', 'scrreprt', 'scrbook', 'scrlttr2',
  'elsarticle', 'IEEEtran', 'revtex4-2', 'achemso', 'amsart', 'llncs', 'acmart', 'svjour3', 'sn-jnl', 'mnras', 'aa',
  'tufte-handout', 'tufte-book', 'mimosis', 'hepthesis', 'suftesi', 'toptesi', 'disser',
  'amsbook', 'ElegantBook', 'apa7', 'moderncv', 'europasscv', 'tikzposter', 'a0poster', 'exam', 'standalone',
]

export const FONT_FAMILIES: [string, string][] = [
  ['default', 'Computer Modern (LaTeX default)'],
  ['times', 'Times Roman'],
  ['palatino', 'Palatino'],
  ['charter', 'Charter'],
  ['libertine', 'Linux Libertine'],
  ['helvetica', 'Helvetica (sans-serif)'],
  ['courier', 'Courier (monospace)'],
]

type SettingsTab = 'metadata' | 'text' | 'layout' | 'packages' | 'advanced'

export function SettingsDialog({ initial, done }: { initial: DocMeta; done: Done<DocMeta> }) {
  const [m, setM] = useState<DocMeta>({ ...initial, packages: [...initial.packages] })
  const [tab, setTab] = useState<SettingsTab>('metadata')
  const [packages, setPackages] = useState(initial.packages.join('\n'))
  const set = <K extends keyof DocMeta>(k: K, v: DocMeta[K]) => setM((x) => ({ ...x, [k]: v }))
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== '' ? Number(v) : fallback)
  const margin = (k: 'margin_top_cm' | 'margin_bottom_cm' | 'margin_left_cm' | 'margin_right_cm', label: string) => (
    <Field label={label}>
      <input className="k-input" type="number" step={0.1} min={0.5} max={6} value={m[k]} onChange={(e) => set(k, num(e.target.value, m[k]))} />
    </Field>
  )
  return (
    <Modal
      title="Document settings"
      onCancel={() => done(null)}
      onOk={() => done({ ...m, packages: packages.split('\n').map((p) => p.trim()).filter(Boolean), documentclass: m.documentclass.trim() || 'article' })}
      okLabel="Apply"
      width={600}
    >
      <div className="ktx-tabs small">
        {(['metadata', 'text', 'layout', 'packages', 'advanced'] as SettingsTab[]).map((t) => (
          <button key={t} className={`ktx-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="ktx-settings">
        {tab === 'metadata' && (
          <>
            <Field label="Title" hint="Used when the document has no Title paragraph.">
              <input className="k-input" value={m.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <Field label="Author" hint="One line per line of the title block (name, then affiliation).">
              <textarea className="k-input ktx-textarea" rows={3} value={m.author} placeholder={'Name\nDepartment, Institution, City, Country'} onChange={(e) => set('author', e.target.value)} />
            </Field>
            <Field label="Document class">
              <input className="k-input mono" list="ktx-classes" value={m.documentclass} onChange={(e) => set('documentclass', e.target.value)} />
              <datalist id="ktx-classes">
                {TEMPLATE_CHOICES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>
          </>
        )}
        {tab === 'text' && (
          <>
            <Field label="Editor font" hint="Only how the visual page looks; the PDF uses the output font.">
              <input className="k-input" value={m.visual_font_family === 'Georgia' ? '' : m.visual_font_family} placeholder="Same as the output font" onChange={(e) => set('visual_font_family', e.target.value.trim() || 'Georgia')} />
            </Field>
            <Field label="Output font">
              <select className="k-input" value={m.body_font_family} onChange={(e) => set('body_font_family', e.target.value)}>
                {FONT_FAMILIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
              </select>
            </Field>
            <div className="ktx-row">
              <Field label="Body size">
                <select className="k-input" value={m.body_font_pt} onChange={(e) => set('body_font_pt', Number(e.target.value))}>
                  {[...new Set([10, 11, 12, m.body_font_pt])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v} pt</option>)}
                </select>
              </Field>
              <Field label="Line spacing">
                <input className="k-input" type="number" step={0.05} min={0.8} max={3} value={m.line_spacing} onChange={(e) => set('line_spacing', num(e.target.value, m.line_spacing))} />
              </Field>
            </div>
            <label className="ktx-check">
              <input type="checkbox" checked={m.paragraph_indent} onChange={(e) => set('paragraph_indent', e.target.checked)} /> Indent the first line of every paragraph
            </label>
          </>
        )}
        {tab === 'layout' && (
          <>
            <div className="ktx-row">
              {margin('margin_top_cm', 'Top (cm)')}
              {margin('margin_bottom_cm', 'Bottom (cm)')}
              {margin('margin_left_cm', 'Left (cm)')}
              {margin('margin_right_cm', 'Right (cm)')}
            </div>
            <div className="ktx-row">
              <Field label="Paper">
                <select className="k-input" value={m.page_size} onChange={(e) => set('page_size', e.target.value)}>
                  {PAGE_SIZES.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
                </select>
              </Field>
              <Field label="Columns (whole document)">
                <select className="k-input" value={m.column_count} onChange={(e) => set('column_count', Number(e.target.value))}>
                  <option value={1}>1 column</option>
                  <option value={2}>2 columns</option>
                  <option value={3}>3 columns</option>
                </select>
              </Field>
            </div>
            <p className="ktx-field-hint">For a multi-column region inside a one-column document, use Insert ▸ Multi-column region.</p>
          </>
        )}
        {tab === 'packages' && (
          <Field label="LaTeX packages, one per line" hint={`geometry and setspace are added automatically. Default: ${DEFAULT_PACKAGES.join(', ')}.`}>
            <textarea className="k-input ktx-textarea mono" rows={10} value={packages} onChange={(e) => setPackages(e.target.value)} />
          </Field>
        )}
        {tab === 'advanced' && (
          <>
            <Field label="Class options" hint="Extra \documentclass options, e.g. draft, landscape.">
              <input className="k-input mono" value={m.class_options} onChange={(e) => set('class_options', e.target.value)} />
            </Field>
            <Field label="Preamble (verbatim LaTeX)">
              <textarea className="k-input ktx-textarea mono" rows={5} value={m.preamble_extras} onChange={(e) => set('preamble_extras', e.target.value)} />
            </Field>
            <Field label="Front matter (verbatim LaTeX)">
              <textarea className="k-input ktx-textarea mono" rows={3} value={m.frontmatter_extras} onChange={(e) => set('frontmatter_extras', e.target.value)} />
            </Field>
            <Field label="Bibliography style (kRef citations)">
              <input className="k-input mono" value={m.bib_style} onChange={(e) => set('bib_style', e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  )
}
