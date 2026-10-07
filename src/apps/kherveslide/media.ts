// Pictures of a presentation in the browser: where a stored path points (the
// drive, absolute or next to the .kslide; or an example's own media until it
// is saved), object URLs for the canvas, and the files of a LaTeX compile —
// formats XeTeX can't read are converted to PNG, and picture effects are baked
// with the canvas (the desktop bakes them with Pillow).

import { useEffect, useState } from 'react'
import { fs, path as P } from '@/os'
import type { Deck, SlidePicture } from './model'
import { PICTURE_EFFECTS } from './model'
import { serializeBackdrop, serializeDeck, TEX_IMAGE_EXTS, suffix, type SerializeOptions } from './serializer'

export const PICTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf']
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
}

type Listener = () => void

/** One window's pictures. */
export class Media {
  /** The folder of the open .kslide (relative paths are read from there). */
  deckDir: string | null = null
  /** Pictures that are not on the drive yet (an example's media/), by stored path. */
  readonly assets = new Map<string, Uint8Array>()
  private urls = new Map<string, string>()
  private listeners = new Set<Listener>()
  private version = 0
  private unwatch: () => void

  constructor() {
    this.unwatch = fs.watch((ev) => {
      const gone = ev.type === 'rename' ? [ev.path, ev.oldPath] : [ev.path]
      let changed = ev.type !== 'change' && ev.type !== 'delete' // a picture that was missing may have appeared
      for (const key of [...this.urls.keys()]) {
        if (gone.some((p) => key === p || key.startsWith(p + '/'))) {
          URL.revokeObjectURL(this.urls.get(key)!)
          this.urls.delete(key)
          changed = true
        }
      }
      if (changed) this.bump()
    })
  }

  dispose() {
    this.unwatch()
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    this.urls.clear()
  }

  private bump() {
    this.version++
    for (const l of this.listeners) l()
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getVersion = () => this.version

  /** The drive file a stored path points to, if it exists. */
  drivePath(stored: string): string | null {
    if (!stored) return null
    const p = stored.replace(/\\/g, '/')
    const candidates = p.startsWith('/') || p.startsWith('~') ? [P.resolve(P.HOME, p)] : this.deckDir ? [P.join(this.deckDir, p)] : []
    for (const c of candidates) if (fs.isFile(c)) return c
    return null
  }

  has(stored: string): boolean {
    return !!this.drivePath(stored) || this.assets.has(stored)
  }

  async bytes(stored: string): Promise<Uint8Array | null> {
    const d = this.drivePath(stored)
    if (d) return fs.readBytes(d)
    return this.assets.get(stored) ?? null
  }

  /** An object URL for the picture, or null when it can't be found. */
  async url(stored: string): Promise<string | null> {
    const key = this.drivePath(stored) ?? (this.assets.has(stored) ? `asset:${stored}` : null)
    if (!key) return null
    const have = this.urls.get(key)
    if (have) return have
    const data = await this.bytes(stored)
    if (!data) return null
    const u = URL.createObjectURL(new Blob([data as BlobPart], { type: MIME[suffix(stored)] ?? 'application/octet-stream' }))
    this.urls.set(key, u)
    return u
  }

  /** Write the example pictures still in memory next to the saved file, so relative paths keep working. */
  async saveAssets(deck: Deck, dir: string): Promise<number> {
    let n = 0
    for (const stored of usedPictures(deck)) {
      if (stored.startsWith('/') || !this.assets.has(stored)) continue
      const target = P.join(dir, stored)
      if (!P.isInside(target, dir) || fs.exists(target)) continue
      await fs.writeBytes(target, this.assets.get(stored)!, { mkdirs: true })
      n++
    }
    return n
  }
}

/** Every picture path a presentation uses (pictures, video posters, the theme logo). */
export function usedPictures(deck: Deck): string[] {
  const out = new Set<string>()
  if (deck.theme_spec.enabled && deck.theme_spec.logo) out.add(deck.theme_spec.logo)
  for (const s of [...deck.slides, deck.master]) {
    for (const o of s.objects) {
      if (o.type === 'SlidePicture' && o.path) out.add(o.path)
      if (o.type === 'SlideVideo' && o.poster) out.add(o.poster)
    }
  }
  return [...out]
}

/** Re-render when a picture of this window changes on the drive. */
export function useImageUrl(media: Media, stored: string): string | null {
  const [state, setState] = useState<{ key: string; url: string | null }>({ key: '', url: null })
  const [version, setVersion] = useState(media.getVersion())
  useEffect(() => media.subscribe(() => setVersion(media.getVersion())), [media])
  useEffect(() => {
    let live = true
    if (!stored) {
      setState({ key: stored, url: null })
      return
    }
    void media.url(stored).then((u) => live && setState({ key: stored, url: u }))
    return () => {
      live = false
    }
  }, [media, stored, version])
  return state.key === stored ? state.url : null
}

// ------------------------------------------------------------------ picture effects

const neutral = Object.fromEntries(PICTURE_EFFECTS.map(([n, , d]) => [n, d])) as Record<string, unknown>

/** Has the picture any PowerPoint-style effect (the desktop's image_effects.has_effects)? */
export function hasEffects(o: SlidePicture): boolean {
  if (!o.path) return false
  for (const [name] of PICTURE_EFFECTS) {
    if (['recolor_color', 'artistic_amount', 'fade_start', 'fade_end', 'glow_color'].includes(name)) continue
    if (name === 'glow_size') {
      if (o.glow_size && o.glow_color) return true
      continue
    }
    if ((o as unknown as Record<string, unknown>)[name] !== neutral[name]) return true
  }
  return false
}

/** The colour / correction effects as a CSS filter (canvas display and baking). `px` = pixels per box height, for blurs. */
export function effectFilter(o: SlidePicture, px = 300): string {
  const f: string[] = []
  if (o.brightness) f.push(`brightness(${(1 + o.brightness).toFixed(3)})`)
  if (o.contrast) f.push(`contrast(${(1 + o.contrast).toFixed(3)})`)
  if (o.saturation !== 1) f.push(`saturate(${o.saturation.toFixed(3)})`)
  if (o.temperature > 0) f.push(`sepia(${(0.45 * o.temperature).toFixed(3)})`)
  if (o.temperature < 0) f.push(`hue-rotate(${(-25 * o.temperature).toFixed(1)}deg) saturate(${(1 - 0.2 * o.temperature).toFixed(3)})`)
  switch (o.recolor) {
    case 'grayscale':
    case 'duotone':
      f.push('grayscale(1)')
      break
    case 'sepia':
      f.push('sepia(1)')
      break
    case 'washout':
      f.push('contrast(0.45) brightness(1.45)')
      break
    case 'bw':
      f.push('grayscale(1) contrast(12)')
      break
  }
  if (o.artistic === 'blur') f.push(`blur(${(o.artistic_amount * 0.02 * px).toFixed(2)}px)`)
  if (o.artistic === 'posterize') f.push('contrast(1.6) saturate(1.4)')
  if (o.sharpness > 0) f.push(`contrast(${(1 + 0.15 * o.sharpness).toFixed(3)})`)
  if (o.sharpness < 0) f.push(`blur(${(-o.sharpness * 0.006 * px).toFixed(2)}px)`)
  return f.join(' ')
}

async function decode(data: Uint8Array, ext: string): Promise<CanvasImageSource & { width: number; height: number }> {
  const blob = new Blob([data as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' })
  if (ext === '.svg') {
    const url = URL.createObjectURL(blob)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      return img
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  return createImageBitmap(blob)
}

async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  if (!blob) throw new Error('The picture could not be converted.')
  return new Uint8Array(await blob.arrayBuffer())
}

/** A picture XeTeX can't include (GIF, WebP, SVG…) as PNG. */
async function toPng(data: Uint8Array, ext: string): Promise<Uint8Array> {
  const img = await decode(data, ext)
  const c = document.createElement('canvas')
  const scale = ext === '.svg' ? 3 : 1
  c.width = Math.max(1, Math.round(img.width * scale))
  c.height = Math.max(1, Math.round(img.height * scale))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return canvasPng(c)
}

/** The cropped picture with its effects, as PNG (glow and reflection are not baked: no padding). */
async function bake(o: SlidePicture, data: Uint8Array): Promise<Uint8Array> {
  const ext = suffix(o.path)
  if (ext === '.pdf' || ext === '.eps') return data
  const img = await decode(data, ext)
  const cl = Math.max(0, Math.min(0.9, o.crop_l))
  const ct = Math.max(0, Math.min(0.9, o.crop_t))
  const cr = Math.max(0, Math.min(0.9, o.crop_r))
  const cb = Math.max(0, Math.min(0.9, o.crop_b))
  const sx = cl * img.width
  const sy = ct * img.height
  const sw = Math.max(1, (1 - cl - cr) * img.width)
  const sh = Math.max(1, (1 - ct - cb) * img.height)
  const c = document.createElement('canvas')
  c.width = Math.round(sw)
  c.height = Math.round(sh)
  const ctx = c.getContext('2d')!
  if (o.mask === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(c.width / 2, c.height / 2, c.width / 2, c.height / 2, 0, 0, Math.PI * 2)
    ctx.clip()
  } else if (o.mask === 'rounded') {
    ctx.beginPath()
    ctx.roundRect(0, 0, c.width, c.height, Math.min(c.width, c.height) * 0.12)
    ctx.clip()
  }
  ctx.filter = effectFilter(o, c.height) || 'none'
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height)
  if (o.fade) {
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'destination-in'
    const s = Math.max(0, Math.min(1, o.fade_start))
    const e = Math.max(s + 0.001, Math.min(1, o.fade_end))
    let g: CanvasGradient
    if (o.fade === 'radial') g = ctx.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, Math.hypot(c.width, c.height) / 2)
    else {
      const [x0, y0, x1, y1] = { left: [0, 0, c.width, 0], right: [c.width, 0, 0, 0], top: [0, 0, 0, c.height], bottom: [0, c.height, 0, 0] }[o.fade] ?? [0, 0, c.width, 0]
      g = ctx.createLinearGradient(x0, y0, x1, y1)
    }
    if (o.fade === 'radial') {
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(1 - e, 'rgba(0,0,0,1)')
      g.addColorStop(Math.min(1, 1 - s), 'rgba(0,0,0,0)')
    } else {
      g.addColorStop(s, 'rgba(0,0,0,0)')
      g.addColorStop(e, 'rgba(0,0,0,1)')
    }
    ctx.fillStyle = g
    ctx.fillRect(0, 0, c.width, c.height)
  }
  return canvasPng(c)
}

// ------------------------------------------------------------------ compile bundles

export interface Bundle {
  tex: string
  files: Record<string, string | Uint8Array>
  /** Pictures that could not be found (shown as empty frames in the PDF). */
  missing: string[]
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'picture'

async function bundle(deck: Deck, media: Media, backdrop: boolean): Promise<Bundle> {
  const files: Record<string, string | Uint8Array> = {}
  const names = new Map<string, string>()
  const baked = new Map<SlidePicture, string>()
  const missing: string[] = []
  let n = 0
  for (const stored of usedPictures(deck)) {
    const data = await media.bytes(stored).catch(() => null)
    if (!data) {
      missing.push(stored)
      continue
    }
    const ext = suffix(stored)
    const stem = safeName(P.basename(stored.replace(/\\/g, '/')).replace(/\.[^.]*$/, ''))
    n++
    try {
      if (TEX_IMAGE_EXTS.has(ext)) {
        const name = `img/${n}-${stem}${ext}`
        files[name] = data
        names.set(stored, name)
      } else if (PICTURE_EXTENSIONS.includes(ext)) {
        const name = `img/${n}-${stem}.png`
        files[name] = await toPng(data, ext)
        names.set(stored, name)
      } else missing.push(stored)
    } catch {
      missing.push(stored)
    }
  }
  if (!backdrop) {
    for (const s of [...deck.slides, deck.master]) {
      for (const o of s.objects) {
        if (o.type !== 'SlidePicture' || !hasEffects(o) || !names.has(o.path)) continue
        const data = await media.bytes(o.path)
        if (!data) continue
        try {
          const name = `img/fx${baked.size + 1}-${safeName(P.basename(o.path)).replace(/\.[^.]*$/, '')}.png`
          files[name] = await bake(o, data)
          baked.set(o, name)
        } catch {
          /* keep the plain picture */
        }
      }
    }
  }
  const options: SerializeOptions = {
    // A missing picture becomes an empty frame (no path), as on the desktop for a format TeX can't read.
    imagePath: (p) => names.get(p) ?? '',
    baked: (o) => (baked.has(o) ? { path: baked.get(o)!, pad: [0, 0, 0, 0] } : null),
  }
  const tex = backdrop ? serializeBackdrop(deck, options) : serializeDeck(deck, options)
  files['presentation.tex'] = tex
  return { tex, files, missing }
}

/** The presentation's LaTeX and every file it needs, ready for compileLatex('presentation.tex', files). */
export function compileBundle(deck: Deck, media: Media): Promise<Bundle> {
  return bundle(deck, media, false)
}

/** The theme backdrop (every slide without its own objects), for the exact canvas. */
export function backdropBundle(deck: Deck, media: Media): Promise<Bundle> {
  return bundle({ ...deck, slides: deck.slides.map((s) => ({ ...s, objects: [] })) }, media, true)
}

/** Pick a picture on the drive. */
export function isPicture(p: string): boolean {
  return PICTURE_EXTENSIONS.includes(P.extname(p))
}
