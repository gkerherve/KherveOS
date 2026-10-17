// Kherve Grand Prix: the sound, synthesised with WebAudio (no sound files).
// An engine is its firing frequency (revs / 20 for six cylinders) played
// through a waveform shaped for that engine (a high, rasping turbo V6 for the
// single-seaters, a deeper flat-six with an uneven burble for the coupés),
// with the crank's half-order note under it, a distorted rasp that grows with
// the throttle, and a band of exhaust roar following the revs. Lifting off at
// high revs pops and crackles; a gear change cuts the note for a moment. The
// single-seater adds its turbo whistle, blow-off and hybrid whine, the coupé
// its straight-cut gearbox whine. Inside the cockpit the sound is muffled and
// boomy, from the chase camera open, from the trackside far away. The two
// nearest other cars have voices of their own (Doppler, distance). Tyres,
// wind, kerbs and the crowd come on top.

import type { Series } from './f1Physics.ts'
import { EngineDSP, ENGINES, type EngineKind } from './f1EngineDSP.ts'

export type { EngineKind }

/** Which engine a car has: the single-seaters a V10, each coupé its own. */
export function engineOf(series: Series, model?: string): EngineKind {
  if (series === 'modern') return 'v10'
  return model === 'dieppe' ? 'inline4' : model === 'bavaria' ? 'inline6' : 'flat6'
}

// The engines run in an AudioWorklet (the source of EngineDSP, shipped as a module), loaded once per audio context.
const worklets = new WeakMap<BaseAudioContext, Promise<boolean>>()

/** The worklet module's source: EngineDSP's own code, the engine table and the processor. */
export function workletSource(): string {
  return `const EngineDSP = (${EngineDSP.toString()});
const ENGINES = ${JSON.stringify(ENGINES)};
class KherveEngine extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'rpm', defaultValue: 1000, minValue: 0, maxValue: 30000, automationRate: 'k-rate' }, { name: 'throttle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]
  }
  constructor() {
    super()
    this.d = new EngineDSP(sampleRate)
    this.d.seed = (Math.random() * 4294967295) >>> 0 || 1
    this.d.configure(ENGINES.v10)
    this.last = 1000
    this.alive = true
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.engine) this.d.configure(ENGINES[m.engine])
      if (m.idle) this.d.idle = m.idle
      if (m.redline) this.d.redline = m.redline
      if (m.cut) this.d.cut(m.cut)
      if (m.crackle) this.d.crackle = m.crackle
      if (m.stop) this.alive = false
    }
  }
  process(inputs, outputs, params) {
    const out = outputs[0][0]
    const rpm = params.rpm[0]
    this.d.process(out, this.last, rpm, params.throttle[0])
    this.last = rpm
    return this.alive
  }
}
registerProcessor('kherve-engine', KherveEngine)
`
}

function loadWorklet(ac: AudioContext): Promise<boolean> {
  let p = worklets.get(ac)
  if (!p) {
    const src = workletSource()
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))
    p = (ac.audioWorklet ? ac.audioWorklet.addModule(url) : Promise.reject(new Error('no AudioWorklet')))
      .then(() => true)
      .catch(() => false)
      .finally(() => URL.revokeObjectURL(url))
    worklets.set(ac, p)
  }
  return p
}

interface Voice {
  readonly out: GainNode
  drive(rpm: number, throttle: number, vol: number, open: number, bass: number): void
  cut(depth: number, ms: number): void
  setWave(series: Series): void
  setEngine(kind: EngineKind, idle: number, redline: number): void
  crackle(seconds: number): void
  stop(): void
}

export type Listener = 'cockpit' | 'chase' | 'far'

export interface PlayerSound {
  rpm: number
  idle: number
  redline: number
  throttle: number
  gear: number
  /** m/s */
  speed: number
  slide: number
  kerb: number
  listener: Listener
  /** The engine runs (not parked in the garage). */
  on: boolean
  engine: EngineKind
}

/** Harmonic weights of the engine note: which orders of the firing frequency are loud. */
function harmonics(series: Series, sharp: number): { real: Float32Array; imag: Float32Array } {
  const N = 40
  const real = new Float32Array(N)
  const imag = new Float32Array(N)
  for (let n = 1; n < N; n++) {
    let a: number
    if (series === 'modern') {
      // the turbo V6: bright, with strong 3rd and 6th orders, a thin top end
      a = Math.pow(n, -0.75 + sharp * 0.2) * (n % 3 === 0 ? 1.7 : 1) * (n === 2 ? 1.3 : 1)
    } else {
      // the flat-six: fuller and lower, the 1st and 3rd orders strong, a ragged top
      a = Math.pow(n, -0.55) * (n % 3 === 0 ? 1.9 : 1) * (n === 1 ? 1.5 : 1) * (n % 2 === 0 ? 0.75 : 1)
    }
    imag[n] = a * (n % 2 ? 1 : -1)
  }
  return { real, imag }
}

function distortion(ac: AudioContext, k: number): WaveShaperNode {
  const ws = ac.createWaveShaper()
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  ws.curve = curve
  ws.oversample = '2x'
  return ws
}

/** One engine: note, half-order, rasp, exhaust roar, through a tone filter. */
class EngineVoice implements Voice {
  private ac: AudioContext
  private note: OscillatorNode
  private half: OscillatorNode
  private raspOsc: OscillatorNode
  private noteG: GainNode
  private halfG: GainNode
  private raspG: GainNode
  private raspF: BiquadFilterNode
  private roarF: BiquadFilterNode
  private roarG: GainNode
  private tone: BiquadFilterNode
  private boom: BiquadFilterNode
  readonly out: GainNode
  private series: Series
  private srcs: AudioScheduledSourceNode[] = []

  constructor(ac: AudioContext, dest: AudioNode, noise: AudioBuffer, series: Series) {
    this.ac = ac
    this.series = series
    const osc = (type?: OscillatorType) => {
      const o = ac.createOscillator()
      if (type) o.type = type
      o.start()
      this.srcs.push(o)
      return o
    }
    const gain = (v: number) => {
      const g = ac.createGain()
      g.gain.value = v
      return g
    }
    this.note = osc()
    this.setWave(series)
    this.half = osc('triangle')
    this.raspOsc = osc('sawtooth')
    this.noteG = gain(0)
    this.halfG = gain(0)
    this.raspG = gain(0)
    this.raspF = ac.createBiquadFilter()
    this.raspF.type = 'bandpass'
    this.raspF.Q.value = 1.2
    const shaper = distortion(ac, 6)
    const ns = ac.createBufferSource()
    ns.buffer = noise
    ns.loop = true
    ns.start(0, Math.random())
    this.srcs.push(ns)
    this.roarF = ac.createBiquadFilter()
    this.roarF.type = 'bandpass'
    this.roarF.Q.value = 1.6
    this.roarG = gain(0)
    this.tone = ac.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.Q.value = 0.8
    this.boom = ac.createBiquadFilter()
    this.boom.type = 'lowshelf'
    this.boom.frequency.value = 220
    this.out = gain(0)
    this.note.connect(this.noteG).connect(this.tone)
    this.half.connect(this.halfG).connect(this.tone)
    this.raspOsc.connect(shaper).connect(this.raspF).connect(this.raspG).connect(this.tone)
    ns.connect(this.roarF).connect(this.roarG).connect(this.tone)
    this.tone.connect(this.boom).connect(this.out).connect(dest)
  }

  setWave(series: Series) {
    this.series = series
    const h = harmonics(series, 0)
    this.note.setPeriodicWave(this.ac.createPeriodicWave(h.real, h.imag))
  }

  setEngine() {}

  crackle() {}

  private set(p: AudioParam, v: number, tc = 0.03) {
    p.setTargetAtTime(v, this.ac.currentTime, tc)
  }

  /** rpm, throttle (0..1), loudness, how open the sound is (0 muffled .. 1 open), extra bass (dB). */
  drive(rpm: number, throttle: number, vol: number, open: number, bass: number) {
    const f0 = Math.max(25, rpm / 20)
    const modern = this.series === 'modern'
    const load = 0.25 + 0.75 * throttle
    this.set(this.note.frequency, f0, 0.015)
    this.set(this.half.frequency, f0 / 2, 0.015)
    this.set(this.raspOsc.frequency, f0 * (modern ? 1 : 0.5), 0.015)
    this.set(this.raspF.frequency, f0 * (modern ? 3 : 2.2))
    this.set(this.roarF.frequency, Math.min(6000, f0 * (modern ? 2.5 : 1.6)))
    this.set(this.noteG.gain, 0.55 * (0.45 + 0.55 * load))
    this.set(this.halfG.gain, (modern ? 0.12 : 0.32) * (0.6 + 0.4 * load))
    this.set(this.raspG.gain, (modern ? 0.16 : 0.26) * throttle * throttle)
    this.set(this.roarG.gain, (modern ? 0.35 : 0.55) * (0.15 + 0.85 * throttle))
    this.set(this.tone.frequency, (600 + open * 7000) * (0.6 + 0.4 * load) + f0 * 1.5)
    this.set(this.boom.gain, bass)
    this.set(this.out.gain, vol, 0.05)
  }

  /** A short cut in the note (a gear change). */
  cut(depth: number, ms: number) {
    const t = this.ac.currentTime
    const g = this.out.gain
    const v = g.value
    g.cancelScheduledValues(t)
    g.setValueAtTime(v, t)
    g.linearRampToValueAtTime(v * (1 - depth), t + 0.012)
    g.linearRampToValueAtTime(v, t + ms / 1000)
  }

  stop() {
    for (const s of this.srcs) {
      try {
        s.stop()
      } catch {
        // stopped already
      }
      s.disconnect()
    }
    this.out.disconnect()
  }
}

/** The real engine: cylinders firing into the exhausts (f1EngineDSP), then the listener's filter. */
class WorkletVoice implements Voice {
  private ac: AudioContext
  private node: AudioWorkletNode
  private rpm: AudioParam
  private thr: AudioParam
  private tone: BiquadFilterNode
  private boom: BiquadFilterNode
  readonly out: GainNode
  private kind: EngineKind | null = null

  constructor(ac: AudioContext, dest: AudioNode) {
    this.ac = ac
    this.node = new AudioWorkletNode(ac, 'kherve-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] })
    this.rpm = this.node.parameters.get('rpm')!
    this.thr = this.node.parameters.get('throttle')!
    this.tone = ac.createBiquadFilter()
    this.tone.type = 'lowpass'
    this.tone.Q.value = 0.7
    this.boom = ac.createBiquadFilter()
    this.boom.type = 'lowshelf'
    this.boom.frequency.value = 200
    this.out = ac.createGain()
    this.out.gain.value = 0
    this.node.connect(this.tone).connect(this.boom).connect(this.out).connect(dest)
  }

  setWave() {}

  setEngine(kind: EngineKind, idle: number, redline: number) {
    if (kind === this.kind) return
    this.kind = kind
    this.node.port.postMessage({ engine: kind, idle, redline })
  }

  private set(p: AudioParam, v: number, tc = 0.03) {
    p.setTargetAtTime(v, this.ac.currentTime, tc)
  }

  drive(rpm: number, throttle: number, vol: number, open: number, bass: number) {
    this.set(this.rpm, Math.max(300, rpm), 0.012)
    this.set(this.thr, throttle, 0.02)
    this.set(this.tone.frequency, 500 + open * open * 15000, 0.05)
    this.set(this.boom.gain, bass)
    this.set(this.out.gain, vol * 1.6, 0.05)
  }

  /** A gear change: the ignition cut for a moment (and a small dip in the sound). */
  cut(depth: number, ms: number) {
    this.node.port.postMessage({ cut: ms })
    const t = this.ac.currentTime
    const g = this.out.gain
    const v = g.value
    g.cancelScheduledValues(t)
    g.setValueAtTime(v, t)
    g.linearRampToValueAtTime(v * (1 - depth * 0.4), t + 0.01)
    g.linearRampToValueAtTime(v, t + ms / 1000)
  }

  crackle(seconds: number) {
    this.node.port.postMessage({ crackle: seconds })
  }

  stop() {
    this.node.port.postMessage({ stop: true })
    this.node.disconnect()
    this.out.disconnect()
  }
}

export class CarAudio {
  readonly ac: AudioContext
  private dest: AudioNode
  private noise: AudioBuffer
  private series: Series
  private me: Voice
  private rivals: Voice[]
  /** The cylinder-by-cylinder engines are running (else the simple oscillator voices while the worklet loads, or when there is none). */
  private real = false
  private stopped = false
  private extras: { osc: OscillatorNode; g: GainNode }[] = []
  private turbo: { osc: OscillatorNode; g: GainNode }
  private whine: { osc: OscillatorNode; g: GainNode }
  private tyreG: GainNode
  private windG: GainNode
  private windF: BiquadFilterNode
  private rumbleG: GainNode
  private crowdG: GainNode
  private srcs: AudioScheduledSourceNode[] = []
  private nodes: AudioNode[] = []
  private gear = 1
  private lastThrottle = 0
  private crackle = 0

  constructor(ac: AudioContext, dest: AudioNode, series: Series) {
    this.ac = ac
    this.dest = dest
    this.series = series
    const len = ac.sampleRate * 2
    this.noise = ac.createBuffer(1, len, ac.sampleRate)
    const d = this.noise.getChannelData(0)
    // brown-ish noise: smoother, more like air and exhaust than hiss
    let last = 0
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.04 * w) / 1.04
      d[i] = last * 3.2 + w * 0.25
    }
    this.me = new EngineVoice(ac, dest, this.noise, series)
    this.rivals = [new EngineVoice(ac, dest, this.noise, series), new EngineVoice(ac, dest, this.noise, series)]
    void loadWorklet(ac).then((ok) => {
      if (!ok || this.stopped) return
      try {
        const me = new WorkletVoice(ac, dest)
        const rivals = [new WorkletVoice(ac, dest), new WorkletVoice(ac, dest)]
        this.me.stop()
        for (const r of this.rivals) r.stop()
        this.me = me
        this.rivals = rivals
        this.real = true
      } catch {
        // keep the simple voices
      }
    })
    const tonal = (type: OscillatorType) => {
      const o = ac.createOscillator()
      o.type = type
      o.start()
      const g = ac.createGain()
      g.gain.value = 0
      o.connect(g).connect(dest)
      this.srcs.push(o)
      this.extras.push({ osc: o, g })
      return { osc: o, g }
    }
    this.turbo = tonal('sine')
    this.whine = tonal('triangle')
    const noiseBand = (type: BiquadFilterType, f: number, q: number) => {
      const s = ac.createBufferSource()
      s.buffer = this.noise
      s.loop = true
      s.start(0, Math.random() * 1.5)
      this.srcs.push(s)
      const flt = ac.createBiquadFilter()
      flt.type = type
      flt.frequency.value = f
      flt.Q.value = q
      const g = ac.createGain()
      g.gain.value = 0
      s.connect(flt).connect(g).connect(dest)
      this.nodes.push(flt, g)
      return { flt, g }
    }
    this.tyreG = noiseBand('bandpass', 1700, 9).g
    const wind = noiseBand('lowpass', 400, 0.6)
    this.windG = wind.g
    this.windF = wind.flt
    this.rumbleG = noiseBand('lowpass', 120, 1).g
    this.crowdG = noiseBand('bandpass', 1000, 0.4).g
  }

  setSeries(series: Series) {
    if (series === this.series) return
    this.series = series
    this.me.setWave(series)
    for (const r of this.rivals) r.setWave(series)
  }

  private set(p: AudioParam, v: number, tc = 0.05) {
    p.setTargetAtTime(v, this.ac.currentTime, tc)
  }

  player(s: PlayerSound) {
    const modern = this.series === 'modern'
    const open = s.listener === 'chase' ? 1 : s.listener === 'cockpit' ? 0.4 : 0.12
    const vol = !s.on ? 0 : s.listener === 'far' ? 0.05 : s.listener === 'cockpit' ? 0.19 : 0.15
    const revs = (s.rpm - s.idle) / Math.max(1, s.redline - s.idle)
    this.me.setEngine(s.engine, s.idle, s.redline)
    this.me.drive(s.rpm, s.throttle, vol, open, s.listener === 'cockpit' ? 7 : 2)
    // gear changes: a cut in the note, and a clack from a coupé's dog box
    if (s.gear !== this.gear) {
      if (s.gear > this.gear && s.on) {
        this.me.cut(modern ? 0.6 : 0.85, modern ? 40 : 110)
        if (!this.real) this.pop(modern ? 0.04 : 0.09, modern ? 3000 : 900, 0.025)
      }
      this.gear = s.gear
    }
    // lifting at high revs: the exhaust pops and crackles for a moment (and the turbo blows off)
    if (s.on && this.lastThrottle > 0.6 && s.throttle < 0.15 && revs > 0.45) {
      this.crackle = modern ? 0.5 : 1.1
      this.me.crackle(modern ? 0.7 : 1.6)
      if (modern && !this.real) this.pop(0.06, 5000, 0.12, 'highpass')
    }
    this.lastThrottle = s.throttle
    if (this.crackle > 0) {
      this.crackle -= 1 / 60
      if (s.throttle > 0.3 || this.real) this.crackle = 0
      else if (Math.random() < (modern ? 0.1 : 0.16)) this.pop((0.005 + Math.random() * 0.009) * (s.listener === 'far' ? 0.3 : 1), 600 + Math.random() * 1600, 0.04 + Math.random() * 0.05)
    }
    // the turbo's whistle and the hybrid's whine (modern), the gearbox's whine (classic)
    if (modern) {
      this.set(this.turbo.osc.frequency, 2400 + revs * 3600, 0.08)
      this.set(this.turbo.g.gain, s.on ? (this.real ? 0.003 : 0.012) * s.throttle * revs * revs * (s.listener === 'far' ? 0.2 : 1) : 0, 0.1)
      this.set(this.whine.osc.frequency, 280 + s.speed * 16, 0.05)
      this.set(this.whine.g.gain, s.on ? 0.006 * Math.min(1, s.speed / 30) : 0, 0.1)
    } else {
      this.set(this.turbo.g.gain, 0)
      this.set(this.whine.osc.frequency, (s.speed * 95) / Math.max(1, s.gear * 0.55 + 0.6), 0.04)
      this.set(this.whine.g.gain, s.on ? 0.007 * Math.min(1, s.speed / 15) * (0.4 + 0.6 * s.throttle) : 0, 0.08)
    }
    this.set(this.tyreG.gain, s.slide * 0.12)
    this.set(this.windG.gain, Math.min(0.1, s.speed * 0.0012) * (s.listener === 'cockpit' ? 1.3 : 1), 0.1)
    this.set(this.windF.frequency, 250 + s.speed * 9, 0.1)
    this.set(this.rumbleG.gain, s.kerb * 0.3, 0.03)
  }

  /** The two nearest other cars: revs, distance (m), speed towards the listener (m/s). */
  others(cars: { rpm: number; dist: number; closing: number; engine: EngineKind }[]) {
    this.rivals.forEach((v, k) => {
      const c = cars[k]
      if (!c) {
        v.drive(1000, 0, 0, 0.5, 0)
        return
      }
      const doppler = 1 / (1 - Math.max(-0.3, Math.min(0.3, c.closing / 343)))
      v.setEngine(c.engine, this.series === 'modern' ? 4200 : 2600, this.series === 'modern' ? 12400 : 7900)
      const vol = Math.min(0.22, 0.32 / Math.pow(1 + c.dist / 9, 1.35))
      v.drive(c.rpm * doppler, 0.8, vol, Math.max(0.05, 1 / (1 + c.dist / 35)), 0)
    })
  }

  silenceMe() {
    this.me.drive(1000, 0, 0, 0.5, 0)
    this.set(this.turbo.g.gain, 0)
    this.set(this.whine.g.gain, 0)
    this.set(this.tyreG.gain, 0)
    this.set(this.windG.gain, 0)
    this.set(this.rumbleG.gain, 0)
  }

  crowd(v: number) {
    this.set(this.crowdG.gain, v, 0.3)
  }

  quiet() {
    this.silenceMe()
    this.others([])
    this.crowd(0)
  }

  /** A short burst: a pop of the exhaust, a gear's clack, the turbo's blow-off. */
  private pop(vol: number, freq: number, dur: number, type: BiquadFilterType = 'bandpass') {
    const ac = this.ac
    const t = ac.currentTime
    const s = ac.createBufferSource()
    s.buffer = this.noise
    const f = ac.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = type === 'bandpass' ? 1.4 : 0.7
    const g = ac.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(f).connect(g).connect(this.dest)
    s.start(t, Math.random() * 1.5, dur + 0.02)
  }

  stop() {
    this.stopped = true
    this.me.stop()
    for (const r of this.rivals) r.stop()
    for (const s of this.srcs) {
      try {
        s.stop()
      } catch {
        // stopped already
      }
      s.disconnect()
    }
    for (const n of this.nodes) n.disconnect()
    for (const e of this.extras) e.g.disconnect()
  }
}
