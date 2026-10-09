// AI tools of kELN (the manifest is src/os/ai/manifests/keln.ts). Written against a small set of hooks the window
// provides, so the logic can be tested without a browser. Signing, witnessing and amending are deliberately NOT
// available: a signature is a person's act.

import type { useAppTools } from '@/os/ai/appTools'
import { markdownToDoc } from './doc.ts'
import { asUser, KelnError, parseKeln, serializeKeln, systemCtx, type Ctx, type Notebook } from './model.ts'
import { addEntry } from './notebook.ts'
import { entrySummary } from './render.ts'
import { searchEntries } from './search.ts'
import { TEMPLATES, getTemplate, instantiateTemplate } from './templates.ts'

type Tools = Parameters<typeof useAppTools>[1]

export interface ExampleRef {
  title: string
  file: string
  path: string
  group?: string
  description?: string
}

export interface Hooks {
  state(): { notebook: Notebook | null; path: string | null; dirty: boolean; selected?: string | null }
  /** Puts a changed notebook in the window; `saved` when it was written to its file already. */
  apply(nb: Notebook, saved: boolean): void
  readFile(path: string): Promise<string>
  writeFile(path: string, text: string): Promise<void>
  user(): string
  examples(): ExampleRef[]
  openExample(path: string): Promise<void>
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function findProject(nb: Notebook, wanted: string): string {
  const w = wanted.toLowerCase()
  const hit = nb.projects.find((p) => p.code.toLowerCase() === w || p.name.toLowerCase() === w || p.id === wanted) ?? (w ? nb.projects.find((p) => p.name.toLowerCase().includes(w)) : undefined)
  if (hit) return hit.id
  if (!w && nb.projects.length === 1) return nb.projects[0].id
  throw new KelnError(nb.projects.length ? `Which project? Use one of: ${nb.projects.map((p) => `${p.code} (${p.name})`).join(', ')}.` : 'This notebook has no project yet; create one in kELN first.')
}

function findTemplate(wanted: string) {
  if (!wanted) return getTemplate('blank')!
  const w = wanted.toLowerCase()
  const t = TEMPLATES.find((x) => x.id === w || x.name.toLowerCase() === w) ?? TEMPLATES.find((x) => x.name.toLowerCase().includes(w) || x.id.includes(w))
  if (!t) throw new KelnError(`Unknown template “${wanted}”. Templates: ${TEMPLATES.map((x) => x.id).join(', ')}.`)
  return t
}

function findExample(list: ExampleRef[], id: string): ExampleRef | null {
  const w = id.toLowerCase().trim()
  const n = /^\d+$/.test(w) ? Number(w) : 0
  return (n ? list[n - 1] : undefined) ?? list.find((e) => e.file.toLowerCase() === w || e.title.toLowerCase() === w) ?? list.find((e) => e.title.toLowerCase().includes(w) || e.file.toLowerCase().includes(w)) ?? null
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function kelnTools(h: Hooks): Tools {
  /** The notebook a call is about: the open one, or the file named by `path`. */
  async function target(path: string): Promise<{ nb: Notebook; path: string | null; open: boolean }> {
    const s = h.state()
    if (!path || path === s.path) {
      if (!s.notebook) throw new KelnError('No notebook is open in kELN. Open one, or pass the path of a .keln file.')
      return { nb: s.notebook, path: s.path, open: true }
    }
    try {
      return { nb: parseKeln(await h.readFile(path)), path, open: false }
    } catch (e) {
      throw new KelnError(`Could not read ${path}: ${msg(e)}`)
    }
  }

  return {
    get_state: async () => {
      const s = h.state()
      const nb = s.notebook
      if (!nb) return { open: false, hint: 'No notebook is open. Use load_example to open an example, or ask the user to open or create a .keln notebook.', templates: TEMPLATES.map((t) => t.id) }
      const selected = s.selected ? nb.entries.find((e) => e.id === s.selected) : undefined
      return {
        open: true, title: nb.title, path: s.path, unsaved: s.dirty, owner: nb.owner, entries: nb.entries.length, samples: nb.samples.length, signed: nb.entries.filter((e) => e.status !== 'draft').length,
        projects: nb.projects.map((p) => ({ code: p.code, name: p.name })), selectedEntry: selected ? entrySummary(nb, selected) : null,
        recent: [...nb.entries].sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 5).map((e) => entrySummary(nb, e)), templates: TEMPLATES.map((t) => t.id),
        note: 'Signing, witnessing and amending are done by people in kELN; the AI can only add drafts.',
      }
    },

    add_entry: async (a, ctx) => {
      const title = text(a.title)
      if (!title) throw new KelnError('Give the entry a title.')
      const t = await target(text(a.path))
      const tpl = findTemplate(text(a.template))
      const projectId = findProject(t.nb, text(a.project))
      const project = t.nb.projects.find((p) => p.id === projectId)!
      const where = t.path ?? '(unsaved notebook)'
      const ok = await ctx.confirm(`Add a draft entry “${title}” to ${t.nb.title}`, `Project ${project.code}, template ${tpl.name}. It will be written to ${where}.`)
      if (!ok) throw new KelnError('The user declined to add the entry.')
      const inst = instantiateTemplate(tpl)
      let content = inst.content
      const body = text(a.text)
      if (body) content = { ...content, content: [...(content.content ?? []).filter((n) => !(n.type === 'paragraph' && !n.content?.length)), ...(markdownToDoc(body).content ?? [])] }
      const tags = text(a.tags) ? text(a.tags).split(/[,;]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean) : inst.tags
      const who = h.user() || t.nb.owner || 'user'
      const c: Ctx = asUser(systemCtx(who), `${who} (via ${ctx.caller})`)
      const r = addEntry(t.nb, { projectId, title, content, tags, template: inst.template, links: inst.links, author: who }, c)
      let saved = false
      if (t.path) {
        await h.writeFile(t.path, serializeKeln(r.nb))
        saved = true
      }
      if (t.open) h.apply(r.nb, saved)
      return { id: r.entry.id, number: r.entry.experiment, title: r.entry.title, status: 'draft', project: project.code, template: tpl.id, tags, path: t.path, saved, note: 'A draft: a person reviews, edits and signs it in kELN.' }
    },

    search: async (a) => {
      const t = await target(text(a.path))
      const hits = searchEntries(t.nb, text(a.query), {
        ...(text(a.project) ? { project: text(a.project) } : {}), ...(text(a.tag) ? { tag: text(a.tag) } : {}), ...(text(a.status) ? { status: text(a.status) as 'draft' } : {}), ...(text(a.from) ? { from: text(a.from) } : {}),
      })
      return {
        notebook: t.nb.title, count: hits.length,
        entries: hits.slice(0, 20).map((x) => ({ id: x.entry.id, number: x.entry.experiment, title: x.entry.title, date: x.entry.date.slice(0, 10), status: x.entry.status, tags: x.entry.tags, snippet: x.snippet })),
        note: hits.length > 20 ? 'Showing the first 20.' : undefined,
      }
    },

    load_example: async (a) => {
      const list = h.examples()
      const id = text(a.id)
      if (!id) return { examples: list.map((e, i) => ({ id: i + 1, title: e.title, group: e.group, description: e.description })) }
      const ex = findExample(list, id)
      if (!ex) throw new KelnError(`No example matches “${id}”. Call load_example without an id to list them.`)
      await h.openExample(ex.path)
      return { opened: ex.title, path: ex.path }
    },
  }
}
