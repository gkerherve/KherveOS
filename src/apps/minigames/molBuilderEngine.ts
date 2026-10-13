// Molecule Builder's engine for the game shell: clicks on the grid place
// atoms and bonds, C / N / O (or 1–3) pick the element, a right-click or
// Delete takes an atom away, ? asks for a hint, R clears the board; plus the
// sounds and the drawing: CPK-coloured atoms labelled with their hydrogens
// (CH₃, OH, NH₂), single / double / triple bonds, a red ring on an atom with
// too many bonds, and the molecule's name when an isomer is found. The rules
// are in molBuilderRules.ts.

import type { Frame, GameEngine, Phase } from './GameShell'
import { FONT, Floaters, Particles, glowText, rgba } from './fx'
import { arpeggio, sfx, tone } from './sound'
import {
  BOND_REACH, ELEMENTS, GRID_COLS, GRID_ROWS, MolBuilder as Rules, VALENCE, formulaOf, hydrogens, pretty,
  type Atom, type BuilderEvent, type El,
} from './molBuilderRules'

export const SPACING = 62
export const W = GRID_COLS * SPACING + 60
export const H = GRID_ROWS * SPACING + 150
const X0 = 30 + SPACING / 2
const Y0 = 84 + SPACING / 2
const R = 19
const PALETTE_Y = H - 34

export const ATOM_COLORS: Record<El, [string, string]> = {
  C: ['#4a4f55', '#ffffff'],
  N: ['#3b6cf0', '#ffffff'],
  O: ['#e8333a', '#ffffff'],
}

const px = (x: number) => X0 + x * SPACING
const py = (y: number) => Y0 + y * SPACING
const PALETTE = (i: number) => ({ x: 30 + i * 64, y: PALETTE_Y - 18, w: 56, h: 36 })
const CLEAR_BUTTON = { x: W - 30 - 140, y: PALETTE_Y - 18, w: 66, h: 36 }
const HINT_BUTTON = { x: W - 30 - 66, y: PALETTE_Y - 18, w: 66, h: 36 }
const inBox = (x: number, y: number, b: { x: number; y: number; w: number; h: number }) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h

const SUB = '₀₁₂₃₄₅₆₇₈₉'
/** "CH₃", "OH", "NH₂", "C". */
export function atomLabel(el: El, h: number): string {
  if (h <= 0) return el
  return `${el}H${h > 1 ? SUB[h] : ''}`
}

const ELEMENT_KEYS: Record<string, El> = { KeyC: 'C', KeyN: 'N', KeyO: 'O', Digit1: 'C', Digit2: 'N', Digit3: 'O' }
const REMOVE_KEYS = ['Delete', 'Backspace', 'KeyX']
const HINT_KEYS = ['Slash', 'KeyI']
const CLEAR_KEYS = ['KeyR']

export class MolBuilderEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...Object.keys(ELEMENT_KEYS), ...REMOVE_KEYS, ...HINT_KEYS, ...CLEAR_KEYS])
  readonly game = new Rules()
  accent = '#22b357'
  phase: Phase = 'ready'
  canvas: HTMLCanvasElement | null = null
  private particles = new Particles(300)
  private floaters = new Floaters()
  private hover: { x: number; y: number } | null = null
  private banner: { title: string; sub: string; color: string; t: number } | null = null

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const g = this.game
    return `${g.state === 'won' ? 'All levels' : `Level ${g.level + 1}`} · ${g.isomersFound} isomers`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.banner = null
  }

  // ------------------------------------------------------------ controls

  keyDown(code: string) {
    const g = this.game
    const el = ELEMENT_KEYS[code]
    if (el) {
      g.setElement(el)
      const sel = g.mol.atoms.find((a) => a.id === g.selected)
      if (sel && sel.el !== el) g.setAtom(sel.x, sel.y, el)
      else this.drain()
    } else if (REMOVE_KEYS.includes(code)) {
      const sel = g.mol.atoms.find((a) => a.id === g.selected)
      if (sel) g.remove(sel.x, sel.y)
    } else if (HINT_KEYS.includes(code)) g.useHint()
    else if (CLEAR_KEYS.includes(code) && g.showing <= 0) g.clear()
  }

  keyUp() {}
  releaseAll() {}

  /** The grid point under a position, if close enough. */
  private gridAt(x: number, y: number): { x: number; y: number } | null {
    const gx = Math.round((x - X0) / SPACING)
    const gy = Math.round((y - Y0) / SPACING)
    if (gx < 0 || gy < 0 || gx >= GRID_COLS || gy >= GRID_ROWS) return null
    return Math.hypot(px(gx) - x, py(gy) - y) <= SPACING * 0.42 ? { x: gx, y: gy } : null
  }

  pointerMove(x: number, y: number) {
    this.hover = this.gridAt(x, y)
  }

  pointerDown(x: number, y: number) {
    const g = this.game
    for (let i = 0; i < ELEMENTS.length; i++) if (inBox(x, y, PALETTE(i))) return g.setElement(ELEMENTS[i])
    if (inBox(x, y, CLEAR_BUTTON)) return g.showing <= 0 ? g.clear() : undefined
    if (inBox(x, y, HINT_BUTTON)) return void g.useHint()
    const p = this.gridAt(x, y)
    if (p) g.click(p.x, p.y)
    else if (g.selected !== null) g.selected = null
  }

  /** A right-click: remove the atom there. */
  removeAt(x: number, y: number) {
    const p = this.gridAt(x, y)
    if (p) this.game.remove(p.x, p.y)
  }

  // ------------------------------------------------------------ the clock

  update(dt: number) {
    this.game.update(dt)
    this.drain()
    this.particles.update(dt)
    this.floaters.update(dt)
    if (this.banner) {
      this.banner.t += dt
      if (this.game.state === 'play' && this.banner.t > 2) this.banner = null
    }
  }

  drain() {
    for (const e of this.game.events) this.onEvent(e)
    this.game.events.length = 0
  }

  private onEvent(e: BuilderEvent) {
    switch (e.type) {
      case 'place':
        this.particles.burst(px(e.x), py(e.y), ATOM_COLORS[e.el][0], { count: 8, speed: [20, 70], gravity: 0, drag: 3, life: [0.2, 0.4], square: false })
        tone({ freq: 520, to: 700, dur: 0.06, type: 'sine', vol: 0.05 })
        break
      case 'remove':
        tone({ freq: 500, to: 250, dur: 0.08, type: 'sine', vol: 0.05 })
        break
      case 'bond':
        tone({ freq: e.order ? 400 + e.order * 150 : 200, dur: 0.06, type: 'triangle', vol: 0.06 })
        break
      case 'select':
        sfx('sel', () => tone({ freq: 880, dur: 0.03, type: 'sine', vol: 0.03 }), 0.05)
        break
      case 'nope':
        sfx('nope', () => tone({ freq: 160, dur: 0.1, type: 'square', vol: 0.05 }), 0.2)
        break
      case 'found': {
        const atoms = this.game.mol.atoms
        for (const a of atoms) this.particles.burst(px(a.x), py(a.y), this.accent, { count: 10, speed: [40, 140], gravity: 0, drag: 2, life: [0.3, 0.7], square: false })
        arpeggio([67, 71, 74, 79], 0.06, { dur: 0.14, type: 'triangle', vol: 0.07 })
        break
      }
      case 'again':
        this.floaters.add(`${e.name}: already found`, W / 2, Y0 - 10, '#ffd83a', { size: 13, life: 1.2 })
        sfx('again', () => tone({ freq: 300, dur: 0.12, type: 'triangle', vol: 0.05 }), 0.3)
        break
      case 'hint':
        this.floaters.add(`Try ${e.name}`, W / 2, Y0 - 10, '#ffd83a', { size: 14, life: 1.6 })
        break
      case 'level':
        this.banner = { title: `LEVEL ${e.level} DONE`, sub: e.bonus ? `Time bonus +${e.bonus}` : 'Next formula', color: this.accent, t: 0 }
        arpeggio([60, 64, 67, 72, 76], 0.07, { dur: 0.16, type: 'square', vol: 0.06 })
        break
      case 'win':
        this.banner = { title: 'ALL BUILT!', sub: 'Every isomer of every level', color: '#ffd83a', t: 0 }
        break
      case 'timeup':
        this.banner = { title: 'TIME!', sub: 'The lab is closing', color: '#ff4b5c', t: 0 }
        tone({ freq: 300, to: 80, dur: 0.8, type: 'sawtooth', vol: 0.08 })
        break
    }
  }

  // ------------------------------------------------------------- drawing

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    this.phase = f.phase
    this.canvas = ctx.canvas
    const g = this.game
    const lvl = g.current

    const bg = ctx.createLinearGradient(0, 0, 0, H)
    bg.addColorStop(0, '#0d1a12')
    bg.addColorStop(1, '#040906')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // The task.
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.font = `700 10px ${FONT}`
    ctx.fillStyle = 'rgba(220,240,228,0.6)'
    ctx.fillText(`LEVEL ${g.level + 1} · BUILD EVERY ISOMER OF`, 30, 12)
    ctx.textBaseline = 'middle'
    glowText(ctx, pretty(lvl.formula), 30, 40, '#ffd83a', 26, 900)
    ctx.font = `700 13px ${FONT}`
    ctx.fillStyle = '#e8fff0'
    ctx.textAlign = 'right'
    ctx.fillText(`${g.found.filter((x) => lvl.isomers.some((i) => i.name === x.name)).length} / ${lvl.isomers.length} found`, W - 30, 22)
    const left = Math.ceil(g.timeLeft)
    ctx.font = `800 15px ${FONT}`
    ctx.fillStyle = left <= 15 && g.state === 'play' ? '#ff4b5c' : '#e8fff0'
    ctx.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, W - 30, 42)
    ctx.textAlign = 'left'
    ctx.font = `600 11px ${FONT}`
    ctx.fillStyle = 'rgba(232,255,240,0.65)'
    ctx.fillText(g.hint ? `Hint: ${g.hint}` : lvl.hint, 30, 66)

    // The grid.
    ctx.fillStyle = 'rgba(255,255,255,0.025)'
    ctx.beginPath()
    ctx.roundRect(30, 84, GRID_COLS * SPACING, GRID_ROWS * SPACING, 10)
    ctx.fill()
    for (let x = 0; x < GRID_COLS; x++)
      for (let y = 0; y < GRID_ROWS; y++) {
        ctx.fillStyle = rgba(this.accent, 0.18)
        ctx.beginPath()
        ctx.arc(px(x), py(y), 2, 0, Math.PI * 2)
        ctx.fill()
      }

    const m = g.mol
    const byId = new Map(m.atoms.map((a) => [a.id, a]))
    // A preview of the bond the next click would make.
    const sel = g.selected !== null ? byId.get(g.selected) : undefined
    if (sel && this.hover && f.phase === 'playing' && Math.hypot(sel.x - this.hover.x, sel.y - this.hover.y) <= BOND_REACH && (sel.x !== this.hover.x || sel.y !== this.hover.y)) {
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = rgba(this.accent, 0.6)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px(sel.x), py(sel.y))
      ctx.lineTo(px(this.hover.x), py(this.hover.y))
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (this.hover && !g.atomAt(this.hover.x, this.hover.y) && f.phase === 'playing' && g.showing <= 0) {
      ctx.globalAlpha = 0.3
      this.drawAtom(ctx, { id: -1, el: g.element, x: this.hover.x, y: this.hover.y }, VALENCE[g.element], false, false)
      ctx.globalAlpha = 1
    }

    for (const b of m.bonds) {
      const a = byId.get(b.a)!
      const c = byId.get(b.b)!
      this.drawBond(ctx, px(a.x), py(a.y), px(c.x), py(c.y), b.order)
    }
    for (const a of m.atoms) this.drawAtom(ctx, a, hydrogens(m, a), a.id === g.selected, hydrogens(m, a) < 0)

    // What the board makes so far.
    if (m.atoms.length && g.showing <= 0) {
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.font = `700 12px ${FONT}`
      const now = formulaOf(m)
      ctx.fillStyle = now === lvl.formula ? '#46e05b' : 'rgba(232,255,240,0.6)'
      ctx.fillText(`on the board: ${pretty(now)}`, W - 30, 66)
    }

    this.drawPalette(ctx)
    this.particles.draw(ctx)

    if (g.showing > 0) {
      const last = g.found[g.found.length - 1]
      if (last) {
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const a = Math.min(1, (1.4 - g.showing) / 0.15)
        ctx.globalAlpha = a
        glowText(ctx, last.name, W / 2, 84 + GRID_ROWS * SPACING - 26, '#46e05b', 24, 900)
        ctx.globalAlpha = 1
      }
    }
    this.floaters.draw(ctx)
    const b = this.banner
    if (b) {
      ctx.globalAlpha = Math.max(0, Math.min(1, b.t / 0.2, g.state === 'play' ? (2 - b.t) / 0.3 : 1))
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      glowText(ctx, b.title, W / 2, H * 0.42, b.color, 30, 900)
      glowText(ctx, b.sub, W / 2, H * 0.42 + 30, '#e8fff0', 13, 700)
      ctx.globalAlpha = 1
    }
  }

  private drawBond(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, order: number) {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    ctx.strokeStyle = '#d8e6dc'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    const offsets = order === 1 ? [0] : order === 2 ? [-3.5, 3.5] : [-6, 0, 6]
    ctx.beginPath()
    for (const o of offsets) {
      ctx.moveTo(x1 + nx * o, y1 + ny * o)
      ctx.lineTo(x2 + nx * o, y2 + ny * o)
    }
    ctx.stroke()
  }

  private drawAtom(ctx: CanvasRenderingContext2D, a: Atom, h: number, selected: boolean, bad: boolean) {
    const x = px(a.x)
    const y = py(a.y)
    const [fill, text] = ATOM_COLORS[a.el]
    if (selected) {
      ctx.strokeStyle = this.accent
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, R + 5, 0, Math.PI * 2)
      ctx.stroke()
    }
    const ball = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R)
    ball.addColorStop(0, '#ffffff')
    ball.addColorStop(0.28, fill)
    ball.addColorStop(1, '#101214')
    ctx.fillStyle = ball
    ctx.beginPath()
    ctx.arc(x, y, R, 0, Math.PI * 2)
    ctx.fill()
    if (bad) {
      ctx.strokeStyle = '#ff4b5c'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, R + 2, 0, Math.PI * 2)
      ctx.stroke()
    }
    const label = atomLabel(a.el, h)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${label.length > 2 ? 11 : 14}px ${FONT}`
    ctx.fillStyle = text
    ctx.fillText(label, x, y + 1)
  }

  private drawPalette(ctx: CanvasRenderingContext2D) {
    const g = this.game
    ELEMENTS.forEach((el, i) => {
      const b = PALETTE(i)
      const on = g.element === el
      ctx.fillStyle = on ? rgba(this.accent, 0.3) : 'rgba(255,255,255,0.06)'
      ctx.strokeStyle = on ? this.accent : 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.roundRect(b.x, b.y, b.w, b.h, 8)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = ATOM_COLORS[el][0]
      ctx.beginPath()
      ctx.arc(b.x + 18, b.y + b.h / 2, 10, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = `800 10px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fff'
      ctx.fillText(el, b.x + 18, b.y + b.h / 2 + 1)
      ctx.font = `700 10px ${FONT}`
      ctx.fillStyle = 'rgba(232,255,240,0.7)'
      ctx.fillText(`${i + 1}`, b.x + 42, b.y + b.h / 2 + 1)
    })
    for (const [b, label] of [[CLEAR_BUTTON, 'Clear R'], [HINT_BUTTON, 'Hint ?']] as const) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.beginPath()
      ctx.roundRect(b.x, b.y, b.w, b.h, 8)
      ctx.fill()
      ctx.font = `700 11px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillStyle = 'rgba(232,255,240,0.8)'
      ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1)
    }
    ctx.textAlign = 'left'
    ctx.font = `600 10px ${FONT}`
    ctx.fillStyle = 'rgba(232,255,240,0.45)'
    ctx.fillText('click: atom · click two atoms: bond (again: double, triple, none)', 30 + 3 * 64 + 4, PALETTE_Y - 26)
  }
}
