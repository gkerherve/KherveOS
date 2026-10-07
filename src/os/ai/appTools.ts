// App tools, the OS side: apps register code for their AI tools while a
// window is open, and every AI in KherveOS (KherveAI, MCP clients) gets them
// as ordinary KherveOS tools named "<app>_<action>" (khervesheet_set_cells…).
//
//   // in an app component (specs in appManifest.ts):
//   useAppTools(win, {
//     read: async () => ({ text }),
//     save: async (args, ctx) => { … },
//   })
//
//   // or by hand, e.g. from a class that owns the window's document:
//   const off = registerAppTools('khervesheet', win.id, { … })
//
// A call runs in the app's front window offering the tool (or the one named
// by its "window" argument). When the app has no window, it is opened with
// the manifest's openArgs first, and the call waits for it to register.
// runTool (tools.ts) checks the arguments and passes a context whose
// confirm() / allowPython() ask the user, as for the core tools.

import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { os } from '@/os'
import { useWindows } from '@/os/windows'
import type { WindowApi } from '@/os/types'
import type { KTool, ToolContext } from './tools'
import { APP_TOOL_SETS } from './appManifest'
import { appToolDef } from './mcpCore'
import {
  AppToolRegistry, appsToOffer, hiddenCoreTools, pickWindow, runOf, toolName, type AppToolContext, type AppToolImpl, type AppTools, type AppToolSet,
  type AppToolSpec,
} from './appToolsCore'

export type { AppToolContext, AppTools, AppToolImpl } from './appToolsCore'
export { clipText, waitUntil } from './appToolsCore'

/** The tools of the open app windows. */
export const appToolRegistry = new AppToolRegistry()

/** How long a call waits for an app window (just opened, or still loading) to offer its tools. */
const WAIT_MS = 30_000

/** A window offers tools (action → code); call the returned function when it closes. */
export function registerAppTools(appId: string, windowId: string, tools: AppTools): () => void {
  return appToolRegistry.register(appId, windowId, tools)
}

/**
 * Offer AI tools while this window is open. `tools` may be a new object on
 * every render: calls always reach the latest functions (and so the latest
 * state); the set is registered again only when its actions change.
 */
export function useAppTools(win: WindowApi, tools: AppTools) {
  const latest = useRef(tools)
  latest.current = tools
  const actions = Object.keys(tools).sort().join(',')
  useEffect(() => {
    const appId = useWindows.getState().windows.find((w) => w.id === win.id)?.appId
    if (!appId || !actions) return
    const stable: AppTools = {}
    for (const action of actions.split(',')) {
      const first = latest.current[action]
      const run = (args: Record<string, unknown>, ctx: AppToolContext) => {
        const impl = latest.current[action] ?? first
        return runOf(impl)(args, ctx)
      }
      stable[action] = typeof first === 'function' ? run : ({ ...first, run } satisfies AppToolImpl)
    }
    return registerAppTools(appId, win.id, stable)
  }, [win.id, actions])
}

// ------------------------------------------------------- as KherveOS tools

interface Entry {
  set: Pick<AppToolSet, 'app' | 'name' | 'openArgs'>
  spec: AppToolSpec
}

function entries(): Entry[] {
  const out: Entry[] = []
  for (const set of APP_TOOL_SETS) for (const spec of set.tools) out.push({ set, spec })
  for (const { app, spec } of appToolRegistry.extraSpecs(APP_TOOL_SETS)) {
    const set = APP_TOOL_SETS.find((s) => s.app === app) ?? { app, name: app }
    out.push({ set, spec })
  }
  return out
}

/** The tool names of an app ("khervesheet_read_range"…), for list_apps / open_app. */
export function appToolNames(app: string): string[] {
  return entries()
    .filter((e) => e.set.app === app)
    .map((e) => toolName(app, e.spec.action))
}

let lastToast = { key: '', at: 0 }

/** One notification per run of changes (not one per call). */
function notice(caller: string, appName: string, action: string, windowId: string) {
  const key = `${caller}|${windowId}`
  const now = Date.now()
  const quiet = lastToast.key === key && now - lastToast.at < 6000
  lastToast = { key, at: now }
  if (quiet) return
  os.notify({
    title: `${caller} is working in ${appName}`,
    body: action.replace(/_/g, ' '),
    icon: Sparkles,
    timeout: 5000,
    onClick: () => useWindows.getState().focus(windowId),
  })
}

function withNote(result: unknown, note: string): unknown {
  return result && typeof result === 'object' && !Array.isArray(result) ? { ...(result as Record<string, unknown>), note } : { result, note }
}

function asKTool({ set, spec }: Entry): KTool {
  return {
    ...appToolDef(set, spec),
    async run(args: Record<string, unknown>, ctx: ToolContext) {
      const { window: wanted, ...rest } = args
      const wm = useWindows.getState()
      const pick = pickWindow(set.app, typeof wanted === 'string' && wanted.trim() ? wanted.trim() : undefined, wm.windows, appToolRegistry.windows(set.app))
      if (pick.error) throw new Error(`${pick.error} list_windows shows the open windows.`)
      let target = pick.id
      let opened = false
      if (!pick.open) {
        target = os.open(set.app, { ...(set.openArgs ?? {}) })
        if (!target) throw new Error(`${set.name} could not be opened.`)
        opened = true
      }
      const winId = await appToolRegistry.waitFor(set.app, target, WAIT_MS, ctx.signal)
      if (ctx.signal?.aborted) throw new Error('Cancelled: the AI app stopped waiting for an answer.')
      if (!winId) throw new Error(`${set.name} did not get ready in time (window ${target}). Try again in a moment.`)
      const impl = appToolRegistry.impl(set.app, spec.action, winId)
      if (!impl) throw new Error(`This ${set.name} window cannot do "${spec.action}".`)
      const win = useWindows.getState().windows.find((w) => w.id === winId)
      if (win?.minimized && !spec.readOnly) useWindows.getState().focus(winId)
      const result = await runOf(impl)(rest, { ...ctx, windowId: winId })
      if (!spec.readOnly) notice(ctx.caller, set.name, spec.action, winId)
      return opened ? withNote(result, `Opened ${set.name} in window ${winId}.`) : result
    },
  }
}

/** Every app tool (MCP lists them all; calls open the app when needed). */
export function appKTools(): KTool[] {
  return entries().map(asKTool)
}

/** The apps with a window open. */
export function openApps(): string[] {
  return [...new Set([...useWindows.getState().windows.map((w) => w.appId), ...appToolRegistry.apps()])]
}

/**
 * The app tools to offer a model for this request: the apps with a window
 * open and the apps the request names (fewer tools help small models), and
 * the core tools those apps' tools make confusing (create_notebook while the
 * khervebook_ tools are there).
 */
export function offeredAppKTools(request: string): { tools: KTool[]; hide: Set<string> } {
  const apps = appsToOffer(APP_TOOL_SETS, openApps(), request)
  const tools = entries()
    .filter((e) => apps.includes(e.set.app) || !APP_TOOL_SETS.some((s) => s.app === e.set.app))
    .map(asKTool)
  return { tools, hide: hiddenCoreTools(APP_TOOL_SETS, apps) }
}
