// The "Files" panel (desktop explorer.py): a tree of one folder of the
// KherveOS drive. Double-click a notebook to open it (other files open in
// their app); drag a file onto the notebook to make it a cell.

import { useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Mdi } from './mdi'
import { os, useFsVersion, type Stat } from '@/os'
import { basename, dirname, extname, pretty } from '@/os/path'
import { fileIcon } from '@/os/fileIcons'
import { DRAG_MIME } from '@/os/fileActions'
import type { Notebook } from './notebook'
import { dropKind } from './importers'

/** Files surfaced in the tree; everything else is greyed out (desktop FILTERS). */
const SHOWN = new Set(['.kbook', '.ksheet', '.kdocz', '.ktex', '.ktexz', '.ipynb', '.svg', '.py', '.csv', '.tsv', '.txt', '.md', '.xlsx', '.xlsm', '.tex', '.png', '.jpg', '.jpeg', '.gif', '.pdf', '.json', '.dat'])

const isNotebook = (p: string) => extname(p) === '.kbook' || extname(p) === '.ipynb'

function list(dir: string): Stat[] {
  try {
    return os.fs.list(dir).filter((s) => !s.name.startsWith('.'))
  } catch {
    return []
  }
}

interface ExplorerProps {
  nb: Notebook
  root: string
  /** The open notebook's file, highlighted. */
  current: string | null
  onRoot: (dir: string) => void
}

export function Explorer({ nb, root, current, onRoot }: ExplorerProps) {
  useFsVersion() // follow every change on the drive
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)

  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  const activate = (s: Stat) => {
    if (s.type === 'dir') return toggle(s.path)
    if (isNotebook(s.path)) void nb.openPath(s.path)
    else void os.openFile(s.path)
  }

  const menu = (e: MouseEvent, s: Stat) => {
    e.preventDefault()
    e.stopPropagation()
    setSelected(s.path)
    const items = [
      { label: 'Open', onClick: () => activate(s) },
      ...(isNotebook(s.path) ? [{ label: 'Open in New Window', onClick: () => void os.open('khervebook', { path: s.path }) }] : []),
      ...(s.type === 'file' && dropKind(s.path) && !isNotebook(s.path)
        ? [{ label: 'Insert into Notebook', onClick: () => void nb.importFile(s.path) }]
        : []),
      '-' as const,
      ...(s.type === 'dir' ? [{ label: 'Explore This Folder', onClick: () => onRoot(s.path) }] : []),
      { label: 'Show in Files', onClick: () => void os.open('files', { path: s.type === 'dir' ? s.path : dirname(s.path) }) },
      { label: 'Copy Path', onClick: () => void navigator.clipboard?.writeText(s.path).catch(() => {}) },
    ]
    os.contextMenu(e, items)
  }

  const onDragStart = (e: DragEvent, s: Stat) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify([s.path]))
    e.dataTransfer.setData('text/plain', s.path)
    e.dataTransfer.effectAllowed = 'copy'
  }

  const row = (s: Stat, depth: number) => {
    const { icon: Icon, color } = fileIcon(s.path, s.type)
    const isOpen = s.type === 'dir' && open.has(s.path)
    const dim = s.type === 'file' && !SHOWN.has(extname(s.path))
    const cls = ['nb-tree-row']
    if (selected === s.path) cls.push('selected')
    if (current === s.path) cls.push('current')
    if (dim) cls.push('dim')
    return (
      <div key={s.path}>
        <div
          className={cls.join(' ')}
          style={{ paddingLeft: 6 + depth * 14 }}
          role="treeitem"
          aria-expanded={s.type === 'dir' ? isOpen : undefined}
          tabIndex={-1}
          draggable={s.type === 'file'}
          title={s.type === 'dir' ? pretty(s.path) : isNotebook(s.path) ? `${s.name} — double-click to open` : `${s.name} — double-click to open, or drag onto the notebook`}
          onClick={() => setSelected(s.path)}
          onDoubleClick={() => activate(s)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Enter' && activate(s)}
          onContextMenu={(e) => menu(e, s)}
          onDragStart={(e) => onDragStart(e, s)}
        >
          <span
            className="nb-tree-twisty"
            onClick={(e) => {
              e.stopPropagation()
              if (s.type === 'dir') toggle(s.path)
            }}
          >
            {s.type === 'dir' && (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
          </span>
          <Icon size={15} style={{ color }} className="nb-tree-icon" />
          <span className="nb-tree-name">{s.name}</span>
        </div>
        {isOpen && list(s.path).map((c) => row(c, depth + 1))}
      </div>
    )
  }

  const exists = os.fs.isDir(root)
  const items = exists ? list(root) : []
  const { icon: RootIcon } = fileIcon(root, 'dir')
  return (
    <div className="nb-explorer">
      <div className="nb-explorer-head">
        <button
          className="nb-side-btn"
          title="Choose the folder to explore"
          aria-label="Choose the folder to explore"
          onClick={() =>
            void os.dialog.pickFolder({ title: 'Choose the folder to explore', startDir: exists ? root : undefined }).then((d) => {
              if (d) onRoot(d)
            })
          }
        >
          <Mdi name="mdi.folder-open-outline" size={18} />
        </button>
        <span className="nb-explorer-root" title={pretty(root)}>
          {basename(root) || '/'}
        </span>
        {root !== '/' && (
          <button className="nb-side-btn" title="Explore the parent folder" aria-label="Explore the parent folder" onClick={() => onRoot(dirname(root))}>
            ..
          </button>
        )}
      </div>
      <div className="nb-tree" role="tree">
        {!exists ? (
          <div className="nb-tree-empty">This folder no longer exists.</div>
        ) : (
          <>
            <div className="nb-tree-row root" title={pretty(root)}>
              <span className="nb-tree-twisty">
                <ChevronDown size={13} />
              </span>
              <RootIcon size={15} className="nb-tree-icon" />
              <span className="nb-tree-name">{basename(root) || '/'}</span>
            </div>
            {items.length ? items.map((s) => row(s, 1)) : <div className="nb-tree-empty">Empty folder</div>}
          </>
        )}
      </div>
    </div>
  )
}
