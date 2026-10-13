// Titration Rush's engine for the game shell: Space held opens the burette,
// ↓ or a click on the glassware adds a drop, Enter calls the end point, 1–4
// pick the indicator; plus the sounds and the drawing: a graduated burette
// with its meniscus, the flask taking the indicator's colour (and a flash of
// it where each drop lands), a pH meter and the curve in the training rounds.
// The rules are in titrationRules.ts.

import type { Frame, GameEngine, Phase as ShellPhase } from './GameShell'
import { FONT, Floaters, Particles, glowText, rgba } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import {
  BURETTE_ML, INDICATORS, TitrationRush as Rules, baseFraction, goodIndicator, indicatorError, type Indicator, type TitrationEvent,
} from './titrationRules'

export const W = 520
export const H = 420

const BX = 110 // burette centre
const BTOP = 40
const BBOT = 250
const FLASK_Y = 400 // flask bottom
const WATER = '#bfe3ee'
/** Right-hand column. */
const RX = 250
const RW = W - RX - 14
/** The End point button and the indicator list, in logical units. */
const BUTTON = { x: RX, y: H - 46, w: RW, h: 34 }
const CHOICE = (i: number) => ({ x: RX, y: 150 + i * 46, w: RW, h: 38 })

const OPEN_KEYS = ['Space']
const DROP_KEYS = ['ArrowDown', 'KeyD']
const CALL_KEYS = ['Enter', 'KeyE']
const PICK_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4']

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The colour of the solution: the indicator's two forms mixed by the pH, over faintly blue water. */
export function solutionColor(ind: Indicator, pH: number): { rgb: [number, number, number]; alpha: number } {
  const f = baseFraction(ind, pH)
  const a = ind.acid ? hexRgb(ind.acid) : hexRgb(WATER)
  const b = ind.base ? hexRgb(ind.base) : hexRgb(WATER)
  const strength = (ind.acid ? 1 - f : 0) + (ind.base ? f : 0)
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * f)) as [number, number, number]
  return { rgb, alpha: 0.3 + 0.5 * strength }
}

const inBox = (x: number, y: number, b: { x: number; y: number; w: number; h: number }) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h

export class TitrationEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...OPEN_KEYS, ...DROP_KEYS, ...CALL_KEYS, ...PICK_KEYS])
  readonly game = new Rules()
  accent = '#22b357'
  phase: ShellPhase = 'ready'
  private particles = new Particles(200)
  private floaters = new Floaters()
  private drops: { y: number; v: number }[] = []
  private stream = 0

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const r = this.game.results
    const avg = r.length ? r.reduce((a, x) => a + (x.timedOut ? 0 : x.error), 0) / Math.max(1, r.filter((x) => !x.timedOut).length) : 0
    return `${r.length} titrations · mean error ${avg.toFixed(2)} mL`
  }

  reset() {
    this.game.reset()
    this.game.events.length = 0
    this.particles.clear()
    this.floaters.clear()
    this.drops = []
  }

  // ------------------------------------------------------------ controls

  keyDown(code: string) {
    const g = this.game
    if (OPEN_KEYS.includes(code)) g.setOpen(true)
    else if (DROP_KEYS.includes(code)) g.drop()
    else if (CALL_KEYS.includes(code)) {
      if (g.phase === 'result') g.next()
      else g.callEndpoint()
    } else if (PICK_KEYS.includes(code)) g.choose(PICK_KEYS.indexOf(code))
  }

  keyUp(code: string) {
    if (OPEN_KEYS.includes(code)) this.game.setOpen(false)
  }

  releaseAll() {
    this.game.setOpen(false)
  }

  pointerDown(x: number, y: number) {
    const g = this.game
    if (g.phase === 'choose') {
      INDICATORS.forEach((_, i) => inBox(x, y, CHOICE(i)) && g.choose(i))
    } else if (g.phase === 'result') g.next()
    else if (inBox(x, y, BUTTON)) g.callEndpoint()
    else if (x < RX - 10) g.drop()
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    const g = this.game
    g.update(dt)
    this.drain()
    this.particles.update(dt)
    this.floaters.update(dt)
    for (const d of this.drops) {
      d.v += 900 * dt
      d.y += d.v * dt
    }
    this.drops = this.drops.filter((d) => d.y < this.surfaceY())
    this.stream = g.open ? Math.min(1, this.stream + dt * 8) : Math.max(0, this.stream - dt * 8)
    if (g.open) sfx('pour', () => noise({ dur: 0.12, freq: 1800, to: 1200, vol: 0.025, filter: 'bandpass' }), 0.1)
  }

  drain() {
    for (const e of this.game.events) this.onEvent(e)
    this.game.events.length = 0
  }

  private onEvent(e: TitrationEvent) {
    switch (e.type) {
      case 'drop':
        this.drops.push({ y: BBOT + 28, v: 40 })
        tone({ freq: 1400, to: 900, dur: 0.05, type: 'sine', vol: 0.05 })
        break
      case 'open':
        tone({ freq: 500, to: 700, dur: 0.05, type: 'triangle', vol: 0.04 })
        break
      case 'empty':
        this.floaters.add('Burette empty', BX, BTOP + 40, '#ffd83a', { size: 13 })
        break
      case 'choose':
        tone({ freq: 600, to: 900, dur: 0.08, type: 'sine', vol: 0.06 })
        break
      case 'result': {
        const r = e.result
        if (r.timedOut) tone({ freq: 300, to: 120, dur: 0.5, type: 'sawtooth', vol: 0.08 })
        else if (r.points >= 900) arpeggio([72, 76, 79, 84], 0.07, { dur: 0.14, type: 'triangle', vol: 0.07 })
        else if (r.points >= 500) arpeggio([67, 72], 0.08, { dur: 0.12, type: 'triangle', vol: 0.06 })
        else tone({ freq: 380, to: 260, dur: 0.25, type: 'triangle', vol: 0.06 })
        break
      }
      case 'round':
        sfx('round', () => arpeggio([60, 67], 0.06, { dur: 0.1, type: 'square', vol: 0.04 }), 0.3)
        break
      case 'over':
        arpeggio([60, 64, 67, 72], 0.09, { dur: 0.16, type: 'square', vol: 0.06 })
        break
    }
  }

  // ------------------------------------------------------------- drawing

  /** Liquid level in the flask: rises with what has been added. */
  private surfaceY() {
    const g = this.game
    const total = g.setup.volume + g.added
    return FLASK_Y - 30 - Math.min(60, total * 0.75)
  }

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    this.phase = f.phase
    const g = this.game
    const s = g.setup

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0d1a12')
    bg.addColorStop(1, '#040906')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    // The bench.
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.fillRect(0, FLASK_Y + 2, RX - 20, H - FLASK_Y - 2)

    this.drawBurette(ctx)
    this.drawFlask(ctx)
    this.particles.draw(ctx)

    // Right column: the task.
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `700 10px ${FONT}`
    ctx.fillStyle = 'rgba(220,240,228,0.6)'
    ctx.fillText(`ROUND ${g.round} / 10${g.training ? ' · TRAINING' : ''}`, RX, 14)
    const left = Math.ceil(g.timeLeft)
    ctx.textAlign = 'right'
    ctx.font = `800 15px ${FONT}`
    ctx.fillStyle = left <= 10 && (g.phase === 'titrate' || g.phase === 'choose') ? '#ff4b5c' : '#e8fff0'
    ctx.fillText(`${left}s`, W - 14, 10)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    glowText(ctx, s.analyte.formula, RX, 40, '#ffd83a', 20, 900)
    ctx.textBaseline = 'top'
    ctx.font = `600 11px ${FONT}`
    ctx.fillStyle = 'rgba(232,255,240,0.85)'
    ctx.fillText(`${s.volume} mL of ${s.analyte.name}, unknown strength`, RX, 56)
    ctx.fillText(`titrant: ${s.titrant.toFixed(2)} M ${s.analyte.kind === 'acid' ? 'NaOH' : 'HCl'}`, RX, 72)
    if (g.phase !== 'choose') {
      ctx.fillStyle = 'rgba(232,255,240,0.65)'
      ctx.fillText(`indicator: ${s.indicator.name}`, RX, 88)
    }
    ctx.font = `800 22px ${FONT}`
    ctx.fillStyle = '#e8fff0'
    ctx.fillText(`${g.added.toFixed(2)} mL`, RX, 106)

    if (g.phase === 'choose') this.drawChoice(ctx)
    else {
      if (g.training) this.drawCurve(ctx)
      else {
        ctx.font = `600 11px ${FONT}`
        ctx.fillStyle = 'rgba(232,255,240,0.5)'
        ctx.fillText('No pH meter: watch the colour', RX, 150)
      }
      this.drawButton(ctx)
    }
    if (g.phase === 'result') this.drawResult(ctx)
    this.floaters.draw(ctx)
    if (g.phase === 'over') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, 0, W, H)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      glowText(ctx, 'LAB CLOSED', W / 2, H / 2, this.accent, 30, 900)
    }
  }

  private drawBurette(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const top = BTOP
    const len = BBOT - BTOP
    // Clamp and tube.
    ctx.fillStyle = '#3a3f44'
    ctx.fillRect(BX - 40, top + 30, 30, 6)
    ctx.fillRect(BX - 44, top - 10, 4, FLASK_Y - top + 10)
    const level = top + (g.added / BURETTE_ML) * len
    const titrant = g.setup.analyte.kind === 'acid' ? 'rgba(200,225,255,0.35)' : 'rgba(220,240,220,0.35)'
    ctx.fillStyle = titrant
    ctx.fillRect(BX - 8, level, 16, BBOT - level)
    ctx.strokeStyle = 'rgba(220,240,255,0.55)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(BX - 9, top, 18, len)
    // Meniscus.
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath()
    ctx.moveTo(BX - 8, level)
    ctx.quadraticCurveTo(BX, level + 4, BX + 8, level)
    ctx.stroke()
    // Graduations every mL, numbered every 10.
    ctx.strokeStyle = 'rgba(220,240,255,0.4)'
    ctx.fillStyle = 'rgba(220,240,255,0.55)'
    ctx.font = `600 8px ${FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.beginPath()
    for (let ml = 0; ml <= BURETTE_ML; ml++) {
      const y = top + (ml / BURETTE_ML) * len
      const long = ml % 5 === 0
      ctx.moveTo(BX + 9, y)
      ctx.lineTo(BX + 9 + (long ? 7 : 4), y)
      if (ml % 10 === 0) ctx.fillText(String(ml), BX + 19, y)
    }
    ctx.stroke()
    // Stopcock and tip.
    ctx.fillStyle = g.open ? this.accent : '#8a9096'
    ctx.save()
    ctx.translate(BX, BBOT + 8)
    ctx.rotate(g.open ? 0 : Math.PI / 2)
    ctx.fillRect(-14, -3, 28, 6)
    ctx.restore()
    ctx.strokeStyle = 'rgba(220,240,255,0.55)'
    ctx.beginPath()
    ctx.moveTo(BX - 4, BBOT)
    ctx.lineTo(BX - 1.5, BBOT + 26)
    ctx.lineTo(BX + 1.5, BBOT + 26)
    ctx.lineTo(BX + 4, BBOT)
    ctx.stroke()
    // The stream and the falling drops.
    const surface = this.surfaceY()
    if (this.stream > 0) {
      ctx.strokeStyle = `rgba(210,235,255,${0.6 * this.stream})`
      ctx.lineWidth = 2.2 * this.stream
      ctx.beginPath()
      ctx.moveTo(BX, BBOT + 26)
      ctx.lineTo(BX, surface)
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(210,235,255,0.85)'
    for (const d of this.drops) {
      ctx.beginPath()
      ctx.ellipse(BX, d.y, 2.2, 3, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  private drawFlask(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const neckW = 16
    const baseW = 70
    const neckTop = 300
    const shoulder = 330
    const path = () => {
      ctx.beginPath()
      ctx.moveTo(BX - neckW, neckTop)
      ctx.lineTo(BX - neckW, shoulder)
      ctx.lineTo(BX - baseW, FLASK_Y - 6)
      ctx.quadraticCurveTo(BX - baseW, FLASK_Y, BX - baseW + 8, FLASK_Y)
      ctx.lineTo(BX + baseW - 8, FLASK_Y)
      ctx.quadraticCurveTo(BX + baseW, FLASK_Y, BX + baseW, FLASK_Y - 6)
      ctx.lineTo(BX + neckW, shoulder)
      ctx.lineTo(BX + neckW, neckTop)
    }
    // The solution, clipped to the flask below its surface.
    const surface = this.surfaceY()
    const { rgb, alpha } = solutionColor(g.setup.indicator, g.pH)
    ctx.save()
    path()
    ctx.closePath()
    ctx.clip()
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`
    ctx.fillRect(BX - baseW, surface, baseW * 2, FLASK_Y - surface)
    // Where the drop landed the titrant turns the indicator for a moment.
    if (g.splash > 0.02) {
      const local = solutionColor(g.setup.indicator, g.setup.analyte.kind === 'acid' ? 12 : 2)
      const swirl = ctx.createRadialGradient(BX, surface + 10, 2, BX, surface + 10, 34)
      swirl.addColorStop(0, `rgba(${local.rgb[0]},${local.rgb[1]},${local.rgb[2]},${local.alpha * g.splash})`)
      swirl.addColorStop(1, `rgba(${local.rgb[0]},${local.rgb[1]},${local.rgb[2]},0)`)
      ctx.fillStyle = swirl
      ctx.fillRect(BX - baseW, surface, baseW * 2, FLASK_Y - surface)
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.fillRect(BX - baseW, surface, baseW * 2, 1.5)
    ctx.restore()
    // The glass.
    path()
    ctx.strokeStyle = 'rgba(220,240,255,0.6)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.moveTo(BX - baseW + 14, FLASK_Y - 12)
    ctx.lineTo(BX - neckW - 6, shoulder + 10)
    ctx.stroke()
  }

  private drawCurve(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const x0 = RX
    const y0 = 150
    const w = RW
    const h = 170
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.roundRect(x0, y0, w, h, 6)
    ctx.fill()
    const vmax = Math.max(10, Math.ceil((g.added + 5) / 10) * 10)
    const X = (v: number) => x0 + 26 + (v / vmax) * (w - 34)
    const Y = (p: number) => y0 + h - 14 - (Math.max(0, Math.min(14, p)) / 14) * (h - 24)
    ctx.font = `600 8px ${FONT}`
    ctx.fillStyle = 'rgba(220,240,228,0.55)'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.beginPath()
    for (const p of [0, 7, 14]) {
      ctx.fillText(String(p), x0 + 20, Y(p))
      ctx.moveTo(x0 + 26, Y(p))
      ctx.lineTo(x0 + w - 8, Y(p))
    }
    ctx.stroke()
    // The indicator's range.
    const ind = g.setup.indicator
    ctx.fillStyle = rgba(ind.base ?? '#ffffff', 0.12)
    ctx.fillRect(x0 + 26, Y(ind.pKin + 1), w - 34, Y(ind.pKin - 1) - Y(ind.pKin + 1))
    ctx.strokeStyle = this.accent
    ctx.lineWidth = 1.8
    ctx.beginPath()
    g.trace.forEach(([v, p], i) => (i ? ctx.lineTo(X(v), Y(p)) : ctx.moveTo(X(v), Y(p))))
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `800 13px ${FONT}`
    ctx.fillStyle = '#e8fff0'
    ctx.fillText(`pH ${g.pH.toFixed(2)}`, x0 + 30, y0 + 6)
    ctx.font = `600 8px ${FONT}`
    ctx.fillStyle = 'rgba(220,240,228,0.55)'
    ctx.textAlign = 'right'
    ctx.fillText(`${vmax} mL`, x0 + w - 8, y0 + h - 11)
  }

  private drawChoice(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.font = `700 12px ${FONT}`
    ctx.fillStyle = '#ffd83a'
    ctx.fillText('Choose the indicator (1–4)', RX, 132)
    INDICATORS.forEach((ind, i) => {
      const b = CHOICE(i)
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.beginPath()
      ctx.roundRect(b.x, b.y, b.w, b.h, 6)
      ctx.fill()
      // Its two colours.
      const sw = (c: string | null, x: number) => {
        ctx.fillStyle = c ?? WATER
        ctx.globalAlpha = c ? 1 : 0.3
        ctx.beginPath()
        ctx.arc(x, b.y + b.h / 2, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }
      sw(ind.acid, b.x + 40)
      sw(ind.base, b.x + 58)
      ctx.font = `800 12px ${FONT}`
      ctx.fillStyle = this.accent
      ctx.fillText(String(i + 1), b.x + 10, b.y + 12)
      ctx.fillStyle = '#e8fff0'
      ctx.fillText(ind.name, b.x + 74, b.y + 6)
      ctx.font = `600 10px ${FONT}`
      ctx.fillStyle = 'rgba(232,255,240,0.6)'
      ctx.fillText(`turns at pH ${(ind.pKin - 1).toFixed(1)}–${(ind.pKin + 1).toFixed(1)}`, b.x + 74, b.y + 22)
    })
  }

  private drawButton(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const b = BUTTON
    const live = g.phase === 'titrate'
    ctx.fillStyle = live ? this.accent : 'rgba(255,255,255,0.08)'
    ctx.beginPath()
    ctx.roundRect(b.x, b.y, b.w, b.h, 8)
    ctx.fill()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 13px ${FONT}`
    ctx.fillStyle = live ? '#04110a' : 'rgba(232,255,240,0.5)'
    ctx.fillText('END POINT  (Enter)', b.x + b.w / 2, b.y + b.h / 2 + 1)
  }

  private drawResult(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const r = g.results[g.results.length - 1]
    if (!r) return
    const x = 30
    const y = 90
    const w = W - 60
    const h = 210
    ctx.fillStyle = 'rgba(4,12,8,0.92)'
    ctx.strokeStyle = rgba(this.accent, 0.5)
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 12)
    ctx.fill()
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const verdict = r.timedOut ? 'TIME UP' : r.error <= 0.05 ? 'PERFECT' : r.error <= 0.2 ? 'GREAT' : r.error <= 0.5 ? 'GOOD' : 'MISSED'
    glowText(ctx, verdict, W / 2, y + 30, r.timedOut || r.error > 0.5 ? '#ff4b5c' : '#ffd83a', 26, 900)
    ctx.font = `600 12px ${FONT}`
    ctx.fillStyle = '#e8fff0'
    const lines = [
      `You added ${r.added.toFixed(2)} mL · equivalence at ${r.equivalence.toFixed(2)} mL`,
      r.timedOut ? 'No end point called' : `Error ${r.error.toFixed(2)} mL → ${r.points} points`,
      g.choosing
        ? goodIndicator(g.setup)
          ? `${r.indicator}: a good choice +${r.bonus}`
          : `${r.indicator} turns ${indicatorError(g.setup).toFixed(1)} mL away from the equivalence point`
        : `${r.indicator} turns at pH ${(g.setup.indicator.pKin - 1).toFixed(1)}–${(g.setup.indicator.pKin + 1).toFixed(1)}`,
      r.timeBonus ? `Time bonus +${r.timeBonus}` : '',
      `Concentration was ${g.setup.conc.toFixed(3)} M`,
    ]
    lines.forEach((t, i) => t && ctx.fillText(t, W / 2, y + 70 + i * 22))
    ctx.font = `600 10px ${FONT}`
    ctx.fillStyle = 'rgba(232,255,240,0.55)'
    ctx.fillText('Enter or click for the next titration', W / 2, y + h - 16)
  }
}
