// Operations on a notebook (pure, immutable): projects, entries, signing, witnessing, amending, samples and
// inventory. Every change to an entry's record goes through here so the audit chain stays honest.

import { emptyDoc, type PMNode } from './doc.ts'
import {
  addendumHash, appendAudit, dayOf, emptyNotebook, entryHash, getEntry, getProject, getSample, KelnError, LockedError, nextExperiment,
  type Addendum, type Attachment, type Ctx, type Entry, type EntryLink, type InventoryItem, type Notebook, type Project, type Sample, type SavedSearch,
} from './model.ts'

export function createNotebook(ctx: Ctx, opts: { title: string; owner?: string; description?: string; projects?: Array<Pick<Project, 'code' | 'name'> & Partial<Project>>; samplePrefix?: string }): Notebook {
  const t = ctx.now()
  let nb = emptyNotebook(ctx.id('nb'), opts.title, opts.owner ?? ctx.user, t)
  nb = { ...nb, description: opts.description ?? '', settings: { ...nb.settings, samplePrefix: opts.samplePrefix ?? nb.settings.samplePrefix } }
  nb = appendAudit(nb, ctx, { action: 'notebook-created', detail: opts.title })
  for (const p of opts.projects ?? []) nb = addProject(nb, p, ctx)
  return nb
}

export function addProject(nb: Notebook, p: Pick<Project, 'code' | 'name'> & Partial<Project>, ctx: Ctx): Notebook {
  const code = p.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  if (!code) throw new KelnError('A project needs a short code of letters or digits (like ASP).')
  if (nb.projects.some((x) => x.code === code)) throw new KelnError(`There is already a project with the code ${code}.`)
  return { ...nb, projects: [...nb.projects, { id: p.id ?? ctx.id('prj'), code, name: p.name.trim() || code, description: p.description ?? '' }] }
}

export function updateProject(nb: Notebook, id: string, patch: Partial<Pick<Project, 'name' | 'description'>>): Notebook {
  return { ...nb, projects: nb.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }
}

export interface NewEntry {
  projectId: string
  title: string
  content?: PMNode
  tags?: string[]
  template?: string
  /** Join an existing experiment (its number) instead of starting a new one. */
  experiment?: string
  date?: string
  author?: string
  attachments?: Attachment[]
  samples?: string[]
  links?: EntryLink[]
}

/** The local date-time (2026-03-04T09:30:00) of an ISO instant, in the machine's zone. */
export function localStamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function addEntry(nb: Notebook, init: NewEntry, ctx: Ctx): { nb: Notebook; entry: Entry } {
  if (!getProject(nb, init.projectId)) throw new KelnError('Choose a project for the entry (create one first).')
  const t = ctx.now()
  const date = init.date ?? localStamp(t)
  const entry: Entry = {
    id: ctx.id('ent'), projectId: init.projectId, experiment: init.experiment ?? nextExperiment(nb, init.projectId, Number(date.slice(0, 4)) || new Date().getFullYear()),
    title: init.title.trim() || 'Untitled entry', date, author: init.author ?? ctx.user, tags: init.tags ?? [], status: 'draft', favourite: false, content: init.content ?? emptyDoc(),
    attachments: init.attachments ?? [], links: init.links ?? [], samples: init.samples ?? [], template: init.template ?? '', created: t, modified: t, signature: null, witness: null, addenda: [],
  }
  const next = appendAudit({ ...nb, entries: [...nb.entries, entry] }, ctx, { action: 'entry-created', entryId: entry.id, number: entry.experiment, hash: entryHash(entry), detail: entry.title })
  return { nb: next, entry }
}

/** The fields of an entry that a signature covers; changing one of them is an edit. */
export type EditPatch = Partial<Pick<Entry, 'projectId' | 'experiment' | 'title' | 'date' | 'author' | 'tags' | 'content' | 'attachments' | 'links' | 'samples'>>
export type FlagPatch = Partial<Pick<Entry, 'favourite'>>

/** Edits a draft. Signed entries refuse (amend them instead); the favourite flag is not part of the record. */
export function updateEntry(nb: Notebook, id: string, patch: EditPatch & FlagPatch, ctx: Ctx): Notebook {
  const e = getEntry(nb, id)
  if (!e) throw new KelnError('That entry does not exist any more.')
  const { favourite, ...edit } = patch
  const edits = Object.keys(edit).filter((k) => (edit as Record<string, unknown>)[k] !== undefined)
  if (edits.length && e.status !== 'draft') {
    throw new LockedError(`${e.experiment} is ${e.status} and cannot be edited. Add an addendum (Amend) to correct or complete it.`)
  }
  const next: Entry = { ...e, ...edit, ...(favourite !== undefined ? { favourite } : {}), ...(edits.length ? { modified: ctx.now() } : {}) }
  return { ...nb, entries: nb.entries.map((x) => (x.id === id ? next : x)) }
}

/**
 * Appends an 'entry-edited' record when a draft's content hash differs from the last one logged for it. Edits made
 * within `gapMinutes` of the last 'entry-edited' record are not logged again (a log line per keystroke would bury the
 * real events); `force` logs anyway (before signing, closing, exporting).
 */
export function recordEdit(nb: Notebook, id: string, ctx: Ctx, opts: { force?: boolean; gapMinutes?: number } = {}): Notebook {
  const e = getEntry(nb, id)
  if (!e || e.status !== 'draft') return nb
  const hash = entryHash(e)
  const last = [...nb.audit].reverse().find((r) => r.entryId === id)
  if (last && last.hash === hash) return nb
  if (!opts.force && last?.action === 'entry-edited') {
    const gap = (opts.gapMinutes ?? 10) * 60_000
    if (Date.parse(ctx.now()) - Date.parse(last.time) < gap) return nb
  }
  return appendAudit(nb, ctx, { action: 'entry-edited', entryId: id, number: e.experiment, hash, detail: e.title })
}

/** True when a draft has changes the log has not recorded yet. */
export function hasUnloggedEdit(nb: Notebook, id: string): boolean {
  const e = getEntry(nb, id)
  if (!e || e.status !== 'draft') return false
  const last = [...nb.audit].reverse().find((r) => r.entryId === id)
  return !last || last.hash !== entryHash(e)
}

export function signEntry(nb: Notebook, id: string, ctx: Ctx): Notebook {
  const e = getEntry(nb, id)
  if (!e) throw new KelnError('That entry does not exist any more.')
  if (e.status !== 'draft') throw new KelnError(`${e.experiment} is already ${e.status}.`)
  if (!ctx.user.trim()) throw new KelnError('Enter your name in the notebook settings before signing.')
  let next = recordEdit(nb, id, ctx, { force: true })
  const hash = entryHash(e)
  const time = ctx.now()
  next = { ...next, entries: next.entries.map((x) => (x.id === id ? { ...x, status: 'signed', signature: { user: ctx.user, time, hash }, modified: time } : x)) }
  return appendAudit(next, ctx, { action: 'entry-signed', entryId: id, number: e.experiment, hash, detail: `Signed by ${ctx.user}` })
}

export function witnessEntry(nb: Notebook, id: string, witness: string, ctx: Ctx): Notebook {
  const e = getEntry(nb, id)
  if (!e) throw new KelnError('That entry does not exist any more.')
  if (e.status === 'draft') throw new KelnError('Sign the entry first; a witness confirms a signed entry.')
  if (e.status === 'witnessed') throw new KelnError(`${e.experiment} is already witnessed by ${e.witness?.user}.`)
  const name = witness.trim()
  if (!name) throw new KelnError('Enter the witness’s name.')
  if (name.toLowerCase() === (e.signature?.user ?? '').toLowerCase()) throw new KelnError('A witness must be a different person from the signer.')
  const hash = entryHash(e)
  if (hash !== e.signature?.hash) throw new KelnError(`${e.experiment} no longer matches its signature; verify the notebook before witnessing.`)
  const time = ctx.now()
  const next = { ...nb, entries: nb.entries.map((x) => (x.id === id ? { ...x, status: 'witnessed' as const, witness: { user: name, time, hash }, modified: time } : x)) }
  return appendAudit(next, ctx, { action: 'entry-witnessed', entryId: id, number: e.experiment, hash, detail: `Witnessed by ${name}`, user: name })
}

/** An addendum below a signed entry; the signed record itself is never touched. */
export function amendEntry(nb: Notebook, id: string, content: PMNode, reason: string, ctx: Ctx): Notebook {
  const e = getEntry(nb, id)
  if (!e) throw new KelnError('That entry does not exist any more.')
  if (e.status === 'draft') throw new KelnError('A draft can simply be edited; amendments are for signed entries.')
  if (!reason.trim()) throw new KelnError('Say why the entry is amended.')
  const base: Omit<Addendum, 'hash'> = { id: ctx.id('add'), time: ctx.now(), author: ctx.user, reason: reason.trim(), content }
  const addendum: Addendum = { ...base, hash: addendumHash(e.signature?.hash ?? entryHash(e), base) }
  const next = { ...nb, entries: nb.entries.map((x) => (x.id === id ? { ...x, addenda: [...x.addenda, addendum], modified: base.time } : x)) }
  return appendAudit(next, ctx, { action: 'entry-amended', entryId: id, number: e.experiment, hash: addendum.hash, detail: base.reason })
}

export function logExport(nb: Notebook, entryId: string | null, format: string, ctx: Ctx): Notebook {
  if (!entryId) return appendAudit(nb, ctx, { action: 'notebook-exported', detail: format })
  const e = getEntry(nb, entryId)
  if (!e) return nb
  return appendAudit(nb, ctx, { action: 'entry-exported', entryId, number: e.experiment, hash: entryHash(e), detail: format })
}

/** Drafts can be deleted (and the deletion is logged); signed entries cannot. */
export function deleteEntry(nb: Notebook, id: string, ctx: Ctx): Notebook {
  const e = getEntry(nb, id)
  if (!e) return nb
  if (e.status !== 'draft') throw new LockedError(`${e.experiment} is ${e.status}: signed entries are part of the record and cannot be deleted.`)
  const next = { ...nb, entries: nb.entries.filter((x) => x.id !== id) }
  return appendAudit(next, ctx, { action: 'entry-deleted', entryId: id, number: e.experiment, hash: entryHash(e), detail: e.title })
}

/** A new draft with the same content (a "template" from a finished entry): its own number, no signatures. */
export function duplicateEntry(nb: Notebook, id: string, ctx: Ctx, opts: { title?: string; sameExperiment?: boolean } = {}): { nb: Notebook; entry: Entry } {
  const e = getEntry(nb, id)
  if (!e) throw new KelnError('That entry does not exist any more.')
  return addEntry(nb, {
    projectId: e.projectId, title: opts.title ?? `${e.title} (copy)`, content: JSON.parse(JSON.stringify(e.content)) as PMNode, tags: [...e.tags], template: e.template,
    ...(opts.sameExperiment ? { experiment: e.experiment } : {}), attachments: e.attachments.map((a) => ({ ...a })), samples: [...e.samples], links: e.links.map((l) => ({ ...l })),
  }, ctx)
}

// ------------------------------------------------------------------ samples and inventory

export function nextSampleId(nb: Notebook, prefix = nb.settings.samplePrefix, digits = nb.settings.sampleDigits): string {
  const pre = `${prefix}-`
  let max = 0
  for (const s of nb.samples) if (s.id.startsWith(pre)) max = Math.max(max, Number(s.id.slice(pre.length)) || 0)
  return `${prefix}-${String(max + 1).padStart(digits, '0')}`
}

export function addSample(nb: Notebook, init: Partial<Sample> & { name: string }, ctx: Ctx): { nb: Notebook; sample: Sample } {
  const id = init.id ?? nextSampleId(nb)
  if (getSample(nb, id)) throw new KelnError(`There is already a sample ${id}.`)
  const sample: Sample = {
    id, name: init.name.trim(), composition: init.composition ?? '', batch: init.batch ?? '', location: init.location ?? '', made: init.made ?? localStamp(ctx.now()).slice(0, 10),
    parents: init.parents ?? [], status: init.status ?? 'in use', notes: init.notes ?? '', projectId: init.projectId ?? '', author: init.author ?? ctx.user,
  }
  return { nb: { ...nb, samples: [...nb.samples, sample] }, sample }
}

export function updateSample(nb: Notebook, id: string, patch: Partial<Omit<Sample, 'id'>>): Notebook {
  if (patch.parents?.includes(id)) throw new KelnError('A sample cannot be its own parent.')
  if (patch.parents) {
    // no loops: a parent must not descend from this sample
    const children = new Map<string, string[]>()
    for (const s of nb.samples) for (const p of s.parents) children.set(p, [...(children.get(p) ?? []), s.id])
    const below = new Set<string>()
    const stack = [id]
    while (stack.length) for (const c of children.get(stack.pop()!) ?? []) if (!below.has(c)) { below.add(c); stack.push(c) }
    const bad = patch.parents.find((p) => below.has(p))
    if (bad) throw new KelnError(`${bad} is made from ${id}, so it cannot be its parent.`)
  }
  return { ...nb, samples: nb.samples.map((s) => (s.id === id ? { ...s, ...patch } : s)) }
}

export function removeSample(nb: Notebook, id: string): Notebook {
  const used = nb.entries.filter((e) => e.samples.includes(id) || JSON.stringify(e.content).includes(`"id":"${id}"`))
  if (used.length) throw new KelnError(`${id} is used in ${used.length} entr${used.length === 1 ? 'y' : 'ies'} (${used.slice(0, 3).map((e) => e.experiment).join(', ')}); mark it discarded instead.`)
  return { ...nb, samples: nb.samples.filter((s) => s.id !== id).map((s) => ({ ...s, parents: s.parents.filter((p) => p !== id) })) }
}

export function upsertInventory(nb: Notebook, item: InventoryItem): Notebook {
  const exists = nb.inventory.some((i) => i.id === item.id)
  return { ...nb, inventory: exists ? nb.inventory.map((i) => (i.id === item.id ? item : i)) : [...nb.inventory, item] }
}

export function removeInventory(nb: Notebook, id: string): Notebook {
  return { ...nb, inventory: nb.inventory.filter((i) => i.id !== id) }
}

export function addInstrument(nb: Notebook, name: string): Notebook {
  const n = name.trim()
  return n && !nb.instruments.includes(n) ? { ...nb, instruments: [...nb.instruments, n].sort() } : nb
}

export function saveSearch(nb: Notebook, s: SavedSearch): Notebook {
  return { ...nb, savedSearches: [...nb.savedSearches.filter((x) => x.id !== s.id), s] }
}

export function removeSavedSearch(nb: Notebook, id: string): Notebook {
  return { ...nb, savedSearches: nb.savedSearches.filter((s) => s.id !== id) }
}

/** The tags used in the notebook with their counts, most used first. */
export function tagCounts(nb: Notebook): Array<{ tag: string; count: number }> {
  const m = new Map<string, number>()
  for (const e of nb.entries) for (const t of e.tags) m.set(t, (m.get(t) ?? 0) + 1)
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Experiments of a project (by number) with their entries in date order. */
export function experimentsOf(nb: Notebook, projectId: string): Array<{ number: string; entries: Entry[] }> {
  const groups = new Map<string, Entry[]>()
  for (const e of nb.entries.filter((x) => x.projectId === projectId)) groups.set(e.experiment, [...(groups.get(e.experiment) ?? []), e])
  return [...groups]
    .map(([number, entries]) => ({ number, entries: entries.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.number.localeCompare(b.number))
}

export { dayOf }
