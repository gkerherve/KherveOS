// QSplitter: panes side by side (or stacked) with draggable handles. The
// desktop's initial sizes are the proportions; dragging is local.

import { memo, useRef, useState } from 'react'
import type { Node } from '../types'
import { QtNode } from './QtNode'

export const Splitter = memo(function Splitter({ n }: { n: Node }) {
  const kids = (n.kids ?? []).filter((k) => !k.hid)
  const vertical = n.o === 2
  const initial = (n.sizes ?? []).length === (n.kids ?? []).length ? (n.kids ?? []).map((k, i) => (k.hid ? 0 : n.sizes![i])).filter((_, i) => !(n.kids ?? [])[i].hid) : kids.map(() => 1)
  const [sizes, setSizes] = useState<number[] | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const current = sizes && sizes.length === kids.length ? sizes : initial
  const total = current.reduce((a, b) => a + b, 0) || 1

  const drag = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    const el = box.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const length = vertical ? rect.height : rect.width
    const start = vertical ? e.clientY : e.clientX
    const base = [...current]
    const unit = total / Math.max(length, 1)
    const move = (ev: PointerEvent) => {
      const d = ((vertical ? ev.clientY : ev.clientX) - start) * unit
      const next = [...base]
      const min = total * 0.03
      next[i] = Math.max(min, base[i] + d)
      next[i + 1] = Math.max(min, base[i + 1] - d)
      const fix = base[i] + base[i + 1] - (next[i] + next[i + 1])
      next[i + 1] += fix
      setSizes(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('k-dragging')
    }
    document.body.classList.add('k-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={box} className={`kc-split ${vertical ? 'vertical' : 'horizontal'}`}>
      {kids.map((k, i) => [
        <div key={k.id} className="kc-split-pane" style={{ flex: `${current[i]} 1 0` }}>
          <QtNode n={k} />
        </div>,
        i < kids.length - 1 ? <div key={`h${k.id}`} className="kc-split-handle" onPointerDown={drag(i)} /> : null,
      ])}
    </div>
  )
})
