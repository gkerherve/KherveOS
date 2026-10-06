// Notifications for incoming messages the person can't see right now: the
// conversation isn't the one open, or the Messages window isn't in front.
//
// The Messages app starts this the first time it opens, and the listener then
// stays for the life of the page, so messages keep notifying after the window
// is closed. The shell may also call startMessagesNotifier() at startup to
// notify before Messages has ever been opened.

import { MessageCircle } from 'lucide-react'
import { os } from '@/os'
import { realtime, useAuth } from '@/os/server'
import { useMessages } from './store'
import { oneLine } from './format'
import type { MessageNewEvent } from './types'

let started = false

export function startMessagesNotifier(): void {
  if (started) return
  started = true
  realtime.on('message.new', (raw) => {
    const ev = raw as unknown as MessageNewEvent
    const me = useAuth.getState().user
    if (!me || ev.message.sender_id === me.id) return
    const s = useMessages.getState()
    if (s.mounted && s.seen && s.activeId === ev.conversation_id) return

    const sender = ev.sender?.display_name ?? 'New message'
    let title = sender
    if (ev.conversation?.kind === 'group') {
      const known = s.conversations.find((c) => c.id === ev.conversation_id)
      title = `${sender} · ${known?.title || ev.conversation.title || 'Group'}`
    }
    const text = oneLine(ev.message.body)
    os.notify({
      title,
      body: text.length > 160 ? `${text.slice(0, 157)}…` : text,
      icon: MessageCircle,
      color: '#8b5cf6',
      onClick: () => os.open('messages', { conversation: ev.conversation_id }),
    })
  })
}
