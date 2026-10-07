// KherveLAB's shared state: who I am in the lab, the instruments, and a
// `version` that every view reloads on. Live events from the server
// (lab.changed, lab.booking) bump it, so every open window stays current.

import { create } from 'zustand'
import { FlaskConical } from 'lucide-react'
import { os } from '@/os'
import { realtime, type ServerEvent } from '@/os/server'
import { useWindows } from '@/os/windows'
import { errorText, labApi } from './api'
import type { Booking, Instrument, Me } from './types'
import { rangeLabel } from './time'

interface LabState {
  me: Me | null
  instruments: Instrument[]
  status: 'loading' | 'ready' | 'error'
  error: string | null
  /** Bumped by every change (live events included): views reload when it moves. */
  version: number
  /** Requests waiting for the manager (bookings + accounts). */
  requests: number
}

export const useLab = create<LabState>(() => ({
  me: null,
  instruments: [],
  status: 'loading',
  error: null,
  version: 0,
  requests: 0,
}))

export const isAdmin = (me: Me | null) => me?.member.role === 'admin'
export const actsForOthers = (me: Me | null) => me?.member.role === 'admin' || me?.member.role === 'superuser'

export async function loadLab(): Promise<void> {
  try {
    const [me, instruments] = await Promise.all([labApi.me(), labApi.instruments()])
    useLab.setState((s) => ({ me, instruments, status: 'ready', error: null, version: s.version + 1 }))
    void loadRequestCount()
  } catch (e) {
    useLab.setState({ status: 'error', error: errorText(e) })
  }
}

export async function loadRequestCount(): Promise<void> {
  if (!isAdmin(useLab.getState().me)) {
    useLab.setState({ requests: 0 })
    return
  }
  try {
    const r = await labApi.requests()
    useLab.setState({ requests: r.bookings.length + r.members.length })
  } catch {
    // the badge is only a hint
  }
}

export function bump(): void {
  useLab.setState((s) => ({ version: s.version + 1 }))
  void loadRequestCount()
}

const ACTION_TITLES: Record<string, string> = {
  approved: 'Booking approved',
  rejected: 'Booking rejected',
  cancelled: 'Booking cancelled',
  moved: 'Booking moved',
  reassigned: 'Booking given to someone else',
  booked: 'Booked for you',
}

let listeners = 0
let stop: (() => void) | null = null

/** Follow the server's live events while a KherveLAB window is open. */
export function listen(windowId: string): () => void {
  listeners++
  if (!stop) {
    const offChanged = realtime.on('lab.changed', (ev: ServerEvent) => {
      const what = String(ev.what ?? '')
      if (what === 'instruments' || what === 'settings' || what === 'members' || what === 'issues') void loadLab()
      else bump()
    })
    const offBooking = realtime.on('lab.booking', (ev: ServerEvent) => {
      const b = ev.booking as Booking | undefined
      const by = (ev.by as { full_name?: string } | undefined)?.full_name
      if (!b) return
      os.notify({
        title: ACTION_TITLES[String(ev.action)] ?? 'Booking changed',
        body: `${b.instrument}, ${rangeLabel(b.start, b.end)}${by ? ` — by ${by}` : ''}`,
        icon: FlaskConical,
        onClick: () => useWindows.getState().focus(windowId),
      })
    })
    stop = () => {
      offChanged()
      offBooking()
    }
  }
  return () => {
    listeners--
    if (listeners === 0 && stop) {
      stop()
      stop = null
    }
  }
}
