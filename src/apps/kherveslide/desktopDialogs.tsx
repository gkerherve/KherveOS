// The desktop's smaller dialogs, as the port has them: the symbol palette
// (symbol_palette.py + symbols.py), the table size picker and table design
// gallery (table_styles.py), the chemical-structure editor (chemfig), the
// automatic slideshow (slideshow.AutoSlideshowDialog), a list chooser (the
// desktop's QInputDialog.getItem), Help ▸ User Guide (help.py, the same
// docs/USER_GUIDE.md), Help ▸ About (about.py) and Compiler ▸ Compiler status.

import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { latexStatus, type LatexStatus } from '@/os/services/latex'
import { Modal } from './dialogs'
import type { AutoPlay } from './Present'
import type { Deck, Slide } from './model'
import type { Media } from './media'
import { deckLook } from './look'
import { SlideView } from './SlideView'

// ------------------------------------------------------------------ symbols (symbols.py)

export const SYMBOL_GROUPS: [string, [string, string][]][] = [
  ['Greek (lowercase)', [
    ['\\alpha', 'α'], ['\\beta', 'β'], ['\\gamma', 'γ'], ['\\delta', 'δ'], ['\\epsilon', 'ε'], ['\\varepsilon', 'ɛ'], ['\\zeta', 'ζ'], ['\\eta', 'η'],
    ['\\theta', 'θ'], ['\\vartheta', 'ϑ'], ['\\iota', 'ι'], ['\\kappa', 'κ'], ['\\lambda', 'λ'], ['\\mu', 'μ'], ['\\nu', 'ν'], ['\\xi', 'ξ'],
    ['\\pi', 'π'], ['\\varpi', 'ϖ'], ['\\rho', 'ρ'], ['\\varrho', 'ϱ'], ['\\sigma', 'σ'], ['\\varsigma', 'ς'], ['\\tau', 'τ'], ['\\upsilon', 'υ'],
    ['\\phi', 'φ'], ['\\varphi', 'ϕ'], ['\\chi', 'χ'], ['\\psi', 'ψ'], ['\\omega', 'ω'],
  ]],
  ['Greek (uppercase)', [
    ['\\Gamma', 'Γ'], ['\\Delta', 'Δ'], ['\\Theta', 'Θ'], ['\\Lambda', 'Λ'], ['\\Xi', 'Ξ'], ['\\Pi', 'Π'], ['\\Sigma', 'Σ'], ['\\Upsilon', 'Υ'],
    ['\\Phi', 'Φ'], ['\\Psi', 'Ψ'], ['\\Omega', 'Ω'],
  ]],
  ['Operators', [
    ['\\pm', '±'], ['\\mp', '∓'], ['\\times', '×'], ['\\div', '÷'], ['\\cdot', '·'], ['\\ast', '∗'], ['\\star', '⋆'], ['\\circ', '∘'],
    ['\\bullet', '•'], ['\\oplus', '⊕'], ['\\ominus', '⊖'], ['\\otimes', '⊗'], ['\\oslash', '⊘'], ['\\odot', '⊙'], ['\\dagger', '†'], ['\\ddagger', '‡'],
  ]],
  ['Relations', [
    ['\\leq', '≤'], ['\\geq', '≥'], ['\\neq', '≠'], ['\\approx', '≈'], ['\\equiv', '≡'], ['\\sim', '∼'], ['\\simeq', '≃'], ['\\cong', '≅'],
    ['\\propto', '∝'], ['\\ll', '≪'], ['\\gg', '≫'], ['\\subset', '⊂'], ['\\supset', '⊃'], ['\\subseteq', '⊆'], ['\\supseteq', '⊇'], ['\\in', '∈'],
    ['\\notin', '∉'], ['\\ni', '∋'], ['\\perp', '⊥'], ['\\parallel', '∥'], ['\\mid', '∣'],
  ]],
  ['Arrows', [
    ['\\to', '→'], ['\\leftarrow', '←'], ['\\rightarrow', '→'], ['\\Rightarrow', '⇒'], ['\\Leftarrow', '⇐'], ['\\Leftrightarrow', '⇔'],
    ['\\leftrightarrow', '↔'], ['\\uparrow', '↑'], ['\\downarrow', '↓'], ['\\Uparrow', '⇑'], ['\\Downarrow', '⇓'], ['\\mapsto', '↦'],
    ['\\hookrightarrow', '↪'], ['\\longrightarrow', '⟶'], ['\\longleftarrow', '⟵'],
  ]],
  ['Calculus', [
    ['\\int', '∫'], ['\\iint', '∬'], ['\\iiint', '∭'], ['\\oint', '∮'], ['\\sum', '∑'], ['\\prod', '∏'], ['\\coprod', '∐'], ['\\partial', '∂'],
    ['\\nabla', '∇'], ['\\infty', '∞'], ['\\sqrt{x}', '√x'], ['\\frac{a}{b}', 'a/b'], ['\\lim', 'lim'], ['\\sup', 'sup'], ['\\inf', 'inf'],
  ]],
  ['Logic & sets', [
    ['\\forall', '∀'], ['\\exists', '∃'], ['\\nexists', '∄'], ['\\neg', '¬'], ['\\land', '∧'], ['\\lor', '∨'], ['\\cap', '∩'], ['\\cup', '∪'],
    ['\\setminus', '∖'], ['\\emptyset', '∅'], ['\\varnothing', '⌀'], ['\\mathbb{R}', 'ℝ'], ['\\mathbb{N}', 'ℕ'], ['\\mathbb{Z}', 'ℤ'],
    ['\\mathbb{Q}', 'ℚ'], ['\\mathbb{C}', 'ℂ'],
  ]],
  ['Misc & punctuation', [
    ['\\degree', '°'], ['\\angle', '∠'], ['\\triangle', '△'], ['\\square', '□'], ['\\diamond', '⋄'], ['\\dots', '…'], ['\\cdots', '⋯'],
    ['\\vdots', '⋮'], ['\\ddots', '⋱'], ['\\hbar', 'ℏ'], ['\\ell', 'ℓ'], ['\\Re', 'ℜ'], ['\\Im', 'ℑ'], ['\\aleph', 'ℵ'], ['\\copyright', '©'],
    ['\\textregistered', '®'], ['\\texttrademark', '™'],
  ]],
  ['Accents (over a letter)', [
    ['\\hat{a}', 'â'], ['\\bar{a}', 'ā'], ['\\tilde{a}', 'ã'], ['\\vec{a}', '→a'], ['\\dot{a}', 'ȧ'], ['\\ddot{a}', 'ä'], ['\\acute{a}', 'á'],
    ['\\grave{a}', 'à'], ['\\check{a}', 'ǎ'], ['\\breve{a}', 'ă'],
  ]],
  ['kTeX', [['\\Kstroke', 'Ꝁ']]],
]

/** Text-mode macros: inserted as they are, not inside $…$ (symbols.TEXT_MODE_SYMBOLS). */
export const TEXT_MODE_SYMBOLS = new Set(['\\Kstroke'])

export function SymbolDialog({ onDone }: { onDone: (latex: string | null) => void }) {
  const [tab, setTab] = useState(0)
  return (
    <Modal title="Insert symbol" onCancel={() => onDone(null)} wide>
      <div className="ks2-modal-body">
        <div className="ks2-qtabs wrap">
          {SYMBOL_GROUPS.map(([g], i) => (
            <button key={g} className={`ks2-qtab${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>
              {g}
            </button>
          ))}
        </div>
        <div className="ks2-symbols">
          {SYMBOL_GROUPS[tab][1].map(([latex, glyph]) => (
            <button key={latex} className="k-btn" title={latex} onClick={() => onDone(latex)}>
              {glyph || latex}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ tables (table_styles.py)

export interface TableStyle {
  name: string
  header_bg: string
  header_fg: string
  grid: string
  striped: boolean
  stripe_color: string
  rule_color: string
  color: string
  header: boolean
}

const style = (name: string, header_bg: string, header_fg: string, grid: string, striped: boolean, stripe: string, rule: string, header = true): TableStyle => ({
  name, header_bg, header_fg, grid, striped, stripe_color: stripe, rule_color: rule, color: '#000000', header,
})

const ACCENTS: [string, string, string][] = [
  ['Blue', '#2E75B6', '#DEEBF7'], ['Orange', '#ED7D31', '#FCE4D6'], ['Green', '#548235', '#E2EFDA'], ['Red', '#C00000', '#F8D7D2'],
  ['Purple', '#7030A0', '#E6DBF2'], ['Teal', '#2A9D8F', '#D7F0EC'], ['Grey', '#595959', '#EDEDED'],
]

export const TABLE_STYLES: TableStyle[] = [
  style('Plain', '#FFFFFF', '#000000', 'all', false, '#F5F5F5', '#BFBFBF'),
  style('Grid only', '#FFFFFF', '#000000', 'all', false, '#F5F5F5', '#808080'),
  style('No grid', '#FFFFFF', '#000000', 'none', false, '#F5F5F5', '#BFBFBF', false),
  style('Lines', '#FFFFFF', '#000000', 'horizontal', false, '#F5F5F5', '#808080'),
  ...ACCENTS.flatMap(([nm, hd, lt]) => [
    style(`${nm} header`, hd, '#FFFFFF', 'horizontal', false, lt, hd),
    style(`${nm} banded`, hd, '#FFFFFF', 'horizontal', true, lt, hd),
    style(`${nm} grid`, hd, '#FFFFFF', 'all', false, lt, hd),
  ]),
]

/** apply_table_style: copy a design's fields onto a table. */
export function applyTableStyle(t: { header: boolean; header_bg: string; header_fg: string; grid: string; border: boolean; striped: boolean; stripe_color: string; rule_color: string; color: string }, st: TableStyle) {
  t.header = st.header
  t.header_bg = st.header_bg
  t.header_fg = st.header_fg
  t.grid = st.grid
  t.border = st.grid !== 'none'
  t.striped = st.striped
  t.stripe_color = st.stripe_color
  t.rule_color = st.rule_color
  t.color = st.color
}

function TableSwatch({ st }: { st: TableStyle }) {
  const rows = 4
  const rh = 70 / rows
  return (
    <svg width={116} height={70} viewBox="0 0 116 70" className="ks2-tswatch">
      <rect width={116} height={70} fill="#fff" />
      {st.header && <rect width={116} height={rh} fill={st.header_bg} />}
      {Array.from({ length: rows - 1 }, (_, k) => k + 1).map((r) =>
        st.striped && (r - 1) % 2 === 1 ? <rect key={r} y={r * rh} width={116} height={rh} fill={st.stripe_color} /> : null,
      )}
      {st.grid !== 'none' &&
        Array.from({ length: rows + 1 }, (_, r) => r)
          .filter((r) => st.grid !== 'outer' || r === 0 || r === rows)
          .map((r) => <line key={`h${r}`} x1={0} x2={116} y1={r * rh} y2={r * rh} stroke={st.rule_color} />)}
      {st.grid === 'all' && [0, 1, 2, 3].map((c) => <line key={`v${c}`} y1={0} y2={70} x1={c * 38.6} x2={c * 38.6} stroke={st.rule_color} />)}
    </svg>
  )
}

export function TableDesignDialog({ onDone }: { onDone: (st: TableStyle | null) => void }) {
  return (
    <Modal title="Table design" onCancel={() => onDone(null)} wide>
      <div className="ks2-modal-body">
        <div className="ks2-tstyles">
          {TABLE_STYLES.map((st) => (
            <button key={st.name} className="ks2-tstyle" onClick={() => onDone(st)} title={st.name}>
              <TableSwatch st={st} />
              <span>{st.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

/** Insert ▸ Table ▸ Insert table…: the hover-to-size grid (TableGridPicker). */
export function TableGridDialog({ onDone, onDesign }: { onDone: (size: [number, number] | null) => void; onDesign: () => void }) {
  const [hover, setHover] = useState<[number, number]>([0, 0])
  const R = 8
  const C = 10
  return (
    <Modal title="Insert table" onCancel={() => onDone(null)}>
      <div className="ks2-modal-body">
        <div className="ks2-tgrid" onMouseLeave={() => setHover([0, 0])}>
          {Array.from({ length: R * C }, (_, k) => {
            const r = Math.floor(k / C) + 1
            const c = (k % C) + 1
            return (
              <span
                key={k}
                className={`ks2-tgrid-cell${r <= hover[0] && c <= hover[1] ? ' on' : ''}`}
                onMouseEnter={() => setHover([r, c])}
                onClick={() => onDone([r, c])}
              />
            )
          })}
        </div>
        <div className="ks2-modal-intro">{hover[0] ? `${hover[0]} × ${hover[1]} table` : 'Point at the size, then click'}</div>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn" onClick={onDesign}>
          Table design…
        </button>
        <button className="k-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ chemical structure (chemfig)

const CHEMFIG_EXAMPLES: [string, string][] = [
  ['Ethanol', '\\chemfig{H_3C-CH_2-OH}'],
  ['Benzene', '\\chemfig{*6(-=-=-=)}'],
  ['Water', '\\chemfig{H-[:30]O-[:-30]H}'],
  ['Acetic acid', '\\chemfig{H_3C-C(=[:60]O)-[:-60]OH}'],
  ['Phenol', '\\chemfig{*6(-=-=(-OH)-=)}'],
]

/** The chemfig source of a 2-D structure; the window compiles it to a picture. */
export function ChemfigDialog({ initial, onDone }: { initial: string; onDone: (code: string | null) => void }) {
  const [code, setCode] = useState(initial || '\\chemfig{}')
  return (
    <Modal title="Chemical structure" onCancel={() => onDone(null)} wide>
      <div className="ks2-modal-body">
        <div className="ks2-snippets">
          {CHEMFIG_EXAMPLES.map(([n, c]) => (
            <button key={n} className="k-btn" title={c} onClick={() => setCode(c)}>
              {n}
            </button>
          ))}
        </div>
        <textarea className="k-input ks2-textarea" rows={6} value={code} spellCheck={false} onChange={(e) => setCode(e.target.value)} />
        <div className="ks2-modal-intro">
          A molecule in chemfig notation. It is compiled once by LaTeX and placed as a picture; its source is kept beside the picture (.chemfig) so double-clicking it reopens this editor.
        </div>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="k-btn primary" disabled={!code.trim()} onClick={() => onDone(code)}>
          OK
        </button>
      </div>
    </Modal>
  )
}

/** chemfig.build_preview_doc: a standalone document cropped to the structure. */
export function chemfigDoc(body: string): string {
  return ['\\documentclass[border=4pt]{standalone}', '\\usepackage{chemfig}', '\\usepackage{amssymb}', '\\begin{document}', body.trim(), '\\end{document}', ''].join('\n')
}

// ------------------------------------------------------------------ automatic slideshow

export type ShowMode = 'full' | 'window' | 'presenter'

const REPEATS: [AutoPlay['repeat'], string][] = [
  ['once', 'Once through, then end'],
  ['loop', 'Loop continuously (until Esc)'],
  ['for', 'Loop for a set time'],
]

export function AutoSlideshowDialog({ auto, mode, fromCurrent, onDone }: {
  auto: AutoPlay
  mode: ShowMode
  fromCurrent: boolean
  onDone: (r: { auto: AutoPlay; mode: ShowMode; fromCurrent: boolean } | null) => void
}) {
  const [a, setA] = useState(auto)
  const [m, setM] = useState(mode)
  const [cur, setCur] = useState(fromCurrent)
  return (
    <Modal title="Automatic slideshow" onCancel={() => onDone(null)}>
      <div className="ks2-modal-body">
        <label className="ks2-field">
          <span>Each slide shows for</span>
          <span className="ks2-inline">
            <input className="k-input" type="number" min={1} max={3600} value={a.seconds} onChange={(e) => setA({ ...a, seconds: Math.max(1, Number(e.target.value) || 1) })} /> s
          </span>
        </label>
        <div className="ks2-field">
          <span>Repeat</span>
          <span className="ks2-radios">
            {REPEATS.map(([k, label]) => (
              <label key={k}>
                <input type="radio" checked={a.repeat === k} onChange={() => setA({ ...a, repeat: k })} /> {label}
                {k === 'for' && (
                  <>
                    {' '}
                    <input className="k-input ks2-mini" type="number" min={1} max={1440} value={a.minutes} onChange={(e) => setA({ ...a, minutes: Math.max(1, Number(e.target.value) || 1) })} /> min
                  </>
                )}
              </label>
            ))}
          </span>
        </div>
        <label className="ks2-field">
          <span>Show as</span>
          <select className="k-input" value={m} onChange={(e) => setM(e.target.value as ShowMode)}>
            <option value="full">Full screen</option>
            <option value="window">In a window</option>
            <option value="presenter">Presenter view</option>
          </select>
        </label>
        <label className="ks2-field bool">
          <span />
          <span>
            <input type="checkbox" checked={cur} onChange={(e) => setCur(e.target.checked)} /> Start from the current slide
          </span>
        </label>
        <div className="ks2-modal-intro">During the show: S pauses / resumes, the arrow keys still move by hand, Esc ends.</div>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="k-btn primary" onClick={() => onDone({ auto: a, mode: m, fromCurrent: cur })}>
          Start
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ a list to choose from (QInputDialog.getItem)

export function ListDialog({ title, label, items, onDone }: { title: string; label: string; items: string[]; onDone: (item: string | null) => void }) {
  const [v, setV] = useState(items[0] ?? '')
  return (
    <Modal title={title} onCancel={() => onDone(null)}>
      <div className="ks2-modal-body">
        <label className="ks2-field">
          <span>{label}</span>
          <select className="k-input" value={v} onChange={(e) => setV(e.target.value)} autoFocus>
            {items.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="k-btn primary" disabled={!v} onClick={() => onDone(v)}>
          OK
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Help ▸ User Guide (help.py)

const GUIDE_URL = `${import.meta.env.BASE_URL}apps/kherveslide/USER_GUIDE.md`

export function UserGuideDialog({ onClose }: { onClose: () => void }) {
  const [md, setMd] = useState('')
  const [filter, setFilter] = useState('')
  useEffect(() => {
    fetch(GUIDE_URL)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setMd)
      .catch(() => setMd('# kSlide User Guide\n\nThe guide could not be loaded.'))
  }, [])
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(md, { async: false }) as string), [md])
  const heads = useMemo(() => [...md.matchAll(/^(#{2,4})\s+(.+?)\s*$/gm)].map((m) => ({ level: m[1].length, text: m[2] })), [md])
  const go = (text: string) => {
    const el = [...document.querySelectorAll<HTMLElement>('.ks2-guide-body h2, .ks2-guide-body h3, .ks2-guide-body h4')].find((h) => h.textContent?.trim() === text.replace(/[*`]/g, ''))
    el?.scrollIntoView({ block: 'start' })
  }
  return (
    <Modal title="kSlide — User Guide" onCancel={onClose} wide>
      <div className="ks2-guide">
        <div className="ks2-guide-toc">
          <input className="k-input" placeholder="Filter the contents…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {heads
            .filter((h) => h.text.toLowerCase().includes(filter.toLowerCase()))
            .map((h, i) => (
              <button key={i} className={`ks2-guide-link l${h.level}`} onClick={() => go(h.text)}>
                {h.text.replace(/[*`]/g, '')}
              </button>
            ))}
        </div>
        <div className="ks2-guide-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Help ▸ About (about.py)

const KHERVE_TOOLS: [string, string][] = [
  ['KherveFitting', 'peak fitting for XPS spectra'],
  ['KhervePlot', 'Origin-style plotting and data analysis'],
  ['kTeX', 'Word-like writing that produces LaTeX'],
  ['kSlide', 'PowerPoint-like slides that produce beamer LaTeX'],
  ['KherveCAD', 'easy CAD with OpenSCAD as the engine'],
  ['kSheet', 'spreadsheets'],
  ['kBook', 'notebooks'],
  ['kPDF', 'reading and annotating PDFs'],
  ['kPaint', 'drawing and scientific sketches'],
]

export function AboutDialog({ onClose, onLink }: { onClose: () => void; onLink: (url: string) => void }) {
  const a = (url: string, text: string) => (
    <a
      href={url}
      onClick={(e) => {
        e.preventDefault()
        onLink(url)
      }}
    >
      {text}
    </a>
  )
  return (
    <Modal title="About kSlide" onCancel={onClose} wide>
      <div className="ks2-modal-body ks2-about">
        <div className="ks2-about-head">
          <img src="/icons/apps/kherveslide.png" width={72} height={72} alt="" />
          <div>
            <div className="ks2-about-name">kSlide</div>
            <div className="k-muted">PowerPoint-like slides that produce beamer LaTeX — in KherveOS</div>
          </div>
        </div>
        <h3>About the author</h3>
        <p>
          <b>Gwilherm Kerhervé</b> — Research Associate, Department of Materials, {a('https://www.imperial.ac.uk/materials/', 'Imperial College London')}.
        </p>
        <p>
          Works on surface analysis and X-ray Photoelectron Spectroscopy (XPS), with a focus on materials for energy storage and catalysis, and writes free,
          open-source tools for scientists. kSlide grew out of the same everyday need as kTeX: talks and lectures in proper LaTeX (beamer) without
          leaving the drag-and-drop comfort of PowerPoint.
        </p>
        <h3>{a('https://khervetools.com', 'khervetools.com')}</h3>
        <p>The home of the Kherve family of free, open-source apps for science, teaching and everyday work.</p>
        <ul>
          {KHERVE_TOOLS.map(([n, w]) => (
            <li key={n}>
              <b>{n}</b> — {w}
            </li>
          ))}
        </ul>
        <h3>kSlide</h3>
        <p>
          Design slides like in PowerPoint — drag, resize and stack text, pictures, equations and chemistry freely — and get beamer LaTeX, compiled to PDF
          with tectonic on the KherveOS server. Press F1 for the User Guide. {a('https://github.com/gkerherve/KherveSlide', 'Source on GitHub')}.
        </p>
        <p className="k-muted">Copyright © 2026 Gwilherm Kerhervé — licensed under the GNU GPL v3.0.</p>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ Compiler ▸ Compiler status

export function CompilerStatusDialog({ last, onClose }: { last: string; onClose: () => void }) {
  const [st, setSt] = useState<LatexStatus | null | undefined>(undefined)
  useEffect(() => {
    void latexStatus().then(setSt)
  }, [])
  const rows: [string, string][] =
    st === undefined
      ? [['Engine', 'asking the server…']]
      : st === null
        ? [['Engine', 'The KherveOS server is not reachable (or you are not signed in): LaTeX cannot be compiled.']]
        : [
            ['Engine', st.available ? st.engine || 'tectonic' : 'tectonic not found on the server'],
            ['Where', 'on the KherveOS server'],
            ['Sandbox', st.sandbox || '—'],
            ['Last compile', last || '—'],
          ]
  return (
    <Modal title="Compiler status" onCancel={onClose}>
      <div className="ks2-modal-body">
        <table className="ks2-status-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>
                  <b>{k}</b>
                </td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ks2-modal-intro">In KherveOS the slides are typeset by tectonic on the server, which keeps its own package cache: there is no offline bundle to download.</div>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ View ▸ Slide theme ▸ Preview themes… (theme_gallery.py)

/** Every beamer theme with the chosen colour theme, drawn on the current slide (the canvas's drawing of each theme). */
export function ThemeGallery({ deck, slide, media, themes, colourThemes, onDone }: {
  deck: Deck
  slide: Slide
  media: Media
  themes: string[]
  colourThemes: string[]
  onDone: (r: { theme: string; color: string } | null) => void
}) {
  const [color, setColor] = useState(deck.color_theme)
  const [pick, setPick] = useState(deck.theme)
  return (
    <Modal title="Preview themes" onCancel={() => onDone(null)} wide>
      <div className="ks2-modal-body">
        <label className="ks2-field">
          <span>Colour theme</span>
          <select className="k-input" value={color} onChange={(e) => setColor(e.target.value)}>
            {['', ...colourThemes].map((c) => (
              <option key={c} value={c}>
                {c || '(theme default)'}
              </option>
            ))}
          </select>
        </label>
        <div className="ks2-gallery">
          {themes.map((t) => {
            const d: Deck = { ...deck, theme: t, color_theme: color, plain_frames: false, theme_spec: { ...deck.theme_spec, enabled: false } }
            return (
              <button key={t} className={`ks2-gallery-item${pick === t ? ' current' : ''}`} onClick={() => setPick(t)} onDoubleClick={() => onDone({ theme: t, color })}>
                <SlideView deck={d} slide={slide} look={deckLook(d)} media={media} width={168} />
                <span>{t}</span>
              </button>
            )
          })}
        </div>
        <div className="ks2-modal-intro">Drawn by the Visual editor; the PDF is typeset by LaTeX. Double-click a theme to use it.</div>
      </div>
      <div className="ks2-modal-buttons">
        <button className="k-btn" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button className="k-btn primary" onClick={() => onDone({ theme: pick, color })}>
          Use this theme
        </button>
      </div>
    </Modal>
  )
}
