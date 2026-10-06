// Names, initials and times for Messages.

import type { Conversation, Message, User } from './types'

/** "Ada Lovelace" → "AL", "bob" → "B". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  const first = Array.from(words[0])[0] ?? ''
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** A stable colour slot (0–5) for a person or group. */
export const toneOf = (id: number) => Math.abs(id) % 6

const DAY = 86_400_000

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Whole calendar days between two instants (0 = same day). */
export function daysApart(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY)
}

export const clock = (ts: number) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export const fullDate = (ts: number) =>
  new Date(ts * 1000).toLocaleString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** For the conversation list: "now", "5 min", "14:05", "Yesterday", "Mon", "3 Mar", "3/3/24". */
export function shortTime(ts: number, now = Date.now()): string {
  const ms = ts * 1000
  const ago = now - ms
  if (ago < 60_000) return 'now'
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)} min`
  const days = daysApart(ms, now)
  if (days === 0) return clock(ts)
  if (days === 1) return 'Yesterday'
  const d = new Date(ms)
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  if (d.getFullYear() === new Date(now).getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'numeric', year: '2-digit' })
}

/** For day separators: "Today", "Yesterday", "Monday", "Monday 3 March", "3 March 2025". */
export function dayLabel(ts: number, now = Date.now()): string {
  const ms = ts * 1000
  const days = daysApart(ms, now)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  const d = new Date(ms)
  if (days < 7 && days > 0) return d.toLocaleDateString([], { weekday: 'long' })
  if (d.getFullYear() === new Date(now).getFullYear()) return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
}

export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The other person in a direct conversation. */
export function otherMember(c: Conversation, meId: number | undefined) {
  return c.members.find((m) => m.id !== meId) ?? c.members[0]
}

export function memberName(c: Conversation | undefined, userId: number | null, meId: number | undefined): string {
  if (userId !== null && userId === meId) return 'You'
  return c?.members.find((m) => m.id === userId)?.display_name ?? 'Someone'
}

/** The grey line under a conversation's name in the list. */
export function previewOf(c: Conversation, me: User | null): string {
  const m: Message | null = c.last_message
  if (!m) return c.kind === 'group' ? 'Group created — say hello' : 'No messages yet'
  const text = m.deleted ? 'Message deleted' : oneLine(m.body)
  if (m.sender_id === me?.id) return `You: ${text}`
  if (c.kind === 'group') return `${memberName(c, m.sender_id, me?.id).split(' ')[0]}: ${text}`
  return text
}

/** "Ada is typing", "Ada and Bob are typing", "3 people are typing". */
export function typingText(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`
  return `${names.length} people are typing`
}
