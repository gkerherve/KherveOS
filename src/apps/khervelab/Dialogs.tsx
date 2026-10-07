// KherveLAB's own dialogs, drawn inside the app window: the booking window
// (filled from the server's /quote, so it shows exactly what the rules
// allow), a booking's details, and Report a problem.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, CheckCircle2, Clock, LoaderCircle, Trash2, UserRound, X } from 'lucide-react'
import { os } from '@/os'
import { errorText, labApi } from './api'
import type { Booking, Instrument, Me, Person, Quote } from './types'
import { fmtDuration, diffMinutes, money, normaliseStamp, rangeLabel } from './time'
import { actsForOthers, bump, isAdmin } from './store'

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus], textarea, input, select, button.primary')?.focus()
  }, [])
  return (
    <div className="kl-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`kl-modal${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="kl-modal-title">
          <span className="kl-ellipsis">{title}</span>
          <button className="k-icon-btn" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function usePeople(enabled: boolean): Person[] {
  const [people, setPeople] = useState<Person[]>([])
  useEffect(() => {
    if (!enabled) return
    let stale = false
    labApi.people().then(
      (p) => !stale && setPeople(p.filter((x) => x.status === 'active')),
      () => undefined,
    )
    return () => {
      stale = true
    }
  }, [enabled])
  return people
}

// ------------------------------------------------------------------ book

export function BookDialog({ inst, start, end, me, onClose }: { inst: Instrument; start: string; end: string; me: Me; onClose: () => void }) {
  const acting = actsForOthers(me)
  const people = usePeople(acting)
  const [forId, setForId] = useState(me.member.id)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [purpose, setPurpose] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stale = false
    setLoading(true)
    labApi.quote(inst.id, start, end, forId === me.member.id ? undefined : forId).then(
      (q) => {
        if (stale) return
        setQuote(q)
        setError(null)
        setLoading(false)
      },
      (e) => {
        if (stale) return
        setError(errorText(e))
        setLoading(false)
      },
    )
    return () => {
      stale = true
    }
  }, [inst.id, start, end, forId, me.member.id])

  async function submit() {
    if (!quote?.bookable) return
    setBusy(true)
    try {
      const r = await labApi.book(inst.id, start, end, purpose, forId === me.member.id ? undefined : forId)
      const pending = r.bookings.some((b) => b.status === 'pending')
      const what = r.bookings.length > 1 ? `${r.bookings.length} ${inst.name} sessions` : `${inst.name}, ${rangeLabel(r.bookings[0].start, r.bookings[0].end)}`
      os.notify({
        title: pending ? 'Request sent' : 'Booked',
        body: pending ? `${what}. It shows as pending until the lab manager approves it.` : what,
        icon: pending ? Clock : CheckCircle2,
      })
      if (r.problems.length) void os.dialog.alert(r.problems.map((p) => `Not booked: ${p}.`).join('\n'), { title: 'Some sessions were not booked' })
      bump()
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  const cur = quote?.currency ?? me.settings.currency
  const sessions = inst.booking_mode === 'sessions'
  return (
    <Modal title={`Book ${inst.name}`} onClose={onClose}>
      <div className="kl-modal-body">
        {acting && (
          <label className="kl-field">
            <span>For</span>
            <select className="k-input" value={forId} onChange={(e) => setForId(Number(e.target.value))}>
              <option value={me.member.id}>{me.member.full_name} (you)</option>
              {people
                .filter((p) => p.id !== me.member.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name} ({p.username})
                  </option>
                ))}
            </select>
          </label>
        )}
        {loading && !quote ? (
          <div className="kl-muted-row">
            <LoaderCircle size={14} className="k-spin" /> Checking the rules…
          </div>
        ) : quote ? (
          <>
            <div className="kl-quote">
              {quote.items.map((it) => (
                <div key={it.start} className={`kl-quote-item${it.errors.length ? ' bad' : ''}`}>
                  <div className="kl-quote-when">
                    {it.errors.length ? <AlertTriangle size={13} /> : <Check size={13} />}
                    <span>
                      {it.label ? `${it.label}, ` : ''}
                      {rangeLabel(it.start, it.end)} <span className="k-muted">({fmtDuration(diffMinutes(it.start, it.end))})</span>
                    </span>
                    <span className="kl-quote-cost">{money(cur, it.cost)}</span>
                  </div>
                  {it.errors.map((e) => (
                    <div key={e} className="kl-quote-error">
                      {e[0].toUpperCase() + e.slice(1)}.
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="kl-quote-total">
              <span>{quote.bookable ? (quote.instant ? 'Approved at once' : 'Waits for the lab manager’s approval') : 'Nothing here can be booked'}</span>
              {quote.bookable && <strong>{money(cur, quote.total)}</strong>}
            </div>
          </>
        ) : null}
        {sessions && <div className="k-muted kl-small">Each session is its own booking, approved and charged on its own.</div>}
        <label className="kl-field">
          <span>Purpose</span>
          <textarea className="k-input" rows={2} value={purpose} maxLength={500} placeholder="Samples, project or account code…" onChange={(e) => setPurpose(e.target.value)} />
        </label>
        {error && <div className="k-error">{error}</div>}
      </div>
      <div className="kl-modal-buttons">
        <button className="k-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="k-btn primary" disabled={!quote?.bookable || busy || loading} onClick={() => void submit()}>
          {busy ? <LoaderCircle size={14} className="k-spin" /> : null}
          {quote && !quote.instant ? 'Send request' : 'Book'}
        </button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ a booking's details

const STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  pending: 'Waiting for approval',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`kl-pill ${status}`}>{STATUS_LABELS[status] ?? status}</span>
}

export function BookingDialog({ booking, me, onClose }: { booking: Booking; me: Me; onClose: () => void }) {
  const [b, setB] = useState(booking)
  const [purpose, setPurpose] = useState(booking.purpose)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const acting = actsForOthers(me)
  const admin = isAdmin(me)
  const people = usePeople(acting && b.editable)
  const [giveTo, setGiveTo] = useState<number>(0)
  const cur = me.settings.currency
  const canSeeDetails = b.mine || acting

  async function run(fn: () => Promise<Booking | void>, close = false) {
    setBusy(true)
    setError(null)
    try {
      const out = await fn()
      if (out) setB(out)
      bump()
      if (close) onClose()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    const note = await os.dialog.prompt(`Cancel ${b.mine ? 'your' : `${b.who}’s`} booking of ${b.instrument}, ${rangeLabel(b.start, b.end)}?`, {
      title: 'Cancel booking',
      okLabel: 'Cancel booking',
      placeholder: 'Reason (optional)',
    })
    if (note === null) return
    await run(() => labApi.cancel(b.id, note), true)
  }

  async function decide(approve: boolean) {
    let note = ''
    if (!approve) {
      const reason = await os.dialog.prompt('Why is it rejected? The person sees this.', { title: 'Reject booking', okLabel: 'Reject' })
      if (reason === null) return
      note = reason
    }
    await run(() => labApi.decide(b.id, approve, note))
  }

  return (
    <Modal title={`${b.instrument}, ${rangeLabel(b.start, b.end)}`} onClose={onClose}>
      <div className="kl-modal-body">
        <div className="kl-detail-grid">
          <span>Booked for</span>
          <span>
            <UserRound size={12} /> {b.mine ? `${b.who} (you)` : b.who}
          </span>
          <span>Status</span>
          <span>
            <StatusPill status={b.status} />
            {b.issue === 'down' && <span className="kl-pill rejected">Out of order</span>}
            {b.issue === 'problem' && <span className="kl-pill pending">Problem reported</span>}
          </span>
          <span>Length</span>
          <span>{fmtDuration(diffMinutes(b.start, b.end))}</span>
          {canSeeDetails && b.cost !== null && (
            <>
              <span>Cost</span>
              <span>
                {money(cur, b.cost)}{' '}
                <span className="k-muted">
                  {b.price_basis === 'session' ? '(session price)' : b.price_basis === 'fixed' ? '(fixed charge)' : `(${money(cur, b.rate)}/h)`}
                </span>
              </span>
            </>
          )}
          {canSeeDetails && b.note && (
            <>
              <span>Note</span>
              <span>{b.note}</span>
            </>
          )}
        </div>
        {canSeeDetails && (
          <label className="kl-field">
            <span>Purpose</span>
            <textarea className="k-input" rows={2} value={purpose} maxLength={500} disabled={!b.editable} onChange={(e) => setPurpose(e.target.value)} />
          </label>
        )}
        {acting && b.editable && (
          <div className="kl-field">
            <span>Give to</span>
            <div className="kl-row">
              <select className="k-input" value={giveTo} onChange={(e) => setGiveTo(Number(e.target.value))}>
                <option value={0}>Choose someone…</option>
                {people
                  .filter((p) => p.id !== b.user_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name} ({p.username})
                    </option>
                  ))}
              </select>
              <button className="k-btn" disabled={!giveTo || busy} onClick={() => void run(() => labApi.reassign(b.id, giveTo))}>
                Give
              </button>
            </div>
          </div>
        )}
        {error && <div className="k-error">{error}</div>}
      </div>
      <div className="kl-modal-buttons">
        {b.cancellable && (
          <button className="k-btn danger" disabled={busy} onClick={() => void cancel()}>
            <Trash2 size={13} /> Cancel booking
          </button>
        )}
        <span className="kl-flex" />
        {admin && b.status === 'pending' && (
          <>
            <button className="k-btn" disabled={busy} onClick={() => void decide(false)}>
              Reject
            </button>
            <button className="k-btn primary" disabled={busy} onClick={() => void decide(true)}>
              Approve
            </button>
          </>
        )}
        {b.editable && purpose !== b.purpose ? (
          <button className="k-btn primary" disabled={busy} onClick={() => void run(() => labApi.change(b.id, { purpose }))}>
            Save
          </button>
        ) : (
          <button className="k-btn" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ report a problem

export function IssueDialog({ inst, now, onClose }: { inst: Instrument; now: string; onClose: () => void }) {
  const [kind, setKind] = useState<'problem' | 'down'>('problem')
  const [from, setFrom] = useState(now.replace('T', ' '))
  const [until, setUntil] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const start = normaliseStamp(from)
    const end = until.trim() ? normaliseStamp(until) : null
    if (!start || (until.trim() && !end)) {
      setError('Write times as 2026-10-07 09:00.')
      return
    }
    setBusy(true)
    try {
      await labApi.reportIssue({ instrument_id: inst.id, kind, start, end, note })
      os.notify({ title: kind === 'down' ? `${inst.name} marked out of order` : `Problem reported on ${inst.name}`, body: note || undefined })
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={`Report a problem: ${inst.name}`} onClose={onClose}>
      <div className="kl-modal-body">
        <div className="kl-choice">
          <label>
            <input type="radio" checked={kind === 'problem'} onChange={() => setKind('problem')} />
            <span>
              <strong>Problem</strong> — still usable, take care
            </span>
          </label>
          <label>
            <input type="radio" checked={kind === 'down'} onChange={() => setKind('down')} />
            <span>
              <strong>Out of order</strong> — cannot be used; stops new bookings
            </span>
          </label>
        </div>
        <div className="kl-row">
          <label className="kl-field">
            <span>From</span>
            <input className="k-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="kl-field">
            <span>Until</span>
            <input className="k-input" value={until} placeholder="until fixed" onChange={(e) => setUntil(e.target.value)} />
          </label>
        </div>
        <label className="kl-field">
          <span>Details</span>
          <textarea className="k-input" rows={3} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <div className="k-error">{error}</div>}
      </div>
      <div className="kl-modal-buttons">
        <button className="k-btn" onClick={onClose}>
          Cancel
        </button>
        <button className={`k-btn ${kind === 'down' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => void submit()}>
          Report
        </button>
      </div>
    </Modal>
  )
}
