// The Notes panel (the desktop's library_panel.py): every note, in folders,
// newest first, with a search box that looks inside the notes. The open note
// is in bold with its sections under it. Notes and folders move by dragging.

import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FilePlus, Folder as FolderIcon, FolderOpen, FolderPlus, Search, X } from 'lucide-react'
import { path } from '@/os'
import { filterTree, labelOf, type Folder, type NoteInfo } from './library'

const DRAG = 'application/x-khervenote-path'

export interface OutlineItem {
  title: string
  pos: number
}

interface Props {
  tree: Folder | null
  root: string
  openPath: string | null
  /** Title shown for the open note while it has no file yet. */
  pendingLabel: string | null
  outline: OutlineItem[]
  selectedFolder: string
  query: string
  onQuery(q: string): void
  onOpen(p: string): void
  onSelectFolder(p: string): void
  onNewNote(folder: string): void
  onNewFolder(folder: string): void
  onMove(src: string, destFolder: string): void
  onGoto(pos: number): void
  onNoteMenu(e: MouseEvent, info: NoteInfo): void
  onFolderMenu(e: MouseEvent, folder: Folder): void
}

export function NotesPanel(p: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const shown = p.tree ? filterTree(p.tree, p.query) : null
  const searching = !!p.query.trim()

  const toggle = (dir: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(dir)) n.delete(dir)
      else n.add(dir)
      return n
    })

  const dragStart = (e: DragEvent, src: string) => {
    e.dataTransfer.setData(DRAG, src)
    e.dataTransfer.effectAllowed = 'move'
  }
  const dragOver = (e: DragEvent, dir: string) => {
    if (!e.dataTransfer.types.includes(DRAG)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setDropTarget(dir)
  }
  const drop = (e: DragEvent, dir: string) => {
    const src = e.dataTransfer.getData(DRAG)
    setDropTarget(null)
    if (!src) return
    e.preventDefault()
    e.stopPropagation()
    if (src !== dir && path.dirname(src) !== dir) p.onMove(src, dir)
  }

  const noteRow = (n: NoteInfo, depth: number) => {
    const open = n.path === p.openPath
    return (
      <div key={n.path}>
        <div
          className={`kn-row kn-note-row${open ? ' open' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          draggable
          onDragStart={(e) => dragStart(e, n.path)}
          onClick={() => p.onOpen(n.path)}
          onContextMenu={(e) => {
            e.preventDefault()
            p.onNoteMenu(e, n)
          }}
          title={path.pretty(n.path)}
        >
          <span className="kn-row-label">{labelOf(n)}</span>
          {n.date && <span className="kn-row-date">{n.date}</span>}
        </div>
        {open && p.outline.length > 0 && (
          <div className="kn-outline">
            {p.outline.map((o, i) => (
              <div key={i} className="kn-row kn-outline-row" style={{ paddingLeft: 22 + depth * 14 }} onClick={() => p.onGoto(o.pos)}>
                {o.title || 'Untitled section'}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const folderRows = (f: Folder, depth: number, isRoot: boolean): ReactNode => {
    const closed = !searching && !isRoot && collapsed.has(f.path)
    const selected = p.selectedFolder === f.path
    return (
      <div key={f.path} onDragOver={(e) => dragOver(e, f.path)} onDragLeave={() => setDropTarget(null)} onDrop={(e) => drop(e, f.path)}>
        {!isRoot && (
          <div
            className={`kn-row kn-folder-row${selected ? ' selected' : ''}${dropTarget === f.path ? ' drop' : ''}`}
            style={{ paddingLeft: 4 + depth * 14 }}
            draggable
            onDragStart={(e) => dragStart(e, f.path)}
            onClick={() => {
              p.onSelectFolder(f.path)
              toggle(f.path)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              p.onFolderMenu(e, f)
            }}
          >
            {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            {closed ? <FolderIcon size={14} /> : <FolderOpen size={14} />}
            <span className="kn-row-label">{f.name}</span>
          </div>
        )}
        {!closed && (
          <>
            {f.folders.map((sub) => folderRows(sub, isRoot ? depth : depth + 1, false))}
            {f.notes.map((n) => noteRow(n, isRoot ? depth : depth + 1))}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="kn-notes">
      <div className="kn-notes-head">
        <div className="kn-search">
          <Search size={13} />
          <input className="kn-search-input" placeholder="Search notes" value={p.query} onChange={(e) => p.onQuery(e.target.value)} spellCheck={false} />
          {p.query && (
            <button className="k-icon-btn kn-tiny" title="Clear" onClick={() => p.onQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
        <div className="kn-notes-buttons">
          <button className="k-btn small" onClick={() => p.onNewNote(p.selectedFolder)} title="A new note in the selected folder (Ctrl+N)">
            <FilePlus size={13} /> Note
          </button>
          <button className="k-btn small" onClick={() => p.onNewFolder(p.selectedFolder)} title="A new folder inside the selected folder">
            <FolderPlus size={13} /> Folder
          </button>
        </div>
      </div>
      <div
        className={`kn-tree${dropTarget === p.root ? ' drop' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) p.onSelectFolder(p.root)
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget || !p.tree) return
          e.preventDefault()
          p.onFolderMenu(e, p.tree)
        }}
        onDragOver={(e) => dragOver(e, p.root)}
        onDrop={(e) => drop(e, p.root)}
      >
        {p.pendingLabel !== null && (
          <div className="kn-row kn-note-row open kn-pending">
            <span className="kn-row-label">{p.pendingLabel}</span>
          </div>
        )}
        {!p.tree && <div className="kn-empty-msg">Reading your notes…</div>}
        {shown && folderRows(shown, 0, true)}
        {p.tree && !shown && <div className="kn-empty-msg">No note matches “{p.query}”.</div>}
      </div>
    </div>
  )
}
