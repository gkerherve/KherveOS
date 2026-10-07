// The week / day calendar: bookable slots as raised cards on a calm closed
// background, bookings on top. As on the desktop, a plain click never books:
// drag across the slots you want, or press and hold one until it lights up.
// Bookings you may change move by drag and resize by their bottom edge; a
// click (or a small slip of the mouse) opens them.
//
// The slots come from the server's own rules (/calendar), and every drop is
// snapped and checked there: the calendar only proposes.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AlertTriangle, Clock, Wrench } from 'lucide-react'
import type { Booking, CalendarData, Instrument, Slot } from './types'
import { addDays, dayLabel, diffMinutes, hhmm, minutesFrom, parseDay, stampAt, addMinutes } from './time'

export const PPM = 0.75 // pixels per minute: 45 px an hour
const DAY_H = 1440 * PPM
const HOLD_MS = 600
const DRAG_PX = 6
const SNAP = 15

export interface Column {
  key: string
  day: string
  inst: Instrument | null
}

export interface BookingChange {
  start: string
  end: string
  snap: 'move' | 'resize'
}

interface Props {
  columns: Column[]
  data: CalendarData | null
  /** The All instruments view: name the instrument on each booking. */
  showInstrument: boolean
  /** The lab manager may also drag across closed time (e.g. maintenance). */
  freeForm: boolean
  now: string
  onBook(inst: Instrument, start: string, end: string): void
  onOpen(b: Booking): void
  onChange(b: Booking, change: BookingChange): void
  onHint(text: string): void
}

interface Selection {
  instId: number
  start: string
  end: string
}

type Pointer =
  | { kind: 'select'; inst: Instrument; slots: Slot[]; first: number; last: number; x: number; y: number; armed: boolean; timer: number }
  | { kind: 'free'; inst: Instrument; anchor: string; x: number; y: number; armed: boolean }
  | { kind: 'booking'; b: Booking; mode: 'move' | 'resize'; col0: number; min0: number; x: number; y: number; started: boolean }

interface Seg {
  top: number
  bottom: number
  clipTop: boolean
  clipBottom: boolean
}

function clip(day: string, start: string, end: string): Seg | null {
  const a = minutesFrom(day, start)
  const b = minutesFrom(day, end)
  if (b <= 0 || a >= 1440) return null
  return { top: Math.max(0, a), bottom: Math.min(1440, b), clipTop: a < 0, clipBottom: b > 1440 }
}

/** Side-by-side lanes for overlapping cards (only the All instruments view has them). */
function lanes<T extends { seg: Seg }>(items: T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((p, q) => p.seg.top - q.seg.top || q.seg.bottom - p.seg.bottom)
  const out: (T & { lane: number; lanes: number })[] = []
  let cluster: (T & { lane: number; lanes: number })[] = []
  let ends: number[] = []
  let clusterEnd = -1
  const close = () => {
    for (const c of cluster) c.lanes = ends.length
    cluster = []
    ends = []
  }
  for (const it of sorted) {
    if (it.seg.top >= clusterEnd) close()
    let lane = ends.findIndex((e) => e <= it.seg.top)
    if (lane < 0) {
      lane = ends.length
      ends.push(it.seg.bottom)
    } else ends[lane] = it.seg.bottom
    const placed = { ...it, lane, lanes: 1 }
    cluster.push(placed)
    out.push(placed)
    clusterEnd = Math.max(clusterEnd, it.seg.bottom)
  }
  close()
  return out
}

export function Calendar({ columns, data, showInstrument, freeForm, now, onBook, onOpen, onChange, onHint }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const ptr = useRef<Pointer | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [ghost, setGhost] = useState<{ b: Booking; start: string; end: string } | null>(null)

  // Open on the working day.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && el.scrollTop === 0) el.scrollTop = 7 * 60 * PPM
  }, [])

  const slotsByInst = useMemo(() => {
    const m = new Map<number, Slot[]>()
    for (const s of data?.slots ?? []) {
      let list = m.get(s.instrument_id)
      if (!list) m.set(s.instrument_id, (list = []))
      list.push(s)
    }
    for (const list of m.values()) list.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
    return m
  }, [data])

  // Stop a held press when the data under it changes.
  useEffect(() => {
    const p = ptr.current
    if (p?.kind === 'select') window.clearTimeout(p.timer)
    ptr.current = null
    setSelection(null)
    setGhost(null)
  }, [data, columns])

  const sameDay = columns.every((c) => c.day === columns[0]?.day)

  /** The column and minute of day under the pointer. */
  function locate(x: number, y: number): { col: number; minute: number } {
    const r = gridRef.current!.getBoundingClientRect()
    const w = r.width / Math.max(1, columns.length)
    const col = Math.min(columns.length - 1, Math.max(0, Math.floor((x - r.left) / w)))
    const minute = Math.min(1440, Math.max(0, (y - r.top) / PPM))
    return { col, minute }
  }

  function stampAtPointer(x: number, y: number, round = false): { col: number; stamp: string } {
    const { col, minute } = locate(x, y)
    const m = round ? Math.round(minute / SNAP) * SNAP : Math.floor(minute)
    return { col, stamp: stampAt(columns[col].day, m) }
  }

  function slotIndexAt(list: Slot[], stamp: string): number {
    return list.findIndex((s) => s.start <= stamp && stamp < s.end)
  }

  function selectionOf(p: Extract<Pointer, { kind: 'select' }>): Selection {
    const a = p.slots[Math.min(p.first, p.last)]
    const b = p.slots[Math.max(p.first, p.last)]
    return { instId: p.inst.id, start: a.start, end: b.end }
  }

  // ------------------------------------------------------------ pointer handling

  function onColumnDown(e: ReactPointerEvent<HTMLDivElement>, col: Column) {
    if (e.button !== 0) return
    if (!col.inst) {
      onHint('Choose an instrument on the left to book it (or use the Day view, which shows them side by side).')
      return
    }
    const { stamp } = stampAtPointer(e.clientX, e.clientY)
    const list = slotsByInst.get(col.inst.id) ?? []
    const i = slotIndexAt(list, stamp)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (i >= 0) {
      const p: Pointer = { kind: 'select', inst: col.inst, slots: list, first: i, last: i, x: e.clientX, y: e.clientY, armed: false, timer: 0 }
      p.timer = window.setTimeout(() => {
        if (ptr.current === p) {
          p.armed = true
          setSelection(selectionOf(p))
        }
      }, HOLD_MS)
      ptr.current = p
    } else if (freeForm) {
      ptr.current = { kind: 'free', inst: col.inst, anchor: stampAtPointer(e.clientX, e.clientY, true).stamp, x: e.clientX, y: e.clientY, armed: false }
    } else {
      onHint(`${col.inst.name} cannot be booked then: ${col.inst.describe}.`)
    }
  }

  function onBookingDown(e: ReactPointerEvent<HTMLDivElement>, b: Booking, mode: 'move' | 'resize') {
    if (e.button !== 0) return
    e.stopPropagation()
    const { col, minute } = locate(e.clientX, e.clientY)
    e.currentTarget.setPointerCapture(e.pointerId)
    ptr.current = { kind: 'booking', b, mode, col0: col, min0: minute, x: e.clientX, y: e.clientY, started: false }
  }

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    const p = ptr.current
    if (!p) return
    const moved = Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) >= DRAG_PX
    if (p.kind === 'select') {
      if (!p.armed && !moved) return
      p.armed = true
      window.clearTimeout(p.timer)
      const { stamp } = stampAtPointer(e.clientX, e.clientY)
      const j = slotIndexAt(p.slots, stamp)
      if (j >= 0) p.last = j
      setSelection(selectionOf(p))
    } else if (p.kind === 'free') {
      if (!p.armed && !moved) return
      p.armed = true
      const { stamp } = stampAtPointer(e.clientX, e.clientY, true)
      const [s, en] = stamp < p.anchor ? [stamp, p.anchor] : [p.anchor, stamp]
      setSelection({ instId: p.inst.id, start: s, end: en === s ? addMinutes(s, SNAP) : en })
    } else {
      if (!p.started && !moved) return
      if (!p.b.editable) return
      p.started = true
      const { col, minute } = locate(e.clientX, e.clientY)
      const dMin = Math.round((minute - p.min0) / SNAP) * SNAP
      const dDays = sameDay ? 0 : Math.round((parseDay(columns[col].day).getTime() - parseDay(columns[p.col0].day).getTime()) / 86_400_000)
      if (p.mode === 'move') {
        const shift = dDays * 1440 + dMin
        setGhost({ b: p.b, start: addMinutes(p.b.start, shift), end: addMinutes(p.b.end, shift) })
      } else {
        let end = addMinutes(p.b.end, dDays * 1440 + dMin)
        if (diffMinutes(p.b.start, end) < SNAP) end = addMinutes(p.b.start, SNAP)
        setGhost({ b: p.b, start: p.b.start, end })
      }
    }
  }

  function onUp() {
    const p = ptr.current
    ptr.current = null
    if (!p) return
    if (p.kind === 'select') {
      window.clearTimeout(p.timer)
      if (!p.armed) {
        onHint('To book, drag across the slots you want, or press and hold a slot until it lights up.')
        return
      }
      const sel = selectionOf(p)
      setSelection(null)
      onBook(p.inst, sel.start, sel.end)
    } else if (p.kind === 'free') {
      const sel = selection
      setSelection(null)
      if (p.armed && sel) onBook(p.inst, sel.start, sel.end)
      else onHint('Drag across the time to block.')
    } else {
      const g = ghost
      setGhost(null)
      if (!p.started) onOpen(p.b)
      else if (g && (g.start !== p.b.start || g.end !== p.b.end)) onChange(p.b, { start: g.start, end: g.end, snap: p.mode })
    }
  }

  function onCancel() {
    const p = ptr.current
    if (p?.kind === 'select') window.clearTimeout(p.timer)
    ptr.current = null
    setSelection(null)
    setGhost(null)
  }

  // ------------------------------------------------------------ drawing

  const nowDay = now.slice(0, 10)
  const nowMin = minutesFrom(nowDay, now)

  return (
    <div className="kl-cal">
      <div className="kl-cal-scroll" ref={scrollRef}>
        <div className="kl-cal-head">
          <div className="kl-gutter" />
          {columns.map((c) => (
            <div key={c.key} className={`kl-cal-colhead${c.day === nowDay && !sameDay ? ' today' : ''}`}>
              {sameDay && c.inst ? (
                <>
                  <span className="kl-dot" style={{ background: c.inst.colour }} />
                  <span className="kl-ellipsis">{c.inst.name}</span>
                </>
              ) : (
                <span>{dayLabel(c.day)}</span>
              )}
            </div>
          ))}
        </div>
        <div className="kl-cal-body" style={{ height: DAY_H }}>
          <div className="kl-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="kl-hour-label" style={{ top: h * 60 * PPM }}>
                {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
              </div>
            ))}
          </div>
          <div className="kl-cal-grid" ref={gridRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
            {columns.map((c, ci) => {
              const instSlots = c.inst ? (slotsByInst.get(c.inst.id) ?? []) : []
              const bookings = (data?.bookings ?? []).filter((b) => !c.inst || b.instrument_id === c.inst.id)
              const placed = lanes(
                bookings.flatMap((b) => {
                  const seg = clip(c.day, b.start, b.end)
                  return seg ? [{ b, seg }] : []
                }),
              )
              return (
                <div
                  key={c.key}
                  className={`kl-col${c.inst ? '' : ' plain'}${c.day === nowDay ? ' today' : ''}`}
                  style={{ left: `${(ci / columns.length) * 100}%`, width: `${100 / columns.length}%` }}
                  onPointerDown={(e) => onColumnDown(e, c)}
                >
                  {!c.inst && Array.from({ length: 23 }, (_, h) => <div key={h} className="kl-hour-line" style={{ top: (h + 1) * 60 * PPM }} />)}
                  {instSlots.map((s) => {
                    const seg = clip(c.day, s.start, s.end)
                    if (!seg) return null
                    const h = (seg.bottom - seg.top) * PPM
                    return (
                      <div
                        key={s.start}
                        className={`kl-slot ${s.state}${seg.clipTop ? ' clip-top' : ''}${seg.clipBottom ? ' clip-bottom' : ''}`}
                        style={{ top: seg.top * PPM, height: h }}
                        title={`${s.label} ${hhmm(s.start)}–${hhmm(s.end)}${s.state === 'down' ? ' · out of order' : s.state === 'problem' ? ' · problem reported' : ''}`}
                      >
                        {h >= 26 && (
                          <span className="kl-slot-label">
                            {s.state === 'down' ? <Wrench size={10} /> : s.state === 'problem' ? <AlertTriangle size={10} /> : null}
                            {s.label !== 'Daytime' || h >= 40 ? s.label : ''} {h >= 40 ? `${hhmm(s.start)}–${hhmm(s.end)}` : ''}
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {selection && c.inst && selection.instId === c.inst.id && (() => {
                    const seg = clip(c.day, selection.start, selection.end)
                    return seg ? (
                      <div className="kl-selection" style={{ top: seg.top * PPM, height: (seg.bottom - seg.top) * PPM }}>
                        {!seg.clipTop && <span>{hhmm(selection.start)}–{hhmm(selection.end)}</span>}
                      </div>
                    ) : null
                  })()}
                  {placed.map(({ b, seg, lane, lanes: n }) => {
                    const h = (seg.bottom - seg.top) * PPM
                    const dragging = ghost?.b.id === b.id
                    return (
                      <div
                        key={b.id}
                        className={`kl-booking ${b.status}${b.mine ? ' mine' : ''}${b.issue ? ` issue-${b.issue}` : ''}${b.editable ? ' editable' : ''}${dragging ? ' dragging' : ''}`}
                        style={{
                          top: seg.top * PPM,
                          height: Math.max(h, 10),
                          left: `calc(${(lane / n) * 100}% + 2px)`,
                          width: `calc(${100 / n}% - 4px)`,
                          ['--kl-inst' as string]: b.colour,
                        }}
                        title={`${b.who} · ${b.instrument}\n${hhmm(b.start)}–${hhmm(b.end)}${b.status === 'pending' ? ' · waiting for approval' : ''}${b.purpose ? `\n${b.purpose}` : ''}`}
                        onPointerDown={(e) => onBookingDown(e, b, 'move')}
                      >
                        <div className="kl-booking-who kl-ellipsis">{b.mine ? 'You' : b.who}</div>
                        {h >= 30 && showInstrument && <div className="kl-booking-line kl-ellipsis">{b.instrument}</div>}
                        {h >= 44 && (
                          <div className="kl-booking-line kl-ellipsis">
                            {b.status === 'pending' && <Clock size={10} />} {hhmm(b.start)}–{hhmm(b.end)}
                          </div>
                        )}
                        {b.editable && !seg.clipBottom && <div className="kl-resize" onPointerDown={(e) => onBookingDown(e, b, 'resize')} />}
                      </div>
                    )
                  })}
                  {ghost && (!c.inst || ghost.b.instrument_id === c.inst.id) && (() => {
                    const seg = clip(c.day, ghost.start, ghost.end)
                    return seg ? (
                      <div className="kl-ghost" style={{ top: seg.top * PPM, height: Math.max((seg.bottom - seg.top) * PPM, 10), ['--kl-inst' as string]: ghost.b.colour }}>
                        {!seg.clipTop && <span>{hhmm(ghost.start)}–{hhmm(ghost.end)}</span>}
                      </div>
                    ) : null
                  })()}
                  {c.day === nowDay && <div className="kl-now" style={{ top: nowMin * PPM }} />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/** The columns for a view: days of one instrument, days of all, or instruments side by side. */
export function columnsFor(mode: 'day' | 'week', anchor: string, inst: Instrument | null, instruments: Instrument[]): Column[] {
  if (mode === 'week') {
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDays(anchor, i)
      return { key: `${day}-${inst?.id ?? 'all'}`, day, inst }
    })
  }
  if (inst) return [{ key: `${anchor}-${inst.id}`, day: anchor, inst }]
  return instruments.map((i) => ({ key: `${anchor}-${i.id}`, day: anchor, inst: i }))
}
