// Tiny sound effects made with WebAudio: short tones and noise bursts, no
// sound files. One AudioContext serves every game window, and the Sound
// setting (Game › Sound) is shared by all the mini-games and remembered.

import { create } from 'zustand'

const KEY = 'kherveos.minigames.sound'
const VOLUME = 0.32

function readOn(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export const useSound = create<{ on: boolean }>(() => ({ on: readOn() }))

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuffer: AudioBuffer | null = null
let users = 0
const lastPlayed = new Map<string, number>()

export function setSoundOn(on: boolean) {
  useSound.setState({ on })
  try {
    globalThis.localStorage?.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not remembered, but still switched for this session.
  }
  if (ctx && master) master.gain.setTargetAtTime(on ? VOLUME : 0, ctx.currentTime, 0.01)
  if (on) unlockAudio()
}

/** Game windows hold the audio while they are open; the last one to close frees it. */
export function retainAudio() {
  users++
}

export function releaseAudio() {
  users = Math.max(0, users - 1)
  if (users > 0 || !ctx) return
  const old = ctx
  ctx = null
  master = null
  noiseBuffer = null
  lastPlayed.clear() // a new context's clock starts again at 0
  void old.close().catch(() => {})
}

/** Call from key and pointer handlers: browsers only start audio after a user gesture. */
export function unlockAudio() {
  if (!useSound.getState().on) return
  try {
    if (!ctx) {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = VOLUME
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  } catch {
    ctx = null
    master = null
  }
}

function output(): { ac: AudioContext; dest: GainNode } | null {
  if (!ctx || !master || ctx.state !== 'running' || !useSound.getState().on) return null
  return { ac: ctx, dest: master }
}

/** The frequency of a MIDI note (69 = A4 = 440 Hz). */
export function note(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12)
}

export interface Tone {
  freq: number
  /** Slide to this frequency over the sound's length. */
  to?: number
  /** Seconds. */
  dur: number
  type?: OscillatorType
  vol?: number
  /** Start this many seconds from now. */
  at?: number
}

export function tone(t: Tone) {
  const o = output()
  if (!o) return
  const { ac, dest } = o
  const t0 = ac.currentTime + (t.at ?? 0)
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = t.type ?? 'square'
  osc.frequency.setValueAtTime(t.freq, t0)
  if (t.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, t.to), t0 + t.dur)
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(t.vol ?? 0.2, t0 + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t.dur)
  osc.connect(gain)
  gain.connect(dest)
  osc.start(t0)
  osc.stop(t0 + t.dur + 0.03)
}

export interface Noise {
  dur: number
  vol?: number
  /** Filter frequency, and where it slides to. */
  freq?: number
  to?: number
  q?: number
  filter?: BiquadFilterType
  at?: number
}

/** A burst of filtered noise: thuds, clacks, whooshes. */
export function noise(n: Noise) {
  const o = output()
  if (!o) return
  const { ac, dest } = o
  if (!noiseBuffer) {
    const len = Math.floor(ac.sampleRate * 0.5)
    noiseBuffer = ac.createBuffer(1, len, ac.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  }
  const t0 = ac.currentTime + (n.at ?? 0)
  const src = ac.createBufferSource()
  src.buffer = noiseBuffer
  src.loop = true
  const filter = ac.createBiquadFilter()
  filter.type = n.filter ?? 'bandpass'
  filter.frequency.setValueAtTime(n.freq ?? 1000, t0)
  if (n.to) filter.frequency.exponentialRampToValueAtTime(Math.max(20, n.to), t0 + n.dur)
  filter.Q.value = n.q ?? 1
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(n.vol ?? 0.2, t0 + 0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(dest)
  src.start(t0, Math.random() * 0.4)
  src.stop(t0 + n.dur + 0.03)
}

/** Notes one after another (MIDI numbers), `step` seconds apart. */
export function arpeggio(notes: number[], step: number, t: Omit<Tone, 'freq'>) {
  notes.forEach((n, i) => tone({ ...t, freq: note(n), at: (t.at ?? 0) + i * step }))
}

/**
 * Plays a named sound unless it already played less than `gap` seconds ago:
 * ten bumper hits in a row should sound like a rattle, not a roar.
 */
export function sfx(name: string, play: () => void, gap = 0.03) {
  if (!output()) return
  const now = ctx!.currentTime
  if (now - (lastPlayed.get(name) ?? -1) < gap) return
  lastPlayed.set(name, now)
  play()
}
