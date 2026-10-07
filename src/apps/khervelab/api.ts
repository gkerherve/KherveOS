// The KherveLAB endpoints (all under /api/lab). The booking rules live on the
// server only: the app asks /quote before booking and never re-implements them.

import { api, ApiError } from '@/os/server'
import type { Booking, CalendarData, Instrument, InstrumentFields, Issue, LabSettings, Me, Member, Person, Quote, Session } from './types'

const BASE = '/lab'

export interface InstrumentBody extends Partial<InstrumentFields> {
  rates?: Record<string, number>
  sessions?: Session[]
  trained?: number[]
}

export interface MyBookings {
  owner: { id: number; full_name: string; username: string }
  bookings: Booking[]
  month_total: number
  currency: string
}

export const labApi = {
  me: () => api<Me>(`${BASE}/me`),
  saveSettings: (body: Partial<Omit<LabSettings, 'categories' | 'account_approval' | 'show_names'>> & {
    categories?: string[]
    account_approval?: boolean
    show_names?: boolean
  }) => api<{ settings: LabSettings }>(`${BASE}/settings`, { method: 'PATCH', body }),

  instruments: (all = false) => api<{ instruments: Instrument[] }>(`${BASE}/instruments`, { query: { all: all || undefined } }).then((r) => r.instruments),
  createInstrument: (body: InstrumentBody) => api<{ instrument: Instrument }>(`${BASE}/instruments`, { body }).then((r) => r.instrument),
  updateInstrument: (id: number, body: InstrumentBody) =>
    api<{ instrument: Instrument }>(`${BASE}/instruments/${id}`, { method: 'PATCH', body }).then((r) => r.instrument),
  deleteInstrument: (id: number, withBookings = false) =>
    api(`${BASE}/instruments/${id}`, { method: 'DELETE', query: { with_bookings: withBookings || undefined } }),
  addExamples: () => api<{ added: number }>(`${BASE}/instruments/examples`, { method: 'POST' }),

  calendar: (start: string, end: string, instrument: number | null, slots = true) =>
    api<CalendarData>(`${BASE}/calendar`, { query: { start, end, instrument: instrument ?? undefined, slots: slots ? 1 : 0 } }),
  quote: (instrument: number, start: string, end: string, forUser?: number) =>
    api<Quote>(`${BASE}/quote`, { query: { instrument, start, end, for: forUser } }),
  free: (instrument: number, start: string, end: string) =>
    api<{ instrument: string; slots: { start: string; end: string; label: string }[]; now: string }>(`${BASE}/free`, {
      query: { instrument, start, end },
    }),

  book: (instrumentId: number, start: string, end: string, purpose: string, userId?: number) =>
    api<{ bookings: Booking[]; problems: string[] }>(`${BASE}/bookings`, {
      body: { instrument_id: instrumentId, start, end, purpose, user_id: userId },
    }),
  bookings: (scope: 'upcoming' | 'past' | 'all' = 'upcoming', user?: number) =>
    api<MyBookings>(`${BASE}/bookings`, { query: { scope, user } }),
  booking: (id: number) => api<{ booking: Booking }>(`${BASE}/bookings/${id}`).then((r) => r.booking),
  change: (id: number, body: { start?: string; end?: string; purpose?: string; snap?: 'move' | 'resize' }) =>
    api<{ booking: Booking }>(`${BASE}/bookings/${id}`, { method: 'PATCH', body }).then((r) => r.booking),
  cancel: (id: number, note = '') => api<{ booking: Booking }>(`${BASE}/bookings/${id}/cancel`, { body: { note } }).then((r) => r.booking),
  decide: (id: number, approve: boolean, note = '') =>
    api<{ booking: Booking }>(`${BASE}/bookings/${id}/decide`, { body: { approve, note } }).then((r) => r.booking),
  reassign: (id: number, userId: number) =>
    api<{ booking: Booking }>(`${BASE}/bookings/${id}/reassign`, { body: { user_id: userId } }).then((r) => r.booking),

  requests: () => api<{ bookings: Booking[]; members: Member[] }>(`${BASE}/requests`),
  members: () => api<{ members: Member[] }>(`${BASE}/members`).then((r) => r.members),
  people: () => api<{ members: Person[] }>(`${BASE}/members`).then((r) => r.members),
  updateMember: (id: number, body: Partial<Pick<Member, 'role' | 'status' | 'category' | 'group_name' | 'trained'>>) =>
    api<{ member: Member }>(`${BASE}/members/${id}`, { method: 'PATCH', body }).then((r) => r.member),

  issues: (instrument?: number) => api<{ issues: Issue[] }>(`${BASE}/issues`, { query: { instrument } }).then((r) => r.issues),
  reportIssue: (body: { instrument_id: number; kind: 'problem' | 'down'; start?: string; end?: string | null; note: string }) =>
    api<{ issue: Issue }>(`${BASE}/issues`, { body }).then((r) => r.issue),
  resolveIssue: (id: number) => api(`${BASE}/issues/${id}/resolve`, { method: 'POST' }),
  deleteIssue: (id: number) => api(`${BASE}/issues/${id}`, { method: 'DELETE' }),

  /** The .ics text: your bookings, someone's (manager / super user), or one instrument's. */
  async ical(opts: { user?: number; instrument?: number } = {}): Promise<string> {
    const q = new URLSearchParams()
    if (opts.user) q.set('user', String(opts.user))
    if (opts.instrument) q.set('instrument', String(opts.instrument))
    const res = await fetch(`/api${BASE}/ical${q.size ? `?${q}` : ''}`, { credentials: 'same-origin' })
    if (!res.ok) {
      let msg = `Export failed (${res.status})`
      try {
        const d = (await res.json()) as { detail?: string }
        if (typeof d.detail === 'string') msg = d.detail
      } catch {
        // not JSON
      }
      throw new ApiError(res.status, msg)
    }
    return res.text()
  },
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
