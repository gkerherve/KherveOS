// The left pane: who is signed in, search, and the conversations.

import { useEffect, useMemo, useState } from 'react'
import { CheckCheck, ChevronDown, LoaderCircle, LogOut, MessagesSquare, RefreshCw, Search, SquarePen, WifiOff, X } from 'lucide-react'
import { os } from '@/os'
import { useRealtime } from '@/os/server'
import { confirmSignOut } from './account'
import { Avatar } from './Avatar'
import { otherMember, previewOf, shortTime, typingText } from './format'
import { activeTypers, useNow } from './hooks'
import { loadConversations, markAllRead, openConversation, useMessages } from './store'
import type { Conversation, User } from './types'

export function ConversationList({ onNewChat }: { onNewChat: () => void }) {
  const conversations = useMessages((s) => s.conversations)
  const status = useMessages((s) => s.status)
  const error = useMessages((s) => s.error)
  const activeId = useMessages((s) => s.activeId)
  const presence = useMessages((s) => s.presence)
  const typing = useMessages((s) => s.typing)
  const me = useMessages((s) => s.me)
  const [query, setQuery] = useState('')

  // Re-render every second while someone is typing (their line expires), else every 30 s for "5 min" labels.
  const now = Date.now()
  const anyTyping = Object.values(typing).some((entries) => activeTypers(entries, now).length > 0)
  useNow(anyTyping ? 1000 : 30_000)

  const q = query.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!q) return conversations
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.members.some((m) => m.id !== me?.id && (m.display_name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q))),
    )
  }, [conversations, q, me])

  return (
    <aside className="msg-side" aria-label="Conversations">
      <div className="msg-side-head">
        <AccountButton onNewChat={onNewChat} />
        <button className="k-icon-btn msg-head-btn" title="New chat" aria-label="New chat" onClick={onNewChat}>
          <SquarePen size={17} />
        </button>
      </div>

      {(conversations.length > 0 || q) && (
        <div className="msg-search">
          <Search size={14} className="msg-search-icon" />
          <input
            className="k-input"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            spellCheck={false}
            aria-label="Search conversations"
          />
          {query && (
            <button className="k-icon-btn msg-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <ConnectionBanner />

      <div className="msg-conv-list">
        {status === 'loading' && conversations.length === 0 ? (
          <div className="msg-list-state">
            <LoaderCircle size={18} className="k-spin" />
            Loading conversations…
          </div>
        ) : status === 'error' && conversations.length === 0 ? (
          <div className="msg-list-state">
            <div className="k-error">{error}</div>
            <button className="k-btn small" onClick={() => void loadConversations()}>
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        ) : conversations.length === 0 ? (
          <div className="msg-list-empty">
            <span className="msg-list-empty-icon">
              <MessagesSquare size={22} />
            </span>
            <strong>No conversations yet</strong>
            <span>Start one with someone who has an account on this KherveOS server.</span>
            <button className="k-btn primary small" onClick={onNewChat}>
              <SquarePen size={13} /> New chat
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="msg-list-state">No conversations match “{query.trim()}”.</div>
        ) : (
          shown.map((c) => (
            <ConversationRow
              key={c.id}
              c={c}
              me={me}
              active={c.id === activeId}
              presence={presence}
              typers={activeTypers(typing[c.id], now)}
              now={now}
            />
          ))
        )}
      </div>
    </aside>
  )
}

function ConversationRow({
  c,
  me,
  active,
  presence,
  typers,
  now,
}: {
  c: Conversation
  me: User | null
  active: boolean
  presence: Record<number, boolean>
  typers: string[]
  now: number
}) {
  const other = c.kind === 'direct' ? otherMember(c, me?.id) : undefined
  const unread = c.unread_count
  const preview = typers.length ? (c.kind === 'direct' ? 'typing…' : `${typingText(typers)}…`) : previewOf(c, me)
  return (
    <button
      className={`msg-conv${active ? ' active' : ''}${unread > 0 ? ' unread' : ''}`}
      onClick={() => openConversation(c.id)}
      aria-current={active || undefined}
      aria-label={`${c.title}${unread ? `, ${unread} unread` : ''}`}
    >
      {other ? (
        <Avatar name={other.display_name} id={other.id} size={40} online={presence[other.id]} />
      ) : (
        <Avatar name={c.title} id={c.id} size={40} group />
      )}
      <span className="msg-conv-text">
        <span className="msg-conv-line">
          <span className="msg-conv-name">{c.title}</span>
          <span className="msg-conv-time">{shortTime(c.updated_at, now)}</span>
        </span>
        <span className="msg-conv-line">
          <span
            className={`msg-conv-preview${typers.length ? ' typing' : ''}${!typers.length && c.last_message?.deleted ? ' deleted' : ''}`}
          >
            {preview}
          </span>
          {unread > 0 && <span className="msg-badge">{unread > 99 ? '99+' : unread}</span>}
        </span>
      </span>
    </button>
  )
}

function AccountButton({ onNewChat }: { onNewChat: () => void }) {
  const me = useMessages((s) => s.me)
  const hasUnread = useMessages((s) => s.conversations.some((c) => c.unread_count > 0))
  if (!me) return null

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    os.contextMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
      { label: 'New chat…', icon: SquarePen, onClick: onNewChat },
      { label: 'Mark all as read', icon: CheckCheck, onClick: markAllRead, disabled: !hasUnread },
      '-',
      { label: `Sign out (@${me.username})`, icon: LogOut, onClick: () => void confirmSignOut() },
    ])
  }

  return (
    <button className="msg-account" onClick={openMenu} title={`Signed in as ${me.display_name} (@${me.username})`} aria-haspopup="menu">
      <Avatar name={me.display_name} id={me.id} size={32} />
      <span className="msg-account-text">
        <span className="msg-account-name">{me.display_name}</span>
        <span className="msg-account-user">@{me.username}</span>
      </span>
      <ChevronDown size={14} className="msg-account-chevron" />
    </button>
  )
}

/** Shown when the live connection has been down for a moment. */
function ConnectionBanner() {
  const connected = useRealtime((s) => s.connected)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (connected) {
      setShow(false)
      return
    }
    const t = window.setTimeout(() => setShow(true), 2500)
    return () => window.clearTimeout(t)
  }, [connected])
  if (!show) return null
  return (
    <div className="msg-banner" role="status">
      <WifiOff size={13} /> Reconnecting… new messages may be late.
    </div>
  )
}
