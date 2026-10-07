// A small floating window inside the app (the desktop opens its tool windows
// — Peak Fitting, Measure Area, D-parameter… — as separate always-on-top
// frames): a title bar to drag it by, a close box, fixed size.

import { useRef, useState, type ReactNode } from 'react'

export interface FloatWinProps {
  title: string
  icon?: string
  initial: { x: number; y: number }
  width: number
  height?: number
  onClose: () => void
  children: ReactNode
  className?: string
}

export function FloatWin({ title, icon, initial, width, height, onClose, children, className }: FloatWinProps) {
  const [pos, setPos] = useState(initial)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  return (
    <div
      className={`kf-float ${className ?? ''}`}
      style={{ left: pos.x, top: pos.y, width, height }}
      onKeyDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <div
        className="kf-float-title"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const parent = (e.currentTarget.parentElement?.offsetParent as HTMLElement | null) ?? null
          const maxX = parent ? parent.clientWidth - 60 : 4000
          const maxY = parent ? parent.clientHeight - 24 : 4000
          setPos({ x: Math.max(-width + 60, Math.min(maxX, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(maxY, e.clientY - drag.current.dy)) })
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {icon && <img src={icon} width={16} height={16} alt="" />}
        <span>{title}</span>
        <button type="button" className="kf-float-close" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="kf-float-body">{children}</div>
    </div>
  )
}

/** A wx.Notebook: tabs on top, one page shown. */
export function Notebook({ tabs, active, onChange, children }: { tabs: string[]; active: number; onChange: (i: number) => void; children: ReactNode }) {
  return (
    <div className="kf-notebook">
      <div className="kf-tabs" role="tablist">
        {tabs.map((t, i) => (
          <button key={t} type="button" role="tab" aria-selected={i === active} className={i === active ? 'kf-tab-on' : ''} onClick={() => onChange(i)}>
            {t}
          </button>
        ))}
      </div>
      <div className="kf-page">{children}</div>
    </div>
  )
}
