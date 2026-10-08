// Draws a figure from figures.ts with Plotly. Plotly (4.8 MB) is loaded the first time a chart is shown.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { DEFAULT_PALETTE, type Figure, type Palette } from './figures'

interface PlotlyLike {
  react(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  purge(el: HTMLElement): void
  Plots: { resize(el: HTMLElement): void }
  toImage(el: HTMLElement, opts: { format: string; width: number; height: number; scale: number }): Promise<string>
}

let loading: Promise<PlotlyLike> | null = null
function loadPlotly(): Promise<PlotlyLike> {
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
    text: get('--k-text', DEFAULT_PALETTE.text), muted: get('--k-muted', DEFAULT_PALETTE.muted), border: get('--k-border', DEFAULT_PALETTE.border),
    accent: get('--k-accent', DEFAULT_PALETTE.accent), link: get('--k-link', DEFAULT_PALETTE.link), danger: get('--k-danger', DEFAULT_PALETTE.danger),
    success: get('--k-success', DEFAULT_PALETTE.success), warning: get('--k-warning', DEFAULT_PALETTE.warning), surface: get('--k-surface', DEFAULT_PALETTE.surface),
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

export interface ScopeHandle {
  png(scale?: number): Promise<Uint8Array | null>
}

interface Props {
  figure: Figure | null
  /** a click on the plot: the x value under it */
  onClickX?(x: number): void
}

export const ScopeChart = forwardRef<ScopeHandle, Props>(function ScopeChart({ figure, onClickX }, ref) {
  const host = useRef<HTMLDivElement>(null)
  const plotly = useRef<PlotlyLike | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const click = useRef(onClickX)
  click.current = onClickX

  useEffect(() => {
    let dead = false
    loadPlotly().then(
      (p) => { if (!dead) { plotly.current = p; setState('ready') } },
      () => { if (!dead) setState('error') },
    )
    return () => { dead = true }
  }, [])

  useEffect(() => {
    const el = host.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p || !figure) return
    void p.react(el, figure.data, { ...figure.layout, autosize: true }, { displaylogo: false, responsive: false, displayModeBar: 'hover', modeBarButtonsToRemove: ['lasso2d', 'select2d'] }).then(() => {
      const target = el as HTMLElement & { on?: (ev: string, fn: (d: { points?: { x: number }[]; event?: MouseEvent; xvals?: number[] }) => void) => void; removeAllListeners?: (ev: string) => void }
      target.removeAllListeners?.('plotly_click')
      target.on?.('plotly_click', (d) => {
        const x = d.points?.[0]?.x
        if (typeof x === 'number') click.current?.(x)
      })
    })
  }, [state, figure])

  useEffect(() => {
    const el = host.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p) return
    const ro = new ResizeObserver(() => p.Plots.resize(el))
    ro.observe(el)
    return () => {
      ro.disconnect()
      try { p.purge(el) } catch { /* already gone */ }
    }
  }, [state])

  useImperativeHandle(ref, () => ({
    async png(scale = 2) {
      const el = host.current
      const p = plotly.current
      if (!el || !p) return null
      const url = await p.toImage(el, { format: 'png', width: Math.max(400, el.clientWidth), height: Math.max(240, el.clientHeight), scale })
      const bin = atob(url.split(',')[1])
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    },
  }), [])

  return (
    <div className="ke-chart">
      {state === 'loading' && <div className="ke-chart-note k-muted">Loading the plot…</div>}
      {state === 'error' && <div className="ke-chart-note k-muted">The plot library could not be loaded.</div>}
      {state === 'ready' && !figure && <div className="ke-chart-note k-muted">Nothing to draw yet.</div>}
      <div ref={host} className="ke-chart-plot" style={{ display: state === 'ready' && figure ? 'block' : 'none' }} />
    </div>
  )
})
