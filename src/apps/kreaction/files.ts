// Picture files: an SVG drawn to a PNG with a canvas, and the bytes of a data URL. Browser-only helpers.

import { svgSize } from './svgtheme'

/** Bytes of a `data:...;base64,...` URL. */
export function dataUrlToBytes(url: string): Uint8Array {
  const i = url.indexOf(',')
  const body = url.slice(i + 1)
  if (url.slice(0, i).includes(';base64')) {
    const bin = atob(body)
    const out = new Uint8Array(bin.length)
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k)
    return out
  }
  return new TextEncoder().encode(decodeURIComponent(body))
}

/** Draws an SVG (with a viewBox) on a white canvas and returns the PNG bytes. */
export function svgToPng(svg: string, scale = 2): Promise<Uint8Array> {
  const { w, h } = svgSize(svg)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('No canvas available.'))
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Could not make the PNG.'))
          blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject)
        },
        'image/png',
      )
    }
    img.onerror = () => reject(new Error('The picture could not be rendered.'))
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
  })
}
