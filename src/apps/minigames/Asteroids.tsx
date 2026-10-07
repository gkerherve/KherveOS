// Meteor Smash (KherveFitting's Asteroid.py): steer a little ship through a
// field of meteors and shoot them to pieces; big ones split in two. The rules
// are in asteroidsRules.ts, the drawing and sounds in asteroidsEngine.ts;
// this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import type { Asteroids as Rules } from './asteroidsRules'
import { STEP, START_LIVES, rockPoints } from './asteroidsRules'
import { AsteroidsEngine, H, ROCK_COLORS, W } from './asteroidsEngine'

interface Stats {
  score: number
  wave: number
  lives: number
  rocks: number
  shield: boolean
}

const readStats = (g: Rules): Stats => ({ score: g.score, wave: g.wave, lives: g.lives, rocks: g.rocks.length, shield: g.shield > 0 })

const same = (a: Stats, b: Stats) =>
  a.score === b.score && a.wave === b.wave && a.lives === b.lives && a.rocks === b.rocks && a.shield === b.shield

const INFO: GameInfo = {
  id: 'asteroids',
  name: 'Meteor Smash',
  width: W,
  height: H,
  step: STEP,
  controls: [
    ['← →', 'Turn'],
    ['↑', 'Thrust'],
    ['Space', 'Shoot'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>Shoot the meteors before they hit your ship. Big ones break into two medium ones, medium into two small ones, small ones into dust.</p>
      <h4>Controls</h4>
      <ul>
        <li><kbd className="mg-key">←</kbd> <kbd className="mg-key">→</kbd> (or <kbd className="mg-key">A</kbd> <kbd className="mg-key">D</kbd>) turn the ship</li>
        <li><kbd className="mg-key">↑</kbd> (or <kbd className="mg-key">W</kbd>) fires the engine: the ship keeps drifting, slowly losing speed</li>
        <li><kbd className="mg-key">Space</kbd> (or <kbd className="mg-key">F</kbd>) shoots, one shot per press</li>
        <li>Everything wraps around: off one edge, back in at the other</li>
      </ul>
      <h4>Points</h4>
      <ul>
        <li><b style={{ color: ROCK_COLORS[3] }}>Large</b> {rockPoints(3)} · <b style={{ color: ROCK_COLORS[2] }}>medium</b> {rockPoints(2)} ·{' '}
          <b style={{ color: ROCK_COLORS[1] }}>small</b> {rockPoints(1)}</li>
        <li>Clear the screen for the next wave: five meteors, plus one more for every 1,000 points</li>
      </ul>
      <p>You have {START_LIVES} ships. A new ship blinks for a moment: nothing can hit it yet.</p>
    </>
  ),
}

export default function Asteroids({ win }: AppProps) {
  const [engine] = useState(() => new AsteroidsEngine())
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
    return { wave: s.wave, lives: s.lives, meteors: s.rocks, shield: s.shield }
  }

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Wave" value={stats.wave} />
        <Stat label="Meteors" value={stats.rocks} />
      </div>
      <div className="mg-stat">
        <span className="mg-label">Ships</span>
        <div className="mg-lives" aria-label={`${stats.lives} ships left`}>
          {Array.from({ length: Math.max(START_LIVES, stats.lives) }, (_, i) => (
            <span key={i} className={`mg-life${i < stats.lives ? '' : ' mg-off'}`} />
          ))}
        </div>
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-badges">{stats.shield && <span className="mg-badge"><i /> Shield</span>}</div>
      <div className="mg-hint">
        <kbd className="mg-key">←</kbd><kbd className="mg-key">→</kbd> turn · <kbd className="mg-key">↑</kbd> thrust
        <br />
        <kbd className="mg-key">Space</kbd> shoot
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} aiState={aiState} className="mg-asteroids" />
}
