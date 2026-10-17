// Kherve Grand Prix multiplayer: the connection to a race room on the
// KherveOS server (server/kherveos_server/grandprix.py), and the packing of
// car states. Every player's game drives its own car and sends it about
// twenty times a second; the host's game also drives the AI cars and sends
// them. Cars are named by their place in the full grid ("canonical" car c,
// team c >> 1, in the menu's team order), which every game maps to its own
// car index (its own car is always car 0).

import { DRIVERS, codeOf, type RaceCar, type PitState } from './f1Race.ts'
import { COMPOUND_LIST } from './f1Physics.ts'

export interface RoomPlayer {
  id: number
  name: string
  team: number
}

export interface RoomSettings {
  track?: string
  series?: string
  laps?: number
  difficulty?: string
  assists?: boolean
  damage?: boolean
  time?: string
  /** AI cars fill the grid (driven by the host's game). */
  ai?: boolean
}

export interface RoomState {
  code: string
  you: number
  host: number
  state: 'lobby' | 'racing'
  settings: RoomSettings
  players: RoomPlayer[]
}

/** One car on the grid: a player's, or the AI's (id 0). */
export interface GridCar {
  car: number
  id: number
  name: string
  human: boolean
}

export interface RaceStart {
  settings: RoomSettings
  seed: number
  lineup: GridCar[]
}

export interface OpenRoom {
  code: string
  host: string
  players: number
  state: string
  settings: RoomSettings
}

type Msg =
  | ({ t: 'room' } & RoomState)
  | ({ t: 'start' } & RaceStart)
  | { t: 'cars'; from: number; c: number[][] }
  | { t: 'left'; id: number }
  | { t: 'error'; text: string }

export interface NetHandlers {
  room(r: RoomState): void
  start(s: RaceStart): void
  cars(c: number[][]): void
  left(id: number): void
  error(text: string): void
  closed(why: string): void
}

/** The room's websocket: on this KherveOS server, through the page's own address (so a tablet that opened it can join). */
export class GPNet {
  private ws: WebSocket | null = null
  private h: NetHandlers
  private queue: string[] = []
  open = false

  constructor(h: NetHandlers) {
    this.h = h
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/gp/ws`)
      this.ws = ws
      ws.onopen = () => {
        this.open = true
        for (const q of this.queue) ws.send(q)
        this.queue = []
        resolve()
      }
      ws.onmessage = (e) => {
        let m: Msg
        try {
          m = JSON.parse(String(e.data)) as Msg
        } catch {
          return
        }
        if (m.t === 'room') this.h.room(m)
        else if (m.t === 'start') this.h.start(m)
        else if (m.t === 'cars') this.h.cars(Array.isArray(m.c) ? m.c : [])
        else if (m.t === 'left') this.h.left(m.id)
        else if (m.t === 'error') this.h.error(m.text)
      }
      ws.onclose = () => {
        const was = this.open
        this.open = false
        this.ws = null
        // closed before it opened: the server is not there (or is an old one without race rooms)
        const why = was ? 'The connection to the race room was lost. Try again.' : 'Could not reach the race rooms: is KherveOS running (npm run dev:lan) and up to date?'
        if (!was) reject(new Error(why))
        this.h.closed(why)
      }
      ws.onerror = () => {}
    })
  }

  send(m: object) {
    const s = JSON.stringify(m)
    if (this.ws && this.open) this.ws.send(s)
    else if (this.ws) this.queue.push(s)
  }

  close() {
    if (this.ws) {
      try {
        this.send({ t: 'leave' })
        this.ws.close()
      } catch {
        // closed already
      }
    }
    this.ws = null
    this.open = false
  }
}

/** The rooms open on this server. */
export async function openRooms(): Promise<OpenRoom[]> {
  const r = await fetch('/api/gp/rooms', { credentials: 'same-origin' })
  if (!r.ok)
    throw new Error(
      r.status === 404 ? 'This KherveOS server has no race rooms yet: restart KherveOS (quit and open it again).' : 'The KherveOS server does not answer.',
    )
  return ((await r.json()) as { rooms: OpenRoom[] }).rooms
}

export interface LanInfo {
  /** What the others type into their browser: http://<address>:<port>. */
  urls: string[]
  /** Other devices can reach this KherveOS (false: it only answers this computer; null: unknown). */
  reachable: boolean | null
}

/** The addresses other devices on the network open: from the page's own server, else from the KherveOS server. */
export async function lanAddresses(): Promise<LanInfo> {
  const port = location.port ? `:${location.port}` : ''
  try {
    const r = await fetch('/__kherveos/lan')
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      const j = (await r.json()) as { addresses: string[]; port: number; reachable: boolean }
      return { urls: j.addresses.map((a) => `${location.protocol}//${a}:${j.port}`), reachable: j.reachable }
    }
  } catch {
    // not the dev server: ask the KherveOS server
  }
  try {
    const r = await fetch('/api/gp/info', { credentials: 'same-origin' })
    if (!r.ok) return { urls: [], reachable: null }
    return { urls: ((await r.json()) as { addresses: string[] }).addresses.map((a) => `${location.protocol}//${a}${port}`), reachable: null }
  } catch {
    return { urls: [], reachable: null }
  }
}

// ---------------------------------------------------------------- car states

const PITS: PitState[] = ['none', 'in', 'stop', 'out', 'toGarage', 'garage', 'fromGarage']
const r2 = (v: number) => Math.round(v * 100) / 100
const r3 = (v: number) => Math.round(v * 1000) / 1000

/** A car's state as a short array: [car, x, y, z, h, speed, steer, rpm, gear, s, lat, dist, pit, tyre, finished]. */
export function packCar(canon: number, c: RaceCar): number[] {
  return [canon, r2(c.x), r2(c.y), r2(c.z), r3(c.h), r2(c.speed), r3(c.steer), Math.round(c.rpm), c.gear, r2(c.s), r2(c.lat), r2(c.dist), PITS.indexOf(c.pit), COMPOUND_LIST.indexOf(c.tyres.compound), c.finished ? 1 : 0]
}

export interface CarState {
  x: number
  y: number
  z: number
  h: number
  speed: number
  steer: number
  rpm: number
  gear: number
  s: number
  lat: number
  dist: number
  pit: PitState
  tyre: number
  finished: boolean
}

export function unpackCar(a: number[]): [number, CarState] | null {
  if (!Array.isArray(a) || a.length < 15 || !a.every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  return [
    a[0],
    { x: a[1], y: a[2], z: a[3], h: a[4], speed: a[5], steer: a[6], rpm: a[7], gear: a[8], s: a[9], lat: a[10], dist: a[11], pit: PITS[a[12]] ?? 'none', tyre: a[13], finished: a[14] === 1 },
  ]
}

/**
 * Where canonical car c (team c >> 1 in the menu's order) sits in this game's own cars:
 * its team moved to the front (setRaceSeries), and its own car first.
 */
export function localCar(c: number, mine: number): number {
  const myTeam = mine >> 1
  const ct = c >> 1
  if (ct === myTeam) return (c & 1) ^ (mine & 1)
  return 2 * (ct < myTeam ? ct + 1 : ct) + (c & 1)
}

/**
 * This game's view of a race with others: which of its cars each grid car is, who drives each
 * (names), which cars other games drive (the other players; on a guest's game the AI too, which the
 * host drives), which cars nobody drives, and the starting grid (players in the order they joined,
 * then the AI).
 */
export function multiLineup(start: RaceStart, you: number, host: boolean) {
  const me = start.lineup.find((c) => c.id === you)!
  const toCanon: number[] = []
  const toLocal = new Map<number, number>()
  for (let c = 0; c < 12; c++) {
    const l = localCar(c, me.car)
    toCanon[l] = c
    toLocal.set(c, l)
  }
  const names: ({ name: string; code: string; num: number } | null)[] = Array(12).fill(null)
  const remote: number[] = []
  const out: number[] = []
  const players = new Map<number, number>()
  for (let c = 0; c < 12; c++) {
    const l = toLocal.get(c)!
    const g = start.lineup.find((x) => x.car === c)
    if (!g) {
      out.push(l)
      continue
    }
    if (g.human) {
      players.set(g.id, c)
      names[l] = { name: g.name, code: codeOf(g.name), num: DRIVERS[c].num }
      if (g.id !== you) remote.push(l)
    } else {
      // car 0's usual driver is "You": the AI in it gets a name of its own
      names[l] = c === 0 ? { name: 'Lucas Moreau', code: 'MOR', num: 7 } : { name: DRIVERS[c].name, code: DRIVERS[c].code, num: DRIVERS[c].num }
      if (!host) remote.push(l)
    }
  }
  const grid = [...start.lineup]
    .sort((a, b) => (a.human === b.human ? (a.human ? a.id - b.id : a.car - b.car) : a.human ? -1 : 1))
    .map((g) => toLocal.get(g.car)!)
  return { team: me.car >> 1, toCanon, toLocal, names, remote, out, players, grid }
}
