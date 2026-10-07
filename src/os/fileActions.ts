// File operations shared by the desktop and the Files app, with their
// confirmations and right-click menus.

import {
  AppWindow, Copy, Download, ExternalLink, FilePlus, FolderPlus, Pencil, SquareTerminal, Trash2, Upload,
} from 'lucide-react'
import { zip, type AsyncZippable } from 'fflate'
import { fs, FsError } from './vfs'
import { basename, dirname, join } from './path'
import { dialog } from './overlays'
import { useWindows } from './windows'
import { APPS } from './registry'
import type { MenuItem } from './ui/Menu'
import { os } from './index'

/** Drag-and-drop type for files dragged within KherveOS (a JSON array of paths). */
export const DRAG_MIME = 'application/x-kherveos-paths'

async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    await dialog.alert(e instanceof FsError ? e.message : String(e), { title: 'Something went wrong' })
    return undefined
  }
}

export async function newFolder(dir: string): Promise<string | null> {
  const name = await dialog.prompt('Name of the new folder:', { title: 'New folder', defaultValue: fs.uniqueName(dir, 'New folder') })
  if (!name?.trim()) return null
  const path = join(dir, name.trim())
  await guard(() => fs.mkdir(path))
  return fs.isDir(path) ? path : null
}

export async function newTextFile(dir: string): Promise<string | null> {
  const name = await dialog.prompt('Name of the new file:', {
    title: 'New text file', defaultValue: fs.uniqueName(dir, 'Untitled.txt'), selectStem: true,
  })
  if (!name?.trim()) return null
  const path = join(dir, name.trim())
  if (fs.exists(path)) {
    await dialog.alert(`"${name}" already exists.`)
    return null
  }
  await guard(() => fs.writeText(path, ''))
  return fs.exists(path) ? path : null
}

export async function renameItem(path: string): Promise<string | null> {
  const old = basename(path)
  const name = await dialog.prompt(`New name for "${old}":`, { title: 'Rename', defaultValue: old, selectStem: fs.isFile(path) })
  if (!name?.trim() || name.trim() === old) return null
  if (name.includes('/')) {
    await dialog.alert('Names cannot contain "/".')
    return null
  }
  const target = join(dirname(path), name.trim())
  await guard(() => fs.rename(path, target))
  return fs.exists(target) ? target : null
}

export async function deleteItems(paths: string[]): Promise<boolean> {
  if (!paths.length) return false
  const what = paths.length === 1 ? `"${basename(paths[0])}"` : `these ${paths.length} items`
  const folderInside = paths.some((p) => fs.isDir(p) && fs.list(p).length > 0)
  const ok = await dialog.confirm(
    `Delete ${what}?${folderInside ? ' Folders are deleted with everything in them.' : ''} This cannot be undone.`,
    { title: 'Delete', okLabel: 'Delete', danger: true },
  )
  if (!ok) return false
  for (const p of paths) await guard(() => fs.remove(p, { recursive: true }))
  return true
}

export async function duplicateItem(path: string): Promise<void> {
  const target = join(dirname(path), fs.uniqueName(dirname(path), basename(path)))
  await guard(() => fs.copy(path, target))
}

/** Move items into a folder (drag and drop). */
export async function moveItems(paths: string[], dir: string): Promise<void> {
  for (const p of paths) {
    if (dirname(p) === dir) continue
    const target = join(dir, fs.uniqueName(dir, basename(p)))
    await guard(() => fs.rename(p, target))
  }
}

/** Every file and folder in `paths` (folders with all they hold), named relative to their parents. */
export function collectItems(paths: string[]): { path: string; rel: string; type: 'file' | 'dir'; size: number }[] {
  const out: { path: string; rel: string; type: 'file' | 'dir'; size: number }[] = []
  for (const p of paths) {
    const st = fs.stat(p)
    if (!st) continue
    out.push({ path: p, rel: st.name, type: st.type, size: st.size })
    if (st.type === 'dir') {
      const base = dirname(p) === '/' ? 1 : dirname(p).length + 1
      for (const s of fs.walk(p)) out.push({ path: s.path, rel: s.path.slice(base), type: s.type, size: s.size })
    }
  }
  return out
}

/**
 * Zip files and folders (keeping the folders, empty ones too). `level` 0 only
 * stores (fast, for drag-out); 6 compresses (for sending over the network).
 */
export async function zipItems(
  paths: string[],
  opts: { level?: 0 | 1 | 6; onProgress?: (done: number, total: number) => void; cancelled?: () => boolean } = {},
): Promise<Uint8Array> {
  const items = collectItems(paths)
  const total = items.reduce((n, i) => n + (i.type === 'file' ? i.size : 0), 0)
  const entries: AsyncZippable = {}
  let done = 0
  for (const it of items) {
    if (opts.cancelled?.()) throw new Error('cancelled')
    if (it.type === 'dir') entries[`${it.rel}/`] = new Uint8Array(0)
    else {
      entries[it.rel] = await fs.readBytes(it.path)
      done += it.size
      opts.onProgress?.(done, total)
    }
  }
  return new Promise((ok, fail) => zip(entries, { level: opts.level ?? 6 }, (err, data) => (err ? fail(err) : ok(data))))
}

/** The name for a zip of these items: "Folder.zip", "Archive.zip". */
export function zipName(paths: string[]): string {
  return paths.length === 1 ? `${basename(paths[0])}.zip` : 'Archive.zip'
}

/** Download to the computer: a file as itself, a folder or several items as one zip. */
export async function downloadItems(paths: string[]): Promise<void> {
  const existing = paths.filter((p) => fs.exists(p))
  if (!existing.length) return
  if (existing.length === 1 && fs.isFile(existing[0])) {
    await guard(() => os.download(existing[0]))
    return
  }
  await guard(async () => {
    const data = await zipItems(existing, { level: 1 })
    os.downloadBlob(zipName(existing), new Blob([data as BlobPart], { type: 'application/zip' }))
  })
}

/** Right-click menu for selected files/folders. */
export function itemMenu(
  paths: string[],
  opts: { onRename?: (newPath: string) => void; clipboard?: MenuItem[] } = {},
): MenuItem[] {
  const single = paths.length === 1 ? paths[0] : null
  const isFile = single ? fs.isFile(single) : false
  const openWith: MenuItem[] = single && isFile
    ? APPS.filter((a) => a.fileTypes?.length).map((a) => ({ label: a.name, icon: a.icon, onClick: () => os.open(a.id, { path: single }) }))
    : []
  return [
    { label: 'Open', icon: ExternalLink, onClick: () => paths.forEach((p) => void os.openFile(p)) },
    ...(openWith.length ? [{ label: 'Open with', icon: AppWindow, submenu: openWith } as MenuItem] : []),
    ...(single && fs.isDir(single)
      ? [{ label: 'Open in Terminal', icon: SquareTerminal, onClick: () => os.open('terminal', { path: single }) } as MenuItem]
      : []),
    '-',
    { label: 'Rename…', icon: Pencil, disabled: !single, shortcut: 'F2', onClick: async () => {
      const np = single && (await renameItem(single))
      if (np) opts.onRename?.(np)
    } },
    { label: 'Duplicate', icon: Copy, disabled: !single, onClick: () => single && void duplicateItem(single) },
    { label: 'Download', icon: Download, onClick: () => void downloadItems(paths) },
    ...(opts.clipboard?.length ? (['-', ...opts.clipboard] as MenuItem[]) : []),
    '-',
    { label: 'Delete', icon: Trash2, danger: true, shortcut: 'Del', onClick: () => void deleteItems(paths) },
  ]
}

/** Right-click menu for the empty space of a folder (or the desktop). */
export function folderMenu(dir: string, extra: MenuItem[] = [], clipboard: MenuItem[] = []): MenuItem[] {
  return [
    ...(clipboard.length ? ([...clipboard, '-'] as MenuItem[]) : []),
    { label: 'New folder', icon: FolderPlus, onClick: () => void newFolder(dir) },
    { label: 'New text file', icon: FilePlus, onClick: async () => {
      const p = await newTextFile(dir)
      if (p) useWindows.getState().open('notepad', { path: p })
    } },
    { label: 'Upload files…', icon: Upload, onClick: () => void os.upload(dir) },
    { label: 'Open in Terminal', icon: SquareTerminal, onClick: () => os.open('terminal', { path: dir }) },
    ...(extra.length ? (['-', ...extra] as MenuItem[]) : []),
  ]
}
