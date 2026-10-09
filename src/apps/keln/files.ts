// Browser-side helpers for kELN: sanitised HTML and KaTeX, attachments (hash, mime, embed), SVG → PNG, the PDF build
// and the print sheet. Everything pure lives in the other files; this one touches the DOM and the drive.

import DOMPurify from 'dompurify'
import katex from 'katex'
import { fs, path as osPath } from '@/os'
import { bytesToBase64, sha256File } from './hash'
import type { Attachment, Entry, Notebook } from './model'
import { entryToDocument, notebookToDocument, renderCtx } from './render'
import { htmlToPdfInWorker } from './pdf'

/** The largest file that can travel inside the notebook. */
export const MAX_EMBED = 1_000_000

/** HTML that may contain markup we did not write (KaTeX output, SVG drawings, addenda): always through DOMPurify. */
export function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true, svgFilters: false, mathMl: true } })
}

/** LaTeX → sanitised HTML (KaTeX); a message in place of a formula that does not parse. */
export function renderMath(latex: string, display: boolean): string {
  try {
    return safeHtml(katex.renderToString(latex, { displayMode: display, throwOnError: true, output: 'htmlAndMathml', trust: false }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return `<span class="ln-math-error" title="${msg.replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${latex.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`
  }
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
  json: 'application/json', md: 'text/markdown', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

export const isImage = (a: Pick<Attachment, 'mime'>): boolean => /^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(a.mime)

/** An attachment record for some bytes: SHA-256 recorded, small files optionally embedded. */
export async function makeAttachment(o: { id: string; name: string; bytes: Uint8Array; path: string; user: string; now: string; embed: boolean; mime?: string }): Promise<Attachment> {
  return {
    id: o.id, name: o.name, size: o.bytes.length, sha256: await sha256File(o.bytes), mime: o.mime ?? mimeOf(o.name), added: o.now, addedBy: o.user, path: o.path,
    ...(o.embed && o.bytes.length <= MAX_EMBED ? { data: bytesToBase64(o.bytes) } : {}),
  }
}

/** A displayable URL for an image attachment: its embedded data, else the file in the drive. Revoke with the cache owner. */
export async function attachmentBytes(a: Attachment): Promise<Uint8Array | null> {
  if (a.data != null) {
    const s = atob(a.data)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  }
  if (a.path && fs.exists(a.path)) {
    try { return await fs.readBytes(a.path) } catch { return null }
  }
  return null
}

/** Compares a linked file with the hash recorded when it was attached. */
export async function checkAttachment(a: Attachment): Promise<'ok' | 'changed' | 'missing'> {
  const bytes = await attachmentBytes(a)
  if (!bytes) return 'missing'
  return (await sha256File(bytes)) === a.sha256 ? 'ok' : 'changed'
}

/** Writes an embedded attachment to ~/Documents/kELN Attachments so another app can open it; returns the path. */
export async function extractAttachment(a: Attachment, home: string): Promise<string | null> {
  if (a.path && fs.exists(a.path)) return a.path
  const bytes = await attachmentBytes(a)
  if (!bytes) return null
  const dir = `${home}/Documents/kELN Attachments`
  const target = osPath.join(dir, fs.uniqueName(dir, a.name))
  await fs.writeBytes(target, bytes, { mkdirs: true })
  return target
}

// ------------------------------------------------------------------ images

export function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const c = canvas.getContext('2d')
      if (!c) { URL.revokeObjectURL(url); reject(new Error('No canvas.')); return }
      c.fillStyle = '#fff'
      c.fillRect(0, 0, canvas.width, canvas.height)
      c.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The drawing could not be rasterised.')) }
    img.src = url
  })
}

/** A bitmap of any format the browser reads, as a PNG data URL (the PDF engine takes PNG and JPEG). */
async function rasterise(bytes: Uint8Array, mime: string): Promise<string> {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d')!.drawImage(bmp, 0, 0)
  return canvas.toDataURL('image/png')
}

// ------------------------------------------------------------------ PDF

export interface PdfResult {
  pdf: Uint8Array
  pages: number
}

/** A PDF of one entry (or the whole notebook when `entry` is null) through MuPDF's HTML layout. */
export async function buildPdf(nb: Notebook, entry: Entry | null): Promise<PdfResult> {
  const entries = entry ? [entry] : nb.entries
  const images = new Map<string, string>()
  for (const e of entries) {
    for (const a of e.attachments) {
      if (!isImage(a) || images.has(a.id)) continue
      const bytes = await attachmentBytes(a)
      if (!bytes) continue
      try {
        images.set(a.id, a.mime === 'image/png' || a.mime === 'image/jpeg' ? `data:${a.mime};base64,${bytesToBase64(bytes)}` : await rasterise(bytes, a.mime))
      } catch { /* the picture is left out */ }
    }
  }
  const ctx = renderCtx(nb, { imageUrl: (a) => images.get(a.id) })
  let html = entry ? entryToDocument(nb, entry, { mode: 'xhtml', ctx }) : notebookToDocument(nb, { mode: 'xhtml', ctx })
  // charts and barcodes are SVG pictures: the PDF engine wants bitmaps
  const svgs = [...new Set(html.match(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/g) ?? [])]
  for (const url of svgs) {
    const svg = new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0)))
    const w = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1] ?? 400)
    const h = Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(svg)?.[1] ?? 250)
    try { html = html.split(url).join(await svgToPng(svg, w, h, 2)) } catch { /* left as it is */ }
  }
  return htmlToPdfInWorker(html, 595.28, 841.89)
}

/** Opens the browser's print dialog for an HTML page (labels): "Save as PDF" there gives exact pages. */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:10px;height:10px;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const d = frame.contentDocument!
  d.open()
  d.write(html.replace(/^<\?xml[^>]*\?>\s*/, ''))
  d.close()
  const w = frame.contentWindow!
  const cleanup = () => setTimeout(() => frame.remove(), 1000)
  w.addEventListener('afterprint', cleanup, { once: true })
  setTimeout(() => frame.isConnected && frame.remove(), 10 * 60_000)
  setTimeout(() => { w.focus(); w.print() }, 150)
}

/** A download-safe file name. */
export const safeName = (s: string): string => s.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'notebook'
