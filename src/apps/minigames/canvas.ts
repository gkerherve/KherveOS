// Sizing a game's canvas: a fixed logical resolution, letterboxed into
// whatever room the window gives (so the game keeps its shape when the window
// is resized), and drawn at the screen's real pixel density so it stays crisp.

import { useLayoutEffect, useRef, type RefObject } from 'react'

/** The largest size with the game's aspect ratio that fits in the room available. */
export function fitSize(availW: number, availH: number, w: number, h: number): { cssW: number; cssH: number } {
  const s = Math.max(0.05, Math.min(availW / w, availH / h))
  return { cssW: Math.max(1, Math.floor(w * s)), cssH: Math.max(1, Math.floor(h * s)) }
}

export interface View {
  /** Device pixels per logical unit, across and down. */
  sx: number
  sy: number
}

/**
 * Keeps `canvas` (inside `screen`, inside `stage`) fitted: refits when the
 * stage changes size and when the pixel density changes (browser zoom, or the
 * window moving to another monitor).
 */
export function useFitCanvas(
  stageRef: RefObject<HTMLElement | null>,
  screenRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  w: number,
  h: number,
): RefObject<View> {
  const view = useRef<View>({ sx: 1, sy: 1 })

  useLayoutEffect(() => {
    const stage = stageRef.current
    const screen = screenRef.current
    const canvas = canvasRef.current
    if (!stage || !screen || !canvas) return
    let media: MediaQueryList | null = null

    function fit() {
      if (!stage || !screen || !canvas) return
      const cs = getComputedStyle(stage)
      const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      if (availW <= 0 || availH <= 0) return // minimised: keep the last size
      const { cssW, cssH } = fitSize(availW, availH, w, h)
      const dpr = window.devicePixelRatio || 1
      screen.style.width = `${cssW}px`
      screen.style.height = `${cssH}px`
      const pw = Math.max(1, Math.round(cssW * dpr))
      const ph = Math.max(1, Math.round(cssH * dpr))
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
      }
      view.current = { sx: pw / w, sy: ph / h }
    }

    function onDensity() {
      fit()
      watchDensity()
    }

    // A media query on the current density fires once it changes; then watch the new one.
    function watchDensity() {
      media?.removeEventListener('change', onDensity)
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      media.addEventListener('change', onDensity)
    }

    const ro = new ResizeObserver(fit)
    ro.observe(stage)
    fit()
    watchDensity()
    return () => {
      ro.disconnect()
      media?.removeEventListener('change', onDensity)
    }
  }, [stageRef, screenRef, canvasRef, w, h])

  return view
}
