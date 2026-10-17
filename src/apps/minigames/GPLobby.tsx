// Kherve Grand Prix — the multiplayer lobby: host a race room or join one
// (from the list of rooms open on this KherveOS server, or by its code), the
// players in the room and their cars, the host's race settings, and the
// address other devices (a tablet, a phone, another computer) open to join.

import { useEffect, useState } from 'react'
import { TRACKS } from './f1Track'
import { teamsOf } from './f1Race'
import type { Series } from './f1Physics'
import { lanAddresses, openRooms, type LanInfo, type OpenRoom, type RoomState } from './f1Net'

export interface LobbyProps {
  room: RoomState | null
  error: string
  busy: boolean
  name: string
  series: Series
  team: number
  track: string
  laps: number
  ai: boolean
  onName(v: string): void
  onSeries(v: Series): void
  onTeam(v: number): void
  onTrack(v: string): void
  onLaps(v: number): void
  onAi(v: boolean): void
  onHost(): void
  onJoin(code: string): void
  onStart(): void
  onLeave(): void
  onClose(): void
}

const trackName = (id?: string) => TRACKS.find((t) => t.id === id)?.name ?? id ?? ''

export function Lobby(p: LobbyProps) {
  const [rooms, setRooms] = useState<OpenRoom[]>([])
  const [listError, setListError] = useState('')
  const [code, setCode] = useState('')
  const [lan, setLan] = useState<LanInfo>({ urls: [], reachable: null })
  const inRoom = !!p.room
  const host = !!p.room && p.room.host === p.room.you
  // the open rooms, refreshed while choosing
  useEffect(() => {
    if (inRoom) return
    let alive = true
    const load = () =>
      openRooms()
        .then((r) => {
          if (!alive) return
          setRooms(r)
          setListError('')
        })
        .catch((e: unknown) => alive && setListError(e instanceof Error ? e.message : String(e)))
    void load()
    const id = setInterval(load, 2500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [inRoom])
  useEffect(() => {
    void lanAddresses().then(setLan)
  }, [])
  const series: Series = (p.room?.settings.series as Series) ?? p.series
  const teams = teamsOf(series === 'classic' ? 'classic' : 'modern')

  return (
    <div className="gp-wrap">
      <div className="gp-card gp-wide gp-lobby">
        <div className="gp-title gp-small">Multiplayer</div>
        {p.error && <p className="gp-net-error">{p.error}</p>}

        {!inRoom && (
          <>
            <p className="gp-note">
              Race against friends on other computers, tablets or phones. Everyone opens this KherveOS — the same address — signs in, opens Kherve Grand Prix and
              joins the room.
            </p>
            <TellFriend lan={lan} code={null} />
            <label className="gp-lobby-name">
              <span>Your name</span>
              <input className="k-input" value={p.name} maxLength={24} onChange={(e) => p.onName(e.target.value)} />
            </label>
            <div className="gp-lobby-cols">
              <div>
                <h4>Join a room</h4>
                {listError ? (
                  <p className="gp-note">{listError}</p>
                ) : rooms.length === 0 ? (
                  <p className="gp-note">No room is open yet.</p>
                ) : (
                  <ul className="gp-rooms">
                    {rooms.map((r) => (
                      <li key={r.code}>
                        <span>
                          <b>{r.code}</b> {r.host} · {r.players} player{r.players > 1 ? 's' : ''}
                          <small>
                            {trackName(r.settings.track)} · {r.settings.series === 'classic' ? 'Classics' : 'Grand Prix'} · {r.settings.laps ?? '?'} laps
                          </small>
                        </span>
                        <button className="k-btn" disabled={p.busy || r.state !== 'lobby'} onClick={() => p.onJoin(r.code)}>
                          {r.state === 'lobby' ? 'Join' : 'Racing'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="gp-codejoin">
                  <input className="k-input" inputMode="numeric" placeholder="Room code" value={code} maxLength={4} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  <button className="k-btn" disabled={p.busy || code.length !== 4} onClick={() => p.onJoin(code)}>
                    Join
                  </button>
                </div>
              </div>
              <div>
                <h4>Host a race</h4>
                <p className="gp-note">You choose the circuit and start the race; your game drives the AI cars for everyone.</p>
                <button className="k-btn gp-go" disabled={p.busy} onClick={p.onHost}>
                  Host a race
                </button>
              </div>
            </div>
            <div className="gp-buttons">
              <button className="k-btn" onClick={p.onClose}>
                Back
              </button>
            </div>
          </>
        )}

        {p.room && (
          <>
            <div className="gp-roomcode">
              Room <b>{p.room.code}</b>
              {p.room.state === 'racing' && <span className="gp-racing">racing</span>}
            </div>
            <TellFriend lan={lan} code={p.room.code} />
            <ul className="gp-players">
              {p.room.players.map((pl) => (
                <li key={pl.id} className={pl.id === p.room!.you ? 'gp-me' : ''}>
                  <i style={{ background: teams[pl.team]?.color2 }} />
                  <span>{pl.name}</span>
                  <small>{teams[pl.team]?.name}</small>
                  {pl.id === p.room!.host && <em>host</em>}
                </li>
              ))}
            </ul>
            <div className="gp-carhead">Your car</div>
            <div className="gp-cars">
              {teams.map((t, k) => (
                <button key={t.name} className={`gp-carpick ${p.team === k ? 'gp-on' : ''}`} onClick={() => p.onTeam(k)}>
                  <i className="gp-livery" style={{ background: `linear-gradient(135deg, ${t.color} 0 55%, ${t.color2} 55% 72%, ${t.color} 72%)` }} />
                  <b>{t.name}</b>
                </button>
              ))}
            </div>
            {host ? (
              <div className="gp-options gp-lobby-settings">
                <label>
                  <span>Cars</span>
                  <div className="gp-seg">
                    {(['modern', 'classic'] as Series[]).map((s) => (
                      <button key={s} className={p.series === s ? 'gp-on' : ''} onClick={() => p.onSeries(s)}>
                        {s === 'classic' ? 'Classics' : 'Grand Prix'}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  <span>Circuit</span>
                  <div className="gp-seg">
                    {TRACKS.map((t) => (
                      <button key={t.id} className={p.track === t.id ? 'gp-on' : ''} onClick={() => p.onTrack(t.id)}>
                        {t.name}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  <span>Laps</span>
                  <div className="gp-seg">
                    {[2, 3, 5, 8].map((n) => (
                      <button key={n} className={p.laps === n ? 'gp-on' : ''} onClick={() => p.onLaps(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  <span>AI rivals</span>
                  <div className="gp-seg">
                    {[true, false].map((v) => (
                      <button key={String(v)} className={p.ai === v ? 'gp-on' : ''} onClick={() => p.onAi(v)}>
                        {v ? 'Fill the grid' : 'Players only'}
                      </button>
                    ))}
                  </div>
                </label>
              </div>
            ) : (
              <p className="gp-note">
                {trackName(p.room.settings.track)} · {p.room.settings.series === 'classic' ? 'Classics' : 'Grand Prix cars'} · {p.room.settings.laps ?? '?'} laps ·{' '}
                {p.room.settings.ai === false ? 'players only' : 'with AI rivals'}
              </p>
            )}
            <div className="gp-buttons">
              {host ? (
                <button className="k-btn gp-go" disabled={p.room.state !== 'lobby'} onClick={p.onStart}>
                  Start the race
                </button>
              ) : (
                <span className="gp-wait">{p.room.state === 'racing' ? 'The race is on…' : 'Waiting for the host to start…'}</span>
              )}
              <button className="k-btn" onClick={p.onLeave}>
                Leave the room
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** What to tell a friend: the address to open (this computer's IP), then the room to join. */
function TellFriend({ lan, code }: { lan: LanInfo; code: string | null }) {
  const url = lan.urls[0]
  return (
    <div className="gp-tell">
      <div className="gp-tell-head">Tell your friend</div>
      <ol>
        <li>
          Be on the same Wi-Fi, and open this address in the browser (Chrome on Android works):
          {url ? <b className="gp-tell-url">{url}</b> : <b className="gp-tell-url">…finding this computer's address…</b>}
          {lan.urls.length > 1 && <small>or {lan.urls.slice(1).join(' · ')}</small>}
        </li>
        <li>Sign in to KherveOS, open Kherve Grand Prix, tap Multiplayer.</li>
        <li>{code ? <>Join room <b className="gp-tell-code">{code}</b></> : 'Join the room you host (its code shows here once you host).'}</li>
      </ol>
      {lan.reachable === false && (
        <p className="gp-tell-warn">
          Right now KherveOS only answers this computer, so that address will not open on your friend's device. To let friends in: quit the KherveOS app, then in a Terminal, in the KherveOS folder, run <code>npm run dev:lan</code>, then open http://localhost:5173 in your browser.
        </p>
      )}
    </div>
  )
}
