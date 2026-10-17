// Wobbleland's music: a fairground band organ playing a waltz, composed here
// and played by WebAudio (no sound files). The organ's pipes (flutes with a
// vibrato, a reedy trumpet rank an octave up for the second time round), an
// "oom-pah-pah" of bass pipe and chord, a glockenspiel, and the organ's own
// bass drum, snare and cymbal. 16 bars in C major that loop, a little faster
// and brighter in multiball. A step sequencer schedules the notes just ahead
// of the audio clock.

import { audioOut } from './sound'

type Note = [step: number, midi: number, len: number]

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** Six eighth-note steps a bar (3/4). */
const STEPS = 6
const BPM = 168

/** The tune: one list of notes per bar. */
const MELODY: Note[][] = [
  [[0, 67, 2], [2, 72, 2], [4, 76, 2]],
  [[0, 79, 4], [4, 76, 2]],
  [[0, 77, 2], [2, 76, 1], [3, 74, 1], [4, 71, 2]],
  [[0, 74, 4], [4, 67, 2]],
  [[0, 65, 2], [2, 71, 2], [4, 74, 2]],
  [[0, 77, 4], [4, 74, 2]],
  [[0, 76, 2], [2, 74, 1], [3, 72, 1], [4, 76, 2]],
  [[0, 72, 4], [4, 67, 2]],
  [[0, 69, 2], [2, 72, 2], [4, 77, 2]],
  [[0, 81, 4], [4, 77, 2]],
  [[0, 79, 2], [2, 76, 2], [4, 72, 2]],
  [[0, 76, 4], [4, 73, 2]],
  [[0, 74, 2], [2, 77, 2], [4, 81, 2]],
  [[0, 79, 2], [2, 77, 2], [4, 71, 2]],
  [[0, 72, 4], [4, 79, 1], [5, 76, 1]],
  [[0, 72, 6]],
]

/** The chord of each bar: root and the tones above it. */
const CHORDS: [number, number[]][] = [
  [48, [0, 4, 7]], [48, [0, 4, 7]], [43, [0, 4, 7, 10]], [43, [0, 4, 7, 10]],
  [43, [0, 4, 7, 10]], [43, [0, 4, 7, 10]], [48, [0, 4, 7]], [48, [0, 4, 7]],
  [41, [0, 4, 7]], [41, [0, 4, 7]], [48, [0, 4, 7]], [45, [0, 4, 7, 10]],
  [50, [0, 3, 7]], [43, [0, 4, 7, 10]], [48, [0, 4, 7]], [48, [0, 4, 7]],
]

export class ParkMusic {
  /** Multiball and the finale: faster and brighter. */
  excited = false
  on = true
  private timer: number | null = null
  private ac: AudioContext | null = null
  private bus: GainNode | null = null
  private next = 0
  private step = 0
  private noise: AudioBuffer | null = null

  start() {
    if (this.timer !== null) return
    this.timer = window.setInterval(() => this.tick(), 40)
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    if (this.bus && this.ac) {
      const g = this.bus
      g.gain.setTargetAtTime(0, this.ac.currentTime, 0.08)
      window.setTimeout(() => g.disconnect(), 600)
    }
    this.bus = null
    this.ac = null
  }

  /** From the top of the tune (a new game). */
  restart() {
    this.step = 0
  }

  private tick() {
    const out = audioOut()
    if (!out || !this.on) return
    if (this.ac !== out.ac || !this.bus) {
      this.ac = out.ac
      this.bus = out.ac.createGain()
      this.bus.gain.value = 0.5
      // A touch of room: a short feedback echo, like a hall.
      const delay = out.ac.createDelay(0.5)
      delay.delayTime.value = 0.13
      const fb = out.ac.createGain()
      fb.gain.value = 0.22
      const wet = out.ac.createGain()
      wet.gain.value = 0.25
      this.bus.connect(out.dest)
      this.bus.connect(delay)
      delay.connect(fb)
      fb.connect(delay)
      delay.connect(wet)
      wet.connect(out.dest)
      this.next = out.ac.currentTime + 0.1
    }
    const ac = this.ac
    const stepDur = 60 / (BPM * (this.excited ? 1.14 : 1)) / 2
    if (this.next < ac.currentTime) this.next = ac.currentTime + 0.05
    while (this.next < ac.currentTime + 0.25) {
      this.play(this.step, this.next, stepDur)
      this.next += stepDur
      this.step = (this.step + 1) % (MELODY.length * STEPS * 2)
    }
  }

  private play(step: number, t: number, sd: number) {
    const round = Math.floor(step / (MELODY.length * STEPS))
    const bar = Math.floor(step / STEPS) % MELODY.length
    const s = step % STEPS
    const [root, tones] = CHORDS[bar]
    // Oom (bass pipe and drum on 1), pah, pah (the chord on 2 and 3).
    if (s === 0) {
      this.pipe(hz(root - 12), t, sd * 1.8, 0.2, 'triangle', 0)
      this.pipe(hz(root), t, sd * 1.6, 0.08, 'sine', 0)
      this.drum(t)
    } else if (s === 2 || s === 4) {
      for (const k of tones) this.pipe(hz(root + 12 + k), t, sd * 0.9, 0.035, 'square', 1200)
      this.snare(t, s === 4 ? 0.05 : 0.035)
    } else if (s === 3 && bar % 4 === 3) this.pipe(hz(root - 5), t, sd * 0.9, 0.12, 'triangle', 0)
    if (s === 0 && bar % 8 === 7) this.cymbal(t)
    for (const [ns, m, len] of MELODY[bar]) {
      if (ns !== s) continue
      const dur = len * sd * 0.92
      this.flute(hz(m), t, dur, 0.1)
      if (round === 1 || this.excited) this.reed(hz(m + 12), t, dur, 0.035)
      if (len <= 2 && (round === 1 || bar % 2 === 1)) this.bell(hz(m + 12), t, 0.05)
    }
  }

  private env(g: GainNode, t: number, dur: number, vol: number, attack = 0.02) {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + attack)
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - 0.05))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04)
  }

  private pipe(f: number, t: number, dur: number, vol: number, type: OscillatorType, cut: number) {
    const ac = this.ac!
    const o = ac.createOscillator()
    o.type = type
    o.frequency.value = f
    const g = ac.createGain()
    this.env(g, t, dur, vol, 0.012)
    let node: AudioNode = o
    if (cut) {
      const lp = ac.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = cut
      o.connect(lp)
      node = lp
    }
    node.connect(g)
    g.connect(this.bus!)
    o.start(t)
    o.stop(t + dur + 0.1)
  }

  /** A flute rank: sine and a soft octave, with the organ's tremulant. */
  private flute(f: number, t: number, dur: number, vol: number) {
    const ac = this.ac!
    const g = ac.createGain()
    this.env(g, t, dur, vol, 0.03)
    const lfo = ac.createOscillator()
    lfo.frequency.value = 6.2
    const depth = ac.createGain()
    depth.gain.value = f * 0.012
    lfo.connect(depth)
    for (const [mul, type, v] of [[1, 'sine', 1], [2, 'triangle', 0.25], [3, 'sine', 0.08]] as const) {
      const o = ac.createOscillator()
      o.type = type
      o.frequency.value = f * mul
      depth.connect(o.frequency)
      const og = ac.createGain()
      og.gain.value = v
      o.connect(og)
      og.connect(g)
      o.start(t)
      o.stop(t + dur + 0.1)
    }
    lfo.start(t)
    lfo.stop(t + dur + 0.1)
    g.connect(this.bus!)
  }

  /** A trumpet rank: a filtered sawtooth. */
  private reed(f: number, t: number, dur: number, vol: number) {
    const ac = this.ac!
    const o = ac.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f
    const lp = ac.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 2600
    lp.Q.value = 2
    const g = ac.createGain()
    this.env(g, t, dur, vol, 0.02)
    o.connect(lp)
    lp.connect(g)
    g.connect(this.bus!)
    o.start(t)
    o.stop(t + dur + 0.1)
  }

  /** A glockenspiel bar: two inharmonic sines that ring away. */
  private bell(f: number, t: number, vol: number) {
    const ac = this.ac!
    for (const [mul, v, d] of [[1, 1, 0.9], [2.76, 0.4, 0.4], [5.4, 0.15, 0.2]] as const) {
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.value = f * mul
      const g = ac.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(vol * v, t + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d)
      o.connect(g)
      g.connect(this.bus!)
      o.start(t)
      o.stop(t + d + 0.05)
    }
  }

  private noiseSrc(t: number, dur: number) {
    const ac = this.ac!
    if (!this.noise || this.noise.sampleRate !== ac.sampleRate) {
      const len = Math.floor(ac.sampleRate * 0.6)
      this.noise = ac.createBuffer(1, len, ac.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    }
    const src = ac.createBufferSource()
    src.buffer = this.noise
    src.start(t)
    src.stop(t + dur)
    return src
  }

  private drum(t: number) {
    const ac = this.ac!
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(110, t)
    o.frequency.exponentialRampToValueAtTime(48, t + 0.18)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    o.connect(g)
    g.connect(this.bus!)
    o.start(t)
    o.stop(t + 0.35)
  }

  private snare(t: number, vol: number) {
    const ac = this.ac!
    const src = this.noiseSrc(t, 0.12)
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2400
    bp.Q.value = 0.8
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1)
    src.connect(bp)
    bp.connect(g)
    g.connect(this.bus!)
  }

  private cymbal(t: number) {
    const ac = this.ac!
    const src = this.noiseSrc(t, 0.6)
    const hp = ac.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 6000
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    src.connect(hp)
    hp.connect(g)
    g.connect(this.bus!)
  }
}
