// HTML → PDF with MuPDF's own HTML layout (no print dialog): what File › Export › PDF uses. Text stays text (vector,
// searchable). The page size and margins come from the HTML's @page rule. Plain TypeScript.

import type * as MuPDF from 'mupdf'

export function htmlToPdf(mupdf: typeof MuPDF, html: string, widthPt: number, heightPt: number, fontSize = 10): { pdf: Uint8Array; pages: number } {
  const doc = mupdf.Document.openDocument(new TextEncoder().encode(html), 'application/xhtml+xml')
  try {
    doc.layout(widthPt, heightPt, fontSize)
    const buf = new mupdf.Buffer()
    const writer = new mupdf.DocumentWriter(buf, 'pdf', 'compress')
    const n = doc.countPages()
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i)
      const dev = writer.beginPage(page.getBounds())
      page.run(dev, mupdf.Matrix.identity)
      writer.endPage()
      page.destroy()
    }
    writer.close()
    const pdf = buf.asUint8Array().slice()
    buf.destroy()
    return { pdf, pages: n }
  } finally {
    doc.destroy()
  }
}
