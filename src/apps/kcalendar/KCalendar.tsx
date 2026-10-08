// Calendar — a month calendar with events: click a day to see and add what is on it.
// Events are kept in Documents/Calendar/events.json, so they travel with your files.

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { os, fs, HOME, type AppProps } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { dayKey, eventsOn, monthGrid, newId, parseEvents, serializeEvents, isTime, type CalEvent } from './events'
import { kcalendarTools } from './aiTools'
import './kcalendar.css'

export const CAL_DIR = `${HOME}/Documents/Calendar`
export const CAL_FILE = `${CAL_DIR}/events.json`

interface Draft {
  id: string | null
  date: string
  time: string
  title: string
  note: string
}

const blankDraft = (date: string): Draft => ({ id: null, date, time: '', title: '', note: '' })

export default function KCalendar({ win }: AppProps) {
  const today = new Date()
  const [shown, setShown] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState(dayKey(today))
  const [events, setEvents] = useState<CalEvent[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const title = shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  useEffect(() => { win.setTitle(`Calendar — ${title}`) }, [win, title])

  // Load once; a missing file is an empty calendar.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (fs.exists(CAL_FILE)) {
          const list = parseEvents(await fs.readText(CAL_FILE))
          if (alive) setEvents(list)
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { alive = false }
  }, [])

  const weeks = useMemo(() => monthGrid(shown.getFullYear(), shown.getMonth()), [shown])
  const weekdays = weeks[0].map((d) => d.toLocaleDateString(undefined, { weekday: 'short' }))
  const dayEvents = useMemo(() => eventsOn(events, selected), [events, selected])
  const todayKey = dayKey(today)

  const persist = async (next: CalEvent[]) => {
    setEvents(next)
    try {
      await fs.mkdir(CAL_DIR, { recursive: true })
      await fs.writeText(CAL_FILE, serializeEvents(next))
      setError(null)
    } catch (e) {
      setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const select = (key: string) => {
    setSelected(key)
    setDraft(null)
  }

  const saveDraft = async () => {
    if (!draft) return
    if (!draft.title.trim()) return setError('Give the event a title.')
    if (!isTime(draft.time)) return setError('The time must be HH:MM, or empty for all day.')
    const e: CalEvent = { id: draft.id ?? newId(), date: draft.date, time: draft.time, title: draft.title.trim(), note: draft.note }
    await persist(draft.id ? events.map((x) => (x.id === draft.id ? e : x)) : [...events, e])
    setSelected(draft.date)
    setDraft(null)
  }

  const remove = async (id: string) => {
    const e = events.find((x) => x.id === id)
    if (!e) return
    if (!(await os.dialog.confirm(`Delete “${e.title}” on ${e.date}?`, { title: 'Delete event', okLabel: 'Delete', danger: true }))) return
    await persist(events.filter((x) => x.id !== id))
    setDraft(null)
  }

  const move = (delta: number) => setShown(new Date(shown.getFullYear(), shown.getMonth() + delta, 1))

  useAppTools(win, kcalendarTools({
    events: () => events,
    add: async (e) => {
      await persist([...events, e])
      setSelected(e.date)
      setShown(new Date(Number(e.date.slice(0, 4)), Number(e.date.slice(5, 7)) - 1, 1))
    },
    remove: async (id) => {
      await persist(events.filter((x) => x.id !== id))
    },
    show: (key: string) => {
      setSelected(key)
      setShown(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1))
    },
  }))

  return (
    <div className="k-app kcal-app">
      <div className="k-toolbar kcal-toolbar">
        <button className="k-btn" onClick={() => { setShown(new Date(today.getFullYear(), today.getMonth(), 1)); select(todayKey) }}>Today</button>
        <button className="k-icon-btn" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={15} /></button>
        <button className="k-icon-btn" onClick={() => move(1)} aria-label="Next month"><ChevronRight size={15} /></button>
        <div className="kcal-title"><CalendarDays size={15} /> {title}</div>
        <button className="k-btn kcal-new" onClick={() => setDraft(blankDraft(selected))}><Plus size={13} /> New event</button>
      </div>

      <div className="kcal-body">
        <section className="kcal-grid-wrap">
          <div className="kcal-grid">
            {weekdays.map((w, i) => <div key={i} className="kcal-wd">{w}</div>)}
            {weeks.flat().map((d) => {
              const key = dayKey(d)
              const list = eventsOn(events, key)
              const classes = ['kcal-day']
              if (d.getMonth() !== shown.getMonth()) classes.push('other')
              if (key === todayKey) classes.push('today')
              if (key === selected) classes.push('sel')
              return (
                <button key={key} className={classes.join(' ')} onClick={() => select(key)} aria-label={`${d.toLocaleDateString(undefined, { dateStyle: 'full' })}, ${list.length} events`}>
                  <span className="kcal-num">{d.getDate()}</span>
                  {list.slice(0, 3).map((e) => (
                    <span key={e.id} className="kcal-chip">{e.time && <b>{e.time}</b>} {e.title}</span>
                  ))}
                  {list.length > 3 && <span className="kcal-more">+{list.length - 3} more</span>}
                </button>
              )
            })}
          </div>
        </section>

        <aside className="kcal-side">
          <div className="kcal-day-title">
            {parseDayKeyLabel(selected)}
          </div>
          {error && <div className="kcal-error">{error}</div>}

          {draft ? (
            <form className="kcal-form" onSubmit={(e) => { e.preventDefault(); void saveDraft() }}>
              <label>Title
                <input className="k-input" autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <div className="kcal-two">
                <label>Day
                  <input className="k-input" type="date" value={draft.date} onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} />
                </label>
                <label>Time
                  <input className="k-input" type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
                </label>
              </div>
              <label>Note
                <textarea className="k-input" rows={3} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </label>
              <div className="kcal-actions">
                <button type="submit" className="k-btn">{draft.id ? 'Save' : 'Add'}</button>
                <button type="button" className="k-btn" onClick={() => setDraft(null)}>Cancel</button>
                {draft.id && <button type="button" className="k-btn kcal-del" onClick={() => void remove(draft.id!)}><Trash2 size={12} /> Delete</button>}
              </div>
            </form>
          ) : (
            <>
              {dayEvents.length === 0 && <div className="k-muted kcal-empty">Nothing planned. Use New event to add one.</div>}
              <ul className="kcal-list">
                {dayEvents.map((e) => (
                  <li key={e.id}>
                    <button className="kcal-item" onClick={() => setDraft({ id: e.id, date: e.date, time: e.time, title: e.title, note: e.note })}>
                      <span className="kcal-time">{e.time || 'all day'}</span>
                      <span className="kcal-ttl">{e.title}</span>
                      {e.note && <span className="kcal-note">{e.note}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function parseDayKeyLabel(key: string): string {
  const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
