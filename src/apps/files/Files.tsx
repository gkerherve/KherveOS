// Files: the file manager for the KherveOS drive.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ArrowRight, ArrowUp, ChevronRight, FilePlus, FolderPlus, LayoutGrid, List, Search, Upload,
} from 'lucide-react'
import { os, fs, path, HOME, useDir, formatSize, type AppProps, type Stat } from '@/os'
import { fileIcon, IMAGE_EXTS, mimeType } from '@/os/fileIcons'
import { PLACES } from '@/os/ui/places'
import { DRAG_MIME, deleteItems, downloadItems, folderMenu, itemMenu, moveItems, newFolder, newTextFile, renameItem } from '@/os/fileActions'
import { useSettings } from '@/os/settings'
import { clearClipboard, copyMenuItems, handleClipboardKey, pasteMenuItems, useClipboard, usePasteSource } from './clipboard'
import { endDragOut, prepareDragOut, startDragOut } from './dragOut'
import { useAppTools } from '@/os/ai/appTools'
import { filesAiTools } from './aiTools'
import './files.css'

type SortKey = 'name' | 'mtime' | 'size'

const KINDS: Record<string, string> = {
  '.txt': 'Text', '.md': 'Markdown', '.py': 'Python script', '.kbook': 'KherveBook notebook', '.ipynb': 'Jupyter notebook',
  '.json': 'JSON', '.csv': 'CSV table', '.html': 'Web page', '.pdf': 'PDF document', '.png': 'PNG image', '.jpg': 'JPEG image',
  '.jpeg': 'JPEG image', '.gif': 'GIF image', '.svg': 'SVG image', '.webp': 'WebP image', '.tex': 'LaTeX source', '.zip': 'ZIP archive',
}

function kind(s: Stat): string {
  if (s.type === 'dir') return 'Folder'
  const ext = path.extname(s.name)
  return KINDS[ext] ?? (ext ? `${ext.slice(1).toUpperCase()} file` : 'File')
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function when(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? `Today, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A small image preview for grid view, read from the drive. */
function Thumb({ p, size }: { p: string; size: number }) {
  const [url, setUrl] = useState<string | null>(null)
  const mtime = fs.stat(p)?.mtime
  useEffect(() => {
    let u: string | null = null
    let alive = true
    fs.readBytes(p)
      .then((b) => {
        if (!alive) return
        u = URL.createObjectURL(new Blob([b as BlobPart], { type: mimeType(p) }))
        setUrl(u)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [p, mtime])
  if (!url) {
    const { icon: Icon, color } = fileIcon(p, 'file')
    return <Icon size={size} color={color} />
  }
  return <img className="fm-thumb" src={url} alt="" draggable={false} />
}

export default function Files({ win, args }: AppProps) {
  const start = args.path && fs.isDir(args.path) ? args.path : args.path && fs.isFile(args.path) ? path.dirname(args.path) : HOME
  const [dir, setDir] = useState(start)
  const [back, setBack] = useState<string[]>([])
  const [fwd, setFwd] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(args.path && fs.isFile(args.path) ? [args.path] : []))
  const [anchor, setAnchor] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'name', asc: true })
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const listing = useDir(dir)
  const showHidden = useSettings((st) => st.showHidden)
  const setSettings = useSettings((st) => st.set)
  const mainRef = useRef<HTMLDivElement>(null)
  usePasteSource() // re-render (and so refresh the Edit menu) when the clipboard changes
  const dirRef = useRef(dir)
  dirRef.current = dir
  const hiddenRef = useRef(showHidden)
  hiddenRef.current = showHidden
  // AI tools (files_open_folder, files_select: src/os/ai/appManifest.ts).
  useAppTools(
    win,
    useMemo(
      () =>
        filesAiTools({
          dir: () => dirRef.current,
          go: (d) => go(d),
          select: (paths) => setSelected(new Set(paths)),
          showHidden: () => hiddenRef.current,
        }),
      [],
    ),
  )

  // Opened again with a new path (e.g. "Open" on a folder elsewhere).
  useEffect(() => {
    if (!args.path) return
    if (fs.isDir(args.path)) go(args.path)
    else if (fs.isFile(args.path)) {
      go(path.dirname(args.path))
      setSelected(new Set([args.path]))
    }
  }, [args.path])

  // The folder we're in was deleted or moved: follow it, or go up.
  useEffect(
    () =>
      fs.watch((ev) => {
        if (ev.type === 'rename' && path.isInside(dirRef.current, ev.oldPath)) {
          setDir(ev.path + dirRef.current.slice(ev.oldPath.length))
        }
      }),
    [],
  )
  useEffect(() => {
    if (listing) return
    let d = dir
    while (d !== '/' && !fs.isDir(d)) d = path.dirname(d)
    setDir(d)
  }, [listing, dir])

  useEffect(() => {
    win.setTitle(`${dir === HOME ? 'Home' : path.basename(dir)} — Files`)
  }, [win, dir])

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = (listing ?? []).filter((s) => (showHidden || !s.name.startsWith('.')) && (!q || s.name.toLowerCase().includes(q)))
    const dirFirst = (a: Stat, b: Stat) => (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1)
    const by = (a: Stat, b: Stat) =>
      sort.key === 'name'
        ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        : sort.key === 'size'
          ? a.size - b.size
          : a.mtime - b.mtime
    return [...list].sort((a, b) => dirFirst(a, b) || (sort.asc ? by(a, b) : by(b, a)))
  }, [listing, filter, sort, showHidden])

  function go(d: string) {
    if (d === dirRef.current) return
    setBack((b) => [...b, dirRef.current])
    setFwd([])
    setDir(d)
    setSelected(new Set())
    setFilter('')
  }

  const goBack = () => {
    const prev = back[back.length - 1]
    if (!prev) return
    setBack(back.slice(0, -1))
    setFwd([dir, ...fwd])
    setDir(prev)
    setSelected(new Set())
  }
  const goForward = () => {
    const next = fwd[0]
    if (!next) return
    setFwd(fwd.slice(1))
    setBack([...back, dir])
    setDir(next)
    setSelected(new Set())
  }

  const openItem = (s: Stat) => (s.type === 'dir' ? go(s.path) : void os.openFile(s.path))

  const click = (s: Stat, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected)
      if (next.has(s.path)) next.delete(s.path)
      else next.add(s.path)
      setSelected(next)
      setAnchor(s.path)
    } else if (e.shiftKey && anchor) {
      const a = items.findIndex((x) => x.path === anchor)
      const b = items.findIndex((x) => x.path === s.path)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        setSelected(new Set(items.slice(lo, hi + 1).map((x) => x.path)))
      }
    } else {
      setSelected(new Set([s.path]))
      setAnchor(s.path)
    }
  }

  const sel = () => items.filter((s) => selected.has(s.path)).map((s) => s.path)

  const onKeyDown = async (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    if (handleClipboardKey(e, sel(), dir, (paths) => setSelected(new Set(paths)))) return
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Delete' || (e.key === 'Backspace' && mod)) {
      e.preventDefault()
      if (selected.size && (await deleteItems(sel()))) setSelected(new Set())
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      if (dir !== '/') go(path.dirname(dir))
    } else if (e.key === 'Enter') {
      const first = items.find((s) => selected.has(s.path))
      if (first) openItem(first)
    } else if (e.key === 'F2') {
      const [only] = sel()
      if (only) {
        const np = await renameItem(only)
        if (np) setSelected(new Set([np]))
      }
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(items.map((s) => s.path)))
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!items.length) return
      e.preventDefault()
      const step = view === 'grid' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') ? gridColumns() : 1
      const dirn = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
      if (view === 'list' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
      const cur = items.findIndex((s) => s.path === anchor)
      const next = items[Math.max(0, Math.min(items.length - 1, cur < 0 ? 0 : cur + dirn * step))]
      setSelected(new Set([next.path]))
      setAnchor(next.path)
      mainRef.current?.querySelector(`[data-path="${CSS.escape(next.path)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }

  function gridColumns() {
    const grid = mainRef.current?.querySelector('.fm-grid') as HTMLElement | null
    if (!grid) return 1
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length)
  }

  // ---- drag and drop
  // What a drag (or right-click) on an item acts on: the whole selection if the item is in it.
  const dragPaths = (s: Stat) => (selected.has(s.path) ? sel() : [s.path])

  const dragStart = (s: Stat, e: React.DragEvent) => {
    if (!selected.has(s.path)) setSelected(new Set([s.path]))
    // Inside KherveOS this moves; dropped on the computer's desktop it downloads (see dragOut.ts).
    startDragOut(dragPaths(s), e)
  }

  const accepts = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_MIME) || e.dataTransfer.types.includes('Files')

  const dropInto = async (target: string, e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (raw) {
      const paths = (JSON.parse(raw) as string[]).filter((p) => p !== target && !path.isInside(target, p))
      await moveItems(paths, target)
    } else if (e.dataTransfer.files.length) {
      await os.importFiles(target, e.dataTransfer.files)
    }
  }

  const folderDragProps = (s: Stat) =>
    s.type === 'dir'
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!accepts(e)) return
            e.preventDefault()
            e.stopPropagation()
            setDropTarget(s.path)
          },
          onDragLeave: () => setDropTarget((t) => (t === s.path ? null : t)),
          onDrop: (e: React.DragEvent) => void dropInto(s.path, e),
        }
      : {}

  const itemProps = (s: Stat) => ({
    'data-path': s.path,
    draggable: true,
    // The download for a drag out to the computer must be ready when the drag starts.
    onPointerDown: (e: React.PointerEvent) => e.button === 0 && prepareDragOut(dragPaths(s)),
    onDragStart: (e: React.DragEvent) => dragStart(s, e),
    onDragEnd: endDragOut,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation()
      click(s, e)
    },
    onDoubleClick: () => openItem(s),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const paths = dragPaths(s)
      if (!selected.has(s.path)) setSelected(new Set([s.path]))
      os.contextMenu(e, itemMenu(paths, { onRename: (np) => setSelected(new Set([np])), clipboard: copyMenuItems(paths) }))
    },
    ...folderDragProps(s),
  })

  const crumbs = useMemo(() => {
    const out: { name: string; path: string }[] = []
    if (path.isInside(dir, HOME)) {
      out.push({ name: 'Home', path: HOME })
      const rest = dir.slice(HOME.length).split('/').filter(Boolean)
      rest.forEach((part, i) => out.push({ name: part, path: path.join(HOME, ...rest.slice(0, i + 1)) }))
    } else {
      out.push({ name: '/', path: '/' })
      dir.split('/').filter(Boolean).forEach((part, i, all) => out.push({ name: part, path: '/' + all.slice(0, i + 1).join('/') }))
    }
    return out
  }, [dir])

  // Menus in the top menu bar.
  useEffect(() => {
    const selectedPaths = items.filter((s) => selected.has(s.path)).map((s) => s.path)
    const clip = useClipboard.getState()
    win.setMenus([
      {
        label: 'File',
        items: [
          { label: 'New Window', onClick: () => os.open('files', { path: dir, _new: Date.now() }) },
          { label: 'New Folder', icon: FolderPlus, onClick: () => void newFolder(dir) },
          { label: 'New Text File', icon: FilePlus, onClick: () => void newTextFile(dir) },
          '-',
          { label: 'Open', disabled: !selectedPaths.length, onClick: () => selectedPaths.forEach((p) => void os.openFile(p)) },
          { label: 'Rename…', disabled: selectedPaths.length !== 1, onClick: () => void renameItem(selectedPaths[0]) },
          { label: 'Delete', danger: true, disabled: !selectedPaths.length, onClick: () => void deleteItems(selectedPaths) },
          '-',
          { label: 'Upload Files…', icon: Upload, onClick: () => void os.upload(dir) },
          { label: 'Download', disabled: !selectedPaths.length, onClick: () => void downloadItems(selectedPaths) },
        ],
      },
      {
        label: 'Edit',
        items: [
          ...copyMenuItems(selectedPaths),
          ...pasteMenuItems(dir, (paths) => setSelected(new Set(paths))).slice(0, 1),
          '-',
          { label: 'Select All', shortcut: '⌘A', onClick: () => setSelected(new Set(items.map((s) => s.path))) },
          '-',
          {
            label: clip.server ? 'Clear Clipboard (all computers)' : 'Clear Clipboard',
            disabled: !clip.local && !clip.server,
            onClick: () => void clearClipboard(),
          },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'as List', checked: view === 'list', onClick: () => setView('list') },
          { label: 'as Icons', checked: view === 'grid', onClick: () => setView('grid') },
          '-',
          { label: 'Sort by Name', checked: sort.key === 'name', onClick: () => setSort({ key: 'name', asc: true }) },
          { label: 'Sort by Date Modified', checked: sort.key === 'mtime', onClick: () => setSort({ key: 'mtime', asc: false }) },
          { label: 'Sort by Size', checked: sort.key === 'size', onClick: () => setSort({ key: 'size', asc: false }) },
          '-',
          { label: 'Show Hidden Files', checked: showHidden, onClick: () => setSettings({ showHidden: !showHidden }) },
        ],
      },
      {
        label: 'Go',
        items: [
          { label: 'Back', disabled: !back.length, onClick: goBack },
          { label: 'Forward', disabled: !fwd.length, onClick: goForward },
          { label: 'Enclosing Folder', disabled: dir === '/', onClick: () => go(path.dirname(dir)) },
          '-',
          ...PLACES.map((p) => ({ label: p.name, icon: p.icon, onClick: () => go(p.path) })),
        ],
      },
    ])
  })

  const usage = fs.usage()
  const selectedStats = items.filter((s) => selected.has(s.path))
  const selectedSize = selectedStats.reduce((n, s) => n + (s.type === 'file' ? s.size : 0), 0)

  const sortHeader = (key: SortKey, label: string, className: string) => (
    <button
      className={`fm-col ${className}${sort.key === key ? ' sorted' : ''}`}
      onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}
    >
      {label}
      {sort.key === key && <span className="fm-sort-arrow">{sort.asc ? '▲' : '▼'}</span>}
    </button>
  )

  return (
    <div className="k-app fm-app" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="k-toolbar fm-toolbar">
        <button className="k-icon-btn" title="Back" disabled={!back.length} onClick={goBack}><ArrowLeft size={16} /></button>
        <button className="k-icon-btn" title="Forward" disabled={!fwd.length} onClick={goForward}><ArrowRight size={16} /></button>
        <button className="k-icon-btn" title="Up one folder" disabled={dir === '/'} onClick={() => go(path.dirname(dir))}><ArrowUp size={16} /></button>
        <nav className="fm-crumbs" aria-label="Location">
          {crumbs.map((c, i) => (
            <span key={c.path} className="fm-crumb-wrap">
              {i > 0 && <ChevronRight size={13} className="k-muted" />}
              <button
                className={`fm-crumb${i === crumbs.length - 1 ? ' current' : ''}`}
                onClick={() => go(c.path)}
                onDragOver={(e) => accepts(e) && (e.preventDefault(), setDropTarget(c.path))}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => void dropInto(c.path, e)}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="fm-search">
          <Search size={14} />
          <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
        </div>
        <span className="k-sep" />
        <button className={`k-icon-btn${view === 'list' ? ' active' : ''}`} title="List view" onClick={() => setView('list')}><List size={16} /></button>
        <button className={`k-icon-btn${view === 'grid' ? ' active' : ''}`} title="Icon view" onClick={() => setView('grid')}><LayoutGrid size={16} /></button>
        <span className="k-sep" />
        <button className="k-icon-btn" title="New folder" onClick={async () => {
          const p = await newFolder(dir)
          if (p) setSelected(new Set([p]))
        }}><FolderPlus size={16} /></button>
        <button className="k-icon-btn" title="New text file" onClick={async () => {
          const p = await newTextFile(dir)
          if (p) setSelected(new Set([p]))
        }}><FilePlus size={16} /></button>
        <button className="k-icon-btn" title="Upload files from your computer" onClick={async () => {
          const written = await os.upload(dir)
          if (written.length) setSelected(new Set(written))
        }}><Upload size={16} /></button>
      </div>
      <div className="fm-body">
        <aside className="fm-sidebar">
          {PLACES.map((p) => (
            <button
              key={p.path}
              className={`k-place${dir === p.path ? ' active' : ''}${dropTarget === p.path ? ' drop' : ''}`}
              onClick={() => go(p.path)}
              onDragOver={(e) => accepts(e) && (e.preventDefault(), setDropTarget(p.path))}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => void dropInto(p.path, e)}
            >
              <p.icon size={15} /> {p.name}
            </button>
          ))}
          <div className="fm-usage k-muted">
            {formatSize(usage.bytes)} in {usage.files} files
            <br />
            Stored in this browser
          </div>
        </aside>
        <div
          ref={mainRef}
          className={`fm-main${dropTarget === dir ? ' drop' : ''}`}
          onClick={() => setSelected(new Set())}
          onContextMenu={(e) => {
            e.preventDefault()
            setSelected(new Set())
            os.contextMenu(
              e,
              folderMenu(
                dir,
                [
                  { label: 'View as list', checked: view === 'list', onClick: () => setView('list') },
                  { label: 'View as icons', checked: view === 'grid', onClick: () => setView('grid') },
                  { label: 'Select all', onClick: () => setSelected(new Set(items.map((s) => s.path))) },
                ],
                pasteMenuItems(dir, (paths) => setSelected(new Set(paths))),
              ),
            )
          }}
          onDragOver={(e) => {
            if (!accepts(e)) return
            e.preventDefault()
            setDropTarget(dir)
          }}
          onDragLeave={(e) => e.target === e.currentTarget && setDropTarget(null)}
          onDrop={(e) => void dropInto(dir, e)}
        >
          {items.length === 0 ? (
            <div className="k-empty fm-empty">
              {filter ? `Nothing here matches “${filter}”.` : 'This folder is empty. Drop files here, or use Upload.'}
            </div>
          ) : view === 'list' ? (
            <div className="fm-list" role="grid">
              <div className="fm-row fm-head" role="row">
                {sortHeader('name', 'Name', 'fm-name')}
                {sortHeader('mtime', 'Modified', 'fm-date')}
                {sortHeader('size', 'Size', 'fm-size')}
                <span className="fm-col fm-kind">Kind</span>
              </div>
              {items.map((s) => {
                const { icon: Icon, color } = fileIcon(s.path, s.type)
                return (
                  <div
                    key={s.path}
                    role="row"
                    aria-selected={selected.has(s.path)}
                    className={`fm-row${selected.has(s.path) ? ' selected' : ''}${dropTarget === s.path ? ' drop' : ''}`}
                    {...itemProps(s)}
                  >
                    <span className="fm-col fm-name">
                      <Icon size={16} color={color} />
                      <span className="fm-label">{s.name}</span>
                    </span>
                    <span className="fm-col fm-date">{when(s.mtime)}</span>
                    <span className="fm-col fm-size">{s.type === 'dir' ? plural(fs.list(s.path).length, 'item') : formatSize(s.size)}</span>
                    <span className="fm-col fm-kind">{kind(s)}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="fm-grid">
              {items.map((s) => {
                const { icon: Icon, color } = fileIcon(s.path, s.type)
                const isImage = s.type === 'file' && IMAGE_EXTS.includes(path.extname(s.name))
                return (
                  <div
                    key={s.path}
                    className={`fm-tile${selected.has(s.path) ? ' selected' : ''}${dropTarget === s.path ? ' drop' : ''}`}
                    title={s.name}
                    {...itemProps(s)}
                  >
                    <span className="fm-tile-icon">{isImage ? <Thumb p={s.path} size={40} /> : <Icon size={40} color={color} strokeWidth={1.5} />}</span>
                    <span className="fm-tile-name">{s.name}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      <div className="k-statusbar">
        <span>
          {selected.size
            ? `${selected.size} of ${items.length} selected${selectedSize ? ` — ${formatSize(selectedSize)}` : ''}`
            : plural(items.length, 'item')}
        </span>
        <span style={{ marginLeft: 'auto' }}>{path.pretty(dir)}</span>
      </div>
    </div>
  )
}
