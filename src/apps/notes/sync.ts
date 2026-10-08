// Notes sync: while signed in to the KherveOS server, ~/Notes (notes and
// their attachments) is kept the same on every computer through
// /api/notes/sync (server/kherveos_server/notes_sync.py).
//
// Each round compares content hashes three ways — this computer now, the
// server now, both at the last sync (kept in localStorage per user) — and
// sends, fetches or deletes files (syncPlan.ts). Two different edits of the
// same file keep both: the other computer's version is saved next to it as
// "<name> (conflict <date>).md". Rounds run when the app opens, a few seconds
// after notes change, when another computer announces a change
// ("notes.changed"), and every minute. Files written here reach the Notes
// window through the drive's events, like any other app's changes.

import { create } from 'zustand'
import { fs } from '@/os'
import { api, ApiError, realtime, useAuth } from '@/os/server'
import { basename, dirname, join } from '@/os/path'
import { conflictName, planSync } from './syncPlan'
import type { NotesLibrary } from './library'

const MAX_FILE = 25 * 1024 * 1024
const DEVICE_KEY = 'kherveos.deviceId'

export interface SyncState {
  status: 'off' | 'idle' | 'syncing' | 'error'
  /** When the last round finished (ms). */
  last: number | null
  error: string | null
}

export const useNotesSync = create<SyncState>(() => ({ status: 'off', last: null, error: null }))

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = Math.random().toString(36).slice(2, 12)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'device'
  }
}

const baseKey = (userId: number) => `kherveos.notes.sync.${userId}`

function loadBase(userId: number): Record<string, string> {
  try {
    const raw = localStorage.getItem(baseKey(userId))
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function saveBase(userId: number, base: Record<string, string>) {
  try {
    localStorage.setItem(baseKey(userId), JSON.stringify(base))
  } catch {
    /* storage full or blocked: the next round compares again */
  }
}

async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function raw(method: string, path: string, query: Record<string, string>, body?: Uint8Array): Promise<Response> {
  const res = await fetch(`/api/notes/sync${path}?${new URLSearchParams(query)}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/octet-stream' } : undefined,
    body: body as BodyInit | undefined,
  })
  if (!res.ok) {
    let msg = `Sync failed (${res.status})`
    try {
      const d = (await res.json()) as { detail?: string }
      if (typeof d.detail === 'string') msg = d.detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg)
  }
  return res
}

export class NotesSync {
  private lib: NotesLibrary
  private hashes = new Map<string, { mtime: number; size: number; hash: string }>()
  private running = false
  private again = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private me = deviceId()

  constructor(lib: NotesLibrary) {
    this.lib = lib
  }

  /** Start syncing while signed in; returns a stop function. */
  start(): () => void {
    const offs: (() => void)[] = []
    offs.push(
      realtime.on('notes.changed', (ev) => {
        if (ev.device_id !== this.me) this.schedule(400)
      }),
    )
    offs.push(useAuth.subscribe((s, prev) => {
      if (s.user?.id !== prev.user?.id) {
        useNotesSync.setState({ status: s.user ? 'idle' : 'off', error: null })
        if (s.user) this.schedule(200)
      }
    }))
    let seen = this.lib.getVersion()
    offs.push(this.lib.subscribe(() => {
      const v = this.lib.getVersion()
      if (v !== seen) {
        seen = v
        this.schedule(4000)
      }
    }))
    const tick = setInterval(() => this.schedule(0), 60_000)
    offs.push(() => clearInterval(tick))
    useNotesSync.setState({ status: useAuth.getState().user ? 'idle' : 'off' })
    this.schedule(500)
    return () => {
      for (const off of offs) off()
      if (this.timer) clearTimeout(this.timer)
    }
  }

  schedule(ms: number) {
    if (!useAuth.getState().user) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.syncNow()
    }, ms)
  }

  async syncNow(): Promise<void> {
    const user = useAuth.getState().user
    if (!user) {
      useNotesSync.setState({ status: 'off' })
      return
    }
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    useNotesSync.setState({ status: 'syncing', error: null })
    try {
      await this.round(user.id)
      useNotesSync.setState({ status: 'idle', last: Date.now(), error: null })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // A 409 means another computer wrote first: the next round sorts it out.
      if (e instanceof ApiError && e.status === 409) this.again = true
      else useNotesSync.setState({ status: e instanceof ApiError && e.status === 401 ? 'off' : 'error', error: msg })
    } finally {
      this.running = false
      if (this.again) {
        this.again = false
        this.schedule(1500)
      }
    }
  }

  /** ~/Notes as relative path -> hash (files the server can take). */
  private async localManifest(): Promise<Record<string, string>> {
    const root = this.lib.root
    const out: Record<string, string> = {}
    if (!fs.isDir(root)) return out
    for (const st of fs.walk(root)) {
      if (st.type !== 'file' || st.size > MAX_FILE || st.name.startsWith('.')) continue
      const rel = st.path.slice(root.length + 1)
      const cached = this.hashes.get(st.path)
      if (cached && cached.mtime === st.mtime && cached.size === st.size) {
        out[rel] = cached.hash
        continue
      }
      const hash = await sha256(await fs.readBytes(st.path))
      this.hashes.set(st.path, { mtime: st.mtime, size: st.size, hash })
      out[rel] = hash
    }
    return out
  }

  private async round(userId: number) {
    const root = this.lib.root
    const remote = await api<{ files: Record<string, { hash: string | null }> }>('/notes/sync')
    const remoteHashes: Record<string, string | null> = {}
    for (const [p, e] of Object.entries(remote.files)) remoteHashes[p] = e.hash
    const local = await this.localManifest()
    const base = loadBase(userId)
    const plan = planSync(local, remoteHashes, base)
    const next: Record<string, string> = { ...plan.base }
    const commit = () => saveBase(userId, next)
    const abs = (rel: string) => join(root, rel)
    const q = (rel: string, b: string) => ({ path: rel, base: b, device_id: this.me })

    for (const rel of plan.upload) {
      const data = await fs.readBytes(abs(rel))
      const res = await raw('PUT', '/file', q(rel, remoteHashes[rel] ?? ''), data)
      next[rel] = ((await res.json()) as { hash: string }).hash
    }
    for (const rel of plan.download) {
      const res = await raw('GET', '/file', { path: rel })
      const data = new Uint8Array(await res.arrayBuffer())
      await fs.writeBytes(abs(rel), data, { mkdirs: true })
      next[rel] = res.headers.get('X-Hash') ?? (await sha256(data))
    }
    for (const rel of plan.deleteLocal) {
      if (fs.exists(abs(rel))) await fs.remove(abs(rel))
      await removeEmptyParents(dirname(abs(rel)), root)
    }
    for (const rel of plan.deleteRemote) {
      await raw('DELETE', '/file', q(rel, remoteHashes[rel] ?? ''))
    }
    for (const rel of plan.conflicts) {
      // Keep both: theirs next to ours, then ours goes up.
      const res = await raw('GET', '/file', { path: rel })
      const theirs = new Uint8Array(await res.arrayBuffer())
      let copy = conflictName(abs(rel), new Date())
      if (fs.exists(copy)) copy = join(dirname(copy), fs.uniqueName(dirname(copy), basename(copy)))
      await fs.writeBytes(copy, theirs, { mkdirs: true })
      const data = await fs.readBytes(abs(rel))
      const up = await raw('PUT', '/file', q(rel, remoteHashes[rel] ?? ''), data)
      next[rel] = ((await up.json()) as { hash: string }).hash
    }
    commit()
  }
}

/** Remove folders a deletion left empty (not the Notes folder itself). */
async function removeEmptyParents(dir: string, root: string) {
  let d = dir
  while (d !== root && d.startsWith(root + '/') && fs.isDir(d) && fs.list(d).length === 0) {
    await fs.remove(d)
    d = dirname(d)
  }
}
