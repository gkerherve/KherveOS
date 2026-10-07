// Adding references (the desktop's kherveref/importer.py): by DOI / arXiv id /
// ISBN, from PDFs (their DOI, arXiv id or ISBN, else a near-exact Crossref title
// match, else what the PDF says, marked "needs checking"), and from BibTeX /
// BibLaTeX / CSL-JSON text. The same paper is never added twice; a PDF for a
// reference already there is attached to it.
//
// The online lookups and PDF reading are passed in (services.ts in the app),
// so this runs in the Node tests too.

import { parse as parseBibtex } from './bibtex.ts'
import { fromCsl } from './csl.ts'
import { personList, type IdKind, type PdfInfo } from './ids.ts'
import { DuplicateIndex, newEntry, replaceBibliographic, type Entry } from './model.ts'
import type { Library } from './library.ts'
import { sha1Hex } from './sha1.ts'

export interface Services {
  lookupId(kind: IdKind, id: string): Promise<{ entry: Entry; source: string }>
  searchTitle(title: string, author: string): Promise<Entry | null>
  inspectPdf(data: Uint8Array): Promise<PdfInfo>
  /** Offline / server down / timeout, as opposed to "no such record". */
  isNetworkError(e: unknown): boolean
}

export type Status = 'added' | 'review' | 'attached' | 'duplicate' | 'failed'

export interface Outcome {
  source: string
  status: Status
  key: string
  message: string
}

const LABELS: [Status, string][] = [
  ['added', 'added'],
  ['review', 'added, need checking'],
  ['attached', 'PDFs attached to existing references'],
  ['duplicate', 'already in the library'],
  ['failed', 'failed'],
]

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export class Importer {
  lib: Library
  services: Services
  collection: string
  online: boolean
  dups: DuplicateIndex
  outcomes: Outcome[] = []

  constructor(lib: Library, services: Services, opts: { collection?: string; online?: boolean } = {}) {
    this.lib = lib
    this.services = services
    this.collection = opts.collection ?? ''
    this.online = opts.online ?? true
    this.dups = DuplicateIndex.build(lib.entries.values())
  }

  private record(o: Outcome): Outcome {
    this.outcomes.push(o)
    return o
  }

  private existing(e: Entry, sha1 = ''): Entry | null {
    const key = this.dups.find(e, sha1)
    return key ? (this.lib.entries.get(key) ?? null) : null
  }

  private async add(e: Entry, source: string, review: boolean, message = '', pdf?: Uint8Array): Promise<Outcome> {
    if (this.collection && !e.collections.includes(this.collection)) e.collections.push(this.collection)
    e.needs_review = e.needs_review || review
    await this.lib.addEntry(e)
    if (pdf) {
      await this.lib.attachFile(e, pdf, '.pdf')
      await this.lib.saveEntry(e)
    }
    this.dups.add(e)
    return this.record({ source, status: e.needs_review ? 'review' : 'added', key: e.key, message })
  }

  /** Keys of the references added or touched, for selecting them afterwards. */
  get keys(): string[] {
    return [...new Set(this.outcomes.filter((o) => o.key && o.status !== 'failed').map((o) => o.key))]
  }

  get changed(): boolean {
    return this.outcomes.some((o) => o.status === 'added' || o.status === 'review' || o.status === 'attached')
  }

  headline(): string {
    const parts = LABELS.map(([s, label]) => [this.outcomes.filter((o) => o.status === s).length, label] as const)
      .filter(([n]) => n)
      .map(([n, label]) => `${n} ${label}`)
    return parts.join(', ') || 'Nothing to import'
  }

  /** Regenerate library.bib once the batch is done. */
  async finish(): Promise<void> {
    if (this.changed) await this.lib.writeLibraryBib()
  }

  // ---------------------------------------------------------- identifiers

  async addIdentifier(kind: IdKind, id: string): Promise<Outcome> {
    const source = `${kind === 'doi' ? 'DOI' : kind === 'arxiv' ? 'arXiv' : 'ISBN'} ${id}`
    const probe = newEntry(kind === 'doi' ? { doi: id } : kind === 'arxiv' ? { eprint: id, eprinttype: 'arxiv' } : { isbn: id })
    const dup = this.existing(probe)
    if (dup) return this.record({ source, status: 'duplicate', key: dup.key, message: '' })
    if (!this.online) return this.add(probe, source, true, 'added offline: look up the details later')
    let found: { entry: Entry; source: string }
    try {
      found = await this.services.lookupId(kind, id)
    } catch (e) {
      if (this.services.isNetworkError(e)) return this.add(probe, source, true, `lookup failed: ${errText(e)}`)
      return this.record({ source, status: 'failed', key: '', message: errText(e) || 'no record found' })
    }
    const e = found.entry
    if (kind === 'arxiv') {
      e.eprint = id
      e.eprinttype = 'arxiv'
    }
    const again = this.existing(e)
    if (again) return this.record({ source, status: 'duplicate', key: again.key, message: '' })
    return this.add(e, source, false, `from ${found.source}`)
  }

  // ----------------------------------------------------------------- PDFs

  async addPdf(data: Uint8Array, name: string): Promise<Outcome> {
    const sha1 = await sha1Hex(data)
    const same = this.existing(newEntry(), sha1)
    if (same) return this.record({ source: name, status: 'duplicate', key: same.key, message: 'same file already attached' })
    let info: PdfInfo
    try {
      info = await this.services.inspectPdf(data)
    } catch (e) {
      const msg = errText(e)
      return this.record({ source: name, status: 'failed', key: '', message: /password/i.test(msg) ? 'PDF is password protected' : `cannot open PDF: ${msg}` })
    }
    const [entry, review, note] = await this.identify(info, name)
    const dup = this.existing(entry)
    if (dup) {
      if (!dup.files.some((a) => a.path.toLowerCase().endsWith('.pdf'))) {
        await this.lib.attachFile(dup, data, '.pdf')
        await this.lib.saveEntry(dup)
        this.dups.add(dup)
        return this.record({ source: name, status: 'attached', key: dup.key, message: '' })
      }
      return this.record({ source: name, status: 'duplicate', key: dup.key, message: '' })
    }
    return this.add(entry, name, review, note, data)
  }

  /** [entry, needs review, message] for a PDF. */
  private async identify(info: PdfInfo, name: string): Promise<[Entry, boolean, string]> {
    let offline = ''
    if (this.online) {
      for (const [kind, value] of [['doi', info.doi], ['arxiv', info.arxiv], ['isbn', info.isbn]] as [IdKind, string][]) {
        if (!value) continue
        try {
          const { entry } = await this.services.lookupId(kind, value)
          if (kind === 'arxiv') {
            entry.eprint = value
            entry.eprinttype = 'arxiv'
          }
          return [entry, false, `found by ${kind === 'arxiv' ? 'arXiv id' : kind.toUpperCase()} ${value}`]
        } catch (e) {
          if (this.services.isNetworkError(e)) {
            offline = `lookup failed: ${errText(e)}`
            break
          }
        }
      }
      if (info.title && !offline) {
        try {
          const e = await this.services.searchTitle(info.title, info.authors)
          if (e) return [e, false, 'found by title']
        } catch (e) {
          offline = `title search failed: ${errText(e)}`
        }
      }
    }
    const e = newEntry({ type: info.doi || info.arxiv ? 'article' : 'misc' })
    e.title = info.title || name.replace(/\.pdf$/i, '').replace(/_/g, ' ')
    e.authors = info.authors ? personList(info.authors) : []
    e.date = info.year
    e.doi = info.doi
    if (info.arxiv) {
      e.eprint = info.arxiv
      e.eprinttype = 'arxiv'
    }
    e.isbn = info.isbn
    const why =
      offline || (info.hasText ? 'no identifier found; details guessed from the PDF' : 'no text in the PDF (scanned?); please fill in')
    return [e, true, why]
  }

  // ----------------------------------------------------- bibliography text

  /** BibTeX / BibLaTeX, or CSL-JSON (recognised from the text). */
  async importText(text: string, source = 'Pasted text'): Promise<void> {
    const stripped = text.replace(/^[﻿\s]+/, '')
    let entries: Entry[]
    if (stripped.startsWith('[') || stripped.startsWith('{')) {
      let data: unknown
      try {
        data = JSON.parse(stripped)
      } catch (e) {
        this.record({ source, status: 'failed', key: '', message: `not JSON: ${errText(e)}` })
        return
      }
      const items = Array.isArray(data) ? data : ((data as { items?: unknown[] }).items ?? [data])
      entries = items.filter((x) => x && typeof x === 'object').map(fromCsl)
    } else {
      const res = parseBibtex(text)
      for (const w of res.warnings) this.record({ source, status: 'failed', key: '', message: w })
      entries = res.entries
    }
    for (const e of entries) {
      const label = `${source}: ${e.key || e.title.slice(0, 40) || '(untitled)'}`
      const dup = this.existing(e)
      if (dup) this.record({ source: label, status: 'duplicate', key: dup.key, message: '' })
      else await this.add(e, label, !e.title)
    }
  }
}

/** Re-run the lookup for a reference being fixed. Returns a message; throws when nothing is found. */
export async function refreshFromIdentifiers(e: Entry, services: Services): Promise<string> {
  const ids: [IdKind, string][] = [
    ['doi', e.doi],
    ['arxiv', e.eprinttype === 'arxiv' ? e.eprint : ''],
    ['isbn', e.isbn],
  ]
  for (const [kind, value] of ids) {
    if (!value) continue
    const { entry } = await services.lookupId(kind, value)
    replaceBibliographic(e, entry)
    if (kind === 'arxiv') {
      e.eprint = value
      e.eprinttype = 'arxiv'
    }
    e.needs_review = false
    return `Updated from ${kind === 'arxiv' ? 'arXiv' : kind.toUpperCase()} ${value}`
  }
  if (e.title) {
    const found = await services.searchTitle(e.title, e.authors[0]?.family ?? '')
    if (found) {
      replaceBibliographic(e, found)
      e.needs_review = false
      return 'Updated from a Crossref title match'
    }
  }
  throw new Error('No DOI, arXiv id or ISBN, and no exact title match')
}
