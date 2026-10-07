// Screenshots, like macOS: a picture of one window or of the whole screen,
// saved as PNG in ~/Pictures/Screenshots ("Screenshot 2026-10-07 at 14.03.27.png").
//
//   takeScreenshot({ window: id })  /  takeScreenshot('screen')   save + flash + notification
//   captureCanvas(target)                                         just the picture (KherveAI attaches it)
//   screenshotTargets()                                           what can be taken, front window first
//
// The picture is drawn from the page itself (modern-screenshot, the same renderer
// as the Dock's pictures of minimised windows): what other sites show inside
// a Browser window (cross-origin frames) comes out blank.

import { Camera } from 'lucide-react'
import { fs } from './vfs'
import { HOME, join, pretty } from './path'
import { notify } from './overlays'
import { useWindows } from './windows'
import { getApp } from './registry'
import { freeName, screenshotFileName } from './screenshotCore'

export const SCREENSHOT_DIR = `${HOME}/Pictures/Screenshots`

export type ShotTarget = 'screen' | { window: string }

export interface RenderOptions {
  /** Picture pixels per CSS pixel (default: the screen's, up to 2). */
  scale?: number
  /** Elements to leave out of the picture. */
  skip?: (el: HTMLElement) => boolean
  timeout?: number
}

/** Never in a picture: window resize handles, menus, notifications, the flash. */
const ALWAYS_SKIP = ['k-resize', 'k-menu', 'k-toasts', 'k-shot-flash']

function modernOptions(el: HTMLElement, o: RenderOptions) {
  const w = el.offsetWidth
  const h = el.offsetHeight
  return {
    width: w,
    height: h,
    scale: o.scale ?? Math.min(2, window.devicePixelRatio || 1),
    // A window may be mid-animation, and the shell is position: fixed: take each as it lies.
    style: { transform: 'none', opacity: '1', left: '0', top: '0', margin: '0', position: 'relative' },
    filter: (n: Node) => !(n instanceof HTMLElement && (ALWAYS_SKIP.some((c) => n.classList.contains(c)) || o.skip?.(n))),
    font: false as const,
    timeout: o.timeout ?? 8000,
  }
}

/** Draw an element of the page onto a canvas. Throws if it has no size or can't be drawn. */
export async function renderToCanvas(el: HTMLElement, o: RenderOptions = {}): Promise<HTMLCanvasElement> {
  if (!el.offsetWidth || !el.offsetHeight) throw new Error('There is nothing on screen to take a picture of.')
  const { domToCanvas } = await import('modern-screenshot')
  return domToCanvas(el, modernOptions(el, o))
}

/** A small WebP picture of an element (the Dock's tiles). */
export async function renderToWebp(el: HTMLElement, o: RenderOptions & { quality?: number } = {}): Promise<string> {
  if (!el.offsetWidth || !el.offsetHeight) throw new Error('There is nothing on screen to take a picture of.')
  const { domToWebp } = await import('modern-screenshot')
  return domToWebp(el, { ...modernOptions(el, o), quality: o.quality ?? 0.85 })
}

export function windowFrame(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.k-window[data-window-id="${CSS.escape(id)}"]`)
}

const screenElement = () => document.querySelector<HTMLElement>('.k-shell')

function targetElement(t: ShotTarget): HTMLElement {
  const el = t === 'screen' ? screenElement() : windowFrame(t.window)
  if (!el) throw new Error(t === 'screen' ? 'The screen is not ready.' : 'That window is not open any more.')
  if (t !== 'screen' && useWindows.getState().windows.find((w) => w.id === t.window)?.minimized) {
    throw new Error('That window is minimised: bring it back from the Dock first.')
  }
  return el
}

/** What a screenshot can be taken of: the whole screen, then the windows on screen, front first. */
export function screenshotTargets(): { target: ShotTarget; label: string; app?: string }[] {
  const { windows } = useWindows.getState()
  return [
    { target: 'screen' as ShotTarget, label: 'Entire Screen' },
    ...[...windows]
      .filter((w) => !w.minimized)
      .sort((a, b) => b.z - a.z)
      .map((w) => {
        const app = getApp(w.appId)?.name
        return { target: { window: w.id } as ShotTarget, label: app && app !== w.title ? `${app} — ${w.title}` : w.title, app: w.appId }
      }),
  ]
}

/** A name for the picture: "Screenshot of Notepad". */
export function targetName(t: ShotTarget): string {
  if (t === 'screen') return 'Screenshot of the screen'
  const w = useWindows.getState().windows.find((x) => x.id === t.window)
  return `Screenshot of ${(w && (getApp(w.appId)?.name ?? w.title)) || 'a window'}`
}

/** The picture of a window or of the screen, at full resolution. */
export function captureCanvas(t: ShotTarget, o: RenderOptions = {}): Promise<HTMLCanvasElement> {
  return renderToCanvas(targetElement(t), o)
}

/** The camera flash over what was taken (outside the shell, so never in a picture). */
export function flash(t: ShotTarget) {
  const el = t === 'screen' ? screenElement() : windowFrame(t.window)
  if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const r = el.getBoundingClientRect()
  const f = document.createElement('div')
  f.className = 'k-shot-flash'
  Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  if (t !== 'screen') f.style.borderRadius = getComputedStyle(el).borderRadius
  document.body.appendChild(f)
  const done = () => f.remove()
  if (!f.animate) return void setTimeout(done, 300)
  f.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' }).finished.then(done, done)
}

function toPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('The picture could not be made.'))), 'image/png'),
  )
}

/** Save a picture as ~/Pictures/Screenshots/Screenshot <date> at <time>.png; returns its path. */
export async function saveScreenshot(canvas: HTMLCanvasElement, when = new Date()): Promise<string> {
  const name = freeName(screenshotFileName(when), (n) => fs.exists(join(SCREENSHOT_DIR, n)))
  const path = join(SCREENSHOT_DIR, name)
  await fs.writeBytes(path, await toPngBytes(canvas), { mkdirs: true })
  return path
}

let busy = false

/**
 * Take a screenshot like ⇧⌘3 / the title bar's camera: flash, save it to
 * ~/Pictures/Screenshots and say so (a click on the notification opens it).
 * Returns the path, or null (the reason was shown).
 */
export async function takeScreenshot(t: ShotTarget, opts: { quiet?: boolean } = {}): Promise<string | null> {
  if (busy) return null
  busy = true
  const when = new Date()
  try {
    const canvas = await captureCanvas(t)
    if (!opts.quiet) flash(t)
    const path = await saveScreenshot(canvas, when)
    if (!opts.quiet) {
      notify({
        title: 'Screenshot saved',
        body: `${pretty(path).replace(/^~\//, '').replace(/\//g, ' › ')} — click to open`,
        icon: Camera,
        onClick: () => void import('./index').then(({ os }) => os.openFile(path)),
      })
    }
    return path
  } catch (e) {
    if (!opts.quiet) notify({ title: 'No screenshot taken', body: e instanceof Error ? e.message : String(e), icon: Camera, color: 'var(--k-danger)' })
    if (opts.quiet) throw e
    return null
  } finally {
    busy = false
  }
}

/** The focused window, if one is on screen. */
export function frontWindow(): string | null {
  const { windows, focusedId } = useWindows.getState()
  const w = windows.find((x) => x.id === focusedId && !x.minimized)
  return w?.id ?? null
}

/**
 * ⇧⌘3: the whole screen. ⇧⌘4: the front window (Ctrl+Shift on other systems).
 * macOS keeps these keys for itself unless its own shortcuts are turned off,
 * so the title bar's camera is the dependable way. Returns the cleanup.
 */
export function installScreenshotKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey) return
    if (e.code === 'Digit3') {
      e.preventDefault()
      void takeScreenshot('screen')
    } else if (e.code === 'Digit4') {
      e.preventDefault()
      const id = frontWindow()
      void takeScreenshot(id ? { window: id } : 'screen')
    }
  }
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
