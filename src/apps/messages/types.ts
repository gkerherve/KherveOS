// What the Messages server (server/kherveos_server/messages.py) sends.

import type { User } from '@/os/server'

export type { User }

export interface Member extends User {
  online: boolean
}

export interface Message {
  id: number
  conversation_id: number
  sender_id: number | null
  /** Empty when deleted. */
  body: string
  /** Unix time in seconds. */
  created_at: number
  edited_at: number | null
  deleted: boolean
}

/** A message as the app shows it: a real one, or one still on its way (negative id). */
export interface ChatMessage extends Message {
  clientId?: string
  status?: 'sending' | 'failed'
  error?: string
}

export interface Conversation {
  id: number
  kind: 'direct' | 'group'
  /** Direct: the other person's name. Group: its name, or its members' names. */
  title: string
  /** The name a group was given ('' if none). */
  custom_title: string
  members: Member[]
  last_message: Message | null
  unread_count: number
  last_read_id: number
  created_by: number | null
  created_at: number
  updated_at: number
}

// ------------------------------------------------------------ live events

export interface MessageNewEvent {
  type: 'message.new'
  conversation_id: number
  message: Message
  sender: User
  client_id: string | null
  conversation: { kind: 'direct' | 'group'; title: string }
}

export interface MessageUpdatedEvent {
  type: 'message.updated'
  conversation_id: number
  message: Message
}

export interface ConversationNewEvent {
  type: 'conversation.new'
  conversation_id: number
}

export interface ConversationReadEvent {
  type: 'conversation.read'
  conversation_id: number
  last_read_id: number
  unread_count: number
}

export interface TypingEvent {
  type: 'typing'
  conversation_id: number
  user: User
}

export interface PresenceEvent {
  type: 'presence'
  user_id: number
  online: boolean
}
