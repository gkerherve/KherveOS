// Breakout's engine for the game shell: keys and mouse move the paddle, plus
// the sounds, the effects (shards, sparks, call-outs, a little shake) and the
// drawing. The rules and the ball physics are in breakout.ts.

import type { Frame, GameEngine } from './GameShell'
import { FONT, Floaters, Particles, drawMark, fmt, glowText, rgba, shade } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import {
  BALL_R, BRICK_H, BRICK_W, Breakout as Rules, H, PADDLE_H, PADDLE_Y, W,
  type Ball, type BreakoutEvent, type Brick, type PowerKind,
} from './breakoutRules'

export { W, H }

export const BRICK_COLORS: Record<string, string> = {
  r: '#ff4b5c',
  o: '#ff9b2f',
  y: '#ffd83a',
  g: '#46e05b',
  c: '#35e0ea',
  b: '#4a7dff',
  p: '#b45cff',
}
/** Bricks that take several hits are silver; steel ones, which never break, are brass. */
const STRONG = '#c3ced6'
const STEEL = '#b38a3e'

export const POWERS: Record<PowerKind, { color: string; letter: string; name: string }> = {
  wide: { color: '#4a7dff', letter: 'W', name: 'WIDE PADDLE' },
  multi: { color: '#ff4fd8', letter: 'M', name: 'MULTI-BALL' },
  slow: { color: '#35e0ea', letter: 'S', name: 'SLOW BALL' },
  life: { color: '#ff4b5c', letter: '+1', name: 'EXTRA BALL' },
}

const LEFT_KEYS = ['ArrowLeft', 'KeyA']
const RIGHT_KEYS = ['ArrowRight', 'KeyD']
const LAUNCH_KEYS = ['Space', 'ArrowUp', 'KeyW']

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function brickColor(k: Brick): string {
  if (k.steel) return STEEL
  if (k.max > 1) return STRONG
  return BRICK_COLORS[k.kind] ?? '#ffffff'
}

interface Banner {
  title: string
  sub: string
  color: string
  t: number
  life: number
}

export class BreakoutEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...LAUNCH_KEYS])
  readonly game = new Rules()
  accent = '#22b357'
  private particles = new Particles(700)
  private floaters = new Floaters()
  /** Where each ball has just been, for its tail. */
  private trails = new WeakMap<Ball, { x: number; y: number }[]>()
  private held = { left: new Set<string>(), right: new Set<string>() }
  private paddlePrev = W / 2
  private paddleGlow = 0
  private shake = 0
  private shakeX = 0
  private shakeY = 0
  private redFlash = 0
  private banner: Banner | null = null
  private clock = 0

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    return `Level ${this.game.level} · ${this.game.name}`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.trails = new WeakMap()
    this.paddlePrev = this.game.paddle.x
    this.paddleGlow = this.shake = this.shakeX = this.shakeY = this.redFlash = 0
    this.banner = null
  }

  // ------------------------------------------------------------- controls

  keyDown(code: string) {
    if (LEFT_KEYS.includes(code)) this.held.left.add(code)
    else if (RIGHT_KEYS.includes(code)) this.held.right.add(code)
    else if (LAUNCH_KEYS.includes(code)) this.game.launch()
    this.syncKeys()
  }

  keyUp(code: string) {
    this.held.left.delete(code)
    this.held.right.delete(code)
    this.syncKeys()
  }

  releaseAll() {
    this.held.left.clear()
    this.held.right.clear()
    this.syncKeys()
  }

  private syncKeys() {
    this.game.input.left = this.held.left.size > 0
    this.game.input.right = this.held.right.size > 0
  }

  pointerMove(x: number) {
    this.game.input.pointer = x
  }

  pointerDown() {
    this.game.launch()
  }

  // ------------------------------------------------------------- the clock

  update(dt: number) {
    const g = this.game
    this.clock += dt
    this.paddlePrev = g.paddle.x
    g.update(dt)
    for (const e of g.events) this.onEvent(e)
    g.events.length = 0

    for (const b of g.balls) {
      if (b.stuck) {
        this.trails.delete(b)
        continue
      }
      let t = this.trails.get(b)
      if (!t) this.trails.set(b, (t = []))
      t.unshift({ x: b.x, y: b.y })
      if (t.length > 8) t.length = 8
    }
    this.particles.update(dt)
    this.floaters.update(dt)
    this.paddleGlow = Math.max(0, this.paddleGlow - dt * 4)
    this.redFlash = Math.max(0, this.redFlash - dt * 1.6)
    this.shake = Math.max(0, this.shake - dt * 22)
    this.shakeX = (Math.random() - 0.5) * this.shake
    this.shakeY = (Math.random() - 0.5) * this.shake
    if (this.banner && (this.banner.t += dt) > this.banner.life) this.banner = null
  }

  private onEvent(e: BreakoutEvent) {
    const g = this.game
    switch (e.type) {
      case 'paddle':
        this.paddleGlow = 1
        this.particles.burst(e.x, PADDLE_Y, this.accent, {
          count: 6, speed: [40, 150], angle: -Math.PI / 2, spread: Math.PI * 0.8, gravity: 240, life: [0.15, 0.35], size: [1, 2.5],
        })
        sfx('paddle', () => tone({ freq: 380 + (e.x - g.paddle.x) * 2, dur: 0.07, type: 'square', vol: 0.09 }))
        break
      case 'wall':
        sfx('wall', () => tone({ freq: 230, dur: 0.035, type: 'triangle', vol: 0.07 }), 0.04)
        break
      case 'brick': {
        const k = e.brick
        const color = brickColor(k)
        const cx = k.x + BRICK_W / 2
        const cy = k.y + BRICK_H / 2
        if (e.broken) {
          this.particles.burst(cx, cy, color, { count: 14, speed: [50, 230], gravity: 520, life: [0.4, 0.9], size: [2, 4.5] })
          this.floaters.add(`+${k.points}`, cx, cy, color, { size: 10, life: 0.7, vy: -40 })
          this.shake = Math.min(3, this.shake + 1.2)
          const pitch = Math.max(330, 900 - k.row * 45)
          sfx('brick', () => tone({ freq: pitch, dur: 0.075, type: 'square', vol: 0.09 }), 0.02)
        } else {
          this.particles.burst(cx, cy, '#ffffff', { count: 6, speed: [30, 140], life: [0.15, 0.35], size: [1, 2], gravity: 200 })
          sfx('strong', () => tone({ freq: 1200, to: 880, dur: 0.07, type: 'triangle', vol: 0.12 }))
        }
        break
      }
      case 'steel': {
        const k = e.brick
        this.particles.burst(k.x + BRICK_W / 2, k.y + BRICK_H / 2, '#ffe9a8', { count: 5, speed: [40, 160], life: [0.1, 0.3], size: [1, 2], gravity: 150 })
        sfx('steel', () => {
          tone({ freq: 1560, dur: 0.1, type: 'triangle', vol: 0.08 })
          noise({ dur: 0.05, freq: 5000, vol: 0.05, filter: 'highpass' })
        })
        break
      }
      case 'drop':
        sfx('drop', () => tone({ freq: 660, to: 990, dur: 0.09, type: 'sine', vol: 0.06 }))
        break
      case 'power': {
        const p = POWERS[e.kind]
        this.floaters.add(p.name, W / 2, PADDLE_Y - 46, p.color, { size: 15, life: 1.3, pop: true, vy: -18 })
        this.particles.burst(e.x, PADDLE_Y, p.color, { count: 18, speed: [60, 200], angle: -Math.PI / 2, spread: Math.PI, gravity: 260, life: [0.3, 0.7] })
        arpeggio([72, 76, 79, 84], 0.045, { dur: 0.1, type: 'sine', vol: 0.13 })
        break
      }
      case 'launch':
        tone({ freq: 330, to: 680, dur: 0.1, type: 'triangle', vol: 0.1 })
        break
      case 'lost':
        this.redFlash = 1
        this.shake = 7
        tone({ freq: 330, to: 70, dur: 0.6, type: 'sawtooth', vol: 0.11 })
        this.floaters.add(g.lives === 1 ? 'LAST BALL!' : `${g.lives} BALLS LEFT`, W / 2, H * 0.6, '#ff4b5c', { size: 16, life: 1.3, pop: true, vy: -10 })
        break
      case 'cleared':
        this.banner = { title: 'LEVEL CLEAR', sub: `Bonus +${fmt(e.bonus)}`, color: this.accent, t: 0, life: 1.8 }
        arpeggio([60, 64, 67, 72, 76, 79, 84], 0.07, { dur: 0.15, type: 'square', vol: 0.08 })
        for (let i = 0; i < 6; i++) {
          const colors = Object.values(BRICK_COLORS)
          this.particles.burst(60 + Math.random() * (W - 120), 80 + Math.random() * 160, colors[i % colors.length], {
            count: 22, speed: [60, 220], gravity: 160, life: [0.6, 1.2], size: [1.5, 3], square: false,
          })
        }
        break
      case 'level':
        this.banner = { title: `LEVEL ${e.level}`, sub: e.name, color: '#ffffff', t: 0, life: 2.2 }
        if (e.level > 1) arpeggio([67, 72], 0.08, { dur: 0.12, type: 'triangle', vol: 0.1 })
        break
      case 'gameover':
        this.redFlash = 1
        this.shake = 9
        tone({ freq: 260, to: 40, dur: 1.3, type: 'sawtooth', vol: 0.13 })
        break
    }
  }

  // --------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    ctx.save()
    ctx.translate(this.shakeX, this.shakeY)
    this.drawField(ctx)
    this.drawBricks(ctx)
    this.drawDrops(ctx)
    this.drawPaddle(ctx, f)
    if (g.state !== 'cleared') this.drawBalls(ctx, f)
    this.particles.draw(ctx)
    ctx.restore()
    if (this.redFlash > 0) {
      const red = ctx.createLinearGradient(0, H * 0.55, 0, H)
      red.addColorStop(0, 'rgba(255,75,92,0)')
      red.addColorStop(1, `rgba(255,75,92,${0.4 * this.redFlash})`)
      ctx.fillStyle = red
      ctx.fillRect(0, H * 0.55, W, H * 0.45)
    }
    this.floaters.draw(ctx)
    this.drawBanner(ctx)
    if (g.state === 'serve' && f.phase === 'playing' && !this.banner) {
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(f.now / 260)
      ctx.font = `700 11px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#d9f5e3'
      ctx.fillText('SPACE OR CLICK TO LAUNCH', W / 2, PADDLE_Y - 44)
      ctx.globalAlpha = 1
    }
  }

  /** Dark field, a faint grid and the KherveOS mark, glowing walls. */
  private drawField(ctx: CanvasRenderingContext2D) {
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#07140c')
    bg.addColorStop(1, '#020504')
    ctx.fillStyle = bg
    ctx.fillRect(-10, -10, W + 20, H + 20)
    ctx.strokeStyle = rgba(this.accent, 0.05)
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 24; x < W; x += 24) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
    }
    for (let y = 24; y < H; y += 24) {
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
    }
    ctx.stroke()
    drawMark(ctx, W / 2, H * 0.6, 200, rgba(this.accent, 0.07), 14)

    ctx.save()
    ctx.shadowColor = this.accent
    ctx.shadowBlur = 10
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(1, H + 10)
    ctx.lineTo(1, 1)
    ctx.lineTo(W - 1, 1)
    ctx.lineTo(W - 1, H + 10)
    ctx.stroke()
    ctx.restore()
  }

  private drawBricks(ctx: CanvasRenderingContext2D) {
    for (const k of this.game.bricks) {
      if (!k.alive) continue
      const { x, y } = k
      const color = brickColor(k)
      ctx.fillStyle = shade(color, -0.35)
      ctx.beginPath()
      ctx.roundRect(x, y, BRICK_W, BRICK_H, 3)
      ctx.fill()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x, y, BRICK_W, BRICK_H - 2.5, 3)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillRect(x + 2, y + 2, BRICK_W - 4, (BRICK_H - 4) * 0.45)
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.fillRect(x + 3, y + 1, BRICK_W - 6, 1)

      if (k.steel) {
        // Rivets.
        for (const rx of [x + 5, x + BRICK_W - 5]) {
          ctx.fillStyle = shade(STEEL, -0.5)
          ctx.beginPath()
          ctx.arc(rx, y + BRICK_H / 2 - 1, 2, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = shade(STEEL, 0.5)
          ctx.fillRect(rx - 1, y + BRICK_H / 2 - 2.5, 1, 1)
        }
      } else if (k.max > 1) {
        // One crack per hit taken; dots for the hits still needed.
        ctx.strokeStyle = 'rgba(40,48,56,0.85)'
        ctx.lineWidth = 1
        const taken = k.max - k.hits
        for (let i = 0; i < taken; i++) {
          const cx = x + 9 + ((k.col * 7 + i * 13) % 17)
          ctx.beginPath()
          ctx.moveTo(cx, y + 1)
          ctx.lineTo(cx + 3, y + 5)
          ctx.lineTo(cx - 1, y + 8)
          ctx.lineTo(cx + 2, y + BRICK_H - 3)
          ctx.stroke()
        }
        ctx.fillStyle = 'rgba(40,48,56,0.7)'
        for (let i = 0; i < k.hits; i++) ctx.fillRect(x + BRICK_W - 6 - i * 4, y + BRICK_H - 6, 2, 2)
      }

      if (k.hitAge < 0.12) {
        ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - k.hitAge / 0.12)})`
        ctx.beginPath()
        ctx.roundRect(x, y, BRICK_W, BRICK_H, 3)
        ctx.fill()
      }
    }
  }

  private drawDrops(ctx: CanvasRenderingContext2D) {
    for (const d of this.game.drops) {
      const p = POWERS[d.kind]
      const w = 28
      const h = 13
      ctx.save()
      ctx.shadowColor = p.color
      ctx.shadowBlur = 10 + 4 * Math.sin(d.age * 8)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.roundRect(d.x - w / 2, d.y - h / 2, w, h, h / 2)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = 'rgba(255,255,255,0.3)'
      ctx.beginPath()
      ctx.roundRect(d.x - w / 2 + 2, d.y - h / 2 + 1.5, w - 4, h * 0.38, 3)
      ctx.fill()
      ctx.font = `900 9px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.fillText(p.letter, d.x, d.y + 0.5)
    }
  }

  private drawPaddle(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const p = g.paddle
    if (g.state === 'dead') return
    const x = lerp(this.paddlePrev, p.x, f.alpha)
    const left = x - p.w / 2
    // A wide paddle blinks in its last two seconds.
    if (g.wideTime > 0 && g.wideTime < 2 && Math.floor(this.clock * 8) % 2 === 0) ctx.globalAlpha = 0.6
    ctx.save()
    ctx.shadowColor = this.accent
    ctx.shadowBlur = 10 + this.paddleGlow * 16
    const body = ctx.createLinearGradient(0, PADDLE_Y, 0, PADDLE_Y + PADDLE_H)
    body.addColorStop(0, shade(this.accent, 0.5))
    body.addColorStop(0.5, this.accent)
    body.addColorStop(1, shade(this.accent, -0.4))
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.roundRect(left, PADDLE_Y, p.w, PADDLE_H, PADDLE_H / 2)
    ctx.fill()
    ctx.restore()
    // Silver ends, like a little ship.
    ctx.fillStyle = '#dfe8ee'
    for (const ex of [left, left + p.w - 9]) {
      ctx.beginPath()
      ctx.roundRect(ex, PADDLE_Y, 9, PADDLE_H, [ex === left ? PADDLE_H / 2 : 2, ex === left ? 2 : PADDLE_H / 2, ex === left ? 2 : PADDLE_H / 2, ex === left ? PADDLE_H / 2 : 2])
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillRect(left + 6, PADDLE_Y + 1.5, p.w - 12, 1.2)
    if (this.paddleGlow > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 * this.paddleGlow})`
      ctx.beginPath()
      ctx.roundRect(left, PADDLE_Y, p.w, PADDLE_H, PADDLE_H / 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private drawBalls(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const slow = g.slowTime > 0
    for (const b of g.balls) {
      const x = lerp(b.px, b.x, f.alpha)
      const y = lerp(b.py, b.y, f.alpha)
      const trail = this.trails.get(b)
      if (trail) {
        for (let i = 1; i < trail.length; i++) {
          const k = 1 - i / trail.length
          ctx.fillStyle = slow ? rgba('#35e0ea', 0.3 * k) : rgba('#e8fff0', 0.22 * k)
          ctx.beginPath()
          ctx.arc(trail[i].x, trail[i].y, BALL_R * (0.4 + 0.6 * k), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.save()
      ctx.shadowColor = slow ? '#35e0ea' : '#ffffff'
      ctx.shadowBlur = 12
      const shine = ctx.createRadialGradient(x - 1.8, y - 1.8, 0.5, x, y, BALL_R)
      shine.addColorStop(0, '#ffffff')
      shine.addColorStop(1, slow ? '#9eeff3' : '#cfe9da')
      ctx.fillStyle = shine
      ctx.beginPath()
      ctx.arc(x, y, BALL_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    const b = this.banner
    if (!b) return
    const a = Math.min(1, b.t / 0.15) * Math.min(1, (b.life - b.t) / 0.35)
    const pop = 1 + 0.25 * Math.max(0, 1 - b.t / 0.2)
    ctx.globalAlpha = Math.max(0, a)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    glowText(ctx, b.title, W / 2, H * 0.62, b.color, 30 * pop, 900)
    glowText(ctx, b.sub, W / 2, H * 0.62 + 30, this.accent, 14, 700)
    ctx.globalAlpha = 1
  }
}
