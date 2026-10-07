// The Electron Game's engine for the game shell: clicks add electrons, keys
// move the camera, change the colours and take electrons away; plus the
// sounds and the drawing: glowing trails, a shaded nucleus, a grid that
// slides with the camera and the stability plot. The rules are in
// electronsRules.ts.

import type { Frame, GameEngine, Phase } from './GameShell'
import { FONT, Floaters, Particles, glowText, rgba } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import {
  ELECTRON_R, Electrons as Rules, H, NUCLEUS_R, STABLE, VERY_STABLE, W,
  type ElectronEvent, type Stability,
} from './electronsRules'

export { W, H }

const CAMERA_KEYS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
}
const REMOVE_KEYS = ['KeyX', 'Backspace', 'Delete']
const COLOUR_KEYS = ['KeyC']

/** The original's nucleus colours (grey, red, green, blue, yellow, purple, cyan, magenta): hue (degrees) and saturation (%), shaded from a bright middle to a dark edge. */
export const NUCLEI: [number, number][] = [[0, 0], [0, 100], [120, 100], [210, 100], [60, 100], [270, 100], [180, 100], [300, 100]]
/** And its trail colours. */
export const TAILS = ['#d2fac8', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff']
export const ELECTRON = '#c70c78'

export const STABILITY_COLORS: Record<Stability, string> = { 'Very Stable': '#46e05b', Stable: '#ffd83a', Unstable: '#ff4b5c' }

function hsv(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return `rgb(${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)})`
}

interface Banner {
  title: string
  sub: string
  color: string
  t: number
}

export class ElectronsEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...Object.keys(CAMERA_KEYS), ...REMOVE_KEYS, ...COLOUR_KEYS])
  readonly game = new Rules()
  accent = '#22b357'
  phase: Phase = 'ready'
  /** The canvas last drawn on (for the right-click handler in the window). */
  canvas: HTMLCanvasElement | null = null
  private particles = new Particles(300)
  private floaters = new Floaters()
  private held = new Map<string, 'left' | 'right' | 'up' | 'down'>()
  private banner: Banner | null = null
  private pulse = 0

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const g = this.game
    const why = g.state === 'decayed' ? 'Decayed' : 'Full time'
    return `${why} · up to ${g.mostElectrons} electrons`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.banner = null
    this.pulse = 0
  }

  // ------------------------------------------------------------ controls

  keyDown(code: string) {
    const g = this.game
    const dir = CAMERA_KEYS[code]
    if (dir) this.held.set(code, dir)
    else if (REMOVE_KEYS.includes(code)) this.removeElectron()
    else if (COLOUR_KEYS.includes(code)) {
      g.colour++
      tone({ freq: 660, to: 990, dur: 0.08, type: 'sine', vol: 0.06 })
    }
    this.syncKeys()
  }

  keyUp(code: string) {
    this.held.delete(code)
    this.syncKeys()
  }

  releaseAll() {
    this.held.clear()
    this.syncKeys()
  }

  private syncKeys() {
    const dirs = new Set(this.held.values())
    const i = this.game.input
    i.left = dirs.has('left')
    i.right = dirs.has('right')
    i.up = dirs.has('up')
    i.down = dirs.has('down')
  }

  pointerDown(x: number, y: number) {
    this.game.add(x, y)
  }

  removeElectron() {
    if (!this.game.remove()) sfx('nope', () => tone({ freq: 160, dur: 0.08, type: 'square', vol: 0.05 }), 0.15)
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    const g = this.game
    g.update(dt)
    for (const e of g.events) this.onEvent(e)
    g.events.length = 0
    this.particles.update(dt)
    this.floaters.update(dt)
    this.pulse += dt * (1 + g.decay * 5)
    if (this.banner) this.banner.t += dt
  }

  private onEvent(e: ElectronEvent) {
    const g = this.game
    const sx = (x: number) => x - g.view.x
    const sy = (y: number) => y - g.view.y
    switch (e.type) {
      case 'add':
        this.particles.burst(sx(e.x), sy(e.y), '#ff7ac0', { count: 12, speed: [30, 110], gravity: 0, drag: 3, life: [0.25, 0.5], size: [1.5, 3], square: false })
        this.floaters.add('e⁻', sx(e.x), sy(e.y) - 14, '#ff9bd0', { size: 13, life: 0.6, vy: -30 })
        tone({ freq: 520 + g.electrons.length * 30, to: 900 + g.electrons.length * 30, dur: 0.09, type: 'sine', vol: 0.08 })
        break
      case 'remove':
        this.particles.burst(sx(e.x), sy(e.y), '#ffffff', { count: 8, speed: [20, 80], gravity: 0, drag: 3, life: [0.2, 0.4], size: [1, 2], square: false })
        tone({ freq: 700, to: 300, dur: 0.1, type: 'sine', vol: 0.07 })
        break
      case 'full':
        sfx('full', () => tone({ freq: 160, dur: 0.1, type: 'square', vol: 0.05 }), 0.2)
        this.floaters.add('Atom is full', W / 2, H * 0.3, '#ffd83a', { size: 14, life: 0.9 })
        break
      case 'stable':
        sfx('stable', () => arpeggio([72, 79], 0.06, { dur: 0.1, type: 'triangle', vol: 0.06 }), 0.5)
        break
      case 'unstable':
        sfx('unstable', () => tone({ freq: 400, to: 250, dur: 0.15, type: 'triangle', vol: 0.06 }), 0.5)
        break
      case 'decay':
        this.banner = { title: 'ATOM DECAYED', sub: 'It flew apart', color: '#ff4b5c', t: 0 }
        noise({ dur: 0.8, freq: 900, to: 80, vol: 0.18, filter: 'lowpass' })
        tone({ freq: 300, to: 50, dur: 1, type: 'sawtooth', vol: 0.1 })
        break
      case 'timeup':
        this.banner = { title: 'TIME!', sub: 'Experiment complete', color: '#ffffff', t: 0 }
        arpeggio([60, 64, 67, 72], 0.08, { dur: 0.16, type: 'square', vol: 0.07 })
        break
    }
  }

  // ------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    this.phase = f.phase
    this.canvas = ctx.canvas
    const g = this.game
    const vx = g.view.x
    const vy = g.view.y

    // A dark lab bench and a grid that slides with the camera.
    const bg = ctx.createRadialGradient(W / 2, H / 2, 30, W / 2, H / 2, W * 0.75)
    bg.addColorStop(0, '#0c1f13')
    bg.addColorStop(1, '#030806')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = rgba(this.accent, 0.08)
    ctx.lineWidth = 1
    ctx.beginPath()
    const step = 40
    for (let x = -(((vx % step) + step) % step); x < W; x += step) {
      ctx.moveTo(x, 0)
      ctx.lineTo(x, H)
    }
    for (let y = -(((vy % step) + step) % step); y < H; y += step) {
      ctx.moveTo(0, y)
      ctx.lineTo(W, y)
    }
    ctx.stroke()

    // The nucleus.
    const [hue, sat] = NUCLEI[g.colour % NUCLEI.length]
    const nx = g.centre.x - vx
    const ny = g.centre.y - vy
    const glowCol = sat === 0 ? this.accent : hsv(hue, sat / 100, 0.9)
    const halo = ctx.createRadialGradient(nx, ny, NUCLEUS_R * 0.6, nx, ny, NUCLEUS_R * 2.2)
    halo.addColorStop(0, rgbaOf(glowCol, 0.25 + 0.1 * Math.sin(f.now / 400)))
    halo.addColorStop(1, rgbaOf(glowCol, 0))
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(nx, ny, NUCLEUS_R * 2.2, 0, Math.PI * 2)
    ctx.fill()
    const ball = ctx.createRadialGradient(nx - NUCLEUS_R * 0.25, ny - NUCLEUS_R * 0.3, 2, nx, ny, NUCLEUS_R)
    ball.addColorStop(0, hsv(hue, sat / 100, Math.max(0.35, 156 / 255) + (sat === 0 ? 0.1 : 0)))
    ball.addColorStop(1, hsv(hue, sat / 100, 20 / 255))
    ctx.fillStyle = ball
    ctx.beginPath()
    ctx.arc(nx, ny, NUCLEUS_R, 0, Math.PI * 2)
    ctx.fill()

    // The electrons and their trails.
    const tail = TAILS[g.colour % TAILS.length]
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const e of g.electrons) {
      const t = e.tail
      for (let i = 1; i < t.length; i++) {
        const k = i / (t.length - 1)
        ctx.strokeStyle = rgbaOf(tail, 0.05 + 0.55 * k * k)
        ctx.lineWidth = 1 + 4 * k
        ctx.beginPath()
        ctx.moveTo(t[i - 1].x - vx, t[i - 1].y - vy)
        ctx.lineTo(t[i].x - vx, t[i].y - vy)
        ctx.stroke()
      }
    }
    for (const e of g.electrons) {
      const x = e.x - vx
      const y = e.y - vy
      ctx.save()
      ctx.shadowColor = '#ff4fa8'
      ctx.shadowBlur = 10
      ctx.fillStyle = '#000000'
      ctx.beginPath()
      ctx.arc(x, y, ELECTRON_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      const shine = ctx.createRadialGradient(x - 2, y - 2, 0.5, x, y, ELECTRON_R - 1)
      shine.addColorStop(0, '#ff8fc8')
      shine.addColorStop(1, ELECTRON)
      ctx.fillStyle = shine
      ctx.beginPath()
      ctx.arc(x, y, ELECTRON_R - 1, 0, Math.PI * 2)
      ctx.fill()
    }

    this.particles.draw(ctx)
    this.drawReadout(ctx)
    this.drawPlot(ctx)

    // The decay meter shows as a red glow closing in.
    if (g.decay > 0.05) {
      const a = g.decay * (0.55 + 0.25 * Math.sin(this.pulse * 6))
      const v = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.72)
      v.addColorStop(0, 'rgba(255,75,92,0)')
      v.addColorStop(1, `rgba(255,75,92,${Math.max(0, a * 0.6)})`)
      ctx.fillStyle = v
      ctx.fillRect(0, 0, W, H)
    }
    this.floaters.draw(ctx)
    this.drawBanner(ctx)
  }

  /** The original's readout, top left. */
  private drawReadout(ctx: CanvasRenderingContext2D) {
    const g = this.game
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `800 13px ${FONT}`
    ctx.fillStyle = STABILITY_COLORS[g.stability]
    ctx.fillText(g.stability.toUpperCase(), 10, 10)
    ctx.font = `600 11px ${FONT}`
    ctx.fillStyle = 'rgba(220,240,228,0.75)'
    ctx.fillText(`${g.value.toFixed(2)} · ${g.electrons.length} electrons`, 10, 27)
    ctx.textAlign = 'right'
    const left = Math.ceil(g.timeLeft)
    ctx.font = `800 13px ${FONT}`
    ctx.fillStyle = left <= 10 && g.state === 'play' ? '#ff4b5c' : '#e8fff0'
    ctx.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, W - 10, 10)
  }

  /** Stability over the last few seconds, with the two thresholds. */
  private drawPlot(ctx: CanvasRenderingContext2D) {
    const hist = this.game.history
    const x0 = 10
    const w = W - 20
    const h = 46
    const y0 = H - 10 - h
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.roundRect(x0, y0, w, h, 6)
    ctx.fill()
    const top = Math.max(1.5, ...hist)
    const yOf = (v: number) => y0 + h - 3 - (Math.min(v, top) / top) * (h - 6)
    ctx.setLineDash([3, 3])
    ctx.lineWidth = 1
    for (const [v, c] of [[VERY_STABLE, '#46e05b'], [STABLE, '#ffd83a']] as const) {
      ctx.strokeStyle = rgbaOf(c, 0.55)
      ctx.beginPath()
      ctx.moveTo(x0 + 4, yOf(v))
      ctx.lineTo(x0 + w - 4, yOf(v))
      ctx.stroke()
    }
    ctx.setLineDash([])
    if (hist.length > 1) {
      const n = 240
      ctx.lineWidth = 1.6
      for (let i = 1; i < hist.length; i++) {
        const v = hist[i]
        ctx.strokeStyle = v <= VERY_STABLE ? '#46e05b' : v <= STABLE ? '#ffd83a' : '#ff4b5c'
        ctx.beginPath()
        ctx.moveTo(x0 + 4 + ((i - 1 + n - hist.length) / (n - 1)) * (w - 8), yOf(hist[i - 1]))
        ctx.lineTo(x0 + 4 + ((i + n - hist.length) / (n - 1)) * (w - 8), yOf(v))
        ctx.stroke()
      }
    }
    ctx.font = `600 9px ${FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = 'rgba(220,240,228,0.6)'
    ctx.fillText(`STABILITY  max ${top.toFixed(2)}`, x0 + 6, y0 + 4)
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    const b = this.banner
    if (!b) return
    const a = Math.min(1, b.t / 0.2)
    const pop = 1 + 0.25 * Math.max(0, 1 - b.t / 0.2)
    ctx.globalAlpha = a
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    glowText(ctx, b.title, W / 2, H * 0.4, b.color, 30 * pop, 900)
    glowText(ctx, b.sub, W / 2, H * 0.4 + 30, this.accent, 13, 700)
    ctx.globalAlpha = 1
  }
}

/** rgba() for a colour given as #rrggbb or rgb(r,g,b). */
function rgbaOf(color: string, alpha: number): string {
  if (color.startsWith('#')) return rgba(color, alpha)
  return color.replace('rgb(', 'rgba(').replace(')', `,${Math.max(0, Math.min(1, alpha))})`)
}
