// The slide navigator down the left of the Visual tab, as on the desktop
// (navigator.py): a "Slides" header with « to fold it to a slim strip, then
// every slide as a thumbnail. Click to select, drag up or down to reorder (a
// line shows where it lands), right-click for the slide menu, Delete removes
// the selected slide. A hidden slide is washed out with a slashed eye. While
// the master is edited the list holds the master alone.

import { memo, useState } from 'react'
import { EyeOff } from 'lucide-react'
import type { Deck, Slide } from './model'
import type { Look } from './look'
import type { Media } from './media'
import { SlideView } from './SlideView'

interface ThumbProps {
  deck: Deck
  slide: Slide
  look: Look
  media: Media
  width: number
  backdrop: string | null
  master?: boolean
}

/** Everything about the presentation a thumbnail shows, except the slides themselves. */
export function deckStamp(deck: Deck, look: Look): string {
  return JSON.stringify({ ...deck, slides: deck.slides.map((s) => (s.hidden ? 0 : 1)) }) + JSON.stringify(look)
}

/** A slide drawn small (re-rendered only when something it shows changes). */
export const Thumb = memo(
  function Thumb({ deck, slide, look, media, width, backdrop, master = true }: ThumbProps & { stamp: string }) {
    return <SlideView deck={deck} slide={slide} look={look} media={media} width={width} backdrop={backdrop} master={master} />
  },
  (a, b) => a.stamp === b.stamp && a.backdrop === b.backdrop && a.media === b.media && a.width === b.width,
)

interface Props {
  deck: Deck
  look: Look
  media: Media
  backdrop: (string | null)[] | null
  current: number
  /** Editing the master: the list holds the master alone. */
  masterOf: number | null
  width: number
  onSelect: (i: number) => void
  onReorder: (order: number[]) => void
  onContextMenu: (e: React.MouseEvent, i: number) => void
  onDelete: (i: number) => void
}

export function Navigator({ deck, look, media, backdrop, current, masterOf, width, onSelect, onReorder, onContextMenu, onDelete }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const stamp = deckStamp(deck, look)

  if (masterOf !== null) {
    return (
      <div className="ks2-nav-list" tabIndex={0}>
        <div className="ks2-nav-item current" title="The master: what you put on it shows on every slide">
          <div className="ks2-nav-pic">
            <Thumb deck={deck} slide={deck.master} look={look} media={media} width={width} backdrop={null} master={false} stamp={stamp + JSON.stringify(deck.master)} />
          </div>
          <span className="ks2-nav-label">Master</span>
        </div>
      </div>
    )
  }

  const move = (from: number, to: number) => {
    const order = deck.slides.map((_, i) => i)
    order.splice(from, 1)
    order.splice(to > from ? to - 1 : to, 0, from)
    if (order.some((v, i) => v !== i)) onReorder(order)
  }

  return (
    <div
      className="ks2-nav-list"
      tabIndex={0}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).closest('input, textarea')) {
          e.preventDefault()
          e.stopPropagation()
          onDelete(current)
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          e.stopPropagation()
          onSelect(Math.max(0, Math.min(deck.slides.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1))))
        }
      }}
      onDragOver={(e) => {
        if (dragFrom === null) return
        e.preventDefault()
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>('.ks2-nav-item')]
        const at = items.findIndex((el) => {
          const r = el.getBoundingClientRect()
          return e.clientY < r.top + r.height / 2
        })
        setDropAt(at < 0 ? items.length : at)
      }}
      onDrop={(e) => {
        e.preventDefault()
        if (dragFrom !== null && dropAt !== null) move(dragFrom, dropAt)
        setDragFrom(null)
        setDropAt(null)
      }}
    >
      {deck.slides.map((s, i) => (
        <div
          key={i}
          className={`ks2-nav-item${i === current ? ' current' : ''}${s.hidden ? ' hidden' : ''}${dropAt === i && dragFrom !== null ? ' drop-before' : ''}${
            dropAt === deck.slides.length && i === deck.slides.length - 1 && dragFrom !== null ? ' drop-after' : ''
          }`}
          draggable
          onClick={() => onSelect(i)}
          onContextMenu={(e) => {
            e.preventDefault()
            onContextMenu(e, i)
          }}
          onDragStart={(e) => {
            setDragFrom(i)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/x-ks2-slide', String(i))
          }}
          onDragEnd={() => {
            setDragFrom(null)
            setDropAt(null)
          }}
          title={s.hidden ? 'Hidden — not in the PDF or the slideshow (right-click ▸ Show slide)' : s.title || undefined}
        >
          <div className="ks2-nav-pic">
            <Thumb deck={deck} slide={s} look={look} media={media} width={width} backdrop={backdrop?.[i] ?? null} stamp={stamp + JSON.stringify(s)} />
            {s.hidden && (
              <span className="ks2-nav-eye">
                <EyeOff size={12} />
              </span>
            )}
          </div>
          <span className="ks2-nav-label">{i + 1}</span>
        </div>
      ))}
    </div>
  )
}
