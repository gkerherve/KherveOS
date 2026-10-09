// The Tiptap editor of an entry: StarterKit (headings, lists, quote, code, link, underline), highlight, sub/superscript,
// task lists (checklists), tables, KaTeX maths ($…$ inline, display blocks), @sample mentions, and the structured
// blocks (a React node view). The document is ProseMirror JSON, the same thing doc.ts reads for exports and search.

import { InputRule, Node, mergeAttributes, type Extensions } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Highlight } from '@tiptap/extension-highlight'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Placeholder } from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import 'katex/dist/katex.min.css'
import { BlockView } from './blockViews'
import type { EditorEnv } from './env'
import { renderMath } from './files'

const DRAG_MIME = 'application/x-kherveos-paths'

function mathNode(env: EditorEnv, name: 'mathInline' | 'mathBlock') {
  const display = name === 'mathBlock'
  return Node.create({
    name,
    group: display ? 'block' : 'inline',
    inline: !display,
    atom: true,
    selectable: true,
    draggable: display,
    addAttributes() {
      return { latex: { default: '' } }
    },
    parseHTML() {
      return [{ tag: display ? 'div[data-math-block]' : 'span[data-math-inline]', getAttrs: (el) => ({ latex: (el as HTMLElement).getAttribute('data-latex') ?? '' }) }]
    },
    renderHTML({ node }) {
      return [display ? 'div' : 'span', { [display ? 'data-math-block' : 'data-math-inline']: '', 'data-latex': node.attrs.latex }, display ? `$$${node.attrs.latex}$$` : `$${node.attrs.latex}$`]
    },
    addNodeView() {
      return ({ node, getPos, editor }) => {
        const dom = document.createElement(display ? 'div' : 'span')
        dom.className = display ? 'ln-math ln-math-block' : 'ln-math'
        dom.setAttribute('role', 'math')
        dom.tabIndex = -1
        const paint = (latex: string) => {
          dom.innerHTML = latex.trim() ? renderMath(latex, display) : '<span class="ln-math-empty">empty formula</span>'
          dom.title = editor.isEditable ? 'Double-click to edit the formula' : latex
        }
        paint(String(node.attrs.latex))
        let current = String(node.attrs.latex)
        dom.addEventListener('dblclick', (e) => {
          e.preventDefault()
          if (!editor.isEditable) return
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (typeof pos !== 'number') return
          void env.editMath(current, display).then((latex) => {
            if (latex == null || editor.isDestroyed) return
            if (!latex.trim()) editor.view.dispatch(editor.state.tr.delete(pos, pos + 1))
            else editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { latex: latex.trim() }))
          })
        })
        return {
          dom,
          update: (n) => {
            if (n.type.name !== name) return false
            current = String(n.attrs.latex)
            paint(current)
            return true
          },
        }
      }
    },
    addInputRules() {
      if (display) return []
      return [
        new InputRule({
          find: /(?<![\w$\\])\$([^$\n]+)\$$/,
          handler: ({ state, range, match }) => {
            state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1].trim() }))
          },
        }),
      ]
    },
  })
}

function mentionNode(env: EditorEnv) {
  return Node.create({
    name: 'sampleMention',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes() {
      return { id: { default: '' }, label: { default: '' } }
    },
    parseHTML() {
      return [{ tag: 'span[data-sample]', getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute('data-sample') ?? '', label: (el as HTMLElement).textContent?.replace(/^@/, '') ?? '' }) }]
    },
    renderHTML({ node }) {
      return ['span', { 'data-sample': node.attrs.id, class: 'ln-mention' }, `@${node.attrs.label || node.attrs.id}`]
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement('span')
        dom.className = 'ln-mention'
        dom.tabIndex = -1
        let id = String(node.attrs.id)
        const paint = () => {
          dom.textContent = `@${id}`
          dom.title = env.sampleLabel(id)
          dom.classList.toggle('missing', !env.sampleExists(id))
        }
        paint()
        dom.addEventListener('click', (e) => { e.preventDefault(); env.openSample(id) })
        return {
          dom,
          update: (n) => {
            if (n.type.name !== 'sampleMention') return false
            id = String(n.attrs.id)
            paint()
            return true
          },
        }
      }
    },
    addInputRules() {
      return [
        new InputRule({
          find: /(?<![\w@])@([A-Za-z][\w-]*)\s$/,
          handler: ({ state, range, match }) => {
            if (!env.sampleExists(match[1])) return null
            state.tr.replaceWith(range.from, range.to, [this.type.create({ id: match[1], label: match[1] }), state.schema.text(' ')])
          },
        }),
      ]
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('lnMentionKey'),
          props: {
            handleKeyDown: (view, event) => {
              if (event.key !== '@' || event.metaKey || event.ctrlKey || !view.editable) return false
              const { $from } = view.state.selection
              const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset)
              if (before && /\w/.test(before)) return false
              const coords = view.coordsAtPos(view.state.selection.from)
              const type = view.state.schema.nodes.sampleMention
              event.preventDefault()
              env.pickSample({ clientX: coords.left, clientY: coords.bottom + 2 }, (id) => {
                if (id) {
                  const tr = view.state.tr.replaceSelectionWith(type.create({ id, label: id }), false)
                  tr.insertText(' ', tr.selection.to)
                  view.dispatch(tr)
                } else {
                  view.dispatch(view.state.tr.insertText('@'))
                }
                view.focus()
              })
              return true
            },
          },
        }),
      ]
    },
  })
}

export const ElnBlock = Node.create({
  name: 'elnBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      block: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          try { return JSON.parse(el.getAttribute('data-block') ?? 'null') as unknown } catch { return null }
        },
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-block': JSON.stringify(attrs.block) }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-eln-block]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-eln-block': '' })]
  },
  addNodeView() {
    return ReactNodeViewRenderer(BlockView)
  },
})

export function createExtensions(env: EditorEnv): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } },
      dropcursor: { color: 'var(--k-accent)', width: 2 },
    }),
    Highlight,
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: true, allowBase64: true }),
    mathNode(env, 'mathInline'),
    mathNode(env, 'mathBlock'),
    mentionNode(env),
    ElnBlock,
    Placeholder.configure({ placeholder: 'Write here. Type @ to link a sample, $E=mc^2$ for maths, or insert a block (reaction table, measurements, instrument run…) from the toolbar.' }),
  ]
}

/** ProseMirror props: pasted images and paths dragged from Files become attachments. */
export function editorProps(env: EditorEnv) {
  return {
    attributes: { class: 'ln-prose', spellcheck: 'true' },
    handlePaste: (_view: unknown, event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (!files.length) return false
      files.forEach((f) => env.pastedFile(f))
      return true
    },
    handleDrop: (_view: unknown, event: DragEvent) => {
      const dt = event.dataTransfer
      if (!dt) return false
      const raw = dt.getData(DRAG_MIME)
      if (raw) {
        try { env.droppedPaths((JSON.parse(raw) as string[]).filter((p) => typeof p === 'string')) } catch { return false }
        event.preventDefault()
        return true
      }
      const files = [...dt.files]
      if (files.length) {
        files.forEach((f) => env.pastedFile(f))
        event.preventDefault()
        return true
      }
      return false
    },
  }
}
