// Listening: the browser's microphone → the recording kept in the note
// (MediaRecorder, Opus) and, at the same time, 16 kHz audio cut at the
// speaker's pauses (chunker.ts) → Whisper in a worker (whisper.worker.ts) →
// a line of speech with the time it was said. The words being spoken show as
// a live preview until the speaker pauses (the desktop's ListenSession).

import { Chunker, isHallucination, RATE, Resampler, rms, type Chunk } from './chunker'

export const MODELS: { id: string; label: string }[] = [
  { id: 'tiny', label: 'Tiny — fastest, ~40 MB' },
  { id: 'base', label: 'Base — fast, ~80 MB' },
  { id: 'small', label: 'Small — good, ~250 MB' },
  { id: 'large-v3-turbo', label: 'Large v3 turbo — best, ~600 MB (WebGPU)' },
]
export const DEFAULT_MODEL = 'base'

/**
 * (code, label). Whisper in the browser (transformers.js) does not detect the
 * language — without one it assumes English — so "" means this browser's
 * language when Whisper knows it, else English.
 */
export const LANGUAGES: [string, string][] = [
  ['', "This browser's language"], ['en', 'English'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['nl', 'Dutch'], ['zh', 'Chinese'], ['ja', 'Japanese'],
]

const WHISPER_CODES = new Set(['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'zh', 'ja', 'ko', 'ru', 'pl', 'sv', 'da', 'no', 'fi', 'cs', 'el', 'tr', 'ar', 'he', 'hi', 'uk', 'ro', 'hu', 'ca', 'vi', 'id', 'th'])

/** The language code Whisper is given for a setting ("" → the browser's language, or English). */
export function languageFor(setting: string): string {
  if (setting) return setting
  const browser = (typeof navigator !== 'undefined' ? navigator.language : 'en').slice(0, 2).toLowerCase()
  return WHISPER_CODES.has(browser) ? browser : 'en'
}

// ------------------------------------------------------------- the worker

type WorkerOut =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready'; device: string; model: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }

interface Pending {
  resolve: (text: string) => void
  reject: (e: Error) => void
}

/** One Whisper worker for the whole page: the model stays loaded between sessions. */
class Whisper {
  private worker: Worker | null = null
  private pending = new Map<number, Pending>()
  private seq = 0
  private model = ''
  private ready: Promise<string> | null = null
  private readyResolve: ((device: string) => void) | null = null
  private readyReject: ((e: Error) => void) | null = null
  private queue: Promise<unknown> = Promise.resolve()
  onProgress: ((loaded: number, total: number) => void) | null = null

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module', name: 'whisper' })
    w.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') this.onProgress?.(m.loaded, m.total)
      else if (m.type === 'ready') this.readyResolve?.(m.device)
      else if (m.type === 'result') {
        this.pending.get(m.id)?.resolve(m.text)
        this.pending.delete(m.id)
      } else if (m.type === 'error') {
        if (m.id == null) {
          this.readyReject?.(new Error(m.message))
          this.ready = null
          this.model = ''
        } else {
          this.pending.get(m.id)?.reject(new Error(m.message))
          this.pending.delete(m.id)
        }
      }
    }
    w.onerror = (e) => {
      const err = new Error(e.message || 'The speech worker stopped.')
      this.readyReject?.(err)
      for (const p of this.pending.values()) p.reject(err)
      this.pending.clear()
      this.worker = null
      this.ready = null
      this.model = ''
    }
    this.worker = w
    return w
  }

  /** Load a model (downloaded once, then from the browser's cache). Resolves to "webgpu" or "wasm". */
  load(model: string): Promise<string> {
    if (this.ready && this.model === model) return this.ready
    const w = this.ensureWorker()
    this.model = model
    this.ready = new Promise<string>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    w.postMessage({ type: 'load', model })
    return this.ready
  }

  /** Transcribe 16 kHz mono audio; one request at a time. */
  transcribe(audio: Float32Array, language: string): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const id = ++this.seq
        this.pending.set(id, { resolve, reject })
        this.ensureWorker().postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer])
      })
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  get busy(): boolean {
    return this.pending.size > 0
  }

  /** Wait (at most `ms`) for the lines still being transcribed. */
  idle(ms = 20000): Promise<void> {
    return Promise.race([this.queue.then(() => undefined), new Promise<void>((r) => setTimeout(r, ms))])
  }
}

export const whisper = new Whisper()

// ------------------------------------------------------------ the session

export interface ListenEvents {
  /** A finished line of speech and the session time it started. */
  text(text: string, t: number): void
  /** The words being spoken now ("" clears). */
  partial(text: string): void
  level(v: number): void
  status(s: string): void
  error(message: string): void
}

export interface Recorded {
  bytes: Uint8Array
  /** ".ogg", ".webm" or ".m4a" */
  ext: string
  t0: number
  duration: number
}

function recorderType(): { mime: string; ext: string } {
  const can = (t: string) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)
  if (can('audio/ogg;codecs=opus')) return { mime: 'audio/ogg;codecs=opus', ext: '.ogg' }
  if (can('audio/webm;codecs=opus')) return { mime: 'audio/webm;codecs=opus', ext: '.webm' }
  if (can('audio/mp4')) return { mime: 'audio/mp4', ext: '.m4a' }
  return { mime: '', ext: '.webm' }
}

/** One run of the microphone, from Listen to Stop. */
export class ListenSession {
  private stream: MediaStream | null = null
  private audioCtx: AudioContext | null = null
  private node: ScriptProcessorNode | null = null
  private recorder: MediaRecorder | null = null
  private parts: Blob[] = []
  private chunker = new Chunker()
  private resampler: Resampler | null = null
  private heard = 0
  private previewed = 0
  private finals = 0
  private started = 0
  private stopped = false
  private silentSince = 0
  private warned = false
  private type = recorderType()
  private created = performance.now()
  /** The speech model could not be loaded: only the recording goes on. */
  private failed = false
  private reported = false
  private t0: number
  private model: string
  private language: string
  private on: ListenEvents
  private preview: boolean

  /** Seconds of new audio before the preview is refreshed; how far back it looks. */
  static PREVIEW_STEP = 1.2
  static PREVIEW_WINDOW = 10

  constructor(t0: number, model: string, language: string, on: ListenEvents, preview = true) {
    this.t0 = t0
    this.model = model
    this.language = languageFor(language)
    this.on = on
    this.preview = preview
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser gives no access to a microphone here (it needs https or localhost).')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      if (name === 'NotAllowedError') throw new Error('The microphone is blocked. Allow it for this site in the browser (the icon in the address bar), then press Listen again.')
      if (name === 'NotFoundError') throw new Error('No microphone was found.')
      throw new Error(`Could not open the microphone: ${e instanceof Error ? e.message : String(e)}`)
    }
    this.started = performance.now()
    // Session time counts from when the microphone opened (a permission prompt may have waited).
    this.t0 += (this.started - this.created) / 1000
    // The recording kept in the note.
    try {
      this.recorder = this.type.mime ? new MediaRecorder(this.stream, { mimeType: this.type.mime }) : new MediaRecorder(this.stream)
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.parts.push(e.data)
      }
      this.recorder.start(1000)
    } catch {
      this.recorder = null
    }
    // The audio for Whisper.
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.audioCtx = new Ctx()
    this.resampler = new Resampler(this.audioCtx.sampleRate)
    const source = this.audioCtx.createMediaStreamSource(this.stream)
    this.node = this.audioCtx.createScriptProcessor(4096, 1, 1)
    this.node.onaudioprocess = (e) => this.feed(e.inputBuffer.getChannelData(0))
    const mute = this.audioCtx.createGain()
    mute.gain.value = 0
    source.connect(this.node)
    this.node.connect(mute)
    mute.connect(this.audioCtx.destination)
    this.silentSince = performance.now()
    // Load (or download, once) the model while the recording runs.
    this.on.status(`Loading the speech model (${this.model})…`)
    whisper
      .load(this.model)
      .then((device) => {
        if (!this.stopped) this.on.status(`Listening (Whisper ${this.model}, ${device === 'webgpu' ? 'WebGPU' : 'WebAssembly'})`)
      })
      .catch((e: unknown) => {
        this.failed = true
        this.on.status('Recording only: the speech model could not be loaded.')
        this.report(e)
      })
  }

  /** One message per session, not one per line. */
  private report(e: unknown) {
    if (this.reported) return
    this.reported = true
    this.on.error(e instanceof Error ? e.message : String(e))
  }

  private feed(frames: Float32Array) {
    if (this.stopped || !this.resampler) return
    const x = this.resampler.push(frames)
    const level = rms(x)
    this.on.level(level)
    if (level > 1e-4) this.silentSince = performance.now()
    else if (!this.warned && performance.now() - this.silentSince > 5000) {
      this.warned = true
      this.on.error('The microphone sends only silence. Check that it is not muted, or choose another input in the browser.')
    }
    this.heard += x.length
    for (const chunk of this.chunker.feed(x)) this.final(chunk)
    this.maybePreview()
  }

  private final(chunk: Chunk) {
    if (this.failed) return
    this.finals++
    const t = this.t0 + chunk.start / RATE
    whisper
      .transcribe(chunk.audio, this.language)
      .then((text) => {
        this.on.partial('')
        if (text && !isHallucination(text)) this.on.text(text, t)
      })
      .catch((e: unknown) => this.report(e))
      .finally(() => this.finals--)
  }

  private maybePreview() {
    if (!this.preview || this.failed || this.stopped || this.finals > 0 || whisper.busy) return
    if (this.heard - this.previewed < ListenSession.PREVIEW_STEP * RATE) return
    this.previewed = this.heard
    const pending = this.chunker.pending()
    if (!pending) return
    const audio = pending.audio.slice(-ListenSession.PREVIEW_WINDOW * RATE)
    whisper
      .transcribe(audio, this.language)
      .then((text) => {
        if (text && !isHallucination(text) && this.finals === 0 && !this.stopped) this.on.partial(text)
      })
      .catch(() => undefined)
  }

  /** Seconds recorded so far. */
  get duration(): number {
    return this.started ? (performance.now() - this.started) / 1000 : 0
  }

  /** Stop: the last words are transcribed, and the recording comes back for the note. */
  async stop(): Promise<Recorded | null> {
    if (this.stopped) return null
    this.stopped = true
    const duration = this.duration
    for (const chunk of this.chunker.flush()) this.final(chunk)
    this.node?.disconnect()
    await this.audioCtx?.close().catch(() => undefined)
    const recorder = this.recorder
    let blob: Blob | null = null
    if (recorder && recorder.state !== 'inactive') {
      blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(this.parts, { type: recorder.mimeType || this.type.mime }))
        recorder.stop()
      })
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.on.partial('')
    if (!blob || !blob.size) return null
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: this.type.ext, t0: this.t0, duration }
  }
}
