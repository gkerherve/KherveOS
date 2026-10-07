// The desktop's maths and chemistry editors (khervedoc/equation_editor.py):
//
//   Equation editor — a ribbon with Structures (Fraction, Large op, Integral…)
//   and Symbols tabs, the equation drawn large, its LaTeX, "Display on its own
//   line" and "Numbered". Opened by Inline math, Math block and the Equation
//   builder, and by double-clicking an equation.
//   Chemistry editor — mhchem reactions (\ce{…}) from a palette, previewed live.
//   Chemical structure editor — chemfig structures, previewed by compiling them
//   with LaTeX, exactly as they will look in the PDF.
//
// The palettes are the desktop's own (palettes.ts, generated from it). Empty
// slots are \square: Tab jumps to the next one, a click selects it.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { compileLatex } from '@/os/services/latex'
import { openPdf } from '@/os/services/pdf'
import { renderMath } from '../editor/math'
import { SYMBOL_GROUPS, TEXT_MODE_SYMBOLS } from '../symbols'
import {
  CATEGORY_FACES, CHEM_CATEGORY_ICONS, CHEM_GROUPS, CHEMFIG_CATEGORY_ICONS, CHEMFIG_GROUPS, CHEMFIG_PREVIEW_DOC, ENV_NAMES,
  EQUATION_GROUPS, NICE, SYMBOL_TABS, TEMPLATE_NAMES,
} from '../palettes'
import { Modal, type Done } from './dialogs'

const SQUARE = '\\square'
const CE_SLOT = '$\\square$'

/** mathbox.normalize_template: templates keep line breaks as the two characters \n. */
export function normalizeTemplate(s: string): string {
  return s.replace(/\\n(?![A-Za-z])/g, '\n').replace(/(\\\\\s*){2,}/g, '\\\\ ')
}

function niceName(latex: string): string {
  const m = /^\\([A-Za-z]+)/.exec(latex)
  if (!m) return latex
  const name = m[1]
  const nice = (NICE as Record<string, string>)[name]
  if (nice) return nice
  return name[0].toUpperCase() + name.slice(1)
}

function templateName(latex: string, fallback: string): string {
  const named = (TEMPLATE_NAMES as Record<string, string>)[latex]
  if (named) return named
  const env = /^\\begin\{(\w+)\}/.exec(latex)
  if (env && (ENV_NAMES as Record<string, string>)[env[1]]) return (ENV_NAMES as Record<string, string>)[env[1]]
  const fn = /^\\([a-z]+)\(/.exec(latex)
  if (fn) return ({ sin: 'Sine', cos: 'Cosine', tan: 'Tangent', arctan: 'Inverse tangent' } as Record<string, string>)[fn[1]] ?? fn[1]
  if (latex.startsWith('\\') && !latex.includes('{')) return niceName(latex)
  return fallback
}

/** Palette entries like \hat{a} insert an empty slot, not "a". */
function symbolInsertLatex(latex: string): string {
  return latex.startsWith('\\mathbb') ? latex : latex.replace(/\{[a-z]\}/g, `{${SQUARE}}`)
}

/** KaTeX for a preview; an equation environment KaTeX cannot draw is drawn without it. */
function mathHtml(latex: string, display = true): string | null {
  const first = renderMath(latex, display)
  if (first.ok) return first.html
  const env = /\\begin\{(\w+\*?)\}([\s\S]*?)\\end\{\1\}/.exec(latex)
  if (env) {
    const inner = renderMath(`\\begin{aligned}${env[2]}\\end{aligned}`, true)
    if (inner.ok) return inner.html
  }
  return null
}

function Katex({ latex, display = true, className }: { latex: string; display?: boolean; className?: string }) {
  const html = useMemo(() => mathHtml(latex, display), [latex, display])
  if (html === null) return <span className={`${className ?? ''} ktx-tpl-text`}>{latex}</span>
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

// ------------------------------------------------- the LaTeX field with slots

/** _EquationLatexEdit: Tab / Shift-Tab jump between empty slots, a click selects one, they are highlighted. */
function SlotEditor({ value, onChange, slot, rows, placeholder, areaRef, autoFocus }: {
  value: string
  onChange: (v: string) => void
  slot: string
  rows: number
  placeholder?: string
  areaRef: React.RefObject<HTMLTextAreaElement | null>
  autoFocus?: boolean
}) {
  const back = useRef<HTMLDivElement>(null)
  const spans = (text: string) => {
    const out: [number, number][] = []
    let i = text.indexOf(slot)
    while (i >= 0) {
      out.push([i, i + slot.length])
      i = text.indexOf(slot, i + slot.length)
    }
    return out
  }
  const selectSlotAt = (pos: number) => {
    const el = areaRef.current
    if (!el) return false
    for (const [a, b] of spans(el.value)) {
      if (a <= pos && pos <= b) {
        el.setSelectionRange(a, b)
        return true
      }
    }
    return false
  }
  const jump = (forward: boolean) => {
    const el = areaRef.current
    if (!el) return
    const text = el.value
    let i: number
    if (forward) {
      i = text.indexOf(slot, el.selectionEnd)
      if (i < 0) i = text.indexOf(slot)
    } else {
      i = text.lastIndexOf(slot, Math.max(0, el.selectionStart - 1))
      if (i >= el.selectionStart) i = -1
      if (i < 0) i = text.lastIndexOf(slot)
    }
    if (i >= 0) el.setSelectionRange(i, i + slot.length)
  }
  // The highlighted copy of the text behind the transparent field.
  const parts: ReactNode[] = []
  let last = 0
  spans(value).forEach(([a, b], k) => {
    parts.push(value.slice(last, a))
    parts.push(<mark key={k}>{value.slice(a, b)}</mark>)
    last = b
  })
  parts.push(value.slice(last) + '\n')
  return (
    <div className="ktx-slot">
      <div ref={back} className="ktx-slot-back" aria-hidden>{parts}</div>
      <textarea
        ref={areaRef}
        className="ktx-slot-area"
        rows={rows}
        value={value}
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (back.current) back.current.scrollTop = e.currentTarget.scrollTop
        }}
        onMouseUp={(e) => {
          const el = e.currentTarget
          if (el.selectionStart === el.selectionEnd) selectSlotAt(el.selectionStart)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault()
            jump(!e.shiftKey)
          } else if (e.key === '}') {
            // \begin{env + } → the whole environment with a slot inside.
            const el = e.currentTarget
            const before = el.value.slice(0, el.selectionStart)
            const m = /\\begin\{(\w+\*?)$/.exec(before)
            if (m) {
              e.preventDefault()
              const ins = `}\n${slot}\n\\end{${m[1]}}`
              const next = before + ins + el.value.slice(el.selectionEnd)
              onChange(next)
              const at = before.length + 2
              requestAnimationFrame(() => el.setSelectionRange(at, at + slot.length))
            }
          }
        }}
      />
    </div>
  )
}

/** Put `snippet` at the caret (over the selection) and select its first slot. */
function insertAtCaret(el: HTMLTextAreaElement | null, value: string, snippet: string, slot: string, set: (v: string) => void) {
  const a = el ? el.selectionStart : value.length
  const b = el ? el.selectionEnd : value.length
  const next = value.slice(0, a) + snippet + value.slice(b)
  set(next)
  requestAnimationFrame(() => {
    if (!el) return
    el.focus()
    const i = snippet.indexOf(slot)
    if (i >= 0) el.setSelectionRange(a + i, a + i + slot.length)
    else el.setSelectionRange(a + snippet.length, a + snippet.length)
  })
}

const slotHint = (n: number, how: string) => (n ? `${n} empty slot${n !== 1 ? 's' : ''} — ${how}` : '')
const countSlots = (s: string, slot: string) => (s ? s.split(slot).length - 1 : 0)

// ----------------------------------------------------------- equation editor

export interface EquationResult {
  latex: string
  display: boolean
  numbered: boolean
  label: string | null
}

export function EquationEditor({ initial, showLayout, done }: {
  initial: EquationResult
  /** New equations choose inline or display; re-editing keeps what it was. */
  showLayout: boolean
  done: Done<EquationResult>
}) {
  const [latex, setLatex] = useState(initial.latex)
  const [display, setDisplay] = useState(initial.display)
  const [numbered, setNumbered] = useState(initial.numbered)
  const [label, setLabel] = useState(initial.label ?? '')
  const [ribbon, setRibbon] = useState<'structures' | 'symbols'>('structures')
  const [cat, setCat] = useState(0)
  const [symCat, setSymCat] = useState(0)
  const [showSource, setShowSource] = useState(true)
  const area = useRef<HTMLTextAreaElement>(null)
  const insert = (tex: string) => insertAtCaret(area.current, latex, normalizeTemplate(tex), SQUARE, setLatex)
  const symGroups = SYMBOL_GROUPS.filter(([g]) => g !== 'KherveTeX')
  const n = countSlots(latex, SQUARE)
  const preview = latex.trim() ? mathHtml(latex, display || !showLayout ? true : false) : null
  return (
    <Modal
      title="Equation editor"
      width={860}
      onCancel={() => done(null)}
      onOk={() => done({ latex: latex.trim(), display, numbered: display && numbered, label: display && numbered && label.trim() ? label.trim() : null })}
      okDisabled={!latex.trim()}
      okLabel="Insert"
      extra={
        <>
          <button className={`k-btn small${showSource ? ' on' : ''}`} onClick={() => setShowSource((v) => !v)}>
            {showSource ? 'Hide LaTeX' : 'Show LaTeX'}
          </button>
          {showLayout && (
            <>
              <label className="ktx-check" title={'Checked: a display equation on its own line.\nUnchecked: inline math inside the current paragraph.'}>
                <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} /> Display on its own line
              </label>
              <label className="ktx-check" title="Give the display equation a number, e.g. (1).">
                <input type="checkbox" disabled={!display} checked={numbered} onChange={(e) => setNumbered(e.target.checked)} /> Numbered
              </label>
            </>
          )}
          <span className="ktx-slot-hint">{slotHint(n, 'press Tab to jump between them')}</span>
        </>
      }
    >
      <div className="ktx-ribbon">
        <div className="ktx-ribbon-tabs">
          <button className={ribbon === 'structures' ? 'on' : ''} onClick={() => setRibbon('structures')}>Structures</button>
          <button className={ribbon === 'symbols' ? 'on' : ''} onClick={() => setRibbon('symbols')}>Symbols</button>
        </div>
        {ribbon === 'structures' ? (
          <>
            <div className="ktx-ribbon-cats">
              {EQUATION_GROUPS.map(([group], i) => {
                const [face, sample] = CATEGORY_FACES[i] ?? [group, '']
                return (
                  <button key={group} className={`ktx-cat${cat === i ? ' on' : ''}`} title={group} onClick={() => setCat(i)}>
                    {sample && <Katex latex={sample} display={false} className="ktx-cat-face" />}
                    <span>{face}</span>
                  </button>
                )
              })}
            </div>
            <div className="ktx-ribbon-items">
              {EQUATION_GROUPS[cat][1].map(([tex, fallback]) => (
                <button key={tex} className="ktx-tpl" title={templateName(tex, fallback)} onClick={() => insert(tex)}>
                  <Katex latex={normalizeTemplate(tex)} />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="ktx-ribbon-cats">
              {symGroups.map(([group], i) => {
                const [label2, glyph] = SYMBOL_TABS[i] ?? [group, '']
                return (
                  <button key={group} className={`ktx-cat row${symCat === i ? ' on' : ''}`} title={group} onClick={() => setSymCat(i)}>
                    {glyph}  {label2}
                  </button>
                )
              })}
            </div>
            <div className="ktx-ribbon-items symbols">
              {symGroups[symCat][1].filter(([tex]) => !TEXT_MODE_SYMBOLS.has(tex)).map(([tex, glyph]) => {
                const ins = symbolInsertLatex(tex)
                return (
                  <button key={tex} className="ktx-sym" title={niceName(tex)} onClick={() => insert(ins)}>
                    {[...glyph].length <= 2 && !tex.includes('{') ? glyph : <Katex latex={ins} display={false} />}
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
      <div className="ktx-eq-canvas">
        {preview ? (
          <span dangerouslySetInnerHTML={{ __html: preview }} />
        ) : (
          <span className="ktx-eq-empty">{latex.trim() ? "KaTeX can't draw this here; LaTeX may still typeset it." : 'Pick a structure above, or type the LaTeX below'}</span>
        )}
        <div className="ktx-eq-hint">Tab  next slot  ·  click a slot to select it  ·  \  commands (e.g. \alpha)  ·  ⌘↩  insert</div>
      </div>
      {showSource && (
        <div className="ktx-eq-source">
          <div className="ktx-eq-hint left">LaTeX — edit here to change the equation</div>
          <SlotEditor value={latex} onChange={setLatex} slot={SQUARE} rows={3} areaRef={area} autoFocus />
        </div>
      )}
      {display && numbered && showLayout && (
        <input className="k-input ktx-eq-label" value={label} placeholder="Label, for cross-references (e.g. eq:energy)" onChange={(e) => setLabel(e.target.value)} />
      )}
    </Modal>
  )
}

// ----------------------------------------------------- the palette dialogs

function PaletteDialog({
  title, groups, icons, cols, emptyHint, sourceLabel, editHint, slot, value, setValue, preview, renderTemplate, extra, done, cancel, okDisabled,
}: {
  title: string
  groups: readonly (readonly [string, readonly (readonly [string, string])[]])[]
  icons: readonly string[]
  cols: number
  emptyHint: string
  sourceLabel: string
  editHint: string
  slot: string
  value: string
  setValue: (v: string) => void
  preview: ReactNode
  renderTemplate: (tex: string, label: string) => ReactNode
  extra?: ReactNode
  done: () => void
  cancel: () => void
  okDisabled: boolean
}) {
  const [cat, setCat] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const n = countSlots(value, slot)
  return (
    <Modal title={title} width={660} onCancel={cancel} onOk={done} okLabel="Insert" okDisabled={okDisabled}>
      <div className="ktx-pal-preview">{value.trim() ? preview : <span className="ktx-eq-empty">{emptyHint}</span>}</div>
      <div className="ktx-pal-cats" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
        {groups.map(([g], i) => (
          <button key={g} className={`ktx-pal-cat${cat === i ? ' on' : ''}`} title={g} onClick={() => setCat(i)}>
            {icons[i] ?? g.slice(0, 3)}
          </button>
        ))}
      </div>
      <div className="ktx-pal-label">{groups[cat][0]}</div>
      <div className="ktx-pal-items">
        {groups[cat][1].map(([tex, label]) => (
          <button key={tex + label} className="ktx-tpl" title={tex} onClick={() => insertAtCaret(area.current, value, tex, slot, setValue)}>
            {renderTemplate(tex, label)}
          </button>
        ))}
      </div>
      <div className="ktx-pal-src">{sourceLabel}</div>
      <SlotEditor value={value} onChange={setValue} slot={slot} rows={3} areaRef={area} placeholder={editHint} autoFocus />
      <div className="ktx-slot-hint">{slotHint(n, 'click one (or press Tab) to select it, then type to fill it in.')}</div>
      {extra}
    </Modal>
  )
}

/** chemistry.wrap_ce */
export function wrapCe(body: string): string {
  const b = body.trim()
  if (!b) return ''
  if (b.startsWith('\\ce{') && b.endsWith('}')) return b
  return `\\ce{${b}}`
}

/** chemistry.unwrap_ce: the body of one \ce{…}, or null. */
export function unwrapCe(latex: string): string | null {
  const s = (latex || '').trim()
  if (!(s.startsWith('\\ce{') && s.endsWith('}'))) return null
  let depth = 0
  for (let i = 3; i < s.length; i++) {
    if (s[i] === '{') depth += 1
    else if (s[i] === '}') {
      depth -= 1
      if (depth === 0) return i === s.length - 1 ? s.slice(4, i) : null
    }
  }
  return null
}

export function ChemistryEditor({ initial = '', done }: { initial?: string; done: Done<{ latex: string; display: boolean }> }) {
  const [body, setBody] = useState(initial)
  const [display, setDisplay] = useState(false)
  return (
    <PaletteDialog
      title="Chemistry editor"
      groups={CHEM_GROUPS}
      icons={CHEM_CATEGORY_ICONS}
      cols={5}
      emptyHint="Click a template to start building your reaction"
      sourceLabel="Formula (mhchem syntax, inserted inside \ce{…}):"
      editHint="e.g.  2H2 + O2 -> 2H2O"
      slot={CE_SLOT}
      value={body}
      setValue={setBody}
      preview={<Katex latex={wrapCe(body)} />}
      renderTemplate={(tex, label) => {
        const html = mathHtml(wrapCe(tex), false)
        return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="ktx-tpl-text">{label}</span>
      }}
      okDisabled={!body.trim()}
      done={() => done(body.trim() ? { latex: wrapCe(body), display } : null)}
      cancel={() => done(null)}
      extra={
        <>
          <label className="ktx-check">
            <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} /> Display on its own line (numbered equation)
          </label>
          <div className="ktx-slot-hint">For 2-D molecular structures (rings, bonds, wedges) use Insert ▸ Chemical structure… — it draws native chemfig.</div>
        </>
      }
    />
  )
}

/** The chemfig preview: a real LaTeX compile of a standalone document, drawn from its PDF. */
function ChemfigPreview({ body }: { body: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'bad'>('idle')
  useEffect(() => {
    const text = body.trim()
    if (!text) return
    let gone = false
    const t = window.setTimeout(async () => {
      setState('busy')
      const doc = CHEMFIG_PREVIEW_DOC.replace('@@BODY@@', text)
      const r = await compileLatex('chemfig_preview.tex', { 'chemfig_preview.tex': doc })
      if (gone) return
      if (!r.ok || !r.pdf) return setState('bad')
      try {
        const pdf = await openPdf(r.pdf)
        const bmp = await pdf.renderPage(0, 200 / 72)
        pdf.close()
        const c = canvas.current
        if (gone || !c) return bmp.close()
        c.width = bmp.width
        c.height = bmp.height
        c.style.width = `${bmp.width / 2}px`
        c.getContext('2d')?.drawImage(bmp, 0, 0)
        bmp.close()
        setState('ok')
      } catch {
        if (!gone) setState('bad')
      }
    }, 700)
    return () => {
      gone = true
      window.clearTimeout(t)
    }
  }, [body])
  return (
    <>
      <canvas ref={canvas} className="ktx-chemfig-canvas" style={{ display: state === 'ok' ? undefined : 'none' }} />
      {state === 'busy' && <span className="ktx-eq-empty">Rendering…</span>}
      {state === 'bad' && <span className="ktx-eq-bad">Cannot render — check the chemfig syntax.</span>}
    </>
  )
}

export function ChemfigEditor({ initial = '', done }: { initial?: string; done: Done<string> }) {
  const [src, setSrc] = useState(initial)
  return (
    <PaletteDialog
      title="Chemical structure editor"
      groups={CHEMFIG_GROUPS}
      icons={CHEMFIG_CATEGORY_ICONS}
      cols={7}
      emptyHint="Pick a structure or scheme template to start"
      sourceLabel="chemfig source (inserted as-is into the document):"
      editHint="e.g.  \chemfig{*6(======)}"
      slot={SQUARE}
      value={src}
      setValue={setSrc}
      preview={<ChemfigPreview body={src} />}
      renderTemplate={(_tex, label) => <span className="ktx-tpl-text">{label}</span>}
      okDisabled={!src.trim()}
      done={() => done(src.trim() || null)}
      cancel={() => done(null)}
    />
  )
}
