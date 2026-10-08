// kPlot's image export (browser only): the SVG engine's figure as a PNG (drawn on a canvas),
// the interactive engine's figure through Plotly.toImage, and the clipboard.

import type { FigureInput } from './figure.ts'
import { toPlotly, plotlySize } from './plotly.ts'
import { loadPlotly } from './PlotlyView'

export type ImageFormat = 'png' | 'svg'

/** The SVG text rendered to a PNG `scale` × the figure's size at 96 dpi. */
export function svgToPng(svg: string, widthPx: number, heightPx: number, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(widthPx * scale))
      canvas.height = Math.max(1, Math.round(heightPx * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('The browser gave no canvas to draw on.')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The SVG could not be drawn.')) }
    img.src = url
  })
}

/** The axis ranges the user zoomed to in the interactive view (by layout key), to be kept in an export. */
export type Ranges = Record<string, [number, number]>

/** The interactive figure as an image, at the figure's own size (the zoom of the view is kept). */
export async function plotlyImage(fig: FigureInput, format: ImageFormat, scale: number, ranges?: Ranges | null): Promise<Blob> {
  const Plotly = await loadPlotly()
  const p = toPlotly(fig)
  const { width, height } = plotlySize(fig)
  const layout = { ...p.layout, width, height, autosize: false } as Record<string, unknown>
  for (const [k, r] of Object.entries(ranges ?? {})) {
    if (layout[k] && typeof layout[k] === 'object') layout[k] = { ...(layout[k] as object), range: r, autorange: false }
  }
  const url = await Plotly.toImage({ data: p.data, layout, config: p.config } as never, { format, width, height, scale })
  return (await fetch(url)).blob()
}

export async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer())
}

export async function copyImage(png: Blob): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('This browser cannot copy pictures to the clipboard.')
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}
