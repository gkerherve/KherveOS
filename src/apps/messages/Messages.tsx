// Messages: real-time chat between people who have accounts on this KherveOS
// server. The server side is server/kherveos_server/messages.py.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CheckCheck, LoaderCircle, LogOut, MessageCircle, MessagesSquare, SquarePen, UserRound } from 'lucide-react'
import type { AppProps, MenuBarMenu } from '@/os'
import { useAuth, useRealtime } from '@/os/server'
import { useWindows } from '@/os/windows'
import { ServerGate } from '@/os/ui/ServerGate'
import { useAppTools } from '@/os/ai/appTools'
import { messagesAiTools } from './aiTools'
import { confirmSignOut } from './account'
import { ConversationList } from './ConversationList'
import { ConversationView } from './ConversationView'
import { usePageVisible } from './hooks'
import { NewChatDialog } from './NewChatDialog'
import { startMessagesNotifier } from './notifier'
import {
  closeConversation,
  listen,
  loadConversations,
  markAllRead,
  markRead,
  openConversation,
  resetFor,
  resync,
  useMessages,
} from './store'
import './messages.css'

export default function Messages(props: AppProps) {
  // Offered even before sign-in, so the tools can say what is missing.
  useAppTools(props.win, messagesAiTools())
  return (
    <div className="k-app">
      <ServerGate app="Messages" icon={MessageCircle}>
        <MessagesApp {...props} />
      </ServerGate>
    </div>
  )
}

function MessagesApp({ win, args }: AppProps) {
  const me = useAuth((s) => s.user)
  const [readyFor, setReadyFor] = useState<number | null>(null)
  const activeId = useMessages((s) => s.activeId)
  const active = useMessages((s) => (s.activeId === null ? undefined : s.conversations.find((c) => c.id === s.activeId)))
  const status = useMessages((s) => s.status)
  const hasConversations = useMessages((s) => s.conversations.length > 0)
  const hasUnread = useMessages((s) => s.conversations.some((c) => c.unread_count > 0))
  const [newChat, setNewChat] = useState(false)

  // A fresh start for whoever is signed in: live events first, then the list.
  useLayoutEffect(() => {
    if (!me) return
    resetFor(me)
    useMessages.setState({ mounted: true })
    startMessagesNotifier()
    const stop = listen()
    void loadConversations()
    setReadyFor(me.id)
    return () => {
      stop()
      useMessages.setState({ mounted: false, seen: false })
    }
    // Only a different person signing in starts over.
  }, [me?.id])

  // Opened from a notification (or os.open('messages', { conversation })).
  useEffect(() => {
    if (readyFor === null) return
    const id = Number(args.conversation)
    if (Number.isInteger(id) && id > 0) openConversation(id)
  }, [args, readyFor])

  // Can the person see the open conversation right now?
  const focused = useWindows((s) => s.focusedId === win.id)
  const minimized = useWindows((s) => s.windows.some((w) => w.id === win.id && w.minimized))
  const pageVisible = usePageVisible()
  const seen = focused && !minimized && pageVisible
  useEffect(() => {
    useMessages.setState({ seen })
  }, [seen, readyFor])

  // Mark the open conversation read while it is in view.
  const newestId = active?.last_message?.id ?? 0
  const lastRead = active?.last_read_id ?? 0
  const unread = active?.unread_count ?? 0
  useEffect(() => {
    if (!seen || !active || (unread === 0 && newestId <= lastRead)) return
    const t = window.setTimeout(() => void markRead(active.id), 250)
    return () => window.clearTimeout(t)
  }, [seen, active?.id, unread, newestId, lastRead])

  // Catch up on anything missed while the live connection was down.
  const connected = useRealtime((s) => s.connected)
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current && readyFor !== null) resync()
    wasConnected.current = connected
  }, [connected, readyFor])

  const title = active?.title
  useEffect(() => {
    win.setTitle(title ? `Messages — ${title}` : 'Messages')
  }, [title, win])
  useEffect(() => () => win.setTitle('Messages'), [win])

  // The top menu bar.
  useEffect(() => {
    if (!me || typeof win.setMenus !== 'function') return
    const menus: MenuBarMenu[] = [
      {
        label: 'Conversation',
        items: [
          { label: 'New Chat…', icon: SquarePen, onClick: () => setNewChat(true) },
          {
            label: 'Mark as Read',
            icon: CheckCheck,
            disabled: activeId === null || unread === 0,
            onClick: () => activeId !== null && void markRead(activeId),
          },
          { label: 'Mark All as Read', disabled: !hasUnread, onClick: markAllRead },
          '-',
          { label: 'Close Conversation', disabled: activeId === null, onClick: closeConversation },
        ],
      },
      {
        label: 'Account',
        items: [
          { label: `Signed in as ${me.display_name} (@${me.username})`, icon: UserRound, disabled: true },
          '-',
          { label: 'Sign Out…', icon: LogOut, onClick: () => void confirmSignOut() },
        ],
      },
    ]
    win.setMenus(menus)
  }, [win, me, activeId, unread, hasUnread])
  // Signed out (the sign-in form takes over): take the menus away again.
  useEffect(
    () => () => {
      if (typeof win.setMenus === 'function') win.setMenus(null)
    },
    [win],
  )

  if (!me || readyFor !== me.id) return null

  return (
    <div className={`msg-app${activeId !== null ? ' has-active' : ''}`}>
      <ConversationList onNewChat={() => setNewChat(true)} />
      <main className="msg-main">
        {active ? (
          <ConversationView key={active.id} id={active.id} />
        ) : activeId !== null ? (
          <div className="msg-thread-state">
            <LoaderCircle size={22} className="k-spin" />
          </div>
        ) : (
          <Welcome hasConversations={hasConversations} loading={status === 'loading'} onNewChat={() => setNewChat(true)} />
        )}
      </main>
      {newChat && <NewChatDialog onClose={() => setNewChat(false)} />}
    </div>
  )
}

function Welcome({ hasConversations, loading, onNewChat }: { hasConversations: boolean; loading: boolean; onNewChat: () => void }) {
  if (loading) return null
  return (
    <div className="msg-welcome">
      <span className="msg-welcome-icon">
        <MessagesSquare size={30} />
      </span>
      {hasConversations ? (
        <>
          <h2>Pick a conversation</h2>
          <p>Choose one on the left, or start a new chat.</p>
        </>
      ) : (
        <>
          <h2>Chat with people on this server</h2>
          <p>
            Messages connects everyone who has an account on this KherveOS server. Start a conversation with one person, or
            pick several for a group.
          </p>
          <p className="msg-welcome-note">
            Someone missing? They need an account here too: ask them to open Messages on this server and create one.
          </p>
        </>
      )}
      <button className="k-btn primary" onClick={onNewChat}>
        <SquarePen size={14} /> {hasConversations ? 'New chat' : 'Start a conversation'}
      </button>
    </div>
  )
}
