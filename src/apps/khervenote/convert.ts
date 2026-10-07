// The page ↔ the note model (the desktop's editor.load_note / document_to_note).
//
// The page is one endless TipTap document: a section is a level-1 heading,
// every other paragraph is a block whose kind lives in its node (paragraph
// kind="typed|important|question|transcript", heading 2-3, knItem, knImage,
// knAttachment) and whose capture time is its `t` attribute. Works on plain
// JSON (TipTap's JSONContent) so Node can test it.

import { attachmentBlocks, makeBlock, makeSection, pyStrip, type Block, type BlockKind, type Mark, type MarkStyle, type Note, type Section } from './model.ts'

export interface JNode {
  type: string
  attrs?: Record<string, unknown>
  content?: JNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

const MARK_OF: Record<MarkStyle, string> = { b: 'bold', i: 'italic', u: 'underline' }
const STYLE_OF: Record<string, MarkStyle> = { bold: 'b', italic: 'i', underline: 'u' }
export const PARAGRAPH_KINDS = ['typed', 'important', 'question', 'transcript'] as const

/** Text with marks → inline nodes (newlines become hard breaks). */
export function inlineNodes(text: string, marks: Mark[]): JNode[] {
  const n = text.length
  const cuts = new Set<number>([0, n])
  for (const m of marks) for (const c of [m[0], m[0] + m[1]]) cuts.add(Math.max(0, Math.min(n, c)))
  for (let i = 0; i < n; i++) if (text[i] === '\n') (cuts.add(i), cuts.add(i + 1))
  const sorted = [...cuts].sort((a, b) => a - b)
  const out: JNode[] = []
  for (let k = 0; k + 1 < sorted.length; k++) {
    const a = sorted[k]
    const b = sorted[k + 1]
    const seg = text.slice(a, b)
    if (!seg) continue
    if (seg === '\n') {
      out.push({ type: 'hardBreak' })
      continue
    }
    const styles = [...new Set(marks.filter((m) => m[0] <= a && m[0] + m[1] >= b && m[1] > 0).map((m) => m[2]))].sort()
    const node: JNode = { type: 'text', text: seg }
    if (styles.length) node.marks = styles.map((s) => ({ type: MARK_OF[s] }))
    out.push(node)
  }
  return out
}

/** Inline nodes → text and marks (merged into runs per style). */
export function inlineText(content: JNode[] | undefined): { text: string; marks: Mark[] } {
  let text = ''
  const open: Partial<Record<MarkStyle, number>> = {}
  const marks: Mark[] = []
  const close = (style: MarkStyle, at: number) => {
    const start = open[style]
    if (start !== undefined && at > start) marks.push([start, at - start, style])
    delete open[style]
  }
  for (const node of content ?? []) {
    let piece = ''
    if (node.type === 'text') piece = node.text ?? ''
    else if (node.type === 'hardBreak') piece = '\n'
    else continue
    const styles = new Set((node.type === 'text' ? node.marks ?? [] : []).map((m) => STYLE_OF[m.type]).filter(Boolean))
    for (const s of Object.keys(open) as MarkStyle[]) if (!styles.has(s)) close(s, text.length)
    for (const s of styles) if (open[s] === undefined) open[s] = text.length
    text += piece
  }
  for (const s of Object.keys(open) as MarkStyle[]) close(s, text.length)
  marks.sort((a, b) => a[0] - b[0] || a[2].localeCompare(b[2]))
  return { text, marks }
}

function block(b: Block): JNode {
  const t = b.t
  switch (b.kind) {
    case 'heading':
      return { type: 'heading', attrs: { level: b.level >= 3 ? 3 : 2, t }, content: inlineNodes(b.text, b.marks) }
    case 'item':
      return { type: 'knItem', attrs: { level: Math.max(0, Math.min(3, b.level)), numbered: b.numbered, t }, content: inlineNodes(b.text, b.marks) }
    case 'image':
      return { type: 'knImage', attrs: { path: b.path, caption: b.text, t } }
    case 'attachment':
      return { type: 'knAttachment', attrs: { path: b.path, name: b.text, t } }
    default:
      return { type: 'paragraph', attrs: { kind: b.kind, t }, content: inlineNodes(b.text, b.marks) }
  }
}

/** The page for a note (load_note). */
export function noteToDoc(note: Note): JNode {
  const content: JNode[] = []
  note.sections.forEach((sec, i) => {
    if (i > 0 || sec.title) content.push({ type: 'heading', attrs: { level: 1, t: sec.t }, content: inlineNodes(sec.title, []) })
    for (const b of sec.blocks) content.push(block(b))
  })
  if (!content.length) content.push({ type: 'paragraph', attrs: { kind: 'typed', t: null } })
  return { type: 'doc', content }
}

const tOf = (n: JNode): number | null => (typeof n.attrs?.t === 'number' && Number.isFinite(n.attrs.t) ? (n.attrs.t as number) : null)

/** Strip text and keep its marks over what is left. */
function stripped(text: string, marks: Mark[]): { text: string; marks: Mark[] } {
  const lead = text.length - text.replace(/^[\s\x1c-\x1f\x85]+/, '').length
  const out = pyStrip(text)
  const kept: Mark[] = []
  for (const [s, l, st] of marks) {
    const a = Math.max(0, s - lead)
    const b = Math.min(out.length, s + l - lead)
    if (b > a) kept.push([a, b - a, st])
  }
  return { text: out, marks: kept }
}

/**
 * The note's sections from the page (document_to_note), keeping the meta,
 * summary, speech and recordings of `base`. Empty paragraphs are dropped.
 */
export function docToNote(doc: JNode, base: Note): Note {
  const sections: Section[] = [makeSection()]
  const add = (b: Block) => sections[sections.length - 1].blocks.push(b)
  for (const node of doc.content ?? []) {
    const t = tOf(node)
    if (node.type === 'heading') {
      const { text, marks } = inlineText(node.content)
      const level = Number(node.attrs?.level ?? 1)
      if (level <= 1) sections.push(makeSection({ title: pyStrip(text), t }))
      else if (pyStrip(text)) add(makeBlock({ kind: 'heading', text, marks, level: level >= 3 ? 3 : 2, t }))
    } else if (node.type === 'knItem') {
      const r = stripped(inlineText(node.content).text, inlineText(node.content).marks)
      add(makeBlock({ kind: 'item', text: r.text, marks: r.marks, t, level: Math.max(0, Math.min(3, Number(node.attrs?.level ?? 0))), numbered: !!node.attrs?.numbered }))
    } else if (node.type === 'knImage') {
      const path = String(node.attrs?.path ?? '')
      if (path) add(makeBlock({ kind: 'image', path, text: pyStrip(String(node.attrs?.caption ?? '')), t }))
    } else if (node.type === 'knAttachment') {
      const path = String(node.attrs?.path ?? '')
      if (path) add(makeBlock({ kind: 'attachment', path, text: String(node.attrs?.name ?? ''), t }))
    } else if (node.type === 'paragraph') {
      const { text, marks } = inlineText(node.content)
      const kind = (PARAGRAPH_KINDS as readonly string[]).includes(String(node.attrs?.kind)) ? (node.attrs!.kind as BlockKind) : 'typed'
      if (pyStrip(text)) add(makeBlock({ kind, text, marks, t }))
    }
  }
  if (sections.length > 1 && !sections[0].blocks.length) sections.shift()
  const note: Note = { ...base, sections }
  note.attachments = attachmentBlocks(note)
  return note
}

/** The blocks of one section as page nodes (for inserting AI text and the like). */
export function blocksToNodes(blocks: Block[]): JNode[] {
  return blocks.map(block)
}
