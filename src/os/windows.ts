// The window manager: which windows are open, where they are, which one is
// in front. Purely state — the shell renders it (src/shell/WindowFrame.tsx).

import { create } from 'zustand'
import { getApp } from './registry'
import type { AppArgs } from './types'

/** The thin menu bar across the top of the screen. */
export const TOP_BAR_HEIGHT = 24
/** Space kept free for the Dock at the bottom (maximised windows stop above it). */
export const DOCK_SPACE = 76

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export interface WinState extends Bounds {
  id: string
  appId: string
  title: string
  args: AppArgs
  z: number
  minimized: boolean
  /** When it was minimised: the Dock shows minimised windows in this order. */
  minimizedAt?: number
  maximized: boolean
  snapped: 'left' | 'right' | null
  /** Bounds to go back to after un-maximising / un-snapping. */
  restore: Bounds | null
  /** The file shown, if it changed since the window opened (see WindowApi.setDocumentPath). */
  docPath?: string | null
}

interface WMState {
  windows: WinState[]
  focusedId: string | null
  open(appId: string, args?: AppArgs): string | null
  close(id: string, force?: boolean): Promise<void>
  focus(id: string): void
  minimize(id: string): void
  toggleMaximize(id: string): void
  snap(id: string, side: 'left' | 'right' | 'max' | null): void
  setBounds(id: string, b: Partial<Bounds>): void
  setTitle(id: string, title: string): void
  setDocPath(id: string, path: string | null): void
}

const closeGuards = new Map<string, () => boolean | Promise<boolean>>()

export function setCloseGuard(id: string, guard: (() => boolean | Promise<boolean>) | null) {
  if (guard) closeGuards.set(id, guard)
  else closeGuards.delete(id)
}

let counter = 0
let zTop = 10

/** The usable area for windows (below the menu bar, above the Dock). Window coordinates start below the menu bar. */
export function desktopSize() {
  return { w: window.innerWidth, h: window.innerHeight - TOP_BAR_HEIGHT - DOCK_SPACE }
}

export const isSmallScreen = () => window.innerWidth < 760

export const useWindows = create<WMState>((set, get) => ({
  windows: [],
  focusedId: null,

  open(appId, args = {}) {
    const app = getApp(appId)
    if (!app) {
      console.warn(`[wm] unknown app "${appId}"`)
      return null
    }
    const { windows } = get()
    // Singletons, and files already open in this app, focus their window.
    const existing = windows.find(
      (w) =>
        w.appId === appId &&
        !args.newWindow &&
        (app.singleton || (args.path !== undefined && (w.docPath !== undefined ? w.docPath : w.args.path) === args.path)),
    )
    if (existing) {
      if (Object.keys(args).length) {
        set({ windows: windows.map((w) => (w.id === existing.id ? { ...w, args: { ...args } } : w)) })
      }
      get().focus(existing.id)
      return existing.id
    }
    const desk = desktopSize()
    const size = app.defaultSize ?? { w: 720, h: 480 }
    const w = Math.min(size.w, desk.w - 16)
    const h = Math.min(size.h, desk.h - 16)
    const n = windows.filter((x) => !x.minimized).length
    const x = Math.max(8, Math.min(Math.round((desk.w - w) / 2) - 120 + (n % 8) * 32, desk.w - w - 8))
    const y = Math.max(8, Math.min(Math.round((desk.h - h) / 2) - 60 + (n % 8) * 28, desk.h - h - 8))
    const id = `w${++counter}`
    const small = isSmallScreen()
    const win: WinState = {
      id, appId, args: { ...args }, title: app.name,
      x, y, w, h, z: ++zTop,
      minimized: false, maximized: small, snapped: null, restore: null,
    }
    set({ windows: [...windows, win], focusedId: id })
    return id
  },

  async close(id, force = false) {
    const guard = closeGuards.get(id)
    if (!force && guard) {
      get().focus(id)
      const ok = await guard()
      if (!ok) return
    }
    closeGuards.delete(id)
    const rest = get().windows.filter((w) => w.id !== id)
    const top = rest.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0]
    set({ windows: rest, focusedId: get().focusedId === id ? (top?.id ?? null) : get().focusedId })
  },

  focus(id) {
    const { windows, focusedId } = get()
    const target = windows.find((w) => w.id === id)
    if (!target) return
    if (focusedId === id && !target.minimized && target.z === zTop) return
    const z = ++zTop
    set({ windows: windows.map((w) => (w.id === id ? { ...w, z, minimized: false, minimizedAt: undefined } : w)), focusedId: id })
  },

  minimize(id) {
    const rest = get().windows.map((w) => (w.id === id && !w.minimized ? { ...w, minimized: true, minimizedAt: Date.now() } : w))
    const top = rest.filter((w) => !w.minimized).sort((a, b) => b.z - a.z)[0]
    set({ windows: rest, focusedId: top?.id ?? null })
  },

  toggleMaximize(id) {
    const w = get().windows.find((x) => x.id === id)
    if (!w) return
    get().snap(id, w.maximized || w.snapped ? null : 'max')
  },

  snap(id, side) {
    const target = get().windows.find((x) => x.id === id)
    if (side && target && getApp(target.appId)?.fixedSize) return
    set({
      windows: get().windows.map((w) => {
        if (w.id !== id) return w
        if (side === null) {
          const r = w.restore
          return { ...w, maximized: false, snapped: null, restore: null, ...(r ?? {}) }
        }
        const restore = w.maximized || w.snapped ? w.restore : { x: w.x, y: w.y, w: w.w, h: w.h }
        if (side === 'max') return { ...w, maximized: true, snapped: null, restore }
        return { ...w, maximized: false, snapped: side, restore }
      }),
    })
    get().focus(id)
  },

  setBounds(id, b) {
    set({ windows: get().windows.map((w) => (w.id === id ? { ...w, ...b } : w)) })
  },

  setDocPath(id, path) {
    set({ windows: get().windows.map((x) => (x.id === id ? { ...x, docPath: path } : x)) })
  },

  setTitle(id, title) {
    const w = get().windows.find((x) => x.id === id)
    if (!w || w.title === title) return
    set({ windows: get().windows.map((x) => (x.id === id ? { ...x, title } : x)) })
  },
}))
