// Full screen for the whole OS (hides the browser's tabs and address bar).

import { useSyncExternalStore } from 'react'

export const isFullscreen = () => !!document.fullscreenElement

export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
    // Chrome/Edge: let apps receive a single Esc; holding Esc still leaves full screen.
    const kb = (navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }).keyboard
    await kb?.lock?.(['Escape']).catch(() => {})
  } catch (e) {
    console.warn('[fullscreen] not available', e)
  }
}

const subscribe = (cb: () => void) => {
  document.addEventListener('fullscreenchange', cb)
  return () => document.removeEventListener('fullscreenchange', cb)
}

export function useFullscreen(): boolean {
  return useSyncExternalStore(subscribe, isFullscreen)
}
