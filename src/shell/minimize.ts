// Minimising like macOS: the window shrinks into its own tile on the right of
// the Dock, which shows the app's icon; restoring plays the move backwards.

import { create } from 'zustand'

/** Pictures of the minimised windows, by window id (data URLs). */
export const useWindowPictures = create<Record<string, string>>(() => ({}))

/** Where each minimised window's Dock tile last sat (restoring starts there). */
export const tileRects = new Map<string, DOMRect>()

const DURATION = 440
const EASE = 'cubic-bezier(0.33, 0, 0.2, 1)'

/** Forget a window's picture and tile (restored or closed). */
export function forgetWindow(id: string) {
  tileRects.delete(id)
  if (useWindowPictures.getState()[id]) {
    useWindowPictures.setState((s) => {
      const next = { ...s }
      delete next[id]
      return next
    }, true)
  }
}

/** The Dock tile of a minimised window, or a spot at the bottom centre if the Dock has none. */
export function tileFor(id: string): DOMRect {
  const el = document.querySelector<HTMLElement>(`[data-dock-win="${CSS.escape(id)}"]`)
  if (el) {
    const r = el.getBoundingClientRect()
    tileRects.set(id, r)
    return r
  }
  return tileRects.get(id) ?? new DOMRect(window.innerWidth / 2 - 24, window.innerHeight - 56, 48, 48)
}

/**
 * The window flying into its tile: it narrows towards the tile first, then
 * drops into it and fades, a light take on the macOS genie. Transforms are
 * about the window's centre (the default transform-origin).
 */
function keyframes(win: DOMRect, tile: DOMRect): Keyframe[] {
  const s = Math.min(tile.width / win.width, tile.height / win.height)
  const dx = tile.left + tile.width / 2 - (win.left + win.width / 2)
  const dy = tile.top + tile.height / 2 - (win.top + win.height / 2)
  const mix = (a: number, b: number, t: number) => a + (b - a) * t
  return [
    { transform: 'none', opacity: 1, offset: 0 },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.25}px) scale(${mix(1, s, 0.65)}, ${mix(1, s, 0.3)})`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.85, offset: 0.92 },
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0, offset: 1 },
  ]
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * Shrink a window into its Dock tile; resolves once it has landed. The animation
 * holds the window in the tile until `cancel` — call it only once the window is
 * hidden, or it springs back to full size for a frame.
 */
export function animateMinimize(frame: HTMLElement, tile: DOMRect): { done: Promise<void>; cancel: () => void } {
  if (reduced() || !frame.animate) return { done: Promise.resolve(), cancel: () => {} }
  const anim = frame.animate(keyframes(frame.getBoundingClientRect(), tile), { duration: DURATION, easing: EASE, fill: 'forwards' })
  return {
    done: anim.finished.then(
      () => {},
      () => {},
    ),
    cancel: () => anim.cancel(),
  }
}

/** Grow a window back out of its Dock tile. */
export function animateRestore(frame: HTMLElement, tile: DOMRect): Promise<void> {
  if (reduced() || !frame.animate) return Promise.resolve()
  const frames = keyframes(frame.getBoundingClientRect(), tile)
    .reverse()
    .map((k) => ({ ...k, offset: 1 - (k.offset as number) }))
  const anim = frame.animate(frames, { duration: DURATION, easing: EASE })
  return anim.finished.then(
    () => {},
    () => {},
  )
}
