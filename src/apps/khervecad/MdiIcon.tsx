// The desktop's icons: Material Design Icons by their qtawesome names
// ("mdi.cube-outline"), from the same MDI release (mdi.ts, generated).

import { memo, useEffect, useRef } from 'react'
import { MDI } from './mdi'
import { replay, type Op } from './qt/paint'

/** Icons the desktop paints itself (the ribbon's shaded parts): the
 *  recorded drawing, keyed "paint:<id>" (kcweb.app sends each once). */
export type Painted = { s: number; ops: Op[] }
export const PAINTED = new Map<string, Painted>()

function PaintedIcon({ p, size, className }: { p: Painted; size: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size * dpr)
    c.height = Math.round(size * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    const k = (size * dpr) / p.s
    replay(ctx, p.ops, [k, 0, 0, k, 0, 0])
  }, [p, size])
  return <canvas ref={ref} className={className} style={{ width: size, height: size, flex: 'none' }} aria-hidden="true" />
}

export const MdiIcon = memo(function MdiIcon({ name, size = 18, color, className }: { name?: string | null; size?: number; color?: string; className?: string }) {
  const painted = name?.startsWith('paint:') ? PAINTED.get(name) : undefined
  if (painted) return <PaintedIcon p={painted} size={size} className={className} />
  const d = name ? MDI[name] : undefined
  if (!d) return name ? <span className={className} style={{ display: 'inline-block', width: size, height: size }} /> : null
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={d} fill={color ?? 'currentColor'} />
    </svg>
  )
})

export function hasIcon(name?: string | null): boolean {
  return !!name && (name in MDI || PAINTED.has(name))
}
