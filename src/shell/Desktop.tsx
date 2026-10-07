import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, ArrowDownUp, ImageIcon, Info, LayoutGrid, Magnet, Maximize2, Minimize2, Settings as SettingsIcon, Sparkles } from 'lucide-react'
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
import { arrangeInOrder, cleanUp, layout, moveIcons, sortItems, type Area, type SortKey } from './desktopLayout'
import { prunePositions, renamePosition, useDesktopArrange } from './desktopArrange'
import { extname } from '@/os/path'
import './desktopIcons.css'

const DESKTOP = `${HOME}/Desktop`
/** The desktop's menus are frosted, see-through glass, like the Dock's Applications menu. */
const GLASS = { className: 'k-glass-menu' }
/** Drag type of an app shortcut being moved on the desktop (it has no file to carry). */
const ICON_MIME = 'application/x-kherveos-desktop-icon'

/** The icon drag in progress, if it started on the desktop: what moves and where the pointer was. */
let iconDrag: { keys: string[]; x: number; y: number } | null = null

interface Item {
  key: string
  name: string
  /** For Sort By: "Application", "Folder" or the file's extension; last modified. */
  kind: string
  date: number
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
  const wallpaperFit = useSettings((s) => s.wallpaperFit)
  const background = wallpaperCss(wallpaperFit)
  const open = useWindows((s) => s.open)

  const items: Item[] = useMemo(() => {
    const apps: Item[] = showApps
      ? APPS.filter((a) => a.desktop).map((a) => ({
          key: `app:${a.id}`,
          name: a.name,
          open: () => open(a.id),
          app: a,
          kind: 'Application',
          date: 0,
        }))
      : []
    const docs: Item[] = files.filter((f) => !f.name.startsWith('.')).map((f) => {
      const fi = fileIcon(f.path, f.type)
      return {
        key: f.path,
        name: f.name,
        open: () => void os.openFile(f.path),
        kind: f.type === 'dir' ? 'Folder' : extname(f.name).toLowerCase() || 'Document',
        date: f.mtime,
        file: { icon: fi.icon, color: fi.color },
      }
    })
    return [...apps, ...docs]
  }, [showApps, files, open])

  // ---- arranging: every icon has a place, saved; dragged icons snap to the grid.
  const iconsRef = useRef<HTMLDivElement>(null)
  const [area, setArea] = useState<Area>({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = iconsRef.current
    if (!el) return
    const measure = () => setArea({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const saved = useDesktopArrange((s) => s.positions)
  const snap = useDesktopArrange((s) => s.snap)
  const keys = useMemo(() => items.map((i) => i.key), [items])
  const positions = useMemo(() => (area.h ? layout(keys, saved, area) : {}), [keys, saved, area])
  // New icons keep the place they were given; icons of files that are gone are forgotten.
  useEffect(() => {
    if (!area.h) return
    const fresh = Object.fromEntries(keys.filter((k) => !saved[k]).map((k) => [k, positions[k]]))
    if (Object.keys(fresh).length) useDesktopArrange.getState().setPositions(fresh)
    prunePositions(new Set(keys))
  }, [keys, saved, positions, area.h])
  // A file renamed on the desktop stays where it was.
  useEffect(
    () =>
      fs.watch((ev) => {
        if (ev.type === 'rename' && ev.oldPath.startsWith(`${DESKTOP}/`) && ev.path.startsWith(`${DESKTOP}/`)) renamePosition(ev.oldPath, ev.path)
      }),
    [],
  )
  const arrange = (next: Record<string, { x: number; y: number }>) => useDesktopArrange.getState().setPositions(next)
  const cleanUpIcons = () => arrange(cleanUp(keys, positions, area))
  const sortIcons = (by: SortKey) => arrange(arrangeInOrder(sortItems(items, by), area))

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
            { label: 'Clean Up', icon: Sparkles, onClick: cleanUpIcons, disabled: !items.length },
            {
              label: 'Sort By',
              icon: ArrowDownUp,
              disabled: !items.length,
              submenu: [
                { label: 'Name', onClick: () => sortIcons('name') },
                { label: 'Kind', onClick: () => sortIcons('kind') },
                { label: 'Date Modified', onClick: () => sortIcons('date') },
              ],
            },
            { label: 'Snap to Grid', icon: Magnet, checked: snap, onClick: () => useDesktopArrange.getState().setSnap(!snap) },
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
        const types = e.dataTransfer.types
        if (iconDrag && types.includes(ICON_MIME)) {
          // Moving icons around the desktop: no "drop here" highlight.
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        } else if (types.includes('Files') || types.includes(DRAG_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = types.includes(DRAG_MIME) ? 'move' : 'copy'
          setDropping(true)
        }
      }}
      onDragLeave={(e) => e.target === e.currentTarget && setDropping(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropping(false)
        if (iconDrag && e.dataTransfer.types.includes(ICON_MIME)) {
          const { keys: moving, x, y } = iconDrag
          iconDrag = null
          arrange(moveIcons(moving, e.clientX - x, e.clientY - y, positions, area, snap))
          return
        }
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
        ref={iconsRef}
        className="k-desktop-icons k-arranged"
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
              style={positions[item.key] ? { right: positions[item.key].x, top: positions[item.key].y } : { visibility: 'hidden' }}
              draggable
              onDragStart={(e) => {
                const files = dragSet(item.key)
                if (files.length) startDragOut(files, e)
                else e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData(ICON_MIME, item.key)
                // Everything selected moves together (app shortcuts too), keeping its arrangement.
                const moving = selection.includes(item.key) ? selection.filter((k) => positions[k]) : [item.key]
                iconDrag = { keys: moving, x: e.clientX, y: e.clientY }
              }}
              onDragEnd={(e) => {
                iconDrag = null
                endDragOut(e)
              }}
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
