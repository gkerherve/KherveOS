// Meteor Smash's engine for the game shell: keys steer, thrust and shoot,
// plus the sounds, the effects (dust, debris, call-outs, a little shake) and
// the drawing: glowing vector rocks and ship over a starfield. The rules are
// in asteroidsRules.ts.

import type { Frame, GameEngine } from './GameShell'
import { Floaters, Particles, drawMark, glowText, rgba } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import { Asteroids as Rules, H, SHIP_SIZE, W, type AsteroidsEvent, type Rock, type Size } from './asteroidsRules'

export { W, H }

const LEFT_KEYS = ['ArrowLeft', 'KeyA']
const RIGHT_KEYS = ['ArrowRight', 'KeyD']
const THRUST_KEYS = ['ArrowUp', 'KeyW']
const FIRE_KEYS = ['Space', 'KeyF']

/** Rock outlines by size: small ones are the brightest. */
export const ROCK_COLORS: Record<Size, string> = { 1: '#ffd27a', 2: '#c9d4dc', 3: '#9fb0bd' }

interface Star {
  x: number
  y: number
  r: number
  tw: number
}

interface Banner {
  title: string
  sub: string
  t: number
  life: number
}

/** Interpolates a position that may have wrapped around the screen this frame. */
function between(p: number, c: number, alpha: number, max: number) {
  return Math.abs(c - p) > max / 2 ? c : p + (c - p) * alpha
}

export class AsteroidsEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...THRUST_KEYS, ...FIRE_KEYS])
  readonly game = new Rules()
  accent = '#22b357'
  private particles = new Particles(600)
  private floaters = new Floaters()
  private held = { left: new Set<string>(), right: new Set<string>(), thrust: new Set<string>() }
  private stars: Star[] = []
  private shake = 0
  private shakeX = 0
  private shakeY = 0
  private flash = 0
  private banner: Banner | null = null
  private clock = 0

  constructor() {
    for (let i = 0; i < 110; i++)
      this.stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() < 0.15 ? 1.4 : 0.8, tw: Math.random() * Math.PI * 2 })
  }

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    return `Wave ${this.game.wave}`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.shake = this.shakeX = this.shakeY = this.flash = 0
    this.banner = null
  }

  // ------------------------------------------------------------- controls

  keyDown(code: string) {
    if (LEFT_KEYS.includes(code)) this.held.left.add(code)
    else if (RIGHT_KEYS.includes(code)) this.held.right.add(code)
    else if (THRUST_KEYS.includes(code)) this.held.thrust.add(code)
    else if (FIRE_KEYS.includes(code)) this.game.shoot()
    this.syncKeys()
  }

  keyUp(code: string) {
    this.held.left.delete(code)
    this.held.right.delete(code)
    this.held.thrust.delete(code)
    this.syncKeys()
  }

  releaseAll() {
    this.held.left.clear()
    this.held.right.clear()
    this.held.thrust.clear()
    this.syncKeys()
  }

  private syncKeys() {
    this.game.input.left = this.held.left.size > 0
    this.game.input.right = this.held.right.size > 0
    this.game.input.thrust = this.held.thrust.size > 0
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    const g = this.game
    this.clock += dt
    g.update()
    for (const e of g.events) this.onEvent(e)
    g.events.length = 0

    const s = g.ship
    if (g.state === 'play' && s.thrusting) {
      // Exhaust out of the back of the ship.
      const a = (s.angle * Math.PI) / 180
      const bx = s.x - Math.cos(a) * SHIP_SIZE
      const by = s.y - Math.sin(a) * SHIP_SIZE
      this.particles.burst(bx, by, Math.random() < 0.5 ? '#ffb347' : '#ff6a3d', {
        count: 2, speed: [60, 140], angle: a + Math.PI, spread: 0.6, gravity: 0, drag: 3, life: [0.15, 0.35], size: [1.2, 2.6], square: false,
      })
      sfx('thrust', () => noise({ dur: 0.12, freq: 220, vol: 0.05, filter: 'lowpass' }), 0.09)
    }
    this.particles.update(dt)
    this.floaters.update(dt)
    this.flash = Math.max(0, this.flash - dt * 2)
    this.shake = Math.max(0, this.shake - dt * 20)
    this.shakeX = (Math.random() - 0.5) * this.shake
    this.shakeY = (Math.random() - 0.5) * this.shake
    if (this.banner && (this.banner.t += dt) > this.banner.life) this.banner = null
  }

  private onEvent(e: AsteroidsEvent) {
    const g = this.game
    switch (e.type) {
      case 'shoot':
        sfx('shoot', () => tone({ freq: 880, to: 320, dur: 0.09, type: 'square', vol: 0.07 }), 0.02)
        break
      case 'hit': {
        const color = ROCK_COLORS[e.size]
        this.particles.burst(e.x, e.y, color, { count: 8 + e.size * 6, speed: [40, 120 + e.size * 30], gravity: 0, drag: 1.6, life: [0.4, 1], size: [1.5, 3.5] })
        this.floaters.add(`+${e.points}`, e.x, e.y, color, { size: 13, life: 0.8, vy: -32 })
        this.shake = Math.min(6, this.shake + e.size)
        const f = [0, 1400, 700, 260][e.size]
        sfx('hit', () => noise({ dur: 0.12 + e.size * 0.08, freq: f, to: f / 3, vol: 0.12 + e.size * 0.03 }), 0.03)
        break
      }
      case 'crash':
        this.flash = 1
        this.shake = 12
        this.particles.burst(e.x, e.y, this.accent, { count: 30, speed: [40, 220], gravity: 0, drag: 1, life: [0.6, 1.4], size: [1.5, 3.5] })
        this.particles.burst(e.x, e.y, '#ffffff', { count: 14, speed: [80, 260], gravity: 0, drag: 1.2, life: [0.3, 0.7], size: [1, 2] })
        noise({ dur: 0.7, freq: 600, to: 60, vol: 0.2, filter: 'lowpass' })
        tone({ freq: 220, to: 50, dur: 0.6, type: 'sawtooth', vol: 0.1 })
        if (g.lives > 0)
          this.floaters.add(g.lives === 1 ? 'LAST SHIP!' : `${g.lives} SHIPS LEFT`, W / 2, H * 0.62, '#ff4b5c', { size: 20, life: 1.3, pop: true, vy: -10 })
        break
      case 'respawn':
        tone({ freq: 300, to: 900, dur: 0.25, type: 'triangle', vol: 0.09 })
        break
      case 'wave':
        this.banner = { title: `WAVE ${e.wave}`, sub: `${e.rocks} meteors`, t: 0, life: 2 }
        if (e.wave > 1) arpeggio([60, 64, 67, 72, 76], 0.07, { dur: 0.14, type: 'square', vol: 0.07 })
        break
      case 'gameover':
        tone({ freq: 260, to: 40, dur: 1.3, type: 'sawtooth', vol: 0.12 })
        break
    }
  }

  // ------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    ctx.save()
    ctx.translate(this.shakeX, this.shakeY)
    this.drawSpace(ctx, f)
    for (const r of g.rocks) this.drawRock(ctx, r, f.alpha)
    this.drawBullets(ctx, f.alpha)
    if (g.state === 'play') this.drawShip(ctx, f)
    this.particles.draw(ctx)
    ctx.restore()
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,75,92,${0.25 * this.flash})`
      ctx.fillRect(0, 0, W, H)
    }
    this.floaters.draw(ctx)
    this.drawBanner(ctx)
  }

  private drawSpace(ctx: CanvasRenderingContext2D, f: Frame) {
    const bg = ctx.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H / 2, W * 0.7)
    bg.addColorStop(0, '#0a1a10')
    bg.addColorStop(1, '#020504')
    ctx.fillStyle = bg
    ctx.fillRect(-12, -12, W + 24, H + 24)
    for (const s of this.stars) {
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(f.now / 900 + s.tw)
      ctx.fillStyle = '#dff5e6'
      ctx.fillRect(s.x, s.y, s.r, s.r)
    }
    ctx.globalAlpha = 1
    drawMark(ctx, W / 2, H / 2, 260, rgba(this.accent, 0.06), 12)
  }

  private drawRock(ctx: CanvasRenderingContext2D, r: Rock, alpha: number) {
    const x = between(r.px, r.x, alpha, W)
    const y = between(r.py, r.y, alpha, H)
    const a = ((r.angle + r.spin * (alpha - 1)) * Math.PI) / 180
    const color = ROCK_COLORS[r.size]
    // Drawn again across an edge, so a rock wrapping round is seen on both sides.
    for (const ox of [0, -W, W]) {
      for (const oy of [0, -H, H]) {
        const cx = x + ox
        const cy = y + oy
        if (cx < -r.radius - 6 || cx > W + r.radius + 6 || cy < -r.radius - 6 || cy > H + r.radius + 6) continue
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(a)
        ctx.beginPath()
        r.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.closePath()
        ctx.fillStyle = rgba(color, 0.08)
        ctx.fill()
        ctx.shadowColor = color
        ctx.shadowBlur = 8
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        ctx.stroke()
        ctx.restore()
      }
    }
  }

  private drawBullets(ctx: CanvasRenderingContext2D, alpha: number) {
    ctx.save()
    ctx.shadowColor = '#ffffff'
    ctx.shadowBlur = 8
    for (const b of this.game.bullets) {
      const x = between(b.px, b.x, alpha, W)
      const y = between(b.py, b.y, alpha, H)
      ctx.strokeStyle = rgba('#b8ffd0', 0.45)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x - b.vx * 0.8, y - b.vy * 0.8)
      ctx.lineTo(x, y)
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x, y, b.radius, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private drawShip(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const s = g.ship
    // A new ship blinks while its shield is up.
    if (g.shield > 0 && Math.floor(this.clock * 10) % 2 === 0) ctx.globalAlpha = 0.35
    const x = between(s.px, s.x, f.alpha, W)
    const y = between(s.py, s.y, f.alpha, H)
    const S = SHIP_SIZE
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((s.angle * Math.PI) / 180)
    if (s.thrusting) {
      const len = S * (1 + 0.6 * Math.random())
      ctx.fillStyle = '#ffb347'
      ctx.beginPath()
      ctx.moveTo(-S * 0.7, -S * 0.32)
      ctx.lineTo(-S * 0.7 - len, 0)
      ctx.lineTo(-S * 0.7, S * 0.32)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(S * 1.15, 0)
    ctx.lineTo(-S, S * 0.65)
    ctx.lineTo(-S * 0.6, 0)
    ctx.lineTo(-S, -S * 0.65)
    ctx.closePath()
    ctx.fillStyle = rgba(this.accent, 0.3)
    ctx.fill()
    ctx.shadowColor = this.accent
    ctx.shadowBlur = 12
    ctx.strokeStyle = '#e8fff0'
    ctx.lineWidth = 1.8
    ctx.lineJoin = 'round'
    ctx.stroke()
    if (g.shield > 0) {
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = this.accent
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(0, 0, S * 1.9, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    const b = this.banner
    if (!b) return
    const a = Math.min(1, b.t / 0.15) * Math.min(1, (b.life - b.t) / 0.4)
    const pop = 1 + 0.25 * Math.max(0, 1 - b.t / 0.2)
    ctx.globalAlpha = Math.max(0, a)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    glowText(ctx, b.title, W / 2, H * 0.3, '#ffffff', 34 * pop, 900)
    glowText(ctx, b.sub, W / 2, H * 0.3 + 34, this.accent, 15, 700)
    ctx.globalAlpha = 1
  }
}
