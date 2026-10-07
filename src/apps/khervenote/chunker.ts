// Microphone audio → speech chunks for Whisper (the desktop's audio.Chunker).
//
// Whisper works on whole utterances, so the stream is cut where the speaker
// pauses: at least `minS` of audio, ended by `pauseS` of quiet, never longer
// than `maxS` (then cut at the quietest moment in the last 3 s). Chunks that
// are quiet throughout are dropped — given silence, Whisper tends to invent
// "Thank you." Plain TypeScript so Node can test it.

export const RATE = 16000
const FRAME = 480 // 30 ms analysis frames

export interface Chunk {
  /** First sample, counted from the recording start. */
  start: number
  audio: Float32Array
}

function levelsOf(x: Float32Array): Float32Array {
  const n = Math.floor(x.length / FRAME)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) s += x[i] * x[i]
    out[f] = Math.sqrt(s / FRAME)
  }
  return out
}

/** numpy.percentile(x, q) with linear interpolation. */
function percentile(x: Float32Array, q: number): number {
  if (!x.length) return 0
  const s = Float64Array.from(x).sort()
  const pos = (q / 100) * (s.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(s.length - 1, lo + 1)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

export class Chunker {
  private minN: number
  private maxN: number
  private pauseFrames: number
  private floor: number
  private buf = new Float32Array(0)
  /** Sample index of buf[0]. */
  private start = 0

  constructor(minS = 1.5, maxS = 10, pauseS = 0.5, floor = 0.006) {
    this.minN = Math.trunc(minS * RATE)
    this.maxN = Math.trunc(maxS * RATE)
    this.pauseFrames = Math.max(1, Math.trunc((pauseS * RATE) / FRAME))
    this.floor = floor
  }

  /** Quiet relative to the loud parts as well as absolutely, so a noisy room still yields pauses. */
  private quiet(levels: Float32Array): boolean[] {
    const limit = Math.max(this.floor, 0.2 * (levels.length ? percentile(levels, 90) : 0))
    return Array.from(levels, (l) => l < limit)
  }

  private emit(n: number): Chunk | null {
    const audio = this.buf.slice(0, n)
    this.buf = this.buf.slice(n)
    const start = this.start
    this.start += n
    const levels = levelsOf(audio)
    if (!levels.length) return null
    const quiet = this.quiet(levels)
    const first = quiet.indexOf(false)
    if (first < 0 || Math.max(...levels) < this.floor * 2) return null
    // Start shortly before the first sound: its time is when the speaker started.
    const skip = Math.max(0, first - 7) * FRAME
    return { start: start + skip, audio: audio.slice(skip) }
  }

  feed(frames: Float32Array): Chunk[] {
    const next = new Float32Array(this.buf.length + frames.length)
    next.set(this.buf)
    next.set(frames, this.buf.length)
    this.buf = next
    const out: Chunk[] = []
    while (this.buf.length >= this.minN) {
      const levels = levelsOf(this.buf)
      const quiet = this.quiet(levels)
      const tail = quiet.slice(-this.pauseFrames)
      let chunk: Chunk | null
      if (quiet.every((q) => q)) {
        // Nothing said yet: keep only the latest moment of quiet.
        const keep = this.pauseFrames * FRAME
        this.start += this.buf.length - keep
        this.buf = this.buf.slice(-keep)
        break
      }
      if (tail.length === this.pauseFrames && tail.every((q) => q)) {
        chunk = this.emit(levels.length * FRAME)
      } else if (this.buf.length >= this.maxN) {
        // No pause: cut at the quietest frame in the last 3 s.
        const window = Math.max(1, Math.trunc((3 * RATE) / FRAME))
        const lo = Math.max(0, levels.length - window)
        let best = lo
        for (let i = lo; i < levels.length; i++) if (levels[i] < levels[best]) best = i
        chunk = this.emit(Math.max(best * FRAME + FRAME, FRAME))
      } else break
      if (chunk) out.push(chunk)
    }
    return out
  }

  /** The speech heard since the last chunk, for a live preview, or null while it is only quiet. */
  pending(): Chunk | null {
    if (this.buf.length < FRAME * 10) return null
    const levels = levelsOf(this.buf)
    const quiet = this.quiet(levels)
    const first = quiet.indexOf(false)
    if (first < 0 || Math.max(...levels) < this.floor * 2) return null
    const skip = Math.max(0, first - 7) * FRAME
    return { start: this.start + skip, audio: this.buf.slice(skip) }
  }

  flush(): Chunk[] {
    if (!this.buf.length) return []
    const c = this.emit(this.buf.length)
    return c ? [c] : []
  }
}

/** Audio at any rate → 16 kHz, a buffer at a time (each output sample averages the input it covers). */
export class Resampler {
  private ratio: number
  /** Input position (in input samples, relative to the next buffer) of the next output sample's start. */
  private pos = 0
  private carry = new Float32Array(0)

  constructor(inputRate: number) {
    this.ratio = inputRate / RATE
  }

  push(input: Float32Array): Float32Array {
    if (this.ratio === 1) return input.slice()
    const x = new Float32Array(this.carry.length + input.length)
    x.set(this.carry)
    x.set(input, this.carry.length)
    const out: number[] = []
    let p = this.pos
    while (p + this.ratio <= x.length) {
      const a = Math.floor(p)
      const b = Math.max(a + 1, Math.floor(p + this.ratio))
      let s = 0
      for (let i = a; i < b; i++) s += x[i]
      out.push(s / (b - a))
      p += this.ratio
    }
    const keepFrom = Math.floor(p)
    this.carry = x.slice(keepFrom)
    this.pos = p - keepFrom
    return Float32Array.from(out)
  }
}

export function resample(x: Float32Array, inputRate: number): Float32Array {
  return new Resampler(inputRate).push(x)
}

/** Phrases Whisper produces from noise; dropped when they are all a chunk said. */
const HALLUCINATIONS = new Set(['thank you.', 'thank you', 'thanks for watching!', 'thanks for watching.', 'you', 'bye.', 'bye', '.', '...', 'merci.', "sous-titrage st' 501"])

export function isHallucination(text: string): boolean {
  return HALLUCINATIONS.has(text.trim().toLowerCase())
}

/** Root mean square of a buffer (the level meter). */
export function rms(x: Float32Array): number {
  if (!x.length) return 0
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / x.length)
}
