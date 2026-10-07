// Providers, their models, and KherveAI's preferences. Everything here stays in
// this browser's localStorage; API keys (one entry per provider) are only ever
// sent to that provider.

import type { ProviderId } from './types'

export interface ProviderMeta {
  /** "Claude" */
  name: string
  /** "Claude (Anthropic)" */
  label: string
  needsKey: boolean
  /** Suggested models (Ollama lists what is installed instead). */
  models: string[]
  defaultModel: string
  keyUrl?: string
  keyPlaceholder?: string
  host?: string
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  ollama: {
    name: 'Ollama',
    label: 'Ollama (this computer)',
    needsKey: false,
    models: [],
    defaultModel: '',
  },
  anthropic: {
    name: 'Claude',
    label: 'Claude (Anthropic)',
    needsKey: true,
    models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5-20251001'],
    defaultModel: 'claude-sonnet-5-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    host: 'api.anthropic.com',
  },
  openai: {
    name: 'ChatGPT',
    label: 'ChatGPT (OpenAI)',
    needsKey: true,
    models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3'],
    defaultModel: 'gpt-5',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    host: 'api.openai.com',
  },
}

export const PROVIDER_IDS: ProviderId[] = ['ollama', 'anthropic', 'openai']

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

/** Ollama models we would rather start with, best first (by name prefix). */
const OLLAMA_PREFERRED = ['qwen3.5', 'qwen3', 'granite4', 'llama3.2', 'llama3.1', 'mistral', 'qwen2.5', 'phi4']

export interface AiSettings {
  /** The provider new chats start with. */
  provider: ProviderId
  /** The last model used with each provider. */
  models: Record<ProviderId, string>
  ollamaUrl: string
  /** "Let the AI act in KherveOS": offer the KherveOS tools to models that can use them. */
  act: boolean
  /** Let local models that can think do so before answering (slower). */
  think: boolean
  /** Ollama's context window, in tokens. */
  numCtx: number
  /** Model names typed by hand ("Other model…"), kept in the lists. */
  custom: Record<ProviderId, string[]>
}

const SETTINGS_KEY = 'kherveai.settings'
const keyName = (p: ProviderId) => `kherveai.apiKey.${p}`

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const DEFAULT_SETTINGS: AiSettings = {
  provider: 'ollama',
  models: { ollama: '', anthropic: PROVIDERS.anthropic.defaultModel, openai: PROVIDERS.openai.defaultModel },
  ollamaUrl: DEFAULT_OLLAMA_URL,
  act: true,
  think: false,
  numCtx: 16384,
  custom: { ollama: [], anthropic: [], openai: [] },
}

const isProvider = (v: unknown): v is ProviderId => v === 'ollama' || v === 'anthropic' || v === 'openai'
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [])

export function loadSettings(): AiSettings {
  let raw: Record<string, unknown> = {}
  try {
    const text = storage()?.getItem(SETTINGS_KEY)
    if (text) raw = JSON.parse(text) as Record<string, unknown>
  } catch {
    raw = {}
  }
  const d = DEFAULT_SETTINGS
  const models = (raw.models && typeof raw.models === 'object' ? raw.models : {}) as Record<string, unknown>
  const custom = (raw.custom && typeof raw.custom === 'object' ? raw.custom : {}) as Record<string, unknown>
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
  return {
    provider: isProvider(raw.provider) ? raw.provider : d.provider,
    models: {
      ollama: str(models.ollama, d.models.ollama),
      anthropic: str(models.anthropic, d.models.anthropic),
      openai: str(models.openai, d.models.openai),
    },
    ollamaUrl: str(raw.ollamaUrl, d.ollamaUrl).replace(/\/+$/, ''),
    act: typeof raw.act === 'boolean' ? raw.act : d.act,
    think: typeof raw.think === 'boolean' ? raw.think : d.think,
    numCtx: typeof raw.numCtx === 'number' && raw.numCtx >= 2048 ? Math.min(Math.round(raw.numCtx), 1_048_576) : d.numCtx,
    custom: { ollama: strings(custom.ollama), anthropic: strings(custom.anthropic), openai: strings(custom.openai) },
  }
}

export function saveSettings(s: AiSettings) {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* storage full or blocked: keep the settings for this session only */
  }
}

export function loadKey(p: ProviderId): string {
  try {
    return storage()?.getItem(keyName(p)) ?? ''
  } catch {
    return ''
  }
}

export function saveKey(p: ProviderId, key: string) {
  try {
    const s = storage()
    if (!s) return
    if (key.trim()) s.setItem(keyName(p), key.trim())
    else s.removeItem(keyName(p))
  } catch {
    /* ignore */
  }
}

/** The Ollama model to use when the remembered one is not installed. */
export function pickOllamaModel(installed: { name: string; caps: string[] | null }[], wanted: string): string {
  if (!installed.length) return wanted
  if (wanted && installed.some((m) => m.name === wanted)) return wanted
  for (const prefix of OLLAMA_PREFERRED) {
    const hit = installed.find((m) => m.name.startsWith(prefix) && (m.caps?.includes('tools') ?? true))
    if (hit) return hit.name
  }
  return (installed.find((m) => m.caps?.includes('tools')) ?? installed[0]).name
}

/** Does this OpenAI model take function tools? (A few special-purpose ones don't.) */
export function openaiSupportsTools(model: string): boolean {
  return !/(^o1-mini|^o1-preview|instruct|realtime|audio|tts|transcribe|search|image|embedding|moderation|dall-e|whisper)/i.test(model)
}
