// The left column: the whole library, unfiled references, those needing
// checking, the collection tree (drop references or files on a collection to
// file them) and the tags.

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Folder, FolderPlus, Inbox, Library as LibraryIcon, Tag } from 'lucide-react'
import type { Collection } from './library'
import type { Entry } from './model'

export type Scope = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'review' } | { kind: 'collection'; id: string } | { kind: 'tag'; tag: string }

export const KEYS_MIME = 'application/x-kherveref-keys'

export const sameScope = (a: Scope, b: Scope) =>
  a.kind === b.kind && (a.kind !== 'collection' || a.id === (b as typeof a).id) && (a.kind !== 'tag' || a.tag === (b as typeof a).tag)

interface Props {
  entries: Entry[]
  collections: Collection[]
  scope: Scope
  onScope(s: Scope): void
  onNewCollection(parent: string): void
  onCollectionMenu(ev: React.MouseEvent, c: Collection): void
  /** References (by key) or files dropped on a collection. */
  onDropOnCollection(id: string, ev: React.DragEvent): void
}

export function Sidebar({ entries, collections, scope, onScope, onNewCollection, onCollectionMenu, onDropOnCollection }: Props) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [over, setOver] = useState<string | null>(null)
  const [tagsOpen, setTagsOpen] = useState(true)

  const counts = useMemo(() => {
    const review = entries.filter((e) => e.needs_review).length
    const unfiled = entries.filter((e) => !e.collections.length).length
    const tags = new Map<string, number>()
    for (const e of entries) for (const k of e.keywords) tags.set(k, (tags.get(k) ?? 0) + 1)
    const byCol = new Map<string, number>()
    for (const e of entries) for (const c of e.collections) byCol.set(c, (byCol.get(c) ?? 0) + 1)
    return { review, unfiled, tags: [...tags].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })), byCol }
  }, [entries])

  const children = (parent: string) =>
    collections.filter((c) => c.parent === parent || (parent === '' && c.parent && !collections.some((x) => x.id === c.parent))).sort((a, b) => a.name.localeCompare(b.name))

  const item = (s: Scope, icon: React.ReactNode, label: string, count?: number, extra?: Partial<React.HTMLAttributes<HTMLDivElement>>, depth = 0) => (
    <div
      className={`kr-side-item${sameScope(scope, s) ? ' active' : ''}`}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={() => onScope(s)}
      title={label}
      {...extra}
    >
      {icon}
      <span className="kr-side-label">{label}</span>
      {count !== undefined && count > 0 && <span className="kr-count">{count}</span>}
    </div>
  )

  const tree = (parent: string, depth: number): React.ReactNode =>
    children(parent).map((c) => {
      const kids = collections.some((x) => x.parent === c.id)
      const open = !closed.has(c.id)
      return (
        <div key={c.id}>
          {item(
            { kind: 'collection', id: c.id },
            <>
              <span
                className="kr-twisty"
                onClick={(ev) => {
                  ev.stopPropagation()
                  setClosed((s) => {
                    const n = new Set(s)
                    if (n.has(c.id)) n.delete(c.id)
                    else n.add(c.id)
                    return n
                  })
                }}
              >
                {kids ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
              </span>
              <Folder size={14} />
            </>,
            c.name,
            counts.byCol.get(c.id),
            {
              className: `kr-side-item${sameScope(scope, { kind: 'collection', id: c.id }) ? ' active' : ''}${over === c.id ? ' drop' : ''}`,
              onContextMenu: (ev) => {
                ev.preventDefault()
                onCollectionMenu(ev, c)
              },
              onDragOver: (ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                ev.dataTransfer.dropEffect = 'copy'
                setOver(c.id)
              },
              onDragLeave: () => setOver((o) => (o === c.id ? null : o)),
              onDrop: (ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                setOver(null)
                onDropOnCollection(c.id, ev)
              },
            },
            depth,
          )}
          {kids && open && tree(c.id, depth + 1)}
        </div>
      )
    })

  return (
    <nav className="kr-sidebar">
      <div className="kr-side-head">Library</div>
      {item({ kind: 'all' }, <LibraryIcon size={14} />, 'All references', entries.length)}
      {item({ kind: 'unfiled' }, <Inbox size={14} />, 'Unfiled', counts.unfiled)}
      {item({ kind: 'review' }, <AlertTriangle size={14} />, 'Needs checking', counts.review)}

      <div className="kr-side-head">
        <span>Collections</span>
        <button className="k-icon-btn" title="New collection…" onClick={() => onNewCollection('')}>
          <FolderPlus size={14} />
        </button>
      </div>
      {collections.length ? tree('', 0) : <div className="kr-side-hint">Make collections to file your references; drag references onto them.</div>}

      {counts.tags.length > 0 && (
        <>
          <div className="kr-side-head kr-clickable" onClick={() => setTagsOpen((v) => !v)}>
            <span>Tags</span>
            {tagsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </div>
          {tagsOpen && counts.tags.map(([t, n]) => <div key={t}>{item({ kind: 'tag', tag: t }, <Tag size={13} />, t, n)}</div>)}
        </>
      )}
    </nav>
  )
}
