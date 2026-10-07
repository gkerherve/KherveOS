// Pictures in messages: a picture from the drive (paperclip, or dragged in
// from Files) or a screenshot of a window or of the screen (the camera next to
// the paperclip). Each goes to the model as an image it can look at, shrunk to
// at most 1568 px on its longer side (what Claude looks at anyway) and sent as
// PNG or JPEG, which every provider (Ollama included) reads.

import { fs, path as vpath } from '@/os'
import { fitWithin, splitDataUrl } from '@/os/screenshotCore'
import { captureCanvas, flash, saveScreenshot, type ShotTarget } from '@/os/screenshot'
import type { AttachedPicture, Attachment } from './types'

/** The longer side of a picture the model gets, in pixels. */
export const MAX_PICTURE_SIDE = 1568
/** Pictures in one message at most. */
export const MAX_PICTURES = 8
/** Bytes of one picture as sent, at most (base64 grows it by a third; Claude takes up to 5 MB). */
const MAX_PICTURE_BYTES = 3_500_000

const PICTURE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/** Is this file a picture KherveAI can attach (SVG goes as text)? */
export function isPicturePath(p: string): boolean {
  return vpath.extname(p).toLowerCase() in PICTURE_TYPES
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function encode(canvas: HTMLCanvasElement, mime: 'image/png' | 'image/jpeg'): { mime: 'image/png' | 'image/jpeg'; data: string } {
  const parts = splitDataUrl(mime === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png'))
  if (!parts) throw new Error('The picture could not be prepared.')
  return { mime, data: parts.data }
}

/** A picture drawn on a canvas, shrunk to fit, as the model gets it. Screenshots stay PNG (sharp text). */
export function canvasToPicture(source: CanvasImageSource & { width: number; height: number }, prefer: 'image/png' | 'image/jpeg' = 'image/png'): AttachedPicture {
  const fit = fitWithin(source.width, source.height, MAX_PICTURE_SIDE)
  const canvas = document.createElement('canvas')
  canvas.width = fit.w
  canvas.height = fit.h
  const g = canvas.getContext('2d')
  if (!g) throw new Error('The picture could not be prepared.')
  g.imageSmoothingQuality = 'high'
  g.drawImage(source, 0, 0, fit.w, fit.h)
  let out = encode(canvas, prefer)
  // A big PNG (a photo saved as PNG): JPEG says the same in far fewer bytes.
  if (out.mime === 'image/png' && out.data.length * 0.75 > MAX_PICTURE_BYTES) out = encode(canvas, 'image/jpeg')
  return { ...out, width: fit.w, height: fit.h }
}

/** Read a picture from the drive for a message. */
export async function readPicture(path: string): Promise<Attachment> {
  const name = vpath.basename(path)
  const st = fs.stat(path)
  if (!st) throw new Error(`"${name}" doesn't exist any more.`)
  const bytes = await fs.readBytes(path)
  const type = PICTURE_TYPES[vpath.extname(path).toLowerCase()]
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }))
  } catch {
    throw new Error(`"${name}" could not be read as a picture.`)
  }
  try {
    const fits = Math.max(bmp.width, bmp.height) <= MAX_PICTURE_SIDE
    const asIs = fits && (type === 'image/png' || type === 'image/jpeg') && bytes.length <= MAX_PICTURE_BYTES
    const image: AttachedPicture = asIs
      ? { mime: type as 'image/png' | 'image/jpeg', data: toBase64(bytes), width: bmp.width, height: bmp.height }
      : canvasToPicture(bmp, type === 'image/jpeg' || type === 'image/webp' ? 'image/jpeg' : 'image/png')
    return { path, name, size: bytes.length, chars: 0, text: '', truncated: false, image }
  } finally {
    bmp.close()
  }
}

/**
 * Take a screenshot of a window or of the screen for a message: it is saved in
 * ~/Pictures/Screenshots like any screenshot, and that file is attached.
 */
export async function screenshotForMessage(target: ShotTarget): Promise<string> {
  const canvas = await captureCanvas(target)
  flash(target)
  return saveScreenshot(canvas)
}

/** The picture as a data URL (thumbnails). */
export const pictureUrl = (p: AttachedPicture) => `data:${p.mime};base64,${p.data}`
