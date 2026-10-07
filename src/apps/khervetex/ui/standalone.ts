// A standalone LaTeX picture (a flowchart, a drawing, a chemfig structure)
// compiled by the KherveOS LaTeX service and turned into the PNG preview the
// Visual tab shows, as the desktop does with tectonic and PyMuPDF.

import { compileLatex } from '@/os/services/latex'
import { openPdf } from '@/os/services/pdf'

export interface CompiledPicture {
  pdf: Uint8Array
  png: Uint8Array
  /** Width of the PDF page, in points. */
  widthPt: number
  /** The PNG as an object URL, for previews (revoke it when done). */
  url: string
}

/** Compile `tex` and render its first page at `dpi`; throws with LaTeX's first error. */
export async function compileStandalone(tex: string, dpi = 200): Promise<CompiledPicture> {
  const r = await compileLatex('picture.tex', { 'picture.tex': tex })
  if (!r.ok || !r.pdf) throw new Error(r.errors[0]?.message ?? 'LaTeX could not compile this.')
  const doc = await openPdf(r.pdf)
  try {
    const bmp = await doc.renderPage(0, dpi / 72, { annotations: false })
    const canvas = document.createElement('canvas')
    canvas.width = bmp.width
    canvas.height = bmp.height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'))
    if (!blob) throw new Error('The preview could not be drawn.')
    const png = new Uint8Array(await blob.arrayBuffer())
    return { pdf: r.pdf, png, widthPt: doc.pages[0]?.width ?? 300, url: URL.createObjectURL(blob) }
  } finally {
    doc.close()
  }
}
