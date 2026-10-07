// PDF export: one page the figure's true physical size (width / dpi
// inches), holding the drawing rendered at print resolution. The desktop
// writes vector PDF through Qt; this keeps the same page size and look.

import { zlibSync } from 'fflate'

/** A one-page PDF showing the canvas, `widthPt` × `heightPt` points. */
export function pdfFromCanvas(c: HTMLCanvasElement, widthPt: number, heightPt: number): Uint8Array {
  const ctx = c.getContext('2d')!
  const { data } = ctx.getImageData(0, 0, c.width, c.height)
  const rgb = new Uint8Array(c.width * c.height * 3)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    // The page is opaque white underneath: fold any alpha onto white.
    const a = data[i + 3] / 255
    rgb[j] = Math.round(data[i] * a + 255 * (1 - a))
    rgb[j + 1] = Math.round(data[i + 1] * a + 255 * (1 - a))
    rgb[j + 2] = Math.round(data[i + 2] * a + 255 * (1 - a))
  }
  const image = zlibSync(rgb, { level: 6 })
  const W = +widthPt.toFixed(3)
  const H = +heightPt.toFixed(3)
  const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (p: Uint8Array | string) => {
    const b = typeof p === 'string' ? enc.encode(p) : p
    parts.push(b)
    length += b.length
  }
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
  const obj = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = length
    push(`${n} 0 obj\n${body}\n`)
    if (stream) {
      push('stream\n')
      push(stream)
      push('\nendstream\n')
    }
    push('endobj\n')
  }
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`)
  obj(4, `<< /Length ${enc.encode(content).length} >>`, enc.encode(content))
  obj(5, `<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.length} >>`, image)
  obj(6, `<< /Producer (KherveOS KhervePaint) /Creator (KhervePaint) >>`)
  const xref = length
  let table = `xref\n0 7\n0000000000 65535 f \n`
  for (let n = 1; n <= 6; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(table)
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(length)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
