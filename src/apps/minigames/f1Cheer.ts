// Kherve Grand Prix — the sounds of a celebration, all synthesised: a brass
// fanfare for the winner, the crowd cheering and whistling, firework bangs
// and crackles, and the pop of the champagne cork.

import { audioOut, note } from './sound'

let crowdBuf: AudioBuffer | null = null

function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (crowdBuf && crowdBuf.sampleRate === ac.sampleRate) return crowdBuf
  const len = ac.sampleRate * 2
  crowdBuf = ac.createBuffer(2, len, ac.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = crowdBuf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }
  return crowdBuf
}

/** One brass note: two detuned saws through a filter that opens as it blows. */
function brass(ac: AudioContext, dest: AudioNode, midi: number, t0: number, dur: number, vol: number) {
  const f = note(midi)
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 2
  filter.frequency.setValueAtTime(f * 1.5, t0)
  filter.frequency.linearRampToValueAtTime(f * 6, t0 + 0.06)
  filter.frequency.setTargetAtTime(f * 3.5, t0 + 0.08, 0.2)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.04)
  g.gain.setTargetAtTime(vol * 0.7, t0 + 0.06, 0.15)
  g.gain.setTargetAtTime(0.0001, t0 + dur - 0.05, 0.06)
  filter.connect(g)
  g.connect(dest)
  for (const det of [-6, 7]) {
    const o = ac.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f
    o.detune.value = det
    // a little vibrato on the long notes
    if (dur > 0.5) {
      const lfo = ac.createOscillator()
      const lg = ac.createGain()
      lfo.frequency.value = 5.5
      lg.gain.setValueAtTime(0, t0)
      lg.gain.linearRampToValueAtTime(f * 0.006, t0 + 0.5)
      lfo.connect(lg)
      lg.connect(o.frequency)
      lfo.start(t0)
      lfo.stop(t0 + dur + 0.3)
    }
    o.connect(filter)
    o.start(t0)
    o.stop(t0 + dur + 0.3)
  }
}

/** The fanfare: ta-ta-ta-taaa, then a rising chord. Shorter and softer for P2 / P3. */
export function fanfare(place: number) {
  const out = audioOut()
  if (!out) return
  const { ac, dest } = out
  const t = ac.currentTime + 0.05
  const v = place === 1 ? 0.13 : 0.09
  const bus = ac.createGain()
  bus.gain.value = 1
  bus.connect(dest)
  const seq: [number[], number, number][] =
    place === 1
      ? [
          [[67, 60], 0, 0.14],
          [[67, 60], 0.16, 0.14],
          [[67, 60], 0.32, 0.14],
          [[72, 64, 55], 0.48, 0.75],
          [[69, 65, 53], 1.28, 0.3],
          [[71, 67, 55], 1.6, 0.3],
          [[76, 72, 67, 60], 1.92, 1.6],
        ]
      : [
          [[67, 60], 0, 0.14],
          [[67, 60], 0.16, 0.14],
          [[72, 64, 55], 0.32, 1.1],
        ]
  for (const [notes, at, dur] of seq) for (const n of notes) brass(ac, bus, n, t + at, dur, v)
  // a cymbal on the last chord
  const last = seq[seq.length - 1][1]
  burst(ac, dest, t + last, 1.8, 0.07, 'highpass', 6000, 0.7)
}

/** A shaped burst of noise. */
function burst(ac: AudioContext, dest: AudioNode, t0: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q: number, to?: number) {
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer(ac)
  const f = ac.createBiquadFilter()
  f.type = type
  f.frequency.setValueAtTime(freq, t0)
  if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  f.Q.value = q
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f)
  f.connect(g)
  g.connect(dest)
  src.start(t0, Math.random())
  src.stop(t0 + dur + 0.05)
}

/** The grandstands: a roar that swells and fades, with whistles, claps and air horns. `big` for a win. */
export function cheer(seconds: number, big: boolean) {
  const out = audioOut()
  if (!out) return
  const { ac, dest } = out
  const t0 = ac.currentTime + 0.05
  const peak = big ? 0.22 : 0.14
  const bus = ac.createGain()
  bus.gain.setValueAtTime(0.0001, t0)
  bus.gain.exponentialRampToValueAtTime(peak, t0 + 0.7)
  bus.gain.setTargetAtTime(peak * 0.75, t0 + 1.2, 1)
  bus.gain.setTargetAtTime(0.0001, t0 + seconds - 1.5, 0.6)
  bus.connect(dest)
  // voices: bands of noise, each swaying in loudness like a crowd does
  for (const [freq, q, vol] of [
    [450, 0.8, 1],
    [900, 1.2, 0.8],
    [1700, 1.6, 0.5],
    [2800, 2, 0.25],
  ]) {
    const src = ac.createBufferSource()
    src.buffer = noiseBuffer(ac)
    src.loop = true
    const f = ac.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = freq
    f.Q.value = q
    const g = ac.createGain()
    g.gain.value = vol
    const lfo = ac.createOscillator()
    const lg = ac.createGain()
    lfo.frequency.value = 0.3 + Math.random() * 0.5
    lg.gain.value = vol * 0.35
    lfo.connect(lg)
    lg.connect(g.gain)
    src.connect(f)
    f.connect(g)
    g.connect(bus)
    src.start(t0, Math.random())
    lfo.start(t0)
    src.stop(t0 + seconds + 1)
    lfo.stop(t0 + seconds + 1)
  }
  // whistles here and there
  const whistles = big ? 9 : 5
  for (let i = 0; i < whistles; i++) {
    const at = t0 + 0.4 + Math.random() * (seconds - 2)
    const o = ac.createOscillator()
    o.type = 'sine'
    const f = 1900 + Math.random() * 900
    o.frequency.setValueAtTime(f * 0.8, at)
    o.frequency.exponentialRampToValueAtTime(f * 1.15, at + 0.12)
    o.frequency.setValueAtTime(f * 1.15, at + 0.35)
    o.frequency.exponentialRampToValueAtTime(f * 0.7, at + 0.6)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(0.05, at + 0.04)
    g.gain.setValueAtTime(0.05, at + 0.5)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.65)
    o.connect(g)
    g.connect(dest)
    o.start(at)
    o.stop(at + 0.7)
  }
  // claps: a patter of short clicks
  const claps = big ? 120 : 60
  for (let i = 0; i < claps; i++) {
    const at = t0 + 0.3 + Math.random() * (seconds - 1.5)
    burst(ac, bus, at, 0.03, 0.5 + Math.random() * 0.5, 'bandpass', 1200 + Math.random() * 1400, 1.5)
  }
  // air horns for the winner
  if (big)
    for (const at of [0.6, 1.4, 3.2]) {
      const s = t0 + at + Math.random() * 0.3
      for (const m of [1, 1.26]) {
        const o = ac.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = 420 * m
        const f = ac.createBiquadFilter()
        f.type = 'lowpass'
        f.frequency.value = 1800
        const g = ac.createGain()
        g.gain.setValueAtTime(0.0001, s)
        g.gain.exponentialRampToValueAtTime(0.025, s + 0.03)
        g.gain.setValueAtTime(0.025, s + 0.55)
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.7)
        o.connect(f)
        f.connect(g)
        g.connect(dest)
        o.start(s)
        o.stop(s + 0.75)
      }
    }
}

/** A firework: the whistle going up is optional, then the bang and the crackle. `delay` in seconds. */
export function firework(delay = 0, distance = 1) {
  const out = audioOut()
  if (!out) return
  const { ac, dest } = out
  const t = ac.currentTime + delay
  const v = 0.35 / distance
  burst(ac, dest, t, 0.7, v, 'lowpass', 900, 0.7, 120)
  burst(ac, dest, t, 0.12, v * 0.6, 'bandpass', 2500, 0.8)
  for (let i = 0; i < 14; i++) burst(ac, dest, t + 0.25 + Math.random() * 0.9, 0.02, v * 0.25, 'highpass', 3000 + Math.random() * 3000, 1)
}

/** The champagne: a cork pop and the fizz of the spray. */
export function champagne(delay = 0) {
  const out = audioOut()
  if (!out) return
  const { ac, dest } = out
  const t = ac.currentTime + delay
  const o = ac.createOscillator()
  o.type = 'sine'
  o.frequency.setValueAtTime(700, t)
  o.frequency.exponentialRampToValueAtTime(180, t + 0.06)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.3, t + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
  o.connect(g)
  g.connect(dest)
  o.start(t)
  o.stop(t + 0.1)
  burst(ac, dest, t + 0.05, 2.6, 0.08, 'highpass', 4500, 0.6, 7000)
}
