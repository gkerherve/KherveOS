// Editing commands shared by the ribbon, the menu bar, the keyboard and the
// AI tools: character and paragraph formatting, styles, lists, tables,
// pictures, notes, equations, the format painter and change case.

import type { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import type { Mark, Node as PMNodeT } from '@tiptap/pm/model'
import { contentWidth, resolveStyle, type DocSettings, type StyleDef } from './model'

export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72]
const FORMAT_MARKS = ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'textStyle', 'highlight']

/** What the ribbon shows for the selection. */
export interface Snapshot {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  sub: boolean
  sup: boolean
  font: string
  size: number
  color: string | null
  highlight: string | null
  style: string
  align: string
  list: 'bullet' | 'ordered' | null
  listStyle: string | null
  inTable: boolean
  link: string | null
  canUndo: boolean
  canRedo: boolean
  lineHeight: number
  spaceBefore: number
  spaceAfter: number
  indentLeft: number
  indentRight: number
  indentFirst: number
  tabs: { pos: number; align?: string }[]
  empty: boolean
  headerRow: boolean
  tableBorders: string
}

export const NO_SNAPSHOT: Snapshot = {
  bold: false, italic: false, underline: false, strike: false, sub: false, sup: false, font: 'Calibri', size: 11, color: null, highlight: null,
  style: 'Normal', align: 'left', list: null, listStyle: null, inTable: false, link: null, canUndo: false, canRedo: false, lineHeight: 1.08,
  spaceBefore: 0, spaceAfter: 8, indentLeft: 0, indentRight: 0, indentFirst: 0, tabs: [], empty: true, headerRow: false, tableBorders: 'all',
}

function currentParagraph(editor: Editor): PMNodeT | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d >= 0; d--) if ($from.node(d).type.name === 'paragraph') return $from.node(d)
  return null
}

export function snapshot(editor: Editor, styles: Record<string, StyleDef>): Snapshot {
  const p = currentParagraph(editor)
  const pa = (p?.attrs ?? {}) as Record<string, unknown>
  const styleId = String(pa.style ?? 'Normal')
  const st = resolveStyle(styles, styleId)
  const ts = editor.getAttributes('textStyle')
  const sel = editor.state.selection
  const { $from } = sel
  let list: Snapshot['list'] = null
  let listStyle: string | null = null
  let inTable = false
  let headerRow = false
  let tableBorders = 'all'
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d).type.name
    if (!list && (n === 'bulletList' || n === 'orderedList')) {
      list = n === 'bulletList' ? 'bullet' : 'ordered'
      listStyle = ($from.node(d).attrs.listStyle as string | null) ?? null
    }
    if (n === 'table') {
      inTable = true
      tableBorders = String($from.node(d).attrs.borders ?? 'all')
      headerRow = $from.node(d).firstChild?.firstChild?.type.name === 'tableHeader'
    }
  }
  const can = editor.can()
  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    sub: editor.isActive('subscript'),
    sup: editor.isActive('superscript'),
    font: (ts.fontFamily as string) || st.font || 'Calibri',
    size: parseFloat(String(ts.fontSize ?? '')) || st.size || 11,
    color: (ts.color as string) || null,
    highlight: (editor.getAttributes('highlight').color as string) || null,
    style: styleId,
    align: String(pa.align ?? st.align ?? 'left'),
    list,
    listStyle,
    inTable,
    link: (editor.getAttributes('link').href as string) || null,
    canUndo: can.undo(),
    canRedo: can.redo(),
    lineHeight: (pa.lineHeight as number) ?? st.lineHeight ?? 1,
    spaceBefore: (pa.spaceBefore as number) ?? st.spaceBefore ?? 0,
    spaceAfter: (pa.spaceAfter as number) ?? st.spaceAfter ?? 0,
    indentLeft: (pa.indentLeft as number) ?? st.indentLeft ?? 0,
    indentRight: (pa.indentRight as number) ?? st.indentRight ?? 0,
    indentFirst: (pa.indentFirst as number) ?? st.indentFirst ?? 0,
    tabs: Array.isArray(pa.tabs) ? (pa.tabs as Snapshot['tabs']) : [],
    empty: sel.empty,
    headerRow,
    tableBorders,
  }
}

// ------------------------------------------------------------------ characters

export function setFont(editor: Editor, font: string | null) {
  editor.chain().focus().setMark('textStyle', { fontFamily: font }).removeEmptyTextStyle().run()
}

export function setFontSize(editor: Editor, size: number | null) {
  editor.chain().focus().setMark('textStyle', { fontSize: size ? `${size}pt` : null }).removeEmptyTextStyle().run()
}

export function growFont(editor: Editor, current: number, dir: 1 | -1) {
  const next = dir > 0 ? (FONT_SIZES.find((s) => s > current) ?? current + 12) : ([...FONT_SIZES].reverse().find((s) => s < current) ?? Math.max(1, current - 1))
  setFontSize(editor, next)
}

export function setColor(editor: Editor, color: string | null) {
  editor.chain().focus().setMark('textStyle', { color }).removeEmptyTextStyle().run()
}

export function setHighlight(editor: Editor, color: string | null) {
  if (color) editor.chain().focus().setHighlight({ color }).run()
  else editor.chain().focus().unsetHighlight().run()
}

/** Remove character formatting and paragraph formatting; the paragraph becomes Normal. */
export function clearFormatting(editor: Editor) {
  let chain = editor.chain().focus()
  for (const m of FORMAT_MARKS) chain = chain.unsetMark(m, { extendEmptyMarkRange: true })
  chain
    .updateAttributes('paragraph', { style: 'Normal', align: null, indentLeft: null, indentRight: null, indentFirst: null, spaceBefore: null, spaceAfter: null, lineHeight: null, border: null, shading: null, tabs: null })
    .run()
}

export type CaseMode = 'sentence' | 'lower' | 'upper' | 'title' | 'toggle'

export function changeCase(editor: Editor, mode: CaseMode) {
  const { state } = editor
  const { from, to } = state.selection
  if (from === to) return
  const tr = state.tr
  const pieces: { pos: number; node: PMNodeT }[] = []
  state.doc.nodesBetween(from, to, (n, pos) => {
    if (n.isText) pieces.push({ pos, node: n })
  })
  for (const { pos, node } of pieces.reverse()) {
    const a = Math.max(from, pos)
    const b = Math.min(to, pos + node.nodeSize)
    const text = node.text!.slice(a - pos, b - pos)
    let out = text
    if (mode === 'lower') out = text.toLowerCase()
    else if (mode === 'upper') out = text.toUpperCase()
    else if (mode === 'title') out = text.toLowerCase().replace(/(^|[\s\-–—(“"'])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase())
    else if (mode === 'toggle') out = [...text].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('')
    else if (mode === 'sentence') out = text.toLowerCase()
    if (out !== text) tr.replaceWith(a, b, state.schema.text(out, node.marks))
  }
  if (mode === 'sentence') {
    // Capitals after sentence ends (and at the start of the selection).
    const text = tr.doc.textBetween(from, Math.min(to, tr.doc.content.size), '\n', '￼')
    const re = /(^|[.!?]\s+|\n)(\p{Ll})/gu
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const at = from + m.index + m[1].length
      const node = tr.doc.nodeAt(at)
      if (node?.isText) tr.replaceWith(at, at + 1, state.schema.text(m[2].toUpperCase(), node.marks))
    }
  }
  editor.view.dispatch(tr)
}

// ------------------------------------------------------------------ paragraphs

export function setParagraph(editor: Editor, attrs: Record<string, unknown>) {
  editor.chain().focus().updateAttributes('paragraph', attrs).run()
}

export function applyStyle(editor: Editor, style: string) {
  editor.chain().focus().updateAttributes('paragraph', { style }).run()
}

export function indent(editor: Editor, dir: 1 | -1, snap: Snapshot) {
  if (snap.list) {
    if (dir > 0) editor.chain().focus().sinkListItem('listItem').run()
    else editor.chain().focus().liftListItem('listItem').run()
    return
  }
  const left = Math.max(0, Math.round((snap.indentLeft + dir * 36) / 36) * 36)
  setParagraph(editor, { indentLeft: left || null })
}

/** Bullets / numbering on and off; with a list style, switch to it (listStyle undefined: just toggle). */
export function toggleList(editor: Editor, kind: 'bullet' | 'ordered', listStyle: string | null | undefined, snap: Snapshot) {
  const type = kind === 'bullet' ? 'bulletList' : 'orderedList'
  if (snap.list === kind && (listStyle === undefined || listStyle === snap.listStyle)) {
    ;(kind === 'bullet' ? editor.chain().focus().toggleBulletList() : editor.chain().focus().toggleOrderedList()).run()
    return
  }
  if (snap.list !== kind) (kind === 'bullet' ? editor.chain().focus().toggleBulletList() : editor.chain().focus().toggleOrderedList()).run()
  if (listStyle !== undefined) editor.chain().focus().updateAttributes(type, { listStyle }).run()
}

export function setLineHeight(editor: Editor, lh: number | null) {
  setParagraph(editor, { lineHeight: lh })
}

// ------------------------------------------------------------------ inserting

export function insertTable(editor: Editor, rows: number, cols: number, settings: DocSettings, header = true) {
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: header }).run()
  // Columns share the width between the margins, like Word.
  const w = Math.floor(((contentWidth(settings.page) * 96) / 72 - 2) / cols)
  const { state } = editor
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'table') continue
    const start = $from.before(d)
    const tr = state.tr
    $from.node(d).descendants((n, pos) => {
      if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
        tr.setNodeMarkup(start + 1 + pos, undefined, { ...n.attrs, colwidth: [w] })
        return false
      }
      return true
    })
    editor.view.dispatch(tr)
    break
  }
}

/** A table from rows of text (AI tools, paste of a list of rows). */
export function tableNode(rows: string[][], header: boolean, settings: DocSettings) {
  const cols = Math.max(1, ...rows.map((r) => r.length))
  const w = Math.floor(((contentWidth(settings.page) * 96) / 72 - 2) / cols)
  return {
    type: 'table',
    attrs: { borders: 'all' },
    content: rows.map((r, ri) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, (_, ci) => ({
        type: header && ri === 0 ? 'tableHeader' : 'tableCell',
        attrs: { colspan: 1, rowspan: 1, colwidth: [w] },
        content: [{ type: 'paragraph', attrs: { style: 'Normal' }, content: r[ci] ? [{ type: 'text', text: String(r[ci]) }] : undefined }],
      })),
    })),
  }
}

export function setCellBackground(editor: Editor, color: string | null) {
  editor.chain().focus().setCellAttribute('background', color).run()
}

export function setTableBorders(editor: Editor, borders: string) {
  editor.chain().focus().updateAttributes('table', { borders }).run()
}

export function insertImage(editor: Editor, src: string, alt = '', width?: number, height?: number) {
  editor.chain().focus().insertContent({ type: 'image', attrs: { src, alt: alt || null, width: width ?? null, height: height ?? null, wrap: 'inline' } }).run()
}

export function insertNode(editor: Editor, node: Record<string, unknown>) {
  editor.chain().focus().insertContent(node).run()
}

export function setNodeAttrs(editor: Editor, pos: number, attrs: Record<string, unknown>) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs }))
}

/** Select the node at pos (pictures, equations). */
export function selectNode(editor: Editor, pos: number) {
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)))
}

/** Select the word at the cursor when nothing is selected. */
export function selectWordIfEmpty(editor: Editor): boolean {
  const { state } = editor
  if (!state.selection.empty) return true
  const { $from } = state.selection
  const text = $from.parent.textContent
  let a = $from.parentOffset
  let b = a
  while (a > 0 && /[\p{L}\p{N}'’_-]/u.test(text[a - 1])) a--
  while (b < text.length && /[\p{L}\p{N}'’_-]/u.test(text[b])) b++
  if (a === b) return false
  const start = $from.start()
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start + a, start + b)))
  return true
}

// ------------------------------------------------------------------ format painter

export interface Painter {
  marks: { type: string; attrs: Record<string, unknown> }[]
  para: Record<string, unknown> | null
  sticky: boolean
}

export function capturePainter(editor: Editor, sticky: boolean): Painter {
  const { $from } = editor.state.selection
  const marks = (editor.state.storedMarks ?? $from.marks()).filter((m: Mark) => FORMAT_MARKS.includes(m.type.name)).map((m: Mark) => ({ type: m.type.name, attrs: { ...m.attrs } }))
  const p = currentParagraph(editor)
  return { marks, para: p ? { ...p.attrs } : null, sticky }
}

export function applyPainter(editor: Editor, p: Painter) {
  if (editor.state.selection.empty) selectWordIfEmpty(editor)
  let chain = editor.chain()
  for (const m of FORMAT_MARKS) chain = chain.unsetMark(m)
  for (const m of p.marks) chain = chain.setMark(m.type, m.attrs)
  if (p.para && editor.state.selection.empty) chain = chain.updateAttributes('paragraph', p.para)
  chain.run()
}

// ------------------------------------------------------------------ headings

export function headingList(editor: Editor, styles: Record<string, StyleDef>): { text: string; level: number; pos: number }[] {
  const out: { text: string; level: number; pos: number }[] = []
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'table') return false
    if (n.type.name !== 'paragraph') return true
    const style = String(n.attrs.style ?? 'Normal')
    const level = style === 'Title' ? 0 : (resolveStyle(styles, style).outline ?? 0)
    if (level >= 1 && n.textContent.trim()) out.push({ text: n.textContent.trim(), level, pos })
    return false
  })
  return out
}
