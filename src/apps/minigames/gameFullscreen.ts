// Full screen for a game (F, Esc, or its Full Screen menu): the game's window covers
// the whole screen, menu bar and Dock included. If KherveOS is not full screen
// already, the screen goes full screen too (the Mac window in the KherveOS app, the
// page in a browser) and comes back out when the game leaves it; if it is (the
// button in the top bar), it stays so.

import { useSyncExternalStore } from 'react'
import { isFullscreen, onFullscreenChange, setFullscreen } from '@/os/fullscreen'

const CLASS = 'k-game-full'
const EVENT = 'kherveos:game-full'
/** The screen's full screen was turned on by a game (so the game turns it off again). */
let ours = false

const windowOf = (el: HTMLElement | null) => (el?.closest('.k-window') as HTMLElement | null) ?? null

export function isGameFullscreen(el: HTMLElement | null): boolean {
  return !!windowOf(el)?.classList.contains(CLASS)
}

function set(win: HTMLElement, on: boolean) {
  win.classList.toggle(CLASS, on)
  window.dispatchEvent(new Event(EVENT))
}

/** The game's window over the whole screen, or back; `relock` takes the mouse again afterwards. */
export function toggleGameFullscreen(el: HTMLElement | null, relock?: () => void) {
  const win = windowOf(el)
  if (!win) return
  const on = !win.classList.contains(CLASS)
  set(win, on)
  const done = () => relock?.()
  if (on && !isFullscreen()) {
    ours = true
    void setFullscreen(true).then(done, done)
  } else if (!on && ours) {
    ours = false
    void setFullscreen(false).then(done, done)
  } else done()
}

// the screen left full screen some other way (the top-bar button, the green button, Esc held in a browser):
// a game that went full screen on its own goes back into its window
if (typeof window !== 'undefined') {
  onFullscreenChange(() => {
    if (isFullscreen() || !ours) return
    ours = false
    document.querySelectorAll<HTMLElement>(`.${CLASS}`).forEach((w) => set(w, false))
  })
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}

/** Is this game's window full screen (for its menu's check mark)? */
export function useGameFullscreen(ref: { current: HTMLElement | null }): boolean {
  return useSyncExternalStore(subscribe, () => isGameFullscreen(ref.current))
}
