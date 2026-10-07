// Talking to the models: one streamed call to Ollama (NDJSON), Claude (SSE)
// or ChatGPT (SSE), reported as the same small events; and listing models.
// Plain fetch from the browser, no SDKs. API keys go only to their provider.

import { toAnthropic, toOllama, toOpenAI } from './history'
import { PROVIDERS, openaiSupportsTools } from './settings'
import type { WireTool } from './toolbridge'
import type { Message, OllamaModel, ProviderId, StreamEvent, Usage } from './types'
import { callId } from './util'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1'
const OPENAI_URL = 'https://api.openai.com/v1'
const CLAUDE_MAX_TOKENS = 16_000

export class ProviderError extends Error {
  status: number
  /** The model can't take tools: ask again without them. */
  noTools: boolean
  constructor(message: string, status = 0, noTools = false) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.noTools = noTools
  }
}

export interface StreamRequest {
  provider: ProviderId
  model: string
  system: string
  history: Message[]
  /** null: the model gets no tools. */
  tools: WireTool[] | null
  signal: AbortSignal
  key: string
  ollamaUrl: string
  numCtx: number
  /** Ollama: whether a thinking model may think (null: leave it to the model). */
  think: boolean | null
  onEvent: (e: StreamEvent) => void
}

export interface StreamResult {
  stop?: string
  usage?: Usage
}

// ------------------------------------------------------------------ plumbing

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v = JSON.parse(raw) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      return { _unparsed: raw }
    }
  }
  return {}
}

async function* readLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '')
        buf = buf.slice(nl + 1)
        yield line
      }
    }
    buf += dec.decode()
    if (buf.trim()) yield buf
  } finally {
    reader.cancel().catch(() => undefined)
  }
}

function errorMessage(text: string): string {
  try {
    const d = obj(JSON.parse(text))
    if (typeof d.error === 'string') return d.error
    const e = obj(d.error)
    if (typeof e.message === 'string') return e.message
    if (typeof d.message === 'string') return d.message
  } catch {
    /* not JSON */
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

function friendlyError(provider: ProviderId, status: number, msg: string, model: string): ProviderError {
  const name = PROVIDERS[provider].name
  if (provider === 'ollama') {
    if (/does not support tools/i.test(msg)) return new ProviderError(msg, status, true)
    if (status === 404 || /model .* not found|not found, try pulling/i.test(msg)) {
      return new ProviderError(`The model "${model}" isn't installed in Ollama. Install it in a terminal with:  ollama pull ${model}`, status)
    }
    return new ProviderError(`Ollama: ${msg || `error ${status}`}`, status)
  }
  if (status === 401) return new ProviderError(`Your ${name} API key was not accepted (401). Check it in Settings › API Keys & Ollama.`, status)
  if (status === 403) return new ProviderError(`${name} refused the request (403). ${msg}`, status)
  if (status === 404) return new ProviderError(`${name} doesn't know the model "${model}" (404). ${msg}`, status)
  if (status === 429) return new ProviderError(`${name}: rate limit or quota reached (429). ${msg}`, status)
  if (status === 529 || status === 503) return new ProviderError(`${name} is overloaded right now (${status}). Try again in a moment.`, status)
  return new ProviderError(`${name} error${status ? ` ${status}` : ''}: ${msg}`, status)
}

function unreachable(provider: ProviderId, ollamaUrl: string): ProviderError {
  if (provider === 'ollama') {
    return new ProviderError(
      `Could not reach Ollama at ${ollamaUrl}. Is it running? Start it with "ollama serve" (or open the Ollama app), then try again.`,
    )
  }
  return new ProviderError(`Could not reach ${PROVIDERS[provider].host}. Check your internet connection.`)
}

async function post(req: StreamRequest, url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: req.signal,
    })
  } catch (e) {
    if (req.signal.aborted) throw e
    throw unreachable(req.provider, req.ollamaUrl)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw friendlyError(req.provider, res.status, errorMessage(text) || res.statusText, req.model)
  }
  return res
}

// -------------------------------------------------------------------- Ollama

async function streamOllama(req: StreamRequest): Promise<StreamResult> {
  const body: Json = {
    model: req.model,
    stream: true,
    messages: toOllama(req.system, req.history, !!req.tools),
    options: { num_ctx: req.numCtx },
  }
  if (req.tools) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.wire, description: t.description, parameters: t.schema } }))
  }
  if (req.think !== null) body.think = req.think
  const res = await post(req, `${req.ollamaUrl}/api/chat`, {}, body)
  const out: StreamResult = {}
  for await (const line of readLines(res)) {
    if (!line.trim()) continue
    let d: Json
    try {
      d = obj(JSON.parse(line))
    } catch {
      continue
    }
    if (typeof d.error === 'string') throw friendlyError('ollama', 0, d.error, req.model)
    const m = obj(d.message)
    if (str(m.thinking)) req.onEvent({ type: 'thinking', text: str(m.thinking) })
    if (str(m.content)) req.onEvent({ type: 'text', text: str(m.content) })
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        const fn = obj(obj(tc).function)
        if (!str(fn.name)) continue
        req.onEvent({ type: 'tool', id: callId(obj(tc).id), name: str(fn.name), args: parseArgs(fn.arguments) })
      }
    }
    if (d.done) {
      out.stop = str(d.done_reason) || undefined
      out.usage = { input: num(d.prompt_eval_count), output: num(d.eval_count) }
    }
  }
  return out
}

// ----------------------------------------------------------------- Anthropic

async function streamAnthropic(req: StreamRequest): Promise<StreamResult> {
  const body: Json = {
    model: req.model,
    max_tokens: CLAUDE_MAX_TOKENS,
    stream: true,
    // Cached: the tools and this prompt are the same on every step of a chat.
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: toAnthropic(req.history, !!req.tools),
  }
  if (req.tools) body.tools = req.tools.map((t) => ({ name: t.wire, description: t.description, input_schema: t.schema }))
  const res = await post(
    req,
    `${ANTHROPIC_URL}/messages`,
    { 'x-api-key': req.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body,
  )
  const out: StreamResult = { usage: {} }
  const blocks = new Map<number, { kind: string; id: string; name: string; json: string }>()
  for await (const line of readLines(res)) {
    if (!line.startsWith('data:')) continue
    let d: Json
    try {
      d = obj(JSON.parse(line.slice(5)))
    } catch {
      continue
    }
    const index = num(d.index) ?? 0
    switch (d.type) {
      case 'message_start': {
        const u = obj(obj(d.message).usage)
        const input = (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0)
        out.usage = { ...out.usage, input: input || undefined }
        break
      }
      case 'content_block_start': {
        const b = obj(d.content_block)
        blocks.set(index, { kind: str(b.type), id: str(b.id), name: str(b.name), json: '' })
        if (b.type === 'text' && str(b.text)) req.onEvent({ type: 'text', text: str(b.text) })
        break
      }
      case 'content_block_delta': {
        const delta = obj(d.delta)
        if (delta.type === 'text_delta' && str(delta.text)) req.onEvent({ type: 'text', text: str(delta.text) })
        else if (delta.type === 'thinking_delta' && str(delta.thinking)) req.onEvent({ type: 'thinking', text: str(delta.thinking) })
        else if (delta.type === 'input_json_delta') {
          const b = blocks.get(index)
          if (b) b.json += str(delta.partial_json)
        }
        break
      }
      case 'content_block_stop': {
        const b = blocks.get(index)
        if (b?.kind === 'tool_use' && b.name) req.onEvent({ type: 'tool', id: callId(b.id), name: b.name, args: parseArgs(b.json) })
        break
      }
      case 'message_delta': {
        out.stop = str(obj(d.delta).stop_reason) || out.stop
        const output = num(obj(d.usage).output_tokens)
        if (output !== undefined) out.usage = { ...out.usage, output }
        break
      }
      case 'error': {
        const e = obj(d.error)
        const overloaded = e.type === 'overloaded_error'
        throw friendlyError('anthropic', overloaded ? 529 : 0, str(e.message) || 'The stream failed.', req.model)
      }
    }
  }
  return out
}

// -------------------------------------------------------------------- OpenAI

async function streamOpenAI(req: StreamRequest): Promise<StreamResult> {
  const body: Json = {
    model: req.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAI(req.system, req.history, !!req.tools),
  }
  if (req.tools) {
    body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.wire, description: t.description, parameters: t.schema } }))
  }
  const res = await post(req, `${OPENAI_URL}/chat/completions`, { Authorization: `Bearer ${req.key}` }, body)
  const out: StreamResult = {}
  const calls = new Map<number, { id: string; name: string; args: string }>()
  for await (const line of readLines(res)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]') break
    let d: Json
    try {
      d = obj(JSON.parse(data))
    } catch {
      continue
    }
    if (d.error) throw friendlyError('openai', 0, str(obj(d.error).message) || 'The stream failed.', req.model)
    if (d.usage) {
      const u = obj(d.usage)
      out.usage = { input: num(u.prompt_tokens), output: num(u.completion_tokens) }
    }
    const choice = obj(Array.isArray(d.choices) ? d.choices[0] : null)
    const delta = obj(choice.delta)
    if (str(delta.content)) req.onEvent({ type: 'text', text: str(delta.content) })
    if (str(delta.reasoning_content)) req.onEvent({ type: 'thinking', text: str(delta.reasoning_content) })
    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        const tc = obj(raw)
        const i = num(tc.index) ?? calls.size
        const cur = calls.get(i) ?? { id: '', name: '', args: '' }
        if (str(tc.id)) cur.id = str(tc.id)
        const fn = obj(tc.function)
        if (str(fn.name)) cur.name += str(fn.name)
        if (str(fn.arguments)) cur.args += str(fn.arguments)
        calls.set(i, cur)
      }
    }
    if (str(choice.finish_reason)) out.stop = str(choice.finish_reason)
  }
  for (const [, c] of [...calls].sort((a, b) => a[0] - b[0])) {
    if (c.name) req.onEvent({ type: 'tool', id: callId(c.id), name: c.name, args: parseArgs(c.args) })
  }
  return out
}

/** One streamed model call. Events arrive through `req.onEvent`. */
export function streamChat(req: StreamRequest): Promise<StreamResult> {
  if (req.provider === 'ollama') return streamOllama(req)
  if (req.provider === 'anthropic') return streamAnthropic(req)
  return streamOpenAI(req)
}

// -------------------------------------------------------------------- models

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 8000): Promise<Json> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status}: ${errorMessage(text) || res.statusText}`)
  return obj(JSON.parse(text))
}

/** The models installed in Ollama. Throws when Ollama can't be reached. */
export async function fetchOllamaModels(base: string): Promise<OllamaModel[]> {
  const d = await getJson(`${base}/api/tags`, {}, 4000)
  const list = Array.isArray(d.models) ? d.models : []
  return list
    .map((raw) => {
      const m = obj(raw)
      const details = obj(m.details)
      return {
        name: str(m.name) || str(m.model),
        size: num(m.size) ?? 0,
        params: str(details.parameter_size) || undefined,
        family: str(details.family) || undefined,
        caps: Array.isArray(m.capabilities) ? m.capabilities.filter((c): c is string => typeof c === 'string') : null,
      }
    })
    .filter((m) => m.name)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** What an Ollama model can do ("tools", "thinking", "vision"…), for older Ollamas whose list doesn't say. */
export async function fetchOllamaCaps(base: string, model: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const d = obj(await res.json())
    return Array.isArray(d.capabilities) ? d.capabilities.filter((c): c is string => typeof c === 'string') : null
  } catch {
    return null
  }
}

/** The models a Claude or ChatGPT key can use (also a way to check the key). */
export async function fetchRemoteModels(provider: 'anthropic' | 'openai', key: string): Promise<string[]> {
  if (!key.trim()) throw new Error('Enter an API key first.')
  try {
    if (provider === 'anthropic') {
      const d = await getJson(`${ANTHROPIC_URL}/models?limit=100`, {
        'x-api-key': key.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      })
      return (Array.isArray(d.data) ? d.data : []).map((m) => str(obj(m).id)).filter(Boolean)
    }
    const d = await getJson(`${OPENAI_URL}/models`, { Authorization: `Bearer ${key.trim()}` })
    return (Array.isArray(d.data) ? d.data : [])
      .map((m) => str(obj(m).id))
      .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && openaiSupportsTools(id))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`Could not reach ${PROVIDERS[provider].host}. Check your internet connection.`)
    if (e instanceof Error && /^401/.test(e.message)) throw new Error('The key was not accepted (401).')
    throw e
  }
}
