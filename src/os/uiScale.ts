// Interface size (Settings › Appearance › Desktop), like macOS display scaling.
//
// The whole page is scaled with CSS `zoom` on <html>. On its own that would
// leave the OS's geometry in two coordinate spaces: pointer positions,
// getBoundingClientRect() and window.innerWidth/Height in screen pixels,
// while left/top/width/height styles are in zoomed CSS pixels — so a dragged
// window would run ahead of the pointer at 200%. To keep every piece of code
// (window dragging and resizing, snapping, maximise, the minimise animation,
// menus, the Dock, apps' canvases) working unchanged, this emulates the
// browser's own page zoom for scripts: those APIs are reported in CSS pixels,
// i.e. divided by the scale, and the hit-testing calls take CSS pixels too.
//
// Browsers disagree on what zoom does to getBoundingClientRect(), event
// coordinates and hit testing (Chrome ≥ 128 and Firefox follow the standard, older WebKit
// does not), so each is measured with a probe rather than assumed.

import { clampUiScale, useSettings } from './settings'

let scale = 1
/** Divisors that turn the browser's own numbers into CSS pixels at the current scale. */
let rectDiv = 1
let pointDiv = 1
let hitDiv = 1
let viewDiv = 1
let installed = false

export const uiScale = () => scale

type Getter = (this: unknown) => number

function wrapGetter(proto: object | undefined, prop: string, div: () => number) {
  if (!proto) return
  const d = Object.getOwnPropertyDescriptor(proto, prop)
  if (!d?.get || !d.configurable) return
  const get = d.get as Getter
  Object.defineProperty(proto, prop, {
    ...d,
    get(this: unknown) {
      const k = div()
      const v = get.call(this)
      return k === 1 ? v : v / k
    },
  })
}

const scaledRect = (r: DOMRect, k: number) => (k === 1 ? r : new DOMRect(r.x / k, r.y / k, r.width / k, r.height / k))

function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const W = window as unknown as Record<string, { prototype: object } | undefined>
  for (const name of ['MouseEvent', 'Touch']) {
    const proto = W[name]?.prototype
    for (const p of ['clientX', 'clientY', 'pageX', 'pageY', 'x', 'y']) wrapGetter(proto, p, () => pointDiv)
  }
  for (const p of ['innerWidth', 'innerHeight']) {
    // innerWidth/innerHeight live on the window itself (or its prototype, depending on the browser).
    const owner = Object.getOwnPropertyDescriptor(window, p) ? window : Object.getPrototypeOf(window)
    wrapGetter(owner, p, () => viewDiv)
  }

  for (const proto of [Element.prototype, Range.prototype]) {
    const rect = proto.getBoundingClientRect
    proto.getBoundingClientRect = function (this: Element & Range) {
      return scaledRect(rect.call(this), rectDiv)
    }
    const rects = proto.getClientRects
    proto.getClientRects = function (this: Element & Range) {
      const list = rects.call(this)
      if (rectDiv === 1) return list
      const out = Array.from(list, (r) => scaledRect(r, rectDiv)) as unknown as DOMRectList
      ;(out as unknown as { item: (i: number) => DOMRect | null }).item = (i: number) => out[i] ?? null
      return out
    }
  }

  const D = Document.prototype as unknown as Record<string, ((x: number, y: number) => unknown) | undefined>
  for (const name of ['elementFromPoint', 'elementsFromPoint', 'caretRangeFromPoint', 'caretPositionFromPoint']) {
    const fn = D[name]
    if (typeof fn !== 'function') continue
    D[name] = function (this: Document, x: number, y: number) {
      return fn.call(this, x * hitDiv, y * hitDiv)
    }
  }
}

/** Measure how this browser reports geometry under the current zoom. */
function probe(k: number) {
  if (k === 1) {
    rectDiv = pointDiv = hitDiv = viewDiv = 1
    return
  }
  // innerWidth is always the real viewport; the layout viewport in CSS pixels is that / zoom.
  viewDiv = k
  const el = document.createElement('div')
  el.style.cssText =
    'position:fixed;left:200px;top:200px;width:20px;height:20px;opacity:0;pointer-events:auto;z-index:2147483647;margin:0;padding:0;border:0'
  document.body.appendChild(el)
  try {
    rectDiv = 1
    const w = Element.prototype.getBoundingClientRect.call(el).width
    rectDiv = Math.abs(w - 20 * k) < Math.abs(w - 20) ? k : 1
    // Event coordinates follow the same rule as getBoundingClientRect (both are
    // the standardised part of zoom), but hit testing can differ (Chrome takes
    // screen pixels there), so it is probed on its own.
    // (If neither answers, e.g. a tiny window, assume screen pixels.)
    pointDiv = rectDiv
    hitDiv = 1
    const at = (x: number, y: number) => document.elementFromPoint(x, y) === el
    const c = 210 * k
    hitDiv = at(c, c) ? k : at(210, 210) ? 1 : k
  } finally {
    el.remove()
  }
}

function apply(k: number) {
  if (typeof document === 'undefined') return
  install()
  scale = k
  const root = document.documentElement
  if (k === 1) root.style.removeProperty('zoom')
  else root.style.setProperty('zoom', String(k))
  root.style.setProperty('--k-ui-scale', String(k))
  probe(k)
  // Everything that measured the screen (the Dock, maximised windows, menus) measures again.
  window.dispatchEvent(new Event('resize'))
}

/** Apply the interface size now and whenever it changes in Settings. */
export function startUiScale(): () => void {
  let last = clampUiScale(useSettings.getState().uiScale)
  apply(last)
  return useSettings.subscribe((s) => {
    const k = clampUiScale(s.uiScale)
    if (k !== last) {
      last = k
      apply(k)
    }
  })
}
