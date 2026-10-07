// Solitaire (KherveFitting's Solitaire.py, "Kherve Solitaire"): Klondike,
// drawing one card at a time. Drag cards, or click one to send it where it
// fits. The rules are in solitaireRules.ts, the cards in solitaireCards.ts,
// the table and its animations in solitaireEngine.ts; this is the window.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Flag, Undo2, Wand2 } from 'lucide-react'
import type { AppProps } from '@/os'
import type { AppTools } from '@/os/ai/appTools'
import { GameShell, Stat, useScores, type GameControl, type GameInfo, type Phase } from './GameShell'
import { fmt, themeColor } from './fx'
import { POINTS, RANK_NAMES, cardName, type Card, type Solitaire as Rules, type Source, type Target } from './solitaireRules'
import { H, SolitaireEngine, W } from './solitaireEngine'
import './ports.css'

interface Stats {
  score: number
  moves: number
  time: number
  up: number
  canUndo: boolean
  phase: Phase
}

const read = (g: Rules, phase: Phase): Stats => ({
  score: g.score,
  moves: g.moves,
  time: Math.floor(g.elapsed),
  up: g.foundations.reduce((n, f) => n + f.length, 0),
  canUndo: g.canUndo,
  phase,
})

const same = (a: Stats, b: Stats) => (Object.keys(a) as (keyof Stats)[]).every((k) => a[k] === b[k])

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const keepFocus = (e: { preventDefault(): void }) => e.preventDefault()

// ------------------------------------------------------------ AI tools

/** The table as the AI reads it. */
function table(g: Rules) {
  const top = (pile: Card[]) => (pile.length ? cardName(pile[pile.length - 1]) : null)
  return {
    stock: g.stock.length,
    waste: top(g.waste),
    waste_cards: g.waste.length,
    foundations: g.foundations.map(top),
    columns: g.tableau.map((pile, i) => ({
      column: i + 1,
      face_down: pile.filter((c) => !c.up).length,
      cards: pile.filter((c) => c.up).map(cardName),
    })),
  }
}

const SUIT_LETTERS: Record<string, Card['suit']> = {
  d: 'diamonds', '♦': 'diamonds', h: 'hearts', '♥': 'hearts', s: 'spades', '♠': 'spades', c: 'clubs', '♣': 'clubs',
}

/** "7H", "7♥", "10d", "qs" → rank and suit. */
function parseCard(text: string): { rank: number; suit: Card['suit'] } | null {
  const m = /^(10|[2-9]|[ajqk1])\s*([dhsc♦♥♠♣])/i.exec(text.trim().replace(/[\uFE0E\uFE0F]/g, ''))
  if (!m) return null
  const rank = RANK_NAMES.indexOf(m[1].toUpperCase() === '1' ? 'A' : m[1].toUpperCase())
  return rank > 0 ? { rank, suit: SUIT_LETTERS[m[2].toLowerCase()] } : null
}

/** "column 3", "foundation 2", "waste" → its number (1-based in the text), or 0 for none given. */
function place(text: string): { kind: string; n: number } {
  const m = /^\s*(waste|foundation|column|tableau|col)s?\s*#?\s*(\d*)\s*$/i.exec(text)
  if (!m) throw new Error(`"${text}" is not a place: use "waste", "column 1".."column 7" or "foundation 1".."foundation 4".`)
  const kind = m[1].toLowerCase()
  return { kind: kind === 'tableau' || kind === 'col' ? 'column' : kind, n: m[2] ? Number(m[2]) : 0 }
}

function solitaireAiTools(engine: SolitaireEngine, game: GameControl, refresh: () => void): AppTools {
  const g = () => engine.game
  const ready = () => {
    game.ensurePlaying()
    if (g().state !== 'play' || g().finishing) throw new Error('The game is finishing by itself. Wait for game over, then call solitaire_new_game.')
  }
  const after = (extra: Record<string, unknown>) => {
    refresh()
    return { ...extra, score: g().score, moves: g().moves, ...table(g()) }
  }
  return {
    move: async (a) => {
      ready()
      const rules = g()
      const from = place(String(a.from ?? ''))
      let src: Source
      if (from.kind === 'waste') src = { kind: 'waste' }
      else if (from.kind === 'foundation') {
        if (from.n < 1 || from.n > 4) throw new Error('Say which foundation: "foundation 1" to "foundation 4".')
        src = { kind: 'foundation', index: from.n - 1 }
      } else {
        if (from.n < 1 || from.n > 7) throw new Error('Say which column: "column 1" to "column 7".')
        const pile = rules.tableau[from.n - 1]
        if (!pile.length) throw new Error(`Column ${from.n} is empty.`)
        let row = pile.length - 1
        if (typeof a.card === 'string' && a.card.trim()) {
          const want = parseCard(a.card)
          if (!want) throw new Error(`"${a.card}" is not a card: write it like "7H", "10D", "Q♠", "AC".`)
          row = pile.findIndex((c) => c.up && c.rank === want.rank && c.suit === want.suit)
          if (row < 0) throw new Error(`${a.card} is not face up in column ${from.n}. Its face-up cards: ${pile.filter((c) => c.up).map(cardName).join(' ') || 'none'}.`)
        }
        src = { kind: 'tableau', index: from.n - 1, row }
      }
      const cards = rules.cardsAt(src)
      if (!cards.length) throw new Error(`There is no card to move from ${String(a.from)}.`)

      const to = String(a.to ?? '').trim().toLowerCase()
      let dst: Target | null
      if (to === 'auto') dst = rules.bestTarget(src)
      else {
        const t = place(to)
        if (t.kind === 'waste') throw new Error('Cards cannot be moved onto the waste.')
        if (t.kind === 'foundation' && !t.n) {
          const i = [0, 1, 2, 3].find((f) => rules.canMove(src, { kind: 'foundation', index: f }))
          dst = i === undefined ? null : { kind: 'foundation', index: i }
        } else {
          const max = t.kind === 'foundation' ? 4 : 7
          if (t.n < 1 || t.n > max) throw new Error(`Say which ${t.kind}: 1 to ${max}.`)
          dst = { kind: t.kind === 'foundation' ? 'foundation' : 'tableau', index: t.n - 1 }
        }
      }
      const what = cards.length > 1 ? `${cardName(cards[0])} (with ${cards.length - 1} card${cards.length > 2 ? 's' : ''} on it)` : cardName(cards[0])
      if (!dst || !rules.canMove(src, dst)) throw new Error(`${what} cannot go ${to === 'auto' ? 'anywhere' : `to ${String(a.to)}`} now.`)
      rules.move(src, dst)
      const where = dst.kind === 'foundation' ? `foundation ${dst.index + 1}` : `column ${dst.index + 1}`
      return after({ moved: what, to: where, ...(rules.won && { won: true }) })
    },
    action: async (a, ctx) => {
      const action = String(a.action ?? '')
      ready()
      const rules = g()
      let ok: boolean
      if (action === 'draw') ok = rules.draw()
      else if (action === 'undo') ok = rules.undo()
      else if (action === 'auto') ok = rules.autoMove()
      else if (action === 'give_up') {
        if (!(await ctx.confirm('give up this game of Solitaire', `It ends with ${rules.score} points.`))) throw new Error('The user kept playing.')
        ok = rules.resign()
      } else throw new Error('"action" must be "draw", "undo", "auto" or "give_up".')
      if (!ok) {
        const why = action === 'draw' ? 'The stock and the waste are both empty.' : action === 'undo' ? 'There is nothing to undo.' : action === 'auto' ? 'No card can go up to a foundation now.' : 'The game has already ended.'
        throw new Error(why)
      }
      return after({ done: action })
    },
  }
}

const INFO: GameInfo = {
  id: 'solitaire',
  name: 'Solitaire',
  width: W,
  height: H,
  step: 1 / 60,
  controls: [
    ['Mouse', 'Drag cards, or click one'],
    ['Space', 'Draw from the stock'],
    ['U', 'Undo'],
  ],
  help: (
    <>
      <h4>Goal</h4>
      <p>Build the four foundations (top right) up by suit, from ace to king.</p>
      <h4>The table</h4>
      <ul>
        <li>Build the seven columns down in alternating colours: a red 6 on a black 7. Move a card with the cards on it.</li>
        <li>Only a king (with its cards) goes into an empty column</li>
        <li>Click the stock (top left) to turn up one card. When it is empty, click it again to turn the waste back over.</li>
        <li>A card left face down at the bottom of a column turns up by itself</li>
      </ul>
      <h4>Mouse and keys</h4>
      <ul>
        <li>Drag cards where they go, or click a card to send it to a foundation, or else to a column that takes it</li>
        <li>Right-click (or <kbd className="mg-key">A</kbd>) sends the next card that can go to a foundation</li>
        <li><kbd className="mg-key">Space</kbd> or <kbd className="mg-key">D</kbd> draws · <kbd className="mg-key">U</kbd> or <kbd className="mg-key">Z</kbd> undoes · <kbd className="mg-key">G</kbd> gives up and keeps your points</li>
        <li>Once every card is face up, the rest goes up by itself</li>
      </ul>
      <h4>Points</h4>
      <p>
        To a foundation {POINTS.toFoundation} · waste to a column {POINTS.wasteToTableau} · turning a card up {POINTS.flip} · a card back off a
        foundation {POINTS.fromFoundation} · turning the waste over {POINTS.recycle}. Winning adds {POINTS.win}, plus 2 a second under ten minutes.
      </p>
    </>
  ),
}

export default function Solitaire({ win }: AppProps) {
  const [engine] = useState(() => new SolitaireEngine())
  const [stats, setStats] = useState(() => read(engine.game, 'ready'))
  const last = useRef(stats)
  const scores = useScores(INFO.id)

  useEffect(() => {
    engine.accent = themeColor(document.documentElement, '--k-accent', engine.accent)
  }, [engine])

  // Drags carry on outside the table, and a right-click sends a card up
  // (the shell only passes on presses of the left button).
  useEffect(() => {
    const move = (e: PointerEvent) => engine.clientMove(e.clientX, e.clientY)
    const up = (e: PointerEvent) => {
      engine.clientMove(e.clientX, e.clientY)
      engine.clientUp()
    }
    const cancel = () => engine.releaseAll()
    const menu = (e: MouseEvent) => {
      if (!engine.canvas || e.target !== engine.canvas) return
      e.preventDefault()
      if (engine.phase === 'playing') engine.autoMove()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('contextmenu', menu)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('contextmenu', menu)
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
  const aiState = () => ({ moves: engine.game.moves, seconds: Math.floor(engine.game.elapsed), cards_up: engine.game.foundations.reduce((n, f) => n + f.length, 0), ...table(engine.game) })
  const aiTools = (game: GameControl) => solitaireAiTools(engine, game, onFrame)
  const best = Math.max(scores[0]?.score ?? 0, stats.score)

  const panel = (
    <>
      <Stat label="Score" value={fmt(stats.score)} big />
      <div className="mg-pair">
        <Stat label="Time" value={clock(stats.time)} />
        <Stat label="Moves" value={stats.moves} />
      </div>
      <div className="mg-stat">
        <span className="mg-label">Foundations</span>
        <div className="mg-meter" role="meter" aria-valuenow={stats.up} aria-valuemin={0} aria-valuemax={52}>
          <i style={{ width: `${(stats.up / 52) * 100}%` }} />
        </div>
        <span className="mg-hint">{stats.up} of 52 cards</span>
      </div>
      <Stat label="Best" value={fmt(best)} />
      <div className="mg-tools">
        <button className="k-btn small" title="Undo (U)" onMouseDown={keepFocus} disabled={!playing || !stats.canUndo} onClick={() => engine.undo()}>
          <Undo2 size={13} /> Undo
        </button>
        <button className="k-btn small" title="Send a card to a foundation (A or right-click)" onMouseDown={keepFocus} disabled={!playing} onClick={() => engine.autoMove()}>
          <Wand2 size={13} /> Auto
        </button>
        <button className="k-btn small" title="Give up and keep the points (G)" onMouseDown={keepFocus} disabled={!playing} onClick={() => engine.resign()}>
          <Flag size={13} /> Give up
        </button>
      </div>
      <div className="mg-hint">
        Drag, or click a card
        <br />
        <kbd className="mg-key">Space</kbd> draw · <kbd className="mg-key">U</kbd> undo
      </div>
    </>
  )

  return <GameShell win={win} info={INFO} engine={engine} panel={panel} onFrame={onFrame} aiState={aiState} aiTools={aiTools} className="mg-solitaire" />
}
