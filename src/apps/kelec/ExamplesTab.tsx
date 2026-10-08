// The example library: cards with a thumbnail of the schematic, grouped by topic.

import { useMemo, useState } from 'react'
import { PartGlyph } from './Glyph'
import { docBounds } from './editor'
import { EXAMPLES, exampleDoc, type Example } from './examples'

const CATEGORIES = ['All', 'Basics', 'Filters', 'Rectifiers', 'Transistors', 'Op-amps', 'Oscillators', 'Power'] as const

function Thumb({ ex }: { ex: Example }) {
  const doc = useMemo(() => exampleDoc(ex), [ex])
  const b = docBounds(doc) ?? { x1: 0, y1: 0, x2: 100, y2: 100 }
  const pad = 12
  return (
    <svg className="ke-thumb" viewBox={`${b.x1 - pad} ${b.y1 - pad} ${b.x2 - b.x1 + 2 * pad} ${b.y2 - b.y1 + 2 * pad}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g className="ke-wires">{doc.wires.map((w) => <line key={w.id} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} className="ke-wire" />)}</g>
      <g className="ke-part">{doc.parts.map((p) => <PartGlyph key={p.id} part={p} />)}</g>
    </svg>
  )
}

export function ExamplesTab({ onOpen }: { onOpen(ex: Example): void }) {
  const [cat, setCat] = useState<(typeof CATEGORIES)[number]>('All')
  const [q, setQ] = useState('')
  const list = EXAMPLES.filter((e) => (cat === 'All' || e.category === cat) && `${e.title} ${e.description}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="ke-examples">
      <div className="ke-examples-bar">
        <div className="ke-tabs-inline" role="tablist">
          {CATEGORIES.map((c) => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <input className="k-input" value={q} placeholder="Filter…" aria-label="Filter the examples" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="ke-cards">
        {list.map((ex) => (
          <button key={ex.id} className="ke-card" onClick={() => onOpen(ex)}>
            <Thumb ex={ex} />
            <b>{ex.title}</b>
            <span className="ke-card-cat">{ex.category} · {ex.sim.analysis === 'tran' ? 'transient' : ex.sim.analysis === 'ac' ? 'AC sweep' : ex.sim.analysis === 'dc' ? 'DC sweep' : 'DC operating point'}</span>
            <small>{ex.description}</small>
          </button>
        ))}
        {list.length === 0 && <p className="k-muted">No example matches.</p>}
      </div>
    </div>
  )
}
