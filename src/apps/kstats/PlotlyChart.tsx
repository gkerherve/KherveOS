// Draws a figure from figures.ts with Plotly. Plotly (4.8 MB) is loaded the first time a chart is shown.

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PALETTE, type Figure, type Palette } from './figures'

interface PlotlyLike {
  react(el: HTMLElement, data: unknown, layout: unknown, config: unknown): Promise<unknown>
  purge(el: HTMLElement): void
  Plots: { resize(el: HTMLElement): void }
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
    text: get('--k-text', DEFAULT_PALETTE.text),
    muted: get('--k-muted', DEFAULT_PALETTE.muted),
    border: get('--k-border', DEFAULT_PALETTE.border),
    accent: get('--k-accent', DEFAULT_PALETTE.accent),
    link: get('--k-link', DEFAULT_PALETTE.link),
    danger: get('--k-danger', DEFAULT_PALETTE.danger),
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

export default function PlotlyChart({ figure, height = 320 }: { figure: Figure | null; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const plotly = useRef<PlotlyLike | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

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
    const el = ref.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p || !figure) return
    void p.react(el, figure.data, { ...figure.layout, autosize: true }, {
      displaylogo: false, responsive: false, displayModeBar: 'hover', modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    })
  }, [state, figure])

  useEffect(() => {
    const el = ref.current
    const p = plotly.current
    if (state !== 'ready' || !el || !p) return
    const ro = new ResizeObserver(() => p.Plots.resize(el))
    ro.observe(el)
    return () => {
      ro.disconnect()
      try { p.purge(el) } catch { /* already gone */ }
    }
  }, [state])

  return (
    <div className="ks-chart" style={{ height }}>
      {state === 'loading' && <div className="ks-chart-note k-muted">Loading the chart…</div>}
      {state === 'error' && <div className="ks-chart-note k-muted">The chart library could not be loaded.</div>}
      {state === 'ready' && !figure && <div className="ks-chart-note k-muted">Nothing to draw yet.</div>}
      <div ref={ref} className="ks-chart-plot" style={{ display: state === 'ready' && figure ? 'block' : 'none' }} />
    </div>
  )
}
