// AI tools of Calendar (the manifest is src/os/ai/manifests/kcalendar.ts).

import type { useAppTools } from '@/os/ai/appTools'
import { isTime, newId, parseDayKey, sortEvents, type CalEvent } from './events'

type Tools = Parameters<typeof useAppTools>[1]

interface Hooks {
  events(): CalEvent[]
  add(e: CalEvent): Promise<void>
  remove(id: string): Promise<void>
  show(key: string): void
}

export function kcalendarTools(h: Hooks): Tools {
  return {
    events: async (a) => {
      const from = String(a.from ?? '')
      const to = String(a.to ?? '')
      if (from && !parseDayKey(from)) throw new Error('from must be a day, YYYY-MM-DD.')
      if (to && !parseDayKey(to)) throw new Error('to must be a day, YYYY-MM-DD.')
      const list = sortEvents(h.events()).filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
      return { count: list.length, events: list.slice(0, 200) }
    },
    add: async (a) => {
      const date = String(a.date ?? '')
      const title = String(a.title ?? '').trim()
      const time = String(a.time ?? '')
      if (!parseDayKey(date)) throw new Error('date must be a day, YYYY-MM-DD.')
      if (!title) throw new Error('Give the event a title.')
      if (!isTime(time)) throw new Error('time must be HH:MM, or empty for all day.')
      const e: CalEvent = { id: newId(), date, time, title, note: String(a.note ?? '') }
      await h.add(e)
      h.show(date)
      return { id: e.id, shown: true }
    },
    delete: async (a, ctx) => {
      const id = String(a.id ?? '')
      const e = h.events().find((x) => x.id === id)
      if (!e) throw new Error(`There is no event with id ${id}.`)
      if (!(await ctx.confirm('delete a Calendar event', `${e.date} ${e.time} ${e.title}`.trim()))) return { deleted: false }
      await h.remove(id)
      return { deleted: true }
    },
  }
}
