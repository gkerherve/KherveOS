// Reaction Chain: drop atoms into a rack; touching atoms that make a molecule
// (H₂O, CO₂, CH₄, NH₃, NaCl…) react and leave, and what falls into place can
// set off a chain. The rules are in reactionChainRules.ts, the drawing and
// sounds in reactionChainEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppProps } from '@/os'
import type { AppTools } from '@/os/ai/appTools'
import { GameShell, Stat, useScores, type GameControl, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import {
  COLS, LEVEL_ELEMENTS, MOLECULES, PER_LEVEL, ROWS, atomCount, dropTime, elementsAt, moleculesAt, pointsFor,
  type ReactionChain as Rules,
} from './reactionChainRules'
import { ATOM_COLORS, H, ReactionChainEngine, W } from './reactionChainEngine'
import './ports.css'

interface Stats {
  score: number
  level: number
  reactions: number
  chain: number
  made: string
}

const read = (g: Rules): Stats => ({
  score: g.score,
  level: g.level,
  reactions: g.reactions,
  chain: g.bestChain,
  made: JSON.stringify(g.made),
})

const same = (a: Stats, b: Stats) => (Object.keys(a) as (keyof Stats)[]).every((k) => a[k] === b[k])

/** The board as text for the AI: one string per column, bottom first. */
const columnsOf = (g: Rules) => g.cols.map((col) => col.map((t) => t.el))

/** Reaction Chain's own AI tool: drop (spec in src/os/ai/manifests/games.ts). */
function chainAiTools(engine: ReactionChainEngine, game: GameControl, refresh: () => void): AppTools {
  return {
    drop: async (a) => {
      const column = Number(a.column)
      if (!Number.isInteger(column) || column < 1 || column > COLS) throw new Error(`"column" must be a whole number from 1 to ${COLS}.`)
      game.ensurePlaying()
      const g = engine.game
      if (g.state !== 'play') throw new Error('The game is over. Call reactionchain_new_game to play again.')
      g.settle()
      const atom = g.current
      g.moveTo(column - 1)
      if (g.cols[column - 1].length >= ROWS) throw new Error(`Column ${column} is full.`)
      g.drop()
      const reactions = g.settle()
      engine.drain()
      refresh()
      return {
        dropped: atom,
        column,
        reactions: reactions.map((r) => ({ molecule: r.molecule.formula, name: r.molecule.name, chain: r.chain, target: r.target, points: r.points })),
        score: g.score,
        state: g.state,
        next_atom: g.current,
        then: g.next,
        target: g.target?.formula,
        columns: columnsOf(g),
      }
    },
  }
}

const INFO: GameInfo = {
  id: 'reactionchain',
  name: 'Reaction Chain',
  width: W,
  height: H,
  step: 1 / 60,
  controls: [
    ['← →', 'Choose a column (or the mouse)'],
    ['Space ↓', 'Drop the atom (or click)'],
  ],
  help: (
    <>
      <h4>Make molecules</h4>
      <p>
        Atoms drop into a rack of {COLS} columns. A group of atoms touching side by side or one above the other that holds <i>exactly</i> the atoms of a
        molecule reacts and leaves the rack: two H and an O touching make water.
      </p>
      <ul>
        <li>The atoms above fall into the gap. If they complete another molecule it reacts too: a <b>chain</b>, each step worth one more times.</li>
        <li>A molecule scores 10 × atoms² × chain step; the <b style={{ color: '#ffd83a' }}>target</b> molecule scores triple.</li>
        <li>When several molecules could form, the biggest wins (CO₂ before CO).</li>
        <li>Every {PER_LEVEL} molecules the level rises: a new element joins and atoms drop on their own sooner.</li>
        <li>Dropping into a full column ends the game.</li>
      </ul>
      <h4>Molecules</h4>
      <ul className="rc-list">
        {MOLECULES.map((m) => (
          <li key={m.formula}>
            <b>{m.formula}</b> {m.name} <span className="mg-muted">· level {m.level}</span>
          </li>
        ))}
      </ul>
      <h4>Elements by level</h4>
      <p>{LEVEL_ELEMENTS.map((els, i) => `${i + 1}: ${els.join(', ')}`).join(' · ')}</p>
    </>
  ),
}

export default function ReactionChain({ win }: AppProps) {
  const [engine] = useState(() => new ReactionChainEngine())
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
    return {
      level: g.level,
      molecules_made: g.reactions,
      best_chain: g.bestChain,
      current_atom: g.current,
      next_atoms: g.next,
      column: g.column + 1,
      target: g.target && { formula: g.target.formula, name: g.target.name, atoms: g.target.atoms },
      seconds_to_auto_drop: Number(g.timer.toFixed(1)),
      columns: columnsOf(g),
      elements: elementsAt(g.level),
      molecules: moleculesAt(g.level).map((m) => `${m.formula} (${Object.entries(m.atoms).map(([e, n]) => `${n}${e}`).join(' ')})`),
      rules: `${COLS} columns × ${ROWS} rows, columns listed bottom first. Touching atoms (left/right or above/below) holding exactly a molecule's atoms react; points 10 × atoms² × chain step, target ×3.`,
    }
  }
  const aiTools = (game: GameControl) => chainAiTools(engine, game, onFrame)
  const made = Object.entries(JSON.parse(stats.made) as Record<string, number>).sort((a, b) => b[1] - a[1])
  const toLevel = PER_LEVEL - (stats.reactions % PER_LEVEL)
  const els = elementsAt(stats.level)

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Level" value={stats.level} />
        <Stat label="Made" value={stats.reactions} title="Molecules made" />
      </div>
      <div className="mg-pair">
        <Stat label="Best chain" value={stats.chain ? `×${stats.chain}` : '–'} />
        <Stat label="Next level" value={toLevel} title="Molecules to the next level" />
      </div>
      <div className="mg-stat">
        <span className="mg-label">Elements</span>
        <span className="rc-els">
          {els.map((e) => (
            <i key={e} style={{ background: ATOM_COLORS[e][0], color: ATOM_COLORS[e][1] }}>
              {e}
            </i>
          ))}
        </span>
        <span className="mg-hint">drops in {dropTime(stats.level).toFixed(1)} s</span>
      </div>
      <div className="mg-stat">
        <span className="mg-label">Molecules</span>
        {made.length ? (
          <span className="rc-made">
            {made.slice(0, 6).map(([f, n]) => (
              <span key={f}>
                {f} <b>×{n}</b>
              </span>
            ))}
          </span>
        ) : (
          <span className="mg-hint">H + H + O → H₂O ({pointsFor(atomCount(MOLECULES[0]), 1, false)} pts)</span>
        )}
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-hint">
        <kbd className="mg-key">←</kbd> <kbd className="mg-key">→</kbd> column · <kbd className="mg-key">Space</kbd> drop
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} aiState={aiState} aiTools={aiTools} className="mg-reactionchain" />
}
