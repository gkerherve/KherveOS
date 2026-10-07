import { useCallback, useMemo, useState } from 'react'
import { AppWindow, ImageIcon, Info, LayoutGrid, Maximize2, Minimize2, Settings as SettingsIcon } from 'lucide-react'
import { fs, useDir } from '@/os/vfs'
import { HOME } from '@/os/path'
import { APPS } from '@/os/registry'
import { useSettings } from '@/os/settings'
import { useWindows } from '@/os/windows'
import { fileIcon } from '@/os/fileIcons'
import { showContextMenu } from '@/os/overlays'
import { DRAG_MIME, deleteItems, folderMenu, itemMenu, moveItems, renameItem } from '@/os/fileActions'
import { os } from '@/os'
import { AppIcon } from '@/os/ui/AppIcon'
import type { AppManifest } from '@/os/types'
import { wallpaperCss } from './wallpapers'
import { appGroups } from './appsMenu'
import { openLaunchpad } from './ui'
import { isFullscreen, toggleFullscreen } from '@/os/fullscreen'
import { copyMenuItems, handleClipboardKey, pasteMenuItems, usePasteSource } from '@/apps/files/clipboard'
import { endDragOut, prepareDragOut, startDragOut } from '@/apps/files/dragOut'
import { ClipboardCard, PasteProgress, showClipboardCard } from './ClipboardCard'

const DESKTOP = `${HOME}/Desktop`
/** The desktop's menus are frosted, see-through glass, like the Dock's Applications menu. */
const GLASS = { className: 'k-glass-menu' }

interface Item {
  key: string
  name: string
  open: () => void
  app?: AppManifest
  file?: { icon: React.ComponentType<{ size?: number; color?: string }>; color: string }
}

export function Desktop() {
  const wallpaperOpacity = useSettings((s) => s.wallpaperOpacity)
  const showApps = useSettings((s) => s.desktopIcons)
  const files = useDir(DESKTOP) ?? []
  // Selected icons ("app:<id>" for app shortcuts, else file paths); ⌘/Shift-click adds.
  const [selection, setSelection] = useState<string[]>([])
  const [dropping, setDropping] = useState(false)
  const [cardHeight, setCardHeight] = useState(0)
  const onCardHeight = useCallback((h: number) => setCardHeight(h), [])
  usePasteSource() // re-render the menus when the clipboard changes
  const select = (keys: string[]) => setSelection(keys)
  const selectedFiles = selection.filter((k) => !k.startsWith('app:') && fs.exists(k))
  const background = wallpaperCss()
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

  // What a drag or a right-click on this icon acts on: the selection if it is part of it.
  const dragSet = (key: string) =>
    selection.includes(key) ? selection.filter((k) => !k.startsWith('app:') && fs.exists(k)) : [key]

  const onIconPointerDown = (item: Item, e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (e.metaKey || e.ctrlKey) {
      select(selection.includes(item.key) ? selection.filter((k) => k !== item.key) : [...selection, item.key])
      return
    }
    if (e.shiftKey) {
      if (!selection.includes(item.key)) select([...selection, item.key])
    } else if (!selection.includes(item.key)) select([item.key])
    // Dragging out to the computer needs its download ready when the drag starts.
    if (!item.key.startsWith('app:')) prepareDragOut(dragSet(item.key))
  }

  const onItemMenu = (e: React.MouseEvent, item: Item) => {
    e.preventDefault()
    e.stopPropagation()
    if (item.key.startsWith('app:')) {
      select([item.key])
      const id = item.key.slice(4)
      showContextMenu(e, [{ label: `Open ${item.name}`, onClick: () => open(id) }], GLASS)
      return
    }
    const paths = dragSet(item.key)
    if (!selection.includes(item.key)) select([item.key])
    showContextMenu(e, itemMenu(paths, { onRename: (p) => select([p]), clipboard: copyMenuItems(paths) }), GLASS)
  }

  return (
    <div
      className={`k-desktop${dropping ? ' dropping' : ''}`}
      tabIndex={-1}
      onPointerDown={(e) => e.target === e.currentTarget && select([])}
      onContextMenu={(e) => {
        e.preventDefault()
        // Icons have their own menu; anywhere else on the desktop gets this one.
        if ((e.target as HTMLElement).closest('.k-desktop-icon')) return
        const full = isFullscreen()
        showContextMenu(
          e,
          folderMenu(DESKTOP, [
            { label: 'Open App', icon: AppWindow, submenu: appGroups((id) => open(id)) },
            { label: 'All Apps…', icon: LayoutGrid, onClick: openLaunchpad },
            '-',
            { label: 'Change Wallpaper…', icon: ImageIcon, onClick: () => open('settings', { section: 'appearance' }) },
            {
              label: showApps ? 'Hide App Shortcuts' : 'Show App Shortcuts',
              onClick: () => useSettings.getState().set({ desktopIcons: !showApps }),
            },
            { label: full ? 'Exit Full Screen' : 'Enter Full Screen', icon: full ? Minimize2 : Maximize2, onClick: () => void toggleFullscreen() },
            '-',
            { label: 'About Files & Clipboard', icon: Info, onClick: showClipboardCard },
            { label: 'Settings…', icon: SettingsIcon, onClick: () => open('settings') },
          ], pasteMenuItems(DESKTOP, select)),
          GLASS,
        )
      }}
      onKeyDown={async (e) => {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.closest('.k-clipcard')) return
        if (handleClipboardKey(e, selectedFiles, DESKTOP, select)) return
        const mod = e.metaKey || e.ctrlKey
        if (mod && e.key.toLowerCase() === 'a') {
          e.preventDefault()
          select(items.map((i) => i.key))
        } else if (e.key === 'Enter') {
          selection.forEach((k) => items.find((i) => i.key === k)?.open())
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFiles.length) {
          if (await deleteItems(selectedFiles)) select([])
        } else if (e.key === 'F2' && selectedFiles.length === 1) {
          const np = await renameItem(selectedFiles[0])
          if (np) select([np])
        }
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
      <ClipboardCard desktop={DESKTOP} onHeight={onCardHeight} />
      <PasteProgress />
      <div
        className="k-desktop-icons"
        style={cardHeight ? { top: 24 + 10 + cardHeight } : undefined}
        onPointerDown={(e) => e.target === e.currentTarget && select([])}
      >
        {items.map((item) => {
          const FileGlyph = item.file?.icon
          return (
            <button
              key={item.key}
              className={`k-desktop-icon${selection.includes(item.key) ? ' selected' : ''}`}
              title={item.name}
              draggable={!item.key.startsWith('app:')}
              onDragStart={(e) => startDragOut(dragSet(item.key), e)}
              onDragEnd={endDragOut}
              onPointerDown={(e) => onIconPointerDown(item, e)}
              onClick={(e) => {
                // A plain click (not a drag) inside a multiple selection selects just this one, like macOS.
                if (!e.metaKey && !e.ctrlKey && !e.shiftKey && selection.length > 1) select([item.key])
              }}
              onDoubleClick={item.open}
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
