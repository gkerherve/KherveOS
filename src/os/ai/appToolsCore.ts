// App tools, the part without the browser: the registry of the tools that
// open app windows offer, how a call finds its window, and which app tools
// are worth offering a model. Plain TypeScript (no React, no "@/" imports)
// so Node can test it:  node --test tools/tests/app-tools.test.ts
//
// The OS side (the shared registry, the useAppTools hook, turning app tools
// into KherveOS tools for KherveAI and MCP) is appTools.ts; what each app's
// tools are called, take and do is appManifest.ts.

/** A JSON Schema of the arguments (type: 'object'). */
export type Schema = Record<string, unknown>

/** One action of an app, as models see it: `<app>_<action>`. */
export interface AppToolSpec {
  /** snake_case, without the app prefix: "set_cells" → "khervesheet_set_cells". */
  action: string
  /** Written for an AI model: what it does, in a sentence or two. */
  description: string
  inputSchema: Schema
  /** Only reads: no notification, MCP clients may skip asking. */
  readOnly?: boolean
  /** Deletes or overwrites: KherveOS asks the user first. */
  destructive?: boolean
}

/** An app that has AI tools (see appManifest.ts). */
export interface AppToolSet {
  /** The app id (registry.ts), e.g. "khervesheet". */
  app: string
  /** As people say it: "KherveSheet". */
  name: string
  /** One short line for the system prompt. */
  summary: string
  /** Words in a request that mean this app ("sheet", "spreadsheet"…), lower case. */
  keywords: string[]
  /** What to open the app with when a tool is called and no window is open. */
  openArgs?: Record<string, unknown>
  /** Core tools not offered to KherveAI while this app's tools are (they would lead a small model astray). */
  hides?: string[]
  tools: AppToolSpec[]
}

/** What an app tool's code gets besides its arguments. */
export interface AppToolContext {
  /** Who is asking, as the user reads it: "KherveAI", "Claude Code via MCP"… */
  caller: string
  signal?: AbortSignal
  /** The window the call is for. */
  windowId: string
  /** Ask the user to allow something ("replace ~/a.txt"); false when they decline. */
  confirm(what: string, detail?: string): Promise<boolean>
  /** Ask the user before Python written by the AI runs (like run_python). */
  allowPython(code: string): Promise<boolean>
}

export type AppToolRun = (args: Record<string, unknown>, ctx: AppToolContext) => Promise<unknown>

/**
 * A tool's code. A plain function uses the spec of the same action in
 * appManifest.ts; an object can also carry the spec itself, for a tool that
 * is not in the manifest (it is then only offered while the window is open).
 */
export type AppToolImpl = AppToolRun | ({ run: AppToolRun } & Partial<Omit<AppToolSpec, 'action'>>)

/** What a window registers: action → code. */
export type AppTools = Record<string, AppToolImpl>

export const runOf = (impl: AppToolImpl): AppToolRun => (typeof impl === 'function' ? impl : impl.run)

/** "khervesheet" + "set_cells" → "khervesheet_set_cells". */
export const toolName = (app: string, action: string) => `${app}_${action}`

interface Registration {
  app: string
  windowId: string
  tools: AppTools
  seq: number
}

/** The tools of the open app windows. One instance lives in appTools.ts. */
export class AppToolRegistry {
  private regs: Registration[] = []
  private seq = 0
  private listeners = new Set<() => void>()

  /** A window offers tools; call the returned function when it closes. */
  register(app: string, windowId: string, tools: AppTools): () => void {
    const reg: Registration = { app, windowId, tools, seq: ++this.seq }
    this.regs.push(reg)
    this.changed()
    return () => {
      const before = this.regs.length
      this.regs = this.regs.filter((r) => r !== reg)
      if (this.regs.length !== before) this.changed()
    }
  }

  /** Called on every registration and unregistration. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private changed() {
    for (const fn of [...this.listeners]) {
      try {
        fn()
      } catch {
        // a listener's problem
      }
    }
  }

  /** The apps that have a window offering tools. */
  apps(): string[] {
    return [...new Set(this.regs.map((r) => r.app))]
  }

  /** The windows of `app` that offer tools, oldest registration first. */
  windows(app: string): string[] {
    return [...new Set(this.regs.filter((r) => r.app === app).map((r) => r.windowId))]
  }

  /** The code of `app`'s `action` in that window (the latest registration wins). */
  impl(app: string, action: string, windowId: string): AppToolImpl | null {
    for (let i = this.regs.length - 1; i >= 0; i--) {
      const r = this.regs[i]
      if (r.app === app && r.windowId === windowId && Object.hasOwn(r.tools, action)) return r.tools[action]
    }
    return null
  }

  /** Tools windows offer that the manifest does not describe (with their own spec). */
  extraSpecs(sets: readonly AppToolSet[]): { app: string; spec: AppToolSpec }[] {
    const out = new Map<string, { app: string; spec: AppToolSpec }>()
    for (const r of this.regs) {
      const known = sets.find((s) => s.app === r.app)
      for (const [action, impl] of Object.entries(r.tools)) {
        if (known?.tools.some((t) => t.action === action)) continue
        if (typeof impl === 'function' || typeof impl.description !== 'string') continue
        out.set(toolName(r.app, action), {
          app: r.app,
          spec: {
            action,
            description: impl.description,
            inputSchema: impl.inputSchema ?? { type: 'object', properties: {} },
            readOnly: impl.readOnly,
            destructive: impl.destructive,
          },
        })
      }
    }
    return [...out.values()]
  }

  /** Resolves with a window of `app` offering tools (or that one window), or null after `ms`. */
  waitFor(app: string, windowId: string | null, ms: number, signal?: AbortSignal): Promise<string | null> {
    const find = () => {
      const ws = this.windows(app)
      return windowId ? (ws.includes(windowId) ? windowId : null) : (ws[ws.length - 1] ?? null)
    }
    const now = find()
    if (now) return Promise.resolve(now)
    return new Promise((resolve) => {
      const done = (v: string | null) => {
        clearTimeout(timer)
        off()
        signal?.removeEventListener('abort', abort)
        resolve(v)
      }
      const abort = () => done(null)
      const off = this.subscribe(() => {
        const w = find()
        if (w) done(w)
      })
      const timer = setTimeout(() => done(null), ms)
      signal?.addEventListener('abort', abort)
    })
  }
}

/** A window as the window manager has it (only what picking needs). */
export interface WinInfo {
  id: string
  appId: string
  z: number
  minimized?: boolean
}

/**
 * The window a call acts on: the given one (it must be the app's), else the
 * app's front window offering tools, else its front window still loading.
 * `open` is false when the app has no window at all (the caller opens one).
 */
export function pickWindow(
  app: string,
  wanted: string | undefined,
  windows: readonly WinInfo[],
  offering: readonly string[],
): { id: string | null; open: boolean; error?: string } {
  const mine = windows.filter((w) => w.appId === app)
  if (wanted) {
    const w = windows.find((x) => x.id === wanted)
    if (!w) return { id: null, open: mine.length > 0, error: `There is no window "${wanted}".` }
    if (w.appId !== app) return { id: null, open: mine.length > 0, error: `Window "${wanted}" is not a ${app} window (it is ${w.appId}).` }
    return { id: w.id, open: true }
  }
  if (!mine.length) return { id: null, open: false }
  const front = (list: WinInfo[]) => [...list].sort((a, b) => Number(!!a.minimized) - Number(!!b.minimized) || b.z - a.z)[0]
  const ready = mine.filter((w) => offering.includes(w.id))
  return { id: front(ready.length ? ready : mine).id, open: true }
}

/** Which app (and action) a tool name belongs to; app ids may not contain "_" but actions may. */
export function splitToolName(name: string, apps: readonly string[]): { app: string; action: string } | null {
  const n = name.trim().toLowerCase()
  for (const app of [...apps].sort((a, b) => b.length - a.length)) {
    if (n.startsWith(`${app}_`) && n.length > app.length + 1) return { app, action: n.slice(app.length + 1) }
  }
  return null
}

/** The apps a request talks about ("put 1..5 in the sheet" → khervesheet). */
export function mentionedApps(text: string, sets: readonly AppToolSet[]): string[] {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  return sets
    .filter((s) => [s.app, s.name.toLowerCase(), ...s.keywords].some((k) => t.includes(` ${k.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `)))
    .map((s) => s.app)
}

/**
 * The app tools worth offering a model now. Small models get confused by
 * many tools, so: the apps with a window open, and the apps the request
 * names. Every app tool still works when called (it opens the app).
 */
export function appsToOffer(sets: readonly AppToolSet[], openApps: readonly string[], request: string): string[] {
  const named = mentionedApps(request, sets)
  return sets.map((s) => s.app).filter((a) => openApps.includes(a) || named.includes(a))
}

/** The core tools to leave out while these apps' tools are offered. */
export function hiddenCoreTools(sets: readonly AppToolSet[], apps: readonly string[]): Set<string> {
  return new Set(sets.filter((s) => apps.includes(s.app)).flatMap((s) => s.hides ?? []))
}

/** The schema with an optional "window" argument added (every app tool takes one). */
export function withWindowArg(schema: Schema, appName: string): Schema {
  const props = (schema.properties && typeof schema.properties === 'object' ? schema.properties : {}) as Record<string, unknown>
  if (props.window) return schema
  return {
    ...schema,
    type: 'object',
    properties: { ...props, window: { type: 'string', description: `Window id, only if several ${appName} windows are open (default: the front one).` } },
  }
}

/** One line per app for a system prompt: "- KherveSheet (khervesheet_*): spreadsheets… Tools: read_range, set_cells…" */
export function describeApps(sets: readonly AppToolSet[]): string[] {
  return sets.map((s) => `- ${s.name}: ${s.summary} Tools: ${s.tools.map((t) => toolName(s.app, t.action)).join(', ')}.`)
}

/** Resolves true once `test()` holds (checked every `every` ms), false after `ms` or on abort. */
export function waitUntil(test: () => boolean, ms: number, signal?: AbortSignal, every = 100): Promise<boolean> {
  if (test()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const start = Date.now()
    const timer = setInterval(() => {
      let ok = false
      try {
        ok = test()
      } catch {
        ok = false
      }
      if (ok || signal?.aborted || Date.now() - start >= ms) {
        clearInterval(timer)
        resolve(ok)
      }
    }, every)
  })
}

/** Long text → its start and end, with a note of what was cut. */
export function clipText(s: string, max: number): string {
  if (s.length <= max) return s
  const head = Math.floor(max * 0.7)
  return `${s.slice(0, head)}\n… (${s.length - max} characters cut) …\n${s.slice(-(max - head))}`
}
