// Talking to the KherveOS server (server/ — Python, FastAPI).
//
// The browser can do almost everything alone; the server is only needed for
// things that involve other people or other machines: accounts, Messages,
// Email (browsers cannot speak IMAP/SMTP) and launching the web games.
// Everything lives under /api on the same origin (Vite proxies it in dev),
// so the login cookie is sent automatically.

import { create } from 'zustand'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  let url = `/api${path}`
  if (opts.query) {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query)) if (v !== undefined) q.set(k, String(v))
    const s = q.toString()
    if (s) url += `?${s}`
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
  } catch {
    useServer.getState().markOffline()
    throw new ApiError(0, 'The KherveOS server is not reachable.')
  }
  const text = await res.text()
  let data: unknown = null
  let isJson = false
  try {
    data = text ? JSON.parse(text) : null
    isJson = text !== ''
  } catch {
    data = text
  }
  // A 5xx without a JSON body comes from the dev proxy, not from our server:
  // the server is down. (Our server always answers errors as JSON `detail`.)
  if (res.status >= 500 && !isJson) {
    useServer.getState().markOffline()
    throw new ApiError(res.status, 'The KherveOS server is not reachable.')
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail
    const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg ?? String(d)).join('; ') : `Request failed (${res.status})`
    if (res.status === 401 && path !== '/auth/login') useAuth.setState({ user: null })
    throw new ApiError(res.status, msg)
  }
  return data as T
}

// ------------------------------------------------------------ server status

type ServerStatus = 'checking' | 'online' | 'offline'

interface ServerState {
  status: ServerStatus
  version: string | null
  check(): Promise<boolean>
  markOffline(): void
}

let pollTimer: number | undefined

export const useServer = create<ServerState>((set, get) => ({
  status: 'checking',
  version: null,
  async check() {
    try {
      const res = await fetch('/api/health', { credentials: 'same-origin' })
      if (!res.ok) throw new Error(String(res.status))
      const info = (await res.json()) as { version?: string }
      const wasOnline = get().status === 'online'
      set({ status: 'online', version: info.version ?? null })
      if (!wasOnline) void useAuth.getState().refresh()
      schedule(30_000)
      return true
    } catch {
      get().markOffline()
      return false
    }
  },
  markOffline() {
    if (get().status !== 'offline') set({ status: 'offline' })
    schedule(15_000)
  },
}))

function schedule(ms: number) {
  window.clearTimeout(pollTimer)
  pollTimer = window.setTimeout(() => void useServer.getState().check(), ms)
}

// -------------------------------------------------------------------- auth

export interface User {
  id: number
  username: string
  display_name: string
}

interface AuthState {
  user: User | null
  /** True once we have asked the server who we are. */
  checked: boolean
  refresh(): Promise<void>
  login(username: string, password: string): Promise<void>
  register(username: string, displayName: string, password: string): Promise<void>
  logout(): Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  checked: false,
  async refresh() {
    try {
      const me = await api<{ user: User | null }>('/auth/me')
      set({ user: me.user, checked: true })
    } catch {
      set({ checked: true })
    }
  },
  async login(username, password) {
    const r = await api<{ user: User }>('/auth/login', { body: { username, password } })
    set({ user: r.user, checked: true })
  },
  async register(username, displayName, password) {
    const r = await api<{ user: User }>('/auth/register', { body: { username, display_name: displayName, password } })
    set({ user: r.user, checked: true })
  },
  async logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
    } finally {
      set({ user: null })
    }
  },
}))

// ---------------------------------------------------------------- realtime

export type ServerEvent = { type: string; [key: string]: unknown }
type Handler = (ev: ServerEvent) => void

const handlers = new Map<string, Set<Handler>>()
let socket: WebSocket | null = null
let retry = 0
let reconnectTimer: number | undefined

export const useRealtime = create<{ connected: boolean }>(() => ({ connected: false }))

function connect() {
  if (socket || !useAuth.getState().user) return
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/api/ws`)
  socket = ws
  ws.onopen = () => {
    retry = 0
    useRealtime.setState({ connected: true })
  }
  ws.onmessage = (m) => {
    let ev: ServerEvent
    try {
      ev = JSON.parse(String(m.data))
    } catch {
      return
    }
    for (const key of [ev.type, '*']) handlers.get(key)?.forEach((h) => {
      try { h(ev) } catch (e) { console.error('[realtime] handler failed', e) }
    })
  }
  ws.onclose = () => {
    socket = null
    useRealtime.setState({ connected: false })
    if (useAuth.getState().user) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++))
    }
  }
}

function disconnect() {
  window.clearTimeout(reconnectTimer)
  socket?.close()
  socket = null
}

// Connect while signed in, disconnect when signed out.
useAuth.subscribe((s, prev) => {
  if (s.user && !prev.user) connect()
  if (!s.user && prev.user) disconnect()
})

export const realtime = {
  /** Listen for server events of one type ("*" for all). Returns an unsubscribe function. */
  on(type: string, handler: Handler): () => void {
    let set = handlers.get(type)
    if (!set) handlers.set(type, (set = new Set()))
    set.add(handler)
    return () => set!.delete(handler)
  },
  send(ev: ServerEvent) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(ev))
  },
}

/** Start watching the server. Called once by the shell. */
export function startServerWatch() {
  void useServer.getState().check()
}
