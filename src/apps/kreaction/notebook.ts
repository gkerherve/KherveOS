// The kReaction notebook: results pinned with a label (text and, for reactions, the structures as SVG), copied
// or exported as Markdown with the pictures embedded. Pure functions.

import { svgDataUri } from './svgtheme.ts'

export interface NotebookEntry {
  id: string
  label: string
  /** The tool it came from ("Reaction builder", "Kinetics"…). */
  tool: string
  /** The inputs and results as plain text lines. */
  text: string
  time: number
  /** Plain (print) SVG pictures: structures or charts. */
  svgs?: string[]
}

export const MAX_ENTRIES = 200

export function newEntry(tool: string, label: string, text: string, svgs: string[] = [], time = Date.now()): NotebookEntry {
  return { id: `${time.toString(36)}${Math.random().toString(36).slice(2, 6)}`, label: label.trim() || tool, tool, text: text.trim(), time, ...(svgs.length ? { svgs } : {}) }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function stamp(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The notebook as Markdown: a heading per entry, the lines in a code block, the pictures as embedded images. */
export function toMarkdown(entries: NotebookEntry[], title = 'kReaction notebook'): string {
  const out = [`# ${title}`, '']
  if (entries.length === 0) out.push('_Nothing pinned yet._', '')
  for (const e of entries) {
    out.push(`## ${e.label}`, '', `*${e.tool} · ${stamp(e.time)}*`, '')
    for (const svg of e.svgs ?? []) out.push(`![${e.label}](${svgDataUri(svg)})`, '')
    out.push('```', e.text, '```', '')
  }
  return out.join('\n')
}

export function toPlainText(entries: NotebookEntry[], title = 'kReaction notebook'): string {
  const out = [title, '='.repeat(title.length), '']
  for (const e of entries) out.push(`${e.label}  [${e.tool}, ${stamp(e.time)}]`, e.text, '')
  return out.join('\n')
}

export function entryText(e: NotebookEntry): string {
  return `${e.label}\n${e.text}`
}
