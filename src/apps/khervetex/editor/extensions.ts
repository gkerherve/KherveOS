// The visual editor's document schema (TipTap / ProseMirror), shaped after the
// KherveTeX model: paragraph styles (Body, Title, Author, Affiliation,
// Correspondence, Abstract, Keywords, Frame, Heading 0–5), maths, lists,
// figures, tables, raw LaTeX, footnotes, citations, cross-references.
// editor/convert.ts maps it to and from model.ts.

import { Extension, Mark, Node, mergeAttributes, type NodeViewRenderer } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Code } from '@tiptap/extension-code'
import { Strike } from '@tiptap/extension-strike'
import { ListItem } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { TextAlign } from '@tiptap/extension-text-align'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { HIGHLIGHT_COLORS } from '../model'
import { ReferenceResolver, type Numbered } from '../references'
import { latexToDisplay } from '../serializer'
import { paintMath } from './math'
import { findPlugin } from './find'

// ---------------------------------------------------------------- the app link

export type EditKind = 'mathBlock' | 'mathInline' | 'figure' | 'table' | 'footnote' | 'citation' | 'crossref' | 'inlineRaw'

/** What the editor needs from the KherveTeX window around it. */
export interface KtxEnv {
  /** A displayable URL for a figure's picture (a blob: URL), or null (missing, or a PDF). */
  figureUrl(path: string): string | null
  /** Does the document carry this file? */
  hasFile(path: string): boolean
  /** Open the dialog that edits the object at `pos`. */
  edit(kind: EditKind, pos: number): void
  /** A keyboard shortcut handled by the window (link, math, symbol…). */
  action(name: string): boolean
  /** BibTeX sources for showing citations as "[1]" or "Smith (2020)". */
  bibTexts: string[]
}

export const refreshKey = new PluginKey('ktxRefresh')

// ----------------------------------------------------------------- helpers

function attr(name: string, fallback: unknown = null) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-${name}`) ?? fallback,
    renderHTML: (a: Record<string, unknown>) => (a[name] === null || a[name] === undefined || a[name] === '' ? {} : { [`data-${name}`]: String(a[name]) }),
  }
}

function boolAttr(name: string, fallback: boolean) {
  return {
    default: fallback,
    parseHTML: (el: HTMLElement) => {
      const v = el.getAttribute(`data-${name}`)
      return v === null ? fallback : v === 'true'
    },
    renderHTML: (a: Record<string, unknown>) => ({ [`data-${name}`]: String(!!a[name]) }),
  }
}

// ------------------------------------------------------------ paragraph styles

/** One-line styles that hold only text: Title, Author… (model TextLine blocks). */
function textLine(name: string, tag: string) {
  return Node.create({
    name,
    group: 'block',
    content: 'inline*',
    defining: true,
    parseHTML() {
      // Above the paragraph's plain "p" rule, so copy and paste keep the style.
      return [{ tag: `${tag}[data-ktx="${name}"]`, priority: 60 }]
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { 'data-ktx': name, class: `ktx-line ktx-${name}` }), 0]
    },
  })
}

export const TitleNode = textLine('title', 'p')
export const AuthorNode = textLine('author', 'p')
export const AffiliationNode = textLine('affiliation', 'p')
export const CorrespondenceNode = textLine('correspondence', 'p')
export const AbstractNode = textLine('abstract', 'p')
export const KeywordsNode = textLine('keywords', 'p')
export const FrameNode = textLine('frame', 'p')

/** Headings: level 0 = chapter, 1..5 = Heading 1..5 (section … subparagraph). */
export const SectionNode = Node.create({
  name: 'section',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      level: {
        default: 1,
        parseHTML: (el: HTMLElement) => {
          const d = el.getAttribute('data-level')
          if (d !== null) return Number(d) || 0
          return Math.max(1, Math.min(5, Number(el.tagName.slice(1)) || 1))
        },
        renderHTML: (a: Record<string, unknown>) => ({ 'data-level': String(a.level) }),
      },
      numbered: boolAttr('numbered', true),
      label: attr('label'),
    }
  },
  parseHTML() {
    return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => ({ tag }))
  },
  renderHTML({ node, HTMLAttributes }) {
    const level = Number(node.attrs.level) || 0
    return [`h${Math.min(6, level + 1)}`, mergeAttributes(HTMLAttributes, { class: 'ktx-h' }), 0]
  },
})

// ------------------------------------------------------------------- maths

function mathBlockView(): NodeViewRenderer {
  return ({ node }) => {
    const dom = document.createElement('div')
    dom.className = 'ktx-mathblock'
    dom.contentEditable = 'false'
    const body = document.createElement('div')
    body.className = 'ktx-mathblock-body'
    dom.append(body)
    let current = node
    paintMath(body, String(node.attrs.latex ?? ''), true)
    return {
      dom,
      update(next) {
        if (next.type !== current.type) return false
        if (next.attrs.latex !== current.attrs.latex) paintMath(body, String(next.attrs.latex ?? ''), true)
        current = next
        return true
      },
      ignoreMutation: () => true,
    }
  }
}

export const MathBlockNode = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      latex: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? el.textContent ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': String(a.latex) }) },
      numbered: boolAttr('numbered', false),
      label: attr('label'),
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-ktx="math-block"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ktx': 'math-block' }), `\\[${node.attrs.latex}\\]`]
  },
  addNodeView() {
    return mathBlockView()
  },
})

function mathInlineView(): NodeViewRenderer {
  return ({ node }) => {
    const dom = document.createElement('span')
    dom.className = 'ktx-math'
    dom.contentEditable = 'false'
    let current = node
    paintMath(dom, String(node.attrs.latex ?? ''), false)
    return {
      dom,
      update(next) {
        if (next.type !== current.type) return false
        if (next.attrs.latex !== current.attrs.latex) paintMath(dom, String(next.attrs.latex ?? ''), false)
        current = next
        return true
      },
      ignoreMutation: () => true,
    }
  }
}

export const MathInlineNode = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': String(a.latex) }) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-ktx="math"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ktx': 'math' }), `$${node.attrs.latex}$`]
  },
  addNodeView() {
    return mathInlineView()
  },
})

// ----------------------------------------------------------- inline objects

/** A footnote: its text is shown inline (as the desktop does), the note goes to \\footnote{}. */
export const FootnoteNode = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      text: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-text') ?? el.textContent ?? '', renderHTML: () => ({}) },
      // The model's inlines, kept so a rich imported footnote survives until it is edited.
      children: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-ktx="footnote"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const text = String(node.attrs.text ?? '')
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ktx': 'footnote', 'data-text': text, class: 'ktx-fn', title: `Footnote: ${text}` }), text || 'footnote']
  },
})

export const CitationNode = Node.create({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      keys: {
        default: [],
        parseHTML: (el: HTMLElement) => (el.getAttribute('data-keys') ?? '').split(',').filter(Boolean),
        renderHTML: (a: Record<string, unknown>) => ({ 'data-keys': (a.keys as string[]).join(',') }),
      },
      style: attr('style', 'cite'),
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-ktx="cite"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const tip = `\\${node.attrs.style}{${(node.attrs.keys as string[]).join(',')}}`
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ktx': 'cite', class: 'ktx-cite', title: tip })]
  },
})

export const CrossRefNode = Node.create({
  name: 'crossref',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { label: attr('label', ''), kind: attr('kind', 'ref') }
  },
  parseHTML() {
    return [{ tag: 'span[data-ktx="ref"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ktx': 'ref', class: 'ktx-ref', title: `\\${node.attrs.kind}{${node.attrs.label}}` })]
  },
})

/** Verbatim LaTeX in a line; "\\\\" is a line break (Shift+Enter). */
export const InlineRawNode = Node.create({
  name: 'inlineRaw',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { latex: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': String(a.latex) }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-ktx="raw"]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const latex = String(node.attrs.latex ?? '')
    const attrs = mergeAttributes(HTMLAttributes, { 'data-ktx': 'raw', class: 'ktx-iraw', title: latex })
    if (latex === '\\\\') return ['span', mergeAttributes(attrs, { class: 'ktx-break' }), '↵', ['br']]
    return ['span', attrs, latex]
  },
})

// ------------------------------------------------------------------ figures

/** The on-screen width of a LaTeX width like 0.6\\textwidth, 8cm or 3in. */
export function cssWidth(spec: string): string {
  const s = (spec || '').trim()
  const rel = /^([\d.]*)\s*\\(textwidth|linewidth|columnwidth|hsize)$/.exec(s)
  if (rel) return `${Math.min(100, (Number(rel[1] || 1) || 1) * 100)}%`
  const abs = /^([\d.]+)\s*(cm|mm|in|pt|bp|px)$/.exec(s)
  if (abs) {
    const cm = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72.27, bp: 2.54 / 72, px: 2.54 / 96 }[abs[2] as 'cm']
    return `calc(${Number(abs[1]) * cm} * var(--ktx-cm))`
  }
  return '80%'
}

function figureView(env: () => KtxEnv): NodeViewRenderer {
  return ({ node, decorations }) => {
    const dom = document.createElement('div')
    dom.className = 'ktx-figure'
    dom.contentEditable = 'false'
    const pic = document.createElement('div')
    pic.className = 'ktx-figure-pic'
    const cap = document.createElement('div')
    cap.className = 'ktx-figcap'
    const lab = document.createElement('div')
    lab.className = 'ktx-figlabel'
    dom.append(pic, cap, lab)
    let current: PMNode | null = null
    let num: string | null = null

    const numberOf = (decos: readonly Decoration[]) => {
      for (const d of decos) if ((d.spec as { num?: string }).num) return (d.spec as { num: string }).num
      return null
    }
    const paint = (n: PMNode, decos: readonly Decoration[]) => {
      const prev = current
      current = n
      const path = String(n.attrs.path ?? '')
      if (!prev || prev.attrs.path !== path || prev.attrs.width !== n.attrs.width) {
        pic.replaceChildren()
        const url = path ? env().figureUrl(path) : null
        if (url) {
          const img = document.createElement('img')
          img.src = url
          img.alt = path
          img.draggable = false
          img.style.width = cssWidth(String(n.attrs.width ?? ''))
          pic.append(img)
        } else {
          const ph = document.createElement('div')
          ph.className = 'ktx-figure-missing'
          const name = path.slice(path.lastIndexOf('/') + 1)
          ph.textContent = !path
            ? '[No image]'
            : env().hasFile(path)
              ? `[${name} — shown in the PDF]`
              : `[Image not found: ${path}]`
          pic.append(ph)
        }
      }
      num = numberOf(decos)
      const caption = latexToDisplay(String(n.attrs.caption ?? ''))
      cap.textContent = caption ? `Figure${num ? ` ${num}` : ''}: ${caption}` : ''
      lab.textContent = n.attrs.label ? `Label: ${n.attrs.label}` : ''
    }
    paint(node, decorations)
    return {
      dom,
      update(next, decos) {
        if (next.type !== node.type) return false
        paint(next, decos)
        return true
      },
      ignoreMutation: () => true,
    }
  }
}

export function createFigureNode(env: () => KtxEnv) {
  return Node.create({
    name: 'figure',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return {
        path: attr('path', ''),
        caption: attr('caption', ''),
        label: attr('label'),
        width: attr('width', '0.8\\textwidth'),
        source: attr('source', ''),
      }
    },
    parseHTML() {
      return [{ tag: 'div[data-ktx="figure"]' }]
    },
    renderHTML({ node, HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-ktx': 'figure' }), `[Figure: ${node.attrs.path}]`]
    },
    addNodeView() {
      return figureView(env)
    },
  })
}

// ------------------------------------------------------------------- tables

const cellRaw = {
  raw: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-raw'),
    renderHTML: (a: Record<string, unknown>) => (a.raw === null || a.raw === undefined ? {} : { 'data-raw': String(a.raw) }),
  },
}

export const KtxTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      caption: attr('caption', ''),
      label: attr('label'),
      alignment: attr('alignment', ''),
      ruleStyle: attr('rules', ''),
      // A model table with no rows shows one empty cell; untouched, it stays empty.
      wasEmpty: { default: false, rendered: false },
    }
  },
}).configure({ resizable: false, HTMLAttributes: { class: 'ktx-table' } })

export const KtxTableCell = TableCell.extend({
  content: 'paragraph+',
  addAttributes() {
    return { ...this.parent?.(), ...cellRaw }
  },
})

export const KtxTableHeader = TableHeader.extend({
  content: 'paragraph+',
  addAttributes() {
    return { ...this.parent?.(), ...cellRaw }
  },
})

/** Column alignments ('l' | 'c' | 'r') from a tabular spec like "l|cr" or "p{3cm}c". */
export function columnAligns(spec: string, ncols: number): string[] {
  const out: string[] = []
  let i = 0
  const skipGroup = () => {
    if (spec[i] !== '{') return
    let depth = 0
    for (; i < spec.length; i++) {
      if (spec[i] === '{') depth++
      else if (spec[i] === '}' && --depth === 0) { i++; return }
    }
  }
  while (i < spec.length) {
    const ch = spec[i++]
    if ('lcr'.includes(ch)) out.push(ch)
    else if ('pmbX'.includes(ch)) { out.push('l'); skipGroup() }
    else if ('@!<>'.includes(ch)) skipGroup()
  }
  while (out.length < ncols) out.push('l')
  return out
}

// ---------------------------------------------------------------- raw LaTeX

function rawKind(text: string): string {
  const t = text.trim()
  if (/\\begin\{(lstlisting|verbatim|minted)\}/.test(t)) return 'code'
  if (t.includes('\\begin{thebibliography}')) return 'bib'
  if (/^\\(newpage|clearpage|pagebreak)\b\s*$/.test(t)) return 'pagebreak'
  if (/^\\hrulefill\s*$/.test(t)) return 'rule'
  if (t.startsWith('% ===== KHERVETEX')) return 'marker'
  return 'raw'
}

function rawLatexView(): NodeViewRenderer {
  return ({ node }) => {
    const dom = document.createElement('pre')
    dom.className = 'ktx-raw'
    const label = document.createElement('span')
    label.className = 'ktx-raw-tag'
    label.contentEditable = 'false'
    const code = document.createElement('code')
    dom.append(label, code)
    const setKind = (n: PMNode) => {
      const kind = rawKind(n.textContent)
      dom.dataset.kind = kind
      label.textContent = { code: 'Code', bib: 'Bibliography', pagebreak: 'Page break', rule: 'Rule', marker: 'Compile marker', raw: 'LaTeX' }[kind] ?? 'LaTeX'
    }
    setKind(node)
    return {
      dom,
      contentDOM: code,
      update(next) {
        if (next.type !== node.type) return false
        setKind(next)
        return true
      },
      ignoreMutation: (m) => m.type !== 'selection' && (m.target === dom || m.target === label || label.contains(m.target as globalThis.Node)),
    }
  }
}

export const RawLatexNode = Node.create({
  name: 'rawLatex',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'pre[data-ktx="raw"]', preserveWhitespace: 'full' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-ktx': 'raw', class: 'ktx-raw' }), ['code', 0]]
  },
  addNodeView() {
    return rawLatexView()
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => (this.editor.isActive('rawLatex') ? this.editor.commands.insertContent('  ') : false),
      // Leave the block with ↓ at its end: into the next block, or a new paragraph.
      ArrowDown: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection
        if (!empty || $from.parent.type.name !== 'rawLatex' || $from.parentOffset < $from.parent.content.size) return false
        const after = $from.after()
        if (after < state.doc.content.size) return false
        return this.editor.chain().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).run()
      },
    }
  },
})

// --------------------------------------------------------------------- marks

export const SmallcapsMark = Mark.create({
  name: 'smallcaps',
  parseHTML() {
    return [{ tag: 'span[data-ktx="sc"]' }, { style: 'font-variant=small-caps' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ktx': 'sc', class: 'ktx-sc' }), 0]
  },
})

export const HighlightMark = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      color: {
        default: 'yellow',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-color') ?? 'yellow',
        renderHTML: (a: Record<string, unknown>) => ({
          'data-color': String(a.color),
          style: `background-color: ${HIGHLIGHT_COLORS[String(a.color)] ?? '#FFFF00'}`,
        }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'mark[data-ktx="hl"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { 'data-ktx': 'hl', class: 'ktx-hl' }), 0]
  },
})

/** A reviewer's comment on a range of text (\\todo in the PDF). */
export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return {
      note: attr('note', ''),
      author: attr('author', ''),
      timestamp: attr('timestamp', ''),
      resolved: boolAttr('resolved', false),
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-ktx="comment"]' }]
  },
  renderHTML({ mark, HTMLAttributes }) {
    const tip = mark.attrs.author ? `${mark.attrs.author}: ${mark.attrs.note}` : String(mark.attrs.note)
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ktx': 'comment', class: 'ktx-comment', title: tip }), 0]
  },
})

// -------------------------------------------- numbering and display plugin
// Section, figure, table and equation numbers, and how citations and
// cross-references read, recomputed from the whole document on each change.

const numberingKey = new PluginKey<DecorationSet>('ktxNumbering')

function tableCaptionWidget(env: () => KtxEnv, num: string, caption: string, label: string | null) {
  return (view: import('@tiptap/pm/view').EditorView, getPos: () => number | undefined) => {
    const el = document.createElement('div')
    el.className = 'ktx-tabcap'
    el.contentEditable = 'false'
    const text = latexToDisplay(caption)
    el.textContent = text ? `Table ${num}: ${text}` : `Table ${num}`
    if (!text) el.classList.add('empty')
    if (label) {
      const l = document.createElement('span')
      l.className = 'ktx-tabcap-label'
      l.textContent = `  Label: ${label}`
      el.append(l)
    }
    el.title = 'Double-click to edit the caption and label'
    el.addEventListener('mousedown', (e) => e.preventDefault())
    el.addEventListener('dblclick', (e) => {
      e.preventDefault()
      const pos = getPos()
      if (pos === undefined) return
      const before = view.state.doc.resolve(pos).nodeBefore
      if (before?.type.name === 'table') env().edit('table', pos - before.nodeSize)
    })
    return el
  }
}

function buildDecorations(doc: PMNode, env: () => KtxEnv): DecorationSet {
  const objects: Numbered[] = []
  const placed: [number, PMNode][] = []
  const raws: string[] = []
  doc.forEach((node, pos) => {
    const a = node.attrs
    switch (node.type.name) {
      case 'section':
        objects.push({ kind: 'section', level: Number(a.level) || 0, numbered: !!a.numbered, label: a.label ?? null })
        placed.push([pos, node])
        break
      case 'figure':
        objects.push({ kind: 'figure', label: a.label ?? null })
        placed.push([pos, node])
        break
      case 'table':
        objects.push({ kind: 'table', label: a.label ?? null })
        placed.push([pos, node])
        break
      case 'mathBlock':
        objects.push({ kind: 'equation', numbered: !!a.numbered, label: a.label ?? null })
        placed.push([pos, node])
        break
      case 'rawLatex':
        raws.push(node.textContent)
        break
    }
  })
  const citations: string[][] = []
  doc.descendants((node) => {
    if (node.type.name === 'citation') citations.push(node.attrs.keys as string[])
    return node.isBlock
  })
  const res = new ReferenceResolver(raws, env().bibTexts, citations, objects)
  const decos: Decoration[] = []
  placed.forEach(([pos, node], i) => {
    const num = res.numbers[i]
    const end = pos + node.nodeSize
    if (num !== null) decos.push(Decoration.node(pos, end, { 'data-num': num }, { num }))
    if (node.type.name === 'table') {
      const { caption, label, alignment } = node.attrs
      decos.push(
        Decoration.widget(end, tableCaptionWidget(env, num ?? '', String(caption ?? ''), label ?? null), {
          side: -1, ignoreSelection: true, key: `tabcap:${num}:${caption}:${label}`,
        }),
      )
      // Column alignments from the tabular spec.
      const firstRow = node.firstChild
      const aligns = columnAligns(String(alignment ?? ''), firstRow ? firstRow.childCount : 0)
      node.forEach((row, rowOffset) => {
        const rowPos = pos + 1 + rowOffset
        row.forEach((cell, cellOffset, col) => {
          const align = aligns[col]
          if (align && align !== 'l') {
            const cellPos = rowPos + 1 + cellOffset
            decos.push(Decoration.node(cellPos, cellPos + cell.nodeSize, { style: `text-align: ${align === 'c' ? 'center' : 'right'}` }))
          }
        })
      })
    }
  })
  doc.descendants((node, pos) => {
    if (node.type.name === 'citation') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-display': res.citeText(node.attrs.keys as string[], String(node.attrs.style)) }))
    } else if (node.type.name === 'crossref') {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-display': res.refText(String(node.attrs.label), String(node.attrs.kind)) }))
    }
    return node.isBlock
  })
  return DecorationSet.create(doc, decos)
}

function numberingPlugin(env: () => KtxEnv) {
  return new Plugin<DecorationSet>({
    key: numberingKey,
    state: {
      init: (_config, state) => buildDecorations(state.doc, env),
      apply: (tr, old, _oldState, newState) =>
        tr.docChanged || tr.getMeta(refreshKey) ? buildDecorations(newState.doc, env) : old.map(tr.mapping, tr.doc),
    },
    props: {
      decorations: (state) => numberingKey.getState(state),
    },
  })
}

// ------------------------------------------- double-click, keys, the rest

const EDITABLE_ATOMS: Record<string, EditKind> = {
  mathBlock: 'mathBlock', mathInline: 'mathInline', figure: 'figure', footnote: 'footnote',
  citation: 'citation', crossref: 'crossref', inlineRaw: 'inlineRaw',
}

function createKtxBehaviour(env: () => KtxEnv) {
  return Extension.create({
    name: 'ktxBehaviour',
    addKeyboardShortcuts() {
      const act = (name: string) => () => env().action(name)
      return {
        'Shift-Enter': () => {
          if (this.editor.isActive('rawLatex')) return this.editor.commands.insertContent('\n')
          return this.editor.commands.insertContent({ type: 'inlineRaw', attrs: { latex: '\\\\' } })
        },
        'Mod-m': act('mathInline'),
        'Ctrl-m': act('mathInline'),
        'Mod-Shift-m': act('mathBlock'),
        'Ctrl-Shift-m': act('mathBlock'),
        'Mod-k': act('link'),
        'Mod-Shift-h': act('highlight'),
        'Mod-Alt-m': act('comment'),
        'Mod-Shift-g': act('symbol'),
        'Mod-Shift-x': () => this.editor.commands.toggleStrike(),
      }
    },
    addProseMirrorPlugins() {
      return [
        numberingPlugin(env),
        findPlugin(),
        new Plugin({
          props: {
            handleDoubleClickOn: (_view, _pos, node, nodePos) => {
              const kind = EDITABLE_ATOMS[node.type.name]
              if (!kind) return false
              env().edit(kind, nodePos)
              return true
            },
          },
        }),
      ]
    },
  })
}

/** Strike without TipTap's ⇧⌘S, which is Save As here (⇧⌘X instead). */
const KtxStrike = Strike.extend({
  addKeyboardShortcuts() {
    return {}
  },
})

/** Code that may combine with bold, italic… like the model allows. */
const KtxCode = Code.extend({ excludes: '' })

/** A list item holds one paragraph: the model has no nested lists. */
const KtxListItem = ListItem.extend({ content: 'paragraph' })

export function createExtensions(env: () => KtxEnv) {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
      hardBreak: false,
      code: false,
      strike: false,
      listItem: false,
      trailingNode: false,
      dropcursor: { color: '#2e9e5b', width: 2 },
      link: {
        openOnClick: false,
        autolink: false,
        linkOnPaste: false,
        HTMLAttributes: { rel: null, target: null, class: 'ktx-link' },
        isAllowedUri: (url) => !/^\s*(javascript|vbscript|data):/i.test(url),
      },
    }),
    KtxCode,
    KtxStrike,
    KtxListItem,
    Subscript,
    Superscript,
    SmallcapsMark,
    HighlightMark,
    CommentMark,
    TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right', 'justify'], defaultAlignment: null }),
    Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? 'Start writing…' : '') }),
    SectionNode,
    TitleNode,
    AuthorNode,
    AffiliationNode,
    CorrespondenceNode,
    AbstractNode,
    KeywordsNode,
    FrameNode,
    MathBlockNode,
    MathInlineNode,
    FootnoteNode,
    CitationNode,
    CrossRefNode,
    InlineRawNode,
    createFigureNode(env),
    KtxTable,
    TableRow,
    KtxTableCell,
    KtxTableHeader,
    RawLatexNode,
    createKtxBehaviour(env),
  ]
}
