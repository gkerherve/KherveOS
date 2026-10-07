// Tetris: bright bevelled blocks in a black well with a green glow, a ghost
// piece, hold and a three-piece preview, and the modern rules (SRS turns and
// wall kicks, 7-bag, lock delay, T-spins, back-to-back). The rules are in
// tetris.ts, the drawing and sounds in tetrisEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import type { Kind, Tetris as Rules } from './tetrisRules'
import { H, TetrisEngine, W, drawPieceIn } from './tetrisEngine'

// ------------------------------------------------------------ side panel

/** A small canvas showing pieces, one letter each (the hold box and the next queue). */
function Preview({ pieces, height, dim }: { pieces: string; height: number; dim?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const kinds = pieces.split('') as Kind[]
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.globalAlpha = dim ? 0.35 : 1
      // The first piece is shown larger than the ones after it.
      const slots = kinds.length === 1 ? [{ y: h / 2, s: 15 }] : [{ y: h * 0.19, s: 15 }, { y: h * 0.53, s: 12 }, { y: h * 0.82, s: 12 }]
      kinds.forEach((k, i) => slots[i] && drawPieceIn(ctx, k, w / 2, slots[i].y, slots[i].s))
      ctx.globalAlpha = 1
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [pieces, dim])

  return <canvas ref={ref} className="mg-preview" style={{ height }} />
}

interface Stats {
  score: number
  level: number
  lines: number
  hold: Kind | null
  canHold: boolean
  next: string
}

function readStats(g: Rules): Stats {
  return { score: g.score, level: g.level, lines: g.lines, hold: g.hold, canHold: g.canHold, next: g.next.join('') }
}

const INFO: GameInfo = {
  id: 'tetris',
  name: 'Tetris',
  width: W,
  height: H,
  step: 1 / 120,
  controls: [
    ['← →', 'Move'],
    ['↑ X', 'Turn right'],
    ['Z', 'Turn left'],
    ['↓', 'Soft drop'],
    ['Space', 'Hard drop'],
    ['C ⇧', 'Hold'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>Fit the falling pieces together. A full row disappears; let the stack reach the top and the game is over.</p>
      <h4>Controls</h4>
      <ul>
        <li><kbd className="mg-key">←</kbd> <kbd className="mg-key">→</kbd> move (hold to slide)</li>
        <li><kbd className="mg-key">↑</kbd> or <kbd className="mg-key">X</kbd> turn right, <kbd className="mg-key">Z</kbd> turn left — pieces kick off walls and the stack</li>
        <li><kbd className="mg-key">↓</kbd> soft drop, <kbd className="mg-key">Space</kbd> hard drop</li>
        <li><kbd className="mg-key">C</kbd> or <kbd className="mg-key">Shift</kbd> hold the piece for later (once per piece)</li>
      </ul>
      <h4>Scoring</h4>
      <ul>
        <li>Single 100 · Double 300 · Triple 500 · Tetris 800, times the level</li>
        <li>T-spins score more; a Tetris or T-spin right after another is worth 1.5×</li>
        <li>Clearing lines piece after piece builds a combo; an empty well is an All Clear</li>
        <li>Soft drop 1 point a row, hard drop 2</li>
      </ul>
      <p>Every 10 lines the level goes up and the pieces fall faster. A piece resting on the stack locks after half a second.</p>
    </>
  ),
}

export default function Tetris({ win }: AppProps) {
  const [engine] = useState(() => new TetrisEngine())
  const [stats, setStats] = useState(() => readStats(engine.game))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  useEffect(() => {
    engine.accent = themeColor(document.documentElement, '--k-accent', engine.accent)
  }, [engine])

  const onFrame = useCallback(() => {
    const s = readStats(engine.game)
    const l = last.current
    if (s.score !== l.score || s.level !== l.level || s.lines !== l.lines || s.hold !== l.hold || s.canHold !== l.canHold || s.next !== l.next) {
      last.current = s
      setStats(s)
    }
  }, [engine])

  const best = Math.max(scores[0]?.score ?? 0, stats.score)

  const panel = (
    <>
      <div className="mg-box">
        <span className="mg-label">Hold</span>
        <Preview pieces={stats.hold ?? ''} height={44} dim={!stats.canHold} />
      </div>
      <div className="mg-box">
        <span className="mg-label">Next</span>
        <Preview pieces={stats.next} height={128} />
      </div>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Level" value={stats.level} />
        <Stat label="Lines" value={stats.lines} />
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-hint">
        <kbd className="mg-key">←</kbd><kbd className="mg-key">→</kbd> move · <kbd className="mg-key">↑</kbd> turn
        <br />
        <kbd className="mg-key">Space</kbd> drop · <kbd className="mg-key">C</kbd> hold
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} className="mg-tetris" />
}
