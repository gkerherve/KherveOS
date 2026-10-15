// Taking the mouse for a first-person game (pointer lock), one request at a
// time: a second request while one is pending makes Chrome refuse both.
// When the browser says no, the caller is told why (shown to the player).

let pending = false

const clear = () => {
  pending = false
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerlockchange', clear)
  document.addEventListener('pointerlockerror', clear)
}

/** Ask for the mouse on `el` (from a click or a key: browsers want a gesture). */
export function captureMouse(el: HTMLElement | null, refused: (why: string) => void) {
  if (!el || pending || document.pointerLockElement === el) return
  pending = true
  try {
    const req = el.requestPointerLock() as unknown as Promise<void> | undefined
    if (req && typeof req.then === 'function')
      req.then(clear, (e: unknown) => {
        pending = false
        refused(e instanceof Error ? e.message : String(e))
      })
  } catch (e) {
    pending = false
    refused(e instanceof Error ? e.message : String(e))
  }
}
