// Replays what a desktop widget or graphics item painted (the recording
// QPainter, kcweb/qtshim/_painter.py) on a canvas. Points are mapped by hand
// (base transform × the painter's own), so cosmetic pens stay one pixel and
// text stays upright, as Qt draws them.

export type Matrix = [number, number, number, number, number, number]
export type Op = (string | number | null | number[] | number[][])[]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** a then b (Qt order: points are mapped by a, then by b). */
export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ]
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** '#rrggbbaa' → css colour. */
export function cssColor(c: unknown): string | null {
  if (typeof c !== 'string') return null
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(c)
  if (!m) return c
  const a = m[4] ? parseInt(m[4], 16) / 255 : 1
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a.toFixed(3)})`
}

interface State {
  pen: { color: string; width: number; cosmetic: boolean; style: number; cap: number } | null
  brush: string | null
  font: { px: number; bold: boolean; italic: boolean; family: string }
  tf: Matrix
  opacity: number
}

const ALIGN_RIGHT = 0x2
const ALIGN_HCENTER = 0x4
const ALIGN_BOTTOM = 0x40
const ALIGN_VCENTER = 0x80

/** Draw *ops* with *base* mapping the painter's coordinates to the canvas. */
export function replay(ctx: CanvasRenderingContext2D, ops: Op[], base: Matrix = IDENTITY) {
  let st: State = { pen: { color: '#000000', width: 1, cosmetic: true, style: 1, cap: 0x10 }, brush: null, font: { px: 13, bold: false, italic: false, family: '' }, tf: IDENTITY, opacity: 1 }
  const stack: State[] = []
  let m = base
  const scale = () => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1
  const stroke = () => {
    const p = st.pen
    if (!p) return false
    ctx.strokeStyle = cssColor(p.color) ?? '#000'
    ctx.lineWidth = p.cosmetic || p.width === 0 ? Math.max(1, p.width || 1) : Math.max(0.5, p.width * scale())
    ctx.lineCap = p.cap === 0x20 ? 'round' : p.cap === 0 ? 'butt' : 'square'
    ctx.setLineDash(p.style === 2 ? [6, 4] : p.style === 3 ? [2, 3] : p.style === 4 ? [8, 3, 2, 3] : [])
    return true
  }
  const fill = () => {
    if (!st.brush) return false
    ctx.fillStyle = cssColor(st.brush) ?? '#000'
    return true
  }
  const pathOf = (pts: number[], close: boolean) => {
    const p = new Path2D()
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const [x, y] = apply(m, pts[i], pts[i + 1])
      if (i === 0) p.moveTo(x, y)
      else p.lineTo(x, y)
    }
    if (close) p.closePath()
    return p
  }
  const draw = (p: Path2D, rule: CanvasFillRule = 'nonzero', withFill = true) => {
    if (withFill && fill()) ctx.fill(p, rule)
    if (stroke()) ctx.stroke(p)
  }
  ctx.save()
  for (const op of ops) {
    const k = op[0] as string
    const n = (i: number) => op[i] as number
    switch (k) {
      case 'save':
        stack.push({ ...st, pen: st.pen && { ...st.pen }, font: { ...st.font } })
        break
      case 'restore':
        if (stack.length) st = stack.pop()!
        m = multiply(st.tf, base)
        ctx.globalAlpha = st.opacity
        break
      case 'tf':
        st.tf = [n(1), n(2), n(3), n(4), n(5), n(6)]
        m = multiply(st.tf, base)
        break
      case 'pen':
        st.pen = op[1] === null ? null : { color: op[1] as string, width: n(2), cosmetic: !!n(3), style: n(4), cap: n(5) }
        break
      case 'brush':
        st.brush = (op[1] as string | null) ?? null
        break
      case 'font':
        st.font = { px: n(1), bold: !!n(2), italic: !!n(3), family: (op[4] as string) || '' }
        break
      case 'op':
        st.opacity = n(1)
        ctx.globalAlpha = st.opacity
        break
      case 'line': {
        const [a, b] = [apply(m, n(1), n(2)), apply(m, n(3), n(4))]
        if (stroke()) {
          ctx.beginPath()
          ctx.moveTo(a[0], a[1])
          ctx.lineTo(b[0], b[1])
          ctx.stroke()
        }
        break
      }
      case 'point': {
        const [x, y] = apply(m, n(1), n(2))
        if (st.pen) {
          ctx.fillStyle = cssColor(st.pen.color) ?? '#000'
          ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5)
        }
        break
      }
      case 'rect':
      case 'fill': {
        const [x, y, w, h] = [n(1), n(2), n(3), n(4)]
        const p = pathOf([x, y, x + w, y, x + w, y + h, x, y + h], true)
        if (k === 'fill') {
          ctx.fillStyle = cssColor(op[5]) ?? '#000'
          ctx.fill(p)
        } else draw(p)
        break
      }
      case 'rrect': {
        const [x, y, w, h, rx] = [n(1), n(2), n(3), n(4), n(5)]
        const a = apply(m, x, y)
        const b = apply(m, x + w, y + h)
        const p = new Path2D()
        p.roundRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.min(rx * scale(), Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2))
        draw(p)
        break
      }
      case 'ellipse': {
        const [cx, cy] = apply(m, n(1), n(2))
        const p = new Path2D()
        p.ellipse(cx, cy, Math.abs(n(3) * Math.hypot(m[0], m[1])), Math.abs(n(4) * Math.hypot(m[2], m[3])), 0, 0, Math.PI * 2)
        draw(p)
        break
      }
      case 'arc': {
        // Qt angles: degrees, counter-clockwise, y down in the painter's frame
        const [cx, cy, rx, ry, start, span, pie] = [n(1), n(2), n(3), n(4), n(5), n(6), n(7)]
        const steps = Math.max(8, Math.ceil(Math.abs(span) / 4))
        const pts: number[] = pie ? [cx, cy] : []
        for (let i = 0; i <= steps; i++) {
          const a = ((start + (span * i) / steps) * Math.PI) / 180
          pts.push(cx + rx * Math.cos(a), cy - ry * Math.sin(a))
        }
        draw(pathOf(pts, !!pie), 'nonzero', !!pie)
        break
      }
      case 'poly':
        draw(pathOf(op[1] as number[], !!n(2)), 'nonzero', !!n(2))
        break
      case 'path':
      case 'fillpath': {
        const p = new Path2D()
        for (const sub of op[1] as number[][]) p.addPath(pathOf(sub, true))
        const rule: CanvasFillRule = n(2) === 1 ? 'nonzero' : 'evenodd'
        if (k === 'fillpath') {
          ctx.fillStyle = cssColor(op[3]) ?? '#000'
          ctx.fill(p, rule)
        } else draw(p, rule, n(3) !== 0)
        break
      }
      case 'text':
      case 'textr': {
        const f = st.font
        const px = Math.max(1, f.px * scale())
        ctx.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${px}px ${f.family ? `"${f.family}", ` : ''}system-ui, sans-serif`
        ctx.fillStyle = cssColor(st.pen?.color) ?? '#000'
        if (k === 'text') {
          const [x, y] = apply(m, n(1), n(2))
          ctx.fillText(String(op[3]), x, y)
        } else {
          const [x, y, w, h, flags] = [n(1), n(2), n(3), n(4), n(5)]
          const a = apply(m, x, y)
          const b = apply(m, x + w, y + h)
          const [l, t, r, btm] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
          const text = String(op[6])
          const lines = text.split('\n')
          const tw = Math.max(...lines.map((s) => ctx.measureText(s).width))
          const lh = px * 1.2
          const tx = flags & ALIGN_HCENTER ? (l + r) / 2 - tw / 2 : flags & ALIGN_RIGHT ? r - tw : l
          const th = lh * lines.length
          const ty = flags & ALIGN_VCENTER ? (t + btm) / 2 - th / 2 : flags & ALIGN_BOTTOM ? btm - th : t
          lines.forEach((s, i) => ctx.fillText(s, tx, ty + lh * (i + 0.8)))
        }
        break
      }
      case 'comp':
        ctx.globalCompositeOperation = n(1) === 13 ? 'multiply' : 'source-over'
        break
      default:
        break
    }
  }
  ctx.restore()
}
