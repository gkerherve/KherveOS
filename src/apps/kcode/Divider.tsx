// A draggable (and keyboard-adjustable) divider between two panes. It reports the share
// (0–1) of the container that the first pane should take.

import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

interface Props {
  /** "col": the divider is a vertical bar between left and right panes; "row": a horizontal bar between top and bottom. */
  dir: 'col' | 'row'
  container: RefObject<HTMLElement | null>
  share: number
  onChange(share: number): void
  min?: number
  max?: number
  label: string
}

export function Divider({ dir, container, share, onChange, min = 0.2, max = 0.8, label }: Props) {
  const dragging = useRef(false)
  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const move = (e: PointerEvent) => {
    if (!dragging.current) return
    const rect = container.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    onChange(clamp(dir === 'col' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height))
  }
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.03
    const dec = dir === 'col' ? 'ArrowLeft' : 'ArrowUp'
    const inc = dir === 'col' ? 'ArrowRight' : 'ArrowDown'
    if (e.key === dec) onChange(clamp(share - step))
    else if (e.key === inc) onChange(clamp(share + step))
    else return
    e.preventDefault()
  }

  return (
    <div
      className={`kcd-divider ${dir}`}
      role="separator"
      aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      tabIndex={0}
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId) }}
      onPointerMove={move}
      onPointerUp={(e) => { dragging.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }}
      onPointerCancel={() => { dragging.current = false }}
      onKeyDown={key}
    />
  )
}
