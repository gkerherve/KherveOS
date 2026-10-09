// Browser-side helper for kFEA's exports: an SVG drawn on a canvas and returned as PNG bytes.

/** The SVG text drawn on a canvas and returned as PNG bytes. */
export function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('The browser gave no canvas to draw on.')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('The picture could not be made.'))), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The drawing could not be turned into an image.')) }
    img.src = url
  })
}
