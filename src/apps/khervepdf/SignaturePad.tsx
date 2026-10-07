// "Draw your signature": a white pad shaped like the box dragged on the page.
// The strokes are exported on a transparent background so the signature sits
// on the page like ink.

import { useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

interface Props {
  /** Width / height of the box on the page. */
  aspect: number
  color: string
  onDone: (png: Uint8Array) => void
  onCancel: () => void
}

type Stroke = [number, number][]

const LINE = 2.6

export function SignaturePad({ aspect, color, onDone, onCancel }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Stroke[]>([])
  const current = useRef<Stroke | null>(null)
  const [empty, setEmpty] = useState(true)
  // Room to sign comfortably, keeping the box's shape (as the desktop app does).
  const a = Math.max(0.2, Math.min(8, aspect))
  const w = Math.round(Math.min(560, 300 * a))
  const h = Math.round(w / a)

  const draw = (ctx: CanvasRenderingContext2D, k: number) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = LINE * k
    for (const s of strokes.current) {
      if (s.length === 1) {
        ctx.beginPath()
        ctx.arc(s[0][0] * k, s[0][1] * k, (LINE * k) / 2, 0, Math.PI * 2)
        ctx.fill()
        continue
      }
      ctx.beginPath()
      ctx.moveTo(s[0][0] * k, s[0][1] * k)
      for (let i = 1; i < s.length - 1; i++) {
        // smooth through midpoints
        const mx = ((s[i][0] + s[i + 1][0]) / 2) * k
        const my = ((s[i][1] + s[i + 1][1]) / 2) * k
        ctx.quadraticCurveTo(s[i][0] * k, s[i][1] * k, mx, my)
      }
      const last = s[s.length - 1]
      ctx.lineTo(last[0] * k, last[1] * k)
      ctx.stroke()
    }
  }

  const redraw = () => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    draw(ctx, c.width / w)
  }

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const point = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h]
  }

  const finish = async () => {
    // Export at a good resolution, on a transparent background.
    const k = Math.max(2, 900 / w)
    const out = document.createElement('canvas')
    out.width = Math.round(w * k)
    out.height = Math.round(h * k)
    const ctx = out.getContext('2d')
    if (!ctx) return
    draw(ctx, k)
    const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, 'image/png'))
    if (blob) onDone(new Uint8Array(await blob.arrayBuffer()))
  }

  return (
    <div className="kp-modal-backdrop" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
      <div className="kp-modal" role="dialog" aria-label="Draw your signature">
        <div className="kp-modal-title">Draw your signature</div>
        <p className="k-muted kp-modal-hint">Sign with the mouse, trackpad or pen — it is placed in the box you dragged.</p>
        <canvas
          ref={ref}
          className="kp-sig-canvas"
          style={{ width: w, height: h }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            current.current = [point(e)]
            strokes.current.push(current.current)
            setEmpty(false)
            redraw()
          }}
          onPointerMove={(e) => {
            if (!current.current) return
            current.current.push(point(e))
            redraw()
          }}
          onPointerUp={() => (current.current = null)}
          onPointerCancel={() => (current.current = null)}
        />
        <div className="kp-modal-buttons">
          <button
            className="k-btn"
            onClick={() => {
              strokes.current = []
              setEmpty(true)
              redraw()
            }}
          >
            <Eraser size={14} /> Clear
          </button>
          <span className="k-spacer" />
          <button className="k-btn" onClick={onCancel}>Cancel</button>
          <button className="k-btn primary" disabled={empty} onClick={() => void finish()}>Stamp on page</button>
        </div>
      </div>
    </div>
  )
}
