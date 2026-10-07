// Pixels: the raster layer (decode, encode, paint), the bucket fill
// (fill.py: flood the rendered page from the click, then paint the region
// into the raster or trace it into a vector path), the colour picker, and
// "Remove background" for pictures (imageops.py).

import type { Doc, Item, PathCmd, Raster } from './model'
import { colorOf } from './model'
import { base64ToBytes, bytesToBase64, whitePngBase64 } from './png'
import { pictureSvg } from './render'

// ----------------------------------------------------------- flood fill

/** Per-channel tolerance: pixels this close to the clicked colour flood (fill.py). */
export const TOLERANCE = 40

export type Run = [y: number, xl: number, xr: number]

/** Scanline flood from (sx, sy) over RGBA pixels; the inclusive runs it covers. */
export function floodRuns(data: Uint8ClampedArray | Uint8Array, w: number, h: number, sx: number, sy: number, tol = TOLERANCE): Run[] {
  const base = (sy * w + sx) * 4
  const tr = data[base]
  const tg = data[base + 1]
  const tb = data[base + 2]
  const match = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return Math.abs(data[i] - tr) <= tol && Math.abs(data[i + 1] - tg) <= tol && Math.abs(data[i + 2] - tb) <= tol
  }
  const visited = new Uint8Array(w * h)
  const runs: Run[] = []
  const stack: number[] = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    const row = y * w
    if (visited[row + x] || !match(x, y)) continue
    let xl = x
    while (xl > 0 && !visited[row + xl - 1] && match(xl - 1, y)) xl--
    let xr = x
    while (xr < w - 1 && !visited[row + xr + 1] && match(xr + 1, y)) xr++
    for (let xx = xl; xx <= xr; xx++) visited[row + xx] = 1
    runs.push([y, xl, xr])
    for (let xx = xl; xx <= xr; xx++) {
      if (y > 0 && !visited[row - w + xx] && match(xx, y - 1)) stack.push(xx, y - 1)
      if (y < h - 1 && !visited[row + w + xx] && match(xx, y + 1)) stack.push(xx, y + 1)
    }
  }
  return runs
}

/**
 * The outline of the filled runs as closed polygons along pixel edges:
 * outer edges clockwise, holes anticlockwise, collinear points merged.
 */
export function runsToPath(runs: Run[], w: number, h: number): PathCmd[] {
  const mask = new Uint8Array(w * h)
  for (const [y, xl, xr] of runs) mask.fill(1, y * w + xl, y * w + xr + 1)
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1
  // Directed edges with the region on their right (y down), keyed by start vertex.
  const W = w + 1
  const out = new Map<number, number[]>()
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = y0 * W + x0
    const list = out.get(k)
    const v = y1 * W + x1
    if (list) list.push(v)
    else out.set(k, [v])
  }
  for (const [y, xl, xr] of runs) {
    for (let x = xl; x <= xr; x++) {
      if (!on(x, y - 1)) add(x, y, x + 1, y)
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1)
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1)
      if (!on(x - 1, y)) add(x, y + 1, x, y)
    }
  }
  const cmds: PathCmd[] = []
  const dirOf = (a: number, b: number) => [(b % W) - (a % W), Math.floor(b / W) - Math.floor(a / W)]
  for (const startKey of [...out.keys()]) {
    while (out.get(startKey)?.length) {
      const loop: number[] = [startKey]
      let cur = startKey
      let prevDir: number[] | null = null
      for (;;) {
        const list = out.get(cur)
        if (!list || !list.length) break
        // At a pinch point (two edges leave one vertex) keep turning right.
        let pick = 0
        if (list.length > 1 && prevDir) {
          const rightTurn = [-prevDir[1], prevDir[0]]
          const i = list.findIndex((v) => {
            const d = dirOf(cur, v)
            return d[0] === rightTurn[0] && d[1] === rightTurn[1]
          })
          if (i >= 0) pick = i
        }
        const next = list.splice(pick, 1)[0]
        prevDir = dirOf(cur, next)
        cur = next
        if (cur === startKey) break
        loop.push(cur)
      }
      // Drop points in the middle of straight runs.
      const pts = loop.map((k) => [k % W, Math.floor(k / W)])
      const keep = pts.filter((p, i) => {
        const a = pts[(i - 1 + pts.length) % pts.length]
        const b = pts[(i + 1) % pts.length]
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0
      })
      if (keep.length < 3) continue
      cmds.push(['M', keep[0][0], keep[0][1]])
      for (let i = 1; i < keep.length; i++) cmds.push(['L', keep[i][0], keep[i][1]])
      cmds.push(['L', keep[0][0], keep[0][1]])
    }
  }
  return cmds
}

/** Clear the modal border colour flooding in from the edges (imageops.remove_background). */
export function clearBackground(data: Uint8ClampedArray, w: number, h: number, tol = TOLERANCE): boolean {
  if (w < 2 || h < 2) return false
  const counts = new Map<number, number>()
  const key = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
  }
  const count = (x: number, y: number) => {
    const k = key(x, y)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  for (let x = 0; x < w; x++) {
    count(x, 0)
    count(x, h - 1)
  }
  for (let y = 1; y < h - 1; y++) {
    count(0, y)
    count(w - 1, y)
  }
  let best = 0
  let bestN = -1
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n]
  const tr = (best >> 16) & 255
  const tg = (best >> 8) & 255
  const tb = best & 255
  const match = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return Math.abs(data[i] - tr) <= tol && Math.abs(data[i + 1] - tg) <= tol && Math.abs(data[i + 2] - tb) <= tol
  }
  const stack: number[] = []
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (match(x, y)) stack.push(x, y)
  for (let y = 1; y < h - 1; y++) for (const x of [0, w - 1]) if (match(x, y)) stack.push(x, y)
  if (!stack.length) return false
  const visited = new Uint8Array(w * h)
  let cleared = false
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    const row = y * w
    if (visited[row + x] || !match(x, y)) continue
    let xl = x
    while (xl > 0 && !visited[row + xl - 1] && match(xl - 1, y)) xl--
    let xr = x
    while (xr < w - 1 && !visited[row + xr + 1] && match(xr + 1, y)) xr++
    for (let xx = xl; xx <= xr; xx++) {
      visited[row + xx] = 1
      data[(row + xx) * 4 + 3] = 0
    }
    cleared = true
    for (let xx = xl; xx <= xr; xx++) {
      if (y > 0 && !visited[row - w + xx] && match(xx, y - 1)) stack.push(xx, y - 1)
      if (y < h - 1 && !visited[row + w + xx] && match(xx, y + 1)) stack.push(xx, y + 1)
    }
  }
  return cleared
}

// ------------------------------------------------------- browser helpers

export function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: false })!

export const canvasToBlob = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('Could not encode the picture.'))), type, quality))

export async function blobToBase64(b: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await b.arrayBuffer()))
}

const decoded = new WeakMap<Raster, Promise<ImageBitmap | HTMLCanvasElement | null>>()

/** The raster layer as something drawImage takes (null: plain white). */
export function rasterSource(r: Raster): Promise<ImageBitmap | HTMLCanvasElement | null> {
  let p = decoded.get(r)
  if (!p) {
    const src = r.src
    if (!src) p = Promise.resolve(null)
    else if (typeof src === 'string') p = createImageBitmap(new Blob([base64ToBytes(src) as BlobPart], { type: 'image/png' }))
    else if (src instanceof Blob) p = createImageBitmap(src)
    else p = Promise.resolve(src)
    decoded.set(r, p)
  }
  return p
}

/** The raster layer as base64 PNG, for saving (a blank layer is saved white, as the desktop does). */
export async function rasterBase64(r: Raster): Promise<string> {
  const src = r.src
  if (!src) return whitePngBase64(r.w, r.h)
  if (typeof src === 'string') return src
  if (src instanceof Blob) return blobToBase64(src)
  return blobToBase64(await canvasToBlob(src))
}

/** A frozen copy of a canvas (sync), squeezed into a PNG Blob in the background. */
export function freezeRaster(c: HTMLCanvasElement, key: number): Raster {
  const copy = newCanvas(c.width, c.height)
  ctx2d(copy).drawImage(c, 0, 0)
  const r: Raster = { w: c.width, h: c.height, src: copy, key }
  void canvasToBlob(copy).then((b) => {
    if (r.src === copy) r.src = b
  })
  return r
}

/** Draw a round-capped stroke (a dot for a click). `erase` clears to transparent. */
export function strokeLine(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, color: string, width: number, erase = false) {
  ctx.save()
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (a.x === b.x && a.y === b.y) {
    ctx.beginPath()
    ctx.arc(a.x, a.y, width / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.restore()
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => fail(new Error('Could not read the picture.'))
    img.src = url
  })
}

/** Items drawn over a canvas (SVG rendered by the browser). */
export async function drawItems(ctx: CanvasRenderingContext2D, doc: Doc, items: Item[], scale: number) {
  if (!items.length) return
  const svg = pictureSvg(doc, items, { white: false, width: String(doc.width * scale), height: String(doc.height * scale) })
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const img = await loadImage(url)
    ctx.drawImage(img, 0, 0, doc.width * scale, doc.height * scale)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The page as pixels: white, the raster layer, then the items (fill.render_scene_image, exports). */
export async function renderPage(doc: Doc, scale = 1, items: Item[] = doc.items): Promise<HTMLCanvasElement> {
  const c = newCanvas(doc.width * scale, doc.height * scale)
  const ctx = ctx2d(c)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  const raster = await rasterSource(doc.raster)
  ctx.imageSmoothingQuality = 'high'
  if (raster) ctx.drawImage(raster, 0, 0, doc.raster.w * scale, doc.raster.h * scale)
  await drawItems(ctx, doc, items, scale)
  return c
}

/** Paint flood runs into a canvas (raster bucket). */
export function paintRuns(ctx: CanvasRenderingContext2D, runs: Run[], color: string) {
  const c = colorOf(color)
  ctx.save()
  ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${c.a / 255})`
  for (const [y, xl, xr] of runs) ctx.fillRect(xl, y, xr - xl + 1, 1)
  ctx.restore()
}

/** Any picture file as PNG base64 with its size. */
export async function pictureToPng(bytes: Uint8Array, mime = ''): Promise<{ b64: string; w: number; h: number }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], mime ? { type: mime } : {}))
  const c = newCanvas(bmp.width, bmp.height)
  ctx2d(c).drawImage(bmp, 0, 0)
  bmp.close()
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
  return { b64: isPng ? bytesToBase64(bytes) : await blobToBase64(await canvasToBlob(c)), w: c.width, h: c.height }
}

/** Decode a PNG (base64) into a canvas. */
export async function pngToCanvas(b64: string): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(new Blob([base64ToBytes(b64) as BlobPart], { type: 'image/png' }))
  const c = newCanvas(bmp.width, bmp.height)
  ctx2d(c).drawImage(bmp, 0, 0)
  bmp.close()
  return c
}

/** Insert a pHYs chunk so the PNG carries its dpi (export_png sets dots per metre). */
export function withDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33) return png
  const ppm = Math.round(dpi / 0.0254)
  const chunk = new Uint8Array(21)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // pHYs
  dv.setUint32(8, ppm)
  dv.setUint32(12, ppm)
  chunk[16] = 1 // unit: metre
  // CRC over type + data
  let crc = 0xffffffff
  for (let i = 4; i < 17; i++) {
    crc ^= chunk[i]
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  dv.setUint32(17, (crc ^ 0xffffffff) >>> 0)
  const at = 8 + 25 // after the signature and IHDR
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, at))
  out.set(chunk, at)
  out.set(png.subarray(at), at + chunk.length)
  return out
}
