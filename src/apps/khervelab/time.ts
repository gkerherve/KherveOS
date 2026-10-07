// Lab wall-clock times ("YYYY-MM-DDTHH:MM") without the browser's time zone:
// day arithmetic is done on UTC dates, so a slot never shifts (as in the
// desktop's web calendar, khervecal.js).

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-10-07" → a UTC date. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(day: string, n: number): string {
  return dayKey(new Date(parseDay(day).getTime() + n * 86_400_000))
}

/** Monday 0 … Sunday 6. */
export function weekday(day: string): number {
  return (parseDay(day).getUTCDay() + 6) % 7
}

export function mondayOf(day: string): string {
  return addDays(day, -weekday(day))
}

/** Minutes from 00:00 of `day` to a wall-clock stamp (negative before, > 1440 after). */
export function minutesFrom(day: string, stamp: string): number {
  const days = (parseDay(stamp.slice(0, 10)).getTime() - parseDay(day).getTime()) / 86_400_000
  return days * 1440 + Number(stamp.slice(11, 13)) * 60 + Number(stamp.slice(14, 16))
}

/** `day` + minutes → a stamp. */
export function stampAt(day: string, minutes: number): string {
  const d = Math.floor(minutes / 1440)
  const m = minutes - d * 1440
  return `${addDays(day, d)}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

export function addMinutes(stamp: string, minutes: number): string {
  return stampAt(stamp.slice(0, 10), minutesFrom(stamp.slice(0, 10), stamp) + minutes)
}

export function diffMinutes(a: string, b: string): number {
  return minutesFrom(a.slice(0, 10), b) - minutesFrom(a.slice(0, 10), a)
}

export const hhmm = (stamp: string) => stamp.slice(11, 16)

/** "Tue 7 Oct" */
export function dayLabel(day: string, withYear = false): string {
  const d = parseDay(day)
  return `${DAY_NAMES[weekday(day)]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`
}

/** "Tue 7 Oct 09:00–11:00", or across days "Fri 9 Oct 17:00 → Mon 12 Oct 08:00". */
export function rangeLabel(start: string, end: string): string {
  if (start.slice(0, 10) === end.slice(0, 10)) return `${dayLabel(start)} ${hhmm(start)}–${hhmm(end)}`
  const nextDay = addDays(start, 1) === end.slice(0, 10)
  return nextDay ? `${dayLabel(start)} ${hhmm(start)}–${hhmm(end)} (next day)` : `${dayLabel(start)} ${hhmm(start)} → ${dayLabel(end)} ${hhmm(end)}`
}

/** "Oct 2026" or "5 – 11 Oct 2026" */
export function weekTitle(first: string, days: number): string {
  const a = parseDay(first)
  if (days === 1) return dayLabel(first, true)
  const last = parseDay(addDays(first, days - 1))
  const sameMonth = a.getUTCMonth() === last.getUTCMonth()
  return `${a.getUTCDate()}${sameMonth ? '' : ` ${MONTHS[a.getUTCMonth()]}`} – ${last.getUTCDate()} ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`
}

/** 30 min, 4.5 h, 24 h, 1 h 10 min (as the desktop shows lengths). */
export function fmtDuration(minutes: number): string {
  minutes = Math.round(minutes)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (m === 0) return `${h} h`
  if (m === 15 || m === 30 || m === 45) return `${minutes / 60} h`
  return `${h} h ${m} min`
}

export function money(currency: string, x: number | null | undefined): string {
  if (x === null || x === undefined) return ''
  return `${currency}${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Accepts "2026-10-07 09:00", "2026-10-07T09:00(:00)", returns "2026-10-07T09:00" or null. */
export function normaliseStamp(text: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/.exec(text.trim())
  if (!m) return null
  return `${m[1]}T${pad(Number(m[2]))}:${m[3]}`
}
