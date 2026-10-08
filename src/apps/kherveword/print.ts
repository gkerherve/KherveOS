// Print / Export PDF through the browser's print dialog ("Save as PDF"): the
// pages exactly as laid out on screen (vector text, the document's fonts),
// with headers, footers and footnotes. The pages on screen have gaps between
// them; the copy that is printed has none, so every page lands on one sheet.

export interface PrintGeometry {
  pageW: number
  pageH: number
  gap: number
  pages: number
}

export async function printPages(pagesEl: HTMLElement, g: PrintGeometry, title: string): Promise<void> {
  const clone = pagesEl.cloneNode(true) as HTMLElement
  clone.style.transform = 'none'
  clone.style.width = `${g.pageW}px`
  clone.style.height = `${g.pages * g.pageH}px`
  clone.classList.add('kw-printing')
  // Spacers: take the gap out (each one crosses one page boundary).
  clone.querySelectorAll<HTMLElement>('[data-kw-spacer]').forEach((el) => {
    const h = Math.max(0, (Number(el.dataset.kwSpacer) || 0) - g.gap)
    el.style.height = `${h}px`
  })
  clone.querySelectorAll<HTMLElement>('[data-kw-push]').forEach((el) => {
    const h = Math.max(0, (Number(el.dataset.kwPush) || 0) - g.gap)
    el.style.setProperty('--kw-push', `${h}px`)
  })
  for (const layer of ['.kw-page.bg', '.kw-page.over']) {
    clone.querySelectorAll<HTMLElement>(layer).forEach((el, i) => {
      el.style.top = `${i * g.pageH}px`
    })
  }
  // Nothing of the editing UI.
  clone.querySelectorAll('.kw-find, .ProseMirror-selectednode, .kw-img-handle, .ProseMirror-gapcursor, .column-resize-handle').forEach((el) => {
    el.classList.remove('kw-find', 'kw-find-current', 'ProseMirror-selectednode')
    if (el.classList.contains('kw-img-handle') || el.classList.contains('column-resize-handle') || el.classList.contains('ProseMirror-gapcursor')) el.remove()
  })
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'))

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:10px;height:10px;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const d = frame.contentDocument!
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((n) => n.outerHTML)
    .join('\n')
  d.open()
  d.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>${styles}` +
      `<style>@page{size:${g.pageW}px ${g.pageH}px;margin:0}html,body{margin:0;padding:0;background:#fff}` +
      `*{-webkit-print-color-adjust:exact;print-color-adjust:exact}.kw-printing{position:relative!important;left:0;top:0;margin:0;overflow:hidden}` +
      `.kw-printing .kw-page{box-shadow:none!important;outline:none!important}.kw-printing p,.kw-printing li{orphans:1;widows:1}</style>` +
      `</head><body></body></html>`,
  )
  d.close()
  d.body.appendChild(d.importNode(clone, true))
  try {
    await (d as Document & { fonts?: FontFaceSet }).fonts?.ready
    await Promise.all(
      Array.from(d.images).map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => ((img.onload = () => r()), (img.onerror = () => r()))))),
    )
  } catch {
    /* print anyway */
  }
  const w = frame.contentWindow!
  const cleanup = () => setTimeout(() => frame.remove(), 1000)
  w.addEventListener('afterprint', cleanup, { once: true })
  setTimeout(() => frame.isConnected && frame.remove(), 10 * 60_000)
  w.focus()
  w.print()
}
