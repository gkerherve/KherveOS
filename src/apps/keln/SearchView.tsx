// Search: full text with filters (project, tag, author, date range, status, sample, instrument, favourites).

import { useEffect, useMemo, useRef } from 'react'
import { Save, Search as SearchIcon } from 'lucide-react'
import { docInstruments } from './doc'
import type { Notebook, SearchFilters } from './model'
import { noFilters, searchEntries } from './search'
import { StatusBadge, shortDate } from './ui'

interface Props {
  nb: Notebook
  query: string
  filters: SearchFilters
  onQuery(q: string): void
  onFilters(f: SearchFilters): void
  onOpen(id: string): void
  onSave(): void
  /** Changes when the user asks to search (⌘F): the box takes the focus. */
  focusTick: number
}

export function SearchView({ nb, query, filters, onQuery, onFilters, onOpen, onSave, focusTick }: Props) {
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => { if (focusTick > 0) box.current?.focus() }, [focusTick])
  const hits = useMemo(() => searchEntries(nb, query, filters), [nb, query, filters])
  const authors = useMemo(() => [...new Set(nb.entries.map((e) => e.author).filter(Boolean))].sort(), [nb.entries])
  const instruments = useMemo(() => [...new Set([...nb.instruments, ...nb.entries.flatMap((e) => docInstruments(e.content))])].sort(), [nb])
  const tags = useMemo(() => [...new Set(nb.entries.flatMap((e) => e.tags))].sort(), [nb.entries])
  const set = (patch: Partial<SearchFilters>) => onFilters({ ...filters, ...patch })
  const key = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.ln-hit')]
    const i = rows.indexOf(document.activeElement as HTMLElement)
    if (i < 0 && e.key === 'ArrowUp') return
    e.preventDefault()
    rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }
  return (
    <div className="ln-search">
      <div className="ln-filters">
        <div className="ln-searchbox">
          <SearchIcon size={14} />
          <input className="k-input" ref={box} value={query} placeholder="Search entries (words, “phrases”, tag:x sample:ID instrument:x status:signed)" aria-label="Search" onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector<HTMLElement>('.ln-hit')?.focus() } }} />
        </div>
        <div className="ln-filter-row">
          <select className="k-input" aria-label="Project" value={filters.project ?? ''} onChange={(e) => set({ project: e.target.value || undefined })}><option value="">all projects</option>{nb.projects.map((p) => <option key={p.id} value={p.code}>{p.code} · {p.name}</option>)}</select>
          <select className="k-input" aria-label="Tag" value={filters.tag ?? ''} onChange={(e) => set({ tag: e.target.value || undefined })}><option value="">any tag</option>{tags.map((t) => <option key={t}>{t}</option>)}</select>
          <select className="k-input" aria-label="Author" value={filters.author ?? ''} onChange={(e) => set({ author: e.target.value || undefined })}><option value="">any author</option>{authors.map((t) => <option key={t}>{t}</option>)}</select>
          <select className="k-input" aria-label="Status" value={filters.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as SearchFilters['status'] })}><option value="">any status</option><option value="draft">draft</option><option value="signed">signed</option><option value="witnessed">witnessed</option><option value="amended">amended</option></select>
          <select className="k-input" aria-label="Sample" value={filters.sample ?? ''} onChange={(e) => set({ sample: e.target.value || undefined })}><option value="">any sample</option>{nb.samples.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.name}</option>)}</select>
          <select className="k-input" aria-label="Instrument" value={filters.instrument ?? ''} onChange={(e) => set({ instrument: e.target.value || undefined })}><option value="">any instrument</option>{instruments.map((t) => <option key={t}>{t}</option>)}</select>
          <label className="ln-datef">from <input className="k-input" type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} /></label>
          <label className="ln-datef">to <input className="k-input" type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} /></label>
          <label className="ln-check-label"><input type="checkbox" checked={!!filters.favourite} onChange={(e) => set({ favourite: e.target.checked || undefined })} /> favourites</label>
          {!noFilters(filters) && <button className="k-btn small" onClick={() => onFilters({})}>Clear filters</button>}
          <button className="k-btn small" onClick={onSave} disabled={!query.trim() && noFilters(filters)}><Save size={12} /> Save search</button>
        </div>
      </div>
      <div className="ln-hits" onKeyDown={key} role="list" aria-label={`${hits.length} results`}>
        <div className="ln-hits-count" aria-live="polite">{hits.length} of {nb.entries.length} entries</div>
        {hits.length === 0 && <div className="ln-empty big">Nothing matches. Try fewer words or clear a filter.</div>}
        {hits.map(({ entry: e, snippet }) => (
          <button key={e.id} role="listitem" className="ln-hit" onClick={() => onOpen(e.id)}>
            <span className="ln-hit-title">{e.title} <StatusBadge entry={e} /></span>
            <span className="ln-hit-meta">{e.experiment} · {shortDate(e.date)} · {e.author}{e.tags.length ? ` · ${e.tags.map((t) => '#' + t).join(' ')}` : ''}</span>
            <span className="ln-hit-snip">{snippet}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
