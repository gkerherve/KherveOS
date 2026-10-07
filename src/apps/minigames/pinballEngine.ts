// Pinball's engine for the game shell: the flipper and plunger keys, the
// sounds, the lights and effects, and the drawing of the table. The table and
// its rules are in pinball.ts, the collisions in physics.ts.

import type { Frame, GameEngine } from './GameShell'
import { FONT, Floaters, Particles, drawMark, fmt, glowText, rgba, shade } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import {
  ARCH, BALL_R, CX, H, LANE_LETTERS, LANE_X, LANE_X0, LANE_X1, PLUNGER_Y, POSTS, Pinball as Rules, SLINGS, W,
  type Flipper, type PinballEvent,
} from './pinballRules'

export { W, H }

const LEFT_KEYS = ['KeyZ', 'ShiftLeft', 'ArrowLeft']
const RIGHT_KEYS = ['Slash', 'ShiftRight', 'ArrowRight']
const PLUNGER_KEYS = ['Space', 'ArrowDown']

const BUMPER_COLORS = ['#ff4fd8', '#35e0ea', '#ffd83a']
const SLING_COLOR = '#ff9b2f'
const TARGET_COLOR = '#ff4b5c'
const STANDUP_COLOR = '#4a7dff'

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

interface Banner {
  title: string
  sub: string
  color: string
  t: number
  life: number
}

export class PinballEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...PLUNGER_KEYS])
  readonly game = new Rules()
  accent = '#22b357'
  private particles = new Particles(500)
  private floaters = new Floaters()
  private held = { L: new Set<string>(), R: new Set<string>(), plunger: new Set<string>() }
  private banner: Banner | null = null
  /** Recent ball positions, for a motion trail when it flies. */
  private trail: { x: number; y: number }[] = []
  private laneFlash = [9, 9, 9]
  private multFlash = 9
  private saveFlash = 9
  private shake = 0
  private shakeX = 0
  private shakeY = 0
  private tallyShown = 0

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const m = this.game.topMultiplier
    return m > 1 ? `Bonus up to ${m}×` : 'Bonus 1×'
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.banner = null
    this.trail = []
    this.shake = this.shakeX = this.shakeY = 0
    this.releaseAll()
  }

  // ------------------------------------------------------------- controls

  keyDown(code: string) {
    if (LEFT_KEYS.includes(code)) this.held.L.add(code)
    else if (RIGHT_KEYS.includes(code)) this.held.R.add(code)
    else if (PLUNGER_KEYS.includes(code)) this.held.plunger.add(code)
    this.sync()
  }

  keyUp(code: string) {
    this.held.L.delete(code)
    this.held.R.delete(code)
    this.held.plunger.delete(code)
    this.sync()
  }

  releaseAll() {
    this.held.L.clear()
    this.held.R.clear()
    this.held.plunger.clear()
    this.game.releaseAll()
  }

  private sync() {
    const g = this.game
    g.setFlipper('L', this.held.L.size > 0)
    g.setFlipper('R', this.held.R.size > 0)
    const pull = this.held.plunger.size > 0
    if (pull && !g.charging) sfx('pull', () => tone({ freq: 160, to: 120, dur: 0.06, type: 'triangle', vol: 0.1 }))
    g.setPlunger(pull)
  }

  // ------------------------------------------------------------- the clock

  update(dt: number) {
    const g = this.game
    g.update(dt)
    for (const e of g.events) this.onEvent(e)
    g.events.length = 0

    const b = g.ball
    if (g.state === 'play') {
      this.trail.unshift({ x: b.x, y: b.y })
      if (this.trail.length > 6) this.trail.length = 6
    } else this.trail = []
    this.particles.update(dt)
    this.floaters.update(dt)
    for (let i = 0; i < 3; i++) this.laneFlash[i] += dt
    this.multFlash += dt
    this.saveFlash += dt
    this.shake = Math.max(0, this.shake - dt * 25)
    this.shakeX = (Math.random() - 0.5) * this.shake
    this.shakeY = (Math.random() - 0.5) * this.shake
    if (this.banner && (this.banner.t += dt) > this.banner.life) this.banner = null

    // Count the end-of-ball bonus up, with a tick for each step.
    if (g.state === 'drain') {
      const total = g.tally.bonus * g.tally.multiplier
      const shown = Math.min(total, Math.floor((total * g.stateTime) / 1.1))
      if (shown > this.tallyShown) {
        sfx('tick', () => tone({ freq: 1400, dur: 0.025, type: 'square', vol: 0.05 }), 0.06)
        this.tallyShown = shown
      }
    } else this.tallyShown = 0
  }

  private show(title: string, sub: string, color: string, life = 1.6) {
    this.banner = { title, sub, color, t: 0, life }
  }

  private onEvent(e: PinballEvent) {
    const g = this.game
    switch (e.type) {
      case 'flipper':
        if (e.up) {
          noise({ dur: 0.05, freq: 700, vol: 0.16, filter: 'lowpass' })
          tone({ freq: 95, to: 70, dur: 0.05, type: 'square', vol: 0.06 })
        } else noise({ dur: 0.04, freq: 400, vol: 0.07, filter: 'lowpass' })
        break
      case 'bumper': {
        const bu = g.bumpers[e.i]
        const color = BUMPER_COLORS[e.i % BUMPER_COLORS.length]
        this.particles.burst(bu.x, bu.y, color, { count: 10, speed: [80, 220], life: [0.2, 0.45], size: [1.5, 3], gravity: 200, square: false })
        this.floaters.add(`${e.points}`, bu.x, bu.y - bu.r - 6, color, { size: 10, life: 0.6, vy: -40 })
        this.shake = Math.min(3, this.shake + 1.5)
        sfx(`bumper${e.i}`, () => {
          tone({ freq: 720 + e.i * 90, to: 330, dur: 0.1, type: 'square', vol: 0.09 })
          noise({ dur: 0.04, freq: 2500, vol: 0.08 })
        })
        break
      }
      case 'sling': {
        const s = SLINGS[e.i]
        this.particles.burst((s.a[0] + s.c[0]) / 2, (s.a[1] + s.c[1]) / 2, SLING_COLOR, { count: 8, speed: [60, 180], life: [0.15, 0.35], size: [1, 2.5], gravity: 150 })
        sfx('sling', () => {
          tone({ freq: 480, to: 240, dur: 0.07, type: 'triangle', vol: 0.12 })
          noise({ dur: 0.05, freq: 1200, vol: 0.1 })
        })
        break
      }
      case 'wall':
        sfx('wall', () => noise({ dur: 0.03, freq: 900, vol: Math.min(0.12, e.speed / 9000), filter: 'lowpass' }), 0.05)
        break
      case 'target': {
        const t = g.targets[e.i]
        this.particles.burst(t.ax + 4, (t.ay + t.by) / 2, TARGET_COLOR, { count: 10, speed: [60, 180], angle: 0, spread: Math.PI, life: [0.2, 0.5], gravity: 300 })
        noise({ dur: 0.04, freq: 3200, vol: 0.12, q: 2 })
        tone({ freq: 880, dur: 0.06, type: 'square', vol: 0.07 })
        break
      }
      case 'bank':
        this.show('SUPER BUMPERS', 'Bumpers score 500 for 20 s', BUMPER_COLORS[0])
        arpeggio([60, 64, 67, 72, 76], 0.06, { dur: 0.12, type: 'square', vol: 0.09 })
        break
      case 'standup': {
        const t = g.targets[e.i]
        this.particles.burst(t.ax - 4, (t.ay + t.by) / 2, STANDUP_COLOR, { count: 8, speed: [60, 160], angle: Math.PI, spread: Math.PI, life: [0.2, 0.45], gravity: 250 })
        tone({ freq: 1046, dur: 0.12, type: 'sine', vol: 0.12 })
        break
      }
      case 'jackpot':
        this.show('JACKPOT', `+${fmt(e.points)}`, '#ffd83a', 2)
        this.shake = 5
        arpeggio([72, 76, 79, 84, 88, 91, 96], 0.05, { dur: 0.14, type: 'square', vol: 0.08 })
        for (let i = 0; i < 5; i++) {
          this.particles.burst(60 + Math.random() * (W - 140), 140 + Math.random() * 300, BUMPER_COLORS[i % 3], {
            count: 20, speed: [60, 200], life: [0.6, 1.1], gravity: 120, square: false,
          })
        }
        break
      case 'lane':
        this.laneFlash[e.i] = 0
        if (e.lit) tone({ freq: 1318, dur: 0.14, type: 'sine', vol: 0.12 })
        else tone({ freq: 659, dur: 0.06, type: 'sine', vol: 0.06 })
        break
      case 'lanes':
        this.multFlash = 0
        this.show(`${e.multiplier}× BONUS`, e.multiplier >= 5 ? 'Maxed out: +25,000' : 'K·OS complete', this.accent)
        arpeggio([67, 71, 74, 79, 83], 0.06, { dur: 0.12, type: 'triangle', vol: 0.12 })
        break
      case 'skill':
        this.show('SKILL SHOT', `+${fmt(e.points)}`, '#ffd83a')
        arpeggio([72, 79, 84, 91], 0.07, { dur: 0.16, type: 'square', vol: 0.09 })
        break
      case 'inlane':
        sfx('inlane', () => tone({ freq: 880, dur: 0.08, type: 'triangle', vol: 0.08 }))
        break
      case 'outlane':
        tone({ freq: 440, to: 220, dur: 0.25, type: 'triangle', vol: 0.1 })
        break
      case 'launch':
        noise({ dur: 0.25, freq: 400, to: 2400, vol: 0.12 * (0.4 + e.power), q: 0.7 })
        tone({ freq: 70, dur: 0.08, type: 'sine', vol: 0.25 })
        break
      case 'saved':
        this.saveFlash = 0
        this.show('BALL SAVED', 'Shoot again', this.accent)
        arpeggio([72, 67, 72, 79], 0.07, { dur: 0.12, type: 'triangle', vol: 0.12 })
        break
      case 'drain':
        this.shake = 4
        tone({ freq: 392, to: 70, dur: 0.7, type: 'sawtooth', vol: 0.11 })
        break
      case 'bonus':
        break
      case 'ball':
        this.show(`BALL ${e.n}`, e.n === 3 ? 'Last ball' : 'Pull the plunger', '#ffffff', 1.6)
        arpeggio([60, 67], 0.1, { dur: 0.14, type: 'triangle', vol: 0.1, at: 0.05 })
        break
      case 'superEnd':
        tone({ freq: 523, to: 262, dur: 0.3, type: 'triangle', vol: 0.08 })
        break
      case 'gameover':
        tone({ freq: 330, to: 40, dur: 1.4, type: 'sawtooth', vol: 0.12 })
        break
    }
  }

  // --------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    ctx.save()
    ctx.translate(this.shakeX, this.shakeY)
    this.drawPlayfield(ctx, f)
    this.drawInserts(ctx, f)
    this.drawWalls(ctx)
    this.drawSlings(ctx)
    this.drawTargets(ctx, f)
    this.drawBumpers(ctx, f)
    this.drawPlunger(ctx, f)
    for (const fl of g.flippers) this.drawFlipper(ctx, fl)
    if (g.state === 'play') this.drawBall(ctx, f)
    this.particles.draw(ctx)
    ctx.restore()
    this.floaters.draw(ctx)
    this.drawBanner(ctx)
  }

  private drawPlayfield(ctx: CanvasRenderingContext2D, f: Frame) {
    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#08180f')
    bg.addColorStop(0.55, '#051009')
    bg.addColorStop(1, '#020604')
    ctx.fillStyle = bg
    ctx.fillRect(-10, -10, W + 20, H + 20)
    // A soft glow behind the bumpers, stronger while they are super.
    const g = this.game
    const pulse = g.superTime > 0 ? 0.16 + 0.08 * Math.sin(f.now / 120) : 0.07
    const glow = ctx.createRadialGradient(CX, 190, 10, CX, 190, 150)
    glow.addColorStop(0, rgba(BUMPER_COLORS[0], pulse))
    glow.addColorStop(1, rgba(BUMPER_COLORS[0], 0))
    ctx.fillStyle = glow
    ctx.fillRect(0, 40, W, 320)
    // Fine dots, like the printed playfield.
    ctx.fillStyle = rgba(this.accent, 0.08)
    for (let y = 30; y < H; y += 20) {
      for (let x = 24 + ((y / 20) % 2) * 10; x < LANE_X0; x += 20) ctx.fillRect(x, y, 1, 1)
    }
    drawMark(ctx, CX, 420, 170, rgba(this.accent, 0.1), 13)
    // The shooter lane's floor.
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(LANE_X0, 250, LANE_X1 - LANE_X0, H - 250)
  }

  /** The lights printed in the playfield: lanes, multipliers, ball save, arrows. */
  private drawInserts(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const blink = Math.floor(f.now / 180) % 2 === 0
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // K · O · S over the top lanes; the skill-shot lane blinks.
    const skill = g.skillLit
    LANE_LETTERS.forEach((letter, i) => {
      const x = 135 + i * 40
      const lit = g.lanes[i] || (skill === i && blink) || this.laneFlash[i] < 0.25
      this.light(ctx, x, 92, 6, this.accent, lit)
      ctx.font = `900 13px ${FONT}`
      ctx.fillStyle = lit ? '#ffffff' : rgba(this.accent, 0.45)
      ctx.fillText(letter, x, 74)
    })

    // Bonus multiplier: 2× 3× 4× 5×.
    for (let m = 2; m <= 5; m++) {
      const x = CX + (m - 3.5) * 34
      const lit = g.multiplier >= m || (this.multFlash < 0.6 && blink)
      ctx.save()
      if (lit) {
        ctx.shadowColor = '#ffd83a'
        ctx.shadowBlur = 10
      }
      ctx.fillStyle = lit ? '#ffd83a' : 'rgba(255,216,58,0.12)'
      ctx.beginPath()
      ctx.roundRect(x - 13, 520, 26, 15, 4)
      ctx.fill()
      ctx.restore()
      ctx.font = `800 10px ${FONT}`
      ctx.fillStyle = lit ? '#1a1404' : 'rgba(255,216,58,0.5)'
      ctx.fillText(`${m}×`, x, 528)
    }

    // Arrows pointing at the target banks.
    this.arrow(ctx, 50, 342, Math.PI, TARGET_COLOR, g.targets.some((t) => !t.standup && !t.down) && blink)
    this.arrow(ctx, LANE_X0 - 36, 342, 0, STANDUP_COLOR, g.targets.some((t) => t.standup && !t.lit) && !blink)

    // "Shoot again" between the flippers while the ball save runs.
    const saving = (g.saveTime > 0 && (g.saveTime > 2 || blink)) || (this.saveFlash < 1 && blink)
    ctx.save()
    if (saving) {
      ctx.shadowColor = this.accent
      ctx.shadowBlur = 12
    }
    ctx.fillStyle = saving ? this.accent : rgba(this.accent, 0.12)
    ctx.beginPath()
    ctx.roundRect(CX - 30, 640, 60, 16, 8)
    ctx.fill()
    ctx.restore()
    ctx.font = `800 8.5px ${FONT}`
    ctx.fillStyle = saving ? '#04140a' : rgba(this.accent, 0.5)
    ctx.fillText('SHOOT AGAIN', CX, 648.5)

    if (g.superTime > 0) {
      ctx.font = `900 11px ${FONT}`
      ctx.fillStyle = blink || g.superTime > 4 ? BUMPER_COLORS[0] : rgba(BUMPER_COLORS[0], 0.4)
      ctx.fillText('SUPER BUMPERS', CX, 268)
    }
  }

  private light(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, lit: boolean) {
    ctx.save()
    if (lit) {
      ctx.shadowColor = color
      ctx.shadowBlur = 12
    }
    ctx.fillStyle = lit ? shade(color, 0.35) : rgba(color, 0.14)
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, color: string, lit: boolean) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(dir)
    if (lit) {
      ctx.shadowColor = color
      ctx.shadowBlur = 10
    }
    ctx.fillStyle = lit ? color : rgba(color, 0.15)
    ctx.beginPath()
    ctx.moveTo(10, 0)
    ctx.lineTo(-6, -9)
    ctx.lineTo(-2, 0)
    ctx.lineTo(-6, 9)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  /** Walls glow green; rubber posts and guides are white. */
  private drawWalls(ctx: CanvasRenderingContext2D) {
    const g = this.game
    ctx.save()
    ctx.lineCap = 'round'
    ctx.shadowColor = this.accent
    ctx.shadowBlur = 8
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(ARCH.x, ARCH.y, ARCH.r + 1.5, Math.PI, Math.PI * 2)
    ctx.stroke()
    for (const w of g.walls) {
      if (w.kind === 'sling' || w.kind === 'rubber') continue
      ctx.strokeStyle = w.kind === 'guide' ? '#dfe8ee' : w.kind === 'gate' ? shade(this.accent, 0.4) : this.accent
      ctx.lineWidth = w.r * 2
      ctx.beginPath()
      ctx.moveTo(w.ax, w.ay)
      ctx.lineTo(w.bx, w.by)
      ctx.stroke()
    }
    ctx.restore()
    for (const p of POSTS) {
      ctx.fillStyle = '#dfe8ee'
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r + 1, 0, Math.PI * 2)
      ctx.fill()
    }
    // Shade outside the table.
    ctx.fillStyle = '#010302'
    ctx.beginPath()
    ctx.rect(-10, -10, W + 20, H + 20)
    ctx.moveTo(ARCH.x - ARCH.r - 3, ARCH.y)
    ctx.arc(ARCH.x, ARCH.y, ARCH.r + 3, Math.PI, Math.PI * 2)
    ctx.lineTo(LANE_X1 + 3, H + 10)
    ctx.lineTo(11, H + 10)
    ctx.closePath()
    ctx.fill('evenodd')
  }

  private drawSlings(ctx: CanvasRenderingContext2D) {
    const g = this.game
    SLINGS.forEach((s, i) => {
      const flash = Math.max(0, 1 - g.slingAge[i] / 0.15)
      ctx.save()
      ctx.shadowColor = SLING_COLOR
      ctx.shadowBlur = 6 + flash * 14
      ctx.fillStyle = flash > 0 ? rgba(SLING_COLOR, 0.35 + 0.5 * flash) : rgba(SLING_COLOR, 0.18)
      ctx.strokeStyle = SLING_COLOR
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(s.a[0], s.a[1])
      ctx.lineTo(s.b[0], s.b[1])
      ctx.lineTo(s.c[0], s.c[1])
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.restore()
      // The rubber band on the kicking face bulges when it fires.
      const mx = (s.a[0] + s.c[0]) / 2
      const my = (s.a[1] + s.c[1]) / 2
      const len = Math.hypot(s.c[0] - s.a[0], s.c[1] - s.a[1])
      const nx = ((s.c[1] - s.a[1]) / len) * (i === 0 ? 1 : -1)
      const ny = (-(s.c[0] - s.a[0]) / len) * (i === 0 ? 1 : -1)
      ctx.strokeStyle = '#f4f7f8'
      ctx.lineWidth = 3.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(s.a[0], s.a[1])
      ctx.quadraticCurveTo(mx + nx * 5 * flash, my + ny * 5 * flash, s.c[0], s.c[1])
      ctx.stroke()
    })
  }

  private drawTargets(ctx: CanvasRenderingContext2D, f: Frame) {
    for (const t of this.game.targets) {
      const y0 = Math.min(t.ay, t.by)
      const h = Math.abs(t.by - t.ay)
      const x = t.ax - 3
      if (t.down) {
        ctx.strokeStyle = rgba(TARGET_COLOR, 0.35)
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, y0 + 0.5, 5, h - 1)
        continue
      }
      const color = t.standup ? STANDUP_COLOR : TARGET_COLOR
      const flash = Math.max(0, 1 - t.age / 0.15)
      ctx.save()
      ctx.shadowColor = color
      ctx.shadowBlur = 8 + flash * 10
      ctx.fillStyle = flash > 0 ? shade(color, 0.6 * flash) : color
      ctx.beginPath()
      ctx.roundRect(x, y0, 6, h, 2)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.fillRect(x + (t.standup ? 4 : 1), y0 + 2, 1, h - 4)
      if (t.standup) this.light(ctx, x - 9, y0 + h / 2, 3.5, '#ffffff', t.lit || (flash > 0 && Math.floor(f.now / 60) % 2 === 0))
    }
  }

  private drawBumpers(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const superOn = g.superTime > 0
    g.bumpers.forEach((b, i) => {
      const color = BUMPER_COLORS[i % BUMPER_COLORS.length]
      const hit = Math.max(0, 1 - b.age / 0.14)
      const r = b.r + hit * 3
      // Skirt, ring, cap.
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.beginPath()
      ctx.arc(b.x + 2, b.y + 3, r + 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.save()
      ctx.shadowColor = color
      ctx.shadowBlur = 10 + hit * 18 + (superOn ? 8 + 6 * Math.sin(f.now / 100 + i) : 0)
      ctx.fillStyle = shade(color, -0.55)
      ctx.beginPath()
      ctx.arc(b.x, b.y, r + 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = hit > 0 ? '#ffffff' : color
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.arc(b.x, b.y, r - 1, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      const cap = ctx.createRadialGradient(b.x - 4, b.y - 5, 1, b.x, b.y, r - 4)
      cap.addColorStop(0, '#ffffff')
      cap.addColorStop(0.45, hit > 0 || superOn ? shade(color, 0.5) : shade(color, 0.2))
      cap.addColorStop(1, shade(color, -0.25))
      ctx.fillStyle = cap
      ctx.beginPath()
      ctx.arc(b.x, b.y, r - 4, 0, Math.PI * 2)
      ctx.fill()
      // The KherveOS mark on each cap.
      drawMark(ctx, b.x, b.y, (r - 4) * 1.5, 'rgba(0,0,0,0.35)', 18)
    })
  }

  private drawPlunger(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const tip = PLUNGER_Y + g.plungerY()
    const x0 = LANE_X0 + 3
    const w = LANE_X1 - LANE_X0 - 6
    // Spring from the tip down to the bottom.
    ctx.strokeStyle = '#8c979e'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    const coils = 7
    const bottom = H - 4
    for (let i = 0; i <= coils * 2; i++) {
      const y = tip + 6 + ((bottom - tip - 6) * i) / (coils * 2)
      const x = i % 2 === 0 ? x0 + 4 : x0 + w - 4
      if (i === 0) ctx.moveTo(LANE_X, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    // The tip: green to red as it charges.
    const c = g.charge
    const color = c < 0.5 ? this.accent : c < 0.85 ? '#ffd83a' : '#ff4b5c'
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = 6 + c * 14
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(x0, tip - 2, w, 8, 3)
    ctx.fill()
    ctx.restore()
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillRect(x0 + 3, tip - 1, w - 6, 1.5)
    // A kick of light up the lane after a launch.
    if (g.kickTime < 0.25) {
      const a = 1 - g.kickTime / 0.25
      const grad = ctx.createLinearGradient(0, PLUNGER_Y - 200, 0, PLUNGER_Y)
      grad.addColorStop(0, rgba(this.accent, 0))
      grad.addColorStop(1, rgba(this.accent, 0.35 * a))
      ctx.fillStyle = grad
      ctx.fillRect(LANE_X0 + 2, PLUNGER_Y - 200, LANE_X1 - LANE_X0 - 4, 200)
    }
    // "Hold Space" while the ball waits on the plunger.
    if (g.onPlunger && !g.charging && f.phase === 'playing' && Math.floor(f.now / 400) % 2 === 0) {
      ctx.save()
      ctx.translate(LANE_X + 1, PLUNGER_Y - 60)
      ctx.rotate(-Math.PI / 2)
      ctx.font = `800 9px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#d9f5e3'
      ctx.fillText('HOLD SPACE', 0, 0)
      ctx.restore()
    }
  }

  /** A flipper: a tapered bar, white with a rubber edge. */
  private drawFlipper(ctx: CanvasRenderingContext2D, fl: Flipper) {
    const c = Math.cos(fl.angle)
    const s = Math.sin(fl.angle)
    const tx = fl.px + c * fl.len
    const ty = fl.py + s * fl.len
    // The outline: round at the pivot and at the tip, joined by straight sides.
    const a = Math.atan2(s, c)
    const k = Math.asin((fl.r1 - fl.r2) / fl.len)
    ctx.save()
    ctx.shadowColor = this.accent
    ctx.shadowBlur = fl.pressed ? 14 : 6
    ctx.beginPath()
    ctx.arc(fl.px, fl.py, fl.r1, a + Math.PI / 2 + k, a - Math.PI / 2 - k)
    ctx.arc(tx, ty, fl.r2, a - Math.PI / 2 - k, a + Math.PI / 2 + k)
    ctx.closePath()
    const body = ctx.createLinearGradient(fl.px, fl.py - fl.r1, fl.px, fl.py + fl.r1)
    body.addColorStop(0, '#ffffff')
    body.addColorStop(1, '#c9d3d9')
    ctx.fillStyle = body
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = shade(this.accent, -0.3)
    ctx.beginPath()
    ctx.arc(fl.px, fl.py, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawBall(ctx: CanvasRenderingContext2D, f: Frame) {
    const b = this.game.ball
    const x = lerp(b.px, b.x, f.alpha)
    const y = lerp(b.py, b.y, f.alpha)
    const speed = Math.hypot(b.vx, b.vy)
    if (speed > 700) {
      for (let i = 1; i < this.trail.length; i++) {
        const k = 1 - i / this.trail.length
        ctx.fillStyle = `rgba(210,235,225,${0.2 * k})`
        ctx.beginPath()
        ctx.arc(this.trail[i].x, this.trail[i].y, BALL_R * (0.55 + 0.45 * k), 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // A shadow, then chrome.
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.arc(x + 2, y + 3, BALL_R, 0, Math.PI * 2)
    ctx.fill()
    const chrome = ctx.createRadialGradient(x - 3, y - 3.5, 0.5, x, y, BALL_R)
    chrome.addColorStop(0, '#ffffff')
    chrome.addColorStop(0.35, '#dfe6ea')
    chrome.addColorStop(0.75, '#8d99a1')
    chrome.addColorStop(1, '#4b555c')
    ctx.fillStyle = chrome
    ctx.beginPath()
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2)
    ctx.fill()
    // The green of the table reflected along the bottom.
    ctx.strokeStyle = rgba(this.accent, 0.55)
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(x, y, BALL_R - 1.5, Math.PI * 0.2, Math.PI * 0.8)
    ctx.stroke()
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    const g = this.game
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (g.state === 'drain') {
      // The end-of-ball bonus, counted up.
      const { bonus, multiplier } = g.tally
      const a = Math.min(1, g.stateTime / 0.2)
      ctx.globalAlpha = a
      glowText(ctx, 'BONUS', CX, 440, '#ffd83a', 22, 900)
      glowText(ctx, `${fmt(bonus)} × ${multiplier}`, CX, 470, '#ffffff', 16, 800)
      glowText(ctx, fmt(this.tallyShown), CX, 498, this.accent, 20, 900)
      ctx.globalAlpha = 1
      return
    }
    const b = this.banner
    if (!b) return
    const a = Math.min(1, b.t / 0.15) * Math.min(1, (b.life - b.t) / 0.35)
    const pop = 1 + 0.25 * Math.max(0, 1 - b.t / 0.2)
    ctx.globalAlpha = Math.max(0, a)
    glowText(ctx, b.title, CX, 455, b.color, 24 * pop, 900)
    glowText(ctx, b.sub, CX, 482, '#d9f5e3', 12, 700)
    ctx.globalAlpha = 1
  }
}
