// Dragging files out of KherveOS onto the computer (its desktop, a Finder or
// Explorer window) downloads them. Used by Files and by the KherveOS desktop.
//
// Chrome and Edge do it with a "DownloadURL" drag type ("mime:name:url"). The
// URL must be ready *when the drag starts* (dragstart cannot wait), so it is
// prepared as soon as the pointer goes down: a blob URL of the file, or of a
// zip when several items or a folder are dragged (only one DownloadURL is
// allowed per drag). Other browsers (Safari, Firefox) cannot hand a file to
// the computer: there, letting go outside the browser window downloads it
// instead, as does a Chrome drag whose URL was not ready in time.

import type { DragEvent } from 'react'
import { fs, os } from '@/os'
import { mimeType } from '@/os/fileIcons'
import { DRAG_MIME, collectItems, downloadItems, zipItems, zipName } from '@/os/fileActions'
import { downloadUrlData, supportsDownloadUrl } from './pasteLogic'

const LIMIT = 200 * 1024 * 1024
const KEEP = 8
export const canDragOut = supportsDownloadUrl(navigator.userAgent)

interface Prepared {
  url: string
  name: string
  mime: string
}

// Ready URLs by a signature of what they hold (paths + sizes + dates), newest last.
const ready = new Map<string, Prepared>()
const pending = new Set<string>()

function signature(paths: string[]): string | null {
  const items = collectItems(paths)
  if (!items.length) return null
  if (items.reduce((n, i) => n + i.size, 0) > LIMIT) return null
  return items.map((i) => `${i.path}|${i.size}|${fs.stat(i.path)?.mtime}`).join('\n')
}

function remember(key: string, p: Prepared) {
  ready.set(key, p)
  while (ready.size > KEEP) {
    const [oldKey, old] = ready.entries().next().value as [string, Prepared]
    ready.delete(oldKey)
    // The computer may still be fetching it from a drop a moment ago.
    setTimeout(() => URL.revokeObjectURL(old.url), 60_000)
  }
}

/** Get a download URL ready for dragging these items out (call on pointerdown). */
export function prepareDragOut(paths: string[]): void {
  if (!canDragOut || !paths.length) return
  const key = signature(paths)
  if (!key || ready.has(key) || pending.has(key)) return
  pending.add(key)
  const single = paths.length === 1 && fs.isFile(paths[0]) ? paths[0] : null
  const make = single
    ? fs.readBytes(single).then((b) => ({ data: b, name: fs.stat(single)?.name ?? 'file', mime: mimeType(single) }))
    : zipItems(paths, { level: 0 }).then((b) => ({ data: b, name: zipName(paths), mime: 'application/zip' }))
  void make
    .then(({ data, name, mime }) => {
      remember(key, { url: URL.createObjectURL(new Blob([data as BlobPart], { type: mime })), name, mime })
    })
    .catch(() => {})
    .finally(() => pending.delete(key))
}

// Did the pointer leave the browser window during the drag? (for the fallback)
let leftWindow = false
let draggingOut: { paths: string[]; withUrl: boolean } | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('dragleave', (e) => {
    if (draggingOut && !e.relatedTarget) leftWindow = true
  })
  window.addEventListener('dragenter', () => {
    if (draggingOut) leftWindow = false
  })
}

/** Fill the drag data at dragstart: KherveOS paths for inside, a DownloadURL for outside. */
export function startDragOut(paths: string[], e: DragEvent): void {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(paths))
  e.dataTransfer.effectAllowed = 'copyMove'
  let withUrl = false
  if (canDragOut) {
    // Safari turns dragged text into a "text clipping" file: only give it where Finder takes the URL.
    e.dataTransfer.setData('text/plain', paths.join('\n'))
    const key = signature(paths)
    const p = key ? ready.get(key) : undefined
    if (p) {
      e.dataTransfer.setData('DownloadURL', downloadUrlData(p.mime, p.name, p.url))
      withUrl = true
    }
  }
  draggingOut = { paths, withUrl }
  leftWindow = false
}

/** At dragend: a drop outside the window that nothing took downloads the items instead. */
export function endDragOut(e: DragEvent): void {
  const drag = draggingOut
  draggingOut = null
  if (!drag || drag.withUrl || e.dataTransfer.dropEffect !== 'none' || !leftWindow) return
  const { clientX: x, clientY: y } = e
  // Firefox reports 0,0 at dragend; otherwise the point must be outside the page.
  const outside = (x === 0 && y === 0) || x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight
  if (!outside) return
  leftWindow = false
  const existing = drag.paths.filter((p) => fs.exists(p))
  if (existing.length) {
    os.notify({ title: existing.length === 1 ? `Downloading ${fs.stat(existing[0])?.name}` : `Downloading ${zipName(existing)}`, timeout: 3000 })
    void downloadItems(existing)
  }
}
