// "Other Databases & Properties": a panel beside the periodic table that
// follows the selected element. On the desktop this is a window with one
// built-in browser tab per site under a tab bar (the RefBar); here, as in the
// web version, the sites open in a new browser tab, so the tab bar switches
// between the databases and the element's general properties.

import { useState } from 'react'
import { Atom, BookOpen, ChartSpline, ExternalLink, FlaskConical, GraduationCap, Library, ScrollText, Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ElementsFile } from './data'
import { PROPS_TAB, SOURCES, elementName, sourceUrl, type Source } from './sources'
import { openInBrowser } from './platform'
import { PropsPage } from './PropsPage'
import type { PanelTab } from './prefs'

export const SOURCE_ICONS: Record<string, LucideIcon> = {
  xpsfitting: ChartSpline,
  harwell: BookOpen,
  thermo: FlaskConical,
  sss: ScrollText,
  estr: GraduationCap,
}

const DATABASES_HELP = 'Follows the element you click in the periodic table. The sites open in a new browser tab.'

/** The panel's tab bar. */
export function RefBar({ tab, onTab }: { tab: PanelTab; onTab: (t: PanelTab) => void }) {
  const tabs: { id: PanelTab; label: string; icon: LucideIcon; help: string }[] = [
    { id: 'databases', label: 'Databases', icon: Library, help: 'XPS Fitting, Harwell XPS Guru, Thermo Knowledge and Google Scholar' },
    { id: 'properties', label: PROPS_TAB.title, icon: Atom, help: PROPS_TAB.help },
  ]
  return (
    <div className="kdb-refbar" role="tablist" aria-label="Other databases and properties">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          className={tab === t.id ? 'kdb-on' : ''}
          title={t.help}
          onClick={() => onTab(t.id)}
        >
          <t.icon size={14} /> {t.label}
        </button>
      ))}
    </div>
  )
}

interface PanelProps {
  element: string
  meta: ElementsFile
  tab: PanelTab
  onTab: (t: PanelTab) => void
  /** Good paper Scholar: newest papers first. */
  newestFirst: boolean
  onNewestFirst: (v: boolean) => void
  onClose: () => void
  /** A narrow window: the panel floats over the table instead of standing beside it. */
  overlay: boolean
}

export function RefPanel({ element, meta, tab, onTab, newestFirst, onNewestFirst, onClose, overlay }: PanelProps) {
  const m = meta.elements[element]
  if (!m) return null
  return (
    <aside className={`kdb-panel${overlay ? ' kdb-overlay' : ''}`} aria-label="Other databases and properties">
      <header className="kdb-panel-head">
        <span className={`kdb-info-sym kdb-cat-${m.cat}`}>{element}</span>
        <div className="kdb-panel-name">
          <div className="kdb-info-name">{elementName(element, m)}</div>
          <div className="kdb-muted">Atomic number {m.z}</div>
        </div>
        <button type="button" className="k-icon-btn" onClick={onClose} aria-label="Close panel" title="Close">
          <X size={16} />
        </button>
      </header>
      <RefBar tab={tab} onTab={onTab} />
      <div className="kdb-panel-body">
        <p className="kdb-hint">{tab === 'databases' ? DATABASES_HELP : PROPS_TAB.help}</p>
        {tab === 'databases' ? (
          SOURCES.map((s) => (
            <SourceCard key={s.id + element} source={s} element={element} meta={meta} newestFirst={newestFirst} onNewestFirst={onNewestFirst} />
          ))
        ) : (
          <PropsPage el={element} meta={meta} />
        )}
      </div>
    </aside>
  )
}

function SourceCard({
  source, element, meta, newestFirst, onNewestFirst,
}: {
  source: Source
  element: string
  meta: ElementsFile
  newestFirst: boolean
  onNewestFirst: (v: boolean) => void
}) {
  const [terms, setTerms] = useState('')
  const m = meta.elements[element]
  const url = sourceUrl(source, element, m, terms, newestFirst)
  const go = () => openInBrowser(url)
  const Icon = SOURCE_ICONS[source.id] ?? ExternalLink
  return (
    <div className="kdb-card">
      <div className="kdb-card-title">
        <Icon size={15} /> {source.title}
      </div>
      <p className="kdb-muted kdb-small">{source.help}</p>
      {source.search ? (
        <form
          className="kdb-card-search"
          onSubmit={(e) => {
            e.preventDefault()
            go()
          }}
        >
          <div className="kdb-card-row">
            <input
              className="k-input"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder={source.search.placeholder}
              title={`Type a material and press Enter or Search.\nThe query sent to Google Scholar is:\n${source.search.describe('<your material>')}`}
              spellCheck={false}
            />
            <button type="submit" className="k-btn" title={url}>
              <Search size={14} /> Search
            </button>
          </div>
          <div className="kdb-card-query kdb-muted" title={url}>
            {source.search.describe(terms.trim() || elementName(element, m))}
          </div>
          {source.search.sortable && (
            <label className="kdb-check" title={'Ticked: most relevant / most-cited papers first.\nUnticked: newest papers first.'}>
              <input type="checkbox" checked={!newestFirst} onChange={(e) => onNewestFirst(!e.target.checked)} />
              High citations
            </label>
          )}
        </form>
      ) : (
        <button type="button" className="k-btn kdb-card-open" onClick={go} title={url}>
          Open {source.title} <ExternalLink size={13} />
        </button>
      )}
    </div>
  )
}
