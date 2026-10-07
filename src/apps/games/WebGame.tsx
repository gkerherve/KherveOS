// A web game that runs on its own little Python server (see
// server/kherveos_server/games.py): the KherveOS server starts that server,
// then the game's page fills the window in an iframe.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ExternalLink, Gamepad2, LoaderCircle, RefreshCw, RotateCw, ServerCog, ServerOff, TriangleAlert,
} from 'lucide-react'
import { os, type WindowApi } from '@/os'
import { ApiError, api, useAuth, useServer } from '@/os/server'
import { ServerGate, Spinner } from '@/os/ui/ServerGate'
import { useWindows } from '@/os/windows'
import { useAppTools, waitUntil } from '@/os/ai/appTools'
import './games.css'

interface Started {
  id: string
  url: string
  /** False when something already answered on the game's port. */
  started: boolean
  /** True when KherveOS started (and so can restart) the game's server. */
  managed: boolean
}

interface Stopped {
  id: string
  stopped: boolean
  running: boolean
}

const OFFLINE = 'The KherveOS server is not reachable.'

/**
 * POST /api/games/<id>/start. Not api(): that reads every 503/504 as "the
 * KherveOS server is down", but this endpoint answers 503 (not installed) and
 * 504 (did not start) itself, with the reason and the game's log in `detail`.
 */
async function startGame(id: string): Promise<Started> {
  let res: Response
  try {
    res = await fetch(`/api/games/${encodeURIComponent(id)}/start`, { method: 'POST', credentials: 'same-origin' })
  } catch {
    useServer.getState().markOffline()
    throw new ApiError(0, OFFLINE)
  }
  const data = (await res.json().catch(() => null)) as { detail?: unknown } | null
  if (res.ok && data) return data as unknown as Started
  const detail = typeof data?.detail === 'string' ? data.detail : null
  if (detail === null && (res.status === 502 || res.status === 503 || res.status === 504)) {
    useServer.getState().markOffline() // a proxy (Vite, in dev) answering for a server that isn't there
    throw new ApiError(0, OFFLINE)
  }
  if (res.status === 401) useAuth.setState({ user: null })
  throw new ApiError(res.status, detail ?? `The KherveOS server answered ${res.status}.`)
}

/** What the AI tools need from the game's frame. */
interface FrameControl {
  reload(): void
  loading(): boolean
}

type Phase =
  | { kind: 'starting'; restart: boolean }
  | { kind: 'ready'; url: string; managed: boolean }
  | { kind: 'offline' }
  | { kind: 'signin' }
  | { kind: 'error'; status: number; message: string }

/** `game` is the id in the server's whitelist, which is also the app's id in the registry. */
export function WebGame({ game, win }: { game: string; win: WindowApi }) {
  const app = os.getApp(game)
  const name = app?.name ?? game
  const Icon = app?.icon ?? Gamepad2
  const [phase, setPhaseState] = useState<Phase>({ kind: 'starting', restart: false })
  const phaseRef = useRef(phase)
  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])
  const attempt = useRef(0)
  const frame = useRef<FrameControl | null>(null)

  /** Start the game's server (stopping ours first to restart it), then show the game. */
  const launch = useCallback(
    async (restart = false) => {
      const mine = ++attempt.current
      setPhase({ kind: 'starting', restart })
      try {
        if (restart) {
          const stop = await api<Stopped>(`/games/${encodeURIComponent(game)}/stop`, { method: 'POST' })
          if (!stop.stopped && stop.running) {
            os.notify({
              title: `${name}'s server was left running`,
              body: "KherveOS didn't start it, so it can't restart it. The game was reloaded instead.",
            })
          }
        }
        const r = await startGame(game)
        if (mine === attempt.current) setPhase({ kind: 'ready', url: r.url, managed: r.managed })
      } catch (err) {
        if (mine !== attempt.current) return
        const status = err instanceof ApiError ? err.status : -1
        const message = err instanceof Error ? err.message : String(err)
        setPhase(status === 0 ? { kind: 'offline' } : status === 401 ? { kind: 'signin' } : { kind: 'error', status, message })
      }
    },
    [game, name, setPhase],
  )
  const restart = useCallback(() => void launch(true), [launch])

  useEffect(() => {
    void launch()
  }, [launch])

  // The server is back (the shell polls it, or "Try again"): start the game.
  const serverStatus = useServer((s) => s.status)
  useEffect(() => {
    if (phase.kind === 'offline' && serverStatus === 'online') void launch()
  }, [phase.kind, serverStatus, launch])

  // ---- AI tools (get_status, restart, reload; specs in src/os/ai/manifests/games.ts)

  const status = () => {
    const p = phaseRef.current
    return {
      phase: p.kind,
      ...(p.kind === 'ready' && { url: p.url, managed_by_kherveos: p.managed, page_loading: frame.current?.loading() ?? false }),
      ...(p.kind === 'error' && { error: p.message.split('\n')[0] }),
      ...(p.kind === 'offline' && { note: 'The KherveOS server is not running: start it with "npm run server" in the KherveOS folder.' }),
      ...(p.kind === 'signin' && { note: 'The user must sign in to KherveOS first.' }),
    }
  }
  /** Waits (up to a minute) for the game to be shown or to fail. */
  const settled = async (signal?: AbortSignal) => {
    await waitUntil(() => phaseRef.current.kind !== 'starting', 60_000, signal)
    if (phaseRef.current.kind === 'ready') await waitUntil(() => !!frame.current && !frame.current.loading(), 25_000, signal)
    return status()
  }

  useAppTools(win, {
    get_status: async () => {
      let server: Record<string, unknown> | null = null
      try {
        const r = await api<{ games: { id: string; port: number; available: boolean; running: boolean; managed: boolean }[] }>('/games')
        const g = r.games.find((x) => x.id === game)
        if (g) server = { installed: g.available, running: g.running, started_by_kherveos: g.managed, port: g.port }
      } catch {
        // offline or signed out: the phase says so
      }
      return { game: name, ...status(), ...(server && { game_server: server }) }
    },
    restart: async (_a, ctx) => {
      if (!(await ctx.confirm(`restart ${name}'s game server`, 'Progress in the game that is not saved will be lost.'))) throw new Error('The user said no.')
      void launch(true)
      return settled(ctx.signal)
    },
    reload: async (_a, ctx) => {
      const p = phaseRef.current
      if (p.kind !== 'ready') {
        if (p.kind === 'starting') return settled(ctx.signal)
        void launch() // the error / offline screens: try again
        return settled(ctx.signal)
      }
      if (!frame.current) throw new Error(`${name} is not shown in its window yet. Try again in a moment.`)
      if (!(await ctx.confirm(`reload ${name}`, 'Progress in the game that is not saved will be lost.'))) throw new Error('The user said no.')
      frame.current.reload()
      return settled(ctx.signal)
    },
  })

  switch (phase.kind) {
    case 'starting':
      return <Starting name={name} icon={Icon} color={app?.color} restart={phase.restart} />
    case 'offline':
      return <Offline name={name} />
    case 'signin':
      return (
        <ServerGate app={name} icon={Icon}>
          <OnMount run={() => void launch()} label={`Starting ${name}…`} />
        </ServerGate>
      )
    case 'error':
      return <Failed name={name} status={phase.status} message={phase.message} onRetry={() => void launch()} />
    case 'ready':
      return <GameFrame key={phase.url} control={frame} win={win} name={name} icon={Icon} url={phase.url} managed={phase.managed} onRestart={restart} />
  }
}

// ------------------------------------------------------------------ the game

interface GameFrameProps {
  /** Filled in for the AI tools. */
  control: { current: FrameControl | null }
  win: WindowApi
  name: string
  icon: LucideIcon
  url: string
  managed: boolean
  onRestart: () => void
}

function GameFrame({ control, win, name, icon: Icon, url, managed, onRestart }: GameFrameProps) {
  const [frameKey, setFrameKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const focused = useWindows((s) => s.focusedId === win.id)
  const host = new URL(url).host
  // An https page may not show an http frame (mixed content).
  const mixed = window.location.protocol === 'https:' && url.startsWith('http:')

  const focusGame = useCallback(() => {
    const frame = frameRef.current
    if (frame && document.activeElement !== frame) frame.focus()
  }, [])
  const reload = useCallback(() => {
    setLoading(true)
    setFrameKey((k) => k + 1)
  }, [])
  const loadingRef = useRef(loading)
  loadingRef.current = loading
  useEffect(() => {
    control.current = {
      reload: () => {
        loadingRef.current = true // before the next render, for whoever waits on it
        reload()
      },
      loading: () => loadingRef.current,
    }
    return () => {
      control.current = null
    }
  }, [control, reload])

  const openReal = useCallback(() => {
    os.openInRealBrowser(url)
  }, [url])

  // Keys belong to the game: give it the keyboard whenever its window comes to the front.
  useEffect(() => {
    if (!focused) return
    const t = window.setTimeout(focusGame, 0)
    return () => window.clearTimeout(t)
  }, [focused, focusGame])

  // A page that never reports loading shouldn't stay covered.
  useEffect(() => {
    if (!loading) return
    const t = window.setTimeout(() => setLoading(false), 20_000)
    return () => window.clearTimeout(t)
  }, [loading, frameKey])

  const onLoad = () => {
    setLoading(false)
    const active = document.activeElement
    const idle = !active || active === document.body || rootRef.current?.contains(active)
    if (idle && useWindows.getState().focusedId === win.id) focusGame()
  }

  useEffect(() => {
    win.setMenus([
      {
        label: 'Game',
        items: [
          { label: 'Reload Game', icon: RotateCw, onClick: reload },
          { label: 'Open in Real Browser Tab', icon: ExternalLink, onClick: openReal },
          '-',
          { label: "Restart Game's Server", icon: ServerCog, onClick: onRestart },
        ],
      },
    ])
  }, [win, reload, openReal, onRestart])
  useEffect(() => () => win.setMenus(null), [win])

  return (
    <div className="k-app game-app" ref={rootRef}>
      <div className="game-bar">
        <span className="game-bar-name">
          <Icon size={13} /> {name}
        </span>
        <span className="game-bar-addr" title={url}>
          {host}
        </span>
        <button className="k-icon-btn" title="Reload the game" aria-label="Reload the game" onClick={reload}>
          <RotateCw size={14} />
        </button>
        <button className="k-icon-btn" title="Open in a real browser tab" aria-label="Open in a real browser tab" onClick={openReal}>
          <ExternalLink size={14} />
        </button>
        <button
          className="k-icon-btn"
          title={managed ? "Restart the game's server" : "Restart the game's server (KherveOS didn't start this one, so this only reloads)"}
          aria-label="Restart the game's server"
          onClick={onRestart}
        >
          <ServerCog size={14} />
        </button>
      </div>
      <div className="game-stage">
        {mixed ? (
          <div className="k-center">
            <div className="k-gate-card">
              <Icon size={32} color="var(--k-muted)" />
              <h2>{name} can't be shown here</h2>
              <p className="k-muted">
                KherveOS is open over https, and browsers don't show a plain-http game ({host}) inside an https page.
              </p>
              <button className="k-btn primary" onClick={openReal}>
                <ExternalLink size={14} /> Open in a real tab
              </button>
            </div>
          </div>
        ) : (
          <>
            <iframe
              key={frameKey}
              ref={frameRef}
              className="game-frame"
              src={url}
              title={name}
              allow="fullscreen; autoplay; gamepad; clipboard-write"
              onLoad={onLoad}
            />
            {loading && (
              <div className="game-veil">
                <Spinner label={`Loading ${name}…`} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------- other screens

function Starting({ name, icon: Icon, color, restart }: { name: string; icon: LucideIcon; color?: string; restart: boolean }) {
  return (
    <div className="k-center game-starting">
      <span className="game-badge" style={color ? { background: color } : undefined}>
        <Icon size={30} color="var(--k-accent-text)" />
      </span>
      <div className="game-starting-title">
        <LoaderCircle size={16} className="k-spin" />
        {restart ? `Restarting ${name}…` : `Starting ${name}…`}
      </div>
      <div className="k-muted game-small">{name} runs on a little server of its own; it takes a moment to wake up.</div>
    </div>
  )
}

function Offline({ name }: { name: string }) {
  const check = useServer((s) => s.check)
  const [busy, setBusy] = useState(false)
  const [stillDown, setStillDown] = useState(false)
  return (
    <div className="k-center">
      <div className="k-gate-card">
        <ServerOff size={32} color="var(--k-muted)" />
        <h2>The KherveOS server isn't running</h2>
        <p className="k-muted">
          {name} is started by the KherveOS server. In the <code>KherveOS</code> folder, run:
        </p>
        <pre className="k-code-block">npm run server</pre>
        <button
          className="k-btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const ok = await check() // once it answers, WebGame starts the game
            setBusy(false)
            setStillDown(!ok)
          }}
        >
          <RefreshCw size={14} className={busy ? 'k-spin' : undefined} /> Try again
        </button>
        {stillDown && <div className="k-muted game-small">Still no answer from the server.</div>}
      </div>
    </div>
  )
}

function Failed({ name, status, message, onRetry }: { name: string; status: number; message: string; onRetry: () => void }) {
  const [summary, ...log] = message.split('\n')
  const title = status === 503 ? `${name} can't be started` : status === 504 ? `${name} didn't start` : `${name} couldn't be opened`
  return (
    <div className="k-center">
      <div className="k-gate-card game-card">
        <TriangleAlert size={32} color="var(--k-warning)" />
        <h2>{title}</h2>
        <p className="k-muted">{summary}</p>
        {log.length > 0 && <pre className="k-code-block game-log">{log.join('\n')}</pre>}
        <button className="k-btn primary" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    </div>
  )
}

/** Runs `run` once when it first renders: here, once the user has signed in. */
function OnMount({ run, label }: { run: () => void; label: string }) {
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    run()
  })
  return <Spinner label={label} />
}
