// Drawing helpers the mini-games share: colours, sparks and floating text,
// glowing labels and the KherveOS mark. Everything draws in the game's
// logical units (the canvas is already scaled for the screen).

export const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
export const MONO = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace'

/** A score with thousands separators. */
export const fmt = (n: number) => Math.floor(n).toLocaleString()

// ------------------------------------------------------------------ colours

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')

/** Mixes `hex` towards white (amount > 0) or black (amount < 0), -1..1. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parse(hex)
  const t = amount < 0 ? 0 : 255
  const a = Math.abs(amount)
  return `#${hex2(r + (t - r) * a)}${hex2(g + (t - g) * a)}${hex2(b + (t - b) * a)}`
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parse(hex)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`
}

/** A theme colour (e.g. --k-accent) as #rrggbb, for drawing on a canvas. */
export function themeColor(el: Element | null, name: string, fallback: string): string {
  if (!el) return fallback
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : fallback
}

// ---------------------------------------------------------------- particles

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
  gravity: number
  drag: number
  square: boolean
}

export interface BurstOptions {
  count?: number
  /** Speed range, logical units per second. */
  speed?: [number, number]
  /** Direction (radians) and spread around it; a full circle by default. */
  angle?: number
  spread?: number
  gravity?: number
  drag?: number
  size?: [number, number]
  life?: [number, number]
  square?: boolean
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Sparks and shards: short-lived bits that fly, fall and fade. */
export class Particles {
  private list: Particle[] = []
  private readonly cap: number

  constructor(cap = 500) {
    this.cap = cap
  }

  burst(x: number, y: number, color: string, o: BurstOptions = {}) {
    const n = o.count ?? 12
    for (let i = 0; i < n; i++) {
      if (this.list.length >= this.cap) this.list.shift()
      const a = (o.angle ?? 0) + (o.spread === undefined ? Math.random() * Math.PI * 2 : (Math.random() - 0.5) * o.spread)
      const s = rand(...(o.speed ?? [40, 160]))
      const life = rand(...(o.life ?? [0.35, 0.8]))
      this.list.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life, max: life,
        size: rand(...(o.size ?? [1.5, 3])),
        color,
        gravity: o.gravity ?? 300,
        drag: o.drag ?? 1.5,
        square: o.square ?? true,
      })
    }
  }

  update(dt: number) {
    let w = 0
    for (const p of this.list) {
      p.life -= dt
      if (p.life <= 0) continue
      const k = Math.max(0, 1 - p.drag * dt)
      p.vx *= k
      p.vy = p.vy * k + p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      this.list[w++] = p
    }
    this.list.length = w
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.list) {
      const t = p.life / p.max
      ctx.globalAlpha = Math.min(1, t * 1.6)
      ctx.fillStyle = p.color
      const s = p.size * (0.5 + 0.5 * t)
      if (p.square) ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s)
      else {
        ctx.beginPath()
        ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }

  clear() {
    this.list.length = 0
  }

  get size() {
    return this.list.length
  }
}

// ------------------------------------------------------------ floating text

interface Floater {
  text: string
  x: number
  y: number
  vy: number
  life: number
  max: number
  color: string
  size: number
  pop: boolean
}

/** Text that pops up and drifts away: points, "TETRIS!", "BALL SAVED"… */
export class Floaters {
  private list: Floater[] = []

  add(text: string, x: number, y: number, color: string, o: { size?: number; life?: number; vy?: number; pop?: boolean } = {}) {
    const life = o.life ?? 0.9
    this.list.push({ text, x, y, vy: o.vy ?? -30, life, max: life, color, size: o.size ?? 12, pop: o.pop ?? false })
    if (this.list.length > 24) this.list.shift()
  }

  update(dt: number) {
    let w = 0
    for (const f of this.list) {
      f.life -= dt
      if (f.life <= 0) continue
      f.y += f.vy * dt
      this.list[w++] = f
    }
    this.list.length = w
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const f of this.list) {
      const age = f.max - f.life
      const fadeIn = Math.min(1, age / 0.08)
      const fadeOut = Math.min(1, f.life / 0.3)
      // "Pop" text overshoots a little as it appears.
      const scale = f.pop ? 1 + 0.35 * Math.max(0, 1 - age / 0.18) * Math.sin(Math.min(1, age / 0.18) * Math.PI) : 1
      ctx.globalAlpha = fadeIn * fadeOut
      glowText(ctx, f.text, f.x, f.y, f.color, f.size * scale)
    }
    ctx.globalAlpha = 1
  }

  clear() {
    this.list.length = 0
  }
}

// ------------------------------------------------------------------ drawing

/** Bold text with a soft glow of its own colour and a dark edge for contrast. */
export function glowText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size: number, weight = 800) {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(2, size * 0.16)
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'
  ctx.strokeText(text, x, y)
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = size * 0.6
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.restore()
}

/**
 * The KherveOS mark (src/shell/KLogo.tsx): the barred K in a ring. Drawn as
 * strokes centred on (x, y), `size` across.
 */
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, width = 17) {
  const k = size / 200
  ctx.save()
  ctx.translate(x - 100 * k, y - 100 * k)
  ctx.scale(k, k)
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'butt'
  ctx.beginPath()
  ctx.arc(100, 100, 78, 0, Math.PI * 2)
  ctx.moveTo(76, 42)
  ctx.lineTo(76, 158)
  ctx.moveTo(30, 170)
  ctx.lineTo(170, 30)
  ctx.moveTo(84, 116)
  ctx.lineTo(144, 168)
  ctx.stroke()
  ctx.restore()
}

/** Small easing helpers. */
export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3),
  outBack: (t: number) => {
    const c = 1.70158
    const x = Math.min(1, Math.max(0, t)) - 1
    return 1 + (c + 1) * x * x * x + c * x * x
  },
}
