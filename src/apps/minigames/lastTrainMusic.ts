// Last Train: the score and the wind, made live with WebAudio (no files).
// A low drone that breathes, two notes a semitone apart that beat against
// each other, a music box that plays out of tune into a long station reverb,
// metal scraping somewhere in the tunnels, a heartbeat and a string tremolo
// that come in as the station fills with them, and the draught through the
// tunnels. The engine calls tick() every frame with how tense things are and
// how hard the wind blows; stinger() and flicker() are the intro's jolts.

import { audioOut, note } from './sound'

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export class ScaryMusic {
  private ac: AudioContext | null = null
  private bus: GainNode | null = null
  private verb: GainNode | null = null
  private nodes: AudioScheduledSourceNode[] = []
  private dissonance: GainNode | null = null
  private tremolo: GainNode | null = null
  private wind: GainNode | null = null
  private whistle: GainNode | null = null
  private whistleF: BiquadFilterNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private nextNote = 2
  private nextScrape = 6
  private nextBeat = 0
  private nextBoom = 14
  private t = 0
  private level = 0
  /** 0 quiet … 1 the station is full of them. */
  intensity = 0
  /** 0 still … 1 a gust. */
  windLevel = 0.3
  /** Music on (the wind and the jolts play anyway). */
  on = true

  /** Every frame: builds the sound graph once the audio has started, schedules what comes next. */
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
    // the music fades in, and out while it is off
    this.level += ((this.on ? 1 : 0) - this.level) * Math.min(1, dt * 0.6)
    this.bus!.gain.setTargetAtTime(0.85 * this.level, now, 0.1)
    const k = this.intensity
    this.dissonance!.gain.setTargetAtTime((0.025 + 0.035 * (0.5 + 0.5 * Math.sin(this.t * 0.55))) * (0.6 + k), now, 0.4)
    this.tremolo!.gain.setTargetAtTime(Math.max(0, k - 0.45) * 0.05, now, 0.5)
    this.wind!.gain.setTargetAtTime(0.05 + this.windLevel * 0.22, now, 0.3)
    this.whistle!.gain.setTargetAtTime(this.windLevel * this.windLevel * 0.035, now, 0.3)
    this.whistleF!.frequency.setTargetAtTime(900 + this.windLevel * 900, now, 0.5)
    if (this.level < 0.05) return

    // the music box: one note (sometimes a tritone pair) every few seconds, slower when quiet
    this.nextNote -= dt
    if (this.nextNote <= 0) {
      this.nextNote = rand(2.2, 5.5) * (1.2 - k * 0.5)
      const scale = [57, 58, 60, 63, 64, 66, 69, 70]
      const n = scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.4 ? 12 : 0)
      this.bell(n, 0.05 + Math.random() * 0.03)
      if (Math.random() < 0.3) this.bell(n + 6, 0.03, 0.18)
    }
    // metal scraping in the tunnels
    this.nextScrape -= dt
    if (this.nextScrape <= 0) {
      this.nextScrape = rand(8, 16)
      this.scrape()
    }
    // a heartbeat once they are many
    this.nextBeat -= dt
    if (k > 0.35 && this.nextBeat <= 0) {
      this.nextBeat = 60 / (58 + k * 60)
      this.thump(0, 0.22 * k)
      this.thump(0.16, 0.14 * k)
    }
    // a deep hit now and then
    this.nextBoom -= dt
    if (this.nextBoom <= 0) {
      this.nextBoom = rand(14, 26)
      this.thump(0, 0.3, 42, 1.4, true)
    }
  }

  /** The intro's reveal: a cluster of strings and a scream of metal, all at once. */
  stinger(vol = 1) {
    const o = audioOut()
    if (!o || !this.ac || !this.bus) return
    const ac = this.ac
    const t0 = ac.currentTime
    for (const n of [45, 46, 51, 52, 57, 63]) {
      const osc = ac.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = note(n) * (1 + (Math.random() - 0.5) * 0.01)
      const f = ac.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(4000, t0)
      f.frequency.exponentialRampToValueAtTime(400, t0 + 2.5)
      const g = this.env(t0, 0.02, 2.8, 0.05 * vol)
      osc.connect(f).connect(g)
      g.connect(this.bus)
      g.connect(this.verb!)
      osc.start(t0)
      osc.stop(t0 + 3)
    }
    // the screech
    const s = ac.createOscillator()
    s.type = 'sawtooth'
    s.frequency.setValueAtTime(2400, t0)
    s.frequency.exponentialRampToValueAtTime(700, t0 + 1.2)
    const sg = this.env(t0, 0.01, 1.3, 0.03 * vol)
    s.connect(sg)
    sg.connect(this.verb!)
    s.start(t0)
    s.stop(t0 + 1.4)
    this.thump(0, 0.45 * vol, 38, 1.2, true)
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
    const g = this.env(t0, 0.003, on ? 0.18 : 0.3, on ? 0.05 : 0.04)
    osc.connect(f).connect(g).connect(o.dest)
    osc.start(t0)
    osc.stop(t0 + 0.35)
    this.burst(t0, on ? 0.05 : 0.12, on ? 3000 : 400, 0.08, o.dest)
  }

  dispose() {
    this.teardown()
  }

  // ---------------------------------------------------------------- the graph

  private build(ac: AudioContext, dest: GainNode) {
    this.teardown()
    this.ac = ac
    // a noise buffer to loop (wind, scrapes)
    const len = ac.sampleRate * 2
    this.noiseBuf = ac.createBuffer(1, len, ac.sampleRate)
    const d = this.noiseBuf.getChannelData(0)
    let b = 0
    for (let i = 0; i < len; i++) {
      // a little brown, so the wind is not hiss
      b = (b + (Math.random() * 2 - 1) * 0.12) * 0.985
      d[i] = b * 3 + (Math.random() * 2 - 1) * 0.15
    }
    // the bus, and the station's long reverb (a decaying noise impulse)
    this.bus = ac.createGain()
    this.bus.gain.value = 0
    this.bus.connect(dest)
    const conv = ac.createConvolver()
    const ir = ac.createBuffer(2, Math.floor(ac.sampleRate * 3.2), ac.sampleRate)
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c)
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.6)
    }
    conv.buffer = ir
    this.verb = ac.createGain()
    this.verb.gain.value = 0.55
    this.verb.connect(conv)
    conv.connect(this.bus)

    // the drone: two detuned saws and a sub, through a lowpass that breathes
    const droneF = ac.createBiquadFilter()
    droneF.type = 'lowpass'
    droneF.frequency.value = 160
    droneF.Q.value = 4
    const droneG = ac.createGain()
    droneG.gain.value = 0.16
    droneF.connect(droneG).connect(this.bus)
    for (const [f, type] of [[55, 'sawtooth'], [55.4, 'sawtooth'], [27.5, 'sine']] as [number, OscillatorType][]) {
      const o = ac.createOscillator()
      o.type = type
      o.frequency.value = f
      o.connect(droneF)
      this.start(o)
    }
    this.lfo(0.045, 90, droneF.frequency)

    // two notes a semitone apart, beating
    this.dissonance = ac.createGain()
    this.dissonance.gain.value = 0
    this.dissonance.connect(this.bus)
    this.dissonance.connect(this.verb)
    for (const n of [58, 59]) {
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.value = note(n)
      o.connect(this.dissonance)
      this.start(o)
    }

    // high strings, trembling, for when it gets bad
    this.tremolo = ac.createGain()
    this.tremolo.gain.value = 0
    const trem = ac.createGain()
    trem.gain.value = 0.5
    this.lfo(9, 0.5, trem.gain)
    this.tremolo.connect(trem)
    trem.connect(this.bus)
    trem.connect(this.verb)
    for (const n of [81, 82, 88]) {
      const o = ac.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = note(n)
      const f = ac.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 2600
      o.connect(f).connect(this.tremolo)
      this.start(o)
    }

    // the wind: a rumble through the tunnels, and a whistle when it gusts (not part of the music bus)
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
    this.bus = this.verb = this.dissonance = this.tremolo = this.wind = this.whistle = null
    this.whistleF = null
  }

  private start(n: AudioScheduledSourceNode) {
    n.start()
    this.nodes.push(n)
  }

  /** A slow wobble added to a parameter. */
  private lfo(freq: number, depth: number, param: AudioParam) {
    const ac = this.ac!
    const o = ac.createOscillator()
    o.frequency.value = freq
    const g = ac.createGain()
    g.gain.value = depth
    o.connect(g).connect(param)
    this.start(o)
  }

  /** A gain that rises in `attack` and dies away by `end` (seconds from t0). */
  private env(t0: number, attack: number, end: number, peak: number): GainNode {
    const g = this.ac!.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + end)
    return g
  }

  /** A music-box note, slightly out of tune, into the reverb. */
  private bell(n: number, vol: number, delay = 0) {
    const ac = this.ac!
    const t0 = ac.currentTime + delay
    const f = note(n) * (1 + (Math.random() - 0.5) * 0.012)
    for (const [mult, v, type] of [[1, 1, 'sine'], [2.01, 0.35, 'triangle'], [3.98, 0.12, 'sine']] as [number, number, OscillatorType][]) {
      const o = ac.createOscillator()
      o.type = type
      o.frequency.value = f * mult
      const g = this.env(t0, 0.004, 3.2 / mult, vol * v)
      o.connect(g)
      g.connect(this.bus!)
      g.connect(this.verb!)
      o.start(t0)
      o.stop(t0 + 3.4)
    }
  }

  /** Metal dragged across metal, far off. */
  private scrape() {
    const ac = this.ac!
    const t0 = ac.currentTime
    const src = ac.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 14
    f.frequency.setValueAtTime(rand(1800, 3200), t0)
    f.frequency.linearRampToValueAtTime(rand(1200, 2200), t0 + 2.4)
    const g = this.env(t0, 1.2, 3.2, 0.5)
    src.connect(f).connect(g)
    g.connect(this.verb!)
    src.start(t0, Math.random())
    src.stop(t0 + 3.3)
  }

  /** A low thump (a heartbeat; with `deep`, a hit that rolls through the station). */
  private thump(at: number, vol: number, freq = 60, dur = 0.16, deep = false) {
    const ac = this.ac!
    const t0 = ac.currentTime + at
    const o = ac.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(freq, t0)
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + dur)
    const g = this.env(t0, 0.006, dur, vol)
    o.connect(g)
    g.connect(this.bus!)
    if (deep) g.connect(this.verb!)
    o.start(t0)
    o.stop(t0 + dur + 0.05)
  }

  private burst(t0: number, dur: number, freq: number, vol: number, dest: AudioNode) {
    const ac = this.ac!
    const src = ac.createBufferSource()
    src.buffer = this.noiseBuf
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = freq
    const g = this.env(t0, 0.002, dur, vol)
    src.connect(f).connect(g).connect(dest)
    src.start(t0, Math.random())
    src.stop(t0 + dur + 0.02)
  }
}
