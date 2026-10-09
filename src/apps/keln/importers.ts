// Importing text into a new draft entry (pure): Markdown or plain text, and a kNote note (.knote is a ZIP with a
// note.json of sections and blocks; its words become headings, paragraphs and list items).

import { strFromU8, unzipSync } from 'fflate'
import { markdownToDoc, titleOfMarkdown, type PMNode } from './doc.ts'

export interface Imported {
  title: string
  content: PMNode
  tags: string[]
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** A kNote note.json as Markdown: sections → headings, key points and questions → bold lead-ins, items → lists. */
export function knoteToMarkdown(note: unknown): { title: string; markdown: string } {
  if (!isObj(note)) throw new Error('This is not a kNote note.')
  const meta = isObj(note.meta) ? note.meta : {}
  const title = typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : 'Imported note'
  const lines: string[] = [`# ${title}`, '']
  const info = [meta.speaker && `Speaker: ${meta.speaker}`, meta.date && `Date: ${meta.date}`, meta.place && `Place: ${meta.place}`].filter((x): x is string => typeof x === 'string')
  if (info.length) lines.push(info.join(' · '), '')
  if (typeof note.summary === 'string' && note.summary.trim()) lines.push('> ' + note.summary.trim().replace(/\n/g, '\n> '), '')
  const sections = Array.isArray(note.sections) ? note.sections : []
  for (const sec of sections) {
    if (!isObj(sec)) continue
    if (typeof sec.title === 'string' && sec.title.trim()) lines.push(`## ${sec.title.trim()}`, '')
    const blocks = Array.isArray(sec.blocks) ? sec.blocks : []
    for (const b of blocks) {
      if (!isObj(b)) continue
      const text = typeof b.text === 'string' ? b.text.trim() : ''
      const kind = String(b.kind ?? 'typed')
      if (kind === 'heading') lines.push(`${'#'.repeat(Math.min(6, 2 + (Number(b.level) || 1)))} ${text}`, '')
      else if (kind === 'item') lines.push(`${'  '.repeat(Math.max(0, Number(b.level) || 0))}${b.numbered ? '1.' : '-'} ${text}`)
      else if (kind === 'image' || kind === 'attachment') lines.push(`*[${kind}: ${String(b.path ?? '')}]*`, '')
      else if (text) lines.push(kind === 'important' ? `**Key point:** ${text}` : kind === 'question' ? `**Question:** ${text}` : text, '')
    }
    lines.push('')
  }
  return { title, markdown: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' }
}

/** A file's bytes as an entry body: .knote, or text (Markdown, .txt…). */
export function importFile(name: string, bytes: Uint8Array): Imported {
  if (/\.knote$/i.test(name)) {
    let entries: Record<string, Uint8Array>
    try { entries = unzipSync(bytes, { filter: (f) => f.name === 'note.json' }) } catch { throw new Error('This is not a kNote note (it is not a ZIP archive).') }
    if (!entries['note.json']) throw new Error('This .knote file has no note.json.')
    const { title, markdown } = knoteToMarkdown(JSON.parse(strFromU8(entries['note.json'])))
    return { title, content: markdownToDoc(markdown), tags: ['imported', 'knote'] }
  }
  const text = new TextDecoder().decode(bytes)
  return { title: titleOfMarkdown(text, name.replace(/\.[^.]+$/, '')), content: markdownToDoc(text), tags: ['imported'] }
}
