// KherveWord's AI tools (kherveword_read_document, _insert_paragraphs…):
// names, arguments and descriptions are in src/os/ai/manifests/kherveword.ts;
// KherveWord.tsx registers these with useAppTools. Edits go through the
// editor (one undo step each, unsaved like typing); save/export_pdf write files.

import type { Editor } from '@tiptap/core'
import { Fragment, Node as PMNodeT } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { marked } from 'marked'
import { fs } from '@/os'
import { pretty, extname } from '@/os/path'
import { drivePath } from '@/os/ai/tools'
import { clipText, waitUntil, type AppTools } from '@/os/ai/appTools'
import { PAGE_SIZES, PT_PER_CM, countWords, newId, normColor, nodeText, type DocSettings, type HeaderFooter, type PMNode, type WordDoc } from './model'
import { htmlToDoc, bytesToDataUrl } from './io'
import { tableNode } from './commands'
import { replaceAll } from './editor/find'
import { reviewChanges } from './editor/tracking'
import { templateDoc, type TemplateId } from './templates'

export interface WordHost {
  editor(): Editor | null
  loading(): boolean
  settings(): DocSettings
  updateSettings(fn: (s: DocSettings) => DocSettings): void
  info(): { path: string | null; unsaved: boolean; pages: number }
  /** Save to `path` (or the current file). Returns the path written. */
  save(path: string | null): Promise<string>
  exportPdf(path: string | null): Promise<{ path: string; pages: number }>
  load(wd: WordDoc): void
  author(): string
  pageSize(): string
}

interface Item {
  index: number
  pos: number
  node: PMNodeT
  kind: string
  level: number
  list?: string
}

/** The addressable paragraphs: textblocks outside tables, tables, and block objects. */
function items(doc: PMNodeT): Item[] {
  const out: Item[] = []
  const visit = (node: PMNodeT, pos: number, level: number, list?: string) => {
    node.forEach((child, off) => {
      const p = pos + off
      const name = child.type.name
      if (name === 'bulletList' || name === 'orderedList') {
        child.forEach((li, liOff) => visit(li, p + 1 + liOff + 1, level + 1, name === 'bulletList' ? 'bullet' : 'numbered'))
      } else if (child.isTextblock || name === 'table' || child.isAtom) {
        out.push({ index: out.length, pos: p, node: child, kind: name, level, list })
      } else if (child.content.size) visit(child, p + 1, level, list)
    })
  }
  visit(doc, 0, 0)
  return out
}

function styleId(settings: DocSettings, s: unknown): string | null {
  if (typeof s !== 'string' || !s.trim()) return null
  const want = s.trim().toLowerCase().replace(/\s+/g, '')
  for (const st of Object.values(settings.styles)) {
    if (st.id.toLowerCase() === want || st.name.toLowerCase().replace(/\s+/g, '') === want) return st.id
  }
  const h = /^h(?:eading)?(\d)$/.exec(want)
  if (h) return `Heading${h[1]}`
  throw new Error(`There is no paragraph style "${s}". Styles: ${Object.values(settings.styles).map((x) => x.id).join(', ')}.`)
}

function hf(s: unknown): HeaderFooter | null {
  if (typeof s !== 'string') return null
  const parts = s.split('|')
  if (parts.length === 1) return { left: '', center: parts[0].trim(), right: '' }
  return { left: (parts[0] ?? '').trim(), center: (parts[1] ?? '').trim(), right: parts.slice(2).join('|').trim() }
}

export function kherveWordAiTools(host: WordHost): AppTools {
  const ready = async (signal?: AbortSignal): Promise<Editor> => {
    if (!(await waitUntil(() => !host.loading() && !!host.editor(), 30_000, signal))) throw new Error('KherveWord is still opening the document. Try again in a moment.')
    return host.editor()!
  }
  const itemAt = (ed: Editor, index: unknown): Item => {
    const all = items(ed.state.doc)
    const i = Number(index)
    if (!Number.isInteger(i) || i < 0 || i >= all.length) throw new Error(`Paragraph index ${String(index)} does not exist (0–${all.length - 1}). kherveword_read_document lists them.`)
    return all[i]
  }
  /** Position to insert blocks before paragraph `at` (top level), or at the end. */
  const insertPos = (ed: Editor, at: unknown): number => {
    if (at === undefined || at === null) return ed.state.doc.content.size
    const it = itemAt(ed, at)
    const $p = ed.state.doc.resolve(it.pos)
    return $p.depth === 0 ? it.pos : $p.before(1)
  }
  const mdBlocks = async (ed: Editor, text: string): Promise<PMNode[]> => {
    // $…$ maths become equations.
    const withMath = text
      .replace(/\$\$([\s\S]+?)\$\$/g, (_m, l: string) => `\n<div data-type="equation-block" data-latex="${l.trim().replace(/"/g, '&quot;')}"></div>\n`)
      .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_m, pre: string, l: string) => `${pre}<span data-type="equation" data-latex="${l.replace(/"/g, '&quot;')}"></span>`)
    const html = await marked.parse(withMath)
    return htmlToDoc(html, ed.schema).content ?? []
  }

  return {
    async read_document(a, ctx) {
      const ed = await ready(ctx.signal)
      const s = host.settings()
      const info = host.info()
      const max = Math.max(500, Number(a.max_chars) || 20000)
      const from = Math.max(0, Number(a.from) || 0)
      const all = items(ed.state.doc)
      const paragraphs: Record<string, unknown>[] = []
      let used = 0
      let truncatedAt: number | null = null
      for (const it of all.slice(from)) {
        let entry: Record<string, unknown>
        if (it.kind === 'table') {
          const rows: string[][] = []
          it.node.forEach((r) => {
            const row: string[] = []
            r.forEach((c) => row.push(nodeText(c.toJSON() as PMNode).replace(/\s+/g, ' ').trim()))
            rows.push(row)
          })
          entry = { index: it.index, kind: 'table', rows }
        } else if (it.kind === 'paragraph') {
          entry = { index: it.index, style: it.node.attrs.style, text: nodeText(it.node.toJSON() as PMNode) }
          if (it.node.attrs.align) entry.align = it.node.attrs.align
          if (it.list) entry.list = `${it.list} level ${it.level}`
        } else entry = { index: it.index, kind: it.kind, ...(it.node.attrs.latex ? { latex: it.node.attrs.latex } : {}) }
        used += JSON.stringify(entry).length
        if (used > max && paragraphs.length) {
          truncatedAt = it.index
          break
        }
        paragraphs.push(entry)
      }
      const text = nodeText(ed.state.doc.toJSON() as PMNode)
      return {
        path: info.path ? pretty(info.path) : null,
        unsaved_changes: info.unsaved,
        title: s.title,
        pages: info.pages,
        words: countWords(text),
        page: { size: s.page.size, orientation: s.page.orientation, margins_cm: Math.round((s.page.margins.left / PT_PER_CM) * 100) / 100 },
        header: s.header,
        footer: s.footer,
        track_changes: s.trackChanges,
        comments: Object.keys(s.comments).length,
        paragraph_count: all.length,
        paragraphs,
        ...(truncatedAt !== null && { truncated: true, next_from: truncatedAt }),
      }
    },

    async insert_paragraphs(a, ctx) {
      const ed = await ready(ctx.signal)
      const text = String(a.text ?? '')
      if (!text.trim()) throw new Error('"text" is empty.')
      let blocks = await mdBlocks(ed, text)
      const style = styleId(host.settings(), a.style)
      if (style) blocks = blocks.map((b) => (b.type === 'paragraph' && (b.attrs?.style ?? 'Normal') === 'Normal' ? { ...b, attrs: { ...b.attrs, style } } : b))
      const pos = insertPos(ed, a.at)
      const frag = Fragment.fromArray(blocks.map((b) => PMNodeT.fromJSON(ed.schema, b)))
      // An empty document's single empty paragraph is replaced.
      const doc = ed.state.doc
      const onlyEmpty = doc.childCount === 1 && doc.firstChild!.isTextblock && doc.firstChild!.content.size === 0
      const tr = onlyEmpty ? ed.state.tr.replaceWith(0, doc.content.size, frag) : ed.state.tr.insert(pos, frag)
      ed.view.dispatch(tr.scrollIntoView())
      return { inserted_blocks: blocks.length, paragraph_count: items(ed.state.doc).length, saved: false }
    },

    async replace_paragraph(a, ctx) {
      const ed = await ready(ctx.signal)
      const it = itemAt(ed, a.index)
      if (it.kind !== 'paragraph') throw new Error(`Paragraph ${it.index} is a ${it.kind}, not text: delete it and insert paragraphs instead.`)
      const blocks = await mdBlocks(ed, String(a.text ?? ''))
      const style = styleId(host.settings(), a.style)
      const firstPara = blocks.find((b) => b.type === 'paragraph')
      const inline = firstPara?.content ?? []
      const content = Fragment.fromArray(inline.map((n) => PMNodeT.fromJSON(ed.schema, n)))
      const attrs = { ...it.node.attrs, ...(style ? { style } : {}) }
      const tr = ed.state.tr.replaceWith(it.pos, it.pos + it.node.nodeSize, ed.schema.nodes.paragraph.create(attrs, content))
      ed.view.dispatch(tr)
      return { replaced: it.index, style: attrs.style, saved: false }
    },

    async delete_paragraphs(a, ctx) {
      const ed = await ready(ctx.signal)
      const first = itemAt(ed, a.from)
      const last = itemAt(ed, a.to ?? a.from)
      if (last.index < first.index) throw new Error('"to" is before "from".')
      const all = items(ed.state.doc).slice(first.index, last.index + 1)
      const tr = ed.state.tr
      for (const it of [...all].reverse()) {
        const $p = tr.doc.resolve(it.pos)
        // A list item's only paragraph: delete the item.
        if ($p.parent.type.name === 'listItem' && $p.parent.childCount === 1) tr.delete($p.before(), $p.after())
        else tr.delete(it.pos, it.pos + it.node.nodeSize)
      }
      if (tr.doc.content.size === 0) tr.insert(0, ed.schema.nodes.paragraph.create())
      ed.view.dispatch(tr)
      return { deleted: all.length, paragraph_count: items(ed.state.doc).length, saved: false }
    },

    async apply_style(a, ctx) {
      const ed = await ready(ctx.signal)
      const style = styleId(host.settings(), a.style)
      const align = typeof a.align === 'string' ? a.align : null
      if (!style && !align) throw new Error('Give "style" and/or "align".')
      const first = itemAt(ed, a.from)
      const last = itemAt(ed, a.to ?? a.from)
      const tr = ed.state.tr
      let n = 0
      for (const it of items(ed.state.doc).slice(first.index, last.index + 1)) {
        if (it.kind !== 'paragraph') continue
        tr.setNodeMarkup(it.pos, undefined, { ...it.node.attrs, ...(style ? { style } : {}), ...(align ? { align } : {}) })
        n++
      }
      ed.view.dispatch(tr)
      return { styled: n, style, align, saved: false }
    },

    async format_text(a, ctx) {
      const ed = await ready(ctx.signal)
      const find = String(a.find ?? '')
      if (!find) throw new Error('"find" is empty.')
      const s = ed.schema
      const tr = ed.state.tr
      let count = 0
      ed.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true
        const text = node.textBetween(0, node.content.size, undefined, '￼')
        let i = text.indexOf(find)
        while (i >= 0) {
          const from = pos + 1 + i
          const to = from + find.length
          count++
          const set = (on: unknown, mark: string) => {
            if (on === true) tr.addMark(from, to, s.marks[mark].create())
            else if (on === false) tr.removeMark(from, to, s.marks[mark])
          }
          set(a.bold, 'bold')
          set(a.italic, 'italic')
          set(a.underline, 'underline')
          const color = a.color !== undefined ? normColor(a.color) : undefined
          if (a.color !== undefined && !color) throw new Error(`"${String(a.color)}" is not a colour: use e.g. "#c00000" or "red".`)
          const size = Number(a.size) > 0 ? `${Number(a.size)}pt` : undefined
          if (color || size) {
            const old = tr.doc.resolve(from).marks().find((m) => m.type.name === 'textStyle')?.attrs ?? {}
            tr.addMark(from, to, s.marks.textStyle.create({ ...old, ...(color ? { color } : {}), ...(size ? { fontSize: size } : {}) }))
          }
          i = text.indexOf(find, i + find.length)
        }
        return false
      })
      if (!count) throw new Error(`"${clipText(find, 200)}" is not in the document (the match is exact, case included).`)
      ed.view.dispatch(tr)
      return { formatted: count, saved: false }
    },

    async insert_table(a, ctx) {
      const ed = await ready(ctx.signal)
      if (!Array.isArray(a.rows) || !a.rows.length) throw new Error('"rows" must be a list of rows, e.g. [["Name","Value"],["a","1"]].')
      const rows = (a.rows as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r ?? '')]))
      const t = tableNode(rows, a.header !== false, host.settings())
      if (typeof a.borders === 'string') t.attrs.borders = a.borders
      const pos = insertPos(ed, a.at)
      const nodes = [PMNodeT.fromJSON(ed.schema, t), ed.schema.nodes.paragraph.create()]
      ed.view.dispatch(ed.state.tr.insert(pos, Fragment.fromArray(nodes)).scrollIntoView())
      return { rows: rows.length, columns: Math.max(...rows.map((r) => r.length)), saved: false }
    },

    async insert_special(a, ctx) {
      const ed = await ready(ctx.signal)
      const kind = String(a.kind ?? '')
      const s = ed.schema
      if (kind === 'equation' || kind === 'footnote') {
        let node: PMNodeT
        if (kind === 'equation') {
          const latex = String(a.latex ?? '').trim()
          if (!latex) throw new Error('Give "latex" for the equation.')
          if (a.display !== false) {
            // On a line of its own, after the paragraph "at" (its top-level block).
            let pos = ed.state.doc.content.size
            if (a.at !== undefined) {
              const it = itemAt(ed, a.at)
              const $p = ed.state.doc.resolve(it.pos)
              pos = $p.depth === 0 ? it.pos + it.node.nodeSize : $p.after(1)
            }
            ed.view.dispatch(ed.state.tr.insert(pos, s.nodes.equationBlock.create({ latex })))
            return { inserted: 'equation', display: true, saved: false }
          }
          node = s.nodes.equation.create({ latex })
        } else {
          const text = String(a.text ?? '').trim()
          if (!text) throw new Error('Give "text" for the footnote.')
          node = s.nodes.footnote.create({ text })
        }
        const all = items(ed.state.doc)
        const target = a.at === undefined ? [...all].reverse().find((i) => i.kind === 'paragraph') : itemAt(ed, a.at)
        if (!target || target.kind !== 'paragraph') throw new Error('That paragraph is not text.')
        const end = target.pos + target.node.nodeSize - 1
        ed.view.dispatch(ed.state.tr.insert(end, node))
        return { inserted: kind, paragraph: target.index, saved: false }
      }
      const pos = insertPos(ed, a.at)
      let node: PMNodeT
      if (kind === 'page_break') node = s.nodes.pageBreak.create({ kind: 'page' })
      else if (kind === 'toc') node = s.nodes.toc.create()
      else if (kind === 'horizontal_line') node = s.nodes.horizontalRule.create()
      else if (kind === 'image') {
        const p = drivePath(String(a.path ?? ''))
        if (!a.path || !fs.isFile(p)) throw new Error(`Give "path", a picture on the drive (${a.path ? `${pretty(p)} does not exist` : 'missing'}).`)
        const ext = extname(p).toLowerCase().slice(1)
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'svg' ? 'image/svg+xml' : `image/${ext}`
        const src = await bytesToDataUrl(await fs.readBytes(p), mime)
        node = s.nodes.paragraph.create({ style: 'Normal' }, s.nodes.image.create({ src, alt: null, wrap: 'inline' }))
      } else throw new Error(`Unknown kind "${kind}".`)
      ed.view.dispatch(ed.state.tr.insert(pos, node).scrollIntoView())
      return { inserted: kind, saved: false }
    },

    async find_replace(a, ctx) {
      const ed = await ready(ctx.signal)
      const find = String(a.find ?? '')
      if (!find) throw new Error('"find" is empty.')
      const n = replaceAll(ed.view, { text: find, matchCase: a.match_case === true, wholeWord: a.whole_word === true, regex: a.regex === true }, String(a.replace ?? ''))
      if (!n) throw new Error(`"${clipText(find, 200)}" was not found.`)
      return { replaced: n, saved: false }
    },

    async set_page(a, ctx) {
      await ready(ctx.signal)
      if (a.size !== undefined && !PAGE_SIZES[String(a.size)]) throw new Error(`Unknown paper size "${String(a.size)}".`)
      host.updateSettings((s) => {
        const page = { ...s.page, margins: { ...s.page.margins } }
        if (a.size) {
          const ps = PAGE_SIZES[String(a.size)]
          page.size = String(a.size)
          page.width = ps.width
          page.height = ps.height
        }
        if (a.orientation === 'portrait' || a.orientation === 'landscape') page.orientation = a.orientation
        const m = Number(a.margins_cm)
        if (m > 0) {
          const pt = m * PT_PER_CM
          page.margins = { ...page.margins, top: pt, bottom: pt, left: pt, right: pt }
        }
        return { ...s, page, header: hf(a.header) ?? s.header, footer: hf(a.footer) ?? s.footer, title: typeof a.title === 'string' ? a.title : s.title }
      })
      const s = host.settings()
      return { size: s.page.size, orientation: s.page.orientation, header: s.header, footer: s.footer, saved: false }
    },

    async review(a, ctx) {
      const ed = await ready(ctx.signal)
      const out: Record<string, unknown> = {}
      if (typeof a.track_changes === 'boolean') {
        host.updateSettings((s) => ({ ...s, trackChanges: a.track_changes as boolean }))
        out.track_changes = a.track_changes
      }
      if (a.accept_all === true) out.accepted = reviewChanges(ed.view, true, 'all')
      if (a.reject_all === true) out.rejected = reviewChanges(ed.view, false, 'all')
      if (typeof a.comment_on === 'string' && a.comment_on) {
        const find = a.comment_on
        let range = null as [number, number] | null
        ed.state.doc.descendants((node, pos) => {
          if (range || !node.isTextblock) return !range
          const i = node.textBetween(0, node.content.size, undefined, '￼').indexOf(find)
          if (i >= 0) range = [pos + 1 + i, pos + 1 + i + find.length]
          return false
        })
        if (!range) throw new Error(`"${clipText(find, 200)}" is not in the document.`)
        const id = newId()
        const [from, to] = range
        host.updateSettings((s) => ({ ...s, comments: { ...s.comments, [id]: { author: `${host.author()} (${ctx.caller})`, date: new Date().toISOString(), text: String(a.comment ?? '') } } }))
        const tr = ed.state.tr.addMark(from, to, ed.schema.marks.comment.create({ id }))
        ed.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from, to)).setMeta('kwNoTrack', true))
        out.comment = id
      }
      if (!Object.keys(out).length) throw new Error('Nothing to do: give track_changes, accept_all, reject_all or comment_on + comment.')
      return out
    },

    async new_document(a, ctx) {
      await ready(ctx.signal)
      const info = host.info()
      if (info.unsaved && !(await ctx.confirm('replace the open document in KherveWord with a new one', 'Its unsaved changes will be lost.'))) {
        throw new Error('The user did not allow replacing the unsaved document.')
      }
      const id = (['blank', 'letter', 'report', 'cv'].includes(String(a.template)) ? String(a.template) : 'blank') as TemplateId
      host.load(templateDoc(id, host.pageSize()))
      return { template: id, saved: false }
    },

    async save(a, ctx) {
      await ready(ctx.signal)
      const given = typeof a.path === 'string' && a.path.trim() ? a.path.trim() : null
      const info = host.info()
      if (!given && !info.path) throw new Error('This document has never been saved: give "path", e.g. "~/Documents/report.docx".')
      let p = given ? drivePath(given) : info.path!
      if (given && !/\.(docx|html?|md|txt)$/i.test(p)) p += '.docx'
      if (fs.isDir(p)) throw new Error(`${pretty(p)} is a folder.`)
      if (p !== info.path && fs.exists(p) && !(await ctx.confirm(`replace ${pretty(p)}`, 'What is in it now will be lost.'))) throw new Error(`The user did not allow replacing ${pretty(p)}.`)
      const written = await host.save(p)
      return { saved: pretty(written) }
    },

    async export_pdf(a, ctx) {
      await ready(ctx.signal)
      const given = typeof a.path === 'string' && a.path.trim() ? drivePath(a.path.trim()) : null
      let p = given
      if (p && !p.toLowerCase().endsWith('.pdf')) p += '.pdf'
      if (p && fs.exists(p) && !(await ctx.confirm(`replace ${pretty(p)}`, 'What is in it now will be lost.'))) throw new Error(`The user did not allow replacing ${pretty(p)}.`)
      const r = await host.exportPdf(p)
      return { pdf: pretty(r.path), pages: r.pages }
    },
  }
}
