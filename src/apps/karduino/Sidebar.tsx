// The left panel of kArduino: examples, snippets and libraries.

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { EXAMPLES, EXAMPLE_CATEGORIES, SNIPPETS, type Example, type Snippet } from './examples'
import { Libraries } from './Libraries'

export type SideTab = 'examples' | 'snippets' | 'libraries'

interface Props {
  tab: SideTab
  onTab(t: SideTab): void
  current: string | null
  onExample(e: Example): void
  onSnippet(s: Snippet): void
  needed: string[]
  seed: { query: string; n: number }
}

export function Sidebar({ tab, onTab, current, onExample, onSnippet, needed, seed }: Props) {
  const [filter, setFilter] = useState('')
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return EXAMPLE_CATEGORIES.map((c) => ({
      category: c,
      items: EXAMPLES.filter((e) => e.category === c && (!f || `${e.title} ${e.description} ${e.category}`.toLowerCase().includes(f))),
    })).filter((g) => g.items.length)
  }, [filter])

  return (
    <aside className="ka-side" aria-label="Examples and libraries">
      <div className="ka-tabs" role="tablist">
        {(['examples', 'snippets', 'libraries'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
            {t === 'examples' ? 'Examples' : t === 'snippets' ? 'Snippets' : 'Libraries'}
          </button>
        ))}
      </div>
      {tab === 'examples' && (
        <>
          <label className="ka-search">
            <Search size={12} />
            <input className="k-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter examples" aria-label="Filter examples" />
          </label>
          <div className="ka-list">
            {groups.map((g) => (
              <div key={g.category}>
                <div className="ka-subtitle">{g.category}</div>
                {g.items.map((e) => (
                  <button key={e.id} className={`ka-item${current === e.id ? ' on' : ''}`} onClick={() => onExample(e)} title={e.description}>
                    <span>{e.title}</span>
                    <span className="k-muted">{e.description}</span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <div className="k-muted ka-pad">No example matches.</div>}
          </div>
        </>
      )}
      {tab === 'snippets' && (
        <div className="ka-list">
          <div className="k-muted ka-pad">Click a snippet to insert it at the cursor.</div>
          {SNIPPETS.map((s) => (
            <button key={s.id} className="ka-item" onClick={() => onSnippet(s)} title={s.code}>
              <span>{s.title}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'libraries' && <div className="ka-list"><Libraries needed={needed} seed={seed} /></div>}
    </aside>
  )
}
