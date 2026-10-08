// Find and Replace: highlights every match in the document, the current one
// brighter; next/previous move the selection; replace keeps the formatting of
// the first character it replaces.

import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import type { Node as PMNodeT } from '@tiptap/pm/model'

export interface FindQuery {
  text: string
  matchCase: boolean
  wholeWord: boolean
  regex: boolean
}

interface FindState {
  query: FindQuery | null
  current: number
  matches: { from: number; to: number }[]
  deco: DecorationSet
}

export const findKey = new PluginKey<FindState>('kwFind')

export function buildRegex(q: FindQuery): RegExp | null {
  if (!q.text) return null
  let src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (q.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`
  try {
    return new RegExp(src, `gu${q.matchCase ? '' : 'i'}`)
  } catch {
    return null
  }
}

/** Matches in textblocks (a match does not cross paragraphs). */
export function findMatches(doc: PMNodeT, q: FindQuery): { from: number; to: number }[] {
  const re = buildRegex(q)
  if (!re) return []
  const out: { from: number; to: number }[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // Text of the block, with the document position of each character.
    let text = ''
    const at: number[] = []
    node.descendants((child, off) => {
      if (child.isText) {
        if (child.marks.some((m) => m.type.name === 'deletion')) {
          text += '\u0000'.repeat(child.text!.length)
        } else text += child.text
        for (let i = 0; i < child.text!.length; i++) at.push(pos + 1 + off + i)
      } else if (child.isLeaf) {
        text += '￼'
        at.push(pos + 1 + off)
      }
    })
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      if (!m[0].length) {
        re.lastIndex++
        continue
      }
      out.push({ from: at[m.index], to: at[m.index + m[0].length - 1] + 1 })
      if (out.length > 5000) return false
    }
    return false
  })
  return out
}

function decorate(doc: PMNodeT, matches: { from: number; to: number }[], current: number): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'kw-find kw-find-current' : 'kw-find' })),
  )
}

export function findPlugin() {
  return new Plugin<FindState>({
    key: findKey,
    state: {
      init: () => ({ query: null, current: -1, matches: [], deco: DecorationSet.empty }),
      apply(tr, st) {
        const meta = tr.getMeta(findKey) as { query?: FindQuery | null; current?: number } | undefined
        if (meta) {
          const query = meta.query === undefined ? st.query : meta.query
          const matches = query ? findMatches(tr.doc, query) : []
          const current = meta.current ?? (matches.length ? 0 : -1)
          return { query, current: Math.min(current, matches.length - 1), matches, deco: decorate(tr.doc, matches, current) }
        }
        if (tr.docChanged && st.query) {
          const matches = findMatches(tr.doc, st.query)
          const current = Math.min(st.current, matches.length - 1)
          return { ...st, matches, current, deco: decorate(tr.doc, matches, current) }
        }
        return st
      },
    },
    props: {
      decorations: (state) => findKey.getState(state)?.deco,
    },
  })
}

export function findState(state: EditorState): FindState | undefined {
  return findKey.getState(state)
}

export function setFind(view: EditorView, query: FindQuery | null) {
  view.dispatch(view.state.tr.setMeta(findKey, { query }))
}

/** Move to the next (dir 1) or previous (dir -1) match after the selection. */
export function findNext(view: EditorView, dir: 1 | -1): boolean {
  const st = findState(view.state)
  if (!st?.matches.length) return false
  const sel = view.state.selection
  let i: number
  if (dir === 1) {
    i = st.matches.findIndex((m) => m.from >= sel.to)
    if (i < 0) i = 0
  } else {
    i = -1
    for (let k = st.matches.length - 1; k >= 0; k--) if (st.matches[k].to <= sel.from) {
      i = k
      break
    }
    if (i < 0) i = st.matches.length - 1
  }
  const m = st.matches[i]
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).setMeta(findKey, { current: i }).scrollIntoView()
  view.dispatch(tr)
  return true
}

function replaceIn(tr: Transaction, from: number, to: number, text: string) {
  const marks = tr.doc.resolve(from + 1).marks()
  if (text) tr.replaceWith(from, to, tr.doc.type.schema.text(text, marks))
  else tr.delete(from, to)
}

/** Replace the current match (or the selection when it is a match) and go to the next. */
export function replaceCurrent(view: EditorView, by: string): boolean {
  const st = findState(view.state)
  if (!st?.matches.length || !st.query) return false
  const sel = view.state.selection
  const m = st.matches.find((x) => x.from === sel.from && x.to === sel.to)
  if (!m) return findNext(view, 1)
  const tr = view.state.tr
  replaceIn(tr, m.from, m.to, expand(view.state.doc.textBetween(m.from, m.to), by, st.query))
  view.dispatch(tr)
  findNext(view, 1)
  return true
}

/** $1… in the replacement when the query is a regular expression. */
function expand(found: string, by: string, q: FindQuery): string {
  if (!q.regex) return by
  const re = buildRegex({ ...q, wholeWord: false })
  return re ? found.replace(re, by) : by
}

/** Replace every match; returns how many. One undo step. */
export function replaceAll(view: EditorView, query: FindQuery, by: string): number {
  const matches = findMatches(view.state.doc, query)
  if (!matches.length) return 0
  const tr = view.state.tr
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    replaceIn(tr, m.from, m.to, expand(view.state.doc.textBetween(m.from, m.to), by, query))
  }
  view.dispatch(tr)
  return matches.length
}
