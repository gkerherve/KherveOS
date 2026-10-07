// KherveRef's ties to the rest of KherveOS: online lookups through the
// KherveOS server (/api/refs, server/kherveos_server/refs.py) and reading
// PDFs with the PDF service.

import { api, ApiError } from '@/os/server'
import { openPdf } from '@/os/services/pdf'
import { fromCsl } from './csl'
import { analysePdf, largestText, type IdKind, type PdfInfo } from './ids'
import type { Entry } from './model'

/** The service has no such record (404), or the identifier is not one (400). */
export class NotFoundError extends Error {}
/** No answer: offline, server down, timeout. The reference can still be added to check later. */
export class NetworkError extends Error {}

interface LookupAnswer {
  kind: string
  id: string
  source: string
  csl: Record<string, unknown> | null
  arxiv?: string
}

function toEntry(a: LookupAnswer, kind: string): Entry {
  const e = fromCsl(a.csl)
  e.key = ''
  if (kind === 'doi' && !e.doi) e.doi = a.id
  if (kind === 'isbn' && !e.isbn) e.isbn = a.id
  if (a.arxiv) {
    e.eprint = a.arxiv
    e.eprinttype = 'arxiv'
    if (!e.url && e.type === 'unpublished') e.url = `https://arxiv.org/abs/${a.arxiv}`
  }
  return e
}

async function call(path: string, query: Record<string, string>): Promise<LookupAnswer> {
  try {
    return await api<LookupAnswer>(path, { query })
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) throw new NotFoundError(e.message)
    throw new NetworkError(e instanceof Error ? e.message : String(e))
  }
}

/** The full record for a DOI, arXiv id or ISBN. */
export async function lookupId(kind: IdKind, id: string): Promise<{ entry: Entry; source: string }> {
  const path = kind === 'doi' ? '/refs/doi' : kind === 'arxiv' ? '/refs/arxiv' : '/refs/isbn'
  const a = await call(path, kind === 'doi' ? { doi: id } : kind === 'isbn' ? { isbn: id } : { id })
  if (!a.csl) throw new NotFoundError(`No record for ${id}`)
  return { entry: toEntry(a, kind), source: a.source }
}

/** The Crossref record whose title matches almost exactly, or null. */
export async function searchTitle(title: string, author = ''): Promise<Entry | null> {
  const a = await call('/refs/search', { title, author })
  return a.csl ? toEntry(a, 'title') : null
}

/** What a PDF says about itself: DOI / arXiv id / ISBN, else a title, authors and year guessed from it. */
export async function inspectPdf(data: Uint8Array): Promise<PdfInfo> {
  const pdf = await openPdf(data)
  try {
    let text = ''
    for (let p = 0; p < Math.min(2, pdf.pageCount); p++) text += (await pdf.pageText(p)) + '\n'
    let bigTitle = ''
    if (pdf.pageCount) {
      const [words, size] = await Promise.all([pdf.pageWords(0), pdf.pageSize(0)])
      bigTitle = largestText(words, size.height)
    }
    return analysePdf({ meta: pdf.metadata ?? {}, text, pages: pdf.pageCount, bigTitle })
  } finally {
    pdf.close()
  }
}
