// Reaction Chain's engine for the game shell: arrow keys or the mouse pick a
// column, Space / ↓ / a click drops the atom; plus the sounds and the drawing:
// a glass rack of CPK-coloured atoms, bonds glowing between the atoms of a
// molecule as it reacts, and the molecule's formula and name floating away.
// The rules are in reactionChainRules.ts.

import type { Frame, GameEngine, Phase } from './GameShell'
import { FONT, Floaters, Particles, glowText, rgba } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import { COLS, ROWS, ReactionChain as Rules, dropTime, type ChainEvent, type El } from './reactionChainRules'

/** Cell size and where the rack sits. */
export const CELL = 40
export const W = COLS * CELL + 24
export const H = ROWS * CELL + 80
const X0 = 12
const Y0 = 68

/** CPK colours (hydrogen white, oxygen red, carbon dark grey, nitrogen blue…) and the text on them. */
export const ATOM_COLORS: Record<El, [string, string]> = {
  H: ['#f2f4f5', '#1b1f22'],
  O: ['#e8333a', '#ffffff'],
  C: ['#4a4f55', '#ffffff'],
  N: ['#3b6cf0', '#ffffff'],
  Na: ['#a65ee8', '#ffffff'],
  Cl: ['#2fc45a', '#0b2412'],
  S: ['#f2cf2a', '#2a2205'],
}

const LEFT = ['ArrowLeft', 'KeyA']
const RIGHT = ['ArrowRight', 'KeyD']
const DROP = ['ArrowDown', 'KeyS', 'Space', 'Enter']

const cx = (c: number) => X0 + c * CELL + CELL / 2
const cy = (r: number) => Y0 + (ROWS - 1 - r) * CELL + CELL / 2

interface Flash {
  atoms: { x: number; y: number; el: El }[]
  t: number
}

export class ReactionChainEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...LEFT, ...RIGHT, ...DROP])
  readonly game = new Rules()
  accent = '#22b357'
  phase: Phase = 'ready'
  private particles = new Particles(400)
  private floaters = new Floaters()
  private flashes: Flash[] = []
  private banner: { title: string; sub: string; color: string; t: number } | null = null
  /** Where the hovering atom is drawn (eases towards its column). */
  private hoverX = cx(3)
  /** A drop asked for while atoms were still falling, done as soon as they land. */
  private wantDrop = false

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const g = this.game
    return `Level ${g.level} · ${g.reactions} molecules · best chain ×${g.bestChain}`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.flashes = []
    this.banner = null
    this.wantDrop = false
    this.hoverX = cx(this.game.column)
  }

  // ------------------------------------------------------------ controls

  keyDown(code: string) {
    if (LEFT.includes(code)) this.game.move(-1)
    else if (RIGHT.includes(code)) this.game.move(1)
    else if (DROP.includes(code)) this.requestDrop()
  }

  keyUp() {}
  releaseAll() {}

  pointerMove(x: number) {
    this.game.moveTo((x - X0) / CELL)
  }

  pointerDown(x: number) {
    this.game.moveTo((x - X0) / CELL)
    this.requestDrop()
  }

  private requestDrop() {
    if (this.game.busy) this.wantDrop = true
    else this.game.drop()
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    const g = this.game
    g.update(dt)
    if (this.wantDrop && !g.busy) {
      this.wantDrop = false
      g.drop()
    }
    this.drain()
    this.particles.update(dt)
    this.floaters.update(dt)
    for (const f of this.flashes) f.t += dt
    this.flashes = this.flashes.filter((f) => f.t < 0.6)
    if (this.banner) {
      this.banner.t += dt
      if (g.state === 'play' && this.banner.t > 1.6) this.banner = null
    }
  }

  /** Plays the rules' events (also called after the AI's moves). */
  drain() {
    const g = this.game
    for (const e of g.events) this.onEvent(e)
    g.events.length = 0
  }

  private onEvent(e: ChainEvent) {
    switch (e.type) {
      case 'move':
        sfx('move', () => tone({ freq: 420, dur: 0.03, type: 'sine', vol: 0.03 }), 0.04)
        break
      case 'drop':
        tone({ freq: 300, to: 160, dur: 0.08, type: 'triangle', vol: 0.07 })
        break
      case 'full':
        sfx('full', () => tone({ freq: 150, dur: 0.1, type: 'square', vol: 0.05 }), 0.2)
        this.floaters.add('Column full', cx(this.game.column), Y0 + 20, '#ffd83a', { size: 13, life: 0.8 })
        break
      case 'react': {
        const { reaction: r, atoms } = e
        const pts = atoms.map(({ c, r: row, el }) => ({ x: cx(c), y: cy(row), el }))
        this.flashes.push({ atoms: pts, t: 0 })
        for (const p of pts) this.particles.burst(p.x, p.y, ATOM_COLORS[p.el][0], { count: 10, speed: [40, 140], gravity: 120, life: [0.3, 0.7], size: [1.5, 3.5], square: false })
        const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length
        const my = pts.reduce((a, p) => a + p.y, 0) / pts.length
        const color = r.target ? '#ffd83a' : this.accent
        this.floaters.add(r.molecule.formula, mx, my - 6, color, { size: 22, life: 1.2, vy: -26, pop: true })
        this.floaters.add(`${r.molecule.name} +${r.points}`, mx, my + 16, '#e8fff0', { size: 11, life: 1.2, vy: -26 })
        if (r.chain > 1) this.floaters.add(`CHAIN ×${r.chain}`, W / 2, Y0 + 40, '#ff8fc8', { size: 18, life: 1, pop: true })
        const base = 60 + Math.min(r.chain, 6) * 2
        arpeggio([base, base + 4, base + 7, base + 12].slice(0, 2 + Math.min(2, r.chain)), 0.05, { dur: 0.12, type: 'triangle', vol: 0.07 })
        noise({ dur: 0.18, freq: 2000, to: 500, vol: 0.05, filter: 'bandpass' })
        break
      }
      case 'level':
        this.banner = {
          title: `LEVEL ${e.level}`,
          sub: e.added.length ? `New element${e.added.length > 1 ? 's' : ''}: ${e.added.join(', ')}` : 'Atoms drop sooner',
          color: this.accent,
          t: 0,
        }
        arpeggio([67, 71, 74, 79], 0.07, { dur: 0.14, type: 'square', vol: 0.06 })
        break
      case 'over':
        this.banner = { title: 'OVERFLOW', sub: 'The rack is full', color: '#ff4b5c', t: 0 }
        tone({ freq: 300, to: 60, dur: 0.9, type: 'sawtooth', vol: 0.1 })
        break
    }
  }

  // ------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    this.phase = f.phase
    const g = this.game

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0d1a12')
    bg.addColorStop(1, '#040906')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // The target, top.
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.font = `700 10px ${FONT}`
    ctx.fillStyle = 'rgba(220,240,228,0.6)'
    ctx.fillText('TARGET ×3', X0, 14)
    if (g.target) {
      glowText(ctx, g.target.formula, X0, 34, '#ffd83a', 20, 900)
      const wide = ctx.measureText(g.target.formula).width
      ctx.font = `600 11px ${FONT}`
      ctx.fillStyle = 'rgba(232,255,240,0.8)'
      ctx.textAlign = 'left'
      ctx.fillText(g.target.name, X0 + wide + 8, 35)
    }
    // The drop timer.
    if (g.state === 'play' && !g.busy && f.phase === 'playing') {
      const total = dropTime(g.level)
      const k = Math.max(0, g.timer / total)
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(X0, 50, COLS * CELL, 3)
      ctx.fillStyle = k < 0.3 ? '#ff4b5c' : this.accent
      ctx.fillRect(X0, 50, COLS * CELL * k, 3)
    }

    // The rack.
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.beginPath()
    ctx.roundRect(X0 - 4, Y0 - 4, COLS * CELL + 8, ROWS * CELL + 8, 8)
    ctx.fill()
    ctx.strokeStyle = rgba(this.accent, 0.25)
    ctx.lineWidth = 1
    ctx.stroke()
    // The column the atom will fall into.
    if (g.state === 'play') {
      ctx.fillStyle = rgba(this.accent, 0.08)
      ctx.fillRect(X0 + g.column * CELL, Y0, CELL, ROWS * CELL)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'
    ctx.beginPath()
    for (let c = 1; c < COLS; c++) {
      ctx.moveTo(X0 + c * CELL, Y0)
      ctx.lineTo(X0 + c * CELL, Y0 + ROWS * CELL)
    }
    ctx.stroke()

    // Bonds between touching atoms that could still react are not shown (that is the puzzle); the flash of a reaction is.
    for (const fl of this.flashes) {
      const a = 1 - fl.t / 0.6
      ctx.strokeStyle = `rgba(255,255,255,${a})`
      ctx.lineWidth = 4 * a + 1
      ctx.beginPath()
      for (let i = 0; i < fl.atoms.length; i++)
        for (let j = i + 1; j < fl.atoms.length; j++) {
          const p = fl.atoms[i]
          const q = fl.atoms[j]
          if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) <= CELL + 1) {
            ctx.moveTo(p.x, p.y)
            ctx.lineTo(q.x, q.y)
          }
        }
      ctx.stroke()
      for (const p of fl.atoms) this.drawAtom(ctx, p.x, p.y, p.el, 1 + fl.t * 0.8, a)
    }

    for (let c = 0; c < COLS; c++)
      g.cols[c].forEach((t, r) => {
        const y = cy(r) - t.off * CELL
        if (y > Y0 - CELL) this.drawAtom(ctx, cx(c), y, t.el)
      })

    // The atom waiting to drop.
    if (g.state === 'play') {
      this.hoverX += (cx(g.column) - this.hoverX) * 0.35
      const bob = Math.sin(f.now / 250) * 1.5
      ctx.globalAlpha = g.busy ? 0.4 : 1
      this.drawAtom(ctx, this.hoverX, Y0 - CELL / 2 + 6 + bob, g.current, 0.8)
      ctx.globalAlpha = 1
    }

    // Next atoms, top right.
    ctx.textAlign = 'right'
    ctx.font = `700 10px ${FONT}`
    ctx.fillStyle = 'rgba(220,240,228,0.6)'
    ctx.fillText('NEXT', W - X0 - 52, 14)
    g.next.forEach((el, i) => this.drawAtom(ctx, W - X0 - 40 + i * 24, 14, el, 0.5))

    this.particles.draw(ctx)
    this.floaters.draw(ctx)
    this.drawBanner(ctx)
  }

  drawAtom(ctx: CanvasRenderingContext2D, x: number, y: number, el: El, scale = 1, alpha = 1) {
    const [fill, text] = ATOM_COLORS[el]
    const r = (CELL / 2 - 3) * scale
    ctx.save()
    ctx.globalAlpha *= alpha
    const ball = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
    ball.addColorStop(0, '#ffffff')
    ball.addColorStop(0.25, fill)
    ball.addColorStop(1, shadeOf(fill))
    ctx.fillStyle = ball
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${Math.round((el.length > 1 ? 13 : 15) * scale)}px ${FONT}`
    ctx.fillStyle = text
    ctx.fillText(el, x, y + 1)
    ctx.restore()
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    const b = this.banner
    if (!b) return
    const a = Math.min(1, b.t / 0.2, this.game.state === 'play' ? (1.6 - b.t) / 0.3 : 1)
    const pop = 1 + 0.25 * Math.max(0, 1 - b.t / 0.2)
    ctx.globalAlpha = Math.max(0, a)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    glowText(ctx, b.title, W / 2, H * 0.42, b.color, 30 * pop, 900)
    glowText(ctx, b.sub, W / 2, H * 0.42 + 30, '#e8fff0', 13, 700)
    ctx.globalAlpha = 1
  }
}

/** A darker edge for a #rrggbb colour. */
function shadeOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const k = 0.45
  return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`
}
