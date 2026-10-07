// Print the app tools as MCP clients get them (JSON, the same code as the
// browser's mcpBridge.ts), or a summary with --summary. The core tools
// (files, windows, Python…) need the browser and are not included.
//
//   node tools/mcp_tool_list.ts            → JSON list of the app tools
//   node tools/mcp_tool_list.ts --summary  → one line per app

import { APP_TOOL_SETS } from '../src/os/ai/appManifest.ts'
import { appToolDefs, toMcpTools } from '../src/os/ai/mcpCore.ts'

const tools = toMcpTools(appToolDefs(APP_TOOL_SETS))

if (process.argv.includes('--summary')) {
  for (const set of APP_TOOL_SETS) console.log(`${set.name.padEnd(14)} ${set.tools.map((t) => t.action).join(', ')}`)
  console.log(`\n${tools.length} app tools, ${JSON.stringify(tools).length} bytes of JSON`)
} else {
  process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`)
}
