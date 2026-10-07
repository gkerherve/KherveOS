// Solitaire (KherveFitting's Solitaire.py, "Kherve Solitaire"): Klondike,
// drawing one card at a time. Drag cards, or click one to send it where it
// fits. The rules are in solitaireRules.ts, the cards in solitaireCards.ts,
// the table and its animations in solitaireEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Flag, Undo2, Wand2 } from 'lucide-react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo, type Phase } from './GameShell'
import { fmt, themeColor } from './fx'
import { POINTS, type Solitaire as Rules } from './solitaireRules'
import { H, SolitaireEngine, W } from './solitaireEngine'
import './ports.css'

interface Stats {
  score: number
  moves: number
  time: number
  up: number
  canUndo: boolean
  phase: Phase
}

const read = (g: Rules, phase: Phase): Stats => ({
  score: g.score,
  moves: g.moves,
  time: Math.floor(g.elapsed),
  up: g.foundations.reduce((n, f) => n + f.length, 0),
  canUndo: g.canUndo,
  phase,
})

const same = (a: Stats, b: Stats) => (Object.keys(a) as (keyof Stats)[]).every((k) => a[k] === b[k])

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault()

const INFO: GameInfo = {
  id: 'solitaire',
  name: 'Solitaire',
  width: W,
  height: H,
  step: 1 / 60,
  controls: [
    ['Mouse', 'Drag cards, or click one'],
    ['Space', 'Draw from the stock'],
    ['U', 'Undo'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>Build the four foundations (top right) up by suit, from ace to king.</p>
      <h4>The table</h4>
      <ul>
        <li>Build the seven columns down in alternating colours: a red 6 on a black 7. Move a card with the cards on it.</li>
        <li>Only a king (with its cards) goes into an empty column</li>
        <li>Click the stock (top left) to turn up one card. When it is empty, click it again to turn the waste back over.</li>
        <li>A card left face down at the bottom of a column turns up by itself</li>
      </ul>
      <h4>Mouse and keys</h4>
      <ul>
        <li>Drag cards where they go, or click a card to send it to a foundation, or else to a column that takes it</li>
        <li>Right-click (or <kbd className="mg-key">A</kbd>) sends the next card that can go to a foundation</li>
        <li><kbd className="mg-key">Space</kbd> or <kbd className="mg-key">D</kbd> draws · <kbd className="mg-key">U</kbd> or <kbd className="mg-key">Z</kbd> undoes · <kbd className="mg-key">G</kbd> gives up and keeps your points</li>
        <li>Once every card is face up, the rest goes up by itself</li>
      </ul>
      <h4>Points</h4>
      <p>
        To a foundation {POINTS.toFoundation} · waste to a column {POINTS.wasteToTableau} · turning a card up {POINTS.flip} · a card back off a
        foundation {POINTS.fromFoundation} · turning the waste over {POINTS.recycle}. Winning adds {POINTS.win}, plus 2 a second under ten minutes.
      </p>
    </>
  ),
}

export default function Solitaire({ win }: AppProps) {
  const [engine] = useState(() => new SolitaireEngine())
  const [stats, setStats] = useState(() => read(engine.game, 'ready'))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  useEffect(() => {
    engine.accent = themeColor(document.documentElement, '--k-accent', engine.accent)
  }, [engine])

  // Drags carry on outside the table, and a right-click sends a card up
  // (the shell only passes on presses of the left button).
  useEffect(() => {
    const move = (e: PointerEvent) => engine.clientMove(e.clientX, e.clientY)
    const up = (e: PointerEvent) => {
      engine.clientMove(e.clientX, e.clientY)
      engine.clientUp()
    }
    const cancel = () => engine.releaseAll()
    const menu = (e: MouseEvent) => {
      if (!engine.canvas || e.target !== engine.canvas) return
      e.preventDefault()
      if (engine.phase === 'playing') engine.autoMove()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('contextmenu', menu)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('contextmenu', menu)
    }
  }, [engine])

  const onFrame = useCallback(() => {
    const s = read(engine.game, engine.phase)
    if (!same(s, last.current)) {
      last.current = s
      setStats(s)
    }
  }, [engine])

  const playing = stats.phase === 'playing'
  const best = Math.max(scores[0]?.score ?? 0, stats.score)

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Time" value={clock(stats.time)} />
        <Stat label="Moves" value={stats.moves} />
      </div>
      <div className="mg-stat">
        <span className="mg-label">Foundations</span>
        <div className="mg-meter" role="meter" aria-valuenow={stats.up} aria-valuemin={0} aria-valuemax={52}>
          <i style={{ width: `${(stats.up / 52) * 100}%` }} />
        </div>
        <span className="mg-hint">{stats.up} of 52 cards</span>
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-tools">
        <button className="k-btn small" title="Undo (U)" onMouseDown={keepFocus} disabled={!playing || !stats.canUndo} onClick={() => engine.undo()}>
          <Undo2 size={13} /> Undo
        </button>
        <button className="k-btn small" title="Send a card to a foundation (A or right-click)" onMouseDown={keepFocus} disabled={!playing} onClick={() => engine.autoMove()}>
          <Wand2 size={13} /> Auto
        </button>
        <button className="k-btn small" title="Give up and keep the points (G)" onMouseDown={keepFocus} disabled={!playing} onClick={() => engine.resign()}>
          <Flag size={13} /> Give up
        </button>
      </div>
      <div className="mg-hint">
        Drag, or click a card
        <br />
        <kbd className="mg-key">Space</kbd> draw · <kbd className="mg-key">U</kbd> undo
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} className="mg-solitaire" />
}
