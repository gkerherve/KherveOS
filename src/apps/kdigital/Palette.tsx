// The parts palette: a search box and the catalogue by category; click to arm a part (then click on the sheet),
// or drag one onto the sheet.

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { PartIcon } from './Glyph'
import { searchParts } from './editor'
import { CATEGORIES, defaultProps, type KindDef, type Kind } from './model'

interface Props {
  armed: Kind | null
  onArm(kind: Kind): void
  inputRef?: React.Ref<HTMLInputElement>
}

export function Palette({ armed, onArm, inputRef }: Props) {
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchParts(query), [query])
  const groups = useMemo(() => CATEGORIES.map((c) => ({ c, items: found.filter((d) => d.category === c) })).filter((g) => g.items.length), [found])
  return (
    <div className="dg-palette">
      <label className="dg-search">
        <Search size={13} />
        <input
          ref={inputRef} className="k-input" value={query} placeholder="Search parts…" aria-label="Search parts" onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) onArm(found[0].kind); if (e.key === 'Escape') setQuery('') }}
        />
      </label>
      <div className="dg-palette-list">
        {groups.map((g) => (
          <section key={g.c}>
            <h4>{g.c}</h4>
            <div className="dg-palette-grid">
              {g.items.map((d) => <Entry key={d.kind} def={d} armed={armed === d.kind} onArm={onArm} />)}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="k-muted dg-pad">No part matches “{query}”.</p>}
      </div>
    </div>
  )
}

function Entry({ def, armed, onArm }: { def: KindDef; armed: boolean; onArm(k: Kind): void }) {
  const part = { id: 'p', kind: def.kind, ref: def.prefix, x: 0, y: 0, rot: 0 as const, mirror: false, props: defaultProps(def.kind) }
  return (
    <button
      className={`dg-entry${armed ? ' on' : ''}`} title={`${def.name} (${def.prefix})`} draggable aria-pressed={armed}
      onClick={() => onArm(def.kind)} onDragStart={(e) => { e.dataTransfer.setData('text/x-kdigital-part', def.kind); e.dataTransfer.effectAllowed = 'copy' }}
    >
      <PartIcon part={part} size={46} />
      <span>{def.name}</span>
    </button>
  )
}
