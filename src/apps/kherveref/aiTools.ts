// KherveRef's AI tools (kherveref_search, _add_by_doi, _export_bibtex): what
// KherveAI and MCP clients can do with the open library. Their names, arguments
// and descriptions are in src/os/ai/appManifest.ts; KherveRef.tsx registers
// these with useAppTools.

import { fs } from '@/os'
import { pretty } from '@/os/path'
import { drivePath } from '@/os/ai/tools'
import { clipText, type AppTools } from '@/os/ai/appTools'
import { toBibtex, type Dialect } from './bibtex'
import { splitIdentifiers } from './ids'
import { Importer, type Services } from './importer'
import type { Library } from './library'
import { authorText, container, matchesSearch, year, type Entry } from './model'

type Args = Record<string, unknown>

const optText = (a: Args, k: string) => (typeof a[k] === 'string' && (a[k] as string).trim() ? (a[k] as string).trim() : undefined)

export interface AiHost {
  lib(): Library | null
  services: Services
  /** The library changed: refresh the window, select these keys. */
  changed(select?: string[]): void
}

function needLib(host: AiHost): Library {
  const lib = host.lib()
  if (!lib) throw new Error('kRef has no library open yet. Try again in a moment.')
  return lib
}

function collectionId(lib: Library, name: string): string | undefined {
  const n = name.trim().toLowerCase()
  return lib.collections.find((c) => c.name.toLowerCase() === n)?.id
}

function brief(e: Entry) {
  return {
    key: e.key,
    authors: authorText(e, 3),
    year: year(e),
    title: e.title,
    ...(container(e) && { journal: container(e) }),
    ...(e.doi && { doi: e.doi }),
    ...(e.files.length > 0 && { pdf: true }),
    ...(e.needs_review && { needs_checking: true }),
  }
}

export function makeAiTools(host: AiHost): AppTools {
  return {
    search: async (a: Args) => {
      const lib = needLib(host)
      const query = optText(a, 'query') ?? ''
      const colName = optText(a, 'collection')
      let scope: Set<string> | null = null
      if (colName) {
        const id = collectionId(lib, colName)
        if (!id) throw new Error(`There is no collection "${colName}". The collections are: ${lib.collections.map((c) => c.name).join(', ') || 'none'}.`)
        scope = lib.descendants(id)
      }
      const limit = Math.max(1, Math.min(200, Number(a.limit) || 25))
      const hits = [...lib.entries.values()]
        .filter((e) => (!scope || e.collections.some((c) => scope.has(c))) && matchesSearch(e, query))
        .sort((x, y) => (year(y) || '0').localeCompare(year(x) || '0') || x.key.localeCompare(y.key))
      return { total: hits.length, shown: Math.min(limit, hits.length), references: hits.slice(0, limit).map(brief) }
    },

    add_by_doi: async (a: Args) => {
      const lib = needLib(host)
      const { ids, unknown } = splitIdentifiers(String(a.doi ?? ''))
      if (!ids.length) throw new Error(`"${String(a.doi ?? '')}" holds no DOI, arXiv id or ISBN. A DOI looks like 10.1038/nphys1170.`)
      if (ids.length > 50) throw new Error('At most 50 at a time, please.')
      let collection = ''
      const colName = optText(a, 'collection')
      if (colName) {
        collection = collectionId(lib, colName) ?? ''
        if (!collection) {
          collection = lib.newCollectionId()
          lib.collections.push({ id: collection, name: colName, parent: '' })
          await lib.saveCollections()
        }
      }
      const imp = new Importer(lib, host.services, { collection })
      for (const [kind, id] of ids) await imp.addIdentifier(kind, id)
      await imp.finish()
      host.changed(imp.keys)
      return {
        summary: imp.headline(),
        results: imp.outcomes.map((o) => ({
          id: o.source,
          result: o.status === 'review' ? 'added, needs checking' : o.status,
          ...(o.key && { key: o.key }),
          ...(o.message && { note: o.message }),
          ...(o.key && lib.entries.get(o.key) && { title: lib.entries.get(o.key)!.title }),
        })),
        ...(unknown.length > 0 && { not_identifiers: unknown }),
      }
    },

    export_bibtex: async (a: Args, ctx) => {
      const lib = needLib(host)
      const dialect: Dialect = a.dialect === 'bibtex' ? 'bibtex' : 'biblatex'
      let entries = [...lib.entries.values()]
      if (Array.isArray(a.keys) && a.keys.length) {
        const wanted = a.keys.map(String)
        const missing = wanted.filter((k) => !lib.entries.has(k))
        if (missing.length) throw new Error(`No reference with key ${missing.map((k) => `"${k}"`).join(', ')}. Use kherveref_search to find keys.`)
        entries = wanted.map((k) => lib.entries.get(k)!)
      }
      const query = optText(a, 'query')
      if (query) entries = entries.filter((e) => matchesSearch(e, query))
      if (!entries.length) throw new Error('No references match: nothing to export.')
      const text = toBibtex(entries, dialect)
      const target = optText(a, 'path')
      if (!target) return { count: entries.length, dialect, bibtex: clipText(text, 12_000) }
      let p = drivePath(target)
      if (fs.isDir(p)) throw new Error(`"${target}" is a folder: add a file name, e.g. "${target.replace(/\/$/, '')}/references.bib".`)
      if (!/\.(bib|bibtex|txt)$/i.test(p)) p += '.bib'
      if (fs.exists(p) && !(await ctx.confirm(`replace ${pretty(p)}`, `${ctx.caller} wants to export ${entries.length} references over it.`)))
        throw new Error('The user did not allow replacing that file.')
      await fs.writeText(p, text, { mkdirs: true })
      return { written: pretty(p), count: entries.length, dialect }
    },
  }
}
