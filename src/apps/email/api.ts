// The Email app's view of the KherveOS server's IMAP/SMTP bridge (/api/mail,
// server/kherveos_server/mail.py).
//
// The server answers 502 when a *mail* server can't be reached, with a
// readable `detail` and the kind of problem in the X-Mail-Error header. The
// shared api() helper treats every 502 as "the KherveOS server is down", so
// Email has its own small fetch wrapper that tells the two apart.

import { ApiError, useAuth, useServer } from '@/os/server'

export type Security = 'ssl' | 'starttls' | 'none'

export interface ServerSettings {
  host: string
  port: number
  security: Security
}

export interface Provider {
  id: string
  name: string
  supported: boolean
  domains: string[]
  imap: ServerSettings | null
  smtp: ServerSettings | null
  password_label: string
  note: string
  help_url: string | null
}

export interface Account {
  id: number
  email: string
  display_name: string
  imap_host: string
  imap_port: number
  imap_security: Security
  smtp_host: string
  smtp_port: number
  smtp_security: Security
  username: string
  created_at: number
  provider: string
}

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged' | 'important'

export interface Folder {
  /** Decoded full name, e.g. "[Gmail]/Sent Mail". */
  name: string
  /** The name as the IMAP server knows it — what the API wants back. */
  raw: string
  delimiter: string | null
  /** Last part of the name ("Sent Mail"); "Inbox" for INBOX. */
  label: string
  role: FolderRole | null
  flags: string[]
  selectable: boolean
  depth: number
  unread: number | null
  total: number | null
}

export interface Address {
  name: string
  address: string
}

export interface MessageSummary {
  uid: number
  subject: string
  from: Address | null
  to: Address[]
  cc: Address[]
  date: string | null
  message_id: string | null
  seen: boolean
  flagged: boolean
  answered: boolean
  draft: boolean
  has_attachments: boolean
  size: number
}

export interface MessagePage {
  folder: string
  query: string
  offset: number
  limit: number
  total: number
  uidvalidity: number | null
  messages: MessageSummary[]
}

export interface Attachment {
  index: number
  filename: string
  content_type: string
  size: number
  inline: boolean
  content_id: string | null
}

export interface MessageDetail {
  uid: number
  folder: string
  headers: {
    subject: string
    from: Address | null
    to: Address[]
    cc: Address[]
    reply_to: Address[]
    date: string | null
    message_id: string | null
    in_reply_to: string | null
    references: string
  }
  text: string
  html: string | null
  attachments: Attachment[]
  seen: boolean
  flagged: boolean
  answered: boolean
  size: number
}

export interface OutgoingAttachment {
  filename: string
  content_type: string
  data_base64: string
}

export interface SendRequest {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  html?: string
  in_reply_to?: string
  references?: string
  attachments: OutgoingAttachment[]
}

export interface SendResult {
  ok: true
  message_id: string
  saved_to_sent: boolean
  warning: string | null
}

export interface AccountSettings {
  email: string
  password?: string
  display_name: string
  username: string
  provider?: string
  imap_host: string
  imap_port: number
  imap_security: Security
  smtp_host: string
  smtp_port: number
  smtp_security: Security
}

/** An error from the mail bridge. `kind` comes from X-Mail-Error: auth, connect, tls, folder, gone… */
export class MailApiError extends ApiError {
  kind: string | null
  constructor(status: number, message: string, kind: string | null) {
    super(status, message)
    this.kind = kind
  }
}

type Query = Record<string, string | number | undefined>

async function send(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<Response> {
  let url = `/api/mail${path}`
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
    throw new MailApiError(0, 'The KherveOS server is not reachable.', 'offline')
  }
  if (res.status === 401) useAuth.setState({ user: null })
  return res
}

function toError(res: Response, data: unknown): MailApiError {
  const kind = res.headers.get('X-Mail-Error')
  const detail = (data as { detail?: unknown } | null)?.detail
  const message =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((d) => (d as { msg?: string })?.msg ?? String(d)).join('; ')
        : null
  if ((res.status === 502 || res.status === 503 || res.status === 504) && !kind && !message) {
    // Not the bridge talking: a proxy saying the KherveOS server itself is down.
    useServer.getState().markOffline()
    return new MailApiError(res.status, 'The KherveOS server is not reachable.', 'offline')
  }
  return new MailApiError(res.status, message ?? `Request failed (${res.status})`, kind)
}

async function request<T>(path: string, opts: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const res = await send(path, opts)
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) throw toError(res, data)
  return data as T
}

const acc = (id: number) => `/accounts/${id}`
const msg = (id: number, uid: number) => `/accounts/${id}/messages/${uid}`

export const mail = {
  providers: () => request<{ providers: Provider[] }>('/providers').then((r) => r.providers),
  accounts: () => request<{ accounts: Account[] }>('/accounts').then((r) => r.accounts),
  addAccount: (body: AccountSettings) => request<{ account: Account }>('/accounts', { body }).then((r) => r.account),
  updateAccount: (id: number, body: Partial<AccountSettings>) =>
    request<{ account: Account }>(acc(id), { method: 'PATCH', body }).then((r) => r.account),
  removeAccount: (id: number) => request<{ ok: true }>(acc(id), { method: 'DELETE' }),
  folders: (id: number) => request<{ folders: Folder[] }>(`${acc(id)}/folders`).then((r) => r.folders),
  messages: (id: number, folder: string, opts: { offset?: number; limit?: number; q?: string } = {}) =>
    request<MessagePage>(`${acc(id)}/messages`, {
      query: { folder, offset: opts.offset ?? 0, limit: opts.limit ?? 50, q: opts.q || undefined },
    }),
  message: (id: number, folder: string, uid: number) => request<MessageDetail>(msg(id, uid), { query: { folder } }),
  setFlags: (id: number, folder: string, uid: number, flags: { seen?: boolean; flagged?: boolean; answered?: boolean }) =>
    request<{ ok: true }>(`${msg(id, uid)}/flags`, { body: { folder, ...flags } }),
  move: (id: number, folder: string, uid: number, to: string) =>
    request<{ ok: true }>(`${msg(id, uid)}/move`, { body: { folder, to } }),
  remove: (id: number, folder: string, uid: number) =>
    request<{ ok: true; moved_to: string | null }>(`${msg(id, uid)}/delete`, { body: { folder } }),
  send: (id: number, body: SendRequest) => request<SendResult>(`${acc(id)}/send`, { body }),
  /** An attachment's bytes. */
  async attachment(id: number, folder: string, uid: number, index: number): Promise<Blob> {
    const res = await send(`${msg(id, uid)}/attachments/${index}`, { query: { folder } })
    if (!res.ok) {
      let data: unknown = null
      try {
        data = JSON.parse(await res.text())
      } catch {
        data = null
      }
      throw toError(res, data)
    }
    return res.blob()
  },
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
