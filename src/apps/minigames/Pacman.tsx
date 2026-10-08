// Pac-Man: eat every dot in the maze, dodge the four ghosts (each one hunts
// differently) and turn the tables with a power pellet. The rules are in
// pacmanRules.ts, the drawing and sounds in pacmanEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import { FRUITS, START_LIVES, fruitFor, type Pacman as Rules } from './pacmanRules'
import { H, PacmanEngine, W, drawFruit } from './pacmanEngine'

/** The level's fruit, drawn small. */
function FruitIcon({ level }: { level: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = 26 * dpr
    canvas.height = 26 * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, 26, 26)
    drawFruit(ctx, 13, 13, fruitFor(level), 10)
  }, [level])
  return <canvas ref={ref} className="mg-fruit" width={26} height={26} aria-hidden />
}

interface Stats {
  score: number
  level: number
  lives: number
  dots: number
  power: number
}

function readStats(g: Rules): Stats {
  return { score: g.score, level: g.level, lives: g.lives, dots: g.dotsLeft, power: Math.ceil(g.fright) }
}

const same = (a: Stats, b: Stats) =>
  a.score === b.score && a.level === b.level && a.lives === b.lives && a.dots === b.dots && a.power === b.power

const INFO: GameInfo = {
  id: 'pacman',
  name: 'Pac-Man',
  width: W,
  height: H,
  step: 1 / 120,
  controls: [
    ['← → ↑ ↓', 'Steer Pac-Man'],
    ['W A S D', 'Or steer with these'],
    ['P', 'Pause'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>Eat every dot in the maze without being caught. Touch a ghost and you lose a life; you have three. Clear the maze to reach the next level.</p>
      <h4>Controls</h4>
      <ul>
        <li><kbd className="mg-key">←</kbd> <kbd className="mg-key">→</kbd> <kbd className="mg-key">↑</kbd> <kbd className="mg-key">↓</kbd> (or <kbd className="mg-key">W</kbd> <kbd className="mg-key">A</kbd> <kbd className="mg-key">S</kbd> <kbd className="mg-key">D</kbd>) choose where to go</li>
        <li>Press early: Pac-Man takes the turn as soon as there is one. Reversing is instant.</li>
        <li>The tunnel on the middle row leads out of one side and in at the other, and slows the ghosts.</li>
      </ul>
      <h4>The ghosts</h4>
      <ul>
        <li><b>Blinky</b> (red) chases you; he speeds up when few dots are left</li>
        <li><b>Pinky</b> (pink) aims ahead of you</li>
        <li><b>Inky</b> (cyan) flanks you, working with Blinky</li>
        <li><b>Clyde</b> (orange) chases from afar, then gets shy up close</li>
        <li>They take turns hunting and retreating to their corners</li>
      </ul>
      <h4>Scoring</h4>
      <ul>
        <li>Dot 10 · power pellet 50</li>
        <li>Blue ghosts after a power pellet: 200, 400, 800, 1600 in a row. Eaten ghosts run home as eyes.</li>
        <li>Fruit appears twice a level: 100 (cherry) up to 5000 (key)</li>
        <li>An extra life at 10,000 points</li>
      </ul>
    </>
  ),
}

export default function Pacman({ win }: AppProps) {
  const [engine] = useState(() => new PacmanEngine())
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
    const g = engine.game
    const tile = (a: { x: number; y: number }) => ({ x: Math.round(a.x), y: Math.round(a.y) })
    return {
      level: g.level,
      lives: g.lives,
      dots_left: g.dotsLeft,
      power_s: Math.ceil(g.fright),
      mode: g.mode,
      pacman: tile(g.pac),
      ghosts: g.ghosts.map((x) => ({ name: x.name, state: x.state, frightened: x.frightened, ...tile(x) })),
    }
  }

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-stat">
        <span className="mg-label">Level {stats.level}</span>
        <span className="mg-level-name">
          <FruitIcon level={stats.level} /> {FRUITS[fruitFor(stats.level)].name}
        </span>
      </div>
      <div className="mg-stat">
        <span className="mg-label">Lives</span>
        <div className="mg-lives" aria-label={`${stats.lives} lives`}>
          {Array.from({ length: Math.max(START_LIVES, stats.lives) }, (_, i) => (
            <span key={i} className={`mg-pac-life${i < stats.lives ? '' : ' mg-off'}`} />
          ))}
        </div>
      </div>
      <Stat label="Best" value={fmt(best)} />
      <Stat label="Dots left" value={stats.dots} />
      <div className="mg-stat">
        <span className="mg-label">Power</span>
        <div className="mg-badges">
          {stats.power > 0 ? (
            <span className="mg-badge">
              <i style={{ background: '#2b3dff' }} /> Ghosts scared {stats.power}s
            </span>
          ) : (
            <span className="mg-hint">Eat a big pellet</span>
          )}
        </div>
      </div>
      <div className="mg-hint">
        <kbd className="mg-key">←</kbd><kbd className="mg-key">→</kbd><kbd className="mg-key">↑</kbd><kbd className="mg-key">↓</kbd> to steer
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} aiState={aiState} className="mg-pacman" />
}
