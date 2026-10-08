// The KherveOS tool registry: what an AI may do in KherveOS. One list for every
// AI that works here: KherveAI (Ollama, Claude or ChatGPT tool calling) and the
// MCP bridge (mcpBridge.ts: Claude Code, Claude Desktop, ChatGPT connectors…).
//
//   import { KTOOLS, runTool } from '@/os/ai/tools'   (KTOOLS: the core tools; allTools() adds the apps')
//   const r = await runTool('list_files', { path: '~/Documents' }, { caller: 'KherveAI' })
//   r.ok ? r.result : r.error
//
// Paths are on the KherveOS drive: "~" is the home folder (/home/user) and a
// relative path is relative to it; results show paths as "~/…". Results are
// small JSON values (long files and outputs are cut, with "truncated": true).
// runTool checks the arguments, asks the user before anything is deleted or
// overwritten and before Python runs, and shows a small notification for every change.
//
// Apps add their own tools ("khervesheet_set_cells"…) while a window is open:
// see appTools.ts and appManifest.ts.

import { createElement } from 'react'
import { Sparkles } from 'lucide-react'
import { os, fs, FsError, HOME, type AppArgs } from '@/os'
import { basename, dirname, extname, isInside, join, pretty, resolve } from '@/os/path'
import { APPS, appForExtension, getApp } from '@/os/registry'
import { useWindows } from '@/os/windows'
import { mimeType } from '@/os/fileIcons'
import { PythonKernel } from '@/os/python/kernel'
import { captureCanvas, flash, saveScreenshot, targetName, type ShotTarget } from '@/os/screenshot'
import { appKTools, appToolNames } from './appTools'

export interface KTool {
  /** snake_case, unique. */
  name: string
  /** What the tool does, written for an AI model. */
  description: string
  /** JSON Schema of the arguments (type: 'object'). */
  inputSchema: Record<string, unknown>
  /** Deletes or overwrites: the user must confirm (runTool asks). */
  destructive?: boolean
  /** Only reads (MCP clients may skip asking). */
  readOnly?: boolean
  /** For an app's tool: the app id. */
  app?: string
  /** Do it. Returns a JSON-serialisable result; throws an Error with a helpful message. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>
}

/** What a tool's code can ask of the user while it runs (with runTool's dialogs). */
export interface ToolContext {
  caller: string
  signal?: AbortSignal
  /** "caller wants to <what>." Allow / Deny; false when denied or the caller stopped waiting. */
  confirm(what: string, detail?: string): Promise<boolean>
  /** Python written by an AI is shown to the user first (like run_python). */
  allowPython(code: string): Promise<boolean>
}

export interface ToolResult {
  ok: boolean
  result?: unknown
  error?: string
}

export interface RunToolOptions {
  /** Who is asking, as the user reads it: "Claude via MCP", "KherveAI (llama3.2)"… */
  caller?: string
  /** Gives up on a call that is still waiting for the user's permission. */
  signal?: AbortSignal
}

type Args = Record<string, unknown>
type Schema = Record<string, unknown>

// ------------------------------------------------------------------ helpers

const CANCELLED = 'Cancelled: the AI app stopped waiting for an answer.'

const str = (description: string): Schema => ({ type: 'string', description })
const bool = (description: string): Schema => ({ type: 'boolean', description })
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required })

function text(a: Args, key: string): string {
  const v = a[key]
  if (typeof v !== 'string') throw new Error(`"${key}" must be text.`)
  return v
}

const optText = (a: Args, key: string): string | undefined => (typeof a[key] === 'string' ? (a[key] as string) : undefined)

/** "~/x", "/home/user/x" or "x" (relative to ~) → the absolute path on the drive. */
export function drivePath(p: string): string {
  let s = p.trim().replace(/\\/g, '/')
  if (!s) throw new Error('The path is empty.')
  if (s.startsWith('home/')) s = '/' + s
  return resolve(HOME, s)
}

/** A path that must name a file (not "~/Documents/"). */
function filePath(p: string): string {
  if (/[\\/]\s*$/.test(p)) throw new Error(`"${p}" ends with "/": add the file name.`)
  return drivePath(p)
}

const notebookPath = (p: string) => {
  const abs = filePath(p)
  return extname(abs) === '.kbook' ? abs : abs + '.kbook'
}

/** Errors as an AI can act on them. */
function explain(e: unknown): string {
  if (e instanceof FsError) {
    const where = pretty(e.path)
    switch (e.code) {
      case 'ENOENT':
        return `${where} does not exist. Paths are on the KherveOS drive, where ~ is the home folder (/home/user); list_files and search_files help find things.`
      case 'EEXIST':
        return `${where} already exists.`
      case 'ENOTDIR':
        return `${where} is not a folder.`
      case 'EISDIR':
        return `${where} is a folder, not a file.`
      case 'ENOTEMPTY':
        return `${where} is a folder that is not empty.`
      case 'EPERM':
        return `${where} is a system folder and cannot be changed.`
      default:
        return e.message
    }
  }
  return e instanceof Error ? e.message : String(e)
}

/** Long text → its start and its end, with a note of what was cut. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s
  const head = Math.floor(max * 0.6)
  const tail = max - head
  return `${s.slice(0, head)}\n… (${s.length - max} characters cut) …\n${s.slice(-tail)}`
}

function when(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff', '.pdf', '.zip', '.gz', '.tgz', '.tar', '.7z',
  '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.webm', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.xlsx', '.docx',
  '.pptx', '.ktexz', '.kdocz', '.sqlite', '.db', '.whl', '.wasm', '.npy', '.npz', '.h5', '.hdf5', '.pkl', '.vms', '.spe',
])

function looksBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8000)
  if (head.includes(0)) return true
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true })
    return false
  } catch {
    return true
  }
}

/** Hidden files and folders (".git", ".config"…) below `root`. */
function hidden(path: string, root: string): boolean {
  const rel = root === '/' ? path.slice(1) : path.slice(root.length + 1)
  return rel.split('/').some((part) => part.startsWith('.'))
}

function findApp(key: string) {
  const k = key.trim().toLowerCase().replace(/\s+/g, '')
  return APPS.find((a) => a.id === k || a.name.toLowerCase().replace(/\s+/g, '') === k)
}

// The Python session kept for AI use (hidden: no window).
let kernel: PythonKernel | null = null

async function saveFigure(b64: string): Promise<string> {
  const dir = join(HOME, 'Pictures')
  await fs.mkdir(dir, { recursive: true })
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const target = join(dir, fs.uniqueName(dir, `figure-${stamp}.png`))
  await fs.writeBytes(target, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  return pretty(target)
}

// -------------------------------------------------------------------- tools

const PATH_HELP = 'On the KherveOS drive: "~" is the home folder, e.g. "~/Documents/notes.txt".'

export const KTOOLS: KTool[] = [
  {
    name: 'list_files',
    description:
      'List the files and folders in a folder on the KherveOS drive, folders first, with sizes (bytes) and modification times. ' +
      'The home folder "~" holds Documents, Pictures, Notebooks… Hidden items (names starting with ".") are included.',
    inputSchema: object({ path: str(`The folder to list (default "~"). ${PATH_HELP}`) }),
    async run(a) {
      const dir = drivePath(optText(a, 'path') || '~')
      const st = fs.stat(dir)
      if (!st) throw new FsError('ENOENT', dir)
      if (st.type !== 'dir') throw new Error(`${pretty(dir)} is a file, not a folder: read it with read_file.`)
      const all = fs.list(dir)
      const entries = all.slice(0, 300).map((s) =>
        s.type === 'dir'
          ? { name: s.name, type: 'folder', modified: when(s.mtime) }
          : { name: s.name, type: 'file', size: s.size, modified: when(s.mtime) },
      )
      return { path: pretty(dir), entries, ...(all.length > entries.length && { truncated: true, total: all.length }) }
    },
  },
  {
    name: 'read_file',
    description:
      'Read a text file from the KherveOS drive (UTF-8). Long files are cut to max_chars characters and marked "truncated". ' +
      'Pictures, PDFs and other binary files are not returned: open_file shows them to the user.',
    inputSchema: object(
      {
        path: str(`The file to read. ${PATH_HELP}`),
        max_chars: { type: 'integer', description: 'The most characters to return (default 20000, at most 200000).', minimum: 100, maximum: 200000 },
      },
      ['path'],
    ),
    async run(a) {
      const p = drivePath(text(a, 'path'))
      const st = fs.stat(p)
      if (!st) throw new FsError('ENOENT', p)
      if (st.type === 'dir') throw new Error(`${pretty(p)} is a folder: list_files shows what is in it.`)
      const max = Math.min(Math.max(typeof a.max_chars === 'number' ? a.max_chars : 20000, 100), 200000)
      const bytes = await fs.readBytes(p)
      if (BINARY_EXTS.has(extname(p)) || looksBinary(bytes)) {
        return { path: pretty(p), size: st.size, binary: true, note: `Not a text file (${mimeType(p)}). open_file shows it to the user.` }
      }
      const decoded = new TextDecoder().decode(bytes.length > max * 4 ? bytes.subarray(0, max * 4) : bytes)
      if (decoded.length > max || bytes.length > max * 4) {
        return { path: pretty(p), size: st.size, content: decoded.slice(0, max), truncated: true }
      }
      return { path: pretty(p), size: st.size, content: decoded }
    },
  },
  {
    name: 'write_file',
    description:
      'Create a text file on the KherveOS drive, or replace one (UTF-8). Missing parent folders are created. ' +
      'An existing file is only replaced when "overwrite" is true, and KherveOS then asks the user first.',
    inputSchema: object(
      {
        path: str(`Where to save the file. ${PATH_HELP}`),
        content: str('The whole text of the file.'),
        overwrite: bool('Replace the file if it already exists (the user is asked to allow it). Default false.'),
      },
      ['path', 'content'],
    ),
    async run(a) {
      const p = filePath(text(a, 'path'))
      const content = text(a, 'content')
      const st = fs.stat(p)
      if (st?.type === 'dir') throw new FsError('EISDIR', p)
      if (st && a.overwrite !== true) {
        throw new Error(`${pretty(p)} already exists. Pass "overwrite": true to replace it (the user is asked first), or choose another name.`)
      }
      await fs.writeText(p, content, { mkdirs: true })
      return { path: pretty(p), size: fs.stat(p)?.size ?? content.length, replaced: !!st }
    },
  },
  {
    name: 'create_folder',
    description: 'Create a folder (and any missing parent folders) on the KherveOS drive. Fine if it already exists.',
    inputSchema: object({ path: str(`The folder to create. ${PATH_HELP}`) }, ['path']),
    async run(a) {
      const p = drivePath(text(a, 'path'))
      const st = fs.stat(p)
      if (st?.type === 'file') throw new Error(`${pretty(p)} is a file.`)
      if (!st) await fs.mkdir(p, { recursive: true })
      return { path: pretty(p), created: !st }
    },
  },
  {
    name: 'move',
    description:
      'Move or rename a file or folder on the KherveOS drive. If "to" is an existing folder, the item goes inside it. ' +
      'Missing folders on the way are created. Never replaces an existing file.',
    inputSchema: object(
      {
        from: str(`The file or folder to move. ${PATH_HELP}`),
        to: str('Its new path, or the folder to put it in.'),
      },
      ['from', 'to'],
    ),
    async run(a) {
      const from = drivePath(text(a, 'from'))
      const target = text(a, 'to')
      let to = drivePath(target)
      if (!fs.exists(from)) throw new FsError('ENOENT', from)
      // "~/Archive/" means into that folder, even before it exists.
      if ((fs.isDir(to) || /[\\/]\s*$/.test(target)) && to !== from) to = join(to, basename(from))
      if (to === from) return { from: pretty(from), to: pretty(to) }
      if (isInside(to, from)) throw new Error(`A folder cannot be moved into itself (${pretty(to)}).`)
      if (fs.exists(to)) throw new Error(`${pretty(to)} already exists; move never replaces anything. Choose another name, or delete it first.`)
      await fs.mkdir(dirname(to), { recursive: true })
      await fs.rename(from, to)
      return { from: pretty(from), to: pretty(to) }
    },
  },
  {
    name: 'delete',
    description:
      'Delete a file, or a folder with everything in it, from the KherveOS drive. KherveOS asks the user first; ' +
      'deleting cannot be undone (there is no trash).',
    inputSchema: object({ path: str(`The file or folder to delete. ${PATH_HELP}`) }, ['path']),
    destructive: true,
    async run(a) {
      const p = drivePath(text(a, 'path'))
      const st = fs.stat(p)
      if (!st) throw new FsError('ENOENT', p)
      const inside = st.type === 'dir' ? fs.walk(p).length : 0
      await fs.remove(p, { recursive: true })
      return { deleted: pretty(p), type: st.type === 'dir' ? 'folder' : 'file', ...(inside && { items_inside: inside }) }
    },
  },
  {
    name: 'search_files',
    description:
      'Find files and folders on the KherveOS drive whose name, or text content, contains the query (not case-sensitive). ' +
      'Searches the home folder unless "path" is given; skips hidden folders. Up to 50 matches; content matches give the first matching line.',
    inputSchema: object(
      {
        query: str('The text to look for.'),
        path: str('The folder to search in (default "~").'),
      },
      ['query'],
    ),
    async run(a) {
      const query = text(a, 'query').trim()
      if (!query) throw new Error('The query is empty.')
      const q = query.toLowerCase()
      const root = drivePath(optText(a, 'path') || '~')
      if (!fs.isDir(root)) throw fs.exists(root) ? new FsError('ENOTDIR', root) : new FsError('ENOENT', root)
      const LIMIT = 50
      const items = fs.walk(root).filter((s) => !hidden(s.path, root) && !/\/(node_modules|__pycache__)(\/|$)/.test(s.path))
      const matches: Record<string, unknown>[] = []
      const named = new Set<string>()
      for (const s of items) {
        if (matches.length >= LIMIT) break
        if (s.name.toLowerCase().includes(q)) {
          matches.push({ path: pretty(s.path), type: s.type === 'dir' ? 'folder' : 'file', match: 'name' })
          named.add(s.path)
        }
      }
      // Reading every file of a big drive takes long: stop after a budget.
      const decoder = new TextDecoder()
      let files = 0
      let bytesRead = 0
      let partial = false
      for (const s of items) {
        if (matches.length >= LIMIT) break
        if (s.type !== 'file' || named.has(s.path) || s.size > 1_000_000 || BINARY_EXTS.has(extname(s.path))) continue
        if (++files > 3000 || (bytesRead += s.size) > 64_000_000) {
          partial = true
          break
        }
        const bytes = await fs.readBytes(s.path)
        if (looksBinary(bytes)) continue
        const content = decoder.decode(bytes)
        const at = content.toLowerCase().indexOf(q)
        if (at < 0) continue
        const start = content.lastIndexOf('\n', at) + 1
        const end = content.indexOf('\n', at)
        const line = content.slice(start, end < 0 ? undefined : end).trim()
        const lineNo = content.slice(0, at).split('\n').length
        matches.push({ path: pretty(s.path), match: 'content', line: lineNo, text: line.length > 200 ? line.slice(0, 200) + '…' : line })
      }
      return {
        query,
        folder: pretty(root),
        matches,
        ...(matches.length >= LIMIT && { truncated: true }),
        ...(partial && { note: 'Only part of the file contents was searched (too many files): search a smaller folder with "path".' }),
      }
    },
  },
  {
    name: 'list_apps',
    description: 'List the apps of KherveOS: their id (for open_app), name, what they do, the file types they open and their own tools.',
    inputSchema: object({}),
    async run() {
      return {
        apps: APPS.map((app) => {
          const opens = (app.fileTypes ?? []).filter(Boolean)
          const tools = appToolNames(app.id)
          return { id: app.id, name: app.name, description: app.description, ...(opens.length && { opens }), ...(tools.length && { tools }) }
        }),
      }
    },
  },
  {
    name: 'open_app',
    description:
      'Open a KherveOS app in a window on the user\'s screen, optionally with a file or folder ("path") or, for the Browser, ' +
      'a web address ("url"), or, for kDB (the XPS binding-energy database), the element to show ("element", e.g. "O" ' +
      'for oxygen). Apps: files, notepad, terminal, khervebook, khervedb, browser, viewer, settings… (list_apps has them all). ' +
      'Returns the window id.',
    inputSchema: object(
      {
        app: str('The app id or name, e.g. "notepad" or "kBook".'),
        path: str(`A file or folder for the app to open. ${PATH_HELP}`),
        url: str('For the Browser: the web address to open.'),
        element: str('For kDB: the chemical symbol of the element to show, e.g. "O", "Fe".'),
      },
      ['app'],
    ),
    async run(a) {
      const name = text(a, 'app')
      const app = findApp(name)
      if (!app) throw new Error(`There is no app "${name}". The apps are: ${APPS.map((x) => x.id).join(', ')}.`)
      const args: AppArgs = {}
      const path = optText(a, 'path')
      if (path) {
        const p = drivePath(path)
        if (!fs.exists(p)) throw new FsError('ENOENT', p)
        args.path = p
      }
      const url = optText(a, 'url')?.trim()
      if (url) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:\/\//i.test(url)) throw new Error('Only http:// and https:// addresses can be opened.')
        args.url = /^https?:\/\//i.test(url) ? url : `https://${url}`
      }
      const element = optText(a, 'element')?.trim()
      if (element) args.element = element
      const id = os.open(app.id, args)
      if (!id) throw new Error(`${app.name} could not be opened.`)
      const tools = appToolNames(app.id)
      return {
        window: id,
        app: app.id,
        ...(args.path && { path: pretty(args.path) }),
        ...(tools.length && { tools, note: `To act inside ${app.name}, use these tools.` }),
      }
    },
  },
  {
    name: 'open_file',
    description:
      'Open a file or folder of the KherveOS drive for the user, in the app that handles it: Notepad for text and code, ' +
      'kBook for .kbook notebooks, Viewer for pictures, kPDF for PDFs, Files for folders…',
    inputSchema: object({ path: str(`The file or folder to open. ${PATH_HELP}`) }, ['path']),
    async run(a) {
      const p = drivePath(text(a, 'path'))
      const st = fs.stat(p)
      if (!st) throw new FsError('ENOENT', p)
      const app = st.type === 'dir' ? getApp('files') : appForExtension(extname(p))
      if (!app) {
        throw new Error(`No KherveOS app opens "${extname(p)}" files. read_file reads text; open_app opens it in a chosen app.`)
      }
      const id = os.open(app.id, { path: p })
      if (!id) throw new Error(`${app.name} could not be opened.`)
      return { path: pretty(p), app: app.id, window: id }
    },
  },
  {
    name: 'list_windows',
    description:
      'List the windows open on the KherveOS screen, front first: id, app, title, the file shown, position and size, ' +
      'focused / minimised / maximised, and the app tools ("<app>_…") that act inside each window.',
    inputSchema: object({}),
    async run() {
      const { windows, focusedId } = useWindows.getState()
      return {
        windows: [...windows]
          .sort((x, y) => y.z - x.z)
          .map((w) => {
            const doc = w.docPath !== undefined ? w.docPath : w.args.path
            const tools = appToolNames(w.appId)
            return {
              id: w.id,
              app: w.appId,
              title: w.title,
              ...(typeof doc === 'string' && doc && { path: pretty(doc) }),
              bounds: { x: Math.round(w.x), y: Math.round(w.y), w: Math.round(w.w), h: Math.round(w.h) },
              ...(w.id === focusedId && { focused: true }),
              ...(w.minimized && { minimized: true }),
              ...(w.maximized && { maximized: true }),
              ...(w.snapped && { snapped: w.snapped }),
              ...(tools.length && { tools: tools.length > 8 ? [...tools.slice(0, 8), '…'] : tools }),
            }
          }),
      }
    },
  },
  {
    name: 'arrange_window',
    description:
      'Bring a window to the front ("focus"), minimise, maximise, restore it, snap it to the left or right half, or move / resize it ' +
      '(x, y, w, h in pixels). The window id comes from list_windows or open_app.',
    inputSchema: object(
      {
        id: str('The window id, e.g. "w3".'),
        action: { type: 'string', enum: ['focus', 'minimize', 'maximize', 'restore', 'snap_left', 'snap_right', 'move'], description: 'What to do (default "focus"; "move" uses x, y, w, h).' },
        x: { type: 'integer', description: 'For "move": left edge, pixels.' },
        y: { type: 'integer', description: 'For "move": top edge, pixels.' },
        w: { type: 'integer', description: 'For "move": width, pixels.' },
        h: { type: 'integer', description: 'For "move": height, pixels.' },
      },
      ['id'],
    ),
    async run(a) {
      const id = text(a, 'id').trim()
      const wm = useWindows.getState()
      const w = wm.windows.find((x) => x.id === id)
      if (!w) throw new Error(`There is no window "${id}". list_windows shows the open ones.`)
      const action = optText(a, 'action')?.trim().toLowerCase() || 'focus'
      switch (action) {
        case 'focus':
          wm.focus(id)
          break
        case 'minimize':
        case 'minimise':
          wm.minimize(id)
          break
        case 'maximize':
        case 'maximise':
          if (!w.maximized) wm.snap(id, 'max')
          else wm.focus(id)
          break
        case 'restore':
          if (w.maximized || w.snapped) wm.snap(id, null)
          else wm.focus(id)
          break
        case 'snap_left':
        case 'snap_right':
          wm.snap(id, action === 'snap_left' ? 'left' : 'right')
          break
        case 'move': {
          const b: Partial<{ x: number; y: number; w: number; h: number }> = {}
          for (const k of ['x', 'y', 'w', 'h'] as const) if (typeof a[k] === 'number') b[k] = a[k] as number
          if (!Object.keys(b).length) throw new Error('"move" needs x, y, w or h.')
          const app = getApp(w.appId)
          const min = app?.minSize ?? { w: 200, h: 120 }
          if (b.w !== undefined) b.w = Math.max(min.w, Math.min(b.w, window.innerWidth))
          if (b.h !== undefined) b.h = Math.max(min.h, Math.min(b.h, window.innerHeight))
          if (b.x !== undefined) b.x = Math.max(-((b.w ?? w.w) - 80), Math.min(b.x, window.innerWidth - 80))
          if (b.y !== undefined) b.y = Math.max(0, Math.min(b.y, window.innerHeight - 40))
          if (w.maximized || w.snapped) wm.snap(id, null)
          useWindows.getState().setBounds(id, b)
          useWindows.getState().focus(id)
          break
        }
        default:
          throw new Error(`Unknown action "${action}": use focus, minimize, maximize, restore, snap_left, snap_right or move.`)
      }
      const now = useWindows.getState().windows.find((x) => x.id === id)!
      return {
        id,
        app: now.appId,
        bounds: { x: Math.round(now.x), y: Math.round(now.y), w: Math.round(now.w), h: Math.round(now.h) },
        focused: useWindows.getState().focusedId === id,
        ...(now.minimized && { minimized: true }),
        ...(now.maximized && { maximized: true }),
        ...(now.snapped && { snapped: now.snapped }),
      }
    },
  },
  {
    name: 'close_window',
    description: 'Close a window by its id (from list_windows or open_app). An app with unsaved changes may ask the user first.',
    inputSchema: object({ id: str('The window id, e.g. "w3".') }, ['id']),
    async run(a) {
      const id = text(a, 'id').trim()
      const wm = useWindows.getState()
      const w = wm.windows.find((x) => x.id === id)
      if (!w) throw new Error(`There is no window "${id}". list_windows shows the open ones.`)
      await wm.close(id)
      if (useWindows.getState().windows.some((x) => x.id === id)) {
        return { closed: false, id, note: 'The app kept the window open: the user chose not to close it (unsaved changes?).' }
      }
      return { closed: true, id, title: w.title }
    },
  },
  {
    name: 'take_screenshot',
    description:
      'Take a screenshot of one KherveOS window (its id from list_windows) or, without a window, of the whole screen, ' +
      'and save it as a PNG in ~/Pictures/Screenshots ("Screenshot YYYY-MM-DD at HH.MM.SS.png"), like the camera button in each title bar. ' +
      'Returns the file\'s path; the picture itself is not returned (open_file shows it to the user).',
    inputSchema: object({ window: str('The window id, e.g. "w3". Leave out for the whole screen.') }),
    async run(a) {
      const id = optText(a, 'window')?.trim()
      let target: ShotTarget = 'screen'
      if (id) {
        const w = useWindows.getState().windows.find((x) => x.id === id)
        if (!w) throw new Error(`There is no window "${id}". list_windows shows the open ones.`)
        target = { window: id }
      }
      const canvas = await captureCanvas(target)
      flash(target)
      const p = await saveScreenshot(canvas)
      return { path: pretty(p), of: targetName(target).replace(/^Screenshot of /, ''), width: canvas.width, height: canvas.height }
    },
  },
  {
    name: 'run_python',
    description:
      'Run Python 3 (Pyodide, in the browser) in a session kept for AI use: variables stay between calls. The working folder ' +
      'is the home folder /home/user, where the KherveOS files are; files written there appear on the drive. numpy, pandas, ' +
      'scipy, matplotlib, sympy, scikit-learn… load on import. matplotlib figures are saved as PNG files in ~/Pictures and ' +
      'their paths returned. Returns stdout, stderr, the value of the last expression ("result") and any error. ' +
      'No input(). The first run loads Python, which takes a few seconds.',
    inputSchema: object({ code: str('The Python code to run.') }, ['code']),
    async run(a) {
      const code = text(a, 'code')
      const py = (kernel ??= new PythonKernel('kherveos-ai'))
      let stdout = ''
      let stderr = ''
      const r = await py.runCell(code, {
        onStdout: (t) => { if (stdout.length < 400_000) stdout += t },
        onStderr: (t) => { if (stderr.length < 400_000) stderr += t },
      })
      const figures: string[] = []
      for (const b64 of r.figures) figures.push(await saveFigure(b64))
      return {
        ok: r.ok,
        ...(stdout && { stdout: clip(stdout, 10_000) }),
        ...(stderr && { stderr: clip(stderr, 4000) }),
        ...(r.result !== null && { result: clip(r.result, 10_000) }),
        ...(r.error && { error: clip(r.error.traceback || `${r.error.type}: ${r.error.message}`, 6000) }),
        ...(figures.length && { figures }),
      }
    },
  },
  {
    name: 'create_notebook',
    description:
      'Create a kBook notebook (.kbook) from a list of cells (Python code, Markdown or LaTeX) and save it on the ' +
      'KherveOS drive; ".kbook" is added to the name if missing. It only writes the file: open_file shows it. To work in the ' +
      'notebook on screen (add, run cells and see outputs), use the khervebook_ tools instead. ' +
      'Does not replace an existing notebook unless "overwrite" is true (the user is asked first).',
    inputSchema: object(
      {
        path: str('Where to save it, e.g. "~/Notebooks/analysis.kbook".'),
        cells: {
          type: 'array',
          description: 'The cells, in order.',
          items: object(
            {
              type: { type: 'string', enum: ['code', 'markdown', 'latex'], description: 'Python "code", "markdown" text or "latex".' },
              source: str('The cell\'s text.'),
            },
            ['type', 'source'],
          ),
        },
        overwrite: bool('Replace the notebook if it already exists (the user is asked to allow it). Default false.'),
      },
      ['path', 'cells'],
    ),
    async run(a) {
      const p = notebookPath(text(a, 'path'))
      const raw = a.cells
      if (!Array.isArray(raw) || !raw.length) throw new Error('"cells" must be a list of {type, source}, with at least one cell.')
      const cells = raw.map((c, i) => {
        const cell = c && typeof c === 'object' ? (c as Args) : null
        if (!cell) throw new Error(`Cell ${i + 1} must be an object {type, source}.`)
        const type = cell.type ?? 'code'
        if (type !== 'code' && type !== 'markdown' && type !== 'latex') throw new Error(`Cell ${i + 1}: "type" must be "code", "markdown" or "latex".`)
        if (typeof cell.source !== 'string') throw new Error(`Cell ${i + 1}: "source" must be text.`)
        return { type, source: cell.source }
      })
      const st = fs.stat(p)
      if (st?.type === 'dir') throw new FsError('EISDIR', p)
      if (st && a.overwrite !== true) {
        throw new Error(`${pretty(p)} already exists. Pass "overwrite": true to replace it (the user is asked first), or choose another name.`)
      }
      // The format shared with the desktop KherveBook.
      await fs.writeText(p, JSON.stringify({ format: 'kbook', version: 1, cells }, null, 1), { mkdirs: true })
      return { path: pretty(p), cells: cells.length, replaced: !!st }
    },
  },
  {
    name: 'notify',
    description: 'Show the user a short notification in the corner of the KherveOS screen.',
    inputSchema: object({ title: str('A few words.'), body: str('An optional sentence or two.') }, ['title']),
    async run(a) {
      const title = text(a, 'title').trim().slice(0, 120)
      if (!title) throw new Error('The title is empty.')
      const body = optText(a, 'body')?.trim().slice(0, 400)
      os.notify({ title, body: body || undefined, icon: Sparkles })
      return { shown: true }
    },
  },
]

/** The core tools and every app's tools (those of apps with no window open too: they open it). */
export function allTools(): KTool[] {
  return [...KTOOLS, ...appKTools()]
}

export function getTool(name: string): KTool | undefined {
  const all = allTools()
  return all.find((t) => t.name === name) ?? all.find((t) => t.name === name.trim().toLowerCase())
}

// ------------------------------------------------------------- running them

const TYPE_WORDS: Record<string, string> = {
  string: 'text',
  integer: 'a whole number',
  number: 'a number',
  boolean: 'true or false',
  array: 'a list',
  object: 'an object',
}

function fits(v: unknown, type: unknown): boolean {
  switch (type) {
    case 'string': return typeof v === 'string'
    case 'integer': return Number.isInteger(v)
    case 'number': return typeof v === 'number' && Number.isFinite(v)
    case 'boolean': return typeof v === 'boolean'
    case 'array': return Array.isArray(v)
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v)
    default: return true
  }
}

/** Check the arguments against the schema, forgiving what small models often get wrong ("5" for 5, "true" for true…). */
function checkArgs(tool: KTool, raw: unknown): Args {
  const args: Args = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Args) } : {}
  const schema = tool.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    let v = args[key]
    // Small models write "None" or "" for an argument they mean to leave out.
    if (v === undefined || v === null || (spec.type !== 'string' && typeof v === 'string' && /^\s*(none|null|undefined)?\s*$/i.test(v))) {
      delete args[key]
      continue
    }
    if (spec.type === 'string' && (typeof v === 'number' || typeof v === 'boolean')) v = String(v)
    if ((spec.type === 'integer' || spec.type === 'number') && typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) v = Number(v)
    if (spec.type === 'integer' && typeof v === 'number' && Number.isFinite(v)) v = Math.round(v)
    if (spec.type === 'boolean' && (v === 'true' || v === 'false')) v = v === 'true'
    if ((spec.type === 'array' || spec.type === 'object') && typeof v === 'string') {
      try {
        v = JSON.parse(v)
      } catch {
        // reported just below
      }
    }
    if (!fits(v, spec.type)) throw new Error(`"${key}" must be ${TYPE_WORDS[spec.type ?? ''] ?? spec.type}.`)
    args[key] = v
  }
  const missing = (schema.required ?? []).filter((k) => args[k] === undefined)
  if (missing.length) throw new Error(`${tool.name} needs ${missing.map((k) => `"${k}"`).join(' and ')}.`)
  return args
}

interface Question {
  what: string
  detail?: string
}

/** What the user must allow before this call runs, if anything. */
function askFirst(tool: KTool, a: Args): Question | null {
  if (tool.name === 'delete') {
    const p = drivePath(text(a, 'path'))
    const st = fs.stat(p)
    if (!st) return null // nothing to delete: the tool says so
    if (st.type === 'dir') {
      const n = fs.walk(p).length
      return { what: `delete the folder ${pretty(p)}${n ? ` and the ${n} item${n === 1 ? '' : 's'} in it` : ''}`, detail: 'This cannot be undone.' }
    }
    return { what: `delete ${pretty(p)}`, detail: 'This cannot be undone.' }
  }
  if ((tool.name === 'write_file' || tool.name === 'create_notebook') && a.overwrite === true) {
    const p = tool.name === 'write_file' ? filePath(text(a, 'path')) : notebookPath(text(a, 'path'))
    return fs.isFile(p) ? { what: `replace ${pretty(p)}`, detail: 'What is in it now will be lost.' } : null
  }
  return tool.destructive ? { what: `use "${tool.name}"` } : null
}

/** Callers the user let run Python without asking again, until KherveOS is reloaded. */
const pythonAllowed = new Set<string>()

/**
 * Python run for an AI is asked about every time (unless allowed until reload):
 * its code can change any file and reach the KherveOS server as the user.
 */
async function allowPython(caller: string, code: string): Promise<boolean> {
  if (pythonAllowed.has(caller)) return true
  const message = createElement(
    'div',
    null,
    createElement('p', { style: { margin: '0 0 8px' } }, `${caller} wants to run this Python code. Python can read and change your files and use KherveOS as you.`),
    createElement(
      'pre',
      {
        style: {
          maxHeight: 220, overflow: 'auto', margin: 0, padding: '8px 10px', borderRadius: 6, whiteSpace: 'pre-wrap',
          background: 'var(--k-bg)', border: '1px solid var(--k-border)', font: '12px var(--k-mono)', userSelect: 'text',
        },
      },
      clip(code, 4000),
    ),
  )
  const choice = await os.dialog.choose(
    message,
    [
      { label: 'Deny', value: 'deny', primary: true },
      { label: 'Allow once', value: 'once', danger: true },
      { label: 'Allow until reload', value: 'always', danger: true },
    ],
    { title: 'Run Python?' },
  )
  if (choice === 'always') pythonAllowed.add(caller)
  return choice === 'once' || choice === 'always'
}

async function allowed(caller: string, q: Question): Promise<boolean> {
  const choice = await os.dialog.choose(
    `${caller} wants to ${q.what}.${q.detail ? `\n\n${q.detail}` : ''}`,
    [
      { label: 'Deny', value: 'deny', primary: true },
      { label: 'Allow', value: 'allow', danger: true },
    ],
    { title: 'Allow this?' },
  )
  return choice === 'allow'
}

function toast(title: string, body?: string, onClick?: () => void) {
  os.notify({ title, body, icon: Sparkles, onClick, timeout: 5000 })
}

/** A small notification for each change an AI makes. */
function tell(caller: string, name: string, a: Args, result: unknown) {
  const r = result && typeof result === 'object' ? (result as Args) : {}
  const path = (key: string) => (typeof r[key] === 'string' ? (r[key] as string) : '')
  const open = (p: string) => () => void os.openFile(drivePath(p))
  switch (name) {
    case 'write_file':
      return toast(`${caller} ${r.replaced ? 'replaced' : 'saved'} ${basename(path('path'))}`, dirname(path('path')), open(path('path')))
    case 'create_notebook':
      return toast(`${caller} made the notebook ${basename(path('path'))}`, dirname(path('path')), open(path('path')))
    case 'create_folder':
      return r.created ? toast(`${caller} made the folder ${basename(path('path'))}`, dirname(path('path')), open(path('path'))) : undefined
    case 'move':
      return toast(`${caller} moved ${basename(path('from'))}`, `to ${path('to')}`, open(dirname(path('to'))))
    case 'delete':
      return toast(`${caller} deleted ${basename(path('deleted'))}`, dirname(path('deleted')))
    case 'take_screenshot':
      return toast(`${caller} took a screenshot`, `${basename(path('path'))} — click to open`, open(path('path')))
    case 'run_python': {
      const first = typeof a.code === 'string' ? a.code.trim().split('\n')[0].slice(0, 80) : ''
      const figures = Array.isArray(r.figures) ? (r.figures as string[]) : []
      return toast(`${caller} ran Python`, first, figures.length ? open(figures[0]) : undefined)
    }
  }
}

/**
 * Run a tool for an AI: checks the arguments, asks the user before anything is
 * deleted or overwritten and before Python runs, and never throws (errors come
 * back as { ok: false, error }).
 */
export async function runTool(name: string, args: Record<string, unknown>, opts: RunToolOptions = {}): Promise<ToolResult> {
  const tool = getTool(name)
  if (!tool) return { ok: false, error: `There is no tool "${name}". The tools are: ${allTools().map((t) => t.name).join(', ')}.` }
  const caller = opts.caller?.trim() || 'An AI assistant'
  const signal = opts.signal
  const ctx: ToolContext = {
    caller,
    signal,
    async confirm(what, detail) {
      if (signal?.aborted) return false
      const yes = await allowed(caller, { what, detail })
      if (signal?.aborted) {
        if (yes) toast('Not done', `${caller} stopped waiting for your answer.`)
        return false
      }
      return yes
    },
    async allowPython(code) {
      if (signal?.aborted) return false
      const yes = await allowPython(caller, code)
      return yes && !signal?.aborted
    },
  }
  try {
    const input = checkArgs(tool, args)
    const question = askFirst(tool, input)
    if (question) {
      if (opts.signal?.aborted) return { ok: false, error: CANCELLED }
      const yes = await allowed(caller, question)
      if (opts.signal?.aborted) {
        if (yes) toast('Not done', `${caller} stopped waiting for your answer.`)
        return { ok: false, error: CANCELLED }
      }
      if (!yes) return { ok: false, error: `The user did not allow this (${question.what}).` }
    }
    if (tool.name === 'run_python') {
      if (opts.signal?.aborted) return { ok: false, error: CANCELLED }
      const yes = await allowPython(caller, text(input, 'code'))
      if (opts.signal?.aborted) return { ok: false, error: CANCELLED }
      if (!yes) return { ok: false, error: 'The user did not allow this Python code to run.' }
    }
    const result = await tool.run(input, ctx)
    tell(caller, tool.name, input, result)
    return { ok: true, result }
  } catch (e) {
    return { ok: false, error: explain(e) }
  }
}
