// Kherve Grand Prix: a 3D racing game. Qualify (your best lap sets your
// place on the grid), then race: five red lights, tyres that wear, pit stops
// to change them, the chequered flag. Two circuits. The game is in
// f1Engine.ts (loaded on demand with three.js); this is the window: the
// canvas, the HUD, the menu and result cards, scores and the AI tools.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleHelp, Flag, Maximize, Pause, Play, RotateCcw, VolumeX } from 'lucide-react'
import type { AppProps } from '@/os'
import { useWindows } from '@/os/windows'
import { useAppTools } from '@/os/ai/appTools'
import { releaseAudio, retainAudio, setSoundOn, unlockAudio, useSound } from './sound'
import { addScore, DEFAULT_NAME, getScores, lastName } from './scores'
import { useScores } from './GameShell'
import { gameCode } from './fpsKeys'
import { isGameFullscreen, toggleGameFullscreen, useGameFullscreen } from './gameFullscreen'
import type { CamMode, GPHud, GPSettings, GrandPrixEngine, Stage, TimeOfDay } from './f1Engine'
import { TRACKS, type TrackId } from './f1Track'
import { COMPOUNDS, COMPOUND_LIST, type Compound } from './f1Physics'
import { CLASSIC_MODELS, DIFFICULTY, TEAMS, fmtLap, teamsOf, type Classified, type Difficulty } from './f1Race'
import type { Series } from './f1Physics'
import { PoleBurst, Podium, Trophy } from './GPCelebration'
import './grandPrix.css'

const ID = 'grandprix'
const NAME = 'Kherve Grand Prix'
type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'results'
const SETTINGS_KEY = 'kherveos.grandprix.settings'
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1, 0, 0]
const CAM_NAMES: Record<CamMode, string> = { chase: 'Chase', tcam: 'T-cam', cockpit: 'Cockpit', tv: 'TV' }

const CONTROLS: [string, string][] = [
  ['X  (or ↑ / W)', 'Throttle'],
  ['Z  (or ↓ / S)', 'Brake (hold when stopped: reverse)'],
  ['← → / A D', 'Steer'],
  ['Space', 'Handbrake: kick the tail out, then throttle and countersteer to drift'],
  ['P', 'Box this lap (pit stop: new tyres)'],
  ['1 · 2 · 3', 'Tyres for the stop: Soft · Medium · Hard'],
  ['E', 'DRS (in the zone, when allowed)'],
  ['C', 'Camera: chase, T-cam, cockpit, TV'],
  ['R', 'Back onto the track'],
  ['Esc · F', 'Pause · full screen'],
]

const fmt = (n: number) => n.toLocaleString('en-US')
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function loadSettings(): Partial<GPSettings> {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY)
    return raw ? (JSON.parse(raw) as Partial<GPSettings>) : {}
  } catch {
    return {}
  }
}
function saveSettings(s: GPSettings) {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // not remembered
  }
}

/** The circuit's outline for the menu cards. */
function outline(id: TrackId, size = 160): string {
  const def = TRACKS.find((t) => t.id === id)!
  const xs = def.points.map((p) => p[0])
  const zs = def.points.map((p) => p[1])
  const x0 = Math.min(...xs)
  const z0 = Math.min(...zs)
  const sc = size / Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0)
  return def.points.map((p, i) => `${i ? 'L' : 'M'}${((p[0] - x0) * sc + 8).toFixed(1)} ${((p[1] - z0) * sc + 8).toFixed(1)}`).join('') + 'Z'
}

interface RaceScore {
  score: number
  position: number
  grid: number
  pole: boolean
  fastest: boolean
  rank: number
}

export default function GrandPrix({ win }: AppProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<GrandPrixEngine | null>(null)
  const [phase, setPhaseState] = useState<Phase>('loading')
  const phaseRef = useRef<Phase>('loading')
  const [stage, setStage] = useState<Stage>('menu')
  const [hud, setHud] = useState<GPHud | null>(null)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<GPSettings>(() => ({
    track: 'park', laps: 5, quali: 6, difficulty: 'medium', assists: true, name: lastName() || DEFAULT_NAME, series: 'modern', classic: 'stoccarda', team: 0, time: 'day', damage: true, ...loadSettings(),
  }))
  const [startTyre, setStartTyre] = useState<Compound>('medium')
  const [results, setResults] = useState<Classified[]>([])
  const [score, setScore] = useState<RaceScore | null>(null)
  const [podium, setPodium] = useState(false)
  const scores = useScores(ID)
  const soundOn = useSound((s) => s.on)
  const focused = useWindows((s) => s.focusedId === win.id)
  const fullscreen = useGameFullscreen(rootRef)

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])

  // ---- the engine

  useEffect(() => {
    let alive = true
    let raf = 0
    let engine: GrandPrixEngine | null = null
    let ro: ResizeObserver | null = null
    retainAudio()
    void import('./f1Engine')
      .then(({ GrandPrixEngine }) => {
        if (!alive || !canvasRef.current) return
        engine = new GrandPrixEngine(canvasRef.current)
        engineRef.current = engine
        if (import.meta.env.DEV) Object.assign(window, { grandPrix: engine })
        engine.onStage = (st) => {
          setStage(st)
          const e = engineRef.current!
          if (st === 'qualiResults') {
            setResults(e.qualiResults)
            setPhase('results')
          } else if (st === 'raceResults') {
            const res = e.raceResults
            setResults(res)
            const me = res.findIndex((r) => r.player)
            const grid = e.qualiResults.findIndex((r) => r.player)
            const fastest = res.reduce((b, r) => (r.best < b.best ? r : b), res[0])
            const s = e.settings
            const mult = DIFFICULTY[s.difficulty].mult
            const pts = Math.round((POINTS[me] ?? 0) * 100 * mult + (grid === 0 ? 300 : 0) + (fastest?.player ? 200 : 0) + Math.max(0, grid - me) * 50)
            const name = lastName() || s.name || DEFAULT_NAME
            const track = TRACKS.find((t) => t.id === s.track)!.name
            const rank = addScore(ID, { name, score: pts, summary: `P${me + 1} · ${track}${s.series === 'classic' ? ' · Classics' : ''} · ${s.laps} laps · ${DIFFICULTY[s.difficulty].name}`, date: Date.now() })
            setScore({ score: pts, position: me + 1, grid: grid + 1, pole: grid === 0, fastest: !!fastest?.player, rank })
            // on the podium: the ceremony first, with the camera going round the car
            setPodium(me >= 0 && me < 3)
            if (me >= 0 && me < 3) e.celebrate(me === 0 ? 30 : 14)
            setPhase('results')
          } else if (st === 'menu') setPhase('ready')
          else setPhase('playing')
        }
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
          if (p === 'playing') engine!.frame(dt, 'live')
          else if (p === 'ready' || p === 'results') engine!.frame(dt, 'attract')
          else if (now - lastStill > 250) {
            lastStill = now
            engine!.frame(0, 'still')
          }
          if (now - lastHud > 60) {
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
      engine?.dispose()
      engineRef.current = null
      releaseAudio()
    }
  }, [setPhase])

  // ---- actions

  const focusGame = () => rootRef.current?.focus({ preventScroll: true })

  const startQuali = useCallback(
    (skip = false) => {
      const e = engineRef.current
      if (!e) return
      unlockAudio()
      saveSettings(settings)
      setScore(null)
      if (skip || settings.quali <= 0) e.skipQualifying(settings)
      else e.startQualifying(settings)
      focusGame()
    },
    [settings],
  )

  const startRace = useCallback(() => {
    const e = engineRef.current
    if (!e) return
    unlockAudio()
    e.startRace(startTyre)
    focusGame()
  }, [startTyre])

  const pause = useCallback(() => {
    if (phaseRef.current === 'playing') {
      engineRef.current?.releaseAll()
      setPhase('paused')
    }
  }, [setPhase])

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused') return
    unlockAudio()
    setPhase('playing')
    focusGame()
  }, [setPhase])

  const toMenu = useCallback(() => {
    engineRef.current?.backToMenu()
    setResults([])
    setScore(null)
    setPhase('ready')
  }, [setPhase])

  // ---- keys

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inGame = !!rootRef.current?.contains(document.activeElement) || useWindows.getState().focusedId === win.id
      if (!inGame) return
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (!rootRef.current?.contains(document.activeElement) && phaseRef.current !== 'playing') return
      const code = gameCode(e)
      if (code === 'KeyF') {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === 'keydown' && !e.repeat) toggleGameFullscreen(rootRef.current)
        return
      }
      if (code === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (e.type !== 'keydown' || e.repeat) return
        if (phaseRef.current === 'playing') pause()
        else if (phaseRef.current === 'paused') {
          if (isGameFullscreen(rootRef.current)) toggleGameFullscreen(rootRef.current)
          else resume()
        } else if (isGameFullscreen(rootRef.current)) toggleGameFullscreen(rootRef.current)
        return
      }
      if (phaseRef.current !== 'playing') return
      if (!code) return
      e.preventDefault()
      e.stopPropagation()
      unlockAudio()
      if (e.type === 'keydown') {
        if (!e.repeat) engineRef.current?.keyDown(code)
      } else engineRef.current?.keyUp(code)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }, [pause, resume, win.id])

  // behind the menu, the demo race shows the chosen cars on the chosen circuit
  useEffect(() => {
    const e = engineRef.current
    if (!e || phase !== 'ready') return
    e.setSeries(settings.series, settings.team ?? 0)
    e.setTime(settings.time ?? 'day')
    e.setTrack(settings.track)
  }, [phase, settings.series, settings.team, settings.track, settings.time])

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
          { label: 'Main Menu', icon: RotateCcw, onClick: toMenu },
          { label: phase === 'playing' ? 'Pause' : 'Resume', icon: phase === 'playing' ? Pause : Play, disabled: phase !== 'playing' && phase !== 'paused', onClick: () => (phase === 'playing' ? pause() : resume()) },
          { label: 'End Qualifying', icon: Flag, disabled: stage !== 'qualifying', onClick: () => engineRef.current?.endQualifying() },
          '-',
          { label: 'Change Camera (C)', disabled: phase !== 'playing' && phase !== 'paused', onClick: () => engineRef.current?.cycleCamera() },
          { label: 'Sound', icon: VolumeX, checked: soundOn, onClick: () => setSoundOn(!useSound.getState().on) },
          { label: 'Full Screen', icon: Maximize, checked: fullscreen, onClick: () => toggleGameFullscreen(rootRef.current) },
        ],
      },
      { label: 'Help', items: [{ label: `How to Play ${NAME}`, icon: CircleHelp, onClick: () => pause() }] },
    ])
  }, [win, phase, stage, soundOn, fullscreen, toMenu, pause, resume])

  // ---- AI tools (specs in src/os/ai/manifests/games.ts)

  useAppTools(win, {
    get_state: async () => {
      const e = engineRef.current
      const h = e?.snapshot()
      const list = getScores(ID)
      const p = phaseRef.current
      return {
        phase: p === 'loading' ? 'ready' : p === 'results' ? 'over' : p,
        score: score?.score ?? 0,
        best: list[0]?.score ?? 0,
        stage: e?.stage ?? 'menu',
        track: TRACKS.find((t) => t.id === settings.track)?.name,
        cars: `${settings.series === 'classic' ? 'Classics' : 'Modern single-seaters'}; you drive the ${teamsOf(settings.series)[settings.team ?? 0]?.name}${settings.series === 'classic' ? ` ${CLASSIC_MODELS[teamsOf('classic')[settings.team ?? 0]?.model ?? 'stoccarda'].name}` : ''} car`,
        settings: { laps: settings.laps, qualifying_minutes: settings.quali, difficulty: settings.difficulty, assists: settings.assists },
        ...(h && {
          session: h.kind,
          position: `${h.position}/${h.cars}`,
          lap: h.kind === 'race' ? `${h.lap}/${h.laps}` : undefined,
          qualifying_time_left: h.kind === 'qualifying' ? clock(h.remaining) : undefined,
          best_lap: fmtLap(h.bestLap),
          last_lap: fmtLap(h.lastLap),
          tyres: `${COMPOUNDS[h.tyre].name}, ${Math.round(h.wear * 100)}% worn`,
          next_tyres: COMPOUNDS[h.compound].name,
          damage: h.damage.on ? `front ${Math.round(h.damage.fw * 100)}%, rear ${Math.round(h.damage.rw * 100)}%, suspension ${Math.round(h.damage.susp * 100)}%` : 'off',
          pit: h.pit,
          speed_kmh: h.speed,
          top5: h.tower.slice(0, 5).map((r) => `${r.pos}. ${r.code} ${r.gap}`),
        }),
        ...(results.length && { last_results: results.slice(0, 12).map((r, i) => `${i + 1}. ${r.name} ${r.gap}`) }),
        high_scores: list.slice(0, 5).map((s) => ({ name: s.name, score: s.score, summary: s.summary })),
      }
    },
    new_game: async (a, ctx) => {
      const e = engineRef.current
      if (!e) throw new Error(`${NAME} is still loading.`)
      const p = phaseRef.current
      if (p === 'playing' || p === 'paused') {
        pause()
        if (!(await ctx.confirm(`leave the session in ${NAME}`, 'The qualifying or race in progress will be lost.'))) throw new Error('The user kept the session in progress.')
      }
      toMenu()
      if (a.start === true) {
        useWindows.getState().focus(win.id)
        startQuali()
      }
      return { phase: phaseRef.current, note: a.start === true ? 'Qualifying has started: the player drives.' : 'The menu is showing: the player picks the circuit and starts qualifying.' }
    },
    play: async (a) => {
      const action = String(a.action ?? '')
      const p = phaseRef.current
      if (action === 'pause') {
        if (p !== 'playing') return { phase: p, note: 'Not driving, nothing to pause.' }
        pause()
        return { phase: phaseRef.current }
      }
      if (action !== 'start' && action !== 'resume') throw new Error('"action" must be "start", "pause" or "resume".')
      useWindows.getState().focus(win.id)
      if (p === 'paused') resume()
      else if (p === 'ready') startQuali()
      return { phase: phaseRef.current }
    },
  })

  // ---- the page

  const best = scores[0]?.score ?? 0
  const live = (phase === 'playing' || phase === 'paused') && hud
  const set = <K extends keyof GPSettings>(k: K, v: GPSettings[K]) => setSettings((s) => ({ ...s, [k]: v }))
  const e = engineRef.current

  return (
    <div ref={rootRef} className="gp-app" tabIndex={-1} onContextMenu={(ev) => ev.preventDefault()} onMouseDown={() => phase === 'playing' && focusGame()}>
      <canvas ref={canvasRef} className="gp-canvas" />

      {live && hud && <Hud hud={hud} classic={e?.settings.series === 'classic'} mapPath={e?.mapPath ?? ''} box={e?.mapBox ?? { x: 0, z: 0, w: 1, h: 1 }} />}

      {phase === 'loading' && (
        <div className="gp-wrap">
          <div className="gp-card">{error ? <p>Could not start: {error}</p> : <p>Building the circuit…</p>}</div>
        </div>
      )}

      {phase === 'ready' && (
        <div className="gp-wrap gp-menu">
          <div className="gp-card gp-wide">
            <div className="gp-title">
              KHERVE <span>GRAND PRIX</span>
            </div>
            <p className="gp-tag">Qualify — your best lap decides your place on the grid. Then race: five red lights, tyres that wear, a pit stop to change them, and the chequered flag.</p>
            <div className="gp-options">
              <label>
                <span>Cars</span>
                <Seg value={settings.series} options={['modern', 'classic'] as Series[]} label={(v) => (v === 'modern' ? 'Modern single-seaters' : 'Classics (1970s coupés)')} onChange={(v) => set('series', v)} />
              </label>
            </div>
            <div className="gp-carhead">Your car</div>
            <div className="gp-cars">
              {teamsOf(settings.series).map((t, k) => (
                <button
                  key={t.name}
                  className={`gp-carpick ${(settings.team ?? 0) === k ? 'gp-on' : ''}`}
                  title={t.model ? CLASSIC_MODELS[t.model].blurb : t.name}
                  onClick={() => setSettings((s) => ({ ...s, team: k, classic: t.model ?? s.classic }))}
                >
                  <i className="gp-livery" style={{ background: `linear-gradient(135deg, ${t.color} 0 55%, ${t.color2} 55% 72%, ${t.color} 72%)` }} />
                  <b>{t.name}</b>
                  <span>{t.model ? CLASSIC_MODELS[t.model].name : `${t.short} single-seater`}</span>
                </button>
              ))}
            </div>
            <div className="gp-tracks">
              {TRACKS.map((t) => (
                <button key={t.id} className={`gp-track ${settings.track === t.id ? 'gp-on' : ''}`} onClick={() => set('track', t.id)}>
                  <svg viewBox="0 0 176 176" className="gp-outline">
                    <path d={outline(t.id)} />
                  </svg>
                  <div>
                    <b>{t.name}</b>
                    <span>{t.blurb}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="gp-options">
              <label>
                <span>Race</span>
                <Seg value={settings.laps} options={[3, 5, 10, 20]} label={(v) => `${v} laps`} onChange={(v) => set('laps', v)} />
              </label>
              <label>
                <span>Qualifying</span>
                <Seg value={settings.quali} options={[0, 4, 6, 10]} label={(v) => (v ? `${v} min` : 'Skip')} onChange={(v) => set('quali', v)} />
              </label>
              <label>
                <span>Light</span>
                <Seg value={settings.time ?? 'day'} options={['day', 'sunset'] as TimeOfDay[]} label={(v) => (v === 'day' ? (settings.track === 'lake' ? 'Golden afternoon' : 'Midday sun') : 'Sunset')} onChange={(v) => set('time', v)} />
              </label>
              <label>
                <span>Rivals</span>
                <Seg value={settings.difficulty} options={['easy', 'medium', 'hard'] as Difficulty[]} label={(v) => DIFFICULTY[v].name} onChange={(v) => set('difficulty', v)} />
              </label>
              <label>
                <span>Assists</span>
                <Seg value={settings.assists} options={[true, false]} label={(v) => (v ? 'On' : 'Off')} onChange={(v) => set('assists', v)} />
              </label>
              <label>
                <span>Damage</span>
                <Seg value={settings.damage !== false} options={[true, false]} label={(v) => (v ? 'On: crashes break wings' : 'Off')} onChange={(v) => set('damage', v)} />
              </label>
            </div>
            <div className="gp-buttons">
              <button className="k-btn gp-go" onClick={() => startQuali(false)}>
                {settings.quali > 0 ? 'Start qualifying' : 'To the grid'}
              </button>
              {settings.quali > 0 && (
                <button className="k-btn" onClick={() => startQuali(true)}>
                  Skip qualifying (start last)
                </button>
              )}
              <button className="k-btn" onClick={() => toggleGameFullscreen(rootRef.current)}>
                <Maximize size={14} /> {fullscreen ? 'Leave full screen' : 'Full screen'}
              </button>
            </div>
            <details className="gp-help">
              <summary>Controls</summary>
              <Keys />
              <p>A gamepad works too: stick to steer, triggers for throttle and brake, A to leave the garage, X to box, Y camera, LB handbrake, RB DRS.</p>
            </details>
            {best > 0 && (
              <ol className="gp-scores">
                {scores.slice(0, 3).map((s, i) => (
                  <li key={s.date + ':' + i}>
                    <span>{s.name}</span>
                    <span>{s.summary}</span>
                    <b>{fmt(s.score)}</b>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {phase === 'paused' && (
        <div className="gp-wrap" onClick={resume}>
          <div className="gp-card" onClick={(ev) => ev.stopPropagation()}>
            <div className="gp-title gp-small">Paused</div>
            <Keys />
            <div className="gp-buttons">
              <button className="k-btn gp-go" onClick={resume}>
                Resume
              </button>
              {stage === 'qualifying' && (
                <button className="k-btn" onClick={() => { engineRef.current?.endQualifying(); resume() }}>
                  End qualifying now
                </button>
              )}
              <button className="k-btn" onClick={toMenu}>
                Main menu
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'results' && stage === 'qualiResults' && (
        <div className="gp-wrap">
          {results[0]?.player && <PoleBurst />}
          <div className="gp-card gp-wide">
            <div className="gp-title gp-small">{results[0]?.player ? 'Pole position!' : 'Qualifying — the grid'}</div>
            <Classification rows={results} kind="qualifying" />
            <div className="gp-tyrepick">
              <span>Start the race on</span>
              {COMPOUND_LIST.map((c) => (
                <button key={c} className={`gp-tyrebtn ${startTyre === c ? 'gp-on' : ''}`} onClick={() => setStartTyre(c)}>
                  <i style={{ borderColor: COMPOUNDS[c].color }}>{COMPOUNDS[c].letter}</i>
                  {COMPOUNDS[c].name}
                </button>
              ))}
            </div>
            {settings.laps >= 3 && <p className="gp-note">Race rule: use two different compounds — box at least once, or take a 10 s penalty.</p>}
            <div className="gp-buttons">
              <button className="k-btn gp-go" onClick={startRace}>
                Line up on the grid
              </button>
              <button className="k-btn" onClick={toMenu}>
                Main menu
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'results' && stage === 'raceResults' && podium && score && <Podium rows={results} place={score.position} onDone={() => setPodium(false)} />}

      {phase === 'results' && stage === 'raceResults' && !podium && (
        <div className="gp-wrap">
          <div className="gp-card gp-wide">
            <div className="gp-title gp-small gp-wintitle">
              {score && score.position <= 3 && <Trophy place={score.position} size={34} />}
              {score?.position === 1 ? 'You win the Grand Prix!' : `Finished P${score?.position ?? '?'}`}
            </div>
            <Classification rows={results} kind="race" />
            {score && (
              <div className="gp-stats">
                <div>
                  <b>{fmt(score.score)}</b>
                  <span>score</span>
                </div>
                <div>
                  <b>P{score.grid} → P{score.position}</b>
                  <span>grid → finish</span>
                </div>
                {score.pole && (
                  <div>
                    <b>+300</b>
                    <span>pole</span>
                  </div>
                )}
                {score.fastest && (
                  <div>
                    <b>+200</b>
                    <span>fastest lap</span>
                  </div>
                )}
              </div>
            )}
            {scores.length > 0 && (
              <ol className="gp-scores">
                {scores.slice(0, 5).map((s, i) => (
                  <li key={s.date + ':' + i} className={i === score?.rank ? 'gp-on' : ''}>
                    <span>{s.name}</span>
                    <span>{s.summary}</span>
                    <b>{fmt(s.score)}</b>
                  </li>
                ))}
              </ol>
            )}
            <div className="gp-buttons">
              <button className="k-btn gp-go" onClick={toMenu}>
                Next Grand Prix
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Seg<T extends string | number | boolean>({ value, options, label, onChange }: { value: T; options: T[]; label: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="gp-seg">
      {options.map((o) => (
        <button key={String(o)} className={o === value ? 'gp-on' : ''} onClick={() => onChange(o)}>
          {label(o)}
        </button>
      ))}
    </div>
  )
}

function Keys() {
  return (
    <table className="gp-keys">
      <tbody>
        {CONTROLS.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Classification({ rows, kind }: { rows: Classified[]; kind: 'qualifying' | 'race' }) {
  return (
    <table className="gp-class">
      <thead>
        <tr>
          <th>Pos</th>
          <th>Driver</th>
          <th>Team</th>
          {kind === 'race' && <th>Laps</th>}
          <th>{kind === 'race' ? 'Time / gap' : 'Best lap'}</th>
          {kind === 'race' && <th>Best</th>}
          {kind === 'race' && <th>Stops</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.car} className={r.player ? 'gp-me' : ''}>
            <td>{i + 1}</td>
            <td>
              <i className="gp-bar" style={{ background: TEAMS[r.team].color2 }} />
              {r.name} <small>#{r.num}</small>
            </td>
            <td>{TEAMS[r.team].name}</td>
            {kind === 'race' && <td>{r.laps}</td>}
            <td>
              {r.gap}
              {r.penalty > 0 && <small className="gp-pen"> +{r.penalty}s</small>}
            </td>
            {kind === 'race' && <td>{fmtLap(r.best)}</td>}
            {kind === 'race' && <td>{r.stops}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Hud({ hud, classic, mapPath, box }: { hud: GPHud; classic: boolean; mapPath: string; box: { x: number; z: number; w: number; h: number } }) {
  const shift = Math.max(0, Math.min(1, (hud.rpm - 9500) / 2700))
  const inGarage = hud.pit === 'garage'
  const delta = isFinite(hud.bestLap) && hud.lastLap > 0 ? hud.lastLap - hud.bestLap : 0
  return (
    <div className="gp-hud">
      {/* timing tower */}
      <div className="gp-tower">
        <div className="gp-tower-head">{hud.kind === 'race' ? `LAP ${hud.lap}/${hud.laps}` : hud.overtime ? 'FLAG' : `Q ${clock(hud.remaining)}`}</div>
        {hud.tower.map((r) => (
          <div key={r.code} className={`gp-row ${r.player ? 'gp-me' : ''}`}>
            <span className="gp-pos">{r.pos}</span>
            <i className="gp-bar" style={{ background: r.color }} />
            <span className="gp-code">{r.code}</span>
            <span className="gp-gap">{r.pit ? 'PIT' : r.gap}</span>
            <span className="gp-tyre" style={{ color: COMPOUNDS[r.tyre].color, borderColor: COMPOUNDS[r.tyre].color }}>
              {COMPOUNDS[r.tyre].letter}
            </span>
          </div>
        ))}
      </div>

      {/* lap timer */}
      <div className="gp-timer">
        <div className="gp-pospill">
          P{hud.position}
          <small>/{hud.cars}</small>
        </div>
        <div className="gp-laptime">{hud.lapTime > 0 ? fmtLap(hud.lapTime) : '—:—.———'}</div>
        <div className="gp-sectors">
          {hud.sectors.map((c, i) => (
            <i key={i} className={`gp-sec gp-${c || 'none'}`} />
          ))}
        </div>
        <div className="gp-times">
          <span>Last {fmtLap(hud.lastLap)}</span>
          <span>Best {fmtLap(hud.bestLap)}</span>
        </div>
        {delta !== 0 && <div className={`gp-delta ${delta <= 0 ? 'gp-good' : 'gp-bad'}`}>{delta > 0 ? '+' : ''}{delta.toFixed(3)}</div>}
        {hud.kind === 'qualifying' && !hud.lapValid && <div className="gp-invalid">LAP DELETED</div>}
        {hud.penalty > 0 && <div className="gp-invalid">+{hud.penalty} s penalty</div>}
      </div>

      {/* the start lights */}
      {hud.phase === 'lights' && (
        <div className="gp-lights">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="gp-lightcol">
              <i className={i < hud.lights ? 'gp-lit' : ''} />
              <i className={i < hud.lights ? 'gp-lit' : ''} />
            </div>
          ))}
        </div>
      )}

      {/* messages */}
      <div className="gp-center">
        {hud.message && (
          <div className={`gp-msg gp-${hud.message.kind}`} key={hud.message.text + hud.message.t}>
            {hud.message.text}
          </div>
        )}
        {hud.wrongWay && <div className="gp-msg gp-bad">WRONG WAY</div>}
        {hud.drift && !hud.wrongWay && <div className="gp-drift">DRIFT</div>}
        {inGarage && (
          <div className="gp-garage">
            <b>In the garage</b>
            <span>
              Tyres: <TyrePick current={hud.compound} /> — press 1 · 2 · 3
            </span>
            <span>↑ or Enter to go out</span>
          </div>
        )}
        {hud.pit === 'stop' && (
          <div className="gp-stop">
            <b>Pit stop</b>
            <div className="gp-stopbar">
              <i style={{ width: `${Math.min(100, (hud.pitT / Math.max(0.1, hud.pitLen)) * 100)}%` }} />
            </div>
            <span>{hud.pitT.toFixed(1)} s</span>
          </div>
        )}
        {hud.boxRequest && hud.pit === 'none' && <div className="gp-box">BOX THIS LAP · {COMPOUNDS[hud.compound].name}s</div>}
      </div>

      {/* tyres */}
      <div className="gp-tyres">
        <div className="gp-car">
          {[0, 1, 2, 3].map((i) => {
            const w = Math.min(1, hud.wear * (i < 2 ? 0.94 : 1.06))
            const cold = hud.temp < 0.75
            return <i key={i} style={{ background: cold ? '#3aa0ff' : `hsl(${120 - w * 120}, 75%, 45%)` }} />
          })}
          <b style={{ color: COMPOUNDS[hud.tyre].color, borderColor: COMPOUNDS[hud.tyre].color }}>{COMPOUNDS[hud.tyre].letter}</b>
        </div>
        <div className="gp-tyreinfo">
          <span>{COMPOUNDS[hud.tyre].name}</span>
          <span>{Math.round(hud.wear * 100)}% worn</span>
          <span>
            Next: <TyrePick current={hud.compound} />
          </span>
          {hud.mustChange && !hud.changed && hud.kind === 'race' && <span className="gp-warn">Stop needed</span>}
        </div>
        {hud.damage.on && (
          <div className="gp-damage" title="Damage: box (P) to repair">
            {([
              [classic ? 'Nose' : 'F wing', hud.damage.fw],
              [classic ? 'Tail' : 'R wing', hud.damage.rw],
              ['Susp.', hud.damage.susp],
            ] as [string, number][]).map(([name, v]) => (
              <div key={name} className={v >= 0.75 ? 'gp-dmg-bad' : v >= 0.25 ? 'gp-dmg-warn' : ''}>
                <span>{name}</span>
                <i>
                  <b style={{ width: `${Math.round((1 - v) * 100)}%` }} />
                </i>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* speed, gear, revs */}
      <div className="gp-dash">
        <div className="gp-leds">
          {[...Array(12)].map((_, i) => (
            <i key={i} className={i / 12 < shift ? (i < 4 ? 'gp-g' : i < 8 ? 'gp-r' : 'gp-b') : ''} />
          ))}
        </div>
        <div className="gp-speed">
          <b>{hud.speed}</b>
          <small>km/h</small>
        </div>
        <div className="gp-gear">{hud.speed < 1 && hud.brake > 0.5 && hud.throttle < 0.05 ? 'N' : hud.gear}</div>
        <div className="gp-pedals">
          <i className="gp-thr" style={{ height: `${hud.throttle * 100}%` }} />
          <i className="gp-brk" style={{ height: `${hud.brake * 100}%` }} />
        </div>
        <div className="gp-flags">
          {!classic && <span className={hud.drsOpen ? 'gp-drs gp-open' : hud.drsAvailable ? 'gp-drs gp-avail' : 'gp-drs'}>DRS</span>}
          {hud.limiter && <span className="gp-lim">PIT 80</span>}
        </div>
      </div>

      {/* mini-map */}
      <svg className="gp-map" viewBox={`0 0 ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet">
        <path d={mapPath} className="gp-map-track" style={{ strokeWidth: box.w / 45 }} />
        <path d={mapPath} className="gp-map-line" style={{ strokeWidth: box.w / 140 }} />
        {hud.dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.z} r={box.w / (d.player ? 45 : 70)} fill={d.player ? '#ffffff' : d.color} stroke={d.player ? '#22c55e' : '#000'} strokeWidth={box.w / 250} />
        ))}
      </svg>

      <div className="gp-cam">
        {CAM_NAMES[hud.camera]} · {hud.trackName}
      </div>
    </div>
  )
}

function TyrePick({ current }: { current: Compound }) {
  return (
    <span className="gp-pick">
      {COMPOUND_LIST.map((c, i) => (
        <i key={c} className={c === current ? 'gp-on' : ''} style={{ color: COMPOUNDS[c].color, borderColor: COMPOUNDS[c].color }}>
          <sup>{i + 1}</sup>
          {COMPOUNDS[c].letter}
        </i>
      ))}
    </span>
  )
}
