// Track Changes: while it is on, typed text gets an "insertion" mark and
// deleted text stays, struck through, with a "deletion" mark (deleting text
// one inserted oneself while tracking removes it for real). Accept / Reject
// apply or undo them, one at a time or all. Only plain typing, deleting and
// pasting are tracked; formatting changes and structure (tables, lists) are
// applied directly, as noted in the Review tab.

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { Mark, Node as PMNodeT } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { newId } from '../model'

const trackKey = new PluginKey('kwTrack')

export function trackPlugin(tracking: () => { on: boolean; author: string }) {
  return new Plugin({
    key: trackKey,
    appendTransaction(trs, oldState, newState) {
      const t = tracking()
      if (!t.on) return null
      if (trs.length !== 1) return null
      const tr = trs[0]
      if (!tr.docChanged || tr.getMeta('kwNoTrack') || tr.getMeta('history$') || tr.getMeta(trackKey)) return null
      if (tr.steps.length !== 1 || !(tr.steps[0] instanceof ReplaceStep)) return null
      const step = tr.steps[0] as ReplaceStep & { from: number; to: number; slice: { size: number } }
      // Steps that keep structure only (ReplaceStep with "structure") are not edits of text.
      if ((step as unknown as { structure?: boolean }).structure) return null
      const { from, to } = step
      const insSize = step.slice.size
      const schema = newState.schema
      const now = new Date().toISOString()
      // Typing on from one's own change continues it (one change, not one per letter).
      const near = (doc: PMNodeT, pos: number, type: string) => {
        const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
        for (const n of [$p.nodeBefore, $p.nodeAfter]) {
          const m = n?.marks.find((x) => x.type.name === type && x.attrs.author === t.author)
          if (m) return String(m.attrs.id)
        }
        return null
      }
      const id = (insSize > 0 ? near(oldState.doc, from, 'insertion') : near(oldState.doc, from, 'deletion') ?? near(oldState.doc, to, 'deletion')) ?? newId()
      const out = newState.tr
      out.setMeta(trackKey, true)
      out.setMeta('addToHistory', tr.getMeta('addToHistory') !== false)
      // 1. What was typed is an insertion (and not a deletion, even inside deleted text).
      if (insSize > 0) {
        out.removeMark(from, from + insSize, schema.marks.deletion)
        out.addMark(from, from + insSize, schema.marks.insertion.create({ id, author: t.author, date: now }))
      }
      // 2. What was deleted comes back as a deletion, before the inserted text.
      let delSize = 0
      if (to > from) {
        const slice = oldState.doc.slice(from, to)
        out.replace(from, from, slice)
        delSize = out.doc.content.size - newState.doc.content.size
        const delMark = schema.marks.deletion.create({ id, author: t.author, date: now })
        // Only text gets the mark; text that was itself a tracked insertion goes for good.
        const goes: [number, number][] = []
        out.doc.nodesBetween(from, from + delSize, (node, pos) => {
          if (!node.isText) return true
          const a = Math.max(pos, from)
          const b = Math.min(pos + node.nodeSize, from + delSize)
          if (node.marks.some((m) => m.type.name === 'insertion')) goes.push([a, b])
          else if (!node.marks.some((m) => m.type.name === 'deletion')) out.addMark(a, b, delMark)
          return false
        })
        // Cursor: Backspace leaves it before the deleted text, Delete after it, typing after the new text.
        const sel = oldState.selection
        let cursor: number
        if (insSize > 0) cursor = from + delSize + insSize
        else if (sel.empty && sel.head === to) cursor = from
        else cursor = from + delSize
        for (const [a, b] of goes.reverse()) out.delete(a, b)
        cursor = out.mapping.slice(out.steps.length - goes.length).map(cursor)
        out.setSelection(TextSelection.create(out.doc, Math.max(0, Math.min(cursor, out.doc.content.size))))
      }
      return out.steps.length ? out : null
    },
  })
}

// ------------------------------------------------------------------ review

export interface Change {
  id: string
  kind: 'insertion' | 'deletion'
  author: string
  date: string
  from: number
  to: number
  text: string
}

/** Tracked changes in document order (neighbouring pieces with the same id are one). */
export function listChanges(doc: PMNodeT): Change[] {
  const out: Change[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const m of node.marks) {
      if (m.type.name !== 'insertion' && m.type.name !== 'deletion') continue
      const id = String(m.attrs.id ?? '')
      const prev = out[out.length - 1]
      if (prev && prev.id === id && prev.kind === m.type.name && prev.to === pos) {
        prev.to = pos + node.nodeSize
        prev.text += node.text
      } else {
        out.push({ id, kind: m.type.name as Change['kind'], author: String(m.attrs.author ?? ''), date: String(m.attrs.date ?? ''), from: pos, to: pos + node.nodeSize, text: node.text ?? '' })
      }
    }
    return false
  })
  return out
}

function resolve(tr: Transaction, changes: Change[], accept: boolean) {
  // From the end, so earlier positions stay valid.
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    const type = tr.doc.type.schema.marks[c.kind]
    const keep = (c.kind === 'insertion') === accept
    if (keep) tr.removeMark(c.from, c.to, type)
    else tr.delete(c.from, c.to)
  }
}

/** Accept or reject changes: all, those in the selection, or one by id. */
export function reviewChanges(view: EditorView, accept: boolean, which: 'all' | 'selection' | { id: string }): number {
  const all = listChanges(view.state.doc)
  const sel = view.state.selection
  const picked =
    which === 'all'
      ? all
      : which === 'selection'
        ? all.filter((c) => (sel.empty ? c.from <= sel.from && c.to >= sel.from : c.to > sel.from && c.from < sel.to))
        : all.filter((c) => c.id === which.id)
  if (!picked.length) return 0
  const tr = view.state.tr.setMeta('kwNoTrack', true)
  resolve(tr, picked, accept)
  view.dispatch(tr)
  return picked.length
}

/** Comment ids in document order, with the text they cover. */
export function listCommentRanges(state: EditorState): { id: string; from: number; to: number; text: string }[] {
  const out = new Map<string, { id: string; from: number; to: number; text: string }>()
  state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    for (const m of node.marks as readonly Mark[]) {
      if (m.type.name !== 'comment') continue
      const id = String(m.attrs.id ?? '')
      const c = out.get(id)
      if (c) {
        c.to = pos + node.nodeSize
        c.text += node.text
      } else out.set(id, { id, from: pos, to: pos + node.nodeSize, text: node.text ?? '' })
    }
    return false
  })
  return [...out.values()]
}

/** Remove a comment's marks everywhere. */
export function removeCommentMarks(view: EditorView, id: string) {
  const tr = view.state.tr.setMeta('kwNoTrack', true)
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return true
    const m = node.marks.find((x) => x.type.name === 'comment' && x.attrs.id === id)
    if (m) tr.removeMark(pos, pos + node.nodeSize, m)
    return false
  })
  view.dispatch(tr)
}
