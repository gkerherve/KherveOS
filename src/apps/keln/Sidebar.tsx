// The left tree: Recent and favourites, Projects ▸ Experiments ▸ Entries, saved searches, tags.

import { useMemo, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, FileCheck2, FilePen, FileText, FolderOpen, Hash, Plus, Search, ShieldCheck, Star, X } from 'lucide-react'
import { experimentsOf, tagCounts } from './notebook'
import { recentEntries } from './search'
import type { Entry, Notebook, SavedSearch } from './model'

interface Props {
  nb: Notebook
  selected: string | null
  onSelect(id: string): void
  onNewEntry(projectId?: string, experiment?: string): void
  onNewProject(): void
  onSearch(query: string): void
  onSavedSearch(s: SavedSearch): void
  onDeleteSavedSearch(id: string): void
  onEntryMenu(e: React.MouseEvent, entry: Entry): void
}

function EntryIcon({ e }: { e: Entry }) {
  if (e.status === 'witnessed') return <ShieldCheck size={13} className="ln-ico witnessed" aria-label="Witnessed" />
  if (e.status === 'signed') return <FileCheck2 size={13} className="ln-ico signed" aria-label="Signed" />
  return <FilePen size={13} className="ln-ico" aria-label="Draft" />
}

export function Sidebar({ nb, selected, onSelect, onNewEntry, onNewProject, onSearch, onSavedSearch, onDeleteSavedSearch, onEntryMenu }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const recent = useMemo(() => recentEntries(nb, 5), [nb])
  const favourites = useMemo(() => nb.entries.filter((e) => e.favourite), [nb.entries])
  const tags = useMemo(() => tagCounts(nb), [nb])
  const tree = useMemo(() => nb.projects.map((p) => ({ project: p, experiments: experimentsOf(nb, p.id) })), [nb])

  // the entries in the order they are listed: arrow keys walk through them
  const order = useMemo(() => tree.flatMap((t) => (collapsed.has(`p:${t.project.id}`) ? [] : t.experiments.flatMap((x) => (collapsed.has(`x:${x.number}`) ? [] : x.entries.map((e) => e.id))))), [tree, collapsed])
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input')) return
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = selected ? order.indexOf(selected) : -1
    const next = order[Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      onSelect(next)
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-entry="${CSS.escape(next)}"]`)?.focus())
    }
  }

  const row = (e: Entry, depth: number, tree = false) => (
    <button key={e.id} data-entry={tree ? e.id : undefined} className={`ln-tree-row${selected === e.id ? ' on' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onSelect(e.id)} onContextMenu={(ev) => { ev.preventDefault(); onEntryMenu(ev, e) }}
      title={`${e.experiment} · ${e.title}\n${e.date.slice(0, 16).replace('T', ' ')} · ${e.status}`}>
      <EntryIcon e={e} />
      <span className="ln-tree-label">{e.title || 'Untitled'}</span>
      {e.favourite && <Star size={11} className="ln-fav" fill="currentColor" aria-label="Favourite" />}
    </button>
  )

  return (
    <nav className="ln-side" aria-label="Notebook" onKeyDown={onKey}>
      <div className="ln-side-head">
        <strong title={nb.title}>{nb.title}</strong>
        <button className="k-icon-btn" aria-label="New entry" title="New entry (⌘N)" onClick={() => onNewEntry()}><Plus size={15} /></button>
      </div>
      <div className="ln-side-scroll">
        {recent.length > 0 && (
          <section>
            <h4>Recent</h4>
            {recent.map((e) => row(e, 0))}
          </section>
        )}
        {favourites.length > 0 && (
          <section>
            <h4>Favourites</h4>
            {favourites.map((e) => row(e, 0))}
          </section>
        )}
        <section>
          <h4>Projects <button className="k-icon-btn ln-mini" aria-label="New project" title="New project" onClick={onNewProject}><Plus size={12} /></button></h4>
          {tree.length === 0 && <p className="ln-side-empty">No project yet. Create one to start writing entries.</p>}
          {tree.map(({ project, experiments }) => {
            const pk = `p:${project.id}`
            const open = !collapsed.has(pk)
            return (
              <div key={project.id}>
                <div className="ln-tree-row project">
                  <button className="ln-tree-main" onClick={() => toggle(pk)} aria-expanded={open}>
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<FolderOpen size={13} />
                    <span className="ln-tree-label"><b>{project.code}</b> {project.name}</span>
                  </button>
                  <button className="k-icon-btn ln-mini" aria-label={`New entry in ${project.name}`} title="New entry in this project" onClick={() => onNewEntry(project.id)}><Plus size={12} /></button>
                </div>
                {open && experiments.length === 0 && <p className="ln-side-empty" style={{ paddingLeft: 30 }}>No entries yet.</p>}
                {open && experiments.map((x) => {
                  const xk = `x:${x.number}`
                  const xopen = !collapsed.has(xk)
                  return (
                    <div key={x.number}>
                      <div className="ln-tree-row experiment" style={{ paddingLeft: 22 }}>
                        <button className="ln-tree-main" onClick={() => toggle(xk)} aria-expanded={xopen}>
                          {xopen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<span className="ln-tree-label">{x.number}</span>
                        </button>
                        <button className="k-icon-btn ln-mini" aria-label={`New entry in ${x.number}`} title="Another entry in this experiment" onClick={() => onNewEntry(project.id, x.number)}><Plus size={12} /></button>
                      </div>
                      {xopen && x.entries.map((e) => row(e, 2, true))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </section>
        {nb.savedSearches.length > 0 && (
          <section>
            <h4>Saved searches</h4>
            {nb.savedSearches.map((s) => (
              <div key={s.id} className="ln-tree-row">
                <button className="ln-tree-main" onClick={() => onSavedSearch(s)}><Search size={12} /><span className="ln-tree-label">{s.name}</span></button>
                <button className="k-icon-btn ln-mini" aria-label={`Delete saved search ${s.name}`} onClick={() => onDeleteSavedSearch(s.id)}><X size={11} /></button>
              </div>
            ))}
          </section>
        )}
        {tags.length > 0 && (
          <section>
            <h4>Tags</h4>
            <div className="ln-tagcloud">
              {tags.slice(0, 40).map((t) => <button key={t.tag} className="ln-tag" onClick={() => onSearch(`tag:${t.tag}`)} title={`${t.count} entr${t.count === 1 ? 'y' : 'ies'}`}><Hash size={10} />{t.tag}</button>)}
            </div>
          </section>
        )}
        <div className="ln-side-foot"><FileText size={12} /> {nb.entries.length} entries · {nb.samples.length} samples</div>
      </div>
    </nav>
  )
}
