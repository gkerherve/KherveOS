// The page: one endless TipTap document the user writes on directly (the
// desktop's editor.py, one QTextEdit). A section is a level-1 heading; every
// other paragraph is a block — Text, Key point, Question, Transcript
// (paragraph "kind"), Subsection / Sub-subsection (heading 2-3), list items
// (knItem, flat with a nesting level, as in the model), pictures (knImage) and
// attached documents (knAttachment). A paragraph is timed when its first
// character is typed (`t`, seconds since the note started); the times show in
// the left margin. Maths typed as LaTeX ($…$, $$…$$, \(…\), \[…\]) is drawn
// with KaTeX while the cursor is elsewhere.

import { Extension, Node, mergeAttributes, textblockTypeInputRule, type Editor, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Paragraph from '@tiptap/extension-paragraph'
import Heading from '@tiptap/extension-heading'
import { Placeholder } from '@tiptap/extension-placeholder'
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { Mapping } from '@tiptap/pm/transform'
import type { Node as PMNode, NodeType } from '@tiptap/pm/model'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { mathSpans } from './serializer'
import type { JNode } from './convert'

/** What the page needs from the window around it. */
export interface KnEnv {
  /** "14:31:04" for a time, as the margin shows it. */
  timeLabel(t: number): string
  /** Seconds since the note started, for stamping a new paragraph (null: no start time). */
  elapsed(): number | null
  showMath(): boolean
  /** A displayable URL for a picture in the note, or null. */
  assetUrl(path: string): string | null
  editCaption(pos: number): void
  openAttachment(path: string, name: string): void
  attachmentMenu(e: MouseEvent, pos: number, path: string, name: string): void
  /** A pasted or dropped picture file: store it and return its asset path. */
  addPicture(file: File): Promise<string | null>
  /** Paths dragged from the Files app onto the page. */
  dropPaths(paths: string[], pos: number): void
}

export type StyleCode = 'typed' | 'important' | 'question' | 'transcript' | 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered'

export const STYLES: { code: StyleCode; label: string; shortcut?: string }[] = [
  { code: 'typed', label: 'Text', shortcut: 'Ctrl+0' },
  { code: 'h1', label: 'Section', shortcut: 'Ctrl+1' },
  { code: 'h2', label: 'Subsection', shortcut: 'Ctrl+2' },
  { code: 'h3', label: 'Sub-subsection', shortcut: 'Ctrl+3' },
  { code: 'important', label: 'Key point', shortcut: 'Ctrl+Shift+K' },
  { code: 'question', label: 'Question', shortcut: 'Ctrl+Shift+Q' },
  { code: 'transcript', label: 'Transcript' },
  { code: 'bullet', label: 'Bullet list', shortcut: 'Ctrl+Shift+8' },
  { code: 'numbered', label: 'Numbered list', shortcut: 'Ctrl+Shift+7' },
]

const timeAttr = {
  default: null,
  keepOnSplit: false,
  parseHTML: (el: HTMLElement) => {
    const v = el.getAttribute('data-t')
    return v == null || v === '' ? null : Number(v)
  },
  renderHTML: (a: Record<string, unknown>) => (a.t == null ? {} : { 'data-t': String(a.t) }),
}

const KnParagraph = Paragraph.extend({
  addAttributes() {
    return {
      kind: {
        default: 'typed',
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-kind') || 'typed',
        renderHTML: (a: Record<string, unknown>) => ({ 'data-kind': String(a.kind ?? 'typed'), class: `kn-p kn-${String(a.kind ?? 'typed')}` }),
      },
      t: timeAttr,
    }
  },
})

const KnHeading = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), t: timeAttr }
  },
  addKeyboardShortcuts() {
    return {}
  },
}).configure({ levels: [1, 2, 3], HTMLAttributes: { class: 'kn-h' } })

const KnItem = Node.create({
  name: 'knItem',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes() {
    return {
      level: { default: 0, parseHTML: (el) => Number(el.getAttribute('data-level') ?? 0), renderHTML: (a) => ({ 'data-level': String(a.level) }) },
      numbered: { default: false, parseHTML: (el) => el.getAttribute('data-numbered') === 'true', renderHTML: (a) => ({ 'data-numbered': String(!!a.numbered) }) },
      t: timeAttr,
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-kn-item]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-kn-item': '', class: 'kn-item' }), 0]
  },
  addKeyboardShortcuts() {
    const level = (delta: number) => () => {
      const { $from } = this.editor.state.selection
      if ($from.parent.type.name !== 'knItem') return false
      const pos = $from.before()
      const next = Number($from.parent.attrs.level) + delta
      if (next < 0) return this.editor.commands.command(({ tr }) => (tr.setNodeMarkup(pos, this.editor.schema.nodes.paragraph, { kind: 'typed', t: $from.parent.attrs.t }), true))
      return this.editor.commands.command(({ tr }) => (tr.setNodeMarkup(pos, undefined, { ...$from.parent.attrs, level: Math.min(3, next) }), true))
    }
    return {
      Enter: () => {
        const { $from, empty } = this.editor.state.selection
        if ($from.parent.type.name !== 'knItem') return false
        // Return on an empty item leaves the list.
        if (empty && $from.parent.content.size === 0) {
          const pos = $from.before()
          return this.editor.commands.command(({ tr }) => (tr.setNodeMarkup(pos, this.editor.schema.nodes.paragraph, { kind: 'typed', t: null }), true))
        }
        const attrs = { level: $from.parent.attrs.level, numbered: $from.parent.attrs.numbered, t: null }
        return this.editor.commands.command(({ tr, dispatch }) => {
          if (dispatch) {
            tr.deleteSelection()
            tr.split(tr.selection.from, 1, [{ type: this.type, attrs }])
            tr.scrollIntoView()
          }
          return true
        })
      },
      Tab: level(1),
      'Shift-Tab': level(-1),
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection
        if (!empty || $from.parent.type.name !== 'knItem' || $from.parentOffset !== 0) return false
        return level(-1)()
      },
    }
  },
  addInputRules() {
    return [
      textblockTypeInputRule({ find: /^\s*[-*•]\s$/, type: this.type, getAttributes: () => ({ level: 0, numbered: false }) }),
      textblockTypeInputRule({ find: /^\s*\d{1,3}[.)]\s$/, type: this.type, getAttributes: () => ({ level: 0, numbered: true }) }),
    ]
  },
})

/** Pictures: the image and its caption; double-click to change the caption. */
function makeImageNode(env: KnEnv) {
  return Node.create({
    name: 'knImage',
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return { path: { default: '' }, caption: { default: '' }, t: timeAttr }
    },
    parseHTML() {
      return [{ tag: 'figure[data-kn-image]', getAttrs: (el) => ({ path: (el as HTMLElement).getAttribute('data-path') ?? '' }) }]
    },
    renderHTML({ node }) {
      return ['figure', { 'data-kn-image': '', 'data-path': node.attrs.path }]
    },
    addNodeView() {
      return ({ node, getPos }) => {
        const dom = document.createElement('figure')
        dom.className = 'kn-figure'
        const img = document.createElement('img')
        img.draggable = false
        const cap = document.createElement('figcaption')
        dom.append(img, cap)
        const paint = (n: PMNode) => {
          const url = env.assetUrl(String(n.attrs.path))
          if (url) img.src = url
          else img.removeAttribute('src')
          img.alt = String(n.attrs.caption || n.attrs.path)
          img.classList.toggle('kn-missing', !url)
          cap.textContent = String(n.attrs.caption || '')
          cap.classList.toggle('kn-empty', !n.attrs.caption)
          if (!n.attrs.caption) cap.textContent = 'Double-click to add a caption'
        }
        paint(node)
        dom.addEventListener('dblclick', (e) => {
          e.preventDefault()
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (typeof pos === 'number') env.editCaption(pos)
        })
        return {
          dom,
          update: (n) => {
            if (n.type.name !== 'knImage') return false
            paint(n)
            return true
          },
        }
      }
    },
  })
}

const PAPERCLIP =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>'

/** An attached document, shown as a chip in the note; click opens it, right-click for more. */
function makeAttachmentNode(env: KnEnv) {
  return Node.create({
    name: 'knAttachment',
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return { path: { default: '' }, name: { default: '' }, t: timeAttr }
    },
    parseHTML() {
      return [{ tag: 'div[data-kn-attachment]' }]
    },
    renderHTML({ node }) {
      return ['div', { 'data-kn-attachment': '', 'data-path': node.attrs.path }, String(node.attrs.name)]
    },
    addNodeView() {
      return ({ node, getPos }) => {
        const dom = document.createElement('div')
        dom.className = 'kn-attachment'
        const chip = document.createElement('button')
        chip.type = 'button'
        chip.className = 'kn-chip'
        dom.append(chip)
        let current = node
        const paint = (n: PMNode) => {
          current = n
          chip.innerHTML = PAPERCLIP
          const label = document.createElement('span')
          label.textContent = String(n.attrs.name || 'Document')
          chip.append(label)
          chip.title = `${String(n.attrs.name)} — click to open it${/\.pdf$/i.test(String(n.attrs.name)) ? ' in KhervePDF' : ''}; right-click for more`
        }
        paint(node)
        chip.addEventListener('click', (e) => {
          e.preventDefault()
          env.openAttachment(String(current.attrs.path), String(current.attrs.name))
        })
        chip.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (typeof pos === 'number') env.attachmentMenu(e, pos, String(current.attrs.path), String(current.attrs.name))
        })
        return {
          dom,
          stopEvent: (e) => e.type === 'click' || e.type === 'contextmenu' || e.type === 'mousedown',
          update: (n) => {
            if (n.type.name !== 'knAttachment') return false
            paint(n)
            return true
          },
        }
      }
    },
  })
}

// ------------------------------------------------------------------ plugins

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'knItem'])
export const refreshKey = new PluginKey('knRefresh')
/** Meta on a transaction that loads a note: nothing is stamped. */
export const LOAD_META = 'knLoad'

/**
 * A paragraph is timed when its first character is typed: a textblock without
 * a time that has text now and was empty (or did not exist) before.
 */
function stampPlugin(env: KnEnv) {
  return new Plugin({
    appendTransaction(trs, oldState, newState) {
      if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta(LOAD_META))) return null
      const mapping = new Mapping()
      for (const t of trs) mapping.appendMapping(t.mapping)
      const inv = mapping.invert()
      const now = env.elapsed()
      if (now == null) return null
      let tr: Transaction | null = null
      newState.doc.forEach((node, pos) => {
        if (!TEXTBLOCKS.has(node.type.name) || node.attrs.t != null || !node.textContent.trim()) return
        const oldPos = inv.map(pos + 1, -1)
        let before: PMNode | null = null
        if (oldPos >= 0 && oldPos <= oldState.doc.content.size) {
          const $p = oldState.doc.resolve(oldPos)
          before = $p.depth >= 1 ? $p.node(1) : null
        }
        if (before && TEXTBLOCKS.has(before.type.name) && before.textContent.trim()) return
        tr ??= newState.tr
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, t: Math.round(now * 100) / 100 })
      })
      if (tr) (tr as Transaction).setMeta('addToHistory', false)
      return tr
    },
  })
}

const BULLETS = ['•', '◦', '▪', '‣']

/** The times in the margin and the list markers (1., 1.2., •). */
function marginPlugin(env: KnEnv) {
  const build = (doc: PMNode) => {
    const decos: Decoration[] = []
    const counters = [0, 0, 0, 0]
    doc.forEach((node, pos) => {
      const attrs: Record<string, string> = {}
      if (typeof node.attrs.t === 'number') attrs['data-time'] = env.timeLabel(node.attrs.t)
      if (node.type.name === 'knItem') {
        const level = Math.max(0, Math.min(3, Number(node.attrs.level) || 0))
        for (let i = level + 1; i < 4; i++) counters[i] = 0
        if (node.attrs.numbered) {
          counters[level]++
          attrs['data-marker'] = counters.slice(0, level + 1).map((c) => Math.max(1, c)).join('.') + '.'
        } else {
          counters[level] = 0
          attrs['data-marker'] = BULLETS[level]
        }
      } else counters.fill(0)
      if (Object.keys(attrs).length) decos.push(Decoration.node(pos, pos + node.nodeSize, attrs))
    })
    return DecorationSet.create(doc, decos)
  }
  return new Plugin({
    key: new PluginKey('knMargin'),
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(refreshKey) ? build(state.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })
}

const mathCache = new Map<string, string | null>()

function katexHtml(latex: string, display: boolean): string | null {
  const key = (display ? 'D' : 'I') + latex
  if (mathCache.has(key)) return mathCache.get(key)!
  let html: string | null
  try {
    html = katex.renderToString(latex, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, maxExpand: 1000, maxSize: 40 })
  } catch {
    html = null
  }
  if (mathCache.size > 2000) mathCache.clear()
  mathCache.set(key, html)
  return html
}

/** The text of a textblock as the model sees it (hard breaks are "\n"), offset = position − (start + 1). */
function blockText(node: PMNode): string {
  let s = ''
  node.forEach((child) => {
    s += child.isText ? child.text ?? '' : child.type.name === 'hardBreak' ? '\n' : '￼'
  })
  return s
}

/** Maths drawn with KaTeX; its LaTeX shows again while the cursor touches it. */
function mathPlugin(env: KnEnv) {
  const build = (state: EditorState) => {
    if (!env.showMath()) return DecorationSet.empty
    const { from: selFrom, to: selTo } = state.selection
    const decos: Decoration[] = []
    state.doc.descendants((node, pos) => {
      if (!node.isTextblock) return true
      const text = blockText(node)
      if (!text.includes('$') && !text.includes('\\')) return false
      for (const span of mathSpans(text)) {
        const from = pos + 1 + span.from
        const to = pos + 1 + span.to
        if (selFrom <= to && selTo >= from) continue
        const html = katexHtml(span.latex, span.display)
        if (html == null) {
          decos.push(Decoration.inline(from, to, { class: 'kn-math-bad' }))
          continue
        }
        decos.push(Decoration.inline(from, to, { class: 'kn-math-src' }))
        decos.push(
          Decoration.widget(
            to,
            (view: EditorView) => {
              const el = document.createElement(span.display ? 'div' : 'span')
              el.className = span.display ? 'kn-math kn-math-display' : 'kn-math'
              el.innerHTML = html
              el.title = 'Click to edit'
              el.addEventListener('mousedown', (e) => {
                e.preventDefault()
                const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.min(to - 1, view.state.doc.content.size)))
                view.dispatch(tr)
                view.focus()
              })
              return el
            },
            { side: -1, key: `m${from}:${span.display ? 'D' : 'I'}${span.latex}`, ignoreSelection: true },
          ),
        )
      }
      return false
    })
    return DecorationSet.create(state.doc, decos)
  }
  return new Plugin({
    key: new PluginKey('knMath'),
    state: {
      init: (_, state) => build(state),
      apply: (tr, old, _o, state) => (tr.docChanged || tr.selectionSet || tr.getMeta(refreshKey) ? build(state) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state)
      },
    },
  })
}

/** Pictures pasted or dropped onto the page; files dragged from the Files app. */
function inputPlugin(env: KnEnv) {
  const insertPictures = (view: EditorView, files: File[], at: number | null) => {
    void (async () => {
      for (const f of files) {
        const p = await env.addPicture(f)
        if (!p) continue
        const node = view.state.schema.nodes.knImage.create({ path: p, caption: '', t: env.elapsed() })
        const pos = at ?? view.state.selection.to
        const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size))
        const insertAt = $pos.depth >= 1 ? $pos.after(1) : pos
        view.dispatch(view.state.tr.insert(insertAt, node).scrollIntoView())
      }
    })()
  }
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        insertPictures(view, files, null)
        return true
      },
      handleDrop(view, event) {
        const dt = (event as DragEvent).dataTransfer
        if (!dt) return false
        const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos ?? null
        const raw = dt.getData('application/x-kherveos-paths')
        if (raw) {
          try {
            const paths = JSON.parse(raw) as unknown
            if (Array.isArray(paths) && paths.length) {
              env.dropPaths(paths.filter((p): p is string => typeof p === 'string'), at ?? view.state.selection.to)
              return true
            }
          } catch {
            return false
          }
        }
        const files = [...dt.files].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        insertPictures(view, files, at)
        return true
      },
    },
  })
}

function knPlugins(env: KnEnv) {
  return Extension.create({
    name: 'knPlugins',
    addProseMirrorPlugins() {
      return [stampPlugin(env), marginPlugin(env), mathPlugin(env), inputPlugin(env)]
    },
    addKeyboardShortcuts() {
      const style = (code: StyleCode) => () => (setStyle(this.editor, code), true)
      return {
        'Mod-0': style('typed'),
        'Mod-1': style('h1'),
        'Mod-2': style('h2'),
        'Mod-3': style('h3'),
        'Mod-Shift-k': style('important'),
        'Mod-Shift-K': style('important'),
        'Mod-Shift-q': style('question'),
        'Mod-Shift-Q': style('question'),
        'Mod-Shift-8': style('bullet'),
        'Mod-Shift-7': style('numbered'),
        'Mod-Enter': () => (newSection(this.editor), true),
      }
    },
  })
}

export function createExtensions(env: KnEnv): Extensions {
  return [
    StarterKit.configure({
      paragraph: false,
      heading: false,
      blockquote: false,
      codeBlock: false,
      code: false,
      strike: false,
      horizontalRule: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      listKeymap: false,
      link: false,
      dropcursor: { color: 'var(--k-accent)', width: 2 },
    }),
    KnParagraph,
    KnHeading,
    KnItem,
    makeImageNode(env),
    makeAttachmentNode(env),
    knPlugins(env),
    Placeholder.configure({ placeholder: 'Write your notes here — Ctrl+Return starts a new section, $…$ is maths.', showOnlyCurrent: false }),
  ]
}

// ----------------------------------------------------------------- commands

/** The style of the paragraph the cursor is in. */
export function styleAt(editor: Editor): StyleCode | null {
  const node = editor.state.selection.$from.parent
  switch (node.type.name) {
    case 'paragraph':
      return (String(node.attrs.kind) as StyleCode) || 'typed'
    case 'heading':
      return `h${Math.min(3, Number(node.attrs.level) || 1)}` as StyleCode
    case 'knItem':
      return node.attrs.numbered ? 'numbered' : 'bullet'
    default:
      return null
  }
}

/** Give every paragraph in the selection a style, keeping its time. */
export function setStyle(editor: Editor, code: StyleCode) {
  const { state } = editor
  const { from, to } = state.selection
  const nodes = state.schema.nodes
  const target = (node: PMNode): [NodeType, Record<string, unknown>] => {
    const t = node.attrs.t ?? null
    if (code === 'h1' || code === 'h2' || code === 'h3') return [nodes.heading, { level: Number(code[1]), t }]
    if (code === 'bullet' || code === 'numbered') {
      const level = node.type.name === 'knItem' ? node.attrs.level : 0
      return [nodes.knItem, { level, numbered: code === 'numbered', t }]
    }
    return [nodes.paragraph, { kind: code, t }]
  }
  const tr = state.tr
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!TEXTBLOCKS.has(node.type.name)) return true
    const [type, attrs] = target(node)
    tr.setNodeMarkup(pos, type, attrs)
    return false
  })
  if (tr.docChanged) editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
}

/** Ctrl+Return: a new section after the paragraph the cursor is in. */
export function newSection(editor: Editor) {
  const { state } = editor
  const $from = state.selection.$from
  const after = $from.depth >= 1 ? $from.after(1) : state.doc.content.size
  const heading = state.schema.nodes.heading.create({ level: 1, t: null })
  const tr = state.tr.insert(after, heading)
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView()
  editor.view.dispatch(tr)
  editor.view.focus()
}

/** Where each section of the page is: [start, end) of its top-level nodes, and its heading position. */
export interface SectionRange {
  start: number
  end: number
  heading: number | null
  title: string
}

export function sectionRanges(doc: PMNode, withLeadIn: boolean): SectionRange[] {
  const out: SectionRange[] = []
  let cur: SectionRange = { start: 0, end: 0, heading: null, title: '' }
  doc.forEach((node, pos) => {
    if (node.type.name === 'heading' && Number(node.attrs.level) <= 1) {
      cur.end = pos
      out.push(cur)
      cur = { start: pos, end: pos, heading: pos, title: node.textContent.trim() }
    }
  })
  cur.end = doc.content.size
  out.push(cur)
  // The untitled lead-in is a section only when it holds something (docToNote).
  if (!withLeadIn) out.shift()
  return out
}

/** Model blocks → nodes and insert them at `pos` (one undo step). */
export function insertNodes(editor: Editor, pos: number, nodes: JNode[]) {
  const pm = nodes.map((n) => editor.schema.nodeFromJSON(n))
  const tr = editor.state.tr.insert(pos, pm)
  editor.view.dispatch(tr.scrollIntoView())
}

/** The top-level node at the cursor (its position and node). */
export function blockAtCursor(state: EditorState): { pos: number; node: PMNode } | null {
  const $from = state.selection.$from
  if ($from.depth < 1) return null
  return { pos: $from.before(1), node: $from.node(1) }
}

/** Show the paragraph written at (or just after) session time t, flashing it. */
export function goToTime(editor: Editor, t: number): boolean {
  let best: number | null = null
  let last: number | null = null
  editor.state.doc.forEach((node, pos) => {
    if (best != null) return
    const bt = node.attrs.t
    if (typeof bt === 'number' && node.textContent.trim()) {
      last = pos
      if (bt >= t - 2) best = pos
    }
  })
  const pos = best ?? last
  if (pos == null) return false
  const tr = editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 1)))
  editor.view.dispatch(tr.scrollIntoView())
  const dom = editor.view.nodeDOM(pos)
  if (dom instanceof HTMLElement) {
    dom.classList.remove('kn-flash')
    void dom.offsetWidth
    dom.classList.add('kn-flash')
    dom.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
  return true
}

/** Re-draw the margin and the maths (after a setting changed). */
export function refresh(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(refreshKey, true).setMeta('addToHistory', false))
}
