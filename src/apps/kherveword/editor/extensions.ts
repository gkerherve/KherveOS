// KherveWord's document schema (TipTap / ProseMirror): Word-like paragraphs
// (one node with a style and direct formatting), lists with numbering styles,
// tables with borders and shading, pictures that can be resized and wrapped,
// page and section breaks, a table of contents, footnotes, equations,
// comments and tracked changes. The .docx reader/writer use the same JSON.

import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { BulletList, OrderedList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow, TableView } from '@tiptap/extension-table'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { TextStyle } from '@tiptap/extension-text-style'
import { Highlight } from '@tiptap/extension-highlight'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as PMNodeT } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { fontStack, normColor, type StyleDef } from '../model'
import { layoutPlugin } from './layout'
import { findPlugin } from './find'
import { trackPlugin } from './tracking'
import { paintMath } from './math'

/** What the schema needs from the window around it. */
export interface WordEnv {
  styles(): Record<string, StyleDef>
  /** The headings and their pages, for the table of contents. */
  toc(): { text: string; level: number; page: number; pos: number }[]
  /** Open the dialog that edits the object at `pos`. */
  edit(kind: 'equation' | 'equationBlock' | 'footnote' | 'image' | 'toc', pos: number): void
  /** Call `fn` whenever the headings or their pages change; returns the unsubscribe. */
  subscribeToc(fn: () => void): () => void
  /** Jump to a position (table of contents entries). */
  goTo(pos: number): void
  /** Called after every view update (the layout runs then). */
  viewUpdated(view: EditorView): void
  /** Track changes on, and who is writing. */
  tracking(): { on: boolean; author: string }
}

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Word's single line is about 1.17 × the font size. */
export const LINE = 1.17

// ------------------------------------------------------------------ paragraphs

const HEAD_TAG: Record<string, string> = { Title: 'h1', Heading1: 'h1', Heading2: 'h2', Heading3: 'h3', Heading4: 'h4', Heading5: 'h5', Heading6: 'h6' }

function paragraphStyle(a: Record<string, unknown>): string {
  const css: string[] = []
  if (a.align) css.push(`text-align:${a.align}`)
  if (typeof a.indentLeft === 'number') css.push(`margin-left:${a.indentLeft}pt`)
  if (typeof a.indentRight === 'number') css.push(`margin-right:${a.indentRight}pt`)
  if (typeof a.indentFirst === 'number') css.push(`text-indent:${a.indentFirst}pt`)
  if (typeof a.spaceBefore === 'number') css.push(`padding-top:${a.spaceBefore}pt`)
  if (typeof a.spaceAfter === 'number') css.push(`padding-bottom:${a.spaceAfter}pt`)
  if (typeof a.lineHeight === 'number') css.push(`line-height:${(a.lineHeight * LINE).toFixed(3)}`)
  if (a.shading) css.push(`background-color:${a.shading}`)
  const b = a.border as string | null
  if (b) {
    const line = '0.75pt solid #000'
    if (b === 'box') css.push(`border:${line}`, 'padding-left:4pt', 'padding-right:4pt')
    if (b === 'top' || b === 'topBottom') css.push(`border-top:${line}`)
    if (b === 'bottom' || b === 'topBottom') css.push(`border-bottom:${line}`)
  }
  return css.join(';')
}

export const WordParagraph = Node.create<{ env: WordEnv | null }>({
  name: 'paragraph',
  priority: 1000,
  group: 'block',
  content: 'inline*',
  addOptions() {
    return { env: null }
  },
  addAttributes() {
    const data = (name: string, parse: (v: string | null) => unknown = (v) => v) => ({
      default: null,
      parseHTML: (el: HTMLElement) => parse(el.getAttribute(`data-${name}`)),
      renderHTML: () => ({}),
    })
    return {
      style: {
        default: 'Normal',
        parseHTML: (el: HTMLElement) => {
          const d = el.getAttribute('data-style')
          if (d) return d
          const m = /^H([1-6])$/.exec(el.tagName)
          return m ? `Heading${m[1]}` : 'Normal'
        },
        renderHTML: () => ({}),
      },
      align: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const a = el.getAttribute('data-align') ?? el.style.textAlign
          return a === 'center' || a === 'right' || a === 'justify' || a === 'left' ? a : null
        },
        renderHTML: () => ({}),
      },
      indentLeft: data('indent-left', num),
      indentRight: data('indent-right', num),
      indentFirst: data('indent-first', num),
      spaceBefore: data('space-before', num),
      spaceAfter: data('space-after', num),
      lineHeight: data('line-height', num),
      border: data('border'),
      shading: data('shading'),
      tabs: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          try {
            const v = el.getAttribute('data-tabs')
            return v ? JSON.parse(v) : null
          } catch {
            return null
          }
        },
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() {
    // KherveWord's own HTML (copy and paste between windows) keeps its tabs and spaces.
    const own = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((t) => ({ tag: `${t}[data-style]`, priority: 70, preserveWhitespace: true as const }))
    return [...own, { tag: 'p' }, ...[1, 2, 3, 4, 5, 6].map((n) => ({ tag: `h${n}` })), { tag: 'blockquote > p', priority: 60, attrs: { style: 'Quote' } }]
  },
  renderHTML({ node }) {
    const a = node.attrs as Record<string, unknown>
    const style = String(a.style || 'Normal')
    const attrs: Record<string, string> = { 'data-style': style, class: `kw-p kw-s-${style.replace(/[^A-Za-z0-9_-]/g, '')}` }
    const css = paragraphStyle(a)
    if (css) attrs.style = css
    const keys: [string, string][] = [
      ['align', 'align'], ['indentLeft', 'indent-left'], ['indentRight', 'indent-right'], ['indentFirst', 'indent-first'], ['spaceBefore', 'space-before'],
      ['spaceAfter', 'space-after'], ['lineHeight', 'line-height'], ['border', 'border'], ['shading', 'shading'],
    ]
    for (const [k, d] of keys) if (a[k] !== null && a[k] !== undefined) attrs[`data-${d}`] = String(a[k])
    if (Array.isArray(a.tabs) && a.tabs.length) attrs['data-tabs'] = JSON.stringify(a.tabs)
    return [HEAD_TAG[style] ?? 'p', attrs, 0]
  },
  addKeyboardShortcuts() {
    return {
      // After a heading, Enter starts the style's "next" style (Normal).
      Enter: ({ editor }) => {
        const { state } = editor
        const { $from, empty } = state.selection
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false
        if ($from.node(-1)?.type.name === 'listItem') return false
        const style = String($from.parent.attrs.style ?? 'Normal')
        const next = this.options.env?.styles()[style]?.next
        if (!next || next === style) return false
        return editor.chain().splitBlock().updateAttributes('paragraph', { style: next, align: null }).run()
      },
    }
  },
})

// ------------------------------------------------------------------ lists

export const WordBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyle: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-list-style'),
        renderHTML: (a: Record<string, unknown>) => (a.listStyle ? { 'data-list-style': a.listStyle } : {}),
      },
    }
  },
})

export const WordOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      listStyle: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const d = el.getAttribute('data-list-style')
          if (d) return d
          const t = el.getAttribute('type')
          return t === 'a' ? 'lower-alpha' : t === 'A' ? 'upper-alpha' : t === 'i' ? 'lower-roman' : t === 'I' ? 'upper-roman' : null
        },
        renderHTML: (a: Record<string, unknown>) => (a.listStyle ? { 'data-list-style': a.listStyle } : {}),
      },
    }
  },
})

// ------------------------------------------------------------------ text style

/** Font, size and colour on TipTap's textStyle mark (fonts with fallbacks). */
export const WordTextStyleAttrs = Extension.create({
  name: 'kwTextStyleAttrs',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-font') ?? (el.style.fontFamily ? el.style.fontFamily.split(',')[0].replace(/["']/g, '').trim() : null),
            renderHTML: (a: Record<string, unknown>) => (a.fontFamily ? { 'data-font': a.fontFamily, style: `font-family: ${fontStack(String(a.fontFamily))}` } : {}),
          },
          fontSize: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const s = el.style.fontSize
              if (!s) return null
              if (s.endsWith('pt')) return s
              if (s.endsWith('px')) return `${Math.round(parseFloat(s) * 0.75 * 2) / 2}pt`
              return null
            },
            renderHTML: (a: Record<string, unknown>) => (a.fontSize ? { style: `font-size: ${a.fontSize}` } : {}),
          },
          color: {
            default: null,
            parseHTML: (el: HTMLElement) => normColor(el.style.color) ?? (el.style.color || null),
            renderHTML: (a: Record<string, unknown>) => (a.color ? { style: `color: ${a.color}` } : {}),
          },
        },
      },
    ]
  },
})

// ------------------------------------------------------------------ comments and changes

export const CommentMark = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    return { id: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-comment'), renderHTML: (a: Record<string, unknown>) => ({ 'data-comment': a.id }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'kw-comment' }), 0]
  },
})

function changeMark(name: 'insertion' | 'deletion', tag: string) {
  return Mark.create({
    name,
    inclusive: false,
    excludes: name === 'insertion' ? 'deletion' : 'insertion',
    addAttributes() {
      const a = (k: string) => ({ default: null, parseHTML: (el: HTMLElement) => el.getAttribute(`data-${k}`), renderHTML: (v: Record<string, unknown>) => (v[k] ? { [`data-${k}`]: v[k] } : {}) })
      return { id: a('id'), author: a('author'), date: a('date') }
    },
    parseHTML() {
      return [{ tag: `${tag}[data-author]`, priority: 70 }]
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { class: `kw-${name}`, title: `${name === 'insertion' ? 'Inserted' : 'Deleted'} by ${HTMLAttributes['data-author'] ?? 'someone'}` }), 0]
    },
  })
}
export const InsertionMark = changeMark('insertion', 'ins')
export const DeletionMark = changeMark('deletion', 'del')

// ------------------------------------------------------------------ blocks

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: 'page', parseHTML: (el: HTMLElement) => el.getAttribute('data-kind') ?? 'page', renderHTML: (a: Record<string, unknown>) => ({ 'data-kind': a.kind }) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }, { tag: 'div[style*="page-break-after"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-break', class: 'kw-pagebreak', contenteditable: 'false' })]
  },
})

export const TocNode = Node.create<{ env: WordEnv | null }>({
  name: 'toc',
  group: 'block',
  atom: true,
  selectable: true,
  addOptions() {
    return { env: null }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="toc"]' }]
  },
  renderHTML() {
    return ['div', { 'data-type': 'toc', class: 'kw-toc' }]
  },
  addNodeView() {
    const env = this.options.env
    return () => {
      const dom = document.createElement('div')
      dom.className = 'kw-toc'
      dom.contentEditable = 'false'
      let last = ''
      const paint = () => {
        const items = env?.toc().filter((h) => h.level <= 3) ?? []
        const key = JSON.stringify(items)
        if (key === last) return
        last = key
        dom.innerHTML = ''
        const title = document.createElement('div')
        title.className = 'kw-toc-title'
        title.textContent = 'Contents'
        dom.appendChild(title)
        if (!items.length) {
          const e = document.createElement('div')
          e.className = 'kw-toc-empty'
          e.textContent = 'No headings yet: use the Heading styles, and the table of contents fills itself in.'
          dom.appendChild(e)
        }
        for (const h of items) {
          const row = document.createElement('div')
          row.className = `kw-toc-row kw-toc-${h.level}`
          const t = document.createElement('span')
          t.className = 'kw-toc-text'
          t.textContent = h.text
          const dots = document.createElement('span')
          dots.className = 'kw-toc-dots'
          const pg = document.createElement('span')
          pg.className = 'kw-toc-page'
          pg.textContent = String(h.page)
          row.append(t, dots, pg)
          row.title = 'Click to go to this heading'
          row.onmousedown = (e) => {
            e.preventDefault()
            env?.goTo(h.pos)
          }
          dom.appendChild(row)
        }
      }
      paint()
      const off = env?.subscribeToc(paint)
      return {
        dom,
        update: (node: PMNodeT) => {
          if (node.type.name !== 'toc') return false
          paint()
          return true
        },
        destroy: () => off?.(),
        ignoreMutation: () => true,
        // Clicks on an entry jump there; elsewhere the box can be selected (and deleted).
        stopEvent: (e: Event) => e.type === 'mousedown' && !!(e.target as HTMLElement).closest?.('.kw-toc-row'),
      }
    }
  },
})

function mathView(display: boolean, env: WordEnv | null, kind: 'equation' | 'equationBlock') {
  return ({ node, getPos }: { node: PMNodeT; getPos: () => number | undefined }) => {
    const dom = document.createElement(display ? 'div' : 'span')
    dom.className = display ? 'kw-eq-block' : 'kw-eq'
    dom.contentEditable = 'false'
    let latex = String(node.attrs.latex ?? '')
    paintMath(dom, latex, display)
    dom.ondblclick = () => {
      const p = getPos()
      if (p !== undefined) env?.edit(kind, p)
    }
    return {
      dom,
      update: (n: PMNodeT) => {
        if (n.type !== node.type) return false
        if (n.attrs.latex !== latex) {
          latex = String(n.attrs.latex ?? '')
          paintMath(dom, latex, display)
        }
        return true
      },
      ignoreMutation: () => true,
    }
  }
}

export const EquationNode = Node.create<{ env: WordEnv | null }>({
  name: 'equation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { env: null }
  },
  addAttributes() {
    return { latex: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': a.latex }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="equation"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'equation' })]
  },
  addNodeView() {
    return mathView(false, this.options.env, 'equation') as never
  },
})

export const EquationBlockNode = Node.create<{ env: WordEnv | null }>({
  name: 'equationBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addOptions() {
    return { env: null }
  },
  addAttributes() {
    return { latex: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-latex') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': a.latex }) } }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="equation-block"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'equation-block' })]
  },
  addNodeView() {
    return mathView(true, this.options.env, 'equationBlock') as never
  },
})

export const FootnoteNode = Node.create<{ env: WordEnv | null }>({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions() {
    return { env: null }
  },
  addAttributes() {
    return { text: { default: '', parseHTML: (el: HTMLElement) => el.getAttribute('data-text') ?? '', renderHTML: (a: Record<string, unknown>) => ({ 'data-text': a.text }) } }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="footnote"]' }, { tag: 'sup[data-type="footnote"]', priority: 60 }]
  },
  renderHTML({ HTMLAttributes }) {
    // The number comes from a CSS counter (document order).
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-type': 'footnote', class: 'kw-fn' })]
  },
  addNodeView() {
    const env = this.options.env
    return ({ node, getPos }) => {
      const dom = document.createElement('sup')
      dom.className = 'kw-fn'
      dom.contentEditable = 'false'
      dom.title = String(node.attrs.text ?? '')
      dom.ondblclick = () => {
        const p = getPos()
        if (p !== undefined) env?.edit('footnote', p)
      }
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'footnote') return false
          dom.title = String(n.attrs.text ?? '')
          return true
        },
        ignoreMutation: () => true,
      }
    }
  },
})

// ------------------------------------------------------------------ pictures

export const WordImage = Node.create<{ env: WordEnv | null }>({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { env: null }
  },
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('alt') || null },
      title: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('title') || null },
      width: { default: null, parseHTML: (el: HTMLElement) => num(el.getAttribute('width')) ?? (el.style.width.endsWith('px') ? parseFloat(el.style.width) : null) },
      height: { default: null, parseHTML: (el: HTMLElement) => num(el.getAttribute('height')) },
      wrap: { default: 'inline', parseHTML: (el: HTMLElement) => el.getAttribute('data-wrap') ?? 'inline' },
    }
  },
  parseHTML() {
    return [{ tag: 'img[src]' }]
  },
  renderHTML({ node }) {
    const a = node.attrs
    const css: string[] = []
    if (a.wrap === 'left' || a.wrap === 'right') css.push(`float:${a.wrap}`, a.wrap === 'left' ? 'margin:2pt 9pt 4pt 0' : 'margin:2pt 0 4pt 9pt')
    return ['img', { src: a.src, alt: a.alt ?? '', width: a.width ?? undefined, height: a.height ?? undefined, 'data-wrap': a.wrap, style: css.join(';') || undefined }]
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span')
      dom.className = 'kw-img'
      const img = document.createElement('img')
      img.draggable = false
      dom.appendChild(img)
      const handle = document.createElement('span')
      handle.className = 'kw-img-handle'
      dom.appendChild(handle)
      let cur = node
      const paint = () => {
        const a = cur.attrs
        img.src = String(a.src ?? '')
        img.alt = String(a.alt ?? '')
        img.style.width = a.width ? `${a.width}px` : ''
        img.style.height = a.width && a.height ? `${a.height}px` : ''
        dom.dataset.wrap = String(a.wrap ?? 'inline')
      }
      paint()
      img.onload = () => {
        // Remember the natural size once, so pages and .docx know it.
        if (!cur.attrs.width && img.naturalWidth) {
          const pos = getPos()
          if (pos === undefined) return
          const max = (editor.view.dom as HTMLElement).clientWidth * 0.95 || 600
          const w = Math.min(img.naturalWidth, Math.max(50, max - 200))
          const h = Math.round((w * img.naturalHeight) / img.naturalWidth)
          const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, width: Math.round(w), height: h })
          tr.setMeta('addToHistory', false).setMeta('kwNoTrack', true).setMeta('kwSilent', true)
          editor.view.dispatch(tr)
        }
      }
      handle.onpointerdown = (e) => {
        e.preventDefault()
        e.stopPropagation()
        const startX = e.clientX
        const r = img.getBoundingClientRect()
        const scale = r.width / (img.offsetWidth || r.width || 1)
        const w0 = img.offsetWidth
        const ratio = img.offsetHeight / Math.max(1, img.offsetWidth)
        const move = (ev: PointerEvent) => {
          const w = Math.max(16, w0 + (ev.clientX - startX) / scale)
          img.style.width = `${w}px`
          img.style.height = `${w * ratio}px`
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          const pos = getPos()
          if (pos === undefined) return
          const w = Math.round(img.offsetWidth)
          editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, width: w, height: Math.round(w * ratio) }).setMeta('kwNoTrack', true))
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }
      dom.ondblclick = () => {
        const p = getPos()
        if (p !== undefined) this.options.env?.edit('image', p)
      }
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'image') return false
          cur = n
          paint()
          return true
        },
        selectNode: () => dom.classList.add('selected'),
        deselectNode: () => dom.classList.remove('selected'),
        ignoreMutation: () => true,
        stopEvent: (e) => e.target === handle,
      }
    }
  },
})

// ------------------------------------------------------------------ tables

class WordTableView extends TableView {
  constructor(node: PMNodeT, cellMinWidth: number) {
    super(node, cellMinWidth)
    this.table.dataset.borders = String(node.attrs.borders ?? 'all')
  }
  update(node: PMNodeT): boolean {
    const ok = super.update(node)
    if (ok) this.table.dataset.borders = String(node.attrs.borders ?? 'all')
    return ok
  }
}

const cellAttrs = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-background') ?? (el.style.backgroundColor || null),
    renderHTML: (a: Record<string, unknown>) => (a.background ? { 'data-background': a.background, style: `background-color:${a.background}` } : {}),
  },
  valign: {
    default: null,
    parseHTML: (el: HTMLElement) => el.getAttribute('data-valign'),
    renderHTML: (a: Record<string, unknown>) => (a.valign ? { 'data-valign': a.valign, style: `vertical-align:${a.valign}` } : {}),
  },
}

export const WordTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borders: {
        default: 'all',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-borders') ?? (el.getAttribute('border') === '0' ? 'none' : 'all'),
        renderHTML: (a: Record<string, unknown>) => ({ 'data-borders': a.borders }),
      },
    }
  },
}).configure({ resizable: true, cellMinWidth: 24, View: WordTableView as never, lastColumnResizable: true })

export const WordTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs }
  },
})
export const WordTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttrs }
  },
})

// ------------------------------------------------------------------ keys

const WordKeys = Extension.create({
  name: 'kwKeys',
  priority: 50,
  addKeyboardShortcuts() {
    return {
      // Outside lists and tables, Tab types a tab.
      Tab: ({ editor }) => {
        editor.view.dispatch(editor.state.tr.insertText('\t').scrollIntoView())
        return true
      },
      'Shift-Tab': () => true,
      'Mod-Enter': ({ editor }) => editor.chain().insertContent({ type: 'pageBreak', attrs: { kind: 'page' } }).run(),
    }
  },
})

/** Plugins that need the window: layout (pages), find highlights, tracked changes. */
const WordPlugins = Extension.create<{ env: WordEnv | null }>({
  name: 'kwPlugins',
  addOptions() {
    return { env: null }
  },
  addProseMirrorPlugins() {
    const env = this.options.env!
    return [layoutPlugin((v) => env.viewUpdated(v)), findPlugin(), trackPlugin(() => env.tracking())]
  },
})

export function wordExtensions(env: WordEnv) {
  return [
    StarterKit.configure({
      paragraph: false,
      heading: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      bulletList: false,
      orderedList: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
      undoRedo: { depth: 500, newGroupDelay: 600 },
    }),
    WordParagraph.configure({ env }),
    WordBulletList,
    WordOrderedList,
    TextStyle,
    WordTextStyleAttrs,
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    CommentMark,
    InsertionMark,
    DeletionMark,
    PageBreak,
    TocNode.configure({ env }),
    EquationNode.configure({ env }),
    EquationBlockNode.configure({ env }),
    FootnoteNode.configure({ env }),
    WordImage.configure({ env }),
    WordTable,
    TableRow,
    WordTableHeader,
    WordTableCell,
    Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? 'Start typing…' : ''), showOnlyCurrent: true }),
    WordKeys,
    WordPlugins.configure({ env }),
  ]
}

/** Select a position and scroll it into view. */
export function goToPos(view: EditorView, pos: number) {
  const p = Math.max(0, Math.min(pos + 1, view.state.doc.content.size))
  view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(p))).scrollIntoView())
  view.focus()
}
