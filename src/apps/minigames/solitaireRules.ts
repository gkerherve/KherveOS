// Solitaire rules (Klondike, draw one), ported from KherveFitting's
// Solitaire.py ("Kherve Solitaire"): seven tableau columns dealt 1 to 7 with
// the top card face up, a stock drawn one card at a time onto the waste and
// turned over again when empty (as often as you like), four foundations
// built up by suit from the ace. Tableau columns build down in alternating
// colours; only a king goes into an empty column. Any face-up tableau card
// moves with the cards on it; the waste and foundation tops move alone.
//
// New in KherveOS: scoring (Windows-style), undo, a hint when no move is
// left, and an automatic finish once every card is face up. Plain logic with
// no DOM, so it can be tested on its own.

export type Suit = 'diamonds' | 'spades' | 'hearts' | 'clubs'
/** The original's order, also the order of the foundation hints. */
export const SUITS: Suit[] = ['diamonds', 'spades', 'hearts', 'clubs']
export const RANK_NAMES = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export interface Card {
  /** 0..51, stable for the whole game (for animation). */
  id: number
  suit: Suit
  /** 1 = ace … 13 = king. */
  rank: number
  up: boolean
}

export const isRed = (c: { suit: Suit }) => c.suit === 'diamonds' || c.suit === 'hearts'
export const cardName = (c: Card) => `${RANK_NAMES[c.rank]}${{ diamonds: '♦', spades: '♠', hearts: '♥', clubs: '♣' }[c.suit]}`

/** Can `card` go onto a foundation whose top is `top` (null: empty)? */
export function fitsFoundation(card: Card, top: Card | null): boolean {
  if (!top) return card.rank === 1
  return card.suit === top.suit && card.rank === top.rank + 1
}

/** Can `card` go onto a tableau column whose top is `top` (null: empty)? */
export function fitsTableau(card: Card, top: Card | null): boolean {
  if (!top) return card.rank === 13
  return top.up && isRed(card) !== isRed(top) && card.rank === top.rank - 1
}

export type Source = { kind: 'waste' } | { kind: 'foundation'; index: number } | { kind: 'tableau'; index: number; row: number }
export type Target = { kind: 'foundation'; index: number } | { kind: 'tableau'; index: number }

/** Points, as in Windows Solitaire (standard scoring). */
export const POINTS = {
  wasteToTableau: 5,
  toFoundation: 10,
  flip: 5,
  fromFoundation: -15,
  /** Turning the waste over into the stock again. */
  recycle: -20,
  /** Winning: this, plus twice the seconds under ten minutes. */
  win: 500,
}

export function winBonus(seconds: number): number {
  return POINTS.win + 2 * Math.max(0, 600 - Math.floor(seconds))
}

export type SolitaireEvent =
  | { type: 'deal' }
  | { type: 'draw' }
  | { type: 'recycle' }
  | { type: 'move'; cards: Card[]; to: Target; points: number }
  | { type: 'flip'; card: Card }
  | { type: 'undo' }
  | { type: 'invalid' }
  | { type: 'won'; bonus: number }
  | { type: 'resigned' }

export type State = 'play' | 'won' | 'resigned'

interface Snapshot {
  stock: Card[]
  waste: Card[]
  foundations: Card[][]
  tableau: Card[][]
  score: number
  moves: number
}

const copy = (pile: Card[]) => pile.map((c) => ({ ...c }))

/** A shuffled 52-card deck, all face down. */
export function newDeck(rng: () => number = Math.random): Card[] {
  const deck: Card[] = []
  let id = 0
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) deck.push({ id: id++, suit, rank, up: false })
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

export class Solitaire {
  stock: Card[] = []
  waste: Card[] = []
  foundations: Card[][] = [[], [], [], []]
  tableau: Card[][] = [[], [], [], [], [], [], []]
  score = 0
  moves = 0
  /** Seconds played. */
  elapsed = 0
  state: State = 'play'
  stateTime = 0
  /** Every card is face up and the stock is used: the rest goes up by itself. */
  finishing = false
  events: SolitaireEvent[] = []

  private history: Snapshot[] = []
  private finishClock = 0
  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  get over(): boolean {
    if (this.state === 'won') return this.stateTime >= 3.2
    return this.state === 'resigned' && this.stateTime >= 0.6
  }

  get canUndo(): boolean {
    return this.state === 'play' && !this.finishing && this.history.length > 0
  }

  get won(): boolean {
    return this.foundations.every((f) => f.length === 13)
  }

  reset() {
    this.deal(newDeck(this.rng))
  }

  /** Lays out a deck (the last card of `deck` is dealt first, as in the original). */
  deal(deck: Card[]) {
    const cards = deck.map((c) => ({ ...c, up: false }))
    this.tableau = [[], [], [], [], [], [], []]
    for (let col = 0; col < 7; col++)
      for (let row = 0; row <= col; row++) {
        const c = cards.pop()!
        c.up = row === col
        this.tableau[col].push(c)
      }
    this.stock = cards
    this.waste = []
    this.foundations = [[], [], [], []]
    this.score = 0
    this.moves = 0
    this.elapsed = 0
    this.state = 'play'
    this.stateTime = 0
    this.finishing = false
    this.finishClock = 0
    this.history = []
    this.events = [{ type: 'deal' }]
  }

  top(pile: Card[]): Card | null {
    return pile.length ? pile[pile.length - 1] : null
  }

  /** The cards a source would pick up (empty if none can be picked up there). */
  cardsAt(src: Source): Card[] {
    if (src.kind === 'waste') return this.waste.length ? [this.waste[this.waste.length - 1]] : []
    if (src.kind === 'foundation') {
      const f = this.foundations[src.index]
      return f && f.length ? [f[f.length - 1]] : []
    }
    const pile = this.tableau[src.index]
    if (!pile || src.row < 0 || src.row >= pile.length || !pile[src.row].up) return []
    return pile.slice(src.row)
  }

  /** Is moving `src` onto `dst` allowed? */
  canMove(src: Source, dst: Target): boolean {
    if (this.state !== 'play') return false
    const cards = this.cardsAt(src)
    if (!cards.length) return false
    if (src.kind !== 'waste' && src.kind === dst.kind && src.index === dst.index) return false
    if (dst.kind === 'foundation') {
      const f = this.foundations[dst.index]
      return !!f && cards.length === 1 && fitsFoundation(cards[0], this.top(f))
    }
    const pile = this.tableau[dst.index]
    return !!pile && fitsTableau(cards[0], this.top(pile))
  }

  private snapshot() {
    this.history.push({
      stock: copy(this.stock),
      waste: copy(this.waste),
      foundations: this.foundations.map(copy),
      tableau: this.tableau.map(copy),
      score: this.score,
      moves: this.moves,
    })
    if (this.history.length > 300) this.history.shift()
  }

  private addPoints(n: number) {
    this.score = Math.max(0, this.score + n)
  }

  /** Moves `src` onto `dst` if allowed; true if it moved. */
  move(src: Source, dst: Target): boolean {
    if (!this.canMove(src, dst)) {
      if (this.state === 'play') this.events.push({ type: 'invalid' })
      return false
    }
    this.snapshot()
    const n = this.cardsAt(src).length
    let cards: Card[]
    if (src.kind === 'waste') cards = this.waste.splice(this.waste.length - 1, 1)
    else if (src.kind === 'foundation') cards = this.foundations[src.index].splice(-1, 1)
    else cards = this.tableau[src.index].splice(this.tableau[src.index].length - n, n)

    let points = 0
    if (dst.kind === 'foundation') {
      this.foundations[dst.index].push(...cards)
      if (src.kind !== 'foundation') points += POINTS.toFoundation
    } else {
      this.tableau[dst.index].push(...cards)
      if (src.kind === 'waste') points += POINTS.wasteToTableau
      else if (src.kind === 'foundation') points += POINTS.fromFoundation
    }
    this.addPoints(points)
    this.moves++
    this.events.push({ type: 'move', cards, to: dst, points })
    if (src.kind === 'tableau') this.flipTop(src.index)
    this.afterMove()
    return true
  }

  /** Turns up the new top card of a tableau column. */
  private flipTop(col: number) {
    const pile = this.tableau[col]
    const t = this.top(pile)
    if (t && !t.up) {
      t.up = true
      this.addPoints(POINTS.flip)
      this.events.push({ type: 'flip', card: t })
    }
  }

  /** Clicks on the stock: one card onto the waste, or the waste turned back over when the stock is empty. */
  draw(): boolean {
    if (this.state !== 'play' || this.finishing) return false
    if (this.stock.length) {
      this.snapshot()
      const c = this.stock.pop()!
      c.up = true
      this.waste.push(c)
      this.moves++
      this.events.push({ type: 'draw' })
      this.afterMove()
      return true
    }
    if (!this.waste.length) return false
    this.snapshot()
    this.stock = this.waste.reverse().map((c) => ({ ...c, up: false }))
    this.waste = []
    this.addPoints(POINTS.recycle)
    this.moves++
    this.events.push({ type: 'recycle' })
    return true
  }

  /** Where a card from `src` would go on a click: a foundation if it fits, else the first tableau column that takes it. */
  bestTarget(src: Source): Target | null {
    const cards = this.cardsAt(src)
    if (!cards.length) return null
    if (cards.length === 1 && src.kind !== 'foundation')
      for (let i = 0; i < 4; i++) if (this.canMove(src, { kind: 'foundation', index: i })) return { kind: 'foundation', index: i }
    // Prefer a column with cards to an empty one (a king shouldn't hop between empty columns).
    let empty: Target | null = null
    for (let i = 0; i < 7; i++) {
      if (src.kind === 'tableau' && src.index === i) continue
      if (!this.canMove(src, { kind: 'tableau', index: i })) continue
      if (this.tableau[i].length) return { kind: 'tableau', index: i }
      if (!empty && !(src.kind === 'tableau' && src.row === 0)) empty = { kind: 'tableau', index: i }
    }
    return empty
  }

  /** The original's right-click: the waste top, or else the first tableau top that fits, goes up to a foundation. */
  autoMove(): boolean {
    if (this.state !== 'play' || this.finishing) return false
    const sources: Source[] = [{ kind: 'waste' }]
    for (let i = 0; i < 7; i++) sources.push({ kind: 'tableau', index: i, row: this.tableau[i].length - 1 })
    for (const src of sources)
      for (let f = 0; f < 4; f++) if (this.canMove(src, { kind: 'foundation', index: f })) return this.move(src, { kind: 'foundation', index: f })
    return false
  }

  undo(): boolean {
    if (!this.canUndo) return false
    const s = this.history.pop()!
    this.stock = s.stock
    this.waste = s.waste
    this.foundations = s.foundations
    this.tableau = s.tableau
    this.score = s.score
    this.moves = s.moves + 1
    this.events.push({ type: 'undo' })
    return true
  }

  /** Give up: the game ends with the points so far. */
  resign(): boolean {
    if (this.state !== 'play') return false
    this.state = 'resigned'
    this.stateTime = 0
    this.finishing = false
    this.events.push({ type: 'resigned' })
    return true
  }

  /** Is there still a move that could help? (False means: no more moves.) */
  hasUsefulMove(): boolean {
    if (this.state !== 'play') return false
    const tops = (): (Card | null)[] => this.tableau.map((p) => this.top(p))
    const fits = (c: Card) =>
      this.foundations.some((f) => fitsFoundation(c, this.top(f))) || tops().some((t) => fitsTableau(c, t))
    // Any card of the stock or the waste will come round again.
    if ([...this.stock, ...this.waste].some(fits)) return true
    for (let i = 0; i < 7; i++) {
      const pile = this.tableau[i]
      for (let row = 0; row < pile.length; row++) {
        if (!pile[row].up) continue
        const src: Source = { kind: 'tableau', index: i, row }
        if (row === pile.length - 1 && this.foundations.some((f) => fitsFoundation(pile[row], this.top(f)))) return true
        for (let j = 0; j < 7; j++) {
          if (j === i || !this.canMove(src, { kind: 'tableau', index: j })) continue
          // A king moving from the bottom of one column into an empty one changes nothing.
          if (row === 0 && !this.tableau[j].length) continue
          return true
        }
      }
    }
    // Taking a card back down from a foundation helps if something could then go on it.
    for (let f = 0; f < 4; f++) {
      const c = this.top(this.foundations[f])
      if (!c) continue
      for (let j = 0; j < 7; j++) {
        if (!fitsTableau(c, this.top(this.tableau[j]))) continue
        const onIt = (x: Card) => isRed(x) !== isRed(c) && x.rank === c.rank - 1
        if ([...this.stock, ...this.waste].some(onIt)) return true
        if (this.tableau.some((p, k) => k !== j && p.some((x) => x.up && onIt(x)))) return true
      }
    }
    return false
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    this.stateTime += dt
    if (this.state !== 'play') return
    this.elapsed += dt
    if (!this.finishing) return
    this.finishClock += dt
    if (this.finishClock < 0.09) return
    this.finishClock = 0
    // Up goes the lowest card that fits.
    let best: { src: Source; f: number; rank: number } | null = null
    const consider = (src: Source) => {
      const c = this.cardsAt(src)
      if (c.length !== 1) return
      for (let f = 0; f < 4; f++)
        if (this.canMove(src, { kind: 'foundation', index: f }) && (!best || c[0].rank < best.rank)) best = { src, f, rank: c[0].rank }
    }
    consider({ kind: 'waste' })
    for (let i = 0; i < 7; i++) if (this.tableau[i].length) consider({ kind: 'tableau', index: i, row: this.tableau[i].length - 1 })
    const b = best as { src: Source; f: number; rank: number } | null
    if (b) this.move(b.src, { kind: 'foundation', index: b.f })
    else this.finishing = false
  }

  private afterMove() {
    if (this.won) {
      const bonus = winBonus(this.elapsed)
      this.addPoints(bonus)
      this.state = 'won'
      this.stateTime = 0
      this.finishing = false
      this.events.push({ type: 'won', bonus })
      return
    }
    if (!this.finishing && !this.stock.length && this.waste.length <= 1 && this.tableau.every((p) => p.every((c) => c.up))) this.finishing = true
  }
}
