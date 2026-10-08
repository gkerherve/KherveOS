// The desktop's tooltips: rich HTML (the toolbar's how-to cards from
// tooltips.py) or plain text, shown after a short hover over anything with
// a data-kc-tip attribute inside the window.

import { useEffect, useRef, useState } from 'react'
import { sanitize } from './QtNode'

export function Tips({ root }: { root: React.RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ html: string; rich: boolean; x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const el = root.current
    if (!el) return
    let current: HTMLElement | null = null
    const over = (e: PointerEvent) => {
      const target = (e.target as HTMLElement).closest('[data-kc-tip]') as HTMLElement | null
      if (target === current) return
      current = target
      if (timer.current) clearTimeout(timer.current)
      setTip(null)
      if (!target) return
      timer.current = setTimeout(() => {
        const text = target.getAttribute('data-kc-tip') ?? ''
        if (!text) return
        const r = target.getBoundingClientRect()
        setTip({ html: text, rich: /<[a-z][^>]*>/i.test(text), x: r.left, y: r.bottom + 6 })
      }, 650)
    }
    const leave = () => {
      current = null
      if (timer.current) clearTimeout(timer.current)
      setTip(null)
    }
    el.addEventListener('pointerover', over)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('pointerdown', leave)
    return () => {
      el.removeEventListener('pointerover', over)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('pointerdown', leave)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [root])
  if (!tip) return null
  const style = {
    left: Math.max(4, Math.min(tip.x, window.innerWidth - 400)),
    top: tip.y + 220 > window.innerHeight ? undefined : tip.y,
    bottom: tip.y + 220 > window.innerHeight ? window.innerHeight - tip.y + 30 : undefined,
  }
  return tip.rich ? (
    <div className="kc-tip rich" style={style} dangerouslySetInnerHTML={{ __html: sanitize(tip.html) }} />
  ) : (
    <div className="kc-tip" style={style}>
      {tip.html}
    </div>
  )
}
