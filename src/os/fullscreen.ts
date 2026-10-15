// Full screen for the whole OS (hides the browser's tabs and address bar).
//
// In the KherveOS Mac app (tools/macos/KherveOS.swift, a WebKit window) it is the window's own full screen,
// asked of the app: WebKit's page full screen always ends on Esc, the window's does not. In a browser it is
// the page's full screen, with Esc kept from the browser where it can be (Chrome/Edge keyboard lock).
// Either way Esc reaches the page: the desktop ignores it, a game leaves its own full screen.

import { useSyncExternalStore } from 'react'

interface NativeBridge {
  postMessage(message: unknown): void
}

/** The Mac app's message handler, when KherveOS runs inside it. */
const nativeApp = (): NativeBridge | null =>
  (globalThis as { webkit?: { messageHandlers?: { kherveos?: NativeBridge } } }).webkit?.messageHandlers?.kherveos ?? null

/** The Mac window's full screen, as the app last reported it. */
let nativeFull = false
const NATIVE_EVENT = 'kherveos:native-fullscreen'
const CHANGE_EVENT = 'kherveos:fullscreen-change'

export const isFullscreen = () => (nativeApp() ? nativeFull : !!document.fullscreenElement)

/** Turn the screen's full screen on or off (the Mac window's in the app, the page's in a browser). */
export async function setFullscreen(on: boolean): Promise<void> {
  if (on === isFullscreen()) return
  const app = nativeApp()
  if (app) {
    app.postMessage({ type: 'fullscreen', on })
    return
  }
  try {
    if (on) await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    else await document.exitFullscreen()
  } catch (e) {
    console.warn('[fullscreen] not available', e)
  }
}

export async function toggleFullscreen(): Promise<void> {
  await setFullscreen(!isFullscreen())
}

/** Called whenever the screen goes in or out of full screen (button, menu, Esc held in a browser…). */
export function onFullscreenChange(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb)
  return () => window.removeEventListener(CHANGE_EVENT, cb)
}

/**
 * In a browser, whatever turned full screen on, Esc is kept from the browser: a single Esc reaches the page.
 * Chrome/Edge only; holding Esc still leaves full screen there, the browser keeps that for safety.
 */
function lockEscape() {
  if (!document.fullscreenElement) return
  const kb = (navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard
  void kb?.lock?.(['Escape']).catch(() => {})
}

if (typeof window !== 'undefined') {
  const changed = () => window.dispatchEvent(new Event(CHANGE_EVENT))
  document.addEventListener('fullscreenchange', () => {
    lockEscape()
    changed()
  })
  window.addEventListener(NATIVE_EVENT, (e) => {
    nativeFull = !!(e as CustomEvent<boolean>).detail
    changed()
  })
}

export function useFullscreen(): boolean {
  return useSyncExternalStore(onFullscreenChange, isFullscreen)
}
