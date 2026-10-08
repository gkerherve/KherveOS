// Notes: the TipTap editor — StarterKit (headings, bold/italic/underline/
// strike, lists, quote, code, links), checklists, tables, pictures and file
// attachments stored next to the note, and #tags drawn as tags. Everything it
// holds can be written as Markdown (markdown.ts).

import { Extension, Node, mergeAttributes, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import { isLocalHref } from './markdown'

/** What the editor needs from the window around it. */
export interface NotesEditorEnv {
  /** A URL the browser can show for a picture of the open note ("Attachments/a.png"), or null. */
  fileUrl(src: string): Promise<string | null>
  /** Open an attached file (or a picture) in its app. */
  openAttachment(src: string): void
  /** Open a link (web address, or a file next to the note). */
  openLink(href: string): void
  /** Paths dragged from Files (or the desktop) onto the note. */
  dropPaths(paths: string[], pos: number): void
  /** Files from the computer dropped or pasted onto the note. */
  dropFiles(files: File[], pos: number | null): void
}

export const DRAG_PATHS = 'application/x-kherveos-paths'

const NoteImage = Image.extend<ImageOptions & { env: NotesEditorEnv | null }>({
  addOptions() {
    return { ...this.parent!(), env: null }
  },
  addNodeView() {
    const env = this.options.env
    return ({ node }) => {
      const dom = document.createElement('figure')
      dom.className = 'nt-figure'
      const img = document.createElement('img')
      img.draggable = false
      dom.appendChild(img)
      let src = ''
      const show = (n: PMNode) => {
        img.alt = String(n.attrs.alt ?? '')
        img.title = String(n.attrs.title ?? n.attrs.alt ?? '')
        const s = String(n.attrs.src ?? '')
        if (s === src) return
        src = s
        if (!isLocalHref(s)) img.src = s
        else {
          img.removeAttribute('src')
          dom.classList.add('loading')
          void env?.fileUrl(s).then((url) => {
            if (src !== s) return
            dom.classList.remove('loading')
            if (url) img.src = url
            else dom.classList.add('missing')
          })
        }
      }
      show(node)
      img.addEventListener('dblclick', () => env?.openAttachment(src))
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'image') return false
          show(n)
          return true
        },
      }
    }
  },
})

const PAPERCLIP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>'

/** A file attached to the note: a chip; double-click opens it. Markdown: [name](Attachments/name.ext). */
const Attachment = Node.create<{ env: NotesEditorEnv | null }>({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() {
    return { env: null }
  },
  addAttributes() {
    return {
      src: { default: '', parseHTML: (el) => el.getAttribute('data-src') ?? '' },
      name: { default: '', parseHTML: (el) => el.getAttribute('data-name') ?? '' },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-attachment]' }]
  },
  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes({ 'data-attachment': '', 'data-src': node.attrs.src, 'data-name': node.attrs.name, class: 'nt-attach' }, HTMLAttributes), node.attrs.name || node.attrs.src]
  },
  addNodeView() {
    const env = this.options.env
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'nt-attach'
      dom.contentEditable = 'false'
      const icon = document.createElement('span')
      icon.className = 'nt-attach-icon'
      icon.innerHTML = PAPERCLIP
      const label = document.createElement('span')
      label.className = 'nt-attach-name'
      const hint = document.createElement('span')
      hint.className = 'nt-attach-hint'
      hint.textContent = 'Double-click to open'
      dom.append(icon, label, hint)
      let src = String(node.attrs.src)
      label.textContent = String(node.attrs.name || src.split('/').pop())
      dom.addEventListener('dblclick', () => env?.openAttachment(src))
      return {
        dom,
        update: (n) => {
          if (n.type.name !== 'attachment') return false
          src = String(n.attrs.src)
          label.textContent = String(n.attrs.name || src.split('/').pop())
          return true
        },
      }
    }
  },
})

// ------------------------------------------------------------ #tags

const TAG_RE = /(^|[\s([{,;])(#[\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu

function tagDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.name === 'codeBlock' || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return
    const text = node.text ?? ''
    for (const m of text.matchAll(TAG_RE)) {
      const tag = m[2].replace(/[-/]+$/, '')
      if (!/\p{L}/u.test(tag)) continue
      const from = pos + m.index! + m[1].length
      decos.push(Decoration.inline(from, from + tag.length, { class: 'nt-tag' }))
    }
  })
  return DecorationSet.create(doc, decos)
}

const tagKey = new PluginKey<DecorationSet>('ntTags')

function notesPlugins(env: NotesEditorEnv) {
  return Extension.create({
    name: 'notesPlugins',
    addKeyboardShortcuts() {
      return {
        'Mod-Shift-l': () => this.editor.chain().focus().toggleTaskList().run(),
        'Mod-Shift-L': () => this.editor.chain().focus().toggleTaskList().run(),
      }
    },
    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: tagKey,
          state: {
            init: (_c, state) => tagDecorations(state.doc),
            apply: (tr, old) => (tr.docChanged ? tagDecorations(tr.doc) : old),
          },
          props: {
            decorations: (state) => tagKey.getState(state),
          },
        }),
        new Plugin({
          props: {
            handleClickOn(view: EditorView, _pos, _node, _nodePos, event) {
              // ⌘-click (or Ctrl-click) follows a link, as in other editors.
              if (!(event.metaKey || event.ctrlKey)) return false
              const a = (event.target as HTMLElement).closest('a')
              const href = a?.getAttribute('href')
              if (!href) return false
              event.preventDefault()
              env.openLink(href)
              return view.hasFocus()
            },
            handleDOMEvents: {
              click(_view, event) {
                // Never let the browser follow a link inside the editor.
                if ((event.target as HTMLElement).closest('a')) event.preventDefault()
                return false
              },
            },
            handlePaste(_view, event) {
              const files = [...(event.clipboardData?.files ?? [])]
              if (!files.length) return false
              env.dropFiles(files, null)
              return true
            },
            handleDrop(view, event) {
              const dt = (event as DragEvent).dataTransfer
              if (!dt) return false
              const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos ?? view.state.selection.to
              const raw = dt.getData(DRAG_PATHS)
              if (raw) {
                try {
                  const paths = JSON.parse(raw) as unknown
                  if (Array.isArray(paths) && paths.length) {
                    event.preventDefault()
                    env.dropPaths(paths.filter((p): p is string => typeof p === 'string'), at)
                    return true
                  }
                } catch {
                  return false
                }
              }
              const files = [...dt.files]
              if (!files.length) return false
              event.preventDefault()
              env.dropFiles(files, at)
              return true
            },
          },
        }),
      ]
    },
  })
}

export function notesExtensions(env: NotesEditorEnv): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
      dropcursor: { color: 'var(--k-accent)', width: 2 },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    NoteImage.configure({ inline: false, allowBase64: false, env }),
    Attachment.configure({ env }),
    Placeholder.configure({ placeholder: 'Start typing: the first line is the title' }),
    notesPlugins(env),
  ]
}

export const PICTURE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.ico']
