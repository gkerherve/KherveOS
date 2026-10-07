// A chat's messages in each provider's format, and files from the drive
// turned into attachments.

import { fs, path as vpath } from '@/os'
import { wireName } from './toolbridge'
import { isPicturePath, readPicture } from './pictures'
import type { AssistantMessage, AttachedPicture, Attachment, Message, ToolCall, Turn, UserMessage } from './types'
import { callId, clip, safeJson } from './util'

// ------------------------------------------------------------- attachments

/** Characters of one file the model gets at most (start and end kept). */
export const MAX_FILE_CHARS = 20_000
/** Characters of attachments in one message at most. */
export const MAX_ATTACH_CHARS = 60_000

function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192)
  let odd = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return true
    if (b < 9 || (b > 13 && b < 32)) odd++
  }
  return n > 0 && odd / n > 0.1
}

/** Read a file from the drive for a message: a text file, or a picture. `budget`: characters left for this one. */
export async function readAttachment(path: string, budget = MAX_FILE_CHARS): Promise<Attachment> {
  const st = fs.stat(path)
  const name = vpath.basename(path)
  if (!st) throw new Error(`"${name}" doesn't exist any more.`)
  if (st.type === 'dir') throw new Error(`"${name}" is a folder. Attach the files inside it instead.`)
  if (isPicturePath(path)) return readPicture(path)
  const bytes = await fs.readBytes(path)
  if (looksBinary(bytes)) throw new Error(`"${name}" isn't a text file, so it can't be attached (pictures — PNG, JPEG, GIF, WebP, BMP — and text files can be; PDFs and other binary files not yet).`)
  const text = new TextDecoder().decode(bytes)
  const max = Math.max(500, Math.min(MAX_FILE_CHARS, budget))
  const truncated = text.length > max
  return { path, name, size: bytes.length, chars: text.length, text: truncated ? clip(text, max) : text, truncated }
}

/** What the model reads for a user message: attached files first, then the text (pictures go alongside, see userPictures). */
export function userContent(m: UserMessage): string {
  const files = (m.attachments ?? []).map((a) => {
    if (a.image) return `<picture path="${a.path}" size="${a.image.width}x${a.image.height}" />`
    const note = a.truncated ? ` shortened="the start and end of ${a.chars} characters"` : ''
    return `<file path="${a.path}"${note}>\n${a.text}\n</file>`
  })
  const text = m.text.trim()
  if (!files.length) return text || '(empty message)'
  const only = (m.attachments ?? []).every((a) => a.image) ? 'Here are the attached pictures.' : 'Here are the attached files.'
  return `${files.join('\n\n')}\n\n${text || only}`
}

/** The pictures attached to a user message. */
export function userPictures(m: UserMessage): AttachedPicture[] {
  return (m.attachments ?? []).flatMap((a) => (a.image ? [a.image] : []))
}

// ---------------------------------------------------------------- results

const MAX_RESULT_CHARS = 20_000

/** A tool call's result as the text the model reads. */
export function resultText(c: ToolCall): string {
  const r = c.result
  if (!r) return 'Error: the tool did not run.'
  if (!r.ok) return `Error: ${r.error || 'the tool failed.'}`
  const v = r.result
  const s = v === undefined || v === null ? 'Done.' : typeof v === 'string' ? v || 'Done.' : safeJson(v)
  return clip(s, MAX_RESULT_CHARS)
}

/** A tool call told as text, for requests where the model gets no tools. */
function callAsText(c: ToolCall): string {
  const outcome = c.result?.ok ? clip(resultText(c), 1500) : `failed: ${c.result?.error ?? 'did not run'}`
  return `[KherveOS tool ${c.name}(${clip(safeJson(c.args), 400)}) → ${outcome}]`
}

/** All of an assistant message as plain text (tool calls told in brackets). */
function assistantAsText(m: AssistantMessage): string {
  return m.turns
    .map((t) => [t.text.trim(), ...t.calls.map(callAsText)].filter(Boolean).join('\n\n'))
    .filter(Boolean)
    .join('\n\n')
}

/** Turns worth sending: some text or some calls. */
const liveTurns = (m: AssistantMessage): Turn[] => m.turns.filter((t) => t.text.trim() || t.calls.length)

// ----------------------------------------------------------------- Ollama

export function toOllama(system: string, history: Message[], withTools: boolean): unknown[] {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }]
  for (const m of history) {
    if (m.role === 'user') {
      const pictures = userPictures(m)
      out.push({ role: 'user', content: userContent(m), ...(pictures.length && { images: pictures.map((p) => p.data) }) })
    } else if (!withTools) {
      const text = assistantAsText(m)
      if (text) out.push({ role: 'assistant', content: text })
    } else {
      for (const t of liveTurns(m)) {
        if (!t.calls.length) {
          out.push({ role: 'assistant', content: t.text })
          continue
        }
        out.push({
          role: 'assistant',
          content: t.text,
          tool_calls: t.calls.map((c) => ({ id: callId(c.id), function: { name: wireName(c.name), arguments: c.args } })),
        })
        for (const c of t.calls) out.push({ role: 'tool', tool_name: wireName(c.name), tool_call_id: callId(c.id), content: resultText(c) })
      }
    }
  }
  return out
}

// ----------------------------------------------------------------- OpenAI

export function toOpenAI(system: string, history: Message[], withTools: boolean): unknown[] {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }]
  for (const m of history) {
    if (m.role === 'user') {
      const pictures = userPictures(m)
      out.push({
        role: 'user',
        content: pictures.length
          ? [{ type: 'text', text: userContent(m) }, ...pictures.map((p) => ({ type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } }))]
          : userContent(m),
      })
    } else if (!withTools) {
      const text = assistantAsText(m)
      if (text) out.push({ role: 'assistant', content: text })
    } else {
      for (const t of liveTurns(m)) {
        if (!t.calls.length) {
          out.push({ role: 'assistant', content: t.text })
          continue
        }
        out.push({
          role: 'assistant',
          content: t.text.trim() ? t.text : null,
          tool_calls: t.calls.map((c) => ({ id: callId(c.id), type: 'function', function: { name: wireName(c.name), arguments: safeJson(c.args) } })),
        })
        for (const c of t.calls) out.push({ role: 'tool', tool_call_id: callId(c.id), content: resultText(c) })
      }
    }
  }
  return out
}

// -------------------------------------------------------------- Anthropic

type Block = Record<string, unknown>
interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: Block[]
}

/** Claude wants alternating roles: consecutive messages of one role are merged. */
export function toAnthropic(history: Message[], withTools: boolean): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  const push = (role: AnthropicMessage['role'], blocks: Block[]) => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }
  for (const m of history) {
    if (m.role === 'user') {
      // Pictures first, then the text that speaks about them (what Claude does best with).
      const pictures = userPictures(m).map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } }))
      push('user', [...pictures, { type: 'text', text: userContent(m) }])
    } else if (!withTools) {
      const text = assistantAsText(m)
      if (text) push('assistant', [{ type: 'text', text }])
    } else {
      for (const t of liveTurns(m)) {
        const blocks: Block[] = []
        if (t.text.trim()) blocks.push({ type: 'text', text: t.text.trimEnd() })
        for (const c of t.calls) blocks.push({ type: 'tool_use', id: callId(c.id), name: wireName(c.name), input: c.args })
        push('assistant', blocks)
        if (t.calls.length) {
          push(
            'user',
            t.calls.map((c) => ({ type: 'tool_result', tool_use_id: callId(c.id), content: resultText(c), ...(c.result?.ok ? {} : { is_error: true }) })),
          )
        }
      }
    }
  }
  // Tool results must open a user message: put any text that was merged in front of them after them.
  for (const msg of out) {
    if (msg.role !== 'user' || !msg.content.some((b) => b.type === 'tool_result')) continue
    msg.content = [...msg.content.filter((b) => b.type === 'tool_result'), ...msg.content.filter((b) => b.type !== 'tool_result')]
  }
  return out
}

// ----------------------------------------------------------------- export

/** The whole chat as a Markdown document. */
export function chatToMarkdown(title: string, messages: Message[]): string {
  const out: string[] = [`# ${title}`, '', `*Exported from KherveAI on ${new Date().toLocaleString()}*`, '']
  for (const m of messages) {
    if (m.role === 'user') {
      out.push('## You', '')
      for (const a of m.attachments ?? []) {
        out.push(`> ${a.image ? 'Picture' : 'Attached'}: \`${vpath.pretty(a.path)}\`${a.truncated ? ' (shortened)' : ''}`)
      }
      if (m.attachments?.length) out.push('')
      out.push(m.text.trim(), '')
    } else {
      out.push(`## KherveAI (${m.model})`, '')
      for (const t of m.turns) {
        if (t.text.trim()) out.push(t.text.trim(), '')
        for (const c of t.calls) {
          const outcome = c.status === 'done' ? 'done' : c.status === 'skipped' ? 'not run' : c.result?.error ? `failed: ${c.result.error}` : c.status
          out.push(`> Tool \`${c.name}\` ${clip(safeJson(c.args), 300)} — ${outcome}`, '')
        }
      }
      if (m.error) out.push(`> Error: ${m.error}`, '')
      if (m.stopped) out.push('> (stopped)', '')
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
