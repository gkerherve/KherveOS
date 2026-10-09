// WaveDrom in the browser: loaded on demand, the SVG it makes is cleaned and put in the page, cursors are drawn
// into it, and it can be saved as SVG or PNG. (The WaveJSON itself comes from wave.ts.)

import type { WaveJson } from './wave'

type WaveDromModule = typeof import('wavedrom')

let loading: Promise<WaveDromModule> | null = null

export function loadWaveDrom(): Promise<WaveDromModule> {
  if (!loading) {
    loading = import('wavedrom').then((m) => ((m as unknown as { default?: WaveDromModule }).default && !(m as WaveDromModule).renderAny ? (m as unknown as { default: WaveDromModule }).default : m))
  }
  return loading
}

export interface WaveInfo {
  /** x of the first column's left edge, in the SVG's own units */
  laneX: number
  laneY: number
  /** width of one column */
  colW: number
  columns: number
  /** top and bottom of the lanes */
  top: number
  bottom: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Removes everything that could run code, keeps what WaveDrom draws. */
export function cleanSvg(root: Element) {
  const drop = ['script', 'foreignobject', 'iframe', 'object', 'embed', 'a', 'animate', 'set']
  for (const el of [...root.querySelectorAll('*')]) {
    if (drop.includes(el.localName.toLowerCase())) { el.remove(); continue }
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase()
      if (n.startsWith('on')) el.removeAttribute(attr.name)
      else if ((n === 'href' || n === 'xlink:href') && !attr.value.startsWith('#')) el.removeAttribute(attr.name)
      else if (n === 'style' && /url\s*\(|expression\s*\(|javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  }
}

/** The SVG for a WaveJSON, as a DOM element ready to insert. */
export async function renderWave(json: WaveJson, labels?: string[]): Promise<{ svg: SVGSVGElement; info: WaveInfo }> {
  const wd = await loadWaveDrom()
  const source = { ...json, head: { ...(json.head ?? {}), tick: labels ?? 0 } }
  const text = wd.onml.stringify(wd.renderAny(0, source, wd.waveSkin))
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const el = doc.documentElement
  if (el.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('The timing diagram could not be drawn.')
  cleanSvg(el)
  const svg = document.importNode(el, true) as unknown as SVGSVGElement
  return { svg, info: measure(svg) }
}

function measure(svg: SVGSVGElement): WaveInfo {
  const lanes = svg.querySelector('[id^="lanes_"]')
  const transform = lanes?.getAttribute('transform') ?? ''
  const m = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(transform)
  const laneX = m ? Number(m[1]) : 60
  const laneY = m ? Number(m[2]) : 20
  const g0 = svg.querySelector('[id^="gmark_0_"]')
  const g1 = svg.querySelector('[id^="gmark_1_"]')
  const colW = g0 && g1 ? Number(g1.getAttribute('x1')) - Number(g0.getAttribute('x1')) || 40 : 40
  const marks = svg.querySelectorAll('[id^="gmark_"]')
  const first = marks[0]
  const top = first ? Number(first.getAttribute('y1')) : 0
  const bottom = first ? Number(first.getAttribute('y2')) : 100
  return { laneX, laneY, colW, columns: marks.length, top, bottom }
}

/** Draws cursor lines (with their names) into the lanes group. */
export function drawCursors(svg: SVGSVGElement, info: WaveInfo, cursors: { name: string; column: number }[]) {
  const lanes = svg.querySelector('[id^="lanes_"]')
  if (!lanes) return
  for (const old of lanes.querySelectorAll('.dg-cursor')) old.remove()
  const colors = ['#d9480f', '#1971c2']
  cursors.forEach((c, i) => {
    const x = c.column * info.colW
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('class', 'dg-cursor')
    line.setAttribute('x1', String(x)); line.setAttribute('x2', String(x))
    line.setAttribute('y1', String(info.top - 4)); line.setAttribute('y2', String(info.bottom))
    line.setAttribute('stroke', colors[i % colors.length]); line.setAttribute('stroke-width', '1.5')
    lanes.appendChild(line)
    const label = document.createElementNS(SVG_NS, 'text')
    label.setAttribute('class', 'dg-cursor')
    label.setAttribute('x', String(x + 3)); label.setAttribute('y', String(info.top - 8))
    label.setAttribute('fill', colors[i % colors.length]); label.setAttribute('font-size', '11'); label.setAttribute('font-weight', '700')
    label.textContent = c.name
    lanes.appendChild(label)
  })
}

export const serializeSvg = (svg: SVGSVGElement): string => new XMLSerializer().serializeToString(svg)

/** SVG text → PNG bytes drawn on a canvas. */
export function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('The browser gave no canvas to draw on.')); return }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('The picture could not be made.'))), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The diagram could not be drawn as an image.')) }
    img.src = url
  })
}
