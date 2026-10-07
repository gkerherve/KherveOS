// The file clipboard: Copy / Cut / Paste of files and folders, in Files and on
// the KherveOS desktop.
//
// On this computer: the clipboard holds paths on the drive (it is kept in
// localStorage, so every KherveOS tab of this browser shares it). Nothing is
// read until Paste.
//
// Between computers: when signed in to the KherveOS server, Copy also zips the
// items and uploads them to the user's server clipboard (one per user, replaced
// by each Copy, ~100 MB). The server tells the user's other tabs and computers
// ("clipboard.changed"), and Paste there unzips them. The newest copy wins.

import { create } from 'zustand'
import { unzip } from 'fflate'
import { ClipboardPaste, Copy, Scissors, Trash2 } from 'lucide-react'
import { fs, os, path, formatSize, type MenuItem } from '@/os'
import { api, ApiError, realtime, useAuth } from '@/os/server'
import { collectItems, zipItems } from '@/os/fileActions'
import { copyName, deviceName, pasteLabel, pickClipboard, planPaste, safeZipPath, zipTopLevel } from './pasteLogic'

const STORE_KEY = 'kherveos.fileClipboard'
const DEVICE_KEY = 'kherveos.deviceId'
/** The server refuses more (see server/kherveos_server/clipboard.py). */
export const SERVER_LIMIT = 100 * 1024 * 1024

export interface LocalClip {
  mode: 'copy' | 'cut'
  paths: string[]
  time: number
}

export interface ServerClip {
  id: string
  created_at: number
  device_id: string
  device: string
  items: { name: string; type: 'file' | 'dir' }[]
  files: number
  folders: number
  size: number
}

export interface Progress {
  title: string
  detail?: string
  done: number
  total: number
  cancel?: () => void
}

interface ClipState {
  local: LocalClip | null
  server: ServerClip | null
  /** Upload of the last Copy to the server, while it runs. */
  uploading: { done: number; total: number } | null
  /** A paste (or download) in progress, shown by the progress panel. */
  progress: Progress | null
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function loadLocal(): LocalClip | null {
  try {
    const raw = storage()?.getItem(STORE_KEY)
    const v = raw ? (JSON.parse(raw) as LocalClip) : null
    return v && Array.isArray(v.paths) && (v.mode === 'copy' || v.mode === 'cut') ? v : null
  } catch {
    return null
  }
}

function saveLocal(v: LocalClip | null) {
  try {
    if (v) storage()?.setItem(STORE_KEY, JSON.stringify(v))
    else storage()?.removeItem(STORE_KEY)
  } catch {
    /* private window: the clipboard just isn't shared between tabs */
  }
}

function makeDeviceId(): string {
  try {
    const s = storage()
    let id = s?.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, '')
      s?.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID().replace(/-/g, '')
  }
}

export const DEVICE_ID = makeDeviceId()
export const DEVICE_NAME = deviceName(navigator.userAgent)

export const useClipboard = create<ClipState>(() => ({
  local: loadLocal(),
  server: null,
  uploading: null,
  progress: null,
}))

function setLocal(local: LocalClip | null) {
  saveLocal(local)
  useClipboard.setState({ local })
}

// Other tabs of this browser copying or pasting.
window.addEventListener('storage', (e) => {
  if (e.key === STORE_KEY) useClipboard.setState({ local: loadLocal() })
})

// ------------------------------------------------------------ server sync

async function fetchServer() {
  try {
    const r = await api<{ clipboard: ServerClip | null }>('/clipboard')
    useClipboard.setState({ server: r.clipboard })
  } catch {
    /* server without the clipboard module, or offline */
  }
}

useAuth.subscribe((s, prev) => {
  if (s.user && s.user.id !== prev.user?.id) void fetchServer()
  if (!s.user) useClipboard.setState({ server: null })
})
if (useAuth.getState().user) void fetchServer()

realtime.on('clipboard.changed', (ev) => {
  const clip = (ev.clipboard as ServerClip | null) ?? null
  useClipboard.setState({ server: clip })
  if (clip && clip.device_id !== DEVICE_ID && document.visibilityState === 'visible') {
    os.notify({
      title: `Copied on ${clip.device}`,
      body: `${describe(clip.items)} — press ⌘V in a folder to paste here.`,
      icon: ClipboardPaste,
      timeout: 5000,
    })
  }
})
// Coming back online (the socket reconnects): catch up on a copy made meanwhile.
realtime.on('hello', () => void fetchServer())

function describe(items: { name: string }[]): string {
  return items.length === 1 ? `"${items[0].name}"` : `${items.length} items`
}

let uploadXhr: XMLHttpRequest | null = null
/** Each upload's number; a newer Copy (or Clear) makes older uploads stop. */
let uploadRun = 0

function stopUpload() {
  uploadRun++
  uploadXhr?.abort()
  uploadXhr = null
  useClipboard.setState({ uploading: null })
}

/** Send a copy to the server clipboard (signed in only). */
async function upload(paths: string[]) {
  stopUpload()
  const run = uploadRun
  const still = () => run === uploadRun
  const items = collectItems(paths)
  const total = items.reduce((n, i) => n + (i.type === 'file' ? i.size : 0), 0)
  if (total > SERVER_LIMIT) {
    os.notify({
      title: 'Copied on this computer only',
      body: `${formatSize(total)} is too big for the shared clipboard (${formatSize(SERVER_LIMIT)} at most).`,
    })
    return
  }
  useClipboard.setState({ uploading: { done: 0, total: total || 1 } })
  try {
    const data = await zipItems(paths, { level: 6, cancelled: () => !still() })
    if (!still()) return
    await new Promise<void>((ok, fail) => {
      const xhr = new XMLHttpRequest()
      uploadXhr = xhr
      const q = new URLSearchParams({ device_id: DEVICE_ID, device: DEVICE_NAME })
      xhr.open('PUT', `/api/clipboard?${q}`)
      xhr.withCredentials = true
      xhr.setRequestHeader('Content-Type', 'application/zip')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) useClipboard.setState({ uploading: { done: e.loaded, total: e.total } })
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (!still()) return ok()
          try {
            useClipboard.setState({ server: (JSON.parse(xhr.responseText) as { clipboard: ServerClip }).clipboard })
          } catch {
            /* the websocket event brings it too */
          }
          ok()
        } else {
          let msg = `Upload failed (${xhr.status})`
          try {
            msg = (JSON.parse(xhr.responseText) as { detail?: string }).detail ?? msg
          } catch {
            /* keep the status */
          }
          fail(new Error(msg))
        }
      }
      xhr.onerror = () => fail(new Error('The KherveOS server is not reachable.'))
      xhr.onabort = () => ok()
      xhr.send(new Blob([data as BlobPart], { type: 'application/zip' }))
    })
  } catch (e) {
    if (still() && (e as Error).message !== 'cancelled') {
      os.notify({ title: 'Copied on this computer only', body: `Not shared with your other computers: ${(e as Error).message}` })
    }
  } finally {
    if (still()) useClipboard.setState({ uploading: null })
  }
}

// ------------------------------------------------------------ actions

export function copyItems(paths: string[]) {
  const list = paths.filter((p) => fs.exists(p))
  if (!list.length) return
  setLocal({ mode: 'copy', paths: list, time: Date.now() })
  if (useAuth.getState().user) void upload(list)
}

export function cutItems(paths: string[]) {
  const list = paths.filter((p) => fs.exists(p))
  if (!list.length) return
  // A cut is a move on this computer: it is not sent to the server.
  setLocal({ mode: 'cut', paths: list, time: Date.now() })
}

/** Forget the clipboard here and, when signed in, on the server too. */
export async function clearClipboard() {
  stopUpload()
  setLocal(null)
  if (useClipboard.getState().server && useAuth.getState().user) {
    try {
      await api('/clipboard', { method: 'DELETE' })
    } catch (e) {
      os.notify({ title: 'Could not clear the shared clipboard', body: e instanceof ApiError ? e.message : String(e) })
      return
    }
  }
  useClipboard.setState({ server: null })
}

/** Which clipboard Paste would use, and how to label it. */
export function pasteSource(st: Pick<ClipState, 'local' | 'server'> = useClipboard.getState()) {
  const local = st.local ? { ...st.local, paths: st.local.paths.filter((p) => fs.exists(p)) } : null
  const usable = local?.paths.length ? local : null
  const server = st.server ? { time: st.server.created_at * 1000, deviceId: st.server.device_id } : null
  const which = pickClipboard(usable, server, DEVICE_ID)
  if (which === 'server' && st.server) {
    return { which, count: st.server.items.length, label: pasteLabel(st.server.items.length, st.server.device), local: null, server: st.server }
  }
  if (which === 'local' && usable) {
    return { which, count: usable.paths.length, label: pasteLabel(usable.paths.length), local: usable, server: null }
  }
  return { which: null, count: 0, label: 'Paste', local: null, server: null }
}

/** Re-render on clipboard changes (and drive changes, since copied items may vanish). */
export function usePasteSource() {
  const local = useClipboard((s) => s.local)
  const server = useClipboard((s) => s.server)
  return pasteSource({ local, server })
}

function setProgress(p: Progress | null) {
  useClipboard.setState({ progress: p })
}

/** Paste into a folder. Returns the new paths (to select them). */
export async function pasteInto(dir: string): Promise<string[]> {
  if (useClipboard.getState().progress) {
    os.notify({ title: 'Already pasting', body: 'Wait for the current paste to finish.' })
    return []
  }
  const src = pasteSource()
  try {
    if (src.which === 'local' && src.local) return await pasteLocal(src.local, dir)
    if (src.which === 'server' && src.server) return await pasteServer(src.server, dir)
  } catch (e) {
    if ((e as Error).message !== 'cancelled') {
      await os.dialog.alert(e instanceof Error ? e.message : String(e), { title: 'Paste failed' })
    }
  } finally {
    setProgress(null)
  }
  return []
}

async function pasteLocal(clip: LocalClip, dir: string): Promise<string[]> {
  const plan = planPaste(clip.paths, dir, clip.mode, (p) => fs.exists(p), (p) => fs.isDir(p))
  if (plan.skipped.some((s) => s.reason === 'into-itself')) {
    await os.dialog.alert('A folder cannot be pasted into itself.', { title: 'Paste' })
  }
  if (!plan.steps.length) return []
  if (clip.mode === 'cut') {
    // Moving within the drive is instant: no bytes are copied.
    for (const s of plan.steps) await fs.rename(s.from, s.to)
    setLocal(null)
    return plan.steps.map((s) => s.to)
  }
  let cancelled = false
  const items = collectItems(plan.steps.map((s) => s.from))
  const total = items.reduce((n, i) => n + (i.type === 'file' ? i.size : 0), 0)
  let done = 0
  const title = `Copying ${plan.steps.length === 1 ? `"${path.basename(plan.steps[0].from)}"` : `${plan.steps.length} items`} to "${path.basename(dir) || '/'}"`
  const report = (detail?: string) => setProgress({ title, detail, done, total: total || 1, cancel: () => (cancelled = true) })
  report()
  for (const step of plan.steps) {
    for (const it of collectItems([step.from])) {
      if (cancelled) throw new Error('cancelled')
      const target = step.to + it.path.slice(step.from.length)
      if (it.type === 'dir') await fs.mkdir(target, { recursive: true })
      else {
        await fs.writeBytes(target, await fs.readBytes(it.path))
        done += it.size
        report(it.rel.slice(0, 80))
      }
    }
  }
  return plan.steps.map((s) => s.to)
}

async function pasteServer(clip: ServerClip, dir: string): Promise<string[]> {
  let cancelled = false
  const ctrl = new AbortController()
  const title = `Pasting from ${clip.device}`
  setProgress({ title, detail: 'Downloading…', done: 0, total: clip.size || 1, cancel: () => { cancelled = true; ctrl.abort() } })
  let res: Response
  try {
    res = await fetch('/api/clipboard/data', { credentials: 'same-origin', signal: ctrl.signal })
  } catch {
    if (cancelled) throw new Error('cancelled')
    throw new Error('The KherveOS server is not reachable.')
  }
  if (res.status === 404) {
    useClipboard.setState({ server: null })
    throw new Error('The shared clipboard is empty now (it was cleared or replaced).')
  }
  if (!res.ok) throw new Error(`Could not download the shared clipboard (${res.status}).`)
  const length = Number(res.headers.get('Content-Length')) || 0
  const chunks: Uint8Array[] = []
  let got = 0
  const reader = res.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.byteLength
      if (length) setProgress({ title, detail: 'Downloading…', done: got, total: length, cancel: () => { cancelled = true; ctrl.abort() } })
    }
  } else chunks.push(new Uint8Array(await res.arrayBuffer()))
  if (cancelled) throw new Error('cancelled')
  const zipped = new Uint8Array(got || chunks.reduce((n, c) => n + c.byteLength, 0))
  let off = 0
  for (const c of chunks) {
    zipped.set(c, off)
    off += c.byteLength
  }
  const entries = await new Promise<Record<string, Uint8Array>>((ok, fail) => unzip(zipped, (err, data) => (err ? fail(err) : ok(data))))
  // Rename the top-level items that clash, like a local copy.
  const renamed = new Map<string, string>()
  const planned = new Set<string>()
  for (const top of zipTopLevel(Object.keys(entries))) {
    const name = copyName(top.name, top.isDir, (n) => planned.has(n) || fs.exists(path.join(dir, n)))
    planned.add(name)
    renamed.set(top.name, name)
  }
  const names = Object.keys(entries)
  const total = names.reduce((n, k) => n + entries[k].byteLength, 0)
  let done = 0
  const report = (detail?: string) =>
    setProgress({ title, detail, done, total: total || 1, cancel: () => (cancelled = true) })
  for (const raw of names) {
    if (cancelled) throw new Error('cancelled')
    const rel = safeZipPath(raw)
    if (!rel) continue
    const slash = rel.indexOf('/')
    const first = slash < 0 ? rel : rel.slice(0, slash)
    const target = path.join(dir, renamed.get(first) ?? first, slash < 0 ? '' : rel.slice(slash + 1))
    if (raw.endsWith('/')) await fs.mkdir(target, { recursive: true })
    else {
      await fs.writeBytes(target, entries[raw], { mkdirs: true })
      done += entries[raw].byteLength
      report(rel.slice(0, 80))
    }
  }
  return [...renamed.values()].map((n) => path.join(dir, n))
}

// ------------------------------------------------------------ menus

const plural = (n: number) => (n === 1 ? 'Item' : `${n} Items`)

/** Cut / Copy for selected items (right-click and Edit menus). */
export function copyMenuItems(paths: string[]): MenuItem[] {
  return [
    { label: `Cut ${plural(paths.length)}`, icon: Scissors, shortcut: '⌘X', disabled: !paths.length, onClick: () => cutItems(paths) },
    { label: `Copy ${plural(paths.length)}`, icon: Copy, shortcut: '⌘C', disabled: !paths.length, onClick: () => copyItems(paths) },
  ]
}

/** Paste (into `dir`) and, when there is something, Clear Clipboard. */
export function pasteMenuItems(dir: string, onPasted?: (paths: string[]) => void): MenuItem[] {
  const src = pasteSource()
  const st = useClipboard.getState()
  return [
    {
      label: src.label,
      icon: ClipboardPaste,
      shortcut: '⌘V',
      disabled: !src.which,
      onClick: async () => {
        const out = await pasteInto(dir)
        if (out.length) onPasted?.(out)
      },
    },
    ...(st.local || st.server
      ? [{ label: st.server ? 'Clear Clipboard (all computers)' : 'Clear Clipboard', icon: Trash2, onClick: () => void clearClipboard() } as MenuItem]
      : []),
  ]
}

/**
 * ⌘C / ⌘X / ⌘V (Ctrl on other systems) for a file view. Returns true when the
 * key was handled. Ignores keys typed into text fields.
 */
export function handleClipboardKey(
  e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: EventTarget | null; preventDefault(): void },
  selected: string[],
  dir: string,
  onPasted?: (paths: string[]) => void,
): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return false
  // Let the browser copy text the user has selected in this view.
  const ts = window.getSelection()
  const textSelected = !!ts && !ts.isCollapsed && !!t && !!ts.anchorNode && t.contains(ts.anchorNode)
  const k = e.key.toLowerCase()
  if (k === 'c' && selected.length && !textSelected) copyItems(selected)
  else if (k === 'x' && selected.length && !textSelected) cutItems(selected)
  else if (k === 'v') {
    if (!pasteSource().which) return false
    void pasteInto(dir).then((out) => out.length && onPasted?.(out))
  } else return false
  e.preventDefault()
  return true
}
