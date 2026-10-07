// The slide sorter on the left, as on the desktop: a thumbnail per slide,
// drag to reorder, right-click for layouts, duplicate, hide and delete.

import { memo, useState } from 'react'
import { EyeOff, Plus } from 'lucide-react'
import type { Deck, Slide } from './model'
import type { Look } from './look'
import type { Media } from './media'
import { SlideView } from './SlideView'

interface Props {
  deck: Deck
  look: Look
  media: Media
  backdrop: (string | null)[] | null
  current: number
  disabled: boolean
  onSelect: (i: number) => void
  onMove: (from: number, to: number) => void
  onContextMenu: (e: React.MouseEvent, i: number) => void
  onAdd: () => void
}

const THUMB_W = 148

interface ThumbProps {
  deck: Deck
  slide: Slide
  look: Look
  media: Media
  backdrop: string | null
  /** Changes when anything the thumbnail shows changes. */
  stamp: string
}

const Thumb = memo(
  function Thumb({ deck, slide, look, media, backdrop }: ThumbProps) {
    return <SlideView deck={deck} slide={slide} look={look} media={media} width={THUMB_W} backdrop={backdrop} />
  },
  (a, b) => a.stamp === b.stamp && a.backdrop === b.backdrop && a.media === b.media,
)

export function Sorter({ deck, look, media, backdrop, current, disabled, onSelect, onMove, onContextMenu, onAdd }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  // Everything about the deck a thumbnail shows, except the slides themselves.
  const deckStamp = JSON.stringify({ ...deck, slides: deck.slides.map((s) => (s.hidden ? 0 : 1)) }) + JSON.stringify(look)
  return (
    <div className={`ks2-sorter${disabled ? ' disabled' : ''}`}>
      {deck.slides.map((s, i) => (
        <div
          key={i}
          className={`ks2-thumb${i === current ? ' current' : ''}${s.hidden ? ' hidden' : ''}${dropAt === i && dragFrom !== null ? ' drop' : ''}`}
          draggable={!disabled}
          onClick={() => onSelect(i)}
          onContextMenu={(e) => {
            e.preventDefault()
            onSelect(i)
            onContextMenu(e, i)
          }}
          onDragStart={(e) => {
            setDragFrom(i)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/x-ks2-slide', String(i))
          }}
          onDragOver={(e) => {
            if (dragFrom === null) return
            e.preventDefault()
            setDropAt(i)
          }}
          onDragEnd={() => {
            setDragFrom(null)
            setDropAt(null)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i)
            setDragFrom(null)
            setDropAt(null)
          }}
          title={s.title || undefined}
        >
          <span className="ks2-thumb-num">
            {i + 1}
            {s.hidden && <EyeOff size={11} />}
          </span>
          <div className="ks2-thumb-pic">
            <Thumb deck={deck} slide={s} look={look} media={media} backdrop={backdrop?.[i] ?? null} stamp={deckStamp + JSON.stringify(s)} />
          </div>
        </div>
      ))}
      {!disabled && (
        <button className="ks2-thumb-add" onClick={onAdd} title="New slide">
          <Plus size={16} />
        </button>
      )}
    </div>
  )
}
