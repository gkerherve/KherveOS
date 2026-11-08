// The horror score of the first-person games (Last Train, DataCenter Assault),
// made live with WebAudio: no files. Pitched so laptop speakers carry it, not
// only headphones. What plays, quiet to loud:
// - a drone of two low notes a semitone apart, breathing through a filter;
// - string clusters (seconds and tritones) that swell and move every few seconds;
// - a lullaby on a music box, out of tune, a note sometimes wrong, into a long reverb;
// - whispers left and right, metal scraped far off, a violin's shriek sliding up;
// - a deep "braam" now and then; a heartbeat, then war drums and tremolo strings
//   as the danger rises (`intensity`).
// The engine calls tick() every frame; stinger() is a jolt, flicker() a tube.
// With `wind`, a draught through the tunnels too (`windLevel`, Last Train's).

import { audioOut, note } from './sound'

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** The pad's chords (MIDI): clusters and tritones, never a resting place. */
const CHORDS = [
  [45, 46, 52, 57],
  [44, 50, 51, 56],
  [43, 49, 55, 56],
  [41, 47, 48, 53],
  [45, 51, 52, 58],
  [46, 52, 53, 57],
]
/** The lullaby: a nursery tune in A minor, the 7th sharpened. */
const LULLABY = [76, 72, 69, 72, 76, 75, 76, 72, 71, 68, 69, 64]

export class HorrorMusic {
  private ac: AudioContext | null = null
  private bus: GainNode | null = null
  private verb: GainNode | null = null
  private nodes: AudioScheduledSourceNode[] = []
  private pad: { oscs: OscillatorNode[]; gain: GainNode } | null = null
  private padF: BiquadFilterNode | null = null
  private tremolo: GainNode | null = null
  private drone: GainNode | null = null
  private wind: GainNode | null = null
  private whistle: GainNode | null = null
  private whistleF: BiquadFilterNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private chord = 0
  private nextChord = 0
  private nextLull = 4
  private lullStep = -1
  private nextLullNote = 0
  private nextWhisper = 7
  private nextScrape = 10
  private nextShriek = 18
  private nextBraam = 9
  private nextBeat = 0
  private nextDrum = 0
  private drumStep = 0
  private t = 0
  private level = 0
  /** 0 quiet … 1 they are all around. */
  intensity = 0
  /** 0 still … 1 a gust (with `wind`). */
  windLevel = 0.3
  /** Music on (the wind and the jolts play anyway). */
  on = true

  private opts: { wind?: boolean; volume?: number }

  constructor(opts: { wind?: boolean; volume?: number } = {}) {
    this.opts = opts
  }

  tick(dt: number) {
    const o = audioOut()
    if (!o) {
      if (this.ac) this.teardown()
      return
    }
    if (o.ac !== this.ac) this.build(o.ac, o.dest)
    const ac = this.ac!
    const now = ac.currentTime
    this.t += dt
    this.level += ((this.on ? 1 : 0) - this.level) * Math.min(1, dt * 0.5)
    this.bus!.gain.setTargetAtTime((this.opts.volume ?? 1) * this.level, now, 0.15)
    const k = this.intensity
    this.drone!.gain.setTargetAtTime(0.11 + k * 0.06, now, 0.6)
    this.pad!.gain.gain.setTargetAtTime((0.022 + 0.018 * (0.5 + 0.5 * Math.sin(this.t * 0.31))) * (0.7 + k * 0.8), now, 0.8)
    this.padF!.frequency.setTargetAtTime(700 + k * 1600, now, 1)
    this.tremolo!.gain.setTargetAtTime(Math.max(0, k - 0.4) * 0.09, now, 0.6)
    if (this.wind) {
      this.wind.gain.setTargetAtTime(0.05 + this.windLevel * 0.22, now, 0.3)
      this.whistle!.gain.setTargetAtTime(this.windLevel * this.windLevel * 0.035, now, 0.3)
      this.whistleF!.frequency.setTargetAtTime(900 + this.windLevel * 900, now, 0.5)
    }
    if (this.level < 0.05) return

    // the pad moves to its next chord
    this.nextChord -= dt
    if (this.nextChord <= 0) {
      this.nextChord = rand(7, 11) * (1.1 - k * 0.5)
      this.chord = (this.chord + 1 + Math.floor(Math.random() * 3)) % CHORDS.length
      const ch = CHORDS[this.chord]
      this.pad!.oscs.forEach((osc, i) => {
        const n = ch[Math.floor(i / 2) % ch.length]
        osc.frequency.setTargetAtTime(note(n) * (i % 2 ? 1.004 : 0.996), now, 1.2)
      })
    }
    // the lullaby: a phrase, then a long silence; quiet times only
    if (k < 0.55) {
      if (this.lullStep < 0) {
        this.nextLull -= dt
        if (this.nextLull <= 0) this.lullStep = 0
      } else {
        this.nextLullNote -= dt
        if (this.nextLullNote <= 0) {
          const n = LULLABY[this.lullStep] + (Math.random() < 0.12 ? (Math.random() < 0.5 ? -1 : 1) : 0)
          this.bell(n, 0.09)
          this.nextLullNote = this.lullStep % 4 === 3 ? 1.1 : 0.55 + Math.random() * 0.08
          if (++this.lullStep >= LULLABY.length) {
            this.lullStep = -1
            this.nextLull = rand(10, 18)
          }
        }
      }
    }
    // whispers
    this.nextWhisper -= dt
    if (this.nextWhisper <= 0) {
      this.nextWhisper = rand(8, 16) * (1.2 - k * 0.6)
      this.whisper()
    }
    // metal scraped somewhere
    this.nextScrape -= dt
    if (this.nextScrape <= 0) {
      this.nextScrape = rand(10, 20)
      this.scrape()
    }
    // a shriek of strings
    this.nextShriek -= dt
    if (this.nextShriek <= 0) {
      this.nextShriek = rand(16, 30) * (1.2 - k * 0.6)
      this.shriek(0.6 + k * 0.6)
    }
    // the braam
    this.nextBraam -= dt
    if (this.nextBraam <= 0) {
      this.nextBraam = rand(18, 32)
      this.braam(0.8 + k * 0.4)
    }
    // the heartbeat, faster as it gets worse
    this.nextBeat -= dt
    if (k > 0.2 && this.nextBeat <= 0) {
      this.nextBeat = 60 / (60 + k * 70)
      this.heart(0, 0.4 * k)
      this.heart(0.17, 0.26 * k)
    }
    // war drums once they are everywhere
    this.nextDrum -= dt
    if (k > 0.55 && this.nextDrum <= 0) {
      const pattern = [1, 0, 0.6, 0, 1, 0.5, 0.7, 0]
      const step = 60 / 100 / 2
      this.nextDrum = step
      const v = pattern[this.drumStep++ % pattern.length]
      if (v) this.drum(0.35 * v * (k - 0.4))
    }
  }

  /** A jolt: a stab of the orchestra, a shriek, a hit that rolls away. */
  stinger(vol = 1) {
    if (!audioOut() || !this.ac || !this.bus) return
    const ac = this.ac
    const t0 = ac.currentTime
    for (const n of [45, 46, 51, 52, 57, 58, 63, 64]) {
      const osc = ac.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = note(n) * (1 + (Math.random() - 0.5) * 0.012)
      const f = ac.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(5000, t0)
      f.frequency.exponentialRampToValueAtTime(500, t0 + 2.2)
      const g = this.env(t0, 0.015, 2.6, 0.06 * vol)
      osc.connect(f).connect(g)
      g.connect(this.bus)
      g.connect(this.verb!)
      osc.start(t0)
      osc.stop(t0 + 2.7)
    }
    this.shriek(1.2 * vol)
    this.drum(0.7 * vol)
    this.braam(0.8 * vol)
  }

  /** A fluorescent tube kicking in (on) or dying (off). */
  flicker(on: boolean) {
    const o = audioOut()
    if (!o || !this.ac || !this.bus) return
    const ac = this.ac
    const t0 = ac.currentTime
    const osc = ac.createOscillator()
    osc.type = 'square'
    osc.frequency.value = on ? 120 : 100
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = on ? 2400 : 900
    const g = this.env(t0, 0.003, on ? 0.18 : 0.3, on ? 0.06 : 0.05)
    osc.connect(f).connect(g).connect(o.dest)
    osc.start(t0)
    osc.stop(t0 + 0.35)
  }

  dispose() {
    this.teardown()
  }

  // ---------------------------------------------------------------- the graph

  private build(ac: AudioContext, dest: GainNode) {
    this.teardown()
    this.ac = ac
    const len = ac.sampleRate * 2
    this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    let b = 0
    for (let i = 0; i < len; i++) {
      b = (b + (Math.random() * 2 - 1) * 0.12) * 0.985
      d[i] = b * 3 + (Math.random() * 2 - 1) * 0.15
    }
    this.bus = ac.createGain()
    this.bus.gain.value = 0
    this.bus.connect(dest)
    // a long, dark reverb
    const conv = ac.createConvolver()
    const ir = ac.createBuffer(2, Math.floor(ac.sampleRate * 4.5), ac.sampleRate)
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c)
      let lp = 0
      for (let i = 0; i < ch.length; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.35
        ch[i] = lp * Math.pow(1 - i / ch.length, 2.2)
      }
    }
    conv.buffer = ir
    this.verb = ac.createGain()
    this.verb.gain.value = 0.7
    this.verb.connect(conv)
    conv.connect(this.bus)

    // the drone: A and B-flat, low, with an octave so small speakers carry it, breathing through a filter
    const droneF = ac.createBiquadFilter()
    droneF.type = 'lowpass'
    droneF.frequency.value = 420
    droneF.Q.value = 5
    this.drone = ac.createGain()
    this.drone.gain.value = 0
    droneF.connect(this.drone).connect(this.bus)
    for (const [f, type] of [[55, 'sawtooth'], [58.27, 'sawtooth'], [110.3, 'sawtooth'], [27.5, 'sine']] as [number, OscillatorType][]) {
      const o = ac.createOscillator()
      o.type = type
      o.frequency.value = f
      o.connect(droneF)
      this.start(o)
    }
    this.lfo(0.05, 260, droneF.frequency)

    // the string pad: eight detuned saws, a slow vibrato, into the reverb
    this.padF = ac.createBiquadFilter()
    this.padF.type = 'lowpass'
    this.padF.frequency.value = 900
    this.padF.Q.value = 0.7
    const padG = ac.createGain()
    padG.gain.value = 0
    this.padF.connect(padG)
    padG.connect(this.bus)
    padG.connect(this.verb)
    const vib = ac.createOscillator()
    vib.frequency.value = 4.6
    const vibG = ac.createGain()
    vibG.gain.value = 1.6
    vib.connect(vibG)
    this.start(vib)
    const oscs: OscillatorNode[] = []
    for (let i = 0; i < 8; i++) {
      const o = ac.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = note(CHORDS[0][Math.floor(i / 2)]) * (i % 2 ? 1.004 : 0.996)
      vibG.connect(o.detune)
      o.connect(this.padF)
      this.start(o)
      oscs.push(o)
    }
    this.pad = { oscs, gain: padG }

    // high strings, trembling, for when it gets bad
    this.tremolo = ac.createGain()
    this.tremolo.gain.value = 0
    const trem = ac.createGain()
    trem.gain.value = 0.5
    this.lfo(11, 0.5, trem.gain)
    this.tremolo.connect(trem)
    trem.connect(this.bus)
    trem.connect(this.verb)
    for (const n of [81, 82, 87, 88]) {
      const o = ac.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = note(n)
      const f = ac.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 3000
      o.connect(f).connect(this.tremolo)
      this.start(o)
    }

    if (this.opts.wind) {
      const src = ac.createBufferSource()
      src.buffer = this.noiseBuf
      src.loop = true
      const wf = ac.createBiquadFilter()
      wf.type = 'lowpass'
      wf.frequency.value = 520
      this.wind = ac.createGain()
      this.wind.gain.value = 0
      src.connect(wf).connect(this.wind).connect(dest)
      this.lfo(0.13, 160, wf.frequency)
      this.start(src)
      const src2 = ac.createBufferSource()
      src2.buffer = this.noiseBuf
      src2.loop = true
      this.whistleF = ac.createBiquadFilter()
      this.whistleF.type = 'bandpass'
      this.whistleF.Q.value = 9
      this.whistleF.frequency.value = 1200
      this.whistle = ac.createGain()
      this.whistle.gain.value = 0
      src2.connect(this.whistleF).connect(this.whistle).connect(dest)
      src2.start(0, 0.7)
      this.nodes.push(src2)
    }
    this.nextChord = 0
  }

  private teardown() {
    for (const n of this.nodes) {
      try {
        n.stop()
        n.disconnect()
      } catch {
        // the context is gone already
      }
    }
    this.nodes = []
    try {
      this.bus?.disconnect()
      this.wind?.disconnect()
      this.whistle?.disconnect()
    } catch {
      // ditto
    }
    this.ac = null
    this.bus = this.verb = this.tremolo = this.drone = this.wind = this.whistle = null
    this.pad = null
    this.padF = this.whistleF = null
  }

  private start(n: AudioScheduledSourceNode) {
    n.start()
    this.nodes.push(n)
  }

  private lfo(freq: number, depth: number, param: AudioParam) {
    const ac = this.ac!
    const o = ac.createOscillator()
    o.frequency.value = freq
    const g = ac.createGain()
    g.gain.value = depth
    o.connect(g).connect(param)
    this.start(o)
  }

  private env(t0: number, attack: number, end: number, peak: number): GainNode {
    const g = this.ac!.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end)
    return g
  }

  private pan(): StereoPannerNode {
    const p = this.ac!.createStereoPanner()
    p.pan.value = rand(-0.9, 0.9)
    return p
  }

  /** A music-box note, slightly out of tune, into the reverb. */
  private bell(n: number, vol: number, delay = 0) {
    const ac = this.ac!
    const t0 = ac.currentTime + delay
    const f = note(n) * (1 + (Math.random() - 0.5) * 0.014)
    for (const [mult, v, type] of [[1, 1, 'sine'], [2.01, 0.4, 'triangle'], [3.98, 0.15, 'sine'], [5.4, 0.06, 'sine']] as [number, number, OscillatorType][]) {
      const o = ac.createOscillator()
      o.type = type
      o.frequency.value = f * mult
      const g = this.env(t0, 0.003, 3.4 / mult, vol * v)
      o.connect(g)
      g.connect(this.bus!)
      g.connect(this.verb!)
      o.start(t0)
      o.stop(t0 + 3.5)
    }
  }

  /** Breath shaped into a whisper: noise through two moving vowel formants, off to one side. */
  private whisper() {
    const ac = this.ac!
    const t0 = ac.currentTime
    const dur = rand(1.2, 2.4)
    const src = ac.createBufferSource()
    src.buffer = this.noiseBuf
    const hp = ac.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 500
    const out = this.env(t0, 0.25, dur, 0.5)
    // syllables: the level flutters
    const syl = ac.createGain()
    syl.gain.value = 0.5
    const so = ac.createOscillator()
    so.frequency.value = rand(3, 6)
    const sg = ac.createGain()
    sg.gain.value = 0.5
    so.connect(sg).connect(syl.gain)
    so.start(t0)
    so.stop(t0 + dur)
    for (const [a, z] of [[rand(600, 900), rand(300, 700)], [rand(1800, 2600), rand(1100, 2200)]]) {
      const f = ac.createBiquadFilter()
      f.type = 'bandpass'
      f.Q.value = 8
      f.frequency.setValueAtTime(a, t0)
      f.frequency.linearRampToValueAtTime(z, t0 + dur)
      hp.connect(f).connect(syl)
    }
    const p = this.pan()
    src.connect(hp)
    syl.connect(out).connect(p)
    p.connect(this.bus!)
    p.connect(this.verb!)
    src.start(t0, Math.random())
    src.stop(t0 + dur + 0.05)
  }

  /** Metal dragged across metal, far off. */
  private scrape() {
    const ac = this.ac!
    const t0 = ac.currentTime
    const src = ac.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 16
    f.frequency.setValueAtTime(rand(1800, 3200), t0)
    f.frequency.linearRampToValueAtTime(rand(1100, 2200), t0 + 2.4)
    const g = this.env(t0, 1.0, 3.2, 0.9)
    const p = this.pan()
    src.connect(f).connect(g).connect(p)
    p.connect(this.verb!)
    p.connect(this.bus!)
    src.start(t0, Math.random())
    src.stop(t0 + 3.3)
  }

  /** Violins sliding up into a scream. */
  private shriek(vol: number) {
    const ac = this.ac!
    const t0 = ac.currentTime
    const base = rand(1100, 1500)
    for (let i = 0; i < 3; i++) {
      const o = ac.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(base * (1 + i * 0.06), t0)
      o.frequency.exponentialRampToValueAtTime(base * (1.9 + i * 0.07), t0 + 1.6)
      const vib = ac.createOscillator()
      vib.frequency.value = 7 + i
      const vg = ac.createGain()
      vg.gain.value = 25
      vib.connect(vg).connect(o.frequency)
      const f = ac.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = 2400
      f.Q.value = 0.8
      const g = this.env(t0, 0.5, 2.2, 0.025 * vol)
      o.connect(f).connect(g)
      g.connect(this.bus!)
      g.connect(this.verb!)
      for (const n of [o, vib]) {
        n.start(t0)
        n.stop(t0 + 2.3)
      }
    }
  }

  /** The cinema's "braam": low brass, the filter opening and closing. */
  private braam(vol: number) {
    const ac = this.ac!
    const t0 = ac.currentTime
    const f = ac.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = 3
    f.frequency.setValueAtTime(150, t0)
    f.frequency.exponentialRampToValueAtTime(1700, t0 + 0.5)
    f.frequency.exponentialRampToValueAtTime(220, t0 + 3)
    const g = this.env(t0, 0.25, 3.4, 0.11 * vol)
    f.connect(g)
    g.connect(this.bus!)
    g.connect(this.verb!)
    for (const n of [33, 33.1, 40, 45, 46]) {
      const o = ac.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = note(n)
      o.connect(f)
      o.start(t0)
      o.stop(t0 + 3.5)
    }
  }

  /** One beat of a heart: a thud you hear on small speakers too. */
  private heart(at: number, vol: number) {
    const ac = this.ac!
    const t0 = ac.currentTime + at
    for (const [freq, type, v] of [[58, 'sine', 1], [116, 'triangle', 0.5]] as [number, OscillatorType, number][]) {
      const o = ac.createOscillator()
      o.type = type
      o.frequency.setValueAtTime(freq, t0)
      o.frequency.exponentialRampToValueAtTime(freq * 0.6, t0 + 0.15)
      const g = this.env(t0, 0.006, 0.18, vol * v)
      o.connect(g).connect(this.bus!)
      o.start(t0)
      o.stop(t0 + 0.22)
    }
  }

  /** A war drum: a low skin and the slap of the stick. */
  private drum(vol: number) {
    const ac = this.ac!
    const t0 = ac.currentTime
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(110, t0)
    o.frequency.exponentialRampToValueAtTime(45, t0 + 0.35)
    const g = this.env(t0, 0.004, 0.45, vol)
    o.connect(g)
    g.connect(this.bus!)
    g.connect(this.verb!)
    o.start(t0)
    o.stop(t0 + 0.5)
    const src = ac.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = 350
    const ng = this.env(t0, 0.002, 0.12, vol * 0.8)
    src.connect(f).connect(ng).connect(this.bus!)
    src.start(t0, Math.random())
    src.stop(t0 + 0.15)
  }
}
