// The Welcome page inside the main window (start_page.py): one big blank
// slide in the slide area with Start (new / open / import / continue), the
// templates and the example presentations as cards, and "How do you want to
// work?" — while the slides frame on the left lists the recent
// presentations (RecentPanel). Help ▸ Welcome page brings it back; Continue
// or Esc returns to the slides.

import { useMemo } from 'react'
import { path as P } from '@/os'
import type { Deck } from './model'
import type { Media } from './media'
import { deckLook } from './look'
import { SlideView } from './SlideView'
import type { ExampleItem } from './examples'

export type Layout = 'side' | 'window' | 'visual'

/** welcome.LAYOUT_TEXT */
export const LAYOUT_TEXT: Record<Layout, [string, string]> = {
  side: ['Visual + PDF side by side', 'Design the slide on the left and watch the compiled beamer PDF on the right, updated as you edit.'],
  window: ['Visual + PDF in its own window', 'The PDF and console in a separate window you can put on a second screen; close it to dock it back.'],
  visual: ['Visual only', 'Just the slides and the Visual editor. The PDF and console are hidden and nothing compiles while you work.'],
}

interface Props {
  templates: [string, () => Deck][]
  examples: ExampleItem[] | null
  media: Media
  layout: Layout
  showAtStart: boolean
  onShowAtStart: (on: boolean) => void
  onLayout: (l: Layout) => void
  onNew: () => void
  onOpen: () => void
  onImport: () => void
  onContinue: () => void
  onTemplate: (name: string) => void
  onExample: (item: ExampleItem) => void
}

function Card({ deck, media, label, tip, onClick }: { deck: Deck | null; media: Media; label: string; tip?: string; onClick: () => void }) {
  const look = useMemo(() => (deck ? deckLook(deck) : null), [deck])
  return (
    <button className="ks2-card" title={tip} onClick={onClick}>
      <span className="ks2-card-pic">
        {deck && look && deck.slides[0] ? <SlideView deck={deck} slide={deck.slides[0]} look={look} media={media} width={150} /> : <span className="ks2-card-blank" />}
      </span>
      <span className="ks2-card-label">{label}</span>
    </button>
  )
}

export function StartPage(p: Props) {
  const decks = useMemo(() => p.templates.map(([n, make]) => [n, make()] as const), [p.templates])
  return (
    <div
      className="ks2-start"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') p.onContinue()
      }}
    >
      <div className="ks2-start-slide">
        <div className="ks2-start-head">
          <img src="/icons/apps/kherveslide.png" width={52} height={52} alt="" />
          <div className="ks2-start-titles">
            <div className="ks2-start-title">KherveSlide</div>
            <div className="ks2-start-sub">Design like in PowerPoint, present in LaTeX</div>
          </div>
          <label className="ks2-start-check">
            <input type="checkbox" checked={p.showAtStart} onChange={(e) => p.onShowAtStart(e.target.checked)} /> Show this page when KherveSlide starts
          </label>
        </div>
        <div className="ks2-start-buttons">
          <button onClick={p.onNew}>📄 New presentation</button>
          <button onClick={p.onOpen}>📂 Open…</button>
          <button onClick={p.onImport}>📊 Import PowerPoint…</button>
          <button onClick={p.onContinue}>Continue →</button>
        </div>
        <div className="ks2-start-h">Templates</div>
        <div className="ks2-cards">
          {decks.map(([n, d]) => (
            <Card key={n} deck={d} media={p.media} label={n} onClick={() => p.onTemplate(n)} />
          ))}
        </div>
        <div className="ks2-start-h">Example presentations</div>
        <div className="ks2-cards">
          {(p.examples ?? []).map((x) => (
            <Card key={x.file} deck={null} media={p.media} label={x.title} tip={x.description} onClick={() => p.onExample(x)} />
          ))}
          {!p.examples && <span className="k-muted">Loading…</span>}
        </div>
        <div className="ks2-start-h small">How do you want to work?</div>
        <div className="ks2-start-modes">
          {(Object.keys(LAYOUT_TEXT) as Layout[]).map((m) => (
            <label key={m} title={LAYOUT_TEXT[m][1]}>
              <input type="radio" checked={p.layout === m} onChange={() => p.onLayout(m)} /> {LAYOUT_TEXT[m][0]}
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The slides frame while the Welcome page shows: the recent presentations. */
export function RecentPanel({ files, exists, onChoose, onOpen }: { files: string[]; exists: (p: string) => boolean; onChoose: (p: string) => void; onOpen: () => void }) {
  return (
    <div className="ks2-recent">
      <div className="ks2-recent-list">
        {files.length === 0 && <div className="ks2-recent-empty">No recent presentations yet</div>}
        {files.map((f) => (
          <button key={f} className="ks2-recent-item" disabled={!exists(f)} title={f} onClick={() => onChoose(f)}>
            <b>{P.basename(f).replace(/\.kslide$/i, '')}</b>
            <span>{P.dirname(f)}</span>
          </button>
        ))}
      </div>
      <button className="k-btn" onClick={onOpen}>
        Open other…
      </button>
    </div>
  )
}
