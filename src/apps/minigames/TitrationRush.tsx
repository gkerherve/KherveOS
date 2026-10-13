// Titration Rush: ten titrations against the clock, scored on how close the
// end point is to the equivalence point. The rules are in titrationRules.ts,
// the drawing and sounds in titrationEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import type { AppTools } from '@/os/ai/appTools'
import { GameShell, Stat, useScores, type GameControl, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import {
  BURETTE_ML, CHOOSE_FROM, DROP, GOOD_INDICATOR_BONUS, INDICATORS, MAX_POINTS, ROUNDS, ROUND_TIME, STREAM, TRAINING, ZERO_AT,
  type RoundResult, type TitrationRush as Rules,
} from './titrationRules'
import { H, TitrationEngine, W } from './titrationEngine'
import './ports.css'

interface Stats {
  score: number
  round: number
  last: string
  best: string
}

const verdict = (r: RoundResult) => (r.timedOut ? 'time up' : `${r.error.toFixed(2)} mL off`)

const read = (g: Rules): Stats => {
  const done = g.results.filter((r) => !r.timedOut)
  const last = g.results[g.results.length - 1]
  return {
    score: g.score,
    round: g.round,
    last: last ? verdict(last) : '–',
    best: done.length ? `${Math.min(...done.map((r) => r.error)).toFixed(2)} mL` : '–',
  }
}

const same = (a: Stats, b: Stats) => (Object.keys(a) as (keyof Stats)[]).every((k) => a[k] === b[k])

/** Titration Rush's own AI tools (specs in src/os/ai/manifests/games.ts). */
function titrationAiTools(engine: TitrationEngine, game: GameControl, refresh: () => void): AppTools {
  const g = () => engine.game
  const status = () => ({
    round: g().round,
    phase: g().phase,
    added_ml: Number(g().added.toFixed(2)),
    ...(g().training && { pH: Number(g().pH.toFixed(2)) }),
    indicator: g().phase === 'choose' ? null : g().setup.indicator.name,
    seconds_left: Math.ceil(g().timeLeft),
    score: g().score,
  })
  const done = () => {
    engine.drain()
    refresh()
  }
  return {
    add: async (a) => {
      const ml = Number(a.ml)
      if (!(ml > 0) || ml > BURETTE_ML) throw new Error(`"ml" must be more than 0 and at most ${BURETTE_ML}.`)
      game.ensurePlaying()
      if (g().phase === 'choose') throw new Error('Choose the indicator first (titrationrush_choose_indicator).')
      if (g().phase !== 'titrate') throw new Error(`Not titrating now (phase ${g().phase}). Call titrationrush_next for the next round.`)
      g().add(ml)
      done()
      return status()
    },
    choose_indicator: async (a) => {
      game.ensurePlaying()
      const i = INDICATORS.findIndex((x) => x.name === String(a.indicator ?? '').toLowerCase())
      if (i < 0) throw new Error(`"indicator" must be one of: ${INDICATORS.map((x) => x.name).join(', ')}.`)
      if (!g().choose(i)) throw new Error('The indicator is only chosen at the start of rounds 5 to 10.')
      done()
      return status()
    },
    end_point: async () => {
      game.ensurePlaying()
      const r = g().callEndpoint()
      if (!r) throw new Error(`Not titrating now (phase ${g().phase}).`)
      done()
      return { ...r, added: Number(r.added.toFixed(2)), equivalence: Number(r.equivalence.toFixed(2)), error: Number(r.error.toFixed(3)), score: g().score }
    },
    next: async () => {
      game.ensurePlaying()
      if (!g().next()) throw new Error(`There is no finished round to move on from (phase ${g().phase}).`)
      done()
      return status()
    },
  }
}

const INFO: GameInfo = {
  id: 'titrationrush',
  name: 'Titration Rush',
  width: W,
  height: H,
  step: 1 / 60,
  controls: [
    ['Space', 'Hold to open the burette'],
    ['↓', 'Add one drop (or click the flask)'],
    ['Enter', 'Call the end point'],
    ['1 2 3 4', 'Choose the indicator (round 5 on)'],
  ],
  help: (
    <>
      <h4>Find the end point</h4>
      <p>
        Each round the flask holds an acid (or a base) of unknown strength with an indicator. Add titrant from the burette until the indicator turns for good,
        then call the end point. The closer to the true equivalence point, the more points: {MAX_POINTS} for a perfect one, none {ZERO_AT} mL away.
      </p>
      <ul>
        <li>Holding <kbd className="mg-key">Space</kbd> pours {STREAM} mL a second; <kbd className="mg-key">↓</kbd> adds one drop ({DROP} mL).</li>
        <li>Near the end point each drop flashes the colour; when the colour stays after swirling, stop.</li>
        <li>Seconds left give a bonus (5 a second). A round lasts {ROUND_TIME} s.</li>
        <li>Rounds 1–{TRAINING} show a pH meter and the curve. After that, only the colour.</li>
        <li>From round {CHOOSE_FROM} you choose the indicator: one that changes colour near the equivalence pH gets +{GOOD_INDICATOR_BONUS}. A weak acid ends above pH 7, a weak base below.</li>
      </ul>
      <h4>Indicators</h4>
      <ul>
        {INDICATORS.map((i) => (
          <li key={i.name}>
            <b>{i.name}</b>: pH {(i.pKin - 1).toFixed(1)}–{(i.pKin + 1).toFixed(1)}
          </li>
        ))}
      </ul>
    </>
  ),
}

export default function TitrationRush({ win }: AppProps) {
  const [engine] = useState(() => new TitrationEngine())
  const [stats, setStats] = useState(() => read(engine.game))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  useEffect(() => {
    engine.accent = themeColor(document.documentElement, '--k-accent', engine.accent)
  }, [engine])

  const onFrame = useCallback(() => {
    const s = read(engine.game)
    if (!same(s, last.current)) {
      last.current = s
      setStats(s)
    }
  }, [engine])

  const best = Math.max(scores[0]?.score ?? 0, stats.score)
  const aiState = () => {
    const g = engine.game
    const s = g.setup
    return {
      round: g.round,
      rounds: ROUNDS,
      round_phase: g.phase,
      flask: `${s.volume} mL of ${s.analyte.name} (${s.analyte.formula}), concentration unknown`,
      titrant: `${s.titrant} M ${s.analyte.kind === 'acid' ? 'NaOH' : 'HCl'}`,
      indicator: g.phase === 'choose' ? null : s.indicator.name,
      added_ml: Number(g.added.toFixed(2)),
      ...(g.training && { pH: Number(g.pH.toFixed(2)) }),
      seconds_left: Math.ceil(g.timeLeft),
      results: g.results.map((r) => ({ round: r.round, error_ml: Number(r.error.toFixed(3)), points: r.points + r.bonus + r.timeBonus })),
      indicators: INDICATORS.map((i) => `${i.name} (pH ${(i.pKin - 1).toFixed(1)}–${(i.pKin + 1).toFixed(1)})`),
    }
  }
  const aiTools = (game: GameControl) => titrationAiTools(engine, game, onFrame)

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Round" value={`${stats.round}/${ROUNDS}`} />
        <Stat label="Last" value={stats.last} />
      </div>
      <Stat label="Closest" value={stats.best} title="Smallest end-point error" />
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-hint">
        <kbd className="mg-key">Space</kbd> pour · <kbd className="mg-key">↓</kbd> drop
        <br />
        <kbd className="mg-key">Enter</kbd> end point
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} aiState={aiState} aiTools={aiTools} className="mg-titration" />
}
