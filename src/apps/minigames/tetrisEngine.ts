// Tetris's engine for the game shell: turns keys into moves, plays the
// sounds, runs the effects (sparks, call-outs, the well's bump) and draws the
// well. The rules themselves are in tetris.ts.

import type { Frame, GameEngine } from './GameShell'
import { Floaters, Particles, fmt, rgba, shade } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import {
  CELLS, CLEAR_TIME, COLS, END_TIME, HIDDEN, KINDS, ROWS, TOTAL, Tetris as Rules,
  type Action, type Cell, type ClearResult, type Kind, type TetrisEvent,
} from './tetrisRules'

const CELL = 24
const WELL_X = 6
const WELL_Y = 18
const WELL_W = COLS * CELL
const WELL_H = ROWS * CELL
export const W = WELL_X * 2 + WELL_W
export const H = WELL_Y + WELL_H + 6

export const COLORS: Record<Kind, string> = {
  I: '#35e0ea',
  J: '#4a7dff',
  L: '#ff9b2f',
  O: '#ffd83a',
  S: '#46e05b',
  T: '#b45cff',
  Z: '#ff4b5c',
}
/** The grey of the curtain that falls when the game ends. */
const CURTAIN = '#56615a'

interface Tile {
  base: string
  light: string
  dark: string
}
const tile = (c: string): Tile => ({ base: c, light: shade(c, 0.5), dark: shade(c, -0.5) })
const TILES = Object.fromEntries(KINDS.map((k) => [k, tile(COLORS[k])])) as Record<Kind, Tile>
const CURTAIN_TILE = tile(CURTAIN)

const KEYS: Record<string, Action> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'down',
  ArrowUp: 'cw',
  KeyX: 'cw',
  KeyZ: 'ccw',
  Space: 'drop',
  KeyC: 'hold',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
}

/** The top-left corner of a well cell on the canvas. */
const cellX = (x: number) => WELL_X + x * CELL
const cellY = (y: number) => WELL_Y + (y - HIDDEN) * CELL

/** One block: a bright face, light top-left and dark bottom-right bevels, a soft shine. */
function drawBlock(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: Tile) {
  const b = Math.max(1.5, s * 0.15)
  ctx.fillStyle = t.dark
  ctx.fillRect(x, y, s, s)
  ctx.fillStyle = t.light
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + s, y)
  ctx.lineTo(x + s - b, y + b)
  ctx.lineTo(x + b, y + b)
  ctx.lineTo(x + b, y + s - b)
  ctx.lineTo(x, y + s)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = t.base
  ctx.fillRect(x + b, y + b, s - 2 * b, s - 2 * b)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fillRect(x + b, y + b, s - 2 * b, (s - 2 * b) * 0.4)
}

/** A piece centred in a box (the hold and next previews). */
export function drawPieceIn(ctx: CanvasRenderingContext2D, kind: Kind, cx: number, cy: number, s: number) {
  const cells = CELLS[kind][0]
  const xs = cells.map(([x]) => x)
  const ys = cells.map(([, y]) => y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const w = (Math.max(...xs) - minX + 1) * s
  const h = (Math.max(...ys) - minY + 1) * s
  for (const [x, y] of cells) {
    drawBlock(ctx, cx - w / 2 + (x - minX) * s + 0.5, cy - h / 2 + (y - minY) * s + 0.5, s - 1, TILES[kind])
  }
}

interface Trail {
  x: number
  top: number
  bottom: number
  color: string
  t: number
}

export class TetrisEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set(Object.keys(KEYS))
  readonly game = new Rules()
  accent = '#22b357'
  private particles = new Particles(700)
  private floaters = new Floaters()
  private trails: Trail[] = []
  /** The piece that just locked flashes for a moment. */
  private flash: { cells: Cell[]; t: number } | null = null
  /** The well bumps down after a hard drop and springs back. */
  private bump = 0
  private bumpV = 0
  private levelGlow = 0

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const { level, lines } = this.game
    return `Level ${level} · ${lines} line${lines === 1 ? '' : 's'}`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.trails = []
    this.flash = null
    this.bump = this.bumpV = 0
    this.levelGlow = 0
  }

  keyDown(code: string) {
    const a = KEYS[code]
    if (a) this.game.press(a)
  }
  keyUp(code: string) {
    const a = KEYS[code]
    if (a) this.game.release(a)
  }
  releaseAll() {
    this.game.releaseAll()
  }

  update(dt: number) {
    this.game.update(dt)
    for (const e of this.game.events) this.onEvent(e)
    this.game.events.length = 0
    this.particles.update(dt)
    this.floaters.update(dt)
    for (const t of this.trails) t.t += dt
    this.trails = this.trails.filter((t) => t.t < 0.22)
    if (this.flash && (this.flash.t += dt) > 0.18) this.flash = null
    this.levelGlow = Math.max(0, this.levelGlow - dt)
    // A stiff spring: the well dips and settles.
    this.bumpV += (-this.bump * 1400 - this.bumpV * 38) * dt
    this.bump += this.bumpV * dt
  }

  // ------------------------------------------------------------ events

  private onEvent(e: TetrisEvent) {
    switch (e.type) {
      case 'move':
        sfx('move', () => tone({ freq: 210, dur: 0.03, type: 'square', vol: 0.04 }), 0.02)
        break
      case 'rotate':
        sfx('rotate', () => tone({ freq: 560, to: 760, dur: 0.05, type: 'triangle', vol: 0.11 }))
        break
      case 'hold':
        tone({ freq: 330, to: 700, dur: 0.1, type: 'sine', vol: 0.14 })
        break
      case 'land':
        sfx('land', () => tone({ freq: 150, to: 110, dur: 0.05, type: 'sine', vol: 0.12 }))
        break
      case 'lock':
        this.flash = { cells: e.cells, t: 0 }
        sfx('lock', () => noise({ dur: 0.05, freq: 1200, vol: 0.1, filter: 'lowpass' }))
        break
      case 'drop':
        this.onDrop(e.kind, e.from, e.cells, e.rows)
        break
      case 'clear':
        this.onClear(e.rows, e.result)
        break
      case 'spin':
        this.floaters.add(e.result.name.toUpperCase(), W / 2, cellY(HIDDEN + 7), COLORS.T, { size: 17, life: 1.2, pop: true, vy: -16 })
        this.floaters.add(`+${fmt(e.result.points)}`, W / 2, cellY(HIDDEN + 8), '#ffffff', { size: 12, life: 1, vy: -20 })
        arpeggio([67, 74], 0.05, { dur: 0.1, type: 'triangle', vol: 0.14 })
        break
      case 'level':
        this.levelGlow = 1.4
        this.floaters.add(`LEVEL ${e.level}`, W / 2, cellY(HIDDEN + 5), this.accent, { size: 22, life: 1.6, pop: true, vy: -12 })
        arpeggio([60, 64, 67, 72, 76, 79], 0.055, { dur: 0.12, type: 'square', vol: 0.09, at: 0.12 })
        break
      case 'topout':
        tone({ freq: 440, to: 52, dur: 1.2, type: 'sawtooth', vol: 0.14 })
        noise({ dur: 0.5, freq: 300, to: 60, vol: 0.12, filter: 'lowpass' })
        break
    }
  }

  private onDrop(kind: Kind, from: Cell[], cells: Cell[], rows: number) {
    if (rows > 0) {
      // A streak behind each column of the piece: from where its top was to where it is now.
      const topOf = (list: Cell[], x: number) => Math.min(...list.filter(([cx]) => cx === x).map(([, y]) => y))
      for (const x of new Set(cells.map(([cx]) => cx))) {
        this.trails.push({ x, top: topOf(from, x), bottom: topOf(cells, x), color: COLORS[kind], t: 0 })
      }
      // Dust where it lands.
      for (const [x, y] of cells) {
        if (cells.some(([x2, y2]) => x2 === x && y2 === y + 1)) continue
        this.particles.burst(cellX(x) + CELL / 2, cellY(y) + CELL, COLORS[kind], {
          count: 4, speed: [20, 90], angle: -Math.PI / 2, spread: Math.PI * 0.9, gravity: 260, life: [0.2, 0.45], size: [1.5, 3],
        })
      }
    }
    this.bumpV += Math.min(150, 40 + rows * 9)
    tone({ freq: 150, to: 48, dur: 0.13, type: 'sine', vol: 0.32 })
    noise({ dur: 0.07, freq: 500, vol: 0.14, filter: 'lowpass' })
  }

  private onClear(rows: number[], r: ClearResult) {
    for (const y of rows) {
      for (let x = 0; x < COLS; x++) {
        const v = this.game.cell(x, y)
        const color = v ? COLORS[KINDS[v - 1]] : '#ffffff'
        this.particles.burst(cellX(x) + CELL / 2, cellY(y) + CELL / 2, color, {
          count: r.lines === 4 ? 5 : 3, speed: [40, 240], gravity: 460, life: [0.4, 0.95], size: [2, 4],
        })
      }
    }
    const special = r.lines === 4 || r.spin !== 'none'
    const color = r.spin !== 'none' ? COLORS.T : r.lines === 4 ? COLORS.I : '#ffffff'
    // Show the call-out near the cleared rows, but inside the well.
    const y = Math.min(cellY(TOTAL - 4), Math.max(cellY(HIDDEN + 3), cellY(rows[0]) - 10))
    this.floaters.add(`${r.name.toUpperCase()}${r.lines === 4 ? '!' : ''}`, W / 2, y, color, { size: special ? 21 : 16, life: 1.2, pop: true, vy: -14 })
    let line = y + 22
    if (r.b2b) {
      this.floaters.add('BACK-TO-BACK', W / 2, line, COLORS.O, { size: 11, life: 1.2, vy: -14 })
      line += 16
    }
    if (r.combo > 0) {
      this.floaters.add(`COMBO ×${r.combo}`, W / 2, line, COLORS.L, { size: 11, life: 1.2, vy: -14 })
      line += 16
    }
    if (r.perfect) {
      this.floaters.add('ALL CLEAR', W / 2, line, this.accent, { size: 15, life: 1.6, pop: true, vy: -14 })
      line += 18
    }
    this.floaters.add(`+${fmt(r.points)}`, W / 2, line, '#ffffff', { size: 12, life: 1, vy: -20 })

    if (r.lines === 4) {
      arpeggio([60, 67, 72, 76, 79, 84], 0.05, { dur: 0.16, type: 'square', vol: 0.1 })
      noise({ dur: 0.35, freq: 3000, to: 800, vol: 0.08, filter: 'bandpass', q: 0.8 })
    } else {
      const base = [64, 67, 71, 72]
      arpeggio(base.slice(0, r.lines + 1), 0.055, { dur: 0.12, type: r.spin !== 'none' ? 'triangle' : 'square', vol: 0.1 })
    }
    if (r.combo > 1) tone({ freq: 523 * Math.pow(2, Math.min(r.combo, 12) / 12), dur: 0.08, type: 'sine', vol: 0.12, at: 0.2 })
  }

  // ------------------------------------------------------------ drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    ctx.fillStyle = '#020403'
    ctx.fillRect(0, 0, W, H)
    ctx.save()
    ctx.translate(0, Math.max(-2, Math.min(6, this.bump)))
    this.drawWell(ctx, f)
    ctx.save()
    // Only the bottom of the row above the well shows, so pieces slide in from the top.
    ctx.beginPath()
    ctx.rect(WELL_X, WELL_Y - 12, WELL_W, WELL_H + 12)
    ctx.clip()
    this.drawStack(ctx)
    if (g.piece && !g.dead) {
      this.drawGhost(ctx)
      this.drawTrails(ctx)
      this.drawPiece(ctx)
    }
    this.drawFlash(ctx)
    ctx.restore()
    this.drawCurtain(ctx)
    this.particles.draw(ctx)
    ctx.restore()
    this.floaters.draw(ctx)
  }

  /** The black well: a faint grid, a glowing frame (red when the stack gets high). */
  private drawWell(ctx: CanvasRenderingContext2D, f: Frame) {
    const bg = ctx.createLinearGradient(0, WELL_Y, 0, WELL_Y + WELL_H)
    bg.addColorStop(0, '#07130c')
    bg.addColorStop(1, '#030806')
    ctx.fillStyle = bg
    ctx.fillRect(WELL_X, WELL_Y, WELL_W, WELL_H)

    ctx.strokeStyle = 'rgba(70, 200, 120, 0.07)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(cellX(x), WELL_Y)
      ctx.lineTo(cellX(x), WELL_Y + WELL_H)
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(WELL_X, WELL_Y + y * CELL)
      ctx.lineTo(WELL_X + WELL_W, WELL_Y + y * CELL)
    }
    ctx.stroke()

    // The peek above the well fades into the background.
    const peek = ctx.createLinearGradient(0, WELL_Y - 12, 0, WELL_Y)
    peek.addColorStop(0, 'rgba(7,19,12,0)')
    peek.addColorStop(1, 'rgba(7,19,12,0.9)')
    ctx.fillStyle = peek
    ctx.fillRect(WELL_X, WELL_Y - 12, WELL_W, 12)

    const danger = this.dangerLevel()
    const pulse = 0.5 + 0.5 * Math.sin(f.now / 160)
    const frame = danger > 0 ? `rgba(255, 75, 92, ${0.55 + 0.45 * pulse * danger})` : this.accent
    ctx.save()
    ctx.shadowColor = danger > 0 ? '#ff4b5c' : this.accent
    ctx.shadowBlur = 10 + this.levelGlow * 14
    ctx.strokeStyle = frame
    ctx.lineWidth = 2 + this.levelGlow
    ctx.beginPath()
    // Open at the top: pieces come in from above.
    ctx.moveTo(WELL_X - 1, WELL_Y - 4)
    ctx.lineTo(WELL_X - 1, WELL_Y + WELL_H + 1)
    ctx.lineTo(WELL_X + WELL_W + 1, WELL_Y + WELL_H + 1)
    ctx.lineTo(WELL_X + WELL_W + 1, WELL_Y - 4)
    ctx.stroke()
    ctx.restore()
  }

  /** 0 when there is room, rising to 1 as the stack nears the top. */
  private dangerLevel(): number {
    const g = this.game
    for (let y = HIDDEN; y < HIDDEN + 5; y++) {
      for (let x = 0; x < COLS; x++) if (g.cell(x, y)) return 1 - (y - HIDDEN) / 5
    }
    return 0
  }

  private drawStack(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const clearing = g.clearing
    for (let y = HIDDEN - 1; y < TOTAL; y++) {
      const gone = clearing?.rows.includes(y)
      for (let x = 0; x < COLS; x++) {
        const v = g.cell(x, y)
        if (!v) continue
        if (gone && clearing) {
          // Full rows flash white, then vanish from the middle outwards.
          const p = clearing.t / CLEAR_TIME
          if (p >= 0.45 && Math.abs(x + 0.5 - COLS / 2) < ((p - 0.45) / 0.55) * (COLS / 2 + 0.5)) continue
          drawBlock(ctx, cellX(x) + 0.5, cellY(y) + 0.5, CELL - 1, TILES[KINDS[v - 1]])
          ctx.fillStyle = `rgba(255,255,255,${p < 0.45 ? 0.35 + p * 1.4 : 0.95})`
          ctx.fillRect(cellX(x), cellY(y), CELL, CELL)
          continue
        }
        drawBlock(ctx, cellX(x) + 0.5, cellY(y) + 0.5, CELL - 1, TILES[KINDS[v - 1]])
      }
    }
  }

  private drawGhost(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const p = g.piece!
    const gy = g.ghostY()
    if (gy === p.y) return
    const color = COLORS[p.kind]
    for (const [x, y] of g.cellsOf(p, gy)) {
      ctx.fillStyle = rgba(color, 0.12)
      ctx.fillRect(cellX(x) + 1, cellY(y) + 1, CELL - 2, CELL - 2)
      ctx.strokeStyle = rgba(color, 0.55)
      ctx.lineWidth = 1.5
      ctx.strokeRect(cellX(x) + 2, cellY(y) + 2, CELL - 4, CELL - 4)
    }
  }

  private drawPiece(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const p = g.piece!
    const color = COLORS[p.kind]
    const cells = g.cellsOf(p)
    // A soft glow behind the falling piece.
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = 14
    ctx.fillStyle = rgba(color, 0.55)
    for (const [x, y] of cells) ctx.fillRect(cellX(x) + 2, cellY(y) + 2, CELL - 4, CELL - 4)
    ctx.restore()
    for (const [x, y] of cells) drawBlock(ctx, cellX(x) + 0.5, cellY(y) + 0.5, CELL - 1, TILES[p.kind])
    // Brightens while it waits on the stack, as a warning that it is about to lock.
    const lock = g.lockProgress
    if (lock > 0) {
      ctx.fillStyle = `rgba(255,255,255,${lock * 0.32})`
      for (const [x, y] of cells) ctx.fillRect(cellX(x) + 0.5, cellY(y) + 0.5, CELL - 1, CELL - 1)
    }
  }

  private drawTrails(ctx: CanvasRenderingContext2D) {
    for (const t of this.trails) {
      const a = 1 - t.t / 0.22
      const top = cellY(t.top)
      const bottom = cellY(t.bottom)
      if (bottom <= top) continue
      const grad = ctx.createLinearGradient(0, top, 0, bottom)
      grad.addColorStop(0, rgba(t.color, 0))
      grad.addColorStop(1, rgba(t.color, 0.38 * a))
      ctx.fillStyle = grad
      ctx.fillRect(cellX(t.x) + 3, top, CELL - 6, bottom - top)
    }
  }

  private drawFlash(ctx: CanvasRenderingContext2D) {
    if (!this.flash) return
    ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - this.flash.t / 0.18)})`
    for (const [x, y] of this.flash.cells) {
      if (y >= HIDDEN - 1) ctx.fillRect(cellX(x) + 0.5, cellY(y) + 0.5, CELL - 1, CELL - 1)
    }
  }

  /** After a top-out, grey rows fill the well from the bottom. */
  private drawCurtain(ctx: CanvasRenderingContext2D) {
    const g = this.game
    if (!g.dead) return
    const rows = Math.min(ROWS, Math.floor((g.endTime / (END_TIME * 0.7)) * ROWS))
    for (let i = 0; i < rows; i++) {
      const y = TOTAL - 1 - i
      for (let x = 0; x < COLS; x++) drawBlock(ctx, cellX(x) + 0.5, cellY(y) + 0.5, CELL - 1, CURTAIN_TILE)
    }
  }
}
