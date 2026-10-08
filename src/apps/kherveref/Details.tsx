// The details pane: edits one reference (the desktop's editor.py). Fields
// follow the reference type; anything filled in always shows. Changes are
// saved when a field loses focus (or with Save).

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookOpen, Copy, ExternalLink, FileText, Paperclip, PenLine, RefreshCw, Trash2, X } from 'lucide-react'
import { os } from '@/os'
import { entryToBibtex } from './bibtex'
import { formatReference, STYLES } from './cite'
import type { Collection } from './library'
import { cloneEntry, ENTRY_TYPES, parseNames, personDisplay, toDict, type Entry, type Person } from './model'

type FieldName =
  | 'title' | 'subtitle' | 'authors' | 'editors' | 'date' | 'journal' | 'booktitle' | 'publisher' | 'institution' | 'thesis_type' | 'volume'
  | 'number' | 'pages' | 'edition' | 'series' | 'location' | 'doi' | 'url' | 'isbn' | 'issn' | 'eprint' | 'language' | 'keywords' | 'note'
  | 'abstract' | 'notes'

const COMMON: FieldName[] = ['title', 'authors', 'date', 'doi', 'url']
const BY_TYPE: Record<string, FieldName[]> = {
  article: ['journal', 'volume', 'number', 'pages', 'issn', 'eprint'],
  inproceedings: ['booktitle', 'editors', 'pages', 'publisher', 'location', 'series', 'volume', 'institution'],
  book: ['subtitle', 'editors', 'publisher', 'location', 'edition', 'series', 'volume', 'isbn'],
  inbook: ['booktitle', 'editors', 'publisher', 'location', 'pages', 'edition', 'isbn'],
  incollection: ['booktitle', 'editors', 'publisher', 'location', 'pages', 'isbn'],
  thesis: ['thesis_type', 'institution', 'location'],
  report: ['institution', 'number', 'location'],
  online: ['institution'],
  dataset: ['publisher', 'edition'],
  software: ['publisher', 'edition'],
  patent: ['number', 'location', 'institution'],
  unpublished: ['eprint', 'institution'],
  misc: ['publisher', 'institution', 'eprint', 'isbn'],
}
const LABELS: Record<FieldName, string> = {
  title: 'Title', subtitle: 'Subtitle', authors: 'Authors', editors: 'Editors', date: 'Date', journal: 'Journal',
  booktitle: 'Book / proceedings', publisher: 'Publisher', institution: 'Institution', volume: 'Volume', number: 'Number', pages: 'Pages',
  edition: 'Edition', series: 'Series', location: 'Place', doi: 'DOI', url: 'URL', isbn: 'ISBN', issn: 'ISSN', eprint: 'arXiv id',
  thesis_type: 'Thesis type', keywords: 'Tags', abstract: 'Abstract', note: 'Note', language: 'Language', notes: 'Notes',
}
const ORDER: FieldName[] = [
  'title', 'subtitle', 'authors', 'editors', 'date', 'journal', 'booktitle', 'publisher', 'institution', 'thesis_type', 'volume', 'number',
  'pages', 'edition', 'series', 'location', 'doi', 'url', 'isbn', 'issn', 'eprint', 'language', 'keywords', 'note', 'abstract',
]
const ROWS: Partial<Record<FieldName, number>> = { title: 2, authors: 4, editors: 2, abstract: 5, note: 2 }
const PLACEHOLDERS: Partial<Record<FieldName, string>> = {
  authors: 'One per line: Family, Given', editors: 'One per line: Family, Given', date: '2020, 2020-05 or 2020-05-17',
  keywords: 'Comma-separated', doi: '10.1038/…',
}

const namesText = (people: Person[]) => people.map((p) => (p.literal ? `{${p.literal}}` : personDisplay(p))).join('\n')

function fieldText(e: Entry, f: FieldName): string {
  if (f === 'authors') return namesText(e.authors)
  if (f === 'editors') return namesText(e.editors)
  if (f === 'keywords') return e.keywords.join(', ')
  return e[f]
}

function setField(e: Entry, f: FieldName, text: string) {
  if (f === 'authors') e.authors = parseNames(text)
  else if (f === 'editors') e.editors = parseNames(text)
  else if (f === 'keywords') e.keywords = text.split(/[,;]/).map((k) => k.trim()).filter(Boolean)
  else if (f === 'notes') e.notes = text
  else if (f === 'title' || f === 'abstract' || f === 'note') e[f] = text.replace(/\s*\n\s*/g, f === 'title' ? ' ' : '\n').trimEnd()
  else e[f] = text.trim()
  if (f === 'eprint' && e.eprint && !e.eprinttype) e.eprinttype = 'arxiv'
}

export interface DetailsProps {
  entry: Entry | null
  /** How many references are selected (more than one: a summary instead of the form). */
  selectedCount: number
  collections: Collection[]
  style: string
  onSave(e: Entry): void
  onLookup(e: Entry): void
  onOpenFile(e: Entry, index: number): void
  onAttach(e: Entry): void
  onRemoveFile(e: Entry, index: number): void
  onRenameKey(e: Entry): void
  onCopy(kind: 'citation' | 'reference' | 'cite' | 'bibtex'): void
  onSetStyle(style: string): void
  onDeleteSelected(): void
}

export function Details(props: DetailsProps) {
  const { entry, collections, style } = props
  const texts = useRef<Partial<Record<FieldName, string>>>({})
  const [, rerender] = useState(0)
  const [showAll, setShowAll] = useState(false)

  // A fresh copy of the stored reference whenever another one is selected or it was saved / changed on disk.
  const stamp = entry ? `${entry.key}|${entry.modified}` : ''
  const fresh = () => ({ stamp, draft: entry ? cloneEntry(entry) : null, origin: entry ? JSON.stringify(toDict(entry)) : '' })
  const [held, setHeld] = useState(fresh)
  let cur = held
  if (held.stamp !== stamp) {
    cur = fresh()
    // Another reference: forget the edits. The same one just saved: keep what is being typed in another field.
    if (!cur.draft || held.draft?.key !== cur.draft.key) texts.current = {}
    else for (const [f, v] of Object.entries(texts.current)) if (v === fieldText(cur.draft, f as FieldName)) delete texts.current[f as FieldName]
    setHeld(cur)
  }
  const draft = cur.draft
  const origin = cur.origin

  const visible = useMemo(() => {
    if (!draft) return []
    const want = new Set<FieldName>([...COMMON, ...(BY_TYPE[draft.type] ?? []), 'keywords', 'note', 'abstract'])
    return ORDER.filter((f) => showAll || want.has(f) || fieldText(draft, f))
  }, [draft, showAll])

  if (props.selectedCount > 1) {
    return (
      <div className="kr-details kr-details-empty">
        <BookOpen size={28} />
        <p>
          <b>{props.selectedCount} references selected.</b>
        </p>
        <div className="kr-row-buttons">
          <button className="k-btn small" onClick={() => props.onCopy('citation')}>
            Copy citation
          </button>
          <button className="k-btn small" onClick={() => props.onCopy('bibtex')}>
            Copy BibTeX
          </button>
          <button className="k-btn small" onClick={() => props.onCopy('cite')}>
            Copy \cite
          </button>
          <button className="k-btn small danger" onClick={props.onDeleteSelected}>
            Delete…
          </button>
        </div>
      </div>
    )
  }
  if (!entry || !draft) {
    return (
      <div className="kr-details kr-details-empty">
        <BookOpen size={28} />
        <p>Select a reference, or drop PDFs, .bib files or DOIs onto the window to add some.</p>
      </div>
    )
  }

  const valueOf = (f: FieldName) => texts.current[f] ?? fieldText(draft, f)
  const change = (f: FieldName, v: string) => {
    texts.current[f] = v
    rerender((n) => n + 1)
  }
  const dirty = () => {
    const d = cloneEntry(draft)
    for (const [f, v] of Object.entries(texts.current)) setField(d, f as FieldName, v!)
    return JSON.stringify(toDict(d)) !== origin ? d : null
  }
  const commit = () => {
    const d = dirty()
    if (d) props.onSave(d)
  }
  const setNow = (fn: (d: Entry) => void) => {
    const d = cloneEntry(draft)
    for (const [f, v] of Object.entries(texts.current)) setField(d, f as FieldName, v!)
    fn(d)
    props.onSave(d)
  }

  const link = (f: FieldName) => {
    const v = valueOf(f).trim()
    if (!v) return null
    const url = f === 'doi' ? `https://doi.org/${v}` : f === 'eprint' ? `https://arxiv.org/abs/${v}` : f === 'url' && /^https?:\/\//i.test(v) ? v : null
    if (!url) return null
    return (
      <button className="k-icon-btn kr-field-link" title={`Open ${url}`} onClick={() => os.openUrl(url)}>
        <ExternalLink size={14} />
      </button>
    )
  }

  const input = (f: FieldName) => {
    if (f === 'thesis_type') {
      return (
        <select className="k-input" value={draft.thesis_type} onChange={(ev) => setNow((d) => (d.thesis_type = ev.target.value))}>
          <option value="">—</option>
          <option value="phd">PhD thesis</option>
          <option value="master">Master's thesis</option>
          {draft.thesis_type && !['phd', 'master'].includes(draft.thesis_type) && <option value={draft.thesis_type}>{draft.thesis_type}</option>}
        </select>
      )
    }
    const rows = ROWS[f]
    const common = {
      className: 'k-input',
      value: valueOf(f),
      placeholder: PLACEHOLDERS[f],
      spellCheck: f === 'title' || f === 'abstract' || f === 'note',
      onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(f, ev.target.value),
      onBlur: commit,
    }
    return rows ? (
      <textarea {...common} rows={rows} />
    ) : (
      <input {...common} onKeyDown={(ev) => ev.key === 'Enter' && (ev.currentTarget as HTMLInputElement).blur()} />
    )
  }

  const preview = formatReference(draft, style)

  return (
    <div className="kr-details" key={entry.key}>
      <div className="kr-keyrow">
        <code className="kr-key" title="The citation key: cite it in LaTeX as \cite{key}">
          {draft.key}
        </code>
        <button className="k-icon-btn" title="Rename the key…" onClick={() => props.onRenameKey(entry)}>
          <PenLine size={14} />
        </button>
        <button className="k-icon-btn" title="Copy \cite{key}" onClick={() => props.onCopy('cite')}>
          <Copy size={14} />
        </button>
        <span className="kr-spacer" />
        <button className="k-btn small" title="Look the details up again online (DOI, arXiv, ISBN or the title)" onClick={() => props.onLookup(entry)}>
          <RefreshCw size={13} /> Look up
        </button>
      </div>

      {draft.needs_review && (
        <div className="kr-review">
          <AlertTriangle size={14} />
          <span>Needs checking: these details were guessed.</span>
          <button className="k-link-btn" onClick={() => setNow((d) => (d.needs_review = false))}>
            Mark as checked
          </button>
        </div>
      )}

      <div className="kr-form">
        <label className="kr-label">Type</label>
        <select className="k-input" value={draft.type} onChange={(ev) => setNow((d) => (d.type = ev.target.value))}>
          {Object.entries(ENTRY_TYPES).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
          {!(draft.type in ENTRY_TYPES) && <option value={draft.type}>{draft.type}</option>}
        </select>
        {visible.map((f) => (
          <div className="kr-form-row" key={f}>
            <label className="kr-label">{LABELS[f]}</label>
            <div className="kr-field">
              {input(f)}
              {link(f)}
            </div>
          </div>
        ))}
        <span />
        <button className="k-link-btn kr-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer fields' : 'Show all fields'}
        </button>
      </div>

      <section className="kr-section">
        <h4>
          <FileText size={14} /> Files
        </h4>
        {draft.files.length === 0 && <p className="k-muted kr-small">No PDF attached.</p>}
        {draft.files.map((a, i) => (
          <div className="kr-file" key={a.path}>
            <button className="k-link-btn kr-file-name" title="Open in kPDF" onClick={() => props.onOpenFile(entry, i)}>
              {a.path.split('/').pop()}
            </button>
            <button className="k-icon-btn" title="Remove from this reference" onClick={() => props.onRemoveFile(entry, i)}>
              <X size={13} />
            </button>
          </div>
        ))}
        <button className="k-btn small" onClick={() => props.onAttach(entry)}>
          <Paperclip size={13} /> Attach PDF…
        </button>
      </section>

      {collections.length > 0 && (
        <section className="kr-section">
          <h4>Collections</h4>
          <div className="kr-checks">
            {collections.map((c) => (
              <label key={c.id} className="kr-check">
                <input
                  type="checkbox"
                  checked={draft.collections.includes(c.id)}
                  onChange={(ev) =>
                    setNow((d) => {
                      d.collections = ev.target.checked ? [...d.collections, c.id] : d.collections.filter((x) => x !== c.id)
                    })
                  }
                />
                {c.name}
              </label>
            ))}
          </div>
        </section>
      )}

      <section className="kr-section">
        <h4>Notes</h4>
        <textarea
          className="k-input"
          rows={4}
          value={valueOf('notes')}
          onChange={(ev) => change('notes', ev.target.value)}
          onBlur={commit}
          placeholder="Your own notes (not exported)"
        />
      </section>

      <section className="kr-section">
        <h4>
          Citation
          <select className="k-input kr-style" value={style} onChange={(ev) => props.onSetStyle(ev.target.value)} title="Citation style">
            {Object.entries(STYLES).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </h4>
        <div className="kr-preview" dangerouslySetInnerHTML={{ __html: preview }} />
        <div className="kr-row-buttons">
          <button className="k-btn small" onClick={() => props.onCopy('citation')}>
            Copy citation
          </button>
          <button className="k-btn small" onClick={() => props.onCopy('reference')}>
            Copy reference
          </button>
          <button className="k-btn small" onClick={() => props.onCopy('bibtex')}>
            Copy BibTeX
          </button>
        </div>
        <pre className="kr-bib">{entryToBibtex(draft, 'biblatex')}</pre>
      </section>

      <div className="kr-dates k-muted">
        {entry.added && <span>Added {entry.added.slice(0, 10)}</span>}
        {entry.modified && <span>Changed {entry.modified.slice(0, 10)}</span>}
        <button className="k-icon-btn" title="Delete this reference…" onClick={props.onDeleteSelected}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
