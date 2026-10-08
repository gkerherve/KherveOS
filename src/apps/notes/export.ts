// Notes: sharing a note — Markdown or plain text (to the drive, the computer
// or the clipboard), and printing (which is also how a PDF is made: "Save as
// PDF" in the print dialog).

import { fs, os, path } from '@/os'
import { mimeType } from '@/os/fileIcons'
import { docToPlain, isLocalHref, markdownToDoc, ATTACHMENTS } from './markdown'
import { fileStem, localLinks } from './format'
import { library } from './store'
import type { Note } from './library'

export function plainTextOf(note: Note): string {
  return docToPlain(markdownToDoc(note.body)).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

/** Save the note as Markdown somewhere on the drive, with its attachments next to it. */
export async function exportMarkdown(note: Note): Promise<string | null> {
  const target = await os.dialog.saveFile({
    title: 'Export as Markdown',
    defaultName: `${path.HOME}/Documents/${fileStem(note.title || 'Note')}.md`,
    extensions: ['.md'],
  })
  if (!target) return null
  await fs.writeText(target, note.body, { mkdirs: true })
  const dir = path.dirname(target)
  let copied = 0
  for (const link of localLinks(note.body)) {
    const src = library.resolve(note, link)
    const dst = path.join(dir, link)
    if (!fs.exists(src) || src === dst || fs.exists(dst)) continue
    await fs.writeBytes(dst, await fs.readBytes(src), { mkdirs: true })
    copied++
  }
  os.notify({ title: `Exported ${path.basename(target)}`, body: copied ? `${path.pretty(dir)} (and ${copied} attachment${copied === 1 ? '' : 's'} in ${ATTACHMENTS})` : path.pretty(dir) })
  return target
}

export async function exportPlainText(note: Note): Promise<string | null> {
  const target = await os.dialog.saveFile({
    title: 'Export as Plain Text',
    defaultName: `${path.HOME}/Documents/${fileStem(note.title || 'Note')}.txt`,
    extensions: ['.txt'],
  })
  if (!target) return null
  await fs.writeText(target, plainTextOf(note), { mkdirs: true })
  os.notify({ title: `Exported ${path.basename(target)}`, body: path.pretty(path.dirname(target)) })
  return target
}

export function downloadMarkdown(note: Note) {
  os.downloadBlob(`${fileStem(note.title || 'Note')}.md`, new Blob([note.body], { type: 'text/markdown' }))
}

export async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    os.notify({ title: `Copied ${what}` })
  } catch {
    await os.dialog.alert('The browser did not allow copying to the clipboard.')
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

async function dataUrl(p: string): Promise<string | null> {
  try {
    const bytes = await fs.readBytes(p)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return `data:${mimeType(p)};base64,${btoa(bin)}`
  } catch {
    return null
  }
}

/**
 * Print the note (the editor's HTML, pictures inlined). The print dialog's
 * "Save as PDF" makes the PDF.
 */
export async function printNote(note: Note, html: string) {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')!
  for (const img of [...root.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? ''
    if (!isLocalHref(src)) continue
    const url = await dataUrl(library.resolve(note, decodeURIComponentSafe(src)))
    if (url) img.setAttribute('src', url)
    else img.remove()
  }
  for (const a of [...root.querySelectorAll('[data-attachment]')]) {
    a.textContent = `Attached file: ${a.getAttribute('data-name') || a.getAttribute('data-src') || ''}`
  }
  for (const box of [...root.querySelectorAll('ul[data-type="taskList"] > li')]) {
    const checked = box.getAttribute('data-checked') === 'true'
    box.querySelector('label')?.replaceWith(Object.assign(doc.createElement('span'), { className: 'box', textContent: checked ? '☑' : '☐' }))
  }
  const page = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(note.title || 'Note')}</title><style>
    body{font:12pt/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;margin:0}
    @page{margin:18mm}
    h1{font-size:20pt;margin:0 0 8pt} h2{font-size:15pt;margin:14pt 0 6pt} h3{font-size:12.5pt;margin:12pt 0 4pt}
    p{margin:0 0 6pt} img{max-width:100%;height:auto} figure{margin:8pt 0}
    blockquote{margin:6pt 0;padding-left:10pt;border-left:3px solid #9bd3b0;color:#333}
    pre{background:#f3f5f4;padding:8pt;border-radius:4pt;white-space:pre-wrap;font:10pt/1.4 Menlo,Consolas,monospace}
    code{font:0.92em Menlo,Consolas,monospace;background:#f3f5f4;padding:0 3px;border-radius:3px}
    table{border-collapse:collapse;margin:6pt 0} td,th{border:1px solid #bbb;padding:3pt 6pt;vertical-align:top} th{background:#eef5f0;text-align:left}
    td p,th p{margin:0}
    ul[data-type="taskList"]{list-style:none;padding-left:4pt}
    ul[data-type="taskList"] li{display:flex;gap:6pt} ul[data-type="taskList"] li > div{flex:1}
    li[data-checked="true"] > div{color:#777;text-decoration:line-through}
    .box{font-size:13pt;line-height:1.2}
    [data-attachment]{display:inline-block;border:1px solid #bbb;border-radius:4pt;padding:2pt 6pt;margin:4pt 0}
    a{color:#11663a}
    .meta{color:#777;font-size:9pt;margin-bottom:10pt}
  </style></head><body><div class="meta">${esc(new Date(note.modified).toLocaleString())}</div>${root.innerHTML}</body></html>`
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = page
  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } finally {
      setTimeout(() => frame.remove(), 60_000)
    }
  }
  document.body.appendChild(frame)
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
