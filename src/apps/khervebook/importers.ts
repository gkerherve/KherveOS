// Files dropped on (or inserted into) a notebook become cells, as in the
// desktop's notebook.open_file_in_cell / importers.py:
//
//   .py → code, .md → markdown, .tex → latex, .csv/.tsv/.txt/.dat → sheet,
//   .svg → svg, images → a self-contained svg cell (bytes embedded),
//   .ipynb → its cells, .kbook → opens the notebook.

import { os } from '@/os'
import { basename, extname } from '@/os/path'
import { parseNotebook, type CellData, type CellType } from './format'
import { parseWorkbook, serializeWorkbook } from './sheet'

export type DropKind = CellType | 'image' | 'kbook' | 'ipynb'

const DROP_TYPES: Record<string, DropKind> = {
  '.py': 'code',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.tex': 'latex',
  '.csv': 'sheet',
  '.tsv': 'sheet',
  '.txt': 'sheet',
  '.dat': 'sheet',
  '.svg': 'svg',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.webp': 'image',
  '.kbook': 'kbook',
  '.ipynb': 'ipynb',
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
}

/** Text files bigger than this are not pulled into a cell (desktop: 2 MB). */
const MAX_TEXT = 2_000_000
const MAX_IMAGE = 12_000_000

export function dropKind(path: string): DropKind | null {
  return DROP_TYPES[extname(path)] ?? null
}

function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function imageSize(blob: Blob): Promise<{ w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(blob)
    const size = { w: bmp.width || 400, h: bmp.height || 300 }
    bmp.close()
    return size
  } catch {
    return { w: 400, h: 300 }
  }
}

/** A raster image wrapped in an SVG with its bytes embedded (desktop image_to_svg). */
export async function imageToSvg(bytes: Uint8Array, mime: string): Promise<string> {
  const { w, h } = await imageSize(new Blob([bytes as BlobPart], { type: mime }))
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    `width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<image width="${w}" height="${h}" xlink:href="data:${mime};base64,${base64(bytes)}"/></svg>`
  )
}

/** The cells a drive file becomes (null: not something a notebook takes; 'kbook': open it). */
export async function fileToCells(path: string): Promise<CellData[] | 'kbook' | null> {
  const kind = dropKind(path)
  if (!kind || !os.fs.isFile(path)) return null
  if (kind === 'kbook') return 'kbook'
  const size = os.fs.stat(path)?.size ?? 0
  if (kind === 'image') {
    if (size > MAX_IMAGE) throw new Error(`${basename(path)} is too large to embed (${Math.round(size / 1e6)} MB).`)
    return [{ type: 'svg', source: await imageToSvg(await os.fs.readBytes(path), IMAGE_MIME[extname(path)] ?? 'image/png') }]
  }
  if (size > MAX_TEXT) throw new Error(`${basename(path)} is too large to put in a cell (${Math.round(size / 1e6)} MB).`)
  const text = await os.fs.readText(path)
  if (kind === 'ipynb') return parseNotebook(text).cells
  if (kind === 'sheet') return [{ type: 'sheet', source: serializeWorkbook(parseWorkbook(text)) }]
  return [{ type: kind, source: text }]
}
