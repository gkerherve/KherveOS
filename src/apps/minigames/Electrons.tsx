// The Electron Game (KherveFitting's MiniGame.py): electrons pulling on each
// other round a nucleus. Add electrons with clicks and keep the atom stable:
// a stable atom scores, an unstable one decays. The rules are in
// electronsRules.ts, the drawing and sounds in electronsEngine.ts; this is
// the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import {
  DURATION, MAX_ELECTRONS, MIN_ELECTRONS, STABLE, STEP, VERY_STABLE, pointsPerSecond,
  type Electrons as Rules, type Stability,
} from './electronsRules'
import { ElectronsEngine, H, STABILITY_COLORS, W } from './electronsEngine'
import './ports.css'

interface Stats {
  score: number
  electrons: number
  stability: Stability
  value: string
  decay: number
  time: number
  stable: string
  longest: string
  last: string
}

const read = (g: Rules): Stats => ({
  score: g.score,
  electrons: g.electrons.length,
  stability: g.stability,
  value: g.value.toFixed(2),
  decay: Math.round(g.decay * 100),
  time: Math.ceil(g.timeLeft),
  stable: g.stableTime.toFixed(1),
  longest: g.longestStable.toFixed(1),
  last: g.lastStableTime.toFixed(1),
})

const same = (a: Stats, b: Stats) => (Object.keys(a) as (keyof Stats)[]).every((k) => a[k] === b[k])

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const INFO: GameInfo = {
  id: 'electrons',
  name: 'Electron Game',
  width: W,
  height: H,
  step: STEP,
  controls: [
    ['Click', 'Add an electron'],
    ['X', 'Remove the newest (or right-click)'],
    ['C', 'Change colours'],
  ],
  help: (
    <>
      <h4>The atom</h4>
      <p>Every electron pulls on every other one; the nucleus sits at their centre and the camera follows it. Stability is how far the nucleus moves, averaged over the last 100 steps.</p>
      <ul>
        <li><b style={{ color: STABILITY_COLORS['Very Stable'] }}>Very stable</b> {VERY_STABLE} or less · <b style={{ color: STABILITY_COLORS.Stable }}>stable</b> {STABLE} or less · <b style={{ color: STABILITY_COLORS.Unstable }}>unstable</b> above</li>
        <li>An unstable atom runs faster (150 steps a second instead of 60)</li>
      </ul>
      <h4>The game</h4>
      <ul>
        <li>An experiment lasts {DURATION / 60} minutes and starts with three electrons</li>
        <li>A stable atom scores electrons² points a second ({pointsPerSecond(4, 'Stable')} a second with 4), twice that when very stable</li>
        <li>While it is unstable the decay meter fills; when it is full the atom flies apart and the experiment ends</li>
        <li>More electrons score far more, but are harder to keep steady</li>
      </ul>
      <h4>Controls</h4>
      <ul>
        <li>Click to add an electron there (up to {MAX_ELECTRONS}). A new electron far from the nucleus shakes it.</li>
        <li><kbd className="mg-key">X</kbd>, <kbd className="mg-key">Backspace</kbd> or a right-click takes away the newest (at least {MIN_ELECTRONS} stay)</li>
        <li><kbd className="mg-key">←</kbd> <kbd className="mg-key">→</kbd> <kbd className="mg-key">↑</kbd> <kbd className="mg-key">↓</kbd> nudge the camera · <kbd className="mg-key">C</kbd> changes the colours</li>
      </ul>
    </>
  ),
}

export default function Electrons({ win }: AppProps) {
  const [engine] = useState(() => new ElectronsEngine())
  const [stats, setStats] = useState(() => read(engine.game))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  useEffect(() => {
    engine.accent = themeColor(document.documentElement, '--k-accent', engine.accent)
  }, [engine])

  // A right-click on the playfield takes an electron away (the shell only passes on left clicks).
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      if (!engine.canvas || e.target !== engine.canvas) return
      e.preventDefault()
      if (engine.phase === 'playing') engine.removeElectron()
    }
    window.addEventListener('contextmenu', onMenu)
    return () => window.removeEventListener('contextmenu', onMenu)
  }, [engine])

  const onFrame = useCallback(() => {
    const s = read(engine.game)
    if (!same(s, last.current)) {
      last.current = s
      setStats(s)
    }
  }, [engine])

  const best = Math.max(scores[0]?.score ?? 0, stats.score)
  const rate = pointsPerSecond(stats.electrons, stats.stability)

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Electrons" value={stats.electrons} />
        <Stat label="Time" value={clock(stats.time)} />
      </div>
      <div className="mg-stat">
        <span className="mg-label">Stability</span>
        <span className="mg-level-name" style={{ color: STABILITY_COLORS[stats.stability] }}>{stats.stability}</span>
        <span className="mg-hint">
          {stats.value} · {rate ? `+${rate}/s` : 'no points'}
        </span>
      </div>
      <div className="mg-stat" title="Fills while the atom is unstable">
        <span className="mg-label">Decay</span>
        <div className={`mg-meter${stats.decay > 60 ? ' mg-hot' : ''}`} role="meter" aria-valuenow={stats.decay} aria-valuemin={0} aria-valuemax={100}>
          <i style={{ width: `${stats.decay}%` }} />
        </div>
      </div>
      <div className="mg-pair">
        <Stat label="Stable for" value={`${stats.stable}s`} />
        <Stat label="Longest" value={`${stats.longest}s`} />
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-hint">
        Click to add · <kbd className="mg-key">X</kbd> remove
        <br />
        <kbd className="mg-key">C</kbd> colours · last stable {stats.last}s
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} className="mg-electrons" />
}
