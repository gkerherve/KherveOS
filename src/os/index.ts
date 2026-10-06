// The one import apps need:  import { os } from '@/os'
//
//   os.open('notepad', { path })      open an app (args are app-specific)
//   os.openFile(path)                 open a file with its default app
//   os.fs                             the virtual file system (see vfs.ts)
//   os.dialog.alert/confirm/prompt/openFile/saveFile/pickFolder
//   os.notify({ title, body })        a notification toast
//   os.contextMenu(event, items)      a right-click menu
//   os.download(path) / os.upload(dir)  move files between the drive and the computer

import { fs } from './vfs'
import { useWindows } from './windows'
import { APPS, appForExtension, getApp } from './registry'
import { dialog, notify, showContextMenu } from './overlays'
import { basename, extname, join } from './path'
import { mimeType } from './fileIcons'
import type { AppArgs } from './types'

export { fs, FsError, useDir, useFsVersion, formatSize } from './vfs'
export type { Stat, FsEvent } from './vfs'
export * as path from './path'
export { HOME } from './path'
export type { AppProps, AppArgs, WindowApi, AppManifest } from './types'
export type { MenuItem, MenuBarMenu } from './ui/Menu'

function open(appId: string, args: AppArgs = {}): string | null {
  return useWindows.getState().open(appId, args)
}

/** Open a file (or folder) with the app that handles it. */
async function openFile(path: string): Promise<void> {
  const st = fs.stat(path)
  if (!st) {
    await dialog.alert(`"${path}" doesn't exist any more.`)
    return
  }
  if (st.type === 'dir') {
    open('files', { path })
    return
  }
  const app = appForExtension(extname(path))
  if (app) {
    open(app.id, { path })
    return
  }
  const choice = await dialog.confirm(`KherveOS has no app for "${basename(path)}" yet. Open it as text in Notepad?`, {
    title: 'Open file',
    okLabel: 'Open in Notepad',
  })
  if (choice) open('notepad', { path })
}

/** Apps that can open this file (default first). */
function appsFor(path: string) {
  const ext = extname(path)
  return APPS.filter((a) => a.fileTypes?.includes(ext))
}

/** Save a file from the drive to the computer's Downloads folder. */
async function download(path: string): Promise<void> {
  const data = await fs.readBytes(path)
  downloadBlob(basename(path), new Blob([data as BlobPart], { type: mimeType(path) }))
}

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Copy real files from the computer into a folder on the drive. */
async function importFiles(dir: string, files: Iterable<File>): Promise<string[]> {
  const written: string[] = []
  for (const f of files) {
    const name = fs.uniqueName(dir, f.name)
    const target = join(dir, name)
    await fs.writeBytes(target, new Uint8Array(await f.arrayBuffer()))
    written.push(target)
  }
  if (written.length) {
    notify({ title: written.length === 1 ? `Added ${basename(written[0])}` : `Added ${written.length} files`, body: dir })
  }
  return written
}

/** Ask for files from the computer and copy them into `dir`. */
function upload(dir: string): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async () => resolve(await importFiles(dir, input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })
}

export const os = {
  open,
  openFile,
  appsFor,
  getApp,
  fs,
  dialog,
  notify,
  contextMenu: showContextMenu,
  download,
  downloadBlob,
  upload,
  importFiles,
}
