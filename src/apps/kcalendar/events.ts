// Calendar's dates and events, as plain functions (no browser, no file system):
// the month grid, the day keys (YYYY-MM-DD), and the event list kept in events.json.

export interface CalEvent {
  id: string
  /** The day, as YYYY-MM-DD. */
  date: string
  /** Start time, HH:MM, or '' for an all-day event. */
  time: string
  title: string
  note: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The day key of a date: 2026-10-08. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A day key back to a date (local midnight), or null when it is not one. */
export function parseDayKey(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return d.getMonth() === Number(m[2]) - 1 ? d : null
}

export const isTime = (t: string) => t === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/** The weeks of a month as seven-day rows, Monday first; days outside the month are included. */
export function monthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    weeks.push(Array.from({ length: 7 }, (_, d) => new Date(year, month, 1 - offset + w * 7 + d)))
  }
  return weeks
}

/** Events in the order they happen: by day, then by time (all-day first), then title. */
export function sortEvents(list: CalEvent[]): CalEvent[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title))
}

export function eventsOn(list: CalEvent[], key: string): CalEvent[] {
  return sortEvents(list.filter((e) => e.date === key))
}

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** The events.json text: a list, one object per event. */
export function serializeEvents(list: CalEvent[]): string {
  return JSON.stringify({ format: 'kcalendar', version: 1, events: sortEvents(list) }, null, 1) + '\n'
}

/** Read events.json. Entries that do not have a day and a title are left out. */
export function parseEvents(text: string): CalEvent[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This is not a Calendar file (events.json is not valid JSON).')
  }
  const list = (raw as { events?: unknown })?.events
  if (!Array.isArray(list)) return []
  const out: CalEvent[] = []
  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const date = typeof o.date === 'string' ? o.date : ''
    const title = typeof o.title === 'string' ? o.title : ''
    if (!parseDayKey(date) || !title.trim()) continue
    out.push({
      id: typeof o.id === 'string' && o.id ? o.id : newId(),
      date,
      time: typeof o.time === 'string' && isTime(o.time) ? o.time : '',
      title: title.trim(),
      note: typeof o.note === 'string' ? o.note : '',
    })
  }
  return out
}
