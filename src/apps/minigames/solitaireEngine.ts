// Solitaire's engine for the game shell: the table layout, dragging cards
// (or clicking one to send it where it fits), the stock, cards gliding to
// their places, sounds, and the bouncing cards when you win. The rules are
// in solitaireRules.ts and the card art in solitaireCards.ts.

import type { Frame, GameEngine, Phase } from './GameShell'
import { FONT, Floaters, Particles, drawMark, fmt, glowText, rgba } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import { CardSprites, CH, CW, RADIUS, fillSuit } from './solitaireCards'
import { SUITS, Solitaire as Rules, type Card, type SolitaireEvent, type Source, type Target } from './solitaireRules'

export const W = 560
export const H = 480
const MARGIN = 20
const PITCH = CW + 12
const TOP = 16
export const TABLEAU_Y = TOP + CH + 20
const FAN_DOWN = 8
const FAN_UP = 22
const WASTE_FAN = 16

const DRAW_KEYS = ['Space', 'KeyD']
const AUTO_KEYS = ['KeyA']
const UNDO_KEYS = ['KeyU', 'KeyZ', 'Backspace']
const RESIGN_KEYS = ['KeyG']

export const colX = (i: number) => MARGIN + i * PITCH
export const STOCK = { x: colX(0), y: TOP }
export const WASTE = { x: colX(1), y: TOP }
export const foundationX = (i: number) => colX(3 + i)

interface Pos {
  x: number
  y: number
}

interface Placed {
  card: Card
  x: number
  y: number
  /** Where a click here picks up from (null: not pickable). */
  src: Source | null
  /** Height of the part that shows (for clicks on fanned cards). */
  shows: number
}

interface Drag {
  src: Source
  cards: Card[]
  /** Pointer offset from the first card's corner. */
  dx: number
  dy: number
  x: number
  y: number
  sx: number
  sy: number
  moved: boolean
}

interface Bouncer {
  card: Card
  x: number
  y: number
  vx: number
  vy: number
  trail: Pos[]
}

const overlap = (a: Pos & { w: number; h: number }, b: Pos & { w: number; h: number }) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

export class SolitaireEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...DRAW_KEYS, ...AUTO_KEYS, ...UNDO_KEYS, ...RESIGN_KEYS])
  readonly game = new Rules()
  readonly sprites = new CardSprites()
  phase: Phase = 'ready'
  canvas: HTMLCanvasElement | null = null
  /** True when no move is left that could help. */
  stuck = false
  private pos = new Map<number, Pos>()
  private drag: Drag | null = null
  private bouncers: Bouncer[] = []
  private launchQueue: Card[] = []
  private launchClock = 0
  private particles = new Particles(400)
  private floaters = new Floaters()
  private lastNow = 0
  private shakeCard: { id: number; t: number } | null = null

  constructor() {
    // The cards are dealt from the stock when the window opens.
    for (const p of this.layout()) this.pos.set(p.card.id, { x: STOCK.x, y: STOCK.y })
  }

  get accent() {
    return this.sprites.accent
  }
  set accent(v: string) {
    this.sprites.accent = v
  }

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const g = this.game
    const t = Math.floor(g.elapsed)
    const time = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
    if (g.state === 'won') return `Won in ${time} · ${g.moves} moves`
    const up = g.foundations.reduce((n, f) => n + f.length, 0)
    return `${up}/52 cards up · ${time}`
  }

  reset() {
    this.game.reset()
    this.drag = null
    this.bouncers = []
    this.launchQueue = []
    this.particles.clear()
    this.floaters.clear()
    this.stuck = false
    // Deal from the stock.
    this.pos.clear()
    for (const p of this.layout()) this.pos.set(p.card.id, { x: STOCK.x, y: STOCK.y })
  }

  // ------------------------------------------------------------ the layout

  /** Every card where it belongs, in drawing order. */
  layout(): Placed[] {
    const g = this.game
    const out: Placed[] = []
    g.stock.forEach((card, i) => {
      const k = Math.floor(i / 8)
      out.push({ card, x: STOCK.x - k * 0.6, y: STOCK.y - k * 0.6, src: null, shows: CH })
    })
    const shown = Math.min(3, g.waste.length)
    g.waste.forEach((card, i) => {
      const k = Math.max(0, i - (g.waste.length - shown))
      const top = i === g.waste.length - 1
      out.push({ card, x: WASTE.x + k * WASTE_FAN, y: WASTE.y, src: top ? { kind: 'waste' } : null, shows: CH })
    })
    g.foundations.forEach((pile, f) =>
      pile.forEach((card, i) =>
        out.push({ card, x: foundationX(f), y: TOP, src: i === pile.length - 1 ? { kind: 'foundation', index: f } : null, shows: CH })),
    )
    g.tableau.forEach((pile, col) => {
      const ys = this.fan(pile)
      pile.forEach((card, row) =>
        out.push({
          card, x: colX(col), y: ys[row],
          src: card.up ? { kind: 'tableau', index: col, row } : null,
          shows: row === pile.length - 1 ? CH : ys[row + 1] - ys[row],
        }))
    })
    return out
  }

  /** The y of each card in a column, squeezed to fit the table. */
  fan(pile: Card[]): number[] {
    let down = 0
    let up = 0
    for (let i = 0; i < pile.length - 1; i++) pile[i].up ? up++ : down++
    const room = H - 8 - CH - TABLEAU_Y
    const need = down * FAN_DOWN + up * FAN_UP
    const k = need > room ? room / need : 1
    const ys: number[] = []
    let y = TABLEAU_Y
    for (let i = 0; i < pile.length; i++) {
      ys.push(y)
      y += (pile[i].up ? FAN_UP : FAN_DOWN) * k
    }
    return ys
  }

  /** The topmost pickable card under a point. */
  private pick(x: number, y: number): Placed | null {
    const all = this.layout()
    for (let i = all.length - 1; i >= 0; i--) {
      const p = all[i]
      if (!p.src) continue
      if (x >= p.x && x <= p.x + CW && y >= p.y && y <= p.y + Math.max(p.shows, 6)) return p
    }
    return null
  }

  // ------------------------------------------------------------ controls

  keyDown(code: string) {
    const g = this.game
    if (DRAW_KEYS.includes(code)) g.draw()
    else if (AUTO_KEYS.includes(code)) {
      if (!g.autoMove()) this.nope()
    } else if (UNDO_KEYS.includes(code)) {
      if (!g.undo()) this.nope()
    } else if (RESIGN_KEYS.includes(code)) g.resign()
  }

  keyUp() {}

  releaseAll() {
    this.drag = null
  }

  undo() {
    if (!this.game.undo()) this.nope()
  }

  resign() {
    this.game.resign()
  }

  autoMove() {
    if (!this.game.autoMove()) this.nope()
  }

  private nope() {
    sfx('nope', () => tone({ freq: 150, dur: 0.09, type: 'square', vol: 0.05 }), 0.12)
  }

  pointerDown(x: number, y: number) {
    const g = this.game
    if (g.state !== 'play' || g.finishing) return
    if (x >= STOCK.x && x <= STOCK.x + CW && y >= STOCK.y && y <= STOCK.y + CH) {
      g.draw()
      return
    }
    const p = this.pick(x, y)
    if (!p || !p.src) return
    const cards = g.cardsAt(p.src)
    if (!cards.length) return
    this.drag = { src: p.src, cards, dx: x - p.x, dy: y - p.y, x, y, sx: x, sy: y, moved: false }
  }

  /** Window pointer moves (so a drag carries on outside the table), in client pixels. */
  clientMove(cx: number, cy: number) {
    const d = this.drag
    if (!d) return
    const p = this.toLogical(cx, cy)
    if (!p) return
    d.x = p.x
    d.y = p.y
    if (Math.hypot(d.x - d.sx, d.y - d.sy) > 4) d.moved = true
  }

  /** Window pointer release: drop the cards, or treat it as a click. */
  clientUp() {
    const d = this.drag
    this.drag = null
    if (!d) return
    const g = this.game
    if (!d.moved) {
      const t = g.bestTarget(d.src)
      if (t) g.move(d.src, t)
      else this.wobble(d.cards[0])
      return
    }
    // Where the cards overlap a pile the most, among the piles that take them.
    const box = { x: d.x - d.dx, y: d.y - d.dy, w: CW, h: CH }
    let best: Target | null = null
    let area = 0
    const tryTarget = (t: Target, r: { x: number; y: number; w: number; h: number }) => {
      const a = overlap(box, r)
      if (a > area && g.canMove(d.src, t)) {
        best = t
        area = a
      }
    }
    for (let i = 0; i < 4; i++) tryTarget({ kind: 'foundation', index: i }, { x: foundationX(i), y: TOP, w: CW, h: CH })
    for (let i = 0; i < 7; i++) {
      const pile = g.tableau[i]
      const ys = this.fan(pile)
      const y = pile.length ? ys[pile.length - 1] : TABLEAU_Y
      tryTarget({ kind: 'tableau', index: i }, { x: colX(i), y: TABLEAU_Y, w: CW, h: y + CH - TABLEAU_Y })
    }
    const target = best as Target | null
    if (target) g.move(d.src, target)
    else sfx('back', () => noise({ dur: 0.08, freq: 700, vol: 0.05, filter: 'lowpass' }), 0.1)
  }

  private wobble(card: Card) {
    this.shakeCard = { id: card.id, t: 0 }
    this.nope()
  }

  private toLogical(cx: number, cy: number): Pos | null {
    const c = this.canvas
    if (!c) return null
    const r = c.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H }
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    const g = this.game
    g.update(dt)
    let changed = false
    for (const e of g.events) {
      this.onEvent(e)
      changed = true
    }
    g.events.length = 0
    if (changed) this.stuck = g.state === 'play' && !g.finishing && !g.hasUsefulMove()

    // The win: cards leap off the foundations one by one.
    if (this.launchQueue.length) {
      this.launchClock += dt
      while (this.launchClock > 0.07 && this.launchQueue.length) {
        this.launchClock -= 0.07
        const card = this.launchQueue.shift()!
        const p = this.pos.get(card.id) ?? { x: W / 2, y: TOP }
        this.bouncers.push({ card, x: p.x, y: p.y, vx: (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 170), vy: -Math.random() * 260, trail: [] })
      }
    }
    for (const b of this.bouncers) {
      b.trail.unshift({ x: b.x, y: b.y })
      if (b.trail.length > 7) b.trail.length = 7
      b.vy += 900 * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.y > H - CH) {
        b.y = H - CH
        b.vy = -Math.abs(b.vy) * 0.72
      }
    }
    this.bouncers = this.bouncers.filter((b) => b.x > -CW - 40 && b.x < W + 40)
    this.particles.update(dt)
    this.floaters.update(dt)
  }

  private onEvent(e: SolitaireEvent) {
    switch (e.type) {
      case 'deal':
        for (let i = 0; i < 7; i++) noise({ dur: 0.05, freq: 2500, vol: 0.04, at: i * 0.05 })
        break
      case 'draw':
        sfx('draw', () => noise({ dur: 0.06, freq: 3000, vol: 0.06 }), 0.03)
        break
      case 'recycle':
        noise({ dur: 0.3, freq: 1500, to: 400, vol: 0.07 })
        this.floaters.add('−20', STOCK.x + CW / 2, STOCK.y + CH / 2, '#ff8a8a', { size: 12, life: 0.8 })
        break
      case 'move': {
        const c = e.cards[0]
        if (e.to.kind === 'foundation') {
          const x = foundationX(e.to.index) + CW / 2
          this.particles.burst(x, TOP + CH / 2, this.accent, { count: 10, speed: [40, 130], gravity: 160, life: [0.3, 0.6], size: [1.5, 3] })
          sfx('up', () => tone({ freq: 440 * Math.pow(2, (c.rank - 1) / 12), dur: 0.12, type: 'triangle', vol: 0.08 }), 0.03)
        } else sfx('place', () => noise({ dur: 0.06, freq: 900, vol: 0.08, filter: 'lowpass' }), 0.03)
        if (e.points) {
          const p = e.to.kind === 'foundation' ? { x: foundationX(e.to.index) + CW / 2, y: TOP + CH + 6 } : { x: colX(e.to.index) + CW / 2, y: TABLEAU_Y - 8 }
          this.floaters.add(e.points > 0 ? `+${e.points}` : `${e.points}`.replace('-', '−'), p.x, p.y, e.points > 0 ? '#ffffff' : '#ff8a8a', { size: 11, life: 0.7, vy: -22 })
        }
        break
      }
      case 'flip':
        sfx('flip', () => noise({ dur: 0.04, freq: 4000, vol: 0.05, filter: 'highpass' }), 0.03)
        break
      case 'undo':
        sfx('undo', () => tone({ freq: 600, to: 380, dur: 0.08, type: 'sine', vol: 0.06 }), 0.05)
        break
      case 'invalid':
        this.nope()
        break
      case 'won': {
        arpeggio([60, 64, 67, 72, 76, 79, 84, 88], 0.08, { dur: 0.18, type: 'square', vol: 0.07 })
        this.floaters.add(`Bonus +${fmt(e.bonus)}`, W / 2, H * 0.5, '#ffd83a', { size: 18, life: 2.5, pop: true, vy: -8 })
        // Kings first, round the four foundations, like the old Windows finale.
        const q: Card[] = []
        for (let r = 12; r >= 0; r--) for (const f of this.game.foundations) if (f[r]) q.push(f[r])
        this.launchQueue = q
        this.launchClock = 0
        break
      }
      case 'resigned':
        tone({ freq: 300, to: 150, dur: 0.4, type: 'triangle', vol: 0.08 })
        break
    }
  }

  // ------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    this.phase = f.phase
    this.canvas = ctx.canvas
    const dt = this.lastNow ? Math.min(0.1, (f.now - this.lastNow) / 1000) : 0
    this.lastNow = f.now
    const g = this.game
    this.drawTable(ctx)

    const launched = new Set(this.bouncers.map((b) => b.card.id))
    const dragged = new Set(this.drag?.moved ? this.drag.cards.map((c) => c.id) : [])
    const moving: { card: Card; x: number; y: number }[] = []
    // Cards glide to where they belong; those still travelling are drawn on top.
    const k = 1 - Math.exp(-dt * 16)
    for (const p of this.layout()) {
      if (launched.has(p.card.id)) continue
      let cur = this.pos.get(p.card.id)
      if (!cur) this.pos.set(p.card.id, (cur = { x: p.x, y: p.y }))
      if (dragged.has(p.card.id)) continue
      cur.x += (p.x - cur.x) * k
      cur.y += (p.y - cur.y) * k
      if (Math.abs(cur.x - p.x) < 0.3 && Math.abs(cur.y - p.y) < 0.3) {
        cur.x = p.x
        cur.y = p.y
      }
      let x = cur.x
      if (this.shakeCard?.id === p.card.id) x += Math.sin(this.shakeCard.t * 60) * 3 * (1 - this.shakeCard.t / 0.3)
      if (cur.x !== p.x || cur.y !== p.y) moving.push({ card: p.card, x, y: cur.y })
      else this.drawCard(ctx, p.card, x, cur.y, f.scale, false)
    }
    if (this.shakeCard && (this.shakeCard.t += dt) > 0.3) this.shakeCard = null
    for (const m of moving) this.drawCard(ctx, m.card, m.x, m.y, f.scale, true)

    const d = this.drag
    if (d?.moved) {
      d.cards.forEach((c, i) => {
        const x = d.x - d.dx
        const y = d.y - d.dy + i * FAN_UP
        this.pos.set(c.id, { x, y })
        this.drawCard(ctx, c, x, y, f.scale, true)
      })
    }

    for (const b of this.bouncers) {
      for (let i = b.trail.length - 1; i >= 1; i -= 2) {
        ctx.globalAlpha = 0.25 * (1 - i / b.trail.length)
        this.drawCard(ctx, b.card, b.trail[i].x, b.trail[i].y, f.scale, false)
      }
      ctx.globalAlpha = 1
      this.drawCard(ctx, b.card, b.x, b.y, f.scale, true)
    }
    this.particles.draw(ctx)
    this.floaters.draw(ctx)

    if (g.state === 'won') {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const pop = 1 + 0.3 * Math.max(0, 1 - g.stateTime / 0.25)
      glowText(ctx, 'YOU WIN!', W / 2, H * 0.4, '#ffd83a', 40 * pop, 900)
    } else if (this.stuck && f.phase === 'playing') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.beginPath()
      ctx.roundRect(W / 2 - 170, H - 44, 340, 30, 15)
      ctx.fill()
      ctx.font = `700 12px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffd83a'
      ctx.fillText('No more moves · U to undo · G to give up', W / 2, H - 29)
    }
  }

  private drawTable(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const felt = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H / 2, W * 0.75)
    felt.addColorStop(0, '#13502d')
    felt.addColorStop(1, '#06210f')
    ctx.fillStyle = felt
    ctx.fillRect(0, 0, W, H)
    drawMark(ctx, W / 2, H * 0.62, 220, 'rgba(255,255,255,0.035)', 12)

    const slot = (x: number, y: number) => {
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.beginPath()
      ctx.roundRect(x, y, CW, CH, RADIUS)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.2)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.roundRect(x + 0.6, y + 0.6, CW - 1.2, CH - 1.2, RADIUS)
      ctx.stroke()
    }
    const label = (text: string, x: number, y: number, size = 11) => {
      ctx.font = `800 ${size}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(255,255,255,0.32)'
      ctx.fillText(text, x, y)
    }

    slot(STOCK.x, STOCK.y)
    if (!g.stock.length) {
      if (g.waste.length) {
        // Click to turn the waste over.
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(STOCK.x + CW / 2, STOCK.y + CH / 2, 13, -Math.PI * 0.35, Math.PI * 1.35)
        ctx.stroke()
        const a = Math.PI * 1.35
        const ax = STOCK.x + CW / 2 + Math.cos(a) * 13
        const ay = STOCK.y + CH / 2 + Math.sin(a) * 13
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.beginPath()
        ctx.moveTo(ax - 6, ay - 1)
        ctx.lineTo(ax + 5, ay - 4)
        ctx.lineTo(ax + 1, ay + 6)
        ctx.fill()
        label('RESET', STOCK.x + CW / 2, STOCK.y + CH - 12, 9)
      } else label('STOCK', STOCK.x + CW / 2, STOCK.y + CH / 2, 10)
    }
    slot(WASTE.x, WASTE.y)
    if (!g.waste.length) label('WASTE', WASTE.x + CW / 2, WASTE.y + CH / 2, 10)
    for (let i = 0; i < 4; i++) {
      slot(foundationX(i), TOP)
      fillSuit(ctx, SUITS[i], foundationX(i) + CW / 2, TOP + CH / 2, 26, 'rgba(255,255,255,0.16)')
    }
    for (let i = 0; i < 7; i++) {
      slot(colX(i), TABLEAU_Y)
      if (!g.tableau[i].length) label('K', colX(i) + CW / 2, TABLEAU_Y + CH / 2, 22)
    }
  }

  private drawCard(ctx: CanvasRenderingContext2D, card: Card, x: number, y: number, scale: number, lifted: boolean) {
    ctx.fillStyle = lifted ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.28)'
    ctx.beginPath()
    if (lifted) ctx.roundRect(x + 2, y + 5, CW, CH, RADIUS)
    else ctx.roundRect(x, y + 1.2, CW, CH, RADIUS)
    ctx.fill()
    ctx.drawImage(this.sprites.get(card, scale), x, y, CW, CH)
    if (lifted && this.drag?.moved && this.drag.cards[0] === card) {
      ctx.strokeStyle = rgba(this.accent, 0.9)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(x - 1, y - 1, CW + 2, CH + 2, RADIUS + 1)
      ctx.stroke()
    }
  }
}
