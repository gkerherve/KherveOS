// Whisper in the browser, off the main thread: transformers.js (ONNX Runtime
// Web) loaded from the jsDelivr CDN on first use, the model from Hugging Face
// (onnx-community/whisper-*), both cached by the browser afterwards. WebGPU
// when the browser has it, else WebAssembly. The audio never leaves the
// computer — the same promise as the desktop's faster-whisper.
//
//   in:  { type: 'load', model: 'base' }
//        { type: 'transcribe', id, audio: Float32Array (16 kHz mono), language: '' | 'en' … }
//   out: { type: 'progress', loaded, total, file } / { type: 'ready', device, model }
//        { type: 'result', id, text } / { type: 'error', id?, message }

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1'

type In = { type: 'load'; model: string } | { type: 'transcribe'; id: number; audio: Float32Array; language: string }
type Out =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready'; device: string; model: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string }

const ctx = self as unknown as {
  postMessage(msg: Out): void
  onmessage: ((e: MessageEvent<In>) => void) | null
}

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>

let asr: Asr | null = null
let loadedModel = ''
let loading: Promise<void> | null = null

async function hasWebGpu(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try {
    return !!(await gpu.requestAdapter())
  } catch {
    return false
  }
}

async function load(model: string): Promise<void> {
  if (asr && loadedModel === model) return
  const T = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as {
    pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<Asr>
    env: { allowLocalModels: boolean }
  }
  T.env.allowLocalModels = false
  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
    let loaded = 0
    let total = 0
    for (const f of files.values()) (loaded += f.loaded), (total += f.total)
    ctx.postMessage({ type: 'progress', loaded, total, file: p.file })
  }
  const id = `onnx-community/whisper-${model}`
  let device = (await hasWebGpu()) ? 'webgpu' : 'wasm'
  try {
    asr = await T.pipeline('automatic-speech-recognition', id, {
      device,
      // The encoder needs full precision on WebGPU; the decoder is fine in 4 bits.
      dtype: device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
      progress_callback,
    })
  } catch (e) {
    if (device !== 'webgpu') throw e
    device = 'wasm'
    asr = await T.pipeline('automatic-speech-recognition', id, { device, dtype: 'q8', progress_callback })
  }
  loadedModel = model
  ctx.postMessage({ type: 'ready', device, model })
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

ctx.onmessage = async (e) => {
  const msg = e.data
  if (msg.type === 'load') {
    loading = load(msg.model).catch((err) => {
      asr = null
      ctx.postMessage({ type: 'error', message: `Could not load the speech model: ${message(err)}` })
    })
    return
  }
  if (msg.type === 'transcribe') {
    try {
      if (loading) await loading
      if (!asr) throw new Error('The speech model is not loaded.')
      const opts: Record<string, unknown> = { task: 'transcribe', return_timestamps: false, chunk_length_s: 30 }
      if (msg.language) opts.language = msg.language
      const out = await asr(msg.audio, opts)
      const text = (Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : out.text ?? '').trim()
      ctx.postMessage({ type: 'result', id: msg.id, text })
    } catch (err) {
      ctx.postMessage({ type: 'error', id: msg.id, message: `Transcription failed: ${message(err)}` })
    }
  }
}
