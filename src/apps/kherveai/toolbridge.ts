// The bridge between the models and the shared KherveOS tool registry
// (src/os/ai/tools.ts): tool definitions in the shape the APIs want, API-safe
// names, running a call, and rescuing tool calls that small local models
// write out as text instead of using the tool-calling format.

import { KTOOLS, runTool } from '@/os/ai/tools'
import { offeredAppKTools } from '@/os/ai/appTools'
import type { ToolOutcome } from './types'
import { errorText } from './util'

export interface WireTool {
  /** The KherveOS tool's name. */
  name: string
  /** The name the API sees (letters, digits, _ and -; at most 64). */
  wire: string
  description: string
  schema: Record<string, unknown>
  destructive: boolean
}

export function wireName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'tool'
}

function normalizeSchema(s: unknown): Record<string, unknown> {
  const schema: Record<string, unknown> = s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as Record<string, unknown>) } : {}
  schema.type = 'object'
  if (!schema.properties || typeof schema.properties !== 'object') schema.properties = {}
  return schema
}

/**
 * The KherveOS tools to offer a model, ready for the APIs: the core tools,
 * plus the tools of the apps that have a window open or that `request` (the
 * person's message) names. Fewer tools keep small local models on track;
 * any app tool still works when called (it opens its app).
 */
export function availableTools(request = ''): WireTool[] {
  let list: readonly { name: string; description: string; inputSchema: Record<string, unknown>; destructive?: boolean }[] = []
  try {
    const apps = offeredAppKTools(request)
    list = [...(Array.isArray(KTOOLS) ? KTOOLS : []).filter((t) => !apps.hide.has(t.name)), ...apps.tools]
  } catch {
    list = []
  }
  return list
    .filter((t) => t && typeof t.name === 'string' && t.name)
    .map((t) => ({
      name: t.name,
      wire: wireName(t.name),
      description: String(t.description ?? '').trim() || t.name,
      schema: normalizeSchema(t.inputSchema),
      destructive: !!t.destructive,
    }))
}

/** The KherveOS tool behind a name the model used (wire or original, any case). */
export function toolFromWire(name: string, tools: WireTool[]): string {
  const exact = tools.find((t) => t.wire === name || t.name === name)
  if (exact) return exact.name
  const lower = name.toLowerCase()
  return tools.find((t) => t.wire.toLowerCase() === lower || t.name.toLowerCase() === lower)?.name ?? name
}

/** Run one call through the registry (which asks the person before destructive actions). */
export async function execTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutcome> {
  try {
    const r = await runTool(name, args, { caller: 'kAI', signal })
    if (!r || typeof r !== 'object') return { ok: false, error: 'The tool gave no answer.' }
    return r.ok ? { ok: true, result: r.result } : { ok: false, error: r.error || 'The tool failed.' }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

// ------------------------------------------------- tool calls written as text

export interface RecoveredCall {
  name: string
  args: Record<string, unknown>
}

const ARG_KEYS = ['arguments', 'parameters', 'args', 'input']

/** A JSON Schema (the tool's definition echoed back), not argument values. */
const isSchema = (o: Record<string, unknown>) => o.type === 'object' && !!o.properties && typeof o.properties === 'object'

function findArgs(o: Record<string, unknown>, depth = 0): Record<string, unknown> | null {
  for (const k of ARG_KEYS) {
    let v = o[k]
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v) as unknown
      } catch {
        continue
      }
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && !isSchema(v as Record<string, unknown>)) return v as Record<string, unknown>
  }
  if (depth < 2) {
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !isSchema(v as Record<string, unknown>)) {
        const r = findArgs(v as Record<string, unknown>, depth + 1)
        if (r) return r
      }
    }
  }
  return null
}

function collect(v: unknown, known: (n: string) => string | null, out: RecoveredCall[], depth = 0) {
  if (depth > 6 || !v || typeof v !== 'object') return
  if (Array.isArray(v)) {
    for (const x of v) collect(x, known, out, depth + 1)
    return
  }
  const o = v as Record<string, unknown>
  const fn = o.function && typeof o.function === 'object' && !Array.isArray(o.function) ? (o.function as Record<string, unknown>) : null
  const raw =
    typeof o.name === 'string' ? o.name : typeof fn?.name === 'string' ? fn.name : typeof o.tool === 'string' ? o.tool : typeof o.tool_name === 'string' ? o.tool_name : null
  const name = raw ? known(raw) : null
  if (name) {
    out.push({ name, args: (fn && findArgs(fn)) ?? findArgs(o) ?? {} })
    return
  }
  for (const x of Object.values(o)) collect(x, known, out, depth + 1)
}

/** Where a JSON value that starts at `start` ends (exclusive), or -1. */
function jsonEnd(s: string, start: number): number {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * Some local models (phi4-mini…) answer with the tool call as JSON text instead
 * of a real tool call. If the text holds JSON naming one of our tools, return
 * those calls and the text without the JSON.
 */
export function recoverToolCalls(text: string, tools: WireTool[]): { text: string; calls: RecoveredCall[] } | null {
  if (!text || !tools.length) return null
  const known = (n: string): string | null => {
    const lower = n.toLowerCase()
    return tools.find((t) => t.wire === n || t.name === n || t.wire.toLowerCase() === lower || t.name.toLowerCase() === lower)?.name ?? null
  }
  const spans: { from: number; to: number; json: string }[] = []
  // <tool_call>{…}</tool_call> (Hermes/Qwen style)
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    spans.push({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, json: m[1] })
  }
  // ```json … ``` fences
  if (!spans.length) {
    for (const m of text.matchAll(/```(?:json|tool_call|tool)?[ \t]*\r?\n([\s\S]*?)```/g)) {
      spans.push({ from: m.index ?? 0, to: (m.index ?? 0) + m[0].length, json: m[1] })
    }
  }
  // bare JSON at the start of a line
  if (!spans.length) {
    const re = /(^|\n)[ \t]*([[{])/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const start = m.index + m[0].length - 1 // the bracket
      const end = jsonEnd(text, start)
      if (end < 0) break
      spans.push({ from: start, to: end, json: text.slice(start, end) })
      re.lastIndex = end
    }
  }
  const calls: RecoveredCall[] = []
  const used: { from: number; to: number }[] = []
  for (const s of spans) {
    let parsed: unknown
    try {
      parsed = JSON.parse(s.json)
    } catch {
      continue
    }
    const found: RecoveredCall[] = []
    collect(parsed, known, found)
    if (found.length) {
      calls.push(...found)
      used.push(s)
    }
  }
  if (!calls.length) return null
  let rest = text
  for (const u of [...used].sort((a, b) => b.from - a.from)) rest = rest.slice(0, u.from) + rest.slice(u.to)
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), calls }
}
