// One technique-app window's document: the engine (KherveFitting's FitBridge
// with the technique engine's install and protocol) and everything the page
// shows, as the engine last sent it.
//
// A request that reaches a wx modal dialog (FileDialog, MessageDialog,
// TextEntryDialog…) comes back with `modal`: the page asks the user with the
// KherveOS dialogs and sends the same request again with the answers so far
// (shims/wx/__init__.py `_modal`), until it completes.

import { createStore, type StoreApi } from 'zustand'
import { os } from '@/os'
import { HOME } from '@/os/path'
import { FitBridge, toBase64, type Answer } from '@/apps/khervefitting/bridge'
import { WHEELS_DIR, filesFor, installCode, parseAnswers, runCode, type FilesIndex } from './engine.core'
import { WX, wildcardExtensions, type Arrays, type Effect, type Fig, type ModalAnswer, type ModalSpec, type TechInfo, type TechState, type WxFrame, type WxNode } from './types'

const BASE = `${import.meta.env.BASE_URL}apps/khervetech/py/`

export interface TechDocState {
  info: TechInfo | null
  ready: boolean
  fig: Fig | null
  vlines: Record<string, number>
  rangeActive: boolean
  sheets: string[]
  sheet: string
  /** The project as Python sees it (a /home/user path, the same on the drive). */
  file: string
  technique: TechState['technique']
  right: WxNode | null
  frames: Record<number, WxFrame>
  /** Open tool windows, bottom to top. */
  open: number[]
  canUndo: boolean
  canRedo: boolean
  status: string
  busy: number
  progress: string | null
  message: { text: string; error: boolean } | null
  loading: string | null
}

const filesCache = new Map<string, Promise<{ files: Record<string, string>; wheels: Record<string, string> }>>()
const textCache = new Map<string, Promise<string>>()
const wheelCache = new Map<string, Promise<string>>()

async function fetchText(rel: string): Promise<string> {
  let p = textCache.get(rel)
  if (!p) {
    p = fetch(BASE + rel.split('/').map(encodeURIComponent).join('/'), { cache: 'no-cache' }).then((f) => {
      if (!f.ok) throw new Error(`${rel}: HTTP ${f.status}`)
      return f.text()
    })
    textCache.set(rel, p)
    p.catch(() => textCache.delete(rel))
  }
  return p
}

async function fetchWheel(name: string): Promise<string> {
  let p = wheelCache.get(name)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}${WHEELS_DIR}${name}`).then(async (f) => {
      if (!f.ok) throw new Error(`wheels/${name}: HTTP ${f.status}`)
      return toBase64(new Uint8Array(await f.arrayBuffer()))
    })
    wheelCache.set(name, p)
    p.catch(() => wheelCache.delete(name))
  }
  return p
}

/** One technique engine's Python files and wheels (py/files.json), fetched once per page. */
export function engineFiles(tech: string): Promise<{ files: Record<string, string>; wheels: Record<string, string> }> {
  let p = filesCache.get(tech)
  if (!p) {
    p = (async () => {
      const r = await fetch(`${BASE}files.json`, { cache: 'no-cache' })
      if (!r.ok) throw new Error(`files.json: HTTP ${r.status}`)
      const want = filesFor((await r.json()) as FilesIndex, tech)
      const [files, wheels] = await Promise.all([
        Promise.all(want.files.map(async (rel) => [rel, await fetchText(rel)] as const)),
        Promise.all(want.wheels.map(async (w) => [w, await fetchWheel(w)] as const)),
      ])
      return { files: Object.fromEntries(files), wheels: Object.fromEntries(wheels) }
    })()
    filesCache.set(tech, p)
    p.catch(() => filesCache.delete(tech))
  }
  return p
}

export class TechDoc {
  readonly bridge: FitBridge
  readonly store: StoreApi<TechDocState>
  readonly arrays: Arrays = new Map()
  readonly tech: string
  private flashTimer = 0
  /** Shown one after the other, never stacked. */
  private messages: Promise<void> = Promise.resolve()
  onEffect: (e: Effect) => void = () => {}

  constructor(ns: string, tech: string, name: string) {
    this.tech = tech
    this.bridge = new FitBridge(ns, {
      name,
      install: async () => {
        const { files, wheels } = await engineFiles(tech)
        return installCode(files, wheels)
      },
      run: runCode,
      parse: (out) => parseAnswers<Answer>(out),
    })
    this.store = createStore<TechDocState>(() => ({
      info: null, ready: false, fig: null, vlines: {}, rangeActive: false, sheets: [], sheet: '', file: '', technique: null, right: null,
      frames: {}, open: [], canUndo: false, canRedo: false, status: '', busy: 0, progress: null, message: null, loading: null,
    }))
    this.bridge.onBusy = (n) => this.set({ busy: n })
    this.bridge.onProgress = (t) => this.set({ progress: t })
    this.bridge.onLost = () => {
      this.set({ ready: false, fig: null, frames: {}, open: [], right: null, sheets: [], sheet: '', file: '' })
      this.arrays.clear()
      this.flash('Python stopped and started again: open the file again.', true)
      void this.start()
    }
  }

  get state(): TechDocState {
    return this.store.getState()
  }

  set(p: Partial<TechDocState>) {
    this.store.setState(p)
  }

  flash(text: string, error = false) {
    this.set({ message: { text, error } })
    window.clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => this.set({ message: null }), error ? 8000 : 4000)
  }

  /** Start the engine for this technique (MainFrame, the desktop modules). */
  async start(): Promise<boolean> {
    this.arrays.clear()
    const a = await this.call('init', { tech: this.tech })
    if (a.ok) this.set({ info: a.info as TechInfo, ready: true })
    return a.ok
  }

  /** Send a request; answer the engine's modal dialogs; adopt the state it sends. */
  async call(op: string, args: Record<string, unknown> = {}, opts: { strict?: boolean } = {}): Promise<Answer> {
    const answers: ModalAnswer[] = []
    for (let round = 0; round < 12; round++) {
      let a: Answer
      try {
        a = await this.bridge.call(op, { ...args, answers })
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e)
        if (opts.strict) throw e
        this.flash(text, true)
        return { ok: false, error: text }
      }
      if (a.state) this.adopt(a.state as TechState)
      if (!a.ok) {
        if (a.trace) console.warn(`[technique] ${op}:`, a.trace)
        if (opts.strict) throw new Error(a.error ?? 'Python failed.')
        this.flash(a.error ?? 'Python failed.', true)
        return a
      }
      if (!a.modal) return a
      answers.push(await this.ask(a.modal as ModalSpec))
    }
    return { ok: false, error: 'Too many dialogs.' }
  }

  /** Ask what a wx modal dialog asks, with the KherveOS dialogs. */
  async ask(m: ModalSpec): Promise<ModalAnswer> {
    const cancel = { id: WX.ID_CANCEL }
    switch (m.kind) {
      case 'file': {
        const extensions = wildcardExtensions(m.wildcard)
        const startDir = m.dir && m.dir.startsWith(HOME) ? m.dir : undefined
        const path = m.save
          ? await os.dialog.saveFile({ title: m.title, startDir, defaultName: m.file || undefined, extensions })
          : await os.dialog.openFile({ title: m.title, startDir, extensions })
        return path ? { id: WX.ID_OK, paths: [path] } : cancel
      }
      case 'dir': {
        const path = await os.dialog.pickFolder({ title: m.title, startDir: m.dir && m.dir.startsWith(HOME) ? m.dir : undefined })
        return path ? { id: WX.ID_OK, path } : cancel
      }
      case 'text': {
        const value = await os.dialog.prompt(m.message ?? '', { title: m.title, defaultValue: m.value ?? '' })
        return value === null ? cancel : { id: WX.ID_OK, value }
      }
      case 'choice': {
        const choices = m.choices ?? []
        const picked = await os.dialog.choose(m.message ?? '', [...choices.map((c, i) => ({ label: c, value: String(i), primary: i === (m.sel ?? 0) })), { label: 'Cancel', value: 'cancel' }], { title: m.title })
        return picked === null || picked === 'cancel' ? cancel : { id: WX.ID_OK, sel: Number(picked) }
      }
      case 'multichoice': {
        const value = await os.dialog.prompt(`${m.message ?? ''}\n\n${(m.choices ?? []).map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nNumbers, separated by commas:`, { title: m.title, defaultValue: (m.sels ?? []).map((i) => i + 1).join(', ') })
        if (value === null) return cancel
        const sels = value.split(/[,\s]+/).map((t) => Number(t) - 1).filter((i) => Number.isInteger(i) && i >= 0 && i < (m.choices ?? []).length)
        return { id: WX.ID_OK, sels }
      }
      case 'message': {
        const buttons = m.buttons ?? [['OK', WX.ID_OK]]
        if (buttons.length === 1) {
          await os.dialog.alert(m.message ?? '', { title: m.title })
          return { id: buttons[0][1] }
        }
        const picked = await os.dialog.choose(
          m.message ?? '',
          buttons.map(([label, id], i) => ({ label, value: String(id), primary: i === 0 && id !== WX.ID_NO && id !== WX.ID_CANCEL })),
          { title: m.title },
        )
        return { id: picked === null ? (buttons.find(([, id]) => id === WX.ID_CANCEL || id === WX.ID_NO)?.[1] ?? WX.ID_CANCEL) : Number(picked) }
      }
      default:
        // A custom wx.Dialog: shown by the page as a floating window (TechApp's ModalFrame).
        return new Promise<ModalAnswer>((resolve) => this.onModalDialog(m, resolve))
    }
  }

  /** Set by the page: shows a custom wx.Dialog and resolves with the button and the values. */
  onModalDialog: (m: ModalSpec, done: (a: ModalAnswer) => void) => void = (_m, done) => done({ id: WX.ID_CANCEL })

  private adopt(s: TechState) {
    for (const [k, v] of Object.entries(s.arrays ?? {})) this.arrays.set(k, v)
    const frames = { ...this.state.frames }
    for (const f of s.frames ?? []) frames[f.id!] = f
    for (const id of Object.keys(frames).map(Number)) if (!s.open.includes(id)) delete frames[id]
    const patch: Partial<TechDocState> = {
      vlines: s.vlines, rangeActive: s.rangeActive, sheets: s.sheets, sheet: s.sheet, file: s.file, technique: s.technique,
      frames, open: s.open, canUndo: s.canUndo, canRedo: s.canRedo, status: s.status,
    }
    if (s.main) patch.fig = s.main
    if (s.right) patch.right = s.right
    this.set(patch)
    for (const e of s.effects ?? []) this.effect(e)
  }

  private effect(e: Effect) {
    if (e.kind === 'message') {
      const text = e.message ?? ''
      const title = e.title ?? 'KherveFitting'
      this.messages = this.messages.then(() => os.dialog.alert(text, { title }))
    } else if (e.kind === 'clipboard' && typeof e.text === 'string') {
      void navigator.clipboard?.writeText(e.text).catch(() => {})
    }
    this.onEffect(e)
  }

  dispose() {
    window.clearTimeout(this.flashTimer)
    this.bridge.dispose()
  }
}
