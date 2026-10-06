// Small helpers for the Email app: dates, sizes, addresses, folders, replies.

import {
  Archive, FileText, Folder as FolderIcon, Inbox, Mails, Send, ShieldAlert, Star, Tag, Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Account, Address, Folder, FolderRole, MessageDetail, MessageSummary } from './api'

// ------------------------------------------------------------------ dates

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** "14:32", "Yesterday", "Tue", "3 Oct", "3 Oct 2024". */
export function listDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000)
  if (days === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fullDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

// -------------------------------------------------------------- addresses

export function displayName(a: Address | null | undefined): string {
  if (!a) return ''
  return a.name || a.address
}

/** "Jane Doe <jane@x.org>", quoting the name when it needs it. */
export function formatAddress(a: Address): string {
  if (!a.name) return a.address
  const name = /[(),.:;<>@[\]"\\]/.test(a.name) ? `"${a.name.replace(/(["\\])/g, '\\$1')}"` : a.name
  return `${name} <${a.address}>`
}

export function formatAddresses(list: Address[]): string {
  return list.map(formatAddress).join(', ')
}

/** Split what someone typed in a To field: commas or semicolons, but not inside "quotes" or <angles>. */
export function splitAddresses(input: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  let angle = false
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '\\' && quoted && i + 1 < input.length) {
      cur += ch + input[++i]
      continue
    }
    if (ch === '"') quoted = !quoted
    else if (ch === '<' && !quoted) angle = true
    else if (ch === '>' && !quoted) angle = false
    if ((ch === ',' || ch === ';' || ch === '\n') && !quoted && !angle) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export function initials(text: string): string {
  const words = text.replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

// ---------------------------------------------------------------- folders

export const ROLE_ICONS: Record<FolderRole, LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  trash: Trash2,
  junk: ShieldAlert,
  archive: Archive,
  all: Mails,
  flagged: Star,
  important: Tag,
}

export function folderIcon(f: Folder | undefined): LucideIcon {
  return (f?.role && ROLE_ICONS[f.role]) || FolderIcon
}

const ROLE_ORDER: FolderRole[] = ['inbox', 'flagged', 'important', 'drafts', 'sent', 'archive', 'all', 'junk', 'trash']

export interface FolderRow {
  folder: Folder
  indent: number
}

/** Special folders first (Inbox, Drafts, Sent…), then the others as a tree. */
export function folderRows(folders: Folder[]): FolderRow[] {
  const special = folders
    .filter((f) => f.role && f.selectable)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role!) - ROLE_ORDER.indexOf(b.role!))
  const custom = folders.filter((f) => !(f.role && f.selectable))
  const childOf = (f: Folder, p: Folder) => !!p.delimiter && f.name.startsWith(p.name + p.delimiter)
  // Hide containers like "[Gmail]" whose children are all special folders.
  const shown = custom.filter((f) => f.selectable || custom.some((c) => c !== f && c.selectable && childOf(c, f)))
  shown.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return [
    ...special.map((folder) => ({ folder, indent: 0 })),
    ...shown.map((folder) => ({ folder, indent: shown.filter((p) => p !== folder && childOf(folder, p)).length })),
  ]
}

export function folderLabel(f: Folder | undefined, fallback = ''): string {
  if (!f) return fallback === 'INBOX' ? 'Inbox' : fallback
  return f.role === 'inbox' ? 'Inbox' : f.label
}

/** Show who it went to rather than who sent it (in Sent and Drafts). */
export function isOutgoing(f: Folder | undefined): boolean {
  return f?.role === 'sent' || f?.role === 'drafts'
}

export function senderLabel(m: MessageSummary, outgoing: boolean): string {
  if (outgoing) {
    const to = [...m.to, ...m.cc]
    return to.length ? `To: ${to.map(displayName).join(', ')}` : 'To: (no recipients)'
  }
  return displayName(m.from) || '(unknown sender)'
}

// ------------------------------------------------------- replies, forwards

export interface ComposeInit {
  accountId: number
  title: string
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  /** Where the cursor goes: the top for replies. */
  focus: 'to' | 'body'
  inReplyTo?: string
  references?: string
  /** The message being answered: marked as answered once the reply is sent. */
  answering?: { accountId: number; folder: string; uid: number }
  /** Attachments to bring along when forwarding. */
  forwardAttachments?: { accountId: number; folder: string; uid: number; attachments: MessageDetail['attachments'] }
}

export function blankCompose(accountId: number, to = ''): ComposeInit {
  return { accountId, title: 'New message', to, cc: '', bcc: '', subject: '', body: '', focus: to ? 'body' : 'to' }
}

function prefixed(subject: string, prefix: string, already: RegExp): string {
  const s = subject.trim()
  return already.test(s) ? s : `${prefix} ${s || '(no subject)'}`
}

function quoted(d: MessageDetail): string {
  const when = fullDate(d.headers.date)
  const who = d.headers.from ? formatAddress(d.headers.from) : 'someone'
  const lines = d.text.replace(/\s+$/, '').split('\n').map((l) => (l.startsWith('>') ? `>${l}` : `> ${l}`))
  return `\n\n${when ? `On ${when}, ` : ''}${who} wrote:\n${lines.join('\n')}\n`
}

function threading(d: MessageDetail): Pick<ComposeInit, 'inReplyTo' | 'references'> {
  const id = d.headers.message_id ?? undefined
  const refs = [d.headers.references, id].filter(Boolean).join(' ').trim()
  return { inReplyTo: id, references: refs || undefined }
}

export function replyTo(d: MessageDetail, account: Account, all: boolean, myAddresses: Set<string>): ComposeInit {
  const mine = (a: Address) => myAddresses.has(a.address.toLowerCase())
  const sender = d.headers.reply_to.length ? d.headers.reply_to : d.headers.from ? [d.headers.from] : []
  // Replying to something I sent goes back to its recipients.
  let to = sender.every(mine) && d.headers.to.length ? d.headers.to : sender
  let cc: Address[] = []
  if (all) {
    const seen = new Set<string>()
    const keep = (a: Address) => {
      const key = a.address.toLowerCase()
      if (seen.has(key) || mine(a)) return false
      seen.add(key)
      return true
    }
    to = [...to, ...d.headers.to].filter(keep)
    cc = d.headers.cc.filter(keep)
    if (!to.length && sender.length) to = sender.slice(0, 1)
  }
  return {
    accountId: account.id,
    title: all ? 'Reply all' : 'Reply',
    to: formatAddresses(to),
    cc: formatAddresses(cc),
    bcc: '',
    subject: prefixed(d.headers.subject, 'Re:', /^(re|aw|sv|antw|réf|rif|vs)\s*:/i),
    body: quoted(d),
    focus: 'body',
    ...threading(d),
    answering: { accountId: account.id, folder: d.folder, uid: d.uid },
  }
}

export function forward(d: MessageDetail, account: Account): ComposeInit {
  const h = d.headers
  const lines = [
    '',
    '',
    '---------- Forwarded message ----------',
    `From: ${h.from ? formatAddress(h.from) : ''}`,
    `Date: ${fullDate(h.date)}`,
    `Subject: ${h.subject}`,
    `To: ${formatAddresses(h.to)}`,
    ...(h.cc.length ? [`Cc: ${formatAddresses(h.cc)}`] : []),
    '',
    d.text.replace(/\s+$/, ''),
    '',
  ]
  return {
    accountId: account.id,
    title: 'Forward',
    to: '',
    cc: '',
    bcc: '',
    subject: prefixed(h.subject, 'Fwd:', /^(fwd?|tr|wg|rv|i)\s*:/i),
    body: lines.join('\n'),
    focus: 'to',
    forwardAttachments: d.attachments.length
      ? { accountId: account.id, folder: d.folder, uid: d.uid, attachments: d.attachments }
      : undefined,
  }
}

// ------------------------------------------------------------ plain text

export type TextPiece = { text: string; href?: string; email?: string }

const LINK = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+\.[^\s<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

/** Split text into plain runs, web links and email addresses. */
export function linkify(text: string): TextPiece[] {
  const out: TextPiece[] = []
  let last = 0
  for (const m of text.matchAll(LINK)) {
    let token = m[0]
    const trail = token.match(/[.,;:!?)\]]+$/)
    if (trail && !(trail[0].startsWith(')') && token.includes('('))) token = token.slice(0, -trail[0].length)
    const start = m.index ?? 0
    if (start > last) out.push({ text: text.slice(last, start) })
    if (token.includes('@') && !token.includes('/')) out.push({ text: token, email: token })
    else out.push({ text: token, href: token.startsWith('www.') ? `https://${token}` : token })
    last = start + token.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Group "> quoted" lines so they can be shown as quotes. */
export function quoteBlocks(text: string): { quote: boolean; text: string }[] {
  const blocks: { quote: boolean; text: string }[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const quote = /^\s*>/.test(line)
    const content = quote ? line.replace(/^\s*> ?/, '') : line
    const last = blocks[blocks.length - 1]
    if (last && last.quote === quote) last.text += '\n' + content
    else blocks.push({ quote, text: content })
  }
  return blocks
}

// ------------------------------------------------------------------ files

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsDataURL(blob)
  })
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', json: 'application/json',
  zip: 'application/zip', py: 'text/x-python', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', mp4: 'video/mp4', ics: 'text/calendar', kbook: 'application/json',
}

export function guessType(name: string): string {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return MIME[ext] ?? 'application/octet-stream'
}
