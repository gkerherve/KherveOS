// Messages state: the conversation list, the messages loaded so far, who is
// online and who is typing. Messages is a singleton window, so one module-level
// store serves it; `resetFor(me)` starts it afresh each time the app mounts.
//
// Live updates come from the server's websocket (see `listen()`); everything
// here is written so an event and the HTTP response it duplicates can arrive
// in either order.

import { create } from 'zustand'
import { ApiError, realtime } from '@/os/server'
import { messagesApi, type MessagePage } from './api'
import type {
  ChatMessage,
  Conversation,
  ConversationNewEvent,
  ConversationReadEvent,
  Message,
  MessageNewEvent,
  MessageUpdatedEvent,
  PresenceEvent,
  TypingEvent,
  User,
} from './types'

export interface Thread {
  /** Oldest first: real messages in id order, then any still being sent. */
  items: ChatMessage[]
  hasMore: boolean
  loaded: boolean
  loading: boolean
  loadingOlder: boolean
  error: string | null
  olderError: string | null
}

export interface TypingEntry {
  name: string
  until: number
}

export interface MessagesState {
  me: User | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /** Newest activity first. */
  conversations: Conversation[]
  activeId: number | null
  threads: Record<number, Thread>
  /** userId → online. */
  presence: Record<number, boolean>
  /** conversationId → userId → who is typing, until when. */
  typing: Record<number, Record<number, TypingEntry>>
  /** The Messages window is open… */
  mounted: boolean
  /** …and the person can see it (focused, not minimised, browser tab visible). */
  seen: boolean
}

const initial = (me: User | null): MessagesState => ({
  me,
  status: 'loading',
  error: null,
  conversations: [],
  activeId: null,
  threads: {},
  presence: {},
  typing: {},
  mounted: false,
  seen: false,
})

export const useMessages = create<MessagesState>(() => initial(null))
const set = useMessages.setState
const get = useMessages.getState

/** Unsent text per conversation. */
export const drafts = new Map<number, string>()

const TYPING_MS = 6000
export const EMPTY_THREAD: Thread = {
  items: [],
  hasMore: false,
  loaded: false,
  loading: false,
  loadingOlder: false,
  error: null,
  olderError: null,
}

// Bumped on reset, so answers to requests made for a previous session are dropped.
let epoch = 0
let listSeq = 0
let tempSeq = 0
const inflight = new Map<number, Promise<Conversation | null>>()
const reading = new Set<number>()

export const errorText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e))

export function resetFor(me: User) {
  epoch++
  drafts.clear()
  inflight.clear()
  reading.clear()
  set(initial(me), true)
}

// ------------------------------------------------------------ helpers

const byRecent = (a: Conversation, b: Conversation) => b.updated_at - a.updated_at || b.id - a.id

function presenceFrom(list: Conversation[]): Record<number, boolean> {
  const out: Record<number, boolean> = {}
  for (const c of list) for (const m of c.members) out[m.id] = m.online
  return out
}

function putConversation(c: Conversation) {
  set((s) => ({
    conversations: [...s.conversations.filter((x) => x.id !== c.id), c].sort(byRecent),
    presence: { ...s.presence, ...presenceFrom([c]) },
  }))
}

function patchConversation(id: number, fn: (c: Conversation) => Conversation) {
  set((s) => {
    if (!s.conversations.some((c) => c.id === id)) return s
    return { conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)).sort(byRecent) }
  })
}

function patchThread(id: number, fn: (t: Thread) => Partial<Thread>) {
  set((s) => {
    const t = s.threads[id] ?? EMPTY_THREAD
    return { threads: { ...s.threads, [id]: { ...t, ...fn(t) } } }
  })
}

export const findConversation = (id: number | null) =>
  id === null ? undefined : get().conversations.find((c) => c.id === id)

/**
 * Put a real message in a thread: it replaces its optimistic copy (keeping that
 * copy's clientId, so the row keeps its React key) or an older version of itself.
 * Real messages stay in id order; unsent ones stay last.
 */
function absorb(items: ChatMessage[], m: Message, clientId?: string | null): ChatMessage[] {
  const temp = clientId ? items.find((x) => x.id < 0 && x.clientId === clientId) : undefined
  const out = temp ? items.filter((x) => x !== temp) : items.slice()
  const at = out.findIndex((x) => x.id === m.id)
  if (at >= 0) {
    out[at] = { ...m, clientId: out[at].clientId ?? temp?.clientId }
    return out
  }
  const msg: ChatMessage = temp ? { ...m, clientId: temp.clientId } : m
  let i = out.length
  while (i > 0 && (out[i - 1].id < 0 || out[i - 1].id > m.id)) i--
  out.splice(i, 0, msg)
  return out
}

/** Combine the newest page with what is already loaded (live messages may have come in meanwhile). */
function mergeLatest(t: Thread, page: MessagePage): Partial<Thread> {
  const real = t.items.filter((x) => x.id > 0)
  const unsent = t.items.filter((x) => x.id < 0)
  const fresh = page.messages
  if (!fresh.length) return { items: t.items, hasMore: false }
  // Missed more than a page (e.g. while offline): start again from the newest page.
  const gap = page.has_more && real.length > 0 && fresh[0].id > real[real.length - 1].id
  if (!real.length || gap) return { items: [...fresh, ...unsent], hasMore: page.has_more }
  const byId = new Map<number, ChatMessage>()
  for (const m of real) byId.set(m.id, m)
  for (const m of fresh) byId.set(m.id, { ...m, clientId: byId.get(m.id)?.clientId })
  const items = [...byId.values()].sort((a, b) => a.id - b.id)
  const hasMore = fresh[0].id < real[0].id || !t.loaded ? page.has_more : t.hasMore
  return { items: [...items, ...unsent], hasMore }
}

// ------------------------------------------------------------- loading

export async function loadConversations() {
  const seq = ++listSeq
  const e = epoch
  try {
    const list = await messagesApi.conversations()
    if (seq !== listSeq || e !== epoch) return
    set((s) => {
      // Keep the open conversation even if the server leaves it out (an empty chat someone else started).
      const keep = s.conversations.filter((c) => c.id === s.activeId && !list.some((x) => x.id === c.id))
      return {
        conversations: [...list, ...keep].sort(byRecent),
        status: 'ready',
        error: null,
        presence: { ...s.presence, ...presenceFrom(list) },
      }
    })
  } catch (err) {
    if (seq !== listSeq || e !== epoch) return
    set((s) => (s.status === 'ready' ? s : { status: 'error', error: errorText(err) }))
  }
}

/** Fetch one conversation's summary (e.g. one we just heard about). Resolves to null if we can't see it. */
export function fetchConversation(id: number): Promise<Conversation | null> {
  const pending = inflight.get(id)
  if (pending) return pending
  const e = epoch
  const p = messagesApi
    .conversation(id)
    .then((c) => {
      if (e !== epoch) return null
      putConversation(c)
      return c
    })
    .catch(() => null)
    .finally(() => {
      if (inflight.get(id) === p) inflight.delete(id)
    })
  inflight.set(id, p)
  return p
}

export async function loadLatest(id: number) {
  if (get().threads[id]?.loading) return
  const e = epoch
  patchThread(id, () => ({ loading: true, error: null }))
  try {
    const page = await messagesApi.messages(id)
    if (e !== epoch) return
    patchThread(id, (t) => ({ ...mergeLatest(t, page), loaded: true, loading: false }))
  } catch (err) {
    if (e !== epoch) return
    patchThread(id, () => ({ loading: false, error: errorText(err) }))
  }
}

export async function loadOlder(id: number) {
  const t = get().threads[id]
  if (!t || !t.loaded || !t.hasMore || t.loading || t.loadingOlder) return
  const oldest = t.items.find((x) => x.id > 0)?.id
  if (oldest === undefined) return
  const e = epoch
  patchThread(id, () => ({ loadingOlder: true, olderError: null }))
  try {
    const page = await messagesApi.messages(id, oldest)
    if (e !== epoch) return
    patchThread(id, (t) => {
      const known = new Set(t.items.map((x) => x.id))
      return { items: [...page.messages.filter((m) => !known.has(m.id)), ...t.items], hasMore: page.has_more, loadingOlder: false }
    })
  } catch (err) {
    if (e !== epoch) return
    patchThread(id, () => ({ loadingOlder: false, olderError: errorText(err) }))
  }
}

/** Re-read what may have been missed while the connection was down. */
export function resync() {
  void loadConversations()
  const id = get().activeId
  // Other conversations' cached messages may have gaps now: load them afresh when opened.
  set((s) => ({ threads: id !== null && s.threads[id] ? { [id]: s.threads[id] } : {} }))
  if (id !== null) void loadLatest(id)
}

// ----------------------------------------------------------- navigation

export function openConversation(id: number) {
  set({ activeId: id })
  if (!findConversation(id)) {
    void fetchConversation(id).then((c) => {
      if (!c && get().activeId === id && !findConversation(id)) set({ activeId: null })
    })
  }
  const t = get().threads[id]
  if (!t || (!t.loaded && !t.loading) || t.error) void loadLatest(id)
}

export function closeConversation() {
  set({ activeId: null })
}

/** Start (or reopen) a chat with these people and open it. */
export async function startConversation(usernames: string[], title?: string): Promise<Conversation> {
  const { conversation } = await messagesApi.start(usernames, title)
  putConversation(conversation)
  openConversation(conversation.id)
  return conversation
}

// -------------------------------------------------------------- sending

export function sendMessage(conversationId: number, body: string) {
  const me = get().me
  if (!me) return
  const n = ++tempSeq
  const clientId = `${Date.now().toString(36)}-${n}-${Math.random().toString(36).slice(2, 8)}`
  const temp: ChatMessage = {
    id: -n,
    conversation_id: conversationId,
    sender_id: me.id,
    body,
    created_at: Date.now() / 1000,
    edited_at: null,
    deleted: false,
    clientId,
    status: 'sending',
  }
  patchThread(conversationId, (t) => ({ items: [...t.items, temp] }))
  void deliver(conversationId, clientId, body)
}

async function deliver(conversationId: number, clientId: string, body: string) {
  const e = epoch
  try {
    const m = await messagesApi.send(conversationId, body, clientId)
    if (e === epoch) receive(m, clientId)
  } catch (err) {
    if (e !== epoch) return
    patchThread(conversationId, (t) => ({
      items: t.items.map((x) => (x.id < 0 && x.clientId === clientId ? { ...x, status: 'failed', error: errorText(err) } : x)),
    }))
  }
}

export function retryMessage(conversationId: number, clientId: string) {
  const temp = get().threads[conversationId]?.items.find((x) => x.id < 0 && x.clientId === clientId)
  if (!temp) return
  patchThread(conversationId, (t) => ({
    items: t.items.map((x) => (x === temp ? { ...x, status: 'sending', error: undefined } : x)),
  }))
  void deliver(conversationId, clientId, temp.body)
}

export function discardMessage(conversationId: number, clientId: string) {
  patchThread(conversationId, (t) => ({ items: t.items.filter((x) => !(x.id < 0 && x.clientId === clientId)) }))
}

export async function editMessage(m: ChatMessage, body: string) {
  applyUpdate(await messagesApi.edit(m.id, body))
}

export async function deleteMessage(m: ChatMessage) {
  applyUpdate(await messagesApi.remove(m.id))
}

// ---------------------------------------------------------- read state

export async function markRead(id: number) {
  const c = findConversation(id)
  if (!c || reading.has(id)) return
  const newest = c.last_message?.id ?? 0
  if (c.unread_count === 0 && newest <= c.last_read_id) return
  reading.add(id)
  const e = epoch
  patchConversation(id, (c) => ({ ...c, unread_count: 0, last_read_id: Math.max(c.last_read_id, newest) }))
  try {
    const r = await messagesApi.markRead(id, newest || undefined)
    if (e === epoch) applyRead(id, r.last_read_id)
  } catch {
    // The next refresh puts the count right.
  } finally {
    reading.delete(id)
  }
  // Something new may have come in while we were asking.
  const s = get()
  const now = findConversation(id)
  if (e === epoch && s.seen && s.activeId === id && now && (now.last_message?.id ?? 0) > now.last_read_id) void markRead(id)
}

export function markAllRead() {
  for (const c of get().conversations) if (c.unread_count > 0) void markRead(c.id)
}

function applyRead(id: number, lastRead: number) {
  const c = findConversation(id)
  if (!c) return
  if ((c.last_message?.id ?? 0) <= lastRead) {
    // Everything we know of is read; anything newer will arrive as an event and be counted then.
    patchConversation(id, (c) => ({ ...c, last_read_id: Math.max(c.last_read_id, lastRead), unread_count: 0 }))
  } else {
    patchConversation(id, (c) => ({ ...c, last_read_id: Math.max(c.last_read_id, lastRead) }))
    void fetchConversation(id)
  }
}

// --------------------------------------------------------- live events

/** A real message arrived (from the server's answer to our send, or as an event). */
function receive(m: Message, clientId?: string | null) {
  const s = get()
  const id = m.conversation_id
  if (s.threads[id]) patchThread(id, (t) => ({ items: absorb(t.items, m, clientId) }))
  const mine = m.sender_id === s.me?.id
  patchConversation(id, (c) => {
    if (c.last_message && c.last_message.id >= m.id) return c.last_message.id === m.id ? { ...c, last_message: m } : c
    const visible = s.seen && s.activeId === id
    return {
      ...c,
      last_message: m,
      updated_at: Math.max(c.updated_at, m.created_at),
      unread_count: mine ? 0 : visible ? c.unread_count : c.unread_count + 1,
      last_read_id: mine ? Math.max(c.last_read_id, m.id) : c.last_read_id,
    }
  })
}

function applyUpdate(m: Message) {
  const s = get()
  const id = m.conversation_id
  const t = s.threads[id]
  if (t?.items.some((x) => x.id === m.id)) {
    patchThread(id, (t) => ({ items: t.items.map((x) => (x.id === m.id ? { ...m, clientId: x.clientId } : x)) }))
  }
  patchConversation(id, (c) => {
    let next = c.last_message?.id === m.id ? { ...c, last_message: m } : c
    // A deleted message no longer counts as unread.
    if (m.deleted && m.sender_id !== s.me?.id && m.id > c.last_read_id && c.unread_count > 0) {
      next = { ...next, unread_count: next.unread_count - 1 }
    }
    return next
  })
}

function clearTyping(conversationId: number, userId: number | null) {
  if (userId === null) return
  set((s) => {
    const cur = s.typing[conversationId]
    if (!cur?.[userId]) return s
    const rest = { ...cur }
    delete rest[userId]
    return { typing: { ...s.typing, [conversationId]: rest } }
  })
}

function onMessageNew(ev: MessageNewEvent) {
  clearTyping(ev.conversation_id, ev.message.sender_id)
  receive(ev.message, ev.client_id)
  if (!findConversation(ev.conversation_id)) void fetchConversation(ev.conversation_id)
}

function onTyping(ev: TypingEvent) {
  if (ev.user.id === get().me?.id) return
  const now = Date.now()
  set((s) => {
    const next: Record<number, TypingEntry> = {}
    for (const [uid, entry] of Object.entries(s.typing[ev.conversation_id] ?? {})) {
      if (entry.until > now) next[Number(uid)] = entry
    }
    next[ev.user.id] = { name: ev.user.display_name, until: now + TYPING_MS }
    return { typing: { ...s.typing, [ev.conversation_id]: next } }
  })
}

/** Listen for the server's live events. Returns a function that stops listening. */
export function listen(): () => void {
  const offs = [
    realtime.on('message.new', (ev) => onMessageNew(ev as unknown as MessageNewEvent)),
    realtime.on('message.updated', (ev) => applyUpdate((ev as unknown as MessageUpdatedEvent).message)),
    realtime.on('conversation.new', (ev) => {
      const id = (ev as unknown as ConversationNewEvent).conversation_id
      if (!findConversation(id)) void fetchConversation(id)
    }),
    realtime.on('conversation.read', (ev) => {
      const r = ev as unknown as ConversationReadEvent
      applyRead(r.conversation_id, r.last_read_id)
    }),
    realtime.on('typing', (ev) => onTyping(ev as unknown as TypingEvent)),
    realtime.on('presence', (ev) => {
      const p = ev as unknown as PresenceEvent
      set((s) => ({ presence: { ...s.presence, [p.user_id]: p.online } }))
    }),
  ]
  return () => {
    for (const off of offs) off()
  }
}
