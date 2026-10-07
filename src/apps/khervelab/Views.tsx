// My bookings (anyone's, for the manager and super users) and the manager's
// Requests, plus the iCal export they share with the menus.

import { useEffect, useState } from 'react'
import { CalendarArrowDown, Check, LoaderCircle, Trash2, X } from 'lucide-react'
import { os } from '@/os'
import { errorText, labApi, type MyBookings as MyBookingsData } from './api'
import { BookingDialog, StatusPill } from './Dialogs'
import { actsForOthers, bump, useLab } from './store'
import type { Booking, Me, Member, Person } from './types'
import { diffMinutes, fmtDuration, money, rangeLabel } from './time'

/** Save an .ics of your bookings (or someone's, or an instrument's) to the drive. */
export async function exportIcal(opts: { user?: number; instrument?: number }, defaultName: string): Promise<string | null> {
  try {
    const text = await labApi.ical(opts)
    const path = await os.dialog.saveFile({ title: 'Export calendar (iCal)', defaultName, extensions: ['.ics'] })
    if (!path) return null
    await os.fs.writeText(path, text)
    const events = (text.match(/BEGIN:VEVENT/g) ?? []).length
    os.notify({ title: 'Calendar exported', body: `${events} booking${events === 1 ? '' : 's'} → ${path}`, icon: CalendarArrowDown })
    return path
  } catch (e) {
    await os.dialog.alert(errorText(e), { title: 'Export failed' })
    return null
  }
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'calendar'

export function MyBookings({ me }: { me: Me }) {
  const version = useLab((s) => s.version)
  const acting = actsForOthers(me)
  const [scope, setScope] = useState<'upcoming' | 'past' | 'all'>('upcoming')
  const [whose, setWhose] = useState(me.member.id)
  const [people, setPeople] = useState<Person[]>([])
  const [data, setData] = useState<MyBookingsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Booking | null>(null)

  useEffect(() => {
    if (acting) labApi.people().then(setPeople, () => undefined)
  }, [acting])

  useEffect(() => {
    let stale = false
    labApi.bookings(scope, whose === me.member.id ? undefined : whose).then(
      (d) => {
        if (stale) return
        setData(d)
        setError(null)
      },
      (e) => !stale && setError(errorText(e)),
    )
    return () => {
      stale = true
    }
  }, [scope, whose, version, me.member.id])

  async function cancel(b: Booking) {
    const ok = await os.dialog.confirm(`Cancel ${b.instrument}, ${rangeLabel(b.start, b.end)}?`, { title: 'Cancel booking', okLabel: 'Cancel booking', danger: true })
    if (!ok) return
    try {
      await labApi.cancel(b.id)
      bump()
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Not cancelled' })
    }
  }

  const owner = data?.owner
  const cur = data?.currency ?? me.settings.currency
  return (
    <div className="kl-page">
      <div className="kl-page-head">
        <h2>{owner && owner.id !== me.member.id ? `${owner.full_name}’s bookings` : 'My bookings'}</h2>
        <div className="kl-seg">
          {(['upcoming', 'past', 'all'] as const).map((s) => (
            <button key={s} className={scope === s ? 'active' : ''} onClick={() => setScope(s)}>
              {s === 'upcoming' ? 'Upcoming' : s === 'past' ? 'Past' : 'All'}
            </button>
          ))}
        </div>
        {acting && (
          <select className="k-input kl-whose" value={whose} onChange={(e) => setWhose(Number(e.target.value))} title="Whose bookings">
            <option value={me.member.id}>Mine</option>
            {people
              .filter((p) => p.id !== me.member.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
          </select>
        )}
        <span className="kl-flex" />
        <button
          className="k-btn"
          onClick={() => void exportIcal({ user: whose === me.member.id ? undefined : whose }, `${safeName(owner?.username ?? 'my')}-bookings.ics`)}
          title="Save these bookings as an .ics calendar file"
        >
          <CalendarArrowDown size={14} /> Export iCal
        </button>
      </div>
      {data && <div className="kl-summary">This month: {money(cur, data.month_total)} (approved bookings)</div>}
      {error && <div className="k-error">{error}</div>}
      {!data && !error ? (
        <div className="k-center">
          <LoaderCircle size={20} className="k-spin" />
        </div>
      ) : data && data.bookings.length === 0 ? (
        <div className="k-empty">{scope === 'upcoming' ? 'No bookings coming up. Pick an instrument and drag across the calendar to book.' : 'No bookings here.'}</div>
      ) : data ? (
        <table className="kl-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Instrument</th>
              <th>Length</th>
              <th>Status</th>
              <th>Purpose</th>
              <th className="num">Cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.bookings.map((b) => (
              <tr key={b.id} onDoubleClick={() => setOpen(b)}>
                <td>
                  <button className="k-link-btn" onClick={() => setOpen(b)}>
                    {rangeLabel(b.start, b.end)}
                  </button>
                </td>
                <td>
                  <span className="kl-dot" style={{ background: b.colour }} /> {b.instrument}
                </td>
                <td>{fmtDuration(diffMinutes(b.start, b.end))}</td>
                <td>
                  <StatusPill status={b.status} />
                </td>
                <td className="kl-ellipsis kl-purpose">{b.purpose}</td>
                <td className="num">{money(cur, b.cost)}</td>
                <td className="kl-actions">
                  {b.cancellable && (
                    <button className="k-icon-btn" title="Cancel booking" onClick={() => void cancel(b)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {open && <BookingDialog booking={open} me={me} onClose={() => setOpen(null)} />}
    </div>
  )
}

export function Requests({ me }: { me: Me }) {
  const version = useLab((s) => s.version)
  const [data, setData] = useState<{ bookings: Booking[]; members: Member[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Booking | null>(null)

  useEffect(() => {
    let stale = false
    labApi.requests().then(
      (d) => !stale && (setData(d), setError(null)),
      (e) => !stale && setError(errorText(e)),
    )
    return () => {
      stale = true
    }
  }, [version])

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      bump()
    } catch (e) {
      await os.dialog.alert(errorText(e))
    }
  }

  async function reject(b: Booking) {
    const note = await os.dialog.prompt(`Reject ${b.who}’s booking of ${b.instrument}, ${rangeLabel(b.start, b.end)}? The reason is shown to them.`, {
      title: 'Reject booking',
      okLabel: 'Reject',
      placeholder: 'Reason',
    })
    if (note !== null) await act(() => labApi.decide(b.id, false, note))
  }

  const cur = me.settings.currency
  return (
    <div className="kl-page">
      <div className="kl-page-head">
        <h2>Requests</h2>
      </div>
      {error && <div className="k-error">{error}</div>}
      {data && data.bookings.length === 0 && data.members.length === 0 && <div className="k-empty">Nothing is waiting for you.</div>}
      {data && data.members.length > 0 && (
        <>
          <h3>New lab accounts</h3>
          <table className="kl-table">
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.full_name} <span className="k-muted">@{m.username}</span>
                  </td>
                  <td>{m.created.replace('T', ' ')}</td>
                  <td className="kl-actions">
                    <button className="k-btn small" onClick={() => void act(() => labApi.updateMember(m.id, { status: 'disabled' }))}>
                      <X size={12} /> Refuse
                    </button>
                    <button className="k-btn small primary" onClick={() => void act(() => labApi.updateMember(m.id, { status: 'active' }))}>
                      <Check size={12} /> Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data && data.bookings.length > 0 && (
        <>
          <h3>Bookings waiting for approval</h3>
          <table className="kl-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Instrument</th>
                <th>Who</th>
                <th>Purpose</th>
                <th className="num">Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.bookings.map((b) => (
                <tr key={b.id}>
                  <td>
                    <button className="k-link-btn" onClick={() => setOpen(b)}>
                      {rangeLabel(b.start, b.end)}
                    </button>
                  </td>
                  <td>
                    <span className="kl-dot" style={{ background: b.colour }} /> {b.instrument}
                  </td>
                  <td>{b.who}</td>
                  <td className="kl-ellipsis kl-purpose">{b.purpose}</td>
                  <td className="num">{money(cur, b.cost)}</td>
                  <td className="kl-actions">
                    <button className="k-btn small" onClick={() => void reject(b)}>
                      <X size={12} /> Reject
                    </button>
                    <button className="k-btn small primary" onClick={() => void act(() => labApi.decide(b.id, true))}>
                      <Check size={12} /> Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {open && <BookingDialog booking={open} me={me} onClose={() => setOpen(null)} />}
    </div>
  )
}
