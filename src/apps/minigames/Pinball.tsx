// Pinball: one table with gravity, two flippers and a plunger, pop bumpers,
// slingshots, drop and standup targets, and the K·OS rollover lanes that
// raise the bonus multiplier. Three balls, a ball save at the start of each.
// The table and rules are in pinball.ts (collisions in physics.ts), the
// drawing and sounds in pinballEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import type { Pinball as Rules } from './pinballRules'
import { H, PinballEngine, W } from './pinballEngine'

interface Stats {
  score: number
  ball: number
  bonus: number
  multiplier: number
  save: boolean
  superOn: boolean
  lanes: string
}

function readStats(g: Rules): Stats {
  return {
    score: g.score,
    ball: g.ballNumber,
    bonus: g.state === 'drain' ? g.tally.bonus : g.bonus,
    multiplier: g.state === 'drain' ? g.tally.multiplier : g.multiplier,
    save: g.saveTime > 0,
    superOn: g.superTime > 0,
    lanes: g.lanes.map((l) => (l ? '1' : '0')).join(''),
  }
}

const same = (a: Stats, b: Stats) =>
  a.score === b.score && a.ball === b.ball && a.bonus === b.bonus && a.multiplier === b.multiplier &&
  a.save === b.save && a.superOn === b.superOn && a.lanes === b.lanes

const INFO: GameInfo = {
  id: 'pinball',
  name: 'Pinball',
  width: W,
  height: H,
  step: 1 / 240,
  controls: [
    ['Z ⇧ ←', 'Left flipper'],
    ['/ ⇧ →', 'Right flipper'],
    ['Space', 'Hold, then let go to shoot'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>Keep the ball on the table with the flippers and score as much as you can with three balls.</p>
      <h4>Controls</h4>
      <ul>
        <li>Left flipper: <kbd className="mg-key">Z</kbd>, left <kbd className="mg-key">Shift</kbd> or <kbd className="mg-key">←</kbd></li>
        <li>Right flipper: <kbd className="mg-key">/</kbd>, right <kbd className="mg-key">Shift</kbd> or <kbd className="mg-key">→</kbd></li>
        <li>Plunger: hold <kbd className="mg-key">Space</kbd> (or <kbd className="mg-key">↓</kbd>) to pull it back, let go to shoot — the longer you hold, the harder the shot</li>
        <li>Hold a flipper up to catch the ball, then let it roll and flip at the right moment to aim</li>
      </ul>
      <h4>The table</h4>
      <ul>
        <li><b>K·OS lanes</b> at the top: light all three to raise the bonus multiplier (up to 5×). The flippers move the lit lanes.</li>
        <li><b>Skill shot</b>: plunge the ball into the blinking lane for 5,000.</li>
        <li><b>Drop targets</b> (left): knock all three down for <b>Super Bumpers</b> — 500 a hit for 20 s.</li>
        <li><b>Standup targets</b> (right): light all three for a 15,000 jackpot.</li>
        <li>Bumpers 100, slingshots 10, inlanes 1,000.</li>
      </ul>
      <h4>Bonus and ball save</h4>
      <p>Lanes, targets and inlanes build the bonus, paid times the multiplier when the ball drains. For the first seconds of each ball, "Shoot again" is lit: a ball lost then comes back.</p>
    </>
  ),
}

export default function Pinball({ win }: AppProps) {
  const [engine] = useState(() => new PinballEngine())
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

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Ball" value={`${stats.ball}/3`} />
        <Stat label="Bonus" value={fmt(stats.bonus)} />
      </div>
      <div className="mg-stat">
        <span className="mg-label">Multiplier</span>
        <div className="mg-lights">
          {[2, 3, 4, 5].map((m) => (
            <span key={m} className={`mg-light${stats.multiplier >= m ? ' mg-on' : ''}`}>{m}×</span>
          ))}
        </div>
      </div>
      <div className="mg-stat">
        <span className="mg-label">Lanes</span>
        <div className="mg-lights">
          {['K', 'O', 'S'].map((l, i) => (
            <span key={l} className={`mg-light${stats.lanes[i] === '1' ? ' mg-on' : ''}`}>{l}</span>
          ))}
        </div>
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-badges">
        {stats.save && <span className="mg-badge"><i /> Ball save</span>}
        {stats.superOn && <span className="mg-badge"><i /> Super bumpers</span>}
      </div>
      <div className="mg-hint">
        <kbd className="mg-key">Z</kbd> <kbd className="mg-key">/</kbd> flippers
        <br />
        <kbd className="mg-key">Space</kbd> plunger
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} className="mg-pinball" />
}
