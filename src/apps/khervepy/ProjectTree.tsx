// The Project dock: the project folder as a tree, names coloured by their
// Git status, with the desktop app's explorer operations (new, rename,
// duplicate, delete, copy path, drag to move, drop files to upload).

import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  ChevronDown, ChevronRight, ClipboardCopy, Copy, Download, File, FileCode2, FilePlus, Folder, FolderOpen, FolderPlus,
  Pencil, SquareTerminal, Trash2, Upload,
} from 'lucide-react'
import { os, fs, path, type MenuItem, type Stat } from '@/os'
import type { StatusCode } from './repo'

interface Row {
  stat: Stat
  depth: number
}

/** Re-render when the drive changes — at most every `ms` (a clone writes thousands of files). */
export function useFsTick(ms = 150): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let timer: number | undefined
    const off = fs.watch(() => {
      if (timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined
          setTick((n) => n + 1)
        }, ms)
      }
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [ms])
  return tick
}

const HIDDEN_ALWAYS = new Set(['.git'])

export interface ProjectTreeProps {
  root: string
  showHidden: boolean
  activePath: string | null
  statusOf: (abs: string) => StatusCode | null
  onOpen: (p: string) => void
  status: (msg: string) => void
}

export const ProjectTree = memo(function ProjectTree({ root, showHidden, activePath, statusOf, onOpen, status }: ProjectTreeProps) {
  const tick = useFsTick()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root]))
  const [selected, setSelected] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => setExpanded(new Set([root])), [root])

  // Reveal the active file: open the folders above it.
  useEffect(() => {
    if (!activePath || !path.isInside(activePath, root)) return
    setExpanded((cur) => {
      let changed = false
      const next = new Set(cur)
      for (let d = path.dirname(activePath); d.length >= root.length; d = path.dirname(d)) {
        if (!next.has(d)) {
          next.add(d)
          changed = true
        }
        if (d === root) break
      }
      return changed ? next : cur
    })
  }, [activePath, root])

  const rows = useMemo(() => {
    void tick
    const out: Row[] = []
    const visit = (dir: string, depth: number) => {
      let items: Stat[]
      try {
        items = fs.list(dir)
      } catch {
        return
      }
      for (const s of items) {
        if (HIDDEN_ALWAYS.has(s.name) || (!showHidden && s.name.startsWith('.'))) continue
        out.push({ stat: s, depth })
        if (s.type === 'dir' && expanded.has(s.path)) visit(s.path, depth + 1)
      }
    }
    visit(root, 0)
    return out
  }, [root, expanded, showHidden, tick])

  const toggle = (p: string) =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })

  const dirFor = (p: string | null) => (!p ? root : fs.isDir(p) ? p : path.dirname(p))

  // ---------------------------------------------------------- operations

  const fail = (what: string, e: unknown) => os.dialog.alert(`${what}: ${e instanceof Error ? e.message : String(e)}`, { title: 'kPY' })

  const newFile = async (inDir: string) => {
    const name = (await os.dialog.prompt('File name:', { title: 'New File', defaultValue: 'untitled.py', selectStem: true }))?.trim()
    if (!name) return
    const target = path.join(inDir, name)
    if (fs.exists(target)) return void os.dialog.alert(`“${name}” already exists.`, { title: 'New File' })
    try {
      await fs.writeText(target, '', { mkdirs: true })
      setExpanded((cur) => new Set(cur).add(inDir))
      setSelected(target)
      onOpen(target)
    } catch (e) {
      await fail('Could not create the file', e)
    }
  }

  const newFolder = async (inDir: string) => {
    const name = (await os.dialog.prompt('Folder name:', { title: 'New Folder', defaultValue: 'folder' }))?.trim()
    if (!name) return
    const target = path.join(inDir, name)
    try {
      await fs.mkdir(target, { recursive: false })
      setExpanded((cur) => new Set(cur).add(inDir).add(target))
      setSelected(target)
    } catch (e) {
      await fail('Could not create the folder', e)
    }
  }

  const rename = async (p: string) => {
    const name = (await os.dialog.prompt('New name:', { title: 'Rename', defaultValue: path.basename(p), selectStem: fs.isFile(p) }))?.trim()
    if (!name || name === path.basename(p)) return
    const target = path.join(path.dirname(p), name)
    try {
      await fs.rename(p, target)
      setSelected(target)
    } catch (e) {
      await fail('Could not rename', e)
    }
  }

  const duplicate = async (p: string) => {
    const dir = path.dirname(p)
    const dot = fs.isFile(p) ? path.basename(p).lastIndexOf('.') : -1
    const base = path.basename(p)
    const candidate = dot > 0 ? `${base.slice(0, dot)} copy${base.slice(dot)}` : `${base} copy`
    const target = path.join(dir, fs.uniqueName(dir, candidate))
    try {
      await fs.copy(p, target)
      setSelected(target)
    } catch (e) {
      await fail('Could not duplicate', e)
    }
  }

  const remove = async (p: string) => {
    const isDir = fs.isDir(p)
    const ok = await os.dialog.confirm(
      `Delete “${path.basename(p)}”${isDir ? ' and everything in it' : ''}? This can’t be undone.`,
      { title: 'Delete', okLabel: 'Delete', danger: true },
    )
    if (!ok) return
    try {
      await fs.remove(p, { recursive: true })
      status(`Deleted ${path.basename(p)}`)
    } catch (e) {
      await fail('Could not delete', e)
    }
  }

  const copyText = (text: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => status('Copied to the clipboard'),
      () => status('The clipboard is not available'),
    )
  }

  const menuFor = (p: string | null): MenuItem[] => {
    const dir = dirFor(p)
    const isFile = !!p && fs.isFile(p)
    const items: MenuItem[] = [
      { label: 'New File…', icon: FilePlus, onClick: () => void newFile(dir) },
      { label: 'New Folder…', icon: FolderPlus, onClick: () => void newFolder(dir) },
    ]
    if (p) {
      items.push('-')
      if (isFile) items.push({ label: 'Open', icon: FileCode2, onClick: () => onOpen(p) })
      if (isFile) items.push({ label: 'Open With Default App', onClick: () => void os.openFile(p) })
      items.push(
        { label: 'Rename…', icon: Pencil, shortcut: 'F2', onClick: () => void rename(p) },
        { label: 'Duplicate', icon: Copy, onClick: () => void duplicate(p) },
        { label: 'Delete…', icon: Trash2, danger: true, onClick: () => void remove(p) },
        '-',
        { label: 'Copy Path', icon: ClipboardCopy, onClick: () => copyText(p) },
        { label: 'Copy Relative Path', onClick: () => copyText(p.slice(root.length + 1)) },
      )
    }
    items.push(
      '-',
      { label: 'Reveal in Files', icon: FolderOpen, onClick: () => os.open('files', { path: p ?? root }) },
      { label: 'Open in Terminal', icon: SquareTerminal, onClick: () => os.open('terminal', { path: dir }) },
    )
    if (isFile) items.push({ label: 'Download to Computer', icon: Download, onClick: () => void os.download(p!) })
    items.push({ label: 'Upload Files Here…', icon: Upload, onClick: () => void os.upload(dir) })
    return items
  }

  const contextMenu = (e: MouseEvent, p: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    if (p) setSelected(p)
    os.contextMenu(e, menuFor(p))
  }

  // ------------------------------------------------------- drag and drop

  const onDragStart = (e: DragEvent, p: string) => {
    e.dataTransfer.setData('application/x-kherveos-path', p)
    e.dataTransfer.setData('text/plain', p)
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e: DragEvent, dir: string) => {
    const types = e.dataTransfer.types
    if (!types.includes('application/x-kherveos-path') && !types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move'
    setDropTarget(dir)
  }
  const onDrop = async (e: DragEvent, dir: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(null)
    if (e.dataTransfer.files.length) {
      await os.importFiles(dir, [...e.dataTransfer.files])
      return
    }
    const src = e.dataTransfer.getData('application/x-kherveos-path')
    if (!src || path.dirname(src) === dir || path.isInside(dir, src)) return
    try {
      await fs.rename(src, path.join(dir, path.basename(src)))
      setExpanded((cur) => new Set(cur).add(dir))
    } catch (err) {
      await fail('Could not move', err)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!selected) return
    if (e.key === 'F2') {
      e.preventDefault()
      void rename(selected)
    } else if (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      void remove(selected)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (fs.isDir(selected)) toggle(selected)
      else onOpen(selected)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const i = rows.findIndex((r) => r.stat.path === selected)
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) setSelected(next.stat.path)
    }
  }

  if (!fs.isDir(root)) return <div className="kpy-placeholder">The project folder “{path.pretty(root)}” is gone.</div>

  return (
    <div
      ref={box}
      className={`kpy-tree${dropTarget === root ? ' drop' : ''}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => contextMenu(e, null)}
      onDragOver={(e) => onDragOver(e, root)}
      onDragLeave={(e) => e.currentTarget === e.target && setDropTarget(null)}
      onDrop={(e) => void onDrop(e, root)}
    >
      {rows.length === 0 && <div className="kpy-placeholder">This folder is empty. Right-click to add a file.</div>}
      {rows.map(({ stat: s, depth }) => {
        const isDir = s.type === 'dir'
        const open = isDir && expanded.has(s.path)
        const st = statusOf(s.path)
        const Icon = isDir ? (open ? FolderOpen : Folder) : s.name.endsWith('.py') ? FileCode2 : File
        return (
          <div
            key={s.path}
            className={`kpy-row${selected === s.path ? ' selected' : ''}${activePath === s.path ? ' active' : ''}${dropTarget === s.path ? ' drop' : ''}${st ? ` st-${st}` : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            title={s.path}
            draggable
            onDragStart={(e) => onDragStart(e, s.path)}
            onDragOver={isDir ? (e) => onDragOver(e, s.path) : undefined}
            onDrop={isDir ? (e) => void onDrop(e, s.path) : undefined}
            onClick={() => {
              setSelected(s.path)
              if (isDir) toggle(s.path)
            }}
            onDoubleClick={() => !isDir && onOpen(s.path)}
            onContextMenu={(e) => contextMenu(e, s.path)}
          >
            <span className="kpy-twist">{isDir ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}</span>
            <Icon size={14} className="kpy-row-icon" />
            <span className="kpy-row-name">{s.name}</span>
          </div>
        )
      })}
    </div>
  )
})
