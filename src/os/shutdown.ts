// Shut Down…: close every window (each app asks about unsaved work), make sure
// the drive has written everything, then show the "shut down" screen. Inside
// KherveOS.app (macOS, WKWebView) the app is told to quit as well.

import { create } from 'zustand'
import { useWindows } from './windows'
import { fs } from './vfs'
import { closeAllWindows } from './shutdownSequence'

export const useShutdown = create<{ off: boolean }>(() => ({ off: false }))

let busy = false

interface WebKitWindow {
  webkit?: { messageHandlers?: { kherveos?: { postMessage(msg: unknown): void } } }
}

/** Returns false (and changes nothing more) if a window refused to close. */
export async function shutdown(): Promise<boolean> {
  if (busy || useShutdown.getState().off) return false
  busy = true
  try {
    const wm = useWindows.getState()
    const closed = await closeAllWindows({
      windows: () => useWindows.getState().windows,
      close: (id) => wm.close(id),
    })
    if (!closed) return false
    // Let the closed apps unmount (their clean-ups may still write), then flush the drive.
    await new Promise((r) => setTimeout(r, 100))
    await fs.flush().catch((e) => console.error('[shutdown] flush', e))
    useShutdown.setState({ off: true })
    ;(window as WebKitWindow).webkit?.messageHandlers?.kherveos?.postMessage({ type: 'shutdown' })
    return true
  } finally {
    busy = false
  }
}
