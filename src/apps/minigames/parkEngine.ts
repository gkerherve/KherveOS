// Wobbleland's engine for the game shell: the keys, the sounds and music,
// and the drawing of the whole screen — the night park behind the cabinet,
// the backglass and its dot-matrix display on the left, the rides board on
// the right, and the table with its lights and moving rides in the middle.
// The rules are in parkRules.ts, the still artwork in parkArt.ts.

import type { Frame, GameEngine } from './GameShell'
import { FONT, Floaters, Particles, drawMark, fmt, glowText } from './fx'
import { arpeggio, noise, sfx, tone } from './sound'
import { ParkMusic } from './parkMusic'
import { C, LAMPS, LANE_LETTERS, insertShape, offscreen, paintBackglass, paintCoaster, paintPlayfield, paintScene, sceneLights, type Lamp, type SceneLights } from './parkArt'
import {
  ARCH, BALL_R, BALLOON, CAROUSEL, TEACUPS, DUCK_H, DUCK_X, LANE_GUIDES, LANE_X, LANE_X0, LANE_X1, PLUNGER_Y, Park, RIDES, RIDE_GOALS, RIDE_NAMES, SCOOP, SLINGS,
  STRIKER, TH, TIX_H, TIX_X, TW, WHEEL, trackAt, type Ball, type Flipper, type ParkEvent, type Ride,
} from './parkRules'

export const W = 1920
export const H = 1080
/**
 * The table is seen tilted, like a real one: drawn flat into its own canvas,
 * then laid on the screen in thin slices, narrower and flatter towards the
 * top (a perspective projection of the playfield's plane).
 */
const VIEW = { cx: W / 2, top: 22, height: 1030, bottomScale: 1.3, depth: 0.3 }
/** Screen position of table point (x, y). */
export function project(x: number, y: number): [number, number] {
  const v = y / TH
  const k = 1 + VIEW.depth * (1 - v)
  return [VIEW.cx + (x - TW / 2) * (VIEW.bottomScale / k), VIEW.top + (VIEW.height * v) / k]
}

const LEFT_KEYS = ['KeyZ', 'ShiftLeft', 'ArrowLeft']
const RIGHT_KEYS = ['Slash', 'ShiftRight', 'ArrowRight']
const PLUNGER_KEYS = ['Space', 'ArrowDown']

const TAU = Math.PI * 2
const BUMPER_COLORS = [C.pink, C.sky, C.gold]
const RIDE_COLORS: Record<Ride, string> = {
  coaster: C.magenta, wheel: C.sky, teacups: C.pink, striker: C.gold, gallery: C.green, carousel: C.violet,
}

interface Banner {
  title: string
  sub: string
  color: string
  t: number
  life: number
}

type DmdAnim = 'coaster' | 'wheel' | 'fireworks' | 'bell' | 'duck' | 'cups' | 'carousel' | 'tickets' | null

interface DmdMsg {
  title: string
  sub: string
  anim: DmdAnim
  t: number
  life: number
}

interface Rocket {
  x: number
  y: number
  vx: number
  vy: number
  fuse: number
  color: string
}

export class WobblelandEngine implements GameEngine {
  readonly keys: ReadonlySet<string> = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...PLUNGER_KEYS])
  readonly game = new Park()
  readonly music = new ParkMusic()
  /** The best score so far (from the high-score table), for the displays. */
  best = 0
  private particles = new Particles(700)
  private sky = new Particles(1400)
  private rockets: Rocket[] = []
  private floaters = new Floaters()
  private held = { L: new Set<string>(), R: new Set<string>(), plunger: new Set<string>() }
  private banner: Banner | null = null
  private dmdQueue: DmdMsg[] = []
  private trails = new Map<Ball, { x: number; y: number }[]>()
  private flash = new Map<string, number>()
  private lockAnims: { t: number }[] = []
  private shake = 0
  private shakeX = 0
  private shakeY = 0
  private tallyShown = 0
  private lastUpdate = -1e9
  private clock = 0
  private nextAmbient = 4
  /** General illumination: dims when the ball drains. */
  private gi = 1

  // Pre-painted layers, remade when the pixel density changes.
  private layerScale = 0
  private sceneLayer: HTMLCanvasElement | null = null
  private fieldLayer: HTMLCanvasElement | null = null
  private coasterLayer: HTMLCanvasElement | null = null
  private glassLayer: HTMLCanvasElement | null = null
  private dotsLayer: HTMLCanvasElement | null = null
  private lights: SceneLights = sceneLights(W, H)
  private table: HTMLCanvasElement | null = null
  private tableCtx: CanvasRenderingContext2D | null = null
  private tableScale = 0
  private dmd: HTMLCanvasElement | null = null
  private dmdCtx: CanvasRenderingContext2D | null = null

  get over() {
    return this.game.over
  }
  get score() {
    return this.game.score
  }

  summary() {
    const g = this.game
    return `${g.ridesDone} of 6 rides · ${g.tickets} tickets${g.finale ? ' · Grand Finale' : ''}`
  }

  reset() {
    this.game.reset()
    this.particles.clear()
    this.floaters.clear()
    this.banner = null
    this.dmdQueue = []
    this.trails.clear()
    this.lockAnims = []
    this.shake = this.shakeX = this.shakeY = 0
    this.gi = 1
    this.music.restart()
    this.releaseAll()
  }

  /** Stops the music for good (the window closed). */
  dispose() {
    this.music.stop()
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
    if (pull && !g.charging) sfx('pull', () => {
      tone({ freq: 160, to: 110, dur: 0.08, type: 'triangle', vol: 0.12 })
      noise({ dur: 0.5, freq: 300, to: 900, vol: 0.03, filter: 'bandpass', q: 4 })
    })
    g.setPlunger(pull)
  }

  // ------------------------------------------------------------- the clock

  update(dt: number) {
    const g = this.game
    this.lastUpdate = performance.now()
    g.update(dt)
    for (const e of g.events) this.onEvent(e)
    g.events.length = 0
    this.music.excited = g.multiball || g.finale

    for (const b of g.balls) {
      let t = this.trails.get(b)
      if (!t) this.trails.set(b, (t = []))
      t.unshift({ x: b.x, y: b.y })
      if (t.length > 7) t.length = 7
    }
    for (const b of this.trails.keys()) if (!g.balls.includes(b)) this.trails.delete(b)

    // Fireworks over the top of the table in multiball.
    if ((g.multiball || g.finale) && Math.random() < dt * 2.5) {
      const colors = [C.gold, C.magenta, C.teal, C.sky, C.pink]
      this.particles.burst(150 + Math.random() * 300, 50 + Math.random() * 90, colors[Math.floor(Math.random() * colors.length)], {
        count: 26, speed: [40, 150], life: [0.5, 1], size: [2, 3.5], gravity: 60, drag: 1.2, square: false,
      })
    }
    this.particles.update(dt)
    this.floaters.update(dt)
    for (const [k, v] of this.flash) this.flash.set(k, v + dt)
    for (const a of this.lockAnims) a.t += dt
    this.lockAnims = this.lockAnims.filter((a) => a.t < 0.8)
    this.shake = Math.max(0, this.shake - dt * 30)
    this.shakeX = (Math.random() - 0.5) * this.shake
    this.shakeY = (Math.random() - 0.5) * this.shake
    if (this.banner && (this.banner.t += dt) > this.banner.life) this.banner = null
    const m = this.dmdQueue[0]
    if (m && (m.t += dt) > m.life) this.dmdQueue.shift()
    this.gi += ((g.state === 'drain' ? 0.35 : 1) - this.gi) * Math.min(1, dt * 4)

    if (g.state === 'drain') {
      const total = g.tally.bonus * g.tally.multiplier
      const shown = Math.min(total, Math.floor((total * g.stateTime) / 1.4))
      if (shown > this.tallyShown) {
        sfx('tick', () => tone({ freq: 1500, dur: 0.025, type: 'square', vol: 0.05 }), 0.06)
        this.tallyShown = shown
      }
    } else this.tallyShown = 0
  }

  private show(title: string, sub: string, color: string, life = 1.8) {
    this.banner = { title, sub, color, t: 0, life }
  }

  private say(title: string, sub = '', anim: DmdAnim = null, life = 2) {
    // A new message replaces anything waiting, but lets the one on screen finish a moment.
    if (this.dmdQueue.length > 1) this.dmdQueue.length = 1
    const cur = this.dmdQueue[0]
    if (cur && cur.t > 0.5) this.dmdQueue.shift()
    this.dmdQueue.push({ title, sub, anim, t: 0, life })
  }

  private light(id: string) {
    this.flash.set(id, 0)
  }

  /** Rockets into the night sky, from somewhere along the bottom of the screen. */
  private fireworks(n: number) {
    const colors = [C.gold, C.magenta, C.teal, C.sky, C.cream, C.pink, C.green]
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5
      const x = side ? 80 + Math.random() * 520 : 1320 + Math.random() * 520
      this.rockets.push({
        x, y: H + 10, vx: (Math.random() - 0.5) * 80, vy: -(620 + Math.random() * 260),
        fuse: 0.9 + Math.random() * 0.6 + i * 0.18, color: colors[Math.floor(Math.random() * colors.length)],
      })
    }
  }

  private onEvent(e: ParkEvent) {
    const g = this.game
    switch (e.type) {
      case 'flipper':
        if (e.up) {
          noise({ dur: 0.05, freq: 700, vol: 0.16, filter: 'lowpass' })
          tone({ freq: 95, to: 70, dur: 0.05, type: 'square', vol: 0.06 })
        } else noise({ dur: 0.04, freq: 400, vol: 0.06, filter: 'lowpass' })
        break
      case 'bumper': {
        const bu = g.bumpers[e.i]
        const color = BUMPER_COLORS[e.i % 3]
        this.particles.burst(bu.x, bu.y, color, { count: 14, speed: [100, 260], life: [0.2, 0.5], size: [2, 4], gravity: 200, square: false })
        this.floaters.add(fmt(e.points), bu.x, bu.y - bu.r - 8, color, { size: 13, life: 0.6, vy: -50 })
        this.shake = Math.min(4, this.shake + 1.8)
        sfx(`bumper${e.i}`, () => {
          tone({ freq: 640 + e.i * 120, to: 300, dur: 0.12, type: 'square', vol: 0.09 })
          tone({ freq: 1900 + e.i * 200, dur: 0.06, type: 'sine', vol: 0.05 })
          noise({ dur: 0.05, freq: 2600, vol: 0.09 })
        })
        if (!g.done.teacups && g.progress.teacups % 10 === 0) this.say('TEACUPS', `${RIDE_GOALS.teacups - g.progress.teacups} SPINS TO GO`, 'cups', 1.2)
        break
      }
      case 'sling': {
        const s = SLINGS[e.i]
        this.particles.burst((s.a[0] + s.c[0]) / 2, (s.a[1] + s.c[1]) / 2, C.amber, { count: 10, speed: [60, 200], life: [0.15, 0.35], size: [1.5, 3], gravity: 150 })
        sfx('sling', () => {
          tone({ freq: 420, to: 200, dur: 0.08, type: 'triangle', vol: 0.13 })
          noise({ dur: 0.06, freq: 1300, vol: 0.12 })
        })
        break
      }
      case 'wall':
        sfx('wall', () => noise({ dur: 0.035, freq: 1100, vol: Math.min(0.14, e.speed / 8000), filter: 'lowpass' }), 0.05)
        if (e.speed > 600) this.particles.burst(e.x, e.y, '#ffffff', { count: 3, speed: [40, 120], life: [0.1, 0.25], size: [1, 2], gravity: 0 })
        break
      case 'duck': {
        const t = g.ducks[e.i]
        this.particles.burst(t.ax - 4, (t.ay + t.by) / 2, C.gold, { count: 14, speed: [80, 220], angle: Math.PI, spread: Math.PI, life: [0.2, 0.5], gravity: 300 })
        this.particles.burst(t.ax - 4, (t.ay + t.by) / 2, '#ffffff', { count: 6, speed: [20, 60], life: [0.4, 0.7], gravity: -40, square: false })
        noise({ dur: 0.08, freq: 3000, vol: 0.16, q: 0.8 })
        tone({ freq: 620, to: 420, dur: 0.09, type: 'square', vol: 0.07, at: 0.05 })
        tone({ freq: 580, to: 380, dur: 0.09, type: 'square', vol: 0.06, at: 0.16 })
        this.floaters.add('QUACK!', t.ax - 30, t.ay, C.gold, { size: 11, life: 0.7, vy: -40 })
        break
      }
      case 'gallery':
        this.show('SHOOTING GALLERY', `All ducks down · +${fmt(e.points)}`, C.green)
        this.say('BULLSEYE!', `+${fmt(e.points)}`, 'duck')
        arpeggio([72, 76, 79, 84], 0.07, { dur: 0.14, type: 'square', vol: 0.09 })
        this.light('show')
        this.fireworks(1)
        break
      case 'tix': {
        const t = g.tix[e.i]
        this.light(`tix${e.i}`)
        this.particles.burst(t.ax + 6, (t.ay + t.by) / 2, C.amber, { count: 10, speed: [60, 180], angle: 0, spread: Math.PI, life: [0.2, 0.5], gravity: 250 })
        tone({ freq: 1568, dur: 0.08, type: 'sine', vol: 0.1 })
        tone({ freq: 2093, dur: 0.12, type: 'sine', vol: 0.09, at: 0.06 })
        noise({ dur: 0.05, freq: 5000, vol: 0.05, at: 0.06 })
        break
      }
      case 'tixAll':
        this.show('TICKETS!', '+25 tickets · Ride Again lit', C.amber)
        this.say('TICKETS', '+25  RIDE AGAIN LIT', 'tickets')
        arpeggio([76, 79, 84, 88], 0.06, { dur: 0.12, type: 'triangle', vol: 0.1 })
        break
      case 'lane':
        this.light(`lane${e.i}`)
        if (e.lit) tone({ freq: 1318, dur: 0.14, type: 'sine', vol: 0.12 })
        else tone({ freq: 659, dur: 0.06, type: 'sine', vol: 0.06 })
        break
      case 'lanes':
        this.light('mult')
        this.show(`${e.multiplier}× BONUS`, e.multiplier >= 6 ? 'Maxed out: +500,000' : 'P·A·R·K complete', C.teal)
        this.say(`BONUS ${e.multiplier}X`, 'PARK COMPLETE')
        arpeggio([67, 71, 74, 79, 83], 0.06, { dur: 0.12, type: 'triangle', vol: 0.12 })
        break
      case 'skill':
        this.show('SKILL SHOT', `+${fmt(e.points)}`, C.gold)
        this.say('SKILL SHOT', `+${fmt(e.points)}`, 'fireworks')
        arpeggio([72, 79, 84, 91], 0.07, { dur: 0.16, type: 'square', vol: 0.09 })
        this.light('show')
        this.fireworks(2)
        break
      case 'inlane':
        this.light(`inlane${e.side}`)
        sfx('inlane', () => tone({ freq: 880, dur: 0.08, type: 'triangle', vol: 0.08 }))
        break
      case 'outlane':
        tone({ freq: 440, to: 200, dur: 0.3, type: 'triangle', vol: 0.1 })
        break
      case 'launch':
        noise({ dur: 0.3, freq: 400, to: 2600, vol: 0.13 * (0.4 + e.power), q: 0.7 })
        tone({ freq: 70, dur: 0.1, type: 'sine', vol: 0.25 })
        break
      case 'rampStart':
        // The chain lift's clatter, then the rush down.
        for (let i = 0; i < 8; i++) noise({ dur: 0.025, freq: 2200, vol: 0.07, q: 3, at: i * 0.06 })
        noise({ dur: 1.6, freq: 200, to: 900, vol: 0.09, filter: 'lowpass', at: 0.3 })
        noise({ dur: 0.9, freq: 1200, to: 400, vol: 0.05, at: 0.6 })
        this.say('THE LOOP', 'HOLD ON TIGHT', 'coaster', 1.8)
        break
      case 'rampEnd':
        this.light('coaster')
        this.floaters.add(`+${fmt(e.points)}`, 90, 640, C.magenta, { size: 16, life: 1, vy: -40, pop: true })
        if (e.chain > 1) this.show(`COASTER CHAIN ×${e.chain}`, `Back to back · +${fmt(e.points)}`, C.magenta)
        else if (e.combo) this.show('COMBO!', `Inlane to the loop · +${fmt(e.points)}`, C.magenta)
        this.say(e.chain > 1 ? `CHAIN X${e.chain}` : e.combo ? 'COMBO LOOP' : 'LOOP THE LOOP', `+${fmt(e.points)}`, 'coaster', 1.6)
        arpeggio([60, 64, 67, 72], 0.05, { dur: 0.1, type: 'square', vol: 0.08 })
        break
      case 'rampFail':
        sfx('rampFail', () => noise({ dur: 0.12, freq: 300, vol: 0.12, filter: 'lowpass' }), 0.2)
        break
      case 'scoop':
        noise({ dur: 0.12, freq: 260, vol: 0.18, filter: 'lowpass' })
        tone({ freq: 220, to: 110, dur: 0.15, type: 'sine', vol: 0.15 })
        break
      case 'lock':
        this.lockAnims.push({ t: 0 })
        this.light('scoop')
        this.show(`BALL ${e.n} LOCKED`, e.n < 3 ? 'All aboard the Ferris Wheel' : 'Multiball!', C.sky)
        this.say(`BALL ${e.n} LOCKED`, e.n < 3 ? `${3 - e.n} MORE FOR MULTIBALL` : 'MULTIBALL!', 'wheel')
        arpeggio([84, 79, 76, 72], 0.08, { dur: 0.4, type: 'sine', vol: 0.09 })
        break
      case 'eject':
        noise({ dur: 0.08, freq: 500, vol: 0.18, filter: 'lowpass' })
        tone({ freq: 90, dur: 0.08, type: 'square', vol: 0.12 })
        break
      case 'multiball':
        this.show('PARK AFTER DARK', 'Multiball · every scoop is a jackpot', C.sky, 2.6)
        this.say('MULTIBALL', 'SCOOP = JACKPOT', 'fireworks', 2.6)
        this.light('show')
        this.fireworks(6)
        arpeggio([60, 64, 67, 72, 76, 79, 84], 0.07, { dur: 0.2, type: 'square', vol: 0.09 })
        noise({ dur: 2.2, freq: 900, to: 1800, vol: 0.08, q: 0.4, at: 0.2 })
        this.shake = 6
        break
      case 'jackpot':
        this.show('JACKPOT', `+${fmt(e.points)}`, C.gold, 2)
        this.say('JACKPOT', fmt(e.points), 'fireworks', 2)
        this.floaters.add(`+${fmt(e.points)}`, e.x, e.y - 20, C.gold, { size: 20, life: 1.2, vy: -40, pop: true })
        this.light('show')
        this.fireworks(4)
        this.shake = 6
        arpeggio([72, 76, 79, 84, 88, 91, 96], 0.05, { dur: 0.16, type: 'square', vol: 0.08 })
        break
      case 'multiballEnd':
        this.say('MULTIBALL OVER', 'LOCK 3 MORE')
        tone({ freq: 523, to: 262, dur: 0.4, type: 'triangle', vol: 0.08 })
        break
      case 'striker': {
        this.light('striker')
        noise({ dur: 0.08, freq: 180, vol: 0.25, filter: 'lowpass' })
        tone({ freq: 300 + e.level * 900, to: 200 + e.level * 1600, dur: 0.35, type: 'triangle', vol: 0.08 })
        if (e.bell) {
          for (const [f, v] of [[1760, 0.12], [2637, 0.07], [4186, 0.04]] as const) tone({ freq: f, dur: 1.4, type: 'sine', vol: v, at: 0.3 })
          this.show('DING DING DING!', `You rang the bell · +${fmt(e.points)}`, C.gold, 2)
          this.say('RING THE BELL', `+${fmt(e.points)}`, 'bell')
          this.particles.burst(STRIKER.x0 + 28, STRIKER.top, C.gold, { count: 30, speed: [80, 260], life: [0.4, 0.9], gravity: 120, square: false })
          this.light('show')
        this.fireworks(2)
        } else {
          this.floaters.add(fmt(e.points), 290, STRIKER.y - 20 - e.level * 120, C.gold, { size: 12, life: 0.7 })
          this.say('HIGH STRIKER', `${Math.round(e.level * 100)}%  ${fmt(e.points)}`, 'bell', 1.2)
        }
        break
      }
      case 'balloon': {
        const colors = [C.red, C.sky, C.gold, C.magenta, C.green]
        const col = colors[g.balloon.color % colors.length]
        this.particles.burst(e.x, e.y, col, { count: 26, speed: [80, 260], life: [0.3, 0.7], size: [2, 4], gravity: 260 })
        this.particles.burst(e.x, e.y, '#ffffff', { count: 10, speed: [30, 120], life: [0.2, 0.4], size: [1.5, 2.5], gravity: 0, square: false })
        this.floaters.add(`POP! +${fmt(e.points)}`, e.x, e.y - 24, col, { size: 15, life: 0.9, vy: -50, pop: true })
        noise({ dur: 0.07, freq: 2600, vol: 0.2, q: 0.6 })
        noise({ dur: 0.25, freq: 600, to: 200, vol: 0.06, filter: 'lowpass', at: 0.03 })
        this.shake = Math.min(5, this.shake + 2)
        this.say('POP!', `BALLOON ${e.pops}  +${fmt(e.points)}`, 'fireworks', 1.2)
        break
      }
      case 'balloonBonus':
        this.light('show')
        this.show('BALLOON BONANZA', `Five balloons popped · +${fmt(e.points)}`, C.red, 2)
        this.fireworks(3)
        arpeggio([72, 76, 79, 84, 88], 0.06, { dur: 0.14, type: 'square', vol: 0.09 })
        break
      case 'playfield':
        this.light('show')
        this.show(`${e.mult}× PLAYFIELD`, 'Everything scores more for 20 s', C.teal, 2)
        this.say(`${e.mult}X PLAYFIELD`, 'EVERYTHING SCORES MORE', 'fireworks')
        arpeggio([60, 67, 72, 79, 84], 0.05, { dur: 0.14, type: 'sawtooth', vol: 0.07 })
        break
      case 'playfieldEnd':
        this.say('PLAYFIELD', 'MULTIPLIER OVER', null, 1.2)
        break
      case 'superLit':
        this.say('SUPER JACKPOT', 'RING THE STRIKER', 'bell', 2)
        tone({ freq: 880, to: 1760, dur: 0.4, type: 'square', vol: 0.07 })
        break
      case 'superJackpot':
        this.light('show')
        this.show('SUPER JACKPOT', `+${fmt(e.points)}`, C.gold, 3)
        this.say('SUPER JACKPOT', fmt(e.points), 'fireworks', 3)
        this.floaters.add(`+${fmt(e.points)}`, 290, STRIKER.top + 20, C.gold, { size: 24, life: 1.5, vy: -30, pop: true })
        this.fireworks(10)
        this.shake = 9
        for (const [f, v] of [[1760, 0.12], [2637, 0.07], [4186, 0.04]] as const) tone({ freq: f, dur: 1.6, type: 'sine', vol: v })
        arpeggio([72, 76, 79, 84, 88, 91, 96, 100], 0.06, { dur: 0.2, type: 'square', vol: 0.09, at: 0.2 })
        break
      case 'hurryStart':
        this.say('HURRY UP', 'SHOOT THE COASTER', 'coaster', 2)
        break
      case 'hurry':
        this.light('show')
        this.show('HURRY-UP COLLECTED', `+${fmt(e.points)}`, C.magenta, 2)
        this.say('HURRY UP', `+${fmt(e.points)}`, 'fireworks', 2)
        this.fireworks(3)
        arpeggio([79, 84, 88, 91], 0.06, { dur: 0.14, type: 'square', vol: 0.09 })
        break
      case 'hurryEnd':
        this.say('HURRY UP', 'TOO LATE', null, 1.2)
        break
      case 'carouselTick':
        sfx('carousel', () => tone({ freq: 2093 + Math.random() * 400, dur: 0.12, type: 'sine', vol: 0.04 }), 0.2)
        break
      case 'ride':
        this.light(`ride-${e.ride}`)
        this.show(`${RIDE_NAMES[e.ride].toUpperCase()}!`, `Ride ${e.done} of 6 complete · +300,000`, RIDE_COLORS[e.ride], 2.4)
        this.say(RIDE_NAMES[e.ride].toUpperCase(), `RIDE ${e.done} OF 6 DONE`, 'fireworks', 2.2)
        this.light('show')
        this.fireworks(3)
        arpeggio([67, 72, 76, 79, 84], 0.08, { dur: 0.2, type: 'triangle', vol: 0.1 })
        break
      case 'extraBall':
        this.show('EXTRA BALL', 'Three rides done', C.amber, 2)
        this.say('EXTRA BALL', 'SHOOT AGAIN AFTER THIS ONE')
        arpeggio([72, 77, 81, 84], 0.09, { dur: 0.2, type: 'square', vol: 0.08 })
        break
      case 'finale':
        this.show('GRAND FINALE', 'Every ride ridden · +5,000,000', C.gold, 3.5)
        this.say('GRAND FINALE', 'JACKPOTS 3,000,000', 'fireworks', 3.5)
        this.light('show')
        this.fireworks(14)
        this.shake = 8
        arpeggio([60, 64, 67, 72, 76, 79, 84, 88, 91, 96], 0.08, { dur: 0.3, type: 'square', vol: 0.09 })
        break
      case 'saved':
        this.light('again')
        this.show('RIDE AGAIN', 'Ball saved', C.red)
        this.say('BALL SAVED', 'RIDE AGAIN')
        arpeggio([72, 67, 72, 79], 0.07, { dur: 0.12, type: 'triangle', vol: 0.12 })
        break
      case 'drain':
        this.shake = 5
        tone({ freq: 392, to: 60, dur: 0.9, type: 'sawtooth', vol: 0.11 })
        break
      case 'bonus':
        this.say('BONUS', `${fmt(e.bonus)} X ${e.multiplier}`, null, 2.2)
        break
      case 'ball':
        this.show(`BALL ${e.n}`, e.n === 3 ? 'Last ball' : 'Pull the plunger', '#ffffff', 1.6)
        this.say(`BALL ${e.n}`, 'SHOOT THE BALL')
        arpeggio([60, 67], 0.1, { dur: 0.14, type: 'triangle', vol: 0.1, at: 0.05 })
        break
      case 'gameover':
        this.say('GAME OVER', `${fmt(g.score)}`, null, 4)
        tone({ freq: 330, to: 40, dur: 1.6, type: 'sawtooth', vol: 0.12 })
        break
    }
  }

  // --------------------------------------------------------------- drawing

  private layers(scale: number) {
    const s = Math.min(3, Math.max(0.5, Math.round(scale * 4) / 4))
    if (s === this.layerScale && this.sceneLayer) return
    this.layerScale = s
    this.sceneLayer = offscreen(W, H, s, (c) => paintScene(c, W, H))
    const ts = Math.min(3.5, s * VIEW.bottomScale)
    this.fieldLayer = offscreen(TW, TH, ts, paintPlayfield)
    this.coasterLayer = offscreen(TW, TH, ts, paintCoaster)
    this.glassLayer = offscreen(540, 470, s, (c) => paintBackglass(c, 540, 470))
    this.dotsLayer = offscreen(540, 136, s, (c) => {
      c.fillStyle = '#0b0603'
      c.beginPath()
      c.roundRect(0, 0, 540, 136, 8)
      c.fill()
      c.fillStyle = 'rgba(255,110,20,0.08)'
      for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) c.fillRect(6 + x * 4.125 + 0.5, 4 + y * 4 + 0.5, 3, 3)
    })
  }

  render(ctx: CanvasRenderingContext2D, f: Frame) {
    const now = f.now / 1000
    const dt = Math.min(0.1, Math.max(0, now - this.clock))
    this.clock = now
    this.layers(f.scale)
    // Music while the game runs; quiet when paused or between games.
    const running = f.phase === 'playing' && f.now - this.lastUpdate < 400
    if (running) this.music.start()
    else this.music.stop()

    this.drawScene(ctx, f, dt)
    this.drawBackglass(ctx, f)
    this.drawDmd(ctx, f)
    this.drawCard(ctx)
    this.drawBoard(ctx, f)

    // The table, drawn flat at the resolution its nearest end needs, then tilted onto the screen.
    const ts = Math.min(3.5, this.layerScale * VIEW.bottomScale)
    if (!this.table || this.tableScale !== ts) {
      this.table = document.createElement('canvas')
      this.table.width = Math.round(TW * ts)
      this.table.height = Math.round(TH * ts)
      this.tableCtx = this.table.getContext('2d')
      this.tableScale = ts
    }
    const tc = this.tableCtx!
    tc.setTransform(ts, 0, 0, ts, 0, 0)
    this.drawTable(tc, f)
    this.drawCabinet(ctx)
    this.warp(ctx)
    this.drawBanner(ctx)
  }

  /** Lays the flat table onto the screen in slices, with the perspective of a tilted playfield. */
  private warp(ctx: CanvasRenderingContext2D) {
    const src = this.table!
    const n = 260
    const sx = this.shakeX
    const sy = this.shakeY
    ctx.save()
    ctx.imageSmoothingQuality = 'high'
    for (let i = 0; i < n; i++) {
      const y0 = (i / n) * TH
      const y1 = ((i + 1) / n) * TH
      const [, top] = project(0, y0)
      const [, bottom] = project(0, y1)
      const [l, ] = project(0, (y0 + y1) / 2)
      const [r, ] = project(TW, (y0 + y1) / 2)
      ctx.drawImage(src, 0, (y0 / TH) * src.height, src.width, ((y1 - y0) / TH) * src.height, l + sx, top + sy, r - l, bottom - top + 0.75)
    }
    ctx.restore()
  }

  // ---- the night park

  private drawScene(ctx: CanvasRenderingContext2D, f: Frame, dt: number) {
    ctx.drawImage(this.sceneLayer!, 0, 0, W, H)
    const t = f.now / 1000
    // Searchlights sweeping the sky.
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const [x, speed, phase, color] of [[340, 0.23, 0, '120,170,255'], [1600, 0.19, 2, '255,120,200'], [1000, 0.31, 4, '255,220,140']] as const) {
      const a = -Math.PI / 2 + Math.sin(t * speed + phase) * 0.55
      const len = 1300
      const spread = 0.05
      const g = ctx.createLinearGradient(x, H, x + Math.cos(a) * len, H + Math.sin(a) * len)
      g.addColorStop(0, `rgba(${color},0.12)`)
      g.addColorStop(1, `rgba(${color},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(x, H)
      ctx.lineTo(x + Math.cos(a - spread) * len, H + Math.sin(a - spread) * len)
      ctx.lineTo(x + Math.cos(a + spread) * len, H + Math.sin(a + spread) * len)
      ctx.closePath()
      ctx.fill()
    }
    // Strings of bulbs, twinkling.
    for (const b of this.lights.bulbs) {
      const on = 0.55 + 0.45 * Math.sin(t * 3 + b.phase)
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 9)
      g.addColorStop(0, b.c)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = on * 0.6
      ctx.fillStyle = g
      ctx.fillRect(b.x - 9, b.y - 9, 18, 18)
      ctx.globalAlpha = 0.6 + on * 0.4
      ctx.fillStyle = '#fff6e0'
      ctx.fillRect(b.x - 1.2, b.y - 1.2, 2.4, 2.4)
    }
    ctx.globalAlpha = 1
    // Fireworks: rockets climb, then burst into falling sparks.
    if (f.phase === 'ready' || f.phase === 'over' || this.game.multiball || this.game.finale) {
      this.nextAmbient -= dt
      if (this.nextAmbient <= 0) {
        this.light('show')
        this.fireworks(1)
        this.nextAmbient = this.game.multiball || this.game.finale ? 0.7 : 3 + Math.random() * 4
      }
    }
    for (const r of this.rockets) {
      r.fuse -= dt
      r.x += r.vx * dt
      r.y += r.vy * dt
      r.vy += 260 * dt
      ctx.fillStyle = '#fff3c8'
      ctx.fillRect(r.x - 1.5, r.y - 1.5, 3, 3)
      this.sky.burst(r.x, r.y + 4, '#ffb066', { count: 1, speed: [5, 30], angle: Math.PI / 2, spread: 1, life: [0.2, 0.4], size: [1, 2], gravity: 40 })
      if (r.fuse <= 0) {
        const n = 70
        this.sky.burst(r.x, r.y, r.color, { count: n, speed: [60, 260], life: [0.9, 1.7], size: [2, 3.6], gravity: 70, drag: 1.1, square: false })
        this.sky.burst(r.x, r.y, '#ffffff', { count: 18, speed: [20, 120], life: [0.4, 0.9], size: [1.5, 2.5], gravity: 40, square: false })
        if (f.phase === 'playing') sfx('boom', () => {
          noise({ dur: 0.6, freq: 160, vol: 0.12, filter: 'lowpass' })
          noise({ dur: 0.9, freq: 4000, to: 1500, vol: 0.025, at: 0.08 })
        }, 0.15)
      }
    }
    this.rockets = this.rockets.filter((r) => r.fuse > 0)
    this.sky.update(dt)
    this.sky.draw(ctx)
    ctx.restore()
  }

  // ---- the backglass and its display

  private drawBackglass(ctx: CanvasRenderingContext2D, f: Frame) {
    const x = 24
    const y = 40
    const w = 540
    const h = 470
    const t = f.now / 1000
    // The box around it: dark wood and chrome.
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowBlur = 40
    ctx.fillStyle = '#1a0a12'
    ctx.beginPath()
    ctx.roundRect(x - 18, y - 18, w + 36, 690, 26)
    ctx.fill()
    ctx.restore()
    const rim = ctx.createLinearGradient(x - 18, 0, x + w + 18, 0)
    rim.addColorStop(0, '#6b7686')
    rim.addColorStop(0.5, '#e7edf4')
    rim.addColorStop(1, '#6b7686')
    ctx.strokeStyle = rim
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(x - 16, y - 16, w + 32, 686, 24)
    ctx.stroke()
    ctx.drawImage(this.glassLayer!, x, y, w, h)

    // The marquee: WOBBLELAND in neon, letter by letter, with a flicker on one of them.
    const word = 'WOBBLELAND'
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `900 64px ${FONT}`
    const step = 44
    const x0 = x + w / 2 - ((word.length - 1) * step) / 2
    const flicker = Math.sin(t * 37) > 0.93 ? 0.35 : 1
    for (let i = 0; i < word.length; i++) {
      const ch = word[i]
      if (ch === ' ') continue
      const cx = x0 + i * step
      const cy = y + 80 + Math.sin(t * 2 + i * 0.6) * 3
      const color = i < 6 ? C.gold : C.magenta
      ctx.lineWidth = 10
      ctx.strokeStyle = 'rgba(40,0,30,0.85)'
      ctx.strokeText(ch, cx, cy)
      ctx.globalAlpha = i === 8 ? flicker : 1
      ctx.shadowColor = color
      ctx.shadowBlur = 26
      ctx.fillStyle = color
      ctx.fillText(ch, cx, cy)
      ctx.shadowBlur = 0
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `900 62px ${FONT}`
      ctx.fillText(ch, cx, cy - 1)
      ctx.font = `900 64px ${FONT}`
      ctx.globalAlpha = 1
    }
    ctx.font = `800 15px ${FONT}`
    ctx.shadowColor = C.teal
    ctx.shadowBlur = 12
    ctx.fillStyle = C.teal
    ctx.fillText('WHERE NOTHING STANDS STILL', x + w / 2, y + 130)
    ctx.restore()

    // Chasing bulbs around the glass.
    const per = 2 * (w + h)
    const n = 64
    for (let i = 0; i < n; i++) {
      let d = (i / n) * per
      let bx: number
      let by: number
      if (d < w) [bx, by] = [x + d, y]
      else if ((d -= w) < h) [bx, by] = [x + w, y + d]
      else if ((d -= h) < w) [bx, by] = [x + w - d, y + h]
      else [bx, by] = [x, y + h - (d - w)]
      const on = (i + Math.floor(t * 10)) % 4 < 2
      this.bulb(ctx, bx, by, 4.5, i % 2 ? C.gold : C.cream, on ? 1 : 0.15)
    }
  }

  /** A little light bulb with its glow. */
  private bulb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, on: number) {
    if (on > 0.3) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5)
      g.addColorStop(0, color)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.45 * on
      ctx.fillStyle = g
      ctx.fillRect(x - r * 3.5, y - r * 3.5, r * 7, r * 7)
      ctx.restore()
    }
    ctx.fillStyle = on > 0.3 ? '#fffbe8' : '#4a3a2a'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.fill()
    if (on > 0.3) {
      ctx.fillStyle = color
      ctx.globalAlpha = 0.5
      ctx.beginPath()
      ctx.arc(x, y, r * 0.7, 0, TAU)
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  /** The dot-matrix display: 128 × 32 orange dots, drawn from a tiny canvas. */
  private drawDmd(ctx: CanvasRenderingContext2D, f: Frame) {
    if (!this.dmd) {
      this.dmd = document.createElement('canvas')
      this.dmd.width = 128
      this.dmd.height = 32
      this.dmdCtx = this.dmd.getContext('2d', { willReadFrequently: true })
    }
    const d = this.dmdCtx!
    d.fillStyle = '#000'
    d.fillRect(0, 0, 128, 32)
    d.fillStyle = '#fff'
    d.textAlign = 'center'
    d.textBaseline = 'middle'
    this.dmdContent(d, f)
    const px = d.getImageData(0, 0, 128, 32).data

    const X = 24
    const Y = 532
    ctx.drawImage(this.dotsLayer!, X, Y, 540, 136)
    const buckets: [number, number][][] = [[], [], [], []]
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 128; x++) {
        const v = px[(y * 128 + x) * 4]
        if (v < 40) continue
        buckets[v > 200 ? 3 : v > 140 ? 2 : v > 90 ? 1 : 0].push([x, y])
      }
    }
    ctx.save()
    ctx.shadowColor = 'rgba(255,120,20,0.9)'
    ctx.shadowBlur = 6
    buckets.forEach((list, i) => {
      if (!list.length) return
      ctx.fillStyle = ['rgba(255,110,20,0.3)', 'rgba(255,120,25,0.55)', 'rgba(255,135,35,0.8)', '#ffa040'][i]
      ctx.beginPath()
      for (const [x, y] of list) {
        const cx = X + 6 + x * 4.125 + 2
        const cy = Y + 4 + y * 4 + 2
        ctx.moveTo(cx + 1.8, cy)
        ctx.arc(cx, cy, 1.8, 0, TAU)
      }
      ctx.fill()
    })
    ctx.restore()
    // Glass over it.
    const glare = ctx.createLinearGradient(X, Y, X, Y + 136)
    glare.addColorStop(0, 'rgba(255,255,255,0.06)')
    glare.addColorStop(0.4, 'rgba(255,255,255,0)')
    ctx.fillStyle = glare
    ctx.fillRect(X, Y, 540, 136)
  }

  private dmdContent(d: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const t = f.now / 1000
    const big = (s: string, y: number, size = 18) => {
      d.font = `900 ${size}px ${FONT}`
      d.fillText(s, 64, y, 124)
    }
    const small = (s: string, y: number, size = 8) => {
      d.font = `700 ${size}px ${FONT}`
      d.fillText(s, 64, y, 126)
    }
    if (f.phase === 'ready' || (f.phase === 'over' && !this.dmdQueue.length)) {
      const page = Math.floor(t / 3) % 4
      if (page === 0) {
        big('WOBBLELAND', 13, 17)
        small('PRESS SPACE TO RIDE', 27)
      } else if (page === 1) {
        this.dmdAnim(d, 'coaster', t % 3)
        small('LOOP THE LOOP', 27)
      } else if (page === 2) {
        small('HIGH SCORE', 8)
        big(fmt(this.best), 22)
      } else {
        small('FREE RIDES', 9)
        small('FOR EVERYONE', 20)
        this.dmdAnim(d, 'fireworks', t % 3)
      }
      return
    }
    if (f.phase === 'paused') {
      big('PAUSED', 16)
      return
    }
    const m = this.dmdQueue[0]
    if (m) {
      if (m.anim) this.dmdAnim(d, m.anim, m.t)
      const pop = Math.min(1, m.t / 0.15)
      const size = m.title.length > 12 ? 13 : 16
      d.save()
      d.translate(64, 11)
      d.scale(pop, pop)
      d.font = `900 ${size}px ${FONT}`
      d.fillText(m.title, 0, 0, 124)
      d.restore()
      if (m.sub) small(m.sub, 26)
      return
    }
    if (g.state === 'drain') {
      const total = g.tally.bonus * g.tally.multiplier
      small(`BONUS ${fmt(g.tally.bonus)} X ${g.tally.multiplier}`, 8)
      big(fmt(Math.min(total, this.tallyShown)), 22)
      return
    }
    // The score, and a line of what is going on underneath.
    const s = fmt(g.score)
    big(s, 12, s.length > 9 ? 15 : 18)
    d.font = `700 7px ${FONT}`
    d.textAlign = 'left'
    d.fillText(`BALL ${g.ballNumber}`, 2, 27)
    d.textAlign = 'right'
    d.fillText(`${g.ridesDone}/6 RIDES`, 126, 27)
    d.textAlign = 'center'
    d.fillText(g.hurry > 0 ? `HURRY ${fmt(g.hurry)}` : g.pfMult > 1 ? `${g.pfMult}X PLAYFIELD` : g.multiball ? 'MULTIBALL' : g.multiplier > 1 ? `${g.multiplier}X BONUS` : `TIX ${g.tickets}`, 64, 27)
  }

  /** Little animations behind the display's messages. */
  private dmdAnim(d: CanvasRenderingContext2D, anim: DmdAnim, t: number) {
    d.save()
    d.globalAlpha = 0.45
    switch (anim) {
      case 'coaster': {
        // A track of hills and a car riding it.
        const track = (x: number) => 22 - Math.sin(x / 9) * 5 - Math.sin(x / 23) * 3
        d.fillStyle = '#fff'
        for (let x = 0; x < 128; x += 2) d.fillRect(x, track(x), 1, 1)
        const cx = (t * 70) % 160 - 16
        for (let k = 0; k < 3; k++) d.fillRect(cx - k * 7 - 3, track(cx - k * 7) - 4, 6, 3)
        break
      }
      case 'wheel': {
        d.strokeStyle = '#fff'
        d.lineWidth = 1
        d.beginPath()
        d.arc(110, 16, 13, 0, TAU)
        d.stroke()
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + t
          d.beginPath()
          d.moveTo(110, 16)
          d.lineTo(110 + Math.cos(a) * 13, 16 + Math.sin(a) * 13)
          d.stroke()
          d.fillStyle = '#fff'
          d.fillRect(110 + Math.cos(a) * 13 - 1.5, 16 + Math.sin(a) * 13, 3, 3)
        }
        break
      }
      case 'fireworks': {
        d.fillStyle = '#fff'
        for (let k = 0; k < 3; k++) {
          const tt = (t + k * 0.4) % 1.2
          const cx = [24, 64, 104][k]
          const cy = [10, 8, 12][k]
          const r = tt * 16
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * TAU
            d.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r + tt * tt * 6, 1, 1)
          }
        }
        break
      }
      case 'bell': {
        d.fillStyle = '#fff'
        d.fillRect(118, 4, 2, 26)
        const lvl = Math.min(1, t * 2)
        d.fillRect(115, 28 - lvl * 22, 8, 3)
        d.beginPath()
        d.arc(119, 4, 4, 0, TAU)
        d.fill()
        break
      }
      case 'duck': {
        d.fillStyle = '#fff'
        for (let k = 0; k < 4; k++) {
          const x = ((t * 40 + k * 34) % 140) - 8
          d.fillRect(x, 26, 7, 3)
          d.fillRect(x + 4, 23, 3, 3)
        }
        break
      }
      case 'cups':
      case 'carousel':
      case 'tickets': {
        d.fillStyle = '#fff'
        for (let k = 0; k < 6; k++) {
          const a = t * 3 + (k / 6) * TAU
          d.fillRect(64 + Math.cos(a) * 58 - 1, 16 + Math.sin(a) * 13 - 1, 3, 3)
        }
        break
      }
      default:
        break
    }
    d.restore()
  }

  /** The instruction card under the display, like the ones on a real cabinet's apron. */
  private drawCard(ctx: CanvasRenderingContext2D) {
    const x = 24
    const y = 700
    const w = 540
    const h = 330
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 24
    ctx.fillStyle = 'rgba(255,241,214,0.92)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 12)
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = C.red
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.roundRect(x + 8, y + 8, w - 16, h - 16, 8)
    ctx.stroke()
    ctx.fillStyle = C.red
    ctx.font = `900 20px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('HOW TO RIDE', x + w / 2, y + 34)
    const rows: [string, string][] = [
      ['Z  ·  ←  ·  Left Shift', 'Left flipper'],
      ['/  ·  →  ·  Right Shift', 'Right flipper'],
      ['Space (hold, let go)', 'Plunger'],
      ['Coaster ramp ×3', 'Roller Coaster'],
      ['Scoop: lock 3 balls', 'Multiball'],
      ['Hit the pad hard', 'Ring the bell'],
      ['All 6 rides', 'Grand Finale'],
      ['F · P · M · N', 'Full screen · pause · sound · new'],
    ]
    rows.forEach(([k, v], i) => {
      const ry = y + 70 + i * 31
      ctx.textAlign = 'left'
      ctx.font = `800 15px ${FONT}`
      ctx.fillStyle = '#3b1468'
      ctx.fillText(k, x + 28, ry)
      ctx.textAlign = 'right'
      ctx.font = `600 15px ${FONT}`
      ctx.fillStyle = '#5d3a2a'
      ctx.fillText(v, x + w - 28, ry)
      ctx.strokeStyle = 'rgba(93,58,42,0.18)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 4])
      ctx.beginPath()
      ctx.moveTo(x + 28, ry + 15)
      ctx.lineTo(x + w - 28, ry + 15)
      ctx.stroke()
      ctx.setLineDash([])
    })
  }

  // ---- the rides board on the right

  private drawBoard(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const x = 1356
    const y = 40
    const w = 540
    const t = f.now / 1000
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 40
    ctx.fillStyle = 'rgba(18,8,46,0.82)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, 990, 22)
    ctx.fill()
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,201,60,0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x + 6, y + 6, w - 12, 978, 18)
    ctx.stroke()

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    glowText(ctx, 'THE RIDES', x + w / 2, y + 42, C.gold, 34)

    RIDES.forEach((r, i) => {
      const ry = y + 86 + i * 92
      const done = g.done[r]
      const color = RIDE_COLORS[r]
      const p = g.progress[r] / RIDE_GOALS[r]
      const fl = this.flash.get(`ride-${r}`) ?? 9
      // The card.
      ctx.fillStyle = done ? `${color}26` : 'rgba(255,255,255,0.04)'
      ctx.beginPath()
      ctx.roundRect(x + 24, ry, w - 48, 80, 14)
      ctx.fill()
      if (fl < 1.5 && Math.floor(fl * 8) % 2 === 0) {
        ctx.strokeStyle = color
        ctx.lineWidth = 3
        ctx.stroke()
      }
      // Its picture.
      ctx.save()
      ctx.translate(x + 70, ry + 40)
      this.rideIcon(ctx, r, done ? color : 'rgba(255,255,255,0.35)', t)
      ctx.restore()
      ctx.textAlign = 'left'
      ctx.font = `800 21px ${FONT}`
      ctx.fillStyle = done ? '#fff' : 'rgba(255,255,255,0.8)'
      ctx.fillText(RIDE_NAMES[r], x + 116, ry + 26)
      ctx.font = `500 14px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.fillText(rideHint(r), x + 116, ry + 50)
      // Progress bar and count, or a gold star when ridden.
      const bx = x + 116
      const bw = 300
      ctx.fillStyle = 'rgba(255,255,255,0.1)'
      ctx.beginPath()
      ctx.roundRect(bx, ry + 64, bw, 6, 3)
      ctx.fill()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(bx, ry + 64, Math.max(6, bw * p), 6, 3)
      ctx.fill()
      ctx.textAlign = 'right'
      if (done) {
        ctx.save()
        ctx.translate(x + w - 56, ry + 36)
        ctx.rotate(Math.sin(t * 2 + i) * 0.15)
        insertShape(ctx, 'star', 0, 0, 18)
        ctx.shadowColor = C.gold
        ctx.shadowBlur = 16
        ctx.fillStyle = C.gold
        ctx.fill()
        ctx.restore()
      } else {
        ctx.font = `800 18px ${FONT}`
        ctx.fillStyle = 'rgba(255,255,255,0.75)'
        ctx.fillText(`${g.progress[r]}/${RIDE_GOALS[r]}`, x + w - 40, ry + 34)
      }
    })

    // Numbers under the rides.
    const sy = y + 650
    const cell = (label: string, value: string, cx: number, cy: number, color = '#fff') => {
      ctx.textAlign = 'center'
      ctx.font = `700 13px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillText(label.toUpperCase(), cx, cy)
      ctx.font = `900 30px ${FONT}`
      ctx.fillStyle = color
      ctx.fillText(value, cx, cy + 30)
    }
    const balls = g.state === 'dead' ? '—' : `${g.ballNumber} / 3`
    cell('Ball', balls, x + 110, sy)
    cell('Bonus', `${g.multiplier}×`, x + 270, sy, C.teal)
    cell('Tickets', fmt(g.tickets), x + 430, sy, C.amber)
    cell('Locked', g.multiball ? 'MULTI' : `${g.locked} / 3`, x + 110, sy + 90, C.sky)
    cell('Jackpot', fmt(g.jackpot * 10), x + 270, sy + 90, C.gold)
    cell('Playfield', g.pfMult > 1 ? `${g.pfMult}× ${Math.ceil(g.pfTime)}s` : '1×', x + 430, sy + 90, g.pfMult > 1 ? C.teal : '#fff')
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'
    ctx.beginPath()
    ctx.moveTo(x + 40, sy + 190)
    ctx.lineTo(x + w - 40, sy + 190)
    ctx.stroke()
    cell('Score', fmt(g.score), x + 150, sy + 230, '#fff')
    cell('High score', fmt(Math.max(this.best, g.score)), x + 390, sy + 230, C.gold)
    // What is lit right now, as flashing lines.
    const live: [string, string][] = []
    if (g.hurry > 0) live.push([`HURRY-UP ${fmt(g.hurry)} — SHOOT THE COASTER`, C.magenta])
    if (g.superLit) live.push([`SUPER JACKPOT ${fmt(g.superJackpot)} — HIT THE STRIKER`, C.gold])
    if (g.chain > 1) live.push([`COASTER CHAIN ×${g.chain} — AGAIN FOR ×${g.chain + 1}`, C.pink])
    if (g.saveTime > 0) live.push([`RIDE AGAIN ${Math.ceil(g.saveTime)}s`, C.red])
    if (g.extraBalls) live.push([`EXTRA BALL LIT ×${g.extraBalls}`, C.amber])
    ctx.textAlign = 'center'
    ctx.font = `900 15px ${FONT}`
    live.slice(0, 3).forEach(([text, color], i) => {
      ctx.globalAlpha = Math.floor(t * 4 + i) % 2 ? 1 : 0.6
      ctx.fillStyle = color
      ctx.fillText(text, x + w / 2, sy + 296 + i * 22)
    })
    ctx.globalAlpha = 1
  }

  /** The small picture of each ride on the board. */
  private rideIcon(ctx: CanvasRenderingContext2D, r: Ride, color: string, t: number) {
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    switch (r) {
      case 'coaster':
        ctx.beginPath()
        ctx.moveTo(-26, 18)
        ctx.bezierCurveTo(-14, -30, -2, 30, 6, -6)
        ctx.arc(14, -6, 8, Math.PI, Math.PI * 3)
        ctx.lineTo(26, 18)
        ctx.stroke()
        break
      case 'wheel':
        ctx.beginPath()
        ctx.arc(0, -4, 20, 0, TAU)
        ctx.stroke()
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + t * 0.5
          ctx.beginPath()
          ctx.moveTo(0, -4)
          ctx.lineTo(Math.cos(a) * 20, -4 + Math.sin(a) * 20)
          ctx.stroke()
          ctx.fillRect(Math.cos(a) * 20 - 3, -4 + Math.sin(a) * 20, 6, 5)
        }
        ctx.beginPath()
        ctx.moveTo(-12, 26)
        ctx.lineTo(0, -4)
        ctx.lineTo(12, 26)
        ctx.stroke()
        break
      case 'teacups':
        ctx.beginPath()
        ctx.ellipse(0, 14, 24, 7, 0, 0, TAU)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(-16, -10)
        ctx.lineTo(16, -10)
        ctx.quadraticCurveTo(14, 12, 0, 12)
        ctx.quadraticCurveTo(-14, 12, -16, -10)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(19, -2, 6, -Math.PI / 2, Math.PI / 2)
        ctx.stroke()
        break
      case 'striker':
        ctx.fillRect(-2, -26, 4, 50)
        ctx.beginPath()
        ctx.arc(0, -26, 7, 0, TAU)
        ctx.fill()
        ctx.fillRect(-8, 6 - Math.abs(Math.sin(t * 2)) * 24, 16, 6)
        ctx.fillRect(-16, 24, 32, 5)
        break
      case 'gallery':
        ctx.beginPath()
        ctx.ellipse(-2, 6, 16, 9, 0, 0, TAU)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(10, -8, 8, 0, TAU)
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(17, -9)
        ctx.lineTo(26, -6)
        ctx.lineTo(17, -4)
        ctx.fill()
        break
      case 'carousel':
        ctx.beginPath()
        ctx.moveTo(-26, -6)
        ctx.lineTo(0, -24)
        ctx.lineTo(26, -6)
        ctx.closePath()
        ctx.fill()
        ctx.fillRect(-24, 22, 48, 4)
        for (const dx of [-16, 0, 16]) {
          ctx.fillRect(dx - 1, -6, 2, 28)
          ctx.beginPath()
          ctx.ellipse(dx, 8 + Math.sin(t * 3 + dx) * 4, 7, 4, 0, 0, TAU)
          ctx.fill()
        }
        break
    }
  }

  // ---- the cabinet and the table

  private drawCabinet(ctx: CanvasRenderingContext2D) {
    // The cabinet round the tilted playfield: dark wood, chrome side rails, the lockdown bar.
    const [tlx, tly] = project(0, 0)
    const [trx] = project(TW, 0)
    const [blx, bly] = project(0, TH)
    const [brx] = project(TW, TH)
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 60
    ctx.fillStyle = '#16060f'
    ctx.beginPath()
    ctx.moveTo(tlx - 26, tly - 16)
    ctx.lineTo(trx + 26, tly - 16)
    ctx.lineTo(brx + 40, bly + 6)
    ctx.lineTo(blx - 40, bly + 6)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    const rail = (x0: number, x1: number, dir: number) => {
      const g = ctx.createLinearGradient(x1, 0, x1 + dir * 26, 0)
      g.addColorStop(0, '#4b5664')
      g.addColorStop(0.45, '#f2f6fa')
      g.addColorStop(1, '#5c6878')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(x0, tly - 10)
      ctx.lineTo(x0 + dir * 16, tly - 10)
      ctx.lineTo(x1 + dir * 26, bly)
      ctx.lineTo(x1, bly)
      ctx.closePath()
      ctx.fill()
    }
    rail(tlx - 2, blx - 2, -1)
    rail(trx + 2, brx + 2, 1)
    // Lockdown bar.
    const bar = ctx.createLinearGradient(0, bly - 6, 0, bly + 30)
    bar.addColorStop(0, '#f2f6fa')
    bar.addColorStop(0.5, '#8996a6')
    bar.addColorStop(1, '#3c4552')
    ctx.fillStyle = bar
    ctx.beginPath()
    ctx.roundRect(blx - 36, bly - 4, brx - blx + 72, 28, 8)
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    ctx.font = `900 12px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('WOBBLELAND · FREE SOFTWARE · GPL-3.0', W / 2, bly + 10)
    // The backbox's foot at the far end, lit from below.
    const glow = ctx.createLinearGradient(0, tly - 20, 0, tly + 40)
    glow.addColorStop(0, 'rgba(255,201,60,0.25)')
    glow.addColorStop(1, 'rgba(255,201,60,0)')
    ctx.fillStyle = glow
    ctx.fillRect(tlx, tly - 20, trx - tlx, 60)
  }

  private drawTable(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, TW, TH)
    ctx.clip()
    ctx.drawImage(this.fieldLayer!, 0, 0, TW, TH)
    this.drawLamps(ctx, f)
    this.drawTopShow(ctx, f)
    this.drawCarousel(ctx, f)
    this.drawCupsPlatform(ctx, f)
    this.drawWheel(ctx, f)
    this.drawStriker(ctx, f)
    this.drawDucks(ctx, f)
    this.drawTix(ctx)
    this.drawSlings(ctx)
    this.drawBalloon(ctx, f)
    this.drawPlunger(ctx)
    for (const b of g.bumpers) this.drawTeacup(ctx, b, g.bumpers.indexOf(b))
    for (const fl of g.flippers) this.drawFlipper(ctx, fl)
    const alpha = f.alpha
    for (const b of g.balls) if (b.mode !== 'ramp') this.drawBall(ctx, b, alpha, false)
    ctx.drawImage(this.coasterLayer!, 0, 0, TW, TH)
    for (const b of g.balls) if (b.mode === 'ramp') {
      this.drawTrain(ctx, b)
      this.drawBall(ctx, b, alpha, true)
    }
    this.drawSkyRide(ctx, f)
    this.drawLockAnims(ctx)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    this.particles.draw(ctx)
    ctx.restore()
    // General illumination: the whole table dims when the ball drains.
    if (this.gi < 0.99) {
      ctx.fillStyle = `rgba(0,0,0,${(1 - this.gi) * 0.8})`
      ctx.fillRect(0, 0, TW, TH)
    }
    // A soft vignette and the glass's reflection.
    const vg = ctx.createRadialGradient(TW / 2, TH * 0.45, TH * 0.3, TW / 2, TH * 0.5, TH * 0.75)
    vg.addColorStop(0, 'rgba(0,0,0,0)')
    vg.addColorStop(1, 'rgba(0,0,0,0.45)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, TW, TH)
    const glare = ctx.createLinearGradient(0, 0, TW, TH * 0.6)
    glare.addColorStop(0, 'rgba(255,255,255,0.06)')
    glare.addColorStop(0.3, 'rgba(255,255,255,0)')
    glare.addColorStop(0.55, 'rgba(255,255,255,0.025)')
    glare.addColorStop(0.6, 'rgba(255,255,255,0)')
    ctx.fillStyle = glare
    ctx.fillRect(0, 0, TW, TH)
    this.floaters.draw(ctx)
    ctx.restore()
  }

  /** Which inserts are lit now (and how bright). */
  private lampLevel(l: Lamp, f: Frame): number {
    const g = this.game
    const t = f.now / 1000
    const blink = Math.floor(t * 5) % 2 === 0
    const fast = Math.floor(t * 10) % 2 === 0
    if (f.phase === 'ready' || f.phase === 'over') {
      // Attract mode: a sweep of light up the table.
      const wave = Math.sin(t * 4 - l.y / 60)
      return wave > 0.6 ? 1 : 0
    }
    const fl = this.flash.get(l.id) ?? 9
    if (fl < 0.6) return fast ? 1 : 0.2
    const id = l.id
    if (id === 'coaster') return g.hurry > 0 || g.chainTime > 0 ? (fast ? 1 : 0) : g.comboTime > 0 ? (fast ? 1 : 0) : g.done.coaster ? 0.6 : blink ? 1 : 0
    if (id.startsWith('coaster')) return g.progress.coaster > Number(id.slice(7)) ? 1 : 0
    if (id === 'scoop') return g.multiball ? (fast ? 1 : 0) : blink ? 1 : 0.15
    if (id.startsWith('lock')) return g.locked > Number(id.slice(4)) || g.multiball ? 1 : 0
    if (id === 'striker') return g.superLit ? (fast ? 1 : 0) : g.done.striker ? 0.5 : blink ? 1 : 0
    if (id === 'ducks') return g.ducks.some((d) => d.down) ? (fast ? 1 : 0) : blink ? 1 : 0.2
    if (id === 'tix') return g.tix.some((x) => x.lit) ? 1 : 0
    if (id.startsWith('carousel')) return g.progress.carousel > Number(id.slice(8)) ? 1 : 0
    if (id.startsWith('ride-')) {
      if (g.finale) return Math.sin(t * 8 - l.x / 20) > 0 ? 1 : 0.3
      return g.done[id.slice(5) as Ride] ? 1 : 0
    }
    if (id.startsWith('x')) return g.multiplier >= Number(id.slice(1)) ? 1 : 0
    if (id === 'again') return g.saveTime > 3 ? 1 : g.saveTime > 0 ? (fast ? 1 : 0) : 0
    if (id === 'extra') return g.extraBalls > 0 ? 1 : 0
    if (id.startsWith('lane')) {
      const i = Number(id.slice(4))
      return g.lanes[i] ? 1 : g.skillLit === i ? (fast ? 1 : 0) : 0
    }
    if (id === 'inlaneL' || id === 'inlaneR') return g.comboTime > 0 ? (fast ? 1 : 0) : 0
    return 0
  }

  private drawLamps(ctx: CanvasRenderingContext2D, f: Frame) {
    ctx.save()
    for (const l of LAMPS) {
      const v = this.lampLevel(l, f) * this.gi
      if (v <= 0.02) continue
      insertShape(ctx, l.kind, l.x, l.y, l.s, l.angle)
      const g = ctx.createRadialGradient(l.x - l.s * 0.2, l.y - l.s * 0.2, 0, l.x, l.y, l.s * 1.5)
      g.addColorStop(0, '#ffffff')
      g.addColorStop(0.35, l.color)
      g.addColorStop(1, l.color)
      ctx.globalAlpha = v
      ctx.fillStyle = g
      ctx.fill()
      ctx.globalCompositeOperation = 'lighter'
      const glow = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.s * 3.2)
      glow.addColorStop(0, l.color)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = v * 0.55
      ctx.fillStyle = glow
      ctx.fillRect(l.x - l.s * 3.2, l.y - l.s * 3.2, l.s * 6.4, l.s * 6.4)
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.globalAlpha = 1
    // The PARK letters glow over their lit lanes.
    ctx.font = `900 16px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    LANE_LETTERS.forEach((letter, i) => {
      if (!this.game.lanes[i]) return
      ctx.shadowColor = C.gold
      ctx.shadowBlur = 12
      ctx.fillStyle = '#fff4c0'
      ctx.fillText(letter, (LANE_GUIDES[i] + LANE_GUIDES[i + 1]) / 2, 108)
    })
    ctx.restore()
  }

  /** What goes on at the top of the table: bulbs chasing round the arch, spotlights on the big top, lit lanes. */
  private drawTopShow(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const t = f.now / 1000
    const show = (this.flash.get('show') ?? 9) < 2.2
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    // Two spotlights sweeping across the tent.
    ctx.save()
    ctx.beginPath()
    ctx.arc(ARCH.x, ARCH.y, ARCH.r - 4, Math.PI, 0)
    ctx.lineTo(ARCH.x + ARCH.r, 190)
    ctx.lineTo(ARCH.x - ARCH.r, 190)
    ctx.clip()
    for (const [x, ph, col] of [[60, 0, '255,220,150'], [536, 2.1, '150,200,255']] as const) {
      const a = -Math.PI / 2 + Math.sin(t * (show ? 3 : 0.8) + ph) * 0.9
      const len = 420
      const gr = ctx.createLinearGradient(x, 190, x + Math.cos(a) * len, 190 + Math.sin(a) * len)
      gr.addColorStop(0, `rgba(${col},0.32)`)
      gr.addColorStop(1, `rgba(${col},0)`)
      ctx.fillStyle = gr
      ctx.beginPath()
      ctx.moveTo(x, 190)
      ctx.lineTo(x + Math.cos(a - 0.13) * len, 190 + Math.sin(a - 0.13) * len)
      ctx.lineTo(x + Math.cos(a + 0.13) * len, 190 + Math.sin(a + 0.13) * len)
      ctx.closePath()
      ctx.fill()
    }
    // A shimmer running over the stripes.
    const sx = ((t * 160) % 900) - 150
    const sh = ctx.createLinearGradient(sx - 60, 0, sx + 60, 0)
    sh.addColorStop(0, 'rgba(255,255,255,0)')
    sh.addColorStop(0.5, 'rgba(255,240,220,0.12)')
    sh.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = sh
    ctx.fillRect(0, 0, TW, 190)
    ctx.restore()
    // Light columns over the lanes just rolled.
    for (let i = 0; i < 4; i++) {
      const fl = this.flash.get(`lane${i}`) ?? 9
      const lit = g.lanes[i]
      if (fl > 0.6 && !lit) continue
      const x = (LANE_GUIDES[i] + LANE_GUIDES[i + 1]) / 2
      const a = fl < 0.6 ? 1 - fl / 0.6 : 0.25 + 0.1 * Math.sin(t * 6 + i)
      const col = ctx.createLinearGradient(0, 150, 0, 20)
      col.addColorStop(0, `rgba(255,201,60,${0.55 * a})`)
      col.addColorStop(1, 'rgba(255,201,60,0)')
      ctx.fillStyle = col
      ctx.fillRect(x - 22, 20, 44, 130)
    }
    ctx.restore()
    // Bulbs round the arch: a chase, a rainbow in multiball, all flashing after a big moment.
    const n = 48
    for (let i = 0; i < n; i++) {
      const a = Math.PI + ((i + 0.5) / n) * Math.PI
      const x = ARCH.x + Math.cos(a) * (ARCH.r - 10)
      const y = ARCH.y + Math.sin(a) * (ARCH.r - 10)
      let on: number
      let color = i % 3 === 0 ? C.gold : i % 3 === 1 ? C.cream : C.magenta
      if (show) on = Math.floor(t * 12) % 2 ? 1 : 0.15
      else if (g.multiball || g.finale) {
        on = 1
        color = `hsl(${(i * 15 + t * 400) % 360},100%,65%)`
      } else if (f.phase !== 'playing') on = Math.sin(t * 5 - i * 0.4) > 0.3 ? 1 : 0.15
      else on = (i + Math.floor(t * 14)) % 6 < 2 || (n - i + Math.floor(t * 14)) % 6 < 1 ? 1 : 0.18
      this.bulb(ctx, x, y, 3, color, on * this.gi)
    }
  }

  /** The sky ride: cable cars going to and fro on two cables over the lanes. */
  private drawSkyRide(ctx: CanvasRenderingContext2D, f: Frame) {
    const t = f.now / 1000
    const x0 = 166
    const x1 = 430
    const cableY = (x: number, base: number) => base + Math.sin(((x - x0) / (x1 - x0)) * Math.PI) * 9
    ctx.save()
    // Towers with flags.
    for (const x of [x0, x1]) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(x + 4, 52, 6, 50)
      const tw = ctx.createLinearGradient(x - 3, 0, x + 3, 0)
      tw.addColorStop(0, '#6c7888')
      tw.addColorStop(0.5, '#f2f6fa')
      tw.addColorStop(1, '#6c7888')
      ctx.fillStyle = tw
      ctx.fillRect(x - 3, 44, 6, 52)
      ctx.fillStyle = C.red
      const wave = Math.sin(t * 6 + x) * 3
      ctx.beginPath()
      ctx.moveTo(x, 30)
      ctx.quadraticCurveTo(x + 8, 32 + wave, x + 16, 34 + wave)
      ctx.lineTo(x, 40)
      ctx.fill()
      ctx.fillStyle = '#ddd'
      ctx.fillRect(x - 0.8, 28, 1.6, 18)
    }
    // Two cables.
    for (const base of [48, 58]) {
      ctx.strokeStyle = 'rgba(20,10,30,0.8)'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let x = x0; x <= x1; x += 6) {
        if (x === x0) ctx.moveTo(x, cableY(x, base))
        else ctx.lineTo(x, cableY(x, base))
      }
      ctx.stroke()
    }
    // The cars: three each way, swinging a little.
    const colors = [C.gold, C.sky, C.magenta, C.teal, C.red, C.violet]
    for (let k = 0; k < 6; k++) {
      const back = k >= 3
      const p = (t * 0.06 + (k % 3) / 3) % 1
      const x = back ? x1 - p * (x1 - x0) : x0 + p * (x1 - x0)
      const y = cableY(x, back ? 58 : 48)
      const swing = Math.sin(t * 2.4 + k) * 0.12
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(swing)
      ctx.strokeStyle = '#c9d2dc'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, 8)
      ctx.stroke()
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.roundRect(-8 + 5, 8 + 8, 16, 13, 4)
      ctx.fill()
      const body = ctx.createLinearGradient(0, 8, 0, 21)
      body.addColorStop(0, '#ffffff')
      body.addColorStop(0.3, colors[k])
      body.addColorStop(1, shadeOf(colors[k]))
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.roundRect(-8, 8, 16, 13, 4)
      ctx.fill()
      ctx.fillStyle = 'rgba(200,235,255,0.75)'
      ctx.fillRect(-6, 10, 12, 4)
      ctx.fillStyle = '#ffd9b3'
      ctx.beginPath()
      ctx.arc(-2.5, 12.5, 1.8, 0, TAU)
      ctx.arc(2.5, 12.5, 1.8, 0, TAU)
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  }

  /** The teacups' turntable: a big painted disc turning under the three cups. */
  private drawCupsPlatform(ctx: CanvasRenderingContext2D, f: Frame) {
    const { x, y } = TEACUPS
    const R = TEACUPS.r + 42
    const t = f.now / 1000
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath()
    ctx.arc(x + 4, y + 6, R, 0, TAU)
    ctx.fill()
    ctx.translate(x, y)
    ctx.rotate(this.game.cupsAngle)
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(155,107,255,0.55)' : 'rgba(255,140,198,0.5)'
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, R, (i / 16) * TAU, ((i + 1) / 16) * TAU)
      ctx.fill()
    }
    ctx.strokeStyle = C.gold
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, R - 1.5, 0, TAU)
    ctx.stroke()
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU
      const on = (i + Math.floor(t * 10)) % 4 === 0
      ctx.fillStyle = on ? '#fffbe0' : '#7a5a20'
      ctx.beginPath()
      ctx.arc(Math.cos(a) * (R - 1.5), Math.sin(a) * (R - 1.5), 2, 0, TAU)
      ctx.fill()
    }
    // The teapot in the middle.
    ctx.rotate(-this.game.cupsAngle)
    const pot = ctx.createRadialGradient(-5, -5, 2, 0, 0, 16)
    pot.addColorStop(0, '#ffffff')
    pot.addColorStop(0.5, '#9fe3ff')
    pot.addColorStop(1, '#3a7fa8')
    ctx.fillStyle = pot
    ctx.beginPath()
    ctx.arc(0, 0, 15, 0, TAU)
    ctx.fill()
    ctx.fillStyle = C.gold
    ctx.beginPath()
    ctx.arc(0, 0, 4, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = '#9fe3ff'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(13, -2)
    ctx.quadraticCurveTo(24, -6, 26, -14)
    ctx.stroke()
    ctx.restore()
  }

  /** The runaway balloon on its wire, or the empty wire after a pop. */
  private drawBalloon(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const bl = g.balloon
    const t = f.now / 1000
    const y = BALLOON.y
    // Its wire across the table.
    ctx.strokeStyle = 'rgba(255,241,214,0.25)'
    ctx.setLineDash([3, 5])
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(BALLOON.x0, y + 26)
    ctx.lineTo(BALLOON.x1, y + 26)
    ctx.stroke()
    ctx.setLineDash([])
    if (!bl.alive) return
    const colors = [C.red, C.sky, C.gold, C.magenta, C.green]
    const col = colors[bl.color % colors.length]
    const sway = Math.sin(t * 3) * 3
    const x = bl.x
    // String down to its little trolley on the wire.
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y + BALLOON.r)
    ctx.quadraticCurveTo(x - bl.dir * 6 + sway, y + 20, x, y + 26)
    ctx.stroke()
    ctx.fillStyle = '#c9d2dc'
    ctx.fillRect(x - 4, y + 24, 8, 4)
    // Shadow, then the balloon with its shine and knot.
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath()
    ctx.ellipse(x + 6, y + 9, BALLOON.r, BALLOON.r * 1.15, 0, 0, TAU)
    ctx.fill()
    const body = ctx.createRadialGradient(x - 5, y - 7, 2, x, y, BALLOON.r * 1.2)
    body.addColorStop(0, '#ffffff')
    body.addColorStop(0.25, col)
    body.addColorStop(1, shadeOf(col))
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.ellipse(x, y, BALLOON.r, BALLOON.r * 1.15, sway * 0.03, 0, TAU)
    ctx.fill()
    ctx.fillStyle = shadeOf(col)
    ctx.beginPath()
    ctx.moveTo(x - 3, y + BALLOON.r * 1.15 + 3)
    ctx.lineTo(x + 3, y + BALLOON.r * 1.15 + 3)
    ctx.lineTo(x, y + BALLOON.r * 1.15 - 1)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath()
    ctx.ellipse(x - 5, y - 7, 3.5, 5, -0.5, 0, TAU)
    ctx.fill()
    // Its value, over it.
    ctx.font = `900 9px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff'
    ctx.fillText(`${5 * Math.min(5, g.pops + 1)}K`, x, y + 1)
  }

  private drawCarousel(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const { x, y, r } = CAROUSEL
    const a = g.carouselAngle
    const t = f.now / 1000
    ctx.save()
    // Shadow, then the turning platform.
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.arc(x + 3, y + 5, r + 2, 0, TAU)
    ctx.fill()
    ctx.translate(x, y)
    ctx.rotate(a)
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#d61f45' : '#fbe7c6'
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, r, (i / 12) * TAU, ((i + 1) / 12) * TAU)
      ctx.fill()
    }
    // Scalloped gold rim with bulbs.
    ctx.strokeStyle = C.gold
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(0, 0, r - 1.5, 0, TAU)
    ctx.stroke()
    for (let i = 0; i < 24; i++) {
      const b = (i / 24) * TAU
      const on = (i + Math.floor(t * 8)) % 3 === 0
      ctx.fillStyle = on ? '#fffbe0' : '#7a5a20'
      ctx.beginPath()
      ctx.arc(Math.cos(b) * (r - 1.5), Math.sin(b) * (r - 1.5), 1.6, 0, TAU)
      ctx.fill()
    }
    // Horses going round, rising and falling on their poles.
    const horseColors = ['#ffffff', '#f7d08a', '#c9a6ff', '#9fe3ff', '#ffb3d1', '#b8f5c8']
    for (let i = 0; i < 6; i++) {
      const b = (i / 6) * TAU
      const hx = Math.cos(b) * r * 0.66
      const hy = Math.sin(b) * r * 0.66
      const bob = 1 + 0.12 * Math.sin(t * 5 + i * 1.7)
      ctx.save()
      ctx.translate(hx, hy)
      ctx.rotate(b + Math.PI / 2)
      ctx.scale(bob, bob)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.beginPath()
      ctx.ellipse(1.5, 2, 4.5, 8, 0, 0, TAU)
      ctx.fill()
      ctx.fillStyle = horseColors[i]
      ctx.beginPath()
      ctx.ellipse(0, 0, 4, 7.5, 0, 0, TAU)
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(0, -8.5, 2.6, 3.6, 0, 0, TAU)
      ctx.fill()
      ctx.fillStyle = C.gold
      ctx.beginPath()
      ctx.arc(0, 0, 1.6, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#7a3b1a'
      ctx.fillRect(-0.8, -11, 1.6, 4)
      ctx.restore()
    }
    // The centre pole's top.
    const top = ctx.createRadialGradient(-3, -3, 1, 0, 0, 12)
    top.addColorStop(0, '#fff6c8')
    top.addColorStop(0.5, C.gold)
    top.addColorStop(1, '#8a5a10')
    ctx.fillStyle = top
    ctx.beginPath()
    ctx.arc(0, 0, 11, 0, TAU)
    ctx.fill()
    ctx.restore()
    // Its glow while the ball rides it.
    if (g.balls.some((b) => Math.hypot(b.x - x, b.y - y) < r)) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.5)
      glow.addColorStop(0, 'rgba(255,140,198,0.25)')
      glow.addColorStop(1, 'rgba(255,140,198,0)')
      ctx.fillStyle = glow
      ctx.fillRect(x - r * 1.5, y - r * 1.5, r * 3, r * 3)
      ctx.restore()
    }
  }

  /** Where gondola i hangs now. */
  private gondola(i: number): [number, number] {
    const a = this.game.wheelAngle + (i / 8) * TAU
    return [WHEEL.x + Math.cos(a) * WHEEL.r, WHEEL.y + Math.sin(a) * WHEEL.r]
  }

  private drawWheel(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const { x, y, r } = WHEEL
    const t = f.now / 1000
    ctx.save()
    // The A-frame legs down to the boarding platform.
    for (const dx of [-30, 30]) {
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.moveTo(x + 4, y + 6)
      ctx.lineTo(x + dx + 4, SCOOP.y - 18)
      ctx.stroke()
      const leg = ctx.createLinearGradient(x + dx - 3, 0, x + dx + 3, 0)
      leg.addColorStop(0, '#6c7888')
      leg.addColorStop(0.5, '#eef3f8')
      leg.addColorStop(1, '#6c7888')
      ctx.strokeStyle = leg
      ctx.lineWidth = 5
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + dx, SCOOP.y - 22)
      ctx.stroke()
    }
    // Its shadow.
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(x + 6, y + 9, r, 0, TAU)
    ctx.stroke()
    // Spokes and two rims.
    const a0 = g.wheelAngle
    ctx.strokeStyle = 'rgba(230,236,244,0.85)'
    ctx.lineWidth = 1.4
    for (let i = 0; i < 16; i++) {
      const a = a0 + (i / 16) * TAU
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
      ctx.stroke()
    }
    for (const rr of [r, r * 0.62]) {
      ctx.strokeStyle = '#eef3f8'
      ctx.lineWidth = rr === r ? 3.2 : 2
      ctx.beginPath()
      ctx.arc(x, y, rr, 0, TAU)
      ctx.stroke()
    }
    // Bulbs round the rim: a chase, a rainbow in multiball.
    for (let i = 0; i < 32; i++) {
      const a = a0 + (i / 32) * TAU
      const bx = x + Math.cos(a) * r
      const by = y + Math.sin(a) * r
      const color = g.multiball ? `hsl(${(i * 24 + t * 300) % 360},100%,65%)` : i % 2 ? C.gold : C.cream
      const on = g.multiball ? 1 : (i + Math.floor(t * 12)) % 4 === 0 ? 1 : 0.35
      ctx.globalAlpha = on * this.gi
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(bx, by, 2.2, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // The hub.
    const hub = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 11)
    hub.addColorStop(0, '#ffffff')
    hub.addColorStop(1, '#5b6573')
    ctx.fillStyle = hub
    ctx.beginPath()
    ctx.arc(x, y, 10, 0, TAU)
    ctx.fill()
    drawMark(ctx, x, y, 14, 'rgba(60,20,80,0.8)', 22)
    // Gondolas hang level as the wheel turns; locked balls ride in the first ones.
    const colors = [C.magenta, C.sky, C.gold, C.teal, C.red, C.violet, C.green, C.amber]
    for (let i = 0; i < 8; i++) {
      const [gx, gy] = this.gondola(i)
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.roundRect(gx - 9 + 4, gy + 1 + 6, 18, 14, 4)
      ctx.fill()
      ctx.strokeStyle = '#ccd5e0'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(gx, gy)
      ctx.lineTo(gx, gy + 3)
      ctx.stroke()
      const body = ctx.createLinearGradient(gx, gy + 2, gx, gy + 16)
      body.addColorStop(0, colors[i])
      body.addColorStop(1, '#1a0b2e')
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.roundRect(gx - 9, gy + 2, 18, 14, 4)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(gx - 7, gy + 4, 14, 2)
      if (i < g.locked) this.chrome(ctx, gx, gy + 9, 6.5)
    }
    ctx.restore()
  }

  private drawLockAnims(ctx: CanvasRenderingContext2D) {
    for (const a of this.lockAnims) {
      const k = Math.min(1, a.t / 0.7)
      const e = 1 - Math.pow(1 - k, 3)
      const [gx, gy] = this.gondola(Math.max(0, this.game.locked - 1))
      const x = SCOOP.x + (gx - SCOOP.x) * e
      const y = SCOOP.y + (gy + 9 - SCOOP.y) * e - Math.sin(k * Math.PI) * 30
      this.chrome(ctx, x, y, BALL_R * (1 - 0.35 * e))
    }
  }

  private drawStriker(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const x = (STRIKER.x0 + STRIKER.x1) / 2
    const top = STRIKER.top
    const bottom = STRIKER.y - 12
    const t = f.now / 1000
    // The tower: a wooden post with a brass guide rail.
    const post = ctx.createLinearGradient(x - 6, 0, x + 6, 0)
    post.addColorStop(0, '#5a2d10')
    post.addColorStop(0.5, '#c58a4a')
    post.addColorStop(1, '#5a2d10')
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(x - 3, top + 8, 12, bottom - top)
    ctx.fillStyle = post
    ctx.fillRect(x - 6, top + 4, 12, bottom - top)
    ctx.fillStyle = '#e8c070'
    ctx.fillRect(x - 1, top + 4, 2, bottom - top)
    // The puck.
    const py = bottom - 8 - g.strikerLevel * (bottom - top - 22)
    ctx.fillStyle = '#ff3b4e'
    ctx.beginPath()
    ctx.roundRect(x - 9, py - 4, 18, 8, 3)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.fillRect(x - 7, py - 3, 14, 2)
    // The bell, shaking when rung.
    const ring = g.bellAge < 1 ? Math.sin(g.bellAge * 60) * (1 - g.bellAge) * 0.35 : 0
    ctx.save()
    ctx.translate(x, top)
    ctx.rotate(ring)
    const bell = ctx.createRadialGradient(-3, -3, 1, 0, 0, 13)
    bell.addColorStop(0, '#fffbe0')
    bell.addColorStop(0.45, C.gold)
    bell.addColorStop(1, '#8a5a10')
    ctx.fillStyle = bell
    ctx.beginPath()
    ctx.arc(0, 0, 12, 0, TAU)
    ctx.fill()
    ctx.restore()
    if (g.bellAge < 1.2) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const glow = ctx.createRadialGradient(x, top, 0, x, top, 50)
      glow.addColorStop(0, `rgba(255,220,120,${0.7 * (1 - g.bellAge / 1.2)})`)
      glow.addColorStop(1, 'rgba(255,220,120,0)')
      ctx.fillStyle = glow
      ctx.fillRect(x - 50, top - 50, 100, 100)
      ctx.restore()
      // Rings of sound.
      ctx.strokeStyle = `rgba(255,230,150,${1 - g.bellAge})`
      ctx.lineWidth = 1.5
      for (const k of [0, 0.3]) {
        const rr = 14 + ((g.bellAge + k) % 1) * 30
        ctx.beginPath()
        ctx.arc(x, top, rr, -Math.PI * 0.9, -Math.PI * 0.1)
        ctx.stroke()
      }
    }
    // The pad: red rubber with HIT ME.
    const hot = g.strikerAge < 0.15
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.roundRect(STRIKER.x0 - 4, STRIKER.y - 5, STRIKER.x1 - STRIKER.x0 + 12, 14, 7)
    ctx.fill()
    const pad = ctx.createLinearGradient(0, STRIKER.y - 7, 0, STRIKER.y + 7)
    pad.addColorStop(0, hot ? '#ffd0d6' : '#ff5a6b')
    pad.addColorStop(1, '#9a0f22')
    ctx.fillStyle = pad
    ctx.beginPath()
    ctx.roundRect(STRIKER.x0 - 6, STRIKER.y - 7, STRIKER.x1 - STRIKER.x0 + 12, 14, 7)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = `900 8px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(Math.floor(t * 2) % 2 ? 'HIT ME' : 'STRIKE', x, STRIKER.y + 0.5)
  }

  private drawDucks(ctx: CanvasRenderingContext2D, f: Frame) {
    const g = this.game
    const t = f.now / 1000
    g.ducks.forEach((d, i) => {
      const cy = (d.ay + d.by) / 2
      if (d.down) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillRect(DUCK_X - 2, d.ay + 2, 5, DUCK_H - 4)
        return
      }
      const hit = d.age < 0.15
      const bob = Math.sin(t * 4 + i * 1.3) * 1.2
      ctx.save()
      ctx.translate(DUCK_X, cy + bob)
      // The target plate.
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(1, -DUCK_H / 2 + 2, 6, DUCK_H)
      ctx.fillStyle = '#e8eef5'
      ctx.fillRect(-2, -DUCK_H / 2, 5, DUCK_H)
      // The duck, facing the flippers.
      ctx.fillStyle = hit ? '#ffffff' : '#ffd23a'
      ctx.beginPath()
      ctx.ellipse(-10, 4, 11, 6.5, 0, 0, TAU)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(-17, -4, 5.5, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#ff8a1f'
      ctx.beginPath()
      ctx.moveTo(-22, -5)
      ctx.lineTo(-28, -3)
      ctx.lineTo(-22, -1)
      ctx.fill()
      ctx.fillStyle = '#1a0b2e'
      ctx.beginPath()
      ctx.arc(-18.5, -5.5, 1.2, 0, TAU)
      ctx.fill()
      ctx.fillStyle = 'rgba(200,140,20,0.6)'
      ctx.beginPath()
      ctx.ellipse(-8, 3, 6, 3, -0.3, 0, TAU)
      ctx.fill()
      // A bullseye on its side.
      ctx.strokeStyle = C.red
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(-7, 5, 2.5, 0, TAU)
      ctx.stroke()
      ctx.restore()
    })
  }

  private drawTix(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const letters = ['T', 'I', 'X']
    g.tix.forEach((tg, i) => {
      const cy = tg.ay + TIX_H / 2
      const hot = tg.age < 0.15
      ctx.fillStyle = 'rgba(0,0,0,0.4)'
      ctx.fillRect(TIX_X + 1, tg.ay + 3, 10, TIX_H)
      ctx.fillStyle = hot ? '#ffffff' : tg.lit ? '#ffb347' : '#a85a10'
      ctx.beginPath()
      ctx.roundRect(TIX_X - 3, tg.ay, 10, TIX_H, 2)
      ctx.fill()
      if (tg.lit) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        const glow = ctx.createRadialGradient(TIX_X + 2, cy, 0, TIX_X + 2, cy, 22)
        glow.addColorStop(0, 'rgba(255,154,31,0.6)')
        glow.addColorStop(1, 'rgba(255,154,31,0)')
        ctx.fillStyle = glow
        ctx.fillRect(TIX_X - 20, cy - 22, 44, 44)
        ctx.restore()
      }
      ctx.fillStyle = tg.lit ? '#3a1600' : '#ffd8a8'
      ctx.font = `900 9px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(letters[i], TIX_X + 2, cy + 0.5)
    })
  }

  private drawSlings(ctx: CanvasRenderingContext2D) {
    const g = this.game
    SLINGS.forEach((s, i) => {
      const hot = g.slingAge[i] < 0.12
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (hot) {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = 'rgba(255,170,60,0.35)'
        ctx.beginPath()
        ctx.moveTo(s.a[0], s.a[1])
        ctx.lineTo(s.b[0], s.b[1])
        ctx.lineTo(s.c[0], s.c[1])
        ctx.closePath()
        ctx.fill()
        ctx.restore()
      }
      // Rubber all round, the kicking face bulging when it fires.
      ctx.strokeStyle = '#f4f4f4'
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(s.a[0], s.a[1])
      ctx.lineTo(s.b[0], s.b[1])
      ctx.lineTo(s.c[0], s.c[1])
      ctx.stroke()
      const mx = (s.a[0] + s.c[0]) / 2
      const my = (s.a[1] + s.c[1]) / 2
      const nx = i === 0 ? 1 : -1
      const bulge = hot ? 5 : 0
      ctx.strokeStyle = hot ? '#fff3c0' : '#ffffff'
      ctx.lineWidth = 6.5
      ctx.beginPath()
      ctx.moveTo(s.a[0], s.a[1])
      ctx.quadraticCurveTo(mx + nx * bulge, my - bulge * 0.4, s.c[0], s.c[1])
      ctx.stroke()
      for (const p of [s.a, s.b, s.c]) {
        ctx.fillStyle = '#c4122f'
        ctx.beginPath()
        ctx.arc(p[0], p[1], 5, 0, TAU)
        ctx.fill()
        ctx.fillStyle = '#eef3f8'
        ctx.beginPath()
        ctx.arc(p[0], p[1], 2.4, 0, TAU)
        ctx.fill()
      }
    })
  }

  private drawPlunger(ctx: CanvasRenderingContext2D) {
    const g = this.game
    const tipY = PLUNGER_Y + g.plungerY() + 2
    const x = LANE_X
    // The spring.
    ctx.strokeStyle = '#b9c3cf'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    const coils = 9
    const bottom = TH + 4
    for (let i = 0; i <= coils * 2; i++) {
      const yy = tipY + 8 + ((bottom - tipY - 8) * i) / (coils * 2)
      const xx = x + (i % 2 ? 8 : -8)
      if (i === 0) ctx.moveTo(x, yy)
      else ctx.lineTo(xx, yy)
    }
    ctx.stroke()
    // The rod and its tip.
    ctx.fillStyle = '#8a96a6'
    ctx.fillRect(x - 2.5, tipY, 5, bottom - tipY)
    const tip = ctx.createLinearGradient(x - 12, 0, x + 12, 0)
    tip.addColorStop(0, '#5b6573')
    tip.addColorStop(0.5, '#ffffff')
    tip.addColorStop(1, '#5b6573')
    ctx.fillStyle = tip
    ctx.beginPath()
    ctx.roundRect(LANE_X0 + 3, tipY, LANE_X1 - LANE_X0 - 6, 9, 3)
    ctx.fill()
    // Power gauge while pulling.
    if (g.charge > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(LANE_X0 - 14, PLUNGER_Y - 92, 7, 84)
      ctx.fillStyle = `hsl(${120 - g.charge * 120},90%,55%)`
      ctx.fillRect(LANE_X0 - 14, PLUNGER_Y - 8 - 84 * g.charge, 7, 84 * g.charge)
    }
  }

  private drawTeacup(ctx: CanvasRenderingContext2D, b: { x: number; y: number; r: number; age: number; spin: number }, i: number) {
    const hot = b.age < 0.12
    const color = BUMPER_COLORS[i % 3]
    ctx.save()
    // Shadow and saucer.
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.arc(b.x + 4, b.y + 6, b.r + 8, 0, TAU)
    ctx.fill()
    const saucer = ctx.createRadialGradient(b.x - 6, b.y - 6, 4, b.x, b.y, b.r + 8)
    saucer.addColorStop(0, '#ffffff')
    saucer.addColorStop(0.8, '#e9dcf2')
    saucer.addColorStop(1, '#9b86b8')
    ctx.fillStyle = saucer
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r + 7, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = C.gold
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r + 5, 0, TAU)
    ctx.stroke()
    // The cup, turning: its handle and painted spots go round.
    ctx.translate(b.x, b.y)
    ctx.rotate(b.spin)
    ctx.fillStyle = '#f4ecff'
    ctx.beginPath()
    ctx.arc(b.r + 1, 0, 6, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#c9b6e4'
    ctx.beginPath()
    ctx.arc(b.r + 1, 0, 3, 0, TAU)
    ctx.fill()
    const cup = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.3, 2, 0, 0, b.r)
    cup.addColorStop(0, '#ffffff')
    cup.addColorStop(0.5, hot ? '#ffffff' : color)
    cup.addColorStop(1, hot ? color : shadeOf(color))
    ctx.fillStyle = cup
    ctx.beginPath()
    ctx.arc(0, 0, b.r, 0, TAU)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.75)'
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU
      ctx.beginPath()
      ctx.arc(Math.cos(a) * b.r * 0.8, Math.sin(a) * b.r * 0.8, 2.2, 0, TAU)
      ctx.fill()
    }
    // Inside: the seat and the wheel the riders turn.
    ctx.fillStyle = shadeOf(color)
    ctx.beginPath()
    ctx.arc(0, 0, b.r * 0.62, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, b.r * 0.3, 0, TAU)
    ctx.stroke()
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(a) * b.r * 0.3, Math.sin(a) * b.r * 0.3)
      ctx.stroke()
    }
    ctx.restore()
    if (hot) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const glow = ctx.createRadialGradient(b.x, b.y, b.r * 0.5, b.x, b.y, b.r * 2.4)
      glow.addColorStop(0, color)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.6
      ctx.fillStyle = glow
      ctx.fillRect(b.x - b.r * 2.4, b.y - b.r * 2.4, b.r * 4.8, b.r * 4.8)
      ctx.restore()
    }
  }

  private drawFlipper(ctx: CanvasRenderingContext2D, f: Flipper) {
    const [tx, ty] = this.game.tipOf(f)
    const shape = (dx: number, dy: number, grow: number) => {
      const a = Math.atan2(ty - f.py, tx - f.px)
      const n = a + Math.PI / 2
      ctx.beginPath()
      ctx.arc(f.px + dx, f.py + dy, f.r1 + grow, n, n + Math.PI)
      ctx.arc(tx + dx, ty + dy, f.r2 + grow, n + Math.PI, n)
      ctx.closePath()
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    shape(4, 6, 0)
    ctx.fill()
    // The red rubber ring, then the white plastic body.
    ctx.fillStyle = '#d0142f'
    shape(0, 0, 0)
    ctx.fill()
    const body = ctx.createLinearGradient(f.px, f.py - 10, f.px, f.py + 10)
    body.addColorStop(0, '#ffffff')
    body.addColorStop(1, '#d8dde6')
    ctx.fillStyle = body
    shape(0, 0, -2.4)
    ctx.fill()
    // A stripe and the chrome pivot cap.
    ctx.strokeStyle = C.magenta
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(f.px + (tx - f.px) * 0.25, f.py + (ty - f.py) * 0.25)
    ctx.lineTo(f.px + (tx - f.px) * 0.85, f.py + (ty - f.py) * 0.85)
    ctx.stroke()
    const cap = ctx.createRadialGradient(f.px - 2, f.py - 2, 0.5, f.px, f.py, 6)
    cap.addColorStop(0, '#ffffff')
    cap.addColorStop(1, '#6b7686')
    ctx.fillStyle = cap
    ctx.beginPath()
    ctx.arc(f.px, f.py, 5, 0, TAU)
    ctx.fill()
  }

  /** A chrome ball: the night sky above and the purple playfield below reflected in it, the lamps as specks, a sharp highlight. */
  private chrome(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.clip()
    // Reflection: the bright sky over a dark horizon, then the playfield.
    const env = ctx.createLinearGradient(x, y - r, x, y + r)
    env.addColorStop(0, '#f4f7ff')
    env.addColorStop(0.32, '#b9c4d8')
    env.addColorStop(0.47, '#4d4566')
    env.addColorStop(0.53, '#241638')
    env.addColorStop(0.75, '#6b4a8f')
    env.addColorStop(1, '#2a1840')
    ctx.fillStyle = env
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    // The lamps round about, as coloured specks along the horizon.
    const specks = [C.magenta, C.gold, C.teal, C.sky, C.pink]
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = specks[i]
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.ellipse(x - r * 0.75 + i * r * 0.38, y + r * 0.1 + Math.abs(i - 2) * r * 0.06, r * 0.1, r * 0.05, 0, 0, TAU)
      ctx.fill()
    }
    ctx.globalAlpha = 1
    // Round shading: dark towards the edge, as a sphere.
    const shade = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.2, x, y, r)
    shade.addColorStop(0, 'rgba(255,255,255,0.15)')
    shade.addColorStop(0.7, 'rgba(0,0,0,0)')
    shade.addColorStop(1, 'rgba(10,0,20,0.6)')
    ctx.fillStyle = shade
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
    // A rim of light from the playfield below.
    ctx.strokeStyle = 'rgba(255,150,220,0.45)'
    ctx.lineWidth = r * 0.12
    ctx.beginPath()
    ctx.arc(x, y, r * 0.95, Math.PI * 0.15, Math.PI * 0.85)
    ctx.stroke()
    ctx.restore()
    // The highlights: a sharp window of light and a soft glint.
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.ellipse(x - r * 0.36, y - r * 0.42, r * 0.26, r * 0.15, -0.6, 0, TAU)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.beginPath()
    ctx.arc(x + r * 0.35, y + r * 0.45, r * 0.08, 0, TAU)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    ctx.arc(x, y, r, 0, TAU)
    ctx.stroke()
  }

  private drawBall(ctx: CanvasRenderingContext2D, b: Ball, alpha: number, raised: boolean) {
    const x = b.px + (b.x - b.px) * alpha
    const y = b.py + (b.y - b.py) * alpha
    const r = raised ? BALL_R * 1.12 : BALL_R
    // A trail when it flies.
    const trail = this.trails.get(b)
    const speed = Math.hypot(b.vx, b.vy)
    if (trail && (speed > 900 || raised)) {
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      trail.forEach((p, i) => {
        ctx.globalAlpha = 0.12 * (1 - i / trail.length)
        ctx.fillStyle = raised ? C.magenta : '#bcd6ff'
        ctx.beginPath()
        ctx.arc(p.x, p.y, r * (1 - i / 10), 0, TAU)
        ctx.fill()
      })
      ctx.restore()
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.ellipse(x + (raised ? 10 : 3), y + (raised ? 14 : 5), r, r * 0.85, 0, 0, TAU)
    ctx.fill()
    this.chrome(ctx, x, y, r)
  }

  /** The coaster's cars behind the ball while it rides. */
  private drawTrain(ctx: CanvasRenderingContext2D, b: Ball) {
    const colors = [C.red, C.gold, C.sky]
    for (let k = 3; k >= 1; k--) {
      const p = trackAt(b.t - k * 22)
      const a = Math.atan2(p.dy, p.dx)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(a)
      ctx.fillStyle = 'rgba(0,0,0,0.4)'
      ctx.beginPath()
      ctx.roundRect(-10 + 8, -9 + 12, 20, 18, 4)
      ctx.fill()
      const body = ctx.createLinearGradient(0, -9, 0, 9)
      body.addColorStop(0, '#ffffff')
      body.addColorStop(0.3, colors[k - 1])
      body.addColorStop(1, shadeOf(colors[k - 1]))
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.roundRect(-10, -9, 20, 18, 4)
      ctx.fill()
      // Two riders with their arms up.
      ctx.fillStyle = '#ffd9b3'
      for (const dy of [-4, 4]) {
        ctx.beginPath()
        ctx.arc(-1, dy, 2.6, 0, TAU)
        ctx.fill()
      }
      ctx.strokeStyle = '#ffd9b3'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.moveTo(-1, -4)
      ctx.lineTo(-7, -9)
      ctx.moveTo(-1, 4)
      ctx.lineTo(-7, 9)
      ctx.stroke()
      ctx.restore()
    }
  }

  private drawBanner(ctx: CanvasRenderingContext2D) {
    const b = this.banner
    if (!b) return
    const k = Math.min(1, b.t / 0.2)
    const out = Math.min(1, (b.life - b.t) / 0.3)
    const scale = 0.6 + 0.4 * (1 - Math.pow(1 - k, 3)) + Math.sin(k * Math.PI) * 0.12
    ctx.save()
    ctx.globalAlpha = out
    const [bx, by] = project(TW / 2 - 10, 430)
    ctx.translate(bx, by)
    ctx.scale(scale * 1.25, scale * 1.25)
    ctx.fillStyle = 'rgba(10,4,24,0.72)'
    ctx.beginPath()
    ctx.roundRect(-230, -48, 460, 96, 18)
    ctx.fill()
    ctx.strokeStyle = b.color
    ctx.lineWidth = 2.5
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    glowText(ctx, b.title, 0, -10, b.color, b.title.length > 14 ? 30 : 38, 900)
    ctx.font = `700 15px ${FONT}`
    ctx.fillStyle = '#fff'
    ctx.fillText(b.sub, 0, 28)
    ctx.restore()
  }
}

function rideHint(r: Ride): string {
  switch (r) {
    case 'coaster':
      return 'Shoot the loop on the left 3 times'
    case 'wheel':
      return 'Lock 3 balls in the scoop: multiball'
    case 'teacups':
      return 'Spin the teacups 30 times'
    case 'striker':
      return 'Hit the pad hard enough to ring the bell'
    case 'gallery':
      return 'Knock down all four ducks'
    case 'carousel':
      return 'Ride the turntable for 5 seconds'
  }
}

/** A colour a good deal darker. */
function shadeOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.round(v * 0.55)
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}
