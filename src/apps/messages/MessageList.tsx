// The scrolling list of messages: day separators, grouped bubbles, an unread
// marker, older pages on scrolling up, and sticking to the bottom for new ones.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, ArrowDown, Copy, LoaderCircle, MessageCircle, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { os, type MenuItem } from '@/os'
import { Avatar } from './Avatar'
import { clock, dayLabel, daysApart, fullDate, memberName } from './format'
import { RichText } from './RichText'
import {
  EMPTY_THREAD,
  deleteMessage,
  discardMessage,
  errorText,
  loadLatest,
  loadOlder,
  retryMessage,
  startConversation,
  useMessages,
} from './store'
import type { ChatMessage, Conversation, User } from './types'

/** Messages from one person less than this far apart (seconds) share a group. */
const GROUP_GAP = 5 * 60

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'msg'; key: string; m: ChatMessage; mine: boolean; first: boolean; last: boolean }

const rowKey = (m: ChatMessage) => m.clientId ?? String(m.id)

function buildRows(items: ChatMessage[], meId: number, unreadAfter: number | null): Row[] {
  const now = Date.now()
  const firstUnread =
    unreadAfter === null ? -1 : items.findIndex((m) => m.id > unreadAfter && m.sender_id !== meId)
  // Does message i start a new group?
  const starts = items.map((m, i) => {
    const prev = items[i - 1]
    return (
      !prev ||
      i === firstUnread ||
      prev.sender_id !== m.sender_id ||
      m.created_at - prev.created_at > GROUP_GAP ||
      daysApart(prev.created_at * 1000, m.created_at * 1000) !== 0
    )
  })
  const rows: Row[] = []
  items.forEach((m, i) => {
    const prev = items[i - 1]
    if (!prev || daysApart(prev.created_at * 1000, m.created_at * 1000) !== 0) {
      rows.push({ kind: 'day', key: `day-${rowKey(m)}`, label: dayLabel(m.created_at, now) })
    }
    if (i === firstUnread) rows.push({ kind: 'unread', key: 'unread' })
    rows.push({
      kind: 'msg',
      key: rowKey(m),
      m,
      mine: m.sender_id === meId,
      first: starts[i],
      last: i === items.length - 1 || starts[i + 1],
    })
  })
  return rows
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => undefined)
}

async function confirmDelete(m: ChatMessage) {
  const ok = await os.dialog.confirm('It will be removed for everyone in this conversation.', {
    title: 'Delete this message?',
    okLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  try {
    await deleteMessage(m)
  } catch (err) {
    await os.dialog.alert(errorText(err), { title: 'The message could not be deleted' })
  }
}

interface Props {
  conversation: Conversation
  me: User
  /** Messages after this id (from others) get a "New messages" marker. */
  unreadAfter: number | null
  onEdit: (m: ChatMessage) => void
  /** Floating bits over the bottom of the list (the typing indicator). */
  children?: ReactNode
}

export function MessageList({ conversation: c, me, unreadAfter, onEdit, children }: Props) {
  const thread = useMessages((s) => s.threads[c.id]) ?? EMPTY_THREAD
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const snap = useRef<{ ready: boolean; first?: number; lastKey?: string; height: number }>({ ready: false, height: 0 })
  const [showJump, setShowJump] = useState(false)
  const group = c.kind === 'group'

  const rows = useMemo(() => buildRows(thread.items, me.id, unreadAfter), [thread.items, me.id, unreadAfter])

  // Keep the view steady as messages come and go.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const s = snap.current
    const first = thread.items.find((x) => x.id > 0)?.id
    const lastItem = thread.items[thread.items.length - 1]
    const lastKey = lastItem ? rowKey(lastItem) : undefined
    if (!s.ready) {
      if (thread.loaded) {
        // Open at the first unread message if it is more than a screen up, else at the bottom.
        const marker = el.querySelector<HTMLElement>('.msg-unread-sep')
        const bottom = el.scrollHeight - el.clientHeight
        el.scrollTop = marker && marker.offsetTop - 24 < bottom ? Math.max(0, marker.offsetTop - 24) : bottom
        s.ready = true
      }
    } else if (first !== undefined && s.first !== undefined && first < s.first) {
      el.scrollTop += el.scrollHeight - s.height // older messages went in above
    } else if (lastKey !== s.lastKey && lastItem) {
      if (atBottom.current || (lastItem.sender_id === me.id && lastItem.id < 0)) el.scrollTop = el.scrollHeight
      else if (lastItem.sender_id !== me.id) setShowJump(true)
    }
    s.first = first
    s.lastKey = lastKey
    s.height = el.scrollHeight
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
  }, [thread.items, thread.loaded, me.id])

  // A short first page that doesn't fill the view: fetch more right away.
  useEffect(() => {
    const el = scrollRef.current
    if (el && thread.loaded && thread.hasMore && !thread.loadingOlder && !thread.olderError && el.scrollHeight <= el.clientHeight + 40) {
      void loadOlder(c.id)
    }
  }, [thread.loaded, thread.hasMore, thread.loadingOlder, thread.olderError, thread.items.length, c.id])

  // Stay at the bottom when the view changes size (window resized, composer grew).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
    if (atBottom.current) setShowJump(false)
    if (el.scrollTop < 160 && thread.hasMore && !thread.loadingOlder && !thread.olderError) void loadOlder(c.id)
  }

  const jumpToEnd = () => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setShowJump(false)
  }

  const openMenu = (e: React.MouseEvent, m: ChatMessage, mine: boolean) => {
    const items: MenuItem[] = []
    if (m.id < 0) {
      if (m.status !== 'failed' || !m.clientId) return
      const clientId = m.clientId
      items.push(
        { label: 'Try again', icon: RefreshCw, onClick: () => retryMessage(c.id, clientId) },
        { label: 'Remove', icon: Trash2, danger: true, onClick: () => discardMessage(c.id, clientId) },
      )
    } else if (!m.deleted) {
      const selected = window.getSelection()?.toString() ?? ''
      const inside = selected && (e.currentTarget as HTMLElement).contains(window.getSelection()?.anchorNode ?? null)
      items.push({ label: inside ? 'Copy selection' : 'Copy text', icon: Copy, onClick: () => copyText(inside ? selected : m.body) })
      if (mine) {
        items.push(
          { label: 'Edit', icon: Pencil, onClick: () => onEdit(m) },
          '-',
          { label: 'Delete…', icon: Trash2, danger: true, onClick: () => void confirmDelete(m) },
        )
      } else if (group) {
        const sender = c.members.find((p) => p.id === m.sender_id)
        if (sender) {
          items.push('-', {
            label: `Message ${sender.display_name}`,
            icon: MessageCircle,
            onClick: () => void startConversation([sender.username]).catch((err) => os.dialog.alert(errorText(err))),
          })
        }
      }
    }
    if (!items.length) return
    e.preventDefault()
    os.contextMenu(e, items)
  }
  // Rows are memoised: hand them one stable callback that always runs the latest menu code.
  const menuRef = useRef(openMenu)
  useLayoutEffect(() => {
    menuRef.current = openMenu
  })
  const onRowMenu = useCallback((e: React.MouseEvent, m: ChatMessage, mine: boolean) => menuRef.current(e, m, mine), [])

  const creator = memberName(c, c.created_by, me.id)
  const other = c.members.find((p) => p.id !== me.id)

  let content: ReactNode
  if (!thread.loaded && thread.error) {
    content = (
      <div className="msg-thread-state">
        <AlertCircle size={22} />
        <div className="k-error">{thread.error}</div>
        <button className="k-btn small" onClick={() => void loadLatest(c.id)}>
          <RefreshCw size={13} /> Try again
        </button>
      </div>
    )
  } else if (!thread.loaded) {
    content = (
      <div className="msg-thread-state">
        <LoaderCircle size={22} className="k-spin" />
      </div>
    )
  } else if (!thread.items.length) {
    content = (
      <div className="msg-thread-state msg-hello">
        {group ? <Avatar name={c.title} id={c.id} size={64} group /> : <Avatar name={c.title} id={other?.id ?? c.id} size={64} />}
        <strong>{c.title}</strong>
        <span>
          {group
            ? `${creator} started this group with ${c.members.length} people. Say hello!`
            : `This is the start of your conversation with ${c.title}. Say hello!`}
        </span>
      </div>
    )
  } else {
    content = (
      <>
        {thread.hasMore ? (
          <div className="msg-older">
            {thread.olderError ? (
              <button className="k-btn small" onClick={() => void loadOlder(c.id)}>
                <RefreshCw size={13} /> Couldn't load earlier messages — try again
              </button>
            ) : (
              <LoaderCircle size={16} className="k-spin" />
            )}
          </div>
        ) : (
          <div className="msg-beginning">
            {group ? `${creator} created ${c.custom_title ? `“${c.custom_title}”` : 'this group'}` : `Your conversation with ${c.title} starts here`}
          </div>
        )}
        {rows.map((r) =>
          r.kind === 'day' ? (
            <div key={r.key} className="msg-day" role="separator">
              <span>{r.label}</span>
            </div>
          ) : r.kind === 'unread' ? (
            <div key={r.key} className="msg-unread-sep" role="separator">
              <span>New messages</span>
            </div>
          ) : (
            <MessageRow
              key={r.key}
              m={r.m}
              mine={r.mine}
              first={r.first}
              last={r.last}
              group={group}
              senderName={r.mine ? 'You' : memberName(c, r.m.sender_id, me.id)}
              onMenu={onRowMenu}
              conversationId={c.id}
            />
          ),
        )}
      </>
    )
  }

  return (
    <div className="msg-body">
      <div className="msg-scroll" ref={scrollRef} onScroll={onScroll} role="log" aria-label={`Messages with ${c.title}`}>
        {content}
      </div>
      {children}
      {showJump && (
        <button className="msg-jump" onClick={jumpToEnd}>
          <ArrowDown size={14} /> New messages
        </button>
      )}
    </div>
  )
}

interface RowProps {
  m: ChatMessage
  mine: boolean
  first: boolean
  last: boolean
  group: boolean
  senderName: string
  conversationId: number
  onMenu: (e: React.MouseEvent, m: ChatMessage, mine: boolean) => void
}

const MessageRow = memo(function MessageRow({ m, mine, first, last, group, senderName, conversationId, onMenu }: RowProps) {
  const showAvatar = group && !mine
  const edited = m.edited_at && !m.deleted ? ` · edited ${fullDate(m.edited_at)}` : ''
  const bubbleClass = `msg-bubble${m.deleted ? ' deleted' : ''}${m.status ? ` ${m.status}` : ''}`
  return (
    <div
      className={`msg-row ${mine ? 'mine' : 'theirs'}${first ? ' first' : ''}${last ? ' last' : ''}`}
      onContextMenu={(e) => onMenu(e, m, mine)}
    >
      {showAvatar && (
        <div className="msg-row-avatar">{last && m.sender_id !== null && <Avatar name={senderName} id={m.sender_id} size={28} />}</div>
      )}
      <div className="msg-stack">
        {showAvatar && first && <div className="msg-sender">{senderName}</div>}
        <div className={bubbleClass} title={`${fullDate(m.created_at)}${edited}`}>
          {m.deleted ? (
            <span className="msg-deleted-text">{mine ? 'You deleted this message' : 'This message was deleted'}</span>
          ) : (
            <RichText text={m.body} />
          )}
          {m.edited_at && !m.deleted && <span className="msg-edited">edited</span>}
        </div>
        {m.status === 'failed' && m.clientId && (
          <div className="msg-failed" title={m.error}>
            <AlertCircle size={12} /> Not sent.
            <button className="k-link-btn" onClick={() => retryMessage(conversationId, m.clientId!)}>
              Try again
            </button>
            ·
            <button className="k-link-btn" onClick={() => discardMessage(conversationId, m.clientId!)}>
              Remove
            </button>
          </div>
        )}
      </div>
      <span className="msg-time" aria-hidden="true">
        {m.status === 'sending' ? 'Sending…' : clock(m.created_at)}
      </span>
    </div>
  )
})
