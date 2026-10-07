// The MCP tool list, the part without the browser: how a KherveOS tool looks to
// MCP clients (Claude Code, Claude Desktop, ChatGPT…). Plain TypeScript (no
// React, no "@/" imports) so Node can test it:  node --test tools/tests/mcp-tools.test.ts
//
// mcpBridge.ts sends toMcpTools(allTools()) to the server; the server
// (server/kherveos_server/mcp_server.py) checks it against its limits
// (MAX_TOOLS, MAX_TOOLS_JSON) and answers tools/list with it.

import { toolName, withWindowArg, type AppToolSet, type AppToolSpec, type Schema } from './appToolsCore.ts'

/** What the bridge needs of a tool (a KTool has more). */
export interface ToolDef {
  name: string
  description: string
  inputSchema: Schema
  readOnly?: boolean
  destructive?: boolean
  /** For an app's tool: the app id. */
  app?: string
}

export interface McpTool {
  name: string
  description: string
  inputSchema: Schema
  annotations: { title: string; readOnlyHint: boolean; destructiveHint?: boolean }
}

/** Core tools that only read (ChatGPT, for one, asks less before them). */
export const READ_ONLY_CORE = new Set(['list_files', 'read_file', 'search_files', 'list_apps', 'list_windows'])
/** Core tools that may overwrite or run code. */
export const MAY_DESTROY_CORE = new Set(['write_file', 'create_notebook', 'run_python'])

export function titleOf(name: string): string {
  const words = name.replace(/_/g, ' ').replace(/\bpython\b/, 'Python')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** An app tool as a tool definition: "<app>_<action>", with the optional "window" argument. */
export function appToolDef(set: Pick<AppToolSet, 'app' | 'name'>, spec: AppToolSpec): ToolDef {
  return {
    name: toolName(set.app, spec.action),
    app: set.app,
    description: spec.description,
    inputSchema: withWindowArg(spec.inputSchema, set.name),
    readOnly: spec.readOnly,
    destructive: spec.destructive,
  }
}

/** Every app tool of the manifest. */
export function appToolDefs(sets: readonly AppToolSet[]): ToolDef[] {
  return sets.flatMap((set) => set.tools.map((spec) => appToolDef(set, spec)))
}

/** One tool as MCP clients see it. */
export function toMcpTool(t: ToolDef): McpTool {
  const readOnly = READ_ONLY_CORE.has(t.name) || !!t.readOnly
  return {
    name: t.name,
    description: t.app ? `${t.description} (Opens the app if it is not open.)` : t.description,
    inputSchema: t.inputSchema,
    annotations: readOnly
      ? { title: titleOf(t.name), readOnlyHint: true }
      : { title: titleOf(t.name), readOnlyHint: false, destructiveHint: !!t.destructive || MAY_DESTROY_CORE.has(t.name) },
  }
}

export const toMcpTools = (tools: readonly ToolDef[]): McpTool[] => tools.map(toMcpTool)
