// Rune Keep: a fast first-person shooter in the style of the 1996 classics,
// built fresh: three levels of stone keeps, lava and runes, eight weapons and
// six monsters. The game is in rkEngine.ts (levels rkMaps.ts / rkLevel.ts,
// models rkActors.ts), loaded on demand with three.js; this is the window:
// canvas, mouse capture, the status bar, cards, menus, scores, AI tools.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleHelp, Pause, Play, RotateCcw, VolumeX } from 'lucide-react'
import type { AppProps } from '@/os'
import { useWindows } from '@/os/windows'
import { useAppTools } from '@/os/ai/appTools'
import { releaseAudio, retainAudio, setSoundOn, unlockAudio, useSound } from './sound'
import { addScore, DEFAULT_NAME, getScores, lastName } from './scores'
import { useScores } from './GameShell'
import { clearCheckpoint, loadCheckpoint, saveCheckpoint } from './checkpoints'
import { gameCode } from './fpsKeys'
import type { RKHud, RKResult, RKSave, RuneKeepEngine } from './rkEngine'
import './runeKeep.css'

const ID = 'runekeep'
const NAME = 'Rune Keep'
type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'over'

const fmt = (n: number) => n.toLocaleString('en-US')
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const CONTROLS: [string, string][] = [
  ['Mouse', 'Look · left click to fire'],
  ['W A S D', 'Move · Space jump · Shift walk'],
  ['1 – 8 · Q · wheel', 'Weapons'],
  ['Esc', 'Pause'],
]
const SLOT_NAMES = ['Axe', 'SG', 'SSG', 'NG', 'SNG', 'GL', 'RL', 'LG']
const ORDER = ['axe', 'shotgun', 'shotgun2', 'nailgun', 'supernail', 'grenadel', 'rocketl', 'thunder'] as const

export default function RuneKeep({ win }: AppProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hurtRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLDivElement>(null)
  const tintRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<RuneKeepEngine | null>(null)
  const [phase, setPhaseState] = useState<Phase>('loading')
  const phaseRef = useRef<Phase>('loading')
  const [hud, setHud] = useState<RKHud | null>(null)
  const [result, setResult] = useState<(RKResult & { rank: number }) | null>(null)
  const [error, setError] = useState('')
  const scores = useScores(ID)
  const [save, setSave] = useState<RKSave | null>(() => loadCheckpoint<RKSave>(ID))
  const soundOn = useSound((s) => s.on)
  const focused = useWindows((s) => s.focusedId === win.id)
  const wasLocked = useRef(false)

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  const locked = () => !!canvasRef.current && document.pointerLockElement === canvasRef.current

  /** Play: starts at once, then asks for the mouse (if refused, look by moving over the view). */
  const engage = useCallback((e?: { stopPropagation(): void }) => {
    e?.stopPropagation()
    const c = canvasRef.current
    const eng = engineRef.current
    if (!c || !eng) return
    unlockAudio()
    const p = phaseRef.current
    if (p === 'over' || p === 'loading') return
    if (eng.stage === 'intermission') {
      eng.advance()
      if (phaseRef.current === 'over') return
    }
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
    e.newGame()
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

  // ---- the engine

  useEffect(() => {
    let alive = true
    let raf = 0
    let engine: RuneKeepEngine | null = null
    let ro: ResizeObserver | null = null
    retainAudio()
    void Promise.all([import('./rkEngine'), import('./rkModels').then((m) => m.loadModels(['grunt', 'knight', 'brute', 'ravager', 'hound', 'wraith']).catch(() => {}))])
      .then(([{ RuneKeepEngine }]) => {
        if (!alive || !canvasRef.current) return
        engine = new RuneKeepEngine(canvasRef.current, (r) => {
          const name = lastName() || DEFAULT_NAME
          const summary = r.won ? `Escaped · ${r.kills} kills` : `Level ${r.levels + 1} · ${r.kills} kills`
          const rank = addScore(ID, { name, score: r.score, summary, date: Date.now() })
          setResult({ ...r, rank })
          if (r.won) {
            clearCheckpoint(ID)
            setSave(null)
          }
          setPhase('over')
          if (document.pointerLockElement) document.exitPointerLock()
        })
        engineRef.current = engine
        // in dev the console can reach the game (kherveos.runeKeep.pos.set(…))
        if (import.meta.env.DEV) Object.assign((window as unknown as { kherveos: object }).kherveos ?? {}, { runeKeep: engine })
        engine.onCheckpoint = (cp) => {
          saveCheckpoint(ID, cp)
          setSave(cp)
        }
        engine.bindHud({ hurt: hurtRef.current, flash: flashRef.current, tint: tintRef.current })
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
          else if (p === 'playing') {
            engine!.frame(dt, 'playing')
            if (engine!.stage === 'intermission' && locked()) document.exitPointerLock()
          } else if (now - lastStill > 250) {
            lastStill = now
            engine!.frame(0, 'still')
          }
          if (now - lastHud > 80) {
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

  // ---- input

  useEffect(() => {
    const playing = () => phaseRef.current === 'playing' && engineRef.current?.stage !== 'intermission'
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
    const onUp = (e: MouseEvent) => engineRef.current?.mouseUp(e.button)
    const onWheel = (e: WheelEvent) => playing() && inView(e) && engineRef.current?.wheel(e.deltaY)
    const onKey = (e: KeyboardEvent) => {
      // ours when the mouse is captured, our window is in front, or the focus is inside it
      const mine = locked() || useWindows.getState().focusedId === win.id || !!rootRef.current?.contains(document.activeElement)
      if (phaseRef.current !== 'playing' || !mine) return
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
        if (engineRef.current?.stage === 'intermission' && (code === 'Space' || code === 'Enter')) engage()
        else if (!e.repeat) engineRef.current?.keyDown(code)
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
  }, [setPhase, engage, win.id])

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
          level: `${h.levelIndex + 1}/${h.levels} ${h.level}`,
          stage: h.stage,
          health: h.health,
          armor: h.armor,
          weapon: h.weaponName,
          ammo: h.ammoAll,
          weapons: h.owned,
          keys: h.keys,
          kills: `${h.kills}/${h.monsters}`,
          secrets: `${h.secrets}/${h.secretsTotal}`,
          time: clock(h.time),
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
      return { phase: phaseRef.current, note: 'The player clicks the window to play.' }
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
      if (p === 'over') throw new Error(`The game is over. Call ${ID}_new_game to play again.`)
      useWindows.getState().focus(win.id)
      return { phase: p, note: 'The window is in front; the player clicks it to start or resume (a first-person game needs the mouse).' }
    },
  })

  // ---- the page

  const best = scores[0]?.score ?? 0
  const showHud = (phase === 'playing' || phase === 'paused') && hud && hud.stage !== 'intermission'
  const inter = phase !== 'over' && hud?.stage === 'intermission'

  return (
    <div ref={rootRef} className="rk-app" tabIndex={-1} onContextMenu={(e) => e.preventDefault()}>
      <canvas ref={canvasRef} className="rk-canvas" onClick={() => engage()} />
      <div ref={tintRef} className="rk-tint" />
      <div ref={hurtRef} className="rk-hurt" />
      <div ref={flashRef} className="rk-flash" />

      {showHud && hud && (
        <div className="rk-hud">
          <div className="rk-cross" />
          <div className="rk-log">
            {hud.log.map((l, i) => (
              <div key={i + l}>{l}</div>
            ))}
          </div>
          {hud.center && <div className="rk-center" key={hud.center}>{hud.center}</div>}
          <div className="rk-bar">
            <div className="rk-inv">
              {ORDER.map((id, i) => (
                <span key={id} className={`${hud.owned.includes(id) ? 'rk-have' : ''} ${hud.weapon === id ? 'rk-cur' : ''}`}>
                  <i>{i + 1}</i>
                  {SLOT_NAMES[i]}
                </span>
              ))}
              <span className="rk-ammos">
                <b>S</b> {hud.ammoAll.shells} <b>N</b> {hud.ammoAll.nails} <b>R</b> {hud.ammoAll.rockets} <b>C</b> {hud.ammoAll.cells}
              </span>
            </div>
            <div className="rk-main">
              <div className="rk-cell">
                <div className="rk-icon rk-armor" style={{ background: hud.armor ? hud.armorColor : 'transparent' }} />
                <b className={hud.armor ? '' : 'rk-dim'}>{hud.armor}</b>
              </div>
              <div className="rk-cell">
                <div className={`rk-icon rk-face ${hud.health > 60 ? '' : hud.health > 25 ? 'rk-hurt1' : 'rk-hurt2'} ${hud.quad ? 'rk-quadface' : ''}`} />
                <b className={hud.health <= 25 ? 'rk-low' : ''}>{hud.health}</b>
              </div>
              <div className="rk-cell">
                <div className={`rk-icon rk-ammo-${hud.ammoType ?? 'none'}`} />
                <b>{hud.ammo ?? ''}</b>
              </div>
              <div className="rk-keys">
                {hud.keys.map((k) => (
                  <span key={k} className={`rk-key rk-key-${k}`} />
                ))}
                {hud.quad > 0 && <span className="rk-quad">QUAD {hud.quad}</span>}
              </div>
              <div className="rk-level">
                <div>{hud.level}</div>
                <div>
                  Kills {hud.kills}/{hud.monsters} · Secrets {hud.secrets}/{hud.secretsTotal} · {clock(hud.time)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === 'loading' && (
        <div className="rk-wrap">
          <div className="rk-card">{error ? <p>Could not start: {error}</p> : <p>Carving the keep…</p>}</div>
        </div>
      )}
      {(phase === 'ready' || phase === 'paused') && (
        <div className="rk-wrap" onClick={engage}>
          <div className="rk-card">
            {phase === 'ready' ? (
              <>
                <div className="rk-title">RUNE KEEP</div>
                <p className="rk-tag">Three levels of stone, lava and runes. Find the keys, find the secrets, find the way out.</p>
              </>
            ) : (
              <div className="rk-title rk-small">Paused</div>
            )}
            <table className="rk-keystable">
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
              <div className="rk-buttons">
                <button className="k-btn rk-go" onClick={continueGame}>
                  Continue — level {save.level + 1}, {save.levelName}
                </button>
                <button className="k-btn" onClick={engage}>
                  New game
                </button>
              </div>
            ) : (
              <button className="k-btn rk-go" onClick={engage}>
                {phase === 'ready' ? 'Click to play' : 'Click to resume'}
              </button>
            )}
            {phase === 'ready' && best > 0 && <p className="rk-best">Best: {fmt(best)}</p>}
          </div>
        </div>
      )}
      {inter && hud && (
        <div className="rk-wrap" onClick={engage}>
          <div className="rk-card">
            <div className="rk-title rk-small">{hud.level} — completed</div>
            <div className="rk-stats">
              <div>
                <b>{clock(hud.time)}</b>
                <span>time</span>
              </div>
              <div>
                <b>
                  {hud.kills}/{hud.monsters}
                </b>
                <span>kills</span>
              </div>
              <div>
                <b>
                  {hud.secrets}/{hud.secretsTotal}
                </b>
                <span>secrets</span>
              </div>
            </div>
            <button className="k-btn rk-go" onClick={engage}>
              {hud.levelIndex + 1 < hud.levels ? 'Click for the next level' : 'Click to escape'}
            </button>
          </div>
        </div>
      )}
      {phase === 'over' && result && (
        <div className={`rk-wrap ${result.won ? '' : 'rk-dead'}`}>
          <div className="rk-card">
            <div className="rk-title rk-small">{result.won ? 'You escaped the keep' : 'You died'}</div>
            <div className="rk-stats">
              <div>
                <b>{fmt(result.score)}</b>
                <span>score</span>
              </div>
              <div>
                <b>{result.kills}</b>
                <span>kills</span>
              </div>
            </div>
            {scores.length > 0 && (
              <ol className="rk-scores">
                {scores.slice(0, 5).map((s, i) => (
                  <li key={s.date + ':' + i} className={i === result.rank ? 'rk-on' : ''}>
                    <span>{s.name}</span>
                    <span>{s.summary}</span>
                    <b>{fmt(s.score)}</b>
                  </li>
                ))}
              </ol>
            )}
            <div className="rk-buttons">
              {save && !result.won && (
                <button className="k-btn rk-go" onClick={continueGame}>
                  Continue — level {save.level + 1}, {save.levelName}
                </button>
              )}
              <button className={save && !result.won ? 'k-btn' : 'k-btn rk-go'} onClick={newGame}>
                {save && !result.won ? 'New game' : 'Play again'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
