// The month calendar that opens from the clock in the menu bar.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** The weeks of a month as rows of seven dates (Monday first); days outside the month are included. */
export function monthGrid(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(year, month, 1 - offset)
  const weeks: Date[][] = []
  for (let w = 0; w < 6; w++) {
    weeks.push(Array.from({ length: 7 }, (_, d) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)))
  }
  return weeks
}

export function CalendarPopover({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const today = new Date()
  const [shown, setShown] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest('.k-topbar-clock')) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const weeks = monthGrid(shown.getFullYear(), shown.getMonth())
  const weekdays = weeks[0].map((d) => d.toLocaleDateString(undefined, { weekday: 'short' }))
  const title = shown.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const move = (delta: number) => setShown(new Date(shown.getFullYear(), shown.getMonth() + delta, 1))

  return (
    <div ref={ref} className="k-cal" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 240)), top: y }} role="dialog" aria-label="Calendar">
      <div className="k-cal-head">
        <button className="k-cal-nav" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={14} /></button>
        <button className="k-cal-title" onClick={() => setShown(new Date(today.getFullYear(), today.getMonth(), 1))} title="Back to today">{title}</button>
        <button className="k-cal-nav" onClick={() => move(1)} aria-label="Next month"><ChevronRight size={14} /></button>
      </div>
      <div className="k-cal-grid">
        {weekdays.map((w, i) => <div key={i} className="k-cal-wd">{w}</div>)}
        {weeks.flat().map((d) => (
          <div
            key={d.toISOString()}
            className={`k-cal-day${d.getMonth() !== shown.getMonth() ? ' other' : ''}${sameDay(d, today) ? ' today' : ''}`}
          >
            {d.getDate()}
          </div>
        ))}
      </div>
      <div className="k-cal-foot">{today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </div>
  )
}
