// Pictures for figures: LaTeX (tectonic) takes PNG, JPEG and PDF; anything
// else the browser can draw (SVG, GIF, WebP, BMP…) is turned into a PNG.

const NATIVE = new Set(['png', 'jpg', 'jpeg', 'pdf'])
export const PICTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf', '.svg', '.gif', '.webp', '.bmp', '.tif', '.tiff']

export function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function mimeOf(name: string): string {
  const ext = extOf(name)
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'svg': return 'image/svg+xml'
    case 'pdf': return 'application/pdf'
    case 'tif': case 'tiff': return 'image/tiff'
    case '': return 'application/octet-stream'
    default: return `image/${ext}`
  }
}

/** Can an <img> show this file? */
export function isDisplayable(name: string): boolean {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(extOf(name))
}

/** The picture as a file LaTeX can include: {bytes, ext} with ext like "png". */
export async function toLatexPicture(name: string, bytes: Uint8Array): Promise<{ bytes: Uint8Array; ext: string }> {
  const ext = extOf(name)
  if (NATIVE.has(ext)) return { bytes, ext: ext === 'jpeg' ? 'jpg' : ext }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeOf(name) }))
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    // An SVG without a size draws at 0×0: give it a sensible one.
    const w = img.naturalWidth || 1200
    const h = img.naturalHeight || Math.round(w * 0.75)
    const scale = ext === 'svg' ? Math.max(1, 1600 / w) : 1
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No canvas')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'))
    if (!blob) throw new Error('PNG conversion failed')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' }
  } catch {
    throw new Error(`${name}: this picture can't be read (use PNG, JPEG or PDF).`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The next free "figures/figure_NNN.ext" name, as the desktop names bundled pictures. */
export function nextFigurePath(taken: Iterable<string>, ext: string): string {
  const used = new Set<number>()
  for (const p of taken) {
    const m = /^figures\/figure_(\d+)\./.exec(p)
    if (m) used.add(Number(m[1]))
  }
  let n = 1
  while (used.has(n)) n++
  return `figures/figure_${String(n).padStart(3, '0')}.${ext}`
}
