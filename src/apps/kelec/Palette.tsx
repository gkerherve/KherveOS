// The parts palette: a search box and the catalogue by category; click to arm a part (then click on the
// sheet), or drag one onto the sheet.

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { PartIcon } from './Glyph'
import { searchParts } from './editor'
import { CATEGORIES, defaultProps, type PartDef, type PartKind } from './model'

interface Props {
  armed: PartKind | null
  onArm(kind: PartKind): void
  inputRef?: React.Ref<HTMLInputElement>
}

export function Palette({ armed, onArm, inputRef }: Props) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchParts(query), [query])
  const groups = useMemo(() => CATEGORIES.map((c) => ({ c, items: found.filter((d) => d.category === c) })).filter((g) => g.items.length), [found])
  return (
    <div className="ke-palette">
      <label className="ke-search">
        <Search size={13} />
        <input
          ref={inputRef} className="k-input" value={query} placeholder="Search parts…" aria-label="Search parts" onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) onArm(found[0].kind); if (e.key === 'Escape') setQuery('') }}
        />
      </label>
      <div className="ke-palette-list">
        {groups.map((g) => (
          <section key={g.c}>
            <h4>{g.c}</h4>
            <div className="ke-palette-grid">
              {g.items.map((d) => <Entry key={d.kind} def={d} armed={armed === d.kind} onArm={onArm} />)}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="k-muted ke-pad">No part matches “{query}”.</p>}
      </div>
    </div>
  )
}

function Entry({ def, armed, onArm }: { def: PartDef; armed: boolean; onArm(k: PartKind): void }) {
  const part = { id: 'p', kind: def.kind, ref: def.prefix, value: def.value?.default ?? '', x: 0, y: 0, rot: 0 as const, mirror: false, props: defaultProps(def.kind) }
  return (
    <button
      className={`ke-entry${armed ? ' on' : ''}`} title={`${def.name}${def.prefix ? ` (${def.prefix})` : ''}`} draggable
      onClick={() => onArm(def.kind)} onDragStart={(e) => { e.dataTransfer.setData('text/x-kelec-part', def.kind); e.dataTransfer.effectAllowed = 'copy' }}
    >
      <PartIcon part={part} size={46} />
      <span>{def.name}</span>
    </button>
  )
}
