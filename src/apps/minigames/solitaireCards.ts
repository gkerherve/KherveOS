// The playing cards for Solitaire, drawn on a canvas so they stay crisp at
// any size: suit shapes, pips laid out the classic way, framed court cards,
// and a green back with the KherveOS mark. Each card is drawn once into a
// small canvas at the screen's pixel density, then copied.

import { drawMark, FONT } from './fx'
import { RANK_NAMES, type Card, type Suit } from './solitaireRules'

export const CW = 64
export const CH = 88
export const RADIUS = 6

export const RED = '#d4213d'
export const BLACK = '#1b1f24'

const SERIF = 'Georgia, "Times New Roman", serif'

export const suitColor = (s: Suit) => (s === 'hearts' || s === 'diamonds' ? RED : BLACK)

/** Adds a suit shape `size` wide, centred on (x, y), to the current path. */
export function suitPath(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, size: number) {
  const w = size / 2
  switch (suit) {
    case 'hearts':
      ctx.moveTo(x, y + w * 0.92)
      ctx.bezierCurveTo(x - w * 0.25, y + w * 0.62, x - w, y + w * 0.22, x - w, y - w * 0.28)
      ctx.bezierCurveTo(x - w, y - w * 0.8, x - w * 0.32, y - w * 0.98, x, y - w * 0.48)
      ctx.bezierCurveTo(x + w * 0.32, y - w * 0.98, x + w, y - w * 0.8, x + w, y - w * 0.28)
      ctx.bezierCurveTo(x + w, y + w * 0.22, x + w * 0.25, y + w * 0.62, x, y + w * 0.92)
      ctx.closePath()
      break
    case 'diamonds':
      ctx.moveTo(x, y - w * 1.05)
      ctx.quadraticCurveTo(x + w * 0.35, y - w * 0.4, x + w * 0.78, y)
      ctx.quadraticCurveTo(x + w * 0.35, y + w * 0.4, x, y + w * 1.05)
      ctx.quadraticCurveTo(x - w * 0.35, y + w * 0.4, x - w * 0.78, y)
      ctx.quadraticCurveTo(x - w * 0.35, y - w * 0.4, x, y - w * 1.05)
      ctx.closePath()
      break
    case 'spades':
      ctx.moveTo(x, y - w * 0.98)
      ctx.bezierCurveTo(x - w * 0.25, y - w * 0.62, x - w, y - w * 0.3, x - w, y + w * 0.16)
      ctx.bezierCurveTo(x - w, y + w * 0.62, x - w * 0.38, y + w * 0.74, x - w * 0.08, y + w * 0.4)
      ctx.quadraticCurveTo(x - w * 0.12, y + w * 0.82, x - w * 0.42, y + w * 0.98)
      ctx.lineTo(x + w * 0.42, y + w * 0.98)
      ctx.quadraticCurveTo(x + w * 0.12, y + w * 0.82, x + w * 0.08, y + w * 0.4)
      ctx.bezierCurveTo(x + w * 0.38, y + w * 0.74, x + w, y + w * 0.62, x + w, y + w * 0.16)
      ctx.bezierCurveTo(x + w, y - w * 0.3, x + w * 0.25, y - w * 0.62, x, y - w * 0.98)
      ctx.closePath()
      break
    case 'clubs': {
      const r = w * 0.4
      for (const [cx, cy] of [[x, y - w * 0.5], [x - w * 0.52, y + w * 0.1], [x + w * 0.52, y + w * 0.1]]) {
        ctx.moveTo(cx + r, cy)
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
      }
      ctx.moveTo(x - w * 0.16, y)
      ctx.lineTo(x + w * 0.16, y)
      ctx.quadraticCurveTo(x + w * 0.12, y + w * 0.75, x + w * 0.42, y + w * 0.98)
      ctx.lineTo(x - w * 0.42, y + w * 0.98)
      ctx.quadraticCurveTo(x - w * 0.12, y + w * 0.75, x - w * 0.16, y)
      ctx.closePath()
      ctx.moveTo(x - w * 0.25, y - w * 0.2)
      ctx.rect(x - w * 0.25, y - w * 0.3, w * 0.5, w * 0.5)
      break
    }
  }
}

export function fillSuit(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, size: number, color = suitColor(suit)) {
  ctx.fillStyle = color
  ctx.beginPath()
  suitPath(ctx, suit, x, y, size)
  ctx.fill()
}

/** Pip positions for 2..10: columns 0 / 0.5 / 1 across, rows 0..1 down. */
const PIPS: Record<number, [number, number][]> = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
  8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
  9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
  10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** A crown for the kings and queens (`points` spikes). */
function crown(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, points: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x - w / 2, y + h / 2)
  ctx.lineTo(x - w / 2, y - h / 2)
  const n = points
  for (let i = 0; i < n; i++) {
    const x1 = x - w / 2 + (w * (i + 0.5)) / n
    const x2 = x - w / 2 + (w * (i + 1)) / n
    ctx.lineTo(x1, y)
    ctx.lineTo(x2, y - h / 2)
  }
  ctx.lineTo(x + w / 2, y + h / 2)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#f2c94c'
  for (let i = 0; i <= n; i++) {
    ctx.beginPath()
    ctx.arc(x - w / 2 + (w * i) / n, y - h / 2, 1.3, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Draws a face-up card with its top-left corner at (0, 0), in card units. */
export function drawFace(ctx: CanvasRenderingContext2D, card: Pick<Card, 'suit' | 'rank'>) {
  const color = suitColor(card.suit)
  const paper = ctx.createLinearGradient(0, 0, 0, CH)
  paper.addColorStop(0, '#ffffff')
  paper.addColorStop(1, '#eef1ec')
  ctx.fillStyle = paper
  roundRect(ctx, 0, 0, CW, CH, RADIUS)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.lineWidth = 0.8
  roundRect(ctx, 0.4, 0.4, CW - 0.8, CH - 0.8, RADIUS)
  ctx.stroke()

  // The corner indexes, top left and (upside down) bottom right.
  const name = RANK_NAMES[card.rank]
  const index = () => {
    ctx.fillStyle = color
    ctx.font = `700 ${name === '10' ? 11 : 12.5}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(name, 8.5, 3.5)
    fillSuit(ctx, card.suit, 8.5, 21.5, 8)
  }
  index()
  ctx.save()
  ctx.translate(CW, CH)
  ctx.rotate(Math.PI)
  index()
  ctx.restore()

  if (card.rank === 1) {
    fillSuit(ctx, card.suit, CW / 2, CH / 2, card.suit === 'spades' ? 30 : 26)
    return
  }
  if (card.rank <= 10) {
    for (const [nx, ny] of PIPS[card.rank]) {
      const x = 21 + nx * 22
      const y = 17 + ny * 54
      ctx.save()
      ctx.translate(x, y)
      if (ny > 0.5) ctx.rotate(Math.PI)
      fillSuit(ctx, card.suit, 0, 0, 11)
      ctx.restore()
    }
    return
  }

  // Court cards: a framed panel with a crown (or a plume), the letter and the suit.
  const fx = 15
  const fy = 12
  const fw = CW - 30
  const fh = CH - 24
  const tint = ctx.createLinearGradient(0, fy, 0, fy + fh)
  tint.addColorStop(0, color === RED ? '#fde8ea' : '#e8ecf2')
  tint.addColorStop(1, color === RED ? '#f8d3d8' : '#d5dce6')
  ctx.fillStyle = tint
  roundRect(ctx, fx, fy, fw, fh, 3)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  roundRect(ctx, fx + 0.5, fy + 0.5, fw - 1, fh - 1, 3)
  ctx.stroke()
  const cx = CW / 2
  if (card.rank === 13) crown(ctx, cx, fy + 13, 20, 11, 3, color)
  else if (card.rank === 12) crown(ctx, cx, fy + 13, 16, 9, 2, color)
  else {
    // The jack's plumed cap.
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(cx, fy + 15, 9, 4.5, 0, Math.PI, 0)
    ctx.fill()
    ctx.strokeStyle = '#f2c94c'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(cx + 4, fy + 11)
    ctx.quadraticCurveTo(cx + 12, fy + 4, cx + 6, fy + 3)
    ctx.stroke()
  }
  ctx.fillStyle = color
  ctx.font = `700 22px ${SERIF}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, cx, fy + 33)
  fillSuit(ctx, card.suit, cx, fy + 52, 12)
}

/** The back: the theme's green, a diamond lattice and the KherveOS mark. */
export function drawBack(ctx: CanvasRenderingContext2D, accent: string) {
  const bg = ctx.createLinearGradient(0, 0, CW, CH)
  bg.addColorStop(0, '#1b6b3c')
  bg.addColorStop(1, '#0b3a20')
  ctx.fillStyle = '#f4f6f2'
  roundRect(ctx, 0, 0, CW, CH, RADIUS)
  ctx.fill()
  ctx.fillStyle = bg
  roundRect(ctx, 3, 3, CW - 6, CH - 6, RADIUS - 2)
  ctx.fill()
  ctx.save()
  roundRect(ctx, 3, 3, CW - 6, CH - 6, RADIUS - 2)
  ctx.clip()
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let d = -CH; d < CW + CH; d += 7) {
    ctx.moveTo(d, 0)
    ctx.lineTo(d + CH, CH)
    ctx.moveTo(d, CH)
    ctx.lineTo(d + CH, 0)
  }
  ctx.stroke()
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 0.8
  roundRect(ctx, 6, 6, CW - 12, CH - 12, RADIUS - 3)
  ctx.stroke()
  ctx.fillStyle = '#0b3a20'
  ctx.beginPath()
  ctx.arc(CW / 2, CH / 2, 15, 0, Math.PI * 2)
  ctx.fill()
  drawMark(ctx, CW / 2, CH / 2, 28, accent, 15)
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'
  ctx.lineWidth = 0.8
  roundRect(ctx, 0.4, 0.4, CW - 0.8, CH - 0.8, RADIUS)
  ctx.stroke()
}

/** Each card drawn once at the current pixel density, then reused. */
export class CardSprites {
  private cache = new Map<string, HTMLCanvasElement>()
  private scale = 0
  accent = '#22b357'

  get(card: Pick<Card, 'suit' | 'rank' | 'up'>, scale: number): HTMLCanvasElement {
    if (scale !== this.scale) {
      this.cache.clear()
      this.scale = scale
    }
    const key = card.up ? `${card.suit}${card.rank}` : 'back'
    let c = this.cache.get(key)
    if (!c) {
      c = document.createElement('canvas')
      c.width = Math.ceil(CW * scale)
      c.height = Math.ceil(CH * scale)
      const ctx = c.getContext('2d')!
      ctx.scale(scale, scale)
      if (card.up) drawFace(ctx, card)
      else drawBack(ctx, this.accent)
      this.cache.set(key, c)
    }
    return c
  }
}
