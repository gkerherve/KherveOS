// Email: read and send mail from your own accounts (Gmail, iCloud, Fastmail,
// Yahoo, any IMAP/SMTP server) through the KherveOS server, which speaks
// IMAP/SMTP for the browser (server/kherveos_server/mail.py).
//
// Three panes — accounts and folders, the message list, the reader — that
// fold into a drawer and a single pane in small windows. The inbox is checked
// every two minutes and new mail is announced with a notification.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CircleAlert, Forward, Mail, Pencil, Plus, RefreshCw, Reply, ReplyAll, SquarePen } from 'lucide-react'
import { os } from '@/os'
import type { AppProps, MenuBarMenu, WindowApi } from '@/os'
import { useAuth } from '@/os/server'
import { ServerGate, Spinner } from '@/os/ui/ServerGate'
import { mail, type Account, type MessageSummary } from './api'
import { AccountDialog } from './AccountDialog'
import { failure, messageMenuItems } from './actions'
import { Compose } from './Compose'
import { MessageList } from './MessageList'
import { Reader } from './Reader'
import { Sidebar } from './Sidebar'
import { createMailStore, MailContext, useMail, useMailStore, type MailState, type MailStore } from './store'
import { blankCompose, clock, displayName, folderLabel, forward, isOutgoing, replyTo, type ComposeInit } from './util'
import './email.css'

const CHECK_EVERY = 2 * 60_000

export default function Email({ win }: AppProps) {
  return (
    <ServerGate app="Email" icon={Mail}>
      <MailApp win={win} />
    </ServerGate>
  )
}

function announce(win: WindowApi, store: MailStore, account: Account, messages: MessageSummary[]) {
  const first = messages[0]
  const several = (store.getState().accounts?.length ?? 0) > 1
  os.notify({
    title: messages.length === 1 ? `New email from ${displayName(first.from) || 'someone'}` : `${messages.length} new emails`,
    body:
      messages.length === 1
        ? `${first.subject || '(no subject)'}${several ? ` — ${account.email}` : ''}`
        : messages
            .slice(0, 3)
            .map((m) => `${displayName(m.from)}: ${m.subject || '(no subject)'}`)
            .join(' · '),
    icon: Mail,
    color: '#ef4444',
    onClick: () => {
      win.focus()
      const s = store.getState()
      s.openFolder({ accountId: account.id, folder: 'INBOX' })
      if (messages.length === 1) void s.select(first.uid)
    },
  })
}

function MailApp({ win }: { win: WindowApi }) {
  const [store] = useState(() => {
    const created: MailStore = createMailStore({
      onNewMail: (account, messages) => announce(win, created, account, messages),
      onError: failure,
    })
    return created
  })
  return (
    <MailContext.Provider value={store}>
      <MailLayout win={win} />
    </MailContext.Provider>
  )
}

// --------------------------------------------------------------- layout

type Layout = 'wide' | 'medium' | 'narrow'
const PANES_KEY = 'kherveos.email.panes'

function loadPanes(): { sidebar: number; list: number } {
  try {
    const v = JSON.parse(localStorage.getItem(PANES_KEY) ?? 'null')
    if (v && typeof v.sidebar === 'number' && typeof v.list === 'number') return v
  } catch {
    // no saved sizes
  }
  return { sidebar: 220, list: 340 }
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(1000)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function Splitter({ label, value, min, max, onChange }: {
  label: string
  value: number
  min: number
  max: number
  onChange(v: number): void
}) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    const x0 = e.clientX
    const v0 = value
    el.setPointerCapture(e.pointerId)
    el.classList.add('dragging')
    document.body.classList.add('k-dragging') // iframes stop eating the pointer
    const move = (ev: PointerEvent) => onChange(clamp(v0 + ev.clientX - x0, min, max))
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      el.classList.remove('dragging')
      document.body.classList.remove('k-dragging')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }
  return (
    <div
      className="mail-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          onChange(clamp(value + (e.key === 'ArrowLeft' ? -16 : 16), min, max))
        }
      }}
    />
  )
}

function Welcome({ onAdd }: { onAdd(): void }) {
  return (
    <div className="mail-welcome">
      <div className="mail-welcome-card">
        <span className="mail-welcome-icon" aria-hidden>
          <Mail size={30} />
        </span>
        <h2>Bring your email to KherveOS</h2>
        <p>
          Read and send mail from your own accounts — Gmail, iCloud, Fastmail, Yahoo or any IMAP/SMTP server. KherveOS
          connects through your own server, which keeps your password encrypted.
        </p>
        <button className="k-btn primary" onClick={onAdd} autoFocus>
          <Plus size={15} /> Add an account
        </button>
      </div>
    </div>
  )
}

const unreadInboxes = (s: MailState) =>
  Object.values(s.folders).reduce((n, list) => n + (list?.find((f) => f.role === 'inbox')?.unread ?? 0), 0)

function MailLayout({ win }: { win: WindowApi }) {
  const store = useMailStore()
  const userName = useAuth((s) => s.user?.display_name ?? '')
  const accounts = useMail((s) => s.accounts)
  const accountsError = useMail((s) => s.accountsError)
  const current = useMail((s) => s.current)
  const folders = useMail((s) => (s.current ? s.folders[s.current.accountId] : undefined))
  const total = useMail((s) => s.total)
  const selected = useMail((s) => s.selected)
  const detail = useMail((s) => s.detail)
  const checking = useMail((s) => s.checking)
  const lastChecked = useMail((s) => s.lastChecked)
  const unread = useMail(unreadInboxes)
  const [compose, setCompose] = useState<ComposeInit | null>(null)
  const [dialog, setDialog] = useState<{ account?: Account } | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [panes, setPanes] = useState(loadPanes)
  const rootRef = useRef<HTMLDivElement>(null)
  const width = useWidth(rootRef)
  const layout: Layout = width >= 900 ? 'wide' : width >= 640 ? 'medium' : 'narrow'

  // Load the accounts, then keep an eye on every inbox.
  useEffect(() => {
    let alive = true
    void store
      .getState()
      .loadAccounts()
      .then(() => alive && void store.getState().check(false))
    const timer = window.setInterval(() => void store.getState().check(true), CHECK_EVERY)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [store])

  useEffect(() => win.setTitle(unread ? `Email (${unread})` : 'Email'), [win, unread])

  useEffect(() => {
    if (layout === 'wide') setDrawer(false)
  }, [layout])

  // Writing: new messages, replies and forwards. One message at a time.
  const openCompose = useCallback(
    (make: (s: MailState, account: Account) => ComposeInit | null) => {
      const s = store.getState()
      const account = s.accounts?.find((a) => a.id === s.current?.accountId) ?? s.accounts?.[0]
      const init = account ? make(s, account) : null
      if (init) setCompose((open) => open ?? init)
    },
    [store],
  )
  const newMessage = useCallback((to = '') => openCompose((_s, a) => blankCompose(a.id, to)), [openCompose])
  const reply = useCallback(
    (all: boolean) =>
      openCompose((s, a) => {
        const d = s.detail && s.detail.uid === s.selected ? s.detail : null
        const mine = new Set((s.accounts ?? []).map((x) => x.email.toLowerCase()))
        return d ? replyTo(d, a, all, mine) : null
      }),
    [openCompose],
  )
  const forwardMessage = useCallback(
    () => openCompose((s, a) => (s.detail && s.detail.uid === s.selected ? forward(s.detail, a) : null)),
    [openCompose],
  )

  const onSent = useCallback(
    (init: ComposeInit) => {
      const s = store.getState()
      if (init.answering) {
        const { accountId, folder, uid } = init.answering
        mail.setFlags(accountId, folder, uid, { answered: true }).catch(() => {})
        s.markAnswered({ accountId, folder }, uid)
      }
      const open = s.current && s.folders[s.current.accountId]?.find((f) => f.raw === s.current?.folder)
      if (open?.role === 'sent') void s.refresh()
    },
    [store],
  )

  const currentAccount = accounts?.find((a) => a.id === current?.accountId)
  const reading = detail && detail.uid === selected ? detail : null

  // The menu bar at the top of the screen.
  useEffect(() => {
    const has = !!accounts?.length
    const menus: MenuBarMenu[] = [
      {
        label: 'Mailbox',
        items: [
          { label: 'New Message', icon: SquarePen, disabled: !has, onClick: () => newMessage() },
          {
            label: 'Get New Mail',
            icon: RefreshCw,
            disabled: !has,
            onClick: () => {
              void store.getState().refresh()
              void store.getState().check(true)
            },
          },
          '-',
          { label: 'Add Account…', icon: Plus, onClick: () => setDialog({}) },
          {
            label: 'Edit Account…',
            icon: Pencil,
            disabled: !currentAccount,
            onClick: () => currentAccount && setDialog({ account: currentAccount }),
          },
        ],
      },
      {
        label: 'Message',
        items: [
          { label: 'Reply', icon: Reply, disabled: !reading, onClick: () => reply(false) },
          { label: 'Reply All', icon: ReplyAll, disabled: !reading, onClick: () => reply(true) },
          { label: 'Forward', icon: Forward, disabled: !reading, onClick: forwardMessage },
          '-',
          ...(reading
            ? messageMenuItems(store, reading)
            : [
                { label: 'Mark as Unread', disabled: true },
                { label: 'Flag', disabled: true },
                { label: 'Move to', disabled: true },
                '-' as const,
                { label: 'Delete', disabled: true },
              ]),
        ],
      },
    ]
    win.setMenus(menus)
  }, [win, store, accounts, currentAccount, reading, folders, newMessage, reply, forwardMessage])

  useEffect(() => () => win.setMenus(null), [win])

  // Remember the pane sizes (once a drag settles).
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(PANES_KEY, JSON.stringify(panes))
      } catch {
        // storage unavailable: the sizes are just not remembered
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [panes])

  const sidebarW = clamp(panes.sidebar, 160, 340)
  const listMax = Math.max(240, width - (layout === 'wide' ? sidebarW : 0) - 320)
  const listW = clamp(panes.list, 240, Math.min(560, listMax))

  const folder = folders?.find((f) => f.raw === current?.folder)
  const title = folderLabel(folder, current?.folder ?? '')
  const subtitle = currentAccount
    ? `${currentAccount.email}${total ? ` · ${total.toLocaleString()} message${total === 1 ? '' : 's'}` : ''}`
    : ''

  const sidebar = (onPicked?: () => void) => (
    <Sidebar
      onCompose={() => {
        onPicked?.()
        newMessage()
      }}
      onAddAccount={() => {
        onPicked?.()
        setDialog({})
      }}
      onEditAccount={(account) => {
        onPicked?.()
        setDialog({ account })
      }}
      onPicked={onPicked}
    />
  )

  let content: React.ReactNode
  if (accounts === null) {
    content = accountsError ? (
      <div className="mail-placeholder">
        <CircleAlert size={28} />
        <p>{accountsError}</p>
        <button className="k-btn" onClick={() => void store.getState().loadAccounts()}>
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    ) : (
      <Spinner label="Loading your mail accounts…" />
    )
  } else if (accounts.length === 0) {
    content = <Welcome onAdd={() => setDialog({})} />
  } else {
    const showList = layout !== 'narrow' || selected == null
    const showReader = layout !== 'narrow' || selected != null
    content = (
      <div className="mail-main">
        {layout === 'wide' && (
          <>
            {sidebar()}
            <Splitter
              label="Resize the folders"
              value={sidebarW}
              min={160}
              max={340}
              onChange={(v) => setPanes((p) => ({ ...p, sidebar: v }))}
            />
          </>
        )}
        {showList && (
          <MessageList
            title={title}
            subtitle={subtitle}
            outgoing={isOutgoing(folder)}
            onMenu={layout === 'wide' ? undefined : () => setDrawer(true)}
          />
        )}
        {layout !== 'narrow' && (
          <Splitter
            label="Resize the message list"
            value={listW}
            min={240}
            max={Math.min(560, listMax)}
            onChange={(v) => setPanes((p) => ({ ...p, list: v }))}
          />
        )}
        {showReader && (
          <Reader
            onReply={reply}
            onForward={forwardMessage}
            onWrite={(to) => newMessage(to)}
            onBack={layout === 'narrow' ? () => void store.getState().select(null) : undefined}
          />
        )}
        {drawer && layout !== 'wide' && (
          <>
            <div className="mail-drawer-backdrop" onClick={() => setDrawer(false)} />
            <div className="mail-drawer" onKeyDown={(e) => e.key === 'Escape' && setDrawer(false)}>
              {sidebar(() => setDrawer(false))}
            </div>
          </>
        )}
      </div>
    )
  }

  const style = { '--mail-sidebar-w': `${sidebarW}px`, '--mail-list-w': `${listW}px` } as React.CSSProperties

  return (
    <div ref={rootRef} className="k-app mail-app" data-layout={layout} style={style}>
      {content}
      {!!accounts?.length && (
        <div className="k-statusbar mail-status">
          <span className="mail-status-text">
            {current ? `${title}${folder?.unread ? ` · ${folder.unread} unread` : ''}` : ''}
          </span>
          <span className="mail-spacer" />
          <span className="mail-status-text">
            {checking ? 'Checking for new mail…' : lastChecked ? `Checked at ${clock(lastChecked)}` : ''}
          </span>
        </div>
      )}
      {compose && !!accounts?.length && (
        <Compose init={compose} accounts={accounts} win={win} onClose={() => setCompose(null)} onSent={onSent} />
      )}
      {dialog && (
        <AccountDialog
          account={dialog.account}
          defaultName={userName}
          onClose={() => setDialog(null)}
          onSaved={(account, created) => {
            setDialog(null)
            if (created) store.getState().accountAdded(account)
            else store.getState().accountUpdated(account)
            os.notify({
              title: created ? `${account.email} is ready` : 'Account saved',
              body: created ? 'Your inbox is loading.' : account.email,
              icon: Mail,
              color: '#ef4444',
            })
          }}
        />
      )}
    </div>
  )
}

