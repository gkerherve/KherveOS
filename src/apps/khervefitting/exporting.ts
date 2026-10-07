// File > Export and the plot's Export menu: the plot as SVG or PNG, and the
// current core level's curves as text (TXT / CSV / DAT), written to the drive.

import { os } from '@/os'
import { HOME } from '@/os/path'
import { peaksOf, type View } from './model'

function plotSvg(root: HTMLElement | null): string | null {
  const svg = root?.querySelector('.kf-plot svg')
  if (!svg) return null
  const text = new XMLSerializer().serializeToString(svg)
  return text.includes('xmlns=') ? text : text.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
}

const dir = (_view: View | null) => `${HOME}/Documents/KherveFitting`
const stem = (view: View | null) => (view?.sheet || 'plot').replace(/[^\w.-]+/g, '_')

export async function exportPlotSvg(root: HTMLElement | null, view: View | null) {
  const svg = plotSvg(root)
  if (!svg) return
  const path = await os.dialog.saveFile({ title: 'Export plot as SVG', defaultName: `${dir(view)}/${stem(view)}.svg`, extensions: ['.svg'] })
  if (path) await os.fs.writeText(path, svg, { mkdirs: true })
}

export async function exportPlotPng(root: HTMLElement | null, view: View | null, scale = 2) {
  const svg = plotSvg(root)
  const el = root?.querySelector('.kf-plot svg') as SVGSVGElement | null
  if (!svg || !el) return
  const path = await os.dialog.saveFile({ title: 'Export plot as PNG', defaultName: `${dir(view)}/${stem(view)}.png`, extensions: ['.png'] })
  if (!path) return
  const w = el.width.baseVal.value
  const h = el.height.baseVal.value
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('The plot could not be drawn.'))
    img.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  URL.revokeObjectURL(url)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (blob) await os.fs.writeBytes(path, new Uint8Array(await blob.arrayBuffer()), { mkdirs: true })
}

/** The curves of the core level: BE, raw data, background, envelope, residuals, each peak. */
export function curvesTable(view: View, sep: string): string {
  const xs = view.x ?? []
  const peaks = peaksOf(view.grid)
  const cols: [string, (number | null)[] | null | undefined][] = [
    ['B.E. (eV)', xs],
    ['Raw Data', view.y],
    ['Background', view.bkg],
    ['Envelope', view.envelope],
    ['Residuals', view.residuals],
    ...(view.peaks ?? []).map((c, i): [string, (number | null)[] | null] => [peaks[i]?.label || `Peak ${i + 1}`, c]),
  ]
  const used = cols.filter(([, c]) => c && c.length)
  const lines = [used.map(([n]) => n).join(sep)]
  for (let i = 0; i < xs.length; i++) lines.push(used.map(([, c]) => (c![i] === null || c![i] === undefined ? '' : String(c![i]))).join(sep))
  return lines.join('\n') + '\n'
}

export async function exportData(view: View | null, fmt: 'txt' | 'csv' | 'dat') {
  if (!view?.x?.length) return
  const path = await os.dialog.saveFile({ title: `Export data as ${fmt.toUpperCase()}`, defaultName: `${dir(view)}/${stem(view)}.${fmt}`, extensions: [`.${fmt}`] })
  if (path) await os.fs.writeText(path, curvesTable(view, fmt === 'csv' ? ',' : '\t'), { mkdirs: true })
}
