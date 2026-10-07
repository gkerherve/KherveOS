// KherveLAB: book the instruments of one lab, together, on this KherveOS
// server. A port of the desktop KherveLAB (../KherveLAB): the same periods,
// sessions, approval modes, rates and rules, enforced by the server module
// server/kherveos_server/lab.py. Changes reach every open window live.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CalendarArrowDown, CalendarDays, ChevronLeft, ChevronRight, FlaskConical, Inbox, LayoutGrid, ListChecks, LoaderCircle, Settings2, Sparkles,
  Wrench,
} from 'lucide-react'
import type { AppProps, MenuBarMenu } from '@/os'
import { os } from '@/os'
import { useAppTools } from '@/os/ai/appTools'
import { useAuth, useRealtime } from '@/os/server'
import { ServerGate } from '@/os/ui/ServerGate'
import { Admin } from './Admin'
import { labTools } from './aiTools'
import { errorText, labApi } from './api'
import { Calendar, columnsFor, type BookingChange } from './Calendar'
import { BookDialog, BookingDialog, IssueDialog } from './Dialogs'
import { actsForOthers, bump, isAdmin, listen, loadLab, useLab } from './store'
import type { Booking, CalendarData, Instrument } from './types'
import { addDays, mondayOf, money, rangeLabel, weekTitle } from './time'
import { exportIcal, MyBookings, Requests } from './Views'
import './khervelab.css'

type View = 'schedule' | 'mine' | 'requests' | 'admin'
type AdminTab = 'instruments' | 'people' | 'settings' | 'problems'

export default function KherveLAB(props: AppProps) {
  return (
    <div className="k-app kl-root">
      <ServerGate app="KherveLAB" icon={FlaskConical}>
        <LabApp {...props} />
      </ServerGate>
    </div>
  )
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'instrument'

function LabApp({ win, args }: AppProps) {
  const user = useAuth((s) => s.user)
  const me = useLab((s) => s.me)
  const instruments = useLab((s) => s.instruments)
  const status = useLab((s) => s.status)
  const loadError = useLab((s) => s.error)
  const version = useLab((s) => s.version)
  const requests = useLab((s) => s.requests)

  const [view, setView] = useState<View>('schedule')
  const [adminTab, setAdminTab] = useState<AdminTab>('instruments')
  const [instId, setInstId] = useState<number | null>(null) // null: All instruments
  const [mode, setMode] = useState<'day' | 'week'>('week')
  const [anchor, setAnchor] = useState('')
  const [cal, setCal] = useState<CalendarData | null>(null)
  const [hint, setHint] = useState('')
  const [booking, setBooking] = useState<{ inst: Instrument; start: string; end: string } | null>(null)
  const [openB, setOpenB] = useState<Booking | null>(null)
  const [issueFor, setIssueFor] = useState<Instrument | null>(null)

  // Start (and start over when someone else signs in), and follow live events.
  useEffect(() => {
    if (!user) return
    useLab.setState({ me: null, instruments: [], status: 'loading' })
    void loadLab()
    return listen(win.id)
  }, [user?.id, win.id])

  // Catch up after the live connection was down.
  const connected = useRealtime((s) => s.connected)
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) void loadLab()
    wasConnected.current = connected
  }, [connected])

  const today = me?.now.slice(0, 10) ?? ''
  useEffect(() => {
    if (today && !anchor) setAnchor(today)
  }, [today, anchor])

  // os.open('khervelab', { instrument: 3 })
  useEffect(() => {
    const id = Number(args.instrument)
    if (Number.isInteger(id) && id > 0) {
      setInstId(id)
      setView('schedule')
    }
  }, [args])

  const inst = instId === null ? null : (instruments.find((i) => i.id === instId) ?? null)
  useEffect(() => {
    if (instId !== null && status === 'ready' && !instruments.some((i) => i.id === instId)) setInstId(null)
  }, [instId, instruments, status])

  const first = anchor ? (mode === 'week' ? mondayOf(anchor) : anchor) : ''
  const columns = useMemo(() => (first ? columnsFor(mode, first, inst, instruments) : []), [mode, first, inst, instruments])

  // The calendar's data, again whenever anything changes.
  useEffect(() => {
    if (!first || view !== 'schedule' || !me) return
    let stale = false
    const days = mode === 'week' ? 7 : 1
    labApi.calendar(`${first}T00:00`, `${addDays(first, days)}T00:00`, inst?.id ?? null, !!inst || mode === 'day').then(
      (d) => !stale && setCal(d),
      (e) => !stale && setHint(errorText(e)),
    )
    return () => {
      stale = true
    }
  }, [first, mode, inst?.id, version, view, me])

  const step = (n: number) => setAnchor((a) => addDays(a, n * (mode === 'week' ? 7 : 1)))
  const goToday = () => setAnchor(today)
  const show = (id: number, day: string) => {
    setView('schedule')
    setInstId(id)
    setAnchor(day)
  }

  useAppTools(win, labTools(show))

  async function change(b: Booking, ch: BookingChange) {
    try {
      const out = await labApi.change(b.id, ch)
      bump()
      setHint(
        `${out.instrument} now ${rangeLabel(out.start, out.end)}${out.status === 'pending' && b.status !== 'pending' ? ': it waits for the lab manager’s approval again' : ''}.`,
      )
    } catch (e) {
      bump()
      await os.dialog.alert(errorText(e), { title: 'Not changed' })
    }
  }

  // Window title and menu bar.
  const labName = me?.settings.lab_name ?? 'KherveLAB'
  useEffect(() => {
    win.setTitle(inst && view === 'schedule' ? `KherveLAB — ${inst.name}` : `KherveLAB — ${labName}`)
  }, [win, inst, view, labName])

  const admin = isAdmin(me)
  useEffect(() => {
    if (!me || typeof win.setMenus !== 'function') return
    const menus: MenuBarMenu[] = [
      {
        label: 'Lab',
        items: [
          { label: 'Schedule', icon: CalendarDays, checked: view === 'schedule', onClick: () => setView('schedule') },
          { label: 'My Bookings', icon: ListChecks, checked: view === 'mine', onClick: () => setView('mine') },
          '-',
          { label: 'Export My Bookings (iCal)…', icon: CalendarArrowDown, onClick: () => void exportIcal({}, `${safeName(me.member.username)}-bookings.ics`) },
          {
            label: inst ? `Export ${inst.name} Calendar (iCal)…` : 'Export Instrument Calendar (iCal)…',
            disabled: !inst,
            onClick: () => inst && void exportIcal({ instrument: inst.id }, `${safeName(inst.name)}.ics`),
          },
          '-',
          { label: 'Report a Problem…', icon: AlertTriangle, disabled: !inst || me.member.status !== 'active', onClick: () => inst && setIssueFor(inst) },
        ],
      },
      {
        label: 'View',
        items: [
          { label: 'Day', shortcut: '1', checked: mode === 'day', onClick: () => setMode('day') },
          { label: 'Week', shortcut: '2', checked: mode === 'week', onClick: () => setMode('week') },
          '-',
          { label: 'Previous', shortcut: '←', onClick: () => step(-1) },
          { label: 'Today', shortcut: 'T', onClick: goToday },
          { label: 'Next', shortcut: '→', onClick: () => step(1) },
          '-',
          { label: 'All Instruments', checked: instId === null, onClick: () => setInstId(null) },
        ],
      },
    ]
    if (admin) {
      const manage = (t: AdminTab) => () => {
        setAdminTab(t)
        setView('admin')
      }
      menus.push({
        label: 'Manage',
        items: [
          { label: requests ? `Requests (${requests})` : 'Requests', icon: Inbox, onClick: () => setView('requests') },
          '-',
          { label: 'Instruments', onClick: manage('instruments') },
          { label: 'People', onClick: manage('people') },
          { label: 'Lab Settings', onClick: manage('settings') },
          { label: 'Problems and Out of Order', onClick: manage('problems') },
        ],
      })
    }
    win.setMenus(menus)
  }, [win, me, inst, view, mode, instId, admin, requests, today])
  useEffect(() => () => win.setMenus(null), [win])

  if (!me) {
    return status === 'error' ? (
      <div className="k-center">
        <div className="k-gate-card">
          <h2>KherveLAB could not start</h2>
          <p className="k-error">{loadError}</p>
          <button className="k-btn primary" onClick={() => void loadLab()}>
            Try again
          </button>
        </div>
      </div>
    ) : (
      <div className="k-center">
        <LoaderCircle size={22} className="k-spin" />
      </div>
    )
  }

  const pending = me.member.status === 'pending'
  const disabled = me.member.status === 'disabled'
  const cur = me.settings.currency

  return (
    <div
      className="kl-app"
      tabIndex={-1}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement
        if (view !== 'schedule' || e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, select, .kl-modal')) return
        if (e.key === 'ArrowLeft') step(-1)
        else if (e.key === 'ArrowRight') step(1)
        else if (e.key === 't' || e.key === 'T') goToday()
        else if (e.key === '1') setMode('day')
        else if (e.key === '2') setMode('week')
        else return
        e.preventDefault()
      }}
    >
      <aside className="kl-side">
        <div className="kl-side-head">
          <FlaskConical size={16} />
          <span className="kl-ellipsis" title={labName}>
            {labName}
          </span>
        </div>
        <div className="kl-side-label">Schedule</div>
        <button className={`kl-side-item${view === 'schedule' && instId === null ? ' active' : ''}`} onClick={() => (setView('schedule'), setInstId(null))}>
          <LayoutGrid size={14} /> All instruments
        </button>
        {instruments.map((i) => (
          <button key={i.id} className={`kl-side-item${view === 'schedule' && instId === i.id ? ' active' : ''}`} onClick={() => (setView('schedule'), setInstId(i.id))}>
            <span className="kl-dot" style={{ background: i.colour }} />
            <span className="kl-ellipsis">{i.name}</span>
            {i.issue && (
              <span className={`kl-side-issue ${i.issue.kind}`} title={i.issue.kind === 'down' ? 'Out of order' : 'Problem reported'}>
                {i.issue.kind === 'down' ? <Wrench size={11} /> : <AlertTriangle size={11} />}
              </span>
            )}
          </button>
        ))}
        <div className="kl-side-sep" />
        <button className={`kl-side-item${view === 'mine' ? ' active' : ''}`} onClick={() => setView('mine')}>
          <ListChecks size={14} /> {actsForOthers(me) ? 'Bookings' : 'My bookings'}
        </button>
        {admin && (
          <>
            <button className={`kl-side-item${view === 'requests' ? ' active' : ''}`} onClick={() => setView('requests')}>
              <Inbox size={14} /> Requests {requests > 0 && <span className="kl-badge">{requests}</span>}
            </button>
            <button className={`kl-side-item${view === 'admin' ? ' active' : ''}`} onClick={() => setView('admin')}>
              <Settings2 size={14} /> Manage
            </button>
          </>
        )}
        <div className="kl-flex" />
        <div className="kl-side-foot" title={me.roles[me.member.role]}>
          {me.member.full_name}
          <span>{me.roles[me.member.role].replace(/ \(.*\)$/, '')} · {me.member.category}</span>
        </div>
      </aside>

      <main className="kl-main">
        {(pending || disabled) && (
          <div className="kl-banner">
            {pending
              ? 'Your lab account waits for the lab manager’s approval. You can look at the schedule meanwhile.'
              : 'Your lab account is disabled. Ask the lab manager.'}
          </div>
        )}
        {view === 'schedule' &&
          (instruments.length === 0 ? (
            <div className="k-center">
              <div className="k-gate-card">
                <FlaskConical size={30} color="var(--k-accent)" />
                <h2>No instruments yet</h2>
                {admin ? (
                  <>
                    <p className="k-muted">Add the lab’s instruments, or start from the examples (XPS, NAP-XPS, TGA/DSC, dilatometer, BET, glovebox).</p>
                    <div className="kl-row kl-center-row">
                      <button className="k-btn" onClick={() => (setAdminTab('instruments'), setView('admin'))}>
                        Add an instrument
                      </button>
                      <button className="k-btn primary" onClick={() => void labApi.addExamples().then(() => loadLab(), (e) => os.dialog.alert(errorText(e)))}>
                        <Sparkles size={14} /> Add the examples
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="k-muted">The lab manager has not added any instruments yet.</p>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="k-toolbar kl-toolbar">
                <button className="k-icon-btn" title="Previous (←)" onClick={() => step(-1)}>
                  <ChevronLeft size={16} />
                </button>
                <button className="k-btn small" onClick={goToday}>
                  Today
                </button>
                <button className="k-icon-btn" title="Next (→)" onClick={() => step(1)}>
                  <ChevronRight size={16} />
                </button>
                <div className="kl-title">{first && weekTitle(first, mode === 'week' ? 7 : 1)}</div>
                <div className="k-spacer" />
                {inst && (
                  <>
                    <button className="k-btn small" disabled={me.member.status !== 'active'} onClick={() => setIssueFor(inst)} title="Report a problem or out of order">
                      <AlertTriangle size={13} /> Report a problem
                    </button>
                    <button className="k-icon-btn" title={`Export ${inst.name}'s calendar (iCal)`} onClick={() => void exportIcal({ instrument: inst.id }, `${safeName(inst.name)}.ics`)}>
                      <CalendarArrowDown size={15} />
                    </button>
                  </>
                )}
                <div className="kl-seg">
                  <button className={mode === 'day' ? 'active' : ''} onClick={() => setMode('day')}>
                    Day
                  </button>
                  <button className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>
                    Week
                  </button>
                </div>
              </div>
              {inst ? (
                <div className="kl-info">
                  <span>{inst.describe}</span>
                  {inst.booking_mode === 'sessions' && inst.sessions.length > 0 && (
                    <span>{inst.sessions.map((s) => `${s.name} ${s.start_time}–${s.end_time} (${s.days_label})`).join(' · ')}</span>
                  )}
                  <span>
                    Your rate {money(cur, inst.my_rate)}/h · {inst.instant ? 'your bookings are approved at once' : 'your bookings wait for approval'} · up to{' '}
                    {inst.max_days_ahead} days ahead
                  </span>
                  {inst.issue && (
                    <span className={`kl-issue-line ${inst.issue.kind}`}>
                      {inst.issue.kind === 'down' ? <Wrench size={12} /> : <AlertTriangle size={12} />}
                      {inst.issue.kind === 'down' ? 'Out of order' : 'Problem reported'}
                      {inst.issue.end ? ` until ${inst.issue.end.replace('T', ' ')}` : ' until fixed'}
                      {inst.issue.note ? `: ${inst.issue.note}` : ''}
                    </span>
                  )}
                </div>
              ) : (
                <div className="kl-info">
                  <span>
                    {mode === 'week'
                      ? 'Every instrument’s bookings. Pick an instrument to book it, or switch to Day to see them side by side.'
                      : 'The instruments side by side: drag across a column’s slots to book.'}
                  </span>
                </div>
              )}
              <div className="kl-legend">
                <span>
                  <i className="free" /> Free
                </span>
                <span>
                  <i className="booked" /> Booked
                </span>
                <span>
                  <i className="pending" /> Pending
                </span>
                <span>
                  <i className="problem" /> Problem
                </span>
                <span>
                  <i className="down" /> Out of order
                </span>
                <span>
                  <i className="closed" /> Closed
                </span>
              </div>
              {cal && first ? (
                <Calendar
                  columns={columns}
                  data={cal}
                  showInstrument={!inst}
                  freeForm={admin}
                  now={cal.now}
                  onHint={setHint}
                  onBook={(i, start, end) => {
                    if (me.member.status !== 'active') setHint('Your lab account is not active yet, so you cannot book.')
                    else setBooking({ inst: i, start, end })
                  }}
                  onOpen={setOpenB}
                  onChange={(b, ch) => void change(b, ch)}
                />
              ) : (
                <div className="k-center">
                  <LoaderCircle size={20} className="k-spin" />
                </div>
              )}
              <div className="k-statusbar kl-status">{hint || 'To book, drag across the slots you want, or press and hold a slot. Drag your bookings to move them; drag their bottom edge to resize.'}</div>
            </>
          ))}
        {view === 'mine' && <MyBookings me={me} />}
        {view === 'requests' && admin && <Requests me={me} />}
        {view === 'admin' && admin && <Admin me={me} tab={adminTab} setTab={setAdminTab} />}
      </main>

      {booking && <BookDialog inst={booking.inst} start={booking.start} end={booking.end} me={me} onClose={() => setBooking(null)} />}
      {openB && <BookingDialog booking={openB} me={me} onClose={() => setOpenB(null)} />}
      {issueFor && <IssueDialog inst={issueFor} now={me.now} onClose={() => setIssueFor(null)} />}
    </div>
  )
}
