// Find and replace in the visual editor: matches are highlighted with
// decorations; next/previous move the selection; replace edits the text.

import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

interface Match {
  from: number
  to: number
}

interface FindState {
  query: string
  caseSensitive: boolean
  matches: Match[]
  decos: DecorationSet
}

export const findKey = new PluginKey<FindState>('ktxFind')

const EMPTY: FindState = { query: '', caseSensitive: false, matches: [], decos: DecorationSet.empty }

function search(doc: PMNode, query: string, caseSensitive: boolean): Match[] {
  if (!query) return []
  const needle = caseSensitive ? query : query.toLowerCase()
  const out: Match[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Inline objects count as one character, like their size in the document.
    let text = ''
    node.forEach((child) => {
      text += child.isText ? child.text ?? '' : '￼'
    })
    const hay = caseSensitive ? text : text.toLowerCase()
    let i = hay.indexOf(needle)
    while (i !== -1 && out.length < 5000) {
      out.push({ from: pos + 1 + i, to: pos + 1 + i + needle.length })
      i = hay.indexOf(needle, i + Math.max(1, needle.length))
    }
    return false
  })
  return out
}

function build(doc: PMNode, query: string, caseSensitive: boolean): FindState {
  const matches = search(doc, query, caseSensitive)
  const decos = DecorationSet.create(doc, matches.map((m) => Decoration.inline(m.from, m.to, { class: 'ktx-find-hit' })))
  return { query, caseSensitive, matches, decos }
}

export function findPlugin() {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const meta = tr.getMeta(findKey) as { query: string; caseSensitive: boolean } | undefined
        if (meta) return build(tr.doc, meta.query, meta.caseSensitive)
        if (tr.docChanged && prev.query) return build(tr.doc, prev.query, prev.caseSensitive)
        return prev
      },
    },
    props: {
      decorations: (state) => findKey.getState(state)?.decos,
    },
  })
}

export function setFindQuery(view: EditorView, query: string, caseSensitive: boolean): number {
  view.dispatch(view.state.tr.setMeta(findKey, { query, caseSensitive }))
  return findKey.getState(view.state)?.matches.length ?? 0
}

function matches(state: EditorState): Match[] {
  return findKey.getState(state)?.matches ?? []
}

/** Select the next (or previous) match; returns its 1-based index, 0 when there is none. */
export function findNext(view: EditorView, forward = true): number {
  const all = matches(view.state)
  if (!all.length) return 0
  const { from, to } = view.state.selection
  let index = forward ? all.findIndex((m) => m.from >= to) : findLastIndex(all, (m) => m.to <= from)
  if (index === -1) index = forward ? 0 : all.length - 1
  const m = all[index]
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).scrollIntoView())
  return index + 1
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i
  return -1
}

/** Replace the selected match (if the selection is one) and move to the next. */
export function replaceCurrent(view: EditorView, replacement: string): number {
  const { from, to } = view.state.selection
  const hit = matches(view.state).find((m) => m.from === from && m.to === to)
  if (hit) {
    const tr = view.state.tr
    if (replacement) tr.insertText(replacement, hit.from, hit.to)
    else tr.delete(hit.from, hit.to)
    view.dispatch(tr)
  }
  return findNext(view, true)
}

export function replaceAll(view: EditorView, replacement: string): number {
  const all = matches(view.state)
  if (!all.length) return 0
  const tr = view.state.tr
  for (const m of [...all].reverse()) {
    if (replacement) tr.insertText(replacement, m.from, m.to)
    else tr.delete(m.from, m.to)
  }
  view.dispatch(tr)
  return all.length
}

export function findCount(state: EditorState): number {
  return matches(state).length
}
