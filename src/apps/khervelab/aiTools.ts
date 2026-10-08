// KherveLAB's AI tools (specs in src/os/ai/appManifest.ts): list instruments,
// show free slots, book a slot (the user confirms first) and cancel one of
// my bookings (confirmed too). Every rule is checked by the server.

import type { AppTools } from '@/os/ai/appTools'
import { labApi } from './api'
import { bump, loadLab, useLab } from './store'
import type { Instrument } from './types'
import { addDays, diffMinutes, fmtDuration, money, normaliseStamp, rangeLabel } from './time'

async function ready() {
  if (!useLab.getState().me) await loadLab()
  const { me, instruments, error } = useLab.getState()
  if (!me) throw new Error(error ?? 'kLab needs the KherveOS server and a signed-in user.')
  return { me, instruments }
}

function findInstrument(instruments: Instrument[], wanted: unknown): Instrument {
  const w = String(wanted ?? '').trim()
  if (!w) throw new Error(`Say which instrument: ${instruments.map((i) => i.name).join(', ') || 'there are none yet'}.`)
  const byId = /^\d+$/.test(w) ? instruments.find((i) => i.id === Number(w)) : undefined
  const lower = w.toLowerCase()
  const found =
    byId ??
    instruments.find((i) => i.name.toLowerCase() === lower) ??
    instruments.find((i) => i.name.toLowerCase().includes(lower)) ??
    instruments.find((i) => i.description.toLowerCase().includes(lower))
  if (!found) throw new Error(`There is no instrument "${w}". The instruments are: ${instruments.map((i) => i.name).join(', ') || 'none yet'}.`)
  return found
}

function stamp(value: unknown, what: string): string {
  const s = normaliseStamp(String(value ?? ''))
  if (!s) throw new Error(`The ${what} must be a date and time like "2026-10-07 09:00" (lab time).`)
  return s
}

/** `show` brings the instrument and day into view, so the user sees what the AI looks at. */
export function labTools(show: (instrumentId: number, day: string) => void): AppTools {
  return {
    list_instruments: async () => {
      const { me, instruments } = await ready()
      return {
        lab: me.settings.lab_name,
        now: me.now,
        instruments: instruments.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          booking: i.describe,
          approval: i.instant ? 'approved at once for you' : 'waits for the lab manager',
          your_rate: `${money(me.settings.currency, i.my_rate)}/h`,
          max_days_ahead: i.max_days_ahead,
          status: i.issue ? (i.issue.kind === 'down' ? `out of order${i.issue.note ? `: ${i.issue.note}` : ''}` : `problem reported${i.issue.note ? `: ${i.issue.note}` : ''}`) : 'ok',
        })),
      }
    },

    free_slots: async (args) => {
      const { me, instruments } = await ready()
      const inst = findInstrument(instruments, args.instrument)
      const day = args.date ? String(args.date).slice(0, 10) : me.now.slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('The date must look like "2026-10-07".')
      const days = Math.min(14, Math.max(1, Number(args.days ?? 1) || 1))
      const r = await labApi.free(inst.id, `${day}T00:00`, `${addDays(day, days)}T00:00`)
      show(inst.id, day)
      const slots = r.slots.slice(0, 80).map((s) => ({ start: s.start.replace('T', ' '), end: s.end.replace('T', ' '), period: s.label }))
      return {
        instrument: inst.name,
        from: day,
        days,
        free_slots: slots,
        more: r.slots.length > slots.length ? r.slots.length - slots.length : undefined,
        note: 'Times are lab wall-clock. Several adjacent slots can be booked as one booking (start of the first, end of the last).',
      }
    },

    book: async (args, ctx) => {
      const { me, instruments } = await ready()
      const inst = findInstrument(instruments, args.instrument)
      const start = stamp(args.start, 'start')
      const end = stamp(args.end, 'end')
      const purpose = String(args.purpose ?? '').slice(0, 500)
      const q = await labApi.quote(inst.id, start, end)
      if (!q.bookable) {
        const why = q.items.flatMap((i) => i.errors)
        throw new Error(`Cannot book ${inst.name} then: ${why.join('; ')}.`)
      }
      const ok = q.items.filter((i) => !i.errors.length)
      const what = ok.map((i) => `${i.label ? `${i.label}, ` : ''}${rangeLabel(i.start, i.end)}`).join(' + ')
      show(inst.id, ok[0].start.slice(0, 10))
      const yes = await ctx.confirm(
        `book ${inst.name}: ${what}`,
        `${fmtDuration(ok.reduce((n, i) => n + diffMinutes(i.start, i.end), 0))}, ${money(q.currency, q.total)} at your rate; ${q.instant ? 'approved at once' : 'waits for the lab manager’s approval'}.${purpose ? ` Purpose: ${purpose}` : ''}`,
      )
      if (!yes) throw new Error('The user did not want this booking.')
      const r = await labApi.book(inst.id, start, end, purpose)
      bump()
      return {
        booked: r.bookings.map((b) => ({ id: b.id, start: b.start.replace('T', ' '), end: b.end.replace('T', ' '), status: b.status, cost: b.cost })),
        not_booked: r.problems.length ? r.problems : undefined,
        currency: me.settings.currency,
      }
    },

    my_bookings: async () => {
      const { me } = await ready()
      const r = await labApi.bookings('upcoming')
      return {
        bookings: r.bookings.map((b) => ({
          id: b.id,
          instrument: b.instrument,
          start: b.start.replace('T', ' '),
          end: b.end.replace('T', ' '),
          status: b.status,
          purpose: b.purpose || undefined,
          cost: b.cost,
          can_cancel: b.cancellable,
        })),
        this_month: `${money(me.settings.currency, r.month_total)} (approved)`,
      }
    },

    cancel_booking: async (args, ctx) => {
      await ready()
      const id = Number(args.booking_id)
      if (!Number.isInteger(id) || id <= 0) throw new Error('Give the booking id (khervelab_my_bookings lists them).')
      const b = await labApi.booking(id)
      if (!b.mine) throw new Error('That is not your booking: only your own bookings can be cancelled here.')
      if (!b.cancellable) throw new Error(`That booking cannot be cancelled (${b.status === 'cancelled' || b.status === 'rejected' ? `it is ${b.status}` : 'it has started; ask the lab manager'}).`)
      show(b.instrument_id, b.start.slice(0, 10))
      const yes = await ctx.confirm(`cancel your booking of ${b.instrument}, ${rangeLabel(b.start, b.end)}`)
      if (!yes) throw new Error('The user kept the booking.')
      const out = await labApi.cancel(id, String(args.reason ?? ''))
      bump()
      return { cancelled: out.id, instrument: out.instrument, start: out.start.replace('T', ' '), end: out.end.replace('T', ' ') }
    },
  }
}
