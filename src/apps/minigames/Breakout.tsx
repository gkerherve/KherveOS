// Breakout: knock out every brick with the ball. The paddle follows the mouse
// or the arrow keys, where the ball lands on it sets the angle, and some
// bricks drop power-ups: a wider paddle, more balls, a slower ball, an extra
// ball. The rules are in breakout.ts, the drawing and sounds in
// breakoutEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import type { Breakout as Rules } from './breakoutRules'
import { BreakoutEngine, H, POWERS, W } from './breakoutEngine'

interface Stats {
  score: number
  level: number
  name: string
  lives: number
  wide: number
  slow: number
  balls: number
}

function readStats(g: Rules): Stats {
  return {
    score: g.score,
    level: g.level,
    name: g.name,
    lives: g.lives,
    wide: Math.ceil(g.wideTime),
    slow: Math.ceil(g.slowTime),
    balls: g.balls.length,
  }
}

const same = (a: Stats, b: Stats) =>
  a.score === b.score && a.level === b.level && a.lives === b.lives && a.wide === b.wide && a.slow === b.slow && a.balls === b.balls

const INFO: GameInfo = {
  id: 'breakout',
  name: 'Breakout',
  width: W,
  height: H,
  step: 1 / 120,
  hideCursor: true,
  controls: [
    ['← →', 'Move the paddle'],
    ['Mouse', 'Or just move the mouse'],
    ['Space', 'Launch the ball'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>Bounce the ball off your paddle and knock out every brick to reach the next level. Miss the ball and you lose it; you have three.</p>
      <h4>Controls</h4>
      <ul>
        <li>Move the mouse, or hold <kbd className="mg-key">←</kbd> <kbd className="mg-key">→</kbd> (or <kbd className="mg-key">A</kbd> <kbd className="mg-key">D</kbd>)</li>
        <li><kbd className="mg-key">Space</kbd>, <kbd className="mg-key">↑</kbd> or a click launches the ball</li>
        <li>The middle of the paddle sends the ball straight up, the ends send it off to the side</li>
      </ul>
      <h4>Bricks</h4>
      <ul>
        <li>Coloured bricks break at once: the higher rows are worth more</li>
        <li>Silver bricks take two or three hits; brass ones never break</li>
      </ul>
      <h4>Power-ups</h4>
      <ul>
        <li><b style={{ color: POWERS.wide.color }}>W</b> wider paddle for 15 s · <b style={{ color: POWERS.multi.color }}>M</b> three balls ·{' '}
          <b style={{ color: POWERS.slow.color }}>S</b> slower ball for 10 s · <b style={{ color: POWERS.life.color }}>+1</b> an extra ball</li>
      </ul>
      <p>The ball speeds up as a rally goes on and with each level. Clearing a level is worth 1,000 × the level.</p>
    </>
  ),
}

export default function Breakout({ win }: AppProps) {
  const [engine] = useState(() => new BreakoutEngine())
  const [stats, setStats] = useState(() => readStats(engine.game))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  useEffect(() => {
    engine.accent = themeColor(document.documentElement, '--k-accent', engine.accent)
  }, [engine])

  const onFrame = useCallback(() => {
    const s = readStats(engine.game)
    if (!same(s, last.current)) {
      last.current = s
      setStats(s)
    }
  }, [engine])

  const best = Math.max(scores[0]?.score ?? 0, stats.score)
  const aiState = () => {
    const s = readStats(engine.game)
    return { level: s.level, level_name: s.name, lives: s.lives, balls: s.balls, wide_paddle_s: s.wide, slow_ball_s: s.slow }
  }

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-stat">
        <span className="mg-label">Level {stats.level}</span>
        <span className="mg-level-name">{stats.name}</span>
      </div>
      <div className="mg-stat">
        <span className="mg-label">Balls</span>
        <div className="mg-lives" aria-label={`${stats.lives} balls left`}>
          {Array.from({ length: Math.max(3, stats.lives) }, (_, i) => (
            <span key={i} className={`mg-life${i < stats.lives ? '' : ' mg-off'}`} />
          ))}
        </div>
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-stat">
        <span className="mg-label">Power-ups</span>
        <div className="mg-badges">
          {stats.wide > 0 && (
            <span className="mg-badge">
              <i style={{ background: POWERS.wide.color }} /> Wide {stats.wide}s
            </span>
          )}
          {stats.slow > 0 && (
            <span className="mg-badge">
              <i style={{ background: POWERS.slow.color }} /> Slow {stats.slow}s
            </span>
          )}
          {stats.balls > 1 && (
            <span className="mg-badge">
              <i style={{ background: POWERS.multi.color }} /> {stats.balls} balls
            </span>
          )}
          {stats.wide === 0 && stats.slow === 0 && stats.balls <= 1 && <span className="mg-hint">None yet</span>}
        </div>
      </div>
      <div className="mg-hint">
        Mouse or <kbd className="mg-key">←</kbd><kbd className="mg-key">→</kbd> to move
        <br />
        <kbd className="mg-key">Space</kbd> or click to launch
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} aiState={aiState} className="mg-breakout" />
}
