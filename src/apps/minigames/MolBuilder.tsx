// Molecule Builder: build every isomer of a formula from carbon, nitrogen and
// oxygen atoms (the hydrogens fill in). The rules are in molBuilderRules.ts,
// the drawing and sounds in molBuilderEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { AppProps } from '@/os'
import type { AppTools } from '@/os/ai/appTools'
import { GameShell, Stat, useScores, type GameControl, type GameInfo } from './GameShell'
import { fmt, themeColor } from './fx'
import { HINT_COST, LEVELS, TIME_BONUS, formulaOf, isomerPoints, pretty, type MolBuilder as Rules } from './molBuilderRules'
import { H, MolBuilderEngine, W } from './molBuilderEngine'
import './ports.css'

interface Stats {
  score: number
  level: number
  found: string
  isomers: number
}

const read = (g: Rules): Stats => ({
  score: g.score,
  level: g.level,
  found: g.found.map((f) => f.name).join('|'),
  isomers: g.isomersFound,
})

const same = (a: Stats, b: Stats) => (Object.keys(a) as (keyof Stats)[]).every((k) => a[k] === b[k])

/** Molecule Builder's own AI tool: build (spec in src/os/ai/manifests/games.ts). */
function builderAiTools(engine: MolBuilderEngine, game: GameControl, refresh: () => void): AppTools {
  return {
    build: async (a) => {
      const smiles = String(a.smiles ?? '').trim()
      if (!smiles) throw new Error('"smiles" is required, e.g. "CCO" for ethanol (C, N, O; = and # bonds; branches in brackets; ring digits).')
      game.ensurePlaying()
      const g = engine.game
      const level = g.level
      const c = g.buildSmiles(smiles)
      engine.drain()
      refresh()
      const lvl = LEVELS[level]
      const found = g.level === level ? g.found.map((f) => f.name) : lvl.isomers.map((i) => i.name)
      return {
        formula_wanted: lvl.formula,
        formula_built: c.formula,
        result: c.ok ? (found.includes(c.name) ? `found ${c.name}` : c.name) : c.why,
        found,
        still_missing: lvl.isomers.length - found.filter((n) => lvl.isomers.some((i) => i.name === n)).length,
        next_level: g.level !== level ? LEVELS[g.level]?.formula ?? null : null,
        score: g.score,
      }
    },
  }
}

const INFO: GameInfo = {
  id: 'molbuilder',
  name: 'Molecule Builder',
  width: W,
  height: H,
  step: 1 / 60,
  controls: [
    ['Click', 'Place an atom / pick one'],
    ['Click Click', 'Bond two atoms (again: double, triple, none)'],
    ['C N O', 'Choose the element (or change the picked atom)'],
    ['Delete', 'Remove the picked atom (or right-click)'],
  ],
  help: (
    <>
      <h4>Build every isomer</h4>
      <p>
        Each level gives a formula. Isomers have the same atoms joined differently: C₂H₆O is ethanol (CH₃CH₂OH) and dimethyl ether (CH₃OCH₃). Build each one
        on the grid; when it matches the formula it is named and kept, and the board clears.
      </p>
      <ul>
        <li>Hydrogens fill in by themselves: carbon makes 4 bonds, nitrogen 3, oxygen 2. An atom with too many bonds gets a red ring.</li>
        <li>Click an empty point to place an atom; next to the picked atom it bonds straight away. Click two atoms to bond them; clicking the same pair again makes the bond double, triple, then removes it.</li>
        <li>Atoms bond to their neighbours, diagonals included, so you can make rings.</li>
        <li>An isomer scores {isomerPoints(1)} per C, N or O atom; finishing a level adds {TIME_BONUS} points a second left. A hint (?) names a missing one for {HINT_COST} points.</li>
        <li>Drawing the same molecule another way does not count twice. Cis and trans forms count as one.</li>
      </ul>
    </>
  ),
}

export default function MolBuilder({ win }: AppProps) {
  const [engine] = useState(() => new MolBuilderEngine())
  const [stats, setStats] = useState(() => read(engine.game))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  useEffect(() => {
    engine.accent = themeColor(document.documentElement, '--k-accent', engine.accent)
  }, [engine])

  // A right-click on the grid removes the atom there (the shell only passes on left clicks).
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const c = engine.canvas
      if (!c || e.target !== c) return
      e.preventDefault()
      if (engine.phase !== 'playing') return
      const r = c.getBoundingClientRect()
      engine.removeAt(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H)
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
  const aiState = () => {
    const g = engine.game
    const lvl = g.current
    return {
      level: g.level + 1,
      levels: LEVELS.length,
      formula: lvl.formula,
      isomers_total: lvl.isomers.length,
      found: g.found.map((f) => f.name),
      on_board: g.mol.atoms.length ? formulaOf(g.mol) : null,
      seconds_left: Math.ceil(g.timeLeft),
      rules: 'Build a structure with molbuilder_build (SMILES of C, N, O; hydrogens implicit). Each new isomer of the formula scores; all of them finish the level.',
    }
  }
  const aiTools = (game: GameControl) => builderAiTools(engine, game, onFrame)
  const lvl = LEVELS[stats.level]
  const found = new Set(stats.found.split('|'))

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Level" value={`${stats.level + 1}/${LEVELS.length}`} />
        <Stat label="Isomers" value={stats.isomers} />
      </div>
      <div className="mg-stat">
        <span className="mg-label">{pretty(lvl.formula)}</span>
        <ul className="mb-isomers">
          {lvl.isomers.map((i, n) =>
            found.has(i.name) ? (
              <li key={i.name} className="mb-found">
                <Check size={12} /> {i.name}
              </li>
            ) : (
              <li key={i.name} className="mg-muted">
                isomer {n + 1}
              </li>
            ),
          )}
        </ul>
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-hint">
        <kbd className="mg-key">C</kbd> <kbd className="mg-key">N</kbd> <kbd className="mg-key">O</kbd> element · <kbd className="mg-key">?</kbd> hint
        <br />
        <kbd className="mg-key">R</kbd> clear · right-click remove
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} aiState={aiState} aiTools={aiTools} className="mg-molbuilder" />
}
