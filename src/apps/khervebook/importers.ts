// Files dropped on (or inserted into) a notebook become cells, as in the
// desktop's notebook.open_file_in_cell / importers.py:
//
//   .py → code, .md → markdown, .tex → latex, .csv/.tsv/.txt/.dat → sheet,
//   .svg → svg, images → a self-contained svg cell (bytes embedded),
//   .ipynb → its cells, .kbook → opens the notebook, .pdf → one svg cell per
//   page, .xlsx/.xlsm → one multi-sheet sheet cell, .kfit → a KFit cell,
//   .ktexz/.kdocz → a KherveTeX document cell, .kmol → a Molecule cell.

import { unzipSync } from 'fflate'
import { os } from '@/os'
import { basename, extname } from '@/os/path'
import { openPdf } from '@/os/services/pdf'
import { parseNotebook, type CellData, type CellType } from './format'
import { parseWorkbook, ref, serializeWorkbook, type SheetData } from './sheet'
import { bytesToB64, kfitSource, ktexSource, molSource } from './cellfiles'

export type DropKind = CellType | 'image' | 'kbook' | 'ipynb' | 'pdf' | 'xlsx' | 'ktexdoc' | 'kmol'

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
  '.pdf': 'pdf',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
  '.kfit': 'kfit',
  '.ktexz': 'ktexdoc',
  '.kdocz': 'ktexdoc',
  '.kmol': 'kmol',
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

/** desktop importers.pdf_to_cells: every page rendered at 150 dpi into its own SVG cell. */
async function pdfToCells(bytes: Uint8Array): Promise<CellData[]> {
  const doc = await openPdf(bytes)
  try {
    const out: CellData[] = []
    for (let i = 0; i < doc.pageCount; i++) {
      const bmp = await doc.renderPage(i, 150 / 72)
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      canvas.getContext('2d')?.drawImage(bmp, 0, 0)
      bmp.close()
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob) continue
      out.push({ type: 'svg', source: await imageToSvg(new Uint8Array(await blob.arrayBuffer()), 'image/png') })
    }
    return out
  } finally {
    doc.close()
  }
}

const XLSX_MAX_ROWS = 2000
const XLSX_MAX_COLS = 100

/** desktop importers.xlsx_to_cells: the workbook as ONE multi-sheet sheet cell (values as saved; a formula without a saved value keeps its text). */
export function xlsxToWorkbook(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const text = (name: string) => (files[name] ? new TextDecoder().decode(files[name]) : '')
  const xml = (name: string) => new DOMParser().parseFromString(text(name), 'application/xml')
  const shared = [...xml('xl/sharedStrings.xml').getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent ?? '').join(''))
  const rels = new Map([...xml('xl/_rels/workbook.xml.rels').getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']))
  const wb = xml('xl/workbook.xml')
  const sheets: SheetData[] = []
  for (const sh of [...wb.getElementsByTagName('sheet')]) {
    const name = sh.getAttribute('name') ?? `Sheet${sheets.length + 1}`
    const rid = sh.getAttribute('r:id') ?? sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? ''
    let target = rels.get(rid) ?? ''
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const doc = xml(target)
    const data: Record<string, string> = {}
    let maxR = -1
    let maxC = -1
    for (const c of [...doc.getElementsByTagName('c')]) {
      const a1 = c.getAttribute('r') ?? ''
      const m = /^([A-Z]+)(\d+)$/.exec(a1)
      if (!m) continue
      let col = 0
      for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
      const r = Number(m[2]) - 1
      const cc = col - 1
      if (r >= XLSX_MAX_ROWS || cc >= XLSX_MAX_COLS) continue
      const t = c.getAttribute('t')
      const v = c.getElementsByTagName('v')[0]?.textContent ?? null
      const f = c.getElementsByTagName('f')[0]?.textContent ?? null
      let raw: string
      if (t === 's' && v !== null) raw = shared[Number(v)] ?? ''
      else if (t === 'inlineStr') raw = [...c.getElementsByTagName('t')].map((x) => x.textContent ?? '').join('')
      else if (t === 'b' && v !== null) raw = v === '1' ? 'TRUE' : 'FALSE'
      else if (v !== null) raw = v
      else if (f) raw = `'=${f}`
      else continue
      if (raw.startsWith('=')) raw = '=' + JSON.stringify(raw) // data that would read as a formula
      if (!raw) continue
      data[ref(r, cc)] = raw
      maxR = Math.max(maxR, r)
      maxC = Math.max(maxC, cc)
    }
    sheets.push({ name, rows: Math.max(maxR + 1, 1), cols: Math.max(maxC + 1, 1), data })
  }
  if (!sheets.length) throw new Error('The workbook has no sheets.')
  return serializeWorkbook({ sheets, active: sheets[0].name, plots: [] })
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
  if (kind === 'pdf') return pdfToCells(await os.fs.readBytes(path))
  if (kind === 'xlsx') return [{ type: 'sheet', source: xlsxToWorkbook(await os.fs.readBytes(path)) }]
  if (kind === 'kfit' || kind === 'ktexdoc') {
    // Binary and often megabytes: the cell holds the file itself (saved into "<notebook>_files").
    const bytes = await os.fs.readBytes(path)
    const file = { name: basename(path), size: bytes.length, embed: bytesToB64(bytes) }
    return kind === 'kfit'
      ? [{ type: 'kfit', source: kfitSource({ file, sheet: '', view: 'plot', origin: path }) }]
      : [{ type: 'ktex', source: ktexSource({ file, origin: path, page: 0 }) }]
  }
  if (kind === 'kmol') {
    const kmol = JSON.parse(await os.fs.readText(path)) as Record<string, never>
    return [{ type: 'mol', source: molSource({ kmol, view: '3d', query: '' }) }]
  }
  if (size > MAX_TEXT) throw new Error(`${basename(path)} is too large to put in a cell (${Math.round(size / 1e6)} MB).`)
  const text = await os.fs.readText(path)
  if (kind === 'ipynb') return parseNotebook(text).cells
  if (kind === 'sheet') return [{ type: 'sheet', source: serializeWorkbook(parseWorkbook(text)) }]
  return [{ type: kind, source: text }]
}
