// PNG and base64 helpers: the raster layer and pictures travel as base64
// PNG inside .kpaint and SVG files, as in the desktop app.

import { zlibSync } from 'fflate'

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(s)
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

/** Width and height from a PNG's IHDR (base64 or bytes), or null. */
export function pngSize(data: string | Uint8Array): { w: number; h: number } | null {
  let head: Uint8Array
  try {
    head = typeof data === 'string' ? base64ToBytes(data.slice(0, 44)) : data.subarray(0, 32)
  } catch {
    return null
  }
  if (head.length < 24 || head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47) return null
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength)
  return { w: dv.getUint32(16), h: dv.getUint32(20) }
}

/** Width and height of a JPEG (SOF marker), or null. */
export function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    const len = (b[i + 2] << 8) | b[i + 3]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] }
    }
    i += 2 + len
  }
  return null
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Encode 8-bit pixels (RGBA, or RGB when `channels` is 3) as a PNG. */
export function encodePng(pixels: Uint8Array | Uint8ClampedArray, w: number, h: number, channels: 3 | 4 = 4): Uint8Array {
  const stride = w * channels
  const raw = new Uint8Array((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = channels === 4 ? 6 : 2
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const whiteCache = new Map<string, string>()

/** A white w × h PNG as base64 (the blank raster layer the desktop always saves). */
export function whitePngBase64(w: number, h: number): string {
  const key = `${w}x${h}`
  let b64 = whiteCache.get(key)
  if (!b64) {
    b64 = bytesToBase64(encodePng(new Uint8Array(w * h * 3).fill(255), w, h, 3))
    if (whiteCache.size > 8) whiteCache.clear()
    whiteCache.set(key, b64)
  }
  return b64
}
