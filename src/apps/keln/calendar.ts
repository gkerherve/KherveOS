// The timeline / month view of entries (pure): which entries fall on which day, the month grid.

import type { Entry } from './model.ts'
import { dayOf } from './model.ts'

const pad = (n: number): string => String(n).padStart(2, '0')

export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The weeks of a month as seven-day rows (Monday first), including the days of the neighbouring months. */
export function monthGrid(year: number, month: number): Date[][] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => new Date(year, month, 1 - offset + w * 7 + d)))
}

export function entriesByDay(entries: readonly Entry[]): Map<string, Entry[]> {
  const m = new Map<string, Entry[]>()
  for (const e of entries) m.set(dayOf(e.date), [...(m.get(dayOf(e.date)) ?? []), e])
  for (const list of m.values()) list.sort((a, b) => a.date.localeCompare(b.date))
  return m
}

/** Entries grouped by month, newest first (the timeline list). */
export function timeline(entries: readonly Entry[]): Array<{ month: string; entries: Entry[] }> {
  const m = new Map<string, Entry[]>()
  for (const e of [...entries].sort((a, b) => b.date.localeCompare(a.date))) m.set(e.date.slice(0, 7), [...(m.get(e.date.slice(0, 7)) ?? []), e])
  return [...m].map(([month, list]) => ({ month, entries: list }))
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The month (year, month index) holding the newest entry, or the current one. */
export function latestMonth(entries: readonly Entry[], today: Date): { year: number; month: number } {
  const last = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0]
  const d = last ? new Date(`${dayOf(last.date)}T12:00:00`) : today
  return { year: d.getFullYear(), month: d.getMonth() }
}
