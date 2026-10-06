// The Open / Save As / Choose folder dialog, browsing the virtual drive.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, FolderPlus } from 'lucide-react'
import { fs, useDir, FsError } from '../vfs'
import { HOME, basename, dirname, extname, join, pretty } from '../path'
import { fileIcon } from '../fileIcons'
import { PLACES } from './places'
import { dialog } from '../overlays'

export interface FileDialogOptions {
  mode: 'open' | 'save' | 'folder'
  title?: string
  /** Folder to start in (defaults to ~/Documents). */
  startDir?: string
  /** Save mode: suggested file name. May also be a full path. */
  defaultName?: string
  /** Only show files with these extensions, e.g. ['.kbook']. Save mode adds the first one if missing. */
  extensions?: string[]
}

export function FileDialog({ options, onDone }: { options: FileDialogOptions; onDone: (path: string | null) => void }) {
  const { mode, extensions } = options
  const initialDir = (() => {
    const fromName = options.defaultName?.startsWith('/') ? dirname(options.defaultName) : null
    const d = fromName ?? options.startDir ?? `${HOME}/Documents`
    return fs.isDir(d) ? d : HOME
  })()
  const [dir, setDir] = useState(initialDir)
  const [history, setHistory] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState(options.defaultName ? basename(options.defaultName) : '')
  const nameRef = useRef<HTMLInputElement>(null)
  const listing = useDir(dir)

  const entries = useMemo(
    () =>
      (listing ?? []).filter(
        (s) =>
          !s.name.startsWith('.') &&
          (s.type === 'dir' || (mode !== 'folder' && (!extensions?.length || extensions.includes(extname(s.name))))),
      ),
    [listing, mode, extensions],
  )

  useEffect(() => {
    if (mode !== 'save') return
    const el = nameRef.current
    if (!el) return
    el.focus()
    const dot = el.value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
  }, [mode])

  const go = (d: string) => {
    if (d === dir) return
    setHistory((h) => [...h, dir])
    setDir(d)
    setSelected(null)
  }

  const finishSave = async (override?: string) => {
    let n = (override ?? name).trim()
    if (!n) return
    if (n.includes('/')) {
      await dialog.alert('File names cannot contain "/".')
      return
    }
    if (extensions?.length && !extname(n)) n += extensions[0]
    const target = join(dir, n)
    if (fs.isDir(target)) {
      go(target)
      setName('')
      return
    }
    if (fs.exists(target) && !(await dialog.confirm(`"${n}" already exists. Replace it?`, { title: 'Replace file', okLabel: 'Replace', danger: true }))) return
    onDone(target)
  }

  const finish = async () => {
    if (mode === 'save') return finishSave()
    if (mode === 'folder') return onDone(selected && fs.isDir(selected) ? selected : dir)
    if (!selected) return
    if (fs.isDir(selected)) go(selected)
    else onDone(selected)
  }

  const newFolder = async () => {
    const n = await dialog.prompt('Name of the new folder:', { title: 'New folder', defaultValue: fs.uniqueName(dir, 'New folder') })
    if (!n) return
    try {
      await fs.mkdir(join(dir, n))
      setSelected(join(dir, n))
    } catch (e) {
      await dialog.alert(e instanceof FsError ? e.message : String(e))
    }
  }

  const title = options.title ?? (mode === 'open' ? 'Open' : mode === 'save' ? 'Save As' : 'Choose a folder')
  const okLabel = mode === 'open' ? 'Open' : mode === 'save' ? 'Save' : 'Choose'
  const okDisabled = mode === 'save' ? !name.trim() : mode === 'open' ? !selected : false

  return (
    <div
      className="k-dialog k-filedialog"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone(null)
      }}
    >
      <div className="k-dialog-title">
        <span>{title}</span>
      </div>
      <div className="k-filedialog-bar">
        <button className="k-icon-btn" title="Back" disabled={!history.length} onClick={() => {
          const prev = history[history.length - 1]
          setHistory((h) => h.slice(0, -1))
          setDir(prev)
          setSelected(null)
        }}>
          <ArrowLeft size={16} />
        </button>
        <button className="k-icon-btn" title="Up one folder" disabled={dir === '/'} onClick={() => go(dirname(dir))}>
          <ArrowUp size={16} />
        </button>
        <div className="k-filedialog-path" title={dir}>{pretty(dir)}</div>
        {mode !== 'open' && (
          <button className="k-btn small" onClick={newFolder}>
            <FolderPlus size={14} /> New folder
          </button>
        )}
      </div>
      <div className="k-filedialog-main">
        <div className="k-filedialog-places">
          {PLACES.map((p) => (
            <button key={p.path} className={`k-place${dir === p.path ? ' active' : ''}`} onClick={() => go(p.path)}>
              <p.icon size={15} /> {p.name}
            </button>
          ))}
        </div>
        <div className="k-filedialog-list" role="listbox">
          {entries.length === 0 && <div className="k-empty">{mode === 'folder' ? 'No folders here' : 'Nothing here'}</div>}
          {entries.map((s) => {
            const { icon: Icon, color } = fileIcon(s.path, s.type)
            return (
              <div
                key={s.path}
                role="option"
                aria-selected={selected === s.path}
                className={`k-filedialog-row${selected === s.path ? ' selected' : ''}`}
                onClick={() => {
                  setSelected(s.path)
                  if (mode === 'save' && s.type === 'file') setName(s.name)
                }}
                onDoubleClick={() => {
                  if (s.type === 'dir') go(s.path)
                  else if (mode === 'open') onDone(s.path)
                  else if (mode === 'save') { setName(s.name); void finishSave(s.name) }
                }}
              >
                <Icon size={16} color={color} />
                <span className="k-filedialog-name">{s.name}</span>
              </div>
            )
          })}
        </div>
      </div>
      <form
        className="k-filedialog-footer"
        onSubmit={(e) => {
          e.preventDefault()
          void finish()
        }}
      >
        {mode === 'save' ? (
          <label className="k-filedialog-namefield">
            Name
            <input ref={nameRef} className="k-input" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </label>
        ) : (
          <span className="k-muted k-filedialog-hint">
            {extensions?.length ? `Showing ${extensions.join(', ')} files` : mode === 'folder' ? `Folder: ${pretty(selected && fs.isDir(selected) ? selected : dir)}` : ''}
          </span>
        )}
        <div className="k-dialog-buttons">
          <button type="button" className="k-btn" onClick={() => onDone(null)}>Cancel</button>
          <button type="submit" className="k-btn primary" disabled={okDisabled}>{okLabel}</button>
        </div>
      </form>
    </div>
  )
}
