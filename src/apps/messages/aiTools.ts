// Messages' AI tools (messages_list_conversations, _read_conversation,
// _open_conversation, _send): names, arguments and descriptions are in
// src/os/ai/manifests/communication.ts. Messages.tsx registers these with
// useAppTools. They work on the app's store (one per page: Messages is a
// singleton window).
//
// Nothing is sent without the user allowing it: messages_send always asks
// (ctx.confirm) with who it goes to and the text first.

import { useAuth, useServer } from '@/os/server'
import { clipText, waitUntil, type AppTools } from '@/os/ai/appTools'
import { MAX_MESSAGE, messagesApi } from './api'
import { findConversation, openConversation, sendMessage, startConversation, useMessages } from './store'
import type { Conversation, Message, User } from './types'

const get = useMessages.getState

const count = (v: unknown, def: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.round(v))) : def
const when = (ts: number) => new Date(ts * 1000).toISOString()

/** Messages is open, signed in and has its conversation list; a clear error otherwise. */
async function ready(signal?: AbortSignal) {
  const auth = useAuth.getState
  await waitUntil(() => {
    const s = get()
    if (s.mounted && s.me && s.status !== 'loading') return true
    return useServer.getState().status === 'offline' || (auth().checked && !auth().user)
  }, 15_000, signal)
  const s = get()
  if (s.mounted && s.me && s.status !== 'loading') {
    if (s.status === 'error') throw new Error(`Chat could not load the conversations: ${s.error ?? 'unknown error'}.`)
    return s.me
  }
  if (useServer.getState().status === 'offline') {
    throw new Error('Chat needs the KherveOS server, which is not running: the user has to start it ("npm run server" in the KherveOS folder).')
  }
  if (auth().checked && !auth().user) throw new Error('The user has to sign in to KherveOS in the Messages window first.')
  throw new Error('Chat is not ready yet. Try again in a moment.')
}

const norm = (t: string) => t.trim().replace(/^@/, '').toLowerCase()

/** The conversation `v` names: an id, a group's title, or a person (their direct chat first). */
function findByName(v: unknown, me: User): Conversation | null {
  const raw = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  if (!raw) throw new Error('Say which conversation: its id, or the name of a person or group.')
  const list = get().conversations
  if (/^\d+$/.test(raw)) {
    const c = findConversation(Number(raw))
    if (c) return c
  }
  const want = norm(raw)
  const others = (c: Conversation) => c.members.filter((m) => m.id !== me.id)
  const exact = list.filter(
    (c) =>
      c.title.toLowerCase() === want ||
      c.custom_title.toLowerCase() === want ||
      (c.kind === 'direct' && others(c).some((m) => m.username.toLowerCase() === want || m.display_name.toLowerCase() === want)),
  )
  const loose = exact.length
    ? exact
    : list.filter(
        (c) =>
          c.title.toLowerCase().includes(want) ||
          (c.kind === 'direct' && others(c).some((m) => m.username.toLowerCase().includes(want) || m.display_name.toLowerCase().includes(want))),
      )
  if (loose.length === 1) return loose[0]
  if (loose.length > 1) {
    const direct = loose.filter((c) => c.kind === 'direct')
    if (direct.length === 1) return direct[0]
    throw new Error(`"${raw}" matches several conversations: ${loose.map((c) => `${c.title} (id ${c.id})`).join(', ')}. Give the id.`)
  }
  return null
}

function resolve(v: unknown, me: User): Conversation {
  const c = findByName(v, me)
  if (!c) throw new Error(`No conversation with "${String(v ?? '')}". messages_list_conversations shows them; messages_send can start a new one with a person.`)
  return c
}

function describe(c: Conversation, me: User) {
  const last = c.last_message
  return {
    id: c.id,
    title: c.title,
    kind: c.kind,
    members: c.members.filter((m) => m.id !== me.id).map((m) => `${m.display_name} (@${m.username})${m.online ? ' online' : ''}`),
    unread: c.unread_count,
    ...(last && {
      last_message: {
        from: senderName(c, last, me),
        text: last.deleted ? '(deleted)' : clipText(last.body, 200),
        at: when(last.created_at),
      },
    }),
  }
}

function senderName(c: Conversation, m: Message, me: User): string {
  if (m.sender_id === me.id) return 'me'
  return c.members.find((x) => x.id === m.sender_id)?.display_name ?? 'someone'
}

/** The latest `n` messages, oldest first (pages back through the server). */
async function latest(id: number, n: number): Promise<{ messages: Message[]; more: boolean }> {
  let out: Message[] = []
  let before: number | undefined
  let more = true
  while (out.length < n && more) {
    const page = await messagesApi.messages(id, before, Math.min(50, n - out.length))
    out = [...page.messages, ...out]
    more = page.has_more
    if (!page.messages.length) break
    before = page.messages[0].id
  }
  return { messages: out.slice(-n), more }
}

/** A person on this server, for a first message. */
async function findPerson(v: unknown, me: User): Promise<User> {
  const raw = String(v ?? '').trim()
  const want = norm(raw)
  const people = (await messagesApi.searchPeople(want)).filter((u) => u.id !== me.id)
  const exact = people.filter((u) => u.username.toLowerCase() === want || u.display_name.toLowerCase() === want)
  const pick = exact.length === 1 ? exact : people
  if (pick.length === 1) return pick[0]
  if (!pick.length) throw new Error(`Nobody called "${raw}" has an account on this KherveOS server (and there is no such conversation).`)
  throw new Error(`"${raw}" could be: ${pick.slice(0, 8).map((u) => `${u.display_name} (@${u.username})`).join(', ')}. Give the username.`)
}

export function messagesAiTools(): AppTools {
  return {
    async list_conversations(a, ctx) {
      const me = await ready(ctx.signal)
      const all = get().conversations
      const list = a.unread_only === true ? all.filter((c) => c.unread_count > 0) : all
      const limit = count(a.limit, 20, 100)
      return {
        me: `${me.display_name} (@${me.username})`,
        total: list.length,
        conversations: list.slice(0, limit).map((c) => describe(c, me)),
      }
    },

    async read_conversation(a, ctx) {
      const me = await ready(ctx.signal)
      const c = resolve(a.conversation, me)
      const { messages, more } = await latest(c.id, count(a.limit, 20, 200))
      return {
        id: c.id,
        title: c.title,
        unread: c.unread_count,
        messages: messages.map((m) => ({
          from: senderName(c, m, me),
          text: m.deleted ? '(deleted)' : clipText(m.body, 2000),
          at: when(m.created_at),
          ...(m.edited_at && { edited: true }),
        })),
        ...(more && { older_messages: true }),
      }
    },

    async open_conversation(a, ctx) {
      const me = await ready(ctx.signal)
      const c = resolve(a.conversation, me)
      openConversation(c.id)
      return { shown: c.id, title: c.title }
    },

    async send(a, ctx) {
      const me = await ready(ctx.signal)
      const body = typeof a.text === 'string' ? a.text.trim() : ''
      if (!body) throw new Error('"text" is empty: give the message to send.')
      if (body.length > MAX_MESSAGE) throw new Error(`The message is ${body.length} characters long: at most ${MAX_MESSAGE}. Split it.`)

      const existing = findByName(a.to, me)
      const person = existing ? null : await findPerson(a.to, me)
      const who = existing
        ? existing.kind === 'group'
          ? `the group "${existing.title}" (${existing.members.filter((m) => m.id !== me.id).map((m) => m.display_name).join(', ')})`
          : existing.title
        : `${person!.display_name} (@${person!.username}, a new conversation)`
      if (!(await ctx.confirm(`send a message to ${who}`, clipText(body, 600)))) {
        throw new Error('The user did not allow sending this message. It was not sent.')
      }

      const c = existing ?? (await startConversation([person!.username]))
      if (existing) openConversation(c.id)
      sendMessage(c.id, body)
      // The store sends it with a temporary id; wait for the server's answer.
      const temp = [...(get().threads[c.id]?.items ?? [])].reverse().find((x) => x.id < 0 && x.body === body)
      const clientId = temp?.clientId
      const state = () => get().threads[c.id]?.items.find((x) => x.clientId === clientId)
      if (clientId) await waitUntil(() => { const m = state(); return !m || m.id > 0 || m.status === 'failed' }, 20_000, ctx.signal)
      const m = clientId ? state() : undefined
      if (m?.status === 'failed') throw new Error(`The message could not be sent: ${m.error ?? 'unknown error'}. It is shown in Messages with a retry button.`)
      return { sent: true, conversation: c.id, to: c.title, ...(m && m.id < 0 && { note: 'Still being sent.' }) }
    },
  }
}
