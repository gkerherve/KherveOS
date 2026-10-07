// The heart of Shut Down…, kept free of imports so it can be tested on its own:
// close every window front to back through the window manager's close(), which
// runs each app's close guard (Save / Don't Save / Cancel). Stops at the first
// window that stays open (the user cancelled) and leaves the rest as they are.

export interface ClosableWindow {
  id: string
  z: number
  minimized: boolean
}

export interface WindowCloser {
  windows(): readonly ClosableWindow[]
  close(id: string): Promise<void>
}

/** Front to back: visible windows by stacking order, then the minimised ones. */
export function frontToBack(windows: readonly ClosableWindow[]): ClosableWindow[] {
  return [...windows].sort((a, b) => Number(a.minimized) - Number(b.minimized) || b.z - a.z)
}

/** Close every window; true when none is left, false when one refused to close. */
export async function closeAllWindows(wm: WindowCloser): Promise<boolean> {
  const tried = new Set<string>()
  for (;;) {
    const open = wm.windows()
    if (!open.length) return true
    // A window we already asked is still there: its app (or the user) said no.
    if (open.some((w) => tried.has(w.id))) return false
    const next = frontToBack(open)[0]
    tried.add(next.id)
    await wm.close(next.id)
  }
}
