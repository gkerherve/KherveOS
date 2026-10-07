// The lab manager's panel: instruments (periods, sessions, rates, training),
// people (roles, categories), lab settings and reported problems.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, LoaderCircle, Plus, Sparkles, Trash2, Wrench } from 'lucide-react'
import { os } from '@/os'
import { errorText, labApi, type InstrumentBody } from './api'
import { bump, loadLab, useLab } from './store'
import type { Instrument, InstrumentFields, Issue, Me, Member, PeriodMode, Role, Session } from './types'
import { DAY_NAMES, fmtDuration } from './time'

type Tab = 'instruments' | 'people' | 'settings' | 'problems'

export function Admin({ me, tab, setTab }: { me: Me; tab: Tab; setTab: (t: Tab) => void }) {
  return (
    <div className="kl-page kl-admin">
      <div className="kl-page-head">
        <h2>Manage the lab</h2>
        <div className="kl-seg">
          {(
            [
              ['instruments', 'Instruments'],
              ['people', 'People'],
              ['settings', 'Lab settings'],
              ['problems', 'Problems'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'instruments' && <Instruments me={me} />}
      {tab === 'people' && <People me={me} />}
      {tab === 'settings' && <SettingsForm me={me} />}
      {tab === 'problems' && <Problems />}
    </div>
  )
}

// ------------------------------------------------------------------ instruments

const NEW: InstrumentFields = {
  name: '',
  description: '',
  location: '',
  colour: '#22b357',
  active: true,
  approval: 'manual',
  booking_mode: 'free',
  slot_minutes: 30,
  min_minutes: 30,
  max_minutes: 480,
  max_days_ahead: 60,
  open_time: '08:00',
  close_time: '20:00',
  evening_mode: 'closed',
  evening_start: '17:00',
  evening_end: '08:00',
  evening_slot: 60,
  weekend_mode: 'closed',
  weekend_start: '08:00',
  weekend_end: '20:00',
  weekend_slot: 60,
  weekend_span: 'daily',
}

const FIELD_KEYS = Object.keys(NEW) as (keyof InstrumentFields)[]

// Ready-made session layouts (as on the desktop), to start from and edit.
const SESSION_TEMPLATES: Record<string, [string, string, string, string][]> = {
  'Two day sessions and an evening run': [
    ['Morning', '08:00', '12:30', '01234'],
    ['Afternoon', '12:30', '17:00', '01234'],
    ['Evening and overnight', '17:00', '08:00', '01234'],
  ],
  'Full day and overnight': [
    ['Day', '08:00', '17:00', '01234'],
    ['Overnight', '17:00', '08:00', '01234'],
  ],
  '24-hour runs, every day': [['24 h run', '08:00', '08:00', '0123456']],
  'Half days': [
    ['Morning', '09:00', '13:00', '01234'],
    ['Afternoon', '13:00', '17:00', '01234'],
  ],
}

const MODE_LABELS: Record<PeriodMode, string> = {
  closed: 'Closed',
  block: 'One booking for the whole period',
  daytime: 'Same slots as the daytime',
  own: 'Its own slot length',
}

interface Draft {
  fields: InstrumentFields
  rates: Record<string, number>
  sessions: Session[]
  trained: number[]
}

function draftOf(inst: Instrument | null, categories: string[]): Draft {
  if (!inst) return { fields: { ...NEW }, rates: Object.fromEntries(categories.map((c) => [c, 0])), sessions: [], trained: [] }
  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, inst[k]])) as unknown as InstrumentFields
  return { fields, rates: { ...inst.rates }, sessions: inst.sessions.map((s) => ({ ...s, prices: { ...s.prices } })), trained: [...(inst.trained ?? [])] }
}

function Instruments({ me }: { me: Me }) {
  const version = useLab((s) => s.version)
  const [all, setAll] = useState<Instrument[] | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [selected, setSelected] = useState<number | 'new' | null>(null)

  useEffect(() => {
    labApi.instruments(true).then(setAll, () => undefined)
    labApi.members().then(setMembers, () => undefined)
  }, [version])

  useEffect(() => {
    if (selected === null && all && all.length) setSelected(all[0].id)
  }, [all, selected])

  const inst = typeof selected === 'number' ? (all?.find((i) => i.id === selected) ?? null) : null

  async function examples() {
    try {
      const r = await labApi.addExamples()
      os.notify({ title: r.added ? `Added ${r.added} instruments` : 'The example instruments are already there' })
      await loadLab()
    } catch (e) {
      await os.dialog.alert(errorText(e))
    }
  }

  return (
    <div className="kl-split">
      <div className="kl-split-list">
        <button className="k-btn small wide" onClick={() => setSelected('new')}>
          <Plus size={13} /> New instrument
        </button>
        {all?.length === 0 && (
          <button className="k-btn small wide" onClick={() => void examples()} title="XPS, NAP-XPS, TGA/DSC, dilatometer, BET, glovebox">
            <Sparkles size={13} /> Add example instruments
          </button>
        )}
        {all?.map((i) => (
          <button key={i.id} className={`kl-list-item${selected === i.id ? ' active' : ''}${i.active ? '' : ' retired'}`} onClick={() => setSelected(i.id)}>
            <span className="kl-dot" style={{ background: i.colour }} />
            <span className="kl-ellipsis">{i.name}</span>
            {!i.active && <span className="kl-tag">retired</span>}
          </button>
        ))}
      </div>
      <div className="kl-split-main">
        {selected === null || (selected !== 'new' && !inst) ? (
          <div className="k-empty">{all === null || selected !== null ? <LoaderCircle size={18} className="k-spin" /> : 'Add the lab’s first instrument.'}</div>
        ) : (
          <InstrumentEditor
            key={String(selected)}
            inst={inst}
            me={me}
            members={members}
            onSaved={(i) => {
              setSelected(i.id)
              void loadLab()
            }}
            onDeleted={() => {
              setSelected(null)
              void loadLab()
            }}
          />
        )}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="kl-field">
      <span>{label}</span>
      {children}
      {hint && <small className="k-muted">{hint}</small>}
    </label>
  )
}

function Minutes({ value, onChange, max = 1440 }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="kl-row">
      <input className="k-input kl-num" type="number" min={5} max={max} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="k-muted kl-small">min ({fmtDuration(value || 0)})</span>
    </div>
  )
}

function InstrumentEditor({ inst, me, members, onSaved, onDeleted }: {
  inst: Instrument | null
  me: Me
  members: Member[]
  onSaved: (i: Instrument) => void
  onDeleted: () => void
}) {
  const categories = me.categories
  const [d, setD] = useState<Draft>(() => draftOf(inst, categories))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const f = d.fields
  const set = <K extends keyof InstrumentFields>(k: K, v: InstrumentFields[K]) => setD((x) => ({ ...x, fields: { ...x.fields, [k]: v } }))
  const dirty = useMemo(() => JSON.stringify(d) !== JSON.stringify(draftOf(inst, categories)), [d, inst, categories])

  async function save() {
    setBusy(true)
    setError(null)
    const body: InstrumentBody = { ...f, rates: d.rates, trained: d.trained, sessions: f.booking_mode === 'sessions' || d.sessions.length ? d.sessions : undefined }
    try {
      const out = inst ? await labApi.updateInstrument(inst.id, body) : await labApi.createInstrument(body)
      os.notify({ title: inst ? `Saved ${out.name}` : `Added ${out.name}` })
      setD(draftOf(out, categories)) // new sessions now have their ids
      onSaved(out)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!inst) return
    const n = inst.bookings_count ?? 0
    if (!n) {
      if (!(await os.dialog.confirm(`Delete ${inst.name}?`, { title: 'Remove instrument', okLabel: 'Delete', danger: true }))) return
    } else {
      const choice = await os.dialog.choose(
        `${inst.name} has ${n} booking${n === 1 ? '' : 's'}. Retiring it hides it and stops all booking, but keeps its bookings and charges. Deleting removes them too.`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Delete with its bookings', value: 'delete', danger: true },
          { label: 'Retire', value: 'retire', primary: true },
        ],
        { title: 'Remove instrument' },
      )
      if (choice === 'retire') {
        try {
          onSaved(await labApi.updateInstrument(inst.id, { active: false }))
        } catch (e) {
          setError(errorText(e))
        }
        return
      }
      if (choice !== 'delete') return
      if (!(await os.dialog.confirm(`Really delete ${inst.name} and its ${n} booking${n === 1 ? '' : 's'}? This cannot be undone.`, { okLabel: 'Delete', danger: true })))
        return
    }
    try {
      await labApi.deleteInstrument(inst.id, n > 0)
      onDeleted()
    } catch (e) {
      setError(errorText(e))
    }
  }

  function applyTemplate(name: string) {
    const rows = SESSION_TEMPLATES[name]
    if (!rows) return
    setD((x) => ({ ...x, sessions: rows.map(([n, s, e, days]) => ({ name: n, start_time: s, end_time: e, days, prices: {} })) }))
  }

  const setSession = (i: number, patch: Partial<Session>) => setD((x) => ({ ...x, sessions: x.sessions.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))

  const period = (kind: 'evening' | 'weekend') => {
    const mode = f[`${kind}_mode`]
    return (
      <fieldset className="kl-fieldset">
        <legend>{kind === 'evening' ? 'Evening (Mon–Fri)' : 'Weekend'}</legend>
        <div className="kl-grid">
          <Field label="Booked">
            <select className="k-input" value={mode} onChange={(e) => set(`${kind}_mode`, e.target.value as PeriodMode)}>
              {(Object.keys(MODE_LABELS) as PeriodMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          {mode !== 'closed' && kind === 'weekend' && (
            <Field label="Runs">
              <select className="k-input" value={f.weekend_span} onChange={(e) => set('weekend_span', e.target.value as 'daily' | 'whole')}>
                <option value="daily">Each day (Saturday and Sunday)</option>
                <option value="whole">The whole weekend, Saturday to Monday</option>
              </select>
            </Field>
          )}
          {mode !== 'closed' && (
            <>
              <Field label={kind === 'weekend' && f.weekend_span === 'whole' ? 'Starts Saturday' : 'Starts'}>
                <input className="k-input" type="time" value={f[`${kind}_start`]} onChange={(e) => set(`${kind}_start`, e.target.value)} />
              </Field>
              <Field label={kind === 'weekend' && f.weekend_span === 'whole' ? 'Ends Monday' : 'Ends'} hint="At or before the start: the next day">
                <input className="k-input" type="time" value={f[`${kind}_end`]} onChange={(e) => set(`${kind}_end`, e.target.value)} />
              </Field>
            </>
          )}
          {mode === 'own' && (
            <Field label="Slot length">
              <Minutes value={f[`${kind}_slot`]} max={kind === 'weekend' ? 4320 : 1440} onChange={(n) => set(`${kind}_slot`, n)} />
            </Field>
          )}
        </div>
      </fieldset>
    )
  }

  return (
    <div className="kl-editor">
      <fieldset className="kl-fieldset">
        <legend>Instrument</legend>
        <div className="kl-grid">
          <Field label="Name">
            <input className="k-input" value={f.name} data-autofocus maxLength={80} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Colour">
            <input className="kl-colour" type="color" value={f.colour} onChange={(e) => set('colour', e.target.value)} />
          </Field>
          <Field label="Description">
            <input className="k-input" value={f.description} maxLength={500} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Location">
            <input className="k-input" value={f.location} maxLength={120} onChange={(e) => set('location', e.target.value)} />
          </Field>
          <Field label="Approval">
            <select className="k-input" value={f.approval} onChange={(e) => set('approval', e.target.value as InstrumentFields['approval'])}>
              <option value="auto">Automatic: every booking approved at once</option>
              <option value="trained">Automatic for trained users</option>
              <option value="manual">Manual: every booking waits for you</option>
            </select>
          </Field>
          <Field label="How it is booked">
            <select className="k-input" value={f.booking_mode} onChange={(e) => set('booking_mode', e.target.value as InstrumentFields['booking_mode'])}>
              <option value="free">Free time, in slots</option>
              <option value="sessions">Fixed sessions</option>
            </select>
          </Field>
          <Field label="Book ahead" hint="How many days ahead people can book">
            <input className="k-input kl-num" type="number" min={0} max={3650} value={f.max_days_ahead} onChange={(e) => set('max_days_ahead', Number(e.target.value))} />
          </Field>
          {inst && (
            <Field label="Bookable">
              <label className="kl-check">
                <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> In service (untick to retire)
              </label>
            </Field>
          )}
        </div>
      </fieldset>

      {f.booking_mode === 'free' ? (
        <>
          <fieldset className="kl-fieldset">
            <legend>Daytime (Mon–Fri)</legend>
            <div className="kl-grid">
              <Field label="Opens">
                <input className="k-input" type="time" value={f.open_time} onChange={(e) => set('open_time', e.target.value)} />
              </Field>
              <Field label="Closes" hint="00:00 to 24:00 is round the clock">
                <input className="k-input" value={f.close_time} placeholder="20:00 or 24:00" onChange={(e) => set('close_time', e.target.value)} />
              </Field>
              <Field label="Slot length" hint="Slots are counted from the opening time">
                <Minutes value={f.slot_minutes} onChange={(n) => set('slot_minutes', n)} />
              </Field>
              <Field label="Shortest booking">
                <Minutes value={f.min_minutes} onChange={(n) => set('min_minutes', n)} />
              </Field>
              <Field label="Longest booking" hint="Shortest and longest apply to daytime bookings">
                <Minutes value={f.max_minutes} max={10080} onChange={(n) => set('max_minutes', n)} />
              </Field>
            </div>
          </fieldset>
          {period('evening')}
          {period('weekend')}
        </>
      ) : (
        <fieldset className="kl-fieldset">
          <legend>Sessions</legend>
          <div className="kl-row kl-wrap">
            <select className="k-input" value="" onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Start from a template…</option>
              {Object.keys(SESSION_TEMPLATES).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button
              className="k-btn small"
              onClick={() => setD((x) => ({ ...x, sessions: [...x.sessions, { name: 'Session', start_time: '09:00', end_time: '13:00', days: '01234', prices: {} }] }))}
            >
              <Plus size={12} /> Add session
            </button>
          </div>
          <table className="kl-table kl-sessions">
            <thead>
              <tr>
                <th>Name</th>
                <th>Start</th>
                <th>End</th>
                <th>Days</th>
                {categories.map((c) => (
                  <th key={c} className="num" title="Fixed price; empty = hourly rate × length">
                    {c}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {d.sessions.map((s, i) => (
                <tr key={i}>
                  <td>
                    <input className="k-input" value={s.name} onChange={(e) => setSession(i, { name: e.target.value })} />
                  </td>
                  <td>
                    <input className="k-input" type="time" value={s.start_time} onChange={(e) => setSession(i, { start_time: e.target.value })} />
                  </td>
                  <td>
                    <input className="k-input" type="time" value={s.end_time} onChange={(e) => setSession(i, { end_time: e.target.value })} />
                  </td>
                  <td className="kl-days">
                    {DAY_NAMES.map((n, di) => (
                      <label key={n} title={n}>
                        <input
                          type="checkbox"
                          checked={s.days.includes(String(di))}
                          onChange={(e) => {
                            const days = new Set(s.days.split(''))
                            if (e.target.checked) days.add(String(di))
                            else days.delete(String(di))
                            setSession(i, { days: [...days].sort().join('') })
                          }}
                        />
                        {n[0]}
                      </label>
                    ))}
                  </td>
                  {categories.map((c) => (
                    <td key={c}>
                      <input
                        className="k-input kl-num"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="rate"
                        value={s.prices[c] ?? ''}
                        onChange={(e) => setSession(i, { prices: { ...s.prices, [c]: e.target.value === '' ? null : Number(e.target.value) } })}
                      />
                    </td>
                  ))}
                  <td>
                    <button className="k-icon-btn" title="Remove session" onClick={() => setD((x) => ({ ...x, sessions: x.sessions.filter((_, j) => j !== i) }))}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.sessions.length === 0 && <div className="k-muted kl-small">No sessions yet: start from a template or add one. An end at or before the start runs into the next day.</div>}
        </fieldset>
      )}

      <fieldset className="kl-fieldset">
        <legend>Hourly rate per user category ({me.settings.currency})</legend>
        <div className="kl-grid">
          {categories.map((c) => (
            <Field key={c} label={c}>
              <input
                className="k-input kl-num"
                type="number"
                min={0}
                step="0.01"
                value={d.rates[c] ?? 0}
                onChange={(e) => setD((x) => ({ ...x, rates: { ...x.rates, [c]: Number(e.target.value) } }))}
              />
            </Field>
          ))}
        </div>
      </fieldset>

      <fieldset className="kl-fieldset">
        <legend>Trained users {f.approval === 'trained' ? '(booked at once)' : ''}</legend>
        <div className="kl-trained">
          {members.map((m) => (
            <label key={m.id} className="kl-check">
              <input
                type="checkbox"
                checked={d.trained.includes(m.id)}
                onChange={(e) => setD((x) => ({ ...x, trained: e.target.checked ? [...x.trained, m.id] : x.trained.filter((t) => t !== m.id) }))}
              />
              {m.full_name}
            </label>
          ))}
        </div>
      </fieldset>

      {error && <div className="k-error">{error}</div>}
      <div className="kl-editor-buttons">
        {inst && (
          <button className="k-btn danger" onClick={() => void remove()}>
            {inst.bookings_count ? <Archive size={13} /> : <Trash2 size={13} />} Remove…
          </button>
        )}
        <span className="kl-flex" />
        <button className="k-btn primary" disabled={busy || !f.name.trim() || (!dirty && !!inst)} onClick={() => void save()}>
          {busy && <LoaderCircle size={13} className="k-spin" />} {inst ? 'Save' : 'Add instrument'}
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ people

function People({ me }: { me: Me }) {
  const version = useLab((s) => s.version)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    labApi.members().then(setMembers, (e) => setError(errorText(e)))
  }, [version])

  async function update(m: Member, patch: Partial<Member>) {
    try {
      const out = await labApi.updateMember(m.id, patch)
      setMembers((list) => list?.map((x) => (x.id === m.id ? { ...x, ...out } : x)) ?? null)
      bump()
    } catch (e) {
      await os.dialog.alert(errorText(e), { title: 'Not changed' })
    }
  }

  return (
    <>
      <p className="k-muted kl-small">
        Everyone with a KherveOS account on this server. Lab managers manage everything; super users book, move and cancel for anyone, with that
        person’s rules and price.
      </p>
      {error && <div className="k-error">{error}</div>}
      <table className="kl-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Rate category</th>
            <th>Group</th>
          </tr>
        </thead>
        <tbody>
          {members?.map((m) => (
            <tr key={m.id}>
              <td>
                {m.full_name} <span className="k-muted">@{m.username}</span>
              </td>
              <td>
                <select className="k-input" value={m.role} disabled={m.locked || m.id === me.member.id} onChange={(e) => void update(m, { role: e.target.value as Role })}>
                  {(Object.keys(me.roles) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {me.roles[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="k-input"
                  value={m.status}
                  disabled={m.locked || m.id === me.member.id}
                  onChange={(e) => void update(m, { status: e.target.value as Member['status'] })}
                >
                  <option value="active">Active</option>
                  <option value="pending">Waiting for approval</option>
                  <option value="disabled">Disabled</option>
                </select>
              </td>
              <td>
                <select className="k-input" value={m.category} onChange={(e) => void update(m, { category: e.target.value })}>
                  {me.categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className="k-input"
                  defaultValue={m.group_name}
                  placeholder="Group / PI"
                  onBlur={(e) => e.target.value !== m.group_name && void update(m, { group_name: e.target.value })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

// ------------------------------------------------------------------ settings

function SettingsForm({ me }: { me: Me }) {
  const s = me.settings
  const [labName, setLabName] = useState(s.lab_name)
  const [currency, setCurrency] = useState(s.currency)
  const [timezone, setTimezone] = useState(s.timezone)
  const [cats, setCats] = useState(me.categories.join('\n'))
  const [approval, setApproval] = useState(s.account_approval === '1')
  const [names, setNames] = useState(s.show_names === '1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await labApi.saveSettings({
        lab_name: labName,
        currency,
        timezone,
        categories: cats.split('\n'),
        account_approval: approval,
        show_names: names,
      })
      os.notify({ title: 'Lab settings saved' })
      await loadLab()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kl-editor kl-narrow">
      <div className="kl-grid">
        <Field label="Lab name">
          <input className="k-input" value={labName} maxLength={100} onChange={(e) => setLabName(e.target.value)} />
        </Field>
        <Field label="Currency">
          <input className="k-input kl-num" value={currency} maxLength={8} onChange={(e) => setCurrency(e.target.value)} />
        </Field>
        <Field label="Time zone" hint="Bookings are lab wall-clock times, e.g. Europe/London">
          <input className="k-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </Field>
      </div>
      <Field label="Rate categories" hint="One per line. People in a removed category move to the first.">
        <textarea className="k-input" rows={4} value={cats} onChange={(e) => setCats(e.target.value)} />
      </Field>
      <label className="kl-check">
        <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> New lab members wait for my approval before they can book
      </label>
      <label className="kl-check">
        <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Everyone sees who booked a slot
      </label>
      {error && <div className="k-error">{error}</div>}
      <div className="kl-editor-buttons">
        <span className="kl-flex" />
        <button className="k-btn primary" disabled={busy} onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ problems

function Problems() {
  const version = useLab((s) => s.version)
  const instruments = useLab((s) => s.instruments)
  const [issues, setIssues] = useState<Issue[] | null>(null)

  useEffect(() => {
    labApi.issues().then(setIssues, () => undefined)
  }, [version, instruments])

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn()
      await loadLab()
    } catch (e) {
      await os.dialog.alert(errorText(e))
    }
  }

  return (
    <>
      <p className="k-muted kl-small">Open reports and those of the last 90 days. Out of order stops new bookings (except yours); a problem only warns.</p>
      {issues?.length === 0 && <div className="k-empty">No problems reported.</div>}
      <table className="kl-table">
        <tbody>
          {issues?.map((x) => (
            <tr key={x.id}>
              <td>
                <span className={`kl-pill ${x.kind === 'down' ? 'rejected' : 'pending'}`}>{x.kind === 'down' ? 'Out of order' : 'Problem'}</span>
              </td>
              <td>{x.instrument}</td>
              <td>
                {x.start.replace('T', ' ')} → {x.end ? x.end.replace('T', ' ') : 'until fixed'}
              </td>
              <td className="kl-purpose">{x.note}</td>
              <td className="k-muted">{x.reporter ?? ''}</td>
              <td className="kl-actions">
                {!x.end && (
                  <button className="k-btn small" onClick={() => void act(() => labApi.resolveIssue(x.id))}>
                    <Wrench size={12} /> Fixed now
                  </button>
                )}
                <button
                  className="k-icon-btn"
                  title="Remove report (a mistake)"
                  onClick={() => void os.dialog.confirm('Remove this report?', { danger: true, okLabel: 'Remove' }).then((ok) => (ok ? act(() => labApi.deleteIssue(x.id)) : undefined))}
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
