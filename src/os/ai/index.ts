// The AI service: chat with Claude (through the server, which holds the API key)
// or with a local Ollama model. Any app can use it; KherveAI uses the server's Claude.

import { api, ApiError, useServer } from '@/os/server'

export type AiProvider = 'auto' | 'claude' | 'ollama'

export interface AiMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiStatus {
  claude: boolean
  claude_model: string
  ollama: boolean
  ollama_models: string[]
}

export type AiEvent =
  | { provider: 'claude' | 'ollama'; model: string }
  | { text: string }
  | { error: string }
  | { done: true }

export function aiStatus(): Promise<AiStatus> {
  return api<AiStatus>('/ai/status')
}

/** Streams one answer; `onEvent` sees each event as it arrives. Abort with `signal`. */
export async function aiChat(
  messages: AiMessage[],
  opts: { provider?: AiProvider; model?: string; signal?: AbortSignal },
  onEvent: (e: AiEvent) => void,
): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/ai/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, provider: opts.provider ?? 'auto', model: opts.model }),
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) return
    useServer.getState().markOffline()
    throw new ApiError(0, 'The KherveOS server is not reachable.')
  }
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`
    try {
      const detail = (await res.json())?.detail
      if (typeof detail === 'string') msg = detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg)
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += value
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) onEvent(JSON.parse(line) as AiEvent)
      }
    }
  } catch (e) {
    if (opts.signal?.aborted) return
    throw e
  }
}
