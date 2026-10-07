// The AI Chat's providers — the desktop's ai_providers.py over fetch:
// Claude, ChatGPT, Mistral, Ollama and a local OpenAI-compatible server.
// Settings and keys stay in this browser (localStorage) and go only to the
// chosen provider, as on the desktop (QSettings).

const KEY = 'khervemol.ai'
const ANTHROPIC_VERSION = '2023-06-01'
const OPENAI_LIKE = new Set(['ChatGPT', 'Mistral', 'Local'])
export const DEFAULT_BASE: Record<string, string> = {
  Claude: 'https://api.anthropic.com',
  ChatGPT: 'https://api.openai.com',
  Mistral: 'https://api.mistral.ai',
  Ollama: 'http://localhost:11434',
  Local: 'http://localhost:1234',
}

export interface AiSettings {
  provider: string
  models: Record<string, string>
  keys: Record<string, string>
  bases: Record<string, string>
}

export function loadAiSettings(): AiSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<AiSettings>
    return { provider: s.provider ?? 'Claude', models: s.models ?? {}, keys: s.keys ?? {}, bases: s.bases ?? {} }
  } catch {
    return { provider: 'Claude', models: {}, keys: {}, bases: {} }
  }
}

export function saveAiSettings(s: AiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode */
  }
}

const base = (provider: string, url: string) => (url.trim() || DEFAULT_BASE[provider] || '').replace(/\/+$/, '')

async function send(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new Error(`Could not reach ${new URL(url).origin} (is it running, and does it allow requests from this page?)`)
  }
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = {}
  }
  if (!res.ok) {
    const err = data.error as { message?: string } | string | undefined
    const detail = (typeof err === 'object' && err?.message) || (typeof data.message === 'string' ? data.message : '') || text
    const hint = res.status === 401 || res.status === 403 ? ' — check your API key in Settings (no spaces/newlines).' : ''
    throw new Error(`HTTP ${res.status}: ${String(detail).slice(0, 300)}${hint}`)
  }
  return data
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** ai_providers.chat: send the messages, return the reply text. */
export async function chat(provider: string, model: string, messages: ChatMessage[], apiKey = '', baseUrl = '', signal?: AbortSignal): Promise<string> {
  const key = apiKey.trim()
  const json = { 'Content-Type': 'application/json' }
  if (OPENAI_LIKE.has(provider)) {
    const data = await send(`${base(provider, baseUrl)}/v1/chat/completions`, {
      method: 'POST', signal, headers: { ...json, ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model, messages }),
    })
    return String((data.choices as { message: { content: string } }[])[0].message.content)
  }
  if (provider === 'Claude') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const convo = messages.filter((m) => m.role !== 'system')
    const body: Record<string, unknown> = { model, max_tokens: 4096, messages: convo }
    if (system) body.system = system
    const data = await send(`${base('Claude', baseUrl)}/v1/messages`, {
      method: 'POST', signal,
      headers: { ...json, 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body),
    })
    return ((data.content as { type?: string; text?: string }[]) ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  }
  if (provider === 'Ollama') {
    const data = await send(`${base('Ollama', baseUrl)}/api/chat`, { method: 'POST', signal, headers: json, body: JSON.stringify({ model, messages, stream: false }) })
    return String((data.message as { content: string }).content)
  }
  throw new Error(`unknown provider: ${provider}`)
}

/** ai_providers.list_models. */
export async function fetchModels(provider: string, apiKey = '', baseUrl = ''): Promise<string[]> {
  const key = apiKey.trim()
  if (OPENAI_LIKE.has(provider)) {
    const data = await send(`${base(provider, baseUrl)}/v1/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} })
    return ((data.data as { id?: string }[]) ?? []).map((m) => m.id ?? '').filter(Boolean).sort()
  }
  if (provider === 'Claude') {
    const data = await send(`${base('Claude', baseUrl)}/v1/models`, { headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' } })
    return ((data.data as { id?: string }[]) ?? []).map((m) => m.id ?? '').filter(Boolean).sort()
  }
  if (provider === 'Ollama') {
    const data = await send(`${base('Ollama', baseUrl)}/api/tags`, {})
    return ((data.models as { name?: string }[]) ?? []).map((m) => m.name ?? '').filter(Boolean).sort()
  }
  throw new Error(`unknown provider: ${provider}`)
}
