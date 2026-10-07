// Material Lab's engine for the game shell: the bench drawn on the canvas
// (periodic table, reactor, thermometer, furnace, buttons, discoveries and
// the recipe book), clicks and drags, keys, particles and sounds. The rules
// and the 44 reactions are in materialLabRules.ts.

import type { Frame, GameEngine, Phase } from './GameShell'
import { FONT, Floaters, Particles, drawMark, glowText, rgba, shade } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import {
  CATEGORY_COLORS, CATEGORY_NAMES, ELEMENT, ELEMENTS, GROUPS, MAX_FUEL, MaterialLab as Rules, REACTIONS, REACT_TIME, TABLE_POS,
  type Category, type LabEvent, type ProductPhase, type Reaction,
} from './materialLabRules'

export const W = 720
export const H = 480

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

// ---------------------------------------------------------------- the bench

const CELL = 34
const PITCH = 38
const TABLE_X = 16
const TABLE_Y = 34
export const cellRect = (symbol: string): Rect => {
  const [row, col] = TABLE_POS[symbol]
  return { x: TABLE_X + col * PITCH, y: TABLE_Y + row * PITCH, w: CELL, h: CELL }
}
const REACTOR: Rect = { x: 400, y: 64, w: 160, h: 180 }
const THERMO: Rect = { x: 596, y: 64, w: 16, h: 180 }
const MAX_SHOWN_TEMP = 1200
const FURNACE: Rect = { x: 420, y: 254, w: 120, h: 34 }
const FUEL_MINUS: Rect = { x: 372, y: 300, w: 26, h: 24 }
const FUEL_BAR: Rect = { x: 404, y: 304, w: 152, h: 16 }
const FUEL_PLUS: Rect = { x: 562, y: 300, w: 26, h: 24 }
const SWITCH: Rect = { x: 604, y: 300, w: 84, h: 24 }
const CLEAR: Rect = { x: 372, y: 334, w: 76, h: 30 }
const REACT: Rect = { x: 456, y: 334, w: 132, h: 30 }
const BOOK: Rect = { x: 604, y: 334, w: 84, h: 30 }
const FACT: Rect = { x: 340, y: 374, w: 364, h: 96 }
const BOOK_TABS: Rect[] = [
  { x: 560, y: 30, w: 60, h: 22 },
  { x: 626, y: 30, w: 60, h: 22 },
]

const REACT_KEYS = ['KeyR', 'Enter', 'NumpadEnter']
const CLEAR_KEYS = ['KeyC']
const FURNACE_KEYS = ['KeyF']
const PLUS_KEYS = ['Equal', 'NumpadAdd', 'BracketRight']
const MINUS_KEYS = ['Minus', 'NumpadSubtract', 'BracketLeft']
const BOOK_KEYS = ['KeyB']
const BACK_KEYS = ['Backspace']
const FINISH_KEYS = ['KeyE']
const PAGE_KEYS = ['ArrowLeft', 'ArrowRight', 'Digit1', 'Digit2']

const FEEDBACK_COLORS: Record<string, string> = {
  empty: '#ff6b6b', cold: '#ffb347', hot: '#ff6b6b', none: '#b8c2bc', new: '#46e05b', again: '#6fb7ff', mastered: '#b8c2bc',
  locked: '#b8c2bc', full: '#ffb347',
}

const PHASE_NAMES: Record<ProductPhase, string> = { solid: 'Solid', liquid: 'Liquid', gas: 'Gas' }

interface Message {
  text: string
  color: string
  t: number
}

interface Drag {
  symbol: string
  x: number
  y: number
  sx: number
  sy: number
  moved: boolean
}

/** Splits text into lines no wider than `width` in the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > width && line) {
      out.push(line)
      line = word
    } else line = test
  }
  if (line) out.push(line)
  return out
}

/** A little drawn sign for a product's phase: a drop, a cloud or a crystal. */
function phaseIcon(ctx: CanvasRenderingContext2D, phase: ProductPhase, x: number, y: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  if (phase === 'liquid') {
    ctx.moveTo(x, y - 5)
    ctx.quadraticCurveTo(x + 4.5, y + 1, x, y + 4.5)
    ctx.quadraticCurveTo(x - 4.5, y + 1, x, y - 5)
  } else if (phase === 'gas') {
    ctx.arc(x - 2.5, y + 1, 2.6, 0, Math.PI * 2)
    ctx.moveTo(x + 5.3, y + 1)
    ctx.arc(x + 2.7, y + 1, 2.6, 0, Math.PI * 2)
    ctx.moveTo(x + 2.8, y - 2)
    ctx.arc(x, y - 2, 2.8, 0, Math.PI * 2)
  } else {
    ctx.moveTo(x, y - 5)
    ctx.lineTo(x + 4, y)
    ctx.lineTo(x, y + 5)
    ctx.lineTo(x - 4, y)
  }
  ctx.closePath()
  ctx.fill()
}

export class MaterialLabEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([
    ...REACT_KEYS, ...CLEAR_KEYS, ...FURNACE_KEYS, ...PLUS_KEYS, ...MINUS_KEYS, ...BOOK_KEYS, ...BACK_KEYS, ...FINISH_KEYS, ...PAGE_KEYS,
  ])
  readonly game = new Rules()
  accent = '#22b357'
  phase: Phase = 'ready'
  canvas: HTMLCanvasElement | null = null
  /** The recipe book's page, or -1 when it is shut. */
  book = -1
  private particles = new Particles(500)
  private floaters = new Floaters()
  private message: Message | null = null
  private drag: Drag | null = null
  private hover: { x: number; y: number } | null = null
  private flash = 0
  private shakeCell: { symbol: string; t: number } | null = null
  private clock = 0

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const g = this.game
    return `${g.discovered.size}/${REACTIONS.length} discovered${g.state === 'complete' ? ' · all!' : ''}`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.message = null
    this.drag = null
    this.book = -1
    this.flash = 0
  }

  // ------------------------------------------------------------ actions

  react() {
    if (this.book >= 0) this.book = -1
    this.game.react()
  }

  clear() {
    this.game.clear()
  }

  toggleFurnace() {
    if (!this.game.toggleFurnace()) this.say('Add some fuel first (+)', '#ffb347')
  }

  toggleBook() {
    this.book = this.book >= 0 ? -1 : 0
    tone({ freq: this.book >= 0 ? 520 : 390, dur: 0.06, type: 'triangle', vol: 0.05 })
  }

  finish() {
    this.game.finish()
  }

  private say(text: string, color: string) {
    this.message = { text, color, t: 0 }
  }

  // ------------------------------------------------------------ controls

  keyDown(code: string) {
    const g = this.game
    if (PAGE_KEYS.includes(code)) {
      if (this.book >= 0) this.book = code === 'ArrowLeft' || code === 'Digit1' ? 0 : 1
      return
    }
    if (BOOK_KEYS.includes(code)) return this.toggleBook()
    if (this.book >= 0 && !REACT_KEYS.includes(code)) this.book = -1
    if (REACT_KEYS.includes(code)) this.react()
    else if (CLEAR_KEYS.includes(code)) this.clear()
    else if (FURNACE_KEYS.includes(code)) this.toggleFurnace()
    else if (PLUS_KEYS.includes(code)) g.setFuel(g.fuel + 1)
    else if (MINUS_KEYS.includes(code)) g.setFuel(g.fuel - 1)
    else if (BACK_KEYS.includes(code)) {
      if (g.takeBack()) sfx('back', () => tone({ freq: 600, to: 380, dur: 0.07, type: 'sine', vol: 0.05 }), 0.04)
    } else if (FINISH_KEYS.includes(code)) this.finish()
  }

  keyUp() {}

  releaseAll() {
    this.drag = null
  }

  pointerMove(x: number, y: number) {
    this.hover = { x, y }
    const c = this.canvas
    if (c) c.style.cursor = this.clickable(x, y) ? 'pointer' : ''
  }

  private clickable(x: number, y: number): boolean {
    if (this.book >= 0) return true
    for (const r of [FUEL_MINUS, FUEL_PLUS, SWITCH, CLEAR, REACT, BOOK, FURNACE]) if (inside(r, x, y)) return true
    for (const e of ELEMENTS) if (this.game.unlocked.has(e.symbol) && inside(cellRect(e.symbol), x, y)) return true
    return this.chips().some((c) => inside(c, x, y))
  }

  pointerDown(x: number, y: number) {
    const g = this.game
    if (g.state !== 'play') return
    if (this.book >= 0) {
      const tab = BOOK_TABS.findIndex((r) => inside(r, x, y))
      if (tab >= 0) this.book = tab
      else this.book = -1
      return
    }
    if (inside(FUEL_MINUS, x, y)) return g.setFuel(g.fuel - 1)
    if (inside(FUEL_PLUS, x, y)) return g.setFuel(g.fuel + 1)
    if (inside(FUEL_BAR, x, y)) return g.setFuel(Math.ceil(((x - FUEL_BAR.x) / FUEL_BAR.w) * MAX_FUEL))
    if (inside(SWITCH, x, y) || inside(FURNACE, x, y)) return this.toggleFurnace()
    if (inside(CLEAR, x, y)) return this.clear()
    if (inside(REACT, x, y)) return this.react()
    if (inside(BOOK, x, y)) return this.toggleBook()
    const chip = this.chips().find((c) => inside(c, x, y))
    if (chip) {
      if (g.removeOne(chip.symbol)) sfx('back', () => tone({ freq: 600, to: 380, dur: 0.07, type: 'sine', vol: 0.05 }), 0.04)
      return
    }
    for (const e of ELEMENTS) {
      if (!inside(cellRect(e.symbol), x, y)) continue
      if (!g.unlocked.has(e.symbol)) {
        this.shakeCell = { symbol: e.symbol, t: 0 }
        g.add(e.symbol) // reports it as locked
        return
      }
      this.drag = { symbol: e.symbol, x, y, sx: x, sy: y, moved: false }
      return
    }
  }

  /** Window pointer moves while dragging an element, in client pixels. */
  clientMove(cx: number, cy: number) {
    const d = this.drag
    const p = this.toLogical(cx, cy)
    if (!d || !p) return
    d.x = p.x
    d.y = p.y
    if (Math.hypot(d.x - d.sx, d.y - d.sy) > 4) d.moved = true
  }

  /** A click on an element puts it in; a drag puts it in if it lands on the reactor. */
  clientUp() {
    const d = this.drag
    this.drag = null
    if (!d) return
    const drop = { x: REACTOR.x - 16, y: REACTOR.y - 16, w: REACTOR.w + 32, h: REACTOR.h + 32 }
    if (!d.moved || inside(drop, d.x, d.y)) this.game.add(d.symbol)
    else sfx('miss', () => noise({ dur: 0.07, freq: 600, vol: 0.04, filter: 'lowpass' }), 0.1)
  }

  private toLogical(cx: number, cy: number) {
    const c = this.canvas
    if (!c) return null
    const r = c.getBoundingClientRect()
    if (!r.width || !r.height) return null
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H }
  }

  /** The atom chips inside the reactor (a click takes one out). */
  private chips(): (Rect & { symbol: string; n: number })[] {
    const out: (Rect & { symbol: string; n: number })[] = []
    let x = REACTOR.x + 12
    let y = REACTOR.y + 14
    for (const [symbol, n] of this.game.contents) {
      const w = 46
      if (x + w > REACTOR.x + REACTOR.w - 10) {
        x = REACTOR.x + 12
        y += 24
      }
      out.push({ x, y, w, h: 20, symbol, n })
      x += w + 6
    }
    return out
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    const g = this.game
    this.clock += dt
    g.update(dt)
    for (const e of g.events) this.onEvent(e)
    g.events.length = 0

    // The furnace burns, the reactor bubbles or fumes.
    if (g.furnaceOn && Math.random() < 0.25 + g.fuel * 0.06) {
      const heat = Math.min(255, 100 + g.fuel * 15)
      const color = [`rgb(${heat},40,0)`, `rgb(255,${Math.floor(heat / 2)},0)`, `rgb(255,${heat},40)`][Math.floor(Math.random() * 3)]
      this.particles.burst(FURNACE.x + FURNACE.w / 2 + (Math.random() - 0.5) * 70, FURNACE.y + 4, color, {
        count: 1, speed: [30, 60 + g.fuel * 8], angle: -Math.PI / 2, spread: 0.5, gravity: -40, drag: 1, life: [0.25, 0.5], size: [2, 4.5], square: false,
      })
    }
    const p = g.product
    if (p && p.age < REACT_TIME) {
      const r = p.reaction
      const bx = REACTOR.x + 14 + Math.random() * (REACTOR.w - 28)
      if (r.phase === 'liquid' && Math.random() < 0.6)
        this.particles.burst(bx, REACTOR.y + REACTOR.h - 10, '#e6f6ff', { count: 1, speed: [20, 50], angle: -Math.PI / 2, spread: 0.3, gravity: -60, drag: 0.5, life: [0.6, 1], size: [2, 4], square: false })
      else if (r.phase === 'gas' && Math.random() < 0.7)
        this.particles.burst(bx, REACTOR.y + REACTOR.h * 0.6, r.particles, { count: 1, speed: [10, 40], gravity: -50, drag: 0.6, life: [0.9, 1.6], size: [3, 6], square: false })
      else if (r.phase === 'solid' && Math.random() < 0.4)
        this.particles.burst(bx, REACTOR.y + REACTOR.h - 26, r.particles, { count: 1, speed: [30, 90], angle: -Math.PI / 2, spread: 1.4, gravity: 220, life: [0.3, 0.6], size: [1.5, 3] })
    }
    this.particles.update(dt)
    this.floaters.update(dt)
    this.flash = Math.max(0, this.flash - dt * 2)
    if (this.message) this.message.t += dt
    if (this.shakeCell && (this.shakeCell.t += dt) > 0.3) this.shakeCell = null
  }

  private onEvent(e: LabEvent) {
    switch (e.type) {
      case 'add': {
        const el = ELEMENT.get(e.symbol)!
        sfx('add', () => tone({ freq: 300 + el.z * 22, dur: 0.07, type: 'sine', vol: 0.08 }), 0.03)
        this.particles.burst(REACTOR.x + REACTOR.w / 2, REACTOR.y + 30, CATEGORY_COLORS[el.category], { count: 6, speed: [30, 90], gravity: 120, life: [0.2, 0.45], size: [1.5, 3] })
        break
      }
      case 'locked':
        this.say(`${ELEMENT.get(e.symbol)!.name} is locked: discover more compounds to unlock it`, FEEDBACK_COLORS.locked)
        sfx('nope', () => tone({ freq: 150, dur: 0.1, type: 'square', vol: 0.05 }), 0.15)
        break
      case 'full':
        this.say('The reactor is full', FEEDBACK_COLORS.full)
        sfx('nope', () => tone({ freq: 150, dur: 0.1, type: 'square', vol: 0.05 }), 0.15)
        break
      case 'clear':
        noise({ dur: 0.25, freq: 1200, to: 300, vol: 0.06 })
        break
      case 'fuel':
        sfx('fuel', () => tone({ freq: 400 + e.level * 40, dur: 0.05, type: 'square', vol: 0.05 }), 0.03)
        break
      case 'furnace':
        if (e.on) noise({ dur: 0.4, freq: 500, to: 200, vol: 0.12, filter: 'lowpass' })
        else tone({ freq: 300, to: 150, dur: 0.15, type: 'triangle', vol: 0.05 })
        break
      case 'react': {
        const r = e.result
        this.say(r.message, FEEDBACK_COLORS[r.kind] ?? '#ffffff')
        if (r.kind === 'new' || r.kind === 'again' || r.kind === 'mastered') {
          noise({ dur: 0.5, freq: 2500, to: 800, vol: 0.07 })
          if (r.points) this.floaters.add(`+${r.points}`, REACTOR.x + REACTOR.w / 2, REACTOR.y + 40, '#ffffff', { size: 16, life: 1, vy: -30 })
        } else sfx('fail', () => tone({ freq: 180, to: 120, dur: 0.18, type: 'square', vol: 0.06 }), 0.15)
        if (r.kind === 'new') {
          this.flash = 1
          arpeggio([67, 72, 76, 79], 0.07, { dur: 0.14, type: 'triangle', vol: 0.09 })
          this.particles.burst(REACTOR.x + REACTOR.w / 2, REACTOR.y + REACTOR.h / 2, '#ffd83a', { count: 24, speed: [60, 200], gravity: 120, life: [0.5, 1], size: [2, 3.5], square: false })
          for (const s of r.unlocked) {
            const c = cellRect(s)
            this.particles.burst(c.x + CELL / 2, c.y + CELL / 2, CATEGORY_COLORS[ELEMENT.get(s)!.category], { count: 16, speed: [40, 140], gravity: 0, drag: 2, life: [0.5, 0.9], size: [2, 3] })
            this.floaters.add(`${s} unlocked!`, c.x + CELL / 2, c.y - 4, '#ffd83a', { size: 11, life: 1.6, vy: -14 })
          }
        }
        break
      }
      case 'complete':
        this.say(`Every reaction discovered! +500 bonus`, '#ffd83a')
        arpeggio([60, 64, 67, 72, 76, 79, 84], 0.08, { dur: 0.16, type: 'square', vol: 0.08 })
        break
      case 'finished':
        tone({ freq: 392, dur: 0.15, type: 'triangle', vol: 0.08 })
        tone({ freq: 523, dur: 0.3, type: 'triangle', vol: 0.08, at: 0.15 })
        break
    }
  }

  // ------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    this.phase = f.phase
    this.canvas = ctx.canvas
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0b1a11')
    bg.addColorStop(1, '#040906')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    drawMark(ctx, 522, 210, 240, rgba(this.accent, 0.04), 12)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.beginPath()
    ctx.moveTo(328.5, 12)
    ctx.lineTo(328.5, H - 12)
    ctx.stroke()

    this.drawTable(ctx)
    this.drawDiscoveries(ctx)
    this.drawReactor(ctx)
    this.drawThermometer(ctx)
    this.drawControls(ctx)
    this.drawFact(ctx)
    this.particles.draw(ctx)
    this.drawMessage(ctx)
    this.floaters.draw(ctx)
    if (this.drag?.moved) this.drawTile(ctx, this.drag.symbol, this.drag.x - CELL / 2, this.drag.y - CELL / 2, true, true)
    if (this.book >= 0) this.drawBook(ctx)
    if (this.game.state === 'complete') {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      glowText(ctx, 'LAB COMPLETE!', W / 2, H * 0.45, '#ffd83a', 38, 900)
    }
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'left') {
    ctx.font = `800 9.5px ${FONT}`
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(200,230,210,0.55)'
    ctx.fillText(text.split('').join(String.fromCharCode(8202)), x, y)
  }

  private drawTile(ctx: CanvasRenderingContext2D, symbol: string, x: number, y: number, unlocked: boolean, lifted = false) {
    const el = ELEMENT.get(symbol)!
    const color = CATEGORY_COLORS[el.category]
    const hot = !!this.hover && !this.drag && unlocked && inside({ x, y, w: CELL, h: CELL }, this.hover.x, this.hover.y)
    ctx.save()
    if (lifted || hot) {
      ctx.shadowColor = color
      ctx.shadowBlur = lifted ? 16 : 10
    }
    ctx.fillStyle = unlocked ? color : '#2a332e'
    ctx.beginPath()
    ctx.roundRect(x, y, CELL, CELL, 5)
    ctx.fill()
    ctx.restore()
    if (unlocked) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(x + 3, y + 2, CELL - 6, 1.2)
      ctx.strokeStyle = shade(color, -0.45)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1, 5)
      ctx.stroke()
      ctx.fillStyle = '#10140f'
      ctx.font = `600 8px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText(String(el.z), x + 3, y + 2.5)
      ctx.font = `800 15px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(symbol, x + CELL / 2, y + CELL / 2 + 2)
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1, 5)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.font = `800 15px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('?', x + CELL / 2, y + CELL / 2 + 1)
    }
  }

  private drawTable(ctx: CanvasRenderingContext2D) {
    const g = this.game
    this.label(ctx, 'PERIODIC TABLE', TABLE_X, 20)
    this.label(ctx, `${g.unlocked.size}/${ELEMENTS.length} UNLOCKED`, TABLE_X + 8 * PITCH - 4, 20, 'right')
    for (const e of ELEMENTS) {
      const r = cellRect(e.symbol)
      let x = r.x
      if (this.shakeCell?.symbol === e.symbol) x += Math.sin(this.shakeCell.t * 60) * 3
      this.drawTile(ctx, e.symbol, x, r.y, g.unlocked.has(e.symbol))
    }
    // The hovered element's name.
    const h = this.hover
    const over = h && ELEMENTS.find((e) => inside(cellRect(e.symbol), h.x, h.y))
    if (over && g.unlocked.has(over.symbol) && !this.drag) {
      ctx.font = `700 11px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#e8fff0'
      ctx.fillText(`${over.name} · ${CATEGORY_NAMES[over.category]}`, TABLE_X + 3 * PITCH - 6, TABLE_Y + 3 * PITCH + CELL + 14)
    }
    // Legend.
    const cats = Object.keys(CATEGORY_COLORS) as Category[]
    cats.forEach((c, i) => {
      const x = TABLE_X + (i % 2) * 150
      const y = 210 + Math.floor(i / 2) * 15
      ctx.fillStyle = CATEGORY_COLORS[c]
      ctx.beginPath()
      ctx.roundRect(x, y - 4.5, 9, 9, 2)
      ctx.fill()
      ctx.font = `500 10px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(220,235,225,0.7)'
      ctx.fillText(CATEGORY_NAMES[c], x + 14, y)
    })
  }

  private drawDiscoveries(ctx: CanvasRenderingContext2D) {
    const g = this.game
    this.label(ctx, 'RECENT DISCOVERIES', TABLE_X, 286)
    this.label(ctx, `${g.discovered.size}/${REACTIONS.length}`, TABLE_X + 300, 286, 'right')
    if (!g.recent.length) {
      ctx.font = `500 11px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(220,235,225,0.45)'
      ctx.fillText('Nothing yet. Try 2 H and 1 O at room temperature.', TABLE_X, 308)
      return
    }
    g.recent.slice(0, 16).forEach((r, i) => {
      const x = TABLE_X + (i < 8 ? 0 : 154)
      const y = 306 + (i % 8) * 20
      phaseIcon(ctx, r.phase, x + 5, y, r.color === '#151515' ? '#666666' : r.color)
      ctx.font = `600 11px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = i === 0 ? '#46e05b' : 'rgba(220,240,228,0.85)'
      const name = r.name.length > 21 ? `${r.name.slice(0, 20)}…` : r.name
      ctx.fillText(name, x + 14, y)
    })
  }

  private drawReactor(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const r = REACTOR
    this.label(ctx, 'REACTOR', r.x + r.w / 2, r.y - 12, 'center')
    const path = () => {
      ctx.beginPath()
      ctx.moveTo(r.x, r.y)
      ctx.lineTo(r.x, r.y + r.h - 18)
      ctx.quadraticCurveTo(r.x, r.y + r.h, r.x + 18, r.y + r.h)
      ctx.lineTo(r.x + r.w - 18, r.y + r.h)
      ctx.quadraticCurveTo(r.x + r.w, r.y + r.h, r.x + r.w, r.y + r.h - 18)
      ctx.lineTo(r.x + r.w, r.y)
    }
    // Glass.
    path()
    ctx.fillStyle = 'rgba(180,230,255,0.05)'
    ctx.fill()

    // What the last reaction made.
    const p = g.product
    if (p) {
      const re = p.reaction
      const fade = re.phase === 'gas' ? Math.max(0, 1 - p.age / (REACT_TIME * 2.5)) : 1
      ctx.save()
      path()
      ctx.clip()
      if (re.phase === 'liquid') {
        const level = Math.max(0.15, 0.7 - Math.max(0, p.age - REACT_TIME) * 0.005)
        const top = r.y + r.h * (1 - level)
        const wave = Math.sin(this.clock * 3) * 2
        const liq = ctx.createLinearGradient(0, top, 0, r.y + r.h)
        liq.addColorStop(0, rgba(re.color, 0.85))
        liq.addColorStop(1, rgba(shade(re.color, -0.3), 0.95))
        ctx.fillStyle = liq
        ctx.beginPath()
        ctx.moveTo(r.x, top + wave)
        ctx.quadraticCurveTo(r.x + r.w / 2, top - wave, r.x + r.w, top + wave)
        ctx.lineTo(r.x + r.w, r.y + r.h)
        ctx.lineTo(r.x, r.y + r.h)
        ctx.fill()
      } else if (re.phase === 'gas') {
        const gas = ctx.createLinearGradient(0, r.y, 0, r.y + r.h)
        gas.addColorStop(0, rgba(re.color, 0.12 * fade))
        gas.addColorStop(1, rgba(re.color, 0.45 * fade))
        ctx.fillStyle = gas
        ctx.fillRect(r.x, r.y, r.w, r.h)
      } else {
        // A heap of powder or crystals.
        const col = re.color
        ctx.fillStyle = col === '#151515' ? '#2a2a2a' : col
        ctx.beginPath()
        ctx.moveTo(r.x, r.y + r.h)
        ctx.lineTo(r.x, r.y + r.h - 16)
        ctx.quadraticCurveTo(r.x + r.w / 2, r.y + r.h - 40, r.x + r.w, r.y + r.h - 16)
        ctx.lineTo(r.x + r.w, r.y + r.h)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        for (let i = 0; i < 9; i++) ctx.fillRect(r.x + 20 + ((i * 37) % (r.w - 40)), r.y + r.h - 14 - ((i * 13) % 12), 2, 2)
      }
      ctx.restore()
      if (p.age < REACT_TIME + 6) {
        ctx.globalAlpha = Math.min(1, (REACT_TIME + 6 - p.age) / 1)
        ctx.font = `800 15px ${FONT}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#ffffff'
        ctx.fillText(re.equation.split('→')[1]?.trim() ?? re.product, r.x + r.w / 2, r.y + r.h - 56)
        ctx.globalAlpha = 1
      }
    } else if (g.atoms) {
      ctx.save()
      path()
      ctx.clip()
      ctx.fillStyle = 'rgba(200,210,205,0.10)'
      ctx.fillRect(r.x, r.y + r.h * 0.45, r.w, r.h)
      ctx.restore()
    }

    // The atoms in it, as chips (click one to take it out).
    for (const c of this.chips()) {
      const el = ELEMENT.get(c.symbol)!
      const hot = this.hover && inside(c, this.hover.x, this.hover.y)
      ctx.fillStyle = CATEGORY_COLORS[el.category]
      ctx.globalAlpha = hot ? 0.75 : 1
      ctx.beginPath()
      ctx.roundRect(c.x, c.y, c.w, c.h, 10)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillStyle = '#10140f'
      ctx.font = `800 11px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(hot ? `− ${c.symbol}` : `${c.symbol} ×${c.n}`, c.x + c.w / 2, c.y + c.h / 2 + 0.5)
    }
    if (!g.atoms && !p) {
      ctx.font = `500 11px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(220,235,225,0.4)'
      ctx.fillText('Drag or click', r.x + r.w / 2, r.y + r.h / 2 - 8)
      ctx.fillText('elements in here', r.x + r.w / 2, r.y + r.h / 2 + 8)
    }

    // The glass outline, with a highlight; it glows while an element is dragged over it.
    const dragOver = this.drag?.moved && inside({ x: r.x - 16, y: r.y - 16, w: r.w + 32, h: r.h + 32 }, this.drag.x, this.drag.y)
    ctx.save()
    if (dragOver || this.flash > 0) {
      ctx.shadowColor = dragOver ? this.accent : '#ffd83a'
      ctx.shadowBlur = 18
    }
    path()
    ctx.strokeStyle = dragOver ? this.accent : 'rgba(210,235,255,0.65)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(r.x + 10, r.y + 12)
    ctx.lineTo(r.x + 10, r.y + r.h - 30)
    ctx.stroke()
    ctx.fillStyle = 'rgba(210,235,255,0.65)'
    ctx.fillRect(r.x - 6, r.y - 2, 12, 3)
    ctx.fillRect(r.x + r.w - 6, r.y - 2, 12, 3)
  }

  private drawThermometer(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const t = g.temperature
    const r = THERMO
    const yOf = (v: number) => r.y + r.h - 12 - (Math.min(MAX_SHOWN_TEMP, v) / MAX_SHOWN_TEMP) * (r.h - 24)
    ctx.font = `800 14px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = t > 100 ? '#ff8a5c' : '#e8fff0'
    ctx.fillText(`${Math.round(t)} °C`, r.x + r.w / 2 + 20, r.y - 12)
    ctx.fillStyle = 'rgba(255,255,255,0.08)'
    ctx.strokeStyle = 'rgba(210,235,255,0.5)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, r.w / 2)
    ctx.fill()
    ctx.stroke()
    const hotness = Math.min(1, t / 1000)
    const fill = `rgb(255,${Math.round(200 - 150 * hotness)},${Math.round(80 - 60 * hotness)})`
    ctx.save()
    ctx.shadowColor = fill
    ctx.shadowBlur = 6 + hotness * 10
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(r.x + 4, yOf(t), r.w - 8, r.y + r.h - 4 - yOf(t), (r.w - 8) / 2)
    ctx.fill()
    ctx.restore()
    // The furnace's setting, as a tick.
    const target = g.targetTemp
    ctx.strokeStyle = '#ffd83a'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(r.x - 5, yOf(target))
    ctx.lineTo(r.x, yOf(target))
    ctx.stroke()
    ctx.font = `600 8.5px ${FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    for (let v = 0; v <= MAX_SHOWN_TEMP; v += 200) {
      ctx.fillStyle = 'rgba(220,235,225,0.5)'
      ctx.fillRect(r.x + r.w + 2, yOf(v), 4, 1)
      ctx.fillText(String(v), r.x + r.w + 9, yOf(v))
    }
  }

  private button(ctx: CanvasRenderingContext2D, r: Rect, text: string, color: string, on = true) {
    const hot = this.hover && inside(r, this.hover.x, this.hover.y)
    const body = ctx.createLinearGradient(0, r.y, 0, r.y + r.h)
    body.addColorStop(0, shade(color, hot ? 0.25 : 0.1))
    body.addColorStop(1, shade(color, -0.25))
    ctx.globalAlpha = on ? 1 : 0.4
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, 6)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.fillRect(r.x + 4, r.y + 1.5, r.w - 8, 1)
    ctx.font = `800 12px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 0.5)
    ctx.globalAlpha = 1
  }

  private drawControls(ctx: CanvasRenderingContext2D) {
    const g = this.game
    // The furnace.
    const f = FURNACE
    const on = g.furnaceOn
    const heat = Math.min(255, 100 + g.fuel * 15)
    const body = ctx.createLinearGradient(0, f.y, 0, f.y + f.h)
    body.addColorStop(0, on ? `rgb(${heat},${Math.floor(heat / 2)},20)` : '#3a403c')
    body.addColorStop(1, on ? `rgb(${Math.floor(heat * 0.5)},${Math.floor(heat / 5)},0)` : '#1e2320')
    ctx.save()
    if (on) {
      ctx.shadowColor = '#ff8a3d'
      ctx.shadowBlur = 8 + g.fuel * 2
    }
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.roundRect(f.x, f.y, f.w, f.h, 6)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    for (let i = 0; i < 6; i++) ctx.fillRect(f.x + 12 + i * 18, f.y + 9, 10, 3)
    ctx.font = `800 10px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = on ? '#fff2d0' : 'rgba(255,255,255,0.45)'
    ctx.fillText(on ? `FURNACE +${g.fuel * 100} °C` : 'FURNACE OFF', f.x + f.w / 2, f.y + f.h - 10)

    // Fuel: − [bar] +
    this.button(ctx, FUEL_MINUS, '−', '#c0392b', g.fuel > 0)
    this.button(ctx, FUEL_PLUS, '+', '#1f9d55', g.fuel < MAX_FUEL)
    const b = FUEL_BAR
    const seg = (b.w - (MAX_FUEL - 1) * 3) / MAX_FUEL
    for (let i = 0; i < MAX_FUEL; i++) {
      ctx.fillStyle = i < g.fuel ? (on ? `rgb(255,${Math.round(190 - i * 14)},40)` : '#c98a3a') : 'rgba(255,255,255,0.1)'
      ctx.beginPath()
      ctx.roundRect(b.x + i * (seg + 3), b.y, seg, b.h, 3)
      ctx.fill()
    }
    this.label(ctx, `FUEL ${g.fuel}`, b.x + b.w / 2, b.y + b.h + 9, 'center')

    // The on / off switch.
    const s = SWITCH
    ctx.fillStyle = on ? rgba('#ff8a3d', 0.85) : 'rgba(255,255,255,0.12)'
    ctx.beginPath()
    ctx.roundRect(s.x, s.y, s.w, s.h, s.h / 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(on ? s.x + s.w - s.h / 2 : s.x + s.h / 2, s.y + s.h / 2, s.h / 2 - 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `800 10px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = on ? '#2a1200' : 'rgba(255,255,255,0.6)'
    ctx.fillText(on ? 'ON' : 'OFF', on ? s.x + s.w / 2 - 8 : s.x + s.w / 2 + 8, s.y + s.h / 2 + 0.5)

    this.button(ctx, CLEAR, 'Clear', '#b33a3a', g.atoms > 0)
    this.button(ctx, REACT, 'React!', '#1f9d55', g.atoms > 0)
    this.button(ctx, BOOK, this.book >= 0 ? 'Close' : 'Recipes', '#3b6db3')
  }

  /** The latest discovery's card: equation, phase and an interesting fact. */
  private drawFact(ctx: CanvasRenderingContext2D) {
    const r = FACT
    const g = this.game
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, 8)
    ctx.fill()
    ctx.stroke()
    const re: Reaction | undefined = g.recent[0]
    this.label(ctx, re ? 'LATEST DISCOVERY' : 'COMPOUND INFO', r.x + 10, r.y + 12)
    if (!re) {
      ctx.font = `500 11px ${FONT}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(220,235,225,0.45)'
      ctx.fillText('Discover a compound to learn about it.', r.x + 10, r.y + 34)
      return
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.font = `800 13px ${FONT}`
    ctx.fillStyle = '#ffffff'
    ctx.fillText(re.name, r.x + 10, r.y + 30)
    const nameW = ctx.measureText(re.name).width
    ctx.font = `600 11px ${FONT}`
    ctx.fillStyle = '#46e05b'
    ctx.fillText(re.equation, r.x + 18 + nameW, r.y + 30.5)
    phaseIcon(ctx, re.phase, r.x + r.w - 60, r.y + 12, re.color === '#151515' ? '#666666' : re.color)
    ctx.font = `600 10px ${FONT}`
    ctx.fillStyle = 'rgba(220,235,225,0.7)'
    ctx.fillText(`${PHASE_NAMES[re.phase]} · ${re.minTemp}–${re.maxTemp} °C`, r.x + r.w - 52, r.y + 12)
    ctx.font = `500 11px ${FONT}`
    ctx.fillStyle = 'rgba(225,240,230,0.85)'
    wrap(ctx, re.fact, r.w - 20).slice(0, 3).forEach((line, i) => ctx.fillText(line, r.x + 10, r.y + 50 + i * 15))
  }

  private drawMessage(ctx: CanvasRenderingContext2D) {
    const m = this.message
    if (!m || m.t > 4) return
    const a = Math.min(1, m.t / 0.12) * Math.min(1, (4 - m.t) / 0.5)
    ctx.globalAlpha = a
    ctx.font = `700 12px ${FONT}`
    const w = Math.min(W - 352, ctx.measureText(m.text).width + 24)
    const x = 522 - w / 2
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.strokeStyle = rgba(m.color.startsWith('#') ? m.color : '#ffffff', 0.6)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(x, 8, w, 24, 12)
    ctx.fill()
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = m.color
    ctx.fillText(m.text, 522, 20.5, w - 16)
    ctx.globalAlpha = 1
  }

  /** The recipe book: every reaction by temperature, the discovered ones ticked. */
  private drawBook(ctx: CanvasRenderingContext2D) {
    const g = this.game
    ctx.fillStyle = 'rgba(2,6,4,0.82)'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#0f2117'
    ctx.strokeStyle = rgba(this.accent, 0.5)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(16, 16, W - 32, H - 32, 12)
    ctx.fill()
    ctx.stroke()
    ctx.font = `900 16px ${FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = this.accent
    ctx.fillText('RECIPE BOOK', 34, 41)
    ctx.font = `600 11px ${FONT}`
    ctx.fillStyle = 'rgba(220,235,225,0.6)'
    ctx.fillText(`${g.discovered.size} of ${REACTIONS.length} discovered · [S] solid · [L] liquid · [G] gas`, 160, 41)
    BOOK_TABS.forEach((t, i) => {
      ctx.fillStyle = this.book === i ? this.accent : 'rgba(255,255,255,0.1)'
      ctx.beginPath()
      ctx.roundRect(t.x, t.y, t.w, t.h, 11)
      ctx.fill()
      ctx.font = `800 11px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = this.book === i ? '#04120a' : '#e8fff0'
      ctx.fillText(`Page ${i + 1}`, t.x + t.w / 2, t.y + t.h / 2 + 0.5)
    })
    const pages = [
      [[0, 1], [2]],
      [[3, 4], [5, 6]],
    ]
    pages[this.book].forEach((groups, col) => {
      const x = 34 + col * 336
      let y = 76
      for (const gi of groups) {
        const grp = GROUPS[gi]
        ctx.font = `800 10px ${FONT}`
        ctx.textAlign = 'left'
        ctx.fillStyle = '#ff8a5c'
        ctx.fillText(grp.name.toUpperCase(), x, y)
        y += 18
        for (const r of REACTIONS.slice(grp.from, grp.to)) {
          const done = g.discovered.has(r.product)
          ctx.font = `700 10px ${FONT}`
          ctx.fillStyle = done ? '#46e05b' : 'rgba(220,235,225,0.5)'
          ctx.fillText(done ? '✓' : `[${r.phase[0].toUpperCase()}]`, x, y)
          ctx.font = `600 11.5px ${FONT}`
          ctx.fillStyle = done ? '#e8fff0' : 'rgba(220,235,225,0.8)'
          ctx.fillText(r.equation, x + 26, y)
          ctx.font = `500 10px ${FONT}`
          ctx.fillStyle = 'rgba(220,235,225,0.5)'
          ctx.textAlign = 'right'
          ctx.fillText(`${r.minTemp}–${r.maxTemp} °C`, x + 316, y)
          ctx.textAlign = 'left'
          y += 17
        }
        y += 10
      }
    })
    ctx.font = `600 10.5px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(220,235,225,0.5)'
    ctx.fillText('Elements unlock as you discover compounds · ← → turn the page · B or a click closes', W / 2, H - 30)
  }
}
