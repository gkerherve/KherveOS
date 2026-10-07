// Flappy Khervey (KherveFitting's Flappybird.py, "Khervey the Flappy Bird"):
// flap through the pipes, shoot the enemy birds and bees, watch the day go
// by. The rules are in flappyRules.ts, the drawing and sounds in
// flappyEngine.ts; this is the window, with the difficulty picker.

import { useCallback, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo, type Phase } from './GameShell'
import { fmt } from './fx'
import { DIFFICULTIES, POINTS, STAGES, STEP, type Difficulty, type Flappy as Rules } from './flappyRules'
import { FlappyEngine, H, W } from './flappyEngine'
import './ports.css'

interface Stats {
  score: number
  stage: number
  difficulty: Difficulty
  phase: Phase
}

const read = (g: Rules, phase: Phase): Stats => ({ score: g.score, stage: g.stage, difficulty: g.difficulty, phase })

const same = (a: Stats, b: Stats) => a.score === b.score && a.stage === b.stage && a.difficulty === b.difficulty && a.phase === b.phase

const LEVELS = Object.keys(DIFFICULTIES) as Difficulty[]

const INFO: GameInfo = {
  id: 'flappy',
  name: 'Flappy Khervey',
  width: W,
  height: H,
  step: STEP,
  controls: [
    ['↑', 'Flap (or click)'],
    ['Space', 'Hold to shoot'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>Help Khervey fly between the pipes. Each pipe you pass is a point. Don't touch the pipes or the ground.</p>
      <h4>Controls</h4>
      <ul>
        <li><kbd className="mg-key">↑</kbd> (or <kbd className="mg-key">W</kbd>, or a click) flaps</li>
        <li>Hold <kbd className="mg-key">Space</kbd> (or <kbd className="mg-key">X</kbd>) to shoot</li>
      </ul>
      <h4>Enemies</h4>
      <ul>
        <li>Enemy birds fly against you: up when you fall, down when you climb. Shoot one for {POINTS.enemy} points.</li>
        <li>Bees hover along. Shoot one for {POINTS.bee} points.</li>
        <li>Flying into either ends the game.</li>
      </ul>
      <h4>Difficulty</h4>
      <p>Pick it in the side panel before you start: harder means faster pipes, narrower gaps and more enemies. New stages at {STAGES.slice(0, 4).join(', ')}… points.</p>
    </>
  ),
}

export default function Flappy({ win }: AppProps) {
  const [engine] = useState(() => new FlappyEngine())
  const [stats, setStats] = useState(() => read(engine.game, 'ready'))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  const onFrame = useCallback(() => {
    const s = read(engine.game, engine.phase)
    if (!same(s, last.current)) {
      last.current = s
      setStats(s)
    }
  }, [engine])

  // The difficulty can change between games, not during one.
  const canPick = stats.phase === 'ready' || stats.phase === 'over'
  const pick = (d: Difficulty) => {
    if (!canPick || d === engine.game.difficulty) return
    engine.setDifficulty(d)
    onFrame()
  }

  const best = Math.max(scores[0]?.score ?? 0, stats.score)

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <Stat label="Stage" value={stats.stage} />
      <div className="mg-stat">
        <span className="mg-label">Difficulty</span>
        <div className="mg-lights" role="radiogroup" aria-label="Difficulty">
          {LEVELS.map((d) => (
            <button
              key={d}
              role="radio"
              aria-checked={stats.difficulty === d}
              className={`mg-light${stats.difficulty === d ? ' mg-on' : ''}`}
              style={{ cursor: canPick ? 'pointer' : 'default', opacity: canPick || stats.difficulty === d ? 1 : 0.5 }}
              title={canPick ? `${DIFFICULTIES[d].label}: pipes ${DIFFICULTIES[d].pipeSpeed}, gap ${DIFFICULTIES[d].pipeGap}` : 'Change it between games'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(d)}
            >
              {DIFFICULTIES[d].label[0]}
            </button>
          ))}
        </div>
        <span className="mg-hint">{DIFFICULTIES[stats.difficulty].label}</span>
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-hint">
        <kbd className="mg-key">↑</kbd> or click to flap
        <br />
        Hold <kbd className="mg-key">Space</kbd> to shoot
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} className="mg-flappy" />
}
