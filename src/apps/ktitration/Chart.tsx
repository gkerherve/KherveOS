// Draws a figure from figures.ts with Plotly. Plotly (4.8 MB) is loaded the first time a chart is shown, never
// at module level. The component also renders a figure off-screen for export (PNG or SVG, on a white page).

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { DEFAULT_PALETTE, opaque, type Figure, type Palette } from './figures'

interface PlotlyLike {
  react(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  newPlot(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  purge(el: HTMLElement): void
  toImage(el: HTMLElement, opts: { format: 'png' | 'svg'; width: number; height: number; scale?: number }): Promise<string>
  Plots: { resize(el: HTMLElement): void }
}

let loading: Promise<PlotlyLike> | null = null
export function loadPlotly(): Promise<PlotlyLike> {
  loading ??= import('plotly.js-dist-min').then((m) => {
    const mod = m as unknown as { default?: PlotlyLike } & PlotlyLike
    return mod.default ?? mod
  })
  return loading
}

/** The theme colours as "rgb(...)" strings (the browser resolves the CSS variables). */
function readPalette(): Palette {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const get = (v: string, fallback: string) => {
    probe.style.color = ''
    probe.style.color = `var(${v})`
    return getComputedStyle(probe).color || fallback
  }
  const pal: Palette = {
    text: get('--k-text', DEFAULT_PALETTE.text),
    muted: get('--k-muted', DEFAULT_PALETTE.muted),
    border: get('--k-border', DEFAULT_PALETTE.border),
    accent: get('--k-accent', DEFAULT_PALETTE.accent),
    link: get('--k-link', DEFAULT_PALETTE.link),
    danger: get('--k-danger', DEFAULT_PALETTE.danger),
    success: get('--k-success', DEFAULT_PALETTE.success),
    warning: get('--k-warning', DEFAULT_PALETTE.warning),
    surface: get('--k-surface', DEFAULT_PALETTE.surface),
  }
  probe.remove()
  return pal
}

/** The theme's colours, read again when the theme changes. */
export function usePalette(): Palette {
  const [pal, setPal] = useState<Palette>(DEFAULT_PALETTE)
  useEffect(() => {
    const update = () => {
      const next = readPalette()
      setPal((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    update()
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true })
    obs.observe(document.body, { attributes: true })
    return () => obs.disconnect()
  }, [])
  return pal
}

export interface ChartHandle {
  /** Renders the figure on a white page and returns the picture: PNG as bytes, SVG as text. */
  image(fig: Figure, format: 'png' | 'svg', width?: number, height?: number): Promise<Uint8Array | string>
}

/** Renders a figure off-screen with Plotly (used by the export menus, also when no chart is on screen). */
export async function renderImage(fig: Figure, format: 'png' | 'svg', width = 1100, height = 680): Promise<Uint8Array | string> {
  const p = await loadPlotly()
  const div = document.createElement('div')
  div.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px`
  document.body.appendChild(div)
  try {
    const o = opaque(fig)
    await p.newPlot(div, o.data, { ...o.layout, width, height, autosize: false, margin: { l: 70, r: 30, t: 30, b: 70 } }, { staticPlot: true, displayModeBar: false })
    const url = await p.toImage(div, { format, width, height, scale: format === 'png' ? 2 : 1 })
    const comma = url.indexOf(',')
    const body = url.slice(comma + 1)
    if (format === 'svg') return /;base64/.test(url.slice(0, comma)) ? atob(body) : decodeURIComponent(body)
    const bin = atob(body)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } finally {
    try { p.purge(div) } catch { /* already gone */ }
    div.remove()
  }
}

export const Chart = forwardRef<ChartHandle, { figure: Figure | null; empty?: string; label?: string }>(function Chart({ figure, empty, label }, ref) {
  const el = useRef<HTMLDivElement>(null)
  const plotly = useRef<PlotlyLike | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useImperativeHandle(ref, () => ({ image: (fig, format, w, h) => renderImage(fig, format, w, h) }), [])

  useEffect(() => {
    let dead = false
    loadPlotly().then(
      (p) => {
        if (dead) return
        plotly.current = p
        setState('ready')
      },
      () => !dead && setState('error'),
    )
    return () => { dead = true }
  }, [])

  useEffect(() => {
    const node = el.current
    const p = plotly.current
    if (state !== 'ready' || !node || !p || !figure) return
    void p.react(node, figure.data, { ...figure.layout, autosize: true }, {
      displaylogo: false, responsive: false, displayModeBar: 'hover', modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toImage'],
    })
  }, [state, figure])

  useEffect(() => {
    const node = el.current
    const p = plotly.current
    if (state !== 'ready' || !node || !p) return
    const ro = new ResizeObserver(() => {
      if (node.clientWidth > 0 && node.clientHeight > 0) p.Plots.resize(node)
    })
    ro.observe(node)
    return () => {
      ro.disconnect()
      try { p.purge(node) } catch { /* already gone */ }
    }
  }, [state])

  return (
    <div className="ti-chart" role="img" aria-label={label ?? 'Chart'}>
      {state === 'loading' && <div className="ti-chart-note">Loading the chart…</div>}
      {state === 'error' && <div className="ti-chart-note">The chart library could not be loaded.</div>}
      {state === 'ready' && !figure && <div className="ti-chart-note">{empty ?? 'Nothing to draw yet.'}</div>}
      <div ref={el} className="ti-chart-plot" style={{ display: state === 'ready' && figure ? 'block' : 'none' }} />
    </div>
  )
})
