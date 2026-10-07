// Flappy Khervey's engine for the game shell: keys and clicks flap and
// shoot, plus the sounds, the effects (puffs, sparkles, feathers) and the
// drawing: a sky that goes from dawn to night, drifting clouds, pipes,
// flowers and stones on the grass, and the birds and bees. The rules are in
// flappyRules.ts.

import type { Frame, GameEngine, Phase } from './GameShell'
import { FONT, Floaters, Particles, shade } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import {
  BIRD_H, BIRD_W, BIRD_X, BULLET_H, BULLET_W, DIFFICULTIES, Flappy as Rules, GROUND_Y, H, PIPE_W, W,
  moonPosition, skyColor, sunPosition,
  type Bee, type Difficulty, type Enemy, type FlappyEvent, type Pipe,
} from './flappyRules'

export { W, H }

const FLAP_KEYS = ['ArrowUp', 'KeyW']
const FIRE_KEYS = ['Space', 'KeyX']
const STORE = 'kherveos.minigames.flappy.difficulty'

const YELLOW = '#ffd700'
const ORANGE = '#ff8c00'
const PIPE = '#228b22'
const PIPE_DARK = '#006400'
const PETALS = ['#ff69b4', '#ff0000', '#ffff00', '#8a2be2', '#ffa500']
const STONES = ['#808080', '#696969', '#a9a9a9']

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const rgb = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`

interface Cloud {
  x: number
  y: number
  size: number
  speed: number
}
interface Flower {
  x: number
  color: string
  size: number
}
interface Stone {
  x: number
  size: number
  color: string
  points: { x: number; y: number }[]
}

function readDifficulty(): Difficulty {
  try {
    const v = globalThis.localStorage?.getItem(STORE)
    return v === 'easy' || v === 'hard' || v === 'medium' ? v : 'medium'
  } catch {
    return 'medium'
  }
}

function makeStone(x: number): Stone {
  const size = Math.floor(rnd(15, 26))
  const points = []
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8
    const r = size / 2 + Math.floor(rnd(-3, 4))
    points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
  }
  return { x, size, color: STONES[Math.floor(Math.random() * STONES.length)], points }
}

export class FlappyEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...FLAP_KEYS, ...FIRE_KEYS])
  readonly game = new Rules(Math.random, readDifficulty())
  /** The shell's phase, as last drawn (the panel's difficulty buttons need it). */
  phase: Phase = 'ready'
  private particles = new Particles(500)
  private floaters = new Floaters()
  private fire = new Set<string>()
  private clouds: Cloud[] = []
  private flowers: Flower[] = []
  private stones: Stone[] = []
  private stars: { x: number; y: number; tw: number }[] = []
  private shake = 0
  private flash = 0

  constructor() {
    for (let i = 0; i < 5; i++) this.clouds.push({ x: rnd(0, W), y: rnd(50, 200), size: Math.floor(rnd(20, 41)), speed: rnd(0.2, 0.5) })
    for (let i = 0; i < 40; i++) this.stars.push({ x: rnd(0, W), y: rnd(0, GROUND_Y - 120), tw: rnd(0, 6.3) })
    this.scatterGround()
  }

  private scatterGround() {
    this.flowers = Array.from({ length: 10 }, () => ({
      x: rnd(0, W), color: PETALS[Math.floor(Math.random() * PETALS.length)], size: Math.floor(rnd(8, 13)),
    }))
    this.stones = Array.from({ length: 8 }, () => makeStone(rnd(0, W)))
  }

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    return `${DIFFICULTIES[this.game.difficulty].label} · Stage ${this.game.stage}`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.shake = this.flash = 0
    this.scatterGround()
  }

  setDifficulty(d: Difficulty) {
    this.game.setDifficulty(d)
    this.reset()
    try {
      globalThis.localStorage?.setItem(STORE, d)
    } catch {
      // Not remembered; still set for now.
    }
  }

  // ------------------------------------------------------------ controls

  keyDown(code: string) {
    if (FLAP_KEYS.includes(code)) this.game.flap()
    else if (FIRE_KEYS.includes(code)) this.fire.add(code)
    this.game.input.fire = this.fire.size > 0
  }

  keyUp(code: string) {
    this.fire.delete(code)
    this.game.input.fire = this.fire.size > 0
  }

  releaseAll() {
    this.fire.clear()
    this.game.input.fire = false
  }

  pointerDown() {
    this.game.flap()
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    const g = this.game
    g.update()
    for (const e of g.events) this.onEvent(e)
    g.events.length = 0

    if (g.state === 'play') {
      const speed = g.settings.pipeSpeed
      for (const c of this.clouds) {
        c.x -= c.speed
        if (c.x + c.size < 0) {
          c.x = W + rnd(50, 200)
          c.y = rnd(50, 200)
        }
      }
      for (const f of this.flowers) {
        f.x -= speed
        if (f.x < -20) f.x = W + rnd(0, 100)
      }
      for (let i = 0; i < this.stones.length; i++) {
        const s = this.stones[i]
        s.x -= speed
        if (s.x < -s.size) this.stones[i] = makeStone(W + rnd(0, 100))
      }
    }
    this.particles.update(dt)
    this.floaters.update(dt)
    this.shake = Math.max(0, this.shake - dt * 24)
    this.flash = Math.max(0, this.flash - dt * 2.5)
  }

  private onEvent(e: FlappyEvent) {
    const g = this.game
    switch (e.type) {
      case 'flap':
        for (let i = 0; i < 3; i++)
          this.particles.burst(BIRD_X + rnd(-5, 5), g.bird.y + rnd(-5, 5), ORANGE, {
            count: 1, speed: [60, 150], angle: Math.PI / 2 + 0.6, spread: 1.2, gravity: 120, life: [0.3, 0.5], size: [2, 4], square: false,
          })
        sfx('flap', () => {
          tone({ freq: 420, to: 640, dur: 0.07, type: 'triangle', vol: 0.07 })
          noise({ dur: 0.08, freq: 1800, vol: 0.04 })
        }, 0.05)
        break
      case 'shoot':
        sfx('shoot', () => tone({ freq: 1100, to: 500, dur: 0.07, type: 'square', vol: 0.05 }), 0.04)
        break
      case 'pipe':
        if (!e.stage) {
          this.particles.burst(BIRD_X, g.bird.y, '#ffff00', { count: 5, speed: [40, 120], gravity: 0, drag: 2, life: [0.3, 0.5], size: [2, 3], square: false })
          tone({ freq: 988, dur: 0.06, type: 'square', vol: 0.06 })
          tone({ freq: 1319, dur: 0.12, type: 'square', vol: 0.06, at: 0.06 })
        }
        break
      case 'stage':
        this.particles.burst(BIRD_X, g.bird.y, YELLOW, { count: 15, speed: [80, 220], gravity: 0, drag: 1.5, life: [0.5, 0.9], size: [2, 4], square: false })
        this.floaters.add(`STAGE ${e.stage}!`, W / 2, H * 0.36, YELLOW, { size: 26, life: 1.5, pop: true, vy: -14 })
        arpeggio([72, 76, 79, 84], 0.06, { dur: 0.12, type: 'square', vol: 0.07 })
        break
      case 'kill': {
        const color = e.what === 'bee' ? YELLOW : '#ff6400'
        this.particles.burst(e.x, e.y, color, { count: e.what === 'bee' ? 8 : 12, speed: [60, 190], gravity: 200, life: [0.3, 0.7], size: [2, 4], square: false })
        this.floaters.add(`+${e.points}`, e.x, e.y, '#ffffff', { size: 15, life: 0.8, vy: -36 })
        sfx('kill', () => noise({ dur: 0.14, freq: e.what === 'bee' ? 2400 : 1100, to: 300, vol: 0.12 }), 0.03)
        break
      }
      case 'crash':
        this.shake = 8
        this.flash = 1
        for (let i = 0; i < 10; i++)
          this.particles.burst(e.x, e.y, `rgb(255,${Math.floor(rnd(0, 101))},0)`, { count: 1, speed: [80, 240], gravity: 300, life: [0.4, 0.8], size: [2, 4], square: false })
        this.particles.burst(e.x, e.y, YELLOW, { count: 8, speed: [40, 120], gravity: 80, drag: 2, life: [0.8, 1.4], size: [2, 3] })
        noise({ dur: 0.25, freq: 400, to: 80, vol: 0.2, filter: 'lowpass' })
        tone({ freq: 300, to: 90, dur: 0.35, type: 'sawtooth', vol: 0.08 })
        break
      case 'gameover':
        this.shake = Math.max(this.shake, 4)
        tone({ freq: 392, dur: 0.16, type: 'triangle', vol: 0.1 })
        tone({ freq: 330, dur: 0.16, type: 'triangle', vol: 0.1, at: 0.16 })
        tone({ freq: 262, dur: 0.4, type: 'triangle', vol: 0.1, at: 0.32 })
        break
    }
  }

  // ------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    this.phase = f.phase
    const g = this.game
    const a = f.alpha
    ctx.save()
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake)
    this.drawSky(ctx, f)
    for (const c of this.clouds) this.drawCloud(ctx, c)
    for (const p of g.pipes) this.drawPipe(ctx, p, lerp(p.px, p.x, a))
    this.drawGround(ctx)
    this.particles.draw(ctx)
    for (const s of g.shots) {
      const x = lerp(s.px, s.x, a)
      ctx.fillStyle = '#ffff00'
      ctx.strokeStyle = '#ffc800'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.ellipse(x + BULLET_W / 2, s.y + BULLET_H / 2, BULLET_W / 2, BULLET_H / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    for (const e of g.enemies) this.drawEnemy(ctx, e, lerp(e.px, e.x, a), lerp(e.py, e.y, a))
    for (const b of g.bees) this.drawBee(ctx, b, lerp(b.px, b.x, a), lerp(b.py, b.y, a))
    this.drawBird(ctx, lerp(g.bird.py, g.bird.y, a))
    ctx.restore()
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.5 * this.flash})`
      ctx.fillRect(0, 0, W, H)
    }
    this.floaters.draw(ctx)
    // The score, big at the top, as in the original.
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `900 44px ${FONT}`
    ctx.lineJoin = 'round'
    ctx.lineWidth = 6
    ctx.strokeStyle = '#000000'
    ctx.strokeText(String(g.score), W / 2, 66)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(String(g.score), W / 2, 66)
  }

  private drawSky(ctx: CanvasRenderingContext2D, f: Frame) {
    const t = this.game.time
    const c = skyColor(t)
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y)
    sky.addColorStop(0, rgb(c))
    sky.addColorStop(1, rgb([c[0] + (255 - c[0]) * 0.3, c[1] + (255 - c[1]) * 0.3, c[2] + (255 - c[2]) * 0.1].map(Math.round) as [number, number, number]))
    ctx.fillStyle = sky
    ctx.fillRect(-10, -10, W + 20, GROUND_Y + 10)

    // Stars come out as the sky darkens.
    const dark = Math.max(0, Math.min(1, (135 - c[0]) / 110))
    if (dark > 0) {
      ctx.fillStyle = '#ffffff'
      for (const s of this.stars) {
        ctx.globalAlpha = dark * (0.5 + 0.5 * Math.sin(f.now / 700 + s.tw))
        ctx.fillRect(s.x, s.y, 1.5, 1.5)
      }
      ctx.globalAlpha = 1
    }

    const sun = sunPosition(t)
    if (sun) {
      const glow = ctx.createRadialGradient(sun.x, sun.y, 20, sun.x, sun.y, 70)
      glow.addColorStop(0, 'rgba(255,255,150,0.55)')
      glow.addColorStop(1, 'rgba(255,255,150,0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(sun.x, sun.y, 70, 0, Math.PI * 2)
      ctx.fill()
      for (const [r, col] of [[35, '#ffff96'], [30, '#ffff00'], [25, '#ffdc00']] as const) {
        ctx.fillStyle = col
        ctx.beginPath()
        ctx.arc(sun.x, sun.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const moon = moonPosition(t)
    if (moon) {
      ctx.save()
      ctx.shadowColor = '#f0f0ff'
      ctx.shadowBlur = 20
      ctx.fillStyle = '#f0f0ff'
      ctx.beginPath()
      ctx.arc(moon.x, moon.y, 25, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = '#dcdcf0'
      ctx.beginPath()
      ctx.arc(moon.x, moon.y, 23, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#c8c8dc'
      for (const [dx, dy, r] of [[-5, -3, 4], [7, 5, 3], [-2, 9, 2.5]]) {
        ctx.beginPath()
        ctx.arc(moon.x + dx, moon.y + dy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  private drawCloud(ctx: CanvasRenderingContext2D, c: Cloud) {
    const night = skyColor(this.game.time)[0] < 60
    ctx.fillStyle = night ? 'rgba(200,205,230,0.55)' : 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    for (const [dx, dy, r] of [[0, 0, c.size], [c.size / 2, 0, c.size / 2], [-c.size / 2, 0, c.size / 2], [0, -c.size / 3, c.size / 2]]) {
      ctx.moveTo(c.x + dx + r, c.y + dy)
      ctx.arc(c.x + dx, c.y + dy, r, 0, Math.PI * 2)
    }
    ctx.fill()
  }

  private drawPipe(ctx: CanvasRenderingContext2D, p: Pipe, x: number) {
    const body = ctx.createLinearGradient(x, 0, x + PIPE_W, 0)
    body.addColorStop(0, '#2fa52f')
    body.addColorStop(0.35, '#4cc24c')
    body.addColorStop(1, PIPE)
    const bottomY = p.gapY + p.gap
    ctx.fillStyle = body
    ctx.fillRect(x, 0, PIPE_W, p.gapY)
    ctx.fillRect(x, bottomY, PIPE_W, GROUND_Y - bottomY)
    ctx.strokeStyle = PIPE_DARK
    ctx.lineWidth = 3
    ctx.strokeRect(x + 1.5, -2, PIPE_W - 3, p.gapY + 0.5)
    ctx.strokeRect(x + 1.5, bottomY + 1.5, PIPE_W - 3, GROUND_Y - bottomY)
    // The dark lips at the gap.
    ctx.fillStyle = PIPE_DARK
    ctx.fillRect(x - 3, p.gapY - 20, PIPE_W + 6, 20)
    ctx.fillRect(x - 3, bottomY, PIPE_W + 6, 20)
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.fillRect(x, p.gapY - 18, PIPE_W, 3)
    ctx.fillRect(x, bottomY + 2, PIPE_W, 3)
    ctx.strokeStyle = '#32cd32'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x + 6, 0)
    ctx.lineTo(x + 6, p.gapY - 20)
    ctx.moveTo(x + 6, bottomY + 20)
    ctx.lineTo(x + 6, GROUND_Y)
    ctx.stroke()

    const stone = (cx: number, cy: number) => {
      const offsets = [3, -2, 2, -3, 1, -1]
      ctx.beginPath()
      offsets.forEach((o, i) => {
        const a = (Math.PI * 2 * i) / 6
        const r = 10 + o
        if (i) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      })
      ctx.closePath()
      ctx.fillStyle = '#808080'
      ctx.fill()
      ctx.strokeStyle = '#505050'
      ctx.lineWidth = 2
      ctx.stroke()
    }
    if (p.stoneTop) stone(x + PIPE_W / 2, p.gapY - 35)
    if (p.stoneBottom) stone(x + PIPE_W / 2, bottomY + 30)

    if (p.sign) {
      const cy = p.gapY + p.gap / 2
      ctx.fillStyle = PIPE_DARK
      ctx.beginPath()
      ctx.roundRect(x + PIPE_W / 2 - 20, cy - 11, 40, 22, 4)
      ctx.fill()
      ctx.font = `800 13px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ffffff'
      ctx.fillText('XPS', x + PIPE_W / 2, cy + 0.5)
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D) {
    const dirt = ctx.createLinearGradient(0, GROUND_Y + 20, 0, H)
    dirt.addColorStop(0, '#8b4513')
    dirt.addColorStop(1, shade('#8b4513', -0.3))
    ctx.fillStyle = dirt
    ctx.fillRect(-10, GROUND_Y + 20, W + 20, H - GROUND_Y - 10)
    ctx.fillStyle = '#228b22'
    ctx.fillRect(-10, GROUND_Y, W + 20, 20)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(-10, GROUND_Y, W + 20, 3)
    ctx.strokeStyle = '#008000'
    ctx.lineWidth = 2
    ctx.beginPath()
    const off = this.game.ground
    for (let i = -20; i < W + 20; i += 20) {
      const x = i + off
      ctx.moveTo(x, GROUND_Y)
      ctx.lineTo(x - 2, GROUND_Y - 5)
      ctx.moveTo(x + 5, GROUND_Y)
      ctx.lineTo(x + 3, GROUND_Y - 8)
      ctx.moveTo(x + 10, GROUND_Y)
      ctx.lineTo(x + 12, GROUND_Y - 6)
    }
    ctx.stroke()

    for (const fl of this.flowers) {
      ctx.strokeStyle = '#228b22'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(fl.x, GROUND_Y)
      ctx.lineTo(fl.x, GROUND_Y + 20)
      ctx.stroke()
      ctx.fillStyle = fl.color
      const r = fl.size / 2
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 * i) / 5
        ctx.beginPath()
        ctx.arc(fl.x + Math.cos(a) * r, GROUND_Y + Math.sin(a) * r, r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillStyle = YELLOW
      ctx.beginPath()
      ctx.arc(fl.x, GROUND_Y, fl.size / 3, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const s of this.stones) {
      ctx.beginPath()
      s.points.forEach((p, i) => (i ? ctx.lineTo(s.x + p.x, GROUND_Y + p.y) : ctx.moveTo(s.x + p.x, GROUND_Y + p.y)))
      ctx.closePath()
      ctx.fillStyle = s.color
      ctx.fill()
      ctx.strokeStyle = '#505050'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }

  /** Khervey: a round yellow bird, leaning with his speed. */
  private drawBird(ctx: CanvasRenderingContext2D, y: number) {
    const b = this.game.bird
    ctx.save()
    ctx.translate(BIRD_X + BIRD_W / 2, y + BIRD_H / 2)
    ctx.rotate((b.angle * Math.PI) / 180)
    ctx.translate(-BIRD_W / 2, -BIRD_H / 2)
    const body = ctx.createRadialGradient(BIRD_W * 0.4, BIRD_H * 0.3, 2, BIRD_W / 2, BIRD_H / 2, BIRD_W * 0.6)
    body.addColorStop(0, '#fff3a0')
    body.addColorStop(1, YELLOW)
    ctx.fillStyle = body
    ctx.strokeStyle = ORANGE
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(BIRD_W / 2, BIRD_H / 2, BIRD_W / 2 - 1.5, BIRD_H / 2 - 1.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    const wing = b.flap > 5 ? 5 : 0
    ctx.fillStyle = ORANGE
    ctx.beginPath()
    ctx.ellipse(8 + BIRD_W / 4, 8 - wing + BIRD_H / 4, BIRD_W / 4, BIRD_H / 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(BIRD_W - 10, BIRD_H / 2 - 3, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    if (this.game.state === 'play') {
      ctx.fillStyle = '#000000'
      ctx.arc(BIRD_W - 8, BIRD_H / 2 - 3, 3, 0, Math.PI * 2)
      ctx.fill()
    } else {
      // Knocked out: a cross for an eye.
      ctx.lineWidth = 1.6
      ctx.strokeStyle = '#000000'
      ctx.moveTo(BIRD_W - 13, BIRD_H / 2 - 6)
      ctx.lineTo(BIRD_W - 7, BIRD_H / 2)
      ctx.moveTo(BIRD_W - 7, BIRD_H / 2 - 6)
      ctx.lineTo(BIRD_W - 13, BIRD_H / 2)
      ctx.stroke()
    }
    ctx.fillStyle = ORANGE
    ctx.beginPath()
    ctx.moveTo(BIRD_W - 1, BIRD_H / 2 - 3)
    ctx.lineTo(BIRD_W + 9, BIRD_H / 2)
    ctx.lineTo(BIRD_W - 1, BIRD_H / 2 + 3)
    ctx.fill()
    ctx.restore()
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, x: number, y: number) {
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = e.color
    ctx.strokeStyle = shade(e.color, -0.45)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(BIRD_W / 2, BIRD_H / 2, BIRD_W / 2 - 1.5, BIRD_H / 2 - 1.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    const wing = e.wing > 10 ? 5 : 0
    ctx.fillStyle = shade(e.color, 0.25)
    ctx.beginPath()
    ctx.ellipse(8 + BIRD_W / 4 + 4, 8 - wing + BIRD_H / 4, BIRD_W / 4, BIRD_H / 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(10, BIRD_H / 2 - 3, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.arc(8, BIRD_H / 2 - 3, 3, 0, Math.PI * 2)
    ctx.fill()
    // An angry brow.
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(4, BIRD_H / 2 - 11)
    ctx.lineTo(15, BIRD_H / 2 - 7)
    ctx.stroke()
    ctx.fillStyle = shade(e.color, -0.45)
    ctx.beginPath()
    ctx.moveTo(1, BIRD_H / 2 - 3)
    ctx.lineTo(-9, BIRD_H / 2)
    ctx.lineTo(1, BIRD_H / 2 + 3)
    ctx.fill()
    ctx.restore()
  }

  private drawBee(ctx: CanvasRenderingContext2D, b: Bee, x: number, y: number) {
    ctx.save()
    ctx.translate(x, y)
    const wing = b.wing < 5 ? 3 : 0
    ctx.fillStyle = 'rgba(200,230,255,0.85)'
    ctx.beginPath()
    ctx.ellipse(7, 5 - wing, 4, 3, -0.3, 0, Math.PI * 2)
    ctx.ellipse(18, 5 - wing, 4, 3, 0.3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = YELLOW
    ctx.beginPath()
    ctx.ellipse(12.5, 11, 7.5, 6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const sx of [8, 13, 17]) {
      ctx.moveTo(sx, 6)
      ctx.lineTo(sx, 16)
    }
    ctx.stroke()
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.arc(5, 10, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(4, 9, 1.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#000000'
    ctx.beginPath()
    ctx.moveTo(20, 11)
    ctx.lineTo(24, 10)
    ctx.lineTo(24, 12)
    ctx.fill()
    ctx.restore()
  }
}
