// The interactive view: Plotly, loaded lazily (it is 4.8 MB, so never at module level) and kept
// in step with the figure. Plotly's own mode bar gives zoom, pan, hover and reset.

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { PlotlyFigure } from './plotly'
import type { Ranges } from './exporters'

type PlotlyApi = typeof import('plotly.js-dist-min').default

let loading: Promise<PlotlyApi> | null = null

/** Load Plotly once (a failed load is tried again next time). */
export function loadPlotly(): Promise<PlotlyApi> {
  if (!loading) {
    loading = import('plotly.js-dist-min').then((m) => m.default).catch((e) => {
      loading = null
      throw e
    })
  }
  return loading
}

export interface PlotlyHandle {
  /** The axis ranges the user has zoomed or panned to (null when nothing was changed). */
  ranges(): Ranges | null
  /** Back to the automatic ranges. */
  reset(): void
}

interface Props {
  figure: PlotlyFigure
  /** Pixels. */
  width: number
  height: number
  onFail(message: string): void
  ref?: Ref<PlotlyHandle>
}

export default function PlotlyView({ figure, width, height, onFail, ref }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const api = useRef<PlotlyApi | null>(null)
  const drawn = useRef(false)
  const [ready, setReady] = useState(false)
  const failRef = useRef(onFail)
  failRef.current = onFail

  useImperativeHandle(ref, () => ({
    ranges() {
      const gd = box.current as unknown as { layout?: Record<string, { range?: [number, number]; autorange?: unknown }> } | null
      if (!gd?.layout) return null
      const out: Ranges = {}
      for (const k of ['xaxis', 'yaxis', 'yaxis2']) {
        const a = gd.layout[k]
        if (a && Array.isArray(a.range) && a.autorange === false) out[k] = [a.range[0], a.range[1]]
      }
      return Object.keys(out).length ? out : null
    },
    reset() {
      const el = box.current
      if (!el || !api.current) return
      void api.current.relayout(el, { 'xaxis.autorange': true, 'yaxis.autorange': true, 'yaxis2.autorange': true } as never)
    },
  }), [])

  useEffect(() => {
    let alive = true
    loadPlotly().then((P) => {
      if (!alive) return
      api.current = P
      setReady(true)
    }).catch((e: unknown) => failRef.current(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
      const el = box.current
      if (el && api.current && drawn.current) api.current.purge(el)
      drawn.current = false
    }
  }, [])

  useEffect(() => {
    const el = box.current
    const P = api.current
    if (!ready || !el || !P) return
    const layout = { ...figure.layout, width, height, autosize: false }
    void P.react(el, figure.data as never, layout as never, figure.config as never)
      .then(() => { drawn.current = true })
      .catch((e: unknown) => failRef.current(e instanceof Error ? e.message : String(e)))
  }, [ready, figure, width, height])

  return (
    <div className="kp-plotly" style={{ width, height }}>
      {!ready && <div className="kp-loading k-muted">Loading the interactive plot…</div>}
      <div ref={box} style={{ width, height }} />
    </div>
  )
}
