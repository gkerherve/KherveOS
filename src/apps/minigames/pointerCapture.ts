// Taking the mouse for a first-person game: the cursor disappears, stays put,
// and every movement turns the player, with no screen edge to stop at.
//
// In a browser that is pointer lock, one request at a time (a second request
// while one is pending makes Chrome refuse both). In the KherveOS Mac app
// (tools/macos/KherveOS.swift) WebKit gives pages no pointer lock, so the app
// does it: it hides and freezes the cursor and sends the raw movement here
// ('kherveos:mouse-delta'); it lets go by itself when the app loses focus
// ('kherveos:mouse-released').

interface NativeBridge {
  postMessage(message: unknown): void
}

const nativeApp = (): NativeBridge | null =>
  (globalThis as { webkit?: { messageHandlers?: { kherveos?: NativeBridge } } }).webkit?.messageHandlers?.kherveos ?? null

let pending = false
/** The element holding the mouse through the Mac app. */
let nativeEl: HTMLElement | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((cb) => cb())

if (typeof document !== 'undefined') {
  const clear = () => {
    pending = false
  }
  document.addEventListener('pointerlockchange', clear)
  document.addEventListener('pointerlockerror', clear)
  document.addEventListener('pointerlockchange', notify)
  window.addEventListener('kherveos:mouse-released', () => {
    if (!nativeEl) return
    nativeEl = null
    notify()
  })
}

/** The mouse is held through the Mac app (movement arrives with onMouseDelta, not mousemove). */
export const nativeCapture = () => !!nativeEl

export function isMouseCaptured(el: HTMLElement | null): boolean {
  if (!el) return false
  return nativeEl ? nativeEl === el : document.pointerLockElement === el
}

/** Ask for the mouse on `el` (from a click or a key: browsers want a gesture). */
export function captureMouse(el: HTMLElement | null, refused: (why: string) => void) {
  if (!el || isMouseCaptured(el)) return
  const app = nativeApp()
  if (app) {
    nativeEl = el
    app.postMessage({ type: 'mouse', capture: true })
    notify()
    return
  }
  if (pending) return
  pending = true
  try {
    const req = el.requestPointerLock() as unknown as Promise<void> | undefined
    if (req && typeof req.then === 'function')
      req.then(
        () => {
          pending = false
        },
        (e: unknown) => {
          pending = false
          refused(e instanceof Error ? e.message : String(e))
        },
      )
  } catch (e) {
    pending = false
    refused(e instanceof Error ? e.message : String(e))
  }
}

/** Give the mouse back (the cursor shows again where it was). */
export function releaseMouse() {
  if (nativeEl) {
    nativeEl = null
    nativeApp()?.postMessage({ type: 'mouse', capture: false })
    notify()
    return
  }
  if (document.pointerLockElement) document.exitPointerLock()
}

/** Called when the mouse is taken or given back (either way). */
export function onCaptureChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** The movement while the Mac app holds the mouse. */
export function onMouseDelta(cb: (dx: number, dy: number) => void): () => void {
  const on = (e: Event) => {
    if (!nativeEl) return
    const [dx, dy] = (e as CustomEvent<[number, number]>).detail
    cb(dx, dy)
  }
  window.addEventListener('kherveos:mouse-delta', on)
  return () => window.removeEventListener('kherveos:mouse-delta', on)
}
