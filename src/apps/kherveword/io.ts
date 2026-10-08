// Opening and saving KherveWord documents in the browser: .docx/.dotx (own
// reader/writer), .odt, .rtf, .md, .html, .txt in; .docx, .html, .md, .txt
// out; HTML from the clipboard or other formats goes through the editor's
// schema. Autosave copies live in ~/.kherveword/autosave.

import DOMPurify from 'dompurify'
import katex from 'katex'
import { marked } from 'marked'
import { DOMParser as PMDOMParser, type Schema } from '@tiptap/pm/model'
import { fs, path, HOME } from '@/os'
import { readDocx } from './docx/reader'
import { writeDocx } from './docx/writer'
import { rtfToHtml } from './formats/rtf'
import { odtToHtml } from './formats/odt'
import { docToMarkdown, docToText } from './formats/export'
import { docToHtml } from './formats/html'
import { renderMath } from './editor/math'
import { defaultSettings, walk, type DocSettings, type PMNode, type WordDoc } from './model'

export const OPEN_TYPES = ['.docx', '.dotx', '.docm', '.odt', '.rtf', '.md', '.markdown', '.html', '.htm', '.txt']
export const SAVE_TYPES = ['.docx', '.html', '.md', '.txt']

export function defaultPageSize(): string {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'en-GB'
  return /^(en-US|en-CA|es-MX|fr-CA|en-PH)$/i.test(lang) ? 'Letter' : 'A4'
}

/** HTML (sanitised) → document JSON through the editor's schema. */
export function htmlToDoc(html: string, schema: Schema): PMNode {
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['data-style', 'data-type', 'data-text', 'data-latex', 'data-kind', 'data-list-style', 'data-wrap', 'data-borders', 'data-font', 'target'], ADD_DATA_URI_TAGS: ['img'] })
  const dom = document.createElement('div')
  dom.innerHTML = clean
  // Old-style <font> and <center>, and lone text, become something the schema knows.
  dom.querySelectorAll('center').forEach((c) => {
    c.querySelectorAll('p,h1,h2,h3,h4,h5,h6,div').forEach((p) => ((p as HTMLElement).style.textAlign = 'center'))
  })
  return PMDOMParser.fromSchema(schema).parse(dom).toJSON() as PMNode
}

function textToDoc(text: string): PMNode {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  return {
    type: 'doc',
    content: lines.map((l) => ({ type: 'paragraph', attrs: { style: 'Normal' }, content: l ? [{ type: 'text', text: l }] : undefined })),
  }
}

/** Read a file into a document. */
export async function openDocument(p: string, schema: Schema): Promise<{ wd: WordDoc; format: string; template: boolean }> {
  const ext = path.extname(p).toLowerCase()
  const settings = defaultSettings(defaultPageSize())
  settings.title = path.basename(p).replace(/\.[^.]+$/, '')
  if (ext === '.docx' || ext === '.dotx' || ext === '.docm') {
    const wd = readDocx(await fs.readBytes(p))
    if (!wd.settings.title) wd.settings.title = settings.title
    return { wd, format: 'docx', template: ext === '.dotx' }
  }
  if (ext === '.doc') throw new Error('Old Word 97–2003 (.doc) files cannot be read: open them in Word or LibreOffice and save them as .docx.')
  let doc: PMNode
  if (ext === '.odt') doc = htmlToDoc(odtToHtml(await fs.readBytes(p)), schema)
  else if (ext === '.rtf') doc = htmlToDoc(rtfToHtml(await fs.readText(p)), schema)
  else if (ext === '.md' || ext === '.markdown') doc = htmlToDoc(await marked.parse(await fs.readText(p)), schema)
  else if (ext === '.html' || ext === '.htm') doc = htmlToDoc(await fs.readText(p), schema)
  else doc = textToDoc(await fs.readText(p))
  const FORMAT: Record<string, string> = { '.odt': 'odt', '.rtf': 'rtf', '.md': 'md', '.markdown': 'md', '.html': 'html', '.htm': 'html' }
  return { wd: { doc, settings }, format: FORMAT[ext] ?? 'txt', template: false }
}

/** Pictures as data: URLs (pictures from the drive or the web were already turned into data URLs on insert). */
async function inlineImages(doc: PMNode): Promise<PMNode> {
  const copy = JSON.parse(JSON.stringify(doc)) as PMNode
  const jobs: Promise<void>[] = []
  walk(copy, (n) => {
    if (n.type !== 'image' || !n.attrs) return
    const src = String(n.attrs.src ?? '')
    if (src.startsWith('data:image/svg')) {
      // Word wants a bitmap.
      jobs.push(
        svgToPng(src, Number(n.attrs.width) || 0).then((png) => {
          if (png) n.attrs!.src = png
        }),
      )
    } else if (src.startsWith('blob:') || src.startsWith('http')) {
      jobs.push(
        fetch(src)
          .then((r) => r.blob())
          .then((b) => blobToDataUrl(b))
          .then((u) => void (n.attrs!.src = u))
          .catch(() => undefined),
      )
    }
  })
  await Promise.all(jobs)
  return copy
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return blobToDataUrl(new Blob([bytes as BlobPart], { type: mime }))
}

function svgToPng(src: string, width: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = Math.max(1, Math.round((width || img.naturalWidth || 300) * 2))
      const h = Math.max(1, Math.round(w * ((img.naturalHeight || 200) / (img.naturalWidth || 300))))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return resolve(null)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

export const mathHtml = (latex: string, display: boolean) => {
  const r = renderMath(latex, display)
  return r.ok ? r.html : `<code>${latex.replace(/</g, '&lt;')}</code>`
}

/** The bytes of a document in the format of `p`'s extension. */
export async function encodeDocument(p: string, wd: WordDoc, headingPages: number[], toc: { text: string; level: number; page?: number }[]): Promise<Uint8Array> {
  const ext = path.extname(p).toLowerCase()
  const enc = (s: string) => new TextEncoder().encode(s)
  if (ext === '.html' || ext === '.htm') {
    // Equations need KaTeX's stylesheet where the page is opened.
    const katexCss = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css">`
    return enc(docToHtml(wd, { mode: 'web', math: mathHtml, toc }).replace('</head>', `${katexCss}</head>`))
  }
  if (ext === '.md' || ext === '.markdown') return enc(docToMarkdown(wd.doc))
  if (ext === '.txt') return enc(docToText(wd.doc))
  const doc = await inlineImages(wd.doc)
  return writeDocx({ doc, settings: wd.settings }, { headingPages })
}

// ------------------------------------------------------------------ autosave

export const AUTOSAVE_DIR = `${HOME}/.kherveword/autosave`

export interface AutosaveFile {
  wd: WordDoc
  path: string | null
  savedAt: string
  window: string
}

export async function writeAutosave(id: string, data: AutosaveFile) {
  await fs.writeText(`${AUTOSAVE_DIR}/${id}.json`, JSON.stringify(data), { mkdirs: true })
}

export async function dropAutosave(id: string) {
  const p = `${AUTOSAVE_DIR}/${id}.json`
  if (fs.exists(p)) await fs.remove(p).catch(() => undefined)
}

/** Autosaved documents left behind by windows that are not open any more. */
export function leftoverAutosaves(openIds: Set<string>): string[] {
  if (!fs.isDir(AUTOSAVE_DIR)) return []
  return fs
    .list(AUTOSAVE_DIR)
    .filter((s) => s.type === 'file' && s.path.endsWith('.json') && !openIds.has(path.basename(s.path).replace(/\.json$/, '')))
    .map((s) => s.path)
}

export async function readAutosave(p: string): Promise<AutosaveFile | null> {
  try {
    const data = JSON.parse(await fs.readText(p)) as AutosaveFile
    if (!data?.wd?.doc || !data.wd.settings) return null
    // Settings written by an older version: fill what is missing.
    data.wd.settings = { ...defaultSettings(), ...data.wd.settings } as DocSettings
    return data
  } catch {
    return null
  }
}
