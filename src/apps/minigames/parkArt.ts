// Wobbleland's still artwork, painted once into off-screen canvases (at the
// screen's pixel density) and copied every frame: the night amusement park
// behind the cabinet, the printed playfield with its unlit inserts, the
// guide rails, the coaster's wireform, and the backglass. What moves and
// lights up is drawn by parkEngine.ts.

import { FONT, drawMark } from './fx'
import {
  ARCH, CAROUSEL, CX, DUCK_X, DUCK_YS, GATE_Y, GUIDES, LANE_BOTTOM, LANE_GUIDES, LANE_TOP, LANE_X0, LANE_X1, POSTS, RAMP, SCOOP,
  SEPARATORS, SLINGS, STRIKER, TH, TIX_X, TIX_YS, TRACK, TW, LANE_X,
} from './parkRules'

export const C = {
  night: '#12082e',
  plum: '#2a0f4f',
  magenta: '#ff3d9a',
  pink: '#ff8cc6',
  gold: '#ffc93c',
  amber: '#ff9a1f',
  teal: '#2de1c2',
  sky: '#4cc9ff',
  red: '#e8283c',
  cream: '#fff1d6',
  green: '#3ddc84',
  violet: '#9b6bff',
  chrome: '#d9e2ec',
}

/** A canvas of `w` × `h` logical units at `scale` device pixels each, painted once. */
export function offscreen(w: number, h: number, scale: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)
  paint(ctx)
  return c
}

export function seeded(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

const TAU = Math.PI * 2

// ------------------------------------------------------------ the night park

/** Where the far-off bulb strings hang in the scene (the engine twinkles them). */
export interface SceneLights {
  bulbs: { x: number; y: number; c: string; phase: number }[]
}

export function sceneLights(W: number, H: number): SceneLights {
  const rnd = seeded(7)
  const bulbs: SceneLights['bulbs'] = []
  const colors = [C.gold, C.magenta, C.teal, C.cream, C.sky]
  // Strings of bulbs sagging between poles along the bottom of the scene.
  const strings = [
    [20, 780, 300, 820], [300, 820, 620, 790], [1300, 800, 1600, 830], [1600, 830, 1900, 790],
    [40, 900, 340, 940], [1320, 930, 1880, 900],
  ]
  for (const [x0, y0, x1, y1] of strings) {
    const n = 18
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const sag = Math.sin(t * Math.PI) * 34
      bulbs.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + sag, c: colors[i % colors.length], phase: rnd() * TAU })
    }
  }
  void W
  void H
  return { bulbs }
}

export function paintScene(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const rnd = seeded(11)
  // The sky: deep indigo at the top to a warm magenta glow over the park.
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#06031a')
  sky.addColorStop(0.45, '#1a0b3f')
  sky.addColorStop(0.72, '#47135e')
  sky.addColorStop(0.86, '#8a1f62')
  sky.addColorStop(1, '#1b0820')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  // The Milky Way: a faint diagonal band of dust.
  ctx.save()
  ctx.translate(W * 0.5, H * 0.3)
  ctx.rotate(-0.35)
  const band = ctx.createLinearGradient(0, -120, 0, 120)
  band.addColorStop(0, 'rgba(160,140,255,0)')
  band.addColorStop(0.5, 'rgba(170,150,255,0.08)')
  band.addColorStop(1, 'rgba(160,140,255,0)')
  ctx.fillStyle = band
  ctx.fillRect(-W, -120, W * 2, 240)
  ctx.restore()
  // Stars, a few of them bright with a cross of light.
  for (let i = 0; i < 700; i++) {
    const x = rnd() * W
    const y = Math.pow(rnd(), 1.5) * H * 0.7
    const r = rnd() < 0.04 ? 1.6 : 0.4 + rnd() * 0.8
    ctx.globalAlpha = 0.3 + rnd() * 0.7
    ctx.fillStyle = rnd() < 0.15 ? '#ffd9f0' : rnd() < 0.3 ? '#cfe6ff' : '#ffffff'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
    if (r > 1.5) {
      ctx.fillRect(x - 6, y - 0.3, 12, 0.6)
      ctx.fillRect(x - 0.3, y - 6, 0.6, 12)
    }
  }
  ctx.globalAlpha = 1
  // The moon, with its glow and seas.
  const mx = 1700
  const my = 120
  const halo = ctx.createRadialGradient(mx, my, 20, mx, my, 220)
  halo.addColorStop(0, 'rgba(255,240,220,0.35)')
  halo.addColorStop(1, 'rgba(255,240,220,0)')
  ctx.fillStyle = halo
  ctx.fillRect(mx - 220, my - 220, 440, 440)
  const moon = ctx.createRadialGradient(mx - 14, my - 14, 4, mx, my, 46)
  moon.addColorStop(0, '#fffaf0')
  moon.addColorStop(1, '#e9dcc4')
  ctx.fillStyle = moon
  ctx.beginPath()
  ctx.arc(mx, my, 44, 0, TAU)
  ctx.fill()
  ctx.fillStyle = 'rgba(160,140,120,0.25)'
  for (const [dx, dy, r] of [[-12, -8, 10], [14, 6, 7], [-4, 18, 8], [18, -16, 5], [-22, 10, 4]]) {
    ctx.beginPath()
    ctx.arc(mx + dx, my + dy, r, 0, TAU)
    ctx.fill()
  }

  // Far hills, then the park's silhouettes.
  ctx.fillStyle = '#240b38'
  ctx.beginPath()
  ctx.moveTo(0, 760)
  for (let x = 0; x <= W; x += 40) ctx.lineTo(x, 735 + Math.sin(x / 210) * 22 + Math.sin(x / 77) * 8)
  ctx.lineTo(W, H)
  ctx.lineTo(0, H)
  ctx.fill()

  const sil = '#16061f'
  ctx.fillStyle = sil
  ctx.strokeStyle = sil
  // A big Ferris wheel on the far left and one on the right.
  for (const [wx, wy, wr] of [[260, 600, 210], [1690, 640, 180]] as const) {
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(wx, wy, wr, 0, TAU)
    ctx.stroke()
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(wx, wy, wr * 0.82, 0, TAU)
    ctx.stroke()
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU
      ctx.beginPath()
      ctx.moveTo(wx, wy)
      ctx.lineTo(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr)
      ctx.stroke()
      ctx.beginPath()
      ctx.roundRect(wx + Math.cos(a) * wr - 9, wy + Math.sin(a) * wr + 2, 18, 16, 3)
      ctx.fill()
    }
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.moveTo(wx - wr * 0.6, H)
    ctx.lineTo(wx, wy)
    ctx.lineTo(wx + wr * 0.6, H)
    ctx.stroke()
  }
  // A roller coaster's hills and trestles in the middle distance.
  ctx.lineWidth = 4
  ctx.beginPath()
  const coaster = (x: number) => 840 - Math.max(0, Math.sin((x - 380) / 95)) * 150 - Math.max(0, Math.sin((x - 380) / 47)) * 30
  ctx.moveTo(380, coaster(380))
  for (let x = 380; x <= 640; x += 4) ctx.lineTo(x, coaster(x))
  ctx.stroke()
  ctx.lineWidth = 2
  for (let x = 384; x <= 640; x += 14) {
    ctx.beginPath()
    ctx.moveTo(x, coaster(x))
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  ctx.beginPath()
  for (let x = 1290; x <= 1520; x += 4) {
    const y = 850 - Math.abs(Math.sin((x - 1290) / 70)) * 120
    if (x === 1290) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.lineWidth = 4
  ctx.stroke()
  // A drop tower with its ring of seats.
  ctx.fillRect(1540, 420, 16, H - 420)
  ctx.fillRect(1530, 410, 36, 14)
  ctx.fillRect(1524, 640, 48, 22)
  // Circus tents: striped cones with pennants.
  const tent = (x: number, base: number, w: number, h: number) => {
    ctx.beginPath()
    ctx.moveTo(x - w / 2, base)
    ctx.quadraticCurveTo(x - w * 0.18, base - h * 0.55, x, base - h)
    ctx.quadraticCurveTo(x + w * 0.18, base - h * 0.55, x + w / 2, base)
    ctx.fill()
    ctx.fillRect(x - 1.5, base - h - 26, 3, 26)
    ctx.beginPath()
    ctx.moveTo(x + 1.5, base - h - 26)
    ctx.lineTo(x + 18, base - h - 20)
    ctx.lineTo(x + 1.5, base - h - 14)
    ctx.fill()
  }
  tent(120, 900, 230, 170)
  tent(470, 930, 200, 140)
  tent(1420, 920, 240, 175)
  tent(1810, 930, 210, 150)
  // Trees along the front.
  for (let x = -20; x < W + 40; x += 34 + rnd() * 40) {
    const h = 50 + rnd() * 60
    ctx.beginPath()
    ctx.ellipse(x, 990 - h / 2, 22 + rnd() * 14, h / 2, 0, 0, TAU)
    ctx.fill()
  }
  // Warm lit windows and stalls glowing in the dark.
  for (let i = 0; i < 60; i++) {
    const x = rnd() * W
    const y = 860 + rnd() * 120
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,190,90,0.55)' : 'rgba(255,120,190,0.45)'
    ctx.fillRect(x, y, 4 + rnd() * 8, 3 + rnd() * 5)
  }
  // The ground: a dark plaza fading to black.
  const ground = ctx.createLinearGradient(0, 960, 0, H)
  ground.addColorStop(0, 'rgba(10,3,16,0.2)')
  ground.addColorStop(1, '#05020a')
  ctx.fillStyle = ground
  ctx.fillRect(0, 960, W, H - 960)
  // Poles for the bulb strings.
  ctx.fillStyle = '#0c0412'
  for (const x of [20, 300, 620, 1300, 1600, 1900, 40, 340, 1320, 1880]) ctx.fillRect(x - 3, 770, 6, H - 770)
}

// ------------------------------------------------------------- the playfield

function rail(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, w = 6) {
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'
  ctx.lineWidth = w + 3
  ctx.beginPath()
  ctx.moveTo(ax + 3, ay + 4)
  ctx.lineTo(bx + 3, by + 4)
  ctx.stroke()
  const g = ctx.createLinearGradient(ax - w, ay - w, ax + w, ay + w)
  g.addColorStop(0, '#f6fbff')
  g.addColorStop(0.5, '#8b98a8')
  g.addColorStop(1, '#e5ecf3')
  ctx.strokeStyle = g
  ctx.lineWidth = w
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(ax - 1, ay - 1)
  ctx.lineTo(bx - 1, by - 1)
  ctx.stroke()
}

/** An unlit insert: coloured plastic set into the playfield, a darker version of its colour. */
export function insertShape(ctx: CanvasRenderingContext2D, kind: 'round' | 'arrow' | 'oval' | 'star', x: number, y: number, s: number, angle = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  if (kind === 'round') ctx.arc(0, 0, s, 0, TAU)
  else if (kind === 'oval') ctx.ellipse(0, 0, s * 1.5, s * 0.85, 0, 0, TAU)
  else if (kind === 'arrow') {
    ctx.moveTo(0, -s * 1.5)
    ctx.lineTo(s, -s * 0.2)
    ctx.lineTo(s * 0.45, -s * 0.2)
    ctx.lineTo(s * 0.45, s * 1.1)
    ctx.lineTo(-s * 0.45, s * 1.1)
    ctx.lineTo(-s * 0.45, -s * 0.2)
    ctx.lineTo(-s, -s * 0.2)
    ctx.closePath()
  } else {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? s * 0.45 : s
      const a = (i / 10) * TAU - Math.PI / 2
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    ctx.closePath()
  }
  ctx.restore()
}

/** The lamps printed in the playfield: where they are, their shape and colour (the engine lights them). */
export interface Lamp {
  id: string
  kind: 'round' | 'arrow' | 'oval' | 'star'
  x: number
  y: number
  s: number
  angle: number
  color: string
  label?: string
}

const RIDE_LAMP_X = (i: number) => 190 + i * 36

export const LAMPS: Lamp[] = [
  { id: 'coaster', kind: 'arrow', x: 62, y: 482, s: 11, angle: 0, color: C.magenta, label: 'LOOP' },
  { id: 'coaster0', kind: 'round', x: 112, y: 500, s: 5, angle: 0, color: C.magenta },
  { id: 'coaster1', kind: 'round', x: 112, y: 486, s: 5, angle: 0, color: C.magenta },
  { id: 'coaster2', kind: 'round', x: 112, y: 472, s: 5, angle: 0, color: C.magenta },
  { id: 'scoop', kind: 'arrow', x: 438, y: 398, s: 11, angle: 0.55, color: C.sky, label: 'LOCK' },
  { id: 'lock0', kind: 'round', x: 404, y: 404, s: 5, angle: 0, color: C.sky },
  { id: 'lock1', kind: 'round', x: 414, y: 390, s: 5, angle: 0, color: C.sky },
  { id: 'lock2', kind: 'round', x: 424, y: 376, s: 5, angle: 0, color: C.sky },
  { id: 'striker', kind: 'arrow', x: 290, y: 512, s: 11, angle: 0, color: C.gold, label: 'STRIKE' },
  { id: 'ducks', kind: 'arrow', x: 476, y: 478, s: 11, angle: Math.PI / 2, color: C.green },
  { id: 'tix', kind: 'arrow', x: 74, y: 548, s: 10, angle: -Math.PI / 2, color: C.amber },
  ...[0, 1, 2, 3, 4].map((i): Lamp => {
    const a = -Math.PI / 2 + ((i - 2) / 5) * Math.PI * 0.9
    return { id: `carousel${i}`, kind: 'round', x: CAROUSEL.x + Math.cos(a) * 66, y: CAROUSEL.y + Math.sin(a) * 66, s: 5, angle: 0, color: C.pink }
  }),
  ...['coaster', 'wheel', 'teacups', 'striker', 'gallery', 'carousel'].map((r, i): Lamp => ({
    id: `ride-${r}`, kind: 'star', x: RIDE_LAMP_X(i), y: 702, s: 12, angle: 0, color: C.gold,
  })),
  ...[2, 3, 4, 5, 6].map((m, i): Lamp => ({ id: `x${m}`, kind: 'oval', x: 208 + i * 36, y: 742, s: 9, angle: 0, color: C.teal, label: `${m}×` })),
  { id: 'again', kind: 'oval', x: CX, y: 846, s: 14, angle: 0, color: C.red, label: 'RIDE AGAIN' },
  { id: 'extra', kind: 'round', x: CX, y: 792, s: 9, angle: 0, color: C.amber, label: 'EB' },
  ...[0, 1, 2, 3].map((i): Lamp => ({ id: `lane${i}`, kind: 'round', x: (LANE_GUIDES[i] + LANE_GUIDES[i + 1]) / 2, y: 160, s: 7, angle: 0, color: C.gold })),
  { id: 'inlaneL', kind: 'arrow', x: 82, y: 800, s: 7, angle: 0, color: C.magenta },
  { id: 'inlaneR', kind: 'arrow', x: 2 * CX - 82, y: 800, s: 7, angle: 0, color: C.magenta },
]

export const LANE_LETTERS = ['P', 'A', 'R', 'K']

export function paintPlayfield(ctx: CanvasRenderingContext2D) {
  const rnd = seeded(5)
  // The wood under it all (seen in the shooter lane and at the edges).
  ctx.fillStyle = '#2a1408'
  ctx.fillRect(0, 0, TW, TH)

  // The playfield's shape: everything inside the walls and under the arch.
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(20, TH)
  ctx.lineTo(20, ARCH.y)
  ctx.arc(ARCH.x, ARCH.y, ARCH.r, Math.PI, 0)
  ctx.lineTo(LANE_X1, TH)
  ctx.closePath()
  ctx.clip()

  const base = ctx.createRadialGradient(CX, 420, 40, CX, 520, 640)
  base.addColorStop(0, '#3b1468')
  base.addColorStop(0.5, '#230c46')
  base.addColorStop(1, '#0d0520')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, TW, TH)

  // A sunburst behind the middle of the table.
  ctx.save()
  ctx.translate(CX, 470)
  for (let i = 0; i < 36; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,61,154,0.07)' : 'rgba(255,201,60,0.05)'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, 700, (i / 36) * TAU, ((i + 1) / 36) * TAU)
    ctx.fill()
  }
  ctx.restore()

  // The big top: red and cream stripes fanning out under the arch.
  ctx.save()
  ctx.beginPath()
  ctx.arc(ARCH.x, ARCH.y, ARCH.r, Math.PI, 0)
  ctx.lineTo(ARCH.x + ARCH.r, 150)
  ctx.lineTo(ARCH.x - ARCH.r, 150)
  ctx.clip()
  for (let i = 0; i < 22; i++) {
    const a0 = Math.PI + (i / 22) * Math.PI
    const a1 = Math.PI + ((i + 1) / 22) * Math.PI
    const g = ctx.createRadialGradient(ARCH.x, 330, 30, ARCH.x, 330, 330)
    g.addColorStop(0, i % 2 ? 'rgba(232,40,60,0.0)' : 'rgba(255,241,214,0.0)')
    g.addColorStop(1, i % 2 ? 'rgba(232,40,60,0.55)' : 'rgba(255,241,214,0.35)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(ARCH.x, 330)
    ctx.arc(ARCH.x, 330, 340, a0, a1)
    ctx.fill()
  }
  ctx.restore()
  // Bunting: a scalloped edge with little pennants along the bottom of the tent.
  ctx.fillStyle = 'rgba(255,201,60,0.6)'
  ctx.beginPath()
  for (let x = 60; x <= 530; x += 26) {
    ctx.moveTo(x, 150)
    ctx.arc(x + 13, 150, 13, Math.PI, 0, true)
  }
  ctx.fill()
  const flags = [C.red, C.gold, C.teal, C.magenta, C.sky, C.cream]
  for (let i = 0, x = 50; x < 540; x += 22, i++) {
    ctx.fillStyle = flags[i % flags.length]
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    ctx.moveTo(x, 168)
    ctx.lineTo(x + 18, 168)
    ctx.lineTo(x + 9, 184)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.strokeStyle = 'rgba(255,241,214,0.4)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(44, 168)
  ctx.lineTo(540, 168)
  ctx.stroke()

  // The midway: a cobbled path up from the flippers to the carousel.
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(CX - 120, TH)
  ctx.lineTo(CX - 46, 640)
  ctx.lineTo(CX + 46, 640)
  ctx.lineTo(CX + 120, TH)
  ctx.closePath()
  ctx.clip()
  ctx.fillStyle = 'rgba(70,40,90,0.55)'
  ctx.fillRect(0, 600, TW, TH)
  for (let y = 640; y < TH; y += 11) {
    const off = ((y / 11) % 2) * 9
    for (let x = CX - 140 + off; x < CX + 140; x += 18) {
      ctx.fillStyle = `rgba(${150 + rnd() * 50},${110 + rnd() * 40},${170 + rnd() * 40},${0.16 + rnd() * 0.1})`
      ctx.beginPath()
      ctx.ellipse(x, y, 7.5, 4.2, 0, 0, TAU)
      ctx.fill()
    }
  }
  ctx.restore()

  // Little things printed around the park: balloons, popcorn, candy floss, tickets.
  balloons(ctx, 150, 600, [C.red, C.gold, C.sky])
  balloons(ctx, 410, 610, [C.magenta, C.teal, C.violet])
  popcorn(ctx, 112, 660)
  candyFloss(ctx, 448, 664)
  ticketStrip(ctx, 34, 640, -0.25)
  ticketStrip(ctx, 476, 812, 0.4)

  // The carousel's platform: a painted ring of gold and red.
  const ring = ctx.createRadialGradient(CAROUSEL.x, CAROUSEL.y, CAROUSEL.r - 6, CAROUSEL.x, CAROUSEL.y, CAROUSEL.r + 24)
  ring.addColorStop(0, 'rgba(255,201,60,0.5)')
  ring.addColorStop(1, 'rgba(255,201,60,0)')
  ctx.fillStyle = ring
  ctx.beginPath()
  ctx.arc(CAROUSEL.x, CAROUSEL.y, CAROUSEL.r + 24, 0, TAU)
  ctx.fill()

  // The High Striker's tower base and its scale.
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.fillRect(STRIKER.x0 + 14, STRIKER.top, STRIKER.x1 - STRIKER.x0 - 28, STRIKER.y - STRIKER.top)
  const scale = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  ctx.font = `800 7px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  scale.forEach((s, i) => {
    const y = STRIKER.y - 18 - (i / (scale.length - 1)) * (STRIKER.y - STRIKER.top - 40)
    ctx.fillStyle = `hsla(${120 - i * 14},90%,60%,0.75)`
    ctx.fillRect(STRIKER.x1 - 13, y - 1, 6, 2)
    ctx.fillText(s, STRIKER.x1 - 6, y)
  })

  // The shooting gallery's booth behind the ducks: an awning and a back wall.
  ctx.fillStyle = 'rgba(30,90,60,0.55)'
  ctx.fillRect(DUCK_X + 4, DUCK_YS[0] - 6, LANE_X0 - DUCK_X - 4, DUCK_YS[3] + 40 - DUCK_YS[0])
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? C.cream : C.green
    ctx.globalAlpha = 0.6
    ctx.fillRect(DUCK_X - 34 + i * 9, DUCK_YS[0] - 30, 9, 12)
  }
  ctx.globalAlpha = 1
  // The ticket booth behind T·I·X.
  ctx.fillStyle = 'rgba(255,154,31,0.22)'
  ctx.fillRect(20, TIX_YS[0] - 6, TIX_X - 18, TIX_YS[2] + 30 - TIX_YS[0])

  // The scoop's boarding platform under the wheel.
  ctx.fillStyle = 'rgba(76,201,255,0.18)'
  ctx.beginPath()
  ctx.roundRect(SCOOP.x - 34, SCOOP.y - 22, 68, 44, 10)
  ctx.fill()
  ctx.strokeStyle = 'rgba(76,201,255,0.45)'
  ctx.setLineDash([4, 3])
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.setLineDash([])

  // The coaster's mouth: chevrons painted on the floor.
  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = `rgba(255,61,154,${0.25 + i * 0.12})`
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(32, RAMP.y + 70 - i * 14)
    ctx.lineTo(60, RAMP.y + 56 - i * 14)
    ctx.lineTo(88, RAMP.y + 70 - i * 14)
    ctx.stroke()
  }

  // The name over the flippers, and the motto.
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `900 30px ${FONT}`
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'
  ctx.strokeText('WOBBLELAND', CX, 768)
  const name = ctx.createLinearGradient(0, 752, 0, 784)
  name.addColorStop(0, '#fff3b0')
  name.addColorStop(0.5, C.gold)
  name.addColorStop(1, '#d9741a')
  ctx.fillStyle = name
  ctx.globalAlpha = 0.18
  ctx.fillText('WOBBLELAND', CX, 768)
  ctx.globalAlpha = 1
  ctx.font = `700 9px ${FONT}`
  ctx.fillStyle = 'rgba(255,241,214,0.5)'
  ctx.fillText('FREE RIDES FOR EVERYONE', CX, 818)
  ctx.restore()
  drawMark(ctx, CX, 892, 46, 'rgba(255,201,60,0.2)', 15)

  // The unlit inserts, each with a dark rim.
  for (const l of LAMPS) {
    insertShape(ctx, l.kind, l.x, l.y, l.s + 2, l.angle)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fill()
    insertShape(ctx, l.kind, l.x, l.y, l.s, l.angle)
    const g = ctx.createRadialGradient(l.x - l.s * 0.3, l.y - l.s * 0.3, 1, l.x, l.y, l.s * 1.6)
    g.addColorStop(0, mix(l.color, 0.42))
    g.addColorStop(1, mix(l.color, 0.18))
    ctx.fillStyle = g
    ctx.fill()
    if (l.label) {
      ctx.font = `800 ${l.kind === 'oval' && l.label.length > 3 ? 5.5 : 7}px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      const ly = l.kind === 'arrow' ? l.y + l.s * 2.2 : l.y
      if (l.kind === 'arrow') {
        ctx.save()
        ctx.translate(l.x, l.y)
        ctx.rotate(l.angle)
        ctx.fillText(l.label, 0, l.s * 2.1)
        ctx.restore()
      } else ctx.fillText(l.label, l.x, ly)
    }
  }
  // Ride names under the stars.
  ctx.font = `800 5.5px ${FONT}`
  ctx.fillStyle = 'rgba(255,241,214,0.45)'
  ctx.textAlign = 'center'
  ;['COASTER', 'WHEEL', 'TEACUPS', 'STRIKER', 'GALLERY', 'CAROUSEL'].forEach((n, i) => ctx.fillText(n, RIDE_LAMP_X(i), 719))
  // PARK letters over the top lanes.
  ctx.font = `900 16px ${FONT}`
  LANE_LETTERS.forEach((l, i) => {
    ctx.fillStyle = 'rgba(255,201,60,0.3)'
    ctx.fillText(l, (LANE_GUIDES[i] + LANE_GUIDES[i + 1]) / 2, 108)
  })

  ctx.restore() // the playfield's clip

  // The shooter lane: a darker channel with a gold stripe.
  ctx.fillStyle = '#140a1f'
  ctx.fillRect(LANE_X0, GATE_Y - 30, LANE_X1 - LANE_X0, TH - GATE_Y + 30)
  const lane = ctx.createLinearGradient(LANE_X0, 0, LANE_X1, 0)
  lane.addColorStop(0, 'rgba(0,0,0,0.5)')
  lane.addColorStop(0.5, 'rgba(255,201,60,0.08)')
  lane.addColorStop(1, 'rgba(0,0,0,0.5)')
  ctx.fillStyle = lane
  ctx.fillRect(LANE_X0, GATE_Y, LANE_X1 - LANE_X0, TH - GATE_Y)
  ctx.font = `900 11px ${FONT}`
  ctx.save()
  ctx.translate(LANE_X, 640)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,201,60,0.3)'
  ctx.fillText('★ RIDE ON ★', 0, 4)
  ctx.restore()

  // The walls: the arch's rail, the outer walls, guides and separators.
  ctx.strokeStyle = '#8b98a8'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(ARCH.x, ARCH.y, ARCH.r + 2, Math.PI, 0)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(ARCH.x, ARCH.y, ARCH.r - 0.5, Math.PI, 0)
  ctx.stroke()
  rail(ctx, 20, ARCH.y, 20, TH, 6)
  rail(ctx, LANE_X1, ARCH.y, LANE_X1, TH, 6)
  rail(ctx, LANE_X0, GATE_Y, LANE_X0, TH, 6)
  for (const x of LANE_GUIDES) rail(ctx, x, LANE_TOP, x, LANE_BOTTOM, 6)
  rail(ctx, 20, RAMP.lip - 12, RAMP.x1, RAMP.lip + 6, 6)
  rail(ctx, RAMP.x1, RAMP.lip + 6, RAMP.x1 + 4, RAMP.y + 44, 6)
  rail(ctx, LANE_X0, DUCK_YS[0] - 26, DUCK_X, DUCK_YS[0] - 4, 6)
  rail(ctx, DUCK_X, DUCK_YS[3] + 30, LANE_X0, DUCK_YS[3] + 54, 6)
  rail(ctx, 20, TIX_YS[0] - 22, TIX_X, TIX_YS[0] - 6, 6)
  rail(ctx, TIX_X, TIX_YS[2] + 30, 20, TIX_YS[2] + 46, 6)
  rail(ctx, SCOOP.x + 22, SCOOP.y - 26, SCOOP.x + 24, SCOOP.y + 10, 6)
  for (const [i, g] of GUIDES.entries()) {
    rail(ctx, SEPARATORS[i], 700, g.a[0], g.a[1], 5)
    rail(ctx, g.a[0], g.a[1], g.b[0], g.b[1], 5)
  }
  // Posts: red rubber rings on chrome.
  for (const p of POSTS) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.arc(p.x + 2, p.y + 3, p.r + 3, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#c4122f'
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r + 2.5, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#eef3f8'
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r - 1, 0, TAU)
    ctx.fill()
  }
  // The scoop: a dark hole with a chrome rim.
  const hole = ctx.createRadialGradient(SCOOP.x, SCOOP.y, 2, SCOOP.x, SCOOP.y, SCOOP.r + 2)
  hole.addColorStop(0, '#000')
  hole.addColorStop(0.75, '#140820')
  hole.addColorStop(1, '#9aa7b6')
  ctx.fillStyle = hole
  ctx.beginPath()
  ctx.arc(SCOOP.x, SCOOP.y, SCOOP.r + 2, 0, TAU)
  ctx.fill()

  // The slingshots' plastic, under their rubbers (the engine draws the rubbers and flashes).
  for (const s of SLINGS) {
    ctx.fillStyle = 'rgba(255,241,214,0.18)'
    ctx.beginPath()
    ctx.moveTo(s.a[0], s.a[1])
    ctx.lineTo(s.b[0], s.b[1])
    ctx.lineTo(s.c[0], s.c[1])
    ctx.closePath()
    ctx.fill()
  }
}

/** A colour mixed towards black (amount 0..1 of the colour kept). */
export function mix(hex: string, keep: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * keep)
  const g = Math.round(((n >> 8) & 255) * keep)
  const b = Math.round((n & 255) * keep)
  return `rgb(${r},${g},${b})`
}

function balloons(ctx: CanvasRenderingContext2D, x: number, y: number, colors: string[]) {
  ctx.save()
  ctx.globalAlpha = 0.5
  colors.forEach((c, i) => {
    const bx = x + (i - 1) * 13
    const by = y - 26 - (i % 2) * 8
    ctx.strokeStyle = 'rgba(255,241,214,0.6)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.moveTo(bx, by + 10)
    ctx.quadraticCurveTo(bx + 3, by + 24, x, y)
    ctx.stroke()
    const g = ctx.createRadialGradient(bx - 3, by - 4, 1, bx, by, 11)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.3, c)
    g.addColorStop(1, mix(c, 0.5))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(bx, by, 8, 10, 0, 0, TAU)
    ctx.fill()
  })
  ctx.restore()
}

function popcorn(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.globalAlpha = 0.55
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = '#fff6dc'
    ctx.beginPath()
    ctx.arc(x - 8 + (i % 3) * 8 + (i > 5 ? 2 : 0), y - 14 - Math.floor(i / 3) * 4, 4.5, 0, TAU)
    ctx.fill()
  }
  ctx.beginPath()
  ctx.moveTo(x - 13, y - 12)
  ctx.lineTo(x + 13, y - 12)
  ctx.lineTo(x + 9, y + 12)
  ctx.lineTo(x - 9, y + 12)
  ctx.closePath()
  ctx.fillStyle = C.cream
  ctx.fill()
  ctx.save()
  ctx.clip()
  ctx.fillStyle = C.red
  for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * 6 - 1.6, y - 12, 3.2, 24)
  ctx.restore()
  ctx.restore()
}

function candyFloss(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.globalAlpha = 0.55
  ctx.strokeStyle = '#e9d8b0'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x, y - 18)
  ctx.stroke()
  for (const [dx, dy, r] of [[0, -28, 11], [-8, -22, 8], [8, -22, 8], [0, -36, 7]]) {
    const g = ctx.createRadialGradient(x + dx - 2, y + dy - 2, 1, x + dx, y + dy, r)
    g.addColorStop(0, '#ffe3f2')
    g.addColorStop(1, C.pink)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x + dx, y + dy, r, 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}

function ticketStrip(ctx: CanvasRenderingContext2D, x: number, y: number, a: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(a)
  ctx.globalAlpha = 0.5
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = C.amber
    ctx.fillRect(i * 22, 0, 20, 11)
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.font = `800 5px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('ADMIT', i * 22 + 10, 5.5)
  }
  ctx.restore()
}

// --------------------------------------------------------- the coaster's track

/** The wireform ramp: two chrome rails with ties, on posts, and its sign. Drawn over the balls on the playfield. */
export function paintCoaster(ctx: CanvasRenderingContext2D) {
  const pts = TRACK
  const normalAt = (i: number) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(pts.length - 1, i + 1)]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]
  }
  const railPath = (off: number, dx = 0, dy = 0) => {
    ctx.beginPath()
    pts.forEach((p, i) => {
      const [nx, ny] = normalAt(i)
      const x = p[0] + nx * off + dx
      const y = p[1] + ny * off + dy
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  // Its shadow on the playfield, well below (it is up in the air).
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 22
  railPath(0, 10, 14)
  ctx.stroke()
  // Support posts every so often.
  for (let i = 8; i < pts.length - 8; i += 14) {
    const [x, y] = pts[i]
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.arc(x + 8, y + 12, 4, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = '#7d8896'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x + 8, y + 12)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  // Ties across the rails.
  ctx.strokeStyle = '#b58a4a'
  ctx.lineWidth = 2.2
  for (let i = 0; i < pts.length; i += 3) {
    const [nx, ny] = normalAt(i)
    const [x, y] = pts[i]
    ctx.beginPath()
    ctx.moveTo(x - nx * 12, y - ny * 12)
    ctx.lineTo(x + nx * 12, y + ny * 12)
    ctx.stroke()
  }
  // The two rails: chrome tubes with a highlight.
  for (const off of [-11, 11]) {
    ctx.strokeStyle = '#5b6573'
    ctx.lineWidth = 4.5
    railPath(off)
    ctx.stroke()
    ctx.strokeStyle = '#e8eef5'
    ctx.lineWidth = 2.4
    railPath(off)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = 0.8
    railPath(off, -0.6, -0.6)
    ctx.stroke()
  }
  // A red safety rail on the outside of the loop.
  ctx.strokeStyle = 'rgba(232,40,60,0.85)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(112, 300, 70, 0, TAU)
  ctx.stroke()
  // The sign over the mouth.
  ctx.save()
  ctx.translate(60, RAMP.y + 4)
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.beginPath()
  ctx.roundRect(-36, -9, 76, 20, 5)
  ctx.fill()
  const sign = ctx.createLinearGradient(0, -10, 0, 10)
  sign.addColorStop(0, '#ff6fb3')
  sign.addColorStop(1, '#b3155f')
  ctx.fillStyle = sign
  ctx.beginPath()
  ctx.roundRect(-38, -11, 76, 20, 5)
  ctx.fill()
  ctx.strokeStyle = C.gold
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.font = `900 9px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('THE LOOP', 0, -1)
  ctx.restore()
}

// --------------------------------------------------------------- the backglass

/** The backglass's painting (without its lights): a park at dusk under the marquee. */
export function paintBackglass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rnd = seeded(3)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(0, 0, w, h, 18)
  ctx.clip()
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#0b0630')
  sky.addColorStop(0.5, '#5a1670')
  sky.addColorStop(0.8, '#ff6f61')
  sky.addColorStop(1, '#ffc46b')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  // Sun going down behind the park, with the Ꝃ in it.
  const sx = w * 0.5
  const sy = h * 0.74
  const sun = ctx.createRadialGradient(sx, sy, 10, sx, sy, 150)
  sun.addColorStop(0, 'rgba(255,240,180,1)')
  sun.addColorStop(0.35, 'rgba(255,200,90,0.85)')
  sun.addColorStop(1, 'rgba(255,120,90,0)')
  ctx.fillStyle = sun
  ctx.fillRect(sx - 150, sy - 150, 300, 300)
  drawMark(ctx, sx, sy, 92, 'rgba(120,30,60,0.55)', 16)
  for (let i = 0; i < 120; i++) {
    ctx.globalAlpha = 0.3 + rnd() * 0.6
    ctx.fillStyle = '#fff'
    ctx.fillRect(rnd() * w, rnd() * h * 0.4, 1.2, 1.2)
  }
  ctx.globalAlpha = 1
  // The Ferris wheel on the left, a tent on the right, a coaster across.
  const dark = '#2a0b34'
  ctx.strokeStyle = dark
  ctx.fillStyle = dark
  const wx = w * 0.22
  const wy = h * 0.62
  const wr = h * 0.3
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(wx, wy, wr, 0, TAU)
  ctx.stroke()
  ctx.lineWidth = 1.5
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    ctx.beginPath()
    ctx.moveTo(wx, wy)
    ctx.lineTo(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr)
    ctx.stroke()
    const colors = [C.magenta, C.gold, C.teal, C.sky]
    ctx.fillStyle = colors[i % 4]
    ctx.beginPath()
    ctx.roundRect(wx + Math.cos(a) * wr - 8, wy + Math.sin(a) * wr + 1, 16, 13, 3)
    ctx.fill()
  }
  ctx.fillStyle = dark
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(wx - wr * 0.6, h)
  ctx.lineTo(wx, wy)
  ctx.lineTo(wx + wr * 0.6, h)
  ctx.stroke()
  // The big top.
  const tx = w * 0.78
  const tb = h
  const tw = w * 0.36
  const th = h * 0.42
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(tx - tw / 2, tb)
  ctx.quadraticCurveTo(tx - tw * 0.2, tb - th * 0.5, tx, tb - th)
  ctx.quadraticCurveTo(tx + tw * 0.2, tb - th * 0.5, tx + tw / 2, tb)
  ctx.closePath()
  ctx.clip()
  for (let i = -6; i < 6; i++) {
    ctx.fillStyle = i % 2 ? C.red : C.cream
    ctx.beginPath()
    ctx.moveTo(tx, tb - th)
    ctx.lineTo(tx + i * 28, tb)
    ctx.lineTo(tx + (i + 1) * 28, tb)
    ctx.fill()
  }
  ctx.restore()
  ctx.fillStyle = C.gold
  ctx.fillRect(tx - 1.5, tb - th - 30, 3, 30)
  ctx.beginPath()
  ctx.moveTo(tx + 1.5, tb - th - 30)
  ctx.lineTo(tx + 24, tb - th - 22)
  ctx.lineTo(tx + 1.5, tb - th - 14)
  ctx.fill()
  // A coaster track sweeping across the front.
  ctx.strokeStyle = '#1d0726'
  ctx.lineWidth = 5
  ctx.beginPath()
  for (let x = 0; x <= w; x += 4) {
    const y = h * 0.9 - Math.max(0, Math.sin(x / 70)) * h * 0.18
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.lineWidth = 2
  for (let x = 6; x <= w; x += 16) {
    const y = h * 0.9 - Math.max(0, Math.sin(x / 70)) * h * 0.18
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  ctx.restore()
}
