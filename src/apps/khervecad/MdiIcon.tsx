// The desktop's icons: Material Design Icons by their qtawesome names
// ("mdi.cube-outline"), from the same MDI release (mdi.ts, generated).

import { memo } from 'react'
import { MDI } from './mdi'

export const MdiIcon = memo(function MdiIcon({ name, size = 18, color, className }: { name?: string | null; size?: number; color?: string; className?: string }) {
  const d = name ? MDI[name] : undefined
  if (!d) return name ? <span className={className} style={{ display: 'inline-block', width: size, height: size }} /> : null
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={d} fill={color ?? 'currentColor'} />
    </svg>
  )
})

export function hasIcon(name?: string | null): boolean {
  return !!name && name in MDI
}
