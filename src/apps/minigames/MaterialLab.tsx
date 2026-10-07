// Material Lab (KherveFitting's ChemistryLab.py, "Material Lab Simulator"):
// put elements in the reactor, heat it with the furnace and discover 44
// compounds, unlocking new elements as you go. The rules are in
// materialLabRules.ts, the bench and its sounds in materialLabEngine.ts;
// this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, FlagTriangleRight } from 'lucide-react'
import type { AppProps } from '@/os'
import { GameShell, Stat, useScores, type GameInfo, type Phase } from './GameShell'
import { fmt, themeColor } from './fx'
import { DEG_PER_FUEL, ELEMENTS, POINTS, REACTIONS, type MaterialLab as Rules } from './materialLabRules'
import { H, MaterialLabEngine, W } from './materialLabEngine'
import './ports.css'

interface Stats {
  score: number
  found: number
  unlocked: number
  temp: number
  fuel: number
  on: boolean
  phase: Phase
}

const read = (g: Rules, phase: Phase): Stats => ({
  score: g.score,
  found: g.discovered.size,
  unlocked: g.unlocked.size,
  temp: Math.round(g.temperature),
  fuel: g.fuel,
  on: g.furnaceOn,
  phase,
})

const same = (a: Stats, b: Stats) => (Object.keys(a) as (keyof Stats)[]).every((k) => a[k] === b[k])

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault()

const INFO: GameInfo = {
  id: 'materiallab',
  name: 'Material Lab',
  width: W,
  height: H,
  step: 1 / 60,
  controls: [
    ['Mouse', 'Drag or click elements in'],
    ['+ −', 'Furnace fuel'],
    ['F', 'Furnace on / off'],
    ['R', 'React'],
  ],
  help: (
    <>
      <h4>How to play</h4>
      <ul>
        <li>Drag elements from the periodic table into the reactor, or just click them</li>
        <li>Set the furnace fuel with <b>−</b> / <b>+</b> (levels 1–10) and switch it on: each level adds {DEG_PER_FUEL} °C to the room's 25 °C</li>
        <li>Press <b>React!</b> when the right elements are in at the right temperature</li>
        <li>Click an element in the reactor to take one out; <b>Clear</b> empties it</li>
      </ul>
      <h4>Feedback</h4>
      <ul>
        <li><b>Needs more heat</b>: raise the fuel (and check the furnace is on) · <b>Too hot</b>: lower it</li>
        <li><b>No reaction found</b>: try another combination. Extra atoms of the same elements are left over.</li>
        <li>Liquids fill the reactor, gases fume, solids settle as a powder</li>
      </ul>
      <h4>Points</h4>
      <p>
        A new compound is worth {POINTS.discovery} and may unlock new elements. Making a known one again is worth {POINTS.repeat}, the first{' '}
        {POINTS.repeats} times. Discover all {REACTIONS.length} for a {POINTS.complete} bonus, or press <b>Finish</b> to end the session and keep your points.
      </p>
      <h4>Keys</h4>
      <p>
        <kbd className="mg-key">R</kbd> or <kbd className="mg-key">Enter</kbd> react · <kbd className="mg-key">C</kbd> clear · <kbd className="mg-key">F</kbd> furnace ·{' '}
        <kbd className="mg-key">+</kbd> <kbd className="mg-key">−</kbd> fuel · <kbd className="mg-key">Backspace</kbd> takes the last atom out ·{' '}
        <kbd className="mg-key">B</kbd> recipe book · <kbd className="mg-key">E</kbd> finish
      </p>
    </>
  ),
}

export default function MaterialLab({ win }: AppProps) {
  const [engine] = useState(() => new MaterialLabEngine())
  const [stats, setStats] = useState(() => read(engine.game, 'ready'))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  useEffect(() => {
    engine.accent = themeColor(document.documentElement, '--k-accent', engine.accent)
  }, [engine])

  // Dragging an element carries on outside the playfield (the shell only reports presses).
  useEffect(() => {
    const move = (e: PointerEvent) => engine.clientMove(e.clientX, e.clientY)
    const up = (e: PointerEvent) => {
      engine.clientMove(e.clientX, e.clientY)
      engine.clientUp()
    }
    const cancel = () => engine.releaseAll()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
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
      <div className="mg-stat">
        <span className="mg-label">Discovered</span>
        <div className="mg-meter" role="meter" aria-valuenow={stats.found} aria-valuemin={0} aria-valuemax={REACTIONS.length}>
          <i style={{ width: `${(stats.found / REACTIONS.length) * 100}%` }} />
        </div>
        <span className="mg-hint">
          {stats.found} of {REACTIONS.length} compounds
        </span>
      </div>
      <div className="mg-pair">
        <Stat label="Elements" value={`${stats.unlocked}/${ELEMENTS.length}`} />
        <Stat label="Reactor" value={`${stats.temp}°`} title="Reactor temperature, °C" />
      </div>
      <Stat label="Furnace" value={stats.on ? `On · ${stats.fuel}` : stats.fuel ? `Off · ${stats.fuel}` : 'Off'} />
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-tools">
        <button className="k-btn small" title="Recipe book (B)" onMouseDown={keepFocus} disabled={!playing} onClick={() => engine.toggleBook()}>
          <BookOpen size={13} /> Recipes
        </button>
        <button className="k-btn small" title="End the session and keep the points (E)" onMouseDown={keepFocus} disabled={!playing} onClick={() => engine.finish()}>
          <FlagTriangleRight size={13} /> Finish
        </button>
      </div>
      <div className="mg-hint">
        <kbd className="mg-key">R</kbd> react · <kbd className="mg-key">F</kbd> furnace
        <br />
        <kbd className="mg-key">+</kbd><kbd className="mg-key">−</kbd> fuel · <kbd className="mg-key">C</kbd> clear
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} className="mg-lab" />
}
