// The tool list MCP clients (Claude Code, Claude Desktop…) get from KherveOS:
// every app of the registry has tools, they are all in the list the bridge
// builds (mcpCore.ts, the same code as mcpBridge.ts), and the list fits the
// server's limits (server/kherveos_server/mcp_server.py). Starts nothing.
//
//   node --test tools/tests/mcp-tools.test.ts

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { APP_TOOL_SETS } from '../../src/os/ai/appManifest.ts'
import { appToolDefs, toMcpTools, type ToolDef } from '../../src/os/ai/mcpCore.ts'
import { toolName } from '../../src/os/ai/appToolsCore.ts'

const root = new URL('../../', import.meta.url)
const source = (path: string) => readFileSync(new URL(path, root), 'utf8')

/** The app ids of src/os/registry.ts. */
function registryApps(): string[] {
  const text = source('src/os/registry.ts')
  const body = text.slice(text.indexOf('export const APPS'), text.indexOf('\n]\n', text.indexOf('export const APPS')))
  return [...body.matchAll(/^ {4}id: '([^']+)'/gm)].map((m) => m[1])
}

/** The core tools of src/os/ai/tools.ts (names, and the source text as an upper bound of their size). */
function coreTools(): { names: string[]; size: number } {
  const text = source('src/os/ai/tools.ts')
  const start = text.indexOf('export const KTOOLS')
  const end = text.indexOf('\n]\n', start)
  const body = text.slice(start, end)
  return { names: [...body.matchAll(/^ {4}name: '([a-z_]+)'/gm)].map((m) => m[1]), size: body.length }
}

/** A number constant of the MCP server. */
function serverLimit(name: string): number {
  const m = source('server/kherveos_server/mcp_server.py').match(new RegExp(`^${name} = (.+)$`, 'm'))
  assert.ok(m, `${name} is in mcp_server.py`)
  const value = m[1].split('#')[0].trim()
  assert.match(value, /^[\d\s*_]+$/, `${name} is a plain number`)
  return value.split('*').reduce((n, part) => n * Number(part.trim().replace(/_/g, '')), 1)
}

const apps = registryApps()
const core = coreTools()
const appDefs = appToolDefs(APP_TOOL_SETS)
const coreDefs: ToolDef[] = core.names.map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } }))
const listed = toMcpTools([...coreDefs, ...appDefs])

test('the registry and the tool manifest agree', () => {
  assert.ok(apps.length > 25, `found the apps of registry.ts (${apps.length})`)
  const withTools = new Set(APP_TOOL_SETS.map((s) => s.app))
  const missing = apps.filter((a) => !withTools.has(a))
  assert.deepEqual(missing, [], 'every app has AI tools')
  const unknown = [...withTools].filter((a) => !apps.includes(a))
  assert.deepEqual(unknown, [], 'every tool set is for an app of the registry')
  for (const set of APP_TOOL_SETS) assert.ok(set.tools.length > 0, `${set.app} has tools`)
})

test('the OS tools open, list, arrange and close any app\'s windows', () => {
  for (const name of ['list_apps', 'open_app', 'open_file', 'list_windows', 'arrange_window', 'close_window', 'take_screenshot']) {
    assert.ok(core.names.includes(name), `${name} is a core tool`)
  }
})

test('the MCP list holds every app\'s tools', () => {
  const names = new Set(listed.map((t) => t.name))
  assert.equal(names.size, listed.length, 'names are unique (core and app tools too)')
  for (const set of APP_TOOL_SETS) {
    for (const spec of set.tools) assert.ok(names.has(toolName(set.app, spec.action)), `${toolName(set.app, spec.action)} is listed`)
  }
  for (const app of apps) assert.ok(listed.some((t) => t.name.startsWith(`${app}_`)), `${app} has tools in the list`)
})

test('each listed tool is one MCP clients accept', () => {
  for (const t of listed) {
    assert.match(t.name, /^[A-Za-z0-9_-]{1,64}$/, `${t.name}: a valid name`)
    assert.ok(t.description.length > 0 && t.description.length <= 4000, `${t.name}: description kept whole by the server`)
    assert.equal(t.inputSchema.type, 'object', `${t.name}: object schema`)
    assert.equal(typeof t.annotations.title, 'string')
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean')
  }
  for (const t of listed.filter((x) => !core.names.includes(x.name))) {
    const props = t.inputSchema.properties as Record<string, unknown>
    assert.ok(props.window, `${t.name}: takes a window id`)
    assert.match(t.description, /\(Opens the app if it is not open\.\)$/, `${t.name}: says it opens the app`)
  }
})

test('the list fits the server\'s limits', () => {
  const maxTools = serverLimit('MAX_TOOLS')
  const maxJson = serverLimit('MAX_TOOLS_JSON')
  assert.ok(listed.length <= maxTools, `${listed.length} tools, at most ${maxTools}`)
  const appJson = JSON.stringify(toMcpTools(appDefs)).length
  // The core tools' source text is bigger than their JSON: an upper bound.
  assert.ok(appJson + core.size <= maxJson, `about ${appJson + core.size} bytes, at most ${maxJson}`)
  // Leave room: windows can register tools the manifest does not list.
  assert.ok(listed.length <= maxTools * 0.8, `room left under MAX_TOOLS (${listed.length}/${maxTools})`)
})

test('what Claude sees', () => {
  const byApp = new Map<string, number>()
  for (const d of appDefs) byApp.set(d.app!, (byApp.get(d.app!) ?? 0) + 1)
  const line = [...byApp].map(([a, n]) => `${a} ${n}`).join(', ')
  console.log(`${listed.length} tools: ${core.names.length} OS tools + ${appDefs.length} app tools (${line})`)
})
