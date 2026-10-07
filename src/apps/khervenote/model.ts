// KherveNote's note model — the desktop KherveNote's khervenote/model.py.
//
// A Note is one listening session (a lecture, a training, a talk): a flat run
// of Sections, each holding Blocks in the order they were captured. The page,
// the .knote file, the LaTeX serializer and the AI tools all read and write
// through it. Times (`t`) are seconds since the session started.
//
// toDict()/fromDict() give exactly the JSON the desktop writes in note.json,
// so files go back and forth between the two apps. Plain TypeScript (no "@/"
// imports) so Node can test it: node --test src/apps/khervenote/tests/

/** Bumped when the JSON layout changes incompatibly (FORMAT_VERSION). */
export const FORMAT_VERSION = 1

export const BLOCK_KINDS = ['typed', 'transcript', 'important', 'question', 'image', 'heading', 'item', 'attachment'] as const
export type BlockKind = (typeof BLOCK_KINDS)[number]

export const MARK_STYLES = ['b', 'i', 'u'] as const
export type MarkStyle = (typeof MARK_STYLES)[number]
/** [start, length, style] over a block's text. */
export type Mark = [number, number, MarkStyle]

export const LAYOUTS = ['continuous', 'paged'] as const
export type Layout = (typeof LAYOUTS)[number]

export interface Block {
  id: string
  kind: BlockKind
  text: string
  t: number | null
  /** Asset path inside the note ("assets/<name>"): images and attachments. */
  path: string
  /** Heading level (2-3) or list nesting depth (0-3). */
  level: number
  numbered: boolean
  marks: Mark[]
}

export interface Section {
  id: string
  /** An empty title on the first section means "before any section was started". */
  title: string
  t: number | null
  blocks: Block[]
}

/** One stretch of recognised speech; `t` is when it was said (session time). */
export interface Segment {
  t: number
  text: string
}

/** One Listen-to-Stop run of the microphone, kept in the note's assets. */
export interface Recording {
  path: string
  t0: number
  duration: number
}

export interface Attachment {
  path: string
  name: string
}

export interface Meta {
  title: string
  speaker: string
  date: string
  place: string
  /** ISO time the session started; block times count from it. */
  started: string
  layout: Layout
  /** Stays with the note when its file moves; names its folder of earlier versions. */
  id: string
  /** Names, acronyms and terms of the talk, comma-separated. */
  vocabulary: string
}

export interface Note {
  meta: Meta
  summary: string
  sections: Section[]
  recordings: Recording[]
  transcript: Segment[]
  attachments: Attachment[]
}

// ------------------------------------------------------------------ helpers

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)

function randomHex(n: number): string {
  const bytes = new Uint8Array(Math.ceil(n / 2))
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, n)
}

/** uuid4().hex[:10], as block and section ids are made. */
export const newId = () => randomHex(10)
/** uuid4().hex, the note's own id. */
export const newNoteId = () => randomHex(32)

/** Python's round(x, 2). */
export const round2 = (x: number) => Math.round(x * 100) / 100

export function makeBlock(init: Partial<Block> & { kind?: BlockKind } = {}): Block {
  const kind = init.kind ?? 'typed'
  if (!BLOCK_KINDS.includes(kind)) throw new Error(`unknown block kind ${JSON.stringify(kind)}`)
  return {
    id: init.id || newId(),
    kind,
    text: init.text ?? '',
    t: init.t ?? null,
    path: init.path ?? '',
    level: init.level ?? 0,
    numbered: init.numbered ?? false,
    marks: init.marks ? init.marks.map((m) => [m[0], m[1], m[2]] as Mark) : [],
  }
}

export function makeSection(init: Partial<Section> = {}): Section {
  return { id: init.id || newId(), title: init.title ?? '', t: init.t ?? null, blocks: init.blocks ?? [] }
}

export function makeMeta(init: Partial<Meta> = {}): Meta {
  return {
    title: init.title ?? '',
    speaker: init.speaker ?? '',
    date: init.date ?? '',
    place: init.place ?? '',
    started: init.started ?? '',
    layout: init.layout && LAYOUTS.includes(init.layout) ? init.layout : 'continuous',
    id: init.id || newNoteId(),
    vocabulary: init.vocabulary ?? '',
  }
}

export function makeNote(init: Partial<Note> = {}): Note {
  const sections = init.sections && init.sections.length ? init.sections : [makeSection()]
  return {
    meta: init.meta ?? makeMeta(),
    summary: init.summary ?? '',
    sections,
    recordings: init.recordings ?? [],
    transcript: init.transcript ?? [],
    attachments: init.attachments ?? [],
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const p2 = (n: number) => String(n).padStart(2, '0')

/** datetime.now().isoformat(timespec="seconds") (local time, no offset). */
export function isoSeconds(d = new Date()): string {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

/** strftime("%d %B %Y"): "07 October 2026". */
export function longDate(d = new Date()): string {
  return `${p2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Note.new(): a fresh note started now. */
export function newNote(now = new Date()): Note {
  return makeNote({ meta: makeMeta({ date: longDate(now), started: isoSeconds(now) }) })
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/

function parseIso(s: string): { y: number; mo: number; d: number; h: number; mi: number; s: number; zone: string } | null {
  const m = ISO_RE.exec(s.trim())
  if (!m) return null
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0), zone: m[7] ?? '' }
}

/** "1:02:03" or "02:03": time since the start (serializer.format_time). */
export function formatTime(t: number | null): string {
  if (t == null) return ''
  const s = Math.trunc(t)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${p2(m)}:${p2(sec)}` : `${p2(m)}:${p2(sec)}`
}

/**
 * How a time is shown (Note.time_label): the time of day ("10:42:15") or,
 * with `clock` false or no start time, the time since the start.
 */
export function timeLabel(note: Note, t: number | null, clock = true, seconds = true): string {
  if (t == null) return ''
  const start = clock && note.meta.started ? parseIso(note.meta.started) : null
  if (start) {
    const total = Math.floor(start.h * 3600 + start.mi * 60 + start.s + t)
    const day = ((total % 86400) + 86400) % 86400
    const hh = p2(Math.floor(day / 3600))
    const mm = p2(Math.floor((day % 3600) / 60))
    return seconds ? `${hh}:${mm}:${p2(day % 60)}` : `${hh}:${mm}`
  }
  return formatTime(t)
}

/** Seconds since the session started (Note.elapsed), or null without a start time. */
export function elapsed(note: Note, now = new Date()): number | null {
  const p = note.meta.started ? parseIso(note.meta.started) : null
  if (!p) return null
  const start = p.zone ? Date.parse(note.meta.started) : new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s).getTime()
  if (!Number.isFinite(start)) return null
  return Math.max(0, (now.getTime() - start) / 1000)
}

/** Transcript segments said from `start` up to (not including) `end`; null leaves that side open. */
export function speechBetween(note: Note, start: number | null, end: number | null): Segment[] {
  return note.transcript.filter((g) => (start == null || g.t >= start) && (end == null || g.t < end))
}

export function attachmentBlocks(note: Note): Attachment[] {
  const out: Attachment[] = []
  for (const s of note.sections) for (const b of s.blocks) if (b.kind === 'attachment') out.push({ path: b.path, name: b.text })
  return out
}

export function assetPaths(note: Note): string[] {
  const out: string[] = []
  for (const s of note.sections) for (const b of s.blocks) if (b.path) out.push(b.path)
  for (const r of note.recordings) out.push(r.path)
  for (const a of note.attachments) out.push(a.path)
  return out
}

/** The note as lightly marked-up text, for an AI to read (Note.plain_text). */
export function plainText(note: Note): string {
  const m = note.meta
  const lines: string[] = [m.title ? `# ${m.title}` : '# Notes']
  for (const x of [m.speaker, m.date, m.place]) if (x) lines.push(x)
  if (note.attachments.length) lines.push('Attached: ' + note.attachments.map((a) => a.name).join(', '))
  for (const sec of note.sections) {
    if (sec.title) lines.push('', `## ${sec.title}`)
    for (const b of sec.blocks) {
      if (b.kind === 'heading') lines.push('', '#'.repeat(b.level + 1) + ' ' + b.text)
      else if (b.kind === 'item') lines.push('  '.repeat(b.level) + `${b.numbered ? '1.' : '-'} ${b.text}`)
      else if (b.kind === 'image') lines.push(`[image${b.text ? ': ' + b.text : ''}]`)
      else if (b.kind === 'attachment') lines.push(`[attached document: ${b.text}]`)
      else {
        const prefix = ({ important: 'Key point: ', question: 'Question: ', transcript: '(said) ' } as Record<string, string>)[b.kind] ?? ''
        lines.push(prefix + b.text)
      }
    }
  }
  if (note.transcript.length) {
    lines.push('', '## What was said (transcript)')
    for (const g of note.transcript) lines.push(`[${timeLabel(note, g.t)}] ${g.text}`)
  }
  return pyStrip(lines.join('\n')) + '\n'
}

/** Python's str.strip() (Unicode whitespace). */
export function pyStrip(s: string): string {
  return s.replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/g, '')
}

/** Python's str.splitlines(). */
export function splitLines(s: string): string[] {
  const parts = s.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/)
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}

/** The width of an indent with tabs every 4 columns (len(s.expandtabs(4))). */
export function indentWidth(s: string): number {
  let col = 0
  for (const ch of s) col = ch === '\t' ? col + 4 - (col % 4) : col + 1
  return col
}

// -------------------------------------------------------------- persistence

function blockToDict(b: Block): Obj {
  const d: Obj = { id: b.id, kind: b.kind, text: b.text }
  if (b.t != null) d.t = round2(b.t)
  if (b.path) d.path = b.path
  if (b.level) d.level = b.level
  if (b.numbered) d.numbered = true
  if (b.marks.length) d.marks = b.marks.map((m) => [m[0], m[1], m[2]])
  return d
}

function blockFromDict(d: Obj): Block {
  const kind = str(d.kind, 'typed') || 'typed'
  if (!BLOCK_KINDS.includes(kind as BlockKind)) throw new Error(`unknown block kind ${JSON.stringify(kind)}`)
  const marks = Array.isArray(d.marks)
    ? d.marks.filter((m): m is [number, number, MarkStyle] => Array.isArray(m) && m.length === 3 && MARK_STYLES.includes(m[2])).map((m) => [Number(m[0]), Number(m[1]), m[2]] as Mark)
    : []
  return {
    id: str(d.id) || newId(),
    kind: kind as BlockKind,
    text: str(d.text),
    t: num(d.t),
    path: str(d.path),
    level: Math.trunc(Number(d.level ?? 0)) || 0,
    numbered: !!d.numbered,
    marks,
  }
}

function sectionToDict(s: Section): Obj {
  const d: Obj = { id: s.id, title: s.title, blocks: s.blocks.map(blockToDict) }
  if (s.t != null) d.t = round2(s.t)
  return d
}

function sectionFromDict(d: Obj): Section {
  return {
    id: str(d.id) || newId(),
    title: str(d.title),
    t: num(d.t),
    blocks: Array.isArray(d.blocks) ? d.blocks.filter(isObj).map(blockFromDict) : [],
  }
}

export function toDict(note: Note): Obj {
  const m = note.meta
  return {
    format: FORMAT_VERSION,
    meta: { title: m.title, speaker: m.speaker, date: m.date, place: m.place, started: m.started, layout: m.layout, id: m.id, vocabulary: m.vocabulary },
    summary: note.summary,
    sections: note.sections.map(sectionToDict),
    recordings: note.recordings.map((r) => ({ path: r.path, t0: round2(r.t0), duration: round2(r.duration) })),
    transcript: note.transcript.map((g) => ({ t: round2(g.t), text: g.text })),
    attachments: note.attachments.map((a) => ({ path: a.path, name: a.name })),
  }
}

export function fromDict(raw: unknown): Note {
  const d = isObj(raw) ? raw : {}
  const fmt = num(d.format) ?? 1
  if (fmt > FORMAT_VERSION) throw new Error(`this note was written by a newer KherveNote (format ${fmt})`)
  const m = isObj(d.meta) ? d.meta : {}
  const meta = makeMeta({
    title: str(m.title),
    speaker: str(m.speaker),
    date: str(m.date),
    place: str(m.place),
    started: str(m.started),
    layout: m.layout as Layout,
    id: str(m.id),
    vocabulary: str(m.vocabulary),
  })
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : [])
  return makeNote({
    meta,
    summary: str(d.summary),
    sections: list(d.sections).map(sectionFromDict),
    recordings: list(d.recordings)
      .filter((r) => typeof r.path === 'string')
      .map((r) => ({ path: r.path as string, t0: num(r.t0) ?? 0, duration: num(r.duration) ?? 0 })),
    transcript: list(d.transcript).map((g) => ({ t: num(g.t) ?? 0, text: str(g.text) })),
    attachments: list(d.attachments)
      .filter((a) => typeof a.path === 'string')
      .map((a) => ({ path: a.path as string, name: str(a.name) || (a.path as string).split('/').pop()! })),
  })
}

/** A float as Python's json writes it: 25.0, 12.35. */
function pyFloat(x: number): string {
  return Number.isInteger(x) && Math.abs(x) < 1e16 ? x.toFixed(1) : String(x)
}

const FLOAT_TAG = '\u0000pyfloat:'
const FLOAT_RE = /"\\u0000pyfloat:([^"]*)"/g

/**
 * note.json as the desktop writes it: json.dumps(note.to_dict(), indent=1,
 * ensure_ascii=False). Times of speech segments are always floats there; other
 * numbers keep the int/float they had, which JavaScript cannot tell apart, so
 * whole numbers are written as ints (Python reads both the same).
 */
export function noteJson(note: Note): string {
  const d = toDict(note)
  for (const g of d.transcript as Obj[]) g.t = FLOAT_TAG + pyFloat(g.t as number)
  return JSON.stringify(d, null, 1).replace(FLOAT_RE, '$1')
}

export function parseNoteJson(text: string): Note {
  return fromDict(JSON.parse(text))
}

export function cloneNote(note: Note): Note {
  return fromDict(JSON.parse(JSON.stringify(toDict(note))))
}

// ---------------------------------------------------------- editing helpers

export function findBlock(note: Note, blockId: string): { section: Section; index: number } | null {
  for (const section of note.sections) {
    const index = section.blocks.findIndex((b) => b.id === blockId)
    if (index >= 0) return { section, index }
  }
  return null
}

/**
 * Section i's speech (the desktop's section_windows + _speech_window): from
 * `lead` seconds before its heading was written to `lead` before the next
 * section's; the untitled part before the first heading starts at the beginning.
 */
export function sectionSpeechRange(note: Note, index: number, lead = 120): { start: number | null; end: number | null } {
  const sec = note.sections[index]
  if (!sec) return { start: null, end: null }
  const untitledLead = index === 0 && !sec.title
  const start = untitledLead ? null : sec.t
  const next = note.sections[index + 1]
  const end = next ? next.t : null
  return { start: start == null ? null : start - lead, end: end == null ? null : end - lead }
}

// ------------------------------------------------------ the AI's Markdown

const MD_ITEM = /^(\s*)([-*•]|\d{1,3}[.)])\s+(.*)$/
const MD_HEAD = /^(#{1,6})\s+(.*)$/
const MD_BOLD = /\*\*(.+?)\*\*|__(.+?)__/g

function stripChars(s: string, chars: string): string {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a])) a++
  while (b > a && chars.includes(s[b - 1])) b--
  return s.slice(a, b)
}

function rich(s: string): { text: string; marks: Mark[] } {
  const marks: Mark[] = []
  let plain = ''
  let pos = 0
  for (const m of s.matchAll(MD_BOLD)) {
    plain += s.slice(pos, m.index)
    const inner = m[1] ?? m[2]
    marks.push([plain.length, inner.length, 'b'])
    plain += inner
    pos = m.index! + m[0].length
  }
  return { text: plain + s.slice(pos), marks }
}

/**
 * Blocks from the light Markdown an AI answers in (model.markdown_blocks):
 * "#" headings (shifted so the shallowest becomes `topLevel`), "-" / "1." items
 * nested by indent, **bold**, and paragraphs between blank lines.
 */
export function markdownBlocks(text: string, topLevel = 2): Block[] {
  const out: Block[] = []
  const para: string[] = []
  const widths: number[] = []
  const lines = splitLines(text)
  const heads = lines.map((l) => MD_HEAD.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => m[1].length)
  const shift = heads.length ? topLevel - Math.min(...heads) : 0
  const flush = () => {
    if (para.length) {
      const r = rich(para.join(' '))
      out.push(makeBlock({ kind: 'typed', text: r.text, marks: r.marks }))
      para.length = 0
    }
  }
  for (const line of lines) {
    if (!pyStrip(line)) {
      flush()
      widths.length = 0
      continue
    }
    const head = MD_HEAD.exec(pyStrip(line))
    const item = MD_ITEM.exec(line)
    if (head) {
      flush()
      const level = Math.max(2, Math.min(3, head[1].length + shift))
      out.push(makeBlock({ kind: 'heading', text: rich(stripChars(head[2], '# ')).text, level }))
    } else if (item) {
      flush()
      const width = indentWidth(item[1])
      while (widths.length && widths[widths.length - 1] > width) widths.pop()
      if (!widths.length || widths[widths.length - 1] < width) widths.push(width)
      const r = rich(pyStrip(item[3]))
      out.push(makeBlock({ kind: 'item', text: r.text, marks: r.marks, level: Math.min(3, widths.length - 1), numbered: /^\d/.test(item[2]) }))
    } else {
      para.push(pyStrip(line))
    }
  }
  flush()
  return out
}
