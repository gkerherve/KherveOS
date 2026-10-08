// Pac-Man's engine for the game shell: turns keys into turns, plays the
// sounds, runs the effects (sparks, score call-outs) and draws the maze, the
// dots, Pac-Man, the ghosts and the fruit. The rules are in pacmanRules.ts.

import type { Frame, GameEngine } from './GameShell'
import { Floaters, Particles, glowText, rgba } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import {
  COLS, CLEAR_TIME, DYING_TIME, FRUIT_TILE, FRUITS, HOUSE, ROWS, WALL, fruitFor, Pacman as Rules,
  type Dir, type Ghost, type GhostName, type PacmanEvent,
} from './pacmanRules'

export const CELL = 22
const PAD = 6
export const W = PAD * 2 + COLS * CELL
export const H = PAD * 2 + ROWS * CELL

export const GHOST_COLORS: Record<GhostName, string> = {
  blinky: '#ff3b30',
  pinky: '#ffa0dc',
  inky: '#35e0ea',
  clyde: '#ffa23a',
}
const PAC = '#ffd83a'
const FRIGHT = '#2b3dff'

const KEYS: Record<string, Dir> = {
  ArrowLeft: 'L',
  ArrowRight: 'R',
  ArrowUp: 'U',
  ArrowDown: 'D',
  KeyA: 'L',
  KeyD: 'R',
  KeyW: 'U',
  KeyS: 'D',
}

/** The centre of a tile on the canvas. */
const px = (x: number) => PAD + (x + 0.5) * CELL
const py = (y: number) => PAD + (y + 0.5) * CELL

const ANGLE: Record<Dir, number> = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 }

/** The maze's wall edges (where a wall meets open floor), as segments in tile units. */
const EDGES: [number, number, number, number][] = (() => {
  const out: [number, number, number, number][] = []
  const open = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS && !WALL[y][x]
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!WALL[y][x]) continue
      if (open(x, y - 1)) out.push([x, y, x + 1, y])
      if (open(x, y + 1)) out.push([x, y + 1, x + 1, y + 1])
      if (open(x - 1, y)) out.push([x, y, x, y + 1])
      if (open(x + 1, y)) out.push([x + 1, y, x + 1, y + 1])
    }
  }
  return out
})()

export class PacmanEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set(Object.keys(KEYS))
  readonly game = new Rules()
  accent = '#22b357'
  private particles = new Particles(500)
  private floaters = new Floaters()
  private clock = 0
  private waka = false
  /** Where the eaten ghost was while the world stands still. */
  private pop: { x: number; y: number; text: string } | null = null
  private burst = false

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    return `Level ${this.game.level}`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.pop = null
    this.burst = false
    this.clock = 0
  }

  keyDown(code: string) {
    const d = KEYS[code]
    if (d) this.game.press(d)
  }
  keyUp() {}
  releaseAll() {}

  update(dt: number) {
    this.clock += dt
    this.game.update(dt)
    for (const e of this.game.events) this.onEvent(e)
    this.game.events.length = 0
    this.particles.update(dt)
    this.floaters.update(dt)
    if (this.pop && this.game.freeze <= 0) this.pop = null
    // Pac-Man bursts into sparks as he vanishes.
    if (this.game.phase === 'dying' && !this.burst && this.game.phaseTime > DYING_TIME * 0.8) {
      this.burst = true
      this.particles.burst(px(this.game.pac.x), py(this.game.pac.y), PAC, { count: 24, speed: [40, 150], gravity: 0, life: [0.3, 0.7], size: [2, 3.5] })
    }
  }

  // ------------------------------------------------------------ events

  private onEvent(e: PacmanEvent) {
    const g = this.game
    switch (e.type) {
      case 'ready':
        this.burst = false
        this.pop = null
        if (e.first) arpeggio([71, 83, 78, 75, 83, 78, 75, 72, 84, 79, 76, 84, 79, 76], 0.075, { dur: 0.1, type: 'square', vol: 0.07 })
        break
      case 'dot':
        this.waka = !this.waka
        sfx('waka', () => tone({ freq: this.waka ? 330 : 440, to: this.waka ? 440 : 330, dur: 0.07, type: 'triangle', vol: 0.14 }), 0.04)
        break
      case 'pellet':
        tone({ freq: 180, to: 520, dur: 0.18, type: 'square', vol: 0.1 })
        this.particles.burst(px(g.pac.x), py(g.pac.y), '#ffffff', { count: 12, speed: [30, 120], gravity: 0, life: [0.25, 0.5], size: [1.5, 3] })
        break
      case 'ghost':
        this.pop = { x: e.x, y: e.y, text: String(e.points) }
        this.floaters.add(String(e.points), px(e.x), py(e.y), '#35e0ea', { size: 13, life: 0.9, pop: true, vy: -16 })
        this.particles.burst(px(e.x), py(e.y), '#ffffff', { count: 14, speed: [40, 160], gravity: 0, life: [0.25, 0.6], size: [1.5, 3] })
        tone({ freq: 220, to: 1400, dur: 0.25, type: 'sawtooth', vol: 0.1 })
        break
      case 'fruit':
        this.floaters.add(String(e.points), px(e.x), py(e.y), '#ffffff', { size: 13, life: 1.1, pop: true, vy: -16 })
        arpeggio([72, 76, 79, 84], 0.06, { dur: 0.1, type: 'square', vol: 0.09 })
        break
      case 'death':
        // The siren drops away, then a wobbling slide down.
        for (let i = 0; i < 9; i++) tone({ freq: 700 - i * 60, to: 360 - i * 30, dur: 0.12, type: 'square', vol: 0.09, at: 0.18 + i * 0.12 })
        noise({ dur: 0.2, freq: 1500, to: 300, vol: 0.08, filter: 'lowpass' })
        break
      case 'life':
        this.floaters.add('1UP', px(9), py(11), '#8ef0a8', { size: 18, life: 1.4, pop: true, vy: -14 })
        arpeggio([67, 72, 76, 79, 84], 0.07, { dur: 0.12, type: 'triangle', vol: 0.13 })
        break
      case 'frightEnd':
        break
      case 'clear':
        arpeggio([60, 64, 67, 72, 76, 79, 84], 0.09, { dur: 0.14, type: 'square', vol: 0.08 })
        break
      case 'level':
        break
      case 'go':
        break
      case 'over':
        break
    }
  }

  // ------------------------------------------------------------ drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    ctx.fillStyle = '#020403'
    ctx.fillRect(0, 0, W, H)
    this.drawMaze(ctx)
    this.drawDots(ctx, f)
    if (g.fruit) drawFruit(ctx, px(FRUIT_TILE.x), py(FRUIT_TILE.y), fruitFor(g.level), CELL * 0.42)

    const dying = g.phase === 'dying'
    const showGhosts = !dying || g.phaseTime < 0.5
    if (g.phase !== 'clear' || g.phaseTime < 0.3) {
      if (showGhosts) {
        for (const gh of g.ghosts) {
          if (this.pop && gh.state === 'eyes' && gh.x === this.pop.x && gh.y === this.pop.y) continue
          this.drawGhost(ctx, gh, f)
        }
      }
      if (!(g.freeze > 0)) this.drawPac(ctx)
    }
    if (g.phase === 'ready') {
      glowText(ctx, 'READY!', px(HOUSE.x), py(11), PAC, 15)
    }
    this.particles.draw(ctx)
    this.floaters.draw(ctx)
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'
  }

  /** Wall outlines (flashing white when the level is cleared) and the ghost-house door. */
  private drawMaze(ctx: CanvasRenderingContext2D) {
    const g = this.game
    let color = this.accent
    if (g.phase === 'clear') {
      const t = g.phaseTime
      if (t > 0.3 && t < CLEAR_TIME - 0.2) color = Math.floor((t - 0.3) / 0.25) % 2 === 0 ? '#ffffff' : this.accent
    }
    ctx.beginPath()
    for (const [x1, y1, x2, y2] of EDGES) {
      ctx.moveTo(PAD + x1 * CELL, PAD + y1 * CELL)
      ctx.lineTo(PAD + x2 * CELL, PAD + y2 * CELL)
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = rgba(color, 0.22)
    ctx.lineWidth = 6
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()
    // The door of the ghost house.
    ctx.strokeStyle = '#ffa0dc'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(PAD + (HOUSE.x + 0.1) * CELL, PAD + 8.5 * CELL)
    ctx.lineTo(PAD + (HOUSE.x + 0.9) * CELL, PAD + 8.5 * CELL)
    ctx.stroke()
    ctx.lineCap = 'butt'
  }

  private drawDots(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const blink = Math.floor(f.now / 220) % 2 === 0 || g.phase !== 'run'
    ctx.fillStyle = '#ffd9b0'
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const d = g.dots[y * COLS + x]
        if (!d) continue
        if (d === 1) ctx.fillRect(px(x) - 1.6, py(y) - 1.6, 3.2, 3.2)
        else if (blink) {
          ctx.save()
          ctx.shadowColor = '#ffd9b0'
          ctx.shadowBlur = 8
          ctx.beginPath()
          ctx.arc(px(x), py(y), 5.2, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }
    }
  }

  private drawPac(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const p = g.pac
    const x = px(p.x)
    const y = py(p.y)
    const r = CELL * 0.46
    ctx.fillStyle = PAC
    ctx.beginPath()
    if (g.phase === 'dying') {
      // He folds up from the top and disappears.
      const t = Math.min(1, Math.max(0, (g.phaseTime - 0.3) / (DYING_TIME * 0.5)))
      if (t >= 1) return
      const a = Math.PI * t
      ctx.moveTo(x, y)
      ctx.arc(x, y, r, -Math.PI / 2 + a, -Math.PI / 2 - a + Math.PI * 2)
    } else {
      const dir: Dir = p.dx > 0 ? 'R' : p.dx < 0 ? 'L' : p.dy > 0 ? 'D' : p.dy < 0 ? 'U' : g.face
      const moving = p.dx !== 0 || p.dy !== 0
      const open = moving && g.phase === 'run' ? Math.abs(Math.sin(g.odometer * 2.4)) : 0.35
      const m = 0.03 * Math.PI + 0.27 * Math.PI * open
      const a = ANGLE[dir]
      ctx.moveTo(x, y)
      ctx.arc(x, y, r, a + m, a - m + Math.PI * 2)
    }
    ctx.closePath()
    ctx.save()
    ctx.shadowColor = PAC
    ctx.shadowBlur = 8
    ctx.fill()
    ctx.restore()
  }

  private drawGhost(ctx: CanvasRenderingContext2D, gh: Ghost, f: Frame) {
    const g = this.game
    const cx = px(gh.x)
    let cy = py(gh.y)
    if (gh.state === 'house') cy += Math.sin(f.now / 140 + gh.releaseDots) * CELL * 0.14
    const r = CELL * 0.48
    const eyes = gh.state === 'eyes' || gh.state === 'entering'
    // Which way it faces: the eyes look where it is going.
    let lx = gh.dx
    let ly = gh.dy
    if (!lx && !ly) ly = -1

    if (!eyes) {
      const flashing = gh.frightened && g.fright < 2 && Math.floor(f.now / 160) % 2 === 0
      const body = gh.frightened ? (flashing ? '#f4f4ff' : FRIGHT) : GHOST_COLORS[gh.name]
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.arc(cx, cy - r * 0.1, r, Math.PI, 0)
      const bottom = cy + r * 0.95
      ctx.lineTo(cx + r, bottom)
      // Wavy hem: three feet that swap with the clock.
      const feet = 3
      const w = (2 * r) / feet
      const swap = Math.floor(f.now / 120) % 2 === 0
      for (let i = 0; i < feet; i++) {
        const x1 = cx + r - i * w
        ctx.lineTo(x1 - w / 2, bottom - (i % 2 === (swap ? 0 : 1) ? r * 0.28 : 0))
        ctx.lineTo(x1 - w, bottom)
      }
      ctx.closePath()
      ctx.fill()
    }

    if (gh.frightened && !eyes) {
      const flashing = g.fright < 2 && Math.floor(f.now / 160) % 2 === 0
      const face = flashing ? '#ff3b30' : '#ffd0d8'
      ctx.fillStyle = face
      ctx.fillRect(cx - r * 0.45, cy - r * 0.35, r * 0.24, r * 0.24)
      ctx.fillRect(cx + r * 0.21, cy - r * 0.35, r * 0.24, r * 0.24)
      ctx.strokeStyle = face
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i <= 6; i++) {
        const x = cx - r * 0.6 + (i * r * 1.2) / 6
        const y = cy + r * 0.38 + (i % 2 === 0 ? 0 : -r * 0.2)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      return
    }

    // The eyes: white with a blue pupil looking along the way it moves.
    for (const s of [-1, 1]) {
      const ex = cx + s * r * 0.4 + lx * r * 0.12
      const ey = cy - r * 0.28 + ly * r * 0.12
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.ellipse(ex, ey, r * 0.27, r * 0.34, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#1a2cff'
      ctx.beginPath()
      ctx.arc(ex + lx * r * 0.14, ey + ly * r * 0.16, r * 0.15, 0, Math.PI * 2)
      ctx.fill()
    }
  }

}

/** A small drawing of each level's fruit, centred on (x, y), about 2r across. */
export function drawFruit(ctx: CanvasRenderingContext2D, x: number, y: number, kind: number, r: number) {
  const dot = (cx: number, cy: number, rad: number, c: string) => {
    ctx.fillStyle = c
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  const stem = (x1: number, y1: number, x2: number, y2: number, c = '#46e05b') => {
    ctx.strokeStyle = c
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }
  switch (FRUITS[kind].name) {
    case 'Cherry':
      stem(x - r * 0.45, y + r * 0.4, x + r * 0.2, y - r)
      stem(x + r * 0.5, y + r * 0.4, x + r * 0.2, y - r)
      dot(x - r * 0.45, y + r * 0.45, r * 0.5, '#ff3b30')
      dot(x + r * 0.5, y + r * 0.45, r * 0.5, '#ff3b30')
      break
    case 'Strawberry':
      ctx.fillStyle = '#ff3b4f'
      ctx.beginPath()
      ctx.moveTo(x - r * 0.9, y - r * 0.5)
      ctx.quadraticCurveTo(x, y - r * 0.9, x + r * 0.9, y - r * 0.5)
      ctx.quadraticCurveTo(x + r * 0.6, y + r * 0.7, x, y + r)
      ctx.quadraticCurveTo(x - r * 0.6, y + r * 0.7, x - r * 0.9, y - r * 0.5)
      ctx.fill()
      ctx.fillStyle = '#46e05b'
      ctx.fillRect(x - r * 0.5, y - r * 0.85, r, r * 0.3)
      break
    case 'Orange':
      dot(x, y + r * 0.1, r * 0.85, '#ff9b2f')
      stem(x, y - r * 0.7, x + r * 0.4, y - r)
      break
    case 'Apple':
      dot(x - r * 0.3, y + r * 0.1, r * 0.65, '#ff3b30')
      dot(x + r * 0.3, y + r * 0.1, r * 0.65, '#ff3b30')
      stem(x, y - r * 0.5, x + r * 0.3, y - r, '#8b5a2b')
      break
    case 'Melon':
      dot(x, y + r * 0.1, r * 0.85, '#46c05b')
      stem(x - r * 0.5, y - r * 0.3, x + r * 0.5, y + r * 0.5, '#bdf5c4')
      stem(x - r * 0.5, y + r * 0.5, x + r * 0.5, y - r * 0.3, '#bdf5c4')
      break
    case 'Galaxian':
      ctx.fillStyle = '#ffd83a'
      ctx.beginPath()
      ctx.moveTo(x - r, y - r * 0.6)
      ctx.lineTo(x, y - r * 0.1)
      ctx.lineTo(x + r, y - r * 0.6)
      ctx.lineTo(x + r * 0.5, y + r * 0.1)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r * 0.5, y + r * 0.1)
      ctx.closePath()
      ctx.fill()
      dot(x, y - r * 0.2, r * 0.22, '#ff3b30')
      break
    case 'Bell':
      ctx.fillStyle = '#ffd83a'
      ctx.beginPath()
      ctx.arc(x, y - r * 0.1, r * 0.75, Math.PI, 0)
      ctx.lineTo(x + r * 0.95, y + r * 0.6)
      ctx.lineTo(x - r * 0.95, y + r * 0.6)
      ctx.closePath()
      ctx.fill()
      dot(x, y + r * 0.85, r * 0.2, '#ffffff')
      break
    default: // Key
      stem(x, y - r * 0.3, x, y + r, '#35e0ea')
      stem(x, y + r * 0.6, x + r * 0.5, y + r * 0.6, '#35e0ea')
      stem(x, y + r * 0.9, x + r * 0.5, y + r * 0.9, '#35e0ea')
      ctx.strokeStyle = '#35e0ea'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y - r * 0.55, r * 0.4, 0, Math.PI * 2)
      ctx.stroke()
  }
}
