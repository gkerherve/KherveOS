// Notes: the file format. One note = one Markdown file on the drive,
//
//   ~/Notes/<Folder>/<Title>.md
//   ~/Notes/<Folder>/Attachments/<picture or file>     (linked from the note)
//   ~/Notes/Recently Deleted/<Title>.md                 (kept 30 days)
//
// with a small YAML front matter that other editors leave alone:
//
//   ---
//   id: n-lx3k9f-4c1a
//   created: 2026-10-08T09:12:00.000Z
//   modified: 2026-10-08T09:30:12.000Z
//   pinned: true
//   tags: [work, ideas]
//   ---
//   Shopping list
//   - [ ] milk #home
//
// The first line of the text is the title (and the file name). Tags are the
// #words in the text; the front matter repeats them for other tools. A note in
// Recently Deleted also has `deleted:` (when) and `folder:` (where it was).
// Keys the app does not know are kept as they are.
//
// Plain TypeScript (no React, no "@/" imports): `node --test tools/tests/notes.test.ts`.

import { docToPlain, markdownToDoc } from './markdown.ts'

export interface NoteHeader {
  id?: string
  created?: string
  modified?: string
  pinned?: boolean
  tags?: string[]
  /** In Recently Deleted: when it was deleted (ISO date). */
  deleted?: string
  /** In Recently Deleted: the folder it came from ("" = Notes). */
  folder?: string
  /** Other keys, kept in order as written. */
  extra?: [string, string][]
}

export interface ParsedNote {
  header: NoteHeader
  /** The Markdown after the front matter. */
  body: string
  /** True when the file had a front matter block. */
  hadHeader: boolean
}

const KNOWN = new Set(['id', 'created', 'modified', 'pinned', 'tags', 'deleted', 'folder'])

function unquote(v: string): string {
  const s = v.trim()
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    const inner = s.slice(1, -1)
    return s[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'")
  }
  return s
}

function quoteIfNeeded(v: string): string {
  if (v === '' || /^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|: | #/.test(v) || /^(true|false|null|~|yes|no|on|off|[\d.+-]+)$/i.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return v
}

function parseList(v: string): string[] {
  const s = v.trim()
  if (!s) return []
  const inner = s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1) : s
  return inner
    .split(',')
    .map((x) => unquote(x).replace(/^#/, '').trim())
    .filter(Boolean)
}

/** Split a note file into its front matter and its Markdown. */
export function parseNoteFile(text: string): ParsedNote {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(src)
  if (!m) return { header: {}, body: src, hadHeader: false }
  const header: NoteHeader = {}
  const extra: [string, string][] = []
  const lines = m[1].split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const kv = /^([A-Za-z_][\w-]*):(.*)$/.exec(line)
    if (!kv) continue
    const key = kv[1]
    let value = kv[2]
    // A YAML block list ("tags:\n  - a\n  - b").
    if (!value.trim() && i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) {
      const items: string[] = []
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) items.push(lines[++i].replace(/^\s+-\s/, ''))
      value = `[${items.join(', ')}]`
    }
    if (!KNOWN.has(key)) {
      extra.push([key, value.trim()])
      continue
    }
    const v = unquote(value)
    if (key === 'id') header.id = v
    else if (key === 'created') header.created = v
    else if (key === 'modified') header.modified = v
    else if (key === 'deleted') header.deleted = v
    else if (key === 'folder') header.folder = v
    else if (key === 'pinned') header.pinned = /^(true|yes|on|1)$/i.test(v)
    else if (key === 'tags') header.tags = parseList(value)
  }
  if (extra.length) header.extra = extra
  return { header, body: src.slice(m[0].length), hadHeader: true }
}

/** A note file: front matter + Markdown. */
export function serializeNoteFile(header: NoteHeader, body: string): string {
  const lines: string[] = []
  if (header.id) lines.push(`id: ${quoteIfNeeded(header.id)}`)
  if (header.created) lines.push(`created: ${header.created}`)
  if (header.modified) lines.push(`modified: ${header.modified}`)
  if (header.pinned) lines.push('pinned: true')
  if (header.tags?.length) lines.push(`tags: [${header.tags.map(quoteIfNeeded).join(', ')}]`)
  if (header.deleted) lines.push(`deleted: ${header.deleted}`)
  if (header.folder !== undefined && header.deleted) lines.push(`folder: ${quoteIfNeeded(header.folder)}`)
  for (const [k, v] of header.extra ?? []) lines.push(`${k}: ${v}`)
  const text = body.replace(/^\n+/, '')
  return `---\n${lines.join('\n')}\n---\n${text}`
}

// ------------------------------------------------------------ what a note says

const TAG_RE = /(^|[\s([{,;])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu

/** The #tags in a text, without "#", lower case, in order of appearance. */
export function tagsIn(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[2].replace(/[-/]+$/, '')
    if (!/\p{L}/u.test(tag)) continue // "#1" is a number, not a tag
    seen.add(tag.toLowerCase())
  }
  return [...seen]
}

export interface NoteSummary {
  title: string
  /** The text after the title, on one line, for the list. */
  preview: string
  /** Everything, as plain text (search, AI). */
  text: string
  tags: string[]
}

/** Title, preview, text and tags of a note's Markdown. */
export function summarize(body: string): NoteSummary {
  const doc = markdownToDoc(body)
  const bare = docToPlain(doc, { markers: false })
  const lines = bare.split('\n').map((l) => l.trim())
  const first = lines.findIndex(Boolean)
  const title = first >= 0 ? lines[first].slice(0, 200) : ''
  const preview = first >= 0 ? lines.slice(first + 1).filter(Boolean).join(' ').slice(0, 160) : ''
  const text = docToPlain(doc)
  return { title, preview, text, tags: tagsIn(text) }
}

/** The file name for a title: no characters other systems refuse, at most 80 long. */
export function fileStem(title: string): string {
  const s = title
    .replace(/[\\/:*?"<>|#\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim()
  return s || 'New Note'
}

/** True when `name` ("Title.md", "Title 2.md") is already the file of this title. */
export function nameFitsTitle(name: string, title: string): boolean {
  const stem = name.replace(/\.md$/i, '')
  const want = fileStem(title)
  if (stem === want) return true
  const m = /^(.*) (\d+)$/.exec(stem)
  return !!m && m[1] === want
}

/** A new note id: short, sortable-ish, unique enough for one person's notes. */
export function newNoteId(now = Date.now(), rand: () => number = Math.random): string {
  const r = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')
  return `n-${now.toString(36)}-${r}`
}

/** Folder names the app keeps for itself (at every level). */
export const TRASH = 'Recently Deleted'
export const RESERVED_FOLDERS = ['Attachments', TRASH]

/** Whether a folder name is one users can make. Returns why not, or null. */
export function folderNameProblem(name: string): string | null {
  const n = name.trim()
  if (!n) return 'A folder needs a name.'
  if (/[\\/:*?"<>|]/.test(n)) return 'Folder names cannot contain \\ / : * ? " < > |'
  if (n.startsWith('.')) return 'Folder names cannot start with a dot.'
  if (RESERVED_FOLDERS.some((r) => r.toLowerCase() === n.toLowerCase())) return `"${n}" is kept for the app's own use.`
  if (n.length > 80) return 'That name is too long.'
  return null
}

/** How long Recently Deleted keeps a note. */
export const TRASH_DAYS = 30

/** Days left before a deleted note goes for good (0: today). */
export function daysLeft(deletedIso: string | undefined, now = Date.now()): number {
  const t = deletedIso ? Date.parse(deletedIso) : NaN
  if (!Number.isFinite(t)) return TRASH_DAYS
  return Math.max(0, Math.ceil(TRASH_DAYS - (now - t) / 86_400_000))
}

/** The relative links (pictures, files) of a note's Markdown, decoded, without duplicates. */
export function localLinks(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const href = m[1]
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) continue
    try {
      out.add(decodeURIComponent(href))
    } catch {
      out.add(href)
    }
  }
  return [...out]
}

/** Replace links to `from` (relative) by links to `to` in a note's Markdown. */
export function relinkMarkdown(body: string, from: string, to: string): string {
  const enc = (s: string) => s.replace(/[\s()<>]/g, (c) => encodeURIComponent(c))
  const variants = new Set([from, enc(from), encodeURI(from)])
  let out = body
  for (const v of variants) out = out.split(`](${v})`).join(`](${enc(to)})`).split(`](${v} "`).join(`](${enc(to)} "`)
  return out
}

/** "14:05", "Yesterday", "Monday", "08/10/2026" — the list's dates, like Notes on a Mac. */
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  if (diff === 0) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString()
}
