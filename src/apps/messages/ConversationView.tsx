// The right pane: who you're talking to, the messages, and the composer.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, MessageCircle, UserRound, Users } from 'lucide-react'
import { os, type MenuItem } from '@/os'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { otherMember, typingText } from './format'
import { activeTypers, useNow } from './hooks'
import { MessageList } from './MessageList'
import { closeConversation, errorText, startConversation, useMessages } from './store'
import type { ChatMessage } from './types'

export function ConversationView({ id }: { id: number }) {
  const c = useMessages((s) => s.conversations.find((x) => x.id === id))
  const me = useMessages((s) => s.me)
  const presence = useMessages((s) => s.presence)
  const typing = useMessages((s) => s.typing[id])
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  // Where the "New messages" marker goes: what was read when the conversation opened
  // (or when messages started arriving while the window was in the background).
  const [unreadAfter, setUnreadAfter] = useState<number | null>(() => (c && c.unread_count > 0 ? c.last_read_id : null))
  const unread = c?.unread_count ?? 0
  const lastRead = c?.last_read_id ?? 0
  const prevUnread = useRef(unread)
  useEffect(() => {
    // Unread again after having caught up: the marker moves to the new batch.
    if (unread > 0 && prevUnread.current === 0) setUnreadAfter(lastRead)
    prevUnread.current = unread
  }, [unread, lastRead])

  // Re-render every second while someone is typing, so their line goes away when they stop.
  const typers = activeTypers(typing, Date.now())
  useNow(typers.length ? 1000 : 60_000)

  const editLast = useCallback(() => {
    const items = useMessages.getState().threads[id]?.items ?? []
    const meId = useMessages.getState().me?.id
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i]
      if (m.sender_id === meId && m.id > 0 && !m.deleted) {
        setEditing(m)
        return true
      }
    }
    return false
  }, [id])

  if (!c || !me) return null
  const direct = c.kind === 'direct'
  const other = direct ? otherMember(c, me.id) : undefined
  const onlineOthers = c.members.filter((m) => m.id !== me.id && presence[m.id]).length

  let status: string
  let statusClass = ''
  if (typers.length) {
    status = direct ? 'typing…' : `${typingText(typers)}…`
    statusClass = ' typing'
  } else if (other) {
    status = presence[other.id] ? 'Online' : 'Offline'
    statusClass = presence[other.id] ? ' online' : ''
  } else {
    status = `${c.members.length} members${onlineOthers ? ` · ${onlineOthers} online` : ''}`
  }

  // A group's members; picking someone opens your direct chat with them.
  const showMembers = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const items: MenuItem[] = c.members.map((m) =>
      m.id === me.id
        ? { label: `${m.display_name} (you)`, icon: UserRound, disabled: true }
        : {
            label: `${m.display_name}${presence[m.id] ? ' · online' : ''}`,
            icon: MessageCircle,
            onClick: () => void startConversation([m.username]).catch((err) => os.dialog.alert(errorText(err))),
          },
    )
    os.contextMenu({ clientX: r.right - 220, clientY: r.bottom + 4 }, items)
  }

  return (
    <section className="msg-thread" aria-label={`Conversation with ${c.title}`}>
      <header className="msg-thread-head">
        <button className="k-icon-btn msg-back" aria-label="Back to conversations" title="Back" onClick={closeConversation}>
          <ArrowLeft size={18} />
        </button>
        {other ? (
          <Avatar name={other.display_name} id={other.id} size={36} online={presence[other.id]} />
        ) : (
          <Avatar name={c.title} id={c.id} size={36} group />
        )}
        <div className="msg-thread-title">
          <div className="msg-thread-name">{c.title}</div>
          <div
            className={`msg-thread-status${statusClass}`}
            title={direct ? `@${other?.username ?? ''}` : c.members.map((m) => m.display_name).join(', ')}
          >
            {other && !typers.length && <span className="msg-thread-handle">@{other.username} · </span>}
            {status}
          </div>
        </div>
        {!direct && (
          <button className="k-icon-btn msg-head-btn" title="Members" aria-label="Members" onClick={showMembers}>
            <Users size={17} />
          </button>
        )}
      </header>
      <MessageList conversation={c} me={me} unreadAfter={unreadAfter} onEdit={setEditing}>
        <TypingIndicator names={typers} direct={direct} />
      </MessageList>
      <Composer conversation={c} editing={editing} onStopEditing={() => setEditing(null)} onEditLast={editLast} />
    </section>
  )
}

function TypingIndicator({ names, direct }: { names: string[]; direct: boolean }) {
  if (!names.length) return null
  return (
    <div className="msg-typing" aria-live="polite">
      <span className="msg-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {direct && names.length === 1 ? `${names[0]} is typing` : typingText(names)}
    </div>
  )
}
