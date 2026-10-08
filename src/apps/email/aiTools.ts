// Email's AI tools (email_list_accounts, _list_messages, _search,
// _read_message, _open_message, _compose, _send): names, arguments and
// descriptions are in src/os/ai/manifests/communication.ts. Email.tsx
// registers these with useAppTools; MailLayout fills in the host once the
// server is reachable and the user is signed in.
//
// Nothing is sent without the user allowing it: email_send always asks
// (ctx.confirm) with the recipients and the subject first.

import { Send } from 'lucide-react'
import { os } from '@/os'
import { useAuth, useServer } from '@/os/server'
import { clipText, waitUntil, type AppTools } from '@/os/ai/appTools'
import { mail, type Account, type Folder, type MessageSummary, type SendResult } from './api'
import type { MailStore } from './store'
import { blankCompose, formatAddress, formatAddresses, replyTo, splitAddresses, type ComposeInit } from './util'

/** The message open in the compose panel. */
export interface ComposeControl {
  fields(): { accountId: number; to: string; cc: string; bcc: string; subject: string; body: string; attachments: number; sending: boolean }
  /** Sends it as the Send button does (without asking about a missing subject); throws when it can't. */
  send(): Promise<SendResult>
}

/** What the Email window gives its AI tools. */
export interface MailAiHost {
  store: MailStore
  /** Open the compose panel; false when a message is already being written. */
  compose(init: ComposeInit): boolean
  /** The message being written, or null. */
  draft(): ComposeControl | null
  /** A message went out (marks the answered one, refreshes the Sent folder). */
  sent(init: ComposeInit): void
}

const READ_MAX = 12_000
const ROLE_WORDS: Record<string, string> = {
  inbox: 'inbox', sent: 'sent', 'sent mail': 'sent', 'sent items': 'sent', drafts: 'drafts', draft: 'drafts',
  trash: 'trash', bin: 'trash', deleted: 'trash', 'deleted items': 'trash', junk: 'junk', spam: 'junk',
  archive: 'archive', all: 'all', 'all mail': 'all', flagged: 'flagged', starred: 'flagged', important: 'important',
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const given = (v: unknown) => typeof v === 'string' && v.trim() !== ''
const count = (v: unknown, def: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.round(v))) : def

/** "1:4321:INBOX" ↔ account 1, uid 4321, folder INBOX (folder last: it may hold ":"). */
const messageId = (accountId: number, uid: number, folder: string) => `${accountId}:${uid}:${folder}`
function parseId(v: unknown): { accountId: number; uid: number; folder: string } {
  const m = /^(\d+):(\d+):(.+)$/s.exec(text(v))
  if (!m) throw new Error(`"${String(v ?? '')}" is not a message id: ids look like "1:4321:INBOX" (see email_list_messages).`)
  return { accountId: Number(m[1]), uid: Number(m[2]), folder: m[3] }
}

function htmlToText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('style, script, head').forEach((el) => el.remove())
    return (doc.body?.innerText || doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
}

function summary(m: MessageSummary, accountId: number, folder: string) {
  return {
    id: messageId(accountId, m.uid, folder),
    from: m.from ? formatAddress(m.from) : '',
    ...(m.to.length && { to: clipText(formatAddresses(m.to), 200) }),
    subject: m.subject || '(no subject)',
    date: m.date,
    unread: !m.seen,
    ...(m.flagged && { flagged: true }),
    ...(m.answered && { answered: true }),
    ...(m.has_attachments && { attachments: true }),
  }
}

export function emailAiTools(getHost: () => MailAiHost | null): AppTools {
  /** The host, once the accounts are known; a clear error when Email can't work yet. */
  const ready = async (signal?: AbortSignal): Promise<{ host: MailAiHost; accounts: Account[] }> => {
    await waitUntil(() => {
      const h = getHost()
      if (!h) return useServer.getState().status === 'offline' || (useAuth.getState().checked && !useAuth.getState().user)
      const s = h.store.getState()
      return s.accounts !== null || !!s.accountsError
    }, 15_000, signal)
    const host = getHost()
    if (!host) {
      if (useServer.getState().status === 'offline') {
        throw new Error('Mail needs the KherveOS server, which is not running: the user has to start it ("npm run server" in the KherveOS folder).')
      }
      if (useAuth.getState().checked && !useAuth.getState().user) throw new Error('The user has to sign in to KherveOS in the Email window first.')
      throw new Error('Mail is not ready yet. Try again in a moment.')
    }
    const s = host.store.getState()
    if (s.accounts === null) throw new Error(s.accountsError ? `Mail could not load the accounts: ${s.accountsError}` : 'Mail is still loading the accounts. Try again in a moment.')
    if (!s.accounts.length) throw new Error('No email account is set up: the user has to add one in Email first (Mailbox > Add Account…).')
    return { host, accounts: s.accounts }
  }

  const pickAccount = (host: MailAiHost, accounts: Account[], arg: unknown): Account => {
    const want = text(arg).toLowerCase()
    if (!want) return accounts.find((a) => a.id === host.store.getState().current?.accountId) ?? accounts[0]
    const found =
      accounts.find((a) => a.email.toLowerCase() === want) ??
      accounts.find((a) => a.email.toLowerCase().includes(want) || a.display_name.toLowerCase() === want)
    if (!found) throw new Error(`No account "${text(arg)}". The accounts are: ${accounts.map((a) => a.email).join(', ')}.`)
    return found
  }

  const accountById = (accounts: Account[], id: number): Account => {
    const a = accounts.find((x) => x.id === id)
    if (!a) throw new Error(`The account of this message id (${id}) is not set up in Email any more.`)
    return a
  }

  const foldersOf = async (host: MailAiHost, accountId: number): Promise<Folder[]> => {
    let list = host.store.getState().folders[accountId]
    if (!list) {
      await host.store.getState().loadFolders(accountId)
      list = host.store.getState().folders[accountId]
    }
    if (!list) throw new Error(`Could not list the folders: ${host.store.getState().folderErrors[accountId] ?? 'unknown error'}.`)
    return list
  }

  const pickFolder = (folders: Folder[], arg: unknown): Folder => {
    const want = text(arg)
    const lower = want.toLowerCase()
    const usable = folders.filter((f) => f.selectable)
    if (!want || lower === 'inbox') {
      return usable.find((f) => f.role === 'inbox') ?? usable.find((f) => f.raw.toUpperCase() === 'INBOX') ?? { ...fallbackInbox }
    }
    const role = ROLE_WORDS[lower]
    const found =
      usable.find((f) => f.raw === want) ??
      usable.find((f) => f.name.toLowerCase() === lower) ??
      usable.find((f) => f.label.toLowerCase() === lower) ??
      (role ? usable.find((f) => f.role === role) : undefined)
    if (!found) throw new Error(`No folder "${want}". The folders are: ${usable.map((f) => f.name).join(', ')}.`)
    return found
  }

  const listing = async (a: Record<string, unknown>, query: string, signal?: AbortSignal) => {
    const { host, accounts } = await ready(signal)
    const account = pickAccount(host, accounts, a.account)
    const folder = pickFolder(await foldersOf(host, account.id), a.folder)
    const limit = count(a.limit, 20, 100)
    const unreadOnly = a.unread_only === true
    const page = await mail.messages(account.id, folder.raw, { limit: unreadOnly ? 200 : limit, q: query || undefined })
    const list = (unreadOnly ? page.messages.filter((m) => !m.seen) : page.messages).slice(0, limit)
    return {
      account: account.email,
      folder: folder.name,
      ...(query && { query }),
      total: page.total,
      ...(folder.unread != null && { unread: folder.unread }),
      shown: list.length,
      messages: list.map((m) => summary(m, account.id, folder.raw)),
      ...(unreadOnly && page.total > page.messages.length && { note: `Only the newest ${page.messages.length} messages were checked for unread ones.` }),
    }
  }

  const fetchDetail = async (host: MailAiHost, accounts: Account[], id: unknown) => {
    const ref = parseId(id)
    const account = accountById(accounts, ref.accountId)
    const detail = await mail.message(account.id, ref.folder, ref.uid)
    // The server marked it read: show that in the list too.
    const s = host.store.getState()
    if (s.current?.accountId === ref.accountId && s.current.folder === ref.folder && s.items.some((m) => m.uid === ref.uid && !m.seen)) {
      void s.setFlags(ref.uid, { seen: true })
    }
    return { ref, account, detail }
  }

  const myAddresses = (accounts: Account[]) => new Set(accounts.map((x) => x.email.toLowerCase()))

  /** The message the arguments describe (new, or a reply). */
  const build = async (host: MailAiHost, accounts: Account[], a: Record<string, unknown>, quote: boolean): Promise<ComposeInit> => {
    let init: ComposeInit
    if (given(a.reply_to)) {
      const { detail, account: original } = await fetchDetail(host, accounts, a.reply_to)
      const account = given(a.from) ? pickAccount(host, accounts, a.from) : original
      init = replyTo(detail, account, false, myAddresses(accounts))
      const body = typeof a.body === 'string' ? a.body : ''
      init = { ...init, accountId: account.id, body: quote ? `${body}${init.body}` : body }
    } else {
      const account = pickAccount(host, accounts, a.from)
      init = { ...blankCompose(account.id), body: typeof a.body === 'string' ? a.body : '' }
    }
    if (given(a.to)) init.to = text(a.to)
    if (given(a.cc)) init.cc = text(a.cc)
    if (given(a.subject)) init.subject = text(a.subject)
    init.focus = init.to ? 'body' : 'to'
    return init
  }

  const confirmSend = async (
    ctx: { confirm(what: string, detail?: string): Promise<boolean> },
    from: string,
    to: string[],
    cc: string[],
    subject: string,
    body: string,
    attachments = 0,
  ) => {
    const who = [...to, ...cc].join(', ')
    const detail = [
      `From: ${from}`,
      `To: ${to.join(', ') || '—'}`,
      ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
      `Subject: ${subject || '(no subject)'}`,
      ...(attachments ? [`Attachments: ${attachments}`] : []),
      '',
      clipText(body.trim() || '(empty message)', 600),
    ].join('\n')
    if (!(await ctx.confirm(`send the email "${subject || '(no subject)'}" to ${who}`, detail))) {
      throw new Error('The user did not allow sending this email. It was not sent.')
    }
  }

  return {
    async list_accounts(_a, ctx) {
      const { host, accounts } = await ready(ctx.signal)
      const current = host.store.getState().current?.accountId
      const out = []
      for (const account of accounts) {
        let folders: Folder[] | null = null
        try {
          folders = await foldersOf(host, account.id)
        } catch {
          folders = null
        }
        out.push({
          email: account.email,
          name: account.display_name,
          ...(account.id === current && { shown: true }),
          folders: folders
            ? folders.filter((f) => f.selectable).map((f) => ({ name: f.name, ...(f.role && { role: f.role }), unread: f.unread, total: f.total }))
            : 'could not be listed',
        })
      }
      return { accounts: out }
    },

    async list_messages(a, ctx) {
      return listing(a, text(a.query), ctx.signal)
    },

    async search(a, ctx) {
      const query = text(a.query)
      if (!query) throw new Error('"query" is empty: give words to look for.')
      return listing({ ...a, unread_only: false }, query, ctx.signal)
    },

    async read_message(a, ctx) {
      const { host, accounts } = await ready(ctx.signal)
      const { ref, detail } = await fetchDetail(host, accounts, a.id)
      const h = detail.headers
      const body = detail.text.trim() ? detail.text : detail.html ? htmlToText(detail.html) : ''
      return {
        id: messageId(ref.accountId, ref.uid, ref.folder),
        from: h.from ? formatAddress(h.from) : '',
        to: formatAddresses(h.to),
        ...(h.cc.length && { cc: formatAddresses(h.cc) }),
        ...(h.reply_to.length && { reply_to: formatAddresses(h.reply_to) }),
        subject: h.subject || '(no subject)',
        date: h.date,
        ...(detail.attachments.length && { attachments: detail.attachments.map((x) => ({ filename: x.filename, type: x.content_type, size: x.size })) }),
        text: clipText(body, READ_MAX),
        ...(body.length > READ_MAX && { truncated: true }),
      }
    },

    async open_message(a, ctx) {
      const { host, accounts } = await ready(ctx.signal)
      const ref = parseId(a.id)
      accountById(accounts, ref.accountId)
      const s = host.store.getState()
      if (s.current?.accountId !== ref.accountId || s.current.folder !== ref.folder) s.openFolder({ accountId: ref.accountId, folder: ref.folder })
      await host.store.getState().select(ref.uid)
      const after = host.store.getState()
      if (after.detailError) throw new Error(`Could not open the message: ${after.detailError}`)
      return { shown: messageId(ref.accountId, ref.uid, ref.folder), subject: after.detail?.headers.subject || '(no subject)' }
    },

    async compose(a, ctx) {
      const { host, accounts } = await ready(ctx.signal)
      const init = await build(host, accounts, a, true)
      if (!host.compose(init)) {
        throw new Error('A message is already open in the Email compose panel: the user has to send or discard it first (email_send with no "to" sends it).')
      }
      const from = accounts.find((x) => x.id === init.accountId)?.email
      return { opened: true, sent: false, from, to: init.to, subject: init.subject, note: 'The user can now check, edit and send it.' }
    },

    async send(a, ctx) {
      const { host, accounts } = await ready(ctx.signal)

      // No recipients and nothing to answer: send the message the user is writing.
      if (!given(a.to) && !given(a.reply_to)) {
        const draft = host.draft()
        if (!draft) throw new Error('Nothing to send: give "to", "subject" and "body" (or "reply_to"), or open one with email_compose first.')
        const f = draft.fields()
        if (f.sending) throw new Error('That message is already being sent.')
        const to = splitAddresses(f.to)
        const cc = splitAddresses(f.cc)
        const bcc = splitAddresses(f.bcc)
        if (!to.length && !cc.length && !bcc.length) throw new Error('The message in the compose panel has no recipient yet.')
        const from = accounts.find((x) => x.id === f.accountId)?.email ?? ''
        await confirmSend(ctx, from, to, [...cc, ...bcc], f.subject.trim(), f.body, f.attachments)
        const result = await draft.send()
        return { sent: true, from, to: f.to, subject: f.subject.trim() || '(no subject)', ...(result.warning && { warning: result.warning }) }
      }

      const init = await build(host, accounts, a, true)
      const to = splitAddresses(init.to)
      const cc = splitAddresses(init.cc)
      if (!to.length && !cc.length) throw new Error('Give "to": at least one recipient.')
      if (!given(a.body)) throw new Error('Give "body": the text of the message.')
      const account = accounts.find((x) => x.id === init.accountId)!
      const subject = init.subject.trim()
      await confirmSend(ctx, account.email, to, cc, subject, init.answering ? `${text(a.body)}\n\n(the original message is quoted below)` : text(a.body))
      const result = await mail.send(account.id, {
        to,
        cc,
        bcc: [],
        subject,
        text: init.body,
        in_reply_to: init.inReplyTo,
        references: init.references,
        attachments: [],
      })
      host.sent(init)
      os.notify({ title: 'Message sent', body: result.warning ?? (subject || '(no subject)'), icon: Send, color: '#ef4444' })
      return { sent: true, from: account.email, to: to.join(', '), ...(cc.length && { cc: cc.join(', ') }), subject: subject || '(no subject)', ...(result.warning && { warning: result.warning }) }
    },
  }
}

const fallbackInbox: Folder = {
  name: 'INBOX', raw: 'INBOX', delimiter: null, label: 'Inbox', role: 'inbox', flags: [], selectable: true, depth: 0, unread: null, total: null,
}
