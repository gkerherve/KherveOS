// The timeline / calendar view: a month grid of entries (click one to open it, the + on a day starts an entry dated
// that day) and the same entries as a list by month.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { MONTHS, WEEKDAYS, dayKey, entriesByDay, latestMonth, monthGrid, timeline } from './calendar'
import type { Notebook } from './model'
import { shortDate, shortTime } from './ui'

interface Props {
  nb: Notebook
  onOpenEntry(id: string): void
  onNewEntry(date: string): void
}

export function CalendarView({ nb, onOpenEntry, onNewEntry }: Props) {
  const today = useMemo(() => new Date(), [])
  const [ym, setYm] = useState(() => latestMonth(nb.entries, today))
  const byDay = useMemo(() => entriesByDay(nb.entries), [nb.entries])
  const grid = useMemo(() => monthGrid(ym.year, ym.month), [ym])
  const months = useMemo(() => timeline(nb.entries), [nb.entries])
  const step = (d: number) => setYm((s) => { const n = new Date(s.year, s.month + d, 1); return { year: n.getFullYear(), month: n.getMonth() } })
  const todayKey = dayKey(today)
  return (
    <div className="ln-cal">
      <div className="ln-cal-main">
        <div className="ln-toolbar tight">
          <button className="k-icon-btn" aria-label="Previous month" onClick={() => step(-1)}><ChevronLeft size={16} /></button>
          <h3 className="ln-cal-title" aria-live="polite">{MONTHS[ym.month]} {ym.year}</h3>
          <button className="k-icon-btn" aria-label="Next month" onClick={() => step(1)}><ChevronRight size={16} /></button>
          <button className="k-btn small" onClick={() => setYm({ year: today.getFullYear(), month: today.getMonth() })}>Today</button>
        </div>
        <div className="ln-cal-grid" role="grid" aria-label={`${MONTHS[ym.month]} ${ym.year}`}>
          {WEEKDAYS.map((d) => <div key={d} className="ln-cal-wd" role="columnheader">{d}</div>)}
          {grid.flat().map((d) => {
            const k = dayKey(d)
            const list = byDay.get(k) ?? []
            const other = d.getMonth() !== ym.month
            return (
              <div key={k} role="gridcell" className={`ln-cal-day${other ? ' other' : ''}${k === todayKey ? ' today' : ''}`}>
                <div className="ln-cal-num">
                  <span>{d.getDate()}</span>
                  <button className="k-icon-btn ln-mini" aria-label={`New entry on ${k}`} title="New entry on this day" onClick={() => onNewEntry(k)}><Plus size={11} /></button>
                </div>
                {list.slice(0, 3).map((e) => (
                  <button key={e.id} className={`ln-cal-entry ${e.status}`} onClick={() => onOpenEntry(e.id)} title={`${e.experiment} · ${e.title}`}>{shortTime(e.date)} {e.title}</button>
                ))}
                {list.length > 3 && <span className="ln-cal-more">+{list.length - 3} more</span>}
              </div>
            )
          })}
        </div>
      </div>
      <div className="ln-cal-list">
        <h4>Timeline</h4>
        {months.length === 0 && <div className="ln-empty">No entries yet.</div>}
        {months.map((m) => (
          <section key={m.month}>
            <h5>{MONTHS[Number(m.month.slice(5)) - 1]} {m.month.slice(0, 4)}</h5>
            {m.entries.map((e) => (
              <button key={e.id} className="ln-tl-row" onClick={() => onOpenEntry(e.id)}>
                <span className="ln-tl-date">{shortDate(e.date).slice(8)}</span>
                <span className="ln-tl-title">{e.title}</span>
                <span className={`ln-dot ${e.status}`} title={e.status} />
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
