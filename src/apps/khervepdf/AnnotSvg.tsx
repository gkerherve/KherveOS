// Draws annotations the way MuPDF will write them, as SVG in page points
// (the SVG's viewBox is the page box, so zooming needs no redraw).

import { memo } from 'react'
import type { PdfAnnot, PdfPageInfo, PdfRect } from '@/os/services/pdf'
import { TEXT_ASCENT, TEXT_LEADING, arrowHead, fontFamilyFor, layoutText, noteRect } from './geometry'

const imageUrls = new WeakMap<Uint8Array, string>()

function imageUrl(bytes: Uint8Array): string {
  let url = imageUrls.get(bytes)
  if (!url) {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50
    url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: png ? 'image/png' : 'image/jpeg' }))
    imageUrls.set(bytes, url)
  }
  return url
}

const pts = (s: readonly (readonly number[])[]) => s.map((p) => `${p[0]},${p[1]}`).join(' ')

function ArrowHead({ a }: { a: PdfAnnot }) {
  const [p, q] = a.line!
  const ang = Math.atan2(q[1] - p[1], q[0] - p[0])
  const len = arrowHead(a.width)
  const spread = Math.PI / 6
  const l = [q[0] - len * Math.cos(ang - spread), q[1] - len * Math.sin(ang - spread)]
  const r = [q[0] - len * Math.cos(ang + spread), q[1] - len * Math.sin(ang + spread)]
  return <polyline points={pts([l, q, r])} fill="none" stroke={a.color} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round" />
}

function Squiggle({ r, color }: { r: PdfRect; color: string }) {
  const h = r[3] - r[1]
  const step = Math.max(1.5, h / 6)
  const amp = Math.max(0.6, h / 14)
  const base = r[3] - amp
  const p: number[][] = []
  for (let x = r[0], up = true; x <= r[2]; x += step, up = !up) p.push([x, base + (up ? -amp : amp)])
  return <polyline points={pts(p)} fill="none" stroke={color} strokeWidth={Math.max(0.5, h / 16)} />
}

export const AnnotShape = memo(function AnnotShape({ a }: { a: PdfAnnot }) {
  const op = a.opacity ?? 1
  switch (a.kind) {
    case 'ink':
      return (
        <g opacity={op} fill="none" stroke={a.color} strokeWidth={a.width} strokeLinecap="round" strokeLinejoin="round">
          {(a.strokes ?? []).map((s, i) =>
            s.length === 1 ? <circle key={i} cx={s[0][0]} cy={s[0][1]} r={a.width / 2} fill={a.color} stroke="none" /> : <polyline key={i} points={pts(s)} />,
          )}
        </g>
      )
    case 'highlight':
      return (
        <g opacity={op} fill={a.color} className="kp-multiply">
          {(a.rects ?? []).map((r, i) => <rect key={i} x={r[0]} y={r[1]} width={r[2] - r[0]} height={r[3] - r[1]} />)}
        </g>
      )
    case 'underline':
    case 'strikeout':
      return (
        <g opacity={op} stroke={a.color}>
          {(a.rects ?? []).map((r, i) => {
            const h = r[3] - r[1]
            const y = a.kind === 'underline' ? r[3] - h * 0.08 : r[1] + h * 0.55
            return <line key={i} x1={r[0]} x2={r[2]} y1={y} y2={y} strokeWidth={Math.max(0.5, h / 14)} />
          })}
        </g>
      )
    case 'squiggly':
      return <g opacity={op}>{(a.rects ?? []).map((r, i) => <Squiggle key={i} r={r} color={a.color} />)}</g>
    case 'rect': {
      const [x0, y0, x1, y1] = a.rect!
      return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={a.fill ?? 'none'} stroke={a.width > 0 ? a.color : 'none'} strokeWidth={a.width} opacity={op} />
    }
    case 'ellipse': {
      const [x0, y0, x1, y1] = a.rect!
      return (
        <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} fill={a.fill ?? 'none'} stroke={a.width > 0 ? a.color : 'none'} strokeWidth={a.width} opacity={op} />
      )
    }
    case 'line':
    case 'arrow': {
      const [p, q] = a.line!
      return (
        <g opacity={op}>
          <line x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />
          {a.kind === 'arrow' && <ArrowHead a={a} />}
        </g>
      )
    }
    case 'note': {
      const [x, y] = noteRect(a)
      return (
        <g transform={`translate(${x} ${y})`} opacity={op} className="kp-note-icon">
          <title>{a.text || 'Sticky note'}</title>
          <path d="M2 2.5h16v11H9l-4.5 4v-4H2z" fill={a.color} stroke="#000" strokeOpacity={0.55} strokeWidth={0.8} strokeLinejoin="round" />
          <path d="M5 6h10M5 9h7" stroke="#000" strokeOpacity={0.5} strokeWidth={0.9} strokeLinecap="round" />
        </g>
      )
    }
    case 'text': {
      const [x0, y0, x1] = a.rect!
      const size = a.fontSize || 12
      const lines = layoutText(a.text ?? '', size, a.font, x1 - x0 + 0.5)
      return (
        <text x={x0} y={y0} fontSize={size} fontFamily={fontFamilyFor(a.font)} fill={a.color} opacity={op} xmlSpace="preserve">
          {lines.map((l, i) => (
            <tspan key={i} x={x0} y={y0 + size * TEXT_ASCENT + i * size * TEXT_LEADING}>{l || ' '}</tspan>
          ))}
        </text>
      )
    }
    case 'redact': {
      const [x0, y0, x1, y1] = a.rect!
      return <rect className="kp-redact-mark" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
    }
    case 'image': {
      if (!a.image || !a.rect) return null
      const [x0, y0, x1, y1] = a.rect
      return <image href={imageUrl(a.image)} x={x0} y={y0} width={x1 - x0} height={y1 - y0} preserveAspectRatio="xMidYMid meet" opacity={op} />
    }
    default:
      return null
  }
})

/** The annotations of one page. `hidden` ones are left out (being edited); `offset` moves the `moving` ones. */
export function AnnotSvg({
  page, annots, hidden, moving, offset, faded, children,
}: {
  page: PdfPageInfo
  annots: PdfAnnot[]
  hidden?: string | null
  moving?: ReadonlySet<string>
  offset?: [number, number]
  faded?: ReadonlySet<string>
  children?: React.ReactNode
}) {
  return (
    <svg className="kp-annots" viewBox={`${page.x} ${page.y} ${page.width} ${page.height}`} preserveAspectRatio="none">
      {annots.map((a) => {
        if (a.id === hidden) return null
        const shape = <AnnotShape a={a} />
        if (moving?.has(a.id) && offset) return <g key={a.id} transform={`translate(${offset[0]} ${offset[1]})`}>{shape}</g>
        if (faded?.has(a.id)) return <g key={a.id} opacity={0.25}>{shape}</g>
        return <g key={a.id}>{shape}</g>
      })}
      {children}
    </svg>
  )
}
