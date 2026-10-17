// Kherve Grand Prix — the engine sound, built the way an engine makes it.
//
// The crank turns at the revs; every time a cylinder fires, its exhaust valve
// opens and a pressure pulse (a sharp blow-down, then a decay, with the
// combustion's turbulence on it) runs down that cylinder's header pipe. The
// headers have different lengths, so the pulses reach the collector at
// slightly uneven times (the flat-six's howl, the V10's scream). The
// collector feeds the tail pipes, tubes that ring at their own length, and
// the body and silencer, whose resonances stay at fixed frequencies while the
// revs climb (that is what makes it sound like a real engine rather than a
// synthesiser being pitched up). The intake roars with the throttle open.
// Every firing is a little different (more so at idle), lifting off at high
// revs makes the exhaust pop and crackle, a gear change cuts the ignition for
// a moment, and at the limiter the ignition stutters.
//
// `EngineDSP` must stay self-contained (no imports, nothing from this module):
// its source text is also shipped into an AudioWorklet (f1Audio.ts), and the
// tests render it offline.

export type EngineKind = 'v10' | 'flat6' | 'inline4' | 'inline6'

export interface EngineDef {
  /** Firing angles over the 720° cycle of a four-stroke. */
  fire: number[]
  /** Extra delay (ms) of each cylinder's header pipe. */
  pipes: number[]
  /** How long the exhaust pulse lasts, in crank degrees, and how sharp its blow-down is (0..1 of it). */
  pulseDeg: number
  attack: number
  /** Turbulence on each pulse (0..1). */
  hiss: number
  /** Firing-to-firing variation of strength, at full load and at idle. */
  rough: number
  roughIdle: number
  /** Timing scatter of a firing, in crank degrees. */
  jitter: number
  /** Tail pipes: ring delay (ms) and feedback. */
  tubes: number[]
  tubeFb: number
  /** Fixed resonances of the exhaust and body: [Hz, Q, gain]. */
  formants: [number, number, number][]
  /** Silencer cut-off (Hz) at full load. */
  lowpass: number
  /** Saturation at full load (the rasp). */
  drive: number
  /** Intake roar: [Hz, Q, gain]. */
  intake: [number, number, number]
  /** Overall level. */
  level: number
}

const even = (n: number, start = 0) => Array.from({ length: n }, (_, i) => (start + (i * 720) / n) % 720)

export const ENGINES: Record<EngineKind, EngineDef> = {
  // a high-revving V10: ten firings per cycle, short equal headers, a sharp, screaming exhaust
  v10: {
    fire: even(10),
    pipes: [0, 0.06, 0.02, 0.08, 0.04, 0.05, 0.01, 0.07, 0.03, 0.09],
    pulseDeg: 100,
    attack: 0.035,
    hiss: 0.18,
    rough: 0.04,
    roughIdle: 0.14,
    jitter: 0.6,
    tubes: [1.55, 1.9],
    tubeFb: 0.42,
    formants: [
      [950, 1.4, 0.55],
      [2300, 1.8, 0.65],
      [3900, 2.4, 0.4],
      [6200, 3, 0.18],
    ],
    lowpass: 11000,
    drive: 2.4,
    intake: [1500, 1.2, 0.12],
    level: 0.5,
  },
  // the air-cooled flat-six: two banks of three with their own heat exchangers, a hollow, howling note
  flat6: {
    fire: even(6),
    pipes: [0, 0.42, 0.05, 0.47, 0.1, 0.38],
    pulseDeg: 150,
    attack: 0.05,
    hiss: 0.3,
    rough: 0.07,
    roughIdle: 0.22,
    jitter: 1.5,
    tubes: [5.2, 6.1],
    tubeFb: 0.5,
    formants: [
      [340, 1.3, 0.7],
      [1050, 1.6, 0.55],
      [2250, 2, 0.3],
      [3600, 2.6, 0.12],
    ],
    lowpass: 5200,
    drive: 2.2,
    intake: [620, 1.6, 0.35],
    level: 0.62,
  },
  // a small four on twin carburettors: a buzzy, rasping bark
  inline4: {
    fire: even(4),
    pipes: [0, 0.18, 0.09, 0.27],
    pulseDeg: 170,
    attack: 0.04,
    hiss: 0.34,
    rough: 0.09,
    roughIdle: 0.25,
    jitter: 2,
    tubes: [3.9],
    tubeFb: 0.55,
    formants: [
      [480, 1.2, 0.6],
      [1500, 1.8, 0.7],
      [3100, 2.2, 0.35],
    ],
    lowpass: 6500,
    drive: 3.2,
    intake: [480, 2.2, 0.45],
    level: 0.6,
  },
  // the big straight-six: smooth, deep and silky, opening into a hard metallic wail
  inline6: {
    fire: even(6),
    pipes: [0, 0.12, 0.24, 0.06, 0.18, 0.3],
    pulseDeg: 140,
    attack: 0.045,
    hiss: 0.24,
    rough: 0.05,
    roughIdle: 0.16,
    jitter: 1,
    tubes: [6.8, 7.3],
    tubeFb: 0.46,
    formants: [
      [290, 1.1, 0.7],
      [870, 1.5, 0.55],
      [1900, 1.9, 0.4],
      [3300, 2.5, 0.16],
    ],
    lowpass: 4800,
    drive: 2,
    intake: [540, 1.5, 0.3],
    level: 0.6,
  },
}

export class EngineDSP {
  sr: number
  def: EngineDef | null = null
  /** Crank angle in the cycle, degrees. */
  theta = 0
  /** Active exhaust pulses: elapsed and length (samples), strength, and an afterfire flag. */
  pEl: Float32Array = new Float32Array(32)
  pDur: Float32Array = new Float32Array(32)
  pAmp: Float32Array = new Float32Array(32)
  pPop: Uint8Array = new Uint8Array(32)
  pOn: Uint8Array = new Uint8Array(32)
  // tail pipes: ring buffers with a damping filter in the loop
  tubeBuf: Float32Array[] = []
  tubeLen: number[] = []
  tubePos: number[] = []
  tubeLp: number[] = []
  // resonances (biquad band-passes): coefficients and two states each
  fb: Float32Array = new Float32Array(0)
  fz: Float32Array = new Float32Array(0)
  ib: Float32Array = new Float32Array(5)
  iz: Float32Array = new Float32Array(2)
  lp1 = 0
  lp2 = 0
  dcX = 0
  dcY = 0
  env = 0
  noiseLp = 0
  seed = 22222
  /** Ignition cut left (samples): a gear change. */
  cutLeft = 0
  /** Afterfire left (seconds): lifting off at high revs. */
  crackle = 0
  redline = 12400
  idle = 4200
  load = 0

  constructor(sr: number) {
    this.sr = sr
  }

  rand(): number {
    // xorshift: the same in the worklet and in the tests, and cheap
    let x = this.seed
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.seed = x >>> 0
    return this.seed / 4294967296
  }

  gauss(): number {
    return (this.rand() + this.rand() + this.rand() - 1.5) * 1.15
  }

  bandpass(out: Float32Array, at: number, f: number, q: number, g: number) {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    out[at] = (alpha / a0) * g
    out[at + 1] = 0
    out[at + 2] = (-alpha / a0) * g
    out[at + 3] = (-2 * Math.cos(w)) / a0
    out[at + 4] = (1 - alpha) / a0
  }

  configure(def: EngineDef) {
    this.def = def
    this.tubeBuf = []
    this.tubeLen = []
    this.tubePos = []
    this.tubeLp = []
    for (const ms of def.tubes) {
      const n = Math.max(2, Math.round((ms / 1000) * this.sr))
      this.tubeBuf.push(new Float32Array(n))
      this.tubeLen.push(n)
      this.tubePos.push(0)
      this.tubeLp.push(0)
    }
    this.fb = new Float32Array(def.formants.length * 5)
    this.fz = new Float32Array(def.formants.length * 2)
    def.formants.forEach(([f, q, g], k) => this.bandpass(this.fb, k * 5, f, q, g))
    this.bandpass(this.ib, 0, def.intake[0], def.intake[1], 1)
    this.pOn.fill(0)
  }

  cut(ms: number) {
    this.cutLeft = Math.round((ms / 1000) * this.sr)
  }

  /** A firing: start that cylinder's pulse down its header (or skip it when the ignition is cut). */
  fire(cyl: number, rpm: number, throttle: number) {
    const d = this.def!
    const degPerSample = (rpm * 6) / this.sr
    const revs = Math.max(0, Math.min(1, (rpm - this.idle) / Math.max(1, this.redline - this.idle)))
    const limiter = rpm > this.redline - 40 && throttle > 0.5
    let pop = 0
    if (this.cutLeft > 0 || (limiter && this.rand() < 0.55)) {
      // unburnt fuel: now and then it goes off in the hot exhaust
      if (this.rand() < 0.25) pop = 1
      else return
    }
    if (!pop && throttle < 0.12 && this.crackle > 0 && revs > 0.25 && this.rand() < 0.22) pop = 1
    let slot = -1
    for (let i = 0; i < 32; i++)
      if (!this.pOn[i]) {
        slot = i
        break
      }
    if (slot < 0) return
    const rough = d.rough + (d.roughIdle - d.rough) * (1 - revs) * (1 - throttle * 0.6)
    // burning at full throttle, a thin, wet puff off it (the overrun)
    const strength = pop ? 1.1 + this.rand() * 0.9 : (0.3 + 0.7 * Math.pow(throttle, 0.8)) * Math.max(0.2, 1 + rough * this.gauss())
    const delay = (d.pipes[cyl % d.pipes.length] / 1000) * this.sr + (d.jitter * this.gauss()) / degPerSample
    this.pOn[slot] = 1
    this.pPop[slot] = pop
    this.pAmp[slot] = strength
    this.pDur[slot] = pop ? this.sr * (0.012 + this.rand() * 0.02) : Math.max(8, d.pulseDeg / degPerSample)
    this.pEl[slot] = -Math.max(0, delay)
  }

  /** Fills `out` (mono) with the engine, the revs moving from rpm0 to rpm1 over the block. */
  process(out: Float32Array, rpm0: number, rpm1: number, throttle: number) {
    const d = this.def
    if (!d) {
      out.fill(0)
      return
    }
    const n = out.length
    const nF = d.formants.length
    const fire = d.fire
    // the load follows the throttle a little slowly (the gases take a moment)
    const loadTarget = Math.max(0, Math.min(1, throttle))
    const lpCut = d.lowpass * (0.38 + 0.62 * this.load)
    const a = 1 - Math.exp((-2 * Math.PI * lpCut) / this.sr)
    const drive = 1 + (d.drive - 1) * (0.35 + 0.65 * this.load)
    const norm = 1 / Math.tanh(drive * 0.6)
    for (let s = 0; s < n; s++) {
      const rpm = rpm0 + ((rpm1 - rpm0) * s) / n
      this.load += (loadTarget - this.load) * 0.0006
      const step = (rpm * 6) / this.sr
      const prev = this.theta
      let th = prev + step
      if (th >= 720) th -= 720
      this.theta = th
      for (let c = 0; c < fire.length; c++) {
        const f = fire[c]
        if (th >= prev ? f > prev && f <= th : f > prev || f <= th) this.fire(c, rpm, throttle)
      }
      if (this.cutLeft > 0) this.cutLeft--
      // the collector: every live pulse
      let col = 0
      let turb = 0
      const wn = this.rand() * 2 - 1
      for (let i = 0; i < 32; i++) {
        if (!this.pOn[i]) continue
        const el = this.pEl[i]
        this.pEl[i] = el + 1
        if (el < 0) continue
        const x = el / this.pDur[i]
        if (x >= 1) {
          this.pOn[i] = 0
          continue
        }
        let p: number
        if (this.pPop[i]) {
          // an afterfire: a crack of noise
          p = Math.exp(-x * 5) * this.pAmp[i]
          turb += p * 1.6
          col += p * 0.6 * (x < 0.05 ? x / 0.05 : 1)
          continue
        }
        const at = d.attack
        p = x < at ? Math.sin((x / at) * Math.PI * 0.5) : Math.exp(-(x - at) * 4.2) * (1 - x) * (1 - x)
        p *= this.pAmp[i]
        col += p
        turb += p
      }
      this.noiseLp += (wn - this.noiseLp) * 0.5
      const gas = col + turb * d.hiss * (wn * 0.7 + this.noiseLp * 0.3)
      // the tail pipes ring at their length
      let tail = 0
      for (let k = 0; k < this.tubeBuf.length; k++) {
        const buf = this.tubeBuf[k]
        const pos = this.tubePos[k]
        const old = buf[pos]
        this.tubeLp[k] += (old - this.tubeLp[k]) * 0.45
        const y = gas + this.tubeLp[k] * d.tubeFb
        buf[pos] = y
        this.tubePos[k] = pos + 1 >= this.tubeLen[k] ? 0 : pos + 1
        tail += y
      }
      tail /= this.tubeBuf.length
      // the body and the silencer's fixed resonances, over the direct sound
      let res = tail * 0.35
      for (let k = 0; k < nF; k++) {
        const b = k * 5
        const z = k * 2
        const y = this.fb[b] * tail + this.fz[z]
        this.fz[z] = this.fb[b + 1] * tail - this.fb[b + 3] * y + this.fz[z + 1]
        this.fz[z + 1] = this.fb[b + 2] * tail - this.fb[b + 4] * y
        res += y
      }
      // the silencer
      this.lp1 += (res - this.lp1) * a
      this.lp2 += (this.lp1 - this.lp2) * a
      // the intake: air rushing in, in time with the firing, with the throttle open
      this.env += (Math.min(2, col) - this.env) * 0.02
      const iy = this.ib[0] * wn + this.iz[0]
      this.iz[0] = this.ib[1] * wn - this.ib[3] * iy + this.iz[1]
      this.iz[1] = this.ib[2] * wn - this.ib[4] * iy
      const intake = iy * d.intake[2] * this.load * (0.4 + 0.6 * this.env)
      // the rasp: the louder, the harder it saturates
      let v = Math.tanh((this.lp2 + intake) * drive * 0.6) * norm
      // no DC
      const y = v - this.dcX + 0.995 * this.dcY
      this.dcX = v
      this.dcY = y
      v = y * d.level
      out[s] = v !== v ? 0 : v
    }
    if (this.crackle > 0) this.crackle -= n / this.sr
  }
}
