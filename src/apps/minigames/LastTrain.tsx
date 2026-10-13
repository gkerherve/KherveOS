// Last Train: a first-person zombie shooter in a subway station (three.js).
// Clear the wave, board the train, ride to the next station, survive a harder
// wave. The game is in lastTrainEngine.ts (world: lastTrainWorld.ts), loaded
// on demand with three.js; this is the window: canvas, pointer lock, HUD,
// cards, menus, high scores and the AI tools (get_state, new_game, play).

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleHelp, Pause, Play, RotateCcw, VolumeX } from 'lucide-react'
import type { AppProps } from '@/os'
import { useWindows } from '@/os/windows'
import { useAppTools } from '@/os/ai/appTools'
import { releaseAudio, retainAudio, setSoundOn, unlockAudio, useSound } from './sound'
import { addScore, DEFAULT_NAME, getScores, lastName } from './scores'
import { useScores } from './GameShell'
import { loadCheckpoint, saveCheckpoint } from './checkpoints'
import { gameCode } from './fpsKeys'
import type { GameResult, Hud, LastTrainEngine, LTSave } from './lastTrainEngine'
import './lastTrain.css'

const ID = 'lasttrain'
const NAME = 'Last Train'
type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'over'

const fmt = (n: number) => n.toLocaleString('en-US')

const CONTROLS: [string, string][] = [
  ['Mouse', 'Look · left click to shoot · right click to aim'],
  ['W A S D', 'Move · Shift sprint · Space jump'],
  ['1 2 3 · Q · wheel', 'Pistol, rifle, shotgun'],
  ['R', 'Reload'],
  ['Esc', 'Pause'],
]

export default function LastTrain({ win }: AppProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const crossRef = useRef<HTMLDivElement>(null)
  const hitRef = useRef<HTMLDivElement>(null)
  const hurtRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<LastTrainEngine | null>(null)
  const [phase, setPhaseState] = useState<Phase>('loading')
  const phaseRef = useRef<Phase>('loading')
  const [hud, setHud] = useState<Hud | null>(null)
  const [result, setResult] = useState<(GameResult & { rank: number }) | null>(null)
  const [error, setError] = useState('')
  const scores = useScores(ID)
  const [save, setSave] = useState<LTSave | null>(() => loadCheckpoint<LTSave>(ID))
  const soundOn = useSound((s) => s.on)
  const focused = useWindows((s) => s.focusedId === win.id)

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  const locked = () => document.pointerLockElement === canvasRef.current && !!canvasRef.current

  /** Was the mouse captured when this game started? Then losing it (Esc) pauses. */
  const wasLocked = useRef(false)

  /**
   * Play: starts at once, then asks for the mouse (pointer lock). If the
   * browser refuses it, the game still plays: look by moving the mouse over the view.
   */
  const engage = useCallback((e?: { stopPropagation(): void }) => {
    e?.stopPropagation()
    const c = canvasRef.current
    if (!c || !engineRef.current) return
    unlockAudio()
    const p = phaseRef.current
    if (p === 'over' || p === 'loading') return
    if (p !== 'playing') setPhase('playing')
    rootRef.current?.focus({ preventScroll: true })
    if (locked()) return
    try {
      const req = c.requestPointerLock() as unknown as Promise<void> | undefined
      req?.catch?.(() => {})
    } catch {
      // refused: free-mouse mode
    }
  }, [setPhase])

  const pause = useCallback(() => {
    if (phaseRef.current === 'playing') setPhase('paused')
    engineRef.current?.releaseAll()
    if (locked()) document.exitPointerLock()
  }, [setPhase])

  const newGame = useCallback(() => {
    const e = engineRef.current
    if (!e) return
    e.reset()
    setResult(null)
    setPhase('ready')
    if (locked()) document.exitPointerLock()
  }, [setPhase])

  /** Pick up from the last checkpoint (the click is the gesture that takes the mouse). */
  const continueGame = useCallback(
    (e?: { stopPropagation(): void }) => {
      e?.stopPropagation()
      const eng = engineRef.current
      if (!eng || !save) return
      eng.continueFrom(save)
      setResult(null)
      setPhase('ready')
      engage()
    },
    [save, setPhase, engage],
  )

  // ---- the engine (three.js loads with it)

  useEffect(() => {
    let alive = true
    let raf = 0
    let engine: LastTrainEngine | null = null
    let ro: ResizeObserver | null = null
    retainAudio()
    void Promise.all([import('./lastTrainEngine'), import('./rkModels').then((m) => m.loadModels(['zombie']).catch(() => {}))])
      .then(([{ LastTrainEngine }]) => {
        if (!alive || !canvasRef.current) return
        engine = new LastTrainEngine(canvasRef.current, (r) => {
          const name = lastName() || DEFAULT_NAME
          const rank = addScore(ID, { name, score: r.score, summary: `Wave ${r.wave} · ${r.kills} kills`, date: Date.now() })
          setResult({ ...r, rank })
          setPhase('over')
          if (document.pointerLockElement) document.exitPointerLock()
        })
        engineRef.current = engine
        engine.onCheckpoint = (cp) => {
          saveCheckpoint(ID, cp)
          setSave(cp)
        }
        engine.bindHud({ crosshair: crossRef.current, hit: hitRef.current, hurt: hurtRef.current })
        const fit = () => {
          const el = rootRef.current
          if (el && engine) engine.resize(el.clientWidth, el.clientHeight, window.devicePixelRatio || 1)
        }
        ro = new ResizeObserver(fit)
        if (rootRef.current) ro.observe(rootRef.current)
        fit()
        setPhase('ready')
        let last = performance.now()
        let lastStill = 0
        let lastHud = 0
        const loop = (now: number) => {
          raf = requestAnimationFrame(loop)
          const dt = (now - last) / 1000
          last = now
          const p = phaseRef.current
          if (p === 'ready') engine!.frame(dt, 'attract')
          else if (p === 'playing') engine!.frame(dt, 'playing')
          else if (now - lastStill > 250) {
            // paused or over: the scene stays drawn, a few times a second is plenty
            lastStill = now
            engine!.frame(0, 'still')
          }
          if (now - lastHud > 90) {
            lastHud = now
            setHud(engine!.snapshot())
          }
        }
        raf = requestAnimationFrame(loop)
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro?.disconnect()
      if (document.pointerLockElement === canvasRef.current) document.exitPointerLock()
      engine?.dispose()
      engineRef.current = null
      releaseAudio()
    }
  }, [setPhase])

  // ---- pointer lock and input: only while the mouse is captured

  useEffect(() => {
    const playing = () => phaseRef.current === 'playing'
    /** Without pointer lock, the mouse only counts over the 3D view. */
    const inView = (e: Event) => locked() || (e.target instanceof Node && !!canvasRef.current?.contains(e.target))
    const onLock = () => {
      if (locked()) {
        wasLocked.current = true
        if (phaseRef.current === 'ready' || phaseRef.current === 'paused') setPhase('playing')
      } else if (wasLocked.current) {
        wasLocked.current = false
        if (playing()) {
          engineRef.current?.releaseAll()
          setPhase('paused')
        }
      }
    }
    const onMove = (e: MouseEvent) => playing() && inView(e) && engineRef.current?.look(e.movementX, e.movementY)
    const onDown = (e: MouseEvent) => {
      if (!playing() || !inView(e)) return
      e.preventDefault()
      engineRef.current?.mouseDown(e.button)
    }
    const onUp = (e: MouseEvent) => playing() && engineRef.current?.mouseUp(e.button)
    const onWheel = (e: WheelEvent) => playing() && inView(e) && engineRef.current?.wheel(e.deltaY)
    const onKey = (e: KeyboardEvent) => {
      // ours when the mouse is captured, our window is in front, or the focus is inside it
      const mine = locked() || useWindows.getState().focusedId === win.id || !!rootRef.current?.contains(document.activeElement)
      if (!playing() || !mine) return
      if (e.metaKey || e.ctrlKey) return
      const code = gameCode(e)
      if (!code) return
      e.stopPropagation()
      if (code === 'Escape' && !locked()) {
        if (e.type === 'keydown') {
          engineRef.current?.releaseAll()
          setPhase('paused')
        }
        return
      }
      e.preventDefault()
      if (e.type === 'keydown') {
        if (!e.repeat) engineRef.current?.keyDown(code)
      } else engineRef.current?.keyUp(code)
    }
    document.addEventListener('pointerlockchange', onLock)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('mouseup', onUp)
    document.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      document.removeEventListener('pointerlockchange', onLock)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }, [setPhase, win.id])

  // pause when the window goes to the back or the tab is hidden
  useEffect(() => {
    if (!focused) pause()
  }, [focused, pause])
  useEffect(() => {
    const onHide = () => document.hidden && pause()
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [pause])

  // ---- menus

  useEffect(() => {
    win.setMenus([
      {
        label: 'Game',
        items: [
          { label: 'New Game', icon: RotateCcw, onClick: newGame },
          { label: phase === 'playing' ? 'Pause' : 'Resume', icon: phase === 'playing' ? Pause : Play, disabled: phase !== 'playing' && phase !== 'paused', onClick: () => (phase === 'playing' ? pause() : engage()) },
          '-',
          { label: 'Sound', icon: VolumeX, checked: soundOn, onClick: () => setSoundOn(!useSound.getState().on) },
        ],
      },
      { label: 'Help', items: [{ label: `How to Play ${NAME}`, icon: CircleHelp, onClick: () => pause() }] },
    ])
  }, [win, phase, soundOn, newGame, pause, engage])

  // ---- AI tools (specs in src/os/ai/manifests/games.ts)

  useAppTools(win, {
    get_state: async () => {
      const h = engineRef.current?.snapshot()
      const list = getScores(ID)
      const p = phaseRef.current
      return {
        phase: p === 'loading' ? 'ready' : p,
        score: h?.score ?? 0,
        best: Math.max(list[0]?.score ?? 0, h?.score ?? 0),
        ...(h && {
          wave: h.wave,
          station: h.station,
          stage: h.stage,
          health: h.health,
          weapon: h.weapon,
          ammo: h.reserve < 0 ? `${h.mag}/endless` : `${h.mag}/${h.reserve}`,
          enemies_left: h.left,
          kills: h.kills,
        }),
        high_scores: list.slice(0, 5).map((s) => ({ name: s.name, score: s.score, summary: s.summary })),
      }
    },
    new_game: async (a, ctx) => {
      const e = engineRef.current
      if (!e) throw new Error(`${NAME} is still loading.`)
      const p = phaseRef.current
      if ((p === 'playing' || p === 'paused') && e.score > 0) {
        pause()
        if (!(await ctx.confirm(`start a new game of ${NAME}`, `The game in progress (score ${e.score}) will be lost.`)))
          throw new Error('The user kept the game in progress.')
      }
      newGame()
      if (a.start === true) useWindows.getState().focus(win.id)
      return { phase: phaseRef.current, note: 'The player clicks the window to take the mouse and play.' }
    },
    play: async (a) => {
      const action = String(a.action ?? '')
      const p = phaseRef.current
      if (action === 'pause') {
        if (p !== 'playing') return { phase: p, note: 'Not playing, nothing to pause.' }
        pause()
        return { phase: phaseRef.current }
      }
      if (action !== 'start' && action !== 'resume') throw new Error('"action" must be "start", "pause" or "resume".')
      if (p === 'over') throw new Error(`The game is over (score ${engineRef.current?.score ?? 0}). Call ${ID}_new_game to play again.`)
      useWindows.getState().focus(win.id)
      return { phase: p, note: 'The window is in front. A first-person game needs the mouse: the player clicks the window to start or resume.' }
    },
  })

  // ---- the page

  const best = scores[0]?.score ?? 0
  const lowAmmo = hud && hud.mag <= Math.ceil((hud.slot === 2 ? 6 : hud.slot === 1 ? 30 : 12) * 0.25) && !hud.reloading
  const showHud = phase === 'playing' || phase === 'paused'

  return (
    <div ref={rootRef} className="lt-app" tabIndex={-1} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="lt-canvas" onClick={() => engage()} />

      <div className={`lt-hud${showHud ? '' : ' lt-hidden'}`}>
        <div ref={hurtRef} className="lt-hurt" />
        <div ref={crossRef} className="lt-cross">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div ref={hitRef} className="lt-hit">
          <i />
          <i />
          <i />
          <i />
        </div>
        {hud && (
          <>
            <div className="lt-top">
              <span>
                Wave <b>{hud.wave}</b>
              </span>
              <span>
                Score <b>{fmt(hud.score)}</b>
              </span>
              {hud.stage === 'fight' && (
                <span>
                  Left <b>{hud.left}</b>
                </span>
              )}
            </div>
            {hud.message && (
              <div className="lt-message" key={hud.message + hud.sub}>
                <div className="lt-message-main">{hud.message}</div>
                {hud.sub && <div className="lt-message-sub">{hud.sub}</div>}
              </div>
            )}
            <div className="lt-health">
              <div className="lt-station" style={{ borderColor: hud.stationColor }}>
                {hud.station}
              </div>
              <div className="lt-bar">
                <div className={`lt-bar-fill${hud.health < 35 ? ' lt-low' : ''}`} style={{ width: `${hud.health}%` }} />
              </div>
              <div className="lt-hp">
                <b>{hud.health}</b> HP
              </div>
            </div>
            <div className="lt-ammo">
              <div className="lt-weapon">{hud.weapon}</div>
              <div className="lt-rounds">
                <b className={lowAmmo ? 'lt-low-text' : ''}>{hud.mag}</b>
                <span>/ {hud.reserve < 0 ? '∞' : hud.reserve}</span>
              </div>
              <div className="lt-slots">
                {['Pistol', 'Rifle', 'Shotgun'].map((n, i) => (
                  <span key={n} className={i === hud.slot ? 'lt-on' : ''}>
                    {i + 1} {n}
                  </span>
                ))}
              </div>
              {hud.reloading ? <div className="lt-hint">Reloading…</div> : lowAmmo && <div className="lt-hint">R to reload</div>}
            </div>
          </>
        )}
      </div>

      {phase === 'loading' && (
        <div className="lt-card-wrap">
          <div className="lt-card">{error ? <p>Could not start the game: {error}</p> : <p>Building the station…</p>}</div>
        </div>
      )}
      {(phase === 'ready' || phase === 'paused') && (
        <div className="lt-card-wrap" onClick={engage}>
          <div className="lt-card">
            {phase === 'ready' ? (
              <>
                <div className="lt-title">Last Train</div>
                <p className="lt-tag">The station is overrun. Clear each wave, board the train, and ride it to the next stop — if you can.</p>
              </>
            ) : (
              <div className="lt-title lt-small">Paused</div>
            )}
            <table className="lt-keys">
              <tbody>
                {CONTROLS.map(([k, v]) => (
                  <tr key={k}>
                    <th>{k}</th>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {phase === 'ready' && save ? (
              <div className="lt-buttons">
                <button className="k-btn lt-go" onClick={continueGame}>
                  Continue — wave {save.wave}, {save.stationName}
                </button>
                <button className="k-btn" onClick={engage}>
                  New game
                </button>
              </div>
            ) : (
              <button className="k-btn lt-go" onClick={engage}>
                {phase === 'ready' ? 'Click to play' : 'Click to resume'}
              </button>
            )}
            {phase === 'ready' && best > 0 && <p className="lt-best">Best: {fmt(best)}</p>}
          </div>
        </div>
      )}
      {phase === 'over' && result && (
        <div className="lt-card-wrap lt-dead">
          <div className="lt-card">
            <div className="lt-title lt-small">You didn't make the train</div>
            <div className="lt-result">
              <div>
                <b>{fmt(result.score)}</b>
                <span>score</span>
              </div>
              <div>
                <b>{result.wave}</b>
                <span>wave</span>
              </div>
              <div>
                <b>{result.kills}</b>
                <span>kills</span>
              </div>
            </div>
            {scores.length > 0 && (
              <ol className="lt-scores">
                {scores.slice(0, 5).map((s, i) => (
                  <li key={s.date + ':' + i} className={i === result.rank ? 'lt-on' : ''}>
                    <span>{s.name}</span>
                    <span>{s.summary}</span>
                    <b>{fmt(s.score)}</b>
                  </li>
                ))}
              </ol>
            )}
            <div className="lt-buttons">
              {save && (
                <button className="k-btn lt-go" onClick={continueGame}>
                  Continue — wave {save.wave}, {save.stationName}
                </button>
              )}
              <button className={save ? 'k-btn' : 'k-btn lt-go'} onClick={newGame}>
                {save ? 'New game' : 'Play again'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
