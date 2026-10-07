// The agent loop: ask the model, run the KherveOS tools it calls, hand the
// results back, and repeat — up to MAX_STEPS model calls per message. Every
// step is streamed into the chat as it happens and saved when it ends.

import { defaultSystemPrompt } from './prompt'
import { ProviderError, streamChat } from './providers'
import {
  controllers,
  markNoTools,
  openDialog,
  saveChat,
  thinkParam,
  titleFrom,
  toolsFor,
  updateChat,
  useAi,
} from './store'
import { execTool, recoverToolCalls, toolFromWire, type WireTool } from './toolbridge'
import type { AssistantMessage, Attachment, StreamEvent, ToolCall, Turn, Usage, UserMessage } from './types'
import { callId, errorText, isAbort, uid } from './util'

export const MAX_STEPS = 8

const get = useAi.getState

function patchMsg(chatId: string, msgId: string, fn: (m: AssistantMessage) => AssistantMessage) {
  updateChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId && m.role === 'assistant' ? fn(m) : m)) }), false)
}

function patchTurn(chatId: string, msgId: string, index: number, fn: (t: Turn) => Turn) {
  patchMsg(chatId, msgId, (m) => {
    if (!m.turns[index]) return m
    const turns = m.turns.slice()
    turns[index] = fn(turns[index])
    return { ...m, turns }
  })
}

function currentTurn(chatId: string, msgId: string, index: number): Turn | null {
  const m = get().chats[chatId]?.messages.find((x) => x.id === msgId)
  return m && m.role === 'assistant' ? (m.turns[index] ?? null) : null
}

function setRunning(chatId: string, on: boolean) {
  useAi.setState((s) => {
    const running = { ...s.running }
    if (on) running[chatId] = true
    else delete running[chatId]
    return { running }
  })
}

/** Does this chat's provider need a key that isn't set? Opens Settings if so. */
export function missingKey(chatId: string): boolean {
  const chat = get().chats[chatId]
  if (!chat || chat.provider === 'ollama') return false
  if (get().keys[chat.provider]) return false
  openDialog('settings', chat.provider)
  return true
}

/** Send a message and let the model answer (and act). */
export function sendMessage(chatId: string, text: string, attachments: Attachment[] = []): boolean {
  const s = get()
  const chat = s.chats[chatId]
  if (!chat || s.running[chatId] || (!text.trim() && !attachments.length)) return false
  if (missingKey(chatId)) return false
  const msg: UserMessage = { id: uid('m'), role: 'user', time: Date.now(), text: text.trim() }
  if (attachments.length) msg.attachments = attachments
  updateChat(chatId, (c) => ({
    ...c,
    title: c.title === 'New chat' && !c.messages.length ? titleFrom(text || attachments[0]?.name || '') : c.title,
    messages: [...c.messages, msg],
  }))
  void runAgent(chatId)
  return true
}

/** Write the last reply again. */
export function regenerate(chatId: string) {
  const s = get()
  const chat = s.chats[chatId]
  if (!chat || s.running[chatId]) return
  const last = chat.messages[chat.messages.length - 1]
  if (last?.role !== 'assistant') return
  if (missingKey(chatId)) return
  updateChat(chatId, (c) => ({ ...c, messages: c.messages.slice(0, -1) }))
  void runAgent(chatId)
}

/** Carry on after the step limit. */
export function continueRun(chatId: string) {
  if (missingKey(chatId)) return
  void runAgent(chatId, { resume: true })
}

const STOPPED = 'Not run: the person stopped the reply.'

export async function runAgent(chatId: string, opts: { resume?: boolean } = {}): Promise<void> {
  const start = get().chats[chatId]
  if (!start || get().running[chatId]) return
  const controller = new AbortController()
  const signal = controller.signal
  controllers.set(chatId, controller)
  setRunning(chatId, true)

  const provider = start.provider
  const model = start.model
  const last = start.messages[start.messages.length - 1]
  let msgId: string
  let usage: Usage = {}
  if (opts.resume && last?.role === 'assistant') {
    msgId = last.id
    usage = { ...last.usage }
    patchMsg(chatId, msgId, (m) => ({ ...m, limited: false, stopped: false, error: undefined, provider, model }))
  } else {
    const msg: AssistantMessage = { id: uid('m'), role: 'assistant', time: Date.now(), provider, model, turns: [] }
    msgId = msg.id
    updateChat(chatId, (c) => ({ ...c, messages: [...c.messages, msg] }))
  }
  void saveChat(chatId)

  let tools: WireTool[] | null = toolsFor(provider, model)
  // Tool call ids must be unique in a chat (Claude refuses repeats, and some local models reuse them).
  const seenIds = new Set<string>()
  for (const m of start.messages) if (m.role === 'assistant') for (const t of m.turns) for (const c of t.calls) seenIds.add(c.id)
  const uniqueId = (id: string) => {
    let out = id
    while (seenIds.has(out)) out = callId()
    seenIds.add(out)
    return out
  }
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const chat = get().chats[chatId]
      if (!chat) return
      const at = chat.messages.findIndex((m) => m.id === msgId)
      const msg = chat.messages[at]
      if (at < 0 || msg.role !== 'assistant') return
      const history = chat.messages.slice(0, at + 1)
      const index = msg.turns.length
      patchMsg(chatId, msgId, (m) => ({ ...m, turns: [...m.turns, { text: '', calls: [] }] }))

      // Text arrives in many small pieces: hand them to the screen ~25 times a second.
      let text = ''
      let thinking = ''
      let timer: number | null = null
      const flush = () => {
        if (timer !== null) window.clearTimeout(timer)
        timer = null
        if (!text && !thinking) return
        const t = text
        const th = thinking
        text = ''
        thinking = ''
        patchTurn(chatId, msgId, index, (turn) => ({ ...turn, text: turn.text + t, thinking: th ? (turn.thinking ?? '') + th : turn.thinking }))
      }
      const onEvent = (e: StreamEvent) => {
        if (e.type === 'text') text += e.text
        else if (e.type === 'thinking') thinking += e.text
        else {
          flush()
          const call: ToolCall = { id: uniqueId(e.id), name: tools ? toolFromWire(e.name, tools) : e.name, args: e.args, status: 'pending' }
          patchTurn(chatId, msgId, index, (turn) => ({ ...turn, calls: [...turn.calls, call] }))
          return
        }
        if (timer === null) timer = window.setTimeout(flush, 40)
      }

      try {
        const res = await streamChat({
          provider,
          model,
          system: chat.system ?? defaultSystemPrompt(tools),
          history,
          tools,
          signal,
          key: provider === 'ollama' ? '' : get().keys[provider],
          ollamaUrl: get().settings.ollamaUrl,
          numCtx: get().settings.numCtx,
          think: thinkParam(provider, model),
          onEvent,
        })
        if (res.usage) usage = { input: (usage.input ?? 0) + (res.usage.input ?? 0), output: (usage.output ?? 0) + (res.usage.output ?? 0) }
      } catch (e) {
        flush()
        if (e instanceof ProviderError && e.noTools && tools) {
          // This model can't take tools after all: ask again without them.
          markNoTools(provider, model)
          tools = null
          patchMsg(chatId, msgId, (m) => ({ ...m, turns: m.turns.slice(0, index) }))
          step--
          continue
        }
        throw e
      } finally {
        flush()
      }
      if (signal.aborted) break

      let turn = currentTurn(chatId, msgId, index)
      if (!turn) return
      // Small local models sometimes write the call out as JSON instead of making it.
      if (tools && !turn.calls.length && provider === 'ollama') {
        const found = recoverToolCalls(turn.text, tools)
        if (found) {
          patchTurn(chatId, msgId, index, (t) => ({
            ...t,
            text: found.text,
            calls: found.calls.map((c) => ({ id: uniqueId(callId()), name: c.name, args: c.args, status: 'pending' as const })),
          }))
          turn = currentTurn(chatId, msgId, index)
          if (!turn) return
        }
      }
      if (!turn.calls.length) break

      if (step === MAX_STEPS - 1) {
        // Out of steps: don't do what the model can no longer follow up on.
        patchTurn(chatId, msgId, index, (t) => ({
          ...t,
          calls: t.calls.map((c) => ({
            ...c,
            status: 'skipped' as const,
            result: { ok: false, error: `Not run: KherveAI stops after ${MAX_STEPS} steps per message. The person can press Continue.` },
          })),
        }))
        patchMsg(chatId, msgId, (m) => ({ ...m, limited: true }))
        break
      }

      for (let i = 0; i < turn.calls.length; i++) {
        if (signal.aborted) break
        const call = turn.calls[i]
        const setCall = (patch: Partial<ToolCall>) =>
          patchTurn(chatId, msgId, index, (t) => ({ ...t, calls: t.calls.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
        setCall({ status: 'running' })
        const t0 = performance.now()
        const result = await execTool(call.name, call.args, signal)
        setCall({ status: result.ok ? 'done' : 'error', result, ms: Math.round(performance.now() - t0) })
        void saveChat(chatId)
      }
      if (signal.aborted) break
    }
  } catch (e) {
    if (!signal.aborted && !isAbort(e)) patchMsg(chatId, msgId, (m) => ({ ...m, error: errorText(e) }))
  } finally {
    patchMsg(chatId, msgId, (m) => {
      const turns = m.turns
        .map((t) => ({
          ...t,
          calls: t.calls.map((c) =>
            c.status === 'pending' || c.status === 'running' ? { ...c, status: 'skipped' as const, result: { ok: false, error: STOPPED } } : c,
          ),
        }))
        .filter((t, i, all) => i < all.length - 1 || t.text || t.thinking || t.calls.length)
      return { ...m, turns, stopped: signal.aborted || undefined, usage: usage.input || usage.output ? usage : m.usage }
    })
    if (controllers.get(chatId) === controller) controllers.delete(chatId)
    setRunning(chatId, false)
    void saveChat(chatId)
  }
}
