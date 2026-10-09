// The kELN notebook (pure): one .keln file (JSON) with projects, entries, samples, inventory, saved searches and an
// append-only audit log chained by SHA-256. This file holds the types, the hashes (what a signature covers, how a log
// record is chained) and reading/writing the file. The operations on a notebook are in notebook.ts, the verification
// in audit.ts.

import { canonical, hashOf, sha256 } from './hash.ts'
import { docMentions, emptyDoc, type PMNode } from './doc.ts'

export const FORMAT = 'keln'
export const VERSION = 1

export class KelnError extends Error {}

/** An entry that is signed (or witnessed) cannot be edited; it can only be amended. */
export class LockedError extends KelnError {}

export type Status = 'draft' | 'signed' | 'witnessed'
export type SampleStatus = 'in use' | 'consumed' | 'discarded'

export interface Project {
  id: string
  /** Short code used in experiment numbers: ASP → ASP-2026-001. */
  code: string
  name: string
  description: string
}

export interface Attachment {
  id: string
  name: string
  size: number
  /** SHA-256 of the file's bytes, recorded when it was added. */
  sha256: string
  mime: string
  added: string
  addedBy: string
  /** Where the file is in the drive ('' for a file that only exists inside the notebook). */
  path: string
  /** The bytes as base64, for small files (≤ 1 MB) that travel inside the notebook. */
  data?: string
}

export interface EntryLink {
  kind: 'entry' | 'path' | 'url'
  /** An entry id, a path in the drive or a web address. */
  target: string
  label: string
}

export interface Signature {
  user: string
  time: string
  /** The entry's content hash at that moment. */
  hash: string
}

export interface Addendum {
  id: string
  time: string
  author: string
  reason: string
  content: PMNode
  hash: string
}

export interface Entry {
  id: string
  projectId: string
  /** PROJ-YYYY-NNN; several entries may share one (an experiment over several days). */
  experiment: string
  title: string
  /** Local date and time of the work: 2026-03-04T09:30:00. */
  date: string
  author: string
  tags: string[]
  status: Status
  favourite: boolean
  content: PMNode
  attachments: Attachment[]
  links: EntryLink[]
  /** Samples linked by hand (the @mentions in the text count too). */
  samples: string[]
  template: string
  created: string
  modified: string
  signature: Signature | null
  witness: Signature | null
  addenda: Addendum[]
}

export interface Sample {
  id: string
  name: string
  composition: string
  batch: string
  location: string
  /** Date made: 2026-03-04. */
  made: string
  parents: string[]
  status: SampleStatus
  notes: string
  projectId: string
  author: string
}

export interface InventoryItem {
  id: string
  name: string
  formula: string
  cas: string
  /** g/mol; empty → from the formula. */
  mw: number | null
  /** g/mL, for liquids. */
  density: number | null
  supplier: string
  lot: string
  amount: string
  hazard: string
  location: string
}

export interface SearchFilters {
  project?: string
  tag?: string
  author?: string
  /** YYYY-MM-DD, inclusive. */
  from?: string
  to?: string
  status?: Status | 'amended'
  sample?: string
  instrument?: string
  favourite?: boolean
}

export interface SavedSearch {
  id: string
  name: string
  query: string
  filters: SearchFilters
}

export type AuditAction = 'notebook-created' | 'entry-created' | 'entry-edited' | 'entry-signed' | 'entry-witnessed' | 'entry-amended' | 'entry-exported' | 'entry-deleted' | 'notebook-exported'

export interface AuditRecord {
  seq: number
  time: string
  user: string
  action: AuditAction
  entryId: string
  /** The experiment number, so the record still says what it was about if the entry is gone. */
  number: string
  /** The entry's content hash (the addendum's hash for 'entry-amended'). */
  hash: string
  detail: string
  /** The previous record's `rec` ('' for the first). */
  prev: string
  /** SHA-256 of this record without this field: the link of the chain. */
  rec: string
}

export interface NotebookSettings {
  /** The sample ID scheme: PREFIX + zero-padded counter (XPS-0001). */
  samplePrefix: string
  sampleDigits: number
}

export interface Notebook {
  format: typeof FORMAT
  version: number
  id: string
  title: string
  description: string
  owner: string
  created: string
  modified: string
  settings: NotebookSettings
  projects: Project[]
  entries: Entry[]
  samples: Sample[]
  inventory: InventoryItem[]
  savedSearches: SavedSearch[]
  /** Instruments used in this notebook (suggestions for the Instrument run block). */
  instruments: string[]
  audit: AuditRecord[]
}

// ------------------------------------------------------------------ who and when

/** The clock, the user and the id maker an operation uses (a fixed one makes the example notebooks identical every time). */
export interface Ctx {
  now(): string
  user: string
  id(prefix: string): string
}

/** The real clock and random ids. */
export function systemCtx(user: string): Ctx {
  return {
    now: () => new Date().toISOString(),
    user,
    id: (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`,
  }
}

/** A fixed clock: see fixedCtx. `jump` moves it forward to a given instant (never back). */
export interface FixedCtx extends Ctx {
  jump(iso: string): void
}

/** A clock that starts at `start` and moves on `stepMinutes` at every reading, with counting ids. */
export function fixedCtx(start: string, user: string, stepMinutes = 7): FixedCtx {
  let t = Date.parse(start)
  let n = 0
  return {
    now: () => {
      const s = new Date(t).toISOString()
      t += stepMinutes * 60_000
      return s
    },
    jump: (iso) => { t = Math.max(t, Date.parse(iso)) },
    user,
    id: (prefix) => `${prefix}-${String(++n).padStart(3, '0')}`,
  }
}

/** The same context acting as someone else. */
export const asUser = (ctx: Ctx, user: string): Ctx => ({ ...ctx, user })

export const dayOf = (date: string): string => date.slice(0, 10)

// ------------------------------------------------------------------ hashes

/** What a signature covers: the entry's record, not its status, favourite flag or addenda. */
export function entryHashInput(e: Entry): unknown {
  return {
    v: 1,
    projectId: e.projectId,
    experiment: e.experiment,
    title: e.title,
    date: e.date,
    author: e.author,
    tags: e.tags,
    content: e.content,
    attachments: e.attachments.map((a) => ({ id: a.id, name: a.name, size: a.size, sha256: a.sha256 })),
    links: e.links,
    samples: [...e.samples].sort(),
  }
}

/** The content hash of an entry (SHA-256 of the canonical JSON above). */
export const entryHash = (e: Entry): string => hashOf(entryHashInput(e))

/** The hash of an addendum: its text and author tied to the entry it was written under. */
export function addendumHash(entryContentHash: string, a: Pick<Addendum, 'id' | 'time' | 'author' | 'reason' | 'content'>): string {
  return hashOf({ v: 1, entry: entryContentHash, id: a.id, time: a.time, author: a.author, reason: a.reason, content: a.content })
}

/** The `rec` of a log record: its own hash over every other field. */
export function recordHash(r: Omit<AuditRecord, 'rec'> & { rec?: string }): string {
  const { rec: _rec, ...rest } = r
  void _rec
  return sha256(canonical(rest))
}

/** The notebook with one more audit record at the end of the chain. */
export function appendAudit(nb: Notebook, ctx: Ctx, r: { action: AuditAction; entryId?: string; number?: string; hash?: string; detail?: string; user?: string }): Notebook {
  const last = nb.audit[nb.audit.length - 1]
  const base = {
    seq: nb.audit.length + 1, time: ctx.now(), user: r.user ?? ctx.user, action: r.action, entryId: r.entryId ?? '', number: r.number ?? '', hash: r.hash ?? '', detail: r.detail ?? '',
    prev: last ? last.rec : '',
  }
  return { ...nb, audit: [...nb.audit, { ...base, rec: recordHash(base) }], modified: base.time }
}

// ------------------------------------------------------------------ small helpers

/** Every sample an entry is linked to: by hand, or with an @mention in its text. */
export function linkedSamples(e: Entry): string[] {
  return [...new Set([...e.samples, ...docMentions(e.content)])]
}

export const getEntry = (nb: Notebook, id: string): Entry | undefined => nb.entries.find((e) => e.id === id)
export const getProject = (nb: Notebook, id: string): Project | undefined => nb.projects.find((p) => p.id === id)
export const getSample = (nb: Notebook, id: string): Sample | undefined => nb.samples.find((s) => s.id === id)

/** The experiment number of the next entry started in a project in a year: PROJ-YYYY-NNN. */
export function nextExperiment(nb: Notebook, projectId: string, year: number): string {
  const project = getProject(nb, projectId)
  const code = project?.code ?? 'EXP'
  const prefix = `${code}-${year}-`
  let max = 0
  for (const e of nb.entries) {
    if (e.experiment.startsWith(prefix)) max = Math.max(max, Number(e.experiment.slice(prefix.length)) || 0)
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

/** Entry display name: "ASP-2026-001 · Aspirin synthesis". */
export const entryLabel = (e: Entry): string => `${e.experiment} · ${e.title || 'Untitled'}`

export function isAmended(e: Entry): boolean {
  return e.addenda.length > 0
}

// ------------------------------------------------------------------ the file

export function emptyNotebook(id: string, title: string, owner: string, created: string): Notebook {
  return {
    format: FORMAT, version: VERSION, id, title, description: '', owner, created, modified: created,
    settings: { samplePrefix: 'S', sampleDigits: 4 }, projects: [], entries: [], samples: [], inventory: [], savedSearches: [], instruments: [], audit: [],
  }
}

/** The .keln text: stable key order, one space of indent (readable in a Git diff). */
export function serializeKeln(nb: Notebook): string {
  return JSON.stringify(nb, null, 1) + '\n'
}

const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])
const str = (x: unknown, d = ''): string => (typeof x === 'string' ? x : d)

function normaliseEntry(raw: Partial<Entry>): Entry {
  return {
    id: str(raw.id), projectId: str(raw.projectId), experiment: str(raw.experiment), title: str(raw.title), date: str(raw.date), author: str(raw.author),
    tags: arr<string>(raw.tags), status: raw.status === 'signed' || raw.status === 'witnessed' ? raw.status : 'draft', favourite: !!raw.favourite,
    content: raw.content && typeof raw.content === 'object' && (raw.content as PMNode).type === 'doc' ? raw.content : emptyDoc(),
    attachments: arr<Attachment>(raw.attachments), links: arr<EntryLink>(raw.links), samples: arr<string>(raw.samples), template: str(raw.template),
    created: str(raw.created), modified: str(raw.modified), signature: raw.signature ?? null, witness: raw.witness ?? null, addenda: arr<Addendum>(raw.addenda),
  }
}

/** Reads .keln text. Throws KelnError with a plain message for anything that is not a notebook. */
export function parseKeln(text: string): Notebook {
  let raw: Partial<Notebook>
  try {
    raw = JSON.parse(text) as Partial<Notebook>
  } catch {
    throw new KelnError('This file is not a kELN notebook (it is not valid JSON).')
  }
  if (!raw || raw.format !== FORMAT) throw new KelnError('This file is not a kELN notebook (the format field is missing).')
  if (typeof raw.version === 'number' && raw.version > VERSION) throw new KelnError(`This notebook was written by a newer kELN (version ${raw.version}); this one reads version ${VERSION}.`)
  return {
    format: FORMAT, version: VERSION, id: str(raw.id), title: str(raw.title, 'Notebook'), description: str(raw.description), owner: str(raw.owner), created: str(raw.created), modified: str(raw.modified),
    settings: { samplePrefix: str(raw.settings?.samplePrefix, 'S') || 'S', sampleDigits: Math.max(1, Math.min(8, Number(raw.settings?.sampleDigits) || 4)) },
    projects: arr<Project>(raw.projects), entries: arr<Partial<Entry>>(raw.entries).map(normaliseEntry), samples: arr<Sample>(raw.samples),
    inventory: arr<InventoryItem>(raw.inventory), savedSearches: arr<SavedSearch>(raw.savedSearches), instruments: arr<string>(raw.instruments), audit: arr<AuditRecord>(raw.audit),
  }
}
