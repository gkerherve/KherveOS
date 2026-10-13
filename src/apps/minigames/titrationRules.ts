// Titration Rush: ten titrations against the clock. Open the burette (hold
// Space) or add a drop at a time (↓ or a click), watch the indicator, and call
// the end point (Enter) the moment the colour turns for good. The score is how
// close the volume is to the true equivalence point, plus the seconds left.
// The first rounds show a pH meter and the curve; from round 5 you also pick
// the indicator, and a poorly chosen one turns far from the equivalence point.
//
// The chemistry is exact: the pH comes from the charge balance (water, the
// analyte's acid–base forms, the titrant's spectator ions), solved by
// bisection. Plain logic with no DOM, so it can be tested on its own.

export const STEP = 1 / 60
export const ROUNDS = 10
/** Seconds per round. */
export const ROUND_TIME = 45
/** mL a second with the stopcock open, and in one drop. */
export const STREAM = 2
export const DROP = 0.05
export const BURETTE_ML = 50
/** Rounds with the pH meter and curve shown. */
export const TRAINING = 4
/** First round where the player picks the indicator. */
export const CHOOSE_FROM = 5
/** Points for a perfect end point, lost linearly up to this error (mL). */
export const MAX_POINTS = 1000
export const ZERO_AT = 1
export const GOOD_INDICATOR_BONUS = 200
const KW = 1e-14

export interface Analyte {
  name: string
  formula: string
  /** An acid titrated with NaOH, or a base titrated with HCl. */
  kind: 'acid' | 'base'
  /** pKa values of the acid (for a base: of its conjugate acid). Strong ones are given as -2. */
  pKa: number[]
}

export interface Indicator {
  name: string
  pKin: number
  /** Colour of the acid form and the base form (null = colourless). */
  acid: string | null
  base: string | null
}

export const ANALYTES: Analyte[] = [
  { name: 'hydrochloric acid', formula: 'HCl', kind: 'acid', pKa: [-2] },
  { name: 'acetic acid', formula: 'CH₃COOH', kind: 'acid', pKa: [4.76] },
  { name: 'formic acid', formula: 'HCOOH', kind: 'acid', pKa: [3.75] },
  { name: 'benzoic acid', formula: 'C₆H₅COOH', kind: 'acid', pKa: [4.2] },
  { name: 'ammonia', formula: 'NH₃', kind: 'base', pKa: [9.25] },
  { name: 'sodium hydroxide', formula: 'NaOH', kind: 'base', pKa: [16] },
  { name: 'oxalic acid', formula: 'H₂C₂O₄', kind: 'acid', pKa: [1.25, 4.27] },
]

export const INDICATORS: Indicator[] = [
  { name: 'methyl orange', pKin: 3.7, acid: '#e8412c', base: '#f2c218' },
  { name: 'methyl red', pKin: 5.1, acid: '#e0284a', base: '#f2d21c' },
  { name: 'bromothymol blue', pKin: 7.1, acid: '#e2cf2a', base: '#2a5fd8' },
  { name: 'phenolphthalein', pKin: 9.3, acid: null, base: '#e0218a' },
]

export interface Setup {
  analyte: Analyte
  /** Flask volume and concentration (M), titrant concentration (M). */
  volume: number
  conc: number
  titrant: number
  indicator: Indicator
}

/** Average number of protons the analyte has lost at this [H+] (0 … n), for an acid; bound, for a base. */
function protonsLost(pKa: number[], h: number): number {
  // Terms h^(n-i) · K1…Ki, scaled to avoid overflow by working in logs.
  const n = pKa.length
  const logs: number[] = []
  let sumPK = 0
  const lh = Math.log10(h)
  for (let i = 0; i <= n; i++) {
    if (i > 0) sumPK += pKa[i - 1]
    logs.push((n - i) * lh - sumPK)
  }
  const top = Math.max(...logs)
  let s = 0
  let w = 0
  logs.forEach((l, i) => {
    const t = Math.pow(10, l - top)
    s += t
    w += i * t
  })
  return w / s
}

/** pH of the flask after `added` mL of titrant. */
export function phAt(s: Setup, added: number): number {
  const vt = s.volume + added
  const c = (s.conc * s.volume) / vt
  const spectator = (s.titrant * added) / vt
  const n = s.analyte.pKa.length
  // Charge balance, positive minus negative: falls as the pH rises.
  const f = (pH: number) => {
    const h = Math.pow(10, -pH)
    const oh = KW / h
    if (s.analyte.kind === 'acid') return h + spectator - oh - c * protonsLost(s.analyte.pKa, h)
    // A base: its protonated forms carry the charge; Cl⁻ from the HCl.
    return h + c * (n - protonsLost(s.analyte.pKa, h)) - oh - spectator
  }
  let lo = -2
  let hi = 16
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** The volume (mL) of the last equivalence point. */
export function equivalence(s: Setup): number {
  return (s.analyte.pKa.length * s.conc * s.volume) / s.titrant
}

/** Volume where the pH crosses a value (the indicator's colour change), by bisection; null if never within the burette. */
export function volumeAtPH(s: Setup, pH: number, max = BURETTE_ML): number | null {
  const rising = s.analyte.kind === 'acid'
  const past = (v: number) => (rising ? phAt(s, v) >= pH : phAt(s, v) <= pH)
  if (past(0)) return 0
  if (!past(max)) return null
  let lo = 0
  let hi = max
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (past(mid)) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

/** How far (mL) the indicator's colour change lies from the equivalence point. */
export function indicatorError(s: Setup, ind: Indicator = s.indicator): number {
  const v = volumeAtPH(s, ind.pKin)
  return v === null ? Infinity : Math.abs(v - equivalence(s))
}

/** A good indicator turns within 0.1 mL of the equivalence point. */
export const goodIndicator = (s: Setup, ind: Indicator = s.indicator) => indicatorError(s, ind) <= 0.1

/** Points for an end point `error` mL from the equivalence point. */
export function accuracyPoints(error: number): number {
  return Math.round(MAX_POINTS * Math.max(0, 1 - error / ZERO_AT))
}

/** Fraction of the indicator in its base form at this pH. */
export const baseFraction = (ind: Indicator, pH: number) => 1 / (1 + Math.pow(10, ind.pKin - pH))

export interface RoundResult {
  round: number
  analyte: string
  indicator: string
  added: number
  equivalence: number
  error: number
  points: number
  bonus: number
  timeBonus: number
  timedOut: boolean
}

export type Phase = 'choose' | 'titrate' | 'result' | 'over'

export type TitrationEvent =
  | { type: 'drop' }
  | { type: 'open' }
  | { type: 'close' }
  | { type: 'empty' }
  | { type: 'choose'; indicator: Indicator; good: boolean }
  | { type: 'result'; result: RoundResult }
  | { type: 'round'; round: number }
  | { type: 'over' }

export class TitrationRush {
  round = 1
  phase: Phase = 'titrate'
  setup!: Setup
  added = 0
  pH = 7
  /** pH against volume, for the curve. */
  trace: [number, number][] = []
  open = false
  timeLeft = ROUND_TIME
  score = 0
  results: RoundResult[] = []
  /** A wash of colour where the last drop landed (0..1), fading as it mixes. */
  splash = 0
  events: TitrationEvent[] = []
  stateTime = 0
  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
    this.reset()
  }

  get over(): boolean {
    return this.phase === 'over' && this.stateTime >= 1.2
  }

  /** The pH meter and curve are shown. */
  get training(): boolean {
    return this.round <= TRAINING
  }

  get choosing(): boolean {
    return this.round >= CHOOSE_FROM
  }

  reset() {
    this.round = 1
    this.score = 0
    this.results = []
    this.events = []
    this.startRound()
  }

  private pick<T>(list: T[]): T {
    return list[Math.floor(this.rng() * list.length)]
  }

  /** A titration for this round: easy strong / weak acids first, bases and oxalic acid later. */
  makeSetup(round: number): Setup {
    const pool = round <= 2 ? ANALYTES.slice(0, 2) : round <= 4 ? ANALYTES.slice(0, 5) : ANALYTES
    const analyte = this.pick(pool)
    const volume = this.pick([10, 20, 25])
    const titrant = this.pick([0.1, 0.1, 0.2])
    // Concentration such that the end point falls between 8 and 40 mL.
    const target = 8 + this.rng() * 30
    const conc = Math.round(((target * titrant) / (volume * analyte.pKa.length)) * 1000) / 1000
    const setup: Setup = { analyte, volume, conc, titrant, indicator: INDICATORS[3] }
    setup.indicator = INDICATORS.filter((i) => goodIndicator(setup, i)).sort((a, b) => indicatorError(setup, a) - indicatorError(setup, b))[0] ?? INDICATORS[2]
    return setup
  }

  private startRound() {
    this.setup = this.makeSetup(this.round)
    this.added = 0
    this.pH = phAt(this.setup, 0)
    this.trace = [[0, this.pH]]
    this.open = false
    this.splash = 0
    this.timeLeft = ROUND_TIME
    this.phase = this.choosing ? 'choose' : 'titrate'
    this.stateTime = 0
    this.events.push({ type: 'round', round: this.round })
  }

  /** Picks the indicator (rounds from CHOOSE_FROM), by index into INDICATORS. */
  choose(i: number): boolean {
    if (this.phase !== 'choose' || !INDICATORS[i]) return false
    this.setup.indicator = INDICATORS[i]
    this.phase = 'titrate'
    this.events.push({ type: 'choose', indicator: INDICATORS[i], good: goodIndicator(this.setup) })
    return true
  }

  setOpen(open: boolean) {
    if (this.phase !== 'titrate') open = false
    if (open === this.open) return
    this.open = open
    this.events.push({ type: open ? 'open' : 'close' })
  }

  /** Adds titrant (mL); false once the burette is empty. */
  add(ml: number): boolean {
    if (this.phase !== 'titrate') return false
    const room = BURETTE_ML - this.added
    if (room <= 1e-9) {
      this.events.push({ type: 'empty' })
      this.open = false
      return false
    }
    this.added = Math.min(BURETTE_ML, this.added + ml)
    this.pH = phAt(this.setup, this.added)
    const last = this.trace[this.trace.length - 1]
    if (this.added - last[0] >= 0.04) this.trace.push([this.added, this.pH])
    this.splash = 1
    return true
  }

  drop(): boolean {
    if (!this.add(DROP)) return false
    this.events.push({ type: 'drop' })
    return true
  }

  /** Calls the end point at the volume added so far. */
  callEndpoint(): RoundResult | null {
    if (this.phase !== 'titrate') return null
    return this.finish(false)
  }

  private finish(timedOut: boolean): RoundResult {
    this.open = false
    const eq = equivalence(this.setup)
    const error = Math.abs(this.added - eq)
    const points = timedOut ? 0 : accuracyPoints(error)
    const bonus = !timedOut && this.choosing && goodIndicator(this.setup) ? GOOD_INDICATOR_BONUS : 0
    const timeBonus = !timedOut && points > 0 ? Math.round(this.timeLeft * 5) : 0
    const result: RoundResult = {
      round: this.round,
      analyte: this.setup.analyte.name,
      indicator: this.setup.indicator.name,
      added: this.added,
      equivalence: eq,
      error,
      points,
      bonus,
      timeBonus,
      timedOut,
    }
    this.score += points + bonus + timeBonus
    this.results.push(result)
    this.phase = 'result'
    this.stateTime = 0
    this.events.push({ type: 'result', result })
    return result
  }

  /** From the result card to the next round (or the end). */
  next(): boolean {
    if (this.phase !== 'result') return false
    if (this.round >= ROUNDS) {
      this.phase = 'over'
      this.stateTime = 0
      this.events.push({ type: 'over' })
      return true
    }
    this.round++
    this.startRound()
    return true
  }

  update(dt = STEP) {
    this.stateTime += dt
    this.splash = Math.max(0, this.splash - dt * 1.2)
    if (this.phase === 'result' && this.stateTime >= 3.5) this.next()
    if (this.phase !== 'titrate' && this.phase !== 'choose') return
    this.timeLeft = Math.max(0, this.timeLeft - dt)
    if (this.phase === 'titrate' && this.open) this.add(STREAM * dt)
    if (this.timeLeft <= 0) {
      if (this.phase === 'choose') this.setup.indicator = INDICATORS[2]
      this.finish(true)
    }
  }
}
