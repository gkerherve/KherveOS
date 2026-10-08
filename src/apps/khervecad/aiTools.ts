// KherveCAD's AI tools (khervecad_list_tree, _apply_code, _insert_part,
// _tool…): the desktop's own MCP tools (mcp_tools.McpToolExecutor), run by
// the desktop code in this window's Python. Names and arguments are in
// src/os/ai/manifests/khervecad.ts; KherveCAD.tsx registers these.

import type { AppTools } from '@/os/ai/appTools'

/** Run a desktop MCP tool; resolves with its JSON result. */
export type McpCall = (name: string, args: Record<string, unknown>) => Promise<unknown>
export type McpList = (search: string) => Promise<unknown>

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Drop undefined fields (the desktop tools validate their arguments). */
export function clean(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined))
}

async function run(call: McpCall, name: string, args: Record<string, unknown>) {
  const r = (await call(name, clean(args))) as Record<string, unknown> | null
  if (r && typeof r === 'object' && typeof r.error === 'string') throw new Error(r.error)
  return r
}

export function cadTools(call: McpCall, list: McpList): AppTools {
  return {
    list_tree: (a) => run(call, 'list_tree', { node_id: num(a.node_id), depth: num(a.depth) }),
    get_code: (a) => run(call, 'get_code', { node_id: num(a.node_id) }),
    apply_code: (a) => {
      const code = text(a.code)
      if (!code) throw new Error('Pass the OpenSCAD program as "code".')
      return run(call, 'apply_code', { code, mode: text(a.mode), into_id: num(a.into_id) })
    },
    insert_part: (a) => {
      const part = text(a.part_id)
      if (!part) throw new Error('Pass a part id from khervecad_list_parts as "part_id".')
      return run(call, 'insert_part', { part_id: part, x: num(a.x), y: num(a.y), z: num(a.z), color: text(a.color), name: text(a.name) })
    },
    list_parts: (a) => run(call, 'list_parts', { search: text(a.search), category: text(a.category) }),
    tool: (a) => {
      const name = text(a.name)
      if (!name) throw new Error('Pass the desktop tool name as "name" (see khervecad_list_tools).')
      const args = a.args && typeof a.args === 'object' && !Array.isArray(a.args) ? (a.args as Record<string, unknown>) : {}
      return run(call, name, args)
    },
    list_tools: (a) => list(text(a.search) ?? ''),
  }
}
