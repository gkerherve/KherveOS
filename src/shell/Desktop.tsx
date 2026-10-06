import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Settings as SettingsIcon } from 'lucide-react'
import { fs, useDir } from '@/os/vfs'
import { HOME } from '@/os/path'
import { APPS } from '@/os/registry'
import { useSettings } from '@/os/settings'
import { useWindows } from '@/os/windows'
import { fileIcon, mimeType } from '@/os/fileIcons'
import { showContextMenu } from '@/os/overlays'
import { DRAG_MIME, deleteItems, folderMenu, itemMenu, moveItems, renameItem } from '@/os/fileActions'
import { os } from '@/os'
import { AppIcon } from '@/os/ui/AppIcon'
import type { AppManifest } from '@/os/types'
import { wallpaperCss } from './wallpapers'

const DESKTOP = `${HOME}/Desktop`

/** CSS background for the chosen wallpaper (built-in, or a picture from the drive). */
function useWallpaper(id: string): string {
  const [url, setUrl] = useState<string | null>(null)
  const file = id.startsWith('file:') ? id.slice(5) : null
  useEffect(() => {
    if (!file || !fs.isFile(file)) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    fs.readBytes(file).then((bytes) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType(file) }))
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file])
  if (file) return url ? `center / cover no-repeat url("${url}"), var(--k-desk)` : 'var(--k-desk)'
  return wallpaperCss(id)
}

interface Item {
  key: string
  name: string
  open: () => void
  app?: AppManifest
  file?: { icon: React.ComponentType<{ size?: number; color?: string }>; color: string }
}

export function Desktop() {
  const wallpaper = useSettings((s) => s.wallpaper)
  const wallpaperOpacity = useSettings((s) => s.wallpaperOpacity)
  const showApps = useSettings((s) => s.desktopIcons)
  const files = useDir(DESKTOP) ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const background = useWallpaper(wallpaper)
  const open = useWindows((s) => s.open)

  const items: Item[] = useMemo(() => {
    const apps: Item[] = showApps
      ? APPS.filter((a) => a.desktop).map((a) => ({
          key: `app:${a.id}`,
          name: a.name,
          open: () => open(a.id),
          app: a,
        }))
      : []
    const docs: Item[] = files.filter((f) => !f.name.startsWith('.')).map((f) => {
      const fi = fileIcon(f.path, f.type)
      return {
        key: f.path,
        name: f.name,
        open: () => void os.openFile(f.path),
        file: { icon: fi.icon, color: fi.color },
      }
    })
    return [...apps, ...docs]
  }, [showApps, files, open])

  // Dragging a file out to the computer (Chrome/Edge "DownloadURL") needs a URL
  // that is ready at dragstart, so prepare it when the pointer goes down.
  const blobUrls = useRef(new Map<string, string>())
  useEffect(() => () => blobUrls.current.forEach((u) => URL.revokeObjectURL(u)), [])
  const prepareDragOut = (path: string) => {
    const st = fs.stat(path)
    const key = `${path}@${st?.mtime}`
    if (!st || st.type !== 'file' || blobUrls.current.has(key) || st.size > 200 * 1024 * 1024) return
    void fs.readBytes(path).then((b) => {
      blobUrls.current.set(key, URL.createObjectURL(new Blob([b as BlobPart], { type: mimeType(path) })))
    })
  }
  const dragOut = (path: string, e: React.DragEvent) => {
    const st = fs.stat(path)
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify([path]))
    e.dataTransfer.setData('text/plain', path)
    const url = blobUrls.current.get(`${path}@${st?.mtime}`)
    if (url && st) e.dataTransfer.setData('DownloadURL', `${mimeType(path)}:${st.name}:${url}`)
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  const onItemMenu = (e: React.MouseEvent, item: Item) => {
    e.preventDefault()
    e.stopPropagation()
    setSelected(item.key)
    if (item.key.startsWith('app:')) {
      const id = item.key.slice(4)
      showContextMenu(e, [{ label: `Open ${item.name}`, onClick: () => open(id) }])
    } else showContextMenu(e, itemMenu([item.key], { onRename: (p) => setSelected(p) }))
  }

  return (
    <div
      className={`k-desktop${dropping ? ' dropping' : ''}`}
      tabIndex={-1}
      onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (e.target !== e.currentTarget) return
        showContextMenu(
          e,
          folderMenu(DESKTOP, [
            { label: 'Change wallpaper…', icon: ImageIcon, onClick: () => open('settings', { section: 'appearance' }) },
            { label: 'Settings', icon: SettingsIcon, onClick: () => open('settings') },
          ]),
        )
      }}
      onKeyDown={async (e) => {
        if (!selected || selected.startsWith('app:')) {
          if (e.key === 'Enter' && selected) items.find((i) => i.key === selected)?.open()
          return
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (await deleteItems([selected])) setSelected(null)
        } else if (e.key === 'F2') {
          const np = await renameItem(selected)
          if (np) setSelected(np)
        } else if (e.key === 'Enter') void os.openFile(selected)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(DRAG_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = e.dataTransfer.types.includes(DRAG_MIME) ? 'move' : 'copy'
          setDropping(true)
        }
      }}
      onDragLeave={(e) => e.target === e.currentTarget && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        const internal = e.dataTransfer.getData(DRAG_MIME)
        if (internal) void moveItems(JSON.parse(internal) as string[], DESKTOP)
        else if (e.dataTransfer.files.length) void os.importFiles(DESKTOP, e.dataTransfer.files)
      }}
    >
      {/* The picture sits over the theme's desktop colour; its opacity is the "transparency" setting. */}
      <div className="k-wallpaper" style={{ background, opacity: wallpaperOpacity }} />
      <div className="k-desktop-icons" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
        {items.map((item) => {
          const FileGlyph = item.file?.icon
          return (
            <button
              key={item.key}
              className={`k-desktop-icon${selected === item.key ? ' selected' : ''}`}
              title={item.name}
              draggable={!item.key.startsWith('app:')}
              onDragStart={(e) => dragOut(item.key, e)}
              onPointerDown={() => {
                setSelected(item.key)
                if (!item.key.startsWith('app:')) prepareDragOut(item.key)
              }}
              onDoubleClick={item.open}
              onKeyDown={(e) => e.key === 'Enter' && item.open()}
              onContextMenu={(e) => onItemMenu(e, item)}
            >
              {item.app ? (
                <AppIcon app={item.app} size={48} className="k-app-tile" />
              ) : FileGlyph ? (
                <span className="k-file-glyph">
                  <FileGlyph size={34} color={item.file!.color} />
                </span>
              ) : null}
              <span className="k-desktop-label">{item.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
