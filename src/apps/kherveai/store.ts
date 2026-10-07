// KherveAI's state: the chats (saved as JSON files in ~/Documents/AI Chats/,
// one per chat, named after it), which one is open, which are busy, Ollama's
// status and models, and the preferences.

import { create } from 'zustand'
import { HOME, fs, os, path as vpath } from '@/os'
import { fetchOllamaCaps, fetchOllamaModels, fetchRemoteModels } from './providers'
import {
  PROVIDERS,
  loadKey,
  loadSettings,
  openaiSupportsTools,
  pickOllamaModel,
  saveKey,
  saveSettings,
  type AiSettings,
} from './settings'
import { availableTools, type WireTool } from './toolbridge'
import type { Chat, ChatFile, Message, OllamaModel, ProviderId, ToolCall, UserMessage } from './types'
import { errorText, uid } from './util'

export const CHATS_DIR = `${HOME}/Documents/AI Chats`

export type KeyedProvider = 'anthropic' | 'openai'

export interface OllamaState {
  status: 'unknown' | 'checking' | 'ok' | 'down'
  models: OllamaModel[]
  error?: string
}

export type DialogKind = 'settings' | 'system' | null
/** Which field the settings dialog starts in. */
export type SettingsFocus = 'ollama' | KeyedProvider

export interface AiState {
  settings: AiSettings
  keys: Record<KeyedProvider, string>
  /** Chats in memory (the open one, busy ones, ones opened earlier). */
  chats: Record<string, Chat>
  /** Where each saved chat lives on the drive. New chats have none until their first message. */
  paths: Record<string, string>
  activeId: string | null
  /** Chats with a reply being written. */
  running: Record<string, boolean>
  ollama: OllamaState
  /** Models the Claude/ChatGPT APIs listed for the person's key. */
  remote: Partial<Record<ProviderId, string[]>>
  /** "provider:model" that turned out not to take tools. */
  noTools: Record<string, boolean>
  dialog: DialogKind
  settingsFocus: SettingsFocus
}

export const useAi = create<AiState>(() => ({
  settings: loadSettings(),
  keys: { anthropic: loadKey('anthropic'), openai: loadKey('openai') },
  chats: {},
  paths: {},
  activeId: null,
  running: {},
  ollama: { status: 'unknown', models: [] },
  remote: {},
  noTools: {},
  dialog: null,
  settingsFocus: 'ollama',
}))

const get = useAi.getState
const set = useAi.setState

/** The abort switch of every reply being written. */
export const controllers = new Map<string, AbortController>()

// ----------------------------------------------------------------- settings

export function updateSettings(patch: Partial<AiSettings>) {
  const settings = { ...get().settings, ...patch }
  saveSettings(settings)
  set({ settings })
}

export function setApiKey(p: KeyedProvider, key: string) {
  saveKey(p, key)
  set((s) => ({ keys: { ...s.keys, [p]: key.trim() } }))
}

export function openDialog(dialog: DialogKind, focus?: SettingsFocus) {
  set(focus ? { dialog, settingsFocus: focus } : { dialog })
}

// ------------------------------------------------------------------- models

/** The model a new chat with this provider starts with. */
export function defaultModel(provider: ProviderId): string {
  const s = get()
  if (provider === 'ollama') return pickOllamaModel(s.ollama.models, s.settings.models.ollama)
  return s.settings.models[provider] || PROVIDERS[provider].defaultModel
}

/** The models to offer for a provider (installed / known / listed by the API / typed by hand). */
export function modelChoices(
  provider: ProviderId,
  s: Pick<AiState, 'ollama' | 'remote'> & { settings: Pick<AiSettings, 'custom'> } = get(),
): string[] {
  if (provider === 'ollama') return s.ollama.models.map((m) => m.name)
  const all = [...PROVIDERS[provider].models, ...(s.remote[provider] ?? []), ...s.settings.custom[provider]]
  return [...new Set(all)]
}

export function ollamaModel(name: string, s: AiState = get()): OllamaModel | undefined {
  return s.ollama.models.find((m) => m.name === name)
}

export function modelSupportsTools(provider: ProviderId, model: string, s: AiState = get()): boolean {
  if (s.noTools[`${provider}:${model}`]) return false
  if (provider === 'ollama') {
    const caps = ollamaModel(model, s)?.caps
    return caps ? caps.includes('tools') : true // unknown: offer them; Ollama says if it can't
  }
  if (provider === 'openai') return openaiSupportsTools(model)
  return true
}

/** The tools this chat's model gets right now (null: none). */
export function toolsFor(provider: ProviderId, model: string): WireTool[] | null {
  const s = get()
  if (!s.settings.act || !modelSupportsTools(provider, model, s)) return null
  const tools = availableTools()
  return tools.length ? tools : null
}

export function markNoTools(provider: ProviderId, model: string) {
  set((s) => ({ noTools: { ...s.noTools, [`${provider}:${model}`]: true } }))
}

/** Is Ollama's "think" switch worth sending for this model? */
export function thinkParam(provider: ProviderId, model: string): boolean | null {
  if (provider !== 'ollama') return null
  const s = get()
  return ollamaModel(model, s)?.caps?.includes('thinking') ? s.settings.think : null
}

let ollamaCheck: Promise<void> | null = null

/** Ask Ollama what is installed (and whether it is running at all). */
export function refreshOllama(): Promise<void> {
  if (ollamaCheck) return ollamaCheck
  set((s) => ({ ollama: { ...s.ollama, status: s.ollama.status === 'ok' ? 'ok' : 'checking' } }))
  ollamaCheck = (async () => {
    const url = get().settings.ollamaUrl
    try {
      const models = await fetchOllamaModels(url)
      await Promise.all(
        models.filter((m) => !m.caps).map(async (m) => {
          m.caps = await fetchOllamaCaps(url, m.name)
        }),
      )
      set({ ollama: { status: 'ok', models } })
      adoptOllamaModels()
    } catch (e) {
      set((s) => ({ ollama: { status: 'down', models: s.ollama.models, error: errorText(e) } }))
    } finally {
      ollamaCheck = null
    }
  })()
  return ollamaCheck
}

/** Once the installed models are known: give empty Ollama chats a model that exists. */
function adoptOllamaModels() {
  const s = get()
  const best = pickOllamaModel(s.ollama.models, s.settings.models.ollama)
  if (best && best !== s.settings.models.ollama && !s.ollama.models.some((m) => m.name === s.settings.models.ollama)) {
    updateSettings({ models: { ...s.settings.models, ollama: best } })
  }
  const chats = { ...s.chats }
  let changed = false
  for (const c of Object.values(s.chats)) {
    if (c.provider === 'ollama' && !c.messages.length && !s.ollama.models.some((m) => m.name === c.model)) {
      chats[c.id] = { ...c, model: best }
      changed = true
    }
  }
  if (changed) set({ chats })
}

/** List the models a Claude/ChatGPT key can use; also checks the key. */
export async function refreshRemoteModels(p: KeyedProvider, key = get().keys[p]): Promise<string[]> {
  const models = await fetchRemoteModels(p, key)
  set((s) => ({ remote: { ...s.remote, [p]: models } }))
  return models
}

// -------------------------------------------------------------------- chats

export function activeChat(s: AiState = get()): Chat | null {
  return s.activeId ? (s.chats[s.activeId] ?? null) : null
}

export function updateChat(id: string, fn: (c: Chat) => Chat, touch = true) {
  set((s) => {
    const c = s.chats[id]
    if (!c) return {}
    const next = fn(c)
    return { chats: { ...s.chats, [id]: touch ? { ...next, updated: Date.now() } : next } }
  })
}

/** Start a new chat (reusing the open one if it is still empty). */
export function newChat(): string {
  const s = get()
  const cur = activeChat(s)
  if (cur && !s.paths[cur.id] && !cur.messages.length && !s.running[cur.id]) return cur.id
  const provider = s.settings.provider
  const now = Date.now()
  const chat: Chat = { id: uid('c'), title: 'New chat', created: now, updated: now, provider, model: defaultModel(provider), system: null, messages: [] }
  // Forget other empty, unsaved chats.
  const chats: Record<string, Chat> = {}
  for (const [id, c] of Object.entries(s.chats)) if (s.paths[id] || c.messages.length || s.running[id]) chats[id] = c
  set({ chats: { ...chats, [chat.id]: chat }, activeId: chat.id })
  return chat.id
}

export function chatIdForPath(path: string, s: AiState = get()): string | null {
  for (const [id, p] of Object.entries(s.paths)) if (p === path) return id
  return null
}

const stem = (p: string) => vpath.basename(p).replace(/\.json$/i, '')

function normalizeCall(c: ToolCall): ToolCall {
  if (c.status === 'running' || c.status === 'pending') {
    return { ...c, status: 'error', result: c.result ?? { ok: false, error: 'Interrupted (KherveAI was closed while it ran).' } }
  }
  return c
}

/** A chat file's contents, checked and tidied. */
function parseChat(text: string, path: string): Chat {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON.')
  }
  const d = raw && typeof raw === 'object' ? (raw as Partial<ChatFile>) : null
  if (!d || d.format !== 'kherveai-chat' || !Array.isArray(d.messages)) throw new Error('This is not a KherveAI chat.')
  const provider: ProviderId = d.provider === 'anthropic' || d.provider === 'openai' ? d.provider : 'ollama'
  const messages: Message[] = d.messages
    .filter((m): m is Message => !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant'))
    .map((m) =>
      m.role === 'user'
        ? { ...m, id: m.id || uid('m'), text: typeof m.text === 'string' ? m.text : '' }
        : {
            ...m,
            id: m.id || uid('m'),
            turns: (Array.isArray(m.turns) ? m.turns : []).map((t) => ({
              ...t,
              text: typeof t.text === 'string' ? t.text : '',
              calls: (Array.isArray(t.calls) ? t.calls : []).map(normalizeCall),
            })),
          },
    )
  const st = fs.stat(path)
  return {
    id: typeof d.id === 'string' && d.id ? d.id : uid('c'),
    title: stem(path),
    created: typeof d.created === 'number' ? d.created : (st?.ctime ?? Date.now()),
    updated: typeof d.updated === 'number' ? d.updated : (st?.mtime ?? Date.now()),
    provider,
    model: typeof d.model === 'string' && d.model ? d.model : defaultModel(provider),
    system: typeof d.system === 'string' ? d.system : null,
    messages,
  }
}

/** A saved chat, read without opening it. */
export async function readChatFile(path: string): Promise<Chat> {
  return parseChat(await fs.readText(path), path)
}

/** Open a saved chat (from the list or Files). */
export async function openChatFile(path: string): Promise<boolean> {
  const known = chatIdForPath(path)
  if (known && get().chats[known]) {
    set({ activeId: known })
    return true
  }
  try {
    const chat = parseChat(await fs.readText(path), path)
    const s = get()
    if (s.chats[chat.id] && s.paths[chat.id] !== path) chat.id = uid('c') // a copy of an open chat
    set({ chats: { ...s.chats, [chat.id]: chat }, paths: { ...s.paths, [chat.id]: path }, activeId: chat.id })
    return true
  } catch (e) {
    await os.dialog.alert(`Could not open "${vpath.basename(path)}".\n\n${errorText(e)}`, { title: 'KherveAI' })
    return false
  }
}

/** A short title from the first message. */
export function titleFrom(text: string): string {
  const one = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/[#*_`>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!one) return 'New chat'
  if (one.length <= 48) return one
  const cut = one.slice(0, 48)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > 24 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}

function fileNameFor(title: string): string {
  const clean = title
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim()
  return `${clean || 'Chat'}.json`
}

// One queue per chat, so saves and renames never overlap.
const queues = new Map<string, Promise<unknown>>()
function enqueue<T>(id: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(job)
  queues.set(id, next)
  void next.finally(() => {
    if (queues.get(id) === next) queues.delete(id)
  }).catch(() => undefined)
  return next
}

/** Write the chat to its file (creating it, named after the chat, on the first save). */
export function saveChat(id: string): Promise<void> {
  return enqueue(id, async () => {
    const s = get()
    const chat = s.chats[id]
    if (!chat || (!chat.messages.length && !s.paths[id])) return
    let p = s.paths[id]
    if (!p) {
      await fs.mkdir(CHATS_DIR, { recursive: true })
      p = vpath.join(CHATS_DIR, fs.uniqueName(CHATS_DIR, fileNameFor(chat.title)))
      const target = p
      set((st) => ({ paths: { ...st.paths, [id]: target } }))
      if (stem(p) !== chat.title) updateChat(id, (c) => ({ ...c, title: stem(target) }), false)
    }
    const file: ChatFile = { format: 'kherveai-chat', version: 1, ...get().chats[id] }
    await fs.writeText(p, JSON.stringify(file, null, 1))
  }).catch((e) => {
    console.warn('[KherveAI] could not save the chat', e)
    os.notify({ title: 'KherveAI could not save a chat', body: errorText(e) })
  })
}

export async function renameChat(id: string, title: string): Promise<void> {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (!clean || !get().chats[id]) return
  updateChat(id, (c) => ({ ...c, title: clean }), false)
  await enqueue(id, async () => {
    const p = get().paths[id]
    if (!p || !fs.exists(p)) return
    const name = fileNameFor(clean)
    if (vpath.basename(p) === name) return
    const dir = vpath.dirname(p)
    const target = vpath.join(dir, name.toLowerCase() === vpath.basename(p).toLowerCase() ? name : fs.uniqueName(dir, name))
    await fs.rename(p, target)
    set((s) => ({ paths: { ...s.paths, [id]: target } }))
    updateChat(id, (c) => ({ ...c, title: stem(target) }), false)
  }).catch((e) => os.dialog.alert(`The chat could not be renamed.\n\n${errorText(e)}`, { title: 'KherveAI' }))
}

/** Ask for a new name (chat in memory or just a file in the list). */
export async function promptRename(target: { id?: string; path?: string }): Promise<void> {
  const id = target.id ?? (target.path ? chatIdForPath(target.path) : null)
  const current = id ? get().chats[id]?.title : target.path ? stem(target.path) : ''
  const name = await os.dialog.prompt('New name for this chat:', { title: 'Rename chat', defaultValue: current ?? '', okLabel: 'Rename' })
  if (!name?.trim() || name.trim() === current) return
  if (id) {
    if (!get().paths[id]) updateChat(id, (c) => ({ ...c, title: name.trim() }), false)
    else await renameChat(id, name)
    return
  }
  if (!target.path) return
  try {
    const dir = vpath.dirname(target.path)
    await fs.rename(target.path, vpath.join(dir, fs.uniqueName(dir, fileNameFor(name))))
  } catch (e) {
    await os.dialog.alert(`The chat could not be renamed.\n\n${errorText(e)}`, { title: 'KherveAI' })
  }
}

/** Remove a chat from memory (after its file went away). */
function forget(id: string) {
  controllers.get(id)?.abort()
  set((s) => {
    const chats = { ...s.chats }
    const paths = { ...s.paths }
    const running = { ...s.running }
    delete chats[id]
    delete paths[id]
    delete running[id]
    return { chats, paths, running, activeId: s.activeId === id ? null : s.activeId }
  })
  if (!get().activeId) newChat()
}

export async function deleteChat(target: { id?: string; path?: string }): Promise<void> {
  const s = get()
  const id = target.id ?? (target.path ? chatIdForPath(target.path) : null)
  const p = (id ? s.paths[id] : undefined) ?? target.path
  const title = (id ? s.chats[id]?.title : undefined) ?? (p ? stem(p) : 'this chat')
  if (id && !p && !s.chats[id]?.messages.length) return // an empty new chat: nothing to delete
  const ok = await os.dialog.confirm(`Delete the chat "${title}"? This cannot be undone.`, { title: 'Delete chat', okLabel: 'Delete', danger: true })
  if (!ok) return
  if (id) forget(id)
  if (p && fs.exists(p)) {
    const job = () => fs.remove(p)
    await (id ? enqueue(id, job) : job()).catch((e: unknown) => os.dialog.alert(`The chat could not be deleted.\n\n${errorText(e)}`, { title: 'KherveAI' }))
  }
}

/** Keep paths right when chat files are renamed or deleted elsewhere (Files, Terminal…). */
export function watchChatFiles(): () => void {
  return fs.watch((ev) => {
    const s = get()
    if (ev.type === 'rename') {
      const moved: Record<string, string> = {}
      for (const [id, p] of Object.entries(s.paths)) {
        if (p === ev.oldPath) moved[id] = ev.path
        else if (ev.kind === 'dir' && p.startsWith(`${ev.oldPath}/`)) moved[id] = ev.path + p.slice(ev.oldPath.length)
      }
      if (!Object.keys(moved).length) return
      const chats = { ...s.chats }
      for (const [id, p] of Object.entries(moved)) if (chats[id]) chats[id] = { ...chats[id], title: stem(p) }
      set({ paths: { ...s.paths, ...moved }, chats })
    } else if (ev.type === 'delete') {
      for (const [id, p] of Object.entries(s.paths)) {
        if (p === ev.path || p.startsWith(`${ev.path}/`)) forget(id)
      }
    }
  })
}

// ------------------------------------------------------------ chat settings

export function setChatModel(id: string, provider: ProviderId, model?: string) {
  const m = model ?? defaultModel(provider)
  updateChat(id, (c) => ({ ...c, provider, model: m }), false)
  const s = get().settings
  updateSettings({ provider, models: { ...s.models, [provider]: m } })
  if (get().paths[id]) void saveChat(id)
}

/** "Other model…": a model name typed by hand. */
export async function promptCustomModel(id: string, provider: ProviderId): Promise<void> {
  const name = await os.dialog.prompt(`The ${PROVIDERS[provider].name} model to use (its API name):`, {
    title: 'Other model',
    defaultValue: get().chats[id]?.provider === provider ? get().chats[id]?.model : '',
    placeholder: PROVIDERS[provider].defaultModel || 'model name',
    okLabel: 'Use',
  })
  const model = name?.trim()
  if (!model) return
  const s = get().settings
  if (!modelChoices(provider).includes(model)) updateSettings({ custom: { ...s.custom, [provider]: [...s.custom[provider], model].slice(-12) } })
  setChatModel(id, provider, model)
}

export function setChatSystem(id: string, system: string | null) {
  updateChat(id, (c) => ({ ...c, system }), false)
  if (get().paths[id]) void saveChat(id)
}

/** Take back the last message you sent (and its reply) to edit it. */
export function takeLastUserMessage(id: string): UserMessage | null {
  const s = get()
  const chat = s.chats[id]
  if (!chat || s.running[id]) return null
  let i = chat.messages.length - 1
  while (i >= 0 && chat.messages[i].role !== 'user') i--
  if (i < 0) return null
  const msg = chat.messages[i] as UserMessage
  updateChat(id, (c) => ({ ...c, messages: c.messages.slice(0, i) }))
  if (s.paths[id]) void saveChat(id)
  return msg
}

export function stopRun(id: string) {
  controllers.get(id)?.abort()
}

export function stopAll() {
  for (const c of controllers.values()) c.abort()
}
