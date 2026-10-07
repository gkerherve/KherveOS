// The frame every mini-game shares: the canvas fitted into the window, the
// side panel, the start / pause / game-over cards, the Game and Help menus,
// keyboard focus (keys only reach the game whose window is in front),
// auto-pause, sound and high scores. A game brings its engine (rules and
// drawing) and the contents of its panel.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react'
import { CircleHelp, Pause, Play, RotateCcw, Trophy, VolumeX } from 'lucide-react'
import { os, type WindowApi } from '@/os'
import { useWindows } from '@/os/windows'
import { useAppTools, type AppTools } from '@/os/ai/appTools'
import { runLoop } from './loop'
import { useFitCanvas } from './canvas'
import { fmt } from './fx'
import { releaseAudio, retainAudio, setSoundOn, unlockAudio, useSound } from './sound'
import {
  addScore, clearScores, DEFAULT_NAME, getScores, lastName, rankOf, rememberName, subscribeScores, type HighScore,
} from './scores'
import './minigames.css'

export type Phase = 'ready' | 'playing' | 'paused' | 'over'

/** What a game's drawing needs to know besides its own state. */
export interface Frame {
  /** How far the clock is between the last step and the next (0..1), for smooth drawing. */
  alpha: number
  phase: Phase
  /** performance.now(), for idle animations. */
  now: number
  /** Device pixels per logical unit. */
  scale: number
}

/** A game's rules and drawing, driven by the shell. */
export interface GameEngine {
  /** Key codes (KeyboardEvent.code) the game uses while playing. */
  readonly keys: ReadonlySet<string>
  /** Advance by one fixed step of `dt` seconds. Only called while playing. */
  update(dt: number): void
  /** Draw the whole scene, in logical units. */
  render(ctx: CanvasRenderingContext2D, frame: Frame): void
  keyDown(code: string): void
  keyUp(code: string): void
  /** Let go of every held key (the window lost focus). */
  releaseAll(): void
  /** Set up a fresh game. */
  reset(): void
  /** True once the game has ended and its closing animation is over. */
  readonly over: boolean
  readonly score: number
  /** A few words kept with a high score, e.g. "Level 4 · 32 lines". */
  summary(): string
  /** Mouse support (Breakout's paddle), in logical units. */
  pointerMove?(x: number, y: number): void
  pointerDown?(x: number, y: number): void
}

export interface GameInfo {
  /** Key of the high-score table. */
  id: string
  name: string
  /** Logical size of the playfield; it is letterboxed into the window. */
  width: number
  height: number
  /** Fixed time step, seconds. */
  step: number
  /** Controls listed on the start card: [keys, what they do]. */
  controls: [string, string][]
  /** The How to Play card. */
  help: ReactNode
  /** Hide the mouse pointer over the playfield while playing. */
  hideCursor?: boolean
}

type Card = 'help' | 'scores' | null

interface Result {
  score: number
  summary: string
  /** Place in the table (0 = top), -1 if it didn't make it. */
  rank: number
  saved: boolean
}

export function useScores(game: string): HighScore[] {
  return useSyncExternalStore(subscribeScores, () => getScores(game))
}

/** Buttons that don't take the keyboard away from the game. */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault()

/** A labelled number in the side panel. */
export function Stat({ label, value, big, title }: { label: string; value: ReactNode; big?: boolean; title?: string }) {
  return (
    <div className="mg-stat" title={title}>
      <span className="mg-label">{label}</span>
      <span className={`mg-value${big ? ' mg-big' : ''}`}>{value}</span>
    </div>
  )
}

/** What a game's own AI tools get from the shell. */
export interface GameControl {
  phase(): Phase
  /** Start or resume the game (its window comes to the front); throws once it is over. */
  ensurePlaying(): void
}

interface ShellProps {
  win: WindowApi
  info: GameInfo
  engine: GameEngine
  /** The game's own panel: score, level, previews… */
  panel: ReactNode
  /** Called after every drawn frame: a chance to copy numbers into React state. */
  onFrame?: () => void
  className?: string
  /** Extra numbers for the AI's get_state (level, lines…). */
  aiState?: () => Record<string, unknown>
  /** The game's own AI tools (specs in src/os/ai/manifests/games.ts). */
  aiTools?: (game: GameControl) => AppTools
}

export function GameShell({ win, info, engine, panel, onFrame, className, aiState, aiTools }: ShellProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const view = useFitCanvas(stageRef, screenRef, canvasRef, info.width, info.height)

  const [phase, setPhaseState] = useState<Phase>('ready')
  const [card, setCardState] = useState<Card>(null)
  const [result, setResultState] = useState<Result | null>(null)
  // The loop and key handlers read these without waiting for a render.
  const phaseRef = useRef<Phase>('ready')
  const cardRef = useRef<Card>(null)
  const resultRef = useRef<Result | null>(null)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  const soundOn = useSound((s) => s.on)
  const scores = useScores(info.id)
  const focused = useWindows((s) => s.focusedId === win.id)

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }, [])
  const setCard = useCallback((c: Card) => {
    cardRef.current = c
    setCardState(c)
  }, [])
  const setResult = useCallback((r: Result | null) => {
    resultRef.current = r
    setResultState(r)
  }, [])
  const focusRoot = useCallback(() => rootRef.current?.focus({ preventScroll: true }), [])

  // ---- game flow

  const pause = useCallback(() => {
    engine.releaseAll()
    if (phaseRef.current === 'playing') setPhase('paused')
  }, [engine, setPhase])

  /** Start from the start card, or resume after a pause. */
  const play = useCallback(() => {
    setCard(null)
    if (phaseRef.current === 'ready' || phaseRef.current === 'paused') setPhase('playing')
    focusRoot()
  }, [setCard, setPhase, focusRoot])

  const playAgain = useCallback(() => {
    engine.reset()
    setResult(null)
    setCard(null)
    setPhase('playing')
    focusRoot()
  }, [engine, setResult, setCard, setPhase, focusRoot])

  const newGame = useCallback(async () => {
    const p = phaseRef.current
    if ((p === 'playing' || p === 'paused') && engine.score > 0) {
      pause()
      const ok = await os.dialog.confirm('Start a new game? This one will be lost.', { title: info.name, okLabel: 'New Game' })
      focusRoot()
      if (!ok) return
    }
    engine.reset()
    setResult(null)
    setCard(null)
    setPhase('ready')
    focusRoot()
  }, [engine, info.name, pause, setResult, setCard, setPhase, focusRoot])

  const togglePause = useCallback(() => {
    const p = phaseRef.current
    if (p === 'playing') pause()
    else if (p === 'paused' || p === 'ready') play()
  }, [pause, play])

  const openCard = useCallback(
    (c: Card) => {
      pause()
      setCard(c)
      focusRoot()
    },
    [pause, setCard, focusRoot],
  )
  const closeCard = useCallback(() => {
    setCard(null)
    focusRoot()
  }, [setCard, focusRoot])

  const toggleSound = useCallback(() => setSoundOn(!useSound.getState().on), [])

  const saveScore = useCallback(
    (typed: string) => {
      const r = resultRef.current
      if (!r || r.saved) return
      const name = typed.trim() || DEFAULT_NAME
      rememberName(name)
      const rank = addScore(info.id, { name, score: r.score, summary: r.summary, date: Date.now() })
      setResult({ ...r, rank, saved: true })
      focusRoot()
    },
    [info.id, setResult, focusRoot],
  )

  const resetScores = useCallback(async () => {
    const ok = await os.dialog.confirm(`Clear the ${info.name} high scores?`, { title: 'High Scores', okLabel: 'Clear', danger: true })
    focusRoot()
    if (ok) clearScores(info.id)
  }, [info.id, info.name, focusRoot])

  // ---- the loop: fixed steps while playing, a drawing every frame

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    return runLoop(
      info.step,
      (dt) => {
        if (phaseRef.current !== 'playing') return
        engine.update(dt)
        if (engine.over) {
          engine.releaseAll()
          setPhase('over')
          setResult({ score: engine.score, summary: engine.summary(), rank: rankOf(info.id, engine.score), saved: false })
        }
      },
      (alpha, now) => {
        const root = rootRef.current
        if (!root || root.offsetParent === null) return // minimised
        const v = view.current
        const p = phaseRef.current
        ctx.setTransform(v.sx, 0, 0, v.sy, 0, 0)
        engine.render(ctx, { alpha: p === 'playing' ? alpha : 1, phase: p, now, scale: v.sx })
        onFrameRef.current?.()
      },
    )
  }, [engine, info.step, info.id, view, setPhase, setResult])

  useEffect(() => {
    retainAudio()
    return releaseAudio
  }, [])

  // ---- focus: keys go to the game whose window is in front; pause when it isn't

  useEffect(() => {
    if (!focused) {
      pause()
      return
    }
    const t = window.setTimeout(() => {
      const root = rootRef.current
      if (root && !root.contains(document.activeElement)) root.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(t)
  }, [focused, pause])

  useEffect(() => {
    const onVisibility = () => document.hidden && pause()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', pause)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', pause)
    }
  }, [pause])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select')) return // typing a name
    if (e.metaKey || e.ctrlKey || e.altKey) return // OS and browser shortcuts
    unlockAudio()
    const code = e.code
    const p = phaseRef.current

    if (cardRef.current) {
      if (code === 'Escape' || code === 'Enter' || code === 'Space' || code === 'KeyP' || code === 'KeyH' || code === 'F1') {
        e.preventDefault()
        closeCard()
      } else if (code === 'KeyM') toggleSound()
      return
    }

    switch (code) {
      case 'KeyP':
      case 'Escape':
        e.preventDefault()
        togglePause()
        return
      case 'KeyN':
        e.preventDefault()
        void newGame()
        return
      case 'KeyH':
        e.preventDefault()
        openCard('scores')
        return
      case 'KeyM':
        e.preventDefault()
        toggleSound()
        return
      case 'F1':
        e.preventDefault()
        openCard('help')
        return
    }

    if (p === 'playing') {
      if (engine.keys.has(code)) {
        e.preventDefault()
        if (!e.repeat) engine.keyDown(code)
      }
      return
    }
    if (code === 'Space' || code === 'Enter') {
      e.preventDefault()
      if (e.repeat) return
      if (p === 'ready' || p === 'paused') play()
      else if (p === 'over') {
        const r = resultRef.current
        if (!r || r.rank < 0 || r.saved) playAgain()
      }
    } else if (engine.keys.has(code)) e.preventDefault()
  }

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (engine.keys.has(e.code)) {
      e.preventDefault()
      engine.keyUp(e.code)
    }
  }

  const onBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) pause()
  }

  // ---- mouse (paddle games)

  const toLogical = (e: PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      x: Math.min(info.width, Math.max(0, ((e.clientX - r.left) / Math.max(1, r.width)) * info.width)),
      y: Math.min(info.height, Math.max(0, ((e.clientY - r.top) / Math.max(1, r.height)) * info.height)),
    }
  }
  const onPointerMove = (e: PointerEvent) => {
    if (phaseRef.current !== 'playing' || cardRef.current || !engine.pointerMove) return
    const p = toLogical(e)
    engine.pointerMove(p.x, p.y)
  }
  const onPointerDown = (e: PointerEvent) => {
    unlockAudio()
    if (e.button !== 0 || phaseRef.current !== 'playing' || cardRef.current || !engine.pointerDown) return
    if ((e.target as HTMLElement).closest('button, input')) return
    const p = toLogical(e)
    engine.pointerDown(p.x, p.y)
  }

  // ---- AI tools (get_state, new_game, play; specs in src/os/ai/manifests/games.ts)

  /** Start or resume for the AI: the window comes to the front first, so the focus check doesn't pause it again. */
  const aiPlay = useCallback(() => {
    if (phaseRef.current === 'over') throw new Error(`The game is over (score ${engine.score}). Call ${info.id}_new_game to play again.`)
    useWindows.getState().focus(win.id)
    if (phaseRef.current !== 'playing') play()
  }, [engine, info.id, win.id, play])

  const control: GameControl = { phase: () => phaseRef.current, ensurePlaying: aiPlay }

  useAppTools(win, {
    get_state: async () => {
      const list = getScores(info.id)
      return {
        phase: phaseRef.current,
        score: engine.score,
        best: Math.max(list[0]?.score ?? 0, engine.score),
        ...(phaseRef.current === 'over' && resultRef.current && { result: resultRef.current.summary }),
        ...aiState?.(),
        high_scores: list.slice(0, 5).map((s) => ({ name: s.name, score: s.score, ...(s.summary && { summary: s.summary }) })),
      }
    },
    new_game: async (a, ctx) => {
      const p = phaseRef.current
      if ((p === 'playing' || p === 'paused') && engine.score > 0) {
        pause()
        if (!(await ctx.confirm(`start a new game of ${info.name}`, `The game in progress (score ${engine.score}) will be lost.`)))
          throw new Error('The user kept the game in progress.')
      }
      engine.reset()
      setResult(null)
      setCard(null)
      setPhase('ready')
      if (a.start === true) aiPlay()
      return { phase: phaseRef.current, ...aiState?.() }
    },
    play: async (a) => {
      const action = String(a.action ?? '')
      const p = phaseRef.current
      if (action === 'pause') {
        if (p !== 'playing') return { phase: p, note: p === 'paused' ? 'Already paused.' : 'Not playing, nothing to pause.' }
        pause()
      } else if (action === 'start' || action === 'resume') {
        if (cardRef.current) setCard(null)
        aiPlay()
      } else throw new Error('"action" must be "start", "pause" or "resume".')
      return { phase: phaseRef.current, score: engine.score }
    },
    ...aiTools?.(control),
  })

  // ---- menus

  useEffect(() => {
    win.setMenus([
      {
        label: 'Game',
        items: [
          { label: 'New Game', icon: RotateCcw, shortcut: 'N', onClick: () => void newGame() },
          {
            label: phase === 'playing' ? 'Pause' : phase === 'paused' ? 'Resume' : 'Start',
            icon: phase === 'playing' ? Pause : Play,
            shortcut: 'P',
            disabled: phase === 'over',
            onClick: togglePause,
          },
          '-',
          { label: 'High Scores…', icon: Trophy, shortcut: 'H', onClick: () => openCard('scores') },
          '-',
          { label: 'Sound', icon: VolumeX, checked: soundOn, shortcut: 'M', onClick: toggleSound },
        ],
      },
      {
        label: 'Help',
        items: [{ label: `How to Play ${info.name}`, icon: CircleHelp, shortcut: 'F1', onClick: () => openCard('help') }],
      },
    ])
  }, [win, phase, soundOn, info.name, newGame, togglePause, openCard, toggleSound])

  // ---- the cards over the playfield

  const best = scores[0]?.score ?? 0
  let overlay: ReactNode = null
  if (card === 'help') overlay = <HelpCard info={info} onClose={closeCard} />
  else if (card === 'scores')
    overlay = <ScoresCard scores={scores} highlight={result?.saved ? result.rank : -1} onClose={closeCard} onClear={() => void resetScores()} />
  else if (phase === 'ready') overlay = <StartCard info={info} best={best} onStart={play} />
  else if (phase === 'paused') overlay = <PauseCard onResume={play} onNewGame={() => void newGame()} />
  else if (phase === 'over' && result)
    overlay = <OverCard result={result} best={best} onSave={saveScore} onAgain={playAgain} onScores={() => openCard('scores')} />

  return (
    <div
      ref={rootRef}
      className={`k-app mg-app ${className ?? ''}${phase === 'playing' && !card ? ' mg-playing' : ''}${info.hideCursor ? ' mg-hide-cursor' : ''}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
    >
      <div ref={stageRef} className="mg-stage" onPointerMove={onPointerMove} onPointerDown={onPointerDown}>
        <div ref={screenRef} className="mg-screen">
          <canvas ref={canvasRef} className="mg-canvas" />
          {overlay}
        </div>
      </div>
      <aside className="mg-panel">
        <div className="mg-brand">{info.name}</div>
        {panel}
        <div className="mg-panel-foot">
          <button className="k-btn small" onMouseDown={keepFocus} onClick={togglePause} disabled={phase === 'over'}>
            {phase === 'playing' ? <Pause size={13} /> : <Play size={13} />}
            {phase === 'playing' ? 'Pause' : phase === 'paused' ? 'Resume' : 'Start'}
          </button>
          <button className="k-btn small" title="New Game (N)" aria-label="New Game" onMouseDown={keepFocus} onClick={() => void newGame()}>
            <RotateCcw size={13} />
          </button>
        </div>
      </aside>
    </div>
  )
}

// ------------------------------------------------------------------- cards

function StartCard({ info, best, onStart }: { info: GameInfo; best: number; onStart: () => void }) {
  return (
    <div className="mg-overlay">
      <div className="mg-card">
        <div className="mg-title">{info.name}</div>
        <div className="mg-press mg-blink">
          Press <kbd className="mg-key">Space</kbd> to start
        </div>
        <dl className="mg-controls">
          {info.controls.map(([keys, what]) => (
            <div key={keys} className="mg-control">
              <dt>{keys.split(' ').map((k) => <kbd key={k} className="mg-key">{k}</kbd>)}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        {best > 0 && (
          <div className="mg-muted">
            Best <b className="mg-num">{fmt(best)}</b>
          </div>
        )}
        <button className="k-btn primary" onMouseDown={keepFocus} onClick={onStart}>
          <Play size={14} /> Start
        </button>
      </div>
    </div>
  )
}

function PauseCard({ onResume, onNewGame }: { onResume: () => void; onNewGame: () => void }) {
  return (
    <div className="mg-overlay">
      <div className="mg-card">
        <div className="mg-title">Paused</div>
        <div className="mg-press">
          Press <kbd className="mg-key">P</kbd> or <kbd className="mg-key">Space</kbd> to resume
        </div>
        <div className="mg-buttons">
          <button className="k-btn" onMouseDown={keepFocus} onClick={onNewGame}>
            <RotateCcw size={14} /> New Game
          </button>
          <button className="k-btn primary" onMouseDown={keepFocus} onClick={onResume}>
            <Play size={14} /> Resume
          </button>
        </div>
      </div>
    </div>
  )
}

interface OverProps {
  result: Result
  best: number
  onSave: (name: string) => void
  onAgain: () => void
  onScores: () => void
}

function OverCard({ result, best, onSave, onAgain, onScores }: OverProps) {
  const [name, setName] = useState(() => lastName())
  const input = useRef<HTMLInputElement>(null)
  const entering = result.rank >= 0 && !result.saved

  // A moment's wait, so a key still held from the game doesn't land in the name.
  useEffect(() => {
    if (!entering) return
    const t = window.setTimeout(() => {
      input.current?.focus()
      input.current?.select()
    }, 400)
    return () => window.clearTimeout(t)
  }, [entering])

  return (
    <div className="mg-overlay">
      <div className="mg-card">
        <div className="mg-title mg-danger">Game Over</div>
        <div className="mg-final">{fmt(result.score)}</div>
        {result.summary && <div className="mg-muted">{result.summary}</div>}
        {entering ? (
          <form
            className="mg-entry"
            onSubmit={(e) => {
              e.preventDefault()
              onSave(name)
            }}
          >
            <div className="mg-new">
              <Trophy size={14} /> New high score — #{result.rank + 1}
            </div>
            <div className="mg-entry-row">
              <input
                ref={input}
                className="k-input mg-name"
                value={name}
                maxLength={16}
                placeholder="Your name"
                aria-label="Your name"
                spellCheck={false}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    onSave(name)
                  }
                }}
              />
              <button type="submit" className="k-btn primary small" onMouseDown={keepFocus}>
                Save
              </button>
            </div>
          </form>
        ) : (
          <>
            {result.saved && result.rank >= 0 ? (
              <div className="mg-new">
                <Trophy size={14} /> #{result.rank + 1} in the high scores
              </div>
            ) : (
              best > 0 && (
                <div className="mg-muted">
                  Best <b className="mg-num">{fmt(best)}</b>
                </div>
              )
            )}
            <div className="mg-press mg-blink">
              Press <kbd className="mg-key">Space</kbd> to play again
            </div>
            <div className="mg-buttons">
              <button className="k-btn" onMouseDown={keepFocus} onClick={onScores}>
                <Trophy size={14} /> Scores
              </button>
              <button className="k-btn primary" onMouseDown={keepFocus} onClick={onAgain}>
                <RotateCcw size={14} /> Play Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ScoresCard({ scores, highlight, onClose, onClear }: { scores: HighScore[]; highlight: number; onClose: () => void; onClear: () => void }) {
  return (
    <div className="mg-overlay">
      <div className="mg-card mg-scores">
        <div className="mg-title mg-small">
          <Trophy size={16} /> High Scores
        </div>
        {scores.length ? (
          <ol className="mg-table">
            {scores.map((s, i) => (
              <li key={`${s.date}-${i}`} className={i === highlight ? 'mg-hl' : undefined} title={new Date(s.date).toLocaleString()}>
                <span className="mg-rank">{i + 1}</span>
                <span className="mg-who">
                  <span className="mg-who-name">{s.name}</span>
                  {s.summary && <span className="mg-who-sum">{s.summary}</span>}
                </span>
                <span className="mg-pts">{fmt(s.score)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mg-muted">No scores yet. Be the first!</p>
        )}
        <div className="mg-buttons">
          <button className="k-btn small" onMouseDown={keepFocus} onClick={onClear} disabled={!scores.length}>
            Clear…
          </button>
          <button className="k-btn small primary" onMouseDown={keepFocus} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function HelpCard({ info, onClose }: { info: GameInfo; onClose: () => void }) {
  return (
    <div className="mg-overlay">
      <div className="mg-card mg-help">
        <div className="mg-title mg-small">How to Play</div>
        <div className="mg-help-body">{info.help}</div>
        <div className="mg-help-keys">
          <kbd className="mg-key">P</kbd> pause · <kbd className="mg-key">N</kbd> new game · <kbd className="mg-key">H</kbd> scores ·{' '}
          <kbd className="mg-key">M</kbd> sound
        </div>
        <button className="k-btn small primary" onMouseDown={keepFocus} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
