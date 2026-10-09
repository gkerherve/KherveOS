// Web Audio for kSignal (browser only): decoding audio files, playing a signal, recording the microphone as raw samples
// and a live analyser. Nothing here is needed for the pure analysis; every function reports problems as readable errors.

import { resample } from './dsp.ts'

type AudioContextCtor = typeof AudioContext

function contextClass(): AudioContextCtor {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
  const C = w.AudioContext ?? w.webkitAudioContext
  if (!C) throw new Error('This browser has no Web Audio support.')
  return C
}

let shared: AudioContext | null = null

/** One AudioContext for playback and decoding (created on first use, after a click). */
export function audioContext(): AudioContext {
  if (!shared || shared.state === 'closed') shared = new (contextClass())()
  return shared
}

export function closeAudio() {
  const c = shared
  shared = null
  if (c && c.state !== 'closed') void c.close().catch(() => {})
}

export interface DecodedAudio { fs: number; channels: Float64Array[] }

/** Decodes any audio file the browser understands (mp3, ogg, flac, m4a, wav…). */
export async function decodeAudio(bytes: Uint8Array): Promise<DecodedAudio> {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  let buf: AudioBuffer
  try { buf = await audioContext().decodeAudioData(copy) } catch { throw new Error('The browser could not decode this audio file.') }
  const channels: Float64Array[] = []
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(Float64Array.from(buf.getChannelData(c)))
  return { fs: buf.sampleRate, channels }
}

// ------------------------------------------------------------------------------------------------- playback

export interface Playback {
  stop(): void
  /** Resolves when playback ends (or is stopped). */
  done: Promise<void>
  /** The sample rate it was played at (the signal's own when the browser can, else 44.1 kHz). */
  rate: number
}

/** Plays samples at the signal's sample rate (resampled to 44.1 kHz outside 8-96 kHz); scaled down if they clip. */
export function playSamples(x: ArrayLike<number>, fs: number): Playback {
  const ctx = audioContext()
  void ctx.resume().catch(() => {})
  let data: ArrayLike<number> = x
  let rate = fs
  if (fs < 8000 || fs > 96000) {
    rate = 44100
    data = resample(x, fs, rate)
  }
  let peak = 0
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
  const gain = peak > 1 ? 0.95 / peak : 1
  const buf = ctx.createBuffer(1, Math.max(1, data.length), rate)
  const ch = buf.getChannelData(0)
  const fade = Math.min(Math.floor(rate * 0.01), Math.floor(data.length / 2))
  for (let i = 0; i < data.length; i++) {
    let g = gain
    if (i < fade) g *= i / fade
    else if (i >= data.length - fade) g *= (data.length - 1 - i) / fade
    ch[i] = data[i] * g
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  let finish: () => void = () => {}
  const done = new Promise<void>((resolve) => { finish = resolve })
  src.onended = () => finish()
  src.start()
  return { rate, done, stop: () => { try { src.stop() } catch { /* already stopped */ } finish() } }
}

// ------------------------------------------------------------------------------------------------- microphone

function micError(e: unknown): Error {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return new Error('The microphone is blocked. Allow it for this site in the browser, then try again.')
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return new Error('No microphone was found.')
  if (name === 'NotReadableError') return new Error('The microphone is used by another program.')
  return new Error(`The microphone could not be opened${e instanceof Error && e.message ? `: ${e.message}` : '.'}`)
}

/** The raw microphone stream, without the processing meant for calls (echo cancellation, noise suppression, gain control). */
export async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the microphone here (it needs a secure page).')
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
  } catch (e) {
    throw micError(e)
  }
}

export interface Recorder {
  /** Stops and returns the raw samples. */
  stop(): Promise<{ x: Float64Array; fs: number }>
  /** Samples so far (for a timer) and the sample rate. */
  count(): number
  fs: number
  /** Latest block peak 0…1, for a level meter. */
  level(): number
}

const WORKLET = `class Rec extends AudioWorkletProcessor { process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true } } registerProcessor('ksig-rec', Rec)`

/** Records the microphone as raw samples (AudioWorklet, with ScriptProcessor as the fallback), up to `maxSeconds`. */
export async function startRecording(maxSeconds = 30, onFull?: () => void): Promise<Recorder> {
  const stream = await openMicrophone()
  const Ctx = contextClass()
  const ctx = new Ctx()
  await ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const chunks: Float32Array[] = []
  let count = 0
  let level = 0
  const limit = Math.floor(maxSeconds * ctx.sampleRate)
  const push = (block: Float32Array) => {
    if (count >= limit) return
    chunks.push(block)
    count += block.length
    let p = 0
    for (let i = 0; i < block.length; i++) p = Math.max(p, Math.abs(block[i]))
    level = p
    if (count >= limit) onFull?.()
  }
  let node: AudioNode
  let silent: GainNode | null = null
  try {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    try { await ctx.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    const w = new AudioWorkletNode(ctx, 'ksig-rec')
    w.port.onmessage = (e: MessageEvent<Float32Array>) => push(e.data)
    node = w
  } catch {
    const sp = ctx.createScriptProcessor(4096, 1, 1)
    sp.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)))
    node = sp
  }
  silent = ctx.createGain()
  silent.gain.value = 0
  source.connect(node)
  node.connect(silent)
  silent.connect(ctx.destination)
  let stopped = false
  return {
    fs: ctx.sampleRate,
    count: () => count,
    level: () => level,
    async stop() {
      if (!stopped) {
        stopped = true
        source.disconnect()
        node.disconnect()
        stream.getTracks().forEach((t) => t.stop())
        await ctx.close().catch(() => {})
      }
      const x = new Float64Array(count)
      let o = 0
      for (const c of chunks) { x.set(c, o); o += c.length }
      return { x, fs: ctx.sampleRate }
    },
  }
}

// ------------------------------------------------------------------------------------------------- live analyser

export interface LiveInput {
  fs: number
  analyser: AnalyserNode
  stop(): void
}

export async function startLive(fftSize: number, smoothing: number): Promise<LiveInput> {
  const stream = await openMicrophone()
  const ctx = new (contextClass())()
  await ctx.resume().catch(() => {})
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = fftSize
  analyser.smoothingTimeConstant = smoothing
  analyser.minDecibels = -140
  analyser.maxDecibels = 0
  source.connect(analyser)
  return {
    fs: ctx.sampleRate,
    analyser,
    stop() {
      try { source.disconnect() } catch { /* gone */ }
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close().catch(() => {})
    },
  }
}
