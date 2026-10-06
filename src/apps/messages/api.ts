// The Messages endpoints (all under /api/messages), plus people search.

import { api } from '@/os/server'
import type { Conversation, Message, User } from './types'

const BASE = '/messages'

export interface MessagePage {
  messages: Message[]
  has_more: boolean
}

export const messagesApi = {
  conversations: () => api<{ conversations: Conversation[] }>(`${BASE}/conversations`).then((r) => r.conversations),

  conversation: (id: number) => api<{ conversation: Conversation }>(`${BASE}/conversations/${id}`).then((r) => r.conversation),

  /** One other person: their direct chat (reused if it exists). Several: a new group. */
  start: (usernames: string[], title?: string) =>
    api<{ conversation: Conversation; created: boolean }>(`${BASE}/conversations`, { body: { usernames, title } }),

  /** A page of messages, oldest first; `before` pages back in time. */
  messages: (id: number, before?: number, limit = 50) =>
    api<MessagePage>(`${BASE}/conversations/${id}/messages`, { query: { before, limit } }),

  send: (id: number, body: string, clientId: string) =>
    api<{ message: Message }>(`${BASE}/conversations/${id}/messages`, { body: { body, client_id: clientId } }).then((r) => r.message),

  markRead: (id: number, messageId?: number) =>
    api<{ ok: boolean; last_read_id: number; unread_count: number }>(`${BASE}/conversations/${id}/read`, {
      body: { message_id: messageId },
    }),

  edit: (messageId: number, body: string) =>
    api<{ message: Message }>(`${BASE}/messages/${messageId}`, { method: 'PATCH', body: { body } }).then((r) => r.message),

  remove: (messageId: number) =>
    api<{ message: Message }>(`${BASE}/messages/${messageId}`, { method: 'DELETE' }).then((r) => r.message),

  searchPeople: (q: string) => api<{ users: User[] }>('/users/search', { query: { q } }).then((r) => r.users),
}

export const MAX_MESSAGE = 4000
