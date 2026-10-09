// Draws the primitives of a scene (scene.ts) on a 2-D canvas context. Colour names are looked up in the palette.

import type { Palette, Prim } from './scene.ts'

export function drawPrims(ctx: CanvasRenderingContext2D, prims: readonly Prim[], pal: Palette, family = 'sans-serif'): void {
  const col = (c: string | undefined): string | undefined => (c === undefined ? undefined : pal[c] ?? c)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const p of prims) {
    switch (p.t) {
      case 'line':
        ctx.strokeStyle = col(p.c)!; ctx.lineWidth = p.w; ctx.setLineDash(p.dash ?? [])
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke()
        break
      case 'poly': {
        if (p.pts.length < 4) break
        ctx.beginPath()
        ctx.moveTo(p.pts[0], p.pts[1])
        for (let i = 2; i + 1 < p.pts.length; i += 2) ctx.lineTo(p.pts[i], p.pts[i + 1])
        if (p.closed) ctx.closePath()
        const fill = col(p.fill)
        if (fill) { ctx.globalAlpha = p.alpha ?? 1; ctx.fillStyle = fill; ctx.fill(); ctx.globalAlpha = 1 }
        const stroke = col(p.stroke)
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = p.w; ctx.setLineDash(p.dash ?? []); ctx.stroke() }
        break
      }
      case 'circle': {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        const fill = col(p.fill)
        if (fill) { ctx.fillStyle = fill; ctx.fill() }
        const stroke = col(p.stroke)
        if (stroke && p.w > 0) { ctx.strokeStyle = stroke; ctx.lineWidth = p.w; ctx.setLineDash([]); ctx.stroke() }
        break
      }
      default:
        ctx.fillStyle = col(p.c)!
        ctx.font = `${p.bold ? '600 ' : ''}${p.size}px ${family}`
        ctx.textAlign = p.anchor === 'middle' ? 'center' : p.anchor ?? 'start'
        ctx.fillText(p.s, p.x, p.y)
    }
  }
  ctx.setLineDash([])
}
