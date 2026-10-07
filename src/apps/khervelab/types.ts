// What the KherveLAB server module (server/kherveos_server/lab.py) sends.
// Times are lab wall-clock strings, "YYYY-MM-DDTHH:MM".

export type Role = 'user' | 'superuser' | 'admin'
export type MemberStatus = 'pending' | 'active' | 'disabled'
export type Approval = 'auto' | 'trained' | 'manual'
export type PeriodMode = 'closed' | 'block' | 'daytime' | 'own'
export type BookingStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface Member {
  id: number
  username: string
  full_name: string
  role: Role
  status: MemberStatus
  category: string
  group_name: string
  created: string
  /** A manager by configuration (first account / KHERVELAB_ADMINS). */
  locked: boolean
  trained?: number[]
}

export interface LabSettings {
  lab_name: string
  currency: string
  timezone: string
  categories: string
  account_approval: string
  show_names: string
}

export interface Me {
  member: Member
  settings: LabSettings
  categories: string[]
  now: string
  roles: Record<Role, string>
}

export interface Session {
  id?: number | null
  name: string
  start_time: string
  end_time: string
  days: string
  days_label?: string
  hours?: number
  prices: Record<string, number | null>
}

export interface Issue {
  id: number
  instrument_id: number
  kind: 'problem' | 'down'
  start: string
  end: string | null
  note: string
  reported_by: number | null
  created: string
  instrument?: string
  reporter?: string | null
}

/** The columns an instrument editor changes. */
export interface InstrumentFields {
  name: string
  description: string
  location: string
  colour: string
  active: boolean
  approval: Approval
  booking_mode: 'free' | 'sessions'
  slot_minutes: number
  min_minutes: number
  max_minutes: number
  max_days_ahead: number
  open_time: string
  close_time: string
  evening_mode: PeriodMode
  evening_start: string
  evening_end: string
  evening_slot: number
  weekend_mode: PeriodMode
  weekend_start: string
  weekend_end: string
  weekend_slot: number
  weekend_span: 'daily' | 'whole'
}

export interface Instrument extends InstrumentFields {
  id: number
  rates: Record<string, number>
  my_rate: number
  instant: boolean
  trained_me: boolean
  describe: string
  approval_label: string
  sessions: Session[]
  issue: Issue | null
  trained?: number[]
  bookings_count?: number
}

export interface Booking {
  id: number
  instrument_id: number
  instrument: string
  colour: string
  user_id: number
  who: string
  username: string
  start: string
  end: string
  status: BookingStatus
  mine: boolean
  purpose: string
  note: string
  cost: number | null
  price_basis: 'session' | 'fixed' | 'hourly'
  rate: number | null
  session: boolean
  created: string | null
  editable: boolean
  cancellable: boolean
  issue: '' | 'problem' | 'down'
}

export interface Slot {
  instrument_id: number
  start: string
  end: string
  label: string
  state: 'free' | 'problem' | 'down'
}

export interface CalendarData {
  slots: Slot[]
  bookings: Booking[]
  issues: Issue[]
  now: string
}

export interface QuoteItem {
  start: string
  end: string
  label: string
  cost: number
  errors: string[]
}

export interface Quote {
  items: QuoteItem[]
  bookable: boolean
  currency: string
  total: number
  instant: boolean
  for: { id: number; full_name: string }
}

export interface Person {
  id: number
  username: string
  full_name: string
  status: MemberStatus
}
