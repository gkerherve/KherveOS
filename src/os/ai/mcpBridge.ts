// Lets AI apps that speak MCP (Claude Code, Claude Desktop, ChatGPT, Open WebUI…)
// use the KherveOS tools of this tab (tools.ts).
//
// The KherveOS server is the MCP server (server/kherveos_server/mcp_server.py),
// but the tools run here, in the browser, where the drive, the windows and
// Python are. Over the realtime websocket (/api/ws):
//
//   tab → server   mcp.tools  {tab, tools}           on connect: the tools this tab offers
//                  mcp.active {tab}                  the user came back to this tab
//                  mcp.result {id, ok, result|error}
//                  mcp.bye    {tab}                  the page is closing
//   server → tab   mcp.ready  {tab, tools}           the server has this tab's tools
//                  mcp.call   {id, tab, tool, args, client?}
//                  mcp.cancel {id, tab}              the AI app stopped waiting
//
// A call is meant for one tab (the one used last); the others ignore it.
// The shell starts the bridge once with startMcpBridge().

import { create } from 'zustand'
import { realtime, useRealtime, type ServerEvent } from '@/os/server'
import { KTOOLS, runTool, type ToolResult } from './tools'

export interface McpActivity {
  id: string
  tool: string
  /** Who asked, e.g. "Claude Code via MCP". */
  caller: string
  /** The main argument, for display (a path, an app…). */
  detail: string
  at: number
  state: 'running' | 'done' | 'failed'
  error?: string
}

interface BridgeState {
  /** How many tools the server has from this tab; null until it confirms (and while disconnected). */
  registered: number | null
  /** Recent calls from AI apps, newest first. */
  activity: McpActivity[]
}

export const useMcpBridge = create<BridgeState>(() => ({ registered: null, activity: [] }))

/** This page's id, so the server can send a call to one tab only. */
const TAB = `tab-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`

/** Hints for MCP clients (ChatGPT, for one, asks less before read-only tools). */
const READ_ONLY = new Set(['list_files', 'read_file', 'search_files', 'list_apps', 'list_windows'])
const MAY_DESTROY = new Set(['write_file', 'create_notebook', 'run_python'])

const titleOf = (name: string) => {
  const words = name.replace(/_/g, ' ').replace(/\bpython\b/, 'Python')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The tools as MCP clients see them. */
export function mcpToolList() {
  return KTOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: READ_ONLY.has(t.name)
      ? { title: titleOf(t.name), readOnlyHint: true }
      : { title: titleOf(t.name), readOnlyHint: false, destructiveHint: !!t.destructive || MAY_DESTROY.has(t.name) },
  }))
}

const running = new Map<string, AbortController>()

function note(entry: McpActivity) {
  useMcpBridge.setState((s) => ({ activity: [entry, ...s.activity].slice(0, 20) }))
}

function update(id: string, patch: Partial<McpActivity>) {
  useMcpBridge.setState((s) => ({ activity: s.activity.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
}

function detailOf(args: Record<string, unknown>): string {
  for (const key of ['path', 'from', 'app', 'query', 'id', 'title']) {
    if (typeof args[key] === 'string') return args[key] as string
  }
  return typeof args.code === 'string' ? args.code.trim().split('\n')[0].slice(0, 60) : ''
}

async function answer(ev: ServerEvent) {
  if (ev.tab !== undefined && ev.tab !== TAB) return // meant for another tab
  const id = typeof ev.id === 'string' ? ev.id : ''
  if (!id || running.has(id)) return
  const tool = typeof ev.tool === 'string' ? ev.tool : ''
  const args = ev.args && typeof ev.args === 'object' && !Array.isArray(ev.args) ? (ev.args as Record<string, unknown>) : {}
  const caller = `${typeof ev.client === 'string' && ev.client.trim() ? ev.client.trim() : 'Claude'} via MCP`
  const control = new AbortController()
  running.set(id, control)
  note({ id, tool, caller, detail: detailOf(args), at: Date.now(), state: 'running' })
  let outcome: ToolResult
  try {
    outcome = await runTool(tool, args, { caller, signal: control.signal })
  } finally {
    running.delete(id)
  }
  update(id, outcome.ok ? { state: 'done' } : { state: 'failed', error: outcome.error })
  let reply: ServerEvent
  try {
    JSON.stringify(outcome.result) // can it travel?
    reply = outcome.ok
      ? { type: 'mcp.result', id, ok: true, result: outcome.result ?? null }
      : { type: 'mcp.result', id, ok: false, error: outcome.error ?? 'The tool failed.' }
  } catch {
    reply = { type: 'mcp.result', id, ok: false, error: 'The tool gave a result that cannot be sent.' }
  }
  realtime.send(reply)
}

let stopBridge: (() => void) | null = null

/**
 * Offer this tab's tools to MCP clients through the KherveOS server, whenever
 * the user is signed in and connected. Call once (more calls do nothing);
 * returns a function that stops it.
 */
export function startMcpBridge(): () => void {
  if (stopBridge) return stopBridge
  const register = () => {
    useMcpBridge.setState({ registered: null })
    realtime.send({ type: 'mcp.tools', tab: TAB, tools: mcpToolList() })
  }
  const active = () => {
    if (document.visibilityState === 'visible') realtime.send({ type: 'mcp.active', tab: TAB })
  }
  const bye = () => realtime.send({ type: 'mcp.bye', tab: TAB })
  const offs: (() => unknown)[] = [
    useRealtime.subscribe((s, prev) => {
      if (s.connected && !prev.connected) register()
      else if (!s.connected && prev.connected) useMcpBridge.setState({ registered: null })
    }),
    realtime.on('mcp.ready', (ev) => {
      if (ev.tab === TAB) useMcpBridge.setState({ registered: typeof ev.tools === 'number' ? ev.tools : 0 })
    }),
    realtime.on('mcp.call', (ev) => void answer(ev)),
    realtime.on('mcp.cancel', (ev) => {
      if (ev.tab === TAB && typeof ev.id === 'string') running.get(ev.id)?.abort()
    }),
  ]
  window.addEventListener('focus', active)
  document.addEventListener('visibilitychange', active)
  window.addEventListener('pagehide', bye)
  if (useRealtime.getState().connected) register()

  stopBridge = () => {
    offs.forEach((off) => off())
    window.removeEventListener('focus', active)
    document.removeEventListener('visibilitychange', active)
    window.removeEventListener('pagehide', bye)
    bye()
    for (const control of running.values()) control.abort()
    useMcpBridge.setState({ registered: null })
    stopBridge = null
  }
  return stopBridge
}
