// Kherve Grand Prix — the music, composed here and played by WebAudio
// instruments (no sound files). Two pieces:
//  - "Pole Position" for the single-seaters: driving electronic rock in
//    A minor at 132 bpm — four-on-the-floor drums, an octave bass, a
//    sequenced arpeggio through an echo, wide pads and a heroic lead.
//  - "Riviera '71" for the classics: a funk-rock groove in E minor at 108 bpm
//    with a swing — tight drums with ghost notes, a syncopated bass, a
//    drawbar organ with its vibrato, a clavinet riff, brass stabs and a lead
//    guitar.
// Each piece is a song of 8-bar sections (intro, groove, theme, breakdown,
// theme again) that loops. A step sequencer schedules the notes a little
// ahead of the audio clock, on its own timer (the engine sets the style and level).

export type MusicStyle = 'modern' | 'classic'

type Note = [step: number, midi: number, len: number]

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

interface Piece {
  bpm: number
  swing: number
  /** Chord of each of the 8 bars: root (MIDI) and the chord tones above it. */
  chords: [number, number[]][]
  /** The lead's 8 bars. */
  melody: Note[][]
  /** Sections in order: which parts play. */
  song: Section[]
}

interface Section {
  drums: 0 | 1 | 2
  bass: boolean
  keys: boolean
  arp: boolean
  pad: boolean
  lead: boolean
  /** The lead an octave down, softer. */
  low?: boolean
  riser?: boolean
}

const MODERN: Piece = {
  bpm: 132,
  swing: 0,
  chords: [
    [45, [0, 3, 7]],
    [41, [0, 4, 7]],
    [48, [0, 4, 7]],
    [43, [0, 4, 7]],
    [45, [0, 3, 7]],
    [41, [0, 4, 7]],
    [43, [0, 4, 7]],
    [40, [0, 4, 7]],
  ],
  melody: [
    [[0, 76, 4], [4, 81, 4], [8, 84, 6], [14, 83, 2]],
    [[0, 81, 6], [6, 79, 2], [8, 77, 4], [12, 76, 4]],
    [[0, 79, 4], [4, 84, 4], [8, 88, 6], [14, 86, 2]],
    [[0, 86, 8], [8, 83, 4], [12, 79, 4]],
    [[0, 88, 4], [4, 86, 2], [6, 84, 2], [8, 83, 4], [12, 84, 4]],
    [[0, 81, 4], [4, 84, 4], [8, 89, 8]],
    [[0, 88, 4], [4, 86, 4], [8, 83, 4], [12, 79, 4]],
    [[0, 80, 4], [4, 83, 4], [8, 88, 8]],
  ],
  song: [
    { drums: 0, bass: false, keys: false, arp: true, pad: true, lead: false, riser: true },
    { drums: 2, bass: true, keys: false, arp: true, pad: true, lead: false },
    { drums: 2, bass: true, keys: false, arp: true, pad: true, lead: true },
    { drums: 1, bass: true, keys: false, arp: true, pad: true, lead: false, low: true, riser: true },
    { drums: 2, bass: true, keys: false, arp: true, pad: true, lead: true },
    { drums: 2, bass: true, keys: false, arp: false, pad: true, lead: true, low: true },
  ],
}

const CLASSIC: Piece = {
  bpm: 108,
  swing: 0.16,
  chords: [
    [40, [0, 7, 10, 15]],
    [40, [0, 7, 10, 15]],
    [45, [0, 4, 7, 10]],
    [45, [0, 4, 7, 10]],
    [40, [0, 7, 10, 15]],
    [40, [0, 7, 10, 15]],
    [36, [0, 4, 7, 11]],
    [35, [0, 4, 7, 10]],
  ],
  melody: [
    [[0, 71, 3], [3, 74, 3], [6, 76, 2], [8, 79, 4], [12, 76, 4]],
    [[0, 74, 2], [2, 76, 2], [4, 74, 2], [6, 71, 6], [12, 69, 4]],
    [[0, 73, 4], [4, 76, 2], [6, 79, 2], [8, 81, 8]],
    [[0, 79, 2], [2, 81, 2], [4, 79, 2], [6, 76, 4], [10, 73, 6]],
    [[0, 76, 2], [2, 79, 2], [4, 81, 2], [6, 83, 6], [12, 86, 4]],
    [[0, 83, 4], [4, 81, 4], [8, 79, 4], [12, 76, 4]],
    [[0, 79, 4], [4, 76, 4], [8, 71, 4], [12, 72, 4]],
    [[0, 75, 4], [4, 78, 4], [8, 81, 4], [12, 83, 4]],
  ],
  song: [
    { drums: 1, bass: true, keys: true, arp: false, pad: false, lead: false },
    { drums: 2, bass: true, keys: true, arp: true, pad: false, lead: false },
    { drums: 2, bass: true, keys: true, arp: true, pad: false, lead: true },
    { drums: 1, bass: true, keys: true, arp: false, pad: true, lead: false, low: true },
    { drums: 2, bass: true, keys: true, arp: true, pad: false, lead: true },
  ],
}

export class RaceMusic {
  readonly ac: AudioContext
  private bus: GainNode
  private dry: GainNode
  private echo: DelayNode
  private echoFb: GainNode
  private echoIn: GainNode
  private verbIn: GainNode
  private noise: AudioBuffer
  private style: MusicStyle = 'modern'
  private piece: Piece = MODERN
  private step = 0
  private next = 0
  private level = 0
  private nodes: AudioNode[] = []
  private timer: ReturnType<typeof setInterval>

  constructor(ac: AudioContext, dest: AudioNode) {
    this.ac = ac
    this.bus = ac.createGain()
    this.bus.gain.value = 0
    // glue: a gentle compressor on the whole mix
    const comp = ac.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 3
    comp.attack.value = 0.01
    comp.release.value = 0.2
    this.dry = ac.createGain()
    this.dry.connect(comp)
    comp.connect(this.bus).connect(dest)
    // an echo in time with the music (a dotted eighth)
    this.echoIn = ac.createGain()
    this.echo = ac.createDelay(2)
    this.echoFb = ac.createGain()
    this.echoFb.gain.value = 0.38
    const echoTone = ac.createBiquadFilter()
    echoTone.type = 'lowpass'
    echoTone.frequency.value = 3200
    this.echoIn.connect(this.echo).connect(echoTone).connect(this.echoFb).connect(this.echo)
    echoTone.connect(comp)
    // a room: a convolver with a decaying noise tail
    this.verbIn = ac.createGain()
    const verb = ac.createConvolver()
    const len = Math.floor(ac.sampleRate * 2.2)
    const ir = ac.createBuffer(2, len, ac.sampleRate)
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3)
    }
    verb.buffer = ir
    const verbG = ac.createGain()
    verbG.gain.value = 0.35
    this.verbIn.connect(verb).connect(verbG).connect(comp)
    this.nodes.push(this.bus, comp, this.dry, this.echoIn, this.echo, this.echoFb, echoTone, this.verbIn, verb, verbG)
    const nl = ac.sampleRate
    this.noise = ac.createBuffer(1, nl, ac.sampleRate)
    const nd = this.noise.getChannelData(0)
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1
    this.setStyle('modern')
    // its own clock, so a slow frame never leaves a gap in the music
    this.timer = setInterval(() => this.update(), 40)
  }

  setStyle(style: MusicStyle) {
    if (style === this.style && this.next) return
    this.style = style
    this.piece = style === 'classic' ? CLASSIC : MODERN
    this.step = 0
    this.next = 0
    this.echo.delayTime.value = (60 / this.piece.bpm) * 0.75
  }

  /** How loud (0 silent .. 1), eased. */
  setLevel(v: number, tc = 0.8) {
    if (Math.abs(v - this.level) < 0.001) return
    this.level = v
    this.bus.gain.setTargetAtTime(v * 0.55, this.ac.currentTime, tc)
  }

  /** Schedules the notes of the next half second. */
  update() {
    const ac = this.ac
    const now = ac.currentTime
    if (this.level <= 0.001) {
      this.next = 0
      return
    }
    const p = this.piece
    const dur = 60 / p.bpm / 4
    if (!this.next || this.next < now - 0.2) this.next = now + 0.08
    while (this.next < now + 0.6) {
      const odd = this.step % 2 === 1
      this.play(this.step, this.next + (odd ? p.swing * dur : 0), dur)
      this.next += dur
      this.step++
    }
  }

  // ---------------------------------------------------------------- the arrangement

  private play(step: number, t: number, sx: number) {
    const p = this.piece
    const classic = this.style === 'classic'
    const s16 = step % 16
    const bar = Math.floor(step / 16) % 8
    const sec = p.song[Math.floor(step / 128) % p.song.length]
    const [root, tones] = p.chords[bar]
    const chord = tones.map((x) => root + x)
    const first = step % 128 === 0
    if (first && sec.drums === 2) this.cymbal(t, 0.22, 2.2)
    if (first && classic && sec.drums === 2) this.brass(t, chord.map((n) => n + 24), sx * 3)
    // drums
    if (sec.drums) {
      const full = sec.drums === 2
      if (classic) {
        if (s16 === 0 || s16 === 10 || (full && s16 === 7 && bar % 2 === 1)) this.kick(t, 0.9)
        if (s16 === 4 || s16 === 12) this.snare(t, 0.7)
        else if (full && (s16 === 7 || s16 === 15 || s16 === 9)) this.snare(t, 0.12)
        if (s16 % 2 === 0) this.hat(t, s16 % 4 === 0 ? 0.22 : 0.14, s16 === 14 && full)
        else if (full) this.hat(t, 0.06, false)
      } else {
        if (s16 % 4 === 0 && (full || s16 === 0 || s16 === 8)) this.kick(t, 1)
        if (full && (s16 === 4 || s16 === 12)) this.snare(t, 0.75)
        if (full) this.hat(t, s16 % 4 === 2 ? 0.2 : 0.08, s16 % 4 === 2)
        else if (s16 % 2 === 0) this.hat(t, 0.08, false)
        // a fill into the next section
        if (full && bar === 7 && s16 >= 12) this.snare(t, 0.3 + (s16 - 12) * 0.12)
      }
    }
    if (sec.riser && bar === 7 && s16 === 0) this.riser(t, sx * 16)
    // bass
    if (sec.bass) {
      if (classic) {
        const line: [number, number, number][] = [
          [0, 0, 3],
          [3, 12, 1],
          [6, 10, 2],
          [8, 7, 2],
          [10, 0, 1],
          [11, 12, 1],
          [14, 10, 2],
        ]
        for (const [st, off, len] of line) if (st === s16) this.bass(t, root - 12 + off, sx * len * 0.9, true)
      } else if (s16 % 2 === 0) this.bass(t, root - 12 + (s16 % 4 === 2 ? 12 : 0), sx * 1.6, false)
    }
    // pads: a held chord for the bar
    if (sec.pad && s16 === 0) this.pad(t, chord.map((n) => n + 12), sx * 16, classic)
    // keys: the organ on the classic (a held chord with stabs), nothing on the modern
    if (sec.keys && classic) {
      if (s16 === 0) this.organ(t, chord.map((n) => n + 12), sx * 6)
      if (s16 === 10 || s16 === 14) this.organ(t, chord.map((n) => n + 12), sx * 1.4)
    }
    // arpeggio / clavinet
    if (sec.arp) {
      if (classic) {
        const pat = [0, -1, 2, 0, -1, 1, 0, -1, 2, -1, 1, 0, -1, 2, 1, -1]
        const k = pat[s16]
        if (k >= 0) this.clav(t, chord[k % chord.length] + 24, sx * 0.8)
      } else {
        const order = [0, 1, 2, 1, 0, 2, 1, 2]
        this.arp(t, chord[order[s16 % 8]] + 24 + (s16 >= 8 && bar % 2 ? 12 : 0), sx * 0.9)
      }
    }
    // the lead
    if (sec.lead || sec.low)
      for (const [st, m, len] of p.melody[bar])
        if (st === s16) this.lead(t, m - (sec.low && !sec.lead ? 12 : 0), sx * len, sec.lead ? 1 : 0.6, classic)
  }

  // ---------------------------------------------------------------- the instruments

  private env(g: GainNode, t: number, a: number, peak: number, d: number, sus: number, len: number, r: number) {
    const p = g.gain
    p.setValueAtTime(0.0001, t)
    p.exponentialRampToValueAtTime(peak, t + a)
    p.setTargetAtTime(peak * sus, t + a, d)
    p.setTargetAtTime(0.0001, t + Math.max(a, len), r)
  }

  private osc(type: OscillatorType, f: number, t: number, stop: number, detune = 0): OscillatorNode {
    const o = this.ac.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f, t)
    o.detune.value = detune
    o.start(t)
    o.stop(stop)
    return o
  }

  private out(node: AudioNode, echo = 0, verb = 0, pan = 0) {
    let n = node
    if (pan) {
      const pn = this.ac.createStereoPanner()
      pn.pan.value = pan
      node.connect(pn)
      n = pn
    }
    n.connect(this.dry)
    if (echo) {
      const e = this.ac.createGain()
      e.gain.value = echo
      n.connect(e).connect(this.echoIn)
    }
    if (verb) {
      const v = this.ac.createGain()
      v.gain.value = verb
      n.connect(v).connect(this.verbIn)
    }
  }

  private noiseSrc(t: number, len: number): AudioBufferSourceNode {
    const s = this.ac.createBufferSource()
    s.buffer = this.noise
    s.start(t, Math.random() * 0.5, len + 0.05)
    return s
  }

  private kick(t: number, v: number) {
    const ac = this.ac
    const o = this.osc('sine', 160, t, t + 0.45)
    o.frequency.exponentialRampToValueAtTime(48, t + 0.12)
    const g = ac.createGain()
    this.env(g, t, 0.002, 0.9 * v, 0.12, 0.3, 0.12, 0.08)
    o.connect(g)
    this.out(g)
    // the beater's click
    const n = this.noiseSrc(t, 0.02)
    const f = ac.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 3000
    const ng = ac.createGain()
    this.env(ng, t, 0.001, 0.15 * v, 0.005, 0.1, 0.005, 0.005)
    n.connect(f).connect(ng)
    this.out(ng)
  }

  private snare(t: number, v: number) {
    const ac = this.ac
    const n = this.noiseSrc(t, 0.25)
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = this.style === 'classic' ? 2400 : 1800
    f.Q.value = 0.7
    const g = ac.createGain()
    this.env(g, t, 0.001, 0.5 * v, 0.06, 0.2, 0.05, 0.06)
    n.connect(f).connect(g)
    this.out(g, 0, 0.5)
    const o = this.osc('triangle', 200, t, t + 0.15)
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08)
    const og = ac.createGain()
    this.env(og, t, 0.001, 0.4 * v, 0.03, 0.1, 0.03, 0.03)
    o.connect(og)
    this.out(og)
  }

  private hat(t: number, v: number, open: boolean) {
    const ac = this.ac
    const len = open ? 0.22 : 0.04
    const n = this.noiseSrc(t, len)
    const f = ac.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7500
    const g = ac.createGain()
    this.env(g, t, 0.001, v * 0.5, len / 3, 0.2, len / 2, len / 3)
    n.connect(f).connect(g)
    this.out(g, 0, 0, 0.25)
  }

  private cymbal(t: number, v: number, len: number) {
    const ac = this.ac
    const n = this.noiseSrc(t, len)
    const f = ac.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 5000
    const g = ac.createGain()
    this.env(g, t, 0.002, v, len / 4, 0.3, 0.1, len / 4)
    n.connect(f).connect(g)
    this.out(g, 0, 0.6, -0.3)
  }

  private riser(t: number, len: number) {
    const ac = this.ac
    const n = this.noiseSrc(t, len)
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 2
    f.frequency.setValueAtTime(400, t)
    f.frequency.exponentialRampToValueAtTime(7000, t + len)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.18, t + len)
    g.gain.setTargetAtTime(0.0001, t + len, 0.03)
    n.connect(f).connect(g)
    this.out(g, 0.3, 0.4)
  }

  private bass(t: number, m: number, len: number, round: boolean) {
    const ac = this.ac
    const f = ac.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = round ? 2 : 6
    f.frequency.setValueAtTime(round ? 900 : 1600, t)
    f.frequency.setTargetAtTime(round ? 320 : 260, t, round ? 0.08 : 0.05)
    const g = ac.createGain()
    this.env(g, t, 0.004, round ? 0.5 : 0.38, 0.1, 0.6, len, 0.03)
    for (const [type, det] of (round ? [['triangle', 0], ['sawtooth', 0]] : [['sawtooth', -7], ['sawtooth', 7], ['square', 0]]) as [OscillatorType, number][]) {
      const o = this.osc(type, hz(m) * (type === 'square' ? 0.5 : 1), t, t + len + 0.2, det)
      o.connect(f)
    }
    f.connect(g)
    this.out(g)
  }

  private pad(t: number, notes: number[], len: number, warm: boolean) {
    const ac = this.ac
    const f = ac.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(warm ? 900 : 1200, t)
    f.frequency.linearRampToValueAtTime(warm ? 1400 : 2600, t + len * 0.6)
    const g = ac.createGain()
    this.env(g, t, len * 0.25, 0.09, 0.5, 1, len * 0.95, 0.25)
    for (const n of notes)
      for (const det of [-9, 9]) {
        const o = this.osc('sawtooth', hz(n), t, t + len + 1, det)
        o.connect(f)
      }
    f.connect(g)
    this.out(g, 0, 0.6)
  }

  private organ(t: number, notes: number[], len: number) {
    const ac = this.ac
    const g = ac.createGain()
    this.env(g, t, 0.006, 0.075, 0.2, 0.85, len, 0.04)
    // the Leslie: a wobble of pitch and loudness
    const lfo = this.osc('sine', 6.3, t, t + len + 0.3)
    const lg = ac.createGain()
    lg.gain.value = 4
    lfo.connect(lg)
    for (const n of notes)
      for (const [mult, amp] of [
        [0.5, 0.6],
        [1, 1],
        [2, 0.6],
        [3, 0.3],
        [4, 0.25],
      ]) {
        const o = this.osc('sine', hz(n) * mult, t, t + len + 0.3)
        lg.connect(o.detune)
        const og = ac.createGain()
        og.gain.value = amp / notes.length
        o.connect(og).connect(g)
      }
    // the key click
    const n = this.noiseSrc(t, 0.01)
    const ng = ac.createGain()
    this.env(ng, t, 0.001, 0.03, 0.003, 0.1, 0.004, 0.003)
    n.connect(ng).connect(g)
    this.out(g, 0, 0.35, -0.2)
  }

  private clav(t: number, m: number, len: number) {
    const ac = this.ac
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 3
    // an auto-wah: the filter sweeps on every note
    f.frequency.setValueAtTime(2400, t)
    f.frequency.exponentialRampToValueAtTime(700, t + len)
    const g = ac.createGain()
    this.env(g, t, 0.002, 0.16, 0.05, 0.4, len, 0.02)
    const o = this.osc('square', hz(m), t, t + len + 0.1)
    const o2 = this.osc('sawtooth', hz(m) * 2, t, t + len + 0.1, 4)
    o.connect(f)
    o2.connect(f)
    f.connect(g)
    this.out(g, 0.15, 0.1, 0.35)
  }

  private arp(t: number, m: number, len: number) {
    const ac = this.ac
    const f = ac.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = 5
    f.frequency.setValueAtTime(4200, t)
    f.frequency.setTargetAtTime(900, t, 0.06)
    const g = ac.createGain()
    this.env(g, t, 0.003, 0.09, 0.06, 0.3, len, 0.03)
    for (const det of [-6, 6]) this.osc('sawtooth', hz(m), t, t + len + 0.2, det).connect(f)
    f.connect(g)
    this.out(g, 0.45, 0.2, 0.2)
  }

  private lead(t: number, m: number, len: number, v: number, guitar: boolean) {
    const ac = this.ac
    const g = ac.createGain()
    this.env(g, t, guitar ? 0.004 : 0.02, 0.11 * v, 0.2, 0.75, len * 0.92, 0.08)
    // vibrato after the attack
    const lfo = this.osc('sine', 5.6, t, t + len + 0.4)
    const lg = ac.createGain()
    lg.gain.setValueAtTime(0, t)
    lg.gain.linearRampToValueAtTime(guitar ? 22 : 14, t + Math.min(0.4, len))
    lfo.connect(lg)
    const f = ac.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = guitar ? 2600 : 3800
    f.Q.value = 1.5
    if (guitar) {
      // an overdriven guitar: a saw into a soft clipper, then the cabinet
      const ws = ac.createWaveShaper()
      const c = new Float32Array(512)
      for (let i = 0; i < 512; i++) {
        const x = (i / 511) * 2 - 1
        c[i] = Math.tanh(4 * x)
      }
      ws.curve = c
      const pre = ac.createGain()
      pre.gain.value = 0.6
      const o = this.osc('sawtooth', hz(m), t, t + len + 0.4)
      // a little bend up into the note
      o.frequency.setValueAtTime(hz(m - 1), t)
      o.frequency.exponentialRampToValueAtTime(hz(m), t + 0.06)
      lg.connect(o.detune)
      o.connect(pre).connect(ws).connect(f)
    } else
      for (const [type, det] of [
        ['sawtooth', -8],
        ['square', 6],
      ] as [OscillatorType, number][]) {
        const o = this.osc(type, hz(m), t, t + len + 0.4, det)
        lg.connect(o.detune)
        o.connect(f)
      }
    f.connect(g)
    this.out(g, 0.3, 0.35)
  }

  private brass(t: number, notes: number[], len: number) {
    const ac = this.ac
    const g = ac.createGain()
    this.env(g, t, 0.03, 0.12, 0.15, 0.6, len, 0.08)
    const f = ac.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(600, t)
    f.frequency.linearRampToValueAtTime(3200, t + 0.06)
    f.frequency.setTargetAtTime(1600, t + 0.08, 0.15)
    for (const n of notes) this.osc('sawtooth', hz(n), t, t + len + 0.3, (Math.random() - 0.5) * 12).connect(f)
    f.connect(g)
    this.out(g, 0.1, 0.4)
  }

  stop() {
    clearInterval(this.timer)
    this.bus.gain.cancelScheduledValues(this.ac.currentTime)
    this.bus.gain.setTargetAtTime(0, this.ac.currentTime, 0.05)
    const nodes = this.nodes
    setTimeout(() => {
      for (const n of nodes) n.disconnect()
    }, 300)
  }
}
